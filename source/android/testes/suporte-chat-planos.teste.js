const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'www', 'index.html'), 'utf8');
const chat = fs.readFileSync(path.join(raiz, 'www', 'js', 'chamados.js'), 'utf8');
const suporteGlobal = fs.readFileSync(path.join(raiz, 'www', 'js', 'suporte-global.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'www', 'css', 'app.css'), 'utf8');

assert.doesNotMatch(html, /btn-acompanhar-chamados-login/);
assert.doesNotMatch(html, /btn-acompanhar-chamados-config/);
assert.match(html, /js\/chamados\.js/);
assert.doesNotMatch(html, /Esqueceu a senha\? Peça/);
for (const acao of ['acompanhar_publico', 'listar_meus', 'listar_mensagens', 'responder_publico', 'responder_autenticado', 'responder_suporte']) {
  assert.match(chat, new RegExp(acao));
}
assert.match(chat, /SistemaOSChamados/);
assert.match(chat, /abrirNovo/);
assert.match(chat, /requestSubmit/);
assert.match(chat, /form-novo-chamado-app/);
assert.match(css, /chamados-app/);
assert.match(css, /central-chamados-app[^}]*z-index:11000/);
assert.match(html, /id="btn-suporte-sair"[^>]*>Sair \/ trocar conta</);
assert.match(suporteGlobal, /btn-suporte-sair/);
assert.match(suporteGlobal, /SistemaOSSessao\.sair\(\)/);
assert.match(css, /html:not\(\[data-tema="claro"\]\) \{ color-scheme: dark; \}/);
assert.match(css, /input:-webkit-autofill/);

console.log('OK: APK acompanha e responde chamados no login, na empresa e no modo suporte.');
