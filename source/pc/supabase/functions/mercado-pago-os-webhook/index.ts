import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Registro = Record<string, any>;
const headers = { 'Content-Type': 'application/json; charset=utf-8' };
const texto = (valor: unknown) => String(valor ?? '').trim();
const responder = (status: number, corpo: Registro) =>
  new Response(JSON.stringify(corpo), { status, headers });

const base64Bytes = (valor: string) => {
  const bruto = atob(valor);
  return Uint8Array.from(bruto, (caractere) => caractere.charCodeAt(0));
};

async function decifrar(ivBase64: string, cifraBase64: string) {
  const material = texto(Deno.env.get('INTEGRATION_ENCRYPTION_KEY'));
  let bytes: Uint8Array;
  try { bytes = base64Bytes(material); } catch (_) { throw new Error('cofre_indisponivel'); }
  if (bytes.byteLength !== 32) throw new Error('cofre_indisponivel');
  const chave = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
  const aberto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64Bytes(ivBase64) },
    chave, base64Bytes(cifraBase64));
  return new TextDecoder().decode(aberto);
}

async function sha256(valor: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valor));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const mapearStatus = (status: unknown) => {
  switch (texto(status).toLowerCase()) {
    case 'approved': return 'aprovada';
    case 'authorized':
    case 'in_process':
    case 'in_mediation': return 'em_processamento';
    case 'rejected': return 'rejeitada';
    case 'cancelled': return 'cancelada';
    case 'refunded':
    case 'charged_back': return 'estornada';
    default: return 'pendente';
  }
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder(405, { erro: 'Metodo nao permitido.' });
  try {
    const urlRequisicao = new URL(req.url);
    const empresaId = texto(urlRequisicao.searchParams.get('empresa'));
    const tokenWebhook = texto(urlRequisicao.searchParams.get('token'));
    if (!/^[0-9a-f-]{36}$/i.test(empresaId) || !/^[A-Za-z0-9_-]{40,160}$/.test(tokenWebhook)) {
      return responder(200, { recebido: true, ignorado: true });
    }
    const corpo = await req.json().catch(() => ({}));
    const topico = texto(urlRequisicao.searchParams.get('type') || urlRequisicao.searchParams.get('topic') || corpo?.type || corpo?.topic);
    const dataId = texto(urlRequisicao.searchParams.get('data.id') || corpo?.data?.id || corpo?.id);
    if (!dataId || (topico && !['payment', 'merchant_order'].includes(topico))) {
      return responder(200, { recebido: true, ignorado: true });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } });
    const tokenHash = await sha256(tokenWebhook);
    const { data: cobranca, error: cobrancaErro } = await admin.from('cobrancas_os_mp')
      .select('id,empresa_id,ordem_id,numero_os,valor_centavos,moeda,referencia_externa,status,pagamento_provedor_id')
      .eq('empresa_id', empresaId).eq('webhook_token_hash', tokenHash).maybeSingle();
    if (cobrancaErro) throw cobrancaErro;
    if (!cobranca) return responder(200, { recebido: true, ignorado: true });

    const { data: integracao, error: integracaoErro } = await admin.from('integracoes_empresa')
      .select('id,status').eq('empresa_id', empresaId).eq('tipo', 'mercado_pago').maybeSingle();
    if (integracaoErro) throw integracaoErro;
    if (!integracao || integracao.status !== 'conectada') return responder(503, { erro: 'Integracao indisponivel.' });
    const { data: segredo, error: segredoErro } = await admin.from('integracoes_segredos')
      .select('iv_base64,segredo_cifrado_base64').eq('integracao_id', integracao.id).maybeSingle();
    if (segredoErro || !segredo) return responder(503, { erro: 'Integracao indisponivel.' });
    const accessToken = await decifrar(segredo.iv_base64, segredo.segredo_cifrado_base64);

    let paymentId = dataId;
    if (topico === 'merchant_order') {
      const ordemResposta = await fetch(`https://api.mercadopago.com/merchant_orders/${encodeURIComponent(dataId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000)
      });
      if (!ordemResposta.ok) return responder(502, { erro: 'Pagamento ainda nao disponivel.' });
      const ordem = await ordemResposta.json().catch(() => ({}));
      paymentId = texto((ordem.payments || []).find((item: any) => item.status === 'approved')?.id || ordem.payments?.[0]?.id);
      if (!paymentId) return responder(200, { recebido: true, aguardando_pagamento: true });
    }
    if (!/^\d+$/.test(paymentId)) return responder(200, { recebido: true, ignorado: true });

    const pagamentoResposta = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000)
    });
    const pagamento = await pagamentoResposta.json().catch(() => ({}));
    if (!pagamentoResposta.ok) return responder(502, { erro: 'Pagamento ainda nao disponivel.' });
    if (texto(pagamento.id) !== paymentId ||
        (accessToken.startsWith('APP_USR-') && pagamento.live_mode !== true) ||
        (accessToken.startsWith('TEST-') && pagamento.live_mode !== false)) {
      return responder(200, { recebido: true, ignorado: true });
    }

    const metadata = pagamento.metadata && typeof pagamento.metadata === 'object' ? pagamento.metadata : {};
    const valorCentavos = Math.round(Number(pagamento.transaction_amount || 0) * 100);
    if (texto(pagamento.external_reference) !== cobranca.referencia_externa ||
        texto(metadata.empresa_id) !== empresaId || texto(metadata.cobranca_id) !== cobranca.id ||
        texto(metadata.ordem_id) !== cobranca.ordem_id || texto(pagamento.currency_id) !== cobranca.moeda ||
        valorCentavos !== Number(cobranca.valor_centavos)) {
      await admin.from('cobrancas_os_mp').update({ ultimo_erro: 'Pagamento divergente recusado pelo servidor.',
        updated_at: new Date().toISOString() }).eq('id', cobranca.id);
      return responder(200, { recebido: true, divergencia: true });
    }
    if (cobranca.pagamento_provedor_id && cobranca.pagamento_provedor_id !== paymentId) {
      return responder(200, { recebido: true, ignorado: true });
    }

    const totalEstornado = Math.max(0, Math.min(valorCentavos,
      Math.round(Number(pagamento.transaction_amount_refunded || 0) * 100)));
    let status = mapearStatus(pagamento.status);
    if (totalEstornado >= valorCentavos) status = 'estornada';
    const valorLiquidoCentavos = status === 'aprovada' ? valorCentavos - totalEstornado : 0;
    const dadosMinimos = {
      status: texto(pagamento.status), status_detail: texto(pagamento.status_detail).slice(0, 120),
      payment_type_id: texto(pagamento.payment_type_id), payment_method_id: texto(pagamento.payment_method_id),
      date_approved: pagamento.date_approved || null,
      valor_estornado_centavos: totalEstornado, valor_liquido_centavos: valorLiquidoCentavos
    };
    const { data: aplicado, error: aplicarErro } = await admin.rpc('aplicar_status_cobranca_os_mp', {
      p_cobranca_id: cobranca.id, p_pagamento_id: paymentId, p_status: status,
      p_valor_centavos: valorCentavos,
      p_pago_em: pagamento.date_approved || pagamento.date_created || new Date().toISOString(),
      p_dados_provedor: dadosMinimos
    });
    if (aplicarErro) throw aplicarErro;
    return responder(200, { recebido: true, status, aplicado: aplicado?.aplicada === true });
  } catch (_) {
    console.error('[mercado-pago-os-webhook] processamento adiado');
    return responder(500, { erro: 'Pagamento ainda nao pode ser conciliado.' });
  }
});
