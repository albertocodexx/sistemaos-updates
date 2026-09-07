(function (root) {
  'use strict';
  var CHAVE = 'sistemaos_chamados_acompanhamento_v2';
  var CHAVE_ATUAL = 'sistemaos_chamado_atual_v2';
  var chamados = [];
  var atual = null;
  var canal = null;
  var timer = null;
  var novoContexto = null;
  function $(id) { return document.getElementById(id); }
  function texto(valor) { return String(valor == null ? '' : valor); }
  function somenteDigitos(valor) { return texto(valor).replace(/\D/g, ''); }
  var MOTIVOS = {
    trial_assinatura: 'Período de teste / assinatura', cobranca_pagamento: 'Cobrança ou pagamento',
    acesso_login: 'Acesso, senha ou login', sincronizacao_backup: 'Sincronização ou backup',
    documento_assinatura: 'PDF, documento ou assinatura', erro_sistema: 'Erro no sistema',
    configuracao_integracao: 'Configuração ou integração', duvida_funcionalidade: 'Dúvida sobre uma função',
    sugestao: 'Sugestão de melhoria', outro: 'Outro motivo'
  };
  function nomeStatus(valor) { return ({ aberto: 'Aberto', em_atendimento: 'Em atendimento', resolvido: 'Resolvido', fechado: 'Fechado' })[texto(valor)] || 'Aberto'; }
  function cliente() { return root.SupabaseClientApp.obterCliente(); }
  async function invocar(acao, dados) {
    var resposta = await cliente().functions.invoke('chamados-suporte', { body: { acao: acao, dados: dados || {} } });
    if (resposta.error && root.SistemaOSEdgeError) await root.SistemaOSEdgeError.lancar(resposta.error, 'Não foi possível falar com o suporte.');
    if (resposta.error) throw resposta.error;
    if (resposta.data && resposta.data.erro) throw new Error(resposta.data.erro);
    return resposta.data || {};
  }
  function locais() { try { var v = JSON.parse(localStorage.getItem(CHAVE) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  function registrar(resultado) {
    if (!resultado || !resultado.tokenAcompanhamento || !resultado.chamadoId) return;
    var lista = locais().filter(function (item) { return item.chamadoId !== resultado.chamadoId; });
    lista.unshift({ chamadoId: resultado.chamadoId, protocolo: resultado.protocolo, tokenAcompanhamento: resultado.tokenAcompanhamento, registradoEm: new Date().toISOString() });
    localStorage.setItem(CHAVE, JSON.stringify(lista.slice(0, 30)));
  }
  function estrutura() {
    if ($('central-chamados-app')) return;
    var tela = document.createElement('section');
    tela.id = 'central-chamados-app'; tela.className = 'central-chamados-app'; tela.hidden = true;
    tela.innerHTML = '<header><button type="button" id="fechar-central-chamados" class="btn-secundario">Voltar</button><div><strong>Suporte Sistema OS</strong><small>Acompanhe e responda sem sair do aplicativo.</small></div></header>' +
      '<form id="form-novo-chamado-app" class="form-novo-chamado-app" hidden>' +
      '<div class="novo-chamado-app-titulo"><strong>Como podemos ajudar?</strong><span>O chamado fica salvo na nuvem e vinculado ao usuário informado.</span></div>' +
      '<div class="suporte-form-secao-app"><strong>Identificação</strong><span>Confirme quem solicita o atendimento.</span></div>' +
      '<div id="campo-empresa-novo-chamado-app"><label for="empresa-novo-chamado-app">Código da empresa *</label><input id="empresa-novo-chamado-app" maxlength="40"></div>' +
      '<div><label for="usuario-novo-chamado-app">Usuário do Sistema OS *</label><input id="usuario-novo-chamado-app" maxlength="30" autocomplete="username" required></div>' +
      '<div><label for="nome-novo-chamado-app">Nome completo *</label><input id="nome-novo-chamado-app" maxlength="120" autocomplete="name" required></div>' +
      '<div><label for="cargo-novo-chamado-app">Cargo na empresa *</label><select id="cargo-novo-chamado-app" required><option value="">Selecione</option><option value="proprietario">Proprietário(a)</option><option value="administrador">Administrador(a)</option><option value="gerente">Gerente</option><option value="tecnico">Técnico(a)</option><option value="atendente">Atendente</option><option value="financeiro">Financeiro</option><option value="outro">Outro</option></select></div>' +
      '<div id="campo-cargo-outro-novo-chamado-app" hidden><label for="cargo-outro-novo-chamado-app">Informe seu cargo *</label><input id="cargo-outro-novo-chamado-app" maxlength="80"></div>' +
      '<div class="suporte-form-secao-app"><strong>Contato</strong><span>Como devemos retornar?</span></div>' +
      '<div><label for="telefone-novo-chamado-app">Telefone ou WhatsApp *</label><input id="telefone-novo-chamado-app" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" required></div>' +
      '<div><label for="email-novo-chamado-app">E-mail (opcional)</label><input id="email-novo-chamado-app" type="email" maxlength="160" autocomplete="email"></div>' +
      '<div><label for="preferencia-contato-novo-chamado-app">Prefiro receber retorno por *</label><select id="preferencia-contato-novo-chamado-app"><option value="whatsapp">WhatsApp</option><option value="ligacao">Ligação</option><option value="email">E-mail</option></select></div>' +
      '<div><label for="horario-contato-novo-chamado-app">Melhor horário (opcional)</label><input id="horario-contato-novo-chamado-app" maxlength="80" placeholder="Ex.: 9h às 18h"></div>' +
      '<div class="suporte-form-secao-app"><strong>Solicitação</strong><span>Os campos mudam conforme o motivo.</span></div>' +
      '<div><label for="motivo-novo-chamado-app">Motivo do chamado *</label><select id="motivo-novo-chamado-app" required><option value="">Selecione o motivo</option>' + Object.keys(MOTIVOS).map(function (valor) { return '<option value="' + valor + '">' + MOTIVOS[valor] + '</option>'; }).join('') + '</select></div>' +
      '<div id="campo-motivo-outro-novo-chamado-app" hidden><label for="motivo-outro-novo-chamado-app">Qual é o motivo? *</label><input id="motivo-outro-novo-chamado-app" maxlength="160"></div>' +
      '<div id="campo-plataforma-novo-chamado-app" hidden><label for="plataforma-novo-chamado-app">Onde acontece? *</label><select id="plataforma-novo-chamado-app"><option value="celular">Celular</option><option value="pc">Computador</option><option value="ambos">Computador e celular</option></select></div>' +
      '<div id="campo-referencia-novo-chamado-app" hidden><label id="label-referencia-novo-chamado-app" for="referencia-novo-chamado-app">OS ou documento relacionado</label><input id="referencia-novo-chamado-app" maxlength="80" placeholder="Ex.: OS-0020"></div>' +
      '<div><label for="prioridade-novo-chamado-app">Prioridade</label><select id="prioridade-novo-chamado-app"><option value="normal">Normal</option><option value="baixa">Baixa</option><option value="alta">Alta</option><option value="critica">Crítica</option></select></div>' +
      '<div><label for="assunto-novo-chamado-app">Resumo do pedido *</label><input id="assunto-novo-chamado-app" maxlength="160" placeholder="Descreva em uma frase" required></div>' +
      '<div><label for="descricao-novo-chamado-app">Explique o que aconteceu *</label><textarea id="descricao-novo-chamado-app" rows="5" maxlength="8000" placeholder="Conte o que tentou fazer e o que apareceu na tela…" required></textarea></div>' +
      '<p id="status-novo-chamado-app" class="suporte-status"></p><div class="novo-chamado-app-acoes"><button type="button" id="cancelar-novo-chamado-app" class="btn-secundario">Cancelar</button><button type="submit" id="enviar-novo-chamado-app" class="btn-primario">Enviar chamado</button></div></form>' +
      '<main id="conteudo-central-chamados-app" class="conteudo-central-chamados-app">' +
      '<div id="lista-central-chamados-app" class="lista-central-chamados-app"></div>' +
      '<section id="conversa-central-chamados-app" class="conversa-central-chamados-app" hidden><div id="cabecalho-chamado-app" class="cabecalho-chamado-app"></div><div id="mensagens-chamado-app" class="mensagens-chamado-app"></div>' +
      '<form id="form-mensagem-chamado-app" class="form-mensagem-chamado-app"><textarea id="mensagem-chamado-app" maxlength="8000" rows="3" placeholder="Escreva uma mensagem…"></textarea><button type="submit" class="btn-primario">Enviar mensagem</button></form></section>' +
      '<p id="status-chamados-app" class="suporte-status"></p></main>';
    document.body.appendChild(tela);
    $('fechar-central-chamados').addEventListener('click', fechar);
    $('cancelar-novo-chamado-app').addEventListener('click', ocultarNovo);
    $('form-novo-chamado-app').addEventListener('submit', enviarNovo);
    $('motivo-novo-chamado-app').addEventListener('change', atualizarCondicionais);
    $('cargo-novo-chamado-app').addEventListener('change', atualizarCondicionais);
    $('form-mensagem-chamado-app').addEventListener('submit', enviar);
    $('mensagem-chamado-app').addEventListener('keydown', function (evento) {
      if (evento.key === 'Enter' && !evento.shiftKey) {
        evento.preventDefault();
        $('form-mensagem-chamado-app').requestSubmit();
      }
    });
  }
  function atualizarCondicionais() {
    var motivo = $('motivo-novo-chamado-app').value;
    var cargo = $('cargo-novo-chamado-app').value;
    var tecnico = ['acesso_login', 'sincronizacao_backup', 'documento_assinatura', 'erro_sistema', 'configuracao_integracao'].indexOf(motivo) >= 0;
    var referencia = ['cobranca_pagamento', 'sincronizacao_backup', 'documento_assinatura', 'erro_sistema'].indexOf(motivo) >= 0;
    $('campo-motivo-outro-novo-chamado-app').hidden = motivo !== 'outro';
    $('motivo-outro-novo-chamado-app').required = motivo === 'outro';
    $('campo-cargo-outro-novo-chamado-app').hidden = cargo !== 'outro';
    $('cargo-outro-novo-chamado-app').required = cargo === 'outro';
    $('campo-plataforma-novo-chamado-app').hidden = !tecnico;
    $('plataforma-novo-chamado-app').required = tecnico;
    $('campo-referencia-novo-chamado-app').hidden = !referencia;
    $('label-referencia-novo-chamado-app').textContent = motivo === 'cobranca_pagamento' ? 'Cobrança, plano ou protocolo relacionado' : 'OS ou documento relacionado';
    if ($('assunto-novo-chamado-app').dataset.automatico === 'true') {
      $('assunto-novo-chamado-app').value = motivo ? MOTIVOS[motivo] : '';
    }
  }
  function mostrarNovo(contexto) {
    estrutura(); novoContexto = Object.assign({}, contexto || {});
    var publico = texto(novoContexto.origem).indexOf('login_') === 0;
    var estado = root.SistemaOSSessao && root.SistemaOSSessao.obterEstado ? root.SistemaOSSessao.obterEstado() : {};
    var contextoSessao = estado.contexto || {};
    var usuarioSessao = estado.usuario || {};
    var usuarioLogin = novoContexto.usuario || (usuarioSessao.user_metadata && usuarioSessao.user_metadata.usuario) || contextoSessao.usuario || '';
    $('campo-empresa-novo-chamado-app').hidden = !publico;
    $('empresa-novo-chamado-app').value = novoContexto.empresa || '';
    $('usuario-novo-chamado-app').value = usuarioLogin;
    $('usuario-novo-chamado-app').readOnly = !publico;
    $('nome-novo-chamado-app').value = novoContexto.nome || contextoSessao.perfil_nome || usuarioLogin;
    $('nome-novo-chamado-app').readOnly = !publico;
    $('telefone-novo-chamado-app').value = novoContexto.telefone || novoContexto.contato || '';
    $('email-novo-chamado-app').value = novoContexto.email || '';
    $('cargo-novo-chamado-app').value = novoContexto.cargoEmpresa || '';
    $('cargo-outro-novo-chamado-app').value = '';
    $('preferencia-contato-novo-chamado-app').value = 'whatsapp';
    $('horario-contato-novo-chamado-app').value = '';
    $('motivo-novo-chamado-app').value = novoContexto.motivo || '';
    $('motivo-outro-novo-chamado-app').value = '';
    $('plataforma-novo-chamado-app').value = novoContexto.plataforma || 'celular';
    $('referencia-novo-chamado-app').value = '';
    $('assunto-novo-chamado-app').value = novoContexto.assunto || '';
    $('assunto-novo-chamado-app').dataset.automatico = novoContexto.assunto ? 'false' : 'true';
    $('descricao-novo-chamado-app').value = novoContexto.mensagem || '';
    $('prioridade-novo-chamado-app').value = 'normal';
    atualizarCondicionais();
    $('status-novo-chamado-app').textContent = '';
    $('form-novo-chamado-app').hidden = false;
    $('conteudo-central-chamados-app').hidden = true;
  }
  function ocultarNovo() {
    $('form-novo-chamado-app').hidden = true;
    $('conteudo-central-chamados-app').hidden = false;
  }
  async function enviarNovo(evento) {
    evento.preventDefault();
    var publico = texto(novoContexto && novoContexto.origem).indexOf('login_') === 0;
    var empresa = $('empresa-novo-chamado-app').value.trim().toLowerCase();
    var usuario = $('usuario-novo-chamado-app').value.trim().toLowerCase();
    var nome = $('nome-novo-chamado-app').value.trim();
    var telefone = somenteDigitos($('telefone-novo-chamado-app').value);
    var email = $('email-novo-chamado-app').value.trim().toLowerCase();
    var preferenciaContato = $('preferencia-contato-novo-chamado-app').value;
    var cargoEmpresa = $('cargo-novo-chamado-app').value;
    var cargoOutro = $('cargo-outro-novo-chamado-app').value.trim();
    var motivo = $('motivo-novo-chamado-app').value;
    var motivoOutro = $('motivo-outro-novo-chamado-app').value.trim();
    var assunto = $('assunto-novo-chamado-app').value.trim();
    var mensagem = $('descricao-novo-chamado-app').value.trim();
    if (publico && !/^[a-z0-9-]{3,40}$/.test(empresa)) { $('status-novo-chamado-app').textContent = 'Informe o código correto da empresa.'; return; }
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) { $('status-novo-chamado-app').textContent = 'Informe o usuário usado para entrar no Sistema OS.'; return; }
    if (nome.length < 2) { $('status-novo-chamado-app').textContent = 'Informe seu nome completo.'; return; }
    if (!/^\d{10,15}$/.test(telefone)) { $('status-novo-chamado-app').textContent = 'Informe um telefone ou WhatsApp com DDD.'; return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('status-novo-chamado-app').textContent = 'Confira o e-mail informado.'; return; }
    if (preferenciaContato === 'email' && !email) { $('status-novo-chamado-app').textContent = 'Informe o e-mail escolhido para retorno.'; return; }
    if (!cargoEmpresa || (cargoEmpresa === 'outro' && cargoOutro.length < 2)) { $('status-novo-chamado-app').textContent = 'Selecione seu cargo na empresa.'; return; }
    if (!motivo || (motivo === 'outro' && motivoOutro.length < 3)) { $('status-novo-chamado-app').textContent = 'Selecione ou descreva o motivo do chamado.'; return; }
    if (!assunto || mensagem.length < 10) { $('status-novo-chamado-app').textContent = 'Informe o assunto e pelo menos 10 caracteres na descrição.'; return; }
    var botao = $('enviar-novo-chamado-app'); botao.disabled = true; botao.textContent = 'Enviando…';
    try {
      var acao = publico ? 'criar_publico' : 'criar_autenticado';
      var resposta = await invocar(acao, { origem: novoContexto.origem || 'config_celular', empresa: empresa,
        nome: nome, usuario: usuario, telefone: telefone, email: email, preferenciaContato: preferenciaContato,
        horarioContato: $('horario-contato-novo-chamado-app').value.trim(), cargoEmpresa: cargoEmpresa,
        cargoOutro: cargoOutro, motivo: motivo, motivoOutro: motivoOutro,
        plataforma: $('plataforma-novo-chamado-app').value,
        referencia: $('referencia-novo-chamado-app').value.trim(), assunto: assunto,
        prioridade: $('prioridade-novo-chamado-app').value, mensagem: mensagem });
      registrar(resposta); ocultarNovo(); await carregarEAbrir(resposta.chamadoId);
    } catch (erro) { $('status-novo-chamado-app').textContent = texto(erro && erro.message ? erro.message : erro); }
    finally { botao.disabled = false; botao.textContent = 'Enviar chamado'; }
  }
  function desenharLista() {
    var lista = $('lista-central-chamados-app'); lista.innerHTML = '';
    if (!chamados.length) { lista.innerHTML = '<p class="suporte-vazio">Nenhum chamado encontrado neste acesso.</p>'; return; }
    chamados.forEach(function (chamado) {
      var botao = document.createElement('button'); botao.type = 'button'; botao.className = 'item-chamado-app';
      var titulo = document.createElement('strong'); titulo.textContent = chamado.protocolo || ('CH-' + texto(chamado.id).slice(0, 8).toUpperCase());
      var assunto = document.createElement('span'); assunto.textContent = chamado.assunto || 'Atendimento de suporte';
      var meta = document.createElement('small'); meta.textContent = nomeStatus(chamado.status) + (chamado.ultima_mensagem_em ? ' · ' + new Date(chamado.ultima_mensagem_em).toLocaleString('pt-BR') : '');
      botao.append(titulo, assunto, meta); botao.addEventListener('click', function () { abrirConversa(chamado); }); lista.appendChild(botao);
    });
  }
  function desenharMensagens(lista) {
    var alvo = $('mensagens-chamado-app'); alvo.innerHTML = '';
    (lista || []).forEach(function (mensagem) {
      var item = document.createElement('article'); item.className = 'mensagem-chamado-app ' + texto(mensagem.autor_tipo);
      var autor = document.createElement('strong'); autor.textContent = mensagem.autor_nome || (mensagem.autor_tipo === 'suporte' ? 'Suporte Sistema OS' : 'Cliente');
      var corpo = document.createElement('p'); corpo.textContent = texto(mensagem.mensagem);
      var data = document.createElement('small'); data.textContent = mensagem.criado_em ? new Date(mensagem.criado_em).toLocaleString('pt-BR') : '';
      item.append(autor, corpo, data); alvo.appendChild(item);
    });
    alvo.scrollTop = alvo.scrollHeight;
  }
  async function atualizarConversa(silencioso) {
    if (!atual) return;
    var resposta = atual._modo === 'publico'
      ? await invocar('acompanhar_publico', { token: atual._token })
      : await invocar('listar_mensagens', { chamadoId: atual.id });
    atual = Object.assign({}, atual, resposta.chamado || {});
    $('cabecalho-chamado-app').textContent = (atual.protocolo || 'Chamado') + ' · ' + nomeStatus(atual.status) + ' · ' + (atual.assunto || 'Atendimento');
    desenharMensagens(resposta.mensagens || []);
    var encerrado = ['resolvido', 'fechado'].indexOf(texto(atual.status)) >= 0;
    $('form-mensagem-chamado-app').hidden = encerrado;
    $('mensagem-chamado-app').disabled = encerrado;
    if (encerrado) $('status-chamados-app').textContent = 'Chamado ' + nomeStatus(atual.status).toLowerCase() + '. O chat foi encerrado e não aceita novas mensagens.';
    else if (!silencioso) $('status-chamados-app').textContent = 'Conversa atualizada.';
    invocar('marcar_visualizado', { chamadoId: atual.id, token: atual._token || '' }).catch(function () {});
  }
  function iniciarTempoReal() {
    if (canal) cliente().removeChannel(canal);
    clearInterval(timer); canal = null; timer = null;
    if (!atual) return;
    if (atual._modo !== 'publico' && typeof cliente().channel === 'function') {
      canal = cliente().channel('chamado-' + atual.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chamado_mensagens', filter: 'chamado_id=eq.' + atual.id }, function () { atualizarConversa(true).catch(function () {}); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chamados_suporte', filter: 'id=eq.' + atual.id }, function () { atualizarConversa(true).catch(function () {}); })
        .subscribe();
    }
    timer = setInterval(function () { atualizarConversa(true).catch(function () {}); }, atual._modo === 'publico' ? 12000 : 30000);
  }
  async function abrirConversa(chamado) {
    atual = chamado; localStorage.setItem(CHAVE_ATUAL, chamado.id || ''); $('conversa-central-chamados-app').hidden = false; $('status-chamados-app').textContent = 'Carregando conversa…';
    try { await atualizarConversa(false); iniciarTempoReal(); } catch (erro) { $('status-chamados-app').textContent = texto(erro && erro.message ? erro.message : erro); }
  }
  async function enviar(evento) {
    evento.preventDefault(); if (!atual) return;
    if (['resolvido', 'fechado'].indexOf(texto(atual.status)) >= 0) {
      $('status-chamados-app').textContent = 'Este chamado está encerrado e não aceita novas mensagens.';
      return;
    }
    var campo = $('mensagem-chamado-app'); var mensagem = campo.value.trim(); if (!mensagem) return;
    var botao = evento.currentTarget.querySelector('button'); botao.disabled = true;
    try {
      var acao = atual._modo === 'suporte' ? 'responder_suporte' : atual._modo === 'publico' ? 'responder_publico' : 'responder_autenticado';
      await invocar(acao, { chamadoId: atual.id, token: atual._token || '', mensagem: mensagem }); campo.value = ''; await atualizarConversa(true); $('status-chamados-app').textContent = 'Mensagem enviada.';
    } catch (erro) { $('status-chamados-app').textContent = texto(erro && erro.message ? erro.message : erro); }
    finally { botao.disabled = false; }
  }
  async function carregar() {
    var lista = [];
    try { var meus = await invocar('listar_meus', {}); (meus.chamados || []).forEach(function (item) { lista.push(Object.assign({ _modo: 'autenticado' }, item)); }); } catch (_) {}
    for (var i = 0; i < locais().length; i++) {
      var salvo = locais()[i];
      try { var publico = await invocar('acompanhar_publico', { token: salvo.tokenAcompanhamento }); if (publico.chamado && !lista.some(function (item) { return item.id === publico.chamado.id; })) lista.push(Object.assign({ _modo: 'publico', _token: salvo.tokenAcompanhamento }, publico.chamado)); } catch (_) {}
    }
    chamados = lista.sort(function (a, b) { return texto(b.ultima_mensagem_em).localeCompare(texto(a.ultima_mensagem_em)); }); desenharLista(); return chamados;
  }
  async function carregarEAbrir(chamadoId) {
    await carregar();
    var preferido = chamados.find(function (item) { return item.id === chamadoId; })
      || chamados.find(function (item) { return ['resolvido', 'fechado'].indexOf(texto(item.status)) === -1; }) || chamados[0];
    $('status-chamados-app').textContent = chamados.length ? 'Atendimento conectado.' : 'Nenhum chamado neste acesso.';
    if (preferido) await abrirConversa(preferido);
  }
  async function abrir() { estrutura(); $('central-chamados-app').hidden = false; ocultarNovo(); $('status-chamados-app').textContent = 'Buscando chamados…'; await carregarEAbrir(localStorage.getItem(CHAVE_ATUAL) || ''); }
  async function abrirNovo(contexto) { estrutura(); $('central-chamados-app').hidden = false; mostrarNovo(contexto || {}); }
  async function abrirSuporte(chamado) { estrutura(); $('central-chamados-app').hidden = false; chamados = [Object.assign({ _modo: 'suporte' }, chamado)]; desenharLista(); await abrirConversa(chamados[0]); }
  function fechar() { clearInterval(timer); if (canal) cliente().removeChannel(canal); canal = null; timer = null; atual = null; $('central-chamados-app').hidden = true; }
  root.SistemaOSChamados = Object.freeze({ registrar: registrar, abrir: abrir, abrirNovo: abrirNovo, abrirSuporte: abrirSuporte });
})(typeof globalThis !== 'undefined' ? globalThis : this);
