'use strict';

// Atualizações do Windows via GitHub Releases. O pacote publicado contém
// latest.yml + instalador + blockmap, gerados pelo electron-builder.
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

const REPOSITORIO = Object.freeze({
  owner: 'albertocodexx',
  repo: 'sistemaos-updates'
});

let iniciado = false;
let appElectron = null;
let obterJanela = null;
let aoPublicarEstado = null;
let instalacaoSolicitada = false;
let temporizadorInstalacao = null;
let temporizadorNovaTentativa = null;
let atualizacaoObrigatoriaDetectada = false;
let estado = { fase: 'ocioso', versaoAtual: '0.0.0', versaoNova: null, progresso: 0, mensagem: '' };
let ultimaFaseJanela = 'ocioso';

function versaoAtual() {
  try {
    const pacote = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pacote.version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

function publicar(parcial) {
  estado = Object.assign({}, estado, parcial, { versaoAtual: versaoAtual() });
  try { aoPublicarEstado?.(Object.assign({}, estado)); } catch (_) {}
  const janela = obterJanela?.();
  if (janela && !janela.isDestroyed()) {
    janela.webContents.send('update:status', estado);
    if (estado.fase === 'baixando') {
      janela.setProgressBar?.(Math.max(0.01, Math.min(1, Number(estado.progresso || 0) / 100)));
      if (ultimaFaseJanela !== 'baixando') {
        if (janela.isMinimized?.()) janela.restore?.();
        if (janela.isVisible && !janela.isVisible()) janela.show?.();
        janela.flashFrame?.(true);
      }
    } else if (estado.fase === 'pronto' || estado.fase === 'instalando') {
      janela.setProgressBar?.(1);
    } else {
      janela.setProgressBar?.(-1);
      janela.flashFrame?.(false);
    }
  }
  ultimaFaseJanela = estado.fase;
  return estado;
}

function erroLegivel(erro) {
  const texto = String(erro?.message || erro || 'Erro desconhecido');
  if (/404|not found/i.test(texto)) return 'Ainda não há uma atualização publicada no GitHub.';
  if (/net::|network|enotfound|offline|timed out/i.test(texto)) return 'Não foi possível verificar atualizações. Confira a internet.';
  return texto;
}

function inicializar({ app, getJanela, onEstado }) {
  if (iniciado) return;
  iniciado = true;
  appElectron = app;
  obterJanela = getJanela;
  aoPublicarEstado = typeof onEstado === 'function' ? onEstado : null;
  publicar({ fase: 'ocioso', mensagem: 'Atualizações pelo GitHub configuradas.' });

  // A atualização automática só roda na versão instalada. No modo de
  // desenvolvimento não há latest.yml nem instalador para substituir.
  if (!app?.isPackaged) {
    publicar({ fase: 'desenvolvimento', mensagem: 'Verificação automática disponível apenas no aplicativo instalado.' });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => publicar({ fase: 'verificando', progresso: 0, mensagem: 'Verificando atualizações...' }));
  autoUpdater.on('update-available', (info) => {
    atualizacaoObrigatoriaDetectada = true;
    clearTimeout(temporizadorNovaTentativa);
    publicar({
      fase: 'baixando', versaoNova: info.version || null, progresso: 0,
      mensagem: `Baixando a versão ${info.version || 'nova'}...`
    });
  });
  autoUpdater.on('download-progress', (progresso) => publicar({
    fase: 'baixando', progresso: Math.round(Number(progresso?.percent || 0)),
    mensagem: `Baixando atualização: ${Math.round(Number(progresso?.percent || 0))}%`
  }));
  autoUpdater.on('update-not-available', () => {
    atualizacaoObrigatoriaDetectada = false;
    clearTimeout(temporizadorNovaTentativa);
    publicar({
      fase: 'atualizado', versaoNova: null, progresso: 100, mensagem: 'Este computador já está na versão mais recente.'
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    publicar({
      fase: 'pronto', versaoNova: info.version || null, progresso: 100,
      mensagem: 'Atualização pronta. Reiniciando o Sistema OS...'
    });
    // No PC a atualização faz parte do boot: depois do download não existe
    // uma segunda confirmação. O atraso permite que a barra chegue a 100%.
    clearTimeout(temporizadorInstalacao);
    temporizadorInstalacao = setTimeout(() => instalar(), 900);
    temporizadorInstalacao.unref?.();
  });
  autoUpdater.on('error', (erro) => {
    publicar({ fase: 'erro', progresso: 0, mensagem: erroLegivel(erro) });
    // Se a release já foi encontrada, a versão antiga continua bloqueada e o
    // download é retomado automaticamente. Sem isto uma queda curta de rede
    // deixava a tela de abertura parada até o usuário reiniciar o programa.
    if (atualizacaoObrigatoriaDetectada && !instalacaoSolicitada) {
      clearTimeout(temporizadorNovaTentativa);
      temporizadorNovaTentativa = setTimeout(() => verificar().catch(() => {}), 15000);
      temporizadorNovaTentativa.unref?.();
    }
  });

  // A chamada de verificação é feita explicitamente pelo boot do main.js.
  // Assim a janela principal só é criada quando não existe versão nova.
}

async function verificar() {
  if (!appElectron?.isPackaged) return publicar({ fase: 'desenvolvimento', mensagem: 'Instale a versão distribuída para verificar atualizações.' });
  try {
    // Os eventos update-available/update-not-available/download-progress são a
    // fonte de verdade do estado. Não volte artificialmente para "verificando"
    // depois que o download já começou, pois isso escondia o botão Instalar.
    await autoUpdater.checkForUpdates();
    return obterEstado();
  } catch (erro) {
    return publicar({ fase: 'erro', mensagem: erroLegivel(erro) });
  }
}

function obterEstado() {
  return Object.assign({}, estado, { repositorio: `https://github.com/${REPOSITORIO.owner}/${REPOSITORIO.repo}/releases` });
}

function instalar() {
  if (estado.fase !== 'pronto') return { sucesso: false, erro: 'Nenhuma atualização baixada para instalar.' };
  if (instalacaoSolicitada) return { sucesso: true, mensagem: 'O instalador da atualização já está sendo iniciado.' };
  if (!appElectron?.isPackaged) return { sucesso: false, erro: 'Instale a versão distribuída para aplicar atualizações automáticas.' };

  instalacaoSolicitada = true;
  publicar({ fase: 'instalando', mensagem: 'Fechando o Sistema OS para instalar a atualização...' });
  setTimeout(() => {
    try {
      // O NSIS só pode iniciar depois que a resposta IPC retornou ao renderer.
      // Assim, a tela mostra o estado "instalando" antes do aplicativo fechar.
      // Atualizacao automatica deve ser silenciosa. O instalador completo
      // continua interativo quando aberto manualmente pelo usuario.
      autoUpdater.quitAndInstall(true, true);
    } catch (erro) {
      instalacaoSolicitada = false;
      publicar({ fase: 'erro', mensagem: `Não foi possível iniciar o instalador: ${erroLegivel(erro)}` });
    }
  }, 350);
  return { sucesso: true, mensagem: 'Fechando o Sistema OS para iniciar o instalador...' };
}

module.exports = { REPOSITORIO, inicializar, verificar, instalar, obterEstado, versaoAtual };
