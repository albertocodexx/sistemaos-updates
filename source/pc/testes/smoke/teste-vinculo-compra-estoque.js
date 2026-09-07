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

assert.match(html, /id="estNumeroCompra"/, 'estoque deve aceitar o número da compra vinculada');
assert.match(html, /class="estoque-compra-prefixo">CP-</, 'prefixo CP deve aparecer automaticamente');
assert.match(html, /id="btnVincularCompraEstoque"/, 'formulário deve permitir localizar e vincular a compra');
assert.match(renderer, /normalizarNumeroCompraEstoque/, 'números 1 e 0001 devem ser normalizados');
assert.match(renderer, /numeroCompra,/, 'vínculo deve ser enviado ao banco');
assert.match(estilos, /\.compra-card-meta/, 'cartão de compras deve usar o resumo compacto');
assert.doesNotMatch(html, /<label>CPF <span class="obrigatorio">\*<\/span><\/label><input id="cpVCpf"/, 'CPF do vendedor não pode ser obrigatório');

const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-vinculo-compra-'));
const electronPath = require.resolve('electron', { paths: [raiz] });
Module._cache[electronPath] = new Module(electronPath);
Module._cache[electronPath].exports = { app: { getPath: () => dirTemp } };
delete require.cache[require.resolve('../../src/db')];
const db = require('../../src/db');

const compra = db.criarCompra({
  vendedor: { nome: 'Vendedor sem CPF', cpf: '' },
  aparelho: {
    tipo: 'Celular', marca: 'Samsung', modelo: 'Galaxy S20 FE', cor: 'Azul', imei1: '123456789012347'
  },
  dadosCompra: {
    valor: 140,
    custoPecas: 75,
    custoTotal: 215,
    pecasTrocar: [{ nome: 'Tela', valor: 75 }]
  }
});
assert.strictEqual(compra.numero, 'CP-0001');
assert.strictEqual(compra.vendedor.cpf, '', 'compra deve aceitar vendedor sem CPF');

const aparelho = db.criarItemEstoque({
  numeroCompra: '1',
  status: 'Em análise',
  dataEntrada: '2026-08-03'
});
assert.strictEqual(aparelho.numeroCompra, 'CP-0001');
assert.strictEqual(aparelho.marca, 'Samsung');
assert.strictEqual(aparelho.modelo, 'Galaxy S20 FE');
assert.strictEqual(aparelho.tipoEquipamento, 'Smartphone');
assert.strictEqual(aparelho.valorPago, 140);
assert.strictEqual(aparelho.valorGastoPecas, 75);

assert.throws(() => db.criarItemEstoque({ numeroCompra: '0001' }), /já está vinculada/);

db.atualizarCompra('CP-0001', {
  dadosCompra: {
    valor: 150,
    custoPecas: 95,
    custoTotal: 245,
    pecasTrocar: [{ nome: 'Tela', valor: 75 }, { nome: 'Bateria', valor: 20 }]
  }
});
const sincronizado = db.obterItemEstoquePorId(aparelho.id);
assert.strictEqual(sincronizado.valorPago, 150, 'editar a compra deve sincronizar o valor pago');
assert.strictEqual(sincronizado.valorGastoPecas, 95, 'editar a compra deve sincronizar os custos');

fs.rmSync(dirTemp, { recursive: true, force: true });
console.log('OK: compra sem CPF e vínculo CP automático sincronizam o aparelho de revenda.');
