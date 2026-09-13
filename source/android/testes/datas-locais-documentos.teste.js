'use strict';

const assert = require('node:assert/strict');
const { gerarHtmlVenda } = require('../www/src/templates/venda-template');
const { gerarHtmlCompra } = require('../www/src/templates/compra-template');
const { gerarHtmlDesbloqueio } = require('../www/src/templates/desbloqueio-template');

const dataCivil = '2026-09-13';
const esperado = '13/09/2026';
const diaAnterior = '12/09/2026';

const documentos = [
  gerarHtmlVenda({ id: 'VEN-TESTE', dataVenda: dataCivil }, {}),
  gerarHtmlCompra({ numero: 'CP-TESTE', data: dataCivil }, {}),
  gerarHtmlDesbloqueio({ numero: 'DES-TESTE', criadoEm: dataCivil }, {})
];

documentos.forEach((html) => {
  assert.ok(html.includes(esperado), 'a data civil precisa permanecer no dia escolhido');
  assert.equal(html.includes(diaAnterior), false, 'o fuso horário não pode voltar a data em um dia');
});

console.log('OK - datas sem hora permanecem estáveis nos documentos do Android');
