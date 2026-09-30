'use strict';

const assert = require('node:assert/strict');
const { _interpretarEntregaOSLocal } = require('../../src/ia-chat');

const os = [
  { numero: 'OS-0021', status: 'Em reparo', aparelho: { marca: 'Apple', modelo: 'iPhone X' } },
  { numero: 'OS-0022', status: 'Entregue', aparelho: { marca: 'Samsung', modelo: 'S20 FE' } }
];
const banco = { listarOrdens: () => os };
const pedido = 'marcar os do iPhone X como entregue e adicionar lembrete de cobrança no dia 30';
const primeira = _interpretarEntregaOSLocal(pedido, [], banco);
assert.equal(primeira.acaoProposta?.dados.numero, 'OS-0021');
assert.equal(primeira.acaoProposta?.dados.novoStatus, 'Entregue');
assert.match(primeira.resposta, /valor e a data completa/i);

const historico = [
  { role: 'user', content: pedido },
  { role: 'assistant', content: 'Confirma a OS-0021?' },
  { role: 'user', content: 'isso' },
  { role: 'assistant', content: 'Qual o número exato?' }
];
assert.equal(_interpretarEntregaOSLocal('e a os 21', historico, banco).acaoProposta?.dados.numero, 'OS-0021');
assert.equal(_interpretarEntregaOSLocal('isso', historico, banco).acaoProposta?.dados.numero, 'OS-0021');
assert.equal(_interpretarEntregaOSLocal('qual o status da OS-0021?', historico, banco), null);
assert.match(_interpretarEntregaOSLocal('marcar OS-0022 entregue', [], banco).resposta, /já consta como entregue/);

const duplicado = { listarOrdens: () => [os[0], { ...os[0], numero: 'OS-0023' }] };
assert.equal(_interpretarEntregaOSLocal(pedido, [], duplicado).acaoProposta, null);

console.log('IA: resolução de OS, continuação de conversa e confirmação seguras OK');
