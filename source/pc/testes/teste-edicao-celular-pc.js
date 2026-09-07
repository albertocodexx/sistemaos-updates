// testes/teste-edicao-celular-pc.js
// ═══════════════════════════════════════════════════════════════
// Nova funcionalidade: a aba Consulta do celular (busca de OS por
// número) ganhou botões Editar/Excluir. Excluir já reaproveitava o
// mecanismo pronto (exclusoesParaPC/confirmacoesExclusao — ver
// teste-confirmacao-exclusao-celular.js). Editar é o mecanismo NOVO
// espelhado no mesmo padrão de fila+confirmação
// (edicoesParaPC/confirmacoesEdicao), implementado em
// iniciarEscutaEdicoesDoCelular / processarEdicaoRecebidaDoCelular
// (src/firebase-sync.js).
//
// Este teste cobre:
// 1. Edição de campos permitidos (status, defeito relatado,
//    observações, prioridade) é aplicada de fato via db.atualizarOS,
//    e o PDF é regenerado.
// 2. Campos fora da lista permitida (ex.: valores, cliente) são
//    ignorados mesmo que venham no payload — nunca reescreve a OS
//    inteira a partir de um pedido do celular.
// 3. OS inexistente => confirmação com editado:false, motivo
//    nao-encontrada (celular não fica esperando pra sempre).
// 4. Payload sem nenhum campo permitido => editado:false, motivo
//    sem-campos-validos (não conta como sucesso silencioso).
//
// Mesmo padrão de mock de testes/teste-confirmacao-exclusao-celular.js
// (onSnapshot capturado + disparo manual de snapshot fake).
//
// Rodar com: node testes/teste-edicao-celular-pc.js
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const Module = require('module');

let falhas = 0;
let total = 0;
function assert(condicao, mensagem) {
  total++;
  if (!condicao) {
    falhas++;
    console.error('❌ FALHOU:', mensagem);
  } else {
    console.log('✅', mensagem);
  }
}

function instalarMockResolvido(caminhoOuNome, exportsMock, opts) {
  const resolvido = require.resolve(caminhoOuNome, opts);
  Module._cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports: exportsMock };
}

function criarMockModuloFirebase(estadoCompartilhado) {
  const mapa = {
    'firebase/app': { initializeApp: (cfg) => ({ cfg }) },
    'firebase/auth': {
      getAuth: () => ({}),
      signInAnonymously: async () => ({ user: { uid: 'uid-teste' } })
    },
    'firebase/firestore': {
      getFirestore: () => ({}),
      collection: (_db, nome) => ({ nome }),
      doc: (_db, colecao, id) => ({ colecao, id }),
      setDoc: async (refDoc, dados) => {
        estadoCompartilhado.setDocChamadas.push({ colecao: refDoc.colecao, id: refDoc.id, dados });
      },
      deleteDoc: async (refDoc) => {
        estadoCompartilhado.deleteDocChamadas.push({ colecao: refDoc.colecao, id: refDoc.id });
      },
      onSnapshot: (colRef, callback, erroCallback) => {
        estadoCompartilhado.callbackOnSnapshot = callback;
        return () => {};
      }
    }
  };
  for (const [nomeModulo, exportsMock] of Object.entries(mapa)) {
    instalarMockResolvido(nomeModulo, exportsMock, { paths: [path.join(__dirname, '..')] });
  }

  const cloudinaryPath = path.join(__dirname, '..', 'src', 'cloudinary-storage.js');
  instalarMockResolvido(cloudinaryPath, {
    configEstaCompleta: () => true,
    obterConfigCloudinaryInterna: () => ({ cloudName: 'fake', apiKey: 'fake', apiSecret: 'fake' }),
    uploadBase64: async () => ({ url: 'https://fake-url', publicId: 'fake' }),
    baixarComoBase64: async () => Buffer.from('fake').toString('base64'),
    apagarArquivo: async () => {}
  });

  const pdfPath = path.join(__dirname, '..', 'src', 'pdf.js');
  instalarMockResolvido(pdfPath, {
    regenerarPdfPorNumero: async (numero) => {
      estadoCompartilhado.regenerarPdfChamadas.push(numero);
      return '/fake/caminho.pdf';
    }
  });
}

function criarMockDb(database, chamadasAtualizarOS) {
  const dbPath = path.join(__dirname, '..', 'src', 'db.js');
  const dbResolvido = require.resolve(dbPath);
  Module._cache[dbResolvido] = {
    id: dbResolvido, filename: dbResolvido, loaded: true,
    exports: {
      loadDB: () => database,
      STATUS_OS_FECHADOS: ['Entregue', 'Cancelado'],
      STATUS_OS_VALIDOS: ['Aguardando análise', 'Em diagnóstico', 'Em reparo', 'Pronto para retirada', 'Entregue', 'Cancelado'],
      obterEstatisticasOS: () => ({ prontas: 0, atrasadas: 0, emAberto: database.ordens.length, entregues: 0, totalPago: 0, aguardandoPagamento: 0, receitaMeses: {} }),
      calcularAtraso: () => false,
      obterOSPorNumero: (numero) => database.ordens.find(o => String(o.numero) === String(numero)) || null,
      atualizarOS: (numero, payload) => {
        chamadasAtualizarOS.push({ numero, payload });
        const idx = database.ordens.findIndex(o => String(o.numero) === String(numero));
        if (idx === -1) return null;
        database.ordens[idx] = Object.assign({}, database.ordens[idx], payload, {
          aparelho: Object.assign({}, database.ordens[idx].aparelho, payload.aparelho || {})
        });
        return database.ordens[idx];
      },
      salvarConfig: () => ({})
    }
  };
}

function limparCacheFirebaseSync() {
  try {
    const resolvido = require.resolve('../src/firebase-sync');
    delete require.cache[resolvido];
  } catch (e) { /* ainda não foi carregado — nada a limpar */ }
}

function carregarFirebaseSync(database, chamadasAtualizarOS, estadoCompartilhado) {
  criarMockModuloFirebase(estadoCompartilhado);
  criarMockDb(database, chamadasAtualizarOS);
  limparCacheFirebaseSync();
  return require('../src/firebase-sync');
}

async function dispararSnapshotFake(estadoCompartilhado, docId, dadosDoc) {
  const snapshotFake = {
    docChanges: () => [{
      type: 'added',
      doc: { id: docId, data: () => dadosDoc }
    }]
  };
  await estadoCompartilhado.callbackOnSnapshot(snapshotFake);
  await new Promise((r) => setTimeout(r, 10));
}

function databaseComFirebaseConfigCompleta(ordens) {
  return {
    ordens,
    compras: [],
    estoque: [],
    config: {
      firebaseConfig: { apiKey: 'fake', projectId: 'fake', appId: 'fake' }
    }
  };
}

function novoEstado() {
  return { setDocChamadas: [], deleteDocChamadas: [], regenerarPdfChamadas: [], callbackOnSnapshot: null };
}

async function testeEdicaoDeCamposPermitidosAplicaDeFato() {
  const database = databaseComFirebaseConfigCompleta([
    { numero: 'OS-0004', status: 'Aguardando análise', prioridade: 'Normal', observacoes: '', aparelho: { marca: 'S23', modelo: 'S23', defeitoRelatado: 'Tela' } }
  ]);
  const chamadasAtualizarOS = [];
  const estado = novoEstado();
  const firebaseSync = carregarFirebaseSync(database, chamadasAtualizarOS, estado);

  await firebaseSync._interno.iniciarEscutaEdicoesDoCelular();
  await dispararSnapshotFake(estado, 'numero:OS-0004', {
    tipoDocumento: 'os',
    numero: 'OS-0004',
    campos: { status: 'Em reparo', 'aparelho.defeitoRelatado': 'Tela trincada, não liga', observacoes: 'Cliente autorizou por telefone' }
  });

  assert(chamadasAtualizarOS.length === 1 && chamadasAtualizarOS[0].numero === 'OS-0004',
    'atualizarOS foi chamada de verdade para a OS encontrada');
  assert(chamadasAtualizarOS[0].payload.status === 'Em reparo', 'status foi repassado no payload');
  assert(chamadasAtualizarOS[0].payload.aparelho.defeitoRelatado === 'Tela trincada, não liga', 'defeitoRelatado foi repassado (desmontado de "aparelho.defeitoRelatado")');
  assert(chamadasAtualizarOS[0].payload.observacoes === 'Cliente autorizou por telefone', 'observacoes foi repassado no payload');

  assert(database.ordens[0].status === 'Em reparo', 'status da OS foi realmente alterado no banco');
  assert(database.ordens[0].aparelho.defeitoRelatado === 'Tela trincada, não liga', 'defeitoRelatado da OS foi realmente alterado no banco');

  assert(estado.regenerarPdfChamadas.includes('OS-0004'), 'regenerou o PDF depois de editar');

  const confirmacao = estado.setDocChamadas.find(c => c.colecao === 'confirmacoesEdicao' && c.id === 'numero:OS-0004');
  assert(!!confirmacao, 'gravou uma confirmação em confirmacoesEdicao com o mesmo docId do pedido');
  assert(!!confirmacao && confirmacao.dados.editado === true, 'confirmação diz editado:true quando a edição realmente aconteceu');

  const remocaoDaFila = estado.deleteDocChamadas.find(c => c.colecao === 'edicoesParaPC' && c.id === 'numero:OS-0004');
  assert(!!remocaoDaFila, 'pedido processado foi removido da fila edicoesParaPC');
}

async function testeCamposForaDaListaPermitidaSaoIgnorados() {
  const database = databaseComFirebaseConfigCompleta([
    { numero: 'OS-0005', status: 'Em reparo', valorInvestido: 50, cliente: { nome: 'Alberto', telefone: '279' } }
  ]);
  const chamadasAtualizarOS = [];
  const estado = novoEstado();
  const firebaseSync = carregarFirebaseSync(database, chamadasAtualizarOS, estado);

  await firebaseSync._interno.iniciarEscutaEdicoesDoCelular();
  await dispararSnapshotFake(estado, 'numero:OS-0005', {
    tipoDocumento: 'os',
    numero: 'OS-0005',
    campos: {
      status: 'Pronto para retirada',
      valorInvestido: 99999,
      cliente: { nome: 'Outro Nome', telefone: '000' }
    }
  });

  assert(chamadasAtualizarOS.length === 1, 'atualizarOS foi chamada (havia ao menos um campo permitido: status)');
  assert(chamadasAtualizarOS[0].payload.status === 'Pronto para retirada', 'campo permitido (status) foi repassado');
  assert(chamadasAtualizarOS[0].payload.valorInvestido === undefined, 'valorInvestido NÃO foi repassado (fora da lista permitida)');
  assert(chamadasAtualizarOS[0].payload.cliente === undefined, 'cliente NÃO foi repassado (fora da lista permitida)');
  assert(database.ordens[0].valorInvestido === 50, 'valorInvestido no banco continua o original, não foi sobrescrito pelo pedido do celular');
  assert(database.ordens[0].cliente.nome === 'Alberto', 'nome do cliente no banco continua o original, não foi sobrescrito pelo pedido do celular');
}

async function testeConfirmaFalhaQuandoOSNaoEncontrada() {
  const database = databaseComFirebaseConfigCompleta([
    { numero: 'OS-0006', status: 'Em reparo' }
  ]);
  const chamadasAtualizarOS = [];
  const estado = novoEstado();
  const firebaseSync = carregarFirebaseSync(database, chamadasAtualizarOS, estado);

  await firebaseSync._interno.iniciarEscutaEdicoesDoCelular();
  await dispararSnapshotFake(estado, 'numero:OS-INEXISTENTE', {
    tipoDocumento: 'os',
    numero: 'OS-INEXISTENTE',
    campos: { status: 'Em reparo' }
  });

  assert(chamadasAtualizarOS.length === 0, 'atualizarOS NÃO foi chamada para um número que não existe no PC');

  const confirmacao = estado.setDocChamadas.find(c => c.colecao === 'confirmacoesEdicao' && c.id === 'numero:OS-INEXISTENTE');
  assert(!!confirmacao, 'gravou confirmação mesmo quando não encontrou o registro (celular não pode ficar esperando pra sempre)');
  assert(!!confirmacao && confirmacao.dados.editado === false, 'confirmação diz editado:false quando o registro não foi encontrado');
  assert(!!confirmacao && confirmacao.dados.motivo === 'nao-encontrada', 'motivo da confirmação é nao-encontrada');
}

async function testeConfirmaFalhaQuandoNenhumCampoValido() {
  const database = databaseComFirebaseConfigCompleta([
    { numero: 'OS-0007', status: 'Em reparo', valorInvestido: 50 }
  ]);
  const chamadasAtualizarOS = [];
  const estado = novoEstado();
  const firebaseSync = carregarFirebaseSync(database, chamadasAtualizarOS, estado);

  await firebaseSync._interno.iniciarEscutaEdicoesDoCelular();
  await dispararSnapshotFake(estado, 'numero:OS-0007', {
    tipoDocumento: 'os',
    numero: 'OS-0007',
    campos: { valorInvestido: 99999 } // único campo enviado é fora da lista permitida
  });

  assert(chamadasAtualizarOS.length === 0, 'atualizarOS NÃO foi chamada quando nenhum campo do pedido é permitido');

  const confirmacao = estado.setDocChamadas.find(c => c.colecao === 'confirmacoesEdicao' && c.id === 'numero:OS-0007');
  assert(!!confirmacao, 'gravou confirmação mesmo sem campos válidos');
  assert(!!confirmacao && confirmacao.dados.editado === false, 'confirmação diz editado:false quando não há campos válidos');
  assert(!!confirmacao && confirmacao.dados.motivo === 'sem-campos-validos', 'motivo da confirmação é sem-campos-validos');
}

async function main() {
  await testeEdicaoDeCamposPermitidosAplicaDeFato();
  console.log('');
  await testeCamposForaDaListaPermitidaSaoIgnorados();
  console.log('');
  await testeConfirmaFalhaQuandoOSNaoEncontrada();
  console.log('');
  await testeConfirmaFalhaQuandoNenhumCampoValido();

  console.log('\n' + '='.repeat(50));
  console.log(`Total: ${total} testes, ${total - falhas} OK, ${falhas} FALHOU`);
  console.log('='.repeat(50));
  process.exit(falhas > 0 ? 1 : 0);
}

main();
