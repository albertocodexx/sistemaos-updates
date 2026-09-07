// Atualiza os textos de versão da tela de login a partir do package.json.
(function sincronizarVersaoExibidaNoBoot() {
  'use strict';

  if (!window.api?.updateVersaoAtual) return;

  window.api.updateVersaoAtual().then(versao => {
    if (!versao) return;

    document.title = 'Sistema OS';
    const badgeVersao = document.querySelector('.login-brand-versao');
    if (badgeVersao) badgeVersao.textContent = 'v' + versao;

    const rodape = document.querySelector('.login-brand-footer');
    if (rodape) {
      rodape.innerHTML = `&copy; 2026 Sistema OS v${versao} &mdash; Assistência Técnica &amp; Gestão`;
    }
  }).catch(() => {});
})();
