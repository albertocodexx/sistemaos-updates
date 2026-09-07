'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const cobrancas = require(path.join(raiz, 'www', 'js', 'cobrancas-tela.js'));
const html = fs.readFileSync(path.join(raiz, 'www', 'index.html'), 'utf8');
const notificacoes = fs.readFileSync(path.join(raiz, 'www', 'js', 'notificacoes.js'), 'utf8');

assert.match(html, /id="btn-ir-cobrancas"/);
assert.match(html, /id="painel-cobrancas"/);
assert.match(html, /id="form-cobranca-mobile"/);
assert.match(html, /Pendente[\s\S]*Atrasada[\s\S]*Paga[\s\S]*Desativada/);
assert.match(notificacoes, /tela: 'cobrancas'/);
assert.match(notificacoes, /notificarTesteCobranca/);

const futuro = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
assert.strictEqual(cobrancas.statusCobranca({ data: futuro, status: 'pendente' }), 'pendente');
assert.strictEqual(cobrancas.statusCobranca({ data: futuro, status: 'paga', confirmadoEm: new Date().toISOString() }), 'paga');
assert.strictEqual(cobrancas.statusCobranca({ data: futuro, status: 'desativada' }), 'desativada');

const paga = cobrancas.prepararSituacao({ data: futuro, valor: 100 }, 'paga', { data: futuro, valor: 100, status: 'pendente' });
assert.strictEqual(paga.status, 'paga');
assert.strictEqual(paga.impactaRecebimento, true);
assert.strictEqual(paga.valorRecebido, 100);
assert.ok(paga.confirmadoEm);

const extras = cobrancas.recalcularFinanceiro(
  { valorTotalServico: 220, valorRecebidoConfirmado: 0 },
  {},
  [{ data: futuro, valor: 100, status: 'pendente' }],
  [paga]
);
assert.strictEqual(extras.valor_recebido_confirmado, 100);
assert.strictEqual(extras.valor_restante_servico, 120);
assert.strictEqual(extras.percentual_pagamento_confirmado, 45);

const achatadas = cobrancas.achatar([{ numero: '0020', lembretesCobranca: [paga] }]);
assert.strictEqual(achatadas.length, 1);
assert.strictEqual(achatadas[0].status, 'paga');

console.log('OK: aba Cobranças, estados, financeiro e notificação local integrados.');
