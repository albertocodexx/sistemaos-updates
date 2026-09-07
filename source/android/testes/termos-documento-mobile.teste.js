'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const html = ler('www', 'index.html');
const css = ler('www', 'css', 'app.css');
const app = ler('www', 'js', 'app.js');
const estoque = ler('www', 'js', 'supabase', 'estoque-service.js');
const termos = ler('www', 'src', 'termos-predefinidos.js');
const termosEmpacotados = ler('android', 'app', 'src', 'main', 'assets', 'public', 'src', 'termos-predefinidos.js');
const { gerarHtmlVenda } = require(path.join(raiz, 'www', 'src', 'templates', 'venda-template.js'));

for (const tipo of ['os', 'compra', 'venda']) {
  assert.match(html, new RegExp(`id="${tipo}-termos"`), `editor de termos ausente em ${tipo}`);
  assert.match(html, new RegExp(`data-restaurar-termos-documento="${tipo}"`), `restaurar padrão ausente em ${tipo}`);
  assert.match(html, new RegExp(`data-termos-status="${tipo}"`), `estado do editor ausente em ${tipo}`);
}

assert.match(css, /\.termos-documento\s*\{/);
assert.match(css, /\.termos-documento-rodape\s*\{/);
assert.match(app, /function resolverTermosPadraoDocumento\(tipo\)/);
assert.match(app, /termos:\s*texto\('os-termos'\)/);
assert.match(app, /termosCompra:\s*texto\('compra-termos'\)/);
assert.match(app, /termosVenda:\s*texto\('venda-termos'\)/);
assert.match(app, /termos:\s*dados\.termos \|\| ''/);
assert.match(app, /termosCompra:\s*dados\.termosCompra \|\| ''/);
assert.match(app, /termosVenda:\s*dados\.termosVenda \|\| ''/);
assert.match(app, /definirTermosDocumento\('os', dados\.termos\)/);
assert.match(app, /definirTermosDocumento\('compra', dados\.termosCompra\)/);
assert.match(app, /definirTermosDocumento\('venda', dados\.termosVenda\)/);
assert.match(estoque, /termosVenda:\s*venda\.termosVenda \|\| ''/);
assert.match(termos, /Em iPhones, a abertura envolve risco de dano à tela/);
assert.match(termos, /Android com tampa traseira já trincada/);
assert.match(termos, /ajuste no preço estimado será informado previamente ao cliente/);
assert.match(termos, /danos decorrentes da fragilidade ou avaria preexistente/);
assert.strictEqual(termosEmpacotados, termos, 'termos do APK empacotado devem ser idênticos aos fontes web');

assert.match(app, /function normalizarGarantiaVenda\(valor\)/);
assert.match(app, /garantia:\s*normalizarGarantiaVenda/);
for (const garantia of [0, '0', '0 dias', '0 mês', '0 meses', '0 ano', '0 anos', '0,00']) {
  const pdfVenda = gerarHtmlVenda({
    id: 'EST-TESTE',
    dataVenda: '2026-08-10T12:00:00.000Z',
    marca: 'Samsung',
    modelo: 'Galaxy S20 FE',
    compradorNome: 'Cliente Teste',
    valorVenda: 590,
    formaPagamento: 'Cartão de débito',
    garantia
  }, {});
  assert.match(pdfVenda, /Sem garantia/);
  assert.match(pdfVenda, /grade grade-valores/);
}

console.log('OK: termos podem ser revisados por OS, compra e venda e seguem na sincronização.');
