// supabase/functions/integracoes-empresa/index.ts
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

// supabase/functions/integracoes-empresa/index.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json; charset=utf-8"
};
function resposta(status, corpo) {
  return new Response(JSON.stringify(corpo), { status, headers: cors });
}
function bytesBase64(valor) {
  const bruto = atob(valor);
  return Uint8Array.from(bruto, (caractere) => caractere.charCodeAt(0));
}
function base64Bytes(valor) {
  return btoa(String.fromCharCode(...new Uint8Array(valor)));
}
function bytesDeBase64(valor) {
  const bruto = atob(valor);
  return Uint8Array.from(bruto, (caractere) => caractere.charCodeAt(0));
}
async function chaveCifra() {
  const valor = Deno.env.get("INTEGRATION_ENCRYPTION_KEY") || "";
  let bytes;
  try {
    bytes = bytesBase64(valor);
  } catch (_) {
    throw new Error("O cofre seguro da integra\xE7\xE3o n\xE3o est\xE1 configurado. Contate o suporte.");
  }
  if (bytes.byteLength !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY inv\xE1lida.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function cifrar(segredo) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chave = await chaveCifra();
  const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chave, new TextEncoder().encode(segredo));
  return { iv: base64Bytes(iv.buffer), cifra: base64Bytes(cifrado) };
}
async function decifrar(ivBase64, cifraBase64) {
  const chave = await chaveCifra();
  const iv = bytesDeBase64(ivBase64);
  const cifra = bytesDeBase64(cifraBase64);
  const aberto = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, chave, cifra);
  return new TextDecoder().decode(aberto);
}
var PROVEDORES_IA = {
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", modelo: "openai/gpt-oss-120b", tipo: "openai" },
  openai: { url: "https://api.openai.com/v1/chat/completions", modelo: "gpt-4.1-mini", tipo: "openai" },
  anthropic: { url: "https://api.anthropic.com/v1/messages", modelo: "claude-sonnet-4-6", tipo: "anthropic" },
  deepseek: { url: "https://api.deepseek.com/chat/completions", modelo: "deepseek-v4-flash", tipo: "openai" }
};
function validarConfiguracaoIA(provedorRecebido, modeloRecebido) {
  const provedor = String(provedorRecebido || "").trim().toLowerCase();
  const definicao = PROVEDORES_IA[provedor];
  if (!definicao) throw new Error("Selecione um provedor de IA v\xE1lido.");
  const modelo = String(modeloRecebido || definicao.modelo).trim();
  if (!/^[a-z0-9][a-z0-9._/-]{1,99}$/i.test(modelo)) throw new Error("Selecione um modelo de IA v\xE1lido.");
  return { provedor, modelo, definicao };
}
async function chamarProvedorIA(provedor, modelo, apiKey, mensagensRecebidas, opcoes = {}) {
  const definicao = PROVEDORES_IA[provedor];
  const mensagens = (Array.isArray(mensagensRecebidas) ? mensagensRecebidas : []).slice(-12).map((item) => ({
    role: ["system", "assistant"].includes(String(item?.role)) ? String(item.role) : "user",
    content: String(item?.content || "").slice(0, 3e4)
  })).filter((item) => item.content);
  if (!mensagens.length) throw new Error("A pergunta para a IA est\xE1 vazia.");
  const maxTokens = Math.max(8, Math.min(1500, Number(opcoes.maxTokens) || 900));
  let respostaIA;
  if (definicao.tipo === "anthropic") {
    const system = mensagens.filter((item) => item.role === "system").map((item) => item.content).join("\n\n");
    const conversa = mensagens.filter((item) => item.role !== "system");
    respostaIA = await fetch(definicao.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelo, system, messages: conversa, max_tokens: maxTokens, temperature: Number(opcoes.temperature ?? 0.3) })
    });
  } else {
    respostaIA = await fetch(definicao.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelo, messages: mensagens, max_tokens: maxTokens, temperature: Number(opcoes.temperature ?? 0.3), stream: false })
    });
  }
  const retorno = await respostaIA.json().catch(() => ({}));
  if (!respostaIA.ok) throw new Error(`O provedor recusou a solicita\xE7\xE3o (HTTP ${respostaIA.status}).`);
  if (definicao.tipo === "anthropic") {
    return { choices: [{ message: { content: (retorno.content || []).map((item) => String(item?.text || "")).join("\n") } }], usage: retorno.usage };
  }
  return retorno;
}
async function registrarResultadoVerificacao(admin, integracaoId, dados) {
  const { data, error } = await admin.from("integracoes_empresa").update({ ...dados, ultima_verificacao_em: (/* @__PURE__ */ new Date()).toISOString(), updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", integracaoId).select("id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro").single();
  if (error) throw error;
  return data;
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
    const { data: usuario } = await cliente.auth.getUser();
    if (!usuario.user) return resposta(401, { erro: "Sess\xE3o inv\xE1lida." });
    const { data: contexto, error: contextoErro } = await cliente.rpc("obter_contexto_comercial");
    const atual = Array.isArray(contexto) ? contexto[0] : contexto;
    if (contextoErro || !atual?.empresa_id || atual.administrador_global === true || !contextoUsuarioAtivo(atual) || !licencaPermiteOperacao(atual)) {
      return resposta(403, { erro: "Acesso n\xE3o autorizado." });
    }
    const corpo = await req.json();
    const tipo = String(corpo.tipo || "");
    const acao = String(corpo.acao || "");
    if (!["mercado_pago", "whatsapp", "ia"].includes(tipo)) return resposta(400, { erro: "Integra\xE7\xE3o n\xE3o suportada." });
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const podeAdministrar = temPermissao(atual, "configuracoes", "editar");
    const podeConsultarFinanceiro = temPermissao(atual, "financeiro", "ler");
    const podeOperarFinanceiro = temPermissao(atual, "financeiro", "criar") || temPermissao(atual, "financeiro", "editar");
    const podeEnviarWhatsApp = temPermissao(atual, "os", "editar");
    if (tipo === "ia") {
      const buscarIntegracao = async () => {
        const { data, error: error3 } = await admin.from("integracoes_empresa").select("id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados").eq("empresa_id", atual.empresa_id).eq("tipo", "ia").maybeSingle();
        if (error3) throw error3;
        return data;
      };
      const carregarCredencial = async (integracaoId) => {
        const { data, error: error3 } = await admin.from("integracoes_segredos").select("iv_base64,segredo_cifrado_base64").eq("integracao_id", integracaoId).maybeSingle();
        if (error3) throw error3;
        if (!data) return "";
        return String(await decifrar(data.iv_base64, data.segredo_cifrado_base64));
      };
      if (acao === "status") {
        const integracao3 = await buscarIntegracao();
        const possuiChave = integracao3 ? Boolean(await carregarCredencial(integracao3.id)) : false;
        return resposta(200, { integracao: integracao3, possui_chave: possuiChave });
      }
      if (acao === "chat") {
        if (atual.administrador_global) return resposta(403, { erro: "Entre em uma empresa para usar o assistente." });
        const integracao3 = await buscarIntegracao();
        if (!integracao3 || integracao3.status !== "conectada") return resposta(409, { erro: "O assistente de IA ainda n\xE3o foi configurado para esta empresa." });
        const { provedor: provedor2, modelo: modelo2 } = validarConfiguracaoIA(integracao3.metadados?.provedor, integracao3.metadados?.modelo);
        const apiKey2 = await carregarCredencial(integracao3.id);
        if (!apiKey2) return resposta(409, { erro: "A chave segura da IA n\xE3o foi encontrada. Configure novamente." });
        const retorno = await chamarProvedorIA(provedor2, modelo2, apiKey2, corpo.dados?.mensagens, corpo.dados?.opcoes || {});
        return resposta(200, { resposta: retorno, provedor: provedor2, modelo: modelo2 });
      }
      if (!podeAdministrar) return resposta(403, { erro: "Apenas administradores podem alterar o assistente de IA." });
      if (acao === "desconectar") {
        const { data: integracao3, error: error3 } = await admin.from("integracoes_empresa").upsert({
          empresa_id: atual.empresa_id,
          tipo: "ia",
          status: "desconectada",
          conta_mascarada: null,
          conectado_em: null,
          ultimo_erro: null,
          metadados: {},
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }, { onConflict: "empresa_id,tipo" }).select("id,status,metadados").single();
        if (error3) throw error3;
        await admin.from("integracoes_segredos").delete().eq("integracao_id", integracao3.id);
        return resposta(200, { integracao: integracao3, mensagem: "Assistente de IA desconectado desta empresa." });
      }
      const dadosIA = corpo.dados && typeof corpo.dados === "object" ? corpo.dados : {};
      const { provedor, modelo } = validarConfiguracaoIA(dadosIA.provedor, dadosIA.modelo);
      const existente = await buscarIntegracao();
      const chaveNova = String(dadosIA.apiKey || "").trim();
      const apiKey = chaveNova || (existente ? await carregarCredencial(existente.id) : "");
      if (!apiKey) return resposta(400, { erro: "Informe a chave da API do provedor escolhido." });
      try {
        await chamarProvedorIA(provedor, modelo, apiKey, [{ role: "user", content: "Responda apenas OK." }], { maxTokens: 8, temperature: 0 });
      } catch (erro) {
        return resposta(400, { erro: erro instanceof Error ? erro.message : "O provedor recusou a chave." });
      }
      if (acao === "testar") return resposta(200, { sucesso: true, mensagem: "Conex\xE3o com a IA validada.", provedor, modelo });
      if (acao !== "configurar") return resposta(400, { erro: "A\xE7\xE3o de IA n\xE3o reconhecida." });
      const agora = (/* @__PURE__ */ new Date()).toISOString();
      const { data: integracao2, error: error2 } = await admin.from("integracoes_empresa").upsert({
        empresa_id: atual.empresa_id,
        tipo: "ia",
        status: "conectada",
        conta_mascarada: `${provedor} \xB7 ${modelo}`,
        conectado_em: existente?.conectado_em || agora,
        ultima_verificacao_em: agora,
        ultimo_erro: null,
        metadados: { provedor, modelo },
        updated_at: agora
      }, { onConflict: "empresa_id,tipo" }).select("id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados").single();
      if (error2) throw error2;
      if (chaveNova || !existente) {
        const segredo2 = await cifrar(apiKey);
        const { error: segredoErro2 } = await admin.from("integracoes_segredos").upsert({
          integracao_id: integracao2.id,
          iv_base64: segredo2.iv,
          segredo_cifrado_base64: segredo2.cifra,
          atualizado_em: agora
        });
        if (segredoErro2) throw segredoErro2;
      }
      await admin.from("auditoria_comercial").insert({
        empresa_id: atual.empresa_id,
        autor_id: usuario.user.id,
        acao: "integracao_ia_configurada",
        entidade: "integracoes_empresa",
        entidade_id: integracao2.id,
        metadados: { provedor, modelo }
      });
      return resposta(200, { integracao: integracao2, possui_chave: true, mensagem: "Assistente de IA configurado para esta empresa." });
    }
    if (tipo === "whatsapp") {
      const buscarIntegracao = async () => {
        const { data, error: error3 } = await admin.from("integracoes_empresa").select("id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados").eq("empresa_id", atual.empresa_id).eq("tipo", "whatsapp").maybeSingle();
        if (error3) throw error3;
        return data;
      };
      const carregarCredencial = async (integracaoId) => {
        const { data, error: error3 } = await admin.from("integracoes_segredos").select("iv_base64,segredo_cifrado_base64").eq("integracao_id", integracaoId).maybeSingle();
        if (error3) throw error3;
        if (!data) throw new Error("Conecte novamente o WhatsApp API.");
        return JSON.parse(await decifrar(data.iv_base64, data.segredo_cifrado_base64));
      };
      const validarConta = async (token3, phoneNumberId2, versao2) => {
        const teste2 = await fetch(`https://graph.facebook.com/${versao2}/${phoneNumberId2}?fields=display_phone_number,verified_name`, {
          headers: { Authorization: `Bearer ${token3}` }
        });
        const conta3 = await teste2.json().catch(() => ({}));
        if (!teste2.ok) throw new Error(String(conta3?.error?.message || "A Meta recusou essa conta."));
        return conta3;
      };
      if (acao === "status") return resposta(200, { integracao: await buscarIntegracao() });
      if (acao === "enviar") {
        if (!podeEnviarWhatsApp) return resposta(403, { erro: "Seu usu\xE1rio n\xE3o pode enviar mensagens da empresa." });
        const integracao3 = await buscarIntegracao();
        if (!integracao3 || integracao3.status !== "conectada") return resposta(409, { erro: "WhatsApp API n\xE3o est\xE1 conectado." });
        const credencial = await carregarCredencial(integracao3.id);
        const telefone = String(corpo.dados?.telefone || "").replace(/\D/g, "").slice(0, 15);
        const mensagem = String(corpo.dados?.mensagem || "").trim().slice(0, 4096);
        if (telefone.length < 10 || !mensagem) return resposta(400, { erro: "Informe telefone e mensagem." });
        const versao2 = String(integracao3.metadados?.graph_version || "v23.0");
        const phoneNumberId2 = String(integracao3.metadados?.phone_number_id || "");
        const envio = await fetch(`https://graph.facebook.com/${versao2}/${phoneNumberId2}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${credencial.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: telefone, type: "text", text: { preview_url: true, body: mensagem } })
        });
        const retorno = await envio.json().catch(() => ({}));
        if (!envio.ok) return resposta(400, { erro: String(retorno?.error?.message || "N\xE3o foi poss\xEDvel enviar a mensagem.") });
        return resposta(200, { sucesso: true, mensagem_id: String(retorno?.messages?.[0]?.id || "") });
      }
      if (!podeAdministrar) return resposta(403, { erro: "Apenas administradores podem alterar o WhatsApp." });
      if (acao === "desconectar") {
        const { data: integracao3, error: error3 } = await admin.from("integracoes_empresa").upsert({
          empresa_id: atual.empresa_id,
          tipo: "whatsapp",
          status: "desconectada",
          conta_mascarada: null,
          conectado_em: null,
          ultimo_erro: null,
          metadados: { modo: "baileys" },
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }, { onConflict: "empresa_id,tipo" }).select("id,status,metadados").single();
        if (error3) throw error3;
        await admin.from("integracoes_segredos").delete().eq("integracao_id", integracao3.id);
        await admin.from("empresas").update({ whatsapp_modo: "baileys" }).eq("id", atual.empresa_id);
        return resposta(200, { integracao: integracao3, mensagem: "WhatsApp API desconectado. O Baileys continua dispon\xEDvel." });
      }
      if (acao === "verificar") {
        const integracao3 = await buscarIntegracao();
        if (!integracao3 || integracao3.status === "desconectada") return resposta(200, { integracao: integracao3, status_verificado: false });
        try {
          const credencial = await carregarCredencial(integracao3.id);
          await validarConta(String(credencial.access_token || ""), String(integracao3.metadados?.phone_number_id || ""), String(integracao3.metadados?.graph_version || "v23.0"));
          const atualizado = await registrarResultadoVerificacao(admin, integracao3.id, { status: "conectada", ultimo_erro: null });
          return resposta(200, { integracao: { ...integracao3, ...atualizado }, status_verificado: true, mensagem: "WhatsApp API conectado." });
        } catch (erro) {
          const atualizado = await registrarResultadoVerificacao(admin, integracao3.id, { status: "erro", ultimo_erro: String(erro instanceof Error ? erro.message : erro).slice(0, 180) });
          return resposta(200, { integracao: { ...integracao3, ...atualizado }, status_verificado: false, mensagem: "Confira a conex\xE3o do WhatsApp API." });
        }
      }
      const token2 = String(corpo.accessToken || "").trim();
      const dados = corpo.dados && typeof corpo.dados === "object" ? corpo.dados : {};
      const phoneNumberId = String(dados.phoneNumberId || "").replace(/\D/g, "").slice(0, 30);
      const wabaId = String(dados.wabaId || "").replace(/\D/g, "").slice(0, 30);
      const versao = /^v\d+\.\d+$/.test(String(dados.graphVersion || "")) ? String(dados.graphVersion) : "v23.0";
      const modo = ["api", "hibrido"].includes(String(dados.modo)) ? String(dados.modo) : "hibrido";
      if (!token2 || !phoneNumberId) return resposta(400, { erro: "Informe o token permanente e o n\xFAmero da conta da Meta." });
      const conta2 = await validarConta(token2, phoneNumberId, versao);
      const segredo2 = await cifrar(JSON.stringify({ access_token: token2 }));
      const mascara2 = String(conta2.display_phone_number || conta2.verified_name || phoneNumberId).slice(0, 80);
      const { data: integracao2, error: error2 } = await admin.from("integracoes_empresa").upsert({
        empresa_id: atual.empresa_id,
        tipo: "whatsapp",
        status: "conectada",
        conta_mascarada: mascara2,
        conectado_em: (/* @__PURE__ */ new Date()).toISOString(),
        ultima_verificacao_em: (/* @__PURE__ */ new Date()).toISOString(),
        ultimo_erro: null,
        metadados: { provedor: "meta_cloud_api", phone_number_id: phoneNumberId, waba_id: wabaId || null, graph_version: versao, modo },
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }, { onConflict: "empresa_id,tipo" }).select("id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro,metadados").single();
      if (error2) throw error2;
      const { error: segredoErro2 } = await admin.from("integracoes_segredos").upsert({
        integracao_id: integracao2.id,
        iv_base64: segredo2.iv,
        segredo_cifrado_base64: segredo2.cifra,
        atualizado_em: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (segredoErro2) throw segredoErro2;
      await admin.from("empresas").update({ whatsapp_modo: modo }).eq("id", atual.empresa_id);
      return resposta(200, { integracao: integracao2, mensagem: "WhatsApp API conectado. O Baileys continua principal no modo h\xEDbrido.", status_verificado: true });
    }
    if (acao === "criar_preferencia") {
      if (!podeOperarFinanceiro) return resposta(403, { erro: "Seu usu\xE1rio n\xE3o pode gerar cobran\xE7as." });
      const dados = corpo.dados && typeof corpo.dados === "object" ? corpo.dados : {};
      const numero = String(dados.numero || "").trim().slice(0, 80);
      const titulo = String(dados.titulo || numero || "Servi\xE7o de assist\xEAncia t\xE9cnica").trim().slice(0, 250);
      const valor = Number(dados.valor);
      const pagadorRecebido = dados.pagador && typeof dados.pagador === "object" ? dados.pagador : {};
      const nomePagador = String(pagadorRecebido.name || "").trim().slice(0, 120);
      const emailBruto = String(pagadorRecebido.email || "").trim().toLowerCase();
      const emailPagador = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailBruto) ? emailBruto.slice(0, 254) : "";
      let telefonePagador = String(pagadorRecebido.phone?.area_code || "") + String(pagadorRecebido.phone?.number || "");
      telefonePagador = telefonePagador.replace(/\D/g, "").slice(0, 15);
      const pagador = {};
      if (nomePagador) pagador.name = nomePagador;
      if (emailPagador) pagador.email = emailPagador;
      if (telefonePagador.length >= 10) {
        pagador.phone = { area_code: telefonePagador.slice(0, 2), number: telefonePagador.slice(2) };
      }
      if (!/^OS-[0-9]+$/i.test(numero)) {
        return resposta(400, { erro: "Informe um n\xFAmero de OS v\xE1lido para gerar a cobran\xE7a.", codigo: "os_invalida" });
      }
      if (!Number.isFinite(valor) || valor <= 0) {
        return resposta(400, { erro: "Informe um valor v\xE1lido para gerar o link do Mercado Pago.", codigo: "valor_invalido" });
      }
      const { data: ordem, error: ordemErro } = await admin.from("ordens_servico").select("numero,valor,dados_extras").eq("empresa_id", atual.empresa_id).eq("numero", numero).is("deleted_at", null).maybeSingle();
      if (ordemErro) throw ordemErro;
      if (!ordem) return resposta(404, { erro: "A OS n\xE3o pertence a esta empresa.", codigo: "os_nao_encontrada" });
      const valorMaximo = Math.max(Number(ordem.valor || 0), Number(ordem.dados_extras?.valor_total_servico || 0));
      if (valorMaximo <= 0 || valor > valorMaximo + 9e-3) {
        return resposta(400, { erro: "O valor da cobran\xE7a n\xE3o confere com a OS.", codigo: "valor_divergente" });
      }
      const { data: existente, error: buscaErro } = await admin.from("integracoes_empresa").select("id,status").eq("empresa_id", atual.empresa_id).eq("tipo", tipo).maybeSingle();
      if (buscaErro) throw buscaErro;
      if (!existente || existente.status !== "conectada") {
        return resposta(409, {
          erro: "A conta Mercado Pago desta empresa n\xE3o est\xE1 conectada. Conecte-a nas Configura\xE7\xF5es.",
          codigo: "mercado_pago_desconectado"
        });
      }
      const { data: segredo2, error: segredoErro2 } = await admin.from("integracoes_segredos").select("iv_base64,segredo_cifrado_base64").eq("integracao_id", existente.id).maybeSingle();
      if (segredoErro2) throw segredoErro2;
      if (!segredo2?.iv_base64 || !segredo2?.segredo_cifrado_base64) {
        return resposta(409, {
          erro: "A credencial segura do Mercado Pago n\xE3o foi encontrada. Reconecte a conta nas Configura\xE7\xF5es.",
          codigo: "credencial_ausente"
        });
      }
      const token2 = await decifrar(segredo2.iv_base64, segredo2.segredo_cifrado_base64);
      const expiracao = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
      const preferenciaResposta = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token2,
          "Content-Type": "application/json",
          "X-Idempotency-Key": `${atual.empresa_id}:${numero}:${valor.toFixed(2)}`.slice(0, 128)
        },
        body: JSON.stringify({
          items: [{ title: titulo, quantity: 1, currency_id: "BRL", unit_price: Number(valor.toFixed(2)) }],
          payment_methods: { excluded_payment_types: [], installments: 12 },
          ...Object.keys(pagador).length ? { payer: pagador } : {},
          external_reference: numero,
          metadata: { empresa_id: atual.empresa_id, numero_os: numero },
          expires: true,
          expiration_date_to: expiracao
        })
      });
      const preferencia = await preferenciaResposta.json().catch(() => ({}));
      const link = String(preferencia.init_point || preferencia.sandbox_init_point || "").trim();
      if (!preferenciaResposta.ok || !link) {
        const detalhe = `HTTP ${preferenciaResposta.status}`;
        await registrarResultadoVerificacao(admin, existente.id, {
          ultimo_erro: "Falha ao gerar cobran\xE7a: " + detalhe
        });
        return resposta(502, {
          erro: "O Mercado Pago recusou a cria\xE7\xE3o do link. Tente novamente.",
          codigo: "preferencia_recusada"
        });
      }
      let destino;
      try {
        destino = new URL(link);
      } catch (_) {
        return resposta(502, { erro: "O Mercado Pago retornou um link inv\xE1lido.", codigo: "link_invalido" });
      }
      const host = destino.hostname.toLowerCase();
      if (destino.protocol !== "https:" || !(host === "mercadopago.com" || host.endsWith(".mercadopago.com") || host === "mercadopago.com.br" || host.endsWith(".mercadopago.com.br"))) return resposta(502, { erro: "O Mercado Pago retornou um destino n\xE3o permitido.", codigo: "link_invalido" });
      const { error: auditoriaErro2 } = await admin.from("auditoria_comercial").insert({
        empresa_id: atual.empresa_id,
        autor_id: usuario.user.id,
        acao: "mercado_pago_preferencia_criada",
        entidade: "ordens_servico",
        metadados: { numero, valor: Number(valor.toFixed(2)), preferencia_id: preferencia.id || null }
      });
      if (auditoriaErro2) console.warn("[integracoes-empresa] auditoria:", auditoriaErro2.message);
      await registrarResultadoVerificacao(admin, existente.id, { status: "conectada", ultimo_erro: null });
      return resposta(200, {
        sucesso: true,
        link,
        preferencia_id: String(preferencia.id || ""),
        mensagem: "Link do Mercado Pago gerado com sucesso."
      });
    }
    if (acao === "consultar_pagamentos") {
      if (!podeConsultarFinanceiro) return resposta(403, { erro: "Seu usu\xE1rio n\xE3o pode consultar cobran\xE7as." });
      const dados = corpo.dados && typeof corpo.dados === "object" ? corpo.dados : {};
      const numero = String(dados.numero || "").trim().slice(0, 80);
      if (!/^OS-[0-9]+$/i.test(numero)) return resposta(400, { erro: "Informe uma OS v\xE1lida.", codigo: "os_invalida" });
      const { data: ordemConsulta, error: erroOrdemConsulta } = await admin.from("ordens_servico").select("id").eq("empresa_id", atual.empresa_id).eq("numero", numero).is("deleted_at", null).maybeSingle();
      if (erroOrdemConsulta) throw erroOrdemConsulta;
      if (!ordemConsulta) return resposta(404, { erro: "A OS n\xE3o pertence a esta empresa.", codigo: "os_nao_encontrada" });
      const { data: existente, error: buscaErro } = await admin.from("integracoes_empresa").select("id,status").eq("empresa_id", atual.empresa_id).eq("tipo", tipo).maybeSingle();
      if (buscaErro) throw buscaErro;
      if (!existente || existente.status !== "conectada") {
        return resposta(409, {
          erro: "A conta Mercado Pago desta empresa n\xE3o est\xE1 conectada.",
          codigo: "mercado_pago_desconectado"
        });
      }
      const { data: segredo2, error: segredoErro2 } = await admin.from("integracoes_segredos").select("iv_base64,segredo_cifrado_base64").eq("integracao_id", existente.id).maybeSingle();
      if (segredoErro2) throw segredoErro2;
      if (!segredo2?.iv_base64 || !segredo2?.segredo_cifrado_base64) {
        return resposta(409, {
          erro: "A credencial segura do Mercado Pago n\xE3o foi encontrada. Reconecte a conta.",
          codigo: "credencial_ausente"
        });
      }
      const token2 = await decifrar(segredo2.iv_base64, segredo2.segredo_cifrado_base64);
      const busca = await fetch(
        `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(numero)}&status=approved&sort=date_created&criteria=desc&limit=100`,
        { headers: { Authorization: "Bearer " + token2 }, signal: AbortSignal.timeout(2e4) }
      );
      const retorno = await busca.json().catch(() => ({}));
      if (!busca.ok) {
        const detalhe = String(retorno.message || retorno.error || `HTTP ${busca.status}`).slice(0, 180);
        await registrarResultadoVerificacao(admin, existente.id, { ultimo_erro: "Falha ao consultar pagamentos: " + detalhe });
        return resposta(502, { erro: "O Mercado Pago recusou a consulta: " + detalhe, codigo: "consulta_recusada" });
      }
      const pagamentos = (Array.isArray(retorno.results) ? retorno.results : []).filter((p) => String(p?.external_reference || "") === numero && (!p.metadata?.empresa_id || String(p.metadata.empresa_id) === atual.empresa_id)).map((pagamento) => ({
        id: String(pagamento?.id || ""),
        status: String(pagamento?.status || ""),
        transaction_amount: Number(pagamento?.transaction_amount || 0),
        transaction_amount_refunded: Number(pagamento?.transaction_amount_refunded || 0),
        currency_id: String(pagamento?.currency_id || ""),
        live_mode: pagamento?.live_mode,
        empresa_id: atual.empresa_id,
        date_approved: pagamento?.date_approved || null,
        date_created: pagamento?.date_created || null,
        payment_type_id: String(pagamento?.payment_type_id || ""),
        external_reference: String(pagamento?.external_reference || "")
      }));
      await registrarResultadoVerificacao(admin, existente.id, { status: "conectada", ultimo_erro: null });
      return resposta(200, { sucesso: true, pagamentos });
    }
    if (!podeAdministrar) return resposta(403, { erro: "Apenas administradores podem alterar integra\xE7\xF5es." });
    if (acao === "desconectar") {
      const { data: integracao2, error: integracaoErro } = await admin.from("integracoes_empresa").upsert({ empresa_id: atual.empresa_id, tipo, status: "desconectada", conta_mascarada: null, conectado_em: null, ultimo_erro: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "empresa_id,tipo" }).select("id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro").single();
      if (integracaoErro || !integracao2) throw integracaoErro || new Error("N\xE3o foi poss\xEDvel atualizar a integra\xE7\xE3o.");
      const { error: segredoErro2 } = await admin.from("integracoes_segredos").delete().eq("integracao_id", integracao2.id);
      if (segredoErro2) throw segredoErro2;
      const { error: auditoriaErro2 } = await admin.from("auditoria_comercial").insert({ empresa_id: atual.empresa_id, autor_id: usuario.user.id, acao: "integracao_desconectada", entidade: "integracoes_empresa", entidade_id: integracao2.id });
      if (auditoriaErro2) console.warn("[integracoes-empresa] auditoria:", auditoriaErro2.message);
      return resposta(200, { integracao: integracao2, mensagem: "Conta Mercado Pago desconectada.", codigo: "desconectada" });
    }
    if (acao === "verificar") {
      const { data: existente, error: buscaErro } = await admin.from("integracoes_empresa").select("id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro").eq("empresa_id", atual.empresa_id).eq("tipo", tipo).maybeSingle();
      if (buscaErro) throw buscaErro;
      if (!existente || existente.status === "desconectada") {
        return resposta(200, {
          integracao: existente || null,
          status_verificado: false,
          mensagem: "Nenhuma conta Mercado Pago est\xE1 conectada nesta empresa."
        });
      }
      const { data: segredo2, error: segredoErro2 } = await admin.from("integracoes_segredos").select("iv_base64,segredo_cifrado_base64").eq("integracao_id", existente.id).maybeSingle();
      if (segredoErro2) throw segredoErro2;
      if (!segredo2?.iv_base64 || !segredo2?.segredo_cifrado_base64) {
        const integracao2 = await registrarResultadoVerificacao(admin, existente.id, {
          status: "erro",
          ultimo_erro: "Credencial segura n\xE3o encontrada. Conecte a conta novamente."
        });
        return resposta(200, { integracao: integracao2, status_verificado: false, mensagem: integracao2.ultimo_erro });
      }
      try {
        const token2 = await decifrar(segredo2.iv_base64, segredo2.segredo_cifrado_base64);
        const teste2 = await fetch("https://api.mercadopago.com/users/me", {
          headers: { Authorization: "Bearer " + token2 }
        });
        if (!teste2.ok) {
          const integracao3 = await registrarResultadoVerificacao(admin, existente.id, {
            status: "erro",
            ultimo_erro: "O Mercado Pago recusou a verifica\xE7\xE3o da conta (HTTP " + teste2.status + ")."
          });
          return resposta(200, { integracao: integracao3, status_verificado: false, mensagem: integracao3.ultimo_erro });
        }
        const conta2 = await teste2.json();
        const mascara2 = String(conta2.nickname || conta2.email || conta2.id || existente.conta_mascarada || "Conta conectada").slice(0, 80);
        const integracao2 = await registrarResultadoVerificacao(admin, existente.id, {
          status: "conectada",
          conta_mascarada: mascara2,
          ultimo_erro: null
        });
        return resposta(200, {
          integracao: integracao2,
          status_verificado: true,
          mensagem: "Conta Mercado Pago ativa e validada agora."
        });
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        const integracao2 = await registrarResultadoVerificacao(admin, existente.id, {
          status: "erro",
          ultimo_erro: "N\xE3o foi poss\xEDvel validar a conta: " + mensagem.slice(0, 180)
        });
        return resposta(200, { integracao: integracao2, status_verificado: false, mensagem: integracao2.ultimo_erro });
      }
    }
    const token = String(corpo.accessToken || "").trim();
    if (!/^APP_USR-|^TEST-/.test(token)) return resposta(400, { erro: "Credencial inv\xE1lida." });
    const teste = await fetch("https://api.mercadopago.com/users/me", { headers: { Authorization: "Bearer " + token } });
    if (!teste.ok) return resposta(400, { erro: "N\xE3o foi poss\xEDvel validar a conta Mercado Pago." });
    const conta = await teste.json();
    const mascara = String(conta.nickname || conta.email || conta.id || "Conta conectada").slice(0, 80);
    let segredo;
    try {
      segredo = await cifrar(token);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : "O cofre seguro n\xE3o est\xE1 configurado.";
      return resposta(503, { erro: mensagem, codigo: "cofre_indisponivel" });
    }
    const { data: integracao, error } = await admin.from("integracoes_empresa").upsert({ empresa_id: atual.empresa_id, tipo, status: "conectada", conta_mascarada: mascara, conectado_em: (/* @__PURE__ */ new Date()).toISOString(), ultima_verificacao_em: (/* @__PURE__ */ new Date()).toISOString(), ultimo_erro: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "empresa_id,tipo" }).select("id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro").single();
    if (error || !integracao) throw error || new Error("Falha ao registrar integra\xE7\xE3o.");
    const { error: segredoErro } = await admin.from("integracoes_segredos").upsert({ integracao_id: integracao.id, iv_base64: segredo.iv, segredo_cifrado_base64: segredo.cifra, atualizado_em: (/* @__PURE__ */ new Date()).toISOString() });
    if (segredoErro) throw segredoErro;
    const { error: auditoriaErro } = await admin.from("auditoria_comercial").insert({ empresa_id: atual.empresa_id, autor_id: usuario.user.id, acao: "integracao_conectada", entidade: "integracoes_empresa", entidade_id: integracao.id, metadados: { tipo } });
    if (auditoriaErro) console.warn("[integracoes-empresa] auditoria:", auditoriaErro.message);
    return resposta(200, { integracao, mensagem: "Conta Mercado Pago conectada e validada.", status_verificado: true, codigo: "conectada" });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error("[integracoes-empresa]", mensagem);
    return resposta(500, { erro: "N\xE3o foi poss\xEDvel concluir a integra\xE7\xE3o agora. Confira os dados e tente novamente.", codigo: "integracao_indisponivel" });
  }
});
