import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { contextoUsuarioAtivo, ehAdministradorEmpresa } from '../_shared/access.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json; charset=utf-8'
};
const responder = (status: number, corpo: Record<string, unknown>) =>
  new Response(JSON.stringify(corpo), { status, headers: cors });
const texto = (valor: unknown, limite = 8000) => String(valor ?? '').trim().slice(0, limite);
const origensPublicas = new Set(['login_pc', 'login_celular']);
const origensAutenticadas = new Set(['config_pc', 'config_celular']);
const statusValidos = new Set(['aberto', 'em_atendimento', 'resolvido', 'fechado']);
const prioridadesValidas = new Set(['baixa', 'normal', 'alta', 'critica']);
const motivosValidos = new Set([
  'trial_assinatura', 'cobranca_pagamento', 'acesso_login', 'sincronizacao_backup',
  'documento_assinatura', 'erro_sistema', 'configuracao_integracao',
  'duvida_funcionalidade', 'sugestao', 'outro'
]);
const preferenciasContatoValidas = new Set(['whatsapp', 'ligacao', 'email']);
const cargosEmpresaValidos = new Set(['proprietario', 'administrador', 'gerente', 'tecnico', 'atendente', 'financeiro', 'outro']);

type Cliente = ReturnType<typeof createClient>;

async function contextoAutenticado(cliente: Cliente) {
  const { data: sessao } = await cliente.auth.getUser();
  if (!sessao.user) return null;
  const { data: contexto, error } = await cliente.rpc('obter_contexto_comercial');
  const atual = Array.isArray(contexto) ? contexto[0] : contexto;
  if (error || !atual || !contextoUsuarioAtivo(atual)) return null;
  return { usuario: sessao.user, contexto: atual };
}

function protocolo(chamadoId: string) {
  return 'CH-' + chamadoId.slice(0, 8).toUpperCase();
}

function uuidValido(valor: unknown) {
  const token = texto(valor, 80).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token) ? token : '';
}

async function sha256(valor: string) {
  const resumo = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valor));
  return Array.from(new Uint8Array(resumo)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function telefoneNormalizado(valor: unknown) {
  return texto(valor, 30).replace(/\D/g, '').slice(0, 15);
}

function emailValido(valor: string) {
  return !valor || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
}

function podeAcessarAutenticado(chamado: Record<string, any>, autenticado: Record<string, any> | null) {
  if (!autenticado || chamado.excluido_em || autenticado.contexto?.administrador_global) return false;
  if (autenticado.contexto?.empresa_id !== chamado.empresa_id) return false;
  return chamado.aberto_por === autenticado.usuario.id || ehAdministradorEmpresa(autenticado.contexto);
}

function semSegredos(chamado: Record<string, any>) {
  const { public_token: _publicToken, token_hash: _tokenHash, ...seguro } = chamado || {};
  return seguro;
}

function camposChamado(dados: Record<string, any>) {
  const motivo = texto(dados.motivo, 40);
  const motivoOutro = texto(dados.motivoOutro, 160);
  const telefone = telefoneNormalizado(dados.telefone);
  const email = texto(dados.email, 160).toLowerCase();
  const preferenciaContato = texto(dados.preferenciaContato, 20);
  const cargoEmpresa = texto(dados.cargoEmpresa, 30);
  const cargoOutro = texto(dados.cargoOutro, 80);
  const plataforma = ['pc', 'celular', 'ambos'].includes(texto(dados.plataforma, 20)) ? texto(dados.plataforma, 20) : '';
  const referencia = texto(dados.referencia, 80);
  const horarioContato = texto(dados.horarioContato, 80);
  const erro = !motivosValidos.has(motivo) ? 'Selecione o motivo do chamado.'
    : motivo === 'outro' && motivoOutro.length < 3 ? 'Descreva o outro motivo do chamado.'
    : !/^\d{10,15}$/.test(telefone) ? 'Informe um telefone ou WhatsApp com DDD.'
    : !emailValido(email) ? 'Confira o e-mail informado.'
    : !preferenciasContatoValidas.has(preferenciaContato) ? 'Selecione como prefere receber o retorno.'
    : preferenciaContato === 'email' && !email ? 'Informe o e-mail escolhido para retorno.'
    : !cargosEmpresaValidos.has(cargoEmpresa) ? 'Selecione seu cargo na empresa.'
    : cargoEmpresa === 'outro' && cargoOutro.length < 2 ? 'Informe seu cargo na empresa.'
    : '';
  return {
    erro, motivo, motivoOutro: motivoOutro || null, telefone, email: email || null,
    preferenciaContato, cargoEmpresa, cargoOutro: cargoOutro || null,
    contato: [telefone, email].filter(Boolean).join(' · '),
    detalhes: { plataforma: plataforma || null, referencia: referencia || null, horario_contato: horarioContato || null }
  };
}

async function mensagensDoChamado(admin: Cliente, chamadoId: string) {
  const { data, error } = await admin.from('chamado_mensagens')
    .select('id,chamado_id,autor_tipo,autor_nome,mensagem,anexos,visualizado_cliente_em,visualizado_suporte_em,criado_em')
    .eq('chamado_id', chamadoId).order('criado_em', { ascending: true }).limit(500);
  if (error) throw error;
  return data || [];
}

async function chamadoPorToken(admin: Cliente, token: string) {
  if (!token) return null;
  const tokenHash = await sha256(token);
  // Links novos usam apenas SHA-256. A segunda condicao preserva chamados
  // criados antes da migracao, sem gerar novos segredos em texto puro.
  const filtroToken = `token_hash.eq.${tokenHash},public_token.eq.${token}`;
  const { data, error } = await admin.from('chamados_suporte')
    .select('*').or(filtroToken).is('excluido_em', null).maybeSingle();
  if (error) throw error;
  return data;
}

async function adicionarMensagem(admin: Cliente, chamado: Record<string, any>, dados: Record<string, any>) {
  if (['resolvido', 'fechado'].includes(chamado.status) && !dados.permitirEncerrado) {
    throw new Error('Este chamado já foi encerrado e não aceita novas mensagens.');
  }
  const mensagem = texto(dados.mensagem);
  if (mensagem.length < 1) throw new Error('Escreva uma mensagem antes de enviar.');
  const agora = new Date().toISOString();
  const { data, error } = await admin.from('chamado_mensagens').insert({
    chamado_id: chamado.id,
    autor_tipo: dados.autorTipo,
    autor_id: dados.autorId || null,
    autor_nome: texto(dados.autorNome, 120) || null,
    mensagem,
    anexos: Array.isArray(dados.anexos) ? dados.anexos.slice(0, 10) : []
  }).select('id,chamado_id,autor_tipo,autor_nome,mensagem,anexos,criado_em').single();
  if (error) throw error;

  const atualizacao: Record<string, unknown> = {
    ultima_mensagem_em: agora,
    atualizado_em: agora
  };
  if (dados.autorTipo === 'suporte') {
    atualizacao.status = chamado.status === 'aberto' ? 'em_atendimento' : chamado.status;
    atualizacao.atendido_por = dados.autorId || chamado.atendido_por || null;
    if (!chamado.primeira_resposta_em) atualizacao.primeira_resposta_em = agora;
  }
  const { error: updateErro } = await admin.from('chamados_suporte').update(atualizacao).eq('id', chamado.id);
  if (updateErro) throw updateErro;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization = req.headers.get('Authorization') || '';
    const cliente = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const corpo = await req.json();
    const acao = texto(corpo?.acao, 50);
    const dados = corpo?.dados && typeof corpo.dados === 'object' ? corpo.dados : {};

    if (acao === 'criar_publico') {
      const codigo = texto(dados.empresa, 40).toLowerCase();
      const origem = texto(dados.origem, 30);
      const mensagem = texto(dados.mensagem);
      const nome = texto(dados.nome, 120);
      const usuario = texto(dados.usuario, 30).toLowerCase();
      const assunto = texto(dados.assunto, 160) || 'Atendimento de suporte';
      const prioridade = prioridadesValidas.has(texto(dados.prioridade, 20)) ? texto(dados.prioridade, 20) : 'normal';
      const campos = camposChamado(dados);
      if (!/^[a-z0-9-]{3,40}$/.test(codigo) || !origensPublicas.has(origem)
          || !/^[a-z0-9._-]{3,30}$/.test(usuario) || nome.length < 2 || mensagem.length < 10 || campos.erro) {
        return responder(400, { erro: campos.erro || 'Informe empresa, usuário, nome e uma descrição com pelo menos 10 caracteres.' });
      }
      const { data: empresa, error: empresaErro } = await admin.from('empresas')
        .select('id').eq('codigo', codigo).eq('ativo', true).maybeSingle();
      if (empresaErro || !empresa) return responder(404, { erro: 'Não foi possível confirmar a empresa e o usuário informados.' });
      const { data: identidade } = await admin.from('identidades_login')
        .select('usuario_id').eq('empresa_id', empresa.id).ilike('usuario', usuario).eq('ativo', true).maybeSingle();
      const { data: perfil } = identidade?.usuario_id
        ? await admin.from('perfis').select('id').eq('id', identidade.usuario_id).eq('empresa_id', empresa.id).eq('ativo', true).maybeSingle()
        : { data: null };
      if (!identidade || !perfil) return responder(404, { erro: 'Não foi possível confirmar a empresa e o usuário informados.' });

      const enderecoRede = texto(req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'sem-rede', 120).split(',')[0];
      const chaveLimite = await sha256([empresa.id, usuario, enderecoRede].join(':'));
      const { data: permitido, error: limiteErro } = await admin.rpc('registrar_limite_chamado_publico', {
        p_chave_hash: chaveLimite, p_limite: 5, p_janela_minutos: 60
      });
      if (limiteErro) throw limiteErro;
      if (permitido !== true) return responder(429, { erro: 'Muitos chamados foram enviados. Aguarde antes de tentar novamente.' });

      const tokenAcompanhamento = crypto.randomUUID();
      const tokenHash = await sha256(tokenAcompanhamento);
      const agora = new Date().toISOString();
      const { data: chamado, error } = await admin.from('chamados_suporte').insert({
        empresa_id: empresa.id, origem, aberto_por: null, public_token: null, token_hash: tokenHash,
        contato_nome: nome, contato_usuario: usuario,
        contato: campos.contato, telefone_contato: campos.telefone, email_contato: campos.email,
        preferencia_contato: campos.preferenciaContato, cargo_empresa: campos.cargoEmpresa,
        cargo_outro: campos.cargoOutro, motivo: campos.motivo, motivo_outro: campos.motivoOutro,
        detalhes_contato: campos.detalhes,
        mensagem, assunto, prioridade, status: 'aberto', ultima_mensagem_em: agora
      }).select('id').single();
      if (error || !chamado) throw error || new Error('Falha ao criar chamado.');
      await adicionarMensagem(admin, { id: chamado.id, status: 'aberto' }, {
        autorTipo: 'cliente', autorNome: nome || usuario || 'Cliente', mensagem
      });
      await admin.from('auditoria_comercial').insert({
        empresa_id: empresa.id, autor_id: null, acao: 'chamado_publico_criado',
        entidade: 'chamado_suporte', entidade_id: chamado.id,
        metadados: { origem, motivo: campos.motivo, usuario }
      });
      return responder(201, { sucesso: true, chamadoId: chamado.id, protocolo: protocolo(chamado.id), tokenAcompanhamento });
    }

    const autenticado = authorization.startsWith('Bearer ') ? await contextoAutenticado(cliente) : null;

    if (acao === 'criar_autenticado') {
      const atual = autenticado?.contexto;
      const origem = texto(dados.origem, 30);
      const mensagem = texto(dados.mensagem);
      const assunto = texto(dados.assunto, 160) || 'Atendimento de suporte';
      const prioridade = prioridadesValidas.has(texto(dados.prioridade, 20)) ? texto(dados.prioridade, 20) : 'normal';
      const campos = camposChamado(dados);
      if (!autenticado || !atual?.empresa_id || atual?.administrador_global || !origensAutenticadas.has(origem)
          || mensagem.length < 10 || campos.erro) {
        return responder(400, { erro: campos.erro || 'Não foi possível identificar a empresa ou a descrição é muito curta.' });
      }
      const agora = new Date().toISOString();
      const { data: chamado, error } = await admin.from('chamados_suporte').insert({
        empresa_id: atual.empresa_id, origem, aberto_por: autenticado.usuario.id,
        public_token: null, token_hash: null,
        contato_nome: texto(atual.perfil_nome, 120) || null,
        contato_usuario: texto(atual.usuario, 60) || texto(autenticado.usuario.user_metadata?.usuario, 60) || null,
        contato: campos.contato, telefone_contato: campos.telefone, email_contato: campos.email,
        preferencia_contato: campos.preferenciaContato, cargo_empresa: campos.cargoEmpresa,
        cargo_outro: campos.cargoOutro, motivo: campos.motivo, motivo_outro: campos.motivoOutro,
        detalhes_contato: campos.detalhes,
        mensagem, assunto, prioridade, status: 'aberto', ultima_mensagem_em: agora
      }).select('id').single();
      if (error || !chamado) throw error || new Error('Falha ao criar chamado.');
      await adicionarMensagem(admin, { id: chamado.id, status: 'aberto' }, {
        autorTipo: 'cliente', autorId: autenticado.usuario.id,
        autorNome: texto(atual.perfil_nome, 120) || texto(atual.usuario, 60) || 'Cliente', mensagem
      });
      await admin.from('auditoria_comercial').insert({
        empresa_id: atual.empresa_id, autor_id: autenticado.usuario.id,
        acao: 'chamado_autenticado_criado', entidade: 'chamado_suporte', entidade_id: chamado.id,
        metadados: { origem, motivo: campos.motivo }
      });
      return responder(201, { sucesso: true, chamadoId: chamado.id, protocolo: protocolo(chamado.id) });
    }

    if (acao === 'acompanhar_publico') {
      const chamado = await chamadoPorToken(admin, uuidValido(dados.token));
      if (!chamado) return responder(404, { erro: 'Chamado não encontrado neste aparelho.' });
      return responder(200, { chamado: { ...semSegredos(chamado), protocolo: protocolo(chamado.id) }, mensagens: await mensagensDoChamado(admin, chamado.id) });
    }

    if (acao === 'listar_meus') {
      const atual = autenticado?.contexto;
      if (!autenticado || !atual?.empresa_id || atual?.administrador_global) return responder(401, { erro: 'Entre novamente para acompanhar os chamados.' });
      let consulta = admin.from('chamados_suporte')
        .select('id,assunto,origem,status,prioridade,motivo,motivo_outro,criado_em,atualizado_em,ultima_mensagem_em,primeira_resposta_em,encerrado_em,resolucao,avaliacao')
        .eq('empresa_id', atual.empresa_id).is('excluido_em', null);
      if (!ehAdministradorEmpresa(atual)) consulta = consulta.eq('aberto_por', autenticado.usuario.id);
      const { data, error } = await consulta.order('ultima_mensagem_em', { ascending: false }).limit(100);
      if (error) throw error;
      return responder(200, { chamados: (data || []).map((item) => ({ ...item, protocolo: protocolo(item.id) })) });
    }

    const suporte = !!autenticado?.contexto?.administrador_global;

    if (acao === 'listar') {
      if (!suporte) return responder(403, { erro: 'Ação restrita ao suporte do Sistema OS.' });
      const { data: chamados, error } = await admin.from('chamados_suporte')
        .select('id,empresa_id,aberto_por,origem,contato_nome,contato_usuario,contato,telefone_contato,email_contato,preferencia_contato,cargo_empresa,cargo_outro,motivo,motivo_outro,detalhes_contato,mensagem,assunto,prioridade,status,criado_em,atualizado_em,ultima_mensagem_em,primeira_resposta_em,encerrado_em,resolucao,atendido_por,avaliacao')
        .is('excluido_em', null).order('ultima_mensagem_em', { ascending: false }).limit(200);
      if (error) throw error;
      const ids = [...new Set((chamados || []).map((item) => item.empresa_id).filter(Boolean))];
      const { data: empresas, error: empresasErro } = ids.length
        ? await admin.from('empresas').select('id,codigo,nome_fantasia').in('id', ids)
        : { data: [], error: null };
      if (empresasErro) throw empresasErro;
      const { data: naoLidas, error: naoLidasErro } = (chamados || []).length
        ? await admin.from('chamado_mensagens').select('chamado_id').in('chamado_id', (chamados || []).map((item) => item.id))
          .eq('autor_tipo', 'cliente').is('visualizado_suporte_em', null)
        : { data: [], error: null };
      if (naoLidasErro) throw naoLidasErro;
      const contagem = new Map<string, number>();
      (naoLidas || []).forEach((item) => contagem.set(item.chamado_id, (contagem.get(item.chamado_id) || 0) + 1));
      const porId = new Map((empresas || []).map((empresa) => [empresa.id, empresa]));
      return responder(200, { chamados: (chamados || []).map((chamado) => ({
        ...chamado, protocolo: protocolo(chamado.id), nao_lidas_suporte: contagem.get(chamado.id) || 0,
        empresa: porId.get(chamado.empresa_id) || null
      })) });
    }

    if (acao === 'listar_mensagens') {
      const chamadoId = uuidValido(dados.chamadoId);
      const token = uuidValido(dados.token);
      const { data: chamado, error } = await admin.from('chamados_suporte').select('*').eq('id', chamadoId).maybeSingle();
      if (error) throw error;
      if (!chamado || chamado.excluido_em) return responder(404, { erro: 'Chamado não encontrado.' });
      const chamadoToken = token ? await chamadoPorToken(admin, token) : null;
      if (!suporte && !podeAcessarAutenticado(chamado, autenticado) && chamadoToken?.id !== chamado.id) return responder(403, { erro: 'Você não pode acompanhar este chamado.' });
      return responder(200, { chamado: { ...semSegredos(chamado), protocolo: protocolo(chamado.id) }, mensagens: await mensagensDoChamado(admin, chamado.id) });
    }

    if (acao === 'responder_publico') {
      const chamado = await chamadoPorToken(admin, uuidValido(dados.token));
      if (!chamado) return responder(404, { erro: 'Chamado não encontrado neste aparelho.' });
      const mensagem = await adicionarMensagem(admin, chamado, {
        autorTipo: 'cliente', autorNome: chamado.contato_nome || chamado.contato_usuario || 'Cliente', mensagem: dados.mensagem
      });
      await admin.from('auditoria_comercial').insert({
        empresa_id: chamado.empresa_id, autor_id: null,
        acao: 'chamado_resposta_publica', entidade: 'chamado_suporte', entidade_id: chamado.id,
        metadados: { mensagemId: mensagem.id }
      });
      return responder(201, { sucesso: true, mensagem });
    }

    if (acao === 'responder_autenticado') {
      const chamadoId = uuidValido(dados.chamadoId);
      const { data: chamado, error } = await admin.from('chamados_suporte').select('*').eq('id', chamadoId).maybeSingle();
      if (error) throw error;
      if (!chamado || chamado.excluido_em || !podeAcessarAutenticado(chamado, autenticado)) return responder(403, { erro: 'Você não pode responder este chamado.' });
      const mensagem = await adicionarMensagem(admin, chamado, {
        autorTipo: 'cliente', autorId: autenticado?.usuario.id,
        autorNome: autenticado?.contexto?.perfil_nome || autenticado?.contexto?.usuario || 'Cliente', mensagem: dados.mensagem
      });
      await admin.from('auditoria_comercial').insert({
        empresa_id: chamado.empresa_id, autor_id: autenticado?.usuario.id,
        acao: 'chamado_resposta_cliente', entidade: 'chamado_suporte', entidade_id: chamado.id,
        metadados: { mensagemId: mensagem.id }
      });
      return responder(201, { sucesso: true, mensagem });
    }

    if (acao === 'responder_suporte') {
      if (!suporte) return responder(403, { erro: 'Ação restrita ao suporte do Sistema OS.' });
      const chamadoId = uuidValido(dados.chamadoId);
      const { data: chamado, error } = await admin.from('chamados_suporte').select('*').eq('id', chamadoId).maybeSingle();
      if (error) throw error;
      if (!chamado || chamado.excluido_em) return responder(404, { erro: 'Chamado não encontrado.' });
      const mensagem = await adicionarMensagem(admin, chamado, {
        autorTipo: 'suporte', autorId: autenticado?.usuario.id,
        autorNome: autenticado?.contexto?.perfil_nome || 'Suporte Sistema OS', mensagem: dados.mensagem
      });
      await admin.from('auditoria_comercial').insert({
        empresa_id: chamado.empresa_id, autor_id: autenticado?.usuario.id,
        acao: 'chamado_resposta_suporte', entidade: 'chamado_suporte', entidade_id: chamado.id,
        metadados: { mensagemId: mensagem.id }
      });
      return responder(201, { sucesso: true, mensagem });
    }

    if (acao === 'marcar_visualizado') {
      const chamadoId = uuidValido(dados.chamadoId);
      const token = uuidValido(dados.token);
      const { data: chamado, error } = await admin.from('chamados_suporte').select('id,empresa_id,aberto_por,token_hash,excluido_em').eq('id', chamadoId).maybeSingle();
      if (error) throw error;
      const chamadoToken = token ? await chamadoPorToken(admin, token) : null;
      if (!chamado || chamado.excluido_em || (!suporte && !podeAcessarAutenticado(chamado, autenticado) && chamadoToken?.id !== chamado.id)) return responder(403, { erro: 'Acesso negado.' });
      const campo = suporte ? 'visualizado_suporte_em' : 'visualizado_cliente_em';
      const autorOposto = suporte ? 'cliente' : 'suporte';
      const { error: marcarErro } = await admin.from('chamado_mensagens').update({ [campo]: new Date().toISOString() })
        .eq('chamado_id', chamado.id).eq('autor_tipo', autorOposto).is(campo, null);
      if (marcarErro) throw marcarErro;
      return responder(200, { sucesso: true });
    }

    if (acao === 'avaliar') {
      const nota = Number(dados.nota);
      const token = uuidValido(dados.token);
      const chamadoId = uuidValido(dados.chamadoId);
      const chamadoToken = token ? await chamadoPorToken(admin, token) : null;
      const { data: chamado, error } = chamadoToken
        ? { data: chamadoToken, error: null }
        : await admin.from('chamados_suporte').select('id,empresa_id,aberto_por,excluido_em').eq('id', chamadoId).maybeSingle();
      if (error) throw error;
      if (!chamado || chamado.excluido_em || (!chamadoToken && !podeAcessarAutenticado(chamado, autenticado)) || !Number.isInteger(nota) || nota < 1 || nota > 5) {
        return responder(400, { erro: 'Não foi possível registrar esta avaliação.' });
      }
      const { error: avaliacaoErro } = await admin.from('chamados_suporte').update({
        avaliacao: nota, avaliacao_comentario: texto(dados.comentario, 1000) || null, atualizado_em: new Date().toISOString()
      }).eq('id', chamado.id);
      if (avaliacaoErro) throw avaliacaoErro;
      return responder(200, { sucesso: true });
    }

    if (acao === 'atualizar') {
      if (!suporte) return responder(403, { erro: 'Ação restrita ao suporte do Sistema OS.' });
      const chamadoId = uuidValido(dados.chamadoId);
      const status = texto(dados.status, 30);
      const resolucao = texto(dados.resolucao);
      if (!chamadoId || !statusValidos.has(status)) return responder(400, { erro: 'Status de chamado inválido.' });
      const { data: chamado, error: chamadoErro } = await admin.from('chamados_suporte').select('*').eq('id', chamadoId).maybeSingle();
      if (chamadoErro) throw chamadoErro;
      if (!chamado || chamado.excluido_em) return responder(404, { erro: 'Chamado não encontrado.' });
      const agora = new Date().toISOString();
      const statusAnterior = chamado.status;
      const nomeSuporte = texto(autenticado?.contexto?.perfil_nome, 120) || 'Suporte Sistema OS';
      const campos: Record<string, unknown> = { status, atualizado_em: agora };
      if (status === 'em_atendimento') campos.atendido_por = autenticado?.usuario.id;
      if (status === 'resolvido' || status === 'fechado') campos.encerrado_em = agora;
      if (status === 'aberto') {
        campos.encerrado_em = null;
        campos.resolucao = null;
      }
      if (resolucao) campos.resolucao = resolucao;
      const { error } = await admin.from('chamados_suporte').update(campos).eq('id', chamadoId);
      if (error) throw error;
      if (status !== statusAnterior && status === 'em_atendimento') {
        await adicionarMensagem(admin, { ...chamado, status }, {
          autorTipo: 'suporte', autorId: autenticado?.usuario.id, autorNome: nomeSuporte,
          mensagem: `Seu chamado foi assumido por ${nomeSuporte}. O atendimento foi iniciado.`
        });
      } else if (status !== statusAnterior && (status === 'resolvido' || status === 'fechado')) {
        const conclusao = resolucao || (status === 'resolvido'
          ? 'O atendimento foi concluído pelo suporte.'
          : 'O atendimento foi encerrado pelo suporte.');
        await adicionarMensagem(admin, { ...chamado, status }, {
          autorTipo: 'suporte', autorId: autenticado?.usuario.id, autorNome: nomeSuporte,
          mensagem: `${status === 'resolvido' ? 'Chamado resolvido.' : 'Chamado fechado.'} ${conclusao} Este chat foi encerrado e não aceita novas mensagens.`,
          permitirEncerrado: true
        });
      } else if (resolucao && !['resolvido', 'fechado'].includes(status)) {
        await adicionarMensagem(admin, { ...chamado, status }, {
          autorTipo: 'suporte', autorId: autenticado?.usuario.id,
          autorNome: nomeSuporte, mensagem: resolucao
        });
      }
      await admin.from('auditoria_comercial').insert({
        empresa_id: chamado.empresa_id, autor_id: autenticado?.usuario.id,
        acao: 'chamado_' + status, entidade: 'chamado_suporte', entidade_id: chamadoId,
        metadados: { resolucao: resolucao || null }
      });
      return responder(200, { sucesso: true });
    }

    if (acao === 'excluir') {
      if (!suporte) return responder(403, { erro: 'Ação restrita ao suporte do Sistema OS.' });
      const chamadoId = uuidValido(dados.chamadoId);
      if (!chamadoId) return responder(400, { erro: 'Chamado inválido.' });
      const { data: chamado, error: chamadoErro } = await admin.from('chamados_suporte')
        .select('id,empresa_id,assunto,status').eq('id', chamadoId).maybeSingle();
      if (chamadoErro) throw chamadoErro;
      if (!chamado) return responder(404, { erro: 'Chamado não encontrado.' });

      const { count: mensagens } = await admin.from('chamado_mensagens')
        .select('id', { count: 'exact', head: true }).eq('chamado_id', chamadoId);
      const { error: auditoriaErro } = await admin.from('auditoria_comercial').insert({
        empresa_id: chamado.empresa_id, autor_id: autenticado?.usuario.id,
        acao: 'chamado_excluido', entidade: 'chamado_suporte', entidade_id: chamadoId,
        metadados: { assunto: chamado.assunto, status: chamado.status, mensagens: mensagens || 0 }
      });
      if (auditoriaErro) throw auditoriaErro;
      // Retencao segura: a acao remove o item das filas, mas conserva o
      // historico e a auditoria para que um chamado nao seja perdido.
      const { error: excluirErro } = await admin.from('chamados_suporte').update({
        excluido_em: new Date().toISOString(), excluido_por: autenticado?.usuario.id,
        status: 'fechado', atualizado_em: new Date().toISOString()
      }).eq('id', chamadoId);
      if (excluirErro) throw excluirErro;
      return responder(200, { sucesso: true });
    }

    return responder(400, { erro: 'Ação inválida.' });
  } catch (erro) {
    console.error('[chamados-suporte]', erro instanceof Error ? erro.message : String(erro));
    return responder(500, { erro: 'Não foi possível concluir o chamado agora.' });
  }
});
