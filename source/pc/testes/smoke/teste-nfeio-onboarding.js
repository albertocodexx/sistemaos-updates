'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

(async () => {
  const modulo = await import(pathToFileURL(path.join(__dirname,
    '../../supabase/functions/_shared/nfeio-onboarding.ts')).href);
  const cnpj = '12345678000199';
  const id = 'company_abc123';
  const cadastro = {
    cnpj, nome_prestador: 'Empresa Exemplo', nome_fantasia: 'Exemplo',
    regime_tributario: 'simples_nacional', cep_prestador: '01001000',
    codigo_municipio: '3550308', municipio_nome: 'São Paulo', uf: 'SP',
    logradouro_prestador: 'Rua Exemplo', numero_prestador: '10', bairro_prestador: 'Centro',
    inscricao_municipal: '123456', rps_serie: 'IO', rps_proximo_numero: 100
  };
  const envios = [];
  const consultar = async (url, opcoes) => {
    envios.push({ url, opcoes });
    assert.equal(opcoes.headers.Authorization, 'chave-de-teste');
    if (url.endsWith('/v2/companies') && opcoes.method === 'POST') {
      const corpo = JSON.parse(opcoes.body);
      assert.equal(corpo.Company.FederalTaxNumber, cnpj);
      assert.equal(corpo.Company.Address.City.Code, '3550308');
      return new Response(JSON.stringify({ Company: { Id: id, FederalTaxNumber: cnpj } }), { status: 200 });
    }
    if (url.includes('/municipaltaxes')) {
      if (opcoes.method === 'GET') return new Response(JSON.stringify({ MunicipalTax: {
        Id: 'municipal_abc123', CompanyId: id, Status: 'Active', FiscalStatus: 'Active',
        Environment: 'Development', TaxNumber: '123456', City: { Code: '3550308' },
        RpsSerialNumber: 'IO'
      } }), { status: 200 });
      const corpo = JSON.parse(opcoes.body);
      if (opcoes.method === 'PUT') {
        assert.equal(corpo.MunicipalTax.Environment, 'Production');
        assert.equal(corpo.MunicipalTax.LoginPassword, 'senha-municipal-qa');
        return new Response(JSON.stringify({ MunicipalTax: { Id: 'municipal_abc123',
          CompanyId: id, Status: 'Active', Environment: 'Production' } }), { status: 200 });
      }
      assert.equal(corpo.MunicipalTax.Environment, 'Development');
      assert.equal(corpo.MunicipalTax.RpsNumber, 100);
      return new Response(JSON.stringify({ MunicipalTax: { Id: 'municipal_abc123' } }), { status: 200 });
    }
    if (url.includes('/certificates')) {
      assert.ok(opcoes.body instanceof FormData);
      assert.equal(opcoes.body.get('Password'), 'senha-de-teste');
      assert.equal(opcoes.headers['Content-Type'], undefined);
      return new Response(JSON.stringify({ Certificate: { TaxId: cnpj,
        Status: 'Active', ValidUntil: '2099-01-01T00:00:00Z' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ companies: [], hasMore: false }), { status: 200 });
  };

  assert.equal(modulo.montarEmpresaNfeio(cadastro, 'acc_12345678').Company.TaxRegime, 'SimplesNacional');
  assert.equal(modulo.montarEmpresaNfeio({ ...cadastro, cep_prestador: '' }, 'acc_12345678'), null);
  assert.equal((await modulo.consultarEmpresaExistenteNfeio(cnpj, 'chave-de-teste', consultar)).existe, false);
  assert.equal((await modulo.criarEmpresaNfeio(cadastro, 'acc_12345678', 'chave-de-teste', consultar)).id, id);
  assert.equal((await modulo.criarInscricaoMunicipalNfeio(id, cadastro, 'chave-de-teste', consultar)).id, 'municipal_abc123');
  assert.equal((await modulo.criarInscricaoMunicipalNfeio(id, { ...cadastro, rps_serie: '' },
    'chave-de-teste', consultar)).motivo, 'inscricao_incompleta');
  const arquivo = new Uint8Array(128); arquivo[0] = 0x30;
  assert.equal((await modulo.enviarCertificadoNfeio(id, cnpj, arquivo, 'senha-de-teste',
    'chave-de-teste', consultar)).ok, true);
  assert.equal((await modulo.enviarCertificadoNfeio(id, cnpj, arquivo, '',
    'chave-de-teste', consultar)).motivo, 'certificado_invalido');
  assert.equal((await modulo.ativarInscricaoMunicipalNfeio(id, 'municipal_abc123', cadastro,
    { loginPassword: 'senha-municipal-qa' }, 'chave-de-teste', consultar)).ok, true);
  assert.equal((await modulo.ativarInscricaoMunicipalNfeio(id, 'municipal_abc123',
    { ...cadastro, inscricao_municipal: 'outra' }, {}, 'chave-de-teste', consultar)).motivo,
  'inscricao_divergente', 'nao promover inscricao que nao corresponde ao cadastro da empresa');
  assert.equal((await modulo.criarEmpresaNfeio(cadastro, 'acc_12345678', '', consultar)).motivo,
    'credencial_indisponivel');
  assert.equal(envios.length, 7, 'entradas invalidas nao fazem requisicoes externas');

  const edge = fs.readFileSync(path.join(__dirname, '../../supabase/functions/fiscal-documentos/index.ts'), 'utf8');
  const tela = fs.readFileSync(path.join(__dirname, '../../renderer/modules/fiscal/documentos.js'), 'utf8');
  assert.match(edge, /cadastrar_empresa_nfeio/);
  assert.match(edge, /cadastrar_inscricao_nfeio/);
  assert.match(edge, /ativar_inscricao_nfeio/);
  assert.match(edge, /FISCAL_EMISSOR_ATIVO/);
  assert.match(edge, /NFEIO_INVOICE_KEY/);
  assert.match(edge, /FISCAL_WORKER_CRON_SECRET/);
  assert.match(tela, /btnFiscalCadastrarEmpresaNfeio/);
  assert.match(tela, /btnFiscalCadastrarImNfeio/);
  assert.match(tela, /btnFiscalAtivarProducao/);
  assert.match(tela, /prestadorCpf \|\| Boolean\(metadados\.nfeio_empresa_id\)/);
  assert.match(tela, /cadastro de prestador CPF pode ser salvo, mas ainda não permite emitir notas/);
  assert.doesNotMatch(tela, /ID da empresa na NFE\.io/);
  console.log('NFE.io: cadastro pela empresa, IM de teste, A1 transitório e trava segura do emissor OK');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
