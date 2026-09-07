// Etiquetas térmicas de OS.
// O QR Code contém somente um link interno e o número da OS. Nenhum dado
// pessoal do cliente é colocado no payload que pode ser lido pela câmera.
const QRCode = require('qrcode');

const PROTOCOLO = 'sistemaos:';
const HOST_OS = 'os';
const TAMANHO_MAXIMO_NUMERO = 80;

function normalizarNumeroOS(valor) {
  const numero = String(valor == null ? '' : valor).trim();
  if (!numero || numero.length > TAMANHO_MAXIMO_NUMERO) return '';
  if (/[/\\?#\u0000-\u001f]/.test(numero)) return '';
  return numero;
}

function criarLinkOS(numero) {
  const normalizado = normalizarNumeroOS(numero);
  if (!normalizado) throw new Error('Número de OS inválido para a etiqueta.');
  return `${PROTOCOLO}//${HOST_OS}/${encodeURIComponent(normalizado)}`;
}

function extrairNumeroLinkOS(valor) {
  try {
    const url = new URL(String(valor || '').trim());
    if (url.protocol !== PROTOCOLO || url.hostname.toLowerCase() !== HOST_OS) return '';
    const caminho = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return normalizarNumeroOS(caminho || url.searchParams.get('numero'));
  } catch (_) {
    return '';
  }
}

async function gerarQrEtiqueta(numero) {
  const link = criarLinkOS(numero);
  const dataUrl = await QRCode.toDataURL(link, {
    type: 'image/png',
    width: 420,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' }
  });
  return { numero: normalizarNumeroOS(numero), link, dataUrl };
}

module.exports = {
  PROTOCOLO,
  HOST_OS,
  normalizarNumeroOS,
  criarLinkOS,
  extrairNumeroLinkOS,
  gerarQrEtiqueta
};
