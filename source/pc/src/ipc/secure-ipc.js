// Barreira central entre o renderer (nao confiavel) e os handlers do processo
// principal. A interface do preload reduz a superficie exposta, mas nao
// substitui autorizacao no ponto em que a operacao realmente acontece.
const { ehAdministrador, podeModulo, podeAcaoIA } = require('../access-policy');

const CANAIS_PUBLICOS = new Set([
  'supabase:status',
  'supabase:aguardarInicializacao',
  'supabase:login',
  'supabase:restaurarSessao',
  'supabase:logout',
  'supabase:listarContasRapidas',
  'supabase:trocarContaRapida',
  'supabase:removerContaRapida',
  'supabase:configurarTrocaRapida',
  'supabase:recuperarSenha',
  'supabase:processarRecuperacao',
  'supabase:atualizarSenha',
  'supabase:testarConexao',
  'supabase:registrarErroUsuario',
  'supabase:criarChamadoSuporte',
  'auth:login',
  'update:estado',
  'update:verificar',
  'update:versaoAtual',
  'update:instalar',
  'licenca:obter',
  'licenca:verificar'
]);

const CANAIS_SOMENTE_ADMIN = new Set([
  'sistema:zerar',
  'config:configurarPoliticaExclusao',
  'licenca:ativar',
  'licenca:resetar',
  'auth:criarUsuario',
  'auth:gerarAutomatico',
  'auth:editarUsuario',
  'auth:alterarStatus',
  'auth:excluirUsuario',
  'cargos:criar',
  'cargos:editar',
  'cargos:excluir',
  'auditoria:listar'
]);

const MODULO_POR_PREFIXO = Object.freeze({
  'os:': 'os', 'orc:': 'os', 'garantia:': 'os', 'entrega:': 'os', 'desbloqueio:': 'os',
  'assinatura:': 'os', 'conversas:': 'os', 'notificacao:': 'os',
  'cliente:': 'clientes', 'clientes:': 'clientes',
  'estoque:': 'estoque', 'compra:': 'estoque', 'peca:': 'estoque', 'modelos:': 'estoque',
  'pag:': 'financeiro', 'reembolso:': 'financeiro', 'cobranca:': 'financeiro',
  'mp:': 'financeiro', 'financeiro:': 'financeiro', 'fiscal:': 'financeiro',
  'tabelaPrecos:': 'estoque',
  'config:': 'configuracoes', 'rede:': 'configuracoes', 'backup:': 'configuracoes',
  'auth:': 'usuarios', 'cargos:': 'usuarios',
  'whatsapp:': 'os', 'wappfly:': 'os', 'wapplog:': 'os', 'ialog:': 'configuracoes',
  'db:': 'configuracoes'
});

const CANAIS_SESSAO = new Set([
  'app:abrirManual', 'sistema:abrirLinkSeguro', 'auditoria:listar', 'ia:perguntar', 'ia:executarAcao',
  'supabase:sincronizarAgora', 'supabase:assinaturasSaas', 'supabase:administracaoGlobal',
  'supabase:chamadosSuporte', 'supabase:administrarChamadosSuporte'
]);
const MODULOS_EXATOS = Object.freeze({
  'backup:exportarPainelPDF': 'relatorios',
  'etiqueta:gerarQr': 'os', 'os:confirmarPagamentoPresencial': 'financeiro',
  'ia:testarConexao': 'configuracoes', 'supabase:integracaoMercadoPago': 'configuracoes',
  'supabase:verificarIntegracaoMercadoPago': 'configuracoes', 'supabase:obterIntegracaoMercadoPago': 'configuracoes',
  'supabase:integracaoWhatsAppApi': 'configuracoes', 'supabase:fiscalDocumentos': 'financeiro',
  'supabase:integracaoIA': 'configuracoes',
  'whatsapp:desconectar': 'configuracoes', 'whatsapp:reconectar': 'configuracoes'
});

function moduloDoCanal(canal) {
  return MODULOS_EXATOS[canal] || Object.entries(MODULO_POR_PREFIXO).find(([prefixo]) => canal.startsWith(prefixo))?.[1] || '';
}

function acaoDoCanal(canal) {
  const nome = canal.split(':')[1] || '';
  if (/^(excluir|remover)/i.test(nome)) return 'excluir';
  if (/^(criar|registrar|importar|converter)/i.test(nome)) return 'criar';
  if (/^(obter|listar|buscar|stats|status|checklist|categorias|dashboard|modulos|historico|perfil|gerarPdf|abrir|exportar|gerarComprovante|imprimir|contadores|por|naoEntendidas|aguardandoHumano|pagamentoNaRetirada|cruzar|termos)/i.test(nome)) return 'ler';
  return 'editar';
}

function exigirAcesso(canal, usuario, args = []) {
  if (!usuario) throw new Error('Sessao expirada. Entre novamente.');
  if (CANAIS_SOMENTE_ADMIN.has(canal) && !ehAdministrador(usuario)) {
    throw new Error('Acao permitida somente ao administrador.');
  }
  if (canal.startsWith('backup:') && canal !== 'backup:exportarPainelPDF' && !ehAdministrador(usuario)) {
    throw new Error('Somente o administrador pode acessar o backup completo.');
  }
  if (['auth:atualizarNome', 'auth:revalidar'].includes(canal)) {
    if (args[0] !== usuario.id && !ehAdministrador(usuario)) throw new Error('Nao e permitido alterar ou consultar outra conta.');
    if (usuario.acessoSomenteCobranca) throw new Error('Acesso limitado a assinatura.');
    return;
  }
  const modulo = moduloDoCanal(canal);
  if (!modulo && !CANAIS_SESSAO.has(canal) && !CANAIS_SOMENTE_ADMIN.has(canal)
      && canal !== 'lote:importarDoCelular') throw new Error('Canal sem politica de acesso.');
  if (modulo && !podeModulo(usuario, modulo, acaoDoCanal(canal))) {
    throw new Error('Seu usuario nao possui permissao para esta acao.');
  }
  if (canal === 'ia:executarAcao' && !podeAcaoIA(usuario, args[0]?.tipo)) {
    throw new Error('Seu usuario nao possui permissao para esta acao da IA.');
  }
  if (canal === 'assinatura:exportar' && ['compra', 'venda'].includes(args[0]) && !podeModulo(usuario, 'estoque', 'editar')) {
    throw new Error('Seu usuario nao possui permissao para alterar documentos do estoque.');
  }
  // Importacoes mistas podem conter OS, vendas e compras no mesmo arquivo.
  if (['lote:importarDoCelular', 'assinatura:importarResposta'].includes(canal) &&
      !['os', 'estoque'].every(m => podeModulo(usuario, m, 'editar'))) {
    throw new Error('A importacao de documentos exige acesso a OS e estoque.');
  }
}

function validarOrigem(evento, getJanelaPrincipal, rendererUrl) {
  const janela = getJanelaPrincipal?.();
  if (!janela || janela.isDestroyed() || !evento?.senderFrame ||
      evento.sender !== janela.webContents || evento.sender.isDestroyed() ||
      evento.senderFrame !== evento.sender.mainFrame) throw new Error('Origem da solicitacao nao autorizada.');
  const url = new URL(evento.senderFrame.url);
  url.hash = '';
  if (!rendererUrl || url.href !== rendererUrl) throw new Error('Origem da solicitacao nao autorizada.');
}

function criarIpcMainSeguro({ ipcMain, supabaseDesktop, getJanelaPrincipal, rendererUrl, revalidarSessaoLocal, auditoria }) {
  let sessaoLocal = null;
  let geracaoSessao = 0;
  let transicaoEmAndamento = false;
  let operacoesEmAndamento = 0;
  const obterUsuarioAutenticado = () => {
    if (supabaseDesktop?.client || supabaseDesktop?.usuario) return supabaseDesktop.usuario || null;
    if (sessaoLocal && revalidarSessaoLocal) sessaoLocal = revalidarSessaoLocal(sessaoLocal.id);
    return sessaoLocal;
  };
  return new Proxy(ipcMain, {
    get(alvo, propriedade) {
      if (propriedade === 'obterUsuarioAutenticado') return obterUsuarioAutenticado;
      if (propriedade !== 'handle') {
        const valor = alvo[propriedade];
        return typeof valor === 'function' ? valor.bind(alvo) : valor;
      }
      return (canal, handler) => alvo.handle(canal, async (evento, ...args) => {
        validarOrigem(evento, getJanelaPrincipal, rendererUrl);
        const publico = CANAIS_PUBLICOS.has(canal);
        const transicao = ['auth:login', 'supabase:login', 'supabase:restaurarSessao', 'supabase:trocarContaRapida', 'supabase:logout'].includes(canal);
        if ((transicao || !publico) && transicaoEmAndamento) throw new Error('Aguarde a troca de conta terminar.');
        if (transicao && operacoesEmAndamento) throw new Error('Aguarde a operação atual terminar antes de trocar de conta.');
        const usuario = obterUsuarioAutenticado();
        if (!publico) exigirAcesso(canal, usuario, args);
        if (canal === 'auth:login' && supabaseDesktop?.client) throw new Error('Use o login seguro da empresa.');
        if (transicao) {
          sessaoLocal = null;
          geracaoSessao++;
          transicaoEmAndamento = true;
        }
        const geracao = geracaoSessao;
        if (!publico) operacoesEmAndamento++;
        const executar = () => handler(evento, ...args);
        try {
          const resultado = auditoria?.executarComContexto
            ? await auditoria.executarComContexto({ usuario, canal, args }, executar)
            : await executar();
          if (canal === 'auth:login' && resultado?.sucesso && resultado.usuario && geracao === geracaoSessao) sessaoLocal = resultado.usuario;
          return resultado;
        } finally {
          if (!publico) operacoesEmAndamento--;
          if (transicao) transicaoEmAndamento = false;
        }
      });
    }
  });
}

module.exports = { criarIpcMainSeguro, CANAIS_PUBLICOS, CANAIS_SOMENTE_ADMIN, moduloDoCanal, acaoDoCanal, exigirAcesso };
