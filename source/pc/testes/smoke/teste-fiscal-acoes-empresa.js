'use strict';

// Testa as rotas reais da Edge Function fiscal com banco e emissor simulados.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function main() {
  let emissorAtivo = false;
  let administrador = true;
  let numeroId = 0;
  let reservas = 0;
  let ultimaReserva = null;
  let ultimaRegra = null;
  let credenciaisNuvem = true;
  let credenciaisNfeio = false;
  let cadastrosNfeio = 0;
  let inscricoesNfeio = 0;
  const chamadasNuvem = [];
  const empresaA = '11111111-1111-4111-8111-111111111111';
  const empresaB = '22222222-2222-4222-8222-222222222222';
  const notas = [{ id: 'nota-b', empresa_id: empresaB, origem_tipo: 'os', origem_id: 'OS-1',
    valor: 999, descricao: 'Nao pertence a A', status: 'rascunho' }];
  const configuracoes = [{ empresa_id: empresaA, status: 'configurada', ambiente: 'producao', provedor: 'nfeio' }];
  const limites = [];
  const perfis = [{ id: 'usuario-a', empresa_id: empresaA, nome: 'Teste', cargo: 'Administrador', ativo: true }];
  const contas = [{ empresa_id: empresaA, limite_gratuito_mensal: 0,
    preco_excedente_centavos: 99, saldo_centavos: 0, debito_pendente_centavos: 0 }];
  const empresas = [{ id: empresaA, licenca_status: 'ativa',
    plano: { nome: 'Basico' },
    data_vencimento: new Date(Date.now() + 30 * 86400000).toISOString() }];
  const reservasFiscais = [];
  const recargasFiscais = [];
  const colecoes = { notas_fiscais: notas, configuracoes_fiscais: configuracoes,
    limites_emissao_fiscal: limites, perfis, contas_fiscais: contas,
    reservas_fiscais: reservasFiscais, recargas_fiscais: recargasFiscais, empresas };
  function consulta(tabela) {
    const colecao = colecoes[tabela];
    assert.ok(colecao, `Tabela inesperada: ${tabela}`);
    const filtros = [];
    let mutacao = null;
    let valores = null;
    let somenteContagem = false;
    const q = {
      select(_colunas, opcoes) { somenteContagem = opcoes?.head === true; return q; },
      eq(campo, valor) { filtros.push((item) => item[campo] === valor); return q; },
      neq(campo, valor) { filtros.push((item) => item[campo] !== valor); return q; },
      contains(campo, objeto) { filtros.push((item) => Object.entries(objeto)
        .every(([chave, valor]) => item[campo]?.[chave] === valor)); return q; },
      in(campo, valoresAceitos) { filtros.push((item) => valoresAceitos.includes(item[campo])); return q; },
      order() { return q; },
      limit() { return q; },
      update(dados) { mutacao = 'update'; valores = dados; return q; },
      insert(dados) { mutacao = 'insert'; valores = dados; return q; },
      upsert(dados) { mutacao = 'upsert'; valores = dados; return q; },
      async maybeSingle() {
        let item = colecao.find((valor) => filtros.every((filtro) => filtro(valor)));
        if (mutacao === 'insert') {
          item = { id: `nota-${++numeroId}`, ...valores };
          colecao.push(item);
        } else if (mutacao === 'update' && item) Object.assign(item, valores);
        else if (mutacao === 'upsert') {
          item = colecao.find((valor) => valor.empresa_id === valores.empresa_id);
          if (item) Object.assign(item, valores);
          else { item = { ...valores }; colecao.push(item); }
        }
        return { data: item ? { ...item } : null, error: null };
      },
      async single() { return q.maybeSingle(); },
      then(resolve, reject) {
        const encontrados = colecao.filter((item) => filtros.every((filtro) => filtro(item)));
        if (mutacao === 'update') encontrados.forEach((item) => Object.assign(item, valores));
        return Promise.resolve({ data: somenteContagem ? null : encontrados, count: encontrados.length, error: null })
          .then(resolve, reject);
      }
    };
    return q;
  }
  const admin = {
    from: consulta,
    storage: { from(bucket) {
      assert.equal(bucket, 'documentos-fiscais');
      return { async createSignedUrl() {
        return { data: { signedUrl: 'https://qa.invalid/storage/danfse.pdf?token=fixture' }, error: null };
      } };
    } },
    async rpc(nome, parametros) {
      if (nome === 'reservar_cota_fiscal') {
        assert.equal(parametros.p_usuario_id, 'usuario-a');
        reservas += 1;
        ultimaReserva = parametros;
        const nota = notas.find((item) => item.id === parametros.p_nota_id);
        nota.status = 'na_fila';
        return { data: { reservada: true, custo_centavos: 0 }, error: null };
      }
      if (nome === 'definir_limite_emissao_fiscal') {
        ultimaRegra = parametros;
        return { data: parametros, error: null };
      }
      if (nome === 'remover_limite_emissao_fiscal') return { data: true, error: null };
      throw new Error(`RPC inesperada: ${nome}`);
    }
  };
  const cliente = {
    auth: { async getUser() { return { data: { user: { id: 'usuario-a' } } }; } },
    async rpc(nome) {
      assert.equal(nome, 'obter_contexto_comercial');
      return { data: { empresa_id: empresaA, usuario_ativo: true, empresa_ativa: true,
        administrador_global: false, recursos_habilitados: { fiscal_habilitado: true }, admin: administrador }, error: null };
    }
  };
  let atender;
  let codigo = fs.readFileSync(path.join(__dirname, '../../supabase/functions/fiscal-documentos/index.ts'), 'utf8');
  assert.match(codigo, /FISCAL_WORKER_CRON_SECRET/,
    'producao deve exigir worker autenticado, alem da chave do emissor');
  const codigoProducao = codigo.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '');
  // Sem provedor habilitado, nem flags nem cadastro pronto devem gerar reserva.
  codigo = codigo.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '');
  const ambiente = {
    Request, Response, Headers, URL, URLSearchParams, AbortSignal, TextEncoder, TextDecoder, atob, crypto,
    console: { error() {} },
    Deno: { env: { get(nome) {
      if (nome === 'FISCAL_EMISSOR_ATIVO') return emissorAtivo ? 'true' : 'false';
      if (nome === 'NUVEM_FISCAL_EMISSAO_ATIVA') return emissorAtivo ? 'true' : 'false';
      if (nome === 'NUVEM_FISCAL_SANDBOX_CLIENT_ID') return credenciaisNuvem ? 'id-qa' : '';
      if (nome === 'NUVEM_FISCAL_SANDBOX_CLIENT_SECRET') return credenciaisNuvem ? 'secret-qa' : '';
      if (nome === 'NFEIO_INVOICE_KEY') return credenciaisNfeio ? 'chave-qa' : '';
      if (nome === 'NFEIO_ACCOUNT_ID') return credenciaisNfeio ? 'conta-qa' : '';
      if (nome === 'FISCAL_WORKER_CRON_SECRET') return emissorAtivo ? 'cron-secret-qa' : '';
      if (nome === 'SUPABASE_URL') return 'https://qa.invalid';
      if (nome === 'SUPABASE_ANON_KEY') return 'anon-fixture';
      return 'service-fixture';
    } }, serve(funcao) { atender = funcao; } },
    createClient: (_url, chave) => chave === 'anon-fixture' ? cliente : admin,
    contextoUsuarioAtivo: () => true,
    licencaPermiteOperacao: () => true,
    temPermissao: () => true,
    ehAdministradorEmpresa: (contexto) => contexto.admin === true,
    carregarIntegracaoPlataforma: async () => ({ integracao: null, segredo: null }),
    consultarEmpresaExistenteNfeio: async () => ({ ok: true, existe: false }),
    criarEmpresaNfeio: async (fiscal) => {
      assert.equal(fiscal.cnpj, '11444777000161');
      cadastrosNfeio += 1;
      return { ok: true, id: 'company_qa123456' };
    },
    verificarEmitenteNfeio: async () => ({ ok: true, inscricao_municipal_teste: false,
      inscricao_municipal_producao: false }),
    criarInscricaoMunicipalNfeio: async (_id, fiscal) => {
      assert.equal(fiscal.rps_serie, 'QA');
      inscricoesNfeio += 1;
      return { ok: true, id: 'municipal_qa123456' };
    },
    ativarInscricaoMunicipalNfeio: async (_id, _imId, fiscal, credenciais) => {
      assert.equal(fiscal.cnpj, '11444777000161');
      assert.equal(credenciais.loginPassword, 'senha-municipal-qa');
      return { ok: true, ja_ativa: false };
    },
    enviarCertificadoNfeio: async (_id, _cnpj, _arquivo, senha) => {
      assert.equal(senha, ' senha com espaços ');
      return { ok: true, valido_ate: '2099-01-01T00:00:00Z' };
    },
    fetch: async (url, opcoes) => {
      chamadasNuvem.push({ url, method: opcoes?.method || 'GET' });
      if (url === 'https://auth.nuvemfiscal.com.br/oauth/token') {
        assert.equal(opcoes.body.get('scope'), 'empresa');
        return new Response(JSON.stringify({ access_token: 'token-qa' }), { status: 200 });
      }
      assert.match(url, /^https:\/\/api\.sandbox\.nuvemfiscal\.com\.br\//);
      assert.equal(opcoes.headers.Authorization, 'Bearer token-qa');
      if (opcoes.method === 'PUT') {
        const enviado = JSON.parse(opcoes.body);
        assert.equal(enviado.password, 'senha-qa');
        assert.equal(typeof enviado.certificado, 'string');
        return new Response(JSON.stringify({ cpf_cnpj: '52998224725', not_valid_after: '2027-09-27T00:00:00Z' }), { status: 200 });
      }
      if (opcoes.method === 'POST') {
        const cadastro = JSON.parse(opcoes.body);
        assert.equal(cadastro.cpf_cnpj, '52998224725');
        assert.equal(cadastro.endereco.codigo_municipio, '3550308');
        return new Response('{}', { status: 201 });
      }
      return new Response('{}', { status: 404 });
    }
  };
  vm.createContext(ambiente);
  vm.runInContext(stripTypeScriptTypes(codigo), ambiente);
  let atenderProducao;
  const ambienteProducao = { ...ambiente, Deno: { ...ambiente.Deno,
    serve(funcao) { atenderProducao = funcao; } } };
  vm.createContext(ambienteProducao);
  vm.runInContext(stripTypeScriptTypes(codigoProducao), ambienteProducao);
  const chamar = async (acao, dados = {}) => {
    const retorno = await atender(new Request('https://qa.invalid/fiscal-documentos', {
      method: 'POST', headers: { Authorization: 'Bearer qa', 'content-type': 'application/json' },
      body: JSON.stringify({ acao, dados })
    }));
    return { status: retorno.status, corpo: await retorno.json() };
  };
  const origem = { origemTipo: 'os', origemId: 'OS-1', valor: 100, descricao: 'Servico de reparo' };
  let resposta = await chamar('solicitar_emissao', origem);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.nota.status, 'aguardando_configuracao');
  assert.equal(notas.filter((nota) => nota.empresa_id === empresaA).length, 1);
  assert.equal(notas.find((nota) => nota.empresa_id === empresaB).valor, 999, 'empresa B preservada');
  resposta = await chamar('solicitar_emissao', { ...origem, valor: 120, descricao: 'Reparo alterado' });
  assert.equal(resposta.status, 200);
  assert.equal(notas.find((nota) => nota.empresa_id === empresaA).valor, 120, 'rascunho alterado');
  assert.equal(notas.filter((nota) => nota.empresa_id === empresaA).length, 1, 'alteracao nao duplica nota');
  assert.equal((await chamar('solicitar_emissao', { ...origem, valor: 1.234 })).status, 400);
  assert.equal((await chamar('solicitar_emissao', { ...origem, origemTipo: 'compra' })).status, 400);
  const idRascunho = notas.find((nota) => nota.empresa_id === empresaA).id;
  resposta = await chamar('alterar_solicitacao', { id: idRascunho, valor: 130.5, descricao: 'Descrição corrigida' });
  assert.equal(resposta.status, 200);
  assert.equal(notas.find((nota) => nota.id === idRascunho).valor, 130.5);
  assert.equal(notas.find((nota) => nota.id === idRascunho).descricao, 'Descrição corrigida');
  assert.equal((await chamar('alterar_solicitacao', { id: idRascunho, valor: 1.234, descricao: 'Invalida' })).status, 400);
  assert.equal((await chamar('cancelar_solicitacao', { id: idRascunho })).status, 200);
  assert.equal(notas.find((nota) => nota.id === idRascunho).status, 'cancelada');
  assert.equal((await chamar('cancelar_solicitacao', { id: idRascunho })).status, 409);
  assert.equal((await chamar('alterar_solicitacao', { id: idRascunho, valor: 10, descricao: 'Tardia' })).status, 409);
  assert.equal((await chamar('solicitar_emissao', origem)).status, 409, 'nota cancelada nao reabre em silencio');
  assert.equal((await chamar('cancelar_solicitacao', { id: 'nota-b' })).status, 409,
    'empresa A nao cancela documento da B');
  assert.equal((await chamar('criar_recarga', { valorCentavos: 100 })).status, 409,
    'recarga real nao e aberta antes da homologacao');
  assert.equal((await chamar('salvar_configuracao', { tipoPrestador: 'juridica',
    documentoPrestador: '12345678000100' })).status, 400, 'CNPJ invalido e recusado');
  resposta = await chamar('salvar_configuracao', { tipoPrestador: 'fisica', documentoPrestador: '52998224725',
    cadastroMunicipalConfirmado: true, inscricaoMunicipalDispensada: true,
    codigoMunicipio: '3550308', codigoServico: '0101', regimeTributario: 'autonomo' });
  assert.equal(resposta.status, 200);
  assert.equal(configuracoes[0].status, 'nao_configurada', 'troca de emitente exige nova homologacao');
  assert.equal(configuracoes[0].provedor, 'nfeio', 'cadastro fiscal deve usar o emissor ativo');
  configuracoes[0].ambiente = 'homologacao';
  assert.equal((await chamar('resumo')).status, 200);
  assert.equal((await chamar('resumo')).corpo.provedor_fiscal, 'nfeio');
  const a1Teste = Buffer.concat([Buffer.from([0x30]), Buffer.alloc(119, 0x01)]).toString('base64');
  Object.assign(configuracoes[0].metadados, { nome_prestador: 'Prestador QA',
    email_prestador: 'qa@example.invalid', uf: 'SP', cep_prestador: '01001000',
    logradouro_prestador: 'Rua QA', numero_prestador: '10', bairro_prestador: 'Centro' });
  resposta = await chamar('cadastrar_certificado_a1', { certificadoBase64: a1Teste, senha: 'senha-qa' });
  assert.equal(resposta.status, 503, 'A1 nao sai sem emissor NFE.io configurado no servidor');
  assert.equal(chamadasNuvem.length, 0, 'nenhum dado fiscal deve chegar ao provedor encerrado');
  assert.equal(configuracoes[0].status, 'nao_configurada', 'A1 nao libera producao');
  assert.equal(JSON.stringify(configuracoes[0]).includes('senha-qa'), false, 'senha nao pode entrar no banco');
  assert.equal(JSON.stringify(configuracoes[0]).includes(a1Teste), false, 'A1 nao pode entrar no banco');
  assert.equal((await chamar('listar')).corpo.notas.some((nota) => nota.empresa_id === empresaB), false);
  notas.push({ id: 'nota-oficial-a', empresa_id: empresaA, origem_tipo: 'os', origem_id: 'OS-OFICIAL',
    valor: 10, descricao: 'Oficial', status: 'autorizada', numero: '42', codigo_verificacao: 'CODIGO-42',
    danfse_storage_path: `${empresaA}/nota-oficial-a/danfse.pdf` });
  resposta = await chamar('obter_danfse', { id: 'nota-oficial-a' });
  assert.equal(resposta.status, 200);
  assert.match(resposta.corpo.danfse.url, /^https:\/\/qa\.invalid\/storage\//);
  assert.equal((await chamar('obter_danfse', { id: 'nota-b' })).status, 404,
    'DANFSe de outra empresa nao e entregue');

  emissorAtivo = true;
  configuracoes[0].status = 'configurada';
  configuracoes[0].ambiente = 'producao';
  const resumoProducao = await atenderProducao(new Request('https://qa.invalid/fiscal-documentos', {
    method: 'POST', headers: { Authorization: 'Bearer qa', 'content-type': 'application/json' },
    body: JSON.stringify({ acao: 'resumo', dados: {} })
  }));
  assert.equal((await resumoProducao.json()).emissor_operacional, false,
    'sem credencial NFE.io a flag isolada nao habilita emissao');
  resposta = await chamar('solicitar_emissao', { ...origem, origemId: 'OS-2' });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.nota.status, 'aguardando_configuracao');
  assert.equal(reservas, 0, 'sem provedor nao deve reservar nem cobrar nota');
  assert.equal((await chamar('cancelar_solicitacao', { id: resposta.corpo.nota.id })).status, 200,
    'rascunho pode ser cancelado sem envio ao emissor');

  administrador = false;
  assert.equal((await chamar('listar_limites')).status, 403);
  assert.equal((await chamar('salvar_limite', { tipoAlvo: 'usuario', alvo: 'usuario-a', limiteMensal: 1 })).status, 403);
  administrador = true;
  assert.equal((await chamar('listar_limites')).status, 200);
  assert.equal((await chamar('salvar_limite', { tipoAlvo: 'usuario', alvo: 'usuario-a' })).status, 400);
  assert.equal((await chamar('salvar_limite', { tipoAlvo: 'usuario', alvo: 'usuario-a',
    limiteMensal: 5, limiteGastoCentavos: 40 })).status, 200);
  assert.equal(ultimaRegra.p_empresa_id, empresaA);
  assert.equal(ultimaRegra.p_autor_id, 'usuario-a');
  assert.equal(ultimaRegra.p_limite_mensal, 5);
  assert.equal(ultimaRegra.p_limite_gasto_centavos, 40);
  assert.equal((await chamar('remover_limite', { tipoAlvo: 'usuario', alvo: 'usuario-a' })).status, 200);
  emissorAtivo = false;
  empresas[0].licenca_status = 'teste';
  empresas[0].plano = { nome: 'Trial' };
  empresas[0].modulo_fiscal_ativo_ate = null;
  empresas[0].fim_trial = new Date(Date.now() + 30 * 86400000).toISOString();
  assert.equal((await chamar('resumo')).corpo.cota.limite_gratuito_mensal, 0);
  credenciaisNfeio = true;
  resposta = await chamar('salvar_configuracao', { tipoPrestador: 'juridica',
    documentoPrestador: '11444777000161', nomePrestador: 'Empresa QA',
    codigoMunicipio: '3550308', municipioNome: 'Sao Paulo', uf: 'SP',
    inscricaoMunicipal: '12345', rpsSerie: 'QA', rpsProximoNumero: 1,
    codigoServico: '0101', regimeTributario: 'simples_nacional' });
  assert.equal(resposta.status, 200);
  administrador = false;
  assert.equal((await chamar('cadastrar_empresa_nfeio')).status, 403,
    'usuario comum nao cadastra a empresa no emissor');
  administrador = true;
  assert.equal((await chamar('cadastrar_empresa_nfeio')).status, 200);
  assert.equal(configuracoes[0].metadados.nfeio_empresa_id, 'company_qa123456');
  assert.equal((await chamar('cadastrar_empresa_nfeio')).status, 200,
    'repetir cadastro da empresa nao cria duplicata');
  assert.equal(cadastrosNfeio, 1);
  assert.equal((await chamar('cadastrar_inscricao_nfeio')).status, 200);
  assert.equal(configuracoes[0].metadados.nfeio_im_id, 'municipal_qa123456');
  assert.equal((await chamar('cadastrar_inscricao_nfeio')).status, 200,
    'repetir cadastro municipal nao cria duplicata');
  assert.equal(inscricoesNfeio, 1);
  assert.equal((await chamar('cadastrar_certificado_a1', {
    certificadoBase64: a1Teste, senha: ' senha com espaços '
  })).status, 200);
  assert.equal(configuracoes[0].metadados.nfeio_certificado_valido_ate, '2099-01-01T00:00:00Z');
  assert.equal(JSON.stringify(configuracoes[0]).includes('senha com espaços'), false);
  assert.equal((await chamar('ativar_inscricao_nfeio', { senhaPrefeitura: 'senha-municipal-qa' })).status, 400,
    'nao ativar producao sem confirmacao do titular');
  assert.equal((await chamar('ativar_inscricao_nfeio', {
    confirmacaoTitularidade: true, senhaPrefeitura: 'senha-municipal-qa'
  })).status, 200);
  assert.equal(configuracoes[0].provedor, 'nfeio');
  assert.equal(configuracoes[0].ambiente, 'producao');
  assert.equal(configuracoes[0].status, 'configurada');
  assert.ok(configuracoes[0].metadados.nfeio_im_producao_em,
    'registrar confirmacao de producao sem marcar nota como emitida');
  assert.equal(JSON.stringify(configuracoes[0]).includes('senha-municipal-qa'), false,
    'senha municipal nao pode ser persistida');
  assert.equal((await chamar('salvar_configuracao', { tipoPrestador: 'juridica',
    documentoPrestador: '11444777000161', codigoMunicipio: '3550308', uf: 'SP',
    inscricaoMunicipal: '12345', rpsSerie: 'QB', rpsProximoNumero: 1 })).status, 409,
  'serie RPS vinculada nao muda silenciosamente');
  assert.equal((await chamar('solicitar_emissao', { ...origem, origemId: 'OS-TRIAL' })).status, 200,
    'trial ativo prepara documento sem adicional pago');
  emissorAtivo = true;
  resposta = await chamar('solicitar_emissao', { ...origem, origemId: 'OS-NFEIO-PRODUCAO' });
  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.nota.status, 'na_fila');
  assert.equal(reservas, 1, 'emissor completo reserva cota e coloca o documento na fila');
  empresas[0].fim_trial = new Date(Date.now() - 1000).toISOString();
  assert.equal((await chamar('solicitar_emissao', { ...origem, origemId: 'OS-TRIAL-VENCIDO' })).status, 409,
    'trial vencido nao cria nova emissao');
  assert.equal((await chamar('acao_desconhecida')).status, 400);
  console.log('OK: criar, alterar, cancelar, listar, DANFSe, configurar, recarga bloqueada e limites fiscais.');
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
