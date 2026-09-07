/**
 * tema-app.js
 *
 * Liga/desliga o modo escuro na INTERFACE do app celular (telas, formulários,
 * botões). Isso é diferente do tema do PDF gerado (tema-pdf.js), que é um
 * esquema de cores fixo aplicado só dentro do documento exportado — os dois
 * não têm relação entre si.
 *
 * Mecanismo: aplica o atributo data-tema="escuro"|"claro" na tag <html>,
 * e o CSS (app.css) usa esse atributo para sobrescrever as cores da UI
 * via seletor [data-tema="escuro"], sem precisar de uma refatoração
 * completa do CSS existente para variáveis.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TemaApp = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ATRIBUTO = 'data-tema';

  function obterElementoRaiz() {
    if (typeof document === 'undefined') return null;
    return document.documentElement;
  }

  /**
   * Aplica o modo visualmente (não persiste — persistência é responsabilidade
   * de quem chama, tipicamente via config.js salvarConfig({ temaModo })).
   * @param {'claro'|'escuro'} modo
   */
  function aplicar(modo) {
    var normalizado = modo === 'escuro' ? 'escuro' : 'claro';
    var raiz = obterElementoRaiz();
    if (raiz) {
      raiz.setAttribute(ATRIBUTO, normalizado);
    }
    return normalizado;
  }

  function obterAtual() {
    var raiz = obterElementoRaiz();
    if (!raiz) return 'claro';
    var atual = raiz.getAttribute(ATRIBUTO);
    return atual === 'escuro' ? 'escuro' : 'claro';
  }

  function alternar() {
    var novo = obterAtual() === 'escuro' ? 'claro' : 'escuro';
    return aplicar(novo);
  }

  /**
   * Inicializa o tema da UI a partir da config salva (chamar uma vez ao
   * carregar o app, antes ou logo depois do primeiro paint).
   * @param {object} config - objeto retornado por ConfigApp.carregarConfig()
   */
  function inicializarDeConfig(config) {
    var modo = (config && config.temaModo === 'escuro') ? 'escuro' : 'claro';
    return aplicar(modo);
  }

  return {
    aplicar: aplicar,
    obterAtual: obterAtual,
    alternar: alternar,
    inicializarDeConfig: inicializarDeConfig
  };
});
