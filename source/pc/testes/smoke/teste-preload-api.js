// Garante que o preload ainda publica a API usada pelo renderer, sem iniciar
// Electron. O módulo electron é simulado apenas para capturar a API exposta.
const path = require('path');
const Module = require('module');

const raiz = path.resolve(__dirname, '..', '..');
const caminhoElectron = require.resolve('electron');
const caminhoPreload = path.join(raiz, 'preload.js');
const originalElectron = Module._cache[caminhoElectron];
let apiExposta = null;
let falhas = 0;
const chamadasInvoke = [];

function verificar(condicao, mensagem) {
  if (condicao) console.log('OK  - ' + mensagem);
  else { falhas += 1; console.error('FALHOU - ' + mensagem); }
}

const electronSimulado = new Module(caminhoElectron);
electronSimulado.filename = caminhoElectron;
electronSimulado.loaded = true;
electronSimulado.exports = {
  contextBridge: {
    exposeInMainWorld: (nome, api) => { if (nome === 'api') apiExposta = api; }
  },
  ipcRenderer: {
    invoke: (canal, ...args) => {
      chamadasInvoke.push({ canal, args });
      return Promise.resolve();
    },
    on: () => undefined,
    removeListener: () => undefined,
  },
};

try {
  Module._cache[caminhoElectron] = electronSimulado;
  delete require.cache[require.resolve(caminhoPreload)];
  require(caminhoPreload);

  verificar(!!apiExposta, 'preload expõe window.api');
  [
    'oscriar', 'osatualizar', 'oslistar', 'configobter', 'configsalvar',
    'estoquecriar', 'compracriar', 'garantiasalvar', 'supabasestatus',
    'wappenviaraprovacao', 'updateVersaoAtual'
  ].forEach((nome) => verificar(typeof apiExposta?.[nome] === 'function', `API pública disponível: ${nome}`));

  [
    'criar', 'atualizar', 'listar', 'buscar', 'obter', 'statusValidos',
    'estatisticas', 'gerarPdf', 'abrirPdf', 'excluir', 'salvarFoto',
    'excluirFoto', 'substituirFoto', 'registrarRespostaTermos',
    'confirmarPagamentoPresencial'
  ].forEach((nome) => verificar(typeof apiExposta?.os?.[nome] === 'function', `API OS organizada disponível: os.${nome}`));

  verificar(apiExposta?.oscriar === apiExposta?.os?.criar, 'atalho legado oscriar aponta para API organizada');
  apiExposta?.os?.criar({ cliente: 'Teste' }, { id: 'u1' });
  const chamadaCriar = chamadasInvoke.at(-1);
  verificar(
    chamadaCriar?.canal === 'os:criar'
      && chamadaCriar.args[0]?.cliente === 'Teste'
      && chamadaCriar.args[1]?.id === 'u1',
    'API organizada mantém o canal e argumentos de os:criar'
  );

  [
    ['estoque', 'criar'],
    ['financeiro', 'relatorio'],
    ['mobile', 'sincronizarAgora'],
    ['usuarios', 'login'],
    ['whatsapp', 'enviar'],
    ['sistema', 'configuracao']
  ].forEach(([dominio, metodo]) => verificar(
    typeof apiExposta?.[dominio]?.[metodo] === 'function' || typeof apiExposta?.[dominio]?.[metodo] === 'object',
    `API agrupada disponível: ${dominio}.${metodo}`
  ));
} finally {
  delete require.cache[require.resolve(caminhoPreload)];
  if (originalElectron) Module._cache[caminhoElectron] = originalElectron;
  else delete Module._cache[caminhoElectron];
}

if (falhas) process.exit(1);
console.log('\nTeste da API do preload aprovado.');
