'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const janela = new BrowserWindow({
    width: 1280,
    height: 672,
    show: false,
    backgroundColor: '#101010',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.resolve(__dirname, '..', '..', 'preload.js')
    }
  });
  await janela.loadFile(path.resolve(__dirname, '..', '..', 'renderer', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 800));
  await janela.webContents.executeJavaScript(`
    const login = document.getElementById('telaLogin');
    login?.remove();
    document.body.classList.add('tema-escuro');
    window.fiscalSistemaOSHabilitado = () => true;
    window.mostrarDetalheOS({
      numero: 'OS-0019',
      data: '2026-08-08T20:00:00.000Z',
      status: 'Em reparo',
      statusPagamento: 'Aguardando Pagamento na Retirada',
      prioridade: 'Baixa',
      pdfPath: 'C:/teste/OS-0019.pdf',
      cliente: { nome: 'Gabriela', telefone: '(31) 99999-9999', cpf: '123.456.789-00', email: 'cliente@exemplo.com' },
      aparelho: { marca: 'Motorola', modelo: 'Moto G9 Play', cor: 'Azul', tipoEquipamento: 'Smartphone', imei: '000000000000000', acessorios: 'Capa', defeitoRelatado: 'Trocar tela com aro' },
      diagnosticoTecnico: { diagnostico: 'Tela danificada', solucao: 'Substituir conjunto frontal', valorEstimado: 220 }
    });
  `);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const diagnostico = await janela.webContents.executeJavaScript(`(() => {
    const modal = document.getElementById('modalDetalheOS');
    const login = document.getElementById('telaLogin');
    return {
      loginExiste: Boolean(login),
      loginDisplay: login ? getComputedStyle(login).display : null,
      modalClasse: modal?.className || null,
      modalDisplay: modal ? getComputedStyle(modal).display : null,
      modalRetangulo: modal ? modal.getBoundingClientRect().toJSON() : null,
      titulo: document.getElementById('detalheNumero')?.textContent || null
    };
  })()`);
  fs.writeFileSync(path.resolve(__dirname, 'saida-modal-os.json'), JSON.stringify(diagnostico, null, 2));
  await janela.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  janela.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const imagem = await janela.webContents.capturePage();
  const destino = path.resolve(__dirname, 'saida-modal-os.png');
  fs.writeFileSync(destino, imagem.toPNG());
  await janela.webContents.executeJavaScript(`(() => {
    const menu = document.querySelector('#detalheAcoes details.menu-acoes-os');
    if (menu) menu.open = true;
  })()`);
  await janela.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  janela.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const imagemAcoes = await janela.webContents.capturePage();
  fs.writeFileSync(path.resolve(__dirname, 'saida-modal-os-acoes.png'), imagemAcoes.toPNG());
  await janela.webContents.executeJavaScript(`document.getElementById('modalDetalheOS')?.classList.add('escondido')`);
  await janela.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  janela.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const imagemFormulario = await janela.webContents.capturePage();
  fs.writeFileSync(path.resolve(__dirname, 'saida-formulario-os.png'), imagemFormulario.toPNG());
  await janela.webContents.executeJavaScript(`(() => {
    const modal = document.getElementById('modalEditarOS');
    if (modal) modal.classList.remove('escondido');
    const numero = document.getElementById('modalEditarNumero');
    if (numero) numero.textContent = 'OS-0019';
  })()`);
  await janela.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  janela.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const imagemEdicao = await janela.webContents.capturePage();
  fs.writeFileSync(path.resolve(__dirname, 'saida-editar-os.png'), imagemEdicao.toPNG());
  await janela.webContents.executeJavaScript(`(() => {
    document.getElementById('modalEditarOS')?.classList.add('escondido');
    document.getElementById('modalConfig')?.classList.remove('escondido');
  })()`);
  await janela.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  janela.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const imagemConfig = await janela.webContents.capturePage();
  fs.writeFileSync(path.resolve(__dirname, 'saida-configuracoes.png'), imagemConfig.toPNG());
  await janela.webContents.executeJavaScript(`(() => {
    window.api = {
      supabasestatus: async () => ({ autenticado: true, empresaId: 'empresa-teste', fiscalHabilitado: true }),
      supabasefiscaldocumentos: async () => ({
        sucesso: true,
        configuracao: { ambiente: 'homologacao', status: 'nao_configurada', metadados: {}, ultimo_erro: 'Complete as quatro etapas e solicite a ativação fiscal.' },
        notas: []
      }),
      supabasecriarchamadosuporte: async () => ({ sucesso: true, protocolo: 'SUP-TESTE' })
    };
    document.dispatchEvent(new CustomEvent('sistemaos:sessao-pronta', { detail: { fiscalHabilitado: true } }));
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 2450));
  await janela.webContents.executeJavaScript(`(() => {
    const busca = document.querySelector('#modalConfig .config-busca input');
    if (busca) { busca.value = 'fiscal'; busca.dispatchEvent(new Event('input', { bubbles: true })); }
    document.getElementById('configFiscalEmpresa')?.scrollIntoView({ block: 'start' });
  })()`);
  await janela.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  janela.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const imagemFiscal = await janela.webContents.capturePage();
  fs.writeFileSync(path.resolve(__dirname, 'saida-config-fiscal.png'), imagemFiscal.toPNG());
  console.log(destino);
  janela.destroy();
  app.quit();
}).catch((erro) => {
  console.error(erro);
  app.exit(1);
});
