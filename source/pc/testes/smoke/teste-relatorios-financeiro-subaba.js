const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');

assert.doesNotMatch(html, /class="aba"[^>]*data-aba="financeiro"/, 'Financeiro não deve continuar no menu principal');
assert.match(html, /data-aba="relatorios"[^>]*data-permissao-alternativa="financeiro"/, 'Relatórios deve aceitar usuários com permissão financeira');
assert.match(html, /data-relatorios-subaba="geral"/, 'Relatórios deve ter a subaba Visão geral');
assert.match(html, /data-relatorios-subaba="financeiro"/, 'Relatórios deve ter a subaba Financeiro');
assert.match(runtime, /function trocarSubabaRelatorios\(destino\)/, 'runtime deve alternar as duas visões');
assert.match(runtime, /if \(financeiro\) carregarFinanceiro\(\)/, 'subaba financeira deve carregar seus dados');
assert.match(html, /M14 24h7l4-5h9/, 'assistente deve usar a nova marca de circuitos');

console.log('OK: Financeiro é subaba de Relatórios e nova marca do assistente está aplicada.');
