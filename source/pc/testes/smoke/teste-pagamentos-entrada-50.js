const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const raizTemporaria = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-pagamento-50-'));
const caminhoElectron = require.resolve('electron', { paths: [path.resolve(__dirname, '..', '..')] });
Module._cache[caminhoElectron] = new Module(caminhoElectron);
Module._cache[caminhoElectron].exports = {
  app: { getPath: () => raizTemporaria }
};

const db = require('../../src/db');

function criarOSPagamento(percentualAguardado = 50, opcoes = {}) {
  return db.criarOS({
    cliente: { nome: 'Cliente Pagamento', telefone: '27999999999' },
    aparelho: { marca: 'Samsung', modelo: 'A54', defeitoRelatado: 'Tela quebrada' },
    status: 'Aguardando aprovação',
    statusPagamento: 'Aguardando Pagamento Presencial',
    exigirEntrada50Aprovacao: true,
    valorTotalServico: opcoes.semTotal ? 0 : 200,
    valorEntradaAprovacao: opcoes.valorEntrada !== undefined ? opcoes.valorEntrada : 100,
    percentualPagamentoAguardado: percentualAguardado,
    formaPagamento: 'Pix'
  });
}

function pagamentosDaOS(numero) {
  return db.listarPagamentos().filter(p => p.osNumero === numero);
}

try {
  // 1. Entrada de 50%: libera o reparo, mas mantém exatamente R$ 100 pendentes.
  const osEntrada = criarOSPagamento(50);
  const entrada = db.confirmarPagamentoPresencial(osEntrada.numero, { metodo: 'Pix' });
  const depoisEntrada = db.obterOSPorNumero(osEntrada.numero);
  assert.equal(entrada.valor, 100);
  assert.equal(entrada.percentualQuitado, 50);
  assert.equal(entrada.tipoComprovante, 'entrada_50');
  assert.equal(entrada.valorAcumulado, 100);
  assert.equal(entrada.valorRestanteAposPagamento, 100);
  assert.equal(depoisEntrada.status, 'Em reparo');
  assert.equal(depoisEntrada.statusPagamento, 'Pago 50%');
  assert.equal(depoisEntrada.statusAprovacao, 'Aprovado');
  assert.equal(depoisEntrada.entrada50Paga, true);
  assert.equal(depoisEntrada.percentualPagamentoConfirmado, 50);
  assert.equal(depoisEntrada.percentualPagamentoAguardado, 50);
  assert.equal(depoisEntrada.valorRestanteServico, 100);

  // 2. Pagamento de 100% direto: também libera o reparo e quita a OS.
  const osIntegral = criarOSPagamento(100);
  const integral = db.registrarPagamento({
    osNumero: osIntegral.numero,
    valor: 200,
    metodo: 'Pix',
    origem: 'mercadopago'
  });
  const depoisIntegral = db.obterOSPorNumero(osIntegral.numero);
  assert.equal(integral.valor, 200);
  assert.equal(depoisIntegral.status, 'Em reparo');
  assert.equal(depoisIntegral.statusPagamento, 'Pago');
  assert.equal(depoisIntegral.statusAprovacao, 'Aprovado');
  assert.equal(depoisIntegral.entrada50Paga, false);
  assert.equal(depoisIntegral.percentualPagamentoConfirmado, 100);
  assert.equal(depoisIntegral.valorRestanteServico, 0);

  // A confirmação presencial usa a escolha de 100% mesmo sem receber um
  // valor explícito do renderer.
  const osIntegralPresencial = criarOSPagamento(100);
  const integralPresencial = db.confirmarPagamentoPresencial(osIntegralPresencial.numero);
  const depoisIntegralPresencial = db.obterOSPorNumero(osIntegralPresencial.numero);
  assert.equal(integralPresencial.valor, 200);
  assert.equal(depoisIntegralPresencial.status, 'Em reparo');
  assert.equal(depoisIntegralPresencial.statusPagamento, 'Pago');
  assert.equal(depoisIntegralPresencial.statusAprovacao, 'Aprovado');
  assert.equal(depoisIntegralPresencial.percentualPagamentoConfirmado, 100);
  assert.equal(depoisIntegralPresencial.valorRestanteServico, 0);

  // Quando a OS ainda não trouxe nenhum campo de total, uma quitação usa o
  // próprio valor confirmado como total persistido. A aba Autorizadas não
  // pode voltar a exibir R$ 0,00 depois do pagamento.
  const osIntegralSemTotal = criarOSPagamento(100, { semTotal: true, valorEntrada: 0 });
  db.registrarPagamento({
    osNumero: osIntegralSemTotal.numero,
    valor: 240,
    metodo: 'Pix',
    origem: 'mercadopago'
  });
  const depoisIntegralSemTotal = db.obterOSPorNumero(osIntegralSemTotal.numero);
  assert.equal(depoisIntegralSemTotal.valorTotalServico, 240);
  assert.equal(depoisIntegralSemTotal.valorRestanteServico, 0);

  // Se o confirmado é a entrada de 50%, o total ausente é inferido como o
  // dobro da parcela e o outro 50% fica corretamente registrado como saldo.
  const osEntradaSemTotal = criarOSPagamento(50, { semTotal: true, valorEntrada: 90 });
  db.registrarPagamento({
    osNumero: osEntradaSemTotal.numero,
    valor: 90,
    metodo: 'Pix',
    origem: 'mercadopago'
  });
  const depoisEntradaSemTotal = db.obterOSPorNumero(osEntradaSemTotal.numero);
  assert.equal(depoisEntradaSemTotal.valorTotalServico, 180);
  assert.equal(depoisEntradaSemTotal.valorRestanteServico, 90);
  assert.equal(depoisEntradaSemTotal.entrada50Paga, true);

  // 3. Depois da entrada online, a confirmação presencial sem valor usa o
  // saldo, não o total. As duas parcelas precisam somar exatamente R$ 200.
  const osSaldo = criarOSPagamento(50);
  const primeiraParcela = db.registrarPagamento({
    osNumero: osSaldo.numero,
    valor: 100,
    metodo: 'Pix',
    origem: 'mercadopago'
  });
  const segundaParcela = db.confirmarPagamentoPresencial(osSaldo.numero);
  const depoisSaldo = db.obterOSPorNumero(osSaldo.numero);
  const pagamentosSaldo = pagamentosDaOS(osSaldo.numero);
  assert.equal(primeiraParcela.valor, 100);
  assert.equal(segundaParcela.valor, 100);
  assert.equal(segundaParcela.percentualQuitado, 100);
  assert.equal(segundaParcela.tipoComprovante, 'quitacao_100');
  assert.equal(segundaParcela.valorAcumulado, 200);
  assert.equal(segundaParcela.valorRestanteAposPagamento, 0);
  assert.equal(pagamentosSaldo.length, 2);
  assert.equal(pagamentosSaldo.reduce((soma, p) => soma + p.valor, 0), 200);
  assert.equal(depoisSaldo.statusPagamento, 'Pago');
  assert.equal(depoisSaldo.statusAprovacao, 'Aprovado');
  assert.equal(depoisSaldo.entrada50Paga, false);
  assert.equal(depoisSaldo.percentualPagamentoConfirmado, 100);
  assert.equal(depoisSaldo.percentualPagamentoAguardado, 0);
  assert.equal(depoisSaldo.valorRestanteServico, 0);
  assert.equal(depoisSaldo.pagamentoId, segundaParcela.id);

  // 4. Parcelas iguais, mas de origens distintas, não são duplicatas.
  const osSaldoExplicito = criarOSPagamento(50);
  db.registrarPagamento({
    osNumero: osSaldoExplicito.numero,
    valor: 100,
    metodo: 'Pix',
    origem: 'mercadopago'
  });
  assert.doesNotThrow(() => {
    db.confirmarPagamentoPresencial(osSaldoExplicito.numero, { valor: 100, metodo: 'Pix' });
  });
  assert.equal(pagamentosDaOS(osSaldoExplicito.numero).length, 2);

  // A proteção contra uma repetição real da mesma origem continua ativa.
  const osDuplicada = criarOSPagamento(50);
  db.registrarPagamento({
    osNumero: osDuplicada.numero,
    valor: 100,
    metodo: 'Pix',
    origem: 'mercadopago'
  });
  assert.throws(() => {
    db.registrarPagamento({
      osNumero: osDuplicada.numero,
      valor: 100,
      metodo: 'Pix',
      origem: 'mercadopago'
    });
  }, /Pagamento duplicado/);

  // A quitação presencial não pode confirmar valor diferente do saldo.
  assert.throws(() => {
    db.confirmarPagamentoPresencial(osDuplicada.numero, { valor: 80, metodo: 'Dinheiro' });
  }, /saldo restante de R\$ 100\.00/);
  assert.equal(pagamentosDaOS(osDuplicada.numero).length, 1);

  // 5. Pagamento manual abaixo de 50% continua pendente, registra a forma e
  // só passa a quitado quando o acumulado alcança o total da OS.
  const osParcial = criarOSPagamento(100);
  const parcial = db.registrarPagamento({
    osNumero: osParcial.numero,
    valor: 60,
    metodo: 'Cartão de débito',
    origem: 'manual'
  });
  const depoisParcial = db.obterOSPorNumero(osParcial.numero);
  assert.equal(parcial.tipoComprovante, 'pagamento_parcial');
  assert.equal(parcial.percentualQuitado, 30);
  assert.equal(depoisParcial.statusPagamento, 'Pago parcial');
  assert.equal(depoisParcial.percentualPagamentoConfirmado, 30);
  assert.equal(depoisParcial.valorRecebidoConfirmado, 60);
  assert.equal(depoisParcial.valorRestanteServico, 140);
  assert.equal(depoisParcial.formaPagamento, 'Cartão de débito');

  const quitacaoParcial = db.registrarPagamento({
    osNumero: osParcial.numero,
    valor: 140,
    metodo: 'Pix',
    origem: 'manual'
  });
  const depoisQuitacaoParcial = db.obterOSPorNumero(osParcial.numero);
  assert.equal(quitacaoParcial.tipoComprovante, 'quitacao_100');
  assert.equal(depoisQuitacaoParcial.statusPagamento, 'Pago');
  assert.equal(depoisQuitacaoParcial.percentualPagamentoConfirmado, 100);
  assert.equal(depoisQuitacaoParcial.valorRestanteServico, 0);

  console.log('OK - pagamentos de 30%, 50%, 100% e saldo restante validados.');
} finally {
  fs.rmSync(raizTemporaria, { recursive: true, force: true });
}
