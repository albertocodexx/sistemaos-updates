'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'www', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'www', 'css', 'monochrome-theme.css'), 'utf8');
const cssBase = fs.readFileSync(path.join(raiz, 'www', 'css', 'app.css'), 'utf8');
const marca = fs.readFileSync(path.join(raiz, 'www', 'js', 'marca-app.js'), 'utf8');
const fundoIcone = fs.readFileSync(path.join(raiz, 'android', 'app', 'src', 'main', 'res', 'values', 'ic_launcher_background.xml'), 'utf8');

assert(html.includes('css/monochrome-theme.css'), 'camada monocromática precisa estar no app');
assert(html.indexOf('css/monochrome-theme.css') > html.indexOf('css/precos.css'), 'camada monocromática deve ser carregada por último');
assert(!html.includes('fonts.googleapis.com'), 'o app não deve depender de fonte remota');
assert(html.includes('assets/logo-os-white.png'), 'login e topo devem usar a nova marca');
assert(css.includes('--acento-primario: #ffffff'), 'modo escuro deve ser preto e branco');
assert(css.includes('--acento-primario: #000000'), 'modo claro deve ser branco e preto');
assert(css.includes('button:not(:disabled):active'), 'toques devem ter resposta física sem flash azul');
assert(css.includes('transform: translateY(1px) scale(.985)'), 'botões devem reagir ao toque de modo discreto');
assert(css.includes('.cards-estatisticas-financeiro .card-estatistica-numero'), 'valores financeiros devem ter hierarquia própria');
assert(css.includes('font-variant-numeric: tabular-nums'), 'valores devem permanecer alinhados e legíveis');
assert(css.includes('/* Contrato global de contraste:'), 'a última camada deve proteger o contraste de ações e estados ativos');
assert(css.includes('color: var(--acento-primario-texto) !important'), 'ações preenchidas devem usar texto inverso');
assert(css.includes('input::placeholder') && css.includes('color: var(--cor-texto-mais-fraco) !important'), 'placeholders devem permanecer legíveis');
assert(!cssBase.includes('background:#111925;text-align:left'), 'seletor de foto não deve forçar fundo escuro no tema claro');

function luminancia(hex) {
  const valor = hex.replace('#', '');
  const canais = [0, 2, 4].map((indice) => parseInt(valor.slice(indice, indice + 2), 16) / 255)
    .map((canal) => canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4);
  return (0.2126 * canais[0]) + (0.7152 * canais[1]) + (0.0722 * canais[2]);
}
function contraste(a, b) {
  const valores = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (valores[0] + 0.05) / (valores[1] + 0.05);
}
for (const [frente, fundo] of [
  ['#000000', '#f7f7f5'],
  ['#ffffff', '#090909'],
  ['#969691', '#171717'],
  ['#686862', '#fafaf8']
]) assert(contraste(frente, fundo) >= 4.5, 'tokens de texto devem atingir contraste WCAG AA');
assert(marca.includes("logoEl.dataset.marca = 'sistema'"), 'fallback da marca deve permanecer visível');
assert(fundoIcone.includes('#FFFFFF'), 'ícone adaptativo deve usar fundo branco');

for (const arquivo of [
  'www/assets/logo-os-black.png',
  'www/assets/logo-os-white.png',
  'android/app/src/main/ic_launcher-playstore.png',
  'android/app/src/main/res/drawable-port-xxxhdpi/splash.png'
]) {
  const caminho = path.join(raiz, arquivo);
  assert(fs.existsSync(caminho) && fs.statSync(caminho).size > 100, `recurso visual ausente: ${arquivo}`);
}

console.log('OK: Android usa identidade monocromática, marca nova e splash nativo consistente.');
