const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'www', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'www', 'js', 'app.js'), 'utf8');

[
  'Tela / imagem', 'Touch', 'Câmera frontal', 'Câmera traseira', 'Alto-falante',
  'Microfone', 'Face ID / biometria', 'Wi-Fi', 'Bluetooth', 'Sinal / chip',
  'Carregamento', 'Bateria'
].forEach((item) => assert.ok(html.includes(item), `checklist mobile deve conter ${item}`));
assert.ok(html.includes('Chip / SIM'), 'itens recebidos devem conter chip');
assert.ok(html.includes('Cartão de memória'), 'itens recebidos devem conter cartão de memória');
assert.match(app, /acessoriosChecklist:\s*checkboxesMarcados\('\.os-acessorio-check'\)/);
assert.match(app, /testesEntrada:\s*checkboxesMarcados\('\.os-teste-entrada'\)/);
assert.match(app, /marcarCheckboxes\('\.os-teste-entrada'/, 'edição deve restaurar o checklist');

console.log('OK: checklist ampliado da OS é salvo e restaurado no Android.');
