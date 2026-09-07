'use strict';
// Testes comportamentais: somente objetos falsos, sem Electron ou banco real.
const assert = require('node:assert/strict');
const { criarIpcMainSeguro } = require('../../src/ipc/secure-ipc');
const { usuarioPublico } = require('../../src/supabase/desktop-runtime');

async function executar() {
  const falhas = [];
  const teste = async (nome, fn) => {
    try { await fn(); console.log('OK: ' + nome); }
    catch (erro) { falhas.push(nome); console.error('FALHOU: ' + nome + ': ' + erro.message); }
  };
  const url = 'file:///C:/SistemaOS/renderer/index.html';
  const frame = { url };
  const webContents = { mainFrame: frame, isDestroyed: () => false };
  const evento = { sender: webContents, senderFrame: frame };
  const janela = { webContents, isDestroyed: () => false };
  const runtime = { usuario: { id: 'operador', permissoes: { os: true } } };
  const handlers = new Map();
  let chamadas = 0;
  const ipc = criarIpcMainSeguro({
    ipcMain: { handle: (canal, handler) => handlers.set(canal, handler) },
    supabaseDesktop: runtime,
    getJanelaPrincipal: () => janela,
    rendererUrl: url
  });
  for (const canal of ['supabase:status', 'compra:listar', 'os:obter', 'os:atualizar',
    'ia:executarAcao', 'os:confirmarPagamentoPresencial', 'assinatura:exportar', 'novo:semPolitica']) {
    ipc.handle(canal, async () => { chamadas++; return { sucesso: true }; });
  }
  await teste('cargo administrativo nao vira administrador', () => {
    const usuario = usuarioPublico({ id: 'qa' }, { cargo: 'auxiliar administrativo', permissoes: {} });
    assert.equal(usuario.admin, false);
  });
  await teste('cargo administrador exato continua permitido', () => {
    assert.equal(usuarioPublico({ id: 'qa' }, { cargo: 'administrador' }).admin, true);
  });
  await teste('origem externa e rejeitada mesmo no canal publico', async () => {
    await assert.rejects(handlers.get('supabase:status')({ sender: webContents, senderFrame: { url: 'https://externo.invalid/' } }));
  });
  await teste('outra janela e rejeitada mesmo com a mesma URL', async () => {
    await assert.rejects(handlers.get('supabase:status')({ sender: { mainFrame: frame }, senderFrame: frame }));
  });
  await teste('iframe nao recebe acesso da janela principal', async () => {
    await assert.rejects(handlers.get('supabase:status')({ sender: webContents, senderFrame: { url } }));
  });
  await teste('canal publico aceita apenas a janela legitima', async () => {
    assert.equal((await handlers.get('supabase:status')(evento)).sucesso, true);
  });
  await teste('sem sessao nao consulta OS', async () => {
    runtime.usuario = null;
    await assert.rejects(handlers.get('os:obter')(evento, 'OS-TESTE'));
    runtime.usuario = { id: 'operador', permissoes: { os: true } };
  });
  await teste('operador de OS nao consulta compras', async () => {
    await assert.rejects(handlers.get('compra:listar')(evento));
  });
  await teste('IA nao contorna bloqueio financeiro com usuario forjado', async () => {
    await assert.rejects(handlers.get('ia:executarAcao')(evento,
      { tipo: 'alterar_status_cobranca', dados: {} }, { admin: true }));
  });
  await teste('pagamento presencial exige financeiro', async () => {
    await assert.rejects(handlers.get('os:confirmarPagamentoPresencial')(evento, {}));
  });
  await teste('exportar compra para assinatura exige estoque', async () => {
    await assert.rejects(handlers.get('assinatura:exportar')(evento, 'compra', 'CP-TESTE'));
  });
  await teste('canal novo sem politica falha fechado', async () => {
    await assert.rejects(handlers.get('novo:semPolitica')(evento));
  });
  await teste('permissao somente leitura nao autoriza edicao', async () => {
    runtime.usuario = usuarioPublico({ id: 'leitor' }, { cargo: 'tecnico', permissoes: { os: { ler: true, editar: false } } });
    assert.equal((await handlers.get('os:obter')(evento, 'OS-TESTE')).sucesso, true);
    await assert.rejects(handlers.get('os:atualizar')(evento, 'OS-TESTE', {}));
  });
  await teste('acesso somente cobranca nao herda admin global', async () => {
    runtime.usuario = { id: 'restrito', administradorGlobal: true, acessoSomenteCobranca: true, permissoes: {} };
    await assert.rejects(handlers.get('compra:listar')(evento));
  });
  await teste('acao de IA desconhecida e bloqueada para administrador', async () => {
    runtime.usuario = { id: 'admin', admin: true };
    await assert.rejects(handlers.get('ia:executarAcao')(evento, { tipo: '__proto__' }));
  });
  await teste('requisicao autorizada chega ao handler', async () => {
    runtime.usuario = { id: 'editor', permissoes: { os: true } };
    assert.equal((await handlers.get('os:atualizar')(evento, 'OS-TESTE', {})).sucesso, true);
  });
  assert.equal(chamadas, 3, 'somente tres operacoes autorizadas podem atingir handlers');
  await teste('troca de conta nao cruza operacoes em andamento', async () => {
    let liberar;
    ipc.handle('os:salvar', () => new Promise(resolve => { liberar = resolve; }));
    ipc.handle('supabase:logout', async () => { runtime.usuario = null; });
    const pendente = handlers.get('os:salvar')(evento);
    await assert.rejects(handlers.get('supabase:logout')(evento), /atual terminar/i);
    liberar({ sucesso: true }); await pendente;
    await handlers.get('supabase:logout')(evento);
    await assert.rejects(handlers.get('os:obter')(evento), /Sessao/);
  });
  await teste('operacao e segundo login aguardam transicao terminar', async () => {
    let liberar;
    ipc.handle('supabase:login', () => new Promise(resolve => { liberar = resolve; }));
    const pendente = handlers.get('supabase:login')(evento);
    await assert.rejects(handlers.get('os:obter')(evento), /troca/);
    await assert.rejects(handlers.get('supabase:login')(evento), /troca/);
    liberar({ sucesso: false }); await pendente;
  });
  await teste('historico exclusivo do administrador e conta propria sem cargo de usuarios', async () => {
    ipc.handle('auditoria:listar', async () => []);
    ipc.handle('auth:revalidar', async (_, id) => ({ id }));
    runtime.usuario = { id: 'operador', permissoes: { os: true } };
    await assert.rejects(handlers.get('auditoria:listar')(evento), /administrador/);
    assert.equal((await handlers.get('auth:revalidar')(evento, 'operador')).id, 'operador');
    await assert.rejects(handlers.get('auth:revalidar')(evento, 'outra-conta'));
    runtime.usuario = { id: 'admin', admin: true };
    assert.deepEqual(await handlers.get('auditoria:listar')(evento), []);
  });
  await teste('backup completo bloqueado antes de arquivo ou rede', async () => {
    const { exigirAcesso } = require('../../src/ipc/secure-ipc');
    const gestor = { id: 'gerente', permissoes: { configuracoes: true, relatorios: true } };
    for (const canal of ['backup:exportar', 'backup:importar', 'backup:baixarAuto', 'backup:abrirPastaDados']) {
      assert.throws(() => exigirAcesso(canal, gestor), /administrador/);
    }
    assert.doesNotThrow(() => exigirAcesso('backup:exportarPainelPDF', gestor));
    const { CompanyCloudService } = require('../../src/supabase/company-cloud-service');
    for (const cargo of ['tecnico', 'auxiliar administrativo', 'suporte']) {
      const servico = new CompanyCloudService({
        getContext: () => ({ empresa_id: 'qa', cargo, permissoes: { configuracoes: true } }),
        getClient: () => { throw Error('NAO DEVE CHAMAR A REDE'); }
      });
      await assert.rejects(servico.baixarUltimoBackup(), /administrador/);
      await assert.rejects(servico.publicarBackup('nao-existe'), /administrador/);
      assert.equal((await servico.restaurarEmInstalacaoNova()).restaurado, false);
    }
  });
  assert.deepEqual(falhas, []);
}
executar().catch(erro => { console.error(erro); process.exitCode = 1; });
