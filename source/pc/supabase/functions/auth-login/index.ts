import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0'
};

const url = Deno.env.get('SUPABASE_URL')!;
const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-client-info': 'sistema-os-auth-login' } }
});

const cacheEmpresas = new Map<string, { id: string | null; expiraEm: number }>();
const tentativasLocais = new Map<string, { falhas: number; inicio: number }>();
let circuitoBancoAbertoAte = 0;

const CACHE_EMPRESA_MS = 30_000;
const JANELA_LOCAL_MS = 30_000;
const LIMITE_LOCAL = 5;
const CIRCUITO_BANCO_MS = 5_000;

function resposta(status: number, corpo: Record<string, unknown>) {
  return new Response(JSON.stringify(corpo), { status, headers: cors });
}

function texto(valor: unknown) {
  return String(valor ?? '').trim().toLowerCase();
}

async function chaveTentativa(req: Request, empresa: string, usuario: string) {
  const ip = texto((req.headers.get('x-forwarded-for') || '').split(',')[0]
    || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'desconhecido');
  const dados = new TextEncoder().encode(`${ip}|${empresa}|${usuario}`);
  const hash = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function erroTransitorioBanco(erro: unknown) {
  const codigo = String((erro as { code?: unknown } | null)?.code ?? '').toUpperCase();
  const mensagem = String((erro as { message?: unknown } | null)?.message ?? erro ?? '').toLowerCase();
  return codigo === 'PGRST002'
    || codigo === 'PGRST000'
    || /schema cache|service unavailable|temporarily unavailable|connection.*database/.test(mensagem);
}

function abrirCircuitoBanco() {
  circuitoBancoAbertoAte = Math.max(circuitoBancoAbertoAte, Date.now() + CIRCUITO_BANCO_MS);
}

function limiteLocalBloqueado(chave: string) {
  const agora = Date.now();
  const atual = tentativasLocais.get(chave);
  if (!atual || agora - atual.inicio >= JANELA_LOCAL_MS) {
    if (atual) tentativasLocais.delete(chave);
    return false;
  }
  return atual.falhas >= LIMITE_LOCAL;
}

function registrarFalhaLocal(chave: string) {
  const agora = Date.now();
  const atual = tentativasLocais.get(chave);
  if (!atual || agora - atual.inicio >= JANELA_LOCAL_MS) {
    tentativasLocais.set(chave, { falhas: 1, inicio: agora });
    return;
  }
  atual.falhas += 1;
}

function limparFalhaLocal(chave: string) {
  tentativasLocais.delete(chave);
}

async function obterEmpresaAtiva(codigo: string) {
  const agora = Date.now();
  const salva = cacheEmpresas.get(codigo);
  if (salva && salva.expiraEm > agora) return { id: salva.id, error: null };

  const resultado = await admin
    .from('empresas')
    .select('id')
    .eq('codigo', codigo)
    .eq('ativo', true)
    .maybeSingle();
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return resposta(405, { erro: 'Método não permitido.' });

  try {
    const corpo = await req.json();
    const empresa = texto(corpo.empresa);
    const usuario = texto(corpo.usuario);
    const senha = String(corpo.senha ?? '');
    if (!/^[a-z0-9-]{3,40}$/.test(empresa) || !/^[a-z0-9._-]{3,30}$/.test(usuario)
      || senha.length < 1 || senha.length > 128) {
      return resposta(401, { erro: 'Credenciais inválidas.' });
    }

    const chaveLimite = await chaveTentativa(req, empresa, usuario);
    if (limiteLocalBloqueado(chaveLimite)) {
      return resposta(429, { erro: 'Muitas tentativas. Aguarde alguns instantes e tente novamente.' });
    }
    if (Date.now() < circuitoBancoAbertoAte) {
      return resposta(503, {
        erro: 'Serviço de autenticação temporariamente indisponível. Aguarde alguns instantes e tente novamente.',
        codigo: 'servico_auth_indisponivel'
      });
    }
    const limite = await admin.rpc('verificar_limite_login', { p_chave: chaveLimite });
    if (limite.error) {
      abrirCircuitoBanco();
      console.error('[auth-login] limite indisponivel:', limite.error.code || 'erro');
      return resposta(503, { erro: 'Servico de autenticacao temporariamente indisponivel.' });
    }
    if (limite.data?.bloqueado === true) {
      return resposta(429, { erro: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
    }

    // Resolve a empresa primeiro. Assim a consulta não depende de filtros
    // aninhados do PostgREST e preserva a mesma resposta genérica para
    // qualquer combinação inválida.
    const resultadoEmpresa = await obterEmpresaAtiva(empresa);
    if (resultadoEmpresa.error) {
      if (erroTransitorioBanco(resultadoEmpresa.error)) abrirCircuitoBanco();
      console.error('[auth-login] consulta empresa:', JSON.stringify(resultadoEmpresa.error));
      return resposta(503, {
        erro: 'Serviço de dados temporariamente indisponível. Aguarde alguns instantes e tente novamente.',
        codigo: 'servico_dados_indisponivel'
      });
    }
    const empresaAtualId = resultadoEmpresa.id;

    const resultadoIdentidade = await admin
      .from('identidades_login')
      .select('email_tecnico, empresa_id, usuario_id')
      .eq('empresa_id', empresaAtualId || '00000000-0000-0000-0000-000000000000')
      .eq('usuario', usuario)
      .eq('ativo', true)
      .maybeSingle();
    if (resultadoIdentidade.error) {
      if (erroTransitorioBanco(resultadoIdentidade.error)) abrirCircuitoBanco();
      console.error('[auth-login] consulta identidade:', JSON.stringify(resultadoIdentidade.error));
      return resposta(503, {
        erro: 'Serviço de dados temporariamente indisponível. Aguarde alguns instantes e tente novamente.',
        codigo: 'servico_dados_indisponivel'
      });
    }
    const identidade = resultadoIdentidade.data;

    // A mesma resposta é usada para empresa, usuário e senha inválidos.
    const email = identidade?.email_tecnico || ('invalid-' + crypto.randomUUID() + '@invalid.local');
    let token: Response;
    try {
      token = await fetch(url + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: 'Bearer ' + anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: senha }),
        signal: AbortSignal.timeout(8_000)
      });
    } catch (erroAuth) {
      console.error('[auth-login] servico Auth indisponivel:', erroAuth instanceof Error ? erroAuth.message : 'erro');
      return resposta(503, {
        erro: 'Serviço de autenticação temporariamente indisponível. Aguarde alguns instantes e tente novamente.',
        codigo: 'servico_auth_indisponivel'
      });
    }

    // Uma falha do serviço Auth não significa senha errada. Além de confundir
    // o usuário, registrar 502/503 como tentativa inválida poderia bloquear
    // uma conta legítima durante uma indisponibilidade do projeto.
    if (token.status === 408 || token.status >= 500) {
      console.error('[auth-login] servico Auth respondeu:', token.status);
      return resposta(503, {
        erro: 'Serviço de autenticação temporariamente indisponível. Aguarde alguns instantes e tente novamente.',
        codigo: 'servico_auth_indisponivel'
      });
    }
    if (token.status === 429) {
      return resposta(429, { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }
    if (!identidade || !token.ok) {
      registrarFalhaLocal(chaveLimite);
      const falha = await admin.rpc('registrar_falha_login', { p_chave: chaveLimite });
      if (falha.error) {
        abrirCircuitoBanco();
        return resposta(503, { erro: 'Servico de autenticacao temporariamente indisponivel.' });
      }
      return resposta(falha.data?.bloqueado === true ? 429 : 401, {
        erro: falha.data?.bloqueado === true
          ? 'Muitas tentativas. Aguarde 15 minutos e tente novamente.'
          : 'Credenciais inválidas.'
      });
    }

    const sessao = await token.json();
    if (!sessao.access_token || !sessao.refresh_token) return resposta(401, { erro: 'Credenciais inválidas.' });
    limparFalhaLocal(chaveLimite);
    const tarefasPosLogin = await Promise.allSettled([
      admin.rpc('limpar_falhas_login', { p_chave: chaveLimite }),
      admin.from('auditoria_comercial').insert({
        empresa_id: identidade.empresa_id,
        autor_id: identidade.usuario_id,
        acao: 'login',
        entidade: 'sessao',
        entidade_id: identidade.usuario_id
      })
    ]);
    if (tarefasPosLogin.some((tarefa) => tarefa.status === 'rejected')) {
      console.error('[auth-login] tarefa pos-login indisponivel');
    }
    return resposta(200, {
      access_token: sessao.access_token,
      refresh_token: sessao.refresh_token,
      expires_in: sessao.expires_in,
      token_type: sessao.token_type || 'bearer'
    });
  } catch (erro) {
    console.error('[auth-login]', erro instanceof Error ? erro.message : String(erro));
    return resposta(500, { erro: 'Não foi possível entrar agora. Tente novamente.' });
  }
});
