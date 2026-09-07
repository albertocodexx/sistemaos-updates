// testes/teste-conversao-formato.js
// ═══════════════════════════════════════════════════════════════
// Testa a lógica de conversão de formato (documento vindo do Firestore
// com URLs do Cloudinary → formato local com base64, que é o que
// db.importarLoteDoCelular já espera receber do .json manual) — sem
// depender de uma conta Firebase/Cloudinary real (cloudinary-storage é
// mockado). [ATUALIZADO] Antes mockava firebase/storage; a partir da
// migração para Cloudinary (Firebase Storage passou a exigir plano
// pago), o que precisa ser mockado é src/cloudinary-storage.js.
// Rodar com: node testes/teste-conversao-formato.js
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const Module = require('module');

let falhas = 0;
function assert(condicao, mensagem) {
  if (!condicao) { falhas++; console.error('❌ FALHOU:', mensagem); }
  else { console.log('✅', mensagem); }
}

function mockarCloudinaryStorage() {
  const cloudinaryPath = path.join(__dirname, '..', 'src', 'cloudinary-storage.js');
  const resolvido = require.resolve(cloudinaryPath);
  Module._cache[resolvido] = {
    id: resolvido, filename: resolvido, loaded: true,
    exports: {
      configEstaCompleta: () => true,
      obterConfigCloudinaryInterna: () => ({ cloudName: 'fake', apiKey: 'fake', apiSecret: 'fake' }),
      uploadBase64: async (caminhoLogico) => ({ url: `https://res.cloudinary.com/fake/image/upload/v1/${caminhoLogico}`, publicId: caminhoLogico }),
      // Devolve sempre o mesmo conteúdo fake em base64 conhecido, para
      // conseguirmos checar a conversão foi feita (e não só "não quebrou").
      baixarComoBase64: async (url) => Buffer.from(`conteudo-fake-de:${url}`).toString('base64'),
      apagarArquivo: async () => {}
    }
  };
}
function mockarOutrosFirebase() {
  ['firebase/app', 'firebase/auth', 'firebase/firestore'].forEach((nome) => {
    const resolvido = require.resolve(nome, { paths: [path.join(__dirname, '..')] });
    Module._cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports: {
      initializeApp: () => ({}), getAuth: () => ({}), signInAnonymously: async () => ({ user: { uid: 'x' } }),
      getFirestore: () => ({}), collection: () => ({}), doc: () => ({}), setDoc: async () => {}, deleteDoc: async () => {}, onSnapshot: () => (() => {})
    }};
  });
}
function mockarDb() {
  const dbPath = path.join(__dirname, '..', 'src', 'db.js');
  const resolvido = require.resolve(dbPath);
  Module._cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports: {
    loadDB: () => ({ config: {
      firebaseConfig: { apiKey: 'fake', projectId: 'fake', appId: 'fake' },
      cloudinaryConfig: { cloudName: 'fake', apiKey: 'fake', apiSecret: 'fake' }
    } }),
    importarLoteDoCelular: () => ({ sucesso: true })
  }};
}

(async () => {
  mockarOutrosFirebase();
  mockarCloudinaryStorage();
  mockarDb();

  try { delete require.cache[require.resolve('../src/firebase-sync')]; } catch (e) {}
  const firebaseSync = require('../src/firebase-sync');
  await firebaseSync.garantirInicializado();

  // Documento no formato que o celular grava no Firestore: assinatura e
  // fotos como URL do Cloudinary, nunca base64 (regra do prompt).
  const conteudoRecebidoDoFirestore = {
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [{
      idExportacao: 'exp-conv-1',
      tipoDocumento: 'os',
      dados: {
        assinaturaClienteUrlStorage: 'https://res.cloudinary.com/fake/image/upload/v1/docsParaPC/exp-conv-1/assinatura-cliente.png',
        fotos: [
          { urlStorage: 'https://res.cloudinary.com/fake/image/upload/v1/docsParaPC/exp-conv-1/foto1.jpg' },
          { urlStorage: 'https://res.cloudinary.com/fake/image/upload/v1/docsParaPC/exp-conv-1/foto2.jpg' }
        ]
      }
    }]
  };

  const resolvido = await firebaseSync._interno.resolverUrlsParaBase64(conteudoRecebidoDoFirestore);
  const dadosOS = resolvido.itens[0].dados;

  assert(typeof dadosOS.assinaturaClienteBase64 === 'string' && dadosOS.assinaturaClienteBase64.length > 0,
    'assinaturaClienteUrlStorage é convertida para assinaturaClienteBase64 (string não vazia)');
  assert(dadosOS.assinaturaClienteUrlStorage === undefined,
    'Campo assinaturaClienteUrlStorage é removido após a conversão (não sobra campo órfão)');
  assert(dadosOS.fotos.every(f => typeof f.base64 === 'string' && f.base64.length > 0),
    'Todas as fotos do array ganham campo base64 após a conversão');
  assert(dadosOS.fotos.every(f => f.urlStorage === undefined),
    'Campo urlStorage de cada foto é removido após a conversão');

  // Confere que o conteúdo ORIGINAL (passado como argumento) não foi
  // mutado — resolverUrlsParaBase64 deve operar sobre uma cópia, porque
  // extrairCaminhosStorage (chamado depois, para saber o que apagar do
  // Storage) precisa do conteúdo ORIGINAL com as urlStorage intactas.
  assert(conteudoRecebidoDoFirestore.itens[0].dados.assinaturaClienteUrlStorage === 'https://res.cloudinary.com/fake/image/upload/v1/docsParaPC/exp-conv-1/assinatura-cliente.png',
    'O objeto original passado como argumento não é mutado (clone interno preservado)');

  console.log('\n' + (falhas === 0 ? '✅ Todos os testes passaram (0 falhas).' : `❌ ${falhas} teste(s) falharam.`));
  process.exit(falhas === 0 ? 0 : 1);
})();
