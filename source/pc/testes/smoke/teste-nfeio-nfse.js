'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const api = await import(pathToFileURL(path.join(__dirname,
    '../../supabase/functions/_shared/nfeio-nfse.ts')).href);
  const empresa = 'company_12345678';
  const nota = {
    id: 'f6766774-6160-4947-9aa0-f50a89cc1b2e', valor: 175,
    descricao: 'Reparo de aparelho', payload: { tomador: {
      cpfCnpj: '529.982.247-25', nome: 'Cliente de Teste', email: 'cliente@example.test'
    } }
  };
  const fiscal = { codigo_servico_municipal: '1401' };
  const corpo = api.montarNfseNfeio(nota, fiscal);
  assert.equal(corpo.externalId, nota.id);
  assert.equal(corpo.cityServiceCode, '1401');
  assert.equal(corpo.servicesAmount, 175);
  assert.equal(corpo.borrower.federalTaxNumber, '52998224725');
  const cpfComZeroInicial = { ...nota, payload: { tomador: {
    cpfCnpj: '049.335.394-13', nome: 'Cliente de Teste' } } };
  const corpoComZeroInicial = api.montarNfseNfeio(cpfComZeroInicial, fiscal);
  assert.equal(corpoComZeroInicial?.borrower.federalTaxNumber, '04933539413',
    'CPF com zero inicial deve ser preservado como texto');
  assert.equal(corpo.taxes, undefined, 'impostos não podem ser inventados no cliente');
  assert.equal(api.montarNfseNfeio({ ...nota, valor: 175.001 }, fiscal), null);
  assert.equal(api.montarNfseNfeio({ ...nota, payload: { tomador: { nome: 'Cliente', cpfCnpj: '123' } } }, fiscal), null);

  const chamadas = [];
  const chave = 'CHAVE_FICTICIA_APENAS_NO_TESTE';
  const consultar = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    assert.equal(opcoes.headers.Authorization, chave);
    assert.ok(!url.includes(chave), 'chave nunca deve entrar na URL');
    if (opcoes.method === 'POST') {
      assert.equal(JSON.parse(opcoes.body).externalId, nota.id);
      return new Response(JSON.stringify({ flowStatus: 'Processing' }), {
        status: 202, headers: { location: '/v1/jobs/job_12345678' }
      });
    }
    if (opcoes.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/pdf')) return new Response(new TextEncoder().encode('%PDF-1.7\nconteudo de teste'), {
      status: 200, headers: { 'content-type': 'application/pdf' }
    });
    if (url.endsWith('/xml')) return new Response(new TextEncoder().encode('<?xml version="1.0"?><Nfse/>'), {
      status: 200, headers: { 'content-type': 'application/xml' }
    });
    return new Response(JSON.stringify({ id: 'invoice_12345678', status: 'Issued', number: '42' }), { status: 200 });
  };
  const enviada = await api.emitirNfseNfeio(empresa, nota, fiscal, chave, consultar);
  assert.equal(enviada.ok, true);
  assert.equal(enviada.pendente, true, 'HTTP 202 não é autorização fiscal');
  assert.equal(enviada.localizacao, '/v1/jobs/job_12345678');
  const lida = await api.consultarNfseNfeio(empresa, nota.id, chave, consultar);
  assert.equal(lida.status, 'Issued');
  assert.equal(lida.numero, '42');
  const cancelada = await api.cancelarNfseNfeio(empresa, lida.id, chave, consultar);
  assert.equal(cancelada.pendente, true, 'HTTP 204 não confirma cancelamento municipal');
  const pdf = await api.baixarPdfNfseNfeio(empresa, lida.id, chave, consultar);
  assert.equal(pdf.ok, true);
  assert.equal(new TextDecoder().decode(pdf.bytes.subarray(0, 5)), '%PDF-');
  const xml = await api.baixarXmlNfseNfeio(empresa, lida.id, chave, consultar);
  assert.equal(xml.ok, true);
  assert.match(new TextDecoder().decode(xml.bytes), /^<\?xml/);

  const incerta = await api.emitirNfseNfeio(empresa, nota, fiscal, chave, async () => {
    throw new Error('timeout simulado');
  });
  assert.equal(incerta.motivo, 'resultado_desconhecido', 'não repetir POST após timeout sem consultar externalId');
  const invalido = await api.baixarPdfNfseNfeio(empresa, lida.id, chave,
    async () => new Response('<html>erro</html>', { status: 200 }));
  assert.equal(invalido.motivo, 'pdf_invalido');
  const xmlInvalido = await api.baixarXmlNfseNfeio(empresa, lida.id, chave,
    async () => new Response('conteudo sem XML', { status: 200 }));
  assert.equal(xmlInvalido.motivo, 'xml_invalido');
  assert.equal((await api.emitirNfseNfeio(empresa, { ...nota, valor: 0 }, fiscal, chave, consultar)).motivo,
    'nota_incompleta');
  assert.equal(chamadas.length, 5, 'dados inválidos não chamam o provedor');
  console.log('OK: NFE.io NFS-e valida dados, conserva idempotência, não confirma HTTP 202/204 e confere PDF/XML.');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
