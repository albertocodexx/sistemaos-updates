'use strict';

const assert = require('assert');
const { montarRelatorio } = require('../../src/finance/ledger');

const db = {
  ordens: [{
    numero: 'OS-0019', data: '2026-08-20T10:00:00.000Z',
    cliente: { nome: 'Cliente Teste', clienteId: '10000' },
    aparelho: { marca: 'Motorola', modelo: 'Moto G9' },
    valorTotalServico: 220,
    diagnosticoTecnico: { pecasTrocar: [{ nome: 'Tela', valor: 95 }, { nome: 'Cola', valor: 11 }] }
  }],
  pagamentos: [{
    id: 'PAG-1', osNumero: 'OS-0019', clienteNome: 'Cliente Teste', valor: 220,
    metodo: 'Pix', dataPagamento: '2026-08-25T13:00:00.000Z'
  }],
  estoque: [{
    id: 'EST-0001', status: 'Vendido', dataVenda: '2026-08-10T12:00:00.000Z',
    marca: 'Samsung', modelo: 'Galaxy', valorVenda: 590, valorPago: 140,
    valorGastoPecas: 290, gastosExtras: 0, compradorNome: 'Comprador Teste'
  }],
  compras: [], logPecas: [], pecas: [], reembolsos: []
};

const agosto = montarRelatorio(db, { mes: 8, ano: 2026 });
assert.strictEqual(agosto.resumo.composicao.receitaOS, 220);
assert.strictEqual(agosto.resumo.composicao.custoOS, 106);
assert.strictEqual(agosto.resumo.resultado.lucroOS, 114);
assert.strictEqual(agosto.resumo.resultado.lucroVendas, 160);
assert.strictEqual(agosto.resumo.resultado.lucroTotal, 274);
assert.strictEqual(agosto.resumo.caixa.entradas, 810);
assert.strictEqual(agosto.totalLancamentos, 4);

const somenteSaidas = montarRelatorio(db, { mes: 8, ano: 2026, direcoes: ['saida'] });
assert.strictEqual(somenteSaidas.totalLancamentos, 2);
assert.strictEqual(somenteSaidas.resumo.resultado.custos, 536);

const busca = montarRelatorio(db, { mes: 8, ano: 2026, busca: 'OS-0019' });
assert.strictEqual(busca.totalLancamentos, 2);

const parcelado = JSON.parse(JSON.stringify(db));
parcelado.pagamentos = [
  { id: 'P1', osNumero: 'OS-0019', valor: 110, dataPagamento: '2026-08-25T10:00:00.000Z' },
  { id: 'P2', osNumero: 'OS-0019', valor: 110, dataPagamento: '2026-09-02T10:00:00.000Z' }
];
const agostoParcelado = montarRelatorio(parcelado, { mes: 8, ano: 2026 });
const setembroParcelado = montarRelatorio(parcelado, { mes: 9, ano: 2026 });
assert.strictEqual(agostoParcelado.resumo.composicao.custoOS, 53);
assert.strictEqual(setembroParcelado.resumo.composicao.custoOS, 53);
assert.strictEqual(agostoParcelado.resumo.composicao.custoOS + setembroParcelado.resumo.composicao.custoOS, 106);

console.log('OK — extrato financeiro separa caixa, custos e lucro sem duplicar parcelamentos.');
