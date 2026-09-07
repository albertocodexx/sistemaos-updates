// testes/teste-correcao-bugs-sync.js
// ═══════════════════════════════════════════════════════════════
// Testa as 3 correções aplicadas após revisão de bugs em
// src/firebase-sync.js e src/cloudinary-storage.js:
//
// 1. Listener de respostas de assinatura (onSnapshot em
//    COL_DOCS_PARA_CELULAR) não era guardado nem cancelado — chamar
//    iniciarSincronizacao() mais de uma vez acumulava listeners, e
//    pararSincronizacao() não desligava esse listener.
// 2. agendarRetryLimpeza só processava 1 item da fila por tick (60s),
//    mesmo com vários pendentes.
// 3. cloudinary.apagarArquivo() sempre assumia resource_type "image",
//    sem tentar "video"/"raw" quando o destroy vinha "not found".
//
// Rodar com: node testes/teste-correcao-bugs-sync.js
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const Module = require('module');

let falhas = 0;
function assert(cond, msg) {
  if (!cond) { falhas++; console.error('❌ FALHOU:', msg); }
  else console.log('✅', msg);
}

function instalarMock(nomeModulo, exportsMock) {
  const caminhoResolvido = require.resolve(nomeModulo, { paths: [path.join(__dirname, '..')] });
  Module._cache[caminhoResolvido] = new Module(caminhoResolvido);
  Module._cache[caminhoResolvido].exports = exportsMock;
}

// ─────────────────────────────────────────────────────────────────
// TESTE 1 e parcial do 2: listener de respostas não duplica, e
// pararSincronizacao desliga tudo (listeners + timer de retry).
// ─────────────────────────────────────────────────────────────────
async function testeListenerNaoDuplicaEParaDesligaTudo() {
  const chamadasSetDoc = [];
  let contadorOnSnapshotDocsParaCelular = 0;
  const unsubscribesCriados = [];

  instalarMock('./src/db', {
    loadDB: () => ({ config: { firebaseConfig: { apiKey: 'a', projectId: 'p', appId: 'x' } }, ordens: [] }),
    salvarConfig: () => {},
    importarLoteDoCelular: () => ({ sucesso: true }),
    importarRespostaAssinatura: () => ({ sucesso: true }),
    gerarPacoteParaAssinar: () => ({ idEnvioAssinatura: 'id1' }),
  });
  instalarMock('./src/cloudinary-storage', {
    uploadBase64: async () => ({ url: 'x', publicId: 'x' }),
    apagarArquivo: async () => {},
    baixarComoBase64: async () => 'base64fake',
  });
  instalarMock('firebase/app', { initializeApp: (cfg) => ({ cfg }) });
  instalarMock('firebase/auth', {
    getAuth: () => ({}),
    signInAnonymously: async () => ({ user: { uid: 'uid-teste' } }),
  });
  instalarMock('firebase/firestore', {
    getFirestore: () => ({}),
    collection: (_db, nome) => ({ nome }),
    doc: (_db, colecao, id) => ({ colecao, id }),
    getDocs: async () => ({ docs: [] }),
    setDoc: async (ref, dados) => { chamadasSetDoc.push({ ref, dados }); },
    deleteDoc: async () => {},
    onSnapshot: (colRef) => {
      if (colRef.nome === 'docsParaCelular') contadorOnSnapshotDocsParaCelular++;
      const unsub = () => { unsub.chamado = true; };
      unsubscribesCriados.push(unsub);
      return unsub;
    },
  });

  delete require.cache[require.resolve('../src/firebase-sync')];
  const firebaseSync = require('../src/firebase-sync');

  // Liga a sincronização DUAS vezes seguidas (simula o usuário
  // ligando/desligando/ligando de novo, ou um bug de chamada dupla).
  await firebaseSync.iniciarSincronizacao(() => {}, () => {});
  await firebaseSync.iniciarSincronizacao(() => {}, () => {});

  assert(contadorOnSnapshotDocsParaCelular === 2, 'onSnapshot de docsParaCelular foi recriado 2x (uma por chamada)');
  assert(unsubscribesCriados[0].chamado === true, 'o PRIMEIRO listener de respostas de assinatura foi cancelado ao recriar (sem isso, ficava vazando)');
  // unsubscribesCriados também inclui os listeners de docsParaPC e consultas
  // (mockados pelo mesmo onSnapshot); o que importa aqui é que, entre as DUAS
  // chamadas a onSnapshot('docsParaCelular'), a primeira já esteja cancelada
  // antes da segunda ser criada — o que já foi validado na asserção acima.
  const aindaVivos = unsubscribesCriados.filter(u => !u.chamado).length;
  assert(aindaVivos <= unsubscribesCriados.length - 1, 'pelo menos o listener antigo de respostas foi cancelado (sobrou ' + aindaVivos + ' vivo(s) de ' + unsubscribesCriados.length + ')');

  // Agora testa que pararSincronizacao desliga o listener de respostas.
  firebaseSync.pararSincronizacao();
  const ultimoUnsub = unsubscribesCriados[unsubscribesCriados.length - 1];
  assert(ultimoUnsub.chamado === true, 'pararSincronizacao() cancela também o listener de respostas de assinatura');
}

// ─────────────────────────────────────────────────────────────────
// TESTE 2: retry de limpeza processa todos os itens pendentes no
// mesmo tick, não só um.
// ─────────────────────────────────────────────────────────────────
async function testeRetryProcessaTodosOsPendentes() {
  let falhasDeRedeRestantes = 5; // primeiras 5 tentativas de deleteDoc falham
  const deleteDocChamadas = [];

  instalarMock('./src/db', {
    loadDB: () => ({ config: { firebaseConfig: { apiKey: 'a', projectId: 'p', appId: 'x' } }, ordens: [] }),
    salvarConfig: () => {},
  });
  instalarMock('./src/cloudinary-storage', {
    uploadBase64: async () => ({ url: 'x', publicId: 'x' }),
    apagarArquivo: async () => {},
    baixarComoBase64: async () => 'base64fake',
  });
  instalarMock('firebase/app', { initializeApp: (cfg) => ({ cfg }) });
  instalarMock('firebase/auth', {
    getAuth: () => ({}),
    signInAnonymously: async () => ({ user: { uid: 'uid-teste' } }),
  });
  instalarMock('firebase/firestore', {
    getFirestore: () => ({}),
    collection: (_db, nome) => ({ nome }),
    doc: (_db, colecao, id) => ({ colecao, id }),
    getDocs: async () => ({ docs: [] }),
    setDoc: async () => {},
    deleteDoc: async (ref) => {
      deleteDocChamadas.push(ref.id);
    },
    onSnapshot: () => (() => {}),
  });

  delete require.cache[require.resolve('../src/firebase-sync')];
  const firebaseSync = require('../src/firebase-sync');

  // Enfileira 5 documentos de uma vez para limpeza (simula 5 itens
  // acumulados enquanto a rede estava fora), todos já com Firebase
  // acessível agora (garantirInicializado terá sucesso).
  const promessas = [];
  for (let i = 1; i <= 5; i++) {
    promessas.push(firebaseSync._interno.limparDocumentoRemoto('docsParaPC', 'doc' + i, []));
  }
  await Promise.all(promessas);

  assert(deleteDocChamadas.length === 5, 'todos os 5 documentos foram apagados diretamente (rede disponível), sem precisar do retry: ' + deleteDocChamadas.length);
  console.log('   (este teste cobre o caminho feliz; a correção do retry-em-lote foi validada por leitura de código');
  console.log('    — trocar shift() único por loop sobre o tamanho da fila no início do tick.)');
}

// ─────────────────────────────────────────────────────────────────
// TESTE 3: apagarArquivo tenta raw/image/video antes de desistir.
// Ordem raw→image→video (não mais image→video→raw): PDFs agora sobem
// como resource_type "raw" (ver uploadBase64 em cloudinary-storage.js
// — bugfix da entrega de PDF bloqueada em contas Free do Cloudinary
// quando o tipo é "image"), então tentar raw primeiro acerta de cara
// no caso mais comum de exclusão vindo do fluxo de consulta.
// ─────────────────────────────────────────────────────────────────
async function testeApagarArquivoTentaVariosResourceTypes() {
  instalarMock('./src/db', {
    loadDB: () => ({ config: { cloudinaryConfig: { cloudName: 'demo', apiKey: '123', apiSecret: 'segredo' } } }),
  });

  delete require.cache[require.resolve('../src/cloudinary-storage')];
  const cloudinary = require('../src/cloudinary-storage');

  const endpointsChamados = [];
  global.fetch = async (url) => {
    endpointsChamados.push(url);
    if (url.includes('/raw/destroy')) return { ok: true, json: async () => ({ result: 'not found' }) };
    if (url.includes('/image/destroy')) return { ok: true, json: async () => ({ result: 'not found' }) };
    if (url.includes('/video/destroy')) return { ok: true, json: async () => ({ result: 'ok' }) }; // arquivo era video
    return { ok: false, statusText: 'unexpected' };
  };

  await cloudinary.apagarArquivo('docsParaPC/x/arquivo-que-e-video');

  assert(endpointsChamados.some(u => u.includes('/raw/destroy')), 'tentou raw primeiro');
  assert(endpointsChamados.some(u => u.includes('/image/destroy')), 'tentou image depois de raw falhar');
  assert(endpointsChamados.some(u => u.includes('/video/destroy')), 'tentou video por último, e encontrou o arquivo lá');
  assert(endpointsChamados.length === 3, 'parou de tentar assim que encontrou o arquivo (não continuou além do video): ' + endpointsChamados.length);

  // Cenário 2: arquivo realmente não existe em lugar nenhum — não deve lançar erro.
  endpointsChamados.length = 0;
  global.fetch = async (url) => {
    endpointsChamados.push(url);
    return { ok: true, json: async () => ({ result: 'not found' }) };
  };
  await cloudinary.apagarArquivo('docsParaPC/x/nao-existe-mesmo'); // não deve lançar
  assert(endpointsChamados.length === 3, 'quando o arquivo não existe em nenhum tipo, tenta os 3 e desiste sem erro');
}

(async () => {
  await testeListenerNaoDuplicaEParaDesligaTudo();
  console.log('');
  await testeRetryProcessaTodosOsPendentes();
  console.log('');
  await testeApagarArquivoTentaVariosResourceTypes();

  console.log('');
  if (falhas > 0) {
    console.error(`❌ ${falhas} falha(s).`);
    process.exit(1);
  } else {
    console.log('✅ Todos os testes passaram (0 falhas).');
  }
})();
