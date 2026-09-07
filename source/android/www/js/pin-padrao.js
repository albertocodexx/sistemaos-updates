// js/pin-padrao.js
//
// Tela cheia de "padrão de desbloqueio" (grade 3x3 estilo Android), espelhando
// o recurso que já existe no sistema do PC. Isolado do app.js pelo mesmo
// motivo de js/assinatura.js: é um componente autocontido — abre, deixa a
// pessoa arrastar o dedo conectando pontos, e devolve o resultado por
// callback pra quem chamou decidir o que fazer com ele.
//
// DECISÃO DE FORMATO (igual ao PC): o resultado NÃO é uma imagem nem uma
// estrutura de dado nova — é um texto tipo "Padrão: 1-5-9-8-7", escrito
// diretamente dentro do MESMO <input type="text"> de senha que já existe
// (aparelho-senha na OS, compra-aparelho-senha na Compra). Isso significa
// que a exportação pro PC (lote v2, montarObjetoOS/montarObjetoCompra) já
// carrega esse valor de graça, sem precisar tocar no formato do lote nem no
// contrato de dados — o campo de senha continua sendo, para todo o resto do
// sistema, um texto comum.
//
// USO: qualquer botão com data-alvo-pin="id-do-input" abre esta tela e, ao
// confirmar, escreve o resumo no input alvo (dispara 'input' pra qualquer
// listener de validação existente reagir normalmente).

(function () {
  'use strict';

  var tela = document.getElementById('tela-pin');
  var svg = document.getElementById('pin-svg');
  var elResumo = document.getElementById('pin-resumo');
  var btnLimpar = document.getElementById('btn-limpar-pin');
  var btnConfirmar = document.getElementById('btn-confirmar-pin');

  // Grade 3x3 fixa em coordenadas do viewBox (0 0 300 300) — 9 pontos
  // numerados 1..9, esquerda→direita, cima→baixo (mesma numeração do PC).
  var COLUNAS = [70, 150, 230];
  var LINHAS = [70, 150, 230];
  var RAIO_NUCLEO = 10;
  var RAIO_ANEL = 26;
  // Distância máxima (em unidades do viewBox) do dedo até um ponto pra
  // considerá-lo "alcançado" durante o arrasto — folga generosa pro toque
  // impreciso do dedo, sem ativar pontos vizinhos por engano na grade 3x3.
  var RAIO_TOQUE = 34;

  var pontos = []; // [{ n, x, y, nucleo, anel }]
  var sequencia = []; // números 1..9 na ordem em que foram tocados
  var arrastando = false;
  var callbackConfirmar = null;

  function montarGrade() {
    svg.innerHTML = '';
    pontos = [];
    var n = 1;
    for (var li = 0; li < 3; li++) {
      for (var ci = 0; ci < 3; ci++) {
        var x = COLUNAS[ci];
        var y = LINHAS[li];

        var anel = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        anel.setAttribute('cx', x);
        anel.setAttribute('cy', y);
        anel.setAttribute('r', RAIO_ANEL);
        anel.setAttribute('class', 'pin-ponto-anel');
        svg.appendChild(anel);

        var nucleo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        nucleo.setAttribute('cx', x);
        nucleo.setAttribute('cy', y);
        nucleo.setAttribute('r', RAIO_NUCLEO);
        nucleo.setAttribute('class', 'pin-ponto-nucleo');
        svg.appendChild(nucleo);

        pontos.push({ n: n, x: x, y: y, nucleo: nucleo, anel: anel });
        n++;
      }
    }
  }

  // Linha "fantasma" (cinza) conectando todos os pontos, desenhada por
  // baixo, só pra dar a dica visual da grade — igual ao PC.
  var linhaFixaEl = null;
  function desenharLinhasFixas() {
    // Não há uma única linha fixa "óbvia" (a grade toda é a dica visual dos
    // próprios pontos+anéis) — mantido como no-op explícito por clareza;
    // se um dia quisermos guias diagonais/retas fixas, entram aqui.
  }

  var linhaAtivaEl = null;
  function criarLinhaAtiva() {
    linhaAtivaEl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    linhaAtivaEl.setAttribute('class', 'pin-linha-ativa');
    linhaAtivaEl.setAttribute('points', '');
    // Insere antes do primeiro ponto (fica por baixo dos círculos, por
    // cima do fundo) — os pontos foram inseridos primeiro em montarGrade(),
    // então inserir agora já garante essa ordem (SVG desenha na ordem do
    // DOM: quem vem depois fica por cima).
    svg.appendChild(linhaAtivaEl);
  }

  function atualizarLinhaAtiva(pontoAtualXY) {
    var coords = sequencia.map(function (num) {
      var p = pontoPorNumero(num);
      return p.x + ',' + p.y;
    });
    if (pontoAtualXY) {
      coords.push(pontoAtualXY.x + ',' + pontoAtualXY.y);
    }
    linhaAtivaEl.setAttribute('points', coords.join(' '));
  }

  function pontoPorNumero(n) {
    for (var i = 0; i < pontos.length; i++) {
      if (pontos[i].n === n) return pontos[i];
    }
    return null;
  }

  function marcarPontoAtivo(p) {
    p.nucleo.classList.add('ativo');
    p.anel.classList.add('ativo');
  }

  function limparMarcacoes() {
    for (var i = 0; i < pontos.length; i++) {
      pontos[i].nucleo.classList.remove('ativo');
      pontos[i].anel.classList.remove('ativo');
    }
  }

  function coordenadaSvg(evento) {
    var ponto = evento.touches && evento.touches.length ? evento.touches[0] : evento;
    var retangulo = svg.getBoundingClientRect();
    // Converte coordenada de tela (px CSS) pra coordenada do viewBox
    // (0 0 300 300), já que o SVG escala com a largura da grade.
    var escalaX = 300 / retangulo.width;
    var escalaY = 300 / retangulo.height;
    return {
      x: (ponto.clientX - retangulo.left) * escalaX,
      y: (ponto.clientY - retangulo.top) * escalaY
    };
  }

  function pontoMaisProximo(xy) {
    var melhor = null;
    var melhorDist = RAIO_TOQUE;
    for (var i = 0; i < pontos.length; i++) {
      var p = pontos[i];
      var dx = p.x - xy.x;
      var dy = p.y - xy.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= melhorDist) {
        melhor = p;
        melhorDist = dist;
      }
    }
    return melhor;
  }

  function atualizarResumoEBotao() {
    if (sequencia.length === 0) {
      elResumo.textContent = '';
      btnConfirmar.disabled = true;
      return;
    }
    elResumo.textContent = 'Padrão: ' + sequencia.join('-');
    // Padrão precisa de pelo menos 2 pontos pra ter algum valor como
    // "desbloqueio" (1 ponto sozinho não distingue nada) — mesma regra
    // mínima usada no Android real.
    btnConfirmar.disabled = sequencia.length < 2;
  }

  function iniciarArrasto(evento) {
    evento.preventDefault();
    limpar();
    arrastando = true;
    var xy = coordenadaSvg(evento);
    var p = pontoMaisProximo(xy);
    if (p) {
      sequencia.push(p.n);
      marcarPontoAtivo(p);
    }
    atualizarLinhaAtiva(xy);
    atualizarResumoEBotao();
  }

  function continuarArrasto(evento) {
    if (!arrastando) return;
    evento.preventDefault();
    var xy = coordenadaSvg(evento);
    var p = pontoMaisProximo(xy);
    if (p && sequencia.indexOf(p.n) === -1) {
      sequencia.push(p.n);
      marcarPontoAtivo(p);
      atualizarResumoEBotao();
    }
    atualizarLinhaAtiva(xy);
  }

  function encerrarArrasto(evento) {
    if (evento) evento.preventDefault();
    arrastando = false;
    // Fecha a linha exatamente no último ponto tocado (remove o "rabo"
    // solto que seguia o dedo até a posição de soltar o toque).
    atualizarLinhaAtiva(null);
  }

  function limpar() {
    sequencia = [];
    limparMarcacoes();
    atualizarLinhaAtiva(null);
    atualizarResumoEBotao();
  }

  // Lê "Padrão: 1-5-9-8-7" do valor atual do campo (se já tiver um padrão
  // salvo) e devolve os números como array, ou [] se estiver vazio ou não
  // for nesse formato (ex.: senha digitada à mão) — nesse caso não há nada
  // pra pré-desenhar, a tela abre limpa como já acontecia antes.
  function lerPadraoExistente(valorCampo) {
    var m = /^Padrão:\s*([1-9](?:-[1-9]){1,8})\s*$/.exec((valorCampo || '').trim());
    if (!m) return [];
    var partes = m[1].split('-');
    var nums = [];
    var vistos = {};
    for (var i = 0; i < partes.length; i++) {
      var n = Number(partes[i]);
      // Defesa: 1..9 sem repetição — um valor fora disso não é um padrão
      // válido desta grade, trata como "não reconhecido" em vez de
      // desenhar algo quebrado.
      if (n < 1 || n > 9 || vistos[n]) return [];
      vistos[n] = true;
      nums.push(n);
    }
    return nums;
  }

  // Redesenha um padrão já existente (pontos ativos + linha conectando-os
  // na ordem original), sem precisar de arrasto — mesmo efeito visual de
  // tê-lo acabado de desenhar. Usado ao reabrir a tela com um campo que já
  // tem um padrão salvo.
  function redesenharPadrao(nums) {
    for (var i = 0; i < nums.length; i++) {
      var p = pontoPorNumero(nums[i]);
      if (!p) continue;
      sequencia.push(p.n);
      marcarPontoAtivo(p);
    }
    atualizarLinhaAtiva(null);
    atualizarResumoEBotao();
  }

  svg.addEventListener('touchstart', iniciarArrasto, { passive: false });
  svg.addEventListener('touchmove', continuarArrasto, { passive: false });
  svg.addEventListener('touchend', encerrarArrasto, { passive: false });
  svg.addEventListener('touchcancel', encerrarArrasto, { passive: false });

  // Mouse — só pra facilitar testar no navegador de desktop, igual ao
  // mesmo padrão já adotado em js/assinatura.js.
  svg.addEventListener('mousedown', iniciarArrasto);
  svg.addEventListener('mousemove', continuarArrasto);
  window.addEventListener('mouseup', encerrarArrasto);

  btnLimpar.addEventListener('click', limpar);

  btnConfirmar.addEventListener('click', function () {
    if (sequencia.length < 2) return; // defesa extra além do disabled
    var resumo = 'Padrão: ' + sequencia.join('-');
    // Mesmo cuidado de js/assinatura.js: guarda o callback ANTES de
    // fechar() (que zera callbackConfirmar), pra não perder a referência.
    var callback = callbackConfirmar;
    fechar();
    if (typeof callback === 'function') callback(resumo);
  });

  function abrir(aoConfirmar, valorAtualDoCampo) {
    callbackConfirmar = aoConfirmar;
    limpar();
    var numsExistentes = lerPadraoExistente(valorAtualDoCampo);
    if (numsExistentes.length) redesenharPadrao(numsExistentes);
    tela.hidden = false;
  }

  function fechar() {
    tela.hidden = true;
    callbackConfirmar = null;
  }

  montarGrade();
  desenharLinhasFixas();
  criarLinhaAtiva();

  // Liga qualquer botão com data-alvo-pin ao input correspondente. Os
  // scripts estão no fim do <body> sem defer/async (confirmado em
  // index.html), então o DOM já existe neste ponto — não há necessidade
  // (nem garantia de disparo) de esperar por DOMContentLoaded aqui.
  var botoesPin = document.querySelectorAll('[data-alvo-pin]');
  for (var i = 0; i < botoesPin.length; i++) {
    (function (botao) {
      botao.addEventListener('click', function () {
        var idAlvo = botao.getAttribute('data-alvo-pin');
        var input = document.getElementById(idAlvo);
        if (!input) return;
        abrir(function (resumo) {
          input.value = resumo;
          // Dispara 'input' pra qualquer listener de validação/contador
          // de caracteres já existente no campo reagir normalmente, como
          // se a pessoa tivesse digitado o texto.
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, input.value);
      });
    })(botoesPin[i]);
  }

  window.SistemaOSPinPadrao = { abrir: abrir };
})();
