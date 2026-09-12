/** Interface do gate de autenticação. */
(function () {
  'use strict';

  var tela = document.getElementById('tela-login');
  if (!tela || !window.SistemaOSSessao) return;

  var topo = document.getElementById('app-topo');
  var conteudo = document.getElementById('app-conteudo');
  var status = document.getElementById('auth-status');
  var carregando = document.getElementById('auth-carregando');
  var formLogin = document.getElementById('form-login');
  var empresa = document.getElementById('auth-empresa');
  var email = document.getElementById('auth-email');
  var senha = document.getElementById('auth-senha');
  var btnMostrarSenha = document.getElementById('btn-mostrar-senha-auth');
  var btnEntrar = document.getElementById('btn-entrar-auth');
  var formNovaSenha = document.getElementById('form-nova-senha');
  var novaSenha = document.getElementById('auth-nova-senha');
  var confirmarSenha = document.getElementById('auth-confirmar-senha');
  var btnTentar = document.getElementById('btn-tentar-auth');
  var btnSairAuth = document.getElementById('btn-sair-auth');
  var btnSairSessao = document.getElementById('btn-sair-sessao');
  var identidade = document.getElementById('auth-identidade');
  var usuarioResumo = document.getElementById('auth-usuario-resumo');
  var bannerOffline = document.getElementById('auth-banner-offline');
  var bannerLicenca = document.getElementById('licenca-banner');
  var atualizacao = document.getElementById('auth-atualizacao');
  var textoAtualizacao = document.getElementById('auth-atualizacao-texto');
  var btnInstalarAtualizacao = document.getElementById('btn-instalar-atualizacao-login');
  var atualizacaoGlobal = document.getElementById('atualizacao-global-app');
  var textoAtualizacaoGlobal = document.getElementById('atualizacao-global-app-texto');
  var btnAtualizacaoGlobal = document.getElementById('btn-atualizacao-global-app');
  var btnAbrirChamado = document.getElementById('btn-abrir-chamado-login');
  var estadoSessaoAtual = window.SistemaOSSessao.obterEstado();
  var atualizacaoInicialVerificada = false;
  var atualizacaoObrigatoria = false;
  var atualizacaoAutomaticaIniciada = false;

  function definirStatus(texto, ehErro, ehSucesso) {
    status.textContent = texto || '';
    status.classList.toggle('auth-status-erro', !!ehErro);
    status.classList.toggle('auth-status-sucesso', !!ehSucesso);
  }

  if (btnMostrarSenha) {
    btnMostrarSenha.addEventListener('click', function () {
      var mostrar = senha.type === 'password';
      senha.type = mostrar ? 'text' : 'password';
      btnMostrarSenha.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
      btnMostrarSenha.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
      btnMostrarSenha.title = mostrar ? 'Ocultar senha' : 'Mostrar senha';
      senha.focus();
    });
  }

  function formatarErro(erro) {
    var mensagem = String(erro && erro.message ? erro.message : erro || 'Falha inesperada.');
    var normalizada = mensagem.toLowerCase();
    if (/servi[cç]o (?:de dados|de autentica[cç][aã]o) temporariamente indispon[ií]vel|servico_(?:dados|auth)_indisponivel|pgrst00[02]|schema cache|service unavailable|http 50[23]/.test(normalizada)) {
      return 'O servidor está temporariamente sobrecarregado. Aguarde alguns instantes e tente novamente.';
    }
    if (/credenciais inv[aá]lidas|invalid login credentials|invalid credentials/.test(normalizada)) {
      return 'Empresa, usuário ou senha incorretos.';
    }
    if (/usu[aá]rio (?:inativo|bloqueado)|user.*(?:inactive|blocked)/.test(normalizada)) {
      return 'Este usuário está bloqueado. Fale com o administrador da empresa.';
    }
    if (/empresa (?:inativa|bloqueada)|company.*(?:inactive|blocked)/.test(normalizada)) {
      return 'O acesso desta empresa está bloqueado. Fale com o suporte.';
    }
    if (/licen[cç]a.*(?:bloqueada|vencida|expirada)|license.*(?:blocked|expired)/.test(normalizada)) {
      return 'A licença da empresa está vencida ou bloqueada. Fale com o suporte.';
    }
    if (normalizada.indexOf('rate limit') !== -1 || normalizada.indexOf('too many') !== -1) {
      return 'Muitas tentativas. Aguarde um pouco e tente novamente.';
    }
    if (/tempo_limite_servidor/.test(normalizada)) {
      return 'O servidor demorou para responder. Tente novamente em alguns instantes.';
    }
    if (/failed to fetch|network|internet|offline|fetch failed|econn|timeout/.test(normalizada)) {
      return 'Sem conexão com a internet. Verifique a rede e tente novamente.';
    }
    if (/non-2xx|edge function/.test(normalizada)) {
      return 'O serviço seguro não respondeu. Aguarde alguns instantes e tente novamente.';
    }
    if (/n[aã]o foi poss[ií]vel entrar agora/.test(normalizada)) return 'Não foi possível entrar agora. Tente novamente.';
    return 'Não foi possível concluir a operação. Tente novamente ou fale com o suporte.';
  }

  function ocultarBlocos() {
    carregando.hidden = true;
    formLogin.hidden = true;
    formNovaSenha.hidden = true;
    btnTentar.hidden = true;
    btnSairAuth.hidden = true;
  }

  function mostrarAplicativo(estado) {
    tela.hidden = true;
    topo.hidden = false;
    conteudo.hidden = false;
    var usaAuth = estado.tipo !== 'desativado';
    identidade.hidden = !usaAuth;
    bannerOffline.hidden = estado.tipo !== 'offline_com_sessao';
    bannerLicenca.hidden = true;
    if (usaAuth) {
      var contexto = estado.contexto || {};
      // O e-mail do Supabase é apenas o identificador técnico da conta.
      // A interface deve mostrar somente o perfil e a empresa vinculada.
      usuarioResumo.textContent = [contexto.perfil_nome || 'Usuário', contexto.empresa_nome]
        .filter(Boolean)
        .join(' · ');
      var statusLicenca = String(contexto.licenca_status || '').toLowerCase();
      var dataFim = contexto.fim_trial || contexto.data_vencimento;
      if (statusLicenca === 'teste') {
        bannerLicenca.textContent = 'Trial ativo' + (dataFim ? ' até ' + new Date(dataFim).toLocaleDateString('pt-BR') : '') + '.';
        bannerLicenca.hidden = false;
      } else if (statusLicenca === 'vencendo') {
        bannerLicenca.textContent = 'Sua licença vence em breve' + (dataFim ? ': ' + new Date(dataFim).toLocaleDateString('pt-BR') : '.') + ' Regularize com o suporte.';
        bannerLicenca.hidden = false;
      } else if (statusLicenca === 'periodo_graca') {
        bannerLicenca.textContent = 'Licença em período de graça. Regularize com o suporte para evitar bloqueio.';
        bannerLicenca.hidden = false;
      }
    } else {
      usuarioResumo.textContent = '';
    }
  }

  function bloquearAplicativo() {
    topo.hidden = true;
    conteudo.hidden = true;
    identidade.hidden = true;
    bannerOffline.hidden = true;
    bannerLicenca.hidden = true;
    tela.hidden = false;
  }

  function mostrarAtualizacao(resultado) {
    if (!resultado) return;
    var deveExibir = ['verificando', 'disponivel', 'baixando', 'instalando', 'confirmacao'].indexOf(resultado.fase) !== -1 ||
      (resultado.fase === 'erro' && atualizacaoObrigatoria);
    var aplicativoAberto = tela.hidden === true;
    if (atualizacao) {
      atualizacao.hidden = !deveExibir || aplicativoAberto;
      atualizacao.dataset.fase = resultado.fase || '';
    }
    if (atualizacaoGlobal) {
      atualizacaoGlobal.hidden = !deveExibir || !aplicativoAberto;
      atualizacaoGlobal.dataset.fase = resultado.fase || '';
    }
    if (!deveExibir) return;
    var mensagem = resultado.fase === 'disponivel'
      ? 'Nova versão ' + (resultado.versaoNova || '') + ' disponível. Confirme para atualizar o aplicativo.'
      : (resultado.mensagem || 'Verificando atualização do aplicativo…');
    if (textoAtualizacao) textoAtualizacao.textContent = mensagem;
    if (textoAtualizacaoGlobal) textoAtualizacaoGlobal.textContent = mensagem;
    var podeTentarInstalar = resultado.fase === 'disponivel' || (resultado.fase === 'erro' && atualizacaoObrigatoria);
    if (btnInstalarAtualizacao) btnInstalarAtualizacao.hidden = !podeTentarInstalar;
    if (btnAtualizacaoGlobal) btnAtualizacaoGlobal.hidden = !podeTentarInstalar;
  }

  function aplicarEstadoAtualizacao(resultado) {
    resultado = resultado || {};
    var fase = String(resultado.fase || '');
    if (['disponivel', 'baixando', 'instalando', 'confirmacao', 'pronto'].indexOf(fase) !== -1) {
      atualizacaoInicialVerificada = true;
      atualizacaoObrigatoria = true;
    } else if (['atualizado', 'indisponivel', 'desenvolvimento'].indexOf(fase) !== -1) {
      atualizacaoInicialVerificada = true;
      atualizacaoObrigatoria = false;
    } else if (fase === 'erro' && !atualizacaoObrigatoria) {
      // Sem rede não existe confirmação de uma versão nova. A sessão offline
      // continua utilizável; assim que a conexão voltar, a checagem é refeita.
      atualizacaoInicialVerificada = true;
    }
    renderizar(estadoSessaoAtual);
    mostrarAtualizacao(resultado);
    if (fase === 'disponivel' && !atualizacaoAutomaticaIniciada) {
      // A atualização obrigatória faz parte da abertura do aplicativo. Inicia
      // o download sem exigir um segundo toque; o Android ainda exibirá a
      // confirmação nativa de instalação, que não pode ser automatizada.
      atualizacaoAutomaticaIniciada = true;
      instalarAtualizacao(null);
    }
  }

  async function instalarAtualizacao(botao) {
    if (botao) botao.disabled = true;
    try {
      if (!window.SistemaOSAtualizacao || typeof window.SistemaOSAtualizacao.baixarEInstalar !== 'function') {
        throw new Error('O recurso de atualização não está disponível neste APK.');
      }
      var resultado = await window.SistemaOSAtualizacao.baixarEInstalar();
      var mensagem = (resultado && (resultado.mensagem || resultado.erro)) || 'Não foi possível iniciar a atualização.';
      if (textoAtualizacao) textoAtualizacao.textContent = mensagem;
      if (textoAtualizacaoGlobal) textoAtualizacaoGlobal.textContent = mensagem;
      if (resultado && resultado.sucesso) {
        if (atualizacao) atualizacao.dataset.fase = 'baixando';
        if (atualizacaoGlobal) atualizacaoGlobal.dataset.fase = 'baixando';
        if (btnInstalarAtualizacao) btnInstalarAtualizacao.hidden = true;
        if (btnAtualizacaoGlobal) btnAtualizacaoGlobal.hidden = true;
      }
    } catch (erro) {
      var mensagemErro = (erro && erro.message) || 'Não foi possível iniciar a atualização.';
      if (textoAtualizacao) textoAtualizacao.textContent = mensagemErro;
      if (textoAtualizacaoGlobal) textoAtualizacaoGlobal.textContent = mensagemErro;
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  function renderizar(estado) {
    estado = estado || window.SistemaOSSessao.obterEstado();
    estadoSessaoAtual = estado;
    ocultarBlocos();
    if (!atualizacaoInicialVerificada || atualizacaoObrigatoria) {
      bloquearAplicativo();
      definirStatus(
        atualizacaoObrigatoria
          ? 'Atualização obrigatória. Instale a nova versão para continuar.'
          : 'Verificando se há uma atualização…'
      );
      carregando.hidden = atualizacaoObrigatoria;
      return;
    }
    if (estado.tipo === 'desativado' || estado.tipo === 'autenticado' || estado.tipo === 'offline_com_sessao' || estado.tipo === 'cobranca') {
      mostrarAplicativo(estado);
      return;
    }

    bloquearAplicativo();
    if (estado.tipo === 'carregando_sessao') {
      definirStatus(estado.mensagem || 'Validando sessão…');
      carregando.hidden = false;
      return;
    }
    if (estado.tipo === 'deslogado') {
      definirStatus('Entre com a conta vinculada à sua assistência.');
      formLogin.hidden = false;
      return;
    }
    if (estado.tipo === 'recuperacao_senha') {
      definirStatus(estado.mensagem || 'Defina uma nova senha.');
      formNovaSenha.hidden = false;
      novaSenha.focus();
      return;
    }
    if (estado.tipo === 'configuracao_pendente') {
      // Não exponha detalhes de infraestrutura nem ofereça edição técnica.
      definirStatus('Não foi possível iniciar o serviço. Tente novamente ou contate o suporte.', true);
      btnTentar.hidden = false;
      return;
    }

    definirStatus(formatarErro(estado.mensagem || 'Não foi possível liberar o aplicativo.'), true);
    btnTentar.hidden = false;
    btnSairAuth.hidden = false;
  }

  formLogin.addEventListener('submit', async function (evento) {
    evento.preventDefault();
    var empresaDigitada = empresa.value.trim();
    var emailDigitado = email.value.trim();
    var senhaDigitada = senha.value;
    if (!empresaDigitada || !emailDigitado || !senhaDigitada) {
      definirStatus('Informe empresa, usuário e senha.', true);
      return;
    }
    btnEntrar.disabled = true;
    definirStatus('Entrando e validando a empresa…');
    try {
      var dados = await window.SistemaOSAuthService.entrar(empresaDigitada, emailDigitado, senhaDigitada);
      senha.value = '';
      var estadoValidado = await window.SistemaOSSessao.validarSessao(dados && dados.session, true);
      if (window.SistemaOSContasRapidas && estadoValidado && estadoValidado.contexto) {
        await window.SistemaOSContasRapidas.salvar(
          empresaDigitada, emailDigitado, dados && dados.session, estadoValidado.contexto
        ).catch(function (falhaCofre) { console.warn('Conta não foi salva no cofre:', falhaCofre.message); });
      }
      document.dispatchEvent(new CustomEvent('sistema-os:contas-rapidas-alteradas'));
    } catch (erro) {
      senha.value = '';
      definirStatus(formatarErro(erro), true);
      formLogin.hidden = false;
      senha.focus();
    } finally {
      btnEntrar.disabled = false;
    }
  });

  if (btnAbrirChamado) {
    btnAbrirChamado.addEventListener('click', async function () {
      if (window.SistemaOSChamados && window.SistemaOSChamados.abrirNovo) {
        await window.SistemaOSChamados.abrirNovo({
          origem: 'login_celular', empresa: empresa.value.trim().toLowerCase(),
          usuario: email.value.trim(), nome: email.value.trim()
        });
        return;
      }
      var codigo = empresa.value.trim().toLowerCase() || String(window.prompt('Código da empresa:') || '').trim().toLowerCase();
      if (!/^[a-z0-9-]{3,40}$/.test(codigo)) { definirStatus('Informe o código da empresa para abrir o chamado.', true); return; }
      var nome = String(window.prompt('Seu nome (opcional):', email.value.trim()) || '').trim();
      var contato = String(window.prompt('Telefone ou e-mail para retorno (opcional):') || '').trim();
      var mensagem = String(window.prompt('Descreva o que precisa (mínimo 10 caracteres):') || '').trim();
      if (mensagem.length < 10) { definirStatus('Descreva o problema com pelo menos 10 caracteres.', true); return; }
      btnAbrirChamado.disabled = true;
      try {
        var cliente = window.SupabaseClientApp.obterCliente();
        var resposta = await cliente.functions.invoke('chamados-suporte', { body: { acao: 'criar_publico', dados: {
          origem: 'login_celular', empresa: codigo, nome: nome, usuario: email.value.trim(), contato: contato, mensagem: mensagem
        } } });
        if (resposta.error && window.SistemaOSEdgeError) await window.SistemaOSEdgeError.lancar(resposta.error, 'Não foi possível abrir o chamado.');
        if (resposta.error) throw resposta.error;
        if (resposta.data && resposta.data.erro) throw new Error(resposta.data.erro);
        if (window.SistemaOSChamados) window.SistemaOSChamados.registrar(resposta.data || {});
        definirStatus('Chamado ' + ((resposta.data && resposta.data.protocolo) || '') + ' enviado ao suporte.', false, true);
        if (window.SistemaOSChamados) window.SistemaOSChamados.abrir().catch(function () {});
      } catch (erro) { definirStatus(formatarErro(erro), true); }
      finally { btnAbrirChamado.disabled = false; }
    });
  }

  formNovaSenha.addEventListener('submit', async function (evento) {
    evento.preventDefault();
    if (novaSenha.value.length < 8) {
      definirStatus('A nova senha precisa ter pelo menos 8 caracteres.', true);
      return;
    }
    if (novaSenha.value !== confirmarSenha.value) {
      definirStatus('As duas senhas não são iguais.', true);
      return;
    }
    var botao = formNovaSenha.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
      await window.SistemaOSAuthService.atualizarSenha(novaSenha.value);
      novaSenha.value = '';
      confirmarSenha.value = '';
      definirStatus('Senha atualizada. Validando sua conta…', false, true);
      await window.SistemaOSSessao.revalidar();
    } catch (erro) {
      definirStatus(formatarErro(erro), true);
    } finally {
      botao.disabled = false;
    }
  });

  btnTentar.addEventListener('click', async function () {
    if (btnTentar.disabled) return;
    var textoOriginal = btnTentar.textContent;
    btnTentar.disabled = true;
    btnTentar.textContent = 'Tentando…';
    definirStatus('Reconectando ao servidor…');
    carregando.hidden = false;
    try {
      // Uma WebView pode conservar um cliente HTTP quebrado depois que a
      // rede troca entre Wi-Fi e dados móveis. Recriar somente o cliente
      // (a sessão continua no armazenamento seguro do SDK) faz o botão
      // realmente abrir uma nova conexão.
      if (window.SupabaseClientApp && typeof window.SupabaseClientApp.limparCliente === 'function') {
        window.SupabaseClientApp.limparCliente();
      }
      var novoEstado = await window.SistemaOSSessao.reconectar();
      if (!novoEstado || novoEstado.tipo === 'deslogado') {
        definirStatus('Conexão restabelecida. Entre novamente.');
        formLogin.hidden = false;
        (senha.value ? senha : (email.value ? senha : empresa)).focus();
      }
    } catch (erro) {
      definirStatus(formatarErro(erro), true);
      formLogin.hidden = false;
    } finally {
      carregando.hidden = true;
      btnTentar.disabled = false;
      btnTentar.textContent = textoOriginal;
    }
  });

  async function sair() {
    btnSairAuth.disabled = true;
    if (btnSairSessao) btnSairSessao.disabled = true;
    try { await window.SistemaOSSessao.sair(); }
    catch (erro) { definirStatus(formatarErro(erro), true); }
    finally {
      btnSairAuth.disabled = false;
      if (btnSairSessao) btnSairSessao.disabled = false;
    }
  }

  btnSairAuth.addEventListener('click', sair);
  if (btnSairSessao) btnSairSessao.addEventListener('click', sair);

  window.addEventListener('sistema-os:atualizacao-disponivel', function (evento) {
    aplicarEstadoAtualizacao(evento.detail);
  });
  if (btnInstalarAtualizacao) {
    btnInstalarAtualizacao.addEventListener('click', function () {
      instalarAtualizacao(btnInstalarAtualizacao);
    });
  }
  if (btnAtualizacaoGlobal) {
    btnAtualizacaoGlobal.addEventListener('click', function () {
      instalarAtualizacao(btnAtualizacaoGlobal);
    });
  }

  document.addEventListener('sistema-os:sessao-alterada', function (evento) {
    renderizar(evento.detail);
    if (window.SistemaOSAtualizacao && typeof window.SistemaOSAtualizacao.obterUltima === 'function') {
      mostrarAtualizacao(window.SistemaOSAtualizacao.obterUltima());
    }
  });
  renderizar(window.SistemaOSSessao.obterEstado());
  if (window.SistemaOSAtualizacao && typeof window.SistemaOSAtualizacao.verificarNaAbertura === 'function') {
    window.SistemaOSAtualizacao.verificarNaAbertura().catch(function () {
      aplicarEstadoAtualizacao({ fase: 'erro', mensagem: 'Não foi possível verificar atualizações agora.' });
    });
  } else {
    aplicarEstadoAtualizacao({ fase: 'erro', mensagem: 'O verificador de atualização não foi carregado.' });
  }
})();
