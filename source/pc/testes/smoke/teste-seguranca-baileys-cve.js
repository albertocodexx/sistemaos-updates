const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const pacote = require('../../package.json');
const lock = require('../../package-lock.json');
const whatsapp = fs.readFileSync(path.join(raiz, 'src', 'whatsapp.js'), 'utf8');
const versaoResolvida = lock.packages?.['node_modules/@whiskeysockets/baileys']?.version || '';
const versaoYaml = lock.packages?.['node_modules/js-yaml']?.version || '';
const versaoSharp = lock.packages?.['node_modules/sharp']?.version || '';
const versaoBuilder = lock.packages?.['node_modules/electron-builder']?.version || '';

assert.equal(pacote.dependencies['@whiskeysockets/baileys'], '6.7.23');
assert.equal(versaoResolvida, '6.7.23');
assert.equal(pacote.devDependencies.electron, '43.4.0');
assert.equal(pacote.devDependencies['electron-builder'], '26.16.0');
assert.equal(versaoBuilder, '26.16.0');
assert.equal(pacote.overrides['js-yaml'], '4.3.2');
assert.equal(versaoYaml, '4.3.2');
assert.equal(versaoSharp, '0.35.4');
assert.match(whatsapp, /BAILEYS_MINIMO_SEGURO = \[6, 7, 22\]/);
assert.match(whatsapp, /_validarVersaoSeguraBaileys\(\)/);
assert.match(whatsapp, /if \(upsert\?\.requestId\)/);
assert.match(whatsapp, /shouldSyncHistoryMessage: \(\) => false/);
assert.match(whatsapp, /syncFullHistory: false/);
assert.match(whatsapp, /pino\(\{ level: 'silent' \}\)/);

console.log('OK: Baileys, Electron, builder, YAML e imagens fixados em versoes corrigidas.');
