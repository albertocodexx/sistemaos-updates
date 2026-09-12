// Regressões do WhatsApp/UI:
// - respostas recebidas por @lid precisam ser ligadas ao telefone real;
// - o PDF não pode sair como OS-OS-0001.pdf;
// - o aviso detalhado da fila humana só aparece após a transferência;
// - o cabeçalho do chat IA deve respeitar o tema escuro.
const fs = require('fs');
const path = require('path');
const Module = require('module');

let falhas = 0;
function assert(condicao, mensagem) {
  if (!condicao) { falhas++; console.error('FALHOU:', mensagem); }
  else console.log('OK:', mensagem);
}

function mockarModulo(caminho, exportsMock) {
  const resolvido = require.resolve(caminho);
  const modulo = new Module(resolvido);
  modulo.filename = resolvido;
  modulo.loaded = true;
  modulo.exports = exportsMock;
  Module._cache[resolvido] = modulo;
}

mockarModulo('electron', {
  app: { getPath: () => __dirname },
  ipcMain: { handle: () => {} },
});
const chamadas = { telefone: '', aceitou: null, atualizacao: null, ia: 0 };
const osFake = {
  numero: 'OS-0001',
  cliente: { nome: 'Cliente Teste', telefone: '(27) 99604-4952' },
  estadoConversaAprovacao: 'aguardando_sim_nao',
};
mockarModulo(path.join(__dirname, '..', 'src', 'db.js'), {
  obterOSPorTelefone: telefone => { chamadas.telefone = telefone; return osFake; },
  registrarRespostaAprovacao: (_numero, dados) => { chamadas.aceitou = dados.aceitou; },
  atualizarOS: (_numero, dados) => { chamadas.atualizacao = dados; Object.assign(osFake, dados); return osFake; },
  obterOSPorNumero: () => osFake,
  registrarLogMensagem: () => {},
  loadDB: () => ({ config: { codigoPaisWhatsapp: '55', nomeEmpresa: 'Teste' } }),
});
mockarModulo(path.join(__dirname, '..', 'src', 'ia-groq.js'), {
  classificarAceiteTermos: async () => { chamadas.ia++; return { decisao: 'ambiguo' }; },
});
mockarModulo(path.join(__dirname, '..', 'src', 'mensagens-whatsapp.js'), {
  montarConfirmacaoTermosAceitos: () => 'Termos aceitos.',
  montarPedidoFormaPagamento: () => 'Escolha a forma de pagamento.',
});

delete require.cache[require.resolve('../src/whatsapp')];
const whatsapp = require('../src/whatsapp');

assert(
  whatsapp._resolverTelefoneMensagem({ key: { remoteJid: '5527996044952@s.whatsapp.net' } }) === '5527996044952',
  'resolve telefone de uma mensagem no formato tradicional'
);

assert(
  whatsapp._resolverTelefoneMensagem({
    key: {
      remoteJid: '123456789012345@lid',
      senderLid: '123456789012345@lid',
      senderPn: '5527996044952:0@s.whatsapp.net',
    },
  }) === '5527996044952',
  'usa senderPn quando a resposta chega por @lid'
);

whatsapp._registrarMapeamentoLid('998877665544@lid', '5527988887777@s.whatsapp.net');
assert(
  whatsapp._resolverTelefoneMensagem({ key: { remoteJid: '998877665544@lid' } }) === '5527988887777',
  'reaproveita o vínculo LID/telefone anunciado pelo WhatsApp'
);

assert(whatsapp._normalizarNumeroDocumentoOS('OS-0001') === 'OS-0001', 'não duplica o prefixo OS no PDF');
assert(whatsapp._normalizarNumeroDocumentoOS('0001') === 'OS-0001', 'adiciona o prefixo OS quando ele ainda não existe');

const mensagensFonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'mensagens-whatsapp.js'), 'utf8');
const trechoPrincipal = mensagensFonte.split('AGUARDANDO_APROVACAO:')[1].split('RECUSA_REGISTRADA:')[0];
assert(
  !trechoPrincipal.includes('você entra na fila de atendimento') &&
  !mensagensFonte.includes('você entra na fila e uma pessoa continua'),
  'explicação da fila humana não aparece antes da transferência'
);
assert(
  mensagensFonte.includes('Se preferir cancelar e voltar ao atendimento automático'),
  'mensagem de transferência humana ainda explica como voltar com #'
);

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'style.css'), 'utf8');
const cabecalho = css.split('#iaChatCabecalho {')[1].split('}')[0];
assert(cabecalho.includes('var(--bg-card)'), 'cabeçalho do chat IA usa a cor do tema');
assert(!cabecalho.includes('var(--cor-cabecalhos)'), 'cabeçalho do chat IA não herda mais a faixa branca personalizada');

const rendererFonte = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const dbFonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'database', 'domain.js'), 'utf8');
const templateOsFonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'templates', 'os-template.js'), 'utf8');
assert(dbFonte.includes('mercadoPagoWhatsAppAtivo: false'), 'Mercado Pago vem desligado por padrão');
assert(rendererFonte.includes('usarMercadoPagoAprovacao: usarMercadoPago'), 'cada orçamento grava se aquele envio usou Mercado Pago');
assert(rendererFonte.includes("if ((tipoFluxo === 'aprovacao' || usarMercadoPago) && valor < 1)"), 'orçamento exige valor mesmo sem Mercado Pago');
assert(rendererFonte.includes('const caminhoPdfAtualizado = await window.api.osgerarPdf(numero);'), 'PDF é regenerado antes do envio do orçamento');
assert(!rendererFonte.includes("'A combinar'"), 'o envio de orçamento não usa mais o valor genérico A combinar');
assert(templateOsFonte.includes('PEÇAS/ITENS DO SERVIÇO'), 'PDF da OS apresenta peças como itens do serviço');
assert(!templateOsFonte.includes('fmtMoeda(p.valor)'), 'PDF da OS não expõe o custo individual das peças');
assert(rendererFonte.includes("await window.abrirEditarOS(numeroAtualizado)"), 'modal da OS é recarregado imediatamente depois de salvar');
assert(rendererFonte.includes("campo.hasAttribute('list')") && rendererFonte.includes('primeiraOpcaoCompativel'), 'Tab completa a primeira sugestão de qualquer campo com lista');
assert(rendererFonte.includes('listaCoresAparelhos') && rendererFonte.includes("configurar('estMarca', 'estModelo')"), 'cores e formulários auxiliares receberam autocomplete rápido');
assert(rendererFonte.includes("configurar('desbloqueioMarca', 'desbloqueioModelo')") && rendererFonte.includes("'desbloqueioCor'"), 'Desbloqueios recebeu listas de marca, modelo e cor');
assert(rendererFonte.includes("nome: 'estCompradorNome'") && rendererFonte.includes("nome: 'cpVNome'"), 'Venda e Compra completam clientes cadastrados por nome/CPF usando Tab');
assert(rendererFonte.includes('listaCapacidadesAparelhos') && rendererFonte.includes('listaGarantiasVenda'), 'Compra e Venda têm listas rápidas adicionais para capacidade e garantia');

assert(whatsapp.classificarFormaPagamentoManualPorRegras('vou pagar por pix') === 'Pix', 'fallback reconhece Pix');
assert(whatsapp.classificarFormaPagamentoManualPorRegras('pago em dinheiro vivo') === 'Dinheiro', 'fallback reconhece dinheiro vivo');
assert(whatsapp.classificarFormaPagamentoManualPorRegras('pago presencialmente quando buscar') === 'Pagamento Presencial', 'fallback reconhece pagamento presencial');
assert(whatsapp.classificarFormaPagamentoManualPorRegras('manda um boleto com linha digitável') === 'Boleto', 'fallback reconhece boleto por linha digitável');

(async () => {
  await whatsapp._tratarMensagemRecebida({
    key: {
      id: 'MSG-LID-SIM-1',
      fromMe: false,
      remoteJid: '123456789012345@lid',
      senderPn: '5527996044952@s.whatsapp.net',
    },
    message: { conversation: 'Sim' },
  });
  assert(chamadas.telefone === '5527996044952', 'fluxo completo procura a OS pelo telefone real do @lid');
  assert(chamadas.aceitou === true, 'resposta Sim é registrada como aceite');
  assert(chamadas.atualizacao?.estadoConversaAprovacao === 'concluido', 'fluxo de aprovação é concluído após o Sim');
  assert(chamadas.atualizacao?.statusPagamento === 'Aguardando Pagamento na Retirada', 'aceite autoriza o reparo e mantém o pagamento para a retirada');
  assert(chamadas.ia === 0, 'resposta direta Sim funciona sem depender da IA externa');

  osFake.estadoConversaAprovacao = 'aguardando_sim_nao';
  osFake.usarMercadoPagoAprovacao = true;
  osFake.diagnosticoTecnico = { valorEstimado: 150 };
  chamadas.atualizacao = null;
  await whatsapp._processarAceiteTermos({
    os: osFake, telefone: '5527996044952', codigoPais: '55', config: { nomeEmpresa: 'Teste' }
  }, {
    db: {
      registrarRespostaAprovacao: (_numero, dados) => { chamadas.aceitou = dados.aceitou; },
      atualizarOS: (_numero, dados) => { chamadas.atualizacao = dados; Object.assign(osFake, dados); return osFake; },
      obterOSPorNumero: () => osFake,
    },
    gerarLink: async () => 'https://pagamento.exemplo/checkout',
    enviarELogar: async () => ({ sucesso: true }),
    registrarCobranca: () => {},
  });
  assert(osFake.estadoConversaAprovacao === 'aguardando_forma_pagamento_retirada', 'com MP marcado, o Sim mantém a conversa ativa para classificar a forma de pagamento');
  assert(osFake.statusPagamento === 'Aguardando Pagamento na Retirada', 'com MP marcado, o Sim aguarda o pagamento em vez de marcá-lo como pago');

  if (falhas) {
    console.error(`\n${falhas} falha(s).`);
    process.exit(1);
  }
  console.log('\nTodos os testes passaram.');
})();
