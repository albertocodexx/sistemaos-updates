// testes/teste-confirmacao-exclusao-celular.js
// ═══════════════════════════════════════════════════════════════
// Bug: o celular não tinha como saber se uma exclusão pedida por ele
// (via exclusoesParaPC) realmente aconteceu no PC — a função do lado
// celular (notificarExclusaoParaPC) resolvia sucesso assim que
// CONSEGUIA ESCREVER o pedido no Firestore, não quando o PC de fato
// processava e excluía o registro. Com o PC fechado/desconectado, o
// celular mostrava "excluída com sucesso" e removia da lista, mas nada
// tinha sido excluído de verdade — a OS reaparecia na sincronização
// seguinte (relatado como "OS presa").
//
// Correção (lado PC): o listener iniciarEscutaExclusoesDoCelular agora
// grava o resultado real em confirmacoesExclusao/{mesmoDocId} depois de
// processar cada pedido — sucesso (excluido:true) ou falha
// (excluido:false, motivo). O celular passou a esperar essa confirmação
// (com timeout) em vez de assumir sucesso — ver
// testes/sync-exclusao-confirmacao.teste.js no lado celular.
//
// Este teste mocka onSnapshot para capturar o callback do listener e
// simular manualmente um evento "added" chegando em exclusoesParaPC,
// depois verifica o que foi setDoc'ado em confirmacoesExclusao.
//
// Rodar com: node testes/teste-confirmacao-exclusao-celular.js
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

// Registro de tudo que foi gravado via setDoc, indexado por "colecao/id",
// para o teste inspecionar depois. callbackPorColecaoDoc guarda o
// callback passado a onSnapshot para o teste poder disparar manualmente
// (simulando snapshot.docChanges() com um item "added").
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
        // Guarda o callback real do listener para o teste poder simular
        // um snapshot chegando (ver dispararSnapshotFake abaixo).
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
}

function criarMockDb(database, chamadasExclusao) {
  const dbPath = path.join(__dirname, '..', 'src', 'db.js');
  const dbResolvido = require.resolve(dbPath);
  Module._cache[dbResolvido] = {
    id: dbResolvido, filename: dbResolvido, loaded: true,
    exports: {
      loadDB: () => database,
      STATUS_OS_FECHADOS: ['Entregue', 'Cancelado'],
      obterEstatisticasOS: () => ({ prontas: 0, atrasadas: 0, emAberto: database.ordens.length, entregues: 0, totalPago: 0, aguardandoPagamento: 0, receitaMeses: {} }),
      calcularAtraso: () => false,
      excluirOS: (numero, origem) => { chamadasExclusao.push({ tipo: 'os', numero, origem }); },
      excluirCompra: (numero, origem) => { chamadasExclusao.push({ tipo: 'compra', numero, origem }); },
      excluirItemEstoque: (id, origem) => { chamadasExclusao.push({ tipo: 'venda', id, origem }); },
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

function carregarFirebaseSync(database, chamadasExclusao, estadoCompartilhado) {
  criarMockModuloFirebase(estadoCompartilhado);
  criarMockDb(database, chamadasExclusao);
  limparCacheFirebaseSync();
  return require('../src/firebase-sync');
}

// Simula um snapshot do Firestore chegando com um documento "added" em
// exclusoesParaPC — mesmo formato que change.doc em snapshot.docChanges().
async function dispararSnapshotFake(estadoCompartilhado, docId, dadosDoc) {
  const snapshotFake = {
    docChanges: () => [{
      type: 'added',
      doc: { id: docId, data: () => dadosDoc }
    }]
  };
  await estadoCompartilhado.callbackOnSnapshot(snapshotFake);
  // O handler do listener usa await internamente (setDoc/deleteDoc) —
  // um tick extra garante que essas promises já resolveram antes do
  // teste inspecionar setDocChamadas.
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

async function testeConfirmaSucesso() {
  const database = databaseComFirebaseConfigCompleta([
    { numero: 'OS-0001', status: 'Em andamento', origemIdExportacao: null }
  ]);
  const chamadasExclusao = [];
  const estadoCompartilhado = { setDocChamadas: [], deleteDocChamadas: [], callbackOnSnapshot: null };
  const firebaseSync = carregarFirebaseSync(database, chamadasExclusao, estadoCompartilhado);

  await firebaseSync._interno.iniciarEscutaExclusoesDoCelular();
  await dispararSnapshotFake(estadoCompartilhado, 'numero:OS-0001', { tipoDocumento: 'os', numero: 'OS-0001' });

  assert(chamadasExclusao.length === 1 && chamadasExclusao[0].numero === 'OS-0001',
    'excluirOS foi chamada de verdade para a OS encontrada');

  const confirmacao = estadoCompartilhado.setDocChamadas.find(c => c.colecao === 'confirmacoesExclusao' && c.id === 'numero:OS-0001');
  assert(!!confirmacao, 'gravou uma confirmação em confirmacoesExclusao com o mesmo docId do pedido');
  assert(!!confirmacao && confirmacao.dados.excluido === true, 'confirmação diz excluido:true quando a exclusão realmente aconteceu');

  const remocaoDaFila = estadoCompartilhado.deleteDocChamadas.find(c => c.colecao === 'exclusoesParaPC' && c.id === 'numero:OS-0001');
  assert(!!remocaoDaFila, 'pedido processado foi removido da fila exclusoesParaPC');
}

async function testeConfirmaFalhaQuandoNaoEncontrada() {
  const database = databaseComFirebaseConfigCompleta([
    { numero: 'OS-0002', status: 'Em andamento', origemIdExportacao: null }
  ]);
  const chamadasExclusao = [];
  const estadoCompartilhado = { setDocChamadas: [], deleteDocChamadas: [], callbackOnSnapshot: null };
  const firebaseSync = carregarFirebaseSync(database, chamadasExclusao, estadoCompartilhado);

  await firebaseSync._interno.iniciarEscutaExclusoesDoCelular();
  await dispararSnapshotFake(estadoCompartilhado, 'numero:OS-INEXISTENTE', { tipoDocumento: 'os', numero: 'OS-INEXISTENTE' });

  assert(chamadasExclusao.length === 0, 'excluirOS NÃO foi chamada para um número que não existe no PC');

  const confirmacao = estadoCompartilhado.setDocChamadas.find(c => c.colecao === 'confirmacoesExclusao' && c.id === 'numero:OS-INEXISTENTE');
  assert(!!confirmacao, 'gravou confirmação mesmo quando não encontrou o registro (celular não pode ficar esperando pra sempre)');
  assert(!!confirmacao && confirmacao.dados.excluido === false, 'confirmação diz excluido:false quando o registro não foi encontrado');
  assert(!!confirmacao && confirmacao.dados.motivo === 'nao-encontrada', 'motivo da confirmação é nao-encontrada');
}

async function main() {
  await testeConfirmaSucesso();
  await testeConfirmaFalhaQuandoNaoEncontrada();

  console.log('\n' + '='.repeat(50));
  console.log(`Total: ${total} testes, ${total - falhas} OK, ${falhas} FALHOU`);
  console.log('='.repeat(50));
  process.exit(falhas > 0 ? 1 : 0);
}

main();
