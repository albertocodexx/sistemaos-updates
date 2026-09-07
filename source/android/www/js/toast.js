// js/toast.js
//
// Notificação flutuante (popup, estilo "toast" de app nativo) que aparece
// no topo da tela, some sozinha depois de um tempo, e empilha se mais de
// uma for disparada em sequência rápida.
//
// Ponto único de exibição — substitui a mensagem inline "no final da
// tela" (.feedback-acao) que existia em 4 lugares diferentes (app.js:
// mostrarFeedback e mostrarFeedbackPendentes; documentos-recebidos.js:
// mostrarFeedback; config-tela.js: trecho solto no submit do formulário).
// Esses 4 pontos continuam existindo e decidindo QUANDO e COM QUE TEXTO
// notificar (toda a lógica de negócio around "sucesso" vs "erro" já
// funciona e não foi tocada) — eles só passaram a chamar
// window.SistemaOSToast.mostrar(...) em vez de escrever num elemento
// .feedback-acao fixo na própria tela. Ver cada arquivo para a mudança
// mínima equivalente.

(function () {
  'use strict';

  var CHAVE_ANIM_ENTRADA = 'toast-entrando';
  var CHAVE_ANIM_SAIDA = 'toast-saindo';
  var DURACAO_PADRAO_MS = 3200;
  var DURACAO_ERRO_MS = 4200; // erros ficam um pouco mais para dar tempo de ler
  var DURACAO_ANIMACAO_SAIDA_MS = 220; // precisa bater com a transição no CSS

  var container = null;

  function obterContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
    return container;
  }

  // mostrar(mensagem, opcoes?)
  //   opcoes.ehErro (bool) — mesmo papel que o antigo segundo parâmetro
  //     `ehErro` de mostrarFeedback/mostrarFeedbackPendentes: troca a cor
  //     para o tom de erro e aumenta um pouco a duração.
  //   opcoes.duracaoMs (number) — sobrescreve a duração automática, para
  //     casos raros que precisem de mais tempo (não usado hoje, mas evita
  //     precisar mexer neste módulo se surgir a necessidade).
  function mostrar(mensagem, opcoes) {
    opcoes = opcoes || {};
    var ehErro = !!opcoes.ehErro;
    var duracao = opcoes.duracaoMs || (ehErro ? DURACAO_ERRO_MS : DURACAO_PADRAO_MS);

    var el = document.createElement('div');
    el.className = 'toast' + (ehErro ? ' toast-erro' : '');
    el.textContent = mensagem;

    var pai = obterContainer();
    pai.appendChild(el);

    // Força um reflow antes de adicionar a classe de entrada, para que a
    // transição CSS realmente anime a partir do estado inicial (sem isso,
    // o navegador pode aplicar a classe "de uma vez", sem transição).
    void el.offsetWidth;
    el.classList.add(CHAVE_ANIM_ENTRADA);

    var jaRemovido = false;
    function remover() {
      if (jaRemovido) return;
      jaRemovido = true;
      el.classList.remove(CHAVE_ANIM_ENTRADA);
      el.classList.add(CHAVE_ANIM_SAIDA);
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, DURACAO_ANIMACAO_SAIDA_MS);
    }

    // Toque/clique no toast dispensa na hora, sem esperar o timer — útil
    // quando várias notificações empilham e a pessoa quer limpar rápido.
    el.addEventListener('click', remover);

    setTimeout(remover, duracao);

    return { remover: remover };
  }

  window.SistemaOSToast = { mostrar: mostrar };
})();
