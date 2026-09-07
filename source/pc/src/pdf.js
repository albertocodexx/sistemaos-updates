// src/pdf.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { BrowserWindow } = require('electron');
const db = require('./db');
const { gerarHtmlOS } = require('./templates/os-template');
const { gerarHtmlVenda } = require('./templates/venda-template');
const { gerarHtmlCompra } = require('./templates/compra-template');
const { gerarHtmlEntrega } = require('./templates/entrega-template');
const { gerarHtmlGarantia } = require('./templates/garantia-template');
const { gerarHtmlDesbloqueio, gerarHtmlDesbloqueioTermico } = require('./templates/desbloqueio-template');

// ── Renderiza um HTML para PDF ───────────────────────────────
// Antes, o HTML era carregado via `loadURL('data:text/html,...')`.
// Isso quebra com ERR_INVALID_URL (-300) quando o HTML é grande
// (ex: OS com várias fotos em base64), pois URLs data: têm um
// limite de tamanho no Chromium/Electron. A solução é escrever o
// HTML num arquivo temporário e usar loadFile, que não tem esse
// limite.
async function renderizarHtmlParaPdf(html, opcoesPdf) {
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `sistema-os-pdf-${crypto.randomUUID()}.html`);
  const tamanhoHtml = Buffer.byteLength(html, 'utf-8');
  console.log('[Pdf] renderizarHtmlParaPdf: início. tamanhoHtml:', tamanhoHtml, 'bytes | tmp:', path.basename(tmpPath));
  fs.writeFileSync(tmpPath, html, 'utf-8');
  // Aplica as mesmas webPreferences seguras usadas na janela principal
  // (contextIsolation:true, nodeIntegration:false, sandbox:true).
  // Esta janela não precisa de preload pois só renderiza HTML local para PDF.
  const janela = new BrowserWindow({ show: false, width: 900, height: 1200,
    backgroundColor: '#FFFFFF',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await janela.loadFile(tmpPath);
    const t0 = Date.now();
    const buffer = await janela.webContents.printToPDF(opcoesPdf);
    console.log('[Pdf] renderizarHtmlParaPdf: printToPDF OK. tamanhoPdf:', buffer.length, 'bytes | tempo:', (Date.now() - t0), 'ms');
    return buffer;
  } catch (err) {
    console.error('[Pdf] renderizarHtmlParaPdf: ERRO ao gerar PDF:', err.message);
    throw err;
  } finally {
    janela.destroy();
    fs.unlink(tmpPath, () => {}); // limpeza best-effort, não bloqueia o retorno
  }
}

async function imprimirHtmlLocal(html, opcoes = {}) {
  const tmpPath = path.join(os.tmpdir(), `sistema-os-impressao-${crypto.randomUUID()}.html`);
  fs.writeFileSync(tmpPath, html, 'utf-8');
  const janela = new BrowserWindow({
    show: false,
    width: 600,
    height: 1000,
    backgroundColor: '#FFFFFF',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  try {
    await janela.loadFile(tmpPath);
    await janela.webContents.executeJavaScript(
      'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true',
      true
    );
    return await new Promise((resolve, reject) => {
      janela.webContents.print({
        silent: !!opcoes.nomeImpressora,
        deviceName: opcoes.nomeImpressora || undefined,
        printBackground: true,
        margins: { marginType: 'none' }
      }, (sucesso, motivo) => {
        if (!sucesso) return reject(new Error(motivo || 'A impressão foi cancelada ou falhou.'));
        resolve({ sucesso: true });
      });
    });
  } finally {
    janela.destroy();
    fs.unlink(tmpPath, () => {});
  }
}

// ── Assinaturas em imagem ───────────────────────────────────────
// Não colocamos qualquer texto recebido no atributo src. Assinaturas antigas
// ou interrompidas podiam chegar como URL, "undefined" ou base64 truncado;
// o Chromium então desenhava o ícone de imagem quebrada no PDF. Aceitamos
// apenas PNG/JPEG/WebP válido e normalizamos para um data URL autocontido.
function normalizarAssinaturaParaImagem(valor) {
  const bruto = String(valor || '').trim();
  if (!bruto) return '';
  const encontrada = bruto.match(/^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  const base64 = (encontrada ? encontrada[1] : bruto).replace(/\s/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return '';

  let bytes;
  try { bytes = Buffer.from(base64, 'base64'); } catch { return ''; }
  if (bytes.length < 12) return '';

  let mime = '';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) mime = 'image/png';
  else if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) mime = 'image/jpeg';
  else if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') mime = 'image/webp';
  if (!mime) return '';

  return `data:${mime};base64,${base64}`;
}

function criarTagAssinatura(valor, alt) {
  const src = normalizarAssinaturaParaImagem(valor);
  if (!src) return '';
  return `<img src="${src}" alt="${alt}" onerror="this.remove()" style="max-height:100%;max-width:100%;object-fit:contain;" />`;
}

function obterEstadoAssinatura(registro, campoAssinatura) {
  if (registro && registro[campoAssinatura]) return '';
  return registro && registro.assinaturaPendente === true
    ? 'AGUARDANDO ASSINATURA'
    : 'NÃO ASSINADO';
}

function criarMarcadorEstadoAssinatura(texto) {
  if (!texto) return '';
  const cor = texto === 'AGUARDANDO ASSINATURA' ? '#9a6700' : '#b42318';
  return `<span data-assinatura-estado="1" style="display:flex;height:100%;align-items:flex-end;justify-content:center;padding-bottom:5px;box-sizing:border-box;font-size:10px;font-weight:800;letter-spacing:.08em;color:${cor};">${texto}</span>`;
}

// ── App Celular (assinatura em campo) — v43 ──
// Injeta a imagem da assinatura do cliente (base64, coletada no app web
// do celular) nos espaços reservados do template. O template
// (os-template.js) é reaproveitado sem alteração — tanto pelo PC quanto
// pelo celular — então a injeção acontece aqui, de fora, trocando o
// elemento `<div class="assinatura-espaco"></div>` que vem IMEDIATAMENTE
// ANTES do rótulo "ASSINATURA DO CLIENTE" por uma tag <img> com a
// assinatura. Como o HTML tem duas vias (cliente e assistência) lado a
// lado, cada uma com seu próprio bloco de assinatura do cliente, a troca
// é feita nas duas ocorrências.
function injetarAssinaturaClienteNoHtml(html, assinaturaClienteBase64, estadoTexto) {
  const imgTag = criarTagAssinatura(assinaturaClienteBase64, 'Assinatura do cliente');
  const conteudo = imgTag || criarMarcadorEstadoAssinatura(estadoTexto);
  if (!conteudo) return html;
  const padraoEspacoAntesDoLabel =
    /<div class="assinatura-espaco"><\/div>(\s*<div class="linha-assinatura"><\/div>\s*<div class="assinatura-label">ASSINATURA DO CLIENTE<\/div>)/g;
  return html.replace(
    padraoEspacoAntesDoLabel,
    `<div class="assinatura-espaco">${conteudo}</div>$1`
  );
}

// ── App Celular — lote v2 ──
// Mesma técnica de injeção usada para OS (injetarAssinaturaClienteNoHtml),
// mas para o bloco "ASSINATURA DO VENDEDOR" do template de Compra e o
// bloco "ASSINATURA DO COMPRADOR" do template de Venda. Cada documento
// tem 2 vias (ex.: "VIA DO VENDEDOR" / "VIA DA ASSISTÊNCIA"), cada uma
// com seu próprio par de blocos de assinatura — a troca via regex global
// cobre as duas ocorrências, e o rótulo no regex garante que só o bloco
// certo (vendedor/comprador, nunca o da assistência técnica) recebe a
// imagem. No template de Venda, o lado da assistência técnica é rotulado
// "ASSINATURA DA ASSISTÊNCIA TÉCNICA" (mesmo padrão do template de
// Compra) — não "VENDEDOR" — para não confundir com o papel de
// "vendedor" já usado na Compra (lá, a pessoa física que vende o
// aparelho USADO para a loja).
function _injetarAssinaturaPorLabel(html, assinaturaBase64, label, altText, estadoTexto) {
  const imgTag = criarTagAssinatura(assinaturaBase64, altText);
  const conteudo = imgTag || criarMarcadorEstadoAssinatura(estadoTexto);
  if (!conteudo) return html;
  const padrao = new RegExp(
    `<div class="assin-esp"></div>(\\s*<div class="assin-linha"></div>\\s*<div class="assin-label">${label}</div>)`,
    'g'
  );
  return html.replace(padrao, `<div class="assin-esp">${conteudo}</div>$1`);
}

function injetarAssinaturaVendedorCompraNoHtml(html, assinaturaVendedorBase64, estadoTexto) {
  return _injetarAssinaturaPorLabel(html, assinaturaVendedorBase64, 'ASSINATURA DO VENDEDOR', 'Assinatura do vendedor', estadoTexto);
}

function injetarAssinaturaCompradorVendaNoHtml(html, assinaturaCompradorBase64, estadoTexto) {
  return _injetarAssinaturaPorLabel(html, assinaturaCompradorBase64, 'ASSINATURA DO COMPRADOR', 'Assinatura do comprador', estadoTexto);
}

// ── App Celular — Entregas (garantia) ──
// entrega-template.js usa as mesmas classes curtas (assin-esp/assin-linha/
// assin-label) de Compra/Venda, então reaproveita _injetarAssinaturaPorLabel
// normalmente. Só há UM bloco de assinatura neste documento ("ASSINATURA DE
// QUEM RETIROU") — sem segunda via de assistência técnica, ao contrário dos
// outros 3 tipos (ver comentário no topo de entrega-template.js).
function injetarAssinaturaRetirouEntregaNoHtml(html, assinaturaRetirouBase64, estadoTexto) {
  return _injetarAssinaturaPorLabel(html, assinaturaRetirouBase64, 'ASSINATURA DE QUEM RETIROU', 'Assinatura de quem retirou', estadoTexto);
}

function injetarAssinaturaClienteDesbloqueioNoHtml(html, assinaturaClienteBase64, estadoTexto) {
  return _injetarAssinaturaPorLabel(html, assinaturaClienteBase64, 'ASSINATURA DO CLIENTE', 'Assinatura do cliente', estadoTexto);
}

// ── Assinatura da assistência técnica vinda do celular ──
// O celular agora envia uma "fotografia" de qual assinatura de assistência
// valia no momento da exportação daquele documento específico (assinada na
// hora, ou a padrão salva em Configurações, ou nenhuma — a regra de
// prioridade entre essas três é toda resolvida no celular; o PC só usa o
// valor como veio, nunca reaplica lógica própria por cima).
// Regra confirmada com o usuário: o valor vindo do celular SEMPRE
// sobrescreve qualquer assinatura de assistência que o registro já tivesse
// localmente no PC — inclusive sobrescrevendo com vazio, se foi isso que
// valia no momento da exportação.
//
// O template de Compra/Venda usa as classes curtas (assin-esp/assin-linha/
// assin-label); o template de OS usa as classes longas
// (assinatura-espaco/linha-assinatura/assinatura-label). Por isso a versão
// para OS não pode reaproveitar _injetarAssinaturaPorLabel (que é hardcoded
// pras classes curtas) — usa seu próprio regex, espelhando
// injetarAssinaturaClienteNoHtml.
function injetarAssinaturaAssistenciaOSNoHtml(html, assinaturaAssistenciaBase64) {
  const imgTag = criarTagAssinatura(assinaturaAssistenciaBase64, 'Assinatura da assistência técnica');
  if (!imgTag) return html;
  const padraoEspacoAntesDoLabel =
    /<div class="assinatura-espaco"><\/div>(\s*<div class="linha-assinatura"><\/div>\s*<div class="assinatura-label">ASSINATURA DA ASSISTÊNCIA TÉCNICA<\/div>)/g;
  return html.replace(
    padraoEspacoAntesDoLabel,
    `<div class="assinatura-espaco">${imgTag}</div>$1`
  );
}

function injetarAssinaturaAssistenciaCompraNoHtml(html, assinaturaAssistenciaBase64) {
  return _injetarAssinaturaPorLabel(html, assinaturaAssistenciaBase64, 'ASSINATURA DA ASSISTÊNCIA TÉCNICA', 'Assinatura da assistência técnica');
}

function injetarAssinaturaAssistenciaVendaNoHtml(html, assinaturaAssistenciaBase64) {
  return _injetarAssinaturaPorLabel(html, assinaturaAssistenciaBase64, 'ASSINATURA DA ASSISTÊNCIA TÉCNICA', 'Assinatura da assistência técnica');
}

async function gerarPdfDaOS(osOriginal) {
  console.log('[Pdf] gerarPdfDaOS: início. numero:', osOriginal.numero);
  const config = db.obterConfig();
  const os = osOriginal;
  let html = gerarHtmlOS(os, config);
  html = injetarAssinaturaClienteNoHtml(html, os.assinaturaClienteBase64, obterEstadoAssinatura(os, 'assinaturaClienteBase64'));
  html = injetarAssinaturaAssistenciaOSNoHtml(html, os.assinaturaAssistenciaBase64);
  const buffer = await renderizarHtmlParaPdf(html, {
    printBackground: true,
    landscape: false,
    pageSize: 'A4',
    preferCSSPageSize: true,
    margins: { marginType: 'none' }
  });
  const pdfDir = db.getPdfDir();
  const nomeArquivoSeguro = String(osOriginal.numero || '').replace(/[\\/:*?"<>|]/g, '_');
  const caminho = path.join(pdfDir, `${nomeArquivoSeguro}.pdf`);
  fs.writeFileSync(caminho, buffer);
  db.atualizarCaminhoPdf(osOriginal.numero, caminho);
  console.log('[Pdf] gerarPdfDaOS: fim. caminho:', caminho, '| tamanho:', buffer.length, 'bytes');
  return caminho;
}

async function regenerarPdfPorNumero(numero) {
  const os = db.obterOSPorNumero(numero);
  if (!os) throw new Error(`OS ${numero} não encontrada.`);
  return gerarPdfDaOS(os);
}

async function gerarPdfVenda(item) {
  console.log('[Pdf] gerarPdfVenda: início. id:', item.id);
  const config = db.obterConfig();
  let html = gerarHtmlVenda(item, config);
  html = injetarAssinaturaCompradorVendaNoHtml(html, item.assinaturaCompradorBase64, obterEstadoAssinatura(item, 'assinaturaCompradorBase64'));
  html = injetarAssinaturaAssistenciaVendaNoHtml(html, item.assinaturaAssistenciaBase64);
  const buffer = await renderizarHtmlParaPdf(html, { printBackground: true, landscape: false, pageSize: 'A4', margins: { marginType: 'none' } });
  const pdfDir = db.getPdfVendaDir();
  const idVendaSeguro = String(item.id || '').replace(/[\\/:*?"<>|]/g, '_');
  const caminho = path.join(pdfDir, `VENDA-${idVendaSeguro}.pdf`);
  fs.writeFileSync(caminho, buffer);
  db.atualizarCaminhoPdfVenda(item.id, caminho);
  console.log('[Pdf] gerarPdfVenda: fim. caminho:', caminho, '| tamanho:', buffer.length, 'bytes');
  return caminho;
}

async function gerarPdfCompra(cp) {
  console.log('[Pdf] gerarPdfCompra: início. numero:', cp.numero);
  const config = db.obterConfig();
  let html = gerarHtmlCompra(cp, config);
  html = injetarAssinaturaVendedorCompraNoHtml(html, cp.assinaturaVendedorBase64, obterEstadoAssinatura(cp, 'assinaturaVendedorBase64'));
  html = injetarAssinaturaAssistenciaCompraNoHtml(html, cp.assinaturaAssistenciaBase64);
  const buffer = await renderizarHtmlParaPdf(html, { printBackground: true, landscape: true, pageSize: 'A4', margins: { marginType: 'none' } });
  const pdfDir = db.getPdfCompraDir();
  const nomeArquivoSeguro = String(cp.numero || '').replace(/[\\/:*?"<>|]/g, '_');
  const caminho = path.join(pdfDir, `${nomeArquivoSeguro}.pdf`);
  fs.writeFileSync(caminho, buffer);
  db.atualizarCaminhoPdfCompra(cp.numero, caminho);
  console.log('[Pdf] gerarPdfCompra: fim. caminho:', caminho, '| tamanho:', buffer.length, 'bytes');
  return caminho;
}

// ── App Celular — Entregas (garantia) ──
// O lote v2 nunca traz um PDF pronto para itens tipoDocumento:'entrega' —
// só os campos de `dados` (numeroOS, nomeRetirou, marca/modelo/
// reparoRealizado, declaracao, garantiaDias/dataLimiteGarantia) e a
// assinatura em base64 (assinaturaRetirouBase64). O PC gera o PDF aqui,
// reaproveitando o MESMO template usado pelo celular (entrega-template.js,
// copiado sem alteração — ver comentário no topo daquele arquivo), para o
// documento final bater exatamente com o que já foi mostrado ao cliente
// no momento da assinatura. `en` já deve vir com os campos de garantia
// (ou omitidos/zerados, para comprovantes antigos) — ver db.js,
// criarOuSubstituirEntrega.
async function gerarPdfEntrega(en) {
  console.log('[Pdf] gerarPdfEntrega: início. numeroOS:', en.numeroOS);
  const config = db.obterConfig();
  let html = gerarHtmlEntrega(en, config);
  html = injetarAssinaturaRetirouEntregaNoHtml(html, en.assinaturaRetirouBase64, obterEstadoAssinatura(en, 'assinaturaRetirouBase64'));
  const buffer = await renderizarHtmlParaPdf(html, {
    printBackground: true,
    landscape: false,
    pageSize: 'A4',
    preferCSSPageSize: true,
    margins: { marginType: 'none' }
  });
  const pdfDir = db.getPdfEntregaDir();
  const nomeArquivoSeguro = String(en.numeroOS || '').replace(/[\\/:*?"<>|]/g, '_');
  const cicloSeguro = String(en.cicloEntregaId || en.retornoGarantiaId || 'original')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 120);
  const caminho = path.join(pdfDir, `ENTREGA-${nomeArquivoSeguro}-${cicloSeguro}.pdf`);
  fs.writeFileSync(caminho, buffer);
  db.atualizarCaminhoPdfEntrega(en.numeroOS, caminho, en.cicloEntregaId || en.retornoGarantiaId || 'original');
  console.log('[Pdf] gerarPdfEntrega: fim. caminho:', caminho, '| tamanho:', buffer.length, 'bytes');
  return caminho;
}

// ── Aba Garantia (criada manualmente no PC) ──
// Via única, retrato, sem assinatura — ver comentário no topo de
// garantia-template.js.
async function gerarPdfGarantia(g) {
  console.log('[Pdf] gerarPdfGarantia: início. numeroOS:', g.numeroOS);
  const config = db.obterConfig();
  const html = gerarHtmlGarantia(g, config);
  const buffer = await renderizarHtmlParaPdf(html, { printBackground: true, landscape: false, pageSize: 'A4', margins: { marginType: 'none' } });
  const pdfDir = db.getPdfGarantiaDir();
  // Um comprovante por numeroOS — nome de arquivo pelo numeroOS, gerar de
  // novo sobrescreve o PDF físico (mesmo padrão de gerarPdfEntrega).
  const nomeArquivoSeguro = String(g.numeroOS || '').replace(/[\\/:*?"<>|]/g, '_');
  const caminho = path.join(pdfDir, `GARANTIA-${nomeArquivoSeguro}.pdf`);
  fs.writeFileSync(caminho, buffer);
  db.atualizarCaminhoPdfGarantia(g.numeroOS, caminho);
  console.log('[Pdf] gerarPdfGarantia: fim. caminho:', caminho, '| tamanho:', buffer.length, 'bytes');
  return caminho;
}

async function gerarPdfDesbloqueio(documento) {
  const config = db.obterConfig();
  let html = gerarHtmlDesbloqueio(documento, config);
  html = injetarAssinaturaClienteDesbloqueioNoHtml(
    html,
    documento.assinaturaClienteBase64,
    obterEstadoAssinatura(documento, 'assinaturaClienteBase64')
  );
  const buffer = await renderizarHtmlParaPdf(html, {
    printBackground: true,
    landscape: false,
    pageSize: 'A4',
    preferCSSPageSize: true,
    margins: { marginType: 'none' }
  });
  const nomeSeguro = String(documento.numero || '').replace(/[\\/:*?"<>|]/g, '_');
  const caminho = path.join(db.getPdfDesbloqueioDir(), `${nomeSeguro}.pdf`);
  fs.writeFileSync(caminho, buffer);
  db.atualizarCaminhoPdfDesbloqueio(documento.numero, caminho);
  return caminho;
}

async function imprimirDesbloqueioTermico(documento, formato = '80mm', nomeImpressora = '') {
  if (!documento) throw new Error('Autorização de desbloqueio não encontrada.');
  const tipo = String(formato).toLowerCase() === '58mm' ? '58mm' : '80mm';
  let html = gerarHtmlDesbloqueioTermico(documento, db.obterConfig(), tipo);
  html = injetarAssinaturaClienteDesbloqueioNoHtml(
    html,
    documento.assinaturaClienteBase64,
    obterEstadoAssinatura(documento, 'assinaturaClienteBase64')
  );
  return imprimirHtmlLocal(html, { nomeImpressora });
}

// PDFs antigos são atualizados no primeiro acesso. Assim documentos gerados
// antes dos campos assinaturaPendente/naoAssinado também passam a exibir o
// estado correto sem exigir recriação manual pelo usuário.
async function atualizarPdfLegadoAntesDeAbrir(caminhoOriginal) {
  const alvo = path.resolve(String(caminhoOriginal || '')).toLowerCase();
  if (!alvo) return caminhoOriginal;
  const igual = valor => valor && path.resolve(String(valor)).toLowerCase() === alvo;

  const ordem = db.listarOrdens().find(item => igual(item.pdfPath));
  if (ordem) return gerarPdfDaOS(ordem);
  const venda = db.listarEstoque().find(item => igual(item.pdfVendaPath));
  if (venda) return gerarPdfVenda(venda);
  const compra = db.listarCompras().find(item => igual(item.pdfPath));
  if (compra) return gerarPdfCompra(compra);
  const entrega = db.listarEntregas().find(item => igual(item.pdfPath));
  if (entrega) return gerarPdfEntrega(entrega);
  const desbloqueio = db.listarDesbloqueios().find(item => igual(item.pdfPath));
  if (desbloqueio) return gerarPdfDesbloqueio(desbloqueio);
  return caminhoOriginal;
}

module.exports = {
  gerarPdfDaOS, regenerarPdfPorNumero, gerarPdfVenda, gerarPdfCompra,
  gerarPdfEntrega, gerarPdfGarantia, gerarPdfDesbloqueio, imprimirDesbloqueioTermico, atualizarPdfLegadoAntesDeAbrir,
  // Mantidos públicos só para os testes de regressão do PDF.
  normalizarAssinaturaParaImagem,
  obterEstadoAssinatura,
  injetarAssinaturaClienteNoHtml,
  injetarAssinaturaVendedorCompraNoHtml,
  injetarAssinaturaCompradorVendaNoHtml,
  injetarAssinaturaRetirouEntregaNoHtml,
  injetarAssinaturaClienteDesbloqueioNoHtml
};
