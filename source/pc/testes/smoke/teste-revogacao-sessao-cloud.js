'use strict';
// Fixture sem Electron, contas reais, arquivos de cliente ou rede.
const assert = require('node:assert/strict');
const { DesktopSupabaseRuntime } = require('../../src/supabase/desktop-runtime');
const { CompanyCloudService } = require('../../src/supabase/company-cloud-service');

(async () => {
  const callbacks = [];
  const opcoes = [];
  const cofre = new Map();
  const runtime = new DesktopSupabaseRuntime();
  runtime.sessionStore = {
    getItem: k => cofre.get(k), setItem: (k, v) => cofre.set(k, v), removeItem: k => cofre.delete(k),
    obterContaRapida: () => null
  };
  let resolverContexto;
  runtime.createClient = (_url, _key, cfg) => {
    opcoes.push(cfg);
    return { auth: { onAuthStateChange(cb) { callbacks.push(cb); return { data: { subscription: { unsubscribe() {} } } }; } },
      rpc: () => new Promise(resolve => { resolverContexto = resolve; }) };
  };
  runtime.client = runtime._criarCliente({ url: 'https://dummy.invalid', anonKey: 'dummy-public' });
  runtime.usuario = { id: 'usuario-a', empresaId: 'empresa-a' };
  runtime.contexto = { empresa_id: 'empresa-a' };
  runtime.ultimoStatus = { autenticado: true };
  const carga = runtime._carregarContexto({ id: 'usuario-a' });
  callbacks[0]('SIGNED_OUT', null);
  assert.equal(runtime.usuario, null);
  assert.equal(runtime.contexto, null);
  assert.equal(runtime.status().autenticado, false);
  resolverContexto({ data: [{ empresa_id: 'empresa-a', usuario_ativo: true }], error: null });
  await assert.rejects(carga, { code: 'SESSAO_ALTERADA' });
  assert.equal(runtime.usuario, null, 'RPC antiga não pode ressuscitar autoridade');
  opcoes[0].auth.storage.setItem('nova-sessao', 'dummy');
  assert.equal(cofre.get('nova-sessao'), 'dummy', 'novo login ainda deve poder persistir');

  runtime.client = runtime._criarCliente({ url: 'https://dummy.invalid', anonKey: 'dummy-public' });
  runtime.usuario = { id: 'usuario-b', empresaId: 'empresa-b' };
  runtime.contexto = { empresa_id: 'empresa-b' };
  callbacks[0]('SIGNED_OUT', null);
  assert.equal(runtime.usuario.id, 'usuario-b', 'callback antigo não pode derrubar nova conta');
  callbacks[1]('TOKEN_REFRESHED', { user: { id: 'usuario-b' }, access_token: 'dummy', refresh_token: 'dummy' });
  assert.equal(runtime.usuario.id, 'usuario-b', 'refresh normal preserva autoridade e offline');
  callbacks[1]('SIGNED_OUT', null);
  assert.equal(runtime.usuario, null);

  let geracao = 1;
  let contexto = { empresa_id: 'empresa-b', usuario_id: 'usuario-b', cargo: 'tecnico' };
  let resolverIdentidade;
  let gravacoes = 0;
  const cliente = { from: () => ({ select() { return this; }, eq() { return this; },
    maybeSingle: () => new Promise(resolve => { resolverIdentidade = resolve; }) }) };
  const empresa = new CompanyCloudService({ getContext: () => contexto, getClient: () => cliente,
    getGeneration: () => geracao, db: { getRootDir: () => contexto.empresa_id, salvarConfig: () => { gravacoes++; } },
    stateStore: { alterar: () => { gravacoes++; } } });
  const sincronizacao = empresa.sincronizarConfiguracaoCompartilhada();
  contexto = { empresa_id: 'empresa-a', usuario_id: 'usuario-a', cargo: 'tecnico' }; geracao++;
  resolverIdentidade({ data: { configuracoes: { identidadeEmpresa: { configMobile: { nomeEmpresa: 'EMPRESA-B' } } } } });
  await assert.rejects(sincronizacao, { code: 'SESSAO_ALTERADA' });
  assert.equal(gravacoes, 0, 'config antiga após timeout não pode escrever no escopo restaurado');

  const semSessao = new DesktopSupabaseRuntime();
  let concluirSaida;
  semSessao.client = { auth: { getSession: async () => ({ data: {} }),
    signOut: () => new Promise(resolve => { concluirSaida = resolve; }) },
    functions: { invoke: async () => ({ error: new Error('credenciais inválidas') }) } };
  const loginFalhou = semSessao.login('dummy', 'dummy', 'dummy');
  for (let n = 0; n < 20 && !concluirSaida; n++) await Promise.resolve();
  assert.ok(concluirSaida);
  semSessao.client = { auth: {} };
  semSessao.geracaoAutenticacao++;
  semSessao.usuario = { id: 'nova-conta' };
  semSessao.contexto = { empresa_id: 'nova-empresa' };
  concluirSaida({});
  await loginFalhou;
  assert.equal(semSessao.usuario.id, 'nova-conta', 'catch antigo não pode apagar a nova identidade');

  const divergente = new DesktopSupabaseRuntime();
  divergente.sessionStore = { setItem: (k, v) => cofre.set(k, v) };
  divergente.contaTrocaEsperadaId = 'conta-escolhida';
  divergente.client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'outra-conta' } } } }),
    signOut: async () => { divergente._invalidarAutenticacao(); } } };
  const restauracao = await divergente._restaurarSessaoInterna();
  assert.equal(restauracao.codigo, 'conta_divergente');
  assert.equal(divergente.contaTrocaEsperadaId, '');
  assert.equal(JSON.parse(cofre.get('__sistema_os_troca_conta_erro_v1__')).contaId, 'conta-escolhida');
  console.log('OK: revogação cloud remove autoridade e descarta contexto tardio.');
})().catch(erro => { console.error(erro); process.exitCode = 1; });
