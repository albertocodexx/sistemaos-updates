// js/marca-app.js
//
// Atualiza o cabeçalho do app (.topo) para refletir a identidade da
// assistência técnica configurada em Configurações:
// - Se houver logo salva (cfg.logoBase64), mostra a logo no lugar do
//   título de texto.
// - Se não houver logo mas houver nome fantasia salvo (cfg.nomeFantasia),
//   troca o texto "Sistema OS — App do Celular" pelo nome da assistência.
// - Se nenhum dos dois estiver preenchido, mantém o texto padrão original
//   ("Sistema OS — App do Celular") — comportamento de fábrica inalterado.
//
// Isolado dos outros módulos (como config-tela.js) porque só LÊ a config
// já salva — nunca escreve nela. Roda:
// 1) uma vez ao carregar a página (estado inicial do header);
// 2) toda vez que o formulário de Configurações é salvo com sucesso,
//    via o evento customizado 'sistema-os:config-salva' (disparado por
//    config-tela.js logo após ConfigApp.salvarConfig() ter sucesso).

(function () {
  'use strict';

  var logoEl = document.getElementById('topo-logo');
  var tituloEl = document.getElementById('topo-titulo');
  if (!tituloEl) return; // header nesta versão do HTML não tem os ids esperados

  var TITULO_PADRAO = tituloEl.textContent;

  function aplicarIdentidade() {
    var cfg = window.ConfigApp ? window.ConfigApp.carregarConfig() : null;
    var logoBase64 = (cfg && cfg.logoBase64) || '';
    var nomeFantasia = (cfg && cfg.nomeFantasia) ? cfg.nomeFantasia.trim() : '';

    if (logoEl) {
      if (logoBase64) {
        logoEl.src = logoBase64;
        logoEl.alt = nomeFantasia || 'Logo da assistência técnica';
        logoEl.dataset.marca = 'empresa';
        logoEl.hidden = false;
      } else {
        logoEl.src = 'assets/logo-os-white.png';
        logoEl.alt = 'Sistema OS';
        logoEl.dataset.marca = 'sistema';
        logoEl.hidden = false;
      }
    }

    // O nome por extenso continua presente mesmo com logo (acessibilidade,
    // leitor de tela, título da aba) — só o texto muda, entre o padrão de
    // fábrica e o nome fantasia salvo. A logo, quando existe, é exibida ao
    // lado do texto (ver .topo-identidade no CSS), não no lugar dele.
    tituloEl.textContent = nomeFantasia || TITULO_PADRAO;
  }

  // Estado inicial, assim que o script carrega (mesmo timing de
  // TemaApp.inicializarDeConfig em app.js — antes do primeiro paint útil).
  aplicarIdentidade();

  // Reaplica sempre que Configurações for salva com sucesso.
  document.addEventListener('sistema-os:config-salva', aplicarIdentidade);
})();
