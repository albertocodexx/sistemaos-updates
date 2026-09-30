'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

(async () => {
  const arquivo = path.join(__dirname, '../../supabase/functions/_shared/nfeio-preflight.ts');
  const { verificarEmitenteNfeio } = await import(pathToFileURL(arquivo).href);
  const id = 'company_abc123';
  const cnpj = '12345678000199';
  const chamadas = [];
  const consultar = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    if (url.endsWith(`/${id}`)) return new Response(JSON.stringify({ Company: {
      FederalTaxNumber: cnpj, Status: 'Active'
    } }), { status: 200 });
    if (url.includes('municipaltaxes')) return new Response(JSON.stringify({ municipalTaxes: [] }), { status: 200 });
    return new Response(JSON.stringify({ stateTaxes: [] }), { status: 200 });
  };
  assert.equal((await verificarEmitenteNfeio(id, cnpj, '', consultar)).motivo, 'credencial_indisponivel');
  assert.equal(chamadas.length, 0, 'sem credencial nao consulta o provedor');
  assert.equal((await verificarEmitenteNfeio('../invalido', cnpj, 'segredo', consultar)).motivo, 'identificacao_invalida');
  assert.equal(chamadas.length, 0, 'ID inseguro nao gera requisicao');

  const divergente = await verificarEmitenteNfeio(id, '12345678000198', 'segredo', consultar);
  assert.equal(divergente.motivo, 'cnpj_divergente');
  assert.equal(chamadas.length, 1, 'CNPJ divergente nao consulta inscricoes');
  chamadas.length = 0;
  const semInscricao = await verificarEmitenteNfeio(id, cnpj, 'segredo', consultar);
  assert.equal(semInscricao.ok, true);
  assert.equal(semInscricao.inscricao_municipal_teste, false);
  assert.equal(semInscricao.inscricao_estadual_ativa, false);
  assert.equal(semInscricao.emissao_liberada, false);
  assert.equal(chamadas.length, 3);
  assert.ok(chamadas.every(({ opcoes }) => opcoes.headers.Authorization === 'segredo'));

  const comInscricao = await verificarEmitenteNfeio(id, cnpj, 'segredo', async (url) => {
    if (url.endsWith(`/${id}`)) return new Response(JSON.stringify({ Company: {
      FederalTaxNumber: cnpj, Status: 'Active'
    } }), { status: 200 });
    if (url.includes('municipaltaxes')) return new Response(JSON.stringify({ municipalTaxes: [
      { Status: 'Active', Environment: 'Development' }
    ] }), { status: 200 });
    return new Response(JSON.stringify({ stateTaxes: [{ Status: 'Active' }] }), { status: 200 });
  });
  assert.equal(comInscricao.inscricao_municipal_teste, true);
  assert.equal(comInscricao.inscricao_estadual_ativa, true);
  assert.equal(comInscricao.emissao_liberada, false, 'inscricoes nao liberam emissao por si');

  const edge = fs.readFileSync(path.join(__dirname, '../../supabase/functions/fiscal-documentos/index.ts'), 'utf8');
  const tela = fs.readFileSync(path.join(__dirname, '../../renderer/modules/fiscal/documentos.js'), 'utf8');
  assert.match(edge, /cnpjNormalizado\(config\?\.metadados\?\.cnpj/);
  assert.match(edge, /if \(!podeConfigurar\).*Somente o administrador pode conferir/);
  assert.match(edge, /FISCAL_EMISSOR_ATIVO/);
  assert.match(edge, /NFEIO_INVOICE_KEY/);
  assert.match(edge, /FISCAL_WORKER_CRON_SECRET/);
  assert.match(tela, /cadastrar_empresa_nfeio/);
  console.log('NFE.io: preflight isolado, sem credencial, CNPJ divergente e inscricoes OK');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
