'use strict';

const assert = require('assert');
const {
  _interpretarAcaoLocal,
  _responderConsultaCompraLocal,
  _executarAdicionarCustosCompra
} = require('../../src/ia-chat');

const compra = {
  numero: 'CP-0003',
  aparelho: { marca: 'Samsung', modelo: 'Galaxy S20 FE' },
  dadosCompra: { valor: 140, pecasTrocar: [] }
};
const banco = {
  listarCompras: () => [compra],
  obterCompraPorNumero: numero => numero === compra.numero ? compra : null
};

const resultado = _interpretarAcaoLocal(
  'adicionar na compra do S20 FE mais custos: flex power R$ 15, traseira R$ 45 e mais um flex power com botão por R$ 15',
  banco
);

assert.equal(resultado.sucesso, true);
assert.equal(resultado.origem, 'local');
assert.equal(resultado.acaoProposta.tipo, 'adicionar_custos_compra');
assert.equal(resultado.acaoProposta.dados.numero, 'CP-0003');
assert.deepStrictEqual(resultado.acaoProposta.dados.itens, [
  { nome: 'Flex power', valor: 15 },
  { nome: 'Traseira', valor: 45 },
  { nome: 'Flex power com botão', valor: 15 }
]);
assert.match(resultado.resposta, /R\$ 75,00/);

const semSeparadorAntesDeMaisUm = _interpretarAcaoLocal(
  'adicionar na compra do S20 FE mais custos, flex power 15, traseira 45 mais um flex power com botão mais 15',
  banco
);
assert.deepStrictEqual(semSeparadorAntesDeMaisUm.acaoProposta.dados.itens, [
  { nome: 'Flex power', valor: 15 },
  { nome: 'Traseira', valor: 45 },
  { nome: 'Flex power com botão', valor: 15 }
]);

const valorAntesDoNome = _interpretarAcaoLocal(
  'adicionar na compra do S20 FE mais custos, flex power 15, traseira 45 mais 15 de outro flex power',
  banco
);
assert.deepStrictEqual(valorAntesDoNome.acaoProposta.dados.itens, [
  { nome: 'Flex power', valor: 15 },
  { nome: 'Traseira', valor: 45 },
  { nome: 'Flex power', valor: 15 }
]);

const peloNumero = _interpretarAcaoLocal(
  'adicionar custos na compra CP-3, conector de carga 35 e bateria R$ 80',
  banco
);
assert.equal(peloNumero.acaoProposta.dados.numero, 'CP-0003');
assert.equal(peloNumero.acaoProposta.dados.itens.length, 2);
assert.equal(peloNumero.acaoProposta.dados.itens[1].valor, 80);

const consultaDireta = _responderConsultaCompraLocal('gasto em cp0003', banco);
assert.equal(consultaDireta.sucesso, true);
assert.equal(consultaDireta.origem, 'local');
assert.match(consultaDireta.resposta, /CP-0003/);
assert.match(consultaDireta.resposta, /R\$\s*140,00/);
assert.match(consultaDireta.resposta, /total investido/i);

let compraPersistida = JSON.parse(JSON.stringify(compra));
const bancoPersistente = {
  obterCompraPorNumero: numero => numero === compraPersistida.numero
    ? JSON.parse(JSON.stringify(compraPersistida))
    : null,
  atualizarCompra: (numero, patch) => {
    assert.equal(numero, compraPersistida.numero);
    compraPersistida = { ...compraPersistida, ...JSON.parse(JSON.stringify(patch)) };
    return JSON.parse(JSON.stringify(compraPersistida));
  }
};
const gravacao = _executarAdicionarCustosCompra(resultado.acaoProposta.dados, bancoPersistente);
assert.equal(gravacao.sucesso, true);
assert.equal(gravacao.custoAdicionado, 75);
assert.equal(gravacao.custoTotal, 75);
assert.equal(gravacao.valorTotal, 215);
assert.equal(compraPersistida.dadosCompra.pecasTrocar.length, 3);

const bancoQueNaoPersiste = {
  obterCompraPorNumero: () => JSON.parse(JSON.stringify(compra)),
  atualizarCompra: () => JSON.parse(JSON.stringify(compra))
};
const falhaConfirmacao = _executarAdicionarCustosCompra(resultado.acaoProposta.dados, bancoQueNaoPersiste);
assert.equal(falhaConfirmacao.sucesso, false);
assert.match(falhaConfirmacao.erro, /não foi confirmada pelo banco/i);

console.log('OK: custos em compras são interpretados, persistidos e confirmados por releitura.');
