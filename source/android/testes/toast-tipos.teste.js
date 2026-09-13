'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const raiz = path.join(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  runScripts: 'outside-only',
  url: 'https://toast.local/'
});
const window = dom.window;
window.eval(fs.readFileSync(path.join(raiz, 'www/js/toast.js'), 'utf8'));

window.SistemaOSToast.mostrar('Falhou', 'erro');
window.SistemaOSToast.mostrar('Atenção', 'aviso');
window.SistemaOSToast.mostrar('Concluído', 'sucesso');
window.SistemaOSToast.mostrar('Erro novo', { ehErro: true, duracaoMs: 6000 });

const toasts = [...window.document.querySelectorAll('.toast')];
assert.equal(toasts.length, 4);
assert.ok(toasts[0].classList.contains('toast-erro'));
assert.equal(toasts[0].getAttribute('role'), 'alert');
assert.ok(toasts[1].classList.contains('toast-aviso'));
assert.ok(toasts[2].classList.contains('toast-sucesso'));
assert.ok(toasts[3].classList.contains('toast-erro'));

const css = fs.readFileSync(path.join(raiz, 'www/css/monochrome-theme.css'), 'utf8');
assert.match(css, /\.toast\.toast-erro[^{]*\{[^}]*var\(--acento-erro-fundo\)[^}]*!important/s);
assert.match(css, /\.toast\.toast-aviso[^{]*\{[^}]*var\(--acento-aviso-fundo\)[^}]*!important/s);

dom.window.close();
console.log('OK: mensagens de erro, aviso e sucesso mantêm tipo, contraste e compatibilidade no Android.');
