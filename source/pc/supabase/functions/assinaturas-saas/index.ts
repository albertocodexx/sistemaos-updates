import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { contextoUsuarioAtivo, temPermissao } from '../_shared/access.ts';
import {
  carregarIntegracaoPlataforma, cifrarJson, cors, resposta, texto
} from './saas.ts';

const emailValido = (valor: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
const telefoneLimpo = (valor: unknown) => texto(valor).replace(/\D/g, '').slice(0, 15);
const uuidValido = (valor: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(texto(valor));

async function salvarSegredo(admin: any, integracao: any, segredoAberto: Record<string, unknown>) {
  const segredo = await cifrarJson(segredoAberto);
  const { error } = await admin.from('integracoes_plataforma_segredos').upsert({
    integracao_id: integracao.id,
    iv_base64: segredo.iv,
    segredo_cifrado_base64: segredo.cifra,
    atualizado_em: new Date().toISOString()
  });
  if (error) throw error;
}

async function administradorGeral(admin: any, usuarioId: string) {
  const { data, error } = await admin.from('administradores_globais')
    .select('papel,ativo').eq('usuario_id', usuarioId).maybeSingle();
  if (error) throw error;
  return data?.ativo === true && data?.papel === 'administrador_geral';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return resposta(401, { erro: 'Sessao invalida.' });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cliente = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const { data: autenticacao } = await cliente.auth.getUser();
    if (!autenticacao.user) return resposta(401, { erro: 'Sessao invalida.' });

    const { data: contextoConsulta, error: contextoErro } = await cliente.rpc('obter_contexto_comercial');
    const contexto = Array.isArray(contextoConsulta) ? contextoConsulta[0] : contextoConsulta;
    if (contextoErro || !contexto || !contextoUsuarioAtivo(contexto)) {
      return resposta(403, { erro: 'Conta inativa ou sem empresa vinculada.' });
    }

    const corpo = await req.json().catch(() => ({}));
    const acao = texto(corpo.acao);
    const dados = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
    const eAdminGeral = await administradorGeral(admin, autenticacao.user.id);

    if (acao === 'catalogo' || acao === 'resumo') {
      const { data: planos, error: planosErro } = await admin.from('planos')
        .select('id,nome,descricao,preco_referencia,periodo,duracao_dias,ordem,destaque,limites,plano_recursos(habilitado,limite,recurso:recursos(chave,nome,descricao))')
        .eq('ativo', true).is('excluido_em', null).order('ordem').order('preco_referencia');
      if (planosErro) throw planosErro;
      const empresaId = contexto.empresa_id;
      let empresa = null;
      let cobrancas: any[] = [];
      let alertas: any[] = [];
      if (empresaId && !contexto.administrador_global) {
        const [empresaConsulta, cobrancasConsulta, alertasConsulta] = await Promise.all([
          admin.from('empresas').select('id,nome_fantasia,plano_id,licenca_status,data_vencimento,periodo_graca_ate,contato_cobranca_nome,contato_cobranca_email,contato_cobranca_whatsapp,avisos_cobranca_ativos,plano:planos(id,nome)').eq('id', empresaId).single(),
          admin.from('cobrancas_assinatura').select('id,plano_id,tipo_alteracao,valor,status,checkout_url,expira_em,pago_em,aplicado_em,created_at,plano:planos(nome)').eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(10),
          admin.from('alertas_assinatura').select('id,tipo,titulo,mensagem,lido_em,created_at').eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(20)
        ]);
        if (empresaConsulta.error) throw empresaConsulta.error;
        if (cobrancasConsulta.error) throw cobrancasConsulta.error;
        if (alertasConsulta.error) throw alertasConsulta.error;
        empresa = empresaConsulta.data;
        cobrancas = cobrancasConsulta.data || [];
        alertas = alertasConsulta.data || [];
      }
      return resposta(200, { planos: planos || [], empresa, cobrancas, alertas });
    }

    if (acao === 'salvar_contato') {
      if (!contexto.empresa_id || contexto.administrador_global) return resposta(403, { erro: 'Entre na empresa cliente.' });
      const pode = temPermissao(contexto, 'configuracoes', 'editar');
      if (!pode) return resposta(403, { erro: 'Somente o administrador da empresa pode alterar o contato de cobranca.' });
      const telefone = telefoneLimpo(dados.whatsapp);
      const email = texto(dados.email).toLowerCase().slice(0, 254);
      if (telefone && (telefone.length < 10 || telefone.length > 15)) return resposta(400, { erro: 'WhatsApp de cobranca invalido.' });
      if (email && !emailValido(email)) return resposta(400, { erro: 'E-mail de cobranca invalido.' });
      const modo = ['baileys', 'api', 'hibrido'].includes(texto(dados.modo)) ? texto(dados.modo) : 'baileys';
      const { data: empresa, error } = await admin.from('empresas').update({
        contato_cobranca_nome: texto(dados.nome).slice(0, 120) || null,
        contato_cobranca_email: email || null,
        contato_cobranca_whatsapp: telefone || null,
        avisos_cobranca_ativos: dados.avisosAtivos !== false,
        whatsapp_modo: modo,
        updated_at: new Date().toISOString()
      }).eq('id', contexto.empresa_id)
        .select('contato_cobranca_nome,contato_cobranca_email,contato_cobranca_whatsapp,avisos_cobranca_ativos,whatsapp_modo').single();
      if (error) throw error;
      return resposta(200, { empresa, mensagem: 'Contato de cobranca atualizado.' });
    }

    if (acao === 'criar_checkout') {
      if (!contexto.empresa_id || contexto.administrador_global) return resposta(403, { erro: 'Entre na empresa cliente para assinar.' });
      const pode = temPermissao(contexto, 'configuracoes', 'editar');
      if (!pode) return resposta(403, { erro: 'Somente o administrador da empresa pode alterar a assinatura.' });
      const planoId = texto(dados.planoId);
      const { data: plano, error: planoErro } = await admin.from('planos')
        .select('id,nome,descricao,preco_referencia,periodo,duracao_dias,ativo,excluido_em')
        .eq('id', planoId).eq('ativo', true).is('excluido_em', null).maybeSingle();
      if (planoErro) throw planoErro;
      if (!plano || Number(plano.preco_referencia) <= 0) return resposta(400, { erro: 'Plano pago invalido ou indisponivel.' });
      const quantidadeMeses = Math.max(1, Math.min(12, Number.isInteger(Number(dados.quantidadeMeses)) ? Number(dados.quantidadeMeses) : 1));
      const valorTotal = Number((Number(plano.preco_referencia) * quantidadeMeses).toFixed(2));
      const duracaoTotal = Number(plano.duracao_dias) * quantidadeMeses;

      const { data: empresa, error: empresaErro } = await admin.from('empresas')
        .select('id,nome_fantasia,plano_id,licenca_status,contato_cobranca_nome,contato_cobranca_email')
        .eq('id', contexto.empresa_id).single();
      if (empresaErro) throw empresaErro;
      const { data: pendente, error: pendenteErro } = await admin.from('cobrancas_assinatura')
        .select('id,checkout_url,expira_em,status').eq('empresa_id', empresa.id).eq('plano_id', plano.id)
        .eq('duracao_dias', duracaoTotal).eq('valor', valorTotal)
        .in('status', ['pendente', 'em_processamento']).gt('expira_em', new Date(Date.now() + 120000).toISOString())
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (pendenteErro) throw pendenteErro;
      if (pendente?.checkout_url) {
        return resposta(200, { cobranca: pendente, link: pendente.checkout_url, reutilizada: true });
      }

      const { integracao, segredo } = await carregarIntegracaoPlataforma(admin, 'mercado_pago');
      const accessToken = texto(segredo?.access_token);
      if (!integracao || !accessToken) return resposta(409, { erro: 'O Mercado Pago das assinaturas ainda nao foi configurado pelo suporte.' });

      const cobrancaId = crypto.randomUUID();
      const referencia = `SAAS-${empresa.id}-${cobrancaId}`;
      const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const tipoAlteracao = !empresa.plano_id ? 'primeira_assinatura'
        : empresa.licenca_status === 'vencida' ? 'reativacao'
        : empresa.plano_id === plano.id ? 'renovacao'
        : texto(dados.tipoAlteracao) === 'downgrade' ? 'downgrade' : 'upgrade';
      const { data: cobranca, error: cobrancaErro } = await admin.from('cobrancas_assinatura').insert({
        id: cobrancaId,
        empresa_id: empresa.id,
        plano_anterior_id: empresa.plano_id,
        plano_id: plano.id,
        tipo_alteracao: tipoAlteracao,
        valor: valorTotal,
        duracao_dias: duracaoTotal,
        referencia_externa: referencia,
        status: 'pendente',
        expira_em: expiraEm
      }).select('id,idempotency_key').single();
      if (cobrancaErro) throw cobrancaErro;

      const notificationUrl = `${url.replace(/\/$/, '')}/functions/v1/mercado-pago-saas-webhook`;
      const returnUrl = texto(Deno.env.get('SAAS_BILLING_RETURN_URL'));
      const email = texto(empresa.contato_cobranca_email).toLowerCase();
      const preferenciaBody: Record<string, unknown> = {
        items: [{
          id: plano.id,
          title: `Sistema OS - Plano ${plano.nome}`.slice(0, 250),
          description: texto(plano.descricao).slice(0, 250),
          quantity: quantidadeMeses,
          currency_id: 'BRL',
          unit_price: Number(Number(plano.preco_referencia).toFixed(2))
        }],
        external_reference: referencia,
        notification_url: notificationUrl,
        expires: true,
        expiration_date_to: expiraEm,
        statement_descriptor: 'SISTEMA OS',
        metadata: { cobranca_id: cobrancaId, empresa_id: empresa.id, plano_id: plano.id, quantidade_meses: quantidadeMeses },
        ...(emailValido(email) ? { payer: { email, name: texto(empresa.contato_cobranca_nome || empresa.nome_fantasia).slice(0, 120) } } : {})
      };
      if (/^https:\/\//i.test(returnUrl)) {
        preferenciaBody.back_urls = { success: returnUrl, pending: returnUrl, failure: returnUrl };
        preferenciaBody.auto_return = 'approved';
      }

      const mpResposta = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': String(cobranca.idempotency_key)
        },
        body: JSON.stringify(preferenciaBody)
      });
      const preferencia = await mpResposta.json().catch(() => ({}));
      const link = texto(preferencia.init_point || preferencia.sandbox_init_point);
      if (!mpResposta.ok || !link) {
        const detalhe = texto(preferencia.message || preferencia.error || `HTTP ${mpResposta.status}`).slice(0, 300);
        await admin.from('cobrancas_assinatura').update({ status: 'rejeitada', status_detalhe: detalhe }).eq('id', cobrancaId);
        return resposta(502, { erro: `O Mercado Pago recusou a criacao do checkout: ${detalhe}` });
      }
      const { data: atualizada, error: atualizarErro } = await admin.from('cobrancas_assinatura').update({
        preferencia_id: texto(preferencia.id), checkout_url: link, dados_provedor: { collector_id: preferencia.collector_id || null }
      }).eq('id', cobrancaId)
        .select('id,plano_id,tipo_alteracao,valor,status,checkout_url,expira_em,created_at').single();
      if (atualizarErro) throw atualizarErro;
      return resposta(200, { cobranca: atualizada, link, reutilizada: false });
    }

    if (acao === 'marcar_alerta_lido') {
      const alertaId = texto(dados.alertaId);
      const { error } = await admin.from('alertas_assinatura').update({ lido_em: new Date().toISOString() })
        .eq('id', alertaId).eq('empresa_id', contexto.empresa_id);
      if (error) throw error;
      return resposta(200, { sucesso: true });
    }

    if (!eAdminGeral) return resposta(403, { erro: 'Somente Alberto/Administrador Geral pode alterar as integracoes da plataforma.' });

    if (acao === 'listar_integracoes_plataforma') {
      const { data, error } = await admin.from('integracoes_plataforma')
        .select('id,tipo,status,provedor,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados,updated_at')
        .order('tipo');
      if (error) throw error;
      return resposta(200, { integracoes: data || [] });
    }

    if (acao === 'configurar_whatsapp_baileys') {
      const modo = texto(dados.modo) === 'hibrido' ? 'hibrido' : 'baileys';
      const atual = await carregarIntegracaoPlataforma(admin, 'whatsapp');
      if (modo === 'hibrido' && (!texto(atual.segredo?.access_token) || !texto(atual.integracao?.metadados?.phone_number_id))) {
        return resposta(409, { erro: 'Conecte primeiro a API oficial da Meta para usá-la como reserva.' });
      }
      const metadados = modo === 'hibrido'
        ? { ...(atual.integracao?.metadados || {}), modo: 'hibrido', prioridade: 'baileys', fallback_apos_segundos: 120, depende_pc_aberto: false }
        : { modo: 'baileys', depende_pc_aberto: true };
      const { data: integracao, error } = await admin.from('integracoes_plataforma').upsert({
        tipo: 'whatsapp', status: 'conectada', provedor: modo === 'hibrido' ? 'hibrido_baileys_meta' : 'baileys_pc',
        conta_mascarada: modo === 'hibrido' ? 'Baileys + Meta de reserva' : 'QR Code no PC central',
        conectado_em: new Date().toISOString(), ultima_verificacao_em: new Date().toISOString(), ultimo_erro: null,
        metadados, criado_por: autenticacao.user.id,
        atualizado_por: autenticacao.user.id, updated_at: new Date().toISOString()
      }, { onConflict: 'tipo' }).select('id,tipo,status,provedor,conta_mascarada,metadados').single();
      if (error) throw error;
      return resposta(200, { integracao, mensagem: modo === 'hibrido'
        ? 'Modo automático ativado: Baileys primeiro e Meta como reserva após 2 minutos.'
        : 'Baileys ativado. Os envios dependem do PC central aberto e conectado.' });
    }

    if (acao === 'buscar_fila_baileys') {
      const { integracao } = await carregarIntegracaoPlataforma(admin, 'whatsapp');
      if (!['baileys_pc', 'hibrido_baileys_meta'].includes(integracao?.provedor)) return resposta(409, { erro: 'O Baileys não está selecionado.' });
      const agora = new Date().toISOString();
      const { data: pendentes, error } = await admin.from('fila_whatsapp')
        .select('id,destinatario,mensagem_fallback,tentativas,max_tentativas')
        .in('status', ['pendente', 'falhou']).lte('agendada_para', agora)
        .or(`proxima_tentativa_em.is.null,proxima_tentativa_em.lte.${agora}`)
        .order('created_at', { ascending: true }).limit(10);
      if (error) throw error;
      const itens: any[] = [];
      for (const item of pendentes || []) {
        const tentativas = Number(item.tentativas || 0) + 1;
        const { data: bloqueada } = await admin.from('fila_whatsapp')
          .update({ status: 'processando', tentativas })
          .eq('id', item.id).in('status', ['pendente', 'falhou'])
          .select('id,destinatario,mensagem_fallback,tentativas,max_tentativas').maybeSingle();
        if (bloqueada) itens.push({ id: bloqueada.id, destinatario: bloqueada.destinatario, mensagem: bloqueada.mensagem_fallback });
      }
      return resposta(200, { sucesso: true, itens });
    }

    if (acao === 'confirmar_envio_baileys') {
      if (!uuidValido(dados.filaId)) return resposta(400, { erro: 'Item da fila inválido.' });
      const { data: item, error: itemErro } = await admin.from('fila_whatsapp')
        .select('id,tentativas,max_tentativas,status').eq('id', texto(dados.filaId)).maybeSingle();
      if (itemErro) throw itemErro;
      if (!item || item.status !== 'processando') return resposta(200, { sucesso: true, ignorado: true });
      const enviado = dados.sucesso === true;
      const tentativas = Number(item.tentativas || 0);
      const maximo = Number(item.max_tentativas || 5);
      const minutos = Math.min(360, 2 ** Math.min(tentativas, 8));
      const { error } = await admin.from('fila_whatsapp').update(enviado ? {
        status: 'enviada', processada_em: new Date().toISOString(),
        id_mensagem_provedor: texto(dados.mensagemId).slice(0, 250) || null,
        ultimo_erro: null, proxima_tentativa_em: null
      } : {
        status: tentativas >= maximo ? 'cancelada' : 'falhou',
        ultimo_erro: texto(dados.erro || 'Falha no envio pelo Baileys').slice(0, 500),
        proxima_tentativa_em: new Date(Date.now() + minutos * 60000).toISOString()
      }).eq('id', item.id);
      if (error) throw error;
      return resposta(200, { sucesso: true, status: enviado ? 'enviada' : (tentativas >= maximo ? 'cancelada' : 'falhou') });
    }

    if (acao === 'desconectar_integracao') {
      const tipo = texto(dados.tipo);
      if (!['mercado_pago', 'whatsapp', 'fiscal'].includes(tipo)) return resposta(400, { erro: 'Integracao invalida.' });
      const { data: integracao, error } = await admin.from('integracoes_plataforma').upsert({
        tipo, status: 'desconectada', provedor: null, conta_mascarada: null,
        conectado_em: null, ultima_verificacao_em: new Date().toISOString(), ultimo_erro: null,
        metadados: {}, atualizado_por: autenticacao.user.id, updated_at: new Date().toISOString()
      }, { onConflict: 'tipo' }).select('id,tipo,status').single();
      if (error) throw error;
      await admin.from('integracoes_plataforma_segredos').delete().eq('integracao_id', integracao.id);
      return resposta(200, { integracao, mensagem: 'Integracao desconectada.' });
    }

    if (acao === 'conectar_mercado_pago') {
      const accessToken = texto(dados.accessToken);
      const webhookSecret = texto(dados.webhookSecret);
      if (!/^(APP_USR-|TEST-)/.test(accessToken)) return resposta(400, { erro: 'Access Token do Mercado Pago invalido.' });
      const teste = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${accessToken}` } });
      const conta = await teste.json().catch(() => ({}));
      if (!teste.ok) return resposta(400, { erro: 'O Mercado Pago recusou essa credencial.' });
      const mascara = texto(conta.nickname || conta.email || conta.id || 'Conta Mercado Pago').slice(0, 100);
      const { data: integracao, error } = await admin.from('integracoes_plataforma').upsert({
        tipo: 'mercado_pago', status: 'conectada', provedor: 'mercado_pago', conta_mascarada: mascara,
        conectado_em: new Date().toISOString(), ultima_verificacao_em: new Date().toISOString(), ultimo_erro: null,
        metadados: { webhook_assinado: Boolean(webhookSecret) }, criado_por: autenticacao.user.id,
        atualizado_por: autenticacao.user.id, updated_at: new Date().toISOString()
      }, { onConflict: 'tipo' }).select('id,tipo,status,provedor,conta_mascarada,metadados').single();
      if (error) throw error;
      await salvarSegredo(admin, integracao, { access_token: accessToken, webhook_secret: webhookSecret || null });
      return resposta(200, { integracao, mensagem: 'Mercado Pago das assinaturas conectado e validado.' });
    }

    if (acao === 'conectar_whatsapp') {
      const accessToken = texto(dados.accessToken);
      const phoneNumberId = telefoneLimpo(dados.phoneNumberId);
      const wabaId = telefoneLimpo(dados.wabaId);
      const versao = /^v\d+\.\d+$/.test(texto(dados.graphVersion)) ? texto(dados.graphVersion) : texto(Deno.env.get('WHATSAPP_GRAPH_API_VERSION') || 'v23.0');
      if (!accessToken || !phoneNumberId) return resposta(400, { erro: 'Informe o token permanente e o Phone Number ID.' });
      const teste = await fetch(`https://graph.facebook.com/${versao}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const conta = await teste.json().catch(() => ({}));
      if (!teste.ok) return resposta(400, { erro: `A Meta recusou a credencial do WhatsApp (${texto(conta?.error?.message || teste.status)}).` });
      const templates = {
        lembrete: texto(dados.templateLembrete).slice(0, 120),
        vencida: texto(dados.templateVencida).slice(0, 120),
        pagamento_confirmado: texto(dados.templatePagamento).slice(0, 120)
      };
      const mascara = texto(conta.display_phone_number || conta.verified_name || phoneNumberId).slice(0, 100);
      const { data: integracao, error } = await admin.from('integracoes_plataforma').upsert({
        tipo: 'whatsapp', status: 'conectada', provedor: 'meta_cloud_api', conta_mascarada: mascara,
        conectado_em: new Date().toISOString(), ultima_verificacao_em: new Date().toISOString(), ultimo_erro: null,
        metadados: { phone_number_id: phoneNumberId, waba_id: wabaId || null, graph_version: versao, templates, idioma: texto(dados.idioma) || 'pt_BR' },
        criado_por: autenticacao.user.id, atualizado_por: autenticacao.user.id, updated_at: new Date().toISOString()
      }, { onConflict: 'tipo' }).select('id,tipo,status,provedor,conta_mascarada,metadados').single();
      if (error) throw error;
      await salvarSegredo(admin, integracao, { access_token: accessToken });
      return resposta(200, { integracao, mensagem: 'WhatsApp Cloud API conectado. O Baileys continua sendo o canal principal no PC.' });
    }

    return resposta(400, { erro: 'Acao nao reconhecida.' });
  } catch (erro) {
    console.error('[assinaturas-saas]', erro);
    return resposta(500, { erro: 'Nao foi possivel concluir a operacao da assinatura agora.' });
  }
});
