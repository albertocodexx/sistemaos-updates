'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { indexedDB } = require('fake-indexeddb');

const raiz = path.join(__dirname, '..');
const caminhoOS = path.join(raiz, 'www/js/supabase/os-service.js');
const caminhoSync = path.join(raiz, 'www/js/supabase/sync-service.js');
const caminhoCloudData = path.join(raiz, 'www/js/cloud-data.js');

function recarregar(caminho) {
  delete require.cache[require.resolve(caminho)];
  return require(caminho);
}

function linhaOS(extra) {
  return Object.assign({
    id: '11111111-1111-4111-8111-111111111111',
    empresa_id: 'empresa-a',
    numero: 'OS-0042',
    id_exportacao: 'os-local-1',
    cliente_nome_snapshot: 'Ana',
    marca: 'Samsung',
    modelo: 'S23 Ultra',
    status: 'Aguardando análise',
    prioridade: 'Normal',
    revision: 1,
    created_at: '2026-07-17T10:00:00Z',
    updated_at: '2026-07-17T10:00:00Z'
  }, extra || {});
}

function localStorageFalso() {
  const valores = new Map();
  return {
    getItem(chave) { return valores.has(chave) ? valores.get(chave) : null; },
    setItem(chave, valor) { valores.set(chave, String(valor)); },
    removeItem(chave) { valores.delete(chave); }
  };
}

async function executar() {
  let total = 0;
  async function teste(nome, fn) {
    await fn();
    total += 1;
    console.log('✓ ' + nome);
  }

  await teste('criação usa RPC idempotente, número do servidor e nenhum empresa_id do APK', async () => {
    const chamadas = [];
    global.SupabaseClientApp = {
      obterCliente() {
        return {
          async rpc(nome, parametros) {
            chamadas.push({ nome, parametros });
            return { data: linhaOS(), error: null };
          }
        };
      }
    };
    const servico = recarregar(caminhoOS);
    const resultado = await servico.criar({
      empresa_id: 'empresa-forjada',
      numero: 'OS-9999',
      revision: 99,
      cliente: { nome: 'Ana', telefone: '11999999999' },
      aparelho: { marca: 'Samsung', modelo: 'S23 Ultra', defeitoRelatado: 'Tela' },
      garantiaDias: 90,
      fotos: ['data:image/jpeg;base64,NAO-DEVE-IR']
    }, 'os-local-1', 'device-a');
    assert.equal(chamadas[0].nome, 'criar_ordem_servico');
    assert.equal(chamadas[0].parametros.p_id_exportacao, 'os-local-1');
    assert.equal(chamadas[0].parametros.p_origem_dispositivo_id, 'device-a');
    assert.equal('empresa_id' in chamadas[0].parametros.p_dados, false);
    assert.equal('numero' in chamadas[0].parametros.p_dados, false);
    assert.equal('revision' in chamadas[0].parametros.p_dados, false);
    assert.equal('fotos' in chamadas[0].parametros.p_dados, false);
    assert.equal(chamadas[0].parametros.p_dados.cliente_nome_snapshot, 'Ana');
    assert.equal(chamadas[0].parametros.p_dados.modelo, 'S23 Ultra');
    assert.equal(resultado.numero, 'OS-0042');
    assert.equal(resultado.revision, 1);
  });

  await teste('edição envia revision esperada e somente campos permitidos', async () => {
    let chamada;
    global.SupabaseClientApp = {
      obterCliente() {
        return { async rpc(nome, parametros) {
          chamada = { nome, parametros };
          return { data: linhaOS({ revision: 4, status: 'Em reparo' }), error: null };
        } };
      }
    };
    const servico = recarregar(caminhoOS);
    const resultado = await servico.atualizar('11111111-1111-4111-8111-111111111111', 3, {
      status: 'Em reparo',
      'aparelho.defeitoRelatado': 'Conector',
      empresa_id: 'nao-pode',
      numero: 'OS-9999'
    });
    assert.equal(chamada.nome, 'atualizar_ordem_servico');
    assert.equal(chamada.parametros.p_revision, 3);
    assert.deepEqual(chamada.parametros.p_patch, { status: 'Em reparo', defeito_relatado: 'Conector' });
    assert.equal(resultado.revision, 4);
  });

  await teste('conflito de revision é separado de erro de rede', async () => {
    global.SupabaseClientApp = {
      obterCliente() {
        return { async rpc() {
          return { data: null, error: { code: '40001', message: 'conflito_revision: versão mais nova' } };
        } };
      }
    };
    const servico = recarregar(caminhoOS);
    await assert.rejects(
      () => servico.excluir('11111111-1111-4111-8111-111111111111', 1),
      (erro) => erro.tipo === 'conflito'
    );
    assert.equal(servico._classificarErro(new TypeError('Failed to fetch')), 'rede');
  });

  await teste('sem internet a criação entra na mesma fila local e não finge sucesso', async () => {
    const fila = [];
    global.localStorage = localStorageFalso();
    Object.defineProperty(global, 'navigator', { value: { onLine: false }, configurable: true });
    global.SistemaOSSessao = {
      obterEstado() {
        return { tipo: 'offline_com_sessao', usuario: { id: 'usuario-a' }, contexto: { empresa_id: 'empresa-a', usuario_id: 'usuario-a' } };
      },
      ehErroRede() { return true; }
    };
    global.SistemaOSPermissoes = { obterContexto() { return { empresa_id: 'empresa-a', usuario_id: 'usuario-a' }; } };
    global.SistemaOSSupabaseOS = {
      _dadosParaCriacao(dados) { return { cliente_nome_snapshot: dados.cliente.nome }; },
      _patchParaServidor(patch) { return patch; },
      _classificarErro() { return 'rede'; }
    };
    global.SistemaOSHistorico = {
      async enfileirarOperacaoNuvem(item) { fila.push(item); return item; },
      async atualizarOperacaoNuvem() { return null; }
    };
    const sync = recarregar(caminhoSync);
    const resultado = await sync.criarOS({ cliente: { nome: 'Ana' } }, 'os-local-offline', 'hist-1');
    assert.equal(resultado.enviado, false);
    assert.equal(resultado.enfileirado, true);
    assert.equal(fila.length, 1);
    assert.equal(fila[0].empresaId, 'empresa-a');
    assert.equal(fila[0].usuarioId, 'usuario-a');
    assert.equal(fila[0].idExportacao, 'os-local-offline');
  });

  await teste('retry valida sessão, mantém ordem e só conclui após confirmação do servidor', async () => {
    const fila = [
      {
        id: 'os:create:1', empresaId: 'empresa-a', usuarioId: 'usuario-a', entidade: 'ordem_servico',
        operacao: 'insert', idExportacao: '1', dados: { cliente_nome_snapshot: 'Ana' },
        registroLocalId: 'hist-1', status: 'pendente', tentativas: 0, criadoEm: '2026-07-17T10:00:00Z'
      },
      {
        id: 'os:update:2:1', empresaId: 'empresa-a', usuarioId: 'usuario-a', entidade: 'ordem_servico',
        operacao: 'update', entidadeId: 'os-2', revisionEsperada: 1, dados: { status: 'Em reparo' },
        status: 'pendente', tentativas: 0, criadoEm: '2026-07-17T10:01:00Z'
      }
    ];
    const ordem = [];
    const estados = new Map(fila.map((item) => [item.id, Object.assign({}, item)]));
    global.localStorage = localStorageFalso();
    Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true });
    global.SistemaOSSessao = {
      obterEstado() { return { tipo: 'autenticado', usuario: { id: 'usuario-a' }, contexto: { empresa_id: 'empresa-a', usuario_id: 'usuario-a' } }; },
      async revalidar() { ordem.push('validar'); return this.obterEstado(); }
    };
    global.SistemaOSPermissoes = { obterContexto() { return { empresa_id: 'empresa-a', usuario_id: 'usuario-a' }; } };
    global.SupabaseClientApp = {
      obterCliente() { return { async rpc(nome) {
        assert.equal(nome, 'registrar_heartbeat');
        return { data: { id: 'device-a' }, error: null };
      } }; }
    };
    global.SistemaOSSupabaseOS = {
      _dadosParaCriacao(d) { return d; },
      _patchParaServidor(p) { return p; },
      _classificarErro(e) { return e.tipo || 'servidor'; },
      async criar() { ordem.push('criar'); return { id: 'os-1', numero: 'OS-0001', revision: 1 }; },
      async atualizar() { ordem.push('atualizar'); return { id: 'os-2', numero: 'OS-0002', revision: 2 }; }
    };
    global.SistemaOSHistorico = {
      async enfileirarOperacaoNuvem(item) { return item; },
      async listarOperacoesNuvemPendentes() { return fila; },
      async atualizarOperacaoNuvem(id, patch) {
        estados.set(id, Object.assign({}, estados.get(id), patch));
        return estados.get(id);
      },
      async gravarEstadoSupabase(id, remoto) { ordem.push('local:' + id + ':' + remoto.numero); }
    };
    const sync = recarregar(caminhoSync);
    const resultado = await sync.processarFila();
    assert.equal(resultado.enviados, 2);
    assert.deepEqual(ordem, ['validar', 'criar', 'local:hist-1:OS-0001', 'atualizar']);
    assert.equal(estados.get('os:create:1').status, 'concluido');
    assert.equal(estados.get('os:update:2:1').status, 'concluido');
  });

  await teste('retry conserva conflito na fila e não deixa operação posterior ultrapassar', async () => {
    const fila = [
      { id: 'u1', empresaId: 'empresa-a', usuarioId: 'usuario-a', operacao: 'update', entidadeId: 'os-1', revisionEsperada: 1, dados: { status: 'X' }, status: 'pendente' },
      { id: 'd2', empresaId: 'empresa-a', usuarioId: 'usuario-a', operacao: 'delete', entidadeId: 'os-2', revisionEsperada: 1, dados: {}, status: 'pendente' }
    ];
    const estados = new Map(fila.map((item) => [item.id, Object.assign({}, item)]));
    let exclusaoChamada = false;
    Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true });
    global.SistemaOSSessao = {
      obterEstado() { return { tipo: 'autenticado', usuario: { id: 'usuario-a' }, contexto: { empresa_id: 'empresa-a', usuario_id: 'usuario-a' } }; },
      async revalidar() { return this.obterEstado(); }
    };
    global.SistemaOSSupabaseOS = {
      _dadosParaCriacao(d) { return d; }, _patchParaServidor(p) { return p; },
      _classificarErro(e) { return e.code === '40001' ? 'conflito' : 'servidor'; },
      async atualizar() { const erro = new Error('conflito_revision'); erro.code = '40001'; throw erro; },
      async excluir() { exclusaoChamada = true; return { id: 'os-2', revision: 2 }; }
    };
    global.SistemaOSHistorico = {
      async enfileirarOperacaoNuvem(item) { return item; },
      async listarOperacoesNuvemPendentes() { return fila; },
      async atualizarOperacaoNuvem(id, patch) {
        estados.set(id, Object.assign({}, estados.get(id), patch));
        return estados.get(id);
      }
    };
    const sync = recarregar(caminhoSync);
    const resultado = await sync.processarFila();
    assert.equal(resultado.conflitos, 1);
    assert.equal(estados.get('u1').status, 'conflito');
    assert.equal(exclusaoChamada, false);
  });

  await teste('IndexedDB preserva a operação até confirmação e grava número/revision no histórico', async () => {
    const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'outside-only', url: 'https://etapa5.local/' });
    dom.window.indexedDB = indexedDB;
    dom.window.IdExportacao = { gerar() { return 'id-historico-1'; } };
    dom.window.eval(fs.readFileSync(path.join(raiz, 'www/js/historico.js'), 'utf8'));
    const historico = dom.window.SistemaOSHistorico;
    const registro = await historico.salvar({ cliente: { nome: 'Ana' } }, 'os');
    await historico.enfileirarOperacaoNuvem({
      id: 'persistente-1', entidade: 'ordem_servico', operacao: 'insert',
      idExportacao: 'id-historico-1', dados: {}, status: 'pendente'
    });
    assert.equal((await historico.listarOperacoesNuvemPendentes()).length, 1);
    await historico.atualizarOperacaoNuvem('persistente-1', { status: 'concluido' });
    assert.equal((await historico.listarOperacoesNuvem()).length, 1);
    assert.equal((await historico.listarOperacoesNuvemPendentes()).length, 0);
    await historico.gravarEstadoSupabase(registro.id, { id: 'os-remota', numero: 'OS-0008', revision: 3 });
    const atualizado = await historico.obterPorId(registro.id);
    assert.equal(atualizado.supabaseId, 'os-remota');
    assert.equal(atualizado.numeroOSAtribuido, 'OS-0008');
    assert.equal(atualizado.os.numero, 'OS-0008', 'o numero oficial precisa entrar tambem nos dados usados pelo comprovante');
    assert.equal(atualizado.supabaseRevision, 3);
    assert.equal(atualizado.sincronizadoComPC, true);
    let backupGerado = null;
    dom.window.SistemaOSCompartilhar = {
      async compartilharOuBaixarArquivo(conteudo) { backupGerado = conteudo; return { sucesso: true }; }
    };
    dom.window.eval(fs.readFileSync(path.join(raiz, 'www/js/backup.js'), 'utf8'));
    await dom.window.SistemaOSBackup.exportarBackupCompleto();
    assert.equal(backupGerado.versao, 2);
    assert.equal(backupGerado.operacoesNuvem.length, 1);
    assert.equal(backupGerado.operacoesNuvem[0].status, 'concluido');
    dom.window.close();
  });

  await teste('fila nao repete envio recente ao reabrir e recupera somente envio travado', async () => {
    const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'outside-only', url: 'https://etapa5-fila.local/' });
    dom.window.indexedDB = indexedDB;
    dom.window.IdExportacao = { gerar() { return 'id-fila-protegida'; } };
    dom.window.eval(fs.readFileSync(path.join(raiz, 'www/js/historico.js'), 'utf8'));
    const historico = dom.window.SistemaOSHistorico;

    await historico.enfileirarOperacaoNuvem({ id: 'envio-recente', entidade: 'ordem_servico', operacao: 'update', dados: {} });
    await historico.atualizarOperacaoNuvem('envio-recente', {
      status: 'enviando', ultimaTentativaEm: new Date().toISOString()
    });
    await historico.enfileirarOperacaoNuvem({ id: 'envio-travado', entidade: 'ordem_servico', operacao: 'update', dados: {} });
    await historico.atualizarOperacaoNuvem('envio-travado', {
      status: 'enviando', ultimaTentativaEm: new Date(Date.now() - (6 * 60 * 1000)).toISOString()
    });

    const idsPendentes = (await historico.listarOperacoesNuvemPendentes()).map((item) => item.id);
    assert.equal(idsPendentes.includes('envio-recente'), false);
    assert.equal(idsPendentes.includes('envio-travado'), true);
    dom.window.close();
  });

  await teste('assinatura feita sem servidor permanece na fila duravel do Android', async () => {
    const fila = [];
    Object.defineProperty(global, 'navigator', { value: { onLine: false }, configurable: true });
    global.SistemaOSSessao = {
      obterEstado() {
        return { tipo: 'offline_com_sessao', usuario: { id: 'usuario-a' }, contexto: { empresa_id: 'empresa-a', usuario_id: 'usuario-a' } };
      },
      ehErroRede() { return true; }
    };
    global.SistemaOSSupabaseOS = {
      _classificarErro() { return 'rede'; }, _dadosParaCriacao(d) { return d; }, _patchParaServidor(p) { return p; }
    };
    global.SistemaOSHistorico = {
      async enfileirarOperacaoNuvem(item) { fila.push(item); return item; },
      async atualizarOperacaoNuvem() { return null; }
    };
    const sync = recarregar(caminhoSync);
    const resultado = await sync.enviarRespostaAssinatura(
      'envio-assinatura-offline',
      { tipoArquivo: 'sistema-os-pc-para-assinar-resposta', tipoDocumento: 'os', assinaturaClienteBase64: 'data:image/png;base64,QQ==' },
      'doc-local-1'
    );
    assert.equal(resultado.enfileirado, true);
    assert.equal(fila.length, 1);
    assert.equal(fila[0].entidade, 'assinatura_remota');
    assert.equal(fila[0].registroLocalId, 'doc-local-1');
  });

  await teste('fila de assinatura so marca enviada depois da confirmacao do PostgreSQL', async () => {
    const item = {
      id: 'assinatura-remota:responder:envio-1', empresaId: 'empresa-a', usuarioId: 'usuario-a',
      entidade: 'assinatura_remota', operacao: 'responder', entidadeId: 'envio-1',
      registroLocalId: 'doc-local-1', dados: { idEnvioAssinatura: 'envio-1', resposta: { tipoDocumento: 'os' } },
      status: 'pendente', tentativas: 0, criadoEm: '2026-09-09T10:00:00Z'
    };
    let estadoOperacao = Object.assign({}, item);
    let documento = { id: 'doc-local-1', statusLocal: 'assinado' };
    Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true });
    global.SistemaOSSessao = {
      obterEstado() { return { tipo: 'autenticado', usuario: { id: 'usuario-a' }, contexto: { empresa_id: 'empresa-a', usuario_id: 'usuario-a' } }; },
      async revalidar() { return this.obterEstado(); },
      ehErroRede() { return false; }
    };
    global.SistemaOSSupabaseOS = {
      _classificarErro() { return 'servidor'; }, _dadosParaCriacao(d) { return d; }, _patchParaServidor(p) { return p; }
    };
    global.SupabaseClientApp = {
      obterCliente() {
        return { functions: { async invoke(nome, opcoes) {
          assert.equal(nome, 'assinaturas-remotas');
          assert.equal(opcoes.body.acao, 'responder');
          return { data: { sucesso: true }, error: null };
        } } };
      }
    };
    global.SistemaOSHistorico = {
      async enfileirarOperacaoNuvem(x) { return x; },
      async listarOperacoesNuvemPendentes() { return estadoOperacao.status === 'pendente' ? [estadoOperacao] : []; },
      async atualizarOperacaoNuvem(id, patch) { estadoOperacao = Object.assign({}, estadoOperacao, patch); return estadoOperacao; },
      async obterDocumentoRecebidoPorId() { return Object.assign({}, documento); },
      async salvarDocumentoRecebido(doc) { documento = Object.assign({}, doc); return documento; }
    };
    const sync = recarregar(caminhoSync);
    const resultado = await sync.processarFila();
    assert.equal(resultado.enviados, 1);
    assert.equal(estadoOperacao.status, 'concluido');
    assert.equal(documento.statusLocal, 'enviado');
    assert.ok(documento.enviadoAoPostgresqlEm);
  });

  await teste('CloudData atualiza apenas registros com referência válida no Supabase', async () => {
    let supabaseAtualizou = 0;
    global.SupabaseClientApp = { carregarConfiguracao() { return { ok: true, ativo: true }; } };
    global.SistemaOSPermissoes = { obterContexto() { return { feature_flags: { cloudProvider: 'supabase' } }; } };
    global.SistemaOSSupabaseSync = {
      async atualizarOS() { supabaseAtualizou += 1; return { enviado: true, origem: 'supabase' }; }
    };
    const cloudData = recarregar(caminhoCloudData);
    await cloudData.atualizarOS({ id: 'os-1', numero: 'OS-0001', revision: 2 }, 2, { status: 'Em reparo' });
    const semReferencia = await cloudData.atualizarOS({ numero: 'OS-0099' }, null, { status: 'Em reparo' });
    assert.equal(supabaseAtualizou, 1);
    assert.equal(semReferencia.enviado, false);
    assert.equal(semReferencia.motivo, 'referencia-invalida');
  });

  await teste('operacoes identicas compartilham a mesma chamada em andamento', async () => {
    const fonteSync = fs.readFileSync(caminhoSync, 'utf8');
    assert.match(fonteSync, /operacoesEmVoo\[chave\]/);
    assert.match(fonteSync, /if \(operacoesEmVoo\[chave\]\) return operacoesEmVoo\[chave\]/);
    assert.match(fonteSync, /delete operacoesEmVoo\[chave\]/);
  });

  console.log('\n' + total + ' testes da Etapa 5 passaram.');
}

executar().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
