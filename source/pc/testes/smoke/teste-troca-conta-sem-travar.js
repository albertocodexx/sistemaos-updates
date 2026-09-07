'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DesktopSupabaseRuntime } = require('../../src/supabase/desktop-runtime');
const { registerSupabaseHandlers } = require('../../src/ipc/supabase-handlers');
const id = '5cae39cc-2cf1-47db-9332-67cf241ca443';
const chave = 'sb-projeto-auth-token';
const pendente = '__sistema_os_troca_conta_pendente_v1__';
const erroPendente = '__sistema_os_troca_conta_erro_v1__';
const cfg = { url: 'https://projeto.supabase.co', anonKey: 'chave-publica-teste' };
function sessao(uid = id, refresh = 'refresh-novo', exp = Math.floor(Date.now() / 1000) + 3600) {
  const b64 = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const access = [b64({ alg: 'HS256' }), b64({ sub: uid, exp, aud: 'authenticated', role: 'authenticated' }), 'teste'].join('.');
  return { access_token: access, refresh_token: refresh, expires_at: exp, expires_in: 3600,
    token_type: 'bearer', user: { id: uid, aud: 'authenticated', user_metadata: { usuario: 'usuario-teste' } } };
}
function fixture() {
  const runtime = new DesktopSupabaseRuntime();
  const dados = new Map([[chave, JSON.stringify(sessao('suporte', 'refresh-suporte'))]]);
  const contas = new Map([[id, { id, empresaCodigo: 'empresa-teste', empresaId: 'empresa-a', usuario: 'usuario-teste',
    accessToken: sessao(id, '', 1).access_token, refreshToken: 'refresh-antigo' }]]);
  const eventos = [];
  runtime.sessionStore = {
    getItem: (k) => dados.get(k) || null, setItem: (k, v) => dados.set(k, v), removeItem: (k) => dados.delete(k),
    obterContaRapida: (uid) => contas.get(uid), listarContasRapidas: () => [...contas.values()],
    salvarContaRapida: (conta) => contas.set(conta.id, { ...conta }),
    persistenciaCriptografadaDisponivel: () => true
  };
  runtime._configValida = () => cfg;
  runtime.createClient = (_url, _key, opts) => ({ auth: {
    storageKey: chave,
    onAuthStateChange: (fn) => { eventos.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    stopAutoRefresh: () => new Promise(() => {}),
    gravarAtrasado: () => opts.auth.storage.setItem(chave, JSON.stringify(sessao('suporte'))),
    getSession: async () => ({ data: { session: JSON.parse(dados.get(chave) || 'null') } })
  } });
  runtime.client = runtime._criarCliente(cfg);
  runtime.parar = () => {};
  runtime.fetchImpl = async () => ({ ok: true, status: 200, json: async () => sessao() });
  return { runtime, dados, contas, eventos };
}
(async () => {
  // Reproduz a causa original: Auth renova, mas o cartão continua antigo.
  const f = fixture();
  f.runtime.contexto = { empresa_id: 'outra-empresa' };
  assert.equal(f.eventos[0]('TOKEN_REFRESHED', sessao()), undefined, 'callback síncrono, sem chamadas ao Auth');
  assert.equal(f.contas.get(id).refreshToken, 'refresh-novo');
  assert.equal(f.contas.get(id).empresaId, 'empresa-a', 'não misturar metadados');
  f.eventos[0]('TOKEN_REFRESHED', sessao('nao-salvo'));
  assert.equal(f.contas.size, 1);
  f.eventos[0]('TOKEN_REFRESHED', sessao(id, 'refresh-mais-recente'));
  f.runtime.fetchImpl = async (_url, opcoes) => {
    assert.equal(JSON.parse(opcoes.body).refresh_token, 'refresh-mais-recente');
    return { ok: true, status: 200, json: async () => sessao(id, 'refresh-validado') };
  };
  const resposta = await f.runtime.trocarContaRapida(id);
  assert.equal(resposta.sucesso, true);
  assert.equal(resposta.reiniciarAplicacao, true);
  assert.equal(f.contas.get(id).refreshToken, 'refresh-validado');
  f.runtime.client.auth.gravarAtrasado();
  f.eventos[0]('TOKEN_REFRESHED', sessao(id, 'refresh-atrasado'));
  assert.equal(JSON.parse(f.dados.get(chave)).user.id, id);
  assert.equal(f.contas.get(id).refreshToken, 'refresh-validado');
  f.runtime.fetchImpl = () => { throw new Error('boot não deve renovar duas vezes'); };
  assert.equal(await f.runtime._prepararTrocaContaPendente(cfg), true);
  assert.equal(f.dados.has(pendente), false);

  for (const caso of [
    { status: 400, body: { error_code: 'refresh_token_already_used' }, requerSenha: true },
    { status: 400, body: { error_code: 'refresh_token_not_found' }, requerSenha: true },
    { status: 503, body: {}, requerSenha: false },
    { status: 429, body: {}, requerSenha: false },
    { status: 200, body: sessao('usuario-errado'), requerSenha: false },
    { status: 200, body: {}, requerSenha: false }
  ]) {
    const g = fixture();
    const anterior = g.dados.get(chave);
    g.runtime.fetchImpl = async () => ({ status: caso.status, ok: caso.status === 200, json: async () => caso.body });
    const falha = await g.runtime.trocarContaRapida(id);
    assert.equal(falha.sucesso, false);
    assert.equal(falha.requerSenha, caso.requerSenha);
    assert.equal(falha.reiniciarAplicacao, undefined);
    assert.equal(g.dados.get(chave), anterior);
    assert.equal(g.dados.has(pendente), false);
    assert.equal(g.runtime.escritaSessao.permitida, true);
    if (caso.requerSenha) {
      g.runtime.fetchImpl = () => { throw new Error('não reutilizar token revogado'); };
      assert.equal((await g.runtime.trocarContaRapida(id)).requerSenha, true);
    }
  }
  const rede = fixture();
  rede.runtime.fetchImpl = async () => { throw new TypeError('fetch failed'); };
  assert.match((await rede.runtime.trocarContaRapida(id)).erro, /internet/);
  const lento = fixture();
  lento.runtime.fetchImpl = () => new Promise(() => {});
  const inicio = Date.now();
  assert.match((await lento.runtime.trocarContaRapida(id)).erro, /demorou/);
  assert.ok(Date.now() - inicio < 10000);
  assert.equal(lento.dados.has(pendente), false);

  const longa = fixture();
  longa.runtime.contexto = { empresa_id: 'empresa-a', recursos_habilitados: { troca_rapida_contas: true } };
  longa.dados.set(chave, JSON.stringify(sessao(id, 'refresh-apos-carregar')));
  await longa.runtime._salvarContaRapida(sessao(id, 'refresh-antes-carregar'), 'empresa-teste', 'usuario-teste');
  assert.equal(longa.contas.get(id).refreshToken, 'refresh-apos-carregar');

  const boot = fixture();
  boot.dados.set(chave, JSON.stringify(sessao()));
  let carregar = 0;
  boot.runtime._carregarContexto = async () => {
    carregar++;
    boot.runtime.contexto = { empresa_id: 'empresa-a' };
    boot.runtime.usuario = { id };
    await new Promise((resolve) => setTimeout(resolve, 20));
    return boot.runtime.usuario;
  };
  const restauracoes = await Promise.all([boot.runtime.restaurarSessao(), boot.runtime.restaurarSessao()]);
  assert.equal(carregar, 1);
  assert.ok(restauracoes.every((r) => r.sucesso));
  const falhaBoot = fixture();
  falhaBoot.runtime.contaTrocaEsperadaId = id;
  falhaBoot.dados.delete(chave);
  assert.equal((await falhaBoot.runtime.restaurarSessao()).sucesso, false);
  assert.equal(JSON.parse(falhaBoot.dados.get(erroPendente)).contaId, id);

  // Executar a função real do renderer: mensagem visível mesmo com o status
  // de configurações presente, mas oculto na tela de login.
  const textoUI = fs.readFileSync(path.join(__dirname, '../../renderer/core/legacy-runtime.js'), 'utf8');
  const fonteUI = textoUI.slice(textoUI.indexOf('let _trocaContaRapidaEmAndamento = false;'), textoUI.indexOf('// Confirma visualmente o retorno automático'));
  const campos = Object.fromEntries(['loginEmpresa', 'loginUsuario', 'loginSenha', 'statusContasRapidas'].map((k) => [k, { value: '', textContent: '', focus() { this.focado = true; } }]));
  let mensagem = '';
  let chamadasInterface = 0;
  const ui = vm.createContext({ usuarioAtual: null, $: (k) => campos[k],
    window: { api: { supabasetrocarcontarapida: async () => { chamadasInterface++; return { sucesso: false, requerSenha: true, erro: 'Digite a senha.' }; } } },
    aguardarLoginComLimite: (p) => p, mensagemErroAmigavel: (e) => e.message,
    _mostrarErroLogin: (msg) => { mensagem = msg; } });
  vm.runInContext(fonteUI, ui);
  const botao = { textContent: 'Entrar', disabled: false };
  await ui.trocarContaRapidaUI(id, botao, { empresaCodigo: 'empresa-teste', usuario: 'usuario-teste' });
  assert.equal(mensagem, 'Digite a senha.');
  assert.equal(campos.statusContasRapidas.textContent, '');
  assert.equal(campos.loginEmpresa.value, 'empresa-teste');
  assert.equal(campos.loginUsuario.value, 'usuario-teste');
  assert.equal(campos.loginSenha.focado, true);
  assert.equal(botao.textContent, 'Entrar com senha');
  assert.equal(botao.disabled, false);
  assert.equal(chamadasInterface, 1);
  mensagem = '';
  campos.loginSenha.focado = false;
  await ui.trocarContaRapidaUI(id, botao, { empresaCodigo: 'empresa-teste', usuario: 'usuario-teste', requerSenha: true });
  assert.equal(chamadasInterface, 1, 'conta já expirada não deve chamar IPC/rede novamente');
  assert.match(mensagem, /sessão salva expirou/i);
  assert.equal(campos.loginSenha.focado, true);
  assert.equal(botao.textContent, 'Entrar com senha');

  const handlers = {};
  let reinicios = 0;
  registerSupabaseHandlers({ ipcMain: { handle: (k, fn) => { handlers[k] = fn; } },
    supabaseDesktop: { trocarContaRapida: async () => ({ sucesso: false, requerSenha: true }) },
    app: { relaunch: () => reinicios++, quit: () => reinicios++ } });
  await handlers['supabase:trocarContaRapida']({}, id);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(reinicios, 0);

  // SDK instalado de verdade, HTTP simulado e nenhuma conta/dado real.
  const sdk = fixture();
  sdk.dados.set(chave, JSON.stringify(sessao(id, 'refresh-antigo', 1)));
  const { createClient } = require('@supabase/supabase-js');
  sdk.runtime.createClient = (url, key, opts) => createClient(url, key, {
    ...opts, auth: { ...opts.auth, storageKey: chave, autoRefreshToken: false },
    global: { fetch: async (url) => {
      assert.ok(String(url).includes('/auth/v1/token'));
      return new Response(JSON.stringify(sessao(id, 'refresh-sdk-real')), { status: 200, headers: { 'content-type': 'application/json' } });
    } }
  });
  sdk.runtime.client = sdk.runtime._criarCliente(cfg);
  const real = await sdk.runtime.client.auth.getSession();
  assert.equal(real.error, null);
  assert.equal(sdk.contas.get(id).refreshToken, 'refresh-sdk-real');
  sdk.runtime.assinaturaAuth.unsubscribe();
  await sdk.runtime.client.auth.stopAutoRefresh();
  console.log('OK: rotação, conta expirada, rede, isolamento, boot concorrente, erro visível e SDK real.');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
