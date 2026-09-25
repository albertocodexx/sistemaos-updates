'use strict';

const assert = require('assert');
const { remotoRegrideVenda, conciliarEstoque } = require('../../src/supabase/inventory-service');

assert.strictEqual(remotoRegrideVenda(
  { id: 'EST-0001', status: 'Vendido', valorGastoPecas: 290 },
  { id: 'EST-0001', status: 'Reservado', valorGastoPecas: 0 }
), true, 'snapshot antigo reservado deve ser reconhecido como regressão');
assert.strictEqual(remotoRegrideVenda(
  { status: 'Vendido' }, { status: 'Cancelado' }
), false, 'cancelamento explícito não deve ser confundido com snapshot antigo');
assert.strictEqual(remotoRegrideVenda(
  { status: 'Pronto para venda' }, { status: 'Reservado' }
), false, 'reserva normal continua permitida');

const base = {id:'EST-1',status:'Vendido',valorVenda:350,valorGastoPecas:0,cor:'Branco',lembretesCobranca:[]};
const parcela = {id:'p1',data:'2026-09-30',valor:175,status:'paga',atualizadoEm:'2026-09-24T12:00:00Z'};
const mescla = conciliarEstoque(base, {...base,valorGastoPecas:290}, {...base,lembretesCobranca:[parcela]});
assert.strictEqual(mescla.valorGastoPecas,290);
assert.strictEqual(mescla.lembretesCobranca.length,1);
assert.strictEqual(mescla.valorRecebidoConfirmado,175);
assert.strictEqual(mescla.valorRestanteVenda,175);
assert.throws(()=>conciliarEstoque(base,{...base,cor:'Preto'},{...base,cor:'Azul'}),/Conflito/);
assert.strictEqual(conciliarEstoque(base,base,{...base,status:'Reservado'}).status,'Vendido');
console.log('OK: venda concluída, parcelas e edições concorrentes preservadas.');
