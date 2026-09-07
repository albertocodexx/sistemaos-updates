const assert = require('assert');
const Module = require('module');

const caminhoDb = require.resolve('../../src/db');
const cacheAnterior = Module._cache[caminhoDb];
const moduloDb = new Module(caminhoDb);
moduloDb.exports = {};
Module._cache[caminhoDb] = moduloDb;

const caminhoPdf = require.resolve('../../src/pdf');
delete require.cache[caminhoPdf];
const pdf = require('../../src/pdf');

const htmlOS = '<div class="assinatura-espaco"></div><div class="linha-assinatura"></div><div class="assinatura-label">ASSINATURA DO CLIENTE</div>';
const pendente = pdf.injetarAssinaturaClienteNoHtml(htmlOS, '', 'AGUARDANDO ASSINATURA');
const naoAssinado = pdf.injetarAssinaturaClienteNoHtml(htmlOS, '', 'NÃO ASSINADO');

assert.ok(pendente.includes('data-assinatura-estado="1"') && pendente.includes('AGUARDANDO ASSINATURA'));
assert.ok(naoAssinado.includes('data-assinatura-estado="1"') && naoAssinado.includes('NÃO ASSINADO'));
assert.strictEqual(pdf.obterEstadoAssinatura({ assinaturaPendente: true }, 'assinaturaClienteBase64'), 'AGUARDANDO ASSINATURA');
assert.strictEqual(pdf.obterEstadoAssinatura({}, 'assinaturaClienteBase64'), 'NÃO ASSINADO');
assert.strictEqual(pdf.obterEstadoAssinatura({ assinaturaClienteBase64: 'imagem' }, 'assinaturaClienteBase64'), '');

const htmlCompra = '<div class="assin-esp"></div><div class="assin-linha"></div><div class="assin-label">ASSINATURA DO VENDEDOR</div>';
assert.ok(pdf.injetarAssinaturaVendedorCompraNoHtml(htmlCompra, '', 'NÃO ASSINADO').includes('NÃO ASSINADO'));

if (cacheAnterior) Module._cache[caminhoDb] = cacheAnterior;
else delete Module._cache[caminhoDb];
delete require.cache[caminhoPdf];

console.log('OK: PDFs distinguem assinatura pendente, não assinada e assinada.');
