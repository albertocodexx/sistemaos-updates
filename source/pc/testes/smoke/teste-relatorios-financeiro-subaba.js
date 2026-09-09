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
assert.match(html, /id="icone-estrela"[\s\S]*M12 2l2\.5 6\.5L21 11/, 'assistente deve usar a estrela definida na identidade visual');
assert.match(html, /data-aba="log-ia"[\s\S]*?#icone-estrela/, 'Log IA deve apresentar a estrela no menu');

console.log('OK: Financeiro é subaba de Relatórios e estrela do assistente está aplicada.');
