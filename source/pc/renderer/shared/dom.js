// Utilitários de acesso ao DOM usados pelo renderer principal.
(function iniciarRendererDom() {
  'use strict';

  function porId(id) {
    return document.getElementById(id);
  }

  window.RendererDom = Object.freeze({ porId });
})();
