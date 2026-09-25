'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const tela = fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'cobrancas', 'cobrancas.js'), 'utf8');
const dominio = fs.readFileSync(path.join(raiz, 'src', 'database', 'domain.js'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
assert.match(html, /data-aba="cobrancas"/);
assert.match(html, /id="cobrancasPCTipos"[\s\S]*data-cobranca-tipo="todos"[\s\S]*data-cobranca-tipo="os"[\s\S]*data-cobranca-tipo="venda"/);
assert.match(html, /data-orc-subaba="finalizadas"/);
assert.match(tela, /Promise\.all\(\[window\.api\.oslistar\(\), window\.api\.estoquelistar\(\)\]\)/);
assert.match(tela, /Após esta cobrança resta/);
assert.match(tela, /recarregarPendente/,
  'evento recebido durante a carga deve provocar uma segunda leitura da lista');
assert.match(tela, /setInterval\(sincronizarSeVisivel, 15000\)/,
  'aba aberta deve conferir alteracoes do celular mesmo apos falha do Realtime');
assert.match(dominio, /valorRecebidoBaseCobrancas/);
assert.match(dominio, /lembretesCobrancaExcluidos/);
assert.match(runtime, /\['autorizado', 'autorizada'\]\.includes\(statusTecnico\)/,
  'status técnico Autorizada deve aparecer na aba Autorizadas');
assert.match(runtime, /statusTecnico === 'entregue' && pagaIntegral/,
  'finalizadas deve exigir entrega e pagamento integral');

console.log('OK: cobranças do PC podem ter status alterado pela IA sem confundir parcelas.');
