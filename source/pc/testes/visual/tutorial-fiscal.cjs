'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const raiz = path.resolve(__dirname, '..', '..');
const destino = path.resolve(__dirname, 'saida-tutorial-fiscal.png');

function responderCanal(canal, resposta) {
  ipcMain.handle(canal, async () => typeof resposta === 'function' ? resposta(...arguments) : resposta);
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  responderCanal('update:versaoAtual', { versao: '40.5.23' });
  responderCanal('update:estado', { disponivel: false });
  responderCanal('whatsapp:status', { conectado: false });
  responderCanal('supabase:listarContasRapidas', []);
  responderCanal('desbloqueio:termos', {});
  responderCanal('config:obter', {});
  responderCanal('supabase:assinaturasSaas', { sucesso: true, planos: [] });
  ipcMain.handle('supabase:status', async () => ({
    autenticado: true,
    empresaId: 'empresa-teste',
    administradorEmpresa: true,
    administradorGlobal: true,
    fiscalHabilitado: true
  }));
  ipcMain.handle('supabase:fiscalDocumentos', async (_evento, acao) => {
    if (acao === 'listar_limites_equipe') return { sucesso: true, limites: [], cargos: [], usuarios: [] };
    return {
      sucesso: true,
      configuracao: { ambiente: 'homologacao', status: 'nao_configurada', metadados: {} },
      notas: [], homologacoes: [], recargas: [],
      conta: { saldo_centavos: 0, limite_gratuito_mensal: 30, preco_excedente_centavos: 99 },
      uso_mes: 0,
      estimativa_notas_com_saldo: 0,
      capacidade_estimada_total: 30,
      nfeio_disponivel: true,
      emissor_operacional: false
    };
  });

  const janela = new BrowserWindow({
    width: 1280,
    height: 760,
    show: false,
    backgroundColor: '#101010',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.resolve(raiz, 'preload.js')
    }
  });

  await janela.loadFile(path.resolve(raiz, 'renderer', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 900));
  await janela.webContents.executeJavaScript(`(() => {
    document.getElementById('telaLogin')?.remove();
    document.body.classList.add('tema-escuro');
    document.getElementById('modalConfig')?.classList.remove('escondido');
  })()`);
  await janela.webContents.executeJavaScript(`window.abrirCadastroFiscalSuporte({ id: 'empresa-teste', nome_fantasia: 'Empresa Beta' })`);
  await new Promise((resolve) => setTimeout(resolve, 350));
  await janela.webContents.executeJavaScript(`(() => {
    const resultados = document.querySelector('[data-config-resultados]');
    if (resultados) resultados.hidden = true;
    const secao = document.getElementById('configFiscalEmpresa');
    if (secao) {
      for (let atual = secao; atual; atual = atual.parentElement) {
        atual.hidden = false;
        atual.classList.remove('escondido');
        if (atual.id === 'modalConfig') break;
      }
      secao.style.setProperty('display', 'block', 'important');
    }
    secao?.scrollIntoView({ block: 'start' });
  })()`);
  await janela.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

  const diagnostico = await janela.webContents.executeJavaScript(`(() => {
    const modal = document.querySelector('#modalConfig .modal-conteudo') || document.getElementById('modalConfig');
    const secao = document.getElementById('configFiscalEmpresa');
    const tutorial = document.getElementById('fiscalTutorialCadastro');
    const m = modal?.getBoundingClientRect();
    const s = secao?.getBoundingClientRect();
    const t = tutorial?.getBoundingClientRect();
    return {
      secaoVisivel: Boolean(secao && getComputedStyle(secao).display !== 'none' && !secao.hidden),
      tutorialVisivel: Boolean(tutorial && tutorial.open && getComputedStyle(tutorial).display !== 'none'),
      titulo: tutorial?.querySelector('summary')?.textContent?.trim() || '',
      semOverflowHorizontal: Boolean(m && s && t && s.width <= m.width + 1 && t.right <= s.right + 1 && t.left >= s.left - 1),
      temNfse: tutorial?.textContent?.includes('NFS-e — serviços') || false,
      temNfe: tutorial?.textContent?.includes('NF-e — produtos') || false,
      temNfce: tutorial?.textContent?.includes('NFC-e — venda ao consumidor') || false
    };
  })()`);

  assert.equal(diagnostico.secaoVisivel, true);
  assert.equal(diagnostico.tutorialVisivel, true);
  assert.equal(diagnostico.semOverflowHorizontal, true);
  assert.match(diagnostico.titulo, /Como cadastrar a empresa/);
  assert.equal(diagnostico.temNfse && diagnostico.temNfe && diagnostico.temNfce, true);

  janela.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const imagem = await janela.webContents.capturePage();
  fs.writeFileSync(destino, imagem.toPNG());
  console.log(`OK: tutorial fiscal responsivo e visível. Captura: ${destino}`);
  janela.destroy();
  app.quit();
}).catch((erro) => {
  console.error(erro);
  app.exit(1);
});
