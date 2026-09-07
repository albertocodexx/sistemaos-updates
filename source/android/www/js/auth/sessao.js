/**
 * Máquina de estados da sessão do APK.
 * O Supabase valida a identidade, a empresa, o plano e a sessão offline.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSSessao = api;
  if (root.document) api.inicializar();
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var PREFIXO_CACHE = 'sistema-os-contexto-auth-v1:';
  var CHAVE_ULTIMO_USUARIO = 'sistema-os-ultimo-usuario-auth-v1';
  var LIMITE_OFFLINE_MS = 72 * 60 * 60 * 1000;
  var estadoAtual = { tipo: 'carregando_sessao', mensagem: 'Validando sessão…' };
  var iniciou = false;
  var validacaoNumero = 0;
  var assinaturaInicial = '';
  var assinaturaEventosAuth = null;
  var temporizadorEventoAuth = null;
  var temporizadorIdentidadeEmpresa = null;
  var ignorarProximoTokenRefresh = false;

  function comTempoLimite(promessa, limiteMs) {
    var temporizador;
    return Promise.race([
      Promise.resolve(promessa),
      new Promise(function (_, rejeitar) {
        temporizador = setTimeout(function () {
          rejeitar(new Error('TEMPO_LIMITE_SERVIDOR'));
        }, limiteMs || 20000);
      })
    ]).finally(function () { clearTimeout(temporizador); });
  }

  function emitir(estado) {
    estadoAtual = Object.assign({}, estado);
    if (root.document && typeof root.CustomEvent === 'function') {
      root.document.dispatchEvent(new root.CustomEvent('sistema-os:sessao-alterada', {
        detail: obterEstado()
      }));
    }
  }

  function obterEstado() {
    return Object.assign({}, estadoAtual);
  }

  function ehErroRede(erro) {
    var texto = String(erro && erro.message ? erro.message : erro || '').toLowerCase();
    return erro && (erro.status === 0 || erro.name === 'TypeError') ||
      /failed to fetch|network|internet|offline|fetch failed|networkerror|timeout|tempo_limite_servidor/.test(texto);
  }

  function ehSessaoExpirada(erro) {
    var texto = String(erro && erro.message ? erro.message : erro || '').toLowerCase();
    var codigo = String(erro && erro.code ? erro.code : '').toLowerCase();
    return codigo === 'refresh_token_not_found' || codigo === 'invalid_refresh_token' ||
      codigo === 'invalid_grant' ||
      /refresh token.*(invalid|expired|not found|already used)|auth session missing/.test(texto);
  }

  function ehRejeicaoTemporariaAutenticacao(erro) {
    var texto = String(erro && erro.message ? erro.message : erro || '').toLowerCase();
    return !!(erro && Number(erro.status) === 401) ||
      /jwt.*(expired|invalid|rejected)|invalid jwt|token.*rejected/.test(texto);
  }

  function chaveCache(usuarioId) {
    return PREFIXO_CACHE + String(usuarioId || '');
  }

  function salvarCache(usuario, contexto) {
    if (!root.localStorage || !usuario || !usuario.id || !contexto) return;
    var anterior = root.localStorage.getItem(CHAVE_ULTIMO_USUARIO);
    if (anterior && anterior !== usuario.id) root.localStorage.removeItem(chaveCache(anterior));
    root.localStorage.setItem(chaveCache(usuario.id), JSON.stringify({
      usuario: { id: usuario.id, email: usuario.email || '' },
      contexto: contexto,
      validadoEm: Date.now()
    }));
    root.localStorage.setItem(CHAVE_ULTIMO_USUARIO, usuario.id);
  }

  function lerCache(usuarioId, agora) {
    if (!root.localStorage || !usuarioId) return null;
    try {
      var salvo = JSON.parse(root.localStorage.getItem(chaveCache(usuarioId)) || 'null');
      if (!salvo || !salvo.contexto || !salvo.validadoEm) return null;
      var instante = agora == null ? Date.now() : Number(agora);
      if (instante - Number(salvo.validadoEm) > LIMITE_OFFLINE_MS) return null;
      var validacao = root.SistemaOSEmpresaService.validarContexto(salvo.contexto, usuarioId, instante);
      return validacao.estado === 'autenticado' ? salvo : null;
    } catch (_) {
      return null;
    }
  }

  function limparCachesContexto() {
    if (!root.localStorage) return;
    var remover = [];
    for (var i = 0; i < root.localStorage.length; i += 1) {
      var chave = root.localStorage.key(i);
      if (chave && chave.indexOf(PREFIXO_CACHE) === 0) remover.push(chave);
    }
    remover.forEach(function (chave) { root.localStorage.removeItem(chave); });
    root.localStorage.removeItem(CHAVE_ULTIMO_USUARIO);
  }

  function definirEscopoLocal(contexto) {
    var empresaId = contexto && contexto.empresa_id ? String(contexto.empresa_id) : '';
    if (contexto && contexto.administrador_global === true) {
      empresaId = 'suporte-global-' + String((contexto.usuario && contexto.usuario.id) || 'central');
    }
    // Na primeira versão com isolamento, associa o armazenamento legado à
    // empresa que já estava autenticada no aparelho. As contas seguintes
    // recebem chaves/bancos próprios e nunca herdam esses dados.
    try {
      if (empresaId && contexto && contexto.administrador_global !== true && root.localStorage) {
        if (!root.localStorage.getItem('sistema-os-dados-legados-empresa-v1')) {
          root.localStorage.setItem('sistema-os-dados-legados-empresa-v1', empresaId);
        }
      }
    } catch (_) {}
    if (root.ConfigApp && typeof root.ConfigApp.definirEmpresa === 'function') {
      root.ConfigApp.definirEmpresa(empresaId);
    }
    if (root.SistemaOSHistorico && typeof root.SistemaOSHistorico.definirEmpresa === 'function') {
      root.SistemaOSHistorico.definirEmpresa(empresaId);
    }
    try {
      if (root.localStorage) root.localStorage.setItem('sistema-os-empresa-ativa-v1', empresaId);
    } catch (_) {}
    return empresaId;
  }

  function pararSincronizacaoIdentidadeEmpresa() {
    if (temporizadorIdentidadeEmpresa) root.clearInterval(temporizadorIdentidadeEmpresa);
    temporizadorIdentidadeEmpresa = null;
  }

  function agendarSincronizacaoIdentidadeEmpresa(tipo, contexto) {
    pararSincronizacaoIdentidadeEmpresa();
    if (tipo !== 'autenticado' || !contexto || contexto.administrador_global === true) return;
    temporizadorIdentidadeEmpresa = root.setInterval(function () {
      if (root.document && root.document.hidden) return;
      if (!root.SistemaOSEmpresaService || typeof root.SistemaOSEmpresaService.sincronizarConfiguracoesEmpresa !== 'function') return;
      root.SistemaOSEmpresaService.sincronizarConfiguracoesEmpresa(contexto).catch(function (erro) {
        if (root.console) root.console.warn('Sincronização temporária da identidade da empresa falhou.', erro);
      });
    }, 60000);
  }

  function aplicarContexto(tipo, usuario, contexto, mensagem) {
    definirEscopoLocal(contexto);
    if (root.SistemaOSPermissoes) root.SistemaOSPermissoes.definirContexto(contexto);
    emitir({
      tipo: tipo,
      mensagem: mensagem || '',
      usuario: usuario,
      contexto: contexto,
      offline: tipo === 'offline_com_sessao'
    });
    agendarSincronizacaoIdentidadeEmpresa(tipo, contexto);
  }

  async function validarSessao(sessao, mostrarCarregamento, renovacaoTentada) {
    var numero = ++validacaoNumero;
    var appJaVisivel = estadoAtual.tipo === 'autenticado' || estadoAtual.tipo === 'offline_com_sessao';
    if (mostrarCarregamento !== false && !appJaVisivel) {
      emitir({ tipo: 'carregando_sessao', mensagem: 'Validando sessão…' });
    }
    if (!sessao || !sessao.user || !sessao.user.id) {
      pararSincronizacaoIdentidadeEmpresa();
      if (root.SistemaOSPermissoes) root.SistemaOSPermissoes.limpar();
      emitir({ tipo: 'deslogado', mensagem: '' });
      return obterEstado();
    }

    var usuarioSessao = sessao.user;
    try {
      // getUser valida o JWT no servidor; não confiamos só no conteúdo local.
      var usuario = await comTempoLimite(root.SistemaOSAuthService.obterUsuario(), 18000);
      if (!usuario || usuario.id !== usuarioSessao.id) throw new Error('A sessão não corresponde ao usuário autenticado.');
      var contexto = await comTempoLimite(root.SistemaOSEmpresaService.carregarContexto(), 18000);
      if (numero !== validacaoNumero) return obterEstado();
      var resultado = root.SistemaOSEmpresaService.validarContexto(contexto, usuario.id);
      if (resultado.estado === 'cobranca') {
        definirEscopoLocal(contexto);
        if (root.SistemaOSPermissoes) root.SistemaOSPermissoes.definirContexto(Object.assign({}, contexto, {
          acesso_somente_cobranca: true,
          permissoes: { configuracoes: { visualizar: true } }
        }));
        aplicarContexto('cobranca', usuario, Object.assign({}, contexto, { acesso_somente_cobranca: true }), resultado.mensagem);
        return obterEstado();
      }
      if (resultado.estado !== 'autenticado') {
        pararSincronizacaoIdentidadeEmpresa();
        if (root.SistemaOSPermissoes) root.SistemaOSPermissoes.limpar();
        emitir({ tipo: resultado.estado, mensagem: resultado.mensagem, usuario: usuario, contexto: contexto });
        return obterEstado();
      }
      // Ativa o armazenamento da empresa antes de qualquer leitura ou
      // sincronização. Configuração, histórico, rascunhos e assinaturas de
      // empresas diferentes nunca compartilham o mesmo cache local.
      definirEscopoLocal(contexto);
      // Inventário comercial opcional: falha no registro não bloqueia o
      // técnico depois que usuário, empresa e licença já foram validados.
      if (contexto.administrador_global !== true) {
        root.SistemaOSEmpresaService.registrarAcesso().catch(function () {});
        // A identidade visual pertence a empresa, nao ao aparelho nem ao
        // usuario. Falha de rede nao bloqueia o login; o cache local anterior
        // continua sendo usado ate a proxima validacao online.
        await root.SistemaOSEmpresaService.sincronizarConfiguracoesEmpresa(contexto).catch(function (erroConfig) {
          if (root.console) root.console.warn('Nao foi possivel sincronizar as configuracoes da empresa.', erroConfig);
        });
      }
      salvarCache(usuario, contexto);
      aplicarContexto('autenticado', usuario, contexto, '');
      return obterEstado();
    } catch (erro) {
      if (numero !== validacaoNumero) return obterEstado();
      // Uma rejeicao isolada de JWT pode ser causada pela propagacao do
      // gateway de autenticacao. Renova uma unica vez; nunca entra em loop.
      if (!renovacaoTentada && ehRejeicaoTemporariaAutenticacao(erro) &&
          root.SistemaOSAuthService && typeof root.SistemaOSAuthService.renovarSessao === 'function') {
        try {
          ignorarProximoTokenRefresh = true;
          var sessaoRenovada = await root.SistemaOSAuthService.renovarSessao();
          if (sessaoRenovada && sessaoRenovada.user) {
            return validarSessao(sessaoRenovada, false, true);
          }
          ignorarProximoTokenRefresh = false;
        } catch (erroRenovacao) {
          ignorarProximoTokenRefresh = false;
          if (ehSessaoExpirada(erroRenovacao)) erro = erroRenovacao;
        }
      }
      var cache = (ehErroRede(erro) || ehRejeicaoTemporariaAutenticacao(erro))
        ? lerCache(usuarioSessao.id) : null;
      if (cache) {
        aplicarContexto(
          'offline_com_sessao',
          cache.usuario,
          cache.contexto,
          'Servidor temporariamente indisponível. Seus dados locais continuam disponíveis por até 3 dias.'
        );
        return obterEstado();
      }
      if (ehSessaoExpirada(erro)) {
        pararSincronizacaoIdentidadeEmpresa();
        try { await root.SistemaOSAuthService.sair(); } catch (_) {}
        limparCachesContexto();
        if (root.SistemaOSPermissoes) root.SistemaOSPermissoes.limpar();
        emitir({ tipo: 'deslogado', mensagem: 'Sua sessão expirou. Entre novamente.' });
        return obterEstado();
      }
      if (root.SistemaOSPermissoes) root.SistemaOSPermissoes.limpar();
      emitir({
        tipo: 'erro',
        mensagem: ehErroRede(erro) || ehRejeicaoTemporariaAutenticacao(erro)
          ? 'O servidor está se recuperando e não há uma sessão local válida. Tente novamente em instantes.'
          : (erro && erro.message ? erro.message : 'Não foi possível validar a sessão.'),
        erro: erro
      });
      return obterEstado();
    }
  }

  async function revalidar() {
    try {
      var sessao = await root.SistemaOSAuthService.obterSessao();
      return validarSessao(sessao, true);
    } catch (erro) {
      emitir({ tipo: 'erro', mensagem: erro.message || String(erro), erro: erro });
      return obterEstado();
    }
  }

  async function reconectar() {
    ++validacaoNumero;
    emitir({ tipo: 'carregando_sessao', mensagem: 'Reconectando ao servidor…' });
    try {
      // login-tela limpa o cliente antes desta chamada. Registra novamente
      // o observador no cliente recém-criado e encerra a assinatura antiga
      // para evitar eventos duplicados e consumo desnecessário de CPU.
      registrarEventosAuth();
      var sessao = await comTempoLimite(root.SistemaOSAuthService.obterSessao(), 12000);
      return validarSessao(sessao, false);
    } catch (erro) {
      emitir({
        tipo: 'erro',
        mensagem: ehErroRede(erro)
          ? 'Sem conexão com o servidor. Verifique a internet e tente novamente.'
          : (erro.message || String(erro)),
        erro: erro
      });
      return obterEstado();
    }
  }

  async function processarLink(url) {
    // O mesmo App.addListener também recebe links das etiquetas de OS.
    // Eles pertencem a js/qr-os.js e não devem virar um falso erro de login.
    try {
      var linkRecebido = new URL(String(url || ''));
      if (linkRecebido.protocol.toLowerCase() !== 'com.assistencia.sistemaos:' ||
          linkRecebido.hostname.toLowerCase() !== 'auth') return { ignorado: true };
    } catch (_) {
      return { ignorado: true };
    }
    try {
      var resultado = await root.SistemaOSAuthService.processarUrlAutenticacao(url);
      if (resultado && resultado.tipo === 'recovery') {
        emitir({ tipo: 'recuperacao_senha', mensagem: 'Defina uma nova senha para continuar.' });
        return;
      }
      await revalidar();
    } catch (erro) {
      emitir({ tipo: 'erro', mensagem: 'O link de autenticação é inválido ou expirou.', erro: erro });
    }
  }

  function registrarLinksDoCapacitor() {
    var app = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.App;
    if (!app) return;
    app.addListener('appUrlOpen', function (dados) {
      if (dados && dados.url) processarLink(dados.url);
    });
    if (typeof app.getLaunchUrl === 'function') {
      app.getLaunchUrl().then(function (dados) {
        if (dados && dados.url) processarLink(dados.url);
      }).catch(function () {});
    }
  }

  function registrarEventosAuth() {
    try {
      var anterior = assinaturaEventosAuth && assinaturaEventosAuth.data && assinaturaEventosAuth.data.subscription;
      if (anterior && typeof anterior.unsubscribe === 'function') anterior.unsubscribe();
    } catch (_) {}
    assinaturaEventosAuth = root.SistemaOSAuthService.escutar(function (evento, sessao) {
      // Não execute chamadas Supabase dentro do callback síncrono do SDK.
      if (evento === 'TOKEN_REFRESHED' && ignorarProximoTokenRefresh) {
        ignorarProximoTokenRefresh = false;
        return;
      }
      if (temporizadorEventoAuth) clearTimeout(temporizadorEventoAuth);
      temporizadorEventoAuth = setTimeout(function () {
        temporizadorEventoAuth = null;
        if (evento === 'SIGNED_OUT') {
          ++validacaoNumero;
          limparCachesContexto();
          if (root.SistemaOSPermissoes) root.SistemaOSPermissoes.limpar();
          emitir({ tipo: 'deslogado', mensagem: '' });
        } else if (evento === 'PASSWORD_RECOVERY') {
          emitir({ tipo: 'recuperacao_senha', mensagem: 'Defina uma nova senha para continuar.' });
        } else if (evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED' || evento === 'USER_UPDATED') {
          validarSessao(sessao, evento === 'SIGNED_IN');
        }
      }, evento === 'SIGNED_OUT' ? 0 : 120);
    });
  }

  async function inicializar() {
    if (iniciou) return obterEstado();
    iniciou = true;
    var config = root.SupabaseClientApp.carregarConfiguracao();
    assinaturaInicial = root.SupabaseClientApp.assinaturaConfiguracao(config);
    if (!config.ok) {
      emitir({ tipo: 'erro', mensagem: 'Não foi possível iniciar o serviço. Tente novamente ou contate o suporte.' });
      return obterEstado();
    }
    if (!config.ativo) {
      emitir({ tipo: 'erro', mensagem: 'Não foi possível iniciar o serviço. Tente novamente ou contate o suporte.' });
      return obterEstado();
    }

    try {
      root.SupabaseClientApp.obterCliente();
      registrarEventosAuth();
      registrarLinksDoCapacitor();
      var sessao = await root.SistemaOSAuthService.obterSessao();
      await validarSessao(sessao, false);
    } catch (erro) {
      emitir({ tipo: 'configuracao_pendente', mensagem: erro.message || String(erro), erro: erro });
    }
    return obterEstado();
  }

  async function sair() {
    ++validacaoNumero;
    pararSincronizacaoIdentidadeEmpresa();
    try { await root.SistemaOSAuthService.sair(); } finally {
      limparCachesContexto();
      if (root.SistemaOSPermissoes) root.SistemaOSPermissoes.limpar();
      emitir({ tipo: 'deslogado', mensagem: '' });
    }
  }

  if (root.document) {
    root.document.addEventListener('sistema-os:config-salva', function () {
      var assinaturaNova = root.SupabaseClientApp.assinaturaConfiguracao(
        root.SupabaseClientApp.carregarConfiguracao()
      );
      if (assinaturaNova !== assinaturaInicial) root.location.reload();
    });
  }

  return {
    inicializar: inicializar,
    revalidar: revalidar,
    reconectar: reconectar,
    validarSessao: validarSessao,
    sair: sair,
    processarLink: processarLink,
    obterEstado: obterEstado,
    ehErroRede: ehErroRede,
    ehSessaoExpirada: ehSessaoExpirada,
    ehRejeicaoTemporariaAutenticacao: ehRejeicaoTemporariaAutenticacao,
    lerCache: lerCache,
    limparCachesContexto: limparCachesContexto,
    definirEscopoLocal: definirEscopoLocal,
    LIMITE_OFFLINE_MS: LIMITE_OFFLINE_MS
  };
});
