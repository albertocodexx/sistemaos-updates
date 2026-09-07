const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BrowserWindow, shell } = require('electron');
const db = require('./db');
const {
  VERSAO_TEMPLATE_COMPROVANTE,
  gerarHtmlComprovanteOS,
  montarModeloComprovanteOS
} = require('./templates/comprovante-os-template');

const FORMATOS = new Set(['58mm', '80mm', 'a4']);

function formatoSeguro(formato) {
  return FORMATOS.has(formato) ? formato : '80mm';
}

function nomeSeguro(valor) {
  return String(valor || 'SEM-NUMERO').replace(/[\\/:*?"<>|]/g, '_');
}

function diretorioComprovantes() {
  const dir = path.join(db.getPdfDir(), 'Comprovantes-OS');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function caminhoComprovante(numero, formato) {
  return path.join(
    diretorioComprovantes(),
    `COMPROVANTE-${nomeSeguro(numero)}-${formatoSeguro(formato)}.pdf`
  );
}

function hashModelo(osRegistro, config) {
  const modelo = montarModeloComprovanteOS(osRegistro, config);
  const imprimivel = {
    versaoTemplate: VERSAO_TEMPLATE_COMPROVANTE,
    numero: modelo.numero,
    revisao: modelo.revisao,
    empresa: modelo.empresa,
    cliente: modelo.cliente,
    aparelho: modelo.aparelho,
    defeito: modelo.defeito,
    diagnostico: modelo.diagnostico,
    servico: modelo.servico,
    pecas: modelo.pecas,
    valor: modelo.valor,
    pagamento: modelo.pagamento,
    prazo: modelo.prazo,
    garantia: modelo.garantia,
    tipo: modelo.tipo,
    entrega: modelo.entrega,
    temAssinaturaCliente: !!modelo.assinaturaCliente,
    temAssinaturaRecebimento: !!modelo.entrega?.assinatura
  };
  return crypto.createHash('sha256').update(JSON.stringify(imprimivel)).digest('hex');
}

function enriquecerComEntrega(registro, dadosExtras) {
  if (!registro || typeof registro !== 'object') return registro;
  const entregaSalva = db.obterEntregaPorNumeroOS
    ? db.obterEntregaPorNumeroOS(registro.numero)
    : null;
  const nomeRecebedor = String(
    dadosExtras?.nomeRetirou || dadosExtras?.recebidoPor ||
    entregaSalva?.nomeRetirou || entregaSalva?.recebidoPor ||
    registro.nomeRetirou || registro.recebidoPor || ''
  ).trim();
  if (!entregaSalva && !nomeRecebedor) return registro;
  const entrega = {
    ...(entregaSalva || {}),
    ...(dadosExtras || {}),
    nomeRetirou: nomeRecebedor,
    recebidoPor: nomeRecebedor
  };
  return {
    ...registro,
    tipoComprovante: 'entrega',
    entrega,
    dadosEntrega: entrega,
    nomeRetirou: entrega.nomeRetirou || '',
    cpfRetirou: entrega.cpfRetirou || '',
    telefoneRetirou: entrega.telefoneRetirou || '',
    reparoRealizado: entrega.reparoRealizado || registro.reparoRealizado || '',
    valorTotalServico: entrega.valorReparo || registro.valorTotalServico || 0,
    formaPagamento: entrega.formaPagamento || registro.formaPagamento || ''
  };
}

async function carregarHtmlEmJanela(html) {
  const janela = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    backgroundColor: '#FFFFFF',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  try {
    await janela.loadURL(`data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`);
    await janela.webContents.executeJavaScript(
      'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true',
      true
    );
    return { janela };
  } catch (erro) {
    janela.destroy();
    throw erro;
  }
}

async function alturaMicrons(janela) {
  const pixels = await janela.webContents.executeJavaScript(
    'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)',
    true
  );
  return Math.max(60000, Math.min(500000, Math.ceil((Number(pixels) / 96) * 25400) + 3000));
}

async function renderizarComprovante(html, formato) {
  const carregado = await carregarHtmlEmJanela(html);
  try {
    if (formato === 'a4') {
      return await carregado.janela.webContents.printToPDF({
        printBackground: true,
        landscape: false,
        pageSize: 'A4',
        margins: { marginType: 'none' },
        preferCSSPageSize: true
      });
    }
    const largura = (formato === '58mm' ? 58 : 80) / 25.4;
    const altura = (await alturaMicrons(carregado.janela)) / 25400;
    return await carregado.janela.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: { width: largura, height: altura },
      margins: { marginType: 'none' },
      preferCSSPageSize: false
    });
  } finally {
    carregado.janela.destroy();
  }
}

async function gerarComprovanteOS(numeroOuRegistro, formato, opcoes) {
  const registroBase = typeof numeroOuRegistro === 'object'
    ? numeroOuRegistro
    : db.obterOSPorNumero(numeroOuRegistro);
  const registro = enriquecerComEntrega(registroBase, opcoes?.dadosExtras);
  if (!registro) throw new Error('Ordem de serviço não encontrada.');
  if (!registro.numero || /PR[ÉE]VIA|SEM N[ÚU]MERO/i.test(String(registro.numero))) {
    throw new Error('O comprovante será emitido assim que a OS receber o número oficial.');
  }

  const tipo = formatoSeguro(formato);
  const config = db.obterConfig();
  const destino = caminhoComprovante(registro.numero, tipo);
  const destinoHash = `${destino}.sha256`;
  const hash = hashModelo(registro, config);
  const podeReusar = !(opcoes && opcoes.forcar) &&
    fs.existsSync(destino) &&
    fs.existsSync(destinoHash) &&
    fs.readFileSync(destinoHash, 'utf8').trim() === hash;
  if (podeReusar) return destino;

  const html = gerarHtmlComprovanteOS(registro, config, { formato: tipo });
  const buffer = await renderizarComprovante(html, tipo);
  fs.writeFileSync(destino, buffer);
  fs.writeFileSync(destinoHash, hash, 'utf8');
  return destino;
}

async function abrirComprovanteOS(numero, formato, dadosExtras) {
  const caminho = await gerarComprovanteOS(numero, formato, { dadosExtras });
  const erro = await shell.openPath(caminho);
  if (erro) throw new Error(`Não foi possível abrir o comprovante: ${erro}`);
  return caminho;
}

async function listarImpressoras() {
  const janela = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!janela) return [];
  const impressoras = await janela.webContents.getPrintersAsync();
  return impressoras.map((item) => ({
    nome: item.name,
    nomeExibicao: item.displayName || item.name,
    padrao: !!item.isDefault,
    status: item.status
  }));
}

async function imprimirComprovanteOS(numero, formato, nomeImpressora, copias, dadosExtras) {
  const registro = enriquecerComEntrega(db.obterOSPorNumero(numero), dadosExtras);
  if (!registro) throw new Error('Ordem de serviço não encontrada.');
  const tipo = formatoSeguro(formato);
  const html = gerarHtmlComprovanteOS(registro, db.obterConfig(), { formato: tipo });
  const carregado = await carregarHtmlEmJanela(html);
  try {
    const opcoes = {
      silent: !!nomeImpressora,
      printBackground: true,
      deviceName: nomeImpressora || undefined,
      margins: { marginType: 'none' },
      // Com diálogo aberto, o Windows usa o tamanho configurado no driver
      // da impressora térmica (58/80 mm). Forçar um tamanho arbitrário aqui
      // faria alguns drivers ignorarem a bobina selecionada pelo usuário.
      pageSize: tipo === 'a4' ? 'A4' : undefined
    };
    const totalCopias = Math.max(1, Math.min(2, Number(copias) || 1));
    if (totalCopias > 1) opcoes.copies = totalCopias;
    return await new Promise((resolve, reject) => {
      carregado.janela.webContents.print(opcoes, (sucesso, motivo) => {
        if (!sucesso) return reject(new Error(motivo || 'A impressão foi cancelada ou falhou.'));
        resolve({ sucesso: true });
      });
    });
  } finally {
    carregado.janela.destroy();
  }
}

module.exports = {
  gerarComprovanteOS,
  abrirComprovanteOS,
  imprimirComprovanteOS,
  listarImpressoras,
  caminhoComprovante
};
