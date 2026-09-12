const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const pacote = require('../../package.json');
const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(raiz, 'src', 'preload', 'api.js'), 'utf8');
const ipc = fs.readFileSync(path.join(raiz, 'src', 'ipc', 'register-legacy.js'), 'utf8');
const modulo = fs.readFileSync(path.join(raiz, 'src', 'atualizador-github.js'), 'utf8');
const tela = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');

assert.match(String(pacote.dependencies['electron-updater']), /^6\.8\.9$/);
assert.equal(fs.existsSync(path.join(raiz, 'src', 'atualizador.js')), false);
assert.match(main, /atualizador-github/);
assert.match(modulo, /albertocodexx/);
assert.match(modulo, /sistemaos-updates/);
assert.match(modulo, /quitAndInstall\(true, true\)/, 'atualizacao automatica deve instalar silenciosamente');
assert.match(modulo, /setProgressBar/, 'a barra do Windows deve indicar o andamento da atualizacao');
assert.match(modulo, /flashFrame/, 'a janela deve avisar visualmente quando o download comecar');
const htmlAtualizador = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'index.html'), 'utf8');
assert.match(htmlAtualizador, /updateAplicacaoOverlay/, 'a tela deve exibir um aviso central durante a atualizacao');
const instaladorNsis = fs.readFileSync(path.join(raiz, 'build-resources', 'installer.nsh'), 'utf8');
assert.match(instaladorNsis, /\$\{If\}\s+\$\{isUpdated\}[\s\S]*?Goto\s+sistema_os_fim_desinstalacao_personalizada/,
  'desinstalador interno deve pular toda limpeza durante atualizacoes');
assert(instaladorNsis.indexOf('${If} ${isUpdated}') < instaladorNsis.indexOf('RMDir /r "${APP_ELECTRON_DIR}"'),
  'guarda de atualizacao precisa executar antes de qualquer limpeza de dados');
assert.match(modulo, /autoUpdater\.checkForUpdates/);
assert.match(modulo, /atualizacaoObrigatoriaDetectada/);
assert.match(modulo, /setTimeout\(\(\) => verificar\(\)\.catch\(\(\) => \{\}\), 15000\)/,
  'download obrigatório deve tentar novamente após queda temporária');
assert.doesNotMatch(modulo, /resultado\?\.updateInfo\?\.version\s*\?\s*'verificando'/);
assert.match(preload, /updateVerificar/);
assert.match(preload, /updateInstalar/);
assert.match(ipc, /update:verificar/);
assert.match(ipc, /update:instalar/);
assert.match(tela, /btnInstalarAtualizacaoLogin/);
assert.match(tela, /id="updateGlobal"/);
assert.match(renderer, /updateGlobal/);
assert.match(renderer, /loginVisivel/);
assert.match(main, /atualizador\.inicializar\(\{[\s\S]{0,220}onEstado: refletirAtualizacaoNaAbertura/,
  'atualizador deve iniciar ainda na tela de carregamento');
assert.match(main, /await atualizador\.verificar\(\)[\s\S]{0,180}includes\(estadoAtualizacaoInicial\?\.fase\)\) return/,
  'versão antiga não pode abrir enquanto uma atualização está sendo baixada');
assert(main.indexOf('await atualizador.verificar()') < main.indexOf("atualizarTelaAbertura(24"),
  'checagem obrigatória deve acontecer antes de preparar e abrir a interface');
assert.doesNotMatch(ipc, /update:selecionarZip/);
assert.doesNotMatch(tela, /Selecionar Arquivo \.zip/);

console.log('OK: atualização manual por ZIP foi substituída pelo GitHub Releases no Windows.');

(async function testarFluxoCompletoDoAtualizador() {
  const { EventEmitter } = require('events');
  const Module = require('module');
  const carregadorOriginal = Module._load;
  const eventos = new EventEmitter();
  let instalacoes = 0;
  const autoUpdater = Object.assign(eventos, {
    checkForUpdates: async function () {
      eventos.emit('checking-for-update');
      eventos.emit('update-available', { version: '99.0.0' });
      eventos.emit('download-progress', { percent: 100 });
      eventos.emit('update-downloaded', { version: '99.0.0' });
      return { updateInfo: { version: '99.0.0' } };
    },
    quitAndInstall: function (silencioso, forcarExecucao) {
      assert.equal(silencioso, true);
      assert.equal(forcarExecucao, true);
      instalacoes += 1;
    }
  });
  Module._load = function (pedido, pai, principal) {
    if (pedido === 'electron-updater') return { autoUpdater };
    return carregadorOriginal.call(this, pedido, pai, principal);
  };
  const caminhoModulo = path.join(raiz, 'src', 'atualizador-github.js');
  delete require.cache[require.resolve(caminhoModulo)];
  const atualizador = require(caminhoModulo);
  Module._load = carregadorOriginal;

  const estados = [];
  const janela = {
    isDestroyed: () => false,
    webContents: { send: (_canal, dados) => estados.push(dados) }
  };
  atualizador.inicializar({ app: { isPackaged: true }, getJanela: () => janela, onEstado: dados => estados.push(dados) });
  const estado = await atualizador.verificar();
  assert.equal(estado.fase, 'pronto');
  assert.equal(estado.versaoNova, '99.0.0');
  assert.ok(estados.some(item => item.fase === 'baixando'));
  assert.equal(atualizador.instalar().sucesso, true);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(instalacoes, 1);
  console.log('OK: fluxo Windows verificou, baixou, liberou e acionou a instalação.');
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
