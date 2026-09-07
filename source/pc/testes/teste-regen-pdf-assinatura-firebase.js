// Teste ad-hoc (não faz parte do sistema): confirma que, ao importar uma
// resposta de assinatura recebida via Firebase, o PDF é regenerado —
// bug corrigido em processarRespostaAssinaturaRecebida (src/firebase-sync.js).
const path = require('path');
const Module = require('module');

let falhas = 0;
function assert(cond, msg) {
  if (!cond) { falhas++; console.error('❌ FALHOU:', msg); }
  else console.log('✅', msg);
}

function instalarMock(nomeModulo, exportsMock) {
  const base = nomeModulo.startsWith('./') ? path.join(__dirname, '..', 'src') : path.join(__dirname, '..');
  const caminhoResolvido = require.resolve(nomeModulo, { paths: [base] });
  Module._cache[caminhoResolvido] = new Module(caminhoResolvido);
  Module._cache[caminhoResolvido].exports = exportsMock;
}

async function testeRegeneraPdfAoImportarRespostaViaFirebase() {
  const chamadasPdf = [];

  instalarMock('./db', {
    loadDB: () => ({ config: { firebaseConfig: { apiKey: 'a', projectId: 'p', appId: 'x' } }, ordens: [] }),
    salvarConfig: () => {},
    importarRespostaAssinatura: (conteudo) => ({
      sucesso: true,
      tipoDocumento: conteudo.tipoDocumento,
      registro: { numero: 'OS-0001', id: 'item-1' }
    }),
  });
  instalarMock('./cloudinary-storage', {
    uploadBase64: async () => ({ url: 'x', publicId: 'x' }),
    apagarArquivo: async () => {},
    baixarComoBase64: async () => 'base64fake',
  });
  instalarMock('./pdf', {
    gerarPdfDaOS: async (registro) => { chamadasPdf.push(['os', registro]); },
    gerarPdfCompra: async (registro) => { chamadasPdf.push(['compra', registro]); },
    gerarPdfVenda: async (registro) => { chamadasPdf.push(['venda', registro]); },
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
    setDoc: async () => {},
    deleteDoc: async () => {},
    onSnapshot: () => (() => {}),
  });

  delete require.cache[require.resolve('../src/firebase-sync')];
  const firebaseSync = require('../src/firebase-sync');

  await firebaseSync._interno.processarRespostaAssinaturaRecebida(
    'doc1',
    { tipoDocumento: 'os', respondido: true },
    () => {}
  );

  assert(chamadasPdf.length === 1, 'gerarPdf* foi chamado exatamente 1 vez após importar resposta via Firebase');
  assert(chamadasPdf[0] && chamadasPdf[0][0] === 'os', 'gerou o PDF do tipo correto (os)');
}

(async () => {
  await testeRegeneraPdfAoImportarRespostaViaFirebase();
  console.log('');
  if (falhas > 0) {
    console.error(`❌ ${falhas} falha(s).`);
    process.exit(1);
  } else {
    console.log('✅ Todos os testes passaram (0 falhas).');
  }
})();
