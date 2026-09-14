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
assert.ok(renderer.includes("verDetalhesPagamentoExt('${p.id}')"), 'Ver deve abrir os dados, não repetir o PDF');
assert.ok(renderer.includes("imprimirComprovanteTermicoPagamento('${p.id}')"), 'histórico deve oferecer impressão térmica');
assert.ok(ipc.includes("ipcMain.handle('pag:imprimirTermico'"));

console.log('OK: detalhes, PDF e impressão térmica de pagamento têm ações distintas.');
