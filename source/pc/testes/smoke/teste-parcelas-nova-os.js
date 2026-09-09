'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer/core/legacy-runtime.js'), 'utf8');
const layout = fs.readFileSync(path.join(raiz, 'renderer/core/form-layout.js'), 'utf8');

for (const id of ['novaParcelasOS', 'novaQuantidadeParcelas', 'novaPrimeiraParcelaData', 'btnGerarParcelasNovaOS', 'novaListaParcelasOS']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.match(runtime, /_valoresParcelasEmCentavos/);
assert.match(runtime, /lembretesCobranca:\s*novosLembretesCobranca\.map/);
assert.match(runtime, /_dataParcelaMes\(primeiraData, indice\)/);
assert.match(runtime, /novosLembretesCobranca\.some\(item => !item\.data\)/);
assert.match(layout, /#novaParcelasOS/);
assert.match(layout, /atendimento\.append\(cobrancas\)/);

console.log('OK: Nova OS divide o orçamento em parcelas datadas e salva as cobranças para sincronização.');
