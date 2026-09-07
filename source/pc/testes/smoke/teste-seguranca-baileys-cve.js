const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const pacote = require('../../package.json');
const lock = require('../../package-lock.json');
const whatsapp = fs.readFileSync(path.join(raiz, 'src', 'whatsapp.js'), 'utf8');
const versaoResolvida = lock.packages?.['node_modules/@whiskeysockets/baileys']?.version || '';

assert.equal(pacote.dependencies['@whiskeysockets/baileys'], '6.7.23');
assert.equal(versaoResolvida, '6.7.23');
assert.equal(pacote.devDependencies.electron, '43.4.0');
assert.match(whatsapp, /BAILEYS_MINIMO_SEGURO = \[6, 7, 22\]/);
assert.match(whatsapp, /_validarVersaoSeguraBaileys\(\)/);
assert.match(whatsapp, /if \(upsert\?\.requestId\)/);
assert.match(whatsapp, /shouldSyncHistoryMessage: \(\) => false/);
assert.match(whatsapp, /syncFullHistory: false/);
assert.match(whatsapp, /pino\(\{ level: 'silent' \}\)/);

console.log('OK: Baileys 6.7.23 e Electron 43.4.0 fixados em versoes corrigidas.');
