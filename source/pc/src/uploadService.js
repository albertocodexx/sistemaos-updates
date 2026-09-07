// src/uploadService.js — ETAPA 9
// Serviço centralizado de upload: validação, nomes seguros, diretórios
// e abstração de storage (hoje: disco local; pronto para troca futura
// sem precisar reescrever quem chama o serviço).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// ─── Categorias de upload suportadas ───────────────────────────
const CATEGORIAS = ['logos', 'os', 'vendas', 'anexos', 'fotos'];

// ─── Limites e tipos aceitos ────────────────────────────────────
const LIMITE_TAMANHO_BYTES = 15 * 1024 * 1024; // 15MB por arquivo

const TIPOS_PERMITIDOS = {
  imagem: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  documento: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'],
};

let empresaAtivaId = '';

function normalizarEmpresaId(valor) {
  const id = String(valor || '').trim().toLowerCase();
  return /^[a-z0-9-]{3,80}$/.test(id) ? id : '';
}

function ativarEscopoEmpresa(empresaId) {
  empresaAtivaId = normalizarEmpresaId(empresaId);
  return empresaAtivaId;
}

function desativarEscopoEmpresa() {
  empresaAtivaId = '';
}

function extensoesPermitidas(grupo) {
  if (!grupo) return [...TIPOS_PERMITIDOS.imagem, ...TIPOS_PERMITIDOS.documento];
  return TIPOS_PERMITIDOS[grupo] || [];
}

// ─── Diretório raiz de uploads ─────────────────────────────────
// Hoje é uma pasta local dentro dos Documentos do usuário. Centralizar
// aqui é o que permite, no futuro, trocar para outro storage (S3, etc.)
// alterando só este arquivo — nada que chama o serviço precisa mudar.
function getUploadsRootDir() {
  const base = path.join(app.getPath('documents'), 'Sistema OS');
  const root = empresaAtivaId
    ? path.join(base, 'empresas', empresaAtivaId, 'uploads')
    : path.join(base, 'uploads');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function getUploadDir(categoria) {
  if (!CATEGORIAS.includes(categoria)) {
    throw new Error(`Categoria de upload inválida: ${categoria}`);
  }
  const dir = path.join(getUploadsRootDir(), categoria);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Cria toda a estrutura obrigatória de uploads de uma vez
// (chamado na inicialização do app, mas também é seguro chamar
// a qualquer momento — é idempotente).
function garantirEstruturaUploads() {
  getUploadsRootDir();
  CATEGORIAS.forEach(c => getUploadDir(c));
}

// ─── Nome seguro de arquivo ─────────────────────────────────────
function obterExtensao(nomeOriginal, fallback) {
  const ext = (nomeOriginal || '').split('.').pop();
  if (!ext || ext === nomeOriginal) return (fallback || 'bin').toLowerCase();
  return ext.toLowerCase().replace(/[^a-z0-9]/g, '') || (fallback || 'bin');
}

function gerarNomeSeguro(nomeOriginal, fallbackExt) {
  const ext = obterExtensao(nomeOriginal, fallbackExt);
  const hash = crypto.randomBytes(6).toString('hex');
  return `${Date.now()}-${hash}.${ext}`;
}

// ─── Validação ───────────────────────────────────────────────────
// base64Data pode vir como data URL ("data:image/png;base64,....") ou
// já como string base64 pura.
function extrairBufferBase64(base64Data) {
  const semHeader = (base64Data || '').replace(/^data:[^;]+;base64,/, '');
  return Buffer.from(semHeader, 'base64');
}

function validarArquivo({ base64Data, nomeOriginal, grupo }) {
  const erros = [];
  if (!base64Data) {
    erros.push('Arquivo vazio ou inválido.');
    return { valido: false, erros };
  }

  const ext = obterExtensao(nomeOriginal, '');
  const permitidas = extensoesPermitidas(grupo);
  if (permitidas.length && !permitidas.includes(ext)) {
    erros.push(`Tipo de arquivo não permitido (.${ext || '?'}). Permitidos: ${permitidas.join(', ')}.`);
  }

  const buf = extrairBufferBase64(base64Data);
  if (buf.length === 0) {
    erros.push('Arquivo vazio ou inválido.');
  } else if (buf.length > LIMITE_TAMANHO_BYTES) {
    const mb = (LIMITE_TAMANHO_BYTES / (1024 * 1024)).toFixed(0);
    erros.push(`Arquivo excede o limite de ${mb}MB.`);
  }

  return { valido: erros.length === 0, erros, buffer: buf };
}

// ─── Salvamento ──────────────────────────────────────────────────
// Salva um arquivo base64 dentro de uma categoria/subpasta de uploads.
// subpasta é opcional (ex.: id do item, número da OS) para organizar
// por registro dentro da categoria.
function salvarArquivo({ categoria, subpasta, base64Data, nomeOriginal, grupo }) {
  const { valido, erros, buffer } = validarArquivo({ base64Data, nomeOriginal, grupo });
  if (!valido) {
    const erro = new Error(erros.join(' '));
    erro.validacao = erros;
    throw erro;
  }

  let dir = getUploadDir(categoria);
  if (subpasta) {
    // Sanitiza defensivamente: remove qualquer separador de diretório e ".."
    // para impedir path traversal (ex.: subpasta = "../../algumaCoisa").
    // Hoje os únicos chamadores passam IDs internos (ex.: "EST-0001"), mas
    // essa é uma função genérica e reutilizável — a segurança não deve
    // depender de quem chama sempre passar um valor confiável.
    const subpastaSegura = String(subpasta).replace(/[\\/]/g, '').replace(/\.\./g, '');
    if (!subpastaSegura) throw new Error('Subpasta de upload inválida.');
    dir = path.join(dir, subpastaSegura);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const ext = obterExtensao(nomeOriginal, 'bin');
  const nomeArquivo = gerarNomeSeguro(nomeOriginal, ext);
  const caminhoCompleto = path.join(dir, nomeArquivo);
  fs.writeFileSync(caminhoCompleto, buffer);

  return { path: caminhoCompleto, nome: nomeArquivo };
}

function excluirArquivo(caminho) {
  try {
    if (caminho && fs.existsSync(caminho)) fs.unlinkSync(caminho);
    return true;
  } catch (e) {
    console.error('Falha ao excluir arquivo de upload:', e);
    return false;
  }
}

// Converte um path de arquivo local em URL file:// utilizável em <img src>
function caminhoParaFileUrl(caminho) {
  if (!caminho) return '';
  // path.resolve garante caminho absoluto; encodeURI trata espaços/acentos
  const absoluto = path.resolve(caminho).replace(/\\/g, '/');
  const comBarraInicial = absoluto.startsWith('/') ? absoluto : `/${absoluto}`;
  return `file://${encodeURI(comBarraInicial)}`;
}

module.exports = {
  CATEGORIAS,
  LIMITE_TAMANHO_BYTES,
  TIPOS_PERMITIDOS,
  getUploadsRootDir,
  getUploadDir,
  garantirEstruturaUploads,
  gerarNomeSeguro,
  validarArquivo,
  salvarArquivo,
  excluirArquivo,
  caminhoParaFileUrl,
  ativarEscopoEmpresa,
  desativarEscopoEmpresa,
};
