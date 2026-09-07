const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const mensagens = require('../../src/mensagens-whatsapp');

function garantir(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}

const config = { nomeEmpresa: 'Assistência Teste' };
const orcamento = mensagens.montarAguardandoAprovacao({
  nome_cliente: 'Cliente', numero: 'OS-0013', marca: 'S23', modelo: 'S23',
  diagnostico_tecnico: 'Conector danificado', valor: 'R$ 2,00', prazo_reparo: '2 dias'
}, config);
garantir(orcamento.includes('Diagnóstico técnico: *Conector danificado*'), 'diagnóstico técnico não entrou no orçamento');
garantir(!orcamento.includes('R$ R$'), 'mensagem duplicou o prefixo monetário');
garantir(!orcamento.includes('S23 S23'), 'mensagem duplicou marca/modelo iguais');

const entrada = mensagens.montarPedidoEntrada50({
  nome_cliente: 'Cliente', numero: 'OS-0013', valor_total: '200,00', valor_entrada: '100,00',
  link_pagamento_50: 'https://pagamento/50', link_pagamento_100: 'https://pagamento/100'
}, config);
garantir(entrada.includes('https://pagamento/50'), 'não exibiu o link inicial de 50%');
garantir(!entrada.includes('https://pagamento/100'), 'exibiu o link integral antes de o cliente pedi-lo');
garantir(entrada.includes('pagar tudo') && entrada.includes('link integral'), 'não explicou como pedir a quitação online');
garantir(entrada.includes('50% presencial') && entrada.includes('100% presencial'), 'não exibiu alternativas presenciais');

const presencialIntegral = mensagens.montarPagamentoPresencialAguardado({
  nome_cliente: 'Cliente', numero: 'OS-0013', percentual: 100,
  forma_pagamento: 'Dinheiro'
}, config);
garantir(!presencialIntegral.includes('{?saldo_retirada}'), 'marcador interno vazou na mensagem presencial integral');
garantir(!presencialIntegral.includes('50% restantes'), 'mensagem integral informou saldo de 50% indevidamente');

const presencialEntrada = mensagens.montarPagamentoPresencialAguardado({
  nome_cliente: 'Cliente', numero: 'OS-0013', percentual: 50,
  forma_pagamento: 'Dinheiro'
}, config);
garantir(!presencialEntrada.includes('{?saldo_retirada}'), 'marcador interno vazou na mensagem presencial de entrada');
garantir(presencialEntrada.includes('50% restantes ficarão para a retirada'), 'mensagem de entrada não informou o saldo da retirada');

const integral = mensagens.montarPagamentoConfirmado({
  nome_cliente: 'Cliente', numero: 'OS-0013', marca: 'Samsung', modelo: 'Galaxy S23'
}, config);
garantir(integral.includes('pago em *100%*'), 'confirmação integral não informa quitação');
garantir(!integral.includes('orçamento foi aprovado'), 'confirmação ainda aprova orçamento já aprovado');

const parcial = mensagens.montarPagamentoConfirmado({
  nome_cliente: 'Cliente', numero: 'OS-0013', exigir_entrada_50: true,
  valor_entrada: '100,00', valor_restante: '100,00'
}, config);
garantir(parcial.includes('50% restantes deverão ser pagos na retirada'), 'confirmação parcial não informa saldo na retirada');

const whatsapp = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'whatsapp.js'), 'utf8');
const dominio = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'database', 'domain.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const automacao = require('../../src/whatsapp');
garantir(whatsapp.includes("'aguardando_escolha_pagamento_entrada'"), 'listener não escuta escolha 50/100');
garantir(whatsapp.includes('classificarEscolhaPagamentoEntradaPorRegras'), 'fallback local não foi exportado');
garantir(whatsapp.includes('classificarIntencaoPagamentoEntradaPorRegras'), 'fallback de intenção não foi exportado');
garantir(whatsapp.includes('link_pagamento_integral_sob_demanda'), 'listener não gera o link integral sob demanda');
garantir(dominio.includes("'Aguardando Pagamento Presencial'"), 'domínio não aceita pagamento presencial antecipado');
garantir(renderer.includes('const valorFmt = _valorServicoOS(os)'), 'cartão de autorizadas ainda usa valorInvestido');

// Regras rápidas: decisões evidentes não consomem IA e uma frase negativa
// jamais pode criar, por engano, uma cobrança integral.
const classificarIntencao = automacao.classificarIntencaoPagamentoEntradaPorRegras;
garantir(classificarIntencao('quero pagar tudo agora') === 'quitar_100_online', 'não reconheceu quitação integral');
garantir(classificarIntencao('quero acertar o restante agora') === 'quitar_100_online', 'não reconheceu quitação pelo saldo/restante');
garantir(classificarIntencao('não quero pagar tudo') === 'nao_entendido', 'negação gerou link integral indevido');
garantir(classificarIntencao('não vou quitar agora') === 'nao_entendido', 'recusa de quitação gerou link integral indevido');
garantir(classificarIntencao('não quero total, só a entrada') === 'entrada_50_online', 'preferência explícita pela entrada não foi respeitada');
garantir(classificarIntencao('vou pagar em dinheiro na loja') === 'presencial_50', 'presencial sem percentual não assumiu 50%');

function criarBancoFluxo() {
  let atual = {
    numero: 'OS-0013',
    cliente: { nome: 'Cliente' },
    aparelho: { marca: 'Samsung', modelo: 'Galaxy S23' },
    diagnosticoTecnico: { valorEstimado: 200 },
    valorTotalServico: 200,
    valorEntradaAprovacao: 100,
    usarMercadoPagoAprovacao: true,
    exigirEntrada50Aprovacao: true,
    status: 'Aguardando aprovação',
    estadoConversaAprovacao: 'aguardando_sim_nao'
  };
  return {
    registrarRespostaAprovacao() {},
    registrarFormaPagamento(_numero, texto) { atual.respostaPreferenciaPagamento = texto; },
    atualizarOS(_numero, dados) { atual = { ...atual, ...dados }; return atual; },
    obterOSPorNumero() { return atual; },
    obterAtual() { return atual; }
  };
}

async function validarFluxoDinamico() {
  const banco = criarBancoFluxo();
  const linksGerados = [];
  const envios = [];
  const cobrancas = [];
  const gerarLink = async (_os, opcoes) => {
    linksGerados.push({ ...opcoes });
    return `https://pagamento/${opcoes.tipo}`;
  };
  const enviarELogar = async dados => { envios.push(dados); return { sucesso: true }; };
  const registrarCobranca = (_os, link, _telefone, opcoes) => cobrancas.push({ link, ...opcoes });

  await automacao._processarAceiteTermos({
    os: banco.obterAtual(), telefone: '27999999999', codigoPais: '55', config
  }, { db: banco, gerarLink, enviarELogar, registrarCobranca });

  garantir(linksGerados.length === 1 && linksGerados[0].tipo === 'entrada_50',
    'o aceite não deve criar simultaneamente os links de 50% e 100%');
  garantir(banco.obterAtual().linksPagamentoAprovacao.entrada50.includes('entrada_50'),
    'o link inicial de 50% não foi persistido');
  garantir(!banco.obterAtual().linksPagamentoAprovacao.integral100,
    'o link integral foi persistido antes do pedido do cliente');

  await automacao._processarEscolhaPagamentoEntrada({
    os: banco.obterAtual(), texto: 'quero pagar tudo agora', telefone: '27999999999', codigoPais: '55', config
  }, {
    db: banco, gerarLink, enviarELogar, registrarCobranca,
    iaGroq: { classificarEscolhaPagamentoEntrada: async () => { throw new Error('IA não deveria ser necessária'); } }
  });
  garantir(linksGerados.length === 2 && linksGerados[1].tipo === 'integral_100',
    'o link integral não foi criado sob demanda');
  garantir(banco.obterAtual().percentualPagamentoAguardado === 100,
    'a OS não passou a aguardar a quitação integral solicitada');

  const bancoPresencial = criarBancoFluxo();
  let gerouLinkPresencial = false;
  await automacao._processarEscolhaPagamentoEntrada({
    os: bancoPresencial.obterAtual(), texto: 'pago em dinheiro na loja', telefone: '27999999999', codigoPais: '55', config
  }, {
    db: bancoPresencial,
    gerarLink: async () => { gerouLinkPresencial = true; return 'indevido'; },
    enviarELogar,
    registrarCobranca,
    iaGroq: { classificarEscolhaPagamentoEntrada: async () => ({ intencao: 'presencial_50' }) }
  });
  const presencial = bancoPresencial.obterAtual();
  garantir(!gerouLinkPresencial, 'pagamento presencial gerou link indevido');
  garantir(presencial.status === 'Aguardando aprovação', 'presencial autorizou o reparo antes da confirmação');
  garantir(presencial.statusPagamento === 'Aguardando Pagamento Presencial', 'status presencial não foi registrado');
  garantir(presencial.percentualPagamentoAguardado === 50, 'presencial sem percentual não assumiu a entrada de 50%');

  garantir(whatsapp.includes("registrarRespostaAprovacao(os.numero, { aceitou: false"), 'o NÃO não é registrado');
  garantir(whatsapp.includes("estadoConversaAprovacao: 'aguardando_motivo_recusa'"), 'o NÃO não pergunta o motivo');
  garantir(whatsapp.includes('motivoRecusaTermos: texto') && whatsapp.includes("status: 'Cancelado'"),
    'o motivo da recusa não é salvo antes do cancelamento');
  garantir(envios.length >= 3 && cobrancas.some(c => c.tipo === 'entrada_50') && cobrancas.some(c => c.tipo === 'integral_100'),
    'os envios/cobranças esperados não foram registrados');
}

validarFluxoDinamico()
  .then(() => console.log('OK - fluxo de pagamento percentual e apresentação validados.'))
  .catch(erro => { console.error(erro); process.exitCode = 1; });
