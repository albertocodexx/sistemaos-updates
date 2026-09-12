'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'www', 'index.html'), 'utf8');
const tela = fs.readFileSync(path.join(raiz, 'www', 'js', 'estoque-tela.js'), 'utf8');
const estilos = fs.readFileSync(path.join(raiz, 'www', 'css', 'app.css'), 'utf8');
const estoque = require('../www/js/supabase/estoque-service.js');

assert.ok(estoque.STATUS_APARELHO.includes('Aguardando peça'), 'Android deve aceitar o novo status do aparelho');
assert.deepStrictEqual(estoque.normalizarPecasUsadas([
  { descricao: 'Tela', valor: '199.90' },
  { nome: 'Carcaça completa', valor: -10 },
  { nome: '', valor: 0 }
]), [
  { nome: 'Tela', valor: 199.9 },
  { nome: 'Carcaça completa', valor: 0 }
]);
assert.deepStrictEqual(estoque._calcularAlteracoes(
  { id: 'EST-2', status: 'Em análise', observacoes: 'Alterada no PC', valorVenda: 500 },
  { id: 'EST-2', status: 'Aguardando peça', observacoes: 'Alterada no PC', valorVenda: 500 }
), { status: 'Aguardando peça' }, 'fila offline deve guardar apenas o delta e preservar edições simultâneas do PC');
assert.match(html, /id="aparelho-mobile-pecas-lista"/, 'modal deve detalhar as peças usadas');
assert.match(html, /id="aparelho-mobile-total-pecas"/, 'modal deve permitir ajustar o total das peças');
assert.match(tela, /pecasUsadas:\s*normalizarPecasUsadas\(pecasUsadasAparelho\)/, 'edição deve enviar o detalhamento para a nuvem');
assert.match(tela, /valorGastoPecas:\s*\$\('aparelho-mobile-total-pecas'\)\.value/, 'edição deve enviar o total financeiro');
assert.match(estilos, /\.aparelho-mobile-peca-linha/, 'lista deve ser responsiva no celular');

console.log('OK: aparelho no Android sincroniza status, peças usadas e total financeiro.');
