const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const pacote = require('../../package.json');
const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
const mobileIndex = fs.readFileSync(path.join(raiz, '..', 'sistemaos-android', 'www', 'index.html'), 'utf8');

assert.equal(Object.prototype.hasOwnProperty.call(pacote.dependencies, 'firebase'), false);
assert.equal(fs.existsSync(path.join(raiz, 'src', 'firebase-sync.js')), false);
assert.equal(fs.existsSync(path.join(raiz, 'src', 'cloudinary-storage.js')), false);
assert.equal(fs.existsSync(path.join(raiz, 'src', 'nuvem-limpeza.js')), false);
assert.doesNotMatch(main, /require\(['"]\.\/src\/firebase-sync['"]\)/);
assert.doesNotMatch(mobileIndex, /src="js\/firebase-sync\.js"/);
assert.doesNotMatch(mobileIndex, /src="js\/cloudinary-upload\.js"/);
assert.doesNotMatch(mobileIndex, /src="js\/sync-auto\.js"/);

console.log('OK: SDKs, scripts ativos e módulos legados de Firebase/Cloudinary foram removidos.');
