// js/navegacao-voltar.js
//
// PROBLEMA: no APK gerado pelo Capacitor (ver GUIA-GERAR-APK-CAPACITOR.md),
// o botão físico de voltar do Android, sem nenhum tratamento, faz o
// comportamento padrão do WebView: sai do app direto, de qualquer tela,
// mesmo estando no meio de preencher um formulário ou olhando uma prévia.
// O usuário some do app sem querer, e no pior caso perde o que estava
// digitando (o formulário não é salvo automaticamente).
//
// CORREÇÃO: este módulo escuta o evento 'backButton' do plugin
// @capacitor/app (ver Passo 4 do guia, onde ele foi adicionado) e, em vez
// de deixar o Android fechar o app, resolve "um nível para trás" dentro do
// próprio app — só saindo de verdade quando já não há mais nível nenhum
// pra voltar (ou seja, já está na tela inicial/"raiz").
//
// A pilha de navegação, do nível mais "profundo" para o mais "raso":
//   1) tela-assinatura / tela-pin (camadas cheias por cima de tudo) ->
//      fecha a tela (sem confirmar nenhum traço/padrão), volta pra tela
//      de baixo. A ordem entre as duas não importa: na prática nunca
//      ficam abertas ao mesmo tempo.
//   2) painel-preview em modo histórico -> volta para o histórico
//      (replica o que btnVoltarHistorico.click() já faz).
//   3) painel-preview em modo normal -> volta para o formulário do tipo de
//      documento atual (replica exatamente o que btnEditar.click() já
//      faz: compra -> tela 'compra', venda -> tela 'venda', senão 'form').
//   4) painel-doc-detalhe (detalhe de um documento recebido, aba
//      "Documentos") -> volta para a lista de documentos recebidos
//      (replica o que btn-voltar-doc-lista.click() já faz).
//   5) qualquer aba "raiz" (form / compra / venda / historico / config)
//      -> não há mais nível pra voltar dentro do app: deixa o Android
//      seguir com o comportamento padrão dele (minimizar/fechar o app),
//      chamando App.exitApp() explicitamente.
//
// Não duplica lógica de navegação: chama os MESMOS botões que o usuário
// clicaria (btnVoltarHistorico, btnEditar) via .click(), e só fecha a
// tela de assinatura via a função abaixo, já que ela não é reaproveitável
// por clique (o botão "Confirmar" exige um traço desenhado; o de voltar
// não deveria exigir isso).
(function () {
  'use strict';

  function elementoVisivel(el) {
    return !!el && !el.hidden;
  }

  // Fecha a tela de assinatura sem exigir confirmação de um traço.
  // js/assinatura.js só expõe `abrir` em window.SistemaOSAssinatura (por
  // design: o fluxo normal só fecha via handler interno do botão
  // Confirmar). Para o botão de voltar, replicamos aqui o mesmo efeito
  // de fechar() (tela.hidden = true) sem chamar nenhum callback, porque
  // voltar não é o mesmo que confirmar uma assinatura em branco.
  function fecharTelaAssinaturaSemConfirmar() {
    var tela = document.getElementById('tela-assinatura');
    if (tela) tela.hidden = true;
  }

  // Mesma ideia acima, mas para a tela cheia do padrão de PIN
  // (js/pin-padrao.js), que também só expõe `abrir` em
  // window.SistemaOSPinPadrao — o botão de voltar não deve exigir um
  // padrão desenhado pra fechar, então replicamos aqui o mesmo efeito de
  // fechar() sem chamar nenhum callback.
  function fecharTelaPinSemConfirmar() {
    var tela = document.getElementById('tela-pin');
    if (tela) tela.hidden = true;
  }

  // Retorna true se resolveu a navegação dentro do app (não deve sair).
  // Retorna false se já está numa tela raiz (deve sair / deixar o Android
  // seguir com o comportamento padrão dele).
  function voltarUmNivel() {
    var desbloqueioPreview = document.querySelector('.desbloqueio-preview-modal');
    if (desbloqueioPreview) { desbloqueioPreview.remove(); return true; }
    // O primeiro "voltar" durante a leitura fecha somente a câmera e mantém
    // o técnico dentro da aba Ler QR.
    if (window.SistemaOSQRCode && window.SistemaOSQRCode.leituraAtiva()) {
      window.SistemaOSQRCode.cancelarLeitura().catch(function () {});
      return true;
    }

    var telaAssinatura = document.getElementById('tela-assinatura');
    if (elementoVisivel(telaAssinatura)) {
      fecharTelaAssinaturaSemConfirmar();
      return true;
    }

    var telaPin = document.getElementById('tela-pin');
    if (elementoVisivel(telaPin)) {
      fecharTelaPinSemConfirmar();
      return true;
    }

    var painelPreview = document.getElementById('painel-preview');
    if (elementoVisivel(painelPreview)) {
      var btnVoltarHistorico = document.getElementById('btn-voltar-historico');
      var btnEditar = document.getElementById('btn-editar');
      // btnVoltarHistorico só fica visível (não-hidden) quando o preview
      // está em modo histórico — mesmo sinal que configurarPainelPreview
      // usa para decidir emModoHistorico, sem precisar acessar a variável
      // interna de app.js (que não é exportada).
      if (elementoVisivel(btnVoltarHistorico)) {
        btnVoltarHistorico.click();
      } else if (btnEditar) {
        btnEditar.click();
      }
      return true;
    }

    // painel-doc-detalhe: detalhe de um documento recebido (aba
    // "Documentos"). Mesmo padrão do painel-preview acima: replica o
    // clique do botão que o usuário já usaria, em vez de duplicar a
    // lógica de troca de tela que documentos-recebidos.js já tem.
    var painelDocDetalhe = document.getElementById('painel-doc-detalhe');
    if (elementoVisivel(painelDocDetalhe)) {
      var btnVoltarDocs = document.getElementById('btn-voltar-doc-lista');
      if (btnVoltarDocs) {
        btnVoltarDocs.click();
      }
      return true;
    }

    // Já está numa aba raiz (form/compra/venda/historico/config): não há
    // mais nada para "voltar" dentro do app.
    return false;
  }

  function aoAcionarVoltar(evento) {
    var resolvidoDentroDoApp = voltarUmNivel();
    if (resolvidoDentroDoApp) {
      return;
    }
    // Chegou numa tela raiz: deixa o Android sair do app de verdade
    // (comportamento padrão esperado nesse ponto da navegação).
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.exitApp();
    }
    // Fora do Capacitor (navegador comum), não há "sair do app" — não faz
    // nada além de já ter resolvido (ou não) a navegação interna.
  }

  // Integração real: plugin @capacitor/app, só existe dentro do APK
  // gerado pelo Capacitor (ver Passo 4 do guia). Em navegador comum,
  // window.Capacitor não existe e este bloco é ignorado sem erro.
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', aoAcionarVoltar);
  }

  // Fallback SÓ para testar a mesma lógica no navegador de desktop, sem
  // precisar gerar o APK a cada ajuste: tecla Escape aciona a função
  // exportada abaixo. Não tem efeito nenhum no APK real (lá quem aciona é
  // o listener do Capacitor acima), e não substitui o teste no celular
  // físico antes de publicar.
  document.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape') aoAcionarVoltar(evento);
  });

  // Exposto para testes automatizados headless (sem depender de simular
  // uma tecla) e para eventual uso futuro por outro módulo.
  window.SistemaOSNavegacaoVoltar = { voltarUmNivel: voltarUmNivel };
})();
