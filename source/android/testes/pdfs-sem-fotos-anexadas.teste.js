const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const templateOS = fs.readFileSync(path.join(raiz, 'www', 'src', 'templates', 'os-template.js'), 'utf8');
const templateEntrega = fs.readFileSync(path.join(raiz, 'www', 'src', 'templates', 'entrega-template.js'), 'utf8');
const arquivos = fs.readFileSync(path.join(raiz, 'www', 'js', 'supabase', 'arquivo-service.js'), 'utf8');

assert.doesNotMatch(templateOS, /FOTOS DA OS|fotos-grade|foto-pdf|os\.fotos/, 'a previa/PDF da OS nao deve incorporar fotos anexadas');
assert.doesNotMatch(templateEntrega, /\$\{\(en\.fotos|<div class="fotos-grade"|<div class="foto-pdf"/, 'a previa/PDF de entrega nao deve incorporar fotos anexadas');
assert.match(arquivos, /categoria: 'foto'/, 'o envio das fotos ao Storage deve continuar ativo');
assert.match(arquivos, /dados\.fotos/, 'as fotos devem continuar sincronizadas entre celular e PC');

console.log('OK: PDFs do celular sem fotos anexadas; envio e sincronizacao preservados.');
