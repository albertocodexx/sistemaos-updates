// Formatação central do número da Ordem de Serviço.
// Aceita dados antigos como "OS OS-0019" e sempre devolve "OS-0019".
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SistemaOSNumero = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function semPrefixo(valor) {
    var texto = String(valor == null ? '' : valor).trim();
    var anterior = null;

    // Remove quantos prefixos antigos houver, inclusive "OS nº OS-...".
    while (texto && texto !== anterior) {
      anterior = texto;
      texto = texto.replace(
        /^(?:(?:ordem\s+de\s+servi[cç]o)|os)\s*(?:n(?:[º°o.]|ro\.?)?\s*)?[#:\-–—]*\s*/i,
        ''
      ).trim();
    }

    return texto.replace(/^[#:\-–—\s]+/, '').trim();
  }

  function formatar(valor) {
    var numero = semPrefixo(valor);
    return numero ? 'OS-' + numero : '';
  }

  function comFallback(valor, fallback) {
    return formatar(valor) || String(fallback == null ? 'OS' : fallback);
  }

  return {
    semPrefixo: semPrefixo,
    formatar: formatar,
    comFallback: comFallback
  };
});
