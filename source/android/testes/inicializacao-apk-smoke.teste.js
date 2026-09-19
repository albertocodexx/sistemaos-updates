'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'www', 'index.html'), 'utf8');

(async () => {
  const dom = new JSDOM(html, {
    url: 'https://sistemaos.local/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  const falhas = [];

  w.indexedDB = indexedDB;
  w.IDBKeyRange = IDBKeyRange;
  w.alert = () => {};
  w.confirm = () => false;
  w.open = () => null;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({
    ok: false,
    status: 503,
    async json() { return {}; },
    async text() { return ''; },
    async blob() { return new w.Blob([]); }
  });
  w.Capacitor = { Plugins: {} };
  w.HTMLCanvasElement.prototype.getContext = function () {
    return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, drawImage() {},
      setTransform() {}, scale() {}, save() {}, restore() {}, fillRect() {} };
  };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  if (!w.URL.createObjectURL) w.URL.createObjectURL = () => 'blob:teste';
  if (!w.URL.revokeObjectURL) w.URL.revokeObjectURL = () => {};
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, value: false });

  w.addEventListener('error', evento => {
    falhas.push(evento.error || new Error(evento.message || 'Erro global sem detalhe'));
    evento.preventDefault();
  });
  w.addEventListener('unhandledrejection', evento => {
    falhas.push(evento.reason || new Error('Promise rejeitada sem detalhe'));
    evento.preventDefault();
  });

  try {
    const scripts = Array.from(w.document.querySelectorAll('script[src]'));
    for (const tag of scripts) {
      const relativo = new URL(tag.getAttribute('src'), w.location.href).pathname.replace(/^\//, '');
      const arquivo = path.join(raiz, 'www', ...relativo.split('/'));
      assert.ok(fs.existsSync(arquivo), `script declarado não existe: ${relativo}`);
      try {
        w.eval(`${fs.readFileSync(arquivo, 'utf8')}\n//# sourceURL=${relativo}`);
      } catch (erro) {
        falhas.push(new Error(`${relativo}: ${erro.message}`));
      }
    }

    await new Promise(resolve => w.setTimeout(resolve, 120));
    assert.deepEqual(falhas.map(erro => erro.stack || String(erro)), [],
      'a inicialização completa do APK não pode lançar erro síncrono ou rejeição não tratada');
    console.log(`OK: inicialização completa carregou ${scripts.length} scripts sem erro global.`);
  } finally {
    dom.window.close();
  }
})().catch(erro => {
  console.error(erro.stack || erro);
  process.exitCode = 1;
});
