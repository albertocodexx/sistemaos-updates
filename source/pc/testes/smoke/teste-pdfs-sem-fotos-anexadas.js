const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const templateOS = fs.readFileSync(path.join(raiz, 'src', 'templates', 'os-template.js'), 'utf8');
const pdf = fs.readFileSync(path.join(raiz, 'src', 'pdf.js'), 'utf8');
const configHtml = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const dominio = fs.readFileSync(path.join(raiz, 'src', 'database', 'domain.js'), 'utf8');

assert.doesNotMatch(templateOS, /FOTOS DA OS|fotos-grade|foto-pdf|os\.fotos/, 'o PDF da OS nao deve incorporar fotos anexadas');
assert.doesNotMatch(pdf, /injetarBase64NasFotos/, 'o gerador nao deve ler fotos do disco para montar o PDF');
assert.doesNotMatch(configHtml, /exibirFotosNoPdf/, 'a opcao obsoleta de fotos no PDF deve ser removida');
assert.match(dominio, /function salvarFotoOS\(/, 'as fotos devem continuar salvas na galeria da OS');
assert.match(dominio, /CATEGORIAS_FOTO_OS/, 'as categorias e a sincronizacao de fotos devem permanecer ativas');

console.log('OK: PDFs sem fotos anexadas; galeria e persistencia de fotos preservadas.');
