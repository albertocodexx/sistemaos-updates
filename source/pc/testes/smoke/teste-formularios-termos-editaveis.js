'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

const html = ler('renderer', 'index.html');
const css = ler('renderer', 'style.css');
const renderer = ler('renderer', 'core', 'legacy-runtime.js');
const preload = ler('src', 'preload', 'api.js');
const ipc = ler('src', 'ipc', 'register-legacy.js');
const termos = ler('src', 'termos-predefinidos.js');

for (const campo of ['termos', 'editTermos', 'estTermosVenda', 'cpTermosCompra', 'garTermos']) {
  assert.match(html, new RegExp(`id="${campo}"`), `campo de termos ausente: ${campo}`);
}

for (const tipo of ['os', 'venda', 'compra', 'garantia']) {
  assert.match(html, new RegExp(`data-restaurar-termos="${tipo}"`), `restauração ausente: ${tipo}`);
}

assert.match(html, /editar aqui somente para esta OS/i);
assert.match(html, /padrão geral continuará intacto/i);
assert.match(html, /somente para este contrato/i);
assert.match(html, /formulario-cabecalho-pagina/);
assert.match(html, /formulario-intro/);
assert.match(css, /\.termos-editor\s*\{/);
assert.match(css, /\.formulario-fluxo\s*\{/);

assert.match(ipc, /ipcMain\.handle\('config:termosResolvidos'/);
assert.match(ipc, /usarTermosPredefinidosOS/);
assert.match(ipc, /usarTermosPredefinidosVenda/);
assert.match(ipc, /usarTermosPredefinidosCompra/);
assert.match(ipc, /usarTermosPredefinidosGarantia/);
assert.match(preload, /configtermosresolvidos:\s*\(\)\s*=>\s*invocar\('config:termosResolvidos'\)/);

assert.match(renderer, /function aplicarTermosPadraoNoCampo/);
assert.match(renderer, /Personalizado somente neste documento/);
assert.match(renderer, /termosVenda:\s*\$\('estTermosVenda'\)\.value\.trim\(\)/);
assert.match(renderer, /termosCompra:\s*\(\$\('cpTermosCompra'\)/);
assert.match(renderer, /termos:\s*\$\('garTermos'\)\.value\.trim\(\)/);
assert.match(termos, /Em iPhones, a abertura envolve risco de dano à tela/);
assert.match(termos, /ajuste no preço estimado será informado previamente ao cliente/);
assert.match(termos, /Android com tampa traseira já trincada/);
assert.match(termos, /danos decorrentes da fragilidade ou avaria preexistente/);

console.log('OK: formulários organizados e termos padrão editáveis somente por documento.');
