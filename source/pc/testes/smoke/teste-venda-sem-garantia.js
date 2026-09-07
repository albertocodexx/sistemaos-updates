'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { gerarHtmlVenda } = require('../../src/templates/venda-template');

const item = {
  id: 'EST-TESTE',
  dataVenda: '2026-08-10T12:00:00.000Z',
  marca: 'Samsung',
  modelo: 'Galaxy S20 FE',
  cor: 'Branco',
  compradorNome: 'Cliente Teste',
  valorVenda: 590,
  formaPagamento: 'Cartão de débito'
};

for (const garantia of [0, '0', '0 dias', '0 mês', '0 meses', '0 ano', '0 anos', '0,00']) {
  const html = gerarHtmlVenda({ ...item, garantia }, {});
  assert.match(html, /GARANTIA/);
  assert.match(html, /Sem garantia/);
  assert.match(html, /grade grade-valores/);
  assert.match(html, /grid-template-columns:1\.2fr \.85fr 1\.45fr/);
}

const runtime = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'renderer', 'core', 'legacy-runtime.js'),
  'utf8'
);
assert.match(runtime, /function normalizarGarantiaVenda\(valor\)/);
assert.match(runtime, /garantia:\s*normalizarGarantiaVenda/);

console.log('OK: garantia zero vira Sem garantia e a linha de valores permanece alinhada.');
