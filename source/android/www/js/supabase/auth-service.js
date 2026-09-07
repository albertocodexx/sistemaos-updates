/** Operações de Supabase Auth. Senhas existem apenas durante a chamada. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSAuthService = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function cliente() {
    return root.SupabaseClientApp.obterCliente();
  }

  function falhar(error) {
    if (error) throw error;
  }

  function comTempoLimite(promessa, limiteMs) {
    var temporizador;
    return Promise.race([
      Promise.resolve(promessa),
      new Promise(function (_, rejeitar) {
        temporizador = setTimeout(function () {
          rejeitar(new Error('TEMPO_LIMITE_SERVIDOR'));
        }, limiteMs || 20000);
      })
    ]).finally(function () { clearTimeout(temporizador); });
  }

  async function falharFuncao(error) {
    if (!error) return;
    if (root.SistemaOSEdgeError) return root.SistemaOSEdgeError.lancar(error, 'Não foi possível entrar agora.');
    var mensagem = '';
    try {
      var resposta = error.context;
      if (resposta && typeof resposta.clone === 'function') {
        var dados = await resposta.clone().json();
        if (dados && dados.erro) mensagem = String(dados.erro);
      }
    } catch (_) { /* resposta técnica sem JSON */ }
    if (mensagem) throw new Error(mensagem);
    throw error;
  }

  async function entrar(empresa, usuario, senha) {
    var resposta = await comTempoLimite(cliente().functions.invoke('auth-login', {
      body: {
        empresa: String(empresa || '').trim(),
        usuario: String(usuario || '').trim(),
        senha: String(senha || '')
      }
    }), 20000);
    await falharFuncao(resposta.error);
    var credenciais = resposta.data || {};
    if (!credenciais.access_token || !credenciais.refresh_token) {
      throw new Error('Não foi possível validar as credenciais.');
    }
    var sessao = await comTempoLimite(cliente().auth.setSession({
      access_token: credenciais.access_token,
      refresh_token: credenciais.refresh_token
    }), 15000);
    falhar(sessao.error);
    return sessao.data;
  }

  async function sair() {
    var resposta = await cliente().auth.signOut({ scope: 'local' });
    falhar(resposta.error);
  }

  async function obterSessao() {
    var resposta = await comTempoLimite(cliente().auth.getSession(), 15000);
    falhar(resposta.error);
    return resposta.data && resposta.data.session ? resposta.data.session : null;
  }

  async function obterUsuario() {
    var resposta = await comTempoLimite(cliente().auth.getUser(), 15000);
    falhar(resposta.error);
    return resposta.data && resposta.data.user ? resposta.data.user : null;
  }

  async function renovarSessao() {
    var resposta = await comTempoLimite(cliente().auth.refreshSession(), 15000);
    falhar(resposta.error);
    return resposta.data && resposta.data.session ? resposta.data.session : null;
  }

  async function recuperarSenha() {
    throw new Error('Peça ao administrador da empresa para redefinir sua senha.');
  }

  async function atualizarSenha(novaSenha) {
    var resposta = await cliente().auth.updateUser({ password: String(novaSenha || '') });
    falhar(resposta.error);
    return resposta.data && resposta.data.user;
  }

  async function processarUrlAutenticacao(valorUrl) {
    var url = new URL(String(valorUrl || ''));
    var parametros = new URLSearchParams(url.search || '');
    var hash = new URLSearchParams((url.hash || '').replace(/^#/, ''));
    var erro = parametros.get('error_description') || hash.get('error_description');
    if (erro) throw new Error(erro);

    var codigo = parametros.get('code');
    var tipo = parametros.get('type') || hash.get('type') || '';
    if (codigo) {
      var troca = await cliente().auth.exchangeCodeForSession(codigo);
      falhar(troca.error);
      return { tipo: tipo || 'recovery', sessao: troca.data && troca.data.session };
    }

    var accessToken = hash.get('access_token');
    var refreshToken = hash.get('refresh_token');
    if (accessToken && refreshToken) {
      var definida = await cliente().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      falhar(definida.error);
      return { tipo: tipo || 'recovery', sessao: definida.data && definida.data.session };
    }
    return { tipo: tipo, sessao: null };
  }

  function escutar(callback) {
    return cliente().auth.onAuthStateChange(function (evento, sessao) {
      callback(evento, sessao);
    });
  }

  return {
    entrar: entrar,
    sair: sair,
    obterSessao: obterSessao,
    obterUsuario: obterUsuario,
    renovarSessao: renovarSessao,
    recuperarSenha: recuperarSenha,
    atualizarSenha: atualizarSenha,
    processarUrlAutenticacao: processarUrlAutenticacao,
    escutar: escutar
  };
});
