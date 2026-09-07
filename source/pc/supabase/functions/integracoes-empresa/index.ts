import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json; charset=utf-8'
};

function resposta(status: number, corpo: Record<string, unknown>) {
  return new Response(JSON.stringify(corpo), { status, headers: cors });
}

function bytesBase64(valor: string) {
  const bruto = atob(valor);
  return Uint8Array.from(bruto, (caractere) => caractere.charCodeAt(0));
}
function base64Bytes(valor: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(valor)));
}
function bytesDeBase64(valor: string) {
  const bruto = atob(valor);
  return Uint8Array.from(bruto, (caractere) => caractere.charCodeAt(0));
}
async function chaveCifra() {
  const valor = Deno.env.get('INTEGRATION_ENCRYPTION_KEY') || '';
  let bytes: Uint8Array;
  try {
    bytes = bytesBase64(valor);
  } catch (_) {
    throw new Error('O cofre seguro da integração não está configurado. Contate o suporte.');
  }
  if (bytes.byteLength !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY inválida.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function cifrar(segredo: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chave = await chaveCifra();
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, new TextEncoder().encode(segredo));
  return { iv: base64Bytes(iv.buffer), cifra: base64Bytes(cifrado) };
}
async function decifrar(ivBase64: string, cifraBase64: string) {
  const chave = await chaveCifra();
  const iv = bytesDeBase64(ivBase64);
  const cifra = bytesDeBase64(cifraBase64);
  const aberto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, chave, cifra);
  return new TextDecoder().decode(aberto);
}

const PROVEDORES_IA: Record<string, { url: string; modelo: string; tipo: 'openai' | 'anthropic' }> = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', modelo: 'openai/gpt-oss-120b', tipo: 'openai' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', modelo: 'gpt-4.1-mini', tipo: 'openai' },
  anthropic: { url: 'https://api.anthropic.com/v1/messages', modelo: 'claude-sonnet-4-6', tipo: 'anthropic' },
  deepseek: { url: 'https://api.deepseek.com/chat/completions', modelo: 'deepseek-v4-flash', tipo: 'openai' }
};

function validarConfiguracaoIA(provedorRecebido: unknown, modeloRecebido: unknown) {
  const provedor = String(provedorRecebido || '').trim().toLowerCase();
  const definicao = PROVEDORES_IA[provedor];
  if (!definicao) throw new Error('Selecione um provedor de IA válido.');
  const modelo = String(modeloRecebido || definicao.modelo).trim();
  if (!/^[a-z0-9][a-z0-9._/-]{1,99}$/i.test(modelo)) throw new Error('Selecione um modelo de IA válido.');
  return { provedor, modelo, definicao };
}

async function chamarProvedorIA(provedor: string, modelo: string, apiKey: string, mensagensRecebidas: unknown, opcoes: Record<string, unknown> = {}) {
  const definicao = PROVEDORES_IA[provedor];
  const mensagens = (Array.isArray(mensagensRecebidas) ? mensagensRecebidas : []).slice(-12).map((item: any) => ({
    role: ['system', 'assistant'].includes(String(item?.role)) ? String(item.role) : 'user',
    content: String(item?.content || '').slice(0, 30000)
  })).filter((item) => item.content);
  if (!mensagens.length) throw new Error('A pergunta para a IA está vazia.');
  const maxTokens = Math.max(8, Math.min(1500, Number(opcoes.maxTokens) || 900));
  let respostaIA: Response;
  if (definicao.tipo === 'anthropic') {
    const system = mensagens.filter((item) => item.role === 'system').map((item) => item.content).join('\n\n');
    const conversa = mensagens.filter((item) => item.role !== 'system');
    respostaIA = await fetch(definicao.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: modelo, system, messages: conversa, max_tokens: maxTokens, temperature: Number(opcoes.temperature ?? 0.3) })
    });
  } else {
    respostaIA = await fetch(definicao.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelo, messages: mensagens, max_tokens: maxTokens, temperature: Number(opcoes.temperature ?? 0.3), stream: false })
    });
  }
  const retorno = await respostaIA.json().catch(() => ({}));
  if (!respostaIA.ok) throw new Error(`O provedor recusou a solicitação (HTTP ${respostaIA.status}).`);
  if (definicao.tipo === 'anthropic') {
    return { choices: [{ message: { content: (retorno.content || []).map((item: any) => String(item?.text || '')).join('\n') } }], usage: retorno.usage };
  }
  return retorno;
}

async function registrarResultadoVerificacao(
  admin: any,
  integracaoId: string,
  dados: Record<string, unknown>
) {
  const { data, error } = await admin.from('integracoes_empresa')
    .update({ ...dados, ultima_verificacao_em: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', integracaoId)
    .select('id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro')
    .single();
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return resposta(401, { erro: 'Sessão inválida.' });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cliente = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: usuario } = await cliente.auth.getUser();
    if (!usuario.user) return resposta(401, { erro: 'Sessão inválida.' });
    const { data: contexto, error: contextoErro } = await cliente.rpc('obter_contexto_comercial');
    const atual = Array.isArray(contexto) ? contexto[0] : contexto;
    if (contextoErro || !atual?.empresa_id) return resposta(403, { erro: 'Acesso não autorizado.' });
    const corpo = await req.json();
    const tipo = String(corpo.tipo || '');
    const acao = String(corpo.acao || '');
    if (!['mercado_pago', 'whatsapp', 'ia'].includes(tipo)) return resposta(400, { erro: 'Integração não suportada.' });
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const cargo = String(atual.cargo || '').toLowerCase();
    const podeAdministrar = /administrador|propriet/.test(cargo) || Boolean(atual.permissoes?.configuracoes);
    const permissaoFinanceiro = atual.permissoes?.financeiro;
    const podeOperarFinanceiro = podeAdministrar || permissaoFinanceiro === true
      || Boolean(permissaoFinanceiro && typeof permissaoFinanceiro === 'object'
        && Object.values(permissaoFinanceiro).some(Boolean));

    if (tipo === 'ia') {
      const buscarIntegracao = async () => {
        const { data, error } = await admin.from('integracoes_empresa')
          .select('id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados')
          .eq('empresa_id', atual.empresa_id).eq('tipo', 'ia').maybeSingle();
        if (error) throw error;
        return data;
      };
      const carregarCredencial = async (integracaoId: string) => {
        const { data, error } = await admin.from('integracoes_segredos')
          .select('iv_base64,segredo_cifrado_base64').eq('integracao_id', integracaoId).maybeSingle();
        if (error) throw error;
        if (!data) return '';
        return String(await decifrar(data.iv_base64, data.segredo_cifrado_base64));
      };

      if (acao === 'status') {
        const integracao = await buscarIntegracao();
        const possuiChave = integracao ? Boolean(await carregarCredencial(integracao.id)) : false;
        return resposta(200, { integracao, possui_chave: possuiChave });
      }

      if (acao === 'chat') {
        if (atual.administrador_global) return resposta(403, { erro: 'Entre em uma empresa para usar o assistente.' });
        const integracao = await buscarIntegracao();
        if (!integracao || integracao.status !== 'conectada') return resposta(409, { erro: 'O assistente de IA ainda não foi configurado para esta empresa.' });
        const { provedor, modelo } = validarConfiguracaoIA(integracao.metadados?.provedor, integracao.metadados?.modelo);
        const apiKey = await carregarCredencial(integracao.id);
        if (!apiKey) return resposta(409, { erro: 'A chave segura da IA não foi encontrada. Configure novamente.' });
        const retorno = await chamarProvedorIA(provedor, modelo, apiKey, corpo.dados?.mensagens, corpo.dados?.opcoes || {});
        return resposta(200, { resposta: retorno, provedor, modelo });
      }

      if (!podeAdministrar) return resposta(403, { erro: 'Apenas administradores podem alterar o assistente de IA.' });

      if (acao === 'desconectar') {
        const { data: integracao, error } = await admin.from('integracoes_empresa').upsert({
          empresa_id: atual.empresa_id, tipo: 'ia', status: 'desconectada', conta_mascarada: null,
          conectado_em: null, ultimo_erro: null, metadados: {}, updated_at: new Date().toISOString()
        }, { onConflict: 'empresa_id,tipo' }).select('id,status,metadados').single();
        if (error) throw error;
        await admin.from('integracoes_segredos').delete().eq('integracao_id', integracao.id);
        return resposta(200, { integracao, mensagem: 'Assistente de IA desconectado desta empresa.' });
      }

      const dadosIA = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
      const { provedor, modelo } = validarConfiguracaoIA(dadosIA.provedor, dadosIA.modelo);
      const existente = await buscarIntegracao();
      const chaveNova = String(dadosIA.apiKey || '').trim();
      const apiKey = chaveNova || (existente ? await carregarCredencial(existente.id) : '');
      if (!apiKey) return resposta(400, { erro: 'Informe a chave da API do provedor escolhido.' });

      try {
        await chamarProvedorIA(provedor, modelo, apiKey, [{ role: 'user', content: 'Responda apenas OK.' }], { maxTokens: 8, temperature: 0 });
      } catch (erro) {
        return resposta(400, { erro: erro instanceof Error ? erro.message : 'O provedor recusou a chave.' });
      }
      if (acao === 'testar') return resposta(200, { sucesso: true, mensagem: 'Conexão com a IA validada.', provedor, modelo });
      if (acao !== 'configurar') return resposta(400, { erro: 'Ação de IA não reconhecida.' });

      const agora = new Date().toISOString();
      const { data: integracao, error } = await admin.from('integracoes_empresa').upsert({
        empresa_id: atual.empresa_id, tipo: 'ia', status: 'conectada', conta_mascarada: `${provedor} · ${modelo}`,
        conectado_em: existente?.conectado_em || agora, ultima_verificacao_em: agora, ultimo_erro: null,
        metadados: { provedor, modelo }, updated_at: agora
      }, { onConflict: 'empresa_id,tipo' }).select('id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados').single();
      if (error) throw error;
      if (chaveNova || !existente) {
        const segredo = await cifrar(apiKey);
        const { error: segredoErro } = await admin.from('integracoes_segredos').upsert({
          integracao_id: integracao.id, iv_base64: segredo.iv, segredo_cifrado_base64: segredo.cifra, atualizado_em: agora
        });
        if (segredoErro) throw segredoErro;
      }
      await admin.from('auditoria_comercial').insert({
        empresa_id: atual.empresa_id, autor_id: usuario.user.id, acao: 'integracao_ia_configurada',
        entidade: 'integracoes_empresa', entidade_id: integracao.id, metadados: { provedor, modelo }
      });
      return resposta(200, { integracao, possui_chave: true, mensagem: 'Assistente de IA configurado para esta empresa.' });
    }

    // A API oficial e opcional. O Baileys continua principal no PC; esta
    // conexao habilita envios escolhidos e automacoes executadas no servidor.
    if (tipo === 'whatsapp') {
      const buscarIntegracao = async () => {
        const { data, error } = await admin.from('integracoes_empresa')
          .select('id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados')
          .eq('empresa_id', atual.empresa_id).eq('tipo', 'whatsapp').maybeSingle();
        if (error) throw error;
        return data;
      };
      const carregarCredencial = async (integracaoId: string) => {
        const { data, error } = await admin.from('integracoes_segredos')
          .select('iv_base64,segredo_cifrado_base64').eq('integracao_id', integracaoId).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Conecte novamente o WhatsApp API.');
        return JSON.parse(await decifrar(data.iv_base64, data.segredo_cifrado_base64));
      };
      const validarConta = async (token: string, phoneNumberId: string, versao: string) => {
        const teste = await fetch(`https://graph.facebook.com/${versao}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const conta = await teste.json().catch(() => ({}));
        if (!teste.ok) throw new Error(String(conta?.error?.message || 'A Meta recusou essa conta.'));
        return conta;
      };

      if (acao === 'status') return resposta(200, { integracao: await buscarIntegracao() });

      if (acao === 'enviar') {
        const integracao = await buscarIntegracao();
        if (!integracao || integracao.status !== 'conectada') return resposta(409, { erro: 'WhatsApp API não está conectado.' });
        const credencial = await carregarCredencial(integracao.id);
        const telefone = String(corpo.dados?.telefone || '').replace(/\D/g, '').slice(0, 15);
        const mensagem = String(corpo.dados?.mensagem || '').trim().slice(0, 4096);
        if (telefone.length < 10 || !mensagem) return resposta(400, { erro: 'Informe telefone e mensagem.' });
        const versao = String(integracao.metadados?.graph_version || 'v23.0');
        const phoneNumberId = String(integracao.metadados?.phone_number_id || '');
        const envio = await fetch(`https://graph.facebook.com/${versao}/${phoneNumberId}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${credencial.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: telefone, type: 'text', text: { preview_url: true, body: mensagem } })
        });
        const retorno = await envio.json().catch(() => ({}));
        if (!envio.ok) return resposta(400, { erro: String(retorno?.error?.message || 'Não foi possível enviar a mensagem.') });
        return resposta(200, { sucesso: true, mensagem_id: String(retorno?.messages?.[0]?.id || '') });
      }

      if (!podeAdministrar) return resposta(403, { erro: 'Apenas administradores podem alterar o WhatsApp.' });

      if (acao === 'desconectar') {
        const { data: integracao, error } = await admin.from('integracoes_empresa').upsert({
          empresa_id: atual.empresa_id, tipo: 'whatsapp', status: 'desconectada', conta_mascarada: null,
          conectado_em: null, ultimo_erro: null, metadados: { modo: 'baileys' }, updated_at: new Date().toISOString()
        }, { onConflict: 'empresa_id,tipo' }).select('id,status,metadados').single();
        if (error) throw error;
        await admin.from('integracoes_segredos').delete().eq('integracao_id', integracao.id);
        await admin.from('empresas').update({ whatsapp_modo: 'baileys' }).eq('id', atual.empresa_id);
        return resposta(200, { integracao, mensagem: 'WhatsApp API desconectado. O Baileys continua disponível.' });
      }

      if (acao === 'verificar') {
        const integracao = await buscarIntegracao();
        if (!integracao || integracao.status === 'desconectada') return resposta(200, { integracao, status_verificado: false });
        try {
          const credencial = await carregarCredencial(integracao.id);
          await validarConta(String(credencial.access_token || ''), String(integracao.metadados?.phone_number_id || ''), String(integracao.metadados?.graph_version || 'v23.0'));
          const atualizado = await registrarResultadoVerificacao(admin, integracao.id, { status: 'conectada', ultimo_erro: null });
          return resposta(200, { integracao: { ...integracao, ...atualizado }, status_verificado: true, mensagem: 'WhatsApp API conectado.' });
        } catch (erro) {
          const atualizado = await registrarResultadoVerificacao(admin, integracao.id, { status: 'erro', ultimo_erro: String(erro instanceof Error ? erro.message : erro).slice(0, 180) });
          return resposta(200, { integracao: { ...integracao, ...atualizado }, status_verificado: false, mensagem: 'Confira a conexão do WhatsApp API.' });
        }
      }

      const token = String(corpo.accessToken || '').trim();
      const dados = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
      const phoneNumberId = String(dados.phoneNumberId || '').replace(/\D/g, '').slice(0, 30);
      const wabaId = String(dados.wabaId || '').replace(/\D/g, '').slice(0, 30);
      const versao = /^v\d+\.\d+$/.test(String(dados.graphVersion || '')) ? String(dados.graphVersion) : 'v23.0';
      const modo = ['api', 'hibrido'].includes(String(dados.modo)) ? String(dados.modo) : 'hibrido';
      if (!token || !phoneNumberId) return resposta(400, { erro: 'Informe o token permanente e o número da conta da Meta.' });
      const conta = await validarConta(token, phoneNumberId, versao);
      const segredo = await cifrar(JSON.stringify({ access_token: token }));
      const mascara = String(conta.display_phone_number || conta.verified_name || phoneNumberId).slice(0, 80);
      const { data: integracao, error } = await admin.from('integracoes_empresa').upsert({
        empresa_id: atual.empresa_id, tipo: 'whatsapp', status: 'conectada', conta_mascarada: mascara,
        conectado_em: new Date().toISOString(), ultima_verificacao_em: new Date().toISOString(), ultimo_erro: null,
        metadados: { provedor: 'meta_cloud_api', phone_number_id: phoneNumberId, waba_id: wabaId || null, graph_version: versao, modo },
        updated_at: new Date().toISOString()
      }, { onConflict: 'empresa_id,tipo' }).select('id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados').single();
      if (error) throw error;
      const { error: segredoErro } = await admin.from('integracoes_segredos').upsert({
        integracao_id: integracao.id, iv_base64: segredo.iv, segredo_cifrado_base64: segredo.cifra, atualizado_em: new Date().toISOString()
      });
      if (segredoErro) throw segredoErro;
      await admin.from('empresas').update({ whatsapp_modo: modo }).eq('id', atual.empresa_id);
      return resposta(200, { integracao, mensagem: 'WhatsApp API conectado. O Baileys continua principal no modo híbrido.', status_verificado: true });
    }

    // A preferência é criada no servidor usando a credencial guardada no
    // cofre. O token nunca é devolvido ao Electron, ao APK ou ao renderer.
    // Qualquer usuário autenticado da própria empresa pode cobrar uma OS; as
    // ações que alteram a conexão continuam exclusivas dos administradores.
    if (acao === 'criar_preferencia') {
      if (!podeOperarFinanceiro) return resposta(403, { erro: 'Seu usuário não pode gerar cobranças.' });
      const dados = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
      const numero = String(dados.numero || '').trim().slice(0, 80);
      const titulo = String(dados.titulo || numero || 'Serviço de assistência técnica').trim().slice(0, 250);
      const valor = Number(dados.valor);
      const pagadorRecebido = dados.pagador && typeof dados.pagador === 'object' ? dados.pagador : {};
      const nomePagador = String(pagadorRecebido.name || '').trim().slice(0, 120);
      const emailBruto = String(pagadorRecebido.email || '').trim().toLowerCase();
      const emailPagador = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailBruto) ? emailBruto.slice(0, 254) : '';
      let telefonePagador = String(pagadorRecebido.phone?.area_code || '')
        + String(pagadorRecebido.phone?.number || '');
      telefonePagador = telefonePagador.replace(/\D/g, '').slice(0, 15);
      const pagador: Record<string, unknown> = {};
      if (nomePagador) pagador.name = nomePagador;
      if (emailPagador) pagador.email = emailPagador;
      if (telefonePagador.length >= 10) {
        pagador.phone = { area_code: telefonePagador.slice(0, 2), number: telefonePagador.slice(2) };
      }
      if (!/^OS-[0-9]+$/i.test(numero)) {
        return resposta(400, { erro: 'Informe um número de OS válido para gerar a cobrança.', codigo: 'os_invalida' });
      }
      if (!Number.isFinite(valor) || valor <= 0) {
        return resposta(400, { erro: 'Informe um valor válido para gerar o link do Mercado Pago.', codigo: 'valor_invalido' });
      }

      const { data: ordem, error: ordemErro } = await admin.from('ordens_servico')
        .select('numero,valor,dados_extras')
        .eq('empresa_id', atual.empresa_id).eq('numero', numero).is('deleted_at', null).maybeSingle();
      if (ordemErro) throw ordemErro;
      if (!ordem) return resposta(404, { erro: 'A OS não pertence a esta empresa.', codigo: 'os_nao_encontrada' });
      const valorMaximo = Math.max(Number(ordem.valor || 0), Number(ordem.dados_extras?.valor_total_servico || 0));
      if (valorMaximo <= 0 || valor > valorMaximo + 0.009) {
        return resposta(400, { erro: 'O valor da cobrança não confere com a OS.', codigo: 'valor_divergente' });
      }

      const { data: existente, error: buscaErro } = await admin.from('integracoes_empresa')
        .select('id,status')
        .eq('empresa_id', atual.empresa_id)
        .eq('tipo', tipo)
        .maybeSingle();
      if (buscaErro) throw buscaErro;
      if (!existente || existente.status !== 'conectada') {
        return resposta(409, {
          erro: 'A conta Mercado Pago desta empresa não está conectada. Conecte-a nas Configurações.',
          codigo: 'mercado_pago_desconectado'
        });
      }

      const { data: segredo, error: segredoErro } = await admin.from('integracoes_segredos')
        .select('iv_base64,segredo_cifrado_base64')
        .eq('integracao_id', existente.id)
        .maybeSingle();
      if (segredoErro) throw segredoErro;
      if (!segredo?.iv_base64 || !segredo?.segredo_cifrado_base64) {
        return resposta(409, {
          erro: 'A credencial segura do Mercado Pago não foi encontrada. Reconecte a conta nas Configurações.',
          codigo: 'credencial_ausente'
        });
      }

      const token = await decifrar(segredo.iv_base64, segredo.segredo_cifrado_base64);
      const expiracao = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const preferenciaResposta = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': `${atual.empresa_id}:${numero}:${valor.toFixed(2)}`.slice(0, 128)
        },
        body: JSON.stringify({
          items: [{ title: titulo, quantity: 1, currency_id: 'BRL', unit_price: Number(valor.toFixed(2)) }],
          payment_methods: { excluded_payment_types: [], installments: 12 },
          ...(Object.keys(pagador).length ? { payer: pagador } : {}),
          external_reference: numero,
          expires: true,
          expiration_date_to: expiracao
        })
      });
      const preferencia = await preferenciaResposta.json().catch(() => ({}));
      const link = String(preferencia.init_point || preferencia.sandbox_init_point || '').trim();
      if (!preferenciaResposta.ok || !link) {
        const detalhe = `HTTP ${preferenciaResposta.status}`;
        await registrarResultadoVerificacao(admin, existente.id, {
          ultimo_erro: 'Falha ao gerar cobrança: ' + detalhe
        });
        return resposta(502, {
          erro: 'O Mercado Pago recusou a criação do link. Tente novamente.',
          codigo: 'preferencia_recusada'
        });
      }
      let destino: URL;
      try { destino = new URL(link); } catch (_) {
        return resposta(502, { erro: 'O Mercado Pago retornou um link inválido.', codigo: 'link_invalido' });
      }
      const host = destino.hostname.toLowerCase();
      if (destino.protocol !== 'https:' || !(
        host === 'mercadopago.com' || host.endsWith('.mercadopago.com')
        || host === 'mercadopago.com.br' || host.endsWith('.mercadopago.com.br')
      )) return resposta(502, { erro: 'O Mercado Pago retornou um destino não permitido.', codigo: 'link_invalido' });

      const { error: auditoriaErro } = await admin.from('auditoria_comercial').insert({
        empresa_id: atual.empresa_id,
        autor_id: usuario.user.id,
        acao: 'mercado_pago_preferencia_criada',
        entidade: 'ordens_servico',
        metadados: { numero, valor: Number(valor.toFixed(2)), preferencia_id: preferencia.id || null }
      });
      if (auditoriaErro) console.warn('[integracoes-empresa] auditoria:', auditoriaErro.message);
      await registrarResultadoVerificacao(admin, existente.id, { status: 'conectada', ultimo_erro: null });
      return resposta(200, {
        sucesso: true,
        link,
        preferencia_id: String(preferencia.id || ''),
        mensagem: 'Link do Mercado Pago gerado com sucesso.'
      });
    }

    // Consulta segura usada pelo verificador automático do Electron. A
    // credencial continua exclusivamente no cofre: somente os campos mínimos
    // dos pagamentos voltam ao aplicativo, nunca o access token.
    if (acao === 'consultar_pagamentos') {
      if (!podeOperarFinanceiro) return resposta(403, { erro: 'Seu usuário não pode consultar cobranças.' });
      const dados = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
      const numero = String(dados.numero || '').trim().slice(0, 80);
      if (!/^OS-[0-9]+$/i.test(numero)) return resposta(400, { erro: 'Informe uma OS válida.', codigo: 'os_invalida' });

      const { data: existente, error: buscaErro } = await admin.from('integracoes_empresa')
        .select('id,status')
        .eq('empresa_id', atual.empresa_id)
        .eq('tipo', tipo)
        .maybeSingle();
      if (buscaErro) throw buscaErro;
      if (!existente || existente.status !== 'conectada') {
        return resposta(409, {
          erro: 'A conta Mercado Pago desta empresa não está conectada.',
          codigo: 'mercado_pago_desconectado'
        });
      }

      const { data: segredo, error: segredoErro } = await admin.from('integracoes_segredos')
        .select('iv_base64,segredo_cifrado_base64')
        .eq('integracao_id', existente.id)
        .maybeSingle();
      if (segredoErro) throw segredoErro;
      if (!segredo?.iv_base64 || !segredo?.segredo_cifrado_base64) {
        return resposta(409, {
          erro: 'A credencial segura do Mercado Pago não foi encontrada. Reconecte a conta.',
          codigo: 'credencial_ausente'
        });
      }

      const token = await decifrar(segredo.iv_base64, segredo.segredo_cifrado_base64);
      const busca = await fetch(
        `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(numero)}&sort=date_created&criteria=desc&limit=20`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      const retorno = await busca.json().catch(() => ({}));
      if (!busca.ok) {
        const detalhe = String(retorno.message || retorno.error || `HTTP ${busca.status}`).slice(0, 180);
        await registrarResultadoVerificacao(admin, existente.id, { ultimo_erro: 'Falha ao consultar pagamentos: ' + detalhe });
        return resposta(502, { erro: 'O Mercado Pago recusou a consulta: ' + detalhe, codigo: 'consulta_recusada' });
      }

      const pagamentos = (Array.isArray(retorno.results) ? retorno.results : []).map((pagamento: any) => ({
        id: String(pagamento?.id || ''),
        status: String(pagamento?.status || ''),
        transaction_amount: Number(pagamento?.transaction_amount || 0),
        date_approved: pagamento?.date_approved || null,
        date_created: pagamento?.date_created || null,
        payment_type_id: String(pagamento?.payment_type_id || ''),
        external_reference: String(pagamento?.external_reference || '')
      }));
      await registrarResultadoVerificacao(admin, existente.id, { status: 'conectada', ultimo_erro: null });
      return resposta(200, { sucesso: true, pagamentos });
    }

    if (!podeAdministrar) return resposta(403, { erro: 'Apenas administradores podem alterar integrações.' });

    if (acao === 'desconectar') {
      const { data: integracao, error: integracaoErro } = await admin.from('integracoes_empresa')
        .upsert({ empresa_id: atual.empresa_id, tipo, status: 'desconectada', conta_mascarada: null, conectado_em: null, ultimo_erro: null, updated_at: new Date().toISOString() }, { onConflict: 'empresa_id,tipo' })
        .select('id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro').single();
      if (integracaoErro || !integracao) throw integracaoErro || new Error('Não foi possível atualizar a integração.');
      const { error: segredoErro } = await admin.from('integracoes_segredos').delete().eq('integracao_id', integracao.id);
      if (segredoErro) throw segredoErro;
      const { error: auditoriaErro } = await admin.from('auditoria_comercial').insert({ empresa_id: atual.empresa_id, autor_id: usuario.user.id, acao: 'integracao_desconectada', entidade: 'integracoes_empresa', entidade_id: integracao.id });
      if (auditoriaErro) console.warn('[integracoes-empresa] auditoria:', auditoriaErro.message);
      return resposta(200, { integracao, mensagem: 'Conta Mercado Pago desconectada.', codigo: 'desconectada' });
    }

    // A atualização precisa testar a conta de verdade, e não apenas reler o
    // banco. O token nunca sai do cofre: ele é decifrado somente nesta função.
    if (acao === 'verificar') {
      const { data: existente, error: buscaErro } = await admin.from('integracoes_empresa')
        .select('id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro')
        .eq('empresa_id', atual.empresa_id)
        .eq('tipo', tipo)
        .maybeSingle();
      if (buscaErro) throw buscaErro;
      if (!existente || existente.status === 'desconectada') {
        return resposta(200, {
          integracao: existente || null,
          status_verificado: false,
          mensagem: 'Nenhuma conta Mercado Pago está conectada nesta empresa.'
        });
      }

      const { data: segredo, error: segredoErro } = await admin.from('integracoes_segredos')
        .select('iv_base64,segredo_cifrado_base64')
        .eq('integracao_id', existente.id)
        .maybeSingle();
      if (segredoErro) throw segredoErro;
      if (!segredo?.iv_base64 || !segredo?.segredo_cifrado_base64) {
        const integracao = await registrarResultadoVerificacao(admin, existente.id, {
          status: 'erro', ultimo_erro: 'Credencial segura não encontrada. Conecte a conta novamente.'
        });
        return resposta(200, { integracao, status_verificado: false, mensagem: integracao.ultimo_erro });
      }

      try {
        const token = await decifrar(segredo.iv_base64, segredo.segredo_cifrado_base64);
        const teste = await fetch('https://api.mercadopago.com/users/me', {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (!teste.ok) {
          const integracao = await registrarResultadoVerificacao(admin, existente.id, {
            status: 'erro', ultimo_erro: 'O Mercado Pago recusou a verificação da conta (HTTP ' + teste.status + ').'
          });
          return resposta(200, { integracao, status_verificado: false, mensagem: integracao.ultimo_erro });
        }
        const conta = await teste.json();
        const mascara = String(conta.nickname || conta.email || conta.id || existente.conta_mascarada || 'Conta conectada').slice(0, 80);
        const integracao = await registrarResultadoVerificacao(admin, existente.id, {
          status: 'conectada', conta_mascarada: mascara, ultimo_erro: null
        });
        return resposta(200, {
          integracao,
          status_verificado: true,
          mensagem: 'Conta Mercado Pago ativa e validada agora.'
        });
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        const integracao = await registrarResultadoVerificacao(admin, existente.id, {
          status: 'erro', ultimo_erro: 'Não foi possível validar a conta: ' + mensagem.slice(0, 180)
        });
        return resposta(200, { integracao, status_verificado: false, mensagem: integracao.ultimo_erro });
      }
    }

    const token = String(corpo.accessToken || '').trim();
    if (!/^APP_USR-|^TEST-/.test(token)) return resposta(400, { erro: 'Credencial inválida.' });
    const teste = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!teste.ok) return resposta(400, { erro: 'Não foi possível validar a conta Mercado Pago.' });
    const conta = await teste.json();
    const mascara = String(conta.nickname || conta.email || conta.id || 'Conta conectada').slice(0, 80);
    let segredo;
    try {
      segredo = await cifrar(token);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : 'O cofre seguro não está configurado.';
      return resposta(503, { erro: mensagem, codigo: 'cofre_indisponivel' });
    }
    const { data: integracao, error } = await admin.from('integracoes_empresa')
      .upsert({ empresa_id: atual.empresa_id, tipo, status: 'conectada', conta_mascarada: mascara, conectado_em: new Date().toISOString(), ultima_verificacao_em: new Date().toISOString(), ultimo_erro: null, updated_at: new Date().toISOString() }, { onConflict: 'empresa_id,tipo' })
      .select('id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro').single();
    if (error || !integracao) throw error || new Error('Falha ao registrar integração.');
    const { error: segredoErro } = await admin.from('integracoes_segredos').upsert({ integracao_id: integracao.id, iv_base64: segredo.iv, segredo_cifrado_base64: segredo.cifra, atualizado_em: new Date().toISOString() });
    if (segredoErro) throw segredoErro;
    const { error: auditoriaErro } = await admin.from('auditoria_comercial').insert({ empresa_id: atual.empresa_id, autor_id: usuario.user.id, acao: 'integracao_conectada', entidade: 'integracoes_empresa', entidade_id: integracao.id, metadados: { tipo } });
    if (auditoriaErro) console.warn('[integracoes-empresa] auditoria:', auditoriaErro.message);
    return resposta(200, { integracao, mensagem: 'Conta Mercado Pago conectada e validada.', status_verificado: true, codigo: 'conectada' });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error('[integracoes-empresa]', mensagem);
    return resposta(500, { erro: 'Não foi possível concluir a integração: ' + mensagem.slice(0, 180), codigo: 'integracao_indisponivel' });
  }
});
