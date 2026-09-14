'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const ipc = fs.readFileSync(path.join(raiz, 'src', 'ipc', 'register-legacy.js'), 'utf8');

assert.match(html, /Sistema OS by Aurevion Tecnologia/);
assert.match(html, /© 2026 Aurevion Tecnologia\. Todos os direitos reservados\./);
assert.match(html, /aureviontecnologia@gmail\.com/);
assert.match(html, /aureviontecnologia\.vercel\.app/);
assert.match(html, /assets\/aurevion-logo\.png/);
assert.match(html, /id="iaChatBotao"[\s\S]*assets\/ia-assistente\.png/);
assert.match(runtime, /mailto:aureviontecnologia@gmail\.com/);
assert.match(ipc, /host === 'aureviontecnologia\.vercel\.app'/);
assert.ok(fs.existsSync(path.join(raiz, 'renderer', 'assets', 'aurevion-logo.png')));
assert.ok(fs.existsSync(path.join(raiz, 'renderer', 'assets', 'ia-assistente.png')));

console.log('OK: seção Sobre da Aurevion e ícone neutro do assistente estão íntegros.');
