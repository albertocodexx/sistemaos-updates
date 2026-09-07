function registerSupabaseHandlers({ ipcMain, supabaseDesktop, app }) {
  if (!supabaseDesktop) return;
  let reinicioTrocaContaAgendado = false;
  ipcMain.handle('supabase:status', () => supabaseDesktop.status());
  ipcMain.handle('supabase:aguardarInicializacao', () => supabaseDesktop.aguardarInicializacao());
  ipcMain.handle('supabase:login', (_e, empresa, usuario, senha) => supabaseDesktop.login(empresa, usuario, senha));
  ipcMain.handle('supabase:restaurarSessao', () => supabaseDesktop.restaurarSessao());
  ipcMain.handle('supabase:logout', () => supabaseDesktop.logout());
  ipcMain.handle('supabase:listarContasRapidas', () => supabaseDesktop.listarContasRapidas());
  ipcMain.handle('supabase:trocarContaRapida', async (_e, contaId) => {
    const resposta = await supabaseDesktop.trocarContaRapida(contaId);
    if (resposta?.sucesso && resposta?.reiniciarAplicacao && app && !reinicioTrocaContaAgendado) {
      reinicioTrocaContaAgendado = true;
      const temporizador = setTimeout(() => {
        app.relaunch();
        app.quit();
      }, 500);
      temporizador.unref?.();
    }
    return resposta;
  });
  ipcMain.handle('supabase:removerContaRapida', (_e, contaId) => supabaseDesktop.removerContaRapida(contaId));
  ipcMain.handle('supabase:configurarTrocaRapida', (_e, ativa) => supabaseDesktop.configurarTrocaRapida(ativa));
  ipcMain.handle('supabase:recuperarSenha', (_e, email) => supabaseDesktop.recuperarSenha(email));
  ipcMain.handle('supabase:processarRecuperacao', (_e, url) => supabaseDesktop.processarRecuperacaoSenha(url));
  ipcMain.handle('supabase:atualizarSenha', (_e, senha) => supabaseDesktop.atualizarSenha(senha));
  ipcMain.handle('supabase:testarConexao', (_e, credenciais) => supabaseDesktop.testarConexao(credenciais));
  ipcMain.handle('supabase:sincronizarAgora', () => supabaseDesktop.sincronizarAgora());
  ipcMain.handle('tabelaPrecos:listar', () => supabaseDesktop.listarTabelaPrecos());
  ipcMain.handle('tabelaPrecos:salvar', (_e, dados) => supabaseDesktop.salvarTabelaPreco(dados));
  ipcMain.handle('tabelaPrecos:excluir', (_e, id, revision) => supabaseDesktop.excluirTabelaPreco(id, revision));
  ipcMain.handle('supabase:integracaoMercadoPago', (_e, acao, accessToken) => supabaseDesktop.gerenciarIntegracaoMercadoPago(acao, accessToken));
  ipcMain.handle('supabase:verificarIntegracaoMercadoPago', () => supabaseDesktop.verificarIntegracaoMercadoPago());
  ipcMain.handle('supabase:obterIntegracaoMercadoPago', () => supabaseDesktop.obterIntegracaoMercadoPago());
  ipcMain.handle('supabase:assinaturasSaas', (_e, acao, dados) => supabaseDesktop.assinaturasSaas(acao, dados));
  ipcMain.handle('supabase:fiscalDocumentos', (_e, acao, dados) => supabaseDesktop.fiscalDocumentos(acao, dados));
  ipcMain.handle('supabase:integracaoWhatsAppApi', (_e, acao, dados) => supabaseDesktop.integracaoWhatsAppApi(acao, dados));
  ipcMain.handle('supabase:integracaoIA', (_e, acao, dados) => supabaseDesktop.integracaoIA(acao, dados));
  ipcMain.handle('supabase:administracaoGlobal', (_e, acao, dados) => supabaseDesktop.administrarGlobal(acao, dados));
  ipcMain.handle('supabase:registrarErroUsuario', (_e, dados) => supabaseDesktop.registrarErroUsuario(dados));
  ipcMain.handle('supabase:criarChamadoSuporte', (_e, dados) => supabaseDesktop.criarChamadoSuporte(dados));
  ipcMain.handle('supabase:chamadosSuporte', (_e, acao, dados) => supabaseDesktop.chamadosSuporte(acao, dados));
  ipcMain.handle('supabase:administrarChamadosSuporte', (_e, acao, dados) => supabaseDesktop.administrarChamadosSuporte(acao, dados));
}

module.exports = { registerSupabaseHandlers };
