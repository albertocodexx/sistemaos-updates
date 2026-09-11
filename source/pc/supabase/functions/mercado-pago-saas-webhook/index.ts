import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Este webhook e deliberadamente autocontido. Assim, sua publicacao nao depende
// de arquivos auxiliares e nao corre o risco de entrar no ar sem as validacoes.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-request-id, x-signature',
  'Content-Type': 'application/json; charset=utf-8'
};

const resposta = (status: number, corpo: Record<string, unknown>) =>
  new Response(JSON.stringify(corpo), { status, headers: cors });
const texto = (valor: unknown) => String(valor ?? '').trim();

const bytesBase64 = (valor: string) => {
  const bruto = atob(valor);
  return Uint8Array.from(bruto, (caractere) => caractere.charCodeAt(0));
};

async function chaveCifra() {
  const valor = Deno.env.get('INTEGRATION_ENCRYPTION_KEY') || '';
  let bytes: Uint8Array;
  try {
    bytes = bytesBase64(valor);
  } catch (_) {
    throw new Error('O cofre seguro da plataforma nao esta configurado.');
  }
  if (bytes.byteLength !== 32) throw new Error('O cofre seguro da plataforma esta invalido.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
}

async function decifrarJson(ivBase64: string, cifraBase64: string) {
  const chave = await chaveCifra();
  const aberto = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesBase64(ivBase64) },
    chave,
    bytesBase64(cifraBase64)
  );
  const valor = JSON.parse(new TextDecoder().decode(aberto));
  if (!valor || typeof valor !== 'object') throw new Error('Segredo da integracao invalido.');
  return valor as Record<string, unknown>;
}

async function carregarIntegracaoPlataforma(admin: any, tipo: string) {
  const { data: integracao, error } = await admin.from('integracoes_plataforma')
    .select('id,tipo,status,provedor,conta_mascarada,metadados,ultimo_erro')
    .eq('tipo', tipo).maybeSingle();
  if (error) throw error;
  if (!integracao || integracao.status !== 'conectada') return { integracao, segredo: null };
  const { data: cofre, error: cofreErro } = await admin.from('integracoes_plataforma_segredos')
    .select('iv_base64,segredo_cifrado_base64').eq('integracao_id', integracao.id).maybeSingle();
  if (cofreErro) throw cofreErro;
  if (!cofre) return { integracao, segredo: null };
  return {
    integracao,
    segredo: await decifrarJson(cofre.iv_base64, cofre.segredo_cifrado_base64)
  };
}

const mapearStatusMercadoPago = (status: unknown) => {
  switch (texto(status).toLowerCase()) {
    case 'approved': return 'aprovada';
    case 'in_process':
    case 'in_mediation':
    case 'authorized': return 'em_processamento';
    case 'rejected': return 'rejeitada';
    case 'cancelled': return 'cancelada';
    case 'refunded':
    case 'charged_back': return 'estornada';
    default: return 'pendente';
  }
};

const mensagemErro = (erro: unknown) => {
  const mensagem = erro instanceof Error ? erro.message : texto(erro);
  if (/token|secret|authorization|apikey|service.role|cofre/i.test(mensagem)) {
    return 'O servidor recusou a operacao por seguranca.';
  }
  return mensagem || 'Nao foi possivel concluir a operacao.';
};

const bytesHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer))
  .map((valor) => valor.toString(16).padStart(2, '0')).join('');

const igualdadeConstante = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let indice = 0; indice < a.length; indice += 1) diferenca |= a.charCodeAt(indice) ^ b.charCodeAt(indice);
  return diferenca === 0;
};

async function validarAssinatura(req: Request, dataId: string, segredo: string) {
  // Sem segredo configurado nao existe forma de provar que o evento veio do
  // Mercado Pago. Falhar fechado evita a liberacao de assinatura por spoofing.
  if (!segredo) return false;
  const cabecalho = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const partes = Object.fromEntries(cabecalho.split(',').map((parte) => parte.trim().split('=', 2)));
  const ts = texto(partes.ts);
  const recebida = texto(partes.v1).toLowerCase();
  if (!ts || !recebida || !requestId || !dataId) return false;
  const timestampRecebido = Number(ts);
  if (!Number.isFinite(timestampRecebido)) return false;
  const timestampMs = timestampRecebido < 1_000_000_000_000 ? timestampRecebido * 1000 : timestampRecebido;
  if (Math.abs(Date.now() - timestampMs) > 10 * 60 * 1000) return false;
  const manifesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(manifesto));
  return igualdadeConstante(bytesHex(assinatura), recebida);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return resposta(405, { erro: 'Metodo nao permitido.' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const url = new URL(req.url);
    const corpo = await req.json().catch(() => ({}));
    const dataId = texto(url.searchParams.get('data.id') || corpo?.data?.id || corpo?.id);
    const topico = texto(url.searchParams.get('type') || url.searchParams.get('topic') || corpo?.type || corpo?.topic);
    if (!dataId || (topico && !['payment', 'merchant_order'].includes(topico))) {
      return resposta(200, { recebido: true, ignorado: true });
    }

    const { integracao, segredo } = await carregarIntegracaoPlataforma(admin, 'mercado_pago');
    const accessToken = texto(segredo?.access_token);
    if (!integracao || !accessToken) return resposta(503, { erro: 'Integracao Mercado Pago indisponivel.' });
    if (!(await validarAssinatura(req, dataId, texto(segredo?.webhook_secret)))) {
      console.warn('[mercado-pago-saas-webhook] assinatura invalida');
      return resposta(401, { erro: 'Assinatura do webhook invalida.' });
    }

    let paymentId = dataId;
    if (topico === 'merchant_order') {
      const ordemResposta = await fetch(`https://api.mercadopago.com/merchant_orders/${encodeURIComponent(dataId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000)
      });
      if (!ordemResposta.ok) return resposta(502, { erro: 'Ordem ainda não pode ser consultada.' });
      const ordem = await ordemResposta.json().catch(() => ({}));
      paymentId = texto((ordem.payments || []).find((item: any) => item.status === 'approved')?.id || ordem.payments?.[0]?.id);
      if (!paymentId) return resposta(200, { recebido: true, aguardando_pagamento: true });
    }

    const pagamentoResposta = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000)
    });
    const pagamento = await pagamentoResposta.json().catch(() => ({}));
    if (!pagamentoResposta.ok) {
      console.error('[mercado-pago-saas-webhook] pagamento nao consultado', pagamentoResposta.status);
      return resposta(502, { erro: 'Pagamento ainda nao pode ser consultado.' });
    }
    if (!/^\d+$/.test(texto(pagamento.id)) || texto(pagamento.id) !== paymentId || pagamento.live_mode === false) {
      return resposta(200, { recebido: true, ignorado: true });
    }

    const referencia = texto(pagamento.external_reference);
    if (!referencia.startsWith('SAAS-')) return resposta(200, { recebido: true, ignorado: true });
    const { data: cobranca, error: cobrancaErro } = await admin.from('cobrancas_assinatura')
      .select('id,empresa_id,plano_id,valor,moeda,status,aplicado_em,pagamento_provedor_id')
      .eq('referencia_externa', referencia).maybeSingle();
    if (cobrancaErro) throw cobrancaErro;
    if (!cobranca) return resposta(200, { recebido: true, referencia_desconhecida: true });
    if (cobranca.aplicado_em && (texto(cobranca.pagamento_provedor_id) !== texto(pagamento.id)
      || !['approved', 'refunded', 'charged_back'].includes(pagamento.status))) {
      return resposta(200, { recebido: true, ignorado: true });
    }

    const valorRecebido = Number(pagamento.transaction_amount || 0);
    const moeda = texto(pagamento.currency_id);
    if (!Number.isFinite(valorRecebido) || moeda !== cobranca.moeda || Math.abs(valorRecebido - Number(cobranca.valor)) > 0.009
      || (pagamento.status === 'approved' && Number(pagamento.transaction_amount_refunded || 0) > 0)) {
      await admin.from('cobrancas_assinatura').update({
        status: 'rejeitada', pagamento_provedor_id: texto(pagamento.id),
        status_detalhe: 'Valor ou moeda divergente do checkout.',
        dados_provedor: { status: pagamento.status, status_detail: pagamento.status_detail }
      }).eq('id', cobranca.id).is('aplicado_em', null);
      console.error('[mercado-pago-saas-webhook] valor divergente', cobranca.id);
      return resposta(200, { recebido: true, divergencia: true });
    }

    const status = mapearStatusMercadoPago(pagamento.status);
    const pagoEm = pagamento.date_approved || pagamento.date_created || new Date().toISOString();
    const dadosMinimos = {
      status: texto(pagamento.status),
      status_detail: texto(pagamento.status_detail),
      payment_type_id: texto(pagamento.payment_type_id),
      payment_method_id: texto(pagamento.payment_method_id),
      date_approved: pagamento.date_approved || null
    };
    let atualizacao = admin.from('cobrancas_assinatura').update({
      status,
      pagamento_provedor_id: texto(pagamento.id),
      pago_em: status === 'aprovada' ? pagoEm : null,
      status_detalhe: texto(pagamento.status_detail).slice(0, 300) || null,
      dados_provedor: dadosMinimos
    }).eq('id', cobranca.id);
    atualizacao = cobranca.aplicado_em
      ? atualizacao.eq('pagamento_provedor_id', texto(pagamento.id))
      : atualizacao.is('aplicado_em', null);
    const { data: cobrancaAtualizada, error: atualizarErro } = await atualizacao.select('id').maybeSingle();
    if (atualizarErro) throw atualizarErro;
    if (!cobrancaAtualizada) return resposta(200, { recebido: true, ignorado: true });

    let aplicacao = null;
    if (status === 'aprovada' && !cobranca.aplicado_em) {
      const { data, error } = await admin.rpc('aplicar_pagamento_assinatura', {
        p_cobranca_id: cobranca.id,
        p_pagamento_provedor_id: texto(pagamento.id),
        p_pago_em: pagoEm,
        p_forma: texto(pagamento.payment_type_id || pagamento.payment_method_id || 'mercado_pago'),
        p_dados_provedor: dadosMinimos
      });
      if (error) throw error;
      aplicacao = data;
    }

    if (status === 'estornada' && cobranca.aplicado_em) {
      await admin.from('pagamentos_assinatura').update({ status: 'estornado', updated_at: new Date().toISOString() })
        .eq('cobranca_id', cobranca.id);
      await admin.from('alertas_assinatura').upsert({
        empresa_id: cobranca.empresa_id,
        tipo: 'pagamento_falhou',
        titulo: 'Pagamento estornado',
        mensagem: 'O pagamento da assinatura foi estornado. Entre em contato com o suporte.',
        chave_unica: `estorno:${cobranca.id}`
      }, { onConflict: 'chave_unica' });
    }

    return resposta(200, { recebido: true, status, aplicacao });
  } catch (erro) {
    console.error('[mercado-pago-saas-webhook]', mensagemErro(erro));
    return resposta(500, { erro: 'Nao foi possivel processar a notificacao.' });
  }
});
