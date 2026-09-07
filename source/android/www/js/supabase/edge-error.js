/** Converte respostas técnicas das Edge Functions em mensagens úteis. */
(function (root) {
  'use strict';
  async function mensagem(error, padrao) {
    var texto = '';
    try {
      var resposta = error && error.context;
      if (resposta && typeof resposta.clone === 'function') {
        var dados = await resposta.clone().json();
        texto = String(dados && (dados.erro || dados.message) || '');
      }
    } catch (_) {}
    if (!texto) texto = String(error && error.message || error || '');
    if (/servi[cç]o de dados temporariamente indispon[ií]vel|servico_dados_indisponivel|pgrst00[02]|schema cache|service unavailable|http 503/i.test(texto)) {
      return 'O servidor está temporariamente sobrecarregado. Aguarde alguns instantes e tente novamente.';
    }
    if (/invalid login credentials|credenciais inv[aá]lidas/i.test(texto)) return 'Empresa, usuário ou senha incorretos.';
    if (/jwt|session|refresh token|not authenticated/i.test(texto)) return 'Sua sessão expirou. Entre novamente.';
    if (/failed to fetch|network|offline|timeout/i.test(texto)) return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
    if (/non-2xx|edge function/i.test(texto)) return 'O serviço seguro não respondeu. Aguarde alguns instantes e tente novamente.';
    return texto || padrao || 'Não foi possível concluir a operação. Tente novamente.';
  }
  async function lancar(error, padrao) {
    if (error) throw new Error(await mensagem(error, padrao));
  }
  root.SistemaOSEdgeError = { mensagem: mensagem, lancar: lancar };
})(typeof globalThis !== 'undefined' ? globalThis : this);
