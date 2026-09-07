// O conceito comercial atual é Plano. A antiga tela local de Licença não pode
// voltar ao renderer, mas os dados antigos continuam migráveis no backend.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const planos = fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'suporte', 'planos.js'), 'utf8');

assert.doesNotMatch(html, /id=["']btnLicenca["']/);
assert.doesNotMatch(html, /id=["']modalLicenca["']/);
assert.doesNotMatch(html, /modules\/licenca\/licenca\.js/);
assert.match(html, /modules\/suporte\/planos\.js/);
assert.match(runtime, /Plano e acesso/);
assert.match(planos, /planoLimiteUsuarios/);
assert.match(planos, /plano_recursos|recursos/);

console.log('OK: Licença antiga removida da interface e substituída por Planos.');
