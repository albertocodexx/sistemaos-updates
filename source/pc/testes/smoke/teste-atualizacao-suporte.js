'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');

assert.match(html, /id="btnVerificarUpdateSuporte"[\s\S]*Verificar atualização/, 'central de suporte deve ter botao de atualizacao visivel');
assert.match(html, /id="statusUpdateSuporte"[\s\S]*aria-live="polite"/, 'resultado da verificacao deve ser acessivel');
assert.match(renderer, /const verificarSuporte = document\.getElementById\('btnVerificarUpdateSuporte'\)/);
assert.match(renderer, /verificarSuporte\.addEventListener\('click', verificarAtualizacaoAgora\)/, 'botao do suporte deve usar o atualizador oficial');
assert.match(renderer, /statusUpdateSuporte\.textContent = dados\.mensagem/, 'suporte deve ver o estado da verificacao');

console.log('OK: central de suporte verifica atualizacoes pelo atualizador oficial.');
