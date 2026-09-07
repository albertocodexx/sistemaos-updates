const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const raiz = path.resolve(__dirname, '..', '..');
const {
  TIPOS_ITEM_ESTOQUE,
  normalizarTipoItem,
  calcularMovimentacaoEstoque
} = require(path.join(raiz, 'src', 'inventory', 'stock-item'));
const { limparPeca } = require(path.join(raiz, 'src', 'supabase', 'inventory-service'));

assert.deepStrictEqual(TIPOS_ITEM_ESTOQUE, ['Peça / Componente', 'Consumível', 'Acessório']);
assert.strictEqual(normalizarTipoItem('Consumível'), 'Consumível');
assert.strictEqual(normalizarTipoItem('Acessório'), 'Acessório');
assert.strictEqual(normalizarTipoItem(''), 'Peça / Componente', 'itens antigos recebem tipo compatível');

assert.deepStrictEqual(calcularMovimentacaoEstoque(5, 'entrada', 3), {
  saldoAnterior: 5,
  saldoAtual: 8,
  quantidade: 3,
  tipo: 'entrada'
});
assert.deepStrictEqual(calcularMovimentacaoEstoque(5, 'saida', 2), {
  saldoAnterior: 5,
  saldoAtual: 3,
  quantidade: 2,
  tipo: 'saida'
});
assert.throws(() => calcularMovimentacaoEstoque(2, 'saida', 3), /Estoque insuficiente/);
assert.throws(() => calcularMovimentacaoEstoque(2, 'saida', 0), /maior que zero/);
assert.strictEqual(limparPeca({ id: 'PCA-1', tipoItem: 'Consumível' }).tipoItem, 'Consumível');

const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const dominio = ler('src', 'database', 'domain.js');
const preload = ler('src', 'preload', 'api.js');
const ipc = ler('src', 'ipc', 'register-legacy.js');
const renderer = ler('renderer', 'core', 'legacy-runtime.js');
const html = ler('renderer', 'index.html');
const migracaoEstoque = ler('supabase', 'migrations', '20260719000200_estoque_mobile_bidirecional.sql');

assert.match(dominio, /function movimentarEstoquePeca/);
assert.match(dominio, /'Carregador'/);
assert.match(dominio, /normalizarTipoItem\(dados\.tipoItem/);
assert.match(preload, /pecamovimentar:[\s\S]*peca:movimentar/);
assert.match(ipc, /ipcMain\.handle\('peca:movimentar'/);
assert.match(ipc, /sincronizarEstoqueAgora/);
assert.match(renderer, /btnEntradaPeca/);
assert.match(renderer, /btnSaidaPeca/);
assert.match(renderer, /window\.api\.pecamovimentar/);
assert.match(html, /value="Consumível"/);
assert.match(html, /id="btnExcluirPeca"/);
assert.match(migracaoEstoque, /dados jsonb not null/);
assert.match(migracaoEstoque, /tipo in \('aparelho', 'peca'\)/);

const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-consumiveis-'));
const electronPath = require.resolve('electron', { paths: [raiz] });
Module._cache[electronPath] = new Module(electronPath);
Module._cache[electronPath].exports = { app: { getPath: () => dirTemp } };
delete require.cache[require.resolve('../../src/db')];
const db = require('../../src/db');

const pelicula = db.criarPeca({
  tipoItem: 'Consumível',
  nome: 'Película 3D A23',
  categoria: 'Película',
  quantidade: 10,
  estoqueMinimo: 2,
  custo: 4.5
});
assert.strictEqual(pelicula.tipoItem, 'Consumível');
assert.strictEqual(db.movimentarEstoquePeca(pelicula.id, 'entrada', 5, {
  motivo: 'Compra de fornecedor', usuario: 'teste'
}).peca.quantidade, 15);
assert.strictEqual(db.movimentarEstoquePeca(pelicula.id, 'saida', 3, {
  motivo: 'Venda no balcão', usuario: 'teste'
}).peca.quantidade, 12);
const semSaldo = db.movimentarEstoquePeca(pelicula.id, 'saida', 20, { usuario: 'teste' });
assert.strictEqual(semSaldo.sucesso, false);
assert.match(semSaldo.erro, /Estoque insuficiente/);
assert.strictEqual(db.obterPecaPorId(pelicula.id).quantidade, 12, 'falha não pode alterar o saldo');
assert.strictEqual(db.excluirPeca(pelicula.id, 'teste').sucesso, true);
assert.strictEqual(db.obterPecaPorId(pelicula.id), null);
fs.rmSync(dirTemp, { recursive: true, force: true });

console.log('OK: consumíveis, acessórios, entrada, saída, exclusão e sincronização foram integrados.');
