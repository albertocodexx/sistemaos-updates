'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

const html = ler('renderer', 'index.html');
const css = ler('renderer', 'style.css');
const runtime = ler('renderer', 'core', 'legacy-runtime.js');
const organizador = ler('renderer', 'core', 'form-organizer.js');
const main = ler('main.js');

const divsAbertas = (html.match(/<div\b/gi) || []).length;
const divsFechadas = (html.match(/<\/div>/gi) || []).length;
assert.strictEqual(divsAbertas, divsFechadas, 'index.html deve manter a estrutura de divs balanceada');

assert.match(
  html,
  /Dados do Aparelho<\/div>\s*<div class="grade-3">\s*<div class="campo"><label for="marca">/,
  'Dados do Aparelho da Nova OS precisa manter os campos dentro da grade'
);
assert.match(html, /id="detalheConteudo" class="modal-corpo detalhe-os-conteudo"/);
assert.doesNotMatch(html, /id="detalheConteudo"[^>]+max-height/);
assert.match(html, /<details class="menu-acoes-os menu-acoes-edicao">/);
assert.match(html, /<script src="core\/form-organizer\.js"><\/script>/);

assert.match(runtime, /function _renderizarAcoesDetalheOS/);
assert.match(runtime, /<details class="menu-acoes-os">/);
assert.match(runtime, /_renderizarAcoesDetalheOS\(os\);/);
assert.match(runtime, /_renderizarAcoesDetalheOS\(os, \{ incluirAcoesDestrutivas: true \}\);/);
assert.doesNotMatch(runtime, /\$\('detalheConteudo'\)\.innerHTML = `\s*<div style="padding:18px 22px;">/);

assert.match(css, /\.modal-detalhe-os[\s\S]*overflow:\s*hidden/);
assert.match(css, /#detalheAcoes[\s\S]*flex-wrap:\s*nowrap/);
assert.match(css, /\.menu-acoes-os-lista/);
assert.match(css, /\.card\.card-recolhivel\[data-recolhido="true"\]/);
assert.ok(
  css.lastIndexOf('.modal-rodape .botao-primario { order: 0; }') > css.indexOf('.modal-rodape .botao-primario{order:20}'),
  'override do rodape deve vir depois da regra antiga'
);

assert.match(organizador, /#aba-nova-os \.formulario-layout/);
assert.match(organizador, /#modalEditarOS \.formulario-layout/);
assert.match(organizador, /#modalFormCompra \.modal-compra-conteudo/);
assert.match(organizador, /document\.addEventListener\('invalid'/);
assert.match(organizador, /#modalConfig > \.modal-caixa/);
assert.match(organizador, /Buscar nas configurações/);
assert.match(css, /\.config-secao\.config-recolhivel/);
assert.match(css, /\.config-organizador/);

assert.match(main, /screen\.getPrimaryDisplay\(\)\.workAreaSize/);
assert.match(main, /Math\.min\(920, areaUtil\.height\)/);

console.log('OK: formularios e modal de OS organizados, responsivos e sem rodape quebrado.');
