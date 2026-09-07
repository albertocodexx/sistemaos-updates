'use strict';

const assert = require('assert');
const {
  _interpretarAcaoCobrancaLocal,
  _executarAlterarStatusCobranca
} = require('../../src/ia-chat');

let osPersistida = {
  numero: 'OS-0020',
  lembretesCobranca: [
    { id: 'cob-14', data: '2026-09-14', valor: 110, status: 'pendente' },
    { id: 'cob-29', data: '2026-09-29', valor: 110, status: 'pendente' }
  ]
};
const banco = {
  obterOSPorNumero: numero => numero === osPersistida.numero ? JSON.parse(JSON.stringify(osPersistida)) : null,
  atualizarOS: (numero, patch) => {
    assert.equal(numero, osPersistida.numero);
    osPersistida = { ...osPersistida, ...JSON.parse(JSON.stringify(patch)) };
    return JSON.parse(JSON.stringify(osPersistida));
  }
};

const proposta = _interpretarAcaoCobrancaLocal('marcar a cobrança da OS 20 do dia 14 como paga', banco);
assert.equal(proposta.sucesso, true);
assert.equal(proposta.origem, 'local');
assert.equal(proposta.acaoProposta.tipo, 'alterar_status_cobranca');
assert.equal(proposta.acaoProposta.dados.numero, 'OS-0020');
assert.equal(proposta.acaoProposta.dados.lembreteId, 'cob-14');
assert.equal(proposta.acaoProposta.dados.novoStatus, 'paga');

const gravacao = _executarAlterarStatusCobranca(proposta.acaoProposta.dados, banco);
assert.equal(gravacao.sucesso, true);
assert.equal(osPersistida.lembretesCobranca[0].status, 'paga');
assert.ok(osPersistida.lembretesCobranca[0].pagoEm);
assert.equal(osPersistida.lembretesCobranca[1].status, 'pendente');

const ambiguo = _interpretarAcaoCobrancaLocal('marcar a cobrança da OS 20 como atrasada', banco);
assert.equal(ambiguo.acaoProposta, null);
assert.match(ambiguo.resposta, /14\/09\/2026/);
assert.match(ambiguo.resposta, /29\/09\/2026/);

console.log('OK: cobranças do PC podem ter status alterado pela IA sem confundir parcelas.');
