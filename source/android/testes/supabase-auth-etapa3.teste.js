'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const raiz = path.join(__dirname, '..');

function criarStorage() {
  const dados = new Map();
  return {
    get length() { return dados.size; },
    key(indice) { return Array.from(dados.keys())[indice] || null; },
    getItem(chave) { return dados.has(chave) ? dados.get(chave) : null; },
    setItem(chave, valor) { dados.set(String(chave), String(valor)); },
    removeItem(chave) { dados.delete(String(chave)); },
    clear() { dados.clear(); }
  };
}

function jwt(papel) {
  const codificar = (objeto) => Buffer.from(JSON.stringify(objeto))
    .toString('base64url');
  return codificar({ alg: 'HS256', typ: 'JWT' }) + '.' +
    codificar({ role: papel, exp: 4102444800 }) + '.assinatura-publica';
}

async function executar() {
  let total = 0;
  function teste(nome, fn) {
    return Promise.resolve().then(fn).then(() => {
      total += 1;
      console.log('✓ ' + nome);
    });
  }

  global.localStorage = criarStorage();
  const clienteApp = require(path.join(raiz, 'www/js/supabase/supabase-client.js'));

  await teste('Supabase começa desativado e não quebra o modo legado', () => {
    assert.deepEqual(clienteApp.validarConfiguracao({ supabaseAtivo: false }), { ok: true, ativo: false });
  });

  await teste('atualização móvel ativa uma única vez o Supabase em configuração legada', () => {
    const codigoConfig = fs.readFileSync(path.join(raiz, 'www/js/config.js'), 'utf8');
    const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only', url: 'https://app.local/' });
    const win = dom.window;
    win.SistemaOSPublicConfig = {
      supabaseUrl: 'https://projeto.supabase.co',
      supabasePublishableKey: jwt('anon')
    };
    win.localStorage.setItem('osapp_config_empresa_v1', JSON.stringify({
      supabaseAtivo: false,
      nomeFantasia: 'Empresa legada'
    }));
    win.eval(codigoConfig);
    const configuracao = win.ConfigApp.carregarConfig();
    assert.equal(Object.hasOwn(configuracao, 'supabaseAtivo'), false);
    assert.equal(Object.hasOwn(configuracao, 'supabaseMigracaoVersao'), false);
    assert.equal(configuracao.nomeFantasia, 'Empresa legada');
    var salvo = JSON.parse(win.localStorage.getItem('osapp_config_empresa_v1'));
    assert.equal(Object.hasOwn(salvo, 'supabaseAtivo'), false);
    dom.window.close();
  });

  await teste('aceita URL HTTPS e chave anon pública', () => {
    const validacao = clienteApp.validarConfiguracao({
      supabaseAtivo: true,
      supabaseUrl: 'https://projeto.supabase.co/',
      supabasePublishableKey: jwt('anon')
    });
    assert.equal(validacao.ok, true);
    assert.equal(validacao.url, 'https://projeto.supabase.co');
  });

  await teste('recusa HTTP externo e chaves secret/service_role', () => {
    assert.equal(clienteApp.validarConfiguracao({
      supabaseAtivo: true,
      supabaseUrl: 'http://projeto.supabase.co',
      supabasePublishableKey: jwt('anon')
    }).ok, false);
    assert.equal(clienteApp.validarConfiguracao({
      supabaseAtivo: true,
      supabaseUrl: 'https://projeto.supabase.co',
      supabasePublishableKey: 'sb_secret_esta-chave-nao-pode-entrar-no-apk'
    }).ok, false);
    assert.equal(clienteApp.validarConfiguracao({
      supabaseAtivo: true,
      supabaseUrl: 'https://projeto.supabase.co',
      supabasePublishableKey: jwt('service_role')
    }).ok, false);
  });

  const empresaService = require(path.join(raiz, 'www/js/supabase/empresa-service.js'));
  const base = {
    usuario_id: 'usuario-a',
    usuario_ativo: true,
    empresa_id: 'empresa-a',
    empresa_ativa: true,
    licenca_status: 'ativa',
    licenca_expira_em: '2099-01-01T00:00:00.000Z',
    permissoes: {}
  };

  await teste('classifica usuário, empresa e licença bloqueados separadamente', () => {
    assert.equal(empresaService.validarContexto({ ...base, usuario_ativo: false }, 'usuario-a').estado, 'usuario_bloqueado');
    assert.equal(empresaService.validarContexto({ ...base, empresa_ativa: false }, 'usuario-a').estado, 'empresa_bloqueada');
    assert.equal(empresaService.validarContexto({ ...base, licenca_status: 'vencida' }, 'usuario-a').estado, 'cobranca');
    assert.equal(empresaService.validarContexto({ ...base, licenca_status: 'suspensa' }, 'usuario-a').estado, 'licenca_vencida');
    assert.equal(empresaService.validarContexto(base, 'outro-usuario').estado, 'usuario_bloqueado');
  });

  await teste('teste de conexão usa o health check sem consultar tabelas', async () => {
    global.SupabaseClientApp = clienteApp;
    let chamada;
    global.fetch = async (url, opcoes) => {
      chamada = { url, opcoes };
      return { ok: true, status: 200 };
    };
    const resultado = await empresaService.testarConexao({
      url: 'https://projeto.supabase.co',
      publishableKey: jwt('anon')
    });
    assert.equal(resultado.ok, true);
    assert.equal(chamada.url, 'https://projeto.supabase.co/auth/v1/health');
    assert.equal(chamada.opcoes.headers.apikey, jwt('anon'));
    assert.ok(chamada.opcoes.signal, 'teste de conexão deve poder cancelar servidor travado');
  });

  await teste('envia empresa, usuário e senha somente para o endpoint de login', async () => {
    let corpo;
    let sessaoDefinida;
    global.SupabaseClientApp = {
      obterCliente() {
        return {
          functions: { async invoke(nome, opcoes) {
            assert.equal(nome, 'auth-login');
            corpo = opcoes.body;
            return { data: { access_token: 'access', refresh_token: 'refresh' }, error: null };
          } },
          auth: { async setSession(valor) {
            sessaoDefinida = valor;
            return { data: { session: { user: { id: 'usuario-a' } } }, error: null };
          } }
        };
      }
    };
    delete require.cache[require.resolve(path.join(raiz, 'www/js/supabase/auth-service.js'))];
    const auth = require(path.join(raiz, 'www/js/supabase/auth-service.js'));
    await auth.entrar(' Minha-Empresa ', ' USUARIO ', 'senha-temporaria');
    assert.deepEqual(corpo, { empresa: 'Minha-Empresa', usuario: 'USUARIO', senha: 'senha-temporaria' });
    assert.deepEqual(sessaoDefinida, { access_token: 'access', refresh_token: 'refresh' });
    assert.equal(global.localStorage.length, 0);
  });

  await teste('login inválido extrai a mensagem pública e esconde o erro técnico da Edge Function', async () => {
    global.SupabaseClientApp = {
      obterCliente() {
        return {
          functions: { async invoke() {
            return {
              data: null,
              error: {
                message: 'Edge Function returned a non-2xx status code',
                context: { clone: () => ({ json: async () => ({ erro: 'Credenciais inválidas.' }) }) }
              }
            };
          } },
          auth: { async setSession() { throw new Error('não deveria iniciar sessão'); } }
        };
      }
    };
    delete require.cache[require.resolve(path.join(raiz, 'www/js/supabase/auth-service.js'))];
    const auth = require(path.join(raiz, 'www/js/supabase/auth-service.js'));
    await assert.rejects(() => auth.entrar('aet', 'admin', 'incorreta'), /Credenciais inválidas/);
  });

  await teste('não mantém aliases ou e-mail técnico no APK', async () => {
    global.SistemaOSPublicConfig = {};
    let corpo;
    global.SupabaseClientApp = {
      obterCliente() {
        return {
          functions: { async invoke(_nome, opcoes) {
            corpo = opcoes.body;
            return { data: { access_token: 'access', refresh_token: 'refresh' }, error: null };
          } },
          auth: { async setSession() { return { data: { session: {} }, error: null }; } }
        };
      }
    };
    delete require.cache[require.resolve(path.join(raiz, 'www/js/supabase/auth-service.js'))];
    const auth = require(path.join(raiz, 'www/js/supabase/auth-service.js'));
    await auth.entrar('aet', 'admin', 'senha-temporaria');
    assert.deepEqual(corpo, { empresa: 'aet', usuario: 'admin', senha: 'senha-temporaria' });
  });

  await teste('sessão online válida cria cache e libera modo offline por até 3 dias', async () => {
    global.SupabaseClientApp = clienteApp;
    global.SistemaOSEmpresaService = empresaService;
    global.SistemaOSPermissoes = require(path.join(raiz, 'www/js/auth/permissoes.js'));
    global.SistemaOSAuthService = {
      async obterUsuario() { return { id: 'usuario-a', email: 'a@empresa.com' }; },
      async obterSessao() { return { user: { id: 'usuario-a', email: 'a@empresa.com' } }; }
    };
    delete require.cache[require.resolve(path.join(raiz, 'www/js/auth/sessao.js'))];
    const sessao = require(path.join(raiz, 'www/js/auth/sessao.js'));
    empresaService.carregarContexto = async () => ({ ...base });
    let estado = await sessao.validarSessao({ user: { id: 'usuario-a', email: 'a@empresa.com' } });
    assert.equal(estado.tipo, 'autenticado');

    global.SistemaOSAuthService.obterUsuario = async () => { throw new TypeError('Failed to fetch'); };
    estado = await sessao.validarSessao({ user: { id: 'usuario-a', email: 'a@empresa.com' } });
    assert.equal(estado.tipo, 'offline_com_sessao');
    assert.equal(global.SistemaOSPermissoes.obterContexto().empresa_id, 'empresa-a');
  });

  await teste('retomar o app autenticado nao exibe novamente a tela de carregamento', () => {
    const codigoSessao = fs.readFileSync(path.join(raiz, 'www/js/auth/sessao.js'), 'utf8');
    assert.match(codigoSessao, /appJaVisivel = estadoAtual\.tipo === 'autenticado'/);
    assert.match(codigoSessao, /mostrarCarregamento !== false && !appJaVisivel/);
  });

  await teste('cache offline vencido não libera as telas', async () => {
    const cache = global.SistemaOSSessao.lerCache('usuario-a', Date.now() + global.SistemaOSSessao.LIMITE_OFFLINE_MS + 1);
    assert.equal(cache, null);
  });

  await teste('rejeição temporária de JWT conserva a sessão local e não força logout', async () => {
    let saiu = 0;
    global.SistemaOSAuthService.obterUsuario = async () => {
      const erro = new Error('JWT expired');
      erro.status = 401;
      throw erro;
    };
    delete global.SistemaOSAuthService.renovarSessao;
    global.SistemaOSAuthService.sair = async () => { saiu += 1; };
    const estado = await global.SistemaOSSessao.validarSessao({ user: { id: 'usuario-a' } });
    assert.equal(estado.tipo, 'offline_com_sessao');
    assert.equal(saiu, 0);
    assert.ok(global.SistemaOSSessao.lerCache('usuario-a'));
  });

  await teste('refresh token realmente inválido encerra a sessão e limpa o cache', async () => {
    let saiu = 0;
    global.SistemaOSAuthService.obterUsuario = async () => {
      const erro = new Error('JWT rejected');
      erro.status = 401;
      throw erro;
    };
    global.SistemaOSAuthService.renovarSessao = async () => {
      const erro = new Error('refresh token invalid');
      erro.code = 'invalid_refresh_token';
      throw erro;
    };
    global.SistemaOSAuthService.sair = async () => { saiu += 1; };
    const estado = await global.SistemaOSSessao.validarSessao({ user: { id: 'usuario-a' } });
    assert.equal(estado.tipo, 'deslogado');
    assert.equal(saiu, 1);
    assert.equal(global.SistemaOSSessao.lerCache('usuario-a'), null);
  });

  await teste('gate visual esconde telas sem sessão e libera após autenticação', () => {
    const html = fs.readFileSync(path.join(raiz, 'www/index.html'), 'utf8');
    const codigoTela = fs.readFileSync(path.join(raiz, 'www/js/auth/login-tela.js'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://app.local/' });
    const win = dom.window;
    let estado = { tipo: 'deslogado', mensagem: '' };
    win.SistemaOSSessao = {
      obterEstado() { return estado; },
      async validarSessao() {}, async revalidar() {}, async sair() {}
    };
    win.SistemaOSAuthService = {
      async entrar() {}, async recuperarSenha() {}, async atualizarSenha() {}
    };
    win.ConfigApp = { carregarConfig() { return {}; }, salvarConfig() {} };
    win.SupabaseClientApp = { validarConfiguracao() { return { ok: true }; } };
    win.eval(codigoTela);
    assert.equal(win.document.getElementById('form-login').hidden, false);
    assert.equal(win.document.getElementById('app-conteudo').hidden, true);

    estado = {
      tipo: 'autenticado',
      usuario: { email: 'a@empresa.com' },
      contexto: { empresa_nome: 'Empresa A' }
    };
    win.document.dispatchEvent(new win.CustomEvent('sistema-os:sessao-alterada', { detail: estado }));
    assert.equal(win.document.getElementById('tela-login').hidden, true);
    assert.equal(win.document.getElementById('app-conteudo').hidden, false);
    const resumo = win.document.getElementById('auth-usuario-resumo').textContent;
    assert.match(resumo, /Empresa A/);
    assert.doesNotMatch(resumo, /a@empresa\.com/);
    dom.window.close();
  });

  await teste('gate visual não confunde falha técnica do servidor com senha incorreta', async () => {
    const html = fs.readFileSync(path.join(raiz, 'www/index.html'), 'utf8');
    const codigoTela = fs.readFileSync(path.join(raiz, 'www/js/auth/login-tela.js'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://app.local/' });
    const win = dom.window;
    win.SistemaOSSessao = { obterEstado() { return { tipo: 'deslogado' }; }, async validarSessao() {}, async revalidar() {}, async sair() {} };
    win.SistemaOSAuthService = { async entrar() { throw new Error('Edge Function returned a non-2xx status code'); }, async atualizarSenha() {} };
    win.ConfigApp = { carregarConfig() { return {}; }, salvarConfig() {} };
    win.SupabaseClientApp = { validarConfiguracao() { return { ok: true }; } };
    win.eval(codigoTela);
    win.document.getElementById('auth-empresa').value = 'aet';
    win.document.getElementById('auth-email').value = 'admin';
    win.document.getElementById('auth-senha').value = 'incorreta';
    win.document.getElementById('form-login').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(win.document.getElementById('auth-status').textContent, 'O serviço seguro não respondeu. Aguarde alguns instantes e tente novamente.');
    dom.window.close();
  });

  await teste('Tentar novamente recria a conexão e volta ao formulário quando não há sessão', async () => {
    const html = fs.readFileSync(path.join(raiz, 'www/index.html'), 'utf8');
    const codigoTela = fs.readFileSync(path.join(raiz, 'www/js/auth/login-tela.js'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://app.local/' });
    const win = dom.window;
    let limpouCliente = 0;
    let reconectou = 0;
    win.SistemaOSSessao = {
      obterEstado() { return { tipo: 'erro', mensagem: 'Sem conexão' }; },
      async validarSessao() {},
      async revalidar() {},
      async reconectar() { reconectou += 1; return { tipo: 'deslogado' }; },
      async sair() {}
    };
    win.SistemaOSAuthService = { async entrar() {}, async atualizarSenha() {} };
    win.SupabaseClientApp = { limparCliente() { limpouCliente += 1; } };
    win.eval(codigoTela);
    win.document.getElementById('btn-tentar-auth').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(limpouCliente, 1);
    assert.equal(reconectou, 1);
    assert.equal(win.document.getElementById('form-login').hidden, false);
    assert.match(win.document.getElementById('auth-status').textContent, /Entre novamente/);
    dom.window.close();
  });

  console.log('\n' + total + ' testes da Etapa 3 passaram.');
}

executar().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
