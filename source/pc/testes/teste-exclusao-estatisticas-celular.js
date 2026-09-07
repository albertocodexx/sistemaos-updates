// testes/teste-exclusao-estatisticas-celular.js
// ═══════════════════════════════════════════════════════════════
// Bug: o botão "Excluir" na tela de Estatísticas do celular não fazia
// nada, sem nenhum feedback de erro. Causa raiz combinada:
//
//   1) As OS listadas em Estatísticas vêm do resumo remoto agregado
//      pelo PC (montarResumoEstatisticas), que ANTES não incluía
//      origemIdExportacao — o único campo que o fluxo de exclusão do
//      celular (notificarExclusaoParaPC) usava para identificar a OS.
//   2) O listener do PC (iniciarEscutaExclusoesDoCelular) só sabia
//      localizar a OS por origemIdExportacao — mas a maioria das OS
//      criadas direto no PC nunca teve esse campo, então a exclusão
//      falhava silenciosamente mesmo depois de corrigido o (1).
//
// Este teste cobre os dois lados da correção:
//   a) montarResumoEstatisticas() agora inclui origemIdExportacao
//      (podendo ser null) em cada item de ordensAbertas.
//   b) processarExclusaoRecebidaDoCelular() localiza o registro por
//      origemIdExportacao OU, na ausência dele, por número (fallback),
//      usando o campo `numero` enviado junto no aviso de exclusão.
//
// Rodar com: node testes/teste-exclusao-estatisticas-celular.js
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
      setDoc: async () => {},
      deleteDoc: async () => {},
      onSnapshot: () => (() => {})
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

function carregarFirebaseSync(database, chamadasExclusao) {
  criarMockModuloFirebase();
  criarMockDb(database, chamadasExclusao);
  limparCacheFirebaseSync();
  return require('../src/firebase-sync');
}

function testeResumoIncluiOrigemIdExportacao() {
  const database = {
    ordens: [
      { numero: 'OS-0001', status: 'Em andamento', origemIdExportacao: 'exp-abc', cliente: {}, aparelho: {} },
      { numero: 'OS-0002', status: 'Em andamento', origemIdExportacao: null, cliente: {}, aparelho: {} }
    ]
  };
  const firebaseSync = carregarFirebaseSync(database, []);
  const resumo = firebaseSync._interno.montarResumoEstatisticas();

  const item1 = resumo.ordensAbertas.find(o => o.numero === 'OS-0001');
  const item2 = resumo.ordensAbertas.find(o => o.numero === 'OS-0002');

  assert(!!item1 && item1.origemIdExportacao === 'exp-abc', 'resumo inclui origemIdExportacao quando a OS tem esse campo');
  assert(!!item2 && item2.origemIdExportacao === null, 'resumo inclui origemIdExportacao: null quando a OS não tem esse campo (não quebra, não omite o campo)');
}

function testeExclusaoPorOrigemIdExportacao() {
  const database = {
    ordens: [{ numero: 'OS-0007', status: 'Em andamento', origemIdExportacao: 'exp-777' }]
  };
  const chamadas = [];
  const firebaseSync = carregarFirebaseSync(database, chamadas);

  firebaseSync._interno.processarExclusaoRecebidaDoCelular('exp-777', { tipoDocumento: 'os', numero: 'OS-0007' });

  assert(chamadas.length === 1 && chamadas[0].tipo === 'os' && chamadas[0].numero === 'OS-0007',
    'exclusão localizada por origemIdExportacao funciona (fluxo antigo, OS criada no celular)');
}

function testeExclusaoPorFallbackNumero() {
  // Caso mais comum na prática: OS criada direto no PC, sem
  // origemIdExportacao — o docId em exclusoesParaPC vem no formato
  // 'numero:X' (ver notificarExclusaoParaPC no celular), e o PC precisa
  // achar o registro pelo campo `numero` enviado no conteúdo do aviso.
  const database = {
    ordens: [{ numero: 'OS-0042', status: 'Em andamento', origemIdExportacao: null }]
  };
  const chamadas = [];
  const firebaseSync = carregarFirebaseSync(database, chamadas);

  firebaseSync._interno.processarExclusaoRecebidaDoCelular('numero:OS-0042', { tipoDocumento: 'os', numero: 'OS-0042' });

  assert(chamadas.length === 1 && chamadas[0].tipo === 'os' && chamadas[0].numero === 'OS-0042',
    'exclusão localizada por fallback de número funciona (OS criada no PC, sem origemIdExportacao) — este era o bug relatado');
}

function testeExclusaoCompraEVendaPorFallback() {
  const database = {
    ordens: [],
    compras: [{ numero: 'C-0010', origemIdExportacao: null }],
    estoque: [{ id: 'V-0020', origemIdExportacao: null }]
  };
  const chamadas = [];
  const firebaseSync = carregarFirebaseSync(database, chamadas);

  firebaseSync._interno.processarExclusaoRecebidaDoCelular('numero:C-0010', { tipoDocumento: 'compra', numero: 'C-0010' });
  firebaseSync._interno.processarExclusaoRecebidaDoCelular('numero:V-0020', { tipoDocumento: 'venda', numero: 'V-0020' });

  assert(chamadas.some(c => c.tipo === 'compra' && c.numero === 'C-0010'), 'exclusão de compra por fallback de número funciona');
  assert(chamadas.some(c => c.tipo === 'venda' && c.id === 'V-0020'), 'exclusão de venda por fallback de número funciona');
}

function testeRegistroNaoEncontradoNaoLancaENaoExclui() {
  const database = { ordens: [{ numero: 'OS-9999', origemIdExportacao: null }] };
  const chamadas = [];
  const firebaseSync = carregarFirebaseSync(database, chamadas);

  let lancou = false;
  try {
    firebaseSync._interno.processarExclusaoRecebidaDoCelular('numero:OS-INEXISTENTE', { tipoDocumento: 'os', numero: 'OS-INEXISTENTE' });
  } catch (e) {
    lancou = true;
  }

  assert(!lancou, 'registro não encontrado não lança exceção (não trava o listener)');
  assert(chamadas.length === 0, 'registro não encontrado não chama excluirOS indevidamente');
}

// ── montarAtividadeRecentePC: PC empurra "o que mudou" (só leitura) ──
// pro celular saber de criação/edição no PC, sem duplicar dado editável.
function testeAtividadeRecenteIncluiOsRecemCriada() {
  const agora = new Date().toISOString();
  const database = {
    ordens: [{ numero: 'OS-0001', status: 'Em andamento', data: agora, cliente: { nome: 'Maria' }, historicoStatus: [] }],
    compras: [],
    estoque: []
  };
  const firebaseSync = carregarFirebaseSync(database, []);
  const atividade = firebaseSync._interno.montarAtividadeRecentePC(database);

  assert(atividade.length === 1, 'inclui a OS recém-criada na atividade recente');
  assert(atividade[0].tipoDocumento === 'os' && atividade[0].numero === 'OS-0001', 'campos corretos: ' + JSON.stringify(atividade[0]));
  assert(atividade[0].clienteNome === 'Maria', 'inclui nome do cliente');
}

function testeAtividadeRecenteIgnoraOsAntiga() {
  const dataAntiga = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(); // 72h atrás
  const database = {
    ordens: [{ numero: 'OS-0002', status: 'Em andamento', data: dataAntiga, cliente: {}, historicoStatus: [] }],
    compras: [],
    estoque: []
  };
  const firebaseSync = carregarFirebaseSync(database, []);
  const atividade = firebaseSync._interno.montarAtividadeRecentePC(database);

  assert(atividade.length === 0, 'OS com atividade há mais de 48h não aparece (documento não cresce sem limite)');
}

function testeAtividadeRecenteUsaUltimaMudancaDeStatus() {
  const agora = new Date().toISOString();
  const dataAntiga = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const database = {
    // Criada há 72h, mas teve o status mudado agora — deve contar como
    // atividade recente (é uma EDIÇÃO), mesmo com `data` de criação antiga.
    ordens: [{ numero: 'OS-0003', status: 'Pronto para retirada', data: dataAntiga, cliente: {}, historicoStatus: [{ status: 'Pronto para retirada', data: agora }] }],
    compras: [],
    estoque: []
  };
  const firebaseSync = carregarFirebaseSync(database, []);
  const atividade = firebaseSync._interno.montarAtividadeRecentePC(database);

  assert(atividade.length === 1, 'OS editada recentemente (mudança de status) aparece mesmo com data de criação antiga');
  assert(atividade[0].atualizadoEm === agora, 'usa a data da última mudança de status, não a data de criação');
}

function testeAtividadeRecenteIncluiCompraEVenda() {
  const agora = new Date().toISOString();
  const database = {
    ordens: [],
    compras: [{ numero: 'C-0001', data: agora, vendedor: { nome: 'João' }, aparelho: { marca: 'Samsung', modelo: 'A10' } }],
    estoque: [{ id: 'EST-0001', dataCadastro: agora, status: 'Pronto para venda', marca: 'Apple', modelo: 'iPhone 11' }]
  };
  const firebaseSync = carregarFirebaseSync(database, []);
  const atividade = firebaseSync._interno.montarAtividadeRecentePC(database);

  assert(atividade.some(a => a.tipoDocumento === 'compra' && a.numero === 'C-0001'), 'inclui compra recente');
  assert(atividade.some(a => a.tipoDocumento === 'venda' && a.numero === 'EST-0001'), 'inclui venda recente');
}

function testeResumoIncluiAtividadeRecente() {
  const agora = new Date().toISOString();
  const database = {
    ordens: [{ numero: 'OS-0005', status: 'Em andamento', data: agora, cliente: {}, historicoStatus: [] }],
    compras: [],
    estoque: []
  };
  const firebaseSync = carregarFirebaseSync(database, []);
  const resumo = firebaseSync._interno.montarResumoEstatisticas();

  assert(Array.isArray(resumo.atividadeRecente), 'montarResumoEstatisticas inclui o campo atividadeRecente');
  assert(resumo.atividadeRecente.length === 1, 'atividadeRecente reflete o estado atual do banco');
}

(async function main() {
  testeResumoIncluiOrigemIdExportacao();
  testeExclusaoPorOrigemIdExportacao();
  testeExclusaoPorFallbackNumero();
  testeExclusaoCompraEVendaPorFallback();
  testeRegistroNaoEncontradoNaoLancaENaoExclui();
  testeAtividadeRecenteIncluiOsRecemCriada();
  testeAtividadeRecenteIgnoraOsAntiga();
  testeAtividadeRecenteUsaUltimaMudancaDeStatus();
  testeAtividadeRecenteIncluiCompraEVenda();
  testeResumoIncluiAtividadeRecente();

  console.log('\n' + '='.repeat(50));
  console.log(`Total: ${total} testes, ${total - falhas} OK, ${falhas} FALHOU`);
  console.log('='.repeat(50));
  process.exit(falhas > 0 ? 1 : 0);
})();
