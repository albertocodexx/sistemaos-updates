'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const raiz = path.resolve(__dirname, '..', '..');
const ipc = fs.readFileSync(path.join(raiz, 'src', 'ipc', 'register-legacy.js'), 'utf8');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');

assert.ok(ipc.includes("path.join(db.getRootDir(), 'Comprovantes')"));
assert.ok(renderer.includes("window.api.paggerarpdf(pagamentoId)"));
assert.ok(renderer.includes("abrirComprovanteExt(caminho, pagamentoId = '')"));

console.log('OK: comprovante legado é recuperado dentro do diretório seguro.');
