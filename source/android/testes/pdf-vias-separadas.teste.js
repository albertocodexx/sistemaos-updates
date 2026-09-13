'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const templates = path.resolve(__dirname, '..', 'www', 'src', 'templates');
const amostra = {
  numero: 'OS-QA-VIAS', id: 'EST-QA-VIAS',
  data: '2026-09-13T12:00:00-03:00', dataCompra: '2026-09-13T12:00:00-03:00', dataVenda: '2026-09-13T12:00:00-03:00',
  cliente: { nome: 'Cliente QA', clienteId: '10000' },
  aparelho: { tipoEquipamento: 'Smartphone', marca: 'Samsung', modelo: 'Galaxy S20 FE' },
  vendedorNome: 'Vendedor QA', compradorNome: 'Comprador QA', marca: 'Samsung', modelo: 'Galaxy S20 FE',
  valorCompra: 300, valorVenda: 500,
  termos: 'Termos da OS.', termosCompra: 'Termos da compra.', termosVenda: 'Termos da venda.'
};
const config = { nomeEmpresa: 'Assistência QA' };
const casos = [
  ['OS', 'os-template.js', 'gerarHtmlOS'],
  ['compra', 'compra-template.js', 'gerarHtmlCompra'],
  ['venda', 'venda-template.js', 'gerarHtmlVenda']
];

for (const [nome, arquivo, funcao] of casos) {
  const html = require(path.join(templates, arquivo))[funcao](amostra, config);
  assert.match(html, /@page\{size:A4 portrait;margin:0;/, `${nome} deve usar A4 retrato`);
  assert.match(html, /break-after:page;page-break-after:always;/, `${nome} deve separar as vias`);
  assert.doesNotMatch(html, /class="linha-corte"|class="tesoura"|width:297mm|A4 landscape/, `${nome} não deve dividir a folha`);
  assert.equal((html.match(/class="via"/g) || []).length, 2, `${nome} deve manter duas vias`);
}

console.log('OK: PDFs com duas vias usam folhas A4 separadas no Android.');
