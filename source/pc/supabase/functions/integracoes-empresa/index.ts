import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { contextoUsuarioAtivo, ehAdministradorEmpresa, licencaPermiteOperacao, temPermissao } from '../_shared/access.ts';

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
async function sha256Hex(valor: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valor));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function tokenUrlSeguro() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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
    return {
      choices: [{
        message: { content: (retorno.content || []).map((item: any) => String(item?.text || '')).join('\n') },
        finish_reason: retorno.stop_reason === 'max_tokens' ? 'length' : 'stop'
      }],
      usage: retorno.usage
    };
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
    if (contextoErro || !atual?.empresa_id || atual.administrador_global === true ||
        !contextoUsuarioAtivo(atual) || !licencaPermiteOperacao(atual)) {
      return resposta(403, { erro: 'Acesso não autorizado.' });
    }
    const corpo = await req.json();
    const tipo = String(corpo.tipo || '');
    const acao = String(corpo.acao || '');
    if (!['mercado_pago', 'whatsapp', 'ia'].includes(tipo)) return resposta(400, { erro: 'Integração não suportada.' });
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const podeAdministrar = temPermissao(atual, 'configuracoes', 'editar');
    const podeConsultarFinanceiro = temPermissao(atual, 'financeiro', 'ler');
    const podeOperarFinanceiro = temPermissao(atual, 'financeiro', 'criar') ||
      temPermissao(atual, 'financeiro', 'editar');
    const podeEnviarWhatsApp = temPermissao(atual, 'os', 'editar');

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

      const buscarIntegracaoGlobal = async () => {
        const { data, error } = await admin.from('integracoes_plataforma')
          .select('id,status,provedor,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados')
          .eq('tipo', 'ia').maybeSingle();
        if (error) throw error;
        return data;
      };
      const carregarCredencialGlobal = async (integracaoId: string) => {
        const segredoAmbiente = String(Deno.env.get('GROQ_API_KEY_GLOBAL') || '').trim();
        const { data, error } = await admin.from('integracoes_plataforma_segredos')
          .select('iv_base64,segredo_cifrado_base64').eq('integracao_id', integracaoId).maybeSingle();
        if (error) throw error;
        if (!data) return segredoAmbiente;
        try {
          return String(await decifrar(data.iv_base64, data.segredo_cifrado_base64));
        } catch (erro) {
          if (segredoAmbiente) return segredoAmbiente;
          throw erro;
        }
      };
      const global = await buscarIntegracaoGlobal();
      const metadadosGlobal = global?.metadados && typeof global.metadados === 'object' ? global.metadados : {};
      const personalizacaoGlobalAtiva = metadadosGlobal.personalizacao_empresas_ativa === true;
      const personalizacaoEmpresaPermitida = personalizacaoGlobalAtiva &&
        atual.recursos_habilitados?.ia_personalizacao_permitida === true;
      const resumoGlobal = {
        status: global?.status || 'desconectada',
        provedor: String(metadadosGlobal.provedor || global?.provedor || 'groq'),
        modelo: String(metadadosGlobal.modelo || ''),
        personalizacao_empresas_ativa: personalizacaoGlobalAtiva,
        personalizacao_empresa_permitida: personalizacaoEmpresaPermitida,
        limite_minuto_empresa: Number(metadadosGlobal.limite_minuto_empresa) || 3,
        limite_mensal_empresa: Number(metadadosGlobal.limite_mensal_empresa) || 300,
        max_tokens: Number(metadadosGlobal.max_tokens) || 600
      };

      if (acao === 'status') {
        const integracao = await buscarIntegracao();
        const possuiChave = integracao ? Boolean(await carregarCredencial(integracao.id)) : false;
        const usaPersonalizada = personalizacaoEmpresaPermitida && integracao?.status === 'conectada' && possuiChave;
        return resposta(200, {
          integracao,
          possui_chave: possuiChave,
          configuracao_global: resumoGlobal,
          origem_efetiva: usaPersonalizada ? 'empresa' : (global?.status === 'conectada' ? 'global' : 'nenhuma')
        });
      }

      if (acao === 'chat') {
        const integracaoEmpresa = personalizacaoEmpresaPermitida ? await buscarIntegracao() : null;
        const chaveEmpresa = integracaoEmpresa?.status === 'conectada'
          ? await carregarCredencial(integracaoEmpresa.id)
          : '';
        const usarEmpresa = Boolean(chaveEmpresa);
        const integracaoEfetiva = usarEmpresa ? integracaoEmpresa : global;
        const apiKey = usarEmpresa
          ? chaveEmpresa
          : (global?.status === 'conectada' ? await carregarCredencialGlobal(global.id) : '');
        if (!integracaoEfetiva || !apiKey) {
          return resposta(409, { erro: 'O assistente de IA ainda não foi ativado para esta empresa.' });
        }
        const metadadosEfetivos = integracaoEfetiva.metadados && typeof integracaoEfetiva.metadados === 'object'
          ? integracaoEfetiva.metadados
          : {};
        const { provedor, modelo } = validarConfiguracaoIA(
          metadadosEfetivos.provedor || integracaoEfetiva.provedor,
          metadadosEfetivos.modelo
        );
        const limiteMinutoEmpresa = Math.max(1, Math.min(60, Number(metadadosGlobal.limite_minuto_empresa) || 3));
        const limiteMensalEmpresa = Math.max(1, Math.min(100000, Number(metadadosGlobal.limite_mensal_empresa) || 300));
        const limiteMinutoGlobal = Math.max(1, Math.min(1000, Number(metadadosGlobal.limite_minuto_global) || 30));
        const limiteMensalGlobal = Math.max(1, Math.min(1000000, Number(metadadosGlobal.limite_mensal_global) || 10000));
        const { data: cota, error: cotaErro } = await admin.rpc('consumir_cota_ia', {
          p_empresa_id: atual.empresa_id,
          p_limite_minuto_empresa: limiteMinutoEmpresa,
          p_limite_mensal_empresa: limiteMensalEmpresa,
          p_limite_minuto_global: limiteMinutoGlobal,
          p_limite_mensal_global: limiteMensalGlobal
        });
        if (cotaErro) return resposta(429, { erro: cotaErro.message || 'Limite econômico do assistente atingido.' });
        const opcoesRecebidas = corpo.dados?.opcoes && typeof corpo.dados.opcoes === 'object' ? corpo.dados.opcoes : {};
        const maxTokensConfigurado = Math.max(64, Math.min(1500, Number(metadadosGlobal.max_tokens) || 600));
        const opcoesEconomicas = {
          ...opcoesRecebidas,
          maxTokens: Math.min(maxTokensConfigurado, Math.max(64, Number(opcoesRecebidas.maxTokens) || maxTokensConfigurado))
        };
        const retorno = await chamarProvedorIA(provedor, modelo, apiKey, corpo.dados?.mensagens, opcoesEconomicas);
        return resposta(200, { resposta: retorno, provedor, modelo, origem: usarEmpresa ? 'empresa' : 'global', cota });
      }

      if (!ehAdministradorEmpresa(atual)) {
        return resposta(403, { erro: 'Apenas o Administrador da empresa pode alterar a chave própria de IA.' });
      }

      if (!personalizacaoEmpresaPermitida) {
        return resposta(403, {
          erro: personalizacaoGlobalAtiva
            ? 'O suporte ainda não liberou uma chave própria para esta empresa.'
            : 'A personalização de chaves está desativada pelo Administrador Geral. A empresa usa a chave global.'
        });
      }

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

      if (acao === 'listar_pendentes_pc') {
        if (!podeEnviarWhatsApp) return resposta(403, { erro: 'Seu usuário não pode enviar mensagens da empresa.' });
        await admin.from('fila_whatsapp').update({ status: 'pendente', proxima_tentativa_em: null,
          ultimo_erro: 'Envio pelo PC interrompido; aguardando nova tentativa.' })
          .eq('empresa_id', atual.empresa_id).eq('origem', 'os').eq('status', 'processando')
          .lt('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
        const agora = new Date().toISOString();
        const { data: fila, error: filaErro } = await admin.from('fila_whatsapp')
          .select('id,destinatario,mensagem_fallback,tentativas,max_tentativas')
          .eq('empresa_id', atual.empresa_id).eq('origem', 'os').in('status', ['pendente', 'falhou'])
          .lte('agendada_para', agora).or(`proxima_tentativa_em.is.null,proxima_tentativa_em.lte.${agora}`)
          .order('created_at', { ascending: true }).limit(10);
        if (filaErro) throw filaErro;
        const pendentes = [];
        for (const item of fila || []) {
          const tentativas = Number(item.tentativas || 0) + 1;
          const { data: claim } = await admin.from('fila_whatsapp').update({ status: 'processando', tentativas })
            .eq('id', item.id).eq('empresa_id', atual.empresa_id).in('status', ['pendente', 'falhou'])
            .select('id').maybeSingle();
          if (claim) pendentes.push({ id: item.id, telefone: item.destinatario,
            mensagem: item.mensagem_fallback, tentativas, max_tentativas: item.max_tentativas });
        }
        return resposta(200, { pendentes });
      }

      if (acao === 'concluir_pendente_pc') {
        if (!podeEnviarWhatsApp) return resposta(403, { erro: 'Seu usuário não pode confirmar mensagens da empresa.' });
        const id = String(corpo.dados?.id || '').trim();
        if (!/^[0-9a-f-]{36}$/i.test(id)) return resposta(400, { erro: 'Mensagem invalida.' });
        const sucesso = corpo.dados?.sucesso === true;
        const incerto = corpo.dados?.incerto === true;
        const mensagemId = String(corpo.dados?.mensagemId || '').trim().slice(0, 200);
        const erroSeguro = String(corpo.dados?.erro || '').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
        const atualizacao = sucesso
          ? { status: 'enviada', processada_em: new Date().toISOString(), id_mensagem_provedor: mensagemId || null,
              ultimo_erro: null, proxima_tentativa_em: null }
          : incerto
            ? { status: 'cancelada', ultimo_erro: 'Envio sem confirmacao. Confira o WhatsApp antes de reenviar.',
                proxima_tentativa_em: null }
            : { status: 'falhou', ultimo_erro: erroSeguro || 'WhatsApp do PC indisponivel.',
                proxima_tentativa_em: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
        const { data: atualizada, error } = await admin.from('fila_whatsapp').update(atualizacao)
          .eq('id', id).eq('empresa_id', atual.empresa_id).eq('origem', 'os').eq('status', 'processando')
          .select('id,status').maybeSingle();
        if (error) throw error;
        return resposta(200, { atualizada: Boolean(atualizada), status: atualizada?.status || null });
      }

      if (acao === 'status') return resposta(200, { integracao: await buscarIntegracao() });

      if (acao === 'enviar') {
        if (!podeEnviarWhatsApp) return resposta(403, { erro: 'Seu usuário não pode enviar mensagens da empresa.' });
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
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: telefone, type: 'text', text: { preview_url: true, body: mensagem } })
        });
        const retorno = await envio.json().catch(() => ({}));
        if (!envio.ok) return resposta(400, { erro: String(retorno?.error?.message || 'Não foi possível enviar a mensagem.') });
        const mensagemId = String(retorno?.messages?.[0]?.id || '');
        if (!mensagemId) return resposta(502, { erro: 'A Meta não confirmou o identificador da mensagem.' });
        return resposta(200, { sucesso: true, mensagem_id: mensagemId });
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
        .select('id,numero,valor,dados_extras')
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
      const valorCentavos = Math.round(valor * 100);
      const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: reutilizavel, error: reutilizavelErro } = await admin.from('cobrancas_os_mp')
        .select('id,preferencia_id,checkout_url,referencia_externa').eq('empresa_id', atual.empresa_id)
        .eq('ordem_id', ordem.id).eq('valor_centavos', valorCentavos).eq('status', 'pendente')
        .gte('created_at', desde).not('checkout_url', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (reutilizavelErro) throw reutilizavelErro;
      if (reutilizavel?.checkout_url) {
        return resposta(200, { sucesso: true, link: reutilizavel.checkout_url,
          preferencia_id: reutilizavel.preferencia_id || '', cobranca_id: reutilizavel.id,
          reutilizada: true, mensagem: 'A cobrança pendente desta OS foi reutilizada.' });
      }
      const cobrancaId = crypto.randomUUID();
      const referencia = `OSPAY-${cobrancaId}`;
      const webhookToken = tokenUrlSeguro();
      const webhookTokenHash = await sha256Hex(webhookToken);
      const { error: cobrancaErro } = await admin.from('cobrancas_os_mp').insert({
        id: cobrancaId, empresa_id: atual.empresa_id, ordem_id: ordem.id, numero_os: numero,
        valor_centavos: valorCentavos, referencia_externa: referencia, idempotency_key: cobrancaId,
        webhook_token_hash: webhookTokenHash
      });
      if (cobrancaErro) throw cobrancaErro;
      const expiracao = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const preferenciaResposta = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': cobrancaId
        },
        body: JSON.stringify({
          items: [{ title: titulo, quantity: 1, currency_id: 'BRL', unit_price: Number(valor.toFixed(2)) }],
          payment_methods: { excluded_payment_types: [], installments: 12 },
          ...(Object.keys(pagador).length ? { payer: pagador } : {}),
          external_reference: referencia,
          metadata: { empresa_id: atual.empresa_id, cobranca_id: cobrancaId, ordem_id: ordem.id, numero_os: numero },
          notification_url: `${url.replace(/\/$/, '')}/functions/v1/mercado-pago-os-webhook?empresa=${encodeURIComponent(atual.empresa_id)}&token=${encodeURIComponent(webhookToken)}`,
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
        await admin.from('cobrancas_os_mp').update({ status: 'rejeitada', ultimo_erro: detalhe,
          updated_at: new Date().toISOString() }).eq('id', cobrancaId);
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
      )) {
        await admin.from('cobrancas_os_mp').update({ status: 'rejeitada', ultimo_erro: 'Link invalido.',
          updated_at: new Date().toISOString() }).eq('id', cobrancaId);
        return resposta(502, { erro: 'O Mercado Pago retornou um destino não permitido.', codigo: 'link_invalido' });
      }

      const { error: salvarCobrancaErro } = await admin.from('cobrancas_os_mp').update({
        preferencia_id: String(preferencia.id || ''), checkout_url: link, updated_at: new Date().toISOString()
      }).eq('id', cobrancaId);
      if (salvarCobrancaErro) throw salvarCobrancaErro;
      const { error: sincronizarErro } = await admin.rpc('sincronizar_preferencia_os_mp', {
        p_cobranca_id: cobrancaId, p_checkout_url: link
      });
      if (sincronizarErro) throw sincronizarErro;

      const { error: auditoriaErro } = await admin.from('auditoria_comercial').insert({
        empresa_id: atual.empresa_id,
        autor_id: usuario.user.id,
        acao: 'mercado_pago_preferencia_criada',
        entidade: 'ordens_servico',
        metadados: { numero, valor: Number(valor.toFixed(2)), preferencia_id: preferencia.id || null,
          cobranca_id: cobrancaId }
      });
      if (auditoriaErro) console.warn('[integracoes-empresa] auditoria:', auditoriaErro.message);
      await registrarResultadoVerificacao(admin, existente.id, { status: 'conectada', ultimo_erro: null });
      return resposta(200, {
        sucesso: true,
        link,
        preferencia_id: String(preferencia.id || ''),
        cobranca_id: cobrancaId,
        mensagem: 'Link do Mercado Pago gerado com sucesso.'
      });
    }

    // Consulta segura usada pelo verificador automático do Electron. A
    // credencial continua exclusivamente no cofre: somente os campos mínimos
    // dos pagamentos voltam ao aplicativo, nunca o access token.
    if (acao === 'consultar_pagamentos') {
      if (!podeConsultarFinanceiro) return resposta(403, { erro: 'Seu usuário não pode consultar cobranças.' });
      const dados = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
      const numero = String(dados.numero || '').trim().slice(0, 80);
      if (!/^OS-[0-9]+$/i.test(numero)) return resposta(400, { erro: 'Informe uma OS válida.', codigo: 'os_invalida' });
      const { data: ordemConsulta, error: erroOrdemConsulta } = await admin.from('ordens_servico')
        .select('id').eq('empresa_id', atual.empresa_id).eq('numero', numero).is('deleted_at', null).maybeSingle();
      if (erroOrdemConsulta) throw erroOrdemConsulta;
      if (!ordemConsulta) return resposta(404, { erro: 'A OS não pertence a esta empresa.', codigo: 'os_nao_encontrada' });

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
      const { data: cobrancasOs, error: cobrancasErro } = await admin.from('cobrancas_os_mp')
        .select('id,empresa_id,ordem_id,numero_os,valor_centavos,moeda,referencia_externa,status,pagamento_provedor_id,pago_em,dados_provedor')
        .eq('empresa_id', atual.empresa_id).eq('ordem_id', ordemConsulta.id)
        .order('created_at', { ascending: false }).limit(30);
      if (cobrancasErro) throw cobrancasErro;
      for (const cobranca of (cobrancasOs || []).filter((item: any) => ['pendente', 'em_processamento'].includes(item.status)).slice(0, 10)) {
        const conciliacao = await fetch(
          `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(cobranca.referencia_externa)}&sort=date_created&criteria=desc&limit=10`,
          { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) }
        );
        if (!conciliacao.ok) continue;
        const dadosConciliacao = await conciliacao.json().catch(() => ({}));
        const pagamento = (Array.isArray(dadosConciliacao.results) ? dadosConciliacao.results : []).find((item: any) =>
          String(item?.external_reference || '') === cobranca.referencia_externa &&
          String(item?.metadata?.empresa_id || '') === atual.empresa_id &&
          String(item?.metadata?.cobranca_id || '') === cobranca.id &&
          String(item?.metadata?.ordem_id || '') === ordemConsulta.id &&
          String(item?.currency_id || '') === cobranca.moeda &&
          Math.round(Number(item?.transaction_amount || 0) * 100) === Number(cobranca.valor_centavos));
        if (!pagamento?.id) continue;
        const statusBruto = String(pagamento.status || '').toLowerCase();
        const status = statusBruto === 'approved' ? 'aprovada'
          : ['refunded', 'charged_back'].includes(statusBruto) ? 'estornada'
            : ['rejected'].includes(statusBruto) ? 'rejeitada'
              : ['cancelled'].includes(statusBruto) ? 'cancelada' : 'em_processamento';
        const totalEstornado = Math.max(0, Math.min(Number(cobranca.valor_centavos),
          Math.round(Number(pagamento.transaction_amount_refunded || 0) * 100)));
        const valorLiquido = status === 'aprovada' ? Number(cobranca.valor_centavos) - totalEstornado : 0;
        const { error: aplicarErro } = await admin.rpc('aplicar_status_cobranca_os_mp', {
          p_cobranca_id: cobranca.id, p_pagamento_id: String(pagamento.id), p_status: status,
          p_valor_centavos: Number(cobranca.valor_centavos),
          p_pago_em: pagamento.date_approved || pagamento.date_created || new Date().toISOString(),
          p_dados_provedor: { status: statusBruto, status_detail: String(pagamento.status_detail || '').slice(0, 120),
            payment_type_id: String(pagamento.payment_type_id || ''),
            payment_method_id: String(pagamento.payment_method_id || ''),
            valor_estornado_centavos: totalEstornado, valor_liquido_centavos: valorLiquido }
        });
        if (aplicarErro) console.warn('[integracoes-empresa] conciliacao de OS adiada');
      }
      const { data: cobrancasAtualizadas, error: atualizadasErro } = await admin.from('cobrancas_os_mp')
        .select('id,valor_centavos,moeda,status,pagamento_provedor_id,pago_em,dados_provedor,referencia_externa')
        .eq('empresa_id', atual.empresa_id).eq('ordem_id', ordemConsulta.id)
        .in('status', ['aprovada', 'estornada']).order('created_at', { ascending: false }).limit(30);
      if (atualizadasErro) throw atualizadasErro;
      const busca = await fetch(
        `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(numero)}&status=approved&sort=date_created&criteria=desc&limit=100`,
        { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) }
      );
      const retorno = await busca.json().catch(() => ({}));
      if (!busca.ok) {
        const detalhe = String(retorno.message || retorno.error || `HTTP ${busca.status}`).slice(0, 180);
        await registrarResultadoVerificacao(admin, existente.id, { ultimo_erro: 'Falha ao consultar pagamentos: ' + detalhe });
        return resposta(502, { erro: 'O Mercado Pago recusou a consulta: ' + detalhe, codigo: 'consulta_recusada' });
      }

      const pagamentosLegados = (Array.isArray(retorno.results) ? retorno.results : [])
        .filter((p: any) => String(p?.external_reference || '') === numero
          && (!p.metadata?.empresa_id || String(p.metadata.empresa_id) === atual.empresa_id))
        .map((pagamento: any) => ({
        id: String(pagamento?.id || ''),
        status: String(pagamento?.status || ''),
        transaction_amount: Number(pagamento?.transaction_amount || 0),
        transaction_amount_refunded: Number(pagamento?.transaction_amount_refunded || 0),
        currency_id: String(pagamento?.currency_id || ''),
        live_mode: pagamento?.live_mode,
        empresa_id: atual.empresa_id,
        date_approved: pagamento?.date_approved || null,
        date_created: pagamento?.date_created || null,
        payment_type_id: String(pagamento?.payment_type_id || ''),
        external_reference: String(pagamento?.external_reference || '')
      }));
      const pagamentosNovos = (cobrancasAtualizadas || []).map((cobranca: any) => ({
        id: String(cobranca.pagamento_provedor_id || cobranca.id),
        status: cobranca.status === 'aprovada' ? 'approved' : 'refunded',
        transaction_amount: Number(cobranca.valor_centavos || 0) / 100,
        transaction_amount_refunded: Number(cobranca.dados_provedor?.valor_estornado_centavos || 0) / 100,
        currency_id: cobranca.moeda,
        empresa_id: atual.empresa_id,
        date_approved: cobranca.pago_em || null,
        date_created: cobranca.pago_em || null,
        payment_type_id: String(cobranca.dados_provedor?.payment_type_id || ''),
        // O Edge já validou a referência opaca, empresa, ordem, valor e moeda.
        // Para o conciliador local legado, devolva o número da OS esperado.
        external_reference: numero
      }));
      const vistos = new Set();
      const pagamentos = [...pagamentosNovos, ...pagamentosLegados].filter((item) => {
        const chave = String(item.id || '');
        if (!chave || vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      });
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
    return resposta(500, { erro: 'Não foi possível concluir a integração agora. Confira os dados e tente novamente.', codigo: 'integracao_indisponivel' });
  }
});
