'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const Module = require('node:module');
const { pagamentoCorresponde, idMercadoPago, transacaoJaUtilizada } = require('../../src/mercado-pago-validacao');
const raiz = path.resolve(__dirname, '../..');
const agora = Date.now();
const data = new Date(agora - 60_000).toISOString();
const cobranca = { id: 'cob-1', osNumero: 'OS-0001', valor: 100, criadoEm: data, status: 'aguardando' };
const pagamento = { id: '123', status: 'approved', currency_id: 'BRL', transaction_amount: 100,
  external_reference: 'OS-0001', date_created: data, date_approved: data, live_mode: true };

async function main() {
  assert.equal(pagamentoCorresponde(pagamento, cobranca, 'empresa-a', agora), true);
  const adulteracoes = [
    { status: 'pending' }, { status: 'authorized' }, { status: 'refunded' }, { status: 'charged_back' },
    { id: '' }, { id: 'abc' }, { currency_id: undefined }, { currency_id: 'ARS' }, { live_mode: false },
    { external_reference: 'OS-0002' }, { transaction_amount: 99.99 }, { transaction_amount: 100.01 },
    { transaction_amount: NaN }, { transaction_amount: Infinity }, { transaction_amount_refunded: 50 },
    { date_created: 'inválida' }, { date_approved: null },
    { date_created: new Date(agora - 86400000).toISOString() },
    { date_created: new Date(agora + 86400000).toISOString() },
    { empresa_id: 'empresa-b' }, { metadata: { empresa_id: 'empresa-b' } }
  ];
  for (const alteracao of adulteracoes) assert.equal(pagamentoCorresponde({ ...pagamento, ...alteracao }, cobranca, 'empresa-a', agora), false, JSON.stringify(alteracao));
  for (const alteracao of [{ valor: 0 }, { valor: NaN }, { criadoEm: null }, { status: 'cancelado' }]) {
    assert.equal(pagamentoCorresponde(pagamento, { ...cobranca, ...alteracao }, 'empresa-a', agora), false);
  }
  assert.equal(idMercadoPago({ observacao: 'ID MP: 12345 | Data: teste' }), '12345');
  assert.notEqual(idMercadoPago({ observacao: 'ID MP: 12345 | Data: teste' }), '123');
  const anterior = { id: 'p1', origem: 'mercadopago', osNumero: 'OS-0001', mercadoPagoId: '123', cobrancaId: 'cob-anterior' };
  assert.equal(transacaoJaUtilizada(pagamento, cobranca, [anterior]), true);
  assert.equal(transacaoJaUtilizada(pagamento, cobranca, [{ ...anterior, cobrancaId: cobranca.id }]), false);

  // Executa o poller verdadeiro com somente o banco/HTTP substituídos.
  async function rodarPoll({ resposta = pagamento, trocarEmpresa = false, canceladaDuranteConsulta = false } = {}) {
    let empresa = 'empresa-a';
    const cob = { ...cobranca };
    const ordem = { numero: cob.osNumero, status: 'Entregue', statusPagamento: 'Aguardando Pagamento' };
    const registros = [];
    const banco = {
      obterEscopoEmpresaAtivo: () => empresa, loadDB: () => ({ config: {}, cobrancas: [cob] }),
      obterOSPorNumero: () => ordem, listarCobrancas: () => [cob], listarPagamentos: () => registros,
      registrarPagamento: p => { const novo = { ...p, id: 'p1' }; registros.push(novo); ordem.statusPagamento = 'Pago'; return novo; },
      atualizarStatusCobranca: (_id, alteracao) => Object.assign(cob, alteracao)
    };
    const contexto = { require: nome => nome === './db' ? banco
      : nome === './mercado-pago-validacao' ? require('../../src/mercado-pago-validacao') : require(nome),
      module: { exports: {} }, console: { log() {}, error() {}, warn() {} },
      setTimeout: () => ({ unref() {} }), clearTimeout() {}, setInterval() {}, clearInterval() {}, process };
    vm.createContext(contexto);
    vm.runInContext(fs.readFileSync(path.join(raiz, 'src/backup.js'), 'utf8')
      + '\nmodule.exports.executarTeste = _executarPollMP;', contexto);
    contexto.module.exports.definirConsultorMercadoPago(async () => {
      if (trocarEmpresa) empresa = 'empresa-b';
      if (canceladaDuranteConsulta) cob.status = 'cancelado';
      return { sucesso: true, pagamentos: [resposta] };
    });
    await contexto.module.exports.executarTeste();
    if (!trocarEmpresa) await contexto.module.exports.executarTeste();
    return { cob, registros };
  }
  const entregue = await rodarPoll();
  assert.equal(entregue.registros.length, 1, 'OS entregue sem pagamento continua sendo conciliada, uma única vez');
  assert.equal(entregue.cob.status, 'pago');
  assert.equal((await rodarPoll({ trocarEmpresa: true })).registros.length, 0, 'resposta antiga não altera outra empresa');
  assert.equal((await rodarPoll({ canceladaDuranteConsulta: true })).registros.length, 0);
  assert.equal((await rodarPoll({ resposta: { ...pagamento, currency_id: 'USD' } })).registros.length, 0);

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-mp-seguro-'));
  const electron = require.resolve('electron');
  Module._cache[electron] = new Module(electron);
  Module._cache[electron].exports = { app: { getPath: () => pasta } };
  try {
    const db = require('../../src/db');
    const ordem = db.criarOS({ cliente: { nome: 'Cliente teste' }, aparelho: { marca: 'Teste', modelo: 'Modelo', defeitoRelatado: 'Teste' },
      status: 'Entregue', statusPagamento: 'Aguardando Pagamento', exigirEntrada50Aprovacao: true,
      valorTotalServico: 200, valorEntradaAprovacao: 100, percentualPagamentoAguardado: 50 });
    const entrada = { osNumero: ordem.numero, valor: 100, metodo: 'Pix', origem: 'mercadopago', mercadoPagoId: '9001', cobrancaId: 'c1' };
    const primeiro = db.registrarPagamento(entrada);
    assert.equal(db.registrarPagamento(entrada).id, primeiro.id, 'mesma transação é idempotente');
    const segundo = db.registrarPagamento({ ...entrada, mercadoPagoId: '9002', cobrancaId: 'c2' });
    assert.notEqual(segundo.id, primeiro.id, 'duas parcelas online iguais têm IDs próprios');
    assert.equal(db.listarPagamentos().length, 2);
    assert.equal(db.obterOSPorNumero(ordem.numero).statusPagamento, 'Pago');
    assert.equal(db.obterOSPorNumero(ordem.numero).status, 'Entregue');
    assert.equal(db.registrarPagamento(entrada).id, primeiro.id, 'retry após quitação não duplica');
    assert.throws(() => db.registrarPagamento({ ...entrada, cobrancaId: 'outra' }), /outra cobrança/);
    db.registrarLogMensagem({ idMensagem: 'm1', mensagem: 'fixture', sucesso: false, statusEnvio: 'pendente' });
    db.atualizarConfirmacaoMensagem('m1', 'entregue');
    db.atualizarConfirmacaoMensagem('m1', 'aceito-servidor');
    assert.equal(db.listarLogMensagens()[0].statusEnvio, 'entregue', 'ACK atrasado corrige pendente sem regredir entrega');
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); }
  console.log('OK: confirmação MP valida moeda/valor/ID/data, OS entregue, dupla parcela, retry, troca de empresa e ACK tardio.');
}
main().catch(erro => { console.error(erro); process.exitCode = 1; });
