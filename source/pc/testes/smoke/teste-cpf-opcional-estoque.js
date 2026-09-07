'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');

assert.match(html, /<label>CPF do comprador<\/label><input id="estCompradorCpf"[^>]*>/,
  'CPF do comprador deve continuar opcional no formulário de venda');
assert.match(renderer,
  /window\.abrirModalEstoque[\s\S]*?limparErros\([\s\S]*?'estCompradorCpf'[\s\S]*?\);[\s\S]*?\/\/ Título/,
  'modal deve limpar o erro antigo do CPF antes de preencher outro item');
assert.match(renderer,
  /'estCompradorTel', 'estCompradorCpf', 'estDataVenda'[\s\S]*?addEventListener\('input', \(\) => limparErro\(id\)\)/,
  'destaque inválido deve sumir enquanto o usuário corrige o campo');
assert.match(renderer, /if \(compradorCpf && !validarCPF\(compradorCpf\)\)/,
  'CPF preenchido ainda deve ser validado');

console.log('OK: CPF opcional não reaproveita borda de erro antiga no modal de venda.');
