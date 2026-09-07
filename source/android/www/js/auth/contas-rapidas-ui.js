/** Interface de troca rápida, compartilhada entre login e Configurações. */
(function () {
  'use strict';
  if (!window.SistemaOSContasRapidas) return;

  var blocoLogin = document.getElementById('contas-rapidas-login');
  var listaLogin = document.getElementById('lista-contas-rapidas-login');
  var blocoConfig = document.getElementById('contas-rapidas-config');
  var listaConfig = document.getElementById('lista-contas-rapidas-config');
  var linhaAtivar = document.getElementById('linha-ativar-troca-rapida');
  var checkAtivar = document.getElementById('cfg-troca-rapida-contas');
  var btnAdicionar = document.getElementById('btn-adicionar-conta-rapida');
  var status = document.getElementById('status-contas-rapidas');

  function contextoAtual() {
    return (window.SistemaOSSessao.obterEstado() || {}).contexto || null;
  }

  function ehAdminEmpresa(contexto) {
    return contexto && contexto.administrador_global !== true &&
      /administrador|propriet[aá]rio/i.test(String(contexto.cargo || ''));
  }

  function permitido(contexto) {
    return !!(contexto && (contexto.administrador_global === true ||
      contexto.recursos_habilitados && contexto.recursos_habilitados.troca_rapida_contas === true));
  }

  function definirStatus(mensagem, erro) {
    if (status) {
      status.textContent = mensagem || '';
      status.hidden = !mensagem;
      status.classList.toggle('feedback-erro', !!erro);
    }
    var authStatus = document.getElementById('auth-status');
    if (authStatus && mensagem) {
      authStatus.textContent = mensagem;
      authStatus.hidden = false;
      authStatus.classList.toggle('feedback-erro', !!erro);
      authStatus.classList.toggle('feedback-sucesso', !erro);
    }
  }

  function criarConta(conta, naTelaLogin) {
    var item = document.createElement('div');
    item.className = 'conta-rapida-item';
    var texto = document.createElement('button');
    texto.type = 'button';
    texto.className = 'conta-rapida-entrar';
    var forte = document.createElement('strong');
    forte.textContent = conta.nome || conta.usuario;
    var detalhe = document.createElement('span');
    detalhe.textContent = '@' + conta.usuario + ' · ' + (conta.empresaNome || conta.empresa);
    texto.append(forte, detalhe);
    texto.addEventListener('click', async function () {
      var conteudoOriginal = texto.innerHTML;
      texto.disabled = true;
      texto.textContent = 'Entrando…';
      definirStatus('Entrando em ' + (conta.empresaNome || conta.empresa) + ' como ' + conta.usuario + '…', false);
      try {
        await window.SistemaOSContasRapidas.trocar(conta.id);
        definirStatus('Conta alterada com sucesso. Carregando os dados da empresa…', false);
        document.dispatchEvent(new CustomEvent('sistema-os:contas-rapidas-alteradas'));
      } catch (erro) {
        definirStatus(erro.message || String(erro), true);
      } finally {
        texto.disabled = false;
        texto.innerHTML = conteudoOriginal;
      }
    });
    var remover = document.createElement('button');
    remover.type = 'button';
    remover.className = 'conta-rapida-remover';
    remover.setAttribute('aria-label', 'Remover conta salva');
    remover.textContent = '×';
    remover.addEventListener('click', async function () {
      if (!window.confirm('Remover a conta ' + conta.usuario + ' somente deste aparelho?')) return;
      await window.SistemaOSContasRapidas.remover(conta.id);
      await renderizar();
    });
    item.append(texto, remover);
    return item;
  }

  async function renderizar() {
    var contas = [];
    try { contas = await window.SistemaOSContasRapidas.listar(); }
    catch (erro) { definirStatus(erro.message || String(erro), true); }
    var estado = window.SistemaOSSessao.obterEstado() || {};
    var contexto = estado.contexto || null;
    var logado = ['autenticado', 'offline_com_sessao'].indexOf(estado.tipo) !== -1;
    if (blocoLogin && listaLogin) {
      blocoLogin.hidden = logado || !contas.length;
      listaLogin.replaceChildren();
      contas.forEach(function (conta) { listaLogin.appendChild(criarConta(conta, true)); });
    }
    if (linhaAtivar) linhaAtivar.hidden = !logado || !ehAdminEmpresa(contexto);
    if (checkAtivar) checkAtivar.checked = permitido(contexto);
    if (blocoConfig && listaConfig) {
      blocoConfig.hidden = !logado || !permitido(contexto);
      listaConfig.replaceChildren();
      if (!contas.length) {
        var vazio = document.createElement('p');
        vazio.className = 'aviso aviso-tecnico';
        vazio.textContent = 'Nenhuma outra conta salva neste aparelho.';
        listaConfig.appendChild(vazio);
      } else {
        contas.forEach(function (conta) { listaConfig.appendChild(criarConta(conta, false)); });
      }
    }
  }

  if (checkAtivar) checkAtivar.addEventListener('change', async function () {
    checkAtivar.disabled = true;
    try {
      await window.SistemaOSEmpresaService.configurarTrocaRapida(checkAtivar.checked);
      var contexto = contextoAtual();
      if (contexto) {
        contexto.recursos_habilitados = Object.assign({}, contexto.recursos_habilitados || {}, {
          troca_rapida_contas: checkAtivar.checked
        });
      }
      definirStatus('Troca rápida ' + (checkAtivar.checked ? 'ativada.' : 'desativada.'), false);
      await renderizar();
    } catch (erro) {
      checkAtivar.checked = !checkAtivar.checked;
      definirStatus(erro.message || String(erro), true);
    } finally { checkAtivar.disabled = false; }
  });

  if (btnAdicionar) btnAdicionar.addEventListener('click', async function () {
    var empresa = String(window.prompt('Código da empresa:') || '').trim().toLowerCase();
    if (!empresa) return;
    var usuario = String(window.prompt('Usuário:') || '').trim().toLowerCase();
    if (!usuario) return;
    var senha = String(window.prompt('Senha (não será armazenada):') || '');
    if (!senha) return;
    btnAdicionar.disabled = true;
    definirStatus('Validando e adicionando a conta…');
    try {
      var dados = await window.SistemaOSAuthService.entrar(empresa, usuario, senha);
      senha = '';
      var estado = await window.SistemaOSSessao.validarSessao(dados && dados.session, true);
      var salva = await window.SistemaOSContasRapidas.salvar(empresa, usuario, dados && dados.session, estado && estado.contexto);
      if (!salva) throw new Error('A troca rápida precisa estar ativada para a empresa desta conta.');
      definirStatus('Conta adicionada com segurança.', false);
      await renderizar();
    } catch (erro) {
      senha = '';
      definirStatus(erro.message || String(erro), true);
    } finally { btnAdicionar.disabled = false; }
  });

  document.addEventListener('sistema-os:sessao-alterada', renderizar);
  document.addEventListener('sistema-os:contas-rapidas-alteradas', renderizar);
  renderizar();
})();
