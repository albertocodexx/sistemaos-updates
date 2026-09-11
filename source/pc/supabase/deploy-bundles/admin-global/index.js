// supabase/functions/admin-global/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// supabase/functions/_shared/access.ts
var CARGOS_ADMINISTRATIVOS = /* @__PURE__ */ new Set([
  "administrador",
  "admin",
  "proprietario",
  "propriet\xE1rio"
]);
var STATUS_LICENCA_OPERACIONAL = /* @__PURE__ */ new Set([
  "ativa",
  "teste",
  "vencendo",
  "periodo_graca"
]);
var MODULO_DOCUMENTO = Object.freeze({
  os: "os",
  entrega: "os",
  desbloqueio: "os",
  compra: "estoque",
  venda: "estoque"
});
var textoNormalizado = (valor) => String(valor ?? "").trim().toLowerCase();
function ehAdministradorEmpresa(contexto) {
  return !!contexto && contexto.administrador_global !== true && CARGOS_ADMINISTRATIVOS.has(textoNormalizado(contexto.cargo));
}
function contextoUsuarioAtivo(contexto) {
  if (!contexto || contexto.usuario_ativo !== true) return false;
  return contexto.administrador_global === true || contexto.empresa_ativa === true;
}
function licencaPermiteOperacao(contexto) {
  return !!contexto && contexto.administrador_global !== true && STATUS_LICENCA_OPERACIONAL.has(textoNormalizado(contexto.licenca_status));
}

// supabase/functions/admin-global/index.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json; charset=utf-8"
};
var resposta = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: cors });
var texto = (valor) => String(valor ?? "").trim();
var mensagemSegura = (erro) => {
  let mensagem = erro instanceof Error ? erro.message : "";
  if (!mensagem && erro && typeof erro === "object") {
    const registro = erro;
    for (const chave of ["erro", "mensagem", "message", "details", "hint", "error_description"]) {
      const valor = texto(registro[chave]);
      if (valor && valor !== "[object Object]" && valor !== "{}") {
        mensagem = valor;
        break;
      }
    }
  }
  if (!mensagem) {
    const convertido = texto(erro);
    if (convertido !== "[object Object]" && convertido !== "{}") mensagem = convertido;
  }
  if (!mensagem) return "N\xE3o foi poss\xEDvel concluir a opera\xE7\xE3o.";
  if (/service.role|jwt|token|secret|apikey|authorization/i.test(mensagem)) {
    return "O servidor recusou a opera\xE7\xE3o por seguran\xE7a. Entre novamente e tente de novo.";
  }
  return mensagem;
};
var acoes = (ler = false, criar = false, editar = false, excluir = false) => ({ ler, criar, editar, excluir });
var PAPEIS_SUPORTE = ["suporte", "gerente_suporte", "administrador_geral"];
var ROTULOS_PAPEIS_SUPORTE = {
  suporte: "Analista de Suporte",
  gerente_suporte: "Gerente de Suporte",
  administrador_geral: "Administrador Geral"
};
var normalizarPapelSuporte = (valor) => {
  const papel = texto(valor).toLowerCase().replace(/[\s-]+/g, "_");
  if (["administrador_geral", "administrador_do_sistema", "administrador"].includes(papel)) return "administrador_geral";
  if (["gerente_suporte", "gerente_de_suporte", "gerente"].includes(papel)) return "gerente_suporte";
  if (["suporte", "analista_suporte", "analista_de_suporte", "atendente"].includes(papel)) return "suporte";
  return "";
};
var cargoPerfilSuporte = (papel) => ROTULOS_PAPEIS_SUPORTE[papel] || ROTULOS_PAPEIS_SUPORTE.suporte;
var permissoesParaCargo = (cargo) => {
  const valor = cargo.toLowerCase();
  if (valor.includes("admin") || valor.includes("propriet")) {
    return { "*": { "*": true }, os: acoes(true, true, true, true), clientes: acoes(true, true, true, true), estoque: acoes(true, true, true, true), financeiro: acoes(true, true, true, true), relatorios: acoes(true, true, true, true), configuracoes: acoes(true, true, true, true), usuarios: acoes(true, true, true, true) };
  }
  if (valor.includes("gerente")) {
    return { os: acoes(true, true, true, true), clientes: acoes(true, true, true, false), estoque: acoes(true, true, true, false), financeiro: acoes(true, true, true, false), relatorios: acoes(true, false, false, false), configuracoes: acoes(true, false, false, false), usuarios: acoes(true, true, true, false) };
  }
  if (valor.includes("t\xE9cnico") || valor.includes("tecnico")) {
    return { os: acoes(true, true, true, false), clientes: acoes(true, false, true, false), estoque: acoes(true, false, true, false), financeiro: acoes(false), relatorios: acoes(true), configuracoes: acoes(false), usuarios: acoes(false) };
  }
  return { os: acoes(true, true, true, false), clientes: acoes(true, true, true, false), estoque: acoes(false), financeiro: acoes(false), relatorios: acoes(false), configuracoes: acoes(false), usuarios: acoes(false) };
};
var numeroInteiro = (valor, padrao = null) => {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : padrao;
};
var normalizarTelefone = (valor) => texto(valor).replace(/\D/g, "").slice(0, 15);
var telefoneValido = (valor) => valor.length >= 10 && valor.length <= 15;
var PROVEDORES_IA_EMPRESA = {
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", modelo: "openai/gpt-oss-120b" },
  openai: { url: "https://api.openai.com/v1/chat/completions", modelo: "gpt-4.1-mini" },
  anthropic: { url: "https://api.anthropic.com/v1/messages", modelo: "claude-sonnet-4-6", anthropic: true },
  deepseek: { url: "https://api.deepseek.com/chat/completions", modelo: "deepseek-v4-flash" }
};
var base64ParaBytes = (valor) => Uint8Array.from(atob(valor), (caractere) => caractere.charCodeAt(0));
var bytesParaBase64 = (valor) => btoa(String.fromCharCode(...new Uint8Array(valor)));
async function chaveIntegracaoIA() {
  const bytes = base64ParaBytes(Deno.env.get("INTEGRATION_ENCRYPTION_KEY") || "");
  if (bytes.byteLength !== 32) throw new Error("O cofre seguro das integra\xE7\xF5es n\xE3o est\xE1 configurado.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function cifrarChaveIA(valor) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifra = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chaveIntegracaoIA(), new TextEncoder().encode(valor));
  return { iv: bytesParaBase64(iv.buffer), cifra: bytesParaBase64(cifra) };
}
async function decifrarChaveIA(iv, cifra) {
  const aberto = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ParaBytes(iv) }, await chaveIntegracaoIA(), base64ParaBytes(cifra));
  return new TextDecoder().decode(aberto);
}
function validarIAEmpresa(provedorRecebido, modeloRecebido) {
  const provedor = texto(provedorRecebido).toLowerCase();
  const definicao = PROVEDORES_IA_EMPRESA[provedor];
  if (!definicao) throw new Error("Selecione um provedor de IA v\xE1lido.");
  const modelo = texto(modeloRecebido) || definicao.modelo;
  if (!/^[a-z0-9][a-z0-9._/-]{1,99}$/i.test(modelo)) throw new Error("Selecione um modelo de IA v\xE1lido.");
  return { provedor, modelo, definicao };
}
async function testarChaveIAEmpresa(provedor, modelo, apiKey) {
  const definicao = PROVEDORES_IA_EMPRESA[provedor];
  const consulta = definicao.anthropic ? await fetch(definicao.url, { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: modelo, max_tokens: 8, messages: [{ role: "user", content: "Responda apenas OK." }] }) }) : await fetch(definicao.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: modelo, max_tokens: 8, temperature: 0, messages: [{ role: "user", content: "Responda apenas OK." }] }) });
  if (!consulta.ok) throw new Error(`O provedor recusou a configura\xE7\xE3o (HTTP ${consulta.status}).`);
}
async function detalhesPlano(admin, planoId) {
  if (!planoId) return null;
  const { data: plano, error } = await admin.from("planos").select("id,nome,limites").eq("id", planoId).eq("ativo", true).maybeSingle();
  if (error) throw error;
  if (!plano) return null;
  const planoAtual = plano;
  const { data: vinculos, error: vinculosErro } = await admin.from("plano_recursos").select("habilitado,limite,recurso:recursos(chave)").eq("plano_id", planoAtual.id);
  if (vinculosErro) throw vinculosErro;
  const recursos = {};
  (vinculos || []).forEach((vinculo) => {
    const recurso = Array.isArray(vinculo.recurso) ? vinculo.recurso[0] : vinculo.recurso;
    if (!recurso?.chave) return;
    recursos[recurso.chave] = vinculo.habilitado === false ? false : vinculo.limite ?? true;
  });
  return { ...planoAtual, recursos };
}
async function removerObjetosEmpresa(admin, empresaId) {
  const buckets = ["miniaturas", "arquivos-os", "documentos-pdf", "backups-empresa", "identidade-empresa"];
  for (const bucket of buckets) {
    const pastas = [empresaId];
    const arquivos = [];
    while (pastas.length) {
      const pasta = pastas.pop();
      let offset = 0;
      while (true) {
        const { data, error } = await admin.storage.from(bucket).list(pasta, {
          limit: 100,
          offset,
          sortBy: { column: "name", order: "asc" }
        });
        if (error && !/not found/i.test(error.message || "")) throw error;
        const itens = data || [];
        if (!itens.length) break;
        arquivos.push(...itens.filter((item) => item.id).map((item) => `${pasta}/${item.name}`));
        itens.filter((item) => !item.id).forEach((item) => pastas.push(`${pasta}/${item.name}`));
        if (itens.length < 100) break;
        offset += itens.length;
      }
    }
    for (let indice = 0; indice < arquivos.length; indice += 100) {
      const { error: removerErro } = await admin.storage.from(bucket).remove(arquivos.slice(indice, indice + 100));
      if (removerErro) throw removerErro;
    }
  }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return resposta(401, { erro: "Sess\xE3o inv\xE1lida." });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const cliente = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: sessao } = await cliente.auth.getUser();
    if (!sessao.user) return resposta(401, { erro: "Sess\xE3o inv\xE1lida." });
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const { data: contexto, error: contextoErro } = await cliente.rpc("obter_contexto_comercial");
    const contextoAtual = Array.isArray(contexto) ? contexto[0] : contexto;
    if (contextoErro || !contextoAtual || !contextoUsuarioAtivo(contextoAtual)) {
      return resposta(401, { erro: "Sua sess\xE3o n\xE3o est\xE1 vinculada a uma empresa ativa." });
    }
    const corpo = await req.json();
    const acao = texto(corpo.acao);
    const dados = corpo.dados || {};
    const administradorEmpresa = ehAdministradorEmpresa(contextoAtual);
    if (!contextoAtual.administrador_global && !licencaPermiteOperacao(contextoAtual)) {
      return resposta(403, { erro: "A assinatura da empresa n\xE3o permite esta opera\xE7\xE3o." });
    }
    const acoesAdministradorEmpresa = /* @__PURE__ */ new Set([
      "listar_usuarios_empresa",
      "criar_usuario_empresa",
      "atualizar_usuario_empresa",
      "resetar_senha",
      "excluir_usuario_empresa",
      "definir_senha_exclusao_usuario"
    ]);
    const acoesQualquerUsuarioEmpresa = /* @__PURE__ */ new Set(["validar_credencial_admin_exclusao"]);
    if (!contextoAtual.administrador_global && !(administradorEmpresa && acoesAdministradorEmpresa.has(acao)) && !acoesQualquerUsuarioEmpresa.has(acao)) {
      return resposta(403, { erro: "Esta a\xE7\xE3o exige um Administrador da empresa." });
    }
    let papelSuporte = "administrador_empresa";
    if (contextoAtual.administrador_global) {
      const { data: cadastroSuporte, error: suporteErro } = await admin.from("administradores_globais").select("papel,ativo").eq("usuario_id", sessao.user.id).maybeSingle();
      if (suporteErro) throw suporteErro;
      papelSuporte = texto(cadastroSuporte?.papel || "suporte");
    }
    const somenteAdministradorGeral = /* @__PURE__ */ new Set([
      "salvar_plano",
      "excluir_plano",
      "definir_senha_exclusao",
      "decidir_exclusao",
      "definir_papel_suporte",
      "configurar_fiscal_empresa"
    ]);
    const exigeGerencia = /* @__PURE__ */ new Set([
      "criar_empresa",
      "atualizar_licenca",
      "confirmar_pagamento",
      "alterar_telefones_empresa",
      "obter_integracao_ia_empresa",
      "configurar_integracao_ia_empresa",
      "desconectar_integracao_ia_empresa",
      "configurar_troca_rapida_empresa",
      "criar_usuario_empresa",
      "atualizar_usuario_empresa",
      "resetar_senha",
      "excluir_usuario_empresa"
    ]);
    if (contextoAtual.administrador_global && somenteAdministradorGeral.has(acao) && papelSuporte !== "administrador_geral") {
      return resposta(403, { erro: "Somente o Administrador Geral pode realizar esta a\xE7\xE3o." });
    }
    if (contextoAtual.administrador_global && exigeGerencia.has(acao) && !["gerente_suporte", "administrador_geral"].includes(papelSuporte)) {
      return resposta(403, { erro: "Esta a\xE7\xE3o exige o cargo Gerente de Suporte ou Administrador Geral." });
    }
    if (acao === "validar_credencial_admin_exclusao") {
      if (contextoAtual.administrador_global) return resposta(403, { erro: "Entre em uma empresa cliente para validar esta autoriza\xE7\xE3o." });
      const usuario = texto(dados.usuario).toLowerCase();
      const senha = String(dados.senha || "");
      if (!usuario || !senha) return resposta(400, { erro: "Informe o usu\xE1rio e a senha do administrador." });
      const { data: identidade, error: identidadeErro } = await admin.from("identidades_login").select("usuario_id,email_tecnico,ativo").eq("empresa_id", contextoAtual.empresa_id).eq("usuario", usuario).maybeSingle();
      if (identidadeErro) throw identidadeErro;
      if (!identidade?.usuario_id || identidade.ativo === false) return resposta(403, { erro: "Usu\xE1rio ou senha de administrador incorretos." });
      const { data: perfil, error: perfilErro } = await admin.from("perfis").select("id,nome,cargo,ativo").eq("empresa_id", contextoAtual.empresa_id).eq("id", identidade.usuario_id).maybeSingle();
      if (perfilErro) throw perfilErro;
      if (!perfil?.ativo || !["administrador", "admin", "proprietario", "propriet\xE1rio"].includes(texto(perfil.cargo).toLowerCase())) {
        return resposta(403, { erro: "A conta informada n\xE3o \xE9 administradora desta empresa." });
      }
      const verificador = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: loginErro } = await verificador.auth.signInWithPassword({ email: identidade.email_tecnico, password: senha });
      if (loginErro) return resposta(403, { erro: "Usu\xE1rio ou senha de administrador incorretos." });
      await verificador.auth.signOut().catch(() => {
      });
      await admin.from("auditoria_comercial").insert({
        empresa_id: contextoAtual.empresa_id,
        autor_id: sessao.user.id,
        acao: "exclusao_autorizada_por_administrador",
        entidade: "perfil",
        entidade_id: identidade.usuario_id,
        metadados: { administrador: usuario }
      });
      return resposta(200, { sucesso: true, administrador: perfil.nome || usuario });
    }
    if (acao === "definir_senha_exclusao_usuario") {
      const usuarioId = texto(dados.usuarioId);
      const senha = String(dados.senha || "");
      if (!usuarioId || senha.length < 6) return resposta(400, { erro: "Informe o usu\xE1rio e uma senha com pelo menos 6 caracteres." });
      const { data, error } = await cliente.rpc("definir_senha_exclusao_usuario", {
        p_usuario_id: usuarioId,
        p_senha: senha
      });
      if (error) throw error;
      return resposta(200, { sucesso: data === true });
    }
    if (acao === "criar_empresa") {
      const codigo = texto(dados.codigo).toLowerCase();
      const nome = texto(dados.nome);
      const usuario = texto(dados.usuario).toLowerCase();
      const senha = String(dados.senha || "");
      const diasTrial = 45;
      const semTelefone = dados.semTelefone === true;
      const telefonePrincipal = semTelefone ? "" : normalizarTelefone(dados.telefonePrincipal);
      const telefoneCobranca = normalizarTelefone(dados.telefoneCobranca);
      if (!/^[a-z0-9-]{3,40}$/.test(codigo) || !nome || !/^[a-z0-9._-]{3,30}$/.test(usuario) || senha.length < 8) {
        return resposta(400, { erro: "Dados da empresa ou usu\xE1rio inicial inv\xE1lidos." });
      }
      if (!semTelefone && !telefoneValido(telefonePrincipal)) {
        return resposta(400, { erro: "Informe o telefone principal com DDD ou marque que a empresa n\xE3o possui telefone." });
      }
      if (telefoneCobranca && !telefoneValido(telefoneCobranca)) {
        return resposta(400, { erro: "O WhatsApp de cobran\xE7a deve ter entre 10 e 15 d\xEDgitos." });
      }
      const limiteRetencao = new Date(Date.now() - 3 * 864e5).toISOString();
      await admin.from("solicitacoes_exclusao").delete().in("status", ["negada", "executada"]).lt("atualizada_em", limiteRetencao);
      const { data: empresaExistente, error: empresaExistenteErro } = await admin.from("empresas").select("id,codigo,nome_fantasia,ativo,licenca_status").eq("codigo", codigo).maybeSingle();
      if (empresaExistenteErro) throw empresaExistenteErro;
      if (empresaExistente) {
        const arquivada = empresaExistente.ativo === false || empresaExistente.licenca_status === "cancelada";
        return resposta(409, {
          erro: arquivada ? "Esse c\xF3digo pertence a uma empresa arquivada. Conclua a exclus\xE3o definitiva; depois da car\xEAncia de 3 dias ele poder\xE1 ser reutilizado." : "Esse c\xF3digo j\xE1 pertence a uma empresa ativa. Escolha outro c\xF3digo."
        });
      }
      const { data: exclusaoRecente, error: exclusaoRecenteErro } = await admin.from("auditoria_empresas_excluidas").select("empresa_codigo,excluida_em").ilike("empresa_codigo", codigo).gt("excluida_em", limiteRetencao).order("excluida_em", { ascending: false }).limit(1).maybeSingle();
      if (exclusaoRecenteErro) throw exclusaoRecenteErro;
      if (exclusaoRecente) {
        const liberaEm = new Date(new Date(exclusaoRecente.excluida_em).getTime() + 3 * 864e5);
        return resposta(409, { erro: `Esse c\xF3digo foi exclu\xEDdo recentemente e fica reservado por seguran\xE7a at\xE9 ${liberaEm.toLocaleString("pt-BR")}.` });
      }
      const emailTecnico = usuario + "." + codigo + "." + crypto.randomUUID().slice(0, 8) + "@accounts.sistemaos.app";
      const { data: authCriado, error: authErro } = await admin.auth.admin.createUser({
        email: emailTecnico,
        password: senha,
        email_confirm: true,
        user_metadata: { usuario, empresa_codigo: codigo }
      });
      if (authErro || !authCriado.user) return resposta(400, { erro: "N\xE3o foi poss\xEDvel criar o acesso inicial." });
      const inicio = /* @__PURE__ */ new Date();
      const fim = new Date(inicio.getTime() + diasTrial * 864e5);
      const { data: planoTrial } = await admin.from("planos").select("id,limites").ilike("nome", "Trial").eq("ativo", true).maybeSingle();
      const trialDetalhes = planoTrial ? await detalhesPlano(admin, planoTrial.id) : null;
      const limitesTrial = trialDetalhes?.limites || {};
      const { data: empresa, error: empresaErro } = await admin.from("empresas").insert({
        codigo,
        nome_fantasia: nome,
        ativo: true,
        licenca_status: "teste",
        telefone_principal: telefonePrincipal || null,
        empresa_sem_telefone: semTelefone,
        contato_cobranca_whatsapp: telefoneCobranca || null,
        avisos_cobranca_ativos: Boolean(telefoneCobranca),
        plano_id: planoTrial?.id || null,
        inicio_trial: inicio.toISOString(),
        fim_trial: fim.toISOString(),
        periodo_graca_ate: null,
        limite_usuarios: numeroInteiro(limitesTrial.usuarios),
        limite_dispositivos: numeroInteiro(limitesTrial.dispositivos),
        limite_storage: numeroInteiro(limitesTrial.storage_bytes),
        recursos_habilitados: {
          ...trialDetalhes?.recursos || {},
          fiscal_habilitado: true,
          troca_rapida_contas: true
        }
      }).select("id,codigo,nome_fantasia,telefone_principal,empresa_sem_telefone,contato_cobranca_whatsapp,inicio_trial,fim_trial").single();
      if (empresaErro || !empresa) {
        await admin.auth.admin.deleteUser(authCriado.user.id);
        return resposta(400, { erro: "N\xE3o foi poss\xEDvel criar a empresa." });
      }
      const permissoes = permissoesParaCargo("Administrador");
      const operacoes = await Promise.all([
        admin.from("perfis").insert({ id: authCriado.user.id, empresa_id: empresa.id, nome: texto(dados.nomeAdministrador) || "Administrador", cargo: "Administrador", permissoes, ativo: true }),
        admin.from("identidades_login").insert({ empresa_id: empresa.id, usuario_id: authCriado.user.id, usuario, email_tecnico: emailTecnico }),
        admin.from("configuracoes_empresa").upsert({ empresa_id: empresa.id, feature_flags: { supabaseAtivo: true, storageProvider: "supabase-storage" } }),
        admin.from("eventos_licenca").insert({ empresa_id: empresa.id, tipo: "trial_criado", dados: { dias: diasTrial, planoId: planoTrial?.id || null }, autor_id: sessao.user.id }),
        admin.from("auditoria_comercial").insert({
          empresa_id: empresa.id,
          autor_id: sessao.user.id,
          acao: "empresa_criada",
          entidade: "empresa",
          entidade_id: empresa.id,
          metadados: {
            codigo,
            diasTrial,
            planoId: planoTrial?.id || null,
            semTelefone,
            possuiContatoCobranca: Boolean(telefoneCobranca)
          }
        })
      ]);
      const falha = operacoes.find((item) => item.error);
      if (falha?.error) {
        await admin.from("empresas").delete().eq("id", empresa.id);
        await admin.auth.admin.deleteUser(authCriado.user.id);
        throw falha.error;
      }
      return resposta(201, { empresa, usuario: { usuario, nome: texto(dados.nomeAdministrador) || "Administrador" } });
    }
    if (acao === "alterar_codigo_empresa") {
      const empresaId = texto(dados.empresaId);
      const novoCodigo = texto(dados.novoCodigo).toLowerCase();
      if (!empresaId || !/^[a-z0-9-]{3,40}$/.test(novoCodigo)) {
        return resposta(400, { erro: "Use um c\xF3digo de 3 a 40 caracteres, contendo apenas letras, n\xFAmeros e h\xEDfen." });
      }
      const { data: empresa, error: empresaErro } = await admin.from("empresas").select("id,codigo,nome_fantasia").eq("id", empresaId).maybeSingle();
      if (empresaErro) throw empresaErro;
      if (!empresa) return resposta(404, { erro: "Empresa n\xE3o encontrada." });
      if (empresa.codigo === novoCodigo) return resposta(200, { sucesso: true, empresa });
      const { data: codigoEmUso, error: codigoErro } = await admin.from("empresas").select("id").eq("codigo", novoCodigo).neq("id", empresaId).maybeSingle();
      if (codigoErro) throw codigoErro;
      if (codigoEmUso) return resposta(409, { erro: "Este c\xF3digo j\xE1 est\xE1 sendo usado por outra empresa." });
      const { data: empresaAtualizada, error: atualizarErro } = await admin.from("empresas").update({ codigo: novoCodigo, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", empresaId).select("id,codigo,nome_fantasia").single();
      if (atualizarErro) throw atualizarErro;
      await admin.from("auditoria_comercial").insert({
        empresa_id: empresaId,
        autor_id: sessao.user.id,
        acao: "codigo_empresa_alterado",
        entidade: "empresa",
        entidade_id: empresaId,
        metadados: { codigoAnterior: empresa.codigo, novoCodigo }
      });
      return resposta(200, { sucesso: true, empresa: empresaAtualizada });
    }
    if (acao === "alterar_nome_empresa") {
      const empresaId = texto(dados.empresaId);
      const novoNome = texto(dados.novoNome).replace(/\s+/g, " ");
      if (!empresaId || novoNome.length < 2 || novoNome.length > 120) {
        return resposta(400, { erro: "Informe um nome de empresa entre 2 e 120 caracteres." });
      }
      const { data: empresa, error: empresaErro } = await admin.from("empresas").select("id,codigo,nome_fantasia").eq("id", empresaId).maybeSingle();
      if (empresaErro) throw empresaErro;
      if (!empresa) return resposta(404, { erro: "Empresa n\xE3o encontrada." });
      if (empresa.nome_fantasia === novoNome) return resposta(200, { sucesso: true, empresa });
      const { data: empresaAtualizada, error: atualizarErro } = await admin.from("empresas").update({ nome_fantasia: novoNome, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", empresaId).select("id,codigo,nome_fantasia").single();
      if (atualizarErro) throw atualizarErro;
      await admin.from("auditoria_comercial").insert({
        empresa_id: empresaId,
        autor_id: sessao.user.id,
        acao: "nome_empresa_alterado",
        entidade: "empresa",
        entidade_id: empresaId,
        metadados: { nomeAnterior: empresa.nome_fantasia, novoNome }
      });
      return resposta(200, { sucesso: true, empresa: empresaAtualizada });
    }
    if (acao === "alterar_telefones_empresa") {
      const empresaId = texto(dados.empresaId);
      const semTelefone = dados.semTelefone === true;
      const telefonePrincipal = semTelefone ? "" : normalizarTelefone(dados.telefonePrincipal);
      const telefoneCobranca = normalizarTelefone(dados.telefoneCobranca);
      if (!empresaId) return resposta(400, { erro: "Empresa inv\xE1lida." });
      if (!semTelefone && !telefoneValido(telefonePrincipal)) {
        return resposta(400, { erro: "Informe o telefone principal com DDD ou marque que a empresa n\xE3o possui telefone." });
      }
      if (telefoneCobranca && !telefoneValido(telefoneCobranca)) {
        return resposta(400, { erro: "O WhatsApp de cobran\xE7a deve ter entre 10 e 15 d\xEDgitos." });
      }
      const { data: anterior, error: anteriorErro } = await admin.from("empresas").select("id,telefone_principal,empresa_sem_telefone,contato_cobranca_whatsapp").eq("id", empresaId).maybeSingle();
      if (anteriorErro) throw anteriorErro;
      if (!anterior) return resposta(404, { erro: "Empresa n\xE3o encontrada." });
      const { data: empresaAtualizada, error: atualizarErro } = await admin.from("empresas").update({
        telefone_principal: telefonePrincipal || null,
        empresa_sem_telefone: semTelefone,
        contato_cobranca_whatsapp: telefoneCobranca || null,
        avisos_cobranca_ativos: Boolean(telefoneCobranca),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", empresaId).select("id,codigo,nome_fantasia,telefone_principal,empresa_sem_telefone,contato_cobranca_whatsapp,avisos_cobranca_ativos").single();
      if (atualizarErro) throw atualizarErro;
      await admin.from("auditoria_comercial").insert({
        empresa_id: empresaId,
        autor_id: sessao.user.id,
        acao: "telefones_empresa_alterados",
        entidade: "empresa",
        entidade_id: empresaId,
        metadados: {
          semTelefone,
          telefonePrincipalAlterado: normalizarTelefone(anterior.telefone_principal) !== telefonePrincipal,
          contatoCobrancaAlterado: normalizarTelefone(anterior.contato_cobranca_whatsapp) !== telefoneCobranca
        }
      });
      return resposta(200, { sucesso: true, empresa: empresaAtualizada });
    }
    if (acao === "resetar_senha") {
      const usuarioId = texto(dados.usuarioId);
      const senha = String(dados.novaSenha || "");
      if (!usuarioId || senha.length < 8) return resposta(400, { erro: "Nova senha inv\xE1lida." });
      if (!contextoAtual.administrador_global) {
        const { data: perfilAlvo, error: perfilErro } = await admin.from("perfis").select("id").eq("id", usuarioId).eq("empresa_id", contextoAtual.empresa_id).maybeSingle();
        if (perfilErro) throw perfilErro;
        if (!perfilAlvo) return resposta(403, { erro: "Voc\xEA s\xF3 pode redefinir senhas de usu\xE1rios da sua empresa." });
      }
      const { error } = await admin.auth.admin.updateUserById(usuarioId, { password: senha });
      if (error) throw error;
      await admin.from("auditoria_comercial").insert({ autor_id: sessao.user.id, acao: "senha_redefinida_suporte", entidade: "usuario", entidade_id: usuarioId, motivo: texto(dados.motivo) || null });
      return resposta(200, { sucesso: true });
    }
    if (acao === "listar_planos") {
      const [planosConsulta, recursosConsulta, vinculosConsulta] = await Promise.all([
        admin.from("planos").select("id,nome,descricao,ativo,preco_referencia,periodo,duracao_dias,ordem,destaque,excluido_em,limites,created_at,updated_at").is("excluido_em", null).order("ordem").order("nome", { ascending: true }),
        admin.from("recursos").select("id,chave,nome,descricao").order("nome", { ascending: true }),
        admin.from("plano_recursos").select("plano_id,recurso_id,habilitado,limite")
      ]);
      if (planosConsulta.error) throw planosConsulta.error;
      if (recursosConsulta.error) throw recursosConsulta.error;
      if (vinculosConsulta.error) throw vinculosConsulta.error;
      const recursoPorId = new Map((recursosConsulta.data || []).map((item) => [item.id, item]));
      const porPlano = /* @__PURE__ */ new Map();
      (vinculosConsulta.data || []).forEach((vinculo) => {
        const recurso = recursoPorId.get(vinculo.recurso_id);
        if (!recurso) return;
        const lista = porPlano.get(vinculo.plano_id) || [];
        lista.push({ ...recurso, habilitado: vinculo.habilitado, limite: vinculo.limite });
        porPlano.set(vinculo.plano_id, lista);
      });
      return resposta(200, {
        planos: (planosConsulta.data || []).map((plano) => ({ ...plano, recursos: porPlano.get(plano.id) || [] })),
        recursos: recursosConsulta.data || []
      });
    }
    if (acao === "salvar_plano") {
      const planoId = texto(dados.id);
      const nome = texto(dados.nome);
      const periodo = texto(dados.periodo || "mensal");
      const periodosValidos = ["mensal", "trimestral", "semestral", "anual", "vitalicio"];
      const preco = Number(dados.precoReferencia || 0);
      const duracaoRecebida = Number(dados.duracaoDias || { mensal: 30, trimestral: 90, semestral: 180, anual: 365, vitalicio: 36500 }[periodo] || 30);
      const ordemRecebida = Number(dados.ordem ?? 100);
      const duracaoDias = Math.max(1, Math.min(36500, duracaoRecebida));
      const ordem = Math.max(0, Math.min(1e4, ordemRecebida));
      const limites = dados.limites && typeof dados.limites === "object" && !Array.isArray(dados.limites) ? dados.limites : {};
      const recursosSelecionados = Array.isArray(dados.recursos) ? [...new Set(dados.recursos.map((item) => texto(item)).filter(Boolean))] : [];
      if (!nome || !periodosValidos.includes(periodo) || !Number.isFinite(preco) || preco < 0 || !Number.isFinite(duracaoDias) || !Number.isFinite(ordem)) {
        return resposta(400, { erro: "Dados do plano inv\xE1lidos." });
      }
      const registro = {
        nome,
        descricao: texto(dados.descricao) || null,
        ativo: dados.ativo !== false,
        preco_referencia: preco,
        periodo,
        duracao_dias: duracaoDias,
        ordem,
        destaque: dados.destaque === true,
        excluido_em: null,
        limites,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const consulta = planoId ? admin.from("planos").update(registro).eq("id", planoId) : admin.from("planos").insert(registro);
      const { data, error } = await consulta.select("id,nome,descricao,ativo,preco_referencia,periodo,duracao_dias,ordem,destaque,limites").single();
      if (error) throw error;
      const { data: recursosBanco, error: recursosErro } = recursosSelecionados.length ? await admin.from("recursos").select("id,chave").in("chave", recursosSelecionados) : { data: [], error: null };
      if (recursosErro) throw recursosErro;
      const { error: limparErro } = await admin.from("plano_recursos").delete().eq("plano_id", data.id);
      if (limparErro) throw limparErro;
      if (recursosBanco?.length) {
        const { error: vincularErro } = await admin.from("plano_recursos").insert(
          recursosBanco.map((recurso) => ({ plano_id: data.id, recurso_id: recurso.id, habilitado: true }))
        );
        if (vincularErro) throw vincularErro;
      }
      await admin.from("auditoria_comercial").insert({
        autor_id: sessao.user.id,
        acao: planoId ? "plano_atualizado" : "plano_criado",
        entidade: "plano",
        entidade_id: data.id,
        metadados: { nome: data.nome, recursos: recursosSelecionados, limites }
      });
      return resposta(200, { plano: { ...data, recursos: recursosBanco || [] } });
    }
    if (acao === "excluir_plano") {
      const planoId = texto(dados.id);
      if (!planoId) return resposta(400, { erro: "Plano inv\xE1lido." });
      const { data: plano, error: planoErro } = await admin.from("planos").select("id,nome").eq("id", planoId).maybeSingle();
      if (planoErro) throw planoErro;
      if (!plano) return resposta(404, { erro: "Plano n\xE3o encontrado." });
      if (plano.nome.toLowerCase() === "trial") return resposta(409, { erro: "O plano Trial \xE9 necess\xE1rio para novas empresas e n\xE3o pode ser exclu\xEDdo." });
      const { count: empresasVinculadas, error: contarErro } = await admin.from("empresas").select("id", { count: "exact", head: true }).eq("plano_id", planoId).eq("ativo", true);
      if (contarErro) throw contarErro;
      const { error } = await admin.from("planos").update({
        ativo: false,
        excluido_em: (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", planoId);
      if (error) throw error;
      await admin.from("auditoria_comercial").insert({
        autor_id: sessao.user.id,
        acao: "plano_excluido",
        entidade: "plano",
        entidade_id: planoId,
        metadados: { nome: plano.nome, empresas_vinculadas: empresasVinculadas || 0 }
      });
      return resposta(200, {
        sucesso: true,
        mensagem: empresasVinculadas ? "Plano removido das novas contrata\xE7\xF5es. Empresas atuais foram preservadas." : "Plano exclu\xEDdo das novas contrata\xE7\xF5es."
      });
    }
    if (acao === "atualizar_licenca") {
      const empresaId = texto(dados.empresaId);
      const status = texto(dados.status) || null;
      const statusValidos = ["teste", "ativa", "vencendo", "vencida", "periodo_graca", "suspensa", "cancelada", "bloqueada"];
      if (!empresaId || status && !statusValidos.includes(status)) {
        return resposta(400, { erro: "Dados da licen\xE7a inv\xE1lidos." });
      }
      const planoId = texto(dados.planoId);
      const plano = planoId ? await detalhesPlano(admin, planoId) : null;
      if (planoId && !plano) return resposta(404, { erro: "Plano n\xE3o encontrado ou inativo." });
      const limitesPlano = plano?.limites || {};
      const recursosInformados = dados.recursos && typeof dados.recursos === "object" && !Array.isArray(dados.recursos) ? dados.recursos : null;
      const { data, error } = await cliente.rpc("atualizar_licenca_empresa", {
        p_empresa_id: empresaId,
        p_plano_id: planoId || null,
        p_inicio_trial: texto(dados.inicioTrial) || null,
        p_fim_trial: texto(dados.fimTrial) || null,
        p_vencimento: texto(dados.vencimento) || null,
        p_graca_ate: texto(dados.gracaAte) || null,
        p_status: status,
        p_motivo: texto(dados.motivo) || null,
        p_limite_usuarios: numeroInteiro(dados.limiteUsuarios, numeroInteiro(limitesPlano.usuarios)),
        p_limite_dispositivos: numeroInteiro(dados.limiteDispositivos, numeroInteiro(limitesPlano.dispositivos)),
        p_limite_storage: numeroInteiro(dados.limiteStorage, numeroInteiro(limitesPlano.storage_bytes)),
        p_recursos: recursosInformados || plano?.recursos || null
      });
      if (error) throw error;
      return resposta(200, { empresa: data });
    }
    if (acao === "confirmar_pagamento") {
      const empresaId = texto(dados.empresaId);
      const valor = Number(dados.valor);
      const vencimento = texto(dados.vencimento);
      const forma = texto(dados.forma);
      if (!empresaId || !Number.isFinite(valor) || valor < 0 || !vencimento || !forma) {
        return resposta(400, { erro: "Dados do pagamento inv\xE1lidos." });
      }
      const { data, error } = await cliente.rpc("confirmar_pagamento_assinatura", {
        p_empresa_id: empresaId,
        p_plano_id: texto(dados.planoId) || null,
        p_valor: valor,
        p_vencimento: vencimento,
        p_pago_em: texto(dados.pagoEm) || (/* @__PURE__ */ new Date()).toISOString(),
        p_forma: forma,
        p_referencia: texto(dados.referencia) || null,
        p_observacao: texto(dados.observacao) || null
      });
      if (error) throw error;
      return resposta(200, { pagamentoId: data });
    }
    if (acao === "listar_usuarios_empresa") {
      const empresaId = contextoAtual.administrador_global ? texto(dados.empresaId) : texto(contextoAtual.empresa_id);
      if (!empresaId) return resposta(400, { erro: "Empresa inv\xE1lida." });
      const empresaSuporte = contextoAtual.administrador_global === true && empresaId === texto(contextoAtual.empresa_id);
      const { data: perfis, error } = await admin.from("perfis").select("id,nome,cargo,ativo,ultimo_acesso_em").eq("empresa_id", empresaId).order("nome", { ascending: true });
      if (error) throw error;
      const { data: identidades, error: identidadeErro } = await admin.from("identidades_login").select("usuario,usuario_id").eq("empresa_id", empresaId);
      if (identidadeErro) throw identidadeErro;
      const usuarioPorId = new Map((identidades || []).map((identidade) => [identidade.usuario_id, identidade.usuario]));
      const idsUsuarios = (perfis || []).map((perfil) => perfil.id);
      const { data: papeis, error: papeisErro } = empresaSuporte && idsUsuarios.length ? await admin.from("administradores_globais").select("usuario_id,papel,ativo").in("usuario_id", idsUsuarios) : { data: [], error: null };
      if (papeisErro) throw papeisErro;
      const papelPorUsuario = new Map((papeis || []).map((item) => [item.usuario_id, item]));
      const usuarios = (perfis || []).map((perfil) => ({
        id: perfil.id,
        nome: perfil.nome,
        cargo: empresaSuporte ? cargoPerfilSuporte(texto(papelPorUsuario.get(perfil.id)?.papel) || normalizarPapelSuporte(perfil.cargo) || "suporte") : perfil.cargo,
        papelSuporte: empresaSuporte ? texto(papelPorUsuario.get(perfil.id)?.papel) || normalizarPapelSuporte(perfil.cargo) || "suporte" : "",
        ativo: perfil.ativo,
        ultimoAcessoEm: perfil.ultimo_acesso_em,
        usuario: usuarioPorId.get(perfil.id) || ""
      }));
      return resposta(200, { usuarios, empresaSuporte });
    }
    if (acao === "criar_usuario_empresa") {
      const empresaId = contextoAtual.administrador_global ? texto(dados.empresaId) : texto(contextoAtual.empresa_id);
      const usuario = texto(dados.usuario).toLowerCase();
      const senha = String(dados.senha || "");
      const nome = texto(dados.nome) || usuario;
      let cargo = texto(dados.cargo) || "Atendente";
      if (!empresaId || !/^[a-z0-9._-]{3,30}$/.test(usuario) || senha.length < 8) {
        return resposta(400, { erro: "Dados do novo usu\xE1rio inv\xE1lidos." });
      }
      const { data: empresa, error: empresaErro } = await admin.from("empresas").select("id,codigo,limite_usuarios").eq("id", empresaId).single();
      if (empresaErro || !empresa) return resposta(404, { erro: "Empresa n\xE3o encontrada." });
      const empresaSuporte = contextoAtual.administrador_global === true && empresaId === texto(contextoAtual.empresa_id);
      const papelSuporteNovo = empresaSuporte ? normalizarPapelSuporte(dados.papelSuporte || cargo) : "";
      if (empresaSuporte && !PAPEIS_SUPORTE.includes(papelSuporteNovo)) {
        return resposta(400, { erro: "Selecione um cargo v\xE1lido da equipe de suporte." });
      }
      if (empresaSuporte && papelSuporteNovo === "administrador_geral" && papelSuporte !== "administrador_geral") {
        return resposta(403, { erro: "Somente o Administrador Geral pode criar outro Administrador Geral." });
      }
      if (empresaSuporte) cargo = cargoPerfilSuporte(papelSuporteNovo);
      if (empresa.limite_usuarios) {
        const { count, error: contagemErro } = await admin.from("perfis").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("ativo", true);
        if (contagemErro) throw contagemErro;
        if ((count || 0) >= empresa.limite_usuarios) {
          return resposta(409, { erro: `O plano permite no m\xE1ximo ${empresa.limite_usuarios} usu\xE1rio(s) ativo(s). Desative um acesso ou altere o plano.` });
        }
      }
      const { data: existente } = await admin.from("identidades_login").select("usuario_id").eq("empresa_id", empresaId).eq("usuario", usuario).maybeSingle();
      if (existente) return resposta(409, { erro: "J\xE1 existe um usu\xE1rio com esse login nesta empresa." });
      const emailTecnico = usuario + "." + empresa.codigo + "@accounts.sistemaos.app";
      const { data: authCriado, error: authErro } = await admin.auth.admin.createUser({
        email: emailTecnico,
        password: senha,
        email_confirm: true,
        user_metadata: { usuario, empresa_codigo: empresa.codigo }
      });
      if (authErro || !authCriado.user) return resposta(400, { erro: "N\xE3o foi poss\xEDvel criar o usu\xE1rio." });
      const permissoes = permissoesParaCargo(cargo);
      const resultado = await Promise.all([
        admin.from("perfis").insert({ id: authCriado.user.id, empresa_id: empresaId, nome, cargo, permissoes, ativo: true }),
        admin.from("identidades_login").insert({ empresa_id: empresaId, usuario_id: authCriado.user.id, usuario, email_tecnico: emailTecnico })
      ]);
      const falha = resultado.find((item) => item.error);
      if (falha?.error) {
        await admin.from("perfis").delete().eq("id", authCriado.user.id);
        await admin.auth.admin.deleteUser(authCriado.user.id);
        throw falha.error;
      }
      if (empresaSuporte) {
        const { error: suporteCadastroErro } = await admin.from("administradores_globais").upsert({
          usuario_id: authCriado.user.id,
          nome,
          papel: papelSuporteNovo,
          ativo: true,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }, { onConflict: "usuario_id" });
        if (suporteCadastroErro) {
          await admin.from("identidades_login").delete().eq("usuario_id", authCriado.user.id);
          await admin.from("perfis").delete().eq("id", authCriado.user.id);
          await admin.auth.admin.deleteUser(authCriado.user.id);
          throw suporteCadastroErro;
        }
      }
      await admin.from("auditoria_comercial").insert({
        empresa_id: empresaId,
        autor_id: sessao.user.id,
        acao: "usuario_criado_suporte",
        entidade: "usuario",
        entidade_id: authCriado.user.id,
        metadados: { usuario, cargo }
      });
      return resposta(201, { usuario: { id: authCriado.user.id, usuario, nome, cargo, papelSuporte: papelSuporteNovo, ativo: true } });
    }
    if (acao === "atualizar_usuario_empresa") {
      const empresaId = contextoAtual.administrador_global ? texto(dados.empresaId) : texto(contextoAtual.empresa_id);
      const usuarioId = texto(dados.usuarioId);
      const usuario = texto(dados.usuario).toLowerCase();
      const nome = texto(dados.nome);
      let cargo = texto(dados.cargo) || "Atendente";
      const ativo = dados.ativo !== false;
      if (!empresaId || !usuarioId || !nome || !/^[a-z0-9._-]{3,30}$/.test(usuario)) {
        return resposta(400, { erro: "Dados do usu\xE1rio inv\xE1lidos." });
      }
      if (!contextoAtual.administrador_global && usuarioId === sessao.user.id && (!ativo || !["administrador", "proprietario", "propriet\xE1rio"].includes(cargo.toLowerCase()))) {
        return resposta(409, { erro: "Voc\xEA n\xE3o pode remover seu pr\xF3prio acesso de Administrador. Promova outro administrador primeiro." });
      }
      const [{ data: empresa, error: empresaErro }, { data: perfil, error: perfilErro }, { data: identidade, error: identidadeErro }] = await Promise.all([
        admin.from("empresas").select("id,codigo").eq("id", empresaId).single(),
        admin.from("perfis").select("id,nome,cargo,ativo,permissoes").eq("empresa_id", empresaId).eq("id", usuarioId).single(),
        admin.from("identidades_login").select("id,usuario,email_tecnico").eq("empresa_id", empresaId).eq("usuario_id", usuarioId).single()
      ]);
      if (empresaErro || !empresa || perfilErro || !perfil || identidadeErro || !identidade) {
        return resposta(404, { erro: "Usu\xE1rio n\xE3o encontrado nesta empresa." });
      }
      const empresaSuporte = contextoAtual.administrador_global === true && empresaId === texto(contextoAtual.empresa_id);
      const papelSuporteNovo = empresaSuporte ? normalizarPapelSuporte(dados.papelSuporte || cargo) : "";
      if (empresaSuporte && !PAPEIS_SUPORTE.includes(papelSuporteNovo)) {
        return resposta(400, { erro: "Selecione um cargo v\xE1lido da equipe de suporte." });
      }
      if (empresaSuporte && papelSuporteNovo === "administrador_geral" && papelSuporte !== "administrador_geral") {
        return resposta(403, { erro: "Somente o Administrador Geral pode promover algu\xE9m a Administrador Geral." });
      }
      if (empresaSuporte && usuarioId === sessao.user.id && (!ativo || papelSuporteNovo !== "administrador_geral")) {
        const { count } = await admin.from("administradores_globais").select("usuario_id", { count: "exact", head: true }).eq("ativo", true).eq("papel", "administrador_geral").neq("usuario_id", usuarioId);
        if ((count || 0) < 1) return resposta(409, { erro: "Crie outro Administrador Geral antes de reduzir ou bloquear seu pr\xF3prio acesso." });
      }
      if (empresaSuporte) cargo = cargoPerfilSuporte(papelSuporteNovo);
      if (ativo && !perfil.ativo) {
        const { data: empresaLimite, error: limiteErro } = await admin.from("empresas").select("limite_usuarios").eq("id", empresaId).single();
        if (limiteErro) throw limiteErro;
        if (empresaLimite?.limite_usuarios) {
          const { count, error: contagemErro } = await admin.from("perfis").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("ativo", true);
          if (contagemErro) throw contagemErro;
          if ((count || 0) >= empresaLimite.limite_usuarios) {
            return resposta(409, { erro: `O plano permite no m\xE1ximo ${empresaLimite.limite_usuarios} usu\xE1rio(s) ativo(s).` });
          }
        }
      }
      const { data: loginEmUso } = await admin.from("identidades_login").select("usuario_id").eq("empresa_id", empresaId).eq("usuario", usuario).neq("usuario_id", usuarioId).maybeSingle();
      if (loginEmUso) return resposta(409, { erro: "Este login j\xE1 est\xE1 em uso nesta empresa." });
      const novoEmail = usuario + "." + empresa.codigo + "@accounts.sistemaos.app";
      const loginMudou = identidade.usuario !== usuario || identidade.email_tecnico !== novoEmail;
      if (loginMudou) {
        const { data: authAtual } = await admin.auth.admin.getUserById(usuarioId);
        const { error: authErro } = await admin.auth.admin.updateUserById(usuarioId, {
          email: novoEmail,
          user_metadata: { ...authAtual.user?.user_metadata || {}, usuario, empresa_codigo: empresa.codigo }
        });
        if (authErro) return resposta(400, { erro: "N\xE3o foi poss\xEDvel alterar o login deste usu\xE1rio." });
      }
      const { error: identidadeAtualizacaoErro } = await admin.from("identidades_login").update({ usuario, email_tecnico: novoEmail, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", identidade.id);
      if (identidadeAtualizacaoErro) {
        if (loginMudou) await admin.auth.admin.updateUserById(usuarioId, { email: identidade.email_tecnico });
        throw identidadeAtualizacaoErro;
      }
      const { error: perfilAtualizacaoErro } = await admin.from("perfis").update({ nome, cargo, ativo, permissoes: permissoesParaCargo(cargo), updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("empresa_id", empresaId).eq("id", usuarioId);
      if (perfilAtualizacaoErro) {
        await admin.from("identidades_login").update({ usuario: identidade.usuario, email_tecnico: identidade.email_tecnico }).eq("id", identidade.id);
        if (loginMudou) await admin.auth.admin.updateUserById(usuarioId, { email: identidade.email_tecnico });
        throw perfilAtualizacaoErro;
      }
      if (empresaSuporte) {
        const { error: papelErro } = await admin.from("administradores_globais").upsert({
          usuario_id: usuarioId,
          nome,
          papel: papelSuporteNovo,
          ativo,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }, { onConflict: "usuario_id" });
        if (papelErro) {
          await admin.from("perfis").update({
            nome: perfil.nome,
            cargo: perfil.cargo,
            ativo: perfil.ativo,
            permissoes: perfil.permissoes,
            updated_at: (/* @__PURE__ */ new Date()).toISOString()
          }).eq("empresa_id", empresaId).eq("id", usuarioId);
          await admin.from("identidades_login").update({
            usuario: identidade.usuario,
            email_tecnico: identidade.email_tecnico,
            updated_at: (/* @__PURE__ */ new Date()).toISOString()
          }).eq("id", identidade.id);
          if (loginMudou) await admin.auth.admin.updateUserById(usuarioId, { email: identidade.email_tecnico });
          throw papelErro;
        }
      }
      await admin.from("auditoria_comercial").insert({
        empresa_id: empresaId,
        autor_id: sessao.user.id,
        acao: "usuario_atualizado_suporte",
        entidade: "usuario",
        entidade_id: usuarioId,
        metadados: { usuarioAnterior: identidade.usuario, usuario, cargoAnterior: perfil.cargo, cargo, ativoAnterior: perfil.ativo, ativo }
      });
      return resposta(200, { usuario: { id: usuarioId, usuario, nome, cargo, papelSuporte: papelSuporteNovo, ativo } });
    }
    if (acao === "listar_equipe_suporte") {
      const { data: equipe, error } = await admin.from("administradores_globais").select("usuario_id,nome,papel,ativo,created_at,updated_at").order("nome", { ascending: true });
      if (error) throw error;
      const ids = (equipe || []).map((item) => item.usuario_id);
      const { data: identidades, error: identidadesErro } = ids.length ? await admin.from("identidades_login").select("usuario_id,usuario,empresa_id").in("usuario_id", ids) : { data: [], error: null };
      if (identidadesErro) throw identidadesErro;
      const identidadePorId = new Map((identidades || []).map((item) => [item.usuario_id, item]));
      return resposta(200, {
        equipe: (equipe || []).map((item) => ({
          ...item,
          usuario: identidadePorId.get(item.usuario_id)?.usuario || "",
          empresa_id: identidadePorId.get(item.usuario_id)?.empresa_id || null,
          atual: item.usuario_id === sessao.user.id
        }))
      });
    }
    if (acao === "definir_papel_suporte") {
      const usuarioId = texto(dados.usuarioId);
      const papel = texto(dados.papel);
      if (!usuarioId || !["suporte", "gerente_suporte", "administrador_geral"].includes(papel)) {
        return resposta(400, { erro: "Usu\xE1rio ou cargo de suporte inv\xE1lido." });
      }
      const { data: identidade, error: identidadeErro } = await admin.from("identidades_login").select("usuario_id,usuario,empresa_id").eq("usuario_id", usuarioId).maybeSingle();
      if (identidadeErro) throw identidadeErro;
      if (!identidade || identidade.empresa_id !== contextoAtual.empresa_id) {
        return resposta(403, { erro: "Somente usu\xE1rios da empresa suporte podem receber cargos da equipe central." });
      }
      if (usuarioId === sessao.user.id && papel !== "administrador_geral") {
        const { count } = await admin.from("administradores_globais").select("usuario_id", { count: "exact", head: true }).eq("ativo", true).eq("papel", "administrador_geral");
        if ((count || 0) <= 1) return resposta(409, { erro: "Crie outro Administrador Geral antes de alterar seu pr\xF3prio cargo." });
      }
      const { data: perfil } = await admin.from("perfis").select("nome").eq("id", usuarioId).maybeSingle();
      const { error: salvarErro } = await admin.from("administradores_globais").upsert({
        usuario_id: usuarioId,
        nome: perfil?.nome || identidade.usuario || "Suporte",
        papel,
        ativo: true,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }, { onConflict: "usuario_id" });
      if (salvarErro) throw salvarErro;
      await admin.from("auditoria_comercial").insert({
        autor_id: sessao.user.id,
        acao: "papel_suporte_alterado",
        entidade: "usuario",
        entidade_id: usuarioId,
        metadados: { papel }
      });
      return resposta(200, { sucesso: true, papel });
    }
    if (acao === "excluir_usuario_empresa") {
      const empresaId = contextoAtual.administrador_global ? texto(dados.empresaId) : texto(contextoAtual.empresa_id);
      const usuarioId = texto(dados.usuarioId);
      if (!empresaId || !usuarioId) return resposta(400, { erro: "Empresa ou usu\xE1rio inv\xE1lido." });
      if (usuarioId === sessao.user.id) {
        return resposta(409, { erro: "Voc\xEA n\xE3o pode excluir sua pr\xF3pria conta." });
      }
      const { data: perfil, error: perfilErro } = await admin.from("perfis").select("id,nome,cargo,ativo").eq("empresa_id", empresaId).eq("id", usuarioId).maybeSingle();
      if (perfilErro) throw perfilErro;
      if (!perfil) return resposta(404, { erro: "Usu\xE1rio n\xE3o encontrado nesta empresa." });
      const cargoAlvo = texto(perfil.cargo).toLowerCase();
      if (["administrador", "proprietario", "propriet\xE1rio"].includes(cargoAlvo)) {
        const { data: administradores, error: administradoresErro } = await admin.from("perfis").select("id,cargo,ativo").eq("empresa_id", empresaId).eq("ativo", true);
        if (administradoresErro) throw administradoresErro;
        const outrosAdministradores = (administradores || []).filter(
          (item) => item.id !== usuarioId && ["administrador", "proprietario", "propriet\xE1rio"].includes(texto(item.cargo).toLowerCase())
        );
        if (!outrosAdministradores.length) {
          return resposta(409, { erro: "Promova outro administrador ativo antes de excluir este usu\xE1rio." });
        }
      }
      const { data: identidade } = await admin.from("identidades_login").select("usuario").eq("empresa_id", empresaId).eq("usuario_id", usuarioId).maybeSingle();
      const { error: excluirErro } = await admin.auth.admin.deleteUser(usuarioId);
      if (excluirErro) {
        const mensagem = texto(excluirErro.message).toLowerCase();
        const usuarioJaAusente = /user.*not.*found|not.*found|already.*deleted/.test(mensagem);
        if (!usuarioJaAusente) throw excluirErro;
        const { error: identidadeExcluirErro } = await admin.from("identidades_login").delete().eq("empresa_id", empresaId).eq("usuario_id", usuarioId);
        if (identidadeExcluirErro) throw identidadeExcluirErro;
        const { error: perfilExcluirErro } = await admin.from("perfis").delete().eq("empresa_id", empresaId).eq("id", usuarioId);
        if (perfilExcluirErro) throw perfilExcluirErro;
      }
      const { error: auditoriaErro } = await admin.from("auditoria_comercial").insert({
        empresa_id: empresaId,
        autor_id: sessao.user.id,
        acao: "usuario_excluido_definitivamente",
        entidade: "usuario",
        entidade_id: usuarioId,
        metadados: {
          usuario: identidade?.usuario || "",
          nome: perfil.nome,
          cargo: perfil.cargo
        }
      });
      if (auditoriaErro) console.error("Falha ao auditar exclus\xE3o de usu\xE1rio:", auditoriaErro.message);
      return resposta(200, {
        sucesso: true,
        usuarioId,
        aviso: auditoriaErro ? "Usu\xE1rio removido; auditoria pendente." : ""
      });
    }
    if (acao === "configurar_troca_rapida_empresa") {
      const empresaId = texto(dados.empresaId);
      if (!empresaId) return resposta(400, { erro: "Empresa inv\xE1lida." });
      const { data: empresa, error } = await admin.from("empresas").select("id,recursos_habilitados").eq("id", empresaId).maybeSingle();
      if (error) throw error;
      if (!empresa) return resposta(404, { erro: "Empresa n\xE3o encontrada." });
      const recursos = { ...empresa.recursos_habilitados || {}, troca_rapida_contas: dados.ativa === true };
      const { error: atualizarErro } = await admin.from("empresas").update({ recursos_habilitados: recursos, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", empresaId);
      if (atualizarErro) throw atualizarErro;
      await admin.from("auditoria_comercial").insert({
        empresa_id: empresaId,
        autor_id: sessao.user.id,
        acao: "troca_rapida_contas_configurada_suporte",
        entidade: "empresa",
        entidade_id: empresaId,
        metadados: { ativa: dados.ativa === true }
      });
      return resposta(200, { sucesso: true, ativa: dados.ativa === true });
    }
    if (acao === "configurar_fiscal_empresa") {
      const empresaId = texto(dados.empresaId);
      if (!empresaId) return resposta(400, { erro: "Empresa inv\xE1lida." });
      const { data: empresa, error } = await admin.from("empresas").select("id,recursos_habilitados").eq("id", empresaId).maybeSingle();
      if (error) throw error;
      if (!empresa) return resposta(404, { erro: "Empresa n\xE3o encontrada." });
      const ativa = dados.ativa === true;
      const recursos = { ...empresa.recursos_habilitados || {}, fiscal_habilitado: ativa };
      const { error: atualizarErro } = await admin.from("empresas").update({ recursos_habilitados: recursos, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", empresaId);
      if (atualizarErro) throw atualizarErro;
      await admin.from("auditoria_comercial").insert({
        empresa_id: empresaId,
        autor_id: sessao.user.id,
        acao: "recurso_fiscal_configurado_suporte",
        entidade: "empresa",
        entidade_id: empresaId,
        metadados: { ativa }
      });
      return resposta(200, { sucesso: true, ativa });
    }
    if (acao === "solicitar_exclusao") {
      const tipo = texto(dados.tipo);
      const empresaId = texto(dados.empresaId);
      const alvoId = texto(dados.alvoId) || null;
      const alvoRotulo = texto(dados.alvoRotulo);
      const motivo = texto(dados.motivo);
      if (!empresaId || !["usuario", "empresa"].includes(tipo) || !alvoRotulo || motivo.length < 5) {
        return resposta(400, { erro: "Informe o item e um motivo com pelo menos 5 caracteres." });
      }
      if (tipo === "usuario" && !alvoId) return resposta(400, { erro: "Usu\xE1rio inv\xE1lido." });
      const { data, error } = await cliente.rpc("criar_solicitacao_exclusao", {
        p_tipo: tipo,
        p_empresa_id: empresaId,
        p_alvo_id: alvoId,
        p_alvo_rotulo: alvoRotulo,
        p_motivo: motivo
      });
      if (error) throw error;
      return resposta(201, { sucesso: true, solicitacao: data });
    }
    if (acao === "listar_solicitacoes_exclusao") {
      const limiteRetencao = new Date(Date.now() - 3 * 864e5).toISOString();
      await admin.from("solicitacoes_exclusao").delete().in("status", ["negada", "executada"]).lt("atualizada_em", limiteRetencao);
      const { data, error } = await admin.from("solicitacoes_exclusao").select("id,tipo,empresa_id,empresa_codigo,alvo_id,alvo_rotulo,motivo,status,decisao_observacao,criada_em,decidida_em,executada_em,erro_execucao").order("criada_em", { ascending: false }).limit(200);
      if (error) throw error;
      return resposta(200, { solicitacoes: data || [], papelSuporte });
    }
    if (acao === "listar_erros_usuarios") {
      const { data, error } = await admin.from("relatorios_erros").select("id,empresa_id,usuario_id,origem,tela,funcao,mensagem,stack_trace,versao,dispositivo,detalhes,prioridade,status,criado_em,atualizado_em,empresa:empresas(codigo,nome_fantasia)").order("criado_em", { ascending: false }).limit(300);
      if (error) throw error;
      return resposta(200, { erros: data || [] });
    }
    if (acao === "atualizar_erro_usuario") {
      const erroId = texto(dados.erroId);
      const statusErro = texto(dados.status);
      if (!erroId || !["aberto", "analisando", "resolvido", "ignorado"].includes(statusErro)) {
        return resposta(400, { erro: "Relat\xF3rio ou status inv\xE1lido." });
      }
      const { data, error } = await admin.from("relatorios_erros").update({ status: statusErro, atualizado_em: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", erroId).select("id,status,atualizado_em").single();
      if (error) throw error;
      await admin.from("auditoria_comercial").insert({
        autor_id: sessao.user.id,
        acao: "erro_usuario_atualizado",
        entidade: "relatorio_erro",
        entidade_id: erroId,
        metadados: { status: statusErro }
      });
      return resposta(200, { erroUsuario: data });
    }
    if (acao === "definir_senha_exclusao") {
      const senha = String(dados.senha || "");
      const { error } = await cliente.rpc("definir_senha_exclusao_suporte", { p_senha: senha });
      if (error) throw error;
      return resposta(200, { sucesso: true });
    }
    if (acao === "decidir_exclusao") {
      const solicitacaoId = texto(dados.solicitacaoId);
      const aprovar = dados.aprovar === true;
      const senha = String(dados.senha || "");
      if (!solicitacaoId || !senha) return resposta(400, { erro: "Solicita\xE7\xE3o ou senha inv\xE1lida." });
      const { data: decisao, error: decisaoErro } = await cliente.rpc("decidir_solicitacao_exclusao", {
        p_solicitacao_id: solicitacaoId,
        p_aprovar: aprovar,
        p_senha: senha,
        p_observacao: texto(dados.observacao) || null
      });
      if (decisaoErro) throw decisaoErro;
      if (!aprovar) return resposta(200, { sucesso: true, solicitacao: decisao });
      try {
        if (decisao.tipo === "usuario") {
          const usuarioId = texto(decisao.alvo_id);
          const empresaId = texto(decisao.empresa_id);
          const [{ data: perfil }, { count: totalUsuarios }] = await Promise.all([
            admin.from("perfis").select("id,cargo").eq("empresa_id", empresaId).eq("id", usuarioId).maybeSingle(),
            admin.from("perfis").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId)
          ]);
          if (!perfil) throw new Error("O usu\xE1rio solicitado n\xE3o existe mais nesta empresa.");
          if ((totalUsuarios || 0) <= 1) throw new Error("N\xE3o \xE9 poss\xEDvel excluir o \xFAnico usu\xE1rio da empresa.");
          if (String(perfil.cargo || "").toLowerCase().includes("admin")) {
            const { data: outros } = await admin.from("perfis").select("id,cargo,ativo").eq("empresa_id", empresaId).eq("ativo", true).neq("id", usuarioId);
            if (!(outros || []).some((item) => String(item.cargo || "").toLowerCase().includes("admin"))) {
              throw new Error("Promova outro administrador ativo antes de excluir este usu\xE1rio.");
            }
          }
          const { error: excluirErro } = await admin.auth.admin.deleteUser(usuarioId);
          if (excluirErro) throw excluirErro;
        } else if (decisao.tipo === "empresa") {
          const empresaId = texto(decisao.empresa_id);
          await removerObjetosEmpresa(admin, empresaId);
          const { data: resultado, error: excluirErro } = await cliente.rpc("excluir_empresa_definitivamente", {
            p_empresa_id: empresaId,
            p_codigo_confirmacao: decisao.empresa_codigo,
            p_motivo: decisao.motivo
          });
          if (excluirErro) throw excluirErro;
          for (const usuarioId of resultado?.usuariosAuth || []) {
            const { error: authErro } = await admin.auth.admin.deleteUser(String(usuarioId));
            if (authErro && !/not found/i.test(authErro.message || "")) throw authErro;
          }
        }
        await admin.from("solicitacoes_exclusao").update({
          status: "executada",
          executada_em: (/* @__PURE__ */ new Date()).toISOString(),
          atualizada_em: (/* @__PURE__ */ new Date()).toISOString(),
          erro_execucao: null
        }).eq("id", solicitacaoId);
        return resposta(200, { sucesso: true, executada: true });
      } catch (execucaoErro) {
        const erroExecucao = mensagemSegura(execucaoErro);
        await admin.from("solicitacoes_exclusao").update({
          status: "falhou",
          erro_execucao: erroExecucao,
          atualizada_em: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", solicitacaoId);
        return resposta(409, { erro: "A solicita\xE7\xE3o foi aprovada, mas a exclus\xE3o n\xE3o p\xF4de ser conclu\xEDda: " + erroExecucao });
      }
    }
    if (acao === "listar_empresas") {
      const { data, error } = await admin.from("empresas").select("id,codigo,nome_fantasia,telefone_principal,empresa_sem_telefone,contato_cobranca_whatsapp,avisos_cobranca_ativos,ativo,licenca_status,plano_id,inicio_trial,fim_trial,data_vencimento,periodo_graca_ate,ultimo_pagamento_em,proximo_vencimento_em,limite_usuarios,limite_dispositivos,limite_storage,recursos_habilitados,plano:planos(nome)").order("created_at", { ascending: false });
      if (error) throw error;
      const { data: perfisAtivos, error: perfisErro } = await admin.from("perfis").select("empresa_id").eq("ativo", true);
      if (perfisErro) throw perfisErro;
      const contagem = /* @__PURE__ */ new Map();
      (perfisAtivos || []).forEach((perfil) => {
        if (perfil.empresa_id) contagem.set(perfil.empresa_id, (contagem.get(perfil.empresa_id) || 0) + 1);
      });
      return resposta(200, {
        empresas: (data || []).map((empresa) => ({
          ...empresa,
          usuarios_ativos: contagem.get(empresa.id) || 0
        }))
      });
    }
    if (acao === "obter_integracao_ia_empresa" || acao === "configurar_integracao_ia_empresa" || acao === "desconectar_integracao_ia_empresa") {
      const empresaId = texto(dados.empresaId);
      if (!empresaId) return resposta(400, { erro: "Empresa inv\xE1lida." });
      const { data: empresa, error: empresaErro } = await admin.from("empresas").select("id,nome_fantasia,codigo").eq("id", empresaId).maybeSingle();
      if (empresaErro) throw empresaErro;
      if (!empresa) return resposta(404, { erro: "Empresa n\xE3o encontrada." });
      const buscar = async () => {
        const { data, error } = await admin.from("integracoes_empresa").select("id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados").eq("empresa_id", empresaId).eq("tipo", "ia").maybeSingle();
        if (error) throw error;
        return data;
      };
      const carregarSegredo = async (integracaoId) => {
        const { data, error } = await admin.from("integracoes_segredos").select("iv_base64,segredo_cifrado_base64").eq("integracao_id", integracaoId).maybeSingle();
        if (error) throw error;
        return data ? decifrarChaveIA(data.iv_base64, data.segredo_cifrado_base64) : "";
      };
      const existente = await buscar();
      if (acao === "obter_integracao_ia_empresa") {
        return resposta(200, { empresa, integracao: existente, possui_chave: existente ? Boolean(await carregarSegredo(existente.id)) : false });
      }
      if (acao === "desconectar_integracao_ia_empresa") {
        if (existente) {
          await admin.from("integracoes_segredos").delete().eq("integracao_id", existente.id);
          await admin.from("integracoes_empresa").update({ status: "desconectada", conta_mascarada: null, metadados: {}, conectado_em: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", existente.id);
        }
        await admin.from("auditoria_comercial").insert({ empresa_id: empresaId, autor_id: sessao.user.id, acao: "integracao_ia_desconectada_suporte", entidade: "integracoes_empresa", entidade_id: existente?.id || null });
        return resposta(200, { sucesso: true, mensagem: "Assistente de IA desconectado da empresa." });
      }
      const { provedor, modelo } = validarIAEmpresa(dados.provedor, dados.modelo);
      const chaveNova = texto(dados.apiKey);
      const apiKey = chaveNova || (existente ? await carregarSegredo(existente.id) : "");
      if (!apiKey) return resposta(400, { erro: "Informe a chave da API do provedor escolhido." });
      await testarChaveIAEmpresa(provedor, modelo, apiKey);
      const agora = (/* @__PURE__ */ new Date()).toISOString();
      const { data: integracao, error: integracaoErro } = await admin.from("integracoes_empresa").upsert({
        empresa_id: empresaId,
        tipo: "ia",
        status: "conectada",
        conta_mascarada: `${provedor} \xB7 ${modelo}`,
        conectado_em: existente?.conectado_em || agora,
        ultima_verificacao_em: agora,
        ultimo_erro: null,
        metadados: { provedor, modelo, configurado_pelo_suporte: true },
        updated_at: agora
      }, { onConflict: "empresa_id,tipo" }).select("id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados").single();
      if (integracaoErro) throw integracaoErro;
      if (chaveNova || !existente) {
        const segredo = await cifrarChaveIA(apiKey);
        const { error: segredoErro } = await admin.from("integracoes_segredos").upsert({ integracao_id: integracao.id, iv_base64: segredo.iv, segredo_cifrado_base64: segredo.cifra, atualizado_em: agora });
        if (segredoErro) throw segredoErro;
      }
      await admin.from("auditoria_comercial").insert({ empresa_id: empresaId, autor_id: sessao.user.id, acao: "integracao_ia_configurada_suporte", entidade: "integracoes_empresa", entidade_id: integracao.id, metadados: { provedor, modelo } });
      return resposta(200, { empresa, integracao, possui_chave: true, mensagem: "Assistente de IA configurado para a empresa." });
    }
    return resposta(400, { erro: "Opera\xE7\xE3o inv\xE1lida." });
  } catch (erro) {
    console.error("[admin-global]", erro instanceof Error ? erro.message : String(erro));
    return resposta(500, { erro: mensagemSegura(erro) });
  }
});
