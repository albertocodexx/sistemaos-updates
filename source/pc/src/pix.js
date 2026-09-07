// src/pix.js — v20
// Gera o payload Pix (BR Code / EMV) para Copia e Cola.
// Padrão BACEN: https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf
// Sem dependências externas — só Node nativo (crc).

'use strict';

// ── Helpers EMV ──────────────────────────────────────────────────
function emv(id, value) {
  // O padrão BACEN declara o "Length" em BYTES (não em caracteres/UTF-16 code
  // units). Usar `.length` funciona por acaso quando o valor é ASCII puro, mas
  // quebra para qualquer caractere multibyte (ex.: um acento que sobreviva em
  // algum campo não sanitizado, como uma chave Pix de e-mail com acento no
  // domínio) — o app do banco lê o payload byte a byte e desalinha a leitura
  // dos campos seguintes a partir daí, corrompendo o restante do código.
  const len = String(Buffer.byteLength(value, 'utf-8')).padStart(2, '0');
  return `${id}${len}${value}`;
}

// CRC16-CCITT (polinômio 0x1021, init 0xFFFF)
// O padrão EMV/BACEN trata o payload como uma sequência de BYTES (o próprio
// manual do BR Code define o payload como "sequência de bytes lida"), então o
// CRC precisa ser calculado sobre os bytes UTF-8 do payload — não sobre
// `charCodeAt` (unidades de código UTF-16), que dá o mesmo resultado só
// enquanto a string for puramente ASCII. Mesma causa raiz do bug corrigido
// em `emv()` acima.
function crc16(str) {
  const bytes = Buffer.from(str, 'utf-8');
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    }
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// ── Normalização de chave Pix ─────────────────────────────────────
function normalizarChave(chave, tipo) {
  if (!chave) return '';
  switch ((tipo || '').toLowerCase()) {
    case 'telefone': {
      // Formato BACEN: +55 + DDD(2) + número(8-9) = 13 ou 14 dígitos total
      // Remove tudo que não é dígito, depois remove prefixo +55 ou 0055 ou 55 se presente
      const digitos = chave.replace(/\D/g, '');
      // Remove prefixo 55 (ou 0055) se sobrar >= 10 dígitos (DDD + número)
      let semPrefixo = digitos.length >= 12 ? digitos.replace(/^0{0,2}55/, '') : digitos;
      // Bug 2 fix: remove zero inicial antes do DDD (ex: 011987... → 11987...)
      semPrefixo = semPrefixo.replace(/^0(\d{2})/, '$1');
      return '+55' + semPrefixo;
    }
    case 'cpf':
      return chave.replace(/\D/g, '');
    case 'cnpj':
      return chave.replace(/\D/g, '');
    case 'email':
      return chave.toLowerCase().trim();
    default:
      return chave.trim(); // chave aleatória: UUID, não modifica
  }
}

// ── Gerador principal ─────────────────────────────────────────────
/**
 * gerarPixCopiaCola({ chave, tipoChave, nome, cidade, valor, txid, descricao })
 * Retorna a string EMV pronta para colar no app do banco.
 */
function gerarPixCopiaCola({ chave, tipoChave, nome, cidade, valor, txid, descricao }) {
  if (!chave) throw new Error('Chave Pix não configurada.');
  if (!nome)  throw new Error('Nome do recebedor não configurado.');
  if (!cidade) cidade = 'Brasil';
  if (!valor || isNaN(parseFloat(valor))) throw new Error('Valor inválido.');

  const chavePix = normalizarChave(chave, tipoChave);
  const valorStr = parseFloat(valor).toFixed(2);

  // TxID (ID 62 → subfield 05): máx 25 chars, sem espaços/especiais
  const txidClean = (txid || 'OS' + Date.now()).replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const additionalData = emv('62', emv('05', txidClean));

  // Helper: ASCII puro seguro para EMV/BACEN —
  // 1. Expande chars compostos conhecidos antes de normalizar (ex: & → " e ")
  // 2. Remove acentos via NFD
  // 3. Descarta qualquer char fora do subconjunto permitido pelo BACEN no nome/cidade:
  //    letras, dígitos, espaço e ponto. Qualquer outro vira espaço.
  // 4. Colapsa múltiplos espaços e apara bordas
  // 5. Trunca no máximo informado
  const toASCII = (s, max) => {
    if (!s) return '';
    return s
      // expansões antes de normalizar
      .replace(/&/g, ' e ')
      .replace(/\+/g, ' ')
      .replace(/@/g, ' ')
      .replace(/[\/\\]/g, ' ')
      // remove acentos
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      // mantém só letras ASCII, dígitos, espaço e ponto (subconjunto seguro EMV)
      .replace(/[^A-Za-z0-9 .]/g, ' ')
      // colapsa espaços múltiplos e apara
      .replace(/\s+/g, ' ').trim()
      .slice(0, max);
  };

  // Nome: máx 25 chars, sem acentos
  const nomeLimpo   = toASCII(nome,     25);
  // Cidade: máx 15 chars
  const cidadeLimpa = toASCII(cidade,   15);
  // Descrição: máx 72 chars, sem acentos (padrão EMV exige ASCII)
  const descLimpa   = descricao ? toASCII(descricao, 72) : '';

  // Merchant Account Info (ID 26): GUI + chave
  const gui = emv('00', 'br.gov.bcb.pix');
  const keyField = emv('01', chavePix);
  const descField = descLimpa ? emv('02', descLimpa) : '';
  const merchantAccountInfo = emv('26', gui + keyField + descField);

  // Bug 1 fix: '12' = uso único (valor definido + txid), '11' = estático (sem valor fixo)
  const iniciacao = (parseFloat(valorStr) > 0) ? '12' : '11';

  const payload =
    emv('00', '01') +           // Payload Format Indicator
    emv('01', iniciacao) +      // Point of initiation: 12 = uso único, 11 = estático
    merchantAccountInfo +
    emv('52', '0000') +         // Merchant Category Code
    emv('53', '986') +          // Transaction Currency: BRL
    emv('54', valorStr) +       // Transaction Amount
    emv('58', 'BR') +           // Country Code
    emv('59', nomeLimpo) +      // Merchant Name
    emv('60', cidadeLimpa) +    // Merchant City
    additionalData +
    '6304';                     // CRC placeholder

  return payload + crc16(payload);
}

module.exports = { gerarPixCopiaCola, normalizarChave };
