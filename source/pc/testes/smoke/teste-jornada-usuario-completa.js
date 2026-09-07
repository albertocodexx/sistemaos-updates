'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// Banco totalmente isolado: nenhuma etapa desta jornada toca os dados reais.
const raizTemporaria = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-jornada-qa-'));
const caminhoElectron = require.resolve('electron', { paths: [path.resolve(__dirname, '..', '..')] });
Module._cache[caminhoElectron] = new Module(caminhoElectron);
Module._cache[caminhoElectron].exports = { app: { getPath: () => raizTemporaria } };

const db = require('../../src/db');
const auth = require('../../src/auth');
const { gerarHtmlOS } = require('../../src/templates/os-template');

function moedaTotal(lista) {
  return lista.reduce((soma, item) => soma + (Number(item.valor) || 0), 0);
}

try {
  // Usuário real de QA: criação, senha com hash atual, login, sessão e permissões.
  auth.garantirCargosPadrao();
  const senhaTeste = `Qa${crypto.randomBytes(8).toString('hex')}9`;
  const usuarioTeste = auth.criarUsuario({
    usuario: 'qa_sistemaos',
    nome: 'Usuário de Teste Sistema OS',
    cargoId: 'CARGO-ATENDENTE',
    senha: senhaTeste
  });
  assert.equal(usuarioTeste.usuario, 'qa_sistemaos');
  assert.equal(auth.autenticar('qa_sistemaos', 'senha-incorreta').sucesso, false);
  const login = auth.autenticar('qa_sistemaos', senhaTeste);
  assert.equal(login.sucesso, true);
  assert.equal(login.usuario.permissoes.os, true);
  assert.equal(login.usuario.permissoes.financeiro, false);
  assert.equal(auth.revalidarSessao(usuarioTeste.id).id, usuarioTeste.id);
  assert.ok(db.obterUsuarioPorId(usuarioTeste.id).ultimoLogin);

  // Pagamento dividido: metade remota e metade presencial, sem cobrar duas
  // vezes e com os dois lançamentos aparecendo no relatório.
  const osMista = db.criarOS({
    cliente: { nome: 'Cliente QA Misto', telefone: '27999999999' },
    aparelho: { marca: 'Samsung', modelo: 'A54', defeitoRelatado: 'Tela quebrada' },
    status: 'Aguardando aprovação',
    statusPagamento: 'Pagamento 50/50',
    exigirEntrada50Aprovacao: true,
    valorTotalServico: 250,
    valorEntradaAprovacao: 125,
    percentualPagamentoAguardado: 50,
    modalidadePagamentoAprovacao: 'misto',
    diagnosticoTecnico: { valorEstimado: 250 },
    termos: 'Termo específico da OS de teste.'
  });
  const remoto = db.registrarPagamento({
    osNumero: osMista.numero,
    valor: 125,
    metodo: 'Mercado Pago',
    origem: 'mercadopago'
  });
  assert.equal(remoto.percentualQuitado, 50);
  assert.equal(db.obterOSPorNumero(osMista.numero).valorRestanteServico, 125);
  const presencial = db.confirmarPagamentoPresencial(osMista.numero, { metodo: 'Pix presencial' });
  assert.equal(presencial.valor, 125);
  assert.equal(presencial.percentualQuitado, 100);
  assert.equal(db.obterOSPorNumero(osMista.numero).statusPagamento, 'Pago');
  assert.equal(db.obterOSPorNumero(osMista.numero).statusAprovacao, 'Aprovado');
  assert.equal(moedaTotal(db.listarPagamentos().filter(p => p.osNumero === osMista.numero)), 250);

  // Compatibilidade: uma OS antiga já marcada como paga, mas sem lançamento,
  // deve ser recuperada uma única vez e entrar no caixa do mês correto.
  const osLegada = db.criarOS({
    cliente: { nome: 'Cliente QA Legado', telefone: '' },
    aparelho: { marca: 'Motorola', modelo: 'G54', defeitoRelatado: 'Não liga' },
    status: 'Em reparo',
    statusPagamento: 'Autorizado',
    valorTotalServico: 300,
    diagnosticoTecnico: { valorEstimado: 300 },
    formaPagamento: 'Pix'
  });
  const pagamentosPrimeiraLeitura = db.listarPagamentos().filter(p => p.osNumero === osLegada.numero);
  const pagamentosSegundaLeitura = db.listarPagamentos().filter(p => p.osNumero === osLegada.numero);
  assert.equal(pagamentosPrimeiraLeitura.length, 1);
  assert.equal(pagamentosSegundaLeitura.length, 1);
  assert.equal(pagamentosPrimeiraLeitura[0].valor, 300);
  assert.equal(pagamentosPrimeiraLeitura[0].reconciliado, true);

  const agora = new Date();
  const relatorio = db.obterRelatorioFinanceiro({ mes: agora.getMonth() + 1, ano: agora.getFullYear() });
  assert.equal(relatorio.entradas.servicos, 550);
  assert.equal(relatorio.detalheOS.length, 2);
  assert.equal(relatorio.detalheOS.reduce((s, item) => s + item.valorEstimado, 0), 550);

  // Estoque de consumíveis: cadastro, busca, entrada e saída com saldo real.
  const consumivel = db.criarPeca({
    tipoItem: 'consumivel', nome: 'Película QA', categoria: 'Consumível',
    quantidade: 10, estoqueMinimo: 2, custo: 5
  });
  assert.equal(db.buscarPecas({ termo: 'película' })[0].id, consumivel.id);
  assert.equal(db.movimentarEstoquePeca(consumivel.id, 'saida', 2, { referencia: osMista.numero }).peca.quantidade, 8);
  assert.equal(db.movimentarEstoquePeca(consumivel.id, 'entrada', 3).peca.quantidade, 11);

  // Compra, vínculo automático com aparelho para venda e atualização.
  const compra = db.criarCompra({
    vendedor: { nome: 'Vendedor QA' },
    aparelho: { marca: 'Apple', modelo: 'iPhone 11', cor: 'Preto' },
    dadosCompra: { valor: 400, custoPecas: 50 }
  });
  const itemVenda = db.criarItemEstoque({ numeroCompra: compra.numero, marca: 'Apple', modelo: 'iPhone 11' });
  assert.equal(itemVenda.numeroCompra, compra.numero);
  assert.equal(itemVenda.valorPago, 400);
  assert.equal(db.buscarEstoque({ termo: 'iphone' })[0].id, itemVenda.id);

  // Orçamento, conversão para OS, buscas, clientes e indicadores.
  const orcamento = db.criarOrcamento({
    cliente: { nome: 'Cliente QA Orçamento', telefone: '27988888888' },
    aparelho: { tipo: 'Smartphone', marca: 'Xiaomi', modelo: 'Redmi Note 12', defeitoRelatado: 'Conector' },
    servicos: 'Troca do conector', valorTotal: 180
  });
  const osConvertida = db.converterOrcamentoEmOS(orcamento.numero, {});
  assert.ok(osConvertida.numero.startsWith('OS-'));
  assert.equal(db.buscarOrdens('Cliente QA Orçamento').length, 1);
  assert.ok(db.listarClientes().some(cliente => cliente.nome === 'Cliente QA Orçamento'));
  assert.ok(db.obterEstatisticasOS().totalOS >= 3);
  assert.ok(db.obterEstatisticasEstoque().totalAparelhos >= 1);

  // Backup íntegro do cenário completo.
  const caminhoBackup = path.join(raizTemporaria, 'backup-jornada-qa.json');
  const backup = db.exportarBackupCompleto(caminhoBackup);
  assert.ok(fs.existsSync(caminhoBackup));
  assert.ok(backup.totalOrdens >= 3);
  assert.equal(JSON.parse(fs.readFileSync(caminhoBackup, 'utf8')).tipo, 'backup-sistema-os');

  // PDF: duas vias em páginas retrato, termos repetidos e sem qualquer corte.
  const termosLongos = Array.from({ length: 18 }, (_, i) => `${i + 1}. Condição de atendimento QA integral e verificável.`).join('\n');
  const htmlPdf = gerarHtmlOS({ ...osMista, termos: termosLongos }, { nomeEmpresa: 'Empresa QA' });
  assert.match(htmlPdf, /@page\{size:A4 portrait/);
  assert.doesNotMatch(htmlPdf, /\.termos-texto\{[^}]*overflow:hidden/s);
  assert.equal((htmlPdf.match(/Condição de atendimento QA integral/g) || []).length, 36);
  assert.equal((htmlPdf.match(/class="via"/g) || []).length, 2);

  console.log('OK - jornada isolada com usuário QA, autenticação, OS, 50/50, relatório, estoque, compra, orçamento, clientes, backup e PDF validada.');
} finally {
  fs.rmSync(raizTemporaria, { recursive: true, force: true });
}
