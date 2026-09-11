// supabase/functions/assinaturas-remotas/index.ts
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
function temPermissao(contexto, modulo, acao) {
  if (!contexto || contexto.administrador_global === true) return false;
  if (ehAdministradorEmpresa(contexto)) return true;
  const permissoes = contexto.permissoes && typeof contexto.permissoes === "object" ? contexto.permissoes : {};
  if (permissoes?.["*"]?.["*"] === true) return true;
  const permissaoModulo = permissoes?.[modulo];
  return permissaoModulo === true || !!(permissaoModulo && typeof permissaoModulo === "object" && permissaoModulo[acao] === true);
}
function contextoUsuarioAtivo(contexto) {
  if (!contexto || contexto.usuario_ativo !== true) return false;
  return contexto.administrador_global === true || contexto.empresa_ativa === true;
}
function licencaPermiteOperacao(contexto) {
  return !!contexto && contexto.administrador_global !== true && STATUS_LICENCA_OPERACIONAL.has(textoNormalizado(contexto.licenca_status));
}
function tiposDocumentoPermitidos(contexto, acao) {
  return Object.entries(MODULO_DOCUMENTO).filter(([, modulo]) => temPermissao(contexto, modulo, acao)).map(([tipo]) => tipo);
}
function podeAcessarTipoDocumento(contexto, tipoDocumento, acao) {
  const modulo = MODULO_DOCUMENTO[String(tipoDocumento || "")];
  return !!modulo && temPermissao(contexto, modulo, acao);
}

// supabase/functions/assinaturas-remotas/index.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json; charset=utf-8"
};
function resposta(status, corpo) {
  return new Response(JSON.stringify(corpo), { status, headers: cors });
}
function primeiro(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}
function pacoteValido(pacote) {
  const tipo = String(pacote?.tipoDocumento || "");
  const idEnvio = String(pacote?.idEnvioAssinatura || "").trim();
  return pacote && typeof pacote === "object" && pacote.tipoArquivo === "sistema-os-pc-para-assinar" && ["os", "compra", "venda", "entrega", "desbloqueio"].includes(tipo) && idEnvio.length > 0 && idEnvio.length <= 200 && pacote.dados && typeof pacote.dados === "object" && tamanhoJson(pacote) <= 8e6;
}
function tamanhoJson(valor) {
  try {
    return new TextEncoder().encode(JSON.stringify(valor)).byteLength;
  } catch (_) {
    return Number.POSITIVE_INFINITY;
  }
}
function respostaAssinaturaValida(respostaRecebida, tipo, idEnvio) {
  if (!respostaRecebida || typeof respostaRecebida !== "object" || respostaRecebida.tipoArquivo !== "sistema-os-pc-para-assinar-resposta" || String(respostaRecebida.tipoDocumento || "") !== tipo || String(respostaRecebida.idEnvioAssinatura || "").trim() !== idEnvio || respostaRecebida.assinaturaPendente === true || tamanhoJson(respostaRecebida) > 8e6) return false;
  const campo = tipo === "compra" ? "assinaturaVendedorBase64" : tipo === "venda" ? "assinaturaCompradorBase64" : tipo === "entrega" ? "assinaturaRetirouBase64" : "assinaturaClienteBase64";
  const assinatura = String(respostaRecebida[campo] || "");
  if (respostaRecebida.naoAssinado === true) return assinatura.length === 0;
  return /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(assinatura) && assinatura.length <= 6e6;
}
function jsonCanonico(valor) {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor) ?? "null";
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  return `{${Object.keys(valor).sort().map((chave) => `${JSON.stringify(chave)}:${jsonCanonico(valor[chave])}`).join(",")}}`;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return resposta(401, { erro: "Sess\xE3o inv\xE1lida." });
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const cliente = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: usuario, error: usuarioErro } = await cliente.auth.getUser();
    if (usuarioErro || !usuario.user) return resposta(401, { erro: "Sess\xE3o inv\xE1lida." });
    const { data: contexto, error: contextoErro } = await cliente.rpc("obter_contexto_comercial");
    const atual = primeiro(contexto);
    if (contextoErro || !atual?.empresa_id || atual?.administrador_global === true || !contextoUsuarioAtivo(atual) || !licencaPermiteOperacao(atual)) {
      return resposta(403, { erro: "Entre em uma empresa para usar assinatura remota." });
    }
    const corpo = await req.json();
    const acao = String(corpo?.acao || "");
    const dados = corpo?.dados || {};
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    if (acao === "enviar") {
      const pacote = dados.pacote;
      if (!pacoteValido(pacote)) return resposta(400, { erro: "Documento de assinatura inv\xE1lido." });
      if (!podeAcessarTipoDocumento(atual, pacote.tipoDocumento, "criar") && !podeAcessarTipoDocumento(atual, pacote.tipoDocumento, "editar")) {
        return resposta(403, { erro: "Seu usu\xE1rio n\xE3o pode enviar este tipo de documento." });
      }
      const { data, error } = await admin.from("solicitacoes_assinatura_remota").upsert({
        empresa_id: atual.empresa_id,
        id_envio_assinatura: String(pacote.idEnvioAssinatura),
        tipo_documento: String(pacote.tipoDocumento),
        pacote,
        resposta: null,
        status: "pendente",
        enviado_por: usuario.user.id,
        respondido_por: null,
        respondido_em: null,
        concluido_em: null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }, { onConflict: "empresa_id,id_envio_assinatura" }).select("id,id_envio_assinatura,tipo_documento,status,created_at,updated_at").single();
      if (error) throw error;
      return resposta(200, { solicitacao: data, mensagem: "Documento enviado ao celular da empresa." });
    }
    if (acao === "buscar_pendentes") {
      const tipos = tiposDocumentoPermitidos(atual, "ler");
      if (!tipos.length) return resposta(200, { solicitacoes: [] });
      const { data, error } = await admin.from("solicitacoes_assinatura_remota").select("id,id_envio_assinatura,tipo_documento,pacote,created_at,updated_at").eq("empresa_id", atual.empresa_id).eq("status", "pendente").in("tipo_documento", tipos).order("updated_at", { ascending: true }).limit(50);
      if (error) throw error;
      return resposta(200, { solicitacoes: data || [] });
    }
    if (acao === "responder") {
      const idEnvio = String(dados.idEnvioAssinatura || "").trim();
      const respostaAssinada = dados.resposta;
      if (!idEnvio || idEnvio.length > 200 || !respostaAssinada || typeof respostaAssinada !== "object") {
        return resposta(400, { erro: "Resposta de assinatura inv\xE1lida." });
      }
      const tipos = tiposDocumentoPermitidos(atual, "editar");
      if (!tipos.length) return resposta(403, { erro: "Seu usu\xE1rio n\xE3o pode responder documentos." });
      const { data: pendente, error: pendenteErro } = await admin.from("solicitacoes_assinatura_remota").select("id,tipo_documento,status,resposta").eq("empresa_id", atual.empresa_id).eq("id_envio_assinatura", idEnvio).in("tipo_documento", tipos).maybeSingle();
      if (pendenteErro) throw pendenteErro;
      if (!pendente) return resposta(409, { erro: "Esta solicita\xE7\xE3o expirou ou n\xE3o est\xE1 acess\xEDvel." });
      if (!respostaAssinaturaValida(respostaAssinada, pendente.tipo_documento, idEnvio)) {
        return resposta(400, { erro: "A resposta n\xE3o corresponde ao documento enviado." });
      }
      if (["respondida", "concluida"].includes(String(pendente.status))) {
        if (jsonCanonico(pendente.resposta) === jsonCanonico(respostaAssinada)) {
          return resposta(200, {
            solicitacao: { id: pendente.id, status: pendente.status },
            repetida: true,
            mensagem: "Assinatura j\xE1 confirmada no PC."
          });
        }
        return resposta(409, { erro: "Esta solicita\xE7\xE3o j\xE1 possui outra resposta confirmada." });
      }
      if (pendente.status !== "pendente") {
        return resposta(409, { erro: "Esta solicita\xE7\xE3o foi cancelada ou expirou." });
      }
      const { data, error } = await admin.from("solicitacoes_assinatura_remota").update({ resposta: respostaAssinada, status: "respondida", respondido_por: usuario.user.id, respondido_em: (/* @__PURE__ */ new Date()).toISOString(), updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("empresa_id", atual.empresa_id).eq("id", pendente.id).eq("status", "pendente").select("id,status").maybeSingle();
      if (error) throw error;
      if (!data) {
        const { data: confirmada } = await admin.from("solicitacoes_assinatura_remota").select("id,status,resposta").eq("empresa_id", atual.empresa_id).eq("id", pendente.id).maybeSingle();
        if (confirmada && ["respondida", "concluida"].includes(String(confirmada.status)) && jsonCanonico(confirmada.resposta) === jsonCanonico(respostaAssinada)) {
          return resposta(200, { solicitacao: { id: confirmada.id, status: confirmada.status }, repetida: true });
        }
        return resposta(409, { erro: "Esta solicita\xE7\xE3o j\xE1 foi respondida ou expirou." });
      }
      return resposta(200, { solicitacao: data, mensagem: "Assinatura enviada automaticamente ao PC." });
    }
    if (acao === "buscar_respostas") {
      const tipos = tiposDocumentoPermitidos(atual, "ler");
      if (!tipos.length) return resposta(200, { solicitacoes: [] });
      const { data, error } = await admin.from("solicitacoes_assinatura_remota").select("id,resposta,id_envio_assinatura,tipo_documento,respondido_em").eq("empresa_id", atual.empresa_id).eq("status", "respondida").in("tipo_documento", tipos).order("respondido_em", { ascending: true }).limit(50);
      if (error) throw error;
      return resposta(200, { solicitacoes: data || [] });
    }
    if (acao === "confirmar_resposta") {
      const id = String(dados.solicitacaoId || "").trim();
      if (!id) return resposta(400, { erro: "Solicita\xE7\xE3o n\xE3o informada." });
      const tipos = tiposDocumentoPermitidos(atual, "editar");
      if (!tipos.length) return resposta(403, { erro: "Seu usu\xE1rio n\xE3o pode concluir documentos." });
      const { error } = await admin.from("solicitacoes_assinatura_remota").update({ status: "concluida", concluido_em: (/* @__PURE__ */ new Date()).toISOString(), updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("empresa_id", atual.empresa_id).eq("id", id).eq("status", "respondida").in("tipo_documento", tipos);
      if (error) throw error;
      return resposta(200, { sucesso: true });
    }
    return resposta(400, { erro: "A\xE7\xE3o de assinatura n\xE3o suportada." });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error("[assinaturas-remotas]", mensagem);
    return resposta(500, { erro: "N\xE3o foi poss\xEDvel concluir a assinatura remota agora." });
  }
});
