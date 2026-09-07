'use strict';
const fs = require('node:fs');
const path = require('node:path');
function arquivoPermitido(caminho, raiz, extensoes = ['.pdf']) {
  try {
    if (typeof caminho !== 'string' || !path.isAbsolute(caminho) || caminho.includes('\0')) return false;
    if (path.basename(caminho).includes(':')) return false; // NTFS alternate data stream
    if (!extensoes.includes(path.extname(caminho).toLowerCase())) return false;
    const real = fs.realpathSync(caminho), root = fs.realpathSync(raiz);
    const relativo = path.relative(root, real);
    return !!relativo && relativo !== '..' && !relativo.startsWith('..' + path.sep) &&
      !path.isAbsolute(relativo) && extensoes.includes(path.extname(real).toLowerCase()) && fs.statSync(real).isFile();
  } catch (_) { return false; }
}
module.exports = { arquivoPermitido };
