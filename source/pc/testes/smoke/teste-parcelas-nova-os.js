'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer/core/legacy-runtime.js'), 'utf8');
const layout = fs.readFileSync(path.join(raiz, 'renderer/core/form-layout.js'), 'utf8');

for (const id of ['novaParcelasOS', 'novaLembreteCobrancaData', 'novaLembreteCobrancaValor', 'btnAdicionarNovoLembreteCobranca', 'novaListaLembretesCobranca']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.match(runtime, /function renderizarLembretesCobrancaNovaOS\(\)/);
assert.match(runtime, /alterarStatusLembreteCobrancaNovaOS/);
assert.match(runtime, /\['pendente', 'atrasada', 'paga', 'desativada'\]/);
assert.match(runtime, /btnAdicionarNovoLembreteCobranca/);
assert.match(runtime, /lembretesCobranca:\s*novosLembretesCobranca\.map/);
assert.match(runtime, /valor:\s*valor > 0 \? valor : 0/);
assert.doesNotMatch(runtime, /_valoresParcelasEmCentavos|_dataParcelaMes|gerarParcelasNovaOS/);
assert.doesNotMatch(html, /novaQuantidadeParcelas|novaPrimeiraParcelaData|btnGerarParcelasNovaOS|novaListaParcelasOS/);
assert.match(layout, /#novaParcelasOS/);
assert.match(layout, /atendimento\.append\(cobrancas\)/);

console.log('OK: Nova OS restaurou os lembretes manuais com data, valor e situação sincronizada.');
