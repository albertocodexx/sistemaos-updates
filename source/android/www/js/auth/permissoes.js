/** Contexto de autorização carregado após o login. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSPermissoes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var contextoAtual = null;

  function definirContexto(contexto) {
    contextoAtual = contexto ? JSON.parse(JSON.stringify(contexto)) : null;
  }

  function limpar() {
    contextoAtual = null;
  }

  function obterContexto() {
    return contextoAtual ? JSON.parse(JSON.stringify(contextoAtual)) : null;
  }

  function pode(modulo, acao) {
    if (!contextoAtual || contextoAtual.usuario_ativo !== true || contextoAtual.empresa_ativa !== true) {
      return false;
    }
    var cargo = String(contextoAtual.cargo || '').toLowerCase();
    if (['administrador', 'admin', 'proprietário', 'proprietario'].indexOf(cargo) !== -1) return true;
    var permissoes = contextoAtual.permissoes || {};
    return !!(
      permissoes['*'] && permissoes['*']['*'] === true ||
      permissoes[modulo] && permissoes[modulo][acao] === true
    );
  }

  return { definirContexto: definirContexto, limpar: limpar, obterContexto: obterContexto, pode: pode };
});
