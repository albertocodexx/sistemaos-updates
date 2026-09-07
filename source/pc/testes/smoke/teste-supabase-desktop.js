const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DesktopStateStore } = require('../../src/supabase/desktop-state-store');
const { SecureSessionStore } = require('../../src/supabase/secure-session-store');
const { localParaSupabase } = require('../../src/supabase/os-mapper');
const { DesktopSupabaseRuntime, validarChavePublica } = require('../../src/supabase/desktop-runtime');
const publicConfig = require('../../src/supabase/public-config');
const runtimeSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'supabase', 'desktop-runtime.js'), 'utf8');

function jwt(payload) {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc(payload)}.assinatura`;
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-os-stage7-'));
  try {
    assert(/^https:\/\/[^/]+\.supabase\.co$/.test(publicConfig.url));
    assert(/^sb_publishable_/i.test(publicConfig.anonKey));
    assert(!/service_role|sb_secret_/i.test(JSON.stringify(publicConfig)));
    assert.match(runtimeSource, /auth\/v1\/settings[\s\S]{0,300}AbortSignal\.timeout\(10000\)/, 'teste de conexão não pode aguardar indefinidamente');
    assert.throws(() => validarChavePublica(jwt({ role: 'service_role' })), /service_role/);
    assert.throws(() => validarChavePublica('sb_secret_nao_pode'), /secret key/);
    assert.doesNotThrow(() => validarChavePublica(jwt({ role: 'anon' })));

    const state = new DesktopStateStore(temp);
    const osLocal = {
      numero: 'OS-0007', data: '2026-07-17T12:00:00.000Z', status: 'Em reparo',
      cliente: { nome: 'Maria', telefone: '27999999999', cpf: '123' },
      aparelho: { marca: 'Samsung', modelo: 'S23 Ultra', defeitoRelatado: 'Tela', cor: 'Preto' },
      assinaturaClienteBase64: 'data:image/png;base64,SEGREDO',
      fotos: [{ path: 'C:\\privado\\foto.jpg' }], pdfPath: 'C:\\privado\\os.pdf'
    };
    const payload = localParaSupabase(osLocal, state.obter().deviceKey);
    const serializado = JSON.stringify(payload);
    assert(!/SEGREDO|C:\\\\privado|base64|pdfPath/.test(serializado), 'payload leve não pode conter binários ou paths');

    state.enfileirarOS('insert', osLocal.numero, payload);
    state.enfileirarOS('update', osLocal.numero, payload);
    assert.strictEqual(state.obter().fila.length, 1, 'insert+update deve ser compactado');
    assert.strictEqual(state.obter().fila[0].operacao, 'insert');
    state.enfileirarOS('delete', osLocal.numero, {});
    assert.strictEqual(state.obter().fila.length, 0, 'insert local apagado antes do envio não deve chegar ao servidor');

    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (v) => Buffer.from('ENC:' + Buffer.from(v).toString('base64')),
      decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString()
    };
    const secure = new SecureSessionStore({ rootDir: temp, safeStorage });
    secure.setItem('sessao', 'refresh-token-super-secreto');
    assert.strictEqual(secure.getItem('sessao'), 'refresh-token-super-secreto');
    const disco = fs.readFileSync(path.join(temp, 'supabase-session.enc.json'), 'utf8');
    assert(!disco.includes('refresh-token-super-secreto'), 'token não pode existir em texto puro no disco');

    const banco = { ordens: { 'OS-0007': osLocal }, metadados: [] };
    const db = {
      getRootDir: () => temp,
      loadDB: () => ({ config: {} }),
      obterConfig: () => ({}),
      listarEntregas: () => [], listarGarantias: () => [],
      obterOSPorNumero: (n) => banco.ordens[n] || null,
      registrarMetadadosSupabase: (n, linha) => banco.metadados.push({ n, linha }),
      aplicarOSSupabase: () => {}, removerOSSupabase: () => {}
    };
    const chamadas = [];
    const chamadasAuth = [];
    const query = () => {
      const q = { select: () => q, eq: () => q, is: () => q, gt: () => q, gte: () => q, not: () => q, in: () => q, order: () => q, range: async () => ({data: [], error:null}), maybeSingle: async () => ({ data: null, error: null }), limit: async () => ({ data: [], error: null }) };
      return q;
    };
    const cliente = {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        setSession: async (credenciais) => {
          chamadasAuth.push({ nome: 'setSession', credenciais });
          return { data: { user: { id: 'user-1', email: 'interno@conta.local', user_metadata: { usuario: 'admin' } } }, error: null };
        },
        signOut: async () => ({ error: null }),
        resetPasswordForEmail: async (email, opcoes) => {
          chamadasAuth.push({ nome: 'resetPasswordForEmail', email, opcoes });
          return { error: null };
        },
        exchangeCodeForSession: async (codigo) => {
          chamadasAuth.push({ nome: 'exchangeCodeForSession', codigo });
          return { data: { session: { user: { id: 'user-1', email: 'admin@teste.com' } } }, error: null };
        },
        updateUser: async ({ password }) => {
          chamadasAuth.push({ nome: 'updateUser', password });
          return { data: { user: { id: 'user-1', email: 'admin@teste.com' } }, error: null };
        }
      },
      functions: {
        invoke: async (nome, opcoes) => {
          chamadasAuth.push({ nome: 'invoke', nomeFuncao: nome, opcoes });
          return { data: { access_token: 'access', refresh_token: 'refresh' }, error: null };
        }
      },
      rpc: async (nome, args) => {
        chamadas.push({ nome, args });
        if (nome === 'obter_contexto_comercial') return { data: {
          usuario_id: 'user-1', perfil_nome: 'Administrador', cargo: 'Administrador', permissoes: {},
          usuario_ativo: true, empresa_id: 'empresa-1', empresa_nome: 'Assistência Teste', empresa_ativa: true,
          licenca_status: 'ativa', data_vencimento: null, recursos_habilitados: {}, administrador_global: false
        }, error: null };
        if (nome === 'registrar_heartbeat') return { data: { id: 'device-1' }, error: null };
        if (nome === 'criar_ordem_servico_desktop') return { data: {
          id: 'remote-os-7', numero: 'OS-0007', id_exportacao: args.p_id_exportacao,
          revision: 1, updated_at: new Date().toISOString()
        }, error: null };
        if (nome === 'listar_arquivos_temporarios_expirados') return { data: [], error: null };
        return { data: null, error: null };
      },
      from: query,
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) }
    };
    const runtime = new DesktopSupabaseRuntime();
    await runtime.inicializar({ db, safeStorage, nativeImage: null, getJanela: () => null, createClient: () => cliente });
    const login = await runtime.login('empresa-teste', 'admin', 'senha');
    assert.strictEqual(login.sucesso, true);
    assert.deepStrictEqual(chamadasAuth.find((c) => c.nome === 'invoke').opcoes.body, {
      empresa: 'empresa-teste', usuario: 'admin', senha: 'senha'
    });
    assert.deepStrictEqual(chamadasAuth.find((c) => c.nome === 'setSession').credenciais, {
      access_token: 'access', refresh_token: 'refresh'
    });
    assert(chamadas.some((c) => c.nome === 'registrar_acesso_comercial'), 'acesso comercial deve registrar o dispositivo sem identificador físico');
    runtime.registrarAlteracaoOS('insert', osLocal);
    const sync = await runtime.sincronizarAgora();
    assert.strictEqual(sync.sucesso, true);
    assert(chamadas.some((c) => c.nome === 'registrar_heartbeat'), 'heartbeat obrigatório');
    assert(chamadas.some((c) => c.nome === 'criar_ordem_servico_desktop'), 'fila local deve ser enviada');
    assert.strictEqual(banco.metadados[0].linha.id, 'remote-os-7');
    const recuperacao = await runtime.recuperarSenha('admin');
    assert.strictEqual(recuperacao.sucesso, false);
    const codigoRecuperacao = await runtime.processarRecuperacaoSenha('sistemaos://auth/callback?code=teste');
    assert.strictEqual(codigoRecuperacao.sucesso, true);
    const senhaAtualizada = await runtime.atualizarSenha('senha-segura');
    assert.strictEqual(senhaAtualizada.sucesso, true);
    assert(chamadasAuth.some((c) => c.nome === 'exchangeCodeForSession' && c.codigo === 'teste'));
    assert(chamadasAuth.some((c) => c.nome === 'updateUser' && c.password === 'senha-segura'));
    runtime.parar();

    const clienteErroLogin = {
      ...cliente,
      functions: { invoke: async () => ({
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: { clone: () => ({ json: async () => ({ erro: 'Credenciais inválidas.' }) }) }
        }
      }) }
    };
    const runtimeErroLogin = new DesktopSupabaseRuntime();
    await runtimeErroLogin.inicializar({ db, safeStorage, nativeImage: null, getJanela: () => null, createClient: () => clienteErroLogin });
    const loginInvalido = await runtimeErroLogin.login('empresa-teste', 'admin', 'incorreta');
    assert.strictEqual(loginInvalido.sucesso, false);
    assert.strictEqual(loginInvalido.erro, 'Empresa, usuário ou senha incorretos.');
    assert(!/Edge Function|non-2xx/i.test(loginInvalido.erro));
    runtimeErroLogin.parar();

    const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260717000800_electron_desktop_sync.sql'), 'utf8');
    const migrationRestauracao = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260720000100_restaurar_os_desktop.sql'), 'utf8');
    const migrationProtecaoCPU = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260722000100_proteger_cpu_atualizacao_os.sql'), 'utf8');
    const runtimeFonte = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'supabase', 'desktop-runtime.js'), 'utf8');
    assert(migration.includes('criar_ordem_servico_desktop'));
    assert(migration.includes('responder_solicitacao_arquivo'));
    assert(!/grant\s+execute[^;]+service_role/i.test(migration));
    assert(migrationRestauracao.includes('restaurar_ordem_servico_desktop'));
    assert(migrationProtecaoCPU.includes("set statement_timeout = '8s'"));
    assert(migrationProtecaoCPU.includes("set lock_timeout = '3s'"));
    assert(runtimeFonte.includes(".is('deleted_at', null)"), 'publicação precisa confirmar que a OS ficou visível no celular');
    assert(runtimeFonte.includes("rpc('restaurar_ordem_servico_desktop'"), 'publicação precisa reparar tombstone remoto explícito');
    console.log('OK: sessão criptografada, empresa, heartbeat, fila offline, mapper leve e pedidos de arquivo do Electron validados.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
