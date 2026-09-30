'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { selecionar } = require('../www/js/vias-pdf');

const Parser = new JSDOM('').window.DOMParser;
const raizTemplates = path.join(__dirname, '../www/src/templates');
const casos = [
  ['os-template', 'gerarHtmlOS'],
  ['compra-template', 'gerarHtmlCompra'],
  ['venda-template', 'gerarHtmlVenda']
];
const dados = {
  numero: 'OS-0042', id: 'EST-0042', data: new Date().toISOString(),
  cliente: { nome: 'Cliente' }, aparelho: { marca: 'Marca', modelo: 'Modelo', testesEntrada: ['Liga'] },
  vendedorNome: 'Vendedor', compradorNome: 'Comprador'
};
for (const [modulo, funcao] of casos) {
  const html = require(path.join(raizTemplates, modulo))[funcao](dados, { nomeEmpresa: 'Assistência' });
  const original = new Parser().parseFromString(html, 'text/html');
  assert.equal(original.querySelectorAll('.pagina > .via').length, 2, modulo);
  assert.equal(selecionar(html, 'ambas', Parser), html);
  for (const [via, indice] of [['primeira', 0], ['assistencia', 1]]) {
    const filtrado = new Parser().parseFromString(selecionar(html, via, Parser), 'text/html');
    const folhas = filtrado.querySelectorAll('.pagina > .via');
    assert.equal(folhas.length, 1, modulo + ': uma folha por escolha');
    assert.equal(folhas[0].querySelector('.via-label').textContent,
      original.querySelectorAll('.pagina > .via')[indice].querySelector('.via-label').textContent);
  }
}
assert.throws(() => selecionar('<html></html>', 'primeira', Parser), /duas vias/);
assert.throws(() => selecionar('<html></html>', 'invalida', Parser), /inválida/);
const app = fs.readFileSync(path.join(__dirname, '../www/js/app.js'), 'utf8');
assert.match(app, /htmlViaSelecionada\(\)/);
assert.match(app, /btnImprimirPdfA4\.addEventListener/);
console.log('OK: OS, compra e venda permitem compartilhar e imprimir a via escolhida sem alterar o documento salvo.');
