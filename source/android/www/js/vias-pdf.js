'use strict';
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SistemaOSViasPdf = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  function selecionar(html, via, Parser) {
    if (via === 'ambas' || !via) return html;
    if (via !== 'primeira' && via !== 'assistencia') throw new Error('Via do PDF inválida.');
    var Construtor = Parser || root.DOMParser;
    if (typeof Construtor !== 'function') throw new Error('Leitor de PDF indisponível.');
    var documento = new Construtor().parseFromString(String(html || ''), 'text/html');
    var folhas = documento.querySelectorAll('.pagina > .via');
    if (folhas.length !== 2) throw new Error('Este documento não possui duas vias separadas.');
    folhas[via === 'primeira' ? 1 : 0].remove();
    return '<!DOCTYPE html>\n' + documento.documentElement.outerHTML;
  }
  return { selecionar: selecionar };
});
