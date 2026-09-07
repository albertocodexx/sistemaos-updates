'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const etiqueta = require(path.resolve(__dirname, '..', '..', 'src', 'etiqueta-os.js'));

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const preload = fs.readFileSync(path.join(raiz, 'src', 'preload', 'api.js'), 'utf8');
const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');

assert.equal(etiqueta.criarLinkOS('OS-0001'), 'sistemaos://os/OS-0001');
assert.equal(etiqueta.criarLinkOS('1'), 'sistemaos://os/1');
assert.equal(etiqueta.extrairNumeroLinkOS('sistemaos://os/OS-0001'), 'OS-0001');
assert.equal(etiqueta.extrairNumeroLinkOS('https://exemplo.test/os/1'), '');
assert.equal(etiqueta.extrairNumeroLinkOS('sistemaos://auth/callback'), '');
assert.equal(etiqueta.normalizarNumeroOS('../segredo'), '');

assert.match(html, /etiquetaFormato/);
assert.match(html, /58 mm/);
assert.match(html, /80 mm/);
assert.match(html, /etiquetaCopias/);
assert.match(runtime, /@page\{size:/);
assert.match(runtime, /etiquetagerarqr/);
assert.doesNotMatch(runtime, /chart\.googleapis\.com/i, 'QR deve ser gerado offline');
assert.match(preload, /onAbrirOSPorUrl/);
assert.match(main, /sistemaos:abrir-os-url/);

(async () => {
  const qr = await etiqueta.gerarQrEtiqueta('OS-0042');
  assert.equal(qr.link, 'sistemaos://os/OS-0042');
  assert.match(qr.dataUrl, /^data:image\/png;base64,/);
  console.log('OK: etiqueta térmica 58/80 mm usa QR offline e deep link seguro da OS.');
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
