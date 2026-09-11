import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  carregarIntegracaoPlataforma, cors, mapearStatusMercadoPago, resposta, texto
} from './saas.ts';

const compararSeguro = (esperado: string, recebido: string) => {
  if (!esperado || recebido.length !== esperado.length) return false;
  let diferenca = 0;
  for (let indice = 0; indice < esperado.length; indice += 1) {
    diferenca |= esperado.charCodeAt(indice) ^ recebido.charCodeAt(indice);
  }
  return diferenca === 0;
};

const segredoValido = (req: Request) => {
  const segredoCron = texto(Deno.env.get('ASSINATURAS_CRON_SECRET'));
  const recebidoCron = texto(req.headers.get('x-cron-secret'));
  if (segredoCron.length >= 24 && compararSeguro(segredoCron, recebidoCron)) return true;

  // O Supabase Cron pode invocar a função com o service_role armazenado no
  // Vault. Isso evita depender de um computador ou aplicativo aberto.
  const serviceRole = texto(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const authorization = texto(req.headers.get('Authorization'));
  return serviceRole.length >= 24 && compararSeguro(`Bearer ${serviceRole}`, authorization);
};

async function reconciliarMercadoPago(admin: any) {
  const { integracao, segredo } = await carregarIntegracaoPlataforma(admin, 'mercado_pago');
  const token = texto(segredo?.access_token);
  if (!integracao || !token) return { consultadas: 0, aplicadas: 0, indisponivel: true };
  const { data: cobrancas, error } = await admin.from('cobrancas_assinatura')
    .select('id,referencia_externa,valor,moeda,status,aplicado_em')
    .is('aplicado_em', null)
    .in('status', ['pendente', 'em_processamento', 'aprovada', 'rejeitada', 'cancelada', 'expirada'])
    .order('updated_at', { ascending: true }).limit(25);
  if (error) throw error;
  let aplicadas = 0;
  for (const cobranca of cobrancas || []) {
    // Faz a fila rodar: 25 cobranças antigas sem pagamento não podem impedir
    // indefinidamente a consulta das próximas. Aprovada sem aplicado_em é retry.
    await admin.from('cobrancas_assinatura').update({ updated_at: new Date().toISOString() }).eq('id', cobranca.id);
    try {
    const consulta = await fetch(
      `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(cobranca.referencia_externa)}&status=approved&sort=date_created&criteria=desc&limit=100`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) }
    );
    if (!consulta.ok) continue;
    const retorno = await consulta.json().catch(() => ({}));
    const pagamento = (Array.isArray(retorno.results) ? retorno.results : [])
      .find((item: any) => texto(item.external_reference) === cobranca.referencia_externa
        && item.status === 'approved' && /^\d+$/.test(texto(item.id))
        && item.currency_id === cobranca.moeda && item.live_mode !== false
        && Number(item.transaction_amount_refunded || 0) === 0
        && Number.isFinite(Number(item.transaction_amount))
        && Math.abs(Number(item.transaction_amount) - Number(cobranca.valor)) < 0.009);
    if (!pagamento) continue;
    const valor = Number(pagamento.transaction_amount || 0);
    const moeda = texto(pagamento.currency_id);
    if (moeda !== cobranca.moeda || Math.abs(valor - Number(cobranca.valor)) > 0.009) continue;
    const status = mapearStatusMercadoPago(pagamento.status);
    const dadosMinimos = {
      status: texto(pagamento.status), status_detail: texto(pagamento.status_detail),
      payment_type_id: texto(pagamento.payment_type_id), payment_method_id: texto(pagamento.payment_method_id),
      date_approved: pagamento.date_approved || null, reconciliado: true
    };
    const { data: atualizada, error: atualizacaoErro } = await admin.from('cobrancas_assinatura').update({
      status, pagamento_provedor_id: texto(pagamento.id),
      pago_em: status === 'aprovada' ? (pagamento.date_approved || new Date().toISOString()) : null,
      status_detalhe: texto(pagamento.status_detail).slice(0, 300) || null,
      dados_provedor: dadosMinimos
    }).eq('id', cobranca.id).is('aplicado_em', null).select('id').maybeSingle();
    if (atualizacaoErro) throw atualizacaoErro;
    if (!atualizada) continue;
    if (status === 'aprovada' && !cobranca.aplicado_em) {
      const { error: aplicarErro } = await admin.rpc('aplicar_pagamento_assinatura', {
        p_cobranca_id: cobranca.id,
        p_pagamento_provedor_id: texto(pagamento.id),
        p_pago_em: pagamento.date_approved || new Date().toISOString(),
        p_forma: texto(pagamento.payment_type_id || pagamento.payment_method_id || 'mercado_pago'),
        p_dados_provedor: dadosMinimos
      });
      if (!aplicarErro) aplicadas += 1;
      else console.error('[assinaturas-worker] aplicar:', aplicarErro.message);
    }
    } catch (_) {
      // Uma consulta indisponível não interrompe as outras cobranças/mensagens.
      console.error('[assinaturas-worker] Consulta de pagamento adiada.');
    }
  }
  return { consultadas: (cobrancas || []).length, aplicadas, indisponivel: false };
}

const valoresTemplate = (parametros: Record<string, unknown>, alias: string) => {
  if (Array.isArray(parametros.template_body)) return parametros.template_body.map((item) => texto(item));
  if (alias === 'pagamento_confirmado') {
    return [parametros.empresa, parametros.plano, parametros.valor, parametros.vencimento].map(texto);
  }
  return [parametros.empresa, parametros.plano, parametros.vencimento].map(texto);
};

async function processarWhatsApp(admin: any) {
  // Após interrupção não sabemos se o provedor aceitou o envio. Mantenha o
  // registro visível para conferência, sem reenviar automaticamente em dobro.
  await admin.from('fila_whatsapp').update({
    status: 'cancelada',
    ultimo_erro: 'Envio interrompido sem confirmação. Confira o histórico do WhatsApp antes de reenviar.',
    proxima_tentativa_em: null
  }).eq('status', 'processando').lt('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  const { integracao, segredo } = await carregarIntegracaoPlataforma(admin, 'whatsapp');
  const hibrido = integracao?.provedor === 'hibrido_baileys_meta';
  if (!['meta_cloud_api', 'hibrido_baileys_meta'].includes(integracao?.provedor)) {
    return { selecionadas: 0, enviadas: 0, falhas: 0, indisponivel: true, motivo: 'canal_baileys_depende_pc' };
  }
  const token = texto(segredo?.access_token);
  if (!integracao || !token) return { selecionadas: 0, enviadas: 0, falhas: 0, indisponivel: true };
  const metadados = integracao.metadados || {};
  const phoneNumberId = texto(metadados.phone_number_id);
  const versao = /^v\d+\.\d+$/.test(texto(metadados.graph_version)) ? texto(metadados.graph_version) : 'v23.0';
  const templates = metadados.templates || {};
  const idioma = texto(metadados.idioma || 'pt_BR');
  if (!phoneNumberId) return { selecionadas: 0, enviadas: 0, falhas: 0, indisponivel: true };

  const agora = new Date().toISOString();
  let consultaFila = admin.from('fila_whatsapp')
    .select('id,destinatario,template_nome,template_idioma,parametros,tentativas,max_tentativas')
    .in('status', ['pendente', 'falhou']).lte('agendada_para', agora)
    .or(`proxima_tentativa_em.is.null,proxima_tentativa_em.lte.${agora}`)
    .order('created_at', { ascending: true }).limit(25);
  if (hibrido) consultaFila = consultaFila.lte('created_at', new Date(Date.now() - 120000).toISOString());
  const { data: fila, error } = await consultaFila;
  if (error) throw error;
  let enviadas = 0;
  let falhas = 0;
  for (const item of fila || []) {
    const tentativas = Number(item.tentativas || 0) + 1;
    const bloqueio = await admin.from('fila_whatsapp').update({ status: 'processando', tentativas })
      .eq('id', item.id).in('status', ['pendente', 'falhou']).select('id').maybeSingle();
    if (bloqueio.error || !bloqueio.data) continue;
    try {
    const alias = item.template_nome === 'sistemaos_pagamento_confirmado' ? 'pagamento_confirmado'
      : item.template_nome === 'sistemaos_assinatura_vencida' ? 'vencida' : 'lembrete';
    const nomeTemplate = texto(templates[alias]);
    if (!nomeTemplate) {
      falhas += 1;
      await admin.from('fila_whatsapp').update({
        status: tentativas >= Number(item.max_tentativas) ? 'cancelada' : 'falhou',
        ultimo_erro: `Modelo de mensagem ${alias} ainda nao foi configurado na Meta.`,
        proxima_tentativa_em: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
      }).eq('id', item.id);
      continue;
    }
    const parametros = item.parametros && typeof item.parametros === 'object' ? item.parametros : {};
    const corpo = {
      messaging_product: 'whatsapp',
      to: texto(item.destinatario),
      type: 'template',
      template: {
        name: nomeTemplate,
        language: { code: texto(item.template_idioma || idioma) },
        components: [{
          type: 'body',
          parameters: valoresTemplate(parametros, alias).map((valor) => ({ type: 'text', text: valor }))
        }]
      }
    };
    const envio = await fetch(`https://graph.facebook.com/${versao}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify(corpo)
    });
    const retorno = await envio.json().catch(() => ({}));
    if (envio.ok && retorno?.messages?.[0]?.id) {
      enviadas += 1;
      await admin.from('fila_whatsapp').update({
        status: 'enviada', processada_em: new Date().toISOString(),
        id_mensagem_provedor: texto(retorno.messages[0].id), ultimo_erro: null, proxima_tentativa_em: null
      }).eq('id', item.id);
    } else {
      falhas += 1;
      const minutos = Math.min(360, 2 ** Math.min(tentativas, 8));
      await admin.from('fila_whatsapp').update({
        status: tentativas >= Number(item.max_tentativas) ? 'cancelada' : 'falhou',
        ultimo_erro: texto(retorno?.error?.message || `HTTP ${envio.status}`).slice(0, 500),
        proxima_tentativa_em: new Date(Date.now() + minutos * 60000).toISOString()
      }).eq('id', item.id);
    }
    } catch (_) {
      falhas += 1;
      await admin.from('fila_whatsapp').update({
        status: 'cancelada', proxima_tentativa_em: null,
        ultimo_erro: 'O provedor não confirmou o envio. Confira o histórico antes de reenviar para evitar duplicidade.'
      }).eq('id', item.id).eq('status', 'processando');
    }
  }
  return { selecionadas: (fila || []).length, enviadas, falhas, indisponivel: false };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!segredoValido(req)) return resposta(401, { erro: 'Chamada do agendador nao autorizada.' });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const { data: alertas, error: alertaErro } = await admin.rpc('gerar_alertas_assinatura');
    if (alertaErro) throw alertaErro;
    const mercadoPago = await reconciliarMercadoPago(admin);
    const whatsapp = await processarWhatsApp(admin);
    return resposta(200, { sucesso: true, alertas_gerados: Number(alertas || 0), mercado_pago: mercadoPago, whatsapp });
  } catch (erro) {
    console.error('[assinaturas-worker]', erro);
    return resposta(500, { erro: 'Nao foi possivel executar o processamento agendado agora.' });
  }
});
