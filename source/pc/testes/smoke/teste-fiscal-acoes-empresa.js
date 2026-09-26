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
  const empresaA = '11111111-1111-4111-8111-111111111111';
  const empresaB = '22222222-2222-4222-8222-222222222222';
  const notas = [{ id: 'nota-b', empresa_id: empresaB, origem_tipo: 'os', origem_id: 'OS-1',
    valor: 999, descricao: 'Nao pertence a A', status: 'rascunho' }];
  const configuracoes = [{ empresa_id: empresaA, status: 'configurada', ambiente: 'producao', provedor: 'teste' }];
  const limites = [];
  const perfis = [{ id: 'usuario-a', empresa_id: empresaA, nome: 'Teste', cargo: 'Administrador', ativo: true }];
  const contas = [{ empresa_id: empresaA, limite_gratuito_mensal: 100,
    preco_excedente_centavos: 20, saldo_centavos: 0, debito_pendente_centavos: 0 }];
  const reservasFiscais = [];
  const recargasFiscais = [];
  const colecoes = { notas_fiscais: notas, configuracoes_fiscais: configuracoes,
    limites_emissao_fiscal: limites, perfis, contas_fiscais: contas,
    reservas_fiscais: reservasFiscais, recargas_fiscais: recargasFiscais };
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
  codigo = codigo.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '');
  const ambiente = {
    Request, Response, Headers, URL, TextEncoder, TextDecoder, crypto,
    console: { error() {} },
    Deno: { env: { get(nome) {
      if (nome === 'FISCAL_EMISSOR_ATIVO') return emissorAtivo ? 'true' : 'false';
      if (nome === 'SUPABASE_URL') return 'https://qa.invalid';
      if (nome === 'SUPABASE_ANON_KEY') return 'anon-fixture';
      return 'service-fixture';
    } }, serve(funcao) { atender = funcao; } },
    createClient: (_url, chave) => chave === 'anon-fixture' ? cliente : admin,
    contextoUsuarioAtivo: () => true,
    licencaPermiteOperacao: () => true,
    temPermissao: () => true,
    ehAdministradorEmpresa: (contexto) => contexto.admin === true,
    carregarIntegracaoPlataforma: async () => ({ integracao: null, segredo: null })
  };
  vm.createContext(ambiente);
  vm.runInContext(stripTypeScriptTypes(codigo), ambiente);
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
  assert.equal((await chamar('resumo')).status, 200);
  assert.equal((await chamar('listar')).corpo.notas.some((nota) => nota.empresa_id === empresaB), false);
  notas.push({ id: 'nota-oficial-a', empresa_id: empresaA, origem_tipo: 'os', origem_id: 'OS-OFICIAL',
    valor: 10, descricao: 'Oficial', status: 'autorizada', numero: '42',
    danfse_storage_path: `${empresaA}/nota-oficial-a/danfse.pdf` });
  resposta = await chamar('obter_danfse', { id: 'nota-oficial-a' });
  assert.equal(resposta.status, 200);
  assert.match(resposta.corpo.danfse.url, /^https:\/\/qa\.invalid\/storage\//);
  assert.equal((await chamar('obter_danfse', { id: 'nota-b' })).status, 404,
    'DANFSe de outra empresa nao e entregue');

  emissorAtivo = true;
  configuracoes[0].status = 'configurada';
  configuracoes[0].ambiente = 'producao';
  resposta = await chamar('solicitar_emissao', { ...origem, origemId: 'OS-2' });
  assert.equal(resposta.status, 200);
  assert.equal(reservas, 1);
  assert.equal(ultimaReserva.p_nota_id, resposta.corpo.nota.id);
  assert.equal((await chamar('solicitar_emissao', { ...origem, origemId: 'OS-2' })).corpo.reutilizada, true);
  assert.equal(reservas, 1, 'repeticao nao desconta cota nem saldo');
  assert.equal((await chamar('cancelar_solicitacao', { id: resposta.corpo.nota.id })).status, 409,
    'nota enviada ao emissor nao e cancelada so no banco');
  assert.equal((await chamar('alterar_solicitacao', { id: resposta.corpo.nota.id,
    valor: 5, descricao: 'Mudanca apos envio' })).status, 409);

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
  assert.equal((await chamar('acao_desconhecida')).status, 400);
  console.log('OK: criar, alterar, cancelar, listar, DANFSe, configurar, recarga bloqueada e limites fiscais.');
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
