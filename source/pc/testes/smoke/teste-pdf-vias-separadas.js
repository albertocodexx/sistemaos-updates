'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..', '..');
const raizAndroid = path.resolve(raiz, '..', 'sistemaos-android', 'www', 'src', 'templates');

const amostra = {
  numero: 'OS-QA-VIAS',
  id: 'EST-QA-VIAS',
  data: '2026-09-13T12:00:00-03:00',
  dataCompra: '2026-09-13T12:00:00-03:00',
  dataVenda: '2026-09-13T12:00:00-03:00',
  cliente: { nome: 'Cliente QA', clienteId: '10000' },
  aparelho: { tipoEquipamento: 'Smartphone', marca: 'Samsung', modelo: 'Galaxy S20 FE' },
  vendedorNome: 'Vendedor QA',
  compradorNome: 'Comprador QA',
  marca: 'Samsung',
  modelo: 'Galaxy S20 FE',
  valorCompra: 300,
  valorVenda: 500,
  termos: 'Termos da ordem de serviço.',
  termosCompra: 'Termos da compra.',
  termosVenda: 'Termos da venda.'
};

const config = { nomeEmpresa: 'Assistência QA' };

const casos = [
  ['PC / OS', require(path.join(raiz, 'src', 'templates', 'os-template.js')).gerarHtmlOS],
  ['PC / compra', require(path.join(raiz, 'src', 'templates', 'compra-template.js')).gerarHtmlCompra],
  ['PC / venda', require(path.join(raiz, 'src', 'templates', 'venda-template.js')).gerarHtmlVenda],
  ['Android / OS', require(path.join(raizAndroid, 'os-template.js')).gerarHtmlOS],
  ['Android / compra', require(path.join(raizAndroid, 'compra-template.js')).gerarHtmlCompra],
  ['Android / venda', require(path.join(raizAndroid, 'venda-template.js')).gerarHtmlVenda]
];

for (const [nome, gerar] of casos) {
  const html = gerar(amostra, config);
  assert.match(html, /@page\{size:A4 portrait;margin:0;/, `${nome} deve usar A4 retrato`);
  assert.match(html, /break-after:page;page-break-after:always;/, `${nome} deve quebrar após a primeira via`);
  assert.match(html, /\.via:last-child\{break-after:auto;page-break-after:auto;/, `${nome} não deve criar folha vazia no final`);
  assert.doesNotMatch(html, /class="linha-corte"|class="tesoura"|width:297mm|A4 landscape/, `${nome} não pode manter duas vias lado a lado`);
  assert.equal((html.match(/class="via"/g) || []).length, 2, `${nome} deve conter exatamente duas vias`);
}

console.log('OK: OS, compra e venda usam uma folha A4 separada por via no PC e no Android.');
