const assert = require('assert');
const fs = require('fs');
const path = require('path');

const legado = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'renderer', 'core', 'legacy-runtime.js'),
  'utf8'
);

[
  'Tela / imagem funcionando', 'Touch funcionando', 'Câmera frontal funcionando',
  'Câmera traseira funcionando', 'Alto-falante funcionando', 'Microfone funcionando',
  'Face ID / biometria funcionando', 'Sinal / chip funcionando',
  'Carregamento funcionando', 'Bateria funcionando'
].forEach((item) => assert.ok(legado.includes(item), `checklist do PC deve conter ${item}`));
assert.ok(legado.includes('Chip / SIM'), 'acessórios do PC devem conter chip');
assert.ok(legado.includes('Cartão de memória'), 'acessórios do PC devem conter cartão de memória');

console.log('OK: checklist técnico ampliado está disponível no PC.');
