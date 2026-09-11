// supabase/functions/auth-login/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0"
};
var url = Deno.env.get("SUPABASE_URL");
var serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
var anonKey = Deno.env.get("SUPABASE_ANON_KEY");
var admin = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { "x-client-info": "sistema-os-auth-login" } }
});
var cacheEmpresas = /* @__PURE__ */ new Map();
var tentativasLocais = /* @__PURE__ */ new Map();
var circuitoBancoAbertoAte = 0;
var CACHE_EMPRESA_MS = 3e4;
var JANELA_LOCAL_MS = 3e4;
var LIMITE_LOCAL = 5;
var CIRCUITO_BANCO_MS = 5e3;
function resposta(status, corpo) {
  return new Response(JSON.stringify(corpo), { status, headers: cors });
}
function texto(valor) {
  return String(valor ?? "").trim().toLowerCase();
}
async function hashChave(valor) {
  const dados = new TextEncoder().encode(valor);
  const hash = await crypto.subtle.digest("SHA-256", dados);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function chavesTentativa(req, empresa, usuario) {
  const encaminhados = String(req.headers.get("x-forwarded-for") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const ip = texto(req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || encaminhados[encaminhados.length - 1] || "desconhecido");
  return {
    rede: await hashChave(`rede|${ip}|${empresa}|${usuario}`),
    conta: await hashChave(`conta|${empresa}|${usuario}`)
  };
}
function erroTransitorioBanco(erro) {
  const codigo = String(erro?.code ?? "").toUpperCase();
  const mensagem = String(erro?.message ?? erro ?? "").toLowerCase();
  return codigo === "PGRST002" || codigo === "PGRST000" || /schema cache|service unavailable|temporarily unavailable|connection.*database/.test(mensagem);
}
function abrirCircuitoBanco() {
  circuitoBancoAbertoAte = Math.max(circuitoBancoAbertoAte, Date.now() + CIRCUITO_BANCO_MS);
}
function limiteLocalBloqueado(chave) {
  const agora = Date.now();
  const atual = tentativasLocais.get(chave);
  if (!atual || agora - atual.inicio >= JANELA_LOCAL_MS) {
    if (atual) tentativasLocais.delete(chave);
    return false;
  }
  return atual.falhas >= LIMITE_LOCAL;
}
function registrarFalhaLocal(chave) {
  const agora = Date.now();
  const atual = tentativasLocais.get(chave);
  if (!atual || agora - atual.inicio >= JANELA_LOCAL_MS) {
    tentativasLocais.set(chave, { falhas: 1, inicio: agora });
    return;
  }
  atual.falhas += 1;
}
function limparFalhaLocal(chave) {
  tentativasLocais.delete(chave);
}
async function obterEmpresaAtiva(codigo) {
  const agora = Date.now();
  const salva = cacheEmpresas.get(codigo);
  if (salva && salva.expiraEm > agora) return { id: salva.id, error: null };
  const resultado = await admin.from("empresas").select("id").eq("codigo", codigo).eq("ativo", true).maybeSingle();
  if (!resultado.error) {
    cacheEmpresas.set(codigo, { id: resultado.data?.id || null, expiraEm: agora + CACHE_EMPRESA_MS });
    if (cacheEmpresas.size > 200) {
      for (const [chave, valor] of cacheEmpresas) {
        if (valor.expiraEm <= agora) cacheEmpresas.delete(chave);
      }
    }
  }
  return { id: resultado.data?.id || null, error: resultado.error };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resposta(405, { erro: "M\xE9todo n\xE3o permitido." });
  try {
    const corpo = await req.json();
    const empresa = texto(corpo.empresa);
    const usuario = texto(corpo.usuario);
    const senha = String(corpo.senha ?? "");
    if (!/^[a-z0-9-]{3,40}$/.test(empresa) || !/^[a-z0-9._-]{3,30}$/.test(usuario) || senha.length < 1 || senha.length > 128) {
      return resposta(401, { erro: "Credenciais inv\xE1lidas." });
    }
    const chavesLimite = await chavesTentativa(req, empresa, usuario);
    const chaveLimite = chavesLimite.rede;
    const chaveConta = chavesLimite.conta;
    if (limiteLocalBloqueado(chaveLimite)) {
      return resposta(429, { erro: "Muitas tentativas. Aguarde alguns instantes e tente novamente." });
    }
    if (Date.now() < circuitoBancoAbertoAte) {
      return resposta(503, {
        erro: "Servi\xE7o de autentica\xE7\xE3o temporariamente indispon\xEDvel. Aguarde alguns instantes e tente novamente.",
        codigo: "servico_auth_indisponivel"
      });
    }
    const [limite, limiteConta] = await Promise.all([
      admin.rpc("verificar_limite_login", { p_chave: chaveLimite }),
      admin.rpc("verificar_limite_login", { p_chave: chaveConta })
    ]);
    if (limite.error || limiteConta.error) {
      abrirCircuitoBanco();
      console.error("[auth-login] limite indisponivel:", limite.error?.code || limiteConta.error?.code || "erro");
      return resposta(503, { erro: "Servico de autenticacao temporariamente indisponivel." });
    }
    if (limite.data?.bloqueado === true || limiteConta.data?.bloqueado === true) {
      return resposta(429, { erro: "Muitas tentativas. Aguarde 15 minutos e tente novamente." });
    }
    const resultadoEmpresa = await obterEmpresaAtiva(empresa);
    if (resultadoEmpresa.error) {
      if (erroTransitorioBanco(resultadoEmpresa.error)) abrirCircuitoBanco();
      console.error("[auth-login] consulta empresa:", JSON.stringify(resultadoEmpresa.error));
      return resposta(503, {
        erro: "Servi\xE7o de dados temporariamente indispon\xEDvel. Aguarde alguns instantes e tente novamente.",
        codigo: "servico_dados_indisponivel"
      });
    }
    const empresaAtualId = resultadoEmpresa.id;
    const resultadoIdentidade = await admin.from("identidades_login").select("email_tecnico, empresa_id, usuario_id").eq("empresa_id", empresaAtualId || "00000000-0000-0000-0000-000000000000").eq("usuario", usuario).eq("ativo", true).maybeSingle();
    if (resultadoIdentidade.error) {
      if (erroTransitorioBanco(resultadoIdentidade.error)) abrirCircuitoBanco();
      console.error("[auth-login] consulta identidade:", JSON.stringify(resultadoIdentidade.error));
      return resposta(503, {
        erro: "Servi\xE7o de dados temporariamente indispon\xEDvel. Aguarde alguns instantes e tente novamente.",
        codigo: "servico_dados_indisponivel"
      });
    }
    const identidade = resultadoIdentidade.data;
    const email = identidade?.email_tecnico || "invalid-" + crypto.randomUUID() + "@invalid.local";
    let token;
    try {
      token = await fetch(url + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: anonKey, Authorization: "Bearer " + anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: senha }),
        signal: AbortSignal.timeout(8e3)
      });
    } catch (erroAuth) {
      console.error("[auth-login] servico Auth indisponivel:", erroAuth instanceof Error ? erroAuth.message : "erro");
      return resposta(503, {
        erro: "Servi\xE7o de autentica\xE7\xE3o temporariamente indispon\xEDvel. Aguarde alguns instantes e tente novamente.",
        codigo: "servico_auth_indisponivel"
      });
    }
    if (token.status === 408 || token.status >= 500) {
      console.error("[auth-login] servico Auth respondeu:", token.status);
      return resposta(503, {
        erro: "Servi\xE7o de autentica\xE7\xE3o temporariamente indispon\xEDvel. Aguarde alguns instantes e tente novamente.",
        codigo: "servico_auth_indisponivel"
      });
    }
    if (token.status === 429) {
      return resposta(429, { erro: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
    }
    if (!identidade || !token.ok) {
      registrarFalhaLocal(chaveLimite);
      const [falha, falhaConta] = await Promise.all([
        admin.rpc("registrar_falha_login", { p_chave: chaveLimite }),
        admin.rpc("registrar_falha_login_controlada", {
          p_chave: chaveConta,
          p_limite: 20,
          p_bloqueio_minutos: 15
        })
      ]);
      if (falha.error || falhaConta.error) {
        abrirCircuitoBanco();
        return resposta(503, { erro: "Servico de autenticacao temporariamente indisponivel." });
      }
      const bloqueado = falha.data?.bloqueado === true || falhaConta.data?.bloqueado === true;
      return resposta(bloqueado ? 429 : 401, {
        erro: bloqueado ? "Muitas tentativas. Aguarde 15 minutos e tente novamente." : "Credenciais inv\xE1lidas."
      });
    }
    const sessao = await token.json();
    if (!sessao.access_token || !sessao.refresh_token) return resposta(401, { erro: "Credenciais inv\xE1lidas." });
    limparFalhaLocal(chaveLimite);
    const tarefasPosLogin = await Promise.allSettled([
      admin.rpc("limpar_falhas_login", { p_chave: chaveLimite }),
      admin.rpc("limpar_falhas_login", { p_chave: chaveConta }),
      admin.from("auditoria_comercial").insert({
        empresa_id: identidade.empresa_id,
        autor_id: identidade.usuario_id,
        acao: "login",
        entidade: "sessao",
        entidade_id: identidade.usuario_id
      })
    ]);
    if (tarefasPosLogin.some((tarefa) => tarefa.status === "rejected")) {
      console.error("[auth-login] tarefa pos-login indisponivel");
    }
    return resposta(200, {
      access_token: sessao.access_token,
      refresh_token: sessao.refresh_token,
      expires_in: sessao.expires_in,
      token_type: sessao.token_type || "bearer"
    });
  } catch (erro) {
    console.error("[auth-login]", erro instanceof Error ? erro.message : String(erro));
    return resposta(500, { erro: "N\xE3o foi poss\xEDvel entrar agora. Tente novamente." });
  }
});
