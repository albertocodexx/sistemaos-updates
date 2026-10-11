'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const modulo = await import(pathToFileURL(path.join(__dirname,
    '../../supabase/functions/_shared/nfeio-produtos.ts')).href);
  const empresa = 'company_abc123';
  const inscricao = 'statetax_abc123';
  const nota = { id: 'invoice_abc123', payload: {
    natureza_operacao: 'Venda de mercadoria',
    tomador: { nome: 'Cliente Teste', documento: '12345678901', endereco: {
      estado: 'SP', codigo_municipio: '3550308', municipio: 'Sao Paulo', bairro: 'Centro',
      logradouro: 'Rua Teste', numero: '10', cep: '01001000'
    } },
    itens: [{ codigo: 'P1', descricao: 'Peca de teste', ncm: '85171300', cfop: '5102',
      unidade: 'UN', quantidade: 1, valor_unitario: 100, origem: '0', csosn: '102',
      cst_pis: '49', cst_cofins: '49' }]
  } };
  let chamadas = 0;
  const consultar = async (url, opcoes = {}) => {
    chamadas += 1;
    assert.equal(opcoes.headers.Authorization, 'chave-teste');
    if (opcoes.method === 'POST') {
      assert.match(url, /statetaxes\/statetax_abc123\/productinvoices$/);
      const corpo = JSON.parse(opcoes.body);
      assert.equal(corpo.id, nota.id);
      assert.equal(corpo.items[0].tax.icms.csosn, '102');
      assert.equal(corpo.buyer.address.city.code, '3550308');
      return new Response(JSON.stringify({ ProductInvoice: { id: nota.id } }), { status: 200 });
    }
    if (opcoes.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/pdf')) return new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200, headers: { 'content-type': 'application/pdf' }
    });
    if (url.endsWith('/xml')) return new Response('<nfeProc/>', {
      status: 200, headers: { 'content-type': 'application/xml' }
    });
    return new Response(JSON.stringify({ id: nota.id, currentStatus: 'Issued',
      environmentType: 'Production', protocol: { statusCode: 100, accessKey: '1'.repeat(44) } }), { status: 200 });
  };
  assert.equal(modulo.montarDocumentoProdutoNfeio(nota, 'nfe').ok, true);
  assert.equal(modulo.montarDocumentoProdutoNfeio({ ...nota, payload: { ...nota.payload, itens: [] } }, 'nfe').motivo,
    'itens_fiscais_incompletos');
  assert.equal((await modulo.emitirDocumentoProdutoNfeio(empresa, inscricao, nota, 'nfe', 'chave-teste', false, consultar)).id, nota.id);
  const consulta = await modulo.consultarDocumentoProdutoNfeio(empresa, nota.id, 'nfe', 'chave-teste', consultar);
  assert.equal(modulo.estadoDocumentoProdutoNfeio(consulta), 'autorizada');
  assert.equal((await modulo.baixarDanfeProdutoNfeio(empresa, nota.id, 'nfe', 'chave-teste', consultar)).ok, true);
  assert.equal((await modulo.baixarXmlProdutoNfeio(empresa, nota.id, 'nfe', 'chave-teste', consultar)).ok, true);
  assert.equal((await modulo.cancelarDocumentoProdutoNfeio(empresa, nota.id, 'nfe', 'chave-teste', consultar)).ok, true);
  const antes = chamadas;
  assert.equal((await modulo.emitirDocumentoProdutoNfeio('x', inscricao, nota, 'nfe', 'chave-teste', false, consultar)).motivo,
    'identificacao_invalida');
  assert.equal(chamadas, antes, 'identificacao invalida nao chama provedor');
  console.log('NFE.io: NF-e/NFC-e validam itens, usam StateTax, consultam, baixam DANFE/XML e cancelam com seguranca');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
