'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const ler = rel => fs.readFileSync(path.join(raiz, rel), 'utf8');

(async () => {
  const pagina = ler('www/index.html');
  const trecho = pagina.match(/<div id="tela-assinatura"[\s\S]*?<!-- Tela cheia do padrão/);
  assert.ok(trecho, 'A tela de assinatura deve existir no HTML');

  const dom = new JSDOM('<!doctype html><html><body>' + trecho[0].replace(/<!-- Tela cheia do padrão[\s\S]*/, '') + '</body></html>', {
    url: 'https://qa.local',
    runScripts: 'outside-only'
  });
  const w = dom.window;
  const orientacoes = [];
  let desbloqueios = 0;

  w.requestAnimationFrame = callback => { callback(); return 1; };
  w.Capacitor = { Plugins: { ScreenOrientation: {
    async lock(opcoes) { orientacoes.push(opcoes.orientation); },
    async unlock() { desbloqueios += 1; }
  } } };
  w.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 640, height: 220, right: 640, bottom: 220 };
  };
  w.HTMLCanvasElement.prototype.getContext = function () {
    return {
      setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {},
      moveTo() {}, lineTo() {}, stroke() {}, drawImage() {},
      getImageData() { return { data: new Uint8ClampedArray(640 * 220 * 4) }; }
    };
  };
  w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,TESTE'; };

  try {
    w.eval(ler('www/js/assinatura.js'));
    w.SistemaOSAssinatura.abrir(() => {});
    await Promise.resolve();
    assert.equal(w.document.getElementById('tela-assinatura').hidden, false);
    assert.equal(orientacoes[0], 'landscape-primary', 'Ao abrir, a assinatura deve travar o celular de lado');
    assert.ok(w.document.querySelector('.assinatura-linha'), 'A superfície deve mostrar a linha de assinatura');
    assert.match(w.document.querySelector('.assinatura-legenda').textContent, /ASSINE ACIMA DA LINHA/);

    w.document.getElementById('btn-cancelar-assinatura').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(w.document.getElementById('tela-assinatura').hidden, true);
    assert.ok(desbloqueios >= 1, 'Ao sair, deve liberar o bloqueio anterior antes de voltar ao retrato');
    assert.equal(orientacoes.at(-1), 'portrait-primary', 'Ao sair, o aplicativo deve voltar para o modo em pé normal');
    assert.match(ler('www/js/assinatura.js'), /\[180, 650\]/, 'A volta ao retrato deve ser repetida após a reconfiguração da WebView');

    const css = ler('www/css/app.css');
    assert.match(css, /\.assinatura-papel[\s\S]*border: 2px solid/);
    assert.match(css, /\.assinatura-linha[\s\S]*bottom: 25%/);
    assert.match(css, /\.canvas-assinatura[\s\S]*background: transparent/);
    console.log('OK: assinatura abre em paisagem e força retrato primário ao fechar, com repetição resiliente.');
  } finally {
    dom.window.close();
  }
})().catch(erro => {
  console.error(erro.stack || erro);
  process.exitCode = 1;
});
