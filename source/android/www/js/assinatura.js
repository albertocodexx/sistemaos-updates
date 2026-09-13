// js/assinatura.js
//
// Tela cheia de assinatura (Parte 3). Isolado do app.js porque é um
// componente autocontido: abre, desenha no <canvas> via touch, e devolve
// o resultado (dataURL em PNG) por callback — quem chama decide o que
// fazer com a imagem (app.js injeta em .assinatura-espaco).

(function () {
  'use strict';

  var tela = document.getElementById('tela-assinatura');
  var canvas = document.getElementById('canvas-assinatura');
  var ctx = canvas.getContext('2d');
  var btnLimpar = document.getElementById('btn-limpar-assinatura');
  var btnConfirmar = document.getElementById('btn-confirmar-assinatura');
  var btnCancelar = document.getElementById('btn-cancelar-assinatura');

  var desenhando = false;
  var temTraco = false;
  var ultimoX = 0;
  var ultimoY = 0;
  var callbackConfirmar = null;
  var aberturaAtual = 0;
  var mudancaOrientacaoAtual = 0;
  var temporizadoresOrientacao = [];

  function pluginOrientacao() {
    return window.Capacitor && window.Capacitor.Plugins
      ? window.Capacitor.Plugins.ScreenOrientation
      : null;
  }

  function limparTemporizadoresOrientacao() {
    while (temporizadoresOrientacao.length) {
      clearTimeout(temporizadoresOrientacao.pop());
    }
  }

  function bloquearOrientacao(orientacao) {
    var plugin = pluginOrientacao();
    if (plugin && typeof plugin.lock === 'function') {
      return Promise.resolve(plugin.lock({ orientation: orientacao }));
    }
    var orientacaoWeb = window.screen && window.screen.orientation;
    if (orientacaoWeb && typeof orientacaoWeb.lock === 'function') {
      return Promise.resolve(orientacaoWeb.lock(orientacao));
    }
    return Promise.resolve();
  }

  function orientarParaAssinar() {
    limparTemporizadoresOrientacao();
    mudancaOrientacaoAtual += 1;
    return bloquearOrientacao('landscape-primary').catch(function () {
      return bloquearOrientacao('landscape').catch(function () {});
    });
  }

  function restaurarOrientacaoDoApp() {
    limparTemporizadoresOrientacao();
    mudancaOrientacaoAtual += 1;
    var token = mudancaOrientacaoAtual;
    var plugin = pluginOrientacao();

    // Alguns aparelhos concluem a rotação para paisagem depois que o modal
    // já foi fechado. Primeiro liberamos o bloqueio anterior e, em seguida,
    // forçamos retrato primário. Duas verificações curtas cobrem a recriação
    // tardia da Activity/WebView sem deixar o restante do aplicativo deitado.
    var liberar = plugin && typeof plugin.unlock === 'function'
      ? Promise.resolve(plugin.unlock()).catch(function () {})
      : Promise.resolve();

    function forcarRetrato() {
      if (token !== mudancaOrientacaoAtual || !tela.hidden) return Promise.resolve();
      return bloquearOrientacao('portrait-primary').catch(function () {
        return bloquearOrientacao('portrait').catch(function () {});
      });
    }

    return liberar.then(forcarRetrato).then(function () {
      [180, 650].forEach(function (atraso) {
        temporizadoresOrientacao.push(setTimeout(forcarRetrato, atraso));
      });
    });
  }

  function dimensionarCanvas() {
    // Redimensiona o canvas para ocupar o espaço real em pixels do
    // dispositivo (evita traço borrado em telas de alta densidade) sem
    // perder o desenho já feito.
    var dpr = window.devicePixelRatio || 1;
    var retangulo = canvas.getBoundingClientRect();
    var imagemAnterior = temTraco ? canvas.toDataURL() : null;

    if (!retangulo.width || !retangulo.height) return;
    canvas.width = Math.round(retangulo.width * dpr);
    canvas.height = Math.round(retangulo.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    configurarTraco();

    if (imagemAnterior) {
      var img = new Image();
      img.onload = function () {
        ctx.drawImage(img, 0, 0, retangulo.width, retangulo.height);
      };
      img.src = imagemAnterior;
    }
  }

  function configurarTraco() {
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
  }

  // Margem (em pixels do próprio canvas, antes do devicePixelRatio) deixada
  // ao redor do traço depois de recortar o espaço em branco. Sem ela o
  // traço ficaria colado na borda da imagem final — sem "respiro" nenhum,
  // o que também prejudica a leitura no papel.
  var MARGEM_RECORTE_PX = 6;

  // PROBLEMA QUE ESTA FUNÇÃO RESOLVE:
  // canvas.toDataURL() sozinho captura o retângulo INTEIRO do canvas,
  // incluindo toda a área transparente ao redor do traço. Como o elemento
  // <canvas> é largo e baixo (flex:1;width:100%, ocupando a tela toda em
  // celular) e a pessoa tende a assinar perto do meio vertical dessa faixa
  // — não colada na borda de baixo — a imagem final carrega uma faixa
  // transparente considerável entre o traço e a base da própria imagem.
  // No PDF (js/assinatura-injetor.js), a imagem é ancorada com
  // "position:absolute;bottom:0" sobre ".assinatura-espaco", exatamente
  // para pousar em cima da linha de assinatura — mas isso ancora a BASE DA
  // CAIXA da imagem, não o traço de tinta em si. Se a caixa é mais alta que
  // o traço (por causa dessa faixa transparente), sobra um espaço visível
  // entre a assinatura e a linha, em vez de "pousar exatamente" nela.
  //
  // A correção: antes de gerar o dataURL final, varremos os pixels do
  // canvas para achar o menor retângulo que contém todo pixel não
  // totalmente transparente (o "bounding box" do traço de tinta), e
  // recortamos a imagem para esse retângulo (+ uma margem pequena). Assim
  // a base da imagem final já corresponde à base real do traço.
  function recortarParaConteudo(canvasOrigem) {
    var larguraCss = canvasOrigem.getBoundingClientRect().width || canvasOrigem.width;
    var w = canvasOrigem.width;
    var h = canvasOrigem.height;
    var ctxOrigem = canvasOrigem.getContext('2d');
    var dados;
    try {
      dados = ctxOrigem.getImageData(0, 0, w, h).data;
    } catch (e) {
      // Ambiente sem suporte a getImageData (não deveria acontecer em
      // WebView/navegador normal) — devolve o canvas original sem recorte
      // em vez de quebrar a assinatura inteira.
      return canvasOrigem;
    }

    var minX = w, minY = h, maxX = -1, maxY = -1;
    // Varre só o canal alpha (índice 3, 4 em 4 — RGBA) procurando o menor
    // retângulo que envolve todo pixel com alpha > 0.
    for (var y = 0; y < h; y++) {
      var linhaBase = y * w * 4;
      for (var x = 0; x < w; x++) {
        var alpha = dados[linhaBase + x * 4 + 3];
        if (alpha > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0) {
      // Nenhum pixel desenhado (canvas vazio) — não deveria chegar aqui,
      // já que btnConfirmar só habilita com temTraco=true, mas devolve o
      // canvas original como defesa extra em vez de gerar erro.
      return canvasOrigem;
    }

    // Margem convertida para a escala real do canvas (devicePixelRatio),
    // não em pixels CSS, já que estamos operando direto no buffer de pixels.
    var escala = larguraCss ? (w / larguraCss) : 1;
    var margem = Math.round(MARGEM_RECORTE_PX * escala);

    minX = Math.max(0, minX - margem);
    minY = Math.max(0, minY - margem);
    maxX = Math.min(w - 1, maxX + margem);
    maxY = Math.min(h - 1, maxY + margem);

    var larguraRecorte = maxX - minX + 1;
    var alturaRecorte = maxY - minY + 1;

    var canvasRecortado = document.createElement('canvas');
    canvasRecortado.width = larguraRecorte;
    canvasRecortado.height = alturaRecorte;
    var ctxRecortado = canvasRecortado.getContext('2d');
    ctxRecortado.drawImage(
      canvasOrigem,
      minX, minY, larguraRecorte, alturaRecorte,
      0, 0, larguraRecorte, alturaRecorte
    );

    return canvasRecortado;
  }

  function posicaoRelativa(evento) {
    var retangulo = canvas.getBoundingClientRect();
    var ponto = evento.touches && evento.touches.length ? evento.touches[0] : evento;
    return {
      x: ponto.clientX - retangulo.left,
      y: ponto.clientY - retangulo.top
    };
  }

  function iniciarTraco(evento) {
    evento.preventDefault();
    desenhando = true;
    var p = posicaoRelativa(evento);
    ultimoX = p.x;
    ultimoY = p.y;
    // Ponto único (toque sem arrastar) também deve marcar um pingo visível.
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    marcarComoAssinado();
  }

  function continuarTraco(evento) {
    if (!desenhando) return;
    evento.preventDefault();
    var p = posicaoRelativa(evento);
    ctx.beginPath();
    ctx.moveTo(ultimoX, ultimoY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimoX = p.x;
    ultimoY = p.y;
  }

  function encerrarTraco(evento) {
    if (evento) evento.preventDefault();
    desenhando = false;
  }

  function marcarComoAssinado() {
    if (temTraco) return;
    temTraco = true;
    btnConfirmar.disabled = false;
  }

  function limparCanvas() {
    var retangulo = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, retangulo.width, retangulo.height);
    temTraco = false;
    btnConfirmar.disabled = true;
  }

  // Touch (uso real em celular).
  canvas.addEventListener('touchstart', iniciarTraco, { passive: false });
  canvas.addEventListener('touchmove', continuarTraco, { passive: false });
  canvas.addEventListener('touchend', encerrarTraco, { passive: false });
  canvas.addEventListener('touchcancel', encerrarTraco, { passive: false });

  // Mouse (facilita testar no navegador do desktop; não substitui o touch).
  canvas.addEventListener('mousedown', iniciarTraco);
  canvas.addEventListener('mousemove', continuarTraco);
  window.addEventListener('mouseup', encerrarTraco);

  btnLimpar.addEventListener('click', limparCanvas);
  if (btnCancelar) btnCancelar.addEventListener('click', fechar);

  btnConfirmar.addEventListener('click', function () {
    if (!temTraco) return; // defesa extra além do disabled
    // Recorta para o bounding box real do traço (+ margem) antes de gerar
    // o dataURL final — ver comentário de recortarParaConteudo() para o
    // problema que isso resolve (assinatura "flutuando" longe da linha no
    // PDF, por causa do espaço transparente sobrando ao redor do traço).
    var dataUrl = recortarParaConteudo(canvas).toDataURL('image/png');
    // Guarda o callback ANTES de fechar() — fechar() zera
    // callbackConfirmar (pra evitar reuso acidental numa próxima
    // abertura), então chamar a checagem/invocação depois dele faz o
    // callback nunca disparar. Este era um bug real: o botão "Confirmar"
    // nunca entregava a assinatura a quem chamou abrir(), em nenhum dos
    // fluxos (OS, Compra, Venda, assinatura padrão da assistência).
    var callback = callbackConfirmar;
    fechar();
    if (typeof callback === 'function') callback(dataUrl);
  });

  window.addEventListener('resize', function () {
    if (!tela.hidden) dimensionarCanvas();
  });

  function agendarDimensionamento(token) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (!tela.hidden && token === aberturaAtual) dimensionarCanvas();
      });
    });
  }

  function abrir(aoConfirmar) {
    limparTemporizadoresOrientacao();
    callbackConfirmar = aoConfirmar;
    aberturaAtual += 1;
    var token = aberturaAtual;
    tela.hidden = false;
    document.documentElement.classList.add('assinatura-aberta');
    temTraco = false;
    btnConfirmar.disabled = true;
    // A captura abre deitada para oferecer uma área larga, parecida com a
    // linha do documento. O duplo frame mede somente depois de o Android
    // concluir a rotação e de o novo layout estar visível.
    orientarParaAssinar().then(function () { agendarDimensionamento(token); });
    agendarDimensionamento(token);
  }

  function fechar() {
    aberturaAtual += 1;
    tela.hidden = true;
    document.documentElement.classList.remove('assinatura-aberta');
    callbackConfirmar = null;
    return restaurarOrientacaoDoApp();
  }

  // Se o Android suspender e recriar a Activity durante a assinatura, garanta
  // retrato assim que o app voltar a ficar visível e o modal já estiver fechado.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && tela.hidden) restaurarOrientacaoDoApp();
  });
  window.addEventListener('pageshow', function () {
    if (tela.hidden) restaurarOrientacaoDoApp();
  });

  window.SistemaOSAssinatura = { abrir: abrir, fechar: fechar };
})();
