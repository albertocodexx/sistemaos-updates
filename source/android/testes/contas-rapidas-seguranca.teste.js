const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const cofre = ler('www', 'js', 'auth', 'contas-rapidas.js');
const ui = ler('www', 'js', 'auth', 'contas-rapidas-ui.js');
const html = ler('www', 'index.html');

assert.match(cofre, /AES-GCM/);
assert.match(cofre, /generateKey\([^]*false, \['encrypt', 'decrypt'\]/);
assert.doesNotMatch(cofre, /localStorage[^\n]*(access_token|refresh_token)/i);
assert.match(cofre, /refresh_token/);
assert.match(cofre, /anterior/);
assert.match(ui, /configurarTrocaRapida/);
assert.match(html, /cfg-troca-rapida-contas/);
assert.match(html, /lista-contas-rapidas-login/);
assert.doesNotMatch(html, /btn-acompanhar-chamados-(login|config)/);

console.log('OK: troca rápida usa cofre cifrado, é opt-in e não duplica o acompanhamento de chamados.');
