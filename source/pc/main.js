// main.js — v20: WhatsApp/notificação, relatório financeiro real, cruzamento estoque×OS
// Instale antes dos demais módulos. No Windows, processos em segundo plano
// podem herdar stdout/stderr que serão fechados depois; um log de diagnóstico
// jamais deve encerrar o aplicativo com EPIPE.
require('./src/safe-console').instalarConsoleSeguro();

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeImage, Tray, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const db = require('./src/db');
const backup = require('./src/backup');
const pdf = require('./src/pdf');
const comprovanteOS = require('./src/comprovante-os');
const uploadService = require('./src/uploadService');
const licenca = require('./src/licenca');
const auth = require('./src/auth');
const auditoria = require('./src/auditoria');
function moduloPreguicoso(carregador) {
  let modulo;
  const obter = () => (modulo || (modulo = carregador()));
  return new Proxy({}, {
    get: (_alvo, propriedade) => {
      const valor = obter()[propriedade];
      return typeof valor === 'function' ? valor.bind(obter()) : valor;
    },
    set: (_alvo, propriedade, valor) => { obter()[propriedade] = valor; return true; }
  });
}

// Baileys e os provedores de IA carregam muitas dependências. Eles ficam no
// processo principal e são materializados somente depois que a interface já
// começou a abrir; isso reduz o tempo de tela vazia sem pausar mensagens.
const whatsapp    = moduloPreguicoso(() => require('./src/whatsapp'));
const atualizador = require('./src/atualizador-github');
const iaGroq       = moduloPreguicoso(() => require('./src/ia-groq'));
const iaChat       = moduloPreguicoso(() => require('./src/ia-chat'));
const etiquetaOS    = require('./src/etiqueta-os');
const { registerAllIpcHandlers } = require('./src/ipc/register-all');
const { registerLegacyHandlers } = require('./src/ipc/register-legacy');
const { criarIpcMainSeguro } = require('./src/ipc/secure-ipc');
const { DesktopSupabaseRuntime } = require('./src/supabase/desktop-runtime');
const supabaseDesktop = new DesktopSupabaseRuntime();
auditoria.configurar({ db, supabaseDesktop });
// `build-resources` serve somente ao electron-builder e não é copiada para
// resources/app. Os ícones usados durante a execução ficam em `assets`, que
// faz parte do pacote instalado.
const CAMINHO_ICONE_APP = path.join(__dirname, 'assets', 'app-icon.ico');
const CAMINHO_ICONE_BANDEJA = path.join(__dirname, 'assets', 'tray-icon.png');
const NOME_ARQUIVO_PREFERENCIAS_LOCAIS = 'preferencias-locais.json';
const ID_APLICATIVO_WINDOWS = 'com.sistemaos.assistencia';

// Associa janela, atalho, bandeja e notificações ao mesmo aplicativo no
// Windows. Isso evita o quadrado vazio na barra de tarefas.
if (process.platform === 'win32') app.setAppUserModelId(ID_APLICATIVO_WINDOWS);

// ── Validação de path vindos do renderer ───────────────────────
// Os handlers IPC recebem caminhos arbitrários do renderer (que é
// tratado como não-confiável sob contextIsolation). Antes de
// repassá-los a shell.openPath / fs.*, confirme que estão dentro de
// um diretório confiável do app (PDFs, backup, comprovantes...).
// Resolve tambem links/junctions e limita tipos: um nome de PDF recebido da
// tela nunca pode abrir executaveis ou apontar para dados de outra empresa.
function caminhoDentroDe(caminho, raiz = db.getRootDir(), extensoes = ['.pdf']) {
  return require('./src/local-file-access').arquivoPermitido(caminho, raiz, extensoes);
}
const ROOT_APP = () => db.getRootDir();

// ── Trava de instância única ──────────────────────────────────────────────────
// Impede múltiplas instâncias simultâneas (ex: usuário clicando várias vezes
// durante o processo de atualização, quando o app ainda está fechando).
// Se já existe uma instância rodando, foca a janela existente e encerra esta.
const PROTOCOLO_RECUPERACAO_SUPABASE = 'sistemaos';
let janelaPrincipal;
let janelaAbertura;
let iconeBandeja;
let encerramentoSolicitado = false;
let rendererPrincipalPronto = false;
let urlRecuperacaoPendente = encontrarUrlRecuperacao(process.argv);
let urlAberturaOSPendente = encontrarUrlAberturaOS(process.argv);
let servicosEmSegundoPlanoEmAndamento = null;
let servicosEmSegundoPlanoProntos = false;

function mostrarJanelaPrincipal() {
  if (!janelaPrincipal || janelaPrincipal.isDestroyed()) {
    if (janelaAbertura && !janelaAbertura.isDestroyed()) {
      janelaAbertura.show();
      janelaAbertura.focus();
      return;
    }
    criarJanelaPrincipal();
    return;
  }
  if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
  janelaPrincipal.show();
  janelaPrincipal.focus();
  aplicarModoEconomicoJanela();
}

function criarIconeBandeja() {
  if (iconeBandeja && !iconeBandeja.isDestroyed()) return;
  // O Windows renderiza alguns ICOs multirresolução como um quadrado vazio
  // na área de ícones ocultos. A versão PNG, reduzida explicitamente para o
  // tamanho da bandeja, mantém a marca branca/verde visível nos dois temas.
  const imagemOriginal = nativeImage.createFromPath(CAMINHO_ICONE_BANDEJA);
  const imagemFallback = nativeImage.createFromPath(CAMINHO_ICONE_APP);
  const imagemExecutavel = nativeImage.createFromPath(process.execPath);
  const imagemBase = !imagemOriginal.isEmpty()
    ? imagemOriginal
    : (!imagemFallback.isEmpty() ? imagemFallback : imagemExecutavel);
  if (imagemBase.isEmpty()) {
    console.error('[Tray] Nenhum ícone válido foi encontrado:', {
      png: CAMINHO_ICONE_BANDEJA,
      ico: CAMINHO_ICONE_APP
    });
    return;
  }
  const imagem = imagemBase.resize({ width: 20, height: 20, quality: 'best' });
  iconeBandeja = new Tray(imagem);
  iconeBandeja.setToolTip('Sistema OS - atendimento automatico ativo');
  iconeBandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Sistema OS', click: mostrarJanelaPrincipal },
    { type: 'separator' },
    {
      label: 'Sair completamente',
      click: () => {
        encerramentoSolicitado = true;
        app.quit();
      }
    }
  ]));
  iconeBandeja.on('double-click', mostrarJanelaPrincipal);
}

function obterPreferenciasLocais() {
  const padrao = {
    abrirComWindows: true,
    modoEconomicoSegundoPlano: true
  };
  try {
    const caminho = path.join(app.getPath('userData'), NOME_ARQUIVO_PREFERENCIAS_LOCAIS);
    const salvo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    return {
      abrirComWindows: salvo.abrirComWindows !== false,
      modoEconomicoSegundoPlano: salvo.modoEconomicoSegundoPlano !== false
    };
  } catch (_) {
    return padrao;
  }
}

function salvarPreferenciasLocais(preferencias) {
  const atuais = obterPreferenciasLocais();
  const normalizadas = {
    abrirComWindows: typeof preferencias?.abrirComWindows === 'boolean'
      ? preferencias.abrirComWindows : atuais.abrirComWindows,
    modoEconomicoSegundoPlano: typeof preferencias?.modoEconomicoSegundoPlano === 'boolean'
      ? preferencias.modoEconomicoSegundoPlano : atuais.modoEconomicoSegundoPlano
  };
  const caminho = path.join(app.getPath('userData'), NOME_ARQUIVO_PREFERENCIAS_LOCAIS);
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, JSON.stringify(normalizadas, null, 2), 'utf8');
  return normalizadas;
}

function configurarInicioComWindows(abrirComWindows = obterPreferenciasLocais().abrirComWindows) {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: abrirComWindows === true,
      enabled: abrirComWindows === true,
      name: ID_APLICATIVO_WINDOWS,
      path: process.execPath,
      args: ['--background']
    });
  } catch (erro) {
    console.error('[Startup] Nao foi possivel alterar a inicializacao com o Windows:', erro.message);
  }
}

function aplicarModoEconomicoJanela() {
  if (!janelaPrincipal || janelaPrincipal.isDestroyed()) return;
  const preferencias = obterPreferenciasLocais();
  const emSegundoPlano = preferencias.modoEconomicoSegundoPlano === true
    && !janelaPrincipal.isVisible();
  // O Chromium reduz timers, animacoes e trabalho de pintura quando a janela
  // esta oculta. Servicos essenciais (Supabase, WhatsApp, backup e cobrancas)
  // continuam no processo principal e nao sao pausados.
  janelaPrincipal.webContents.setBackgroundThrottling(
    preferencias.modoEconomicoSegundoPlano === true
  );
  if (rendererPrincipalPronto) {
    janelaPrincipal.webContents.send('sistemaos:modo-segundo-plano', {
      ativo: emSegundoPlano,
      economiaHabilitada: preferencias.modoEconomicoSegundoPlano === true
    });
  }
}

function encontrarUrlRecuperacao(argumentos) {
  return (argumentos || []).find((argumento) => {
    try {
      const url = new URL(argumento);
      return url.protocol === `${PROTOCOLO_RECUPERACAO_SUPABASE}:` &&
        url.hostname === 'auth' && url.pathname === '/callback';
    } catch (_) {
      return false;
    }
  }) || '';
}

function entregarUrlRecuperacao(url) {
  if (!url) return;
  urlRecuperacaoPendente = url;
  if (!rendererPrincipalPronto || !janelaPrincipal || janelaPrincipal.isDestroyed()) return;
  janelaPrincipal.webContents.send('supabase:recuperacao-url', urlRecuperacaoPendente);
  urlRecuperacaoPendente = '';
}

function encontrarUrlAberturaOS(argumentos) {
  return (argumentos || []).find((argumento) => etiquetaOS.extrairNumeroLinkOS(argumento)) || '';
}

function entregarUrlAberturaOS(url) {
  const numero = etiquetaOS.extrairNumeroLinkOS(url);
  if (!numero) return;
  urlAberturaOSPendente = url;
  if (!rendererPrincipalPronto || !janelaPrincipal || janelaPrincipal.isDestroyed()) return;
  janelaPrincipal.webContents.send('sistemaos:abrir-os-url', { numero, url });
  urlAberturaOSPendente = '';
}

function registrarProtocoloRecuperacao() {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(PROTOCOLO_RECUPERACAO_SUPABASE, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOLO_RECUPERACAO_SUPABASE);
  }
}

registrarProtocoloRecuperacao();

app.on('open-url', (evento, url) => {
  evento.preventDefault();
  entregarUrlRecuperacao(encontrarUrlRecuperacao([url]));
  entregarUrlAberturaOS(encontrarUrlAberturaOS([url]));
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', (_evento, argumentos) => {
  // Uma segunda tentativa de abrir o app exibe a janela que estava na bandeja.
  mostrarJanelaPrincipal();
  entregarUrlRecuperacao(encontrarUrlRecuperacao(argumentos));
  entregarUrlAberturaOS(encontrarUrlAberturaOS(argumentos));
});

// ── Trava de regressão (Etapa 12): toda BrowserWindow do app DEVE
// usar estas webPreferences. Qualquer janela nova deve espalhar este
// objeto, nunca declarar contextIsolation/nodeIntegration manualmente.
// O renderer segue isolado e sem Node.js. O sandbox do preload fica
// desligado porque a ponte segura usa src/preload/api.js; com sandbox ativo
// o Electron não carrega módulos locais no preload e window.api não existe.
const WEB_PREFERENCES_SEGURAS = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  devTools: !app.isPackaged
});

function criarTelaAbertura() {
  if (janelaAbertura && !janelaAbertura.isDestroyed()) return janelaAbertura;
  janelaAbertura = new BrowserWindow({
    width: 480,
    height: 310,
    show: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    backgroundColor: '#080808',
    icon: CAMINHO_ICONE_APP,
    webPreferences: { ...WEB_PREFERENCES_SEGURAS, sandbox: true }
  });
  janelaAbertura.loadFile(path.join(__dirname, 'renderer', 'boot.html'));
  janelaAbertura.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janelaAbertura.webContents.on('will-navigate', (evento, destino) => {
    if (destino !== janelaAbertura.webContents.getURL()) evento.preventDefault();
  });
  return janelaAbertura;
}

function atualizarTelaAbertura(progresso, texto) {
  if (!janelaAbertura || janelaAbertura.isDestroyed()) return;
  const codigo = `window.SistemaOSBoot?.atualizar(${Number(progresso) || 0},${JSON.stringify(String(texto || ''))})`;
  janelaAbertura.webContents.executeJavaScript(codigo, true).catch(() => {});
}

function refletirAtualizacaoNaAbertura(estado) {
  estado = estado || {};
  if (estado.fase === 'verificando') atualizarTelaAbertura(8, 'Verificando atualização obrigatória…');
  else if (estado.fase === 'baixando') {
    atualizarTelaAbertura(10 + Math.round(Math.max(0, Math.min(100, Number(estado.progresso) || 0)) * .78), estado.mensagem);
  } else if (estado.fase === 'pronto' || estado.fase === 'instalando') {
    atualizarTelaAbertura(96, estado.mensagem || 'Instalando atualização…');
  } else if (estado.fase === 'erro') {
    atualizarTelaAbertura(14, estado.mensagem || 'Não foi possível verificar atualizações.');
  }
}

function fecharTelaAbertura() {
  if (!janelaAbertura || janelaAbertura.isDestroyed()) return;
  janelaAbertura.destroy();
  janelaAbertura = null;
}

function criarJanelaPrincipal() {
  rendererPrincipalPronto = false;
  // Respeita a area util logica do monitor. Em Windows com escala de 125% ou
  // 150%, um tamanho fixo de 1440x920 pode ser maior que a tela disponivel e
  // comprimir modais/rodapes mesmo em um monitor Full HD.
  const areaUtil = screen.getPrimaryDisplay().workAreaSize;
  const larguraInicial = Math.min(1440, areaUtil.width);
  const alturaInicial = Math.min(920, areaUtil.height);
  const larguraMinima = Math.min(1000, larguraInicial);
  const alturaMinima = Math.min(620, alturaInicial);
  janelaPrincipal = new BrowserWindow({
    show: false,
    width: larguraInicial,
    height: alturaInicial,
    minWidth: larguraMinima,
    minHeight: alturaMinima,
    title: 'Sistema OS',
    icon: CAMINHO_ICONE_APP,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      ...WEB_PREFERENCES_SEGURAS,
      backgroundThrottling: true
    }
  });
  janelaPrincipal.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // O renderer e local. Links recebidos de clientes, QR Codes ou APIs nunca
  // podem transformar a janela privilegiada do aplicativo em um navegador.
  janelaPrincipal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janelaPrincipal.webContents.on('will-navigate', (evento, destino) => {
    if (destino !== janelaPrincipal.webContents.getURL()) evento.preventDefault();
  });
  janelaPrincipal.webContents.on('will-attach-webview', (evento) => evento.preventDefault());
  janelaPrincipal.webContents.once('did-finish-load', () => {
    rendererPrincipalPronto = true;
    entregarUrlRecuperacao(urlRecuperacaoPendente);
    entregarUrlAberturaOS(urlAberturaOSPendente);
    aplicarModoEconomicoJanela();
    atualizarTelaAbertura(100, 'Tudo pronto.');
    janelaPrincipal.show();
    janelaPrincipal.focus();
    setTimeout(fecharTelaAbertura, 120);
  });
  janelaPrincipal.on('close', (evento) => {
    if (encerramentoSolicitado) return;
    evento.preventDefault();
    // Fechar pelo X apenas recolhe o aplicativo para os itens ocultos do
    // Windows. A bandeja continua oferecendo "Abrir" e "Sair completamente",
    // sem balão ou mensagem repetitiva na tela.
    janelaPrincipal.hide();
    aplicarModoEconomicoJanela();
  });
  janelaPrincipal.on('show', aplicarModoEconomicoJanela);
  janelaPrincipal.on('focus', aplicarModoEconomicoJanela);
  // WhatsApp, IA e polling podem abrir conexões e nunca devem atrasar a
  // primeira pintura da janela. Se já foram preparados em segundo plano,
  // apenas recebem a nova janela (por exemplo, ao abrir pela bandeja).
  if (servicosEmSegundoPlanoProntos) vincularServicosNaJanela();

  // Ferramentas de desenvolvimento ficam disponiveis apenas ao executar o
  // codigo-fonte. Na versao instalada elas ampliariam a superficie de ataque.
  if (!app.isPackaged) {
    janelaPrincipal.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault();
        janelaPrincipal.webContents.toggleDevTools();
      }
    });
  }
}

const ipcMainSeguro = criarIpcMainSeguro({
  ipcMain, supabaseDesktop, auditoria,
  getJanelaPrincipal: () => janelaPrincipal,
  rendererUrl: pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href,
  revalidarSessaoLocal: id => auth.revalidarSessao(id)
});
registerLegacyHandlers({
  ipcMain: ipcMainSeguro, dialog, shell, app, BrowserWindow, path, fs,
  db, backup, pdf, comprovanteOS, uploadService, licenca,
  auth, auditoria, whatsapp, atualizador, iaGroq, iaChat, supabaseDesktop,
  etiquetaOS,
  registerAllIpcHandlers, caminhoDentroDe,
  getJanelaPrincipal: () => janelaPrincipal,
  raizApp: __dirname,
  getUsuarioAutenticado: () => ipcMainSeguro.obterUsuarioAutenticado()
});

ipcMainSeguro.handle('config:preferenciasLocais', () => obterPreferenciasLocais());
ipcMainSeguro.handle('config:salvarPreferenciasLocais', (_e, preferencias) => {
  const salvas = salvarPreferenciasLocais(preferencias || {});
  configurarInicioComWindows(salvas.abrirComWindows);
  aplicarModoEconomicoJanela();
  return salvas;
});

function vincularServicosNaJanela() {
  whatsapp.init(janelaPrincipal || null, ipcMainSeguro);
  iaGroq.initNotificacoes(janelaPrincipal || null);
  backup.definirJanelaPollMP?.(janelaPrincipal || null);
}

function iniciarServicosEmSegundoPlano() {
  if (servicosEmSegundoPlanoEmAndamento) return servicosEmSegundoPlanoEmAndamento;
  // Não use await no ciclo que cria a janela. A restauração de sessão inclui
  // chamadas à nuvem, configuração, logo e um possível backup da empresa;
  // fazê-la antes de loadFile fazia o aplicativo parecer parado ao abrir.
  servicosEmSegundoPlanoEmAndamento = (async () => {
    try {
      await supabaseDesktop.inicializar({
        db, safeStorage, nativeImage,
        getJanela: () => janelaPrincipal
      });
      whatsapp.definirGeradorPreferenciaMercadoPago?.((dados) => (
        supabaseDesktop.criarPreferenciaMercadoPago(dados)
      ));
      whatsapp.definirRoteadorApiOficial?.((dados) => supabaseDesktop.rotearWhatsAppOficial(dados));
    } catch (err) {
      console.error('[Startup] Supabase Desktop indisponível:', err.message);
    }

    backup.definirPublicadorNuvem((caminho) => supabaseDesktop.publicarUltimoBackup(caminho));
    backup.definirConsultorMercadoPago((numero) => supabaseDesktop.consultarPagamentosMercadoPago(numero));
    servicosEmSegundoPlanoProntos = true;
    vincularServicosNaJanela();
    backup.iniciarAgendamentoBackup();
    backup.iniciarPollMP(janelaPrincipal);
  })();
  return servicosEmSegundoPlanoEmAndamento;
}

app.whenReady().then(async () => {
  // Backups só podem ser restaurados depois que o Supabase identifica a
  // empresa autenticada. Restaurar um arquivo global antes do login mistura
  // dados entre contas e, por isso, é expressamente proibido aqui.
  // Limpeza de migração antes de expor a UI: nenhum segredo de provedor
  // removido permanece no banco local.
  const inicioSomenteEmSegundoPlano = process.argv.includes('--background');
  if (!inicioSomenteEmSegundoPlano) criarTelaAbertura();
  await new Promise(resolve => setTimeout(resolve, 35));
  // Verifica antes de abrir o renderer/login. Se uma versão nova existir,
  // mantém somente a tela de carregamento, baixa e instala automaticamente;
  // a versão antiga nunca chega a ficar utilizável.
  atualizador.inicializar({
    app,
    getJanela: () => janelaPrincipal,
    onEstado: refletirAtualizacaoNaAbertura
  });
  const estadoAtualizacaoInicial = await atualizador.verificar();
  if (['baixando', 'pronto', 'instalando'].includes(estadoAtualizacaoInicial?.fase)) return;
  atualizarTelaAbertura(24, 'Protegendo os dados locais…');
  db.configurarArmazenamentoSeguro?.(safeStorage);
  db.removerConfiguracaoObsoleta?.();
  atualizarTelaAbertura(46, 'Verificando seu acesso…');
  auth.garantirAdminPadrao();       // Mantém cargos e migra usuários locais existentes sem criar credencial padrão
  atualizarTelaAbertura(64, 'Preparando documentos e arquivos…');
  uploadService.garantirEstruturaUploads();
  // Exibe a interface antes de iniciar rede, backup e integrações. Quando o
  // Windows abre com --background, a janela continua adiada até o clique na
  // bandeja e nenhum renderer consome CPU nesse período.
  atualizarTelaAbertura(82, 'Abrindo sua área de trabalho…');
  if (!inicioSomenteEmSegundoPlano) criarJanelaPrincipal();
  criarIconeBandeja();
  configurarInicioComWindows();
  void iniciarServicosEmSegundoPlano();
  app.on('activate', mostrarJanelaPrincipal);
});
app.on('before-quit', () => {
  encerramentoSolicitado = true;
});
app.on('window-all-closed', () => {
  supabaseDesktop.parar();
  backup.pararAgendamento();
  backup.pararPollMP();
  if (process.platform !== 'darwin' && encerramentoSolicitado) app.quit();
});
