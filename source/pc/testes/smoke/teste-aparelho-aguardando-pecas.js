'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const estilos = fs.readFileSync(path.join(raiz, 'renderer', 'style.css'), 'utf8');
const inventoryService = require('../../src/supabase/inventory-service');

assert.match(html, /data-status="Aguardando peça"/, 'a listagem deve permitir filtrar aparelhos aguardando peça');
assert.match(html, /<option>Aguardando peça<\/option>/, 'o formulário deve oferecer o novo status');
assert.match(html, /id="estPecasUsadasLista"/, 'o financeiro deve detalhar as peças usadas');
assert.match(html, /id="btnAdicionarPecaUsadaEstoque"/, 'deve ser possível adicionar mais de uma peça');
assert.match(renderer, /pecasUsadas:\s*normalizarPecasUsadasFormulario\(pecasUsadasEstoque\)/, 'as peças detalhadas devem ser persistidas');
assert.match(renderer, /sincronizarTotalPecasUsadasEstoque/, 'a soma das peças deve alimentar o total financeiro');
assert.match(estilos, /\.estoque-peca-usada-linha/, 'as linhas de peças precisam de layout responsivo');
assert.deepStrictEqual(inventoryService.limparAparelho({ id: 'EST-0002', pecasUsadas: [{ nome: 'Tela', valor: 100 }] }).pecasUsadas,
  [{ nome: 'Tela', valor: 100 }], 'o detalhamento deve seguir na sincronização com a nuvem');

const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-aparelho-pecas-'));
const electronPath = require.resolve('electron', { paths: [raiz] });
Module._cache[electronPath] = new Module(electronPath);
Module._cache[electronPath].exports = { app: { getPath: () => dirTemp } };
delete require.cache[require.resolve('../../src/db')];
const db = require('../../src/db');

const aparelho = db.criarItemEstoque({
  marca: 'Samsung', modelo: 'Galaxy S20', status: 'Aguardando peça',
  valorPago: 140, valorGastoPecas: 315,
  pecasUsadas: [{ nome: 'Tela', valor: 200 }, { descricao: 'Carcaça completa', valor: 115 }]
});
assert.strictEqual(aparelho.status, 'Aguardando peça');
assert.deepStrictEqual(aparelho.pecasUsadas, [
  { nome: 'Tela', valor: 200 }, { nome: 'Carcaça completa', valor: 115 }
]);
assert.strictEqual(aparelho.valorGastoPecas, 315, 'a soma deve compor o investimento e o lucro');
assert.strictEqual(db.obterEstatisticasEstoque().aguardandoPeca, 1);

const ajustado = db.atualizarItemEstoque(aparelho.id, Object.assign({}, aparelho, {
  pecasUsadas: [{ nome: 'Tela', valor: 0 }, { nome: 'Carcaça completa', valor: 0 }],
  valorGastoPecas: 315
}));
assert.strictEqual(ajustado.valorGastoPecas, 315, 'um total manual deve ser preservado sem inventar valores por peça');
assert.throws(() => db.criarItemEstoque({ marca: 'Teste', modelo: 'Inválido', status: 'Sem status' }), /Status de estoque inválido/);

fs.rmSync(dirTemp, { recursive: true, force: true });
console.log('OK: aparelhos aceitam Aguardando peça, detalhamento por peça e total financeiro ajustável.');
