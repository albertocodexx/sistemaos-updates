// Garante que a lista "Numeros atribuidos pelo PC" reflita somente as OS
// que ainda existem no banco local.

const path = require('path');
const Module = require('module');

function instalarMock(nomeModulo, exportsMock) {
  const resolvido = require.resolve(nomeModulo, { paths: [path.join(__dirname, '..')] });
  Module._cache[resolvido] = new Module(resolvido);
  Module._cache[resolvido].exports = exportsMock;
}

let falhas = 0;
function assert(condicao, mensagem) {
  if (condicao) console.log('OK:', mensagem);
  else {
    falhas++;
    console.error('FALHOU:', mensagem);
  }
}

const removidos = [];
const gravados = [];

instalarMock('./src/db', {
  loadDB: () => ({
    config: { firebaseConfig: { apiKey: 'a', projectId: 'p', appId: 'x' } },
    ordens: [
      { numero: 'OS-0003', origemIdExportacao: 'os-atual' },
      { numero: 'OS-0005', origemIdExportacao: 'os-sem-mapeamento' },
      { numero: 'OS-0099', origemIdExportacao: null }
    ]
  }),
  salvarConfig: () => {}
});
instalarMock('./src/cloudinary-storage', {});
instalarMock('firebase/app', { initializeApp: () => ({}) });
instalarMock('firebase/auth', {
  getAuth: () => ({}),
  signInAnonymously: async () => ({ user: { uid: 'uid-teste' } })
});
instalarMock('firebase/firestore', {
  getFirestore: () => ({}),
  collection: (_db, nome) => ({ nome }),
  doc: (_db, colecao, id) => ({ colecao, id }),
  getDocs: async () => ({
    docs: [
      { id: 'os-antiga', data: () => ({ numero: 'OS-0001' }) },
      { id: 'os-atual', data: () => ({ numero: 'OS-9999', criadoEm: 'antes' }) }
    ]
  }),
  deleteDoc: async (ref) => { removidos.push(ref); },
  setDoc: async (ref, dados) => { gravados.push({ ref, dados }); }
});

(async () => {
  delete require.cache[require.resolve('../src/firebase-sync')];
  const firebaseSync = require('../src/firebase-sync');
  const resultado = await firebaseSync._interno.reconciliarNumerosAtribuidos();

  assert(resultado.sucesso === true, 'conciliacao terminou com sucesso');
  assert(removidos.some(r => r.colecao === 'numerosAtribuidos' && r.id === 'os-antiga'),
    'removeu o cartao da OS antiga que nao existe mais');
  assert(gravados.some(g => g.ref.id === 'os-atual' && g.dados.numero === 'OS-0003'),
    'corrigiu o numero de uma OS existente');
  assert(gravados.some(g => g.ref.id === 'os-sem-mapeamento' && g.dados.numero === 'OS-0005'),
    'recriou o mapeamento ausente de uma OS existente');
  assert(!gravados.some(g => g.dados.numero === 'OS-0099'),
    'nao exibiu OS criada diretamente no PC');

  if (falhas) process.exit(1);
  console.log('Todos os testes passaram.');
})();
