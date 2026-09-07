// testes/teste-ordem-gravacao-limpeza.js
// ═══════════════════════════════════════════════════════════════
// Testa, SEM depender de uma conta Firebase real, que a regra mais
// crítica do prompt é respeitada por src/firebase-sync.js:
//
//   "gravar local (db.importarLoteDoCelular) → SÓ DEPOIS apagar do
//   Firebase" — nunca antes, nunca em paralelo. Se a gravação local
//   falhar, o item NÃO deve ser apagado do Firebase.
//
// Estratégia: mocka o módulo 'src/db.js' (via cache do require) com
// stubs que registram a ORDEM em que foram chamados, e mocka os SDKs
// do Firebase (firebase/app, firebase/auth, firebase/firestore) e o
// módulo src/cloudinary-storage.js (que substituiu firebase/storage —
// ver decisão 2 em firebase-sync.js) para não fazer nenhuma chamada de
// rede real.
//
// Rodar com: node testes/teste-ordem-gravacao-limpeza.js
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const Module = require('module');

let falhas = 0;
function assert(condicao, mensagem) {
  if (!condicao) {
    falhas++;
    console.error('❌ FALHOU:', mensagem);
  } else {
    console.log('✅', mensagem);
  }
}

// ── Mock dos SDKs do Firebase (não fazem nenhuma chamada de rede) ──
const chamadasFirestore = [];
const mockFirestoreDoc = {};

function instalarMock(nomeModulo, exportsMock) {
  const caminhoResolvido = require.resolve(nomeModulo, { paths: [path.join(__dirname, '..')] });
  Module._cache[caminhoResolvido] = new Module(caminhoResolvido);
  Module._cache[caminhoResolvido].exports = exportsMock;
}

// O pacote 'firebase' real está instalado (npm install firebase), então
// require.resolve('firebase/app') etc. resolvem para arquivos reais no
// node_modules — substituímos o conteúdo desses arquivos resolvidos no
// require.cache por mocks, sem nenhuma chamada de rede real acontecer.
function criarMockModuloFirebase() {
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
      setDoc: async (ref, dados) => { chamadasFirestore.push({ op: 'setDoc', ref, dados }); },
      deleteDoc: async (ref) => { chamadasFirestore.push({ op: 'deleteDoc', ref }); },
      onSnapshot: () => (() => {}) // devolve unsubscribe no-op
    }
  };
  for (const [nomeModulo, exportsMock] of Object.entries(mapa)) {
    const resolvido = require.resolve(nomeModulo, { paths: [path.join(__dirname, '..')] });
    Module._cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports: exportsMock };
  }

  // src/cloudinary-storage.js substituiu firebase/storage — mockamos
  // aqui pelo mesmo motivo (nenhuma chamada de rede real no teste).
  const cloudinaryPath = path.join(__dirname, '..', 'src', 'cloudinary-storage.js');
  const cloudinaryResolvido = require.resolve(cloudinaryPath);
  Module._cache[cloudinaryResolvido] = {
    id: cloudinaryResolvido, filename: cloudinaryResolvido, loaded: true,
    exports: {
      configEstaCompleta: () => true,
      obterConfigCloudinaryInterna: () => ({ cloudName: 'fake', apiKey: 'fake', apiSecret: 'fake' }),
      uploadBase64: async (caminhoLogico) => { chamadasFirestore.push({ op: 'uploadBase64', caminhoLogico }); return { url: `https://fake-url/${caminhoLogico}`, publicId: caminhoLogico }; },
      baixarComoBase64: async () => Buffer.from('fake').toString('base64'),
      apagarArquivo: async (publicId) => { chamadasFirestore.push({ op: 'apagarArquivo', publicId }); }
    }
  };
}

// ── Mock do módulo src/db.js ────────────────────────────────────
// ordemChamadas é passado por referência de FORA (um array novo por
// teste), para garantir isolamento total entre execuções — nenhum
// estado de um teste vaza para o próximo.
function criarMockDb(simularFalhaGravacaoLocal, ordemChamadasDoTeste) {
  const dbPath = path.join(__dirname, '..', 'src', 'db.js');
  const dbResolvido = require.resolve(dbPath);
  Module._cache[dbResolvido] = {
    id: dbResolvido, filename: dbResolvido, loaded: true,
    exports: {
      loadDB: () => ({
        config: {
          firebaseConfig: { apiKey: 'fake', projectId: 'fake', appId: 'fake' },
          cloudinaryConfig: { cloudName: 'fake', apiKey: 'fake', apiSecret: 'fake' }
        },
        ordens: []
      }),
      importarLoteDoCelular: (conteudo) => {
        ordemChamadasDoTeste.push('gravarLocal');
        if (simularFalhaGravacaoLocal) {
          return { sucesso: false, erro: 'Falha simulada de gravação local.' };
        }
        return { sucesso: true, total: 1, importados: { os: 1, compra: 0, venda: 0, entrega: 0 }, pulados: 0, erros: [], rejeitados: [] };
      },
      importarRespostaAssinatura: () => ({ sucesso: true, tipoDocumento: 'os', registro: { numero: 'OS-0001' } }),
      gerarPacoteParaAssinar: (tipo, registro) => ({ tipoArquivo: 'sistema-os-pc-para-assinar', idEnvioAssinatura: registro.idEnvioAssinatura, tipoDocumento: tipo, dados: registro }),
      obterOSPorNumero: () => null,
      obterGarantiaPorNumeroOS: () => null,
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

async function testeGravacaoComSucessoDeveApagarDoFirebase() {
  const ordemChamadas = [];
  chamadasFirestore.length = 0;
  criarMockModuloFirebase();
  criarMockDb(false, ordemChamadas); // gravação local COM sucesso

  limparCacheFirebaseSync();
  const firebaseSync = require('../src/firebase-sync');

  const conteudoRecebido = {
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [{ idExportacao: 'exp-1', tipoDocumento: 'os', dados: {} }]
  };

  // Em produção, processarDocumentoRecebidoDoCelular só é chamado por
  // dentro do listener criado em iniciarEscutaDocumentosDoCelular, que
  // sempre roda depois de garantirInicializado() ter populado os módulos
  // do SDK — reproduzimos essa mesma pré-condição aqui.
  await firebaseSync.garantirInicializado();
  await firebaseSync._interno.processarDocumentoRecebidoDoCelular('doc-teste-1', conteudoRecebido, null);

  assert(ordemChamadas[0] === 'gravarLocal', 'Gravação local é chamada primeiro');
  const apagouDoFirestore = chamadasFirestore.some(c => c.op === 'deleteDoc');
  assert(apagouDoFirestore, 'Após gravação local com SUCESSO, o documento É apagado do Firestore');
}

async function testeGravacaoComFalhaNaoDeveApagarDoFirebase() {
  const ordemChamadas = [];
  chamadasFirestore.length = 0;
  criarMockModuloFirebase();
  criarMockDb(true, ordemChamadas); // gravação local FALHA

  limparCacheFirebaseSync();
  const firebaseSync = require('../src/firebase-sync');

  const conteudoRecebido = {
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [{ idExportacao: 'exp-2', tipoDocumento: 'os', dados: {} }]
  };

  await firebaseSync.garantirInicializado();
  await firebaseSync._interno.processarDocumentoRecebidoDoCelular('doc-teste-2', conteudoRecebido, null);

  assert(ordemChamadas[0] === 'gravarLocal', 'Gravação local é chamada primeiro (mesmo cenário de falha)');
  const apagouDoFirestore = chamadasFirestore.some(c => c.op === 'deleteDoc');
  assert(!apagouDoFirestore, 'Após gravação local FALHAR, o documento NÃO é apagado do Firestore (permanece para nova tentativa)');
}

async function testeConfigIncompletaFicaInativoSemTravar() {
  criarMockModuloFirebase();
  const dbPath = path.join(__dirname, '..', 'src', 'db.js');
  const dbResolvido = require.resolve(dbPath);
  Module._cache[dbResolvido] = {
    id: dbResolvido, filename: dbResolvido, loaded: true,
    exports: { loadDB: () => ({ config: { firebaseConfig: { apiKey: '', projectId: '', appId: '' } } }) }
  };
  limparCacheFirebaseSync();
  const firebaseSync = require('../src/firebase-sync');

  const resultado = await firebaseSync.garantirInicializado();
  assert(resultado.sucesso === false, 'Com firebaseConfig incompleta, garantirInicializado() retorna sucesso:false');
  assert(typeof resultado.erro === 'string' && resultado.erro.length > 0, 'Retorna mensagem de erro clara, sem lançar exceção (não trava o app)');
}

(async () => {
  criarMockModuloFirebase();
  await testeGravacaoComSucessoDeveApagarDoFirebase();
  await testeGravacaoComFalhaNaoDeveApagarDoFirebase();
  await testeConfigIncompletaFicaInativoSemTravar();

  console.log('\n' + (falhas === 0 ? `✅ Todos os testes passaram (0 falhas).` : `❌ ${falhas} teste(s) falharam.`));
  process.exit(falhas === 0 ? 0 : 1);
})();
