(function (root) {
  'use strict';
  var CHAVE = 'sistemaos_chamados_acompanhamento_v2';
  var CHAVE_ATUAL = 'sistemaos_chamado_atual_v2';
  var chamados = [];
  var atual = null;
  var canal = null;
  var timer = null;
  var novoContexto = null;
  var geracao = 0;
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
  var FLUXOS_MOTIVO = {
    trial_assinatura: { pergunta: 'O que você precisa?', opcoes: [['contratar', 'Contratar após o período de teste'], ['renovar', 'Renovar assinatura'], ['trocar_plano', 'Trocar de plano'], ['acesso_bloqueado', 'Acesso bloqueado ou vencido'], ['outro', 'Outra questão sobre assinatura']], mensagem: 'Conte o que você precisa sobre o teste ou a assinatura *', placeholder: 'Ex.: meu período de teste terminou e quero contratar o plano…' },
    cobranca_pagamento: { pergunta: 'O que aconteceu com o pagamento?', opcoes: [['nao_reconhecido', 'Pagamento ainda não reconhecido'], ['checkout', 'Não consigo abrir ou concluir o pagamento'], ['valor_incorreto', 'Valor ou vencimento incorreto'], ['duplicado', 'Cobrança ou pagamento duplicado'], ['reembolso', 'Reembolso ou cancelamento'], ['outro', 'Outro problema de pagamento']], referencia: 'Pagamento, cobrança, plano ou protocolo (opcional)', mensagem: 'Explique o problema com a cobrança *', placeholder: 'Informe o valor, a data e o que apareceu na tela…' },
    acesso_login: { pergunta: 'Qual é o problema de acesso?', opcoes: [['nao_entra', 'Não consigo entrar'], ['senha', 'Senha ou troca de senha'], ['bloqueado', 'Usuário bloqueado ou pausado'], ['trocar_usuario', 'Troca de usuário não funciona'], ['conta', 'Conta ou empresa não aparece'], ['outro', 'Outro problema de acesso']], plataforma: true, mensagem: 'Explique o que acontece ao tentar entrar *', placeholder: 'Ex.: após tocar em Entrar, volto para a mesma tela…' },
    sincronizacao_backup: { pergunta: 'O que não está sincronizando?', opcoes: [['os', 'Ordens de serviço'], ['assinaturas', 'Assinaturas ou documentos'], ['estoque', 'Estoque ou vendas'], ['clientes', 'Clientes'], ['cobrancas', 'Cobranças ou pagamentos'], ['configuracoes', 'Configurações da empresa'], ['backup', 'Backup ou restauração'], ['outro', 'Outro dado']], plataforma: true, complemento: { pergunta: 'Onde o dado está faltando?', opcoes: [['no_pc', 'Foi criado no celular e não chegou ao PC'], ['no_celular', 'Foi criado no PC e não chegou ao celular'], ['ambos', 'Está diferente nos dois'], ['backup', 'Problema no backup ou restauração']] }, referencia: 'Número da OS, venda ou registro (opcional)', mensagem: 'Diga o que está diferente *', placeholder: 'Informe o registro, onde foi criado e o que aparece em cada aparelho…' },
    documento_assinatura: { pergunta: 'Qual é o problema?', opcoes: [['pdf', 'PDF vazio, preto ou incorreto'], ['assinatura_nao_chega', 'Assinatura não chega ao outro aparelho'], ['assinatura_visual', 'Assinatura pequena, torta ou fora do lugar'], ['compartilhar', 'Compartilhar não abre ou não envia'], ['documento_reaparece', 'Documento excluído reaparece'], ['outro', 'Outro problema com documento']], plataforma: true, complemento: { pergunta: 'Qual documento?', opcoes: [['os', 'Ordem de serviço'], ['entrega', 'Entrega'], ['garantia', 'Garantia'], ['desbloqueio', 'Desbloqueio'], ['compra', 'Compra'], ['venda', 'Venda'], ['outro', 'Outro documento']] }, referencia: 'Número do documento (opcional)', mensagem: 'Explique o problema com o documento *', placeholder: 'Conte o que fez e como o PDF ou a assinatura ficou…' },
    erro_sistema: { pergunta: 'Em qual área ocorreu o erro?', opcoes: [['os', 'Ordens de serviço'], ['clientes', 'Clientes'], ['estoque', 'Estoque ou vendas'], ['financeiro', 'Financeiro ou cobranças'], ['usuarios', 'Usuários e permissões'], ['ia', 'Assistente de IA'], ['relatorios', 'Relatórios'], ['configuracoes', 'Configurações'], ['atualizacao', 'Atualização do aplicativo'], ['outro', 'Outra área']], plataforma: true, complemento: { pergunta: 'Com que frequência acontece?', opcoes: [['sempre', 'Acontece sempre'], ['as_vezes', 'Acontece às vezes'], ['uma_vez', 'Aconteceu uma vez'], ['apos_atualizar', 'Começou depois de uma atualização']] }, referencia: 'OS, venda ou registro relacionado (opcional)', mensagem: 'Descreva o erro *', placeholder: 'Informe o que estava fazendo, o que esperava e a mensagem exibida…' },
    configuracao_integracao: { pergunta: 'Qual configuração ou integração?', opcoes: [['whatsapp', 'WhatsApp'], ['mercado_pago', 'Mercado Pago'], ['ia', 'Assistente de IA'], ['nota_fiscal', 'Nota fiscal'], ['backup', 'Backup'], ['atualizacao', 'Atualizações'], ['empresa', 'Dados da empresa'], ['outro', 'Outra configuração']], plataforma: true, mensagem: 'Diga o que você precisa configurar *', placeholder: 'Explique qual resultado deseja e onde encontrou dificuldade…' },
    duvida_funcionalidade: { pergunta: 'Sobre qual área é a dúvida?', opcoes: [['os', 'Ordens de serviço'], ['clientes', 'Clientes'], ['documentos', 'Documentos e assinaturas'], ['estoque', 'Estoque, compras ou vendas'], ['financeiro', 'Financeiro e cobranças'], ['usuarios', 'Usuários e permissões'], ['ia', 'Assistente de IA'], ['relatorios', 'Relatórios'], ['outro', 'Outra área']], mensagem: 'Qual é a sua dúvida? *', placeholder: 'Conte o que deseja fazer no sistema…' },
    sugestao: { pergunta: 'Qual área pode melhorar?', opcoes: [['os', 'Ordens de serviço'], ['clientes', 'Clientes'], ['documentos', 'Documentos e assinaturas'], ['estoque', 'Estoque, compras ou vendas'], ['financeiro', 'Financeiro e cobranças'], ['usuarios', 'Usuários e permissões'], ['ia', 'Assistente de IA'], ['relatorios', 'Relatórios'], ['outro', 'Outra área']], mensagem: 'Conte sua sugestão *', placeholder: 'Explique a melhoria e como ela ajudaria no trabalho…' },
    outro: { mensagem: 'Explique como podemos ajudar *', placeholder: 'Descreva sua solicitação…' }
  };
  function nomeStatus(valor) { return ({ aberto: 'Aguardando suporte', em_atendimento: 'Atendido', resolvido: 'Finalizado', fechado: 'Finalizado', cancelado: 'Cancelado' })[texto(valor)] || 'Aberto'; }
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
      '<form id="form-novo-chamado-app" class="form-novo-chamado-app" novalidate hidden>' +
      '<div class="novo-chamado-app-titulo"><strong>Como podemos ajudar?</strong><span>Os campos mudam conforme o motivo. Mostraremos somente o necessário.</span></div>' +
      '<div class="suporte-motivo-principal-app"><label for="motivo-novo-chamado-app">Motivo do chamado *</label><select id="motivo-novo-chamado-app"><option value="">Selecione o motivo</option>' + Object.keys(MOTIVOS).map(function (valor) { return '<option value="' + valor + '">' + MOTIVOS[valor] + '</option>'; }).join('') + '</select></div>' +
      '<div id="campo-motivo-outro-novo-chamado-app" hidden><label for="motivo-outro-novo-chamado-app">Qual é o motivo? *</label><input id="motivo-outro-novo-chamado-app" maxlength="160"></div>' +
      '<div id="detalhes-novo-chamado-app" class="detalhes-novo-chamado-app" hidden>' +
        '<div id="campo-detalhe-novo-chamado-app" hidden><label id="label-detalhe-novo-chamado-app" for="detalhe-novo-chamado-app">O que aconteceu?</label><select id="detalhe-novo-chamado-app"></select></div>' +
        '<div id="campo-plataforma-novo-chamado-app" hidden><label for="plataforma-novo-chamado-app">Onde acontece? *</label><select id="plataforma-novo-chamado-app"><option value="celular">Celular</option><option value="pc">Computador</option><option value="ambos">Computador e celular</option></select></div>' +
        '<div id="campo-complemento-novo-chamado-app" hidden><label id="label-complemento-novo-chamado-app" for="complemento-novo-chamado-app">Detalhe</label><select id="complemento-novo-chamado-app"></select></div>' +
        '<div id="campo-referencia-novo-chamado-app" hidden><label id="label-referencia-novo-chamado-app" for="referencia-novo-chamado-app">OS ou documento relacionado</label><input id="referencia-novo-chamado-app" maxlength="80" placeholder="Ex.: OS-0020"></div>' +
        '<div><label id="label-descricao-novo-chamado-app" for="descricao-novo-chamado-app">Explique o que aconteceu *</label><textarea id="descricao-novo-chamado-app" rows="5" maxlength="8000" placeholder="Conte o que tentou fazer e o que apareceu na tela…"></textarea></div>' +
        '<div class="suporte-identidade-automatica-app"><strong>Empresa e usuário identificados automaticamente</strong><span>O chamado será vinculado com segurança ao acesso atual.</span></div>' +
        '<div class="suporte-form-secao-app"><strong>Contato para retorno</strong><span>Informe apenas como o suporte pode falar com você.</span></div>' +
        '<div><label for="telefone-novo-chamado-app">Telefone ou WhatsApp *</label><input id="telefone-novo-chamado-app" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" placeholder="(00) 00000-0000"></div>' +
        '<div><label for="email-novo-chamado-app">E-mail <span class="campo-opcional-app">opcional</span></label><input id="email-novo-chamado-app" type="email" maxlength="160" autocomplete="email"></div>' +
      '</div>' +
      '<input type="hidden" id="cargo-novo-chamado-app" value=""><input type="hidden" id="cargo-outro-novo-chamado-app"><input type="hidden" id="preferencia-contato-novo-chamado-app" value="whatsapp"><input type="hidden" id="horario-contato-novo-chamado-app"><input type="hidden" id="prioridade-novo-chamado-app" value="normal"><input type="hidden" id="assunto-novo-chamado-app">' +
      '<p id="status-novo-chamado-app" class="suporte-status" role="status"></p><div class="novo-chamado-app-acoes"><button type="button" id="cancelar-novo-chamado-app" class="btn-secundario">Cancelar</button><button type="submit" id="enviar-novo-chamado-app" class="btn-primario">Enviar chamado</button></div></form>' +
      '<main id="conteudo-central-chamados-app" class="conteudo-central-chamados-app">' +
      '<div id="lista-central-chamados-app" class="lista-central-chamados-app"></div>' +
      '<section id="conversa-central-chamados-app" class="conversa-central-chamados-app" hidden><div id="cabecalho-chamado-app" class="cabecalho-chamado-app"></div><div id="mensagens-chamado-app" class="mensagens-chamado-app"></div>' +
      '<form id="form-mensagem-chamado-app" class="form-mensagem-chamado-app"><textarea id="mensagem-chamado-app" maxlength="8000" rows="3" placeholder="Escreva uma mensagem…"></textarea><button type="submit" class="btn-primario">Enviar mensagem</button></form></section>' +
      '<p id="status-chamados-app" class="suporte-status"></p></main>';
    document.body.appendChild(tela);
    root.SistemaOSAnexosChamado.montar($('form-novo-chamado-app'),'prints-novo-chamado-app');
    root.SistemaOSAnexosChamado.montar($('form-mensagem-chamado-app'),'prints-resposta-chamado-app');
    var nav=document.createElement('div');nav.className='novo-chamado-app-acoes';
    var historico=document.createElement('button');historico.type='button';historico.className='btn-secundario';historico.textContent='Histórico de chamados';historico.onclick=()=>abrir().catch(function(){});
    var novo=document.createElement('button');novo.type='button';novo.className='btn-primario';novo.textContent='Novo chamado';novo.onclick=()=>mostrarNovo(novoContexto||{origem:'config_celular'});
    nav.append(historico,novo);tela.querySelector('header').after(nav);
    var visitante=document.createElement('div');visitante.id='visitante-chamado-app';visitante.hidden=true;
    visitante.innerHTML='<label><input type="checkbox" id="sem-conta-chamado-app"> Ainda não tenho conta</label><label>Seu nome<input id="nome-visitante-chamado-app" maxlength="120"></label><p>Sem conta, acompanhe pelo histórico neste aparelho. Somente quem tem o acesso de acompanhamento e o suporte pode ler este chamado.</p>';
    $('form-novo-chamado-app').prepend(visitante);
    $('fechar-central-chamados').addEventListener('click', fechar);
    $('cancelar-novo-chamado-app').addEventListener('click', function () { abrir().catch(function () {}); });
    $('form-novo-chamado-app').addEventListener('submit', enviarNovo);
    $('motivo-novo-chamado-app').addEventListener('change', atualizarCondicionais);
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
    var fluxo = FLUXOS_MOTIVO[motivo] || null;
    function preencherSelect(id, pergunta, opcoes) {
      var select = $(id); select.innerHTML = '';
      var inicial = document.createElement('option'); inicial.value = ''; inicial.textContent = 'Selecione'; select.appendChild(inicial);
      (opcoes || []).forEach(function (item) { var opcao = document.createElement('option'); opcao.value = item[0]; opcao.textContent = item[1]; select.appendChild(opcao); });
      if (pergunta) select.setAttribute('aria-label', pergunta);
    }
    $('detalhes-novo-chamado-app').hidden = !motivo;
    $('campo-motivo-outro-novo-chamado-app').hidden = motivo !== 'outro';
    if (motivo !== 'outro') $('motivo-outro-novo-chamado-app').value = '';
    if (!(fluxo && fluxo.opcoes)) $('detalhe-novo-chamado-app').innerHTML = '';
    if (!(fluxo && fluxo.complemento)) $('complemento-novo-chamado-app').innerHTML = '';
    if (!(fluxo && fluxo.referencia)) $('referencia-novo-chamado-app').value = '';
    $('campo-detalhe-novo-chamado-app').hidden = !(fluxo && fluxo.opcoes && fluxo.opcoes.length);
    if (fluxo && fluxo.opcoes && fluxo.opcoes.length) { $('label-detalhe-novo-chamado-app').textContent = fluxo.pergunta + ' *'; preencherSelect('detalhe-novo-chamado-app', fluxo.pergunta, fluxo.opcoes); }
    $('campo-plataforma-novo-chamado-app').hidden = !(fluxo && fluxo.plataforma);
    $('campo-complemento-novo-chamado-app').hidden = !(fluxo && fluxo.complemento);
    if (fluxo && fluxo.complemento) { $('label-complemento-novo-chamado-app').textContent = fluxo.complemento.pergunta + ' *'; preencherSelect('complemento-novo-chamado-app', fluxo.complemento.pergunta, fluxo.complemento.opcoes); }
    $('campo-referencia-novo-chamado-app').hidden = !(fluxo && fluxo.referencia);
    if (fluxo && fluxo.referencia) $('label-referencia-novo-chamado-app').textContent = fluxo.referencia;
    $('label-descricao-novo-chamado-app').textContent = fluxo && fluxo.mensagem ? fluxo.mensagem : 'Explique o que aconteceu *';
    $('descricao-novo-chamado-app').placeholder = fluxo && fluxo.placeholder ? fluxo.placeholder : 'Conte o que tentou fazer e o que apareceu na tela…';
    $('assunto-novo-chamado-app').value = motivo ? MOTIVOS[motivo] : '';
  }
  function mostrarNovo(contexto) {
    geracao++; atual = null;
    estrutura(); novoContexto = Object.assign({}, contexto || {});
    var publico = texto(novoContexto.origem).indexOf('login_') === 0;
    $('visitante-chamado-app').hidden=!publico;$('sem-conta-chamado-app').checked=false;
    $('nome-visitante-chamado-app').value=novoContexto.nome||novoContexto.usuario||'';
    $('prints-novo-chamado-app').value='';
    var estado = root.SistemaOSSessao && root.SistemaOSSessao.obterEstado ? root.SistemaOSSessao.obterEstado() : {};
    var contextoSessao = estado.contexto || {};
    var usuarioSessao = estado.usuario || {};
    var usuarioLogin = novoContexto.usuario || (usuarioSessao.user_metadata && usuarioSessao.user_metadata.usuario) || contextoSessao.usuario || '';
    novoContexto.usuario = usuarioLogin;
    novoContexto.nome = novoContexto.nome || contextoSessao.perfil_nome || usuarioLogin;
    $('telefone-novo-chamado-app').value = novoContexto.telefone || novoContexto.contato || '';
    $('email-novo-chamado-app').value = novoContexto.email || '';
    $('cargo-novo-chamado-app').value = novoContexto.cargoEmpresa || '';
    $('motivo-novo-chamado-app').value = novoContexto.motivo || '';
    $('motivo-outro-novo-chamado-app').value = '';
    $('plataforma-novo-chamado-app').value = novoContexto.plataforma || 'celular';
    $('detalhe-novo-chamado-app').innerHTML = '';
    $('complemento-novo-chamado-app').innerHTML = '';
    $('referencia-novo-chamado-app').value = '';
    $('assunto-novo-chamado-app').value = novoContexto.assunto || '';
    $('descricao-novo-chamado-app').value = novoContexto.mensagem || '';
    atualizarCondicionais();
    $('status-novo-chamado-app').textContent = '';
    $('form-novo-chamado-app').hidden = false;
    $('conteudo-central-chamados-app').hidden = true;
    setTimeout(function () { $('motivo-novo-chamado-app').focus(); }, 60);
  }
  function ocultarNovo() {
    geracao++;
    $('form-novo-chamado-app').hidden = true;
    $('conteudo-central-chamados-app').hidden = false;
    atual=null;clearInterval(timer);if(canal) cliente().removeChannel(canal);canal=null;timer=null;
    $('conversa-central-chamados-app').hidden=true;
  }
  async function enviarNovo(evento) {
    evento.preventDefault();
    if ($('enviar-novo-chamado-app').disabled) return;
    var publico = texto(novoContexto && novoContexto.origem).indexOf('login_') === 0;
    var semConta = publico && $('sem-conta-chamado-app').checked;
    var empresa = texto(novoContexto && novoContexto.empresa).trim().toLowerCase();
    var usuario = texto(novoContexto && novoContexto.usuario).trim().toLowerCase();
    var nome = texto(semConta ? $('nome-visitante-chamado-app').value : novoContexto && (novoContexto.nome || novoContexto.usuario)).trim();
    var telefone = somenteDigitos($('telefone-novo-chamado-app').value);
    var email = $('email-novo-chamado-app').value.trim().toLowerCase();
    var preferenciaContato = $('preferencia-contato-novo-chamado-app').value;
    var cargoEmpresa = $('cargo-novo-chamado-app').value;
    var cargoOutro = $('cargo-outro-novo-chamado-app').value.trim();
    var motivo = $('motivo-novo-chamado-app').value;
    var motivoOutro = $('motivo-outro-novo-chamado-app').value.trim();
    var fluxo = FLUXOS_MOTIVO[motivo] || null;
    var detalhe = $('detalhe-novo-chamado-app').value;
    var complemento = $('complemento-novo-chamado-app').value;
    var detalheOpcao = $('detalhe-novo-chamado-app').options[$('detalhe-novo-chamado-app').selectedIndex];
    var detalheRotulo = detalheOpcao ? detalheOpcao.textContent : '';
    var assunto = [MOTIVOS[motivo], detalheRotulo && detalheRotulo !== 'Selecione' ? detalheRotulo : ''].filter(Boolean).join(' — ');
    var mensagem = $('descricao-novo-chamado-app').value.trim();
    if (publico && !semConta && !/^[a-z0-9-]{3,40}$/.test(empresa)) { $('status-novo-chamado-app').textContent = 'Preencha o código da empresa na tela de entrada antes de abrir o suporte.'; return; }
    if (publico && ((!semConta && !/^[a-z0-9._-]{3,30}$/.test(usuario)) || nome.length < 2)) { $('status-novo-chamado-app').textContent = 'Informe seu nome ou preencha o usuário na tela de entrada.'; return; }
    if (!/^\d{10,15}$/.test(telefone)) { $('status-novo-chamado-app').textContent = 'Informe um telefone ou WhatsApp com DDD.'; return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('status-novo-chamado-app').textContent = 'Confira o e-mail informado.'; return; }
    if (!motivo || (motivo === 'outro' && motivoOutro.length < 3)) { $('status-novo-chamado-app').textContent = 'Selecione ou descreva o motivo do chamado.'; $('motivo-novo-chamado-app').focus(); return; }
    if (fluxo && fluxo.opcoes && fluxo.opcoes.length && !detalhe) { $('status-novo-chamado-app').textContent = 'Escolha a opção que melhor descreve sua solicitação.'; $('detalhe-novo-chamado-app').focus(); return; }
    if (fluxo && fluxo.complemento && !complemento) { $('status-novo-chamado-app').textContent = 'Preencha o detalhe solicitado para este motivo.'; $('complemento-novo-chamado-app').focus(); return; }
    if (!assunto || mensagem.length < 10) { $('status-novo-chamado-app').textContent = 'Explique a solicitação com pelo menos 10 caracteres.'; $('descricao-novo-chamado-app').focus(); return; }
    var botao = $('enviar-novo-chamado-app'); botao.disabled = true; botao.textContent = 'Enviando…';
    $('status-novo-chamado-app').textContent = 'Enviando o chamado com segurança…';
    try {
      var acao = publico ? 'criar_publico' : 'criar_autenticado';
      var resposta = await invocar(acao, Object.assign(publico ? { empresa: empresa, nome: nome, usuario: usuario } : {}, { origem: novoContexto.origem || 'config_celular',
        telefone: telefone, email: email, preferenciaContato: preferenciaContato,
        horarioContato: $('horario-contato-novo-chamado-app').value.trim(), cargoEmpresa: cargoEmpresa,
        cargoOutro: cargoOutro, motivo: motivo, motivoOutro: motivoOutro,
        detalhe: detalhe, complemento: complemento,
        plataforma: fluxo && fluxo.plataforma ? $('plataforma-novo-chamado-app').value : '',
        referencia: fluxo && fluxo.referencia ? $('referencia-novo-chamado-app').value.trim() : '', assunto: assunto,
        prioridade: $('prioridade-novo-chamado-app').value, mensagem: mensagem, semConta:semConta,
        anexos:await root.SistemaOSAnexosChamado.ler('prints-novo-chamado-app') }));
      if (!resposta.sucesso || !resposta.chamadoId) throw new Error('O servidor não confirmou a abertura do chamado. Tente novamente.');
      registrar(resposta); ocultarNovo();
      try { await carregarEAbrir(''); }
      catch (_) { $('status-chamados-app').textContent = 'Chamado ' + (resposta.protocolo || '') + ' enviado. Reabra o suporte para carregar a conversa.'; }
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
      item.append(autor, corpo, data);root.SistemaOSAnexosChamado.mostrar(item,mensagem.anexos);alvo.appendChild(item);
    });
    alvo.scrollTop = alvo.scrollHeight;
  }
  async function atualizarConversa(silencioso) {
    if (!atual) return;
    var selecionado = atual;
    var versao = geracao;
    var resposta = atual._modo === 'publico'
      ? await invocar('acompanhar_publico', { token: atual._token })
      : await invocar('listar_mensagens', { chamadoId: atual.id });
    if (versao !== geracao || !atual || atual.id !== selecionado.id) return;
    atual = Object.assign({}, selecionado, resposta.chamado || {});
    $('cabecalho-chamado-app').textContent = (atual.protocolo || 'Chamado') + ' · ' + nomeStatus(atual.status) + ' · ' + (atual.assunto || 'Atendimento');
    desenharMensagens(resposta.mensagens || []);
    var encerrado = ['resolvido', 'fechado', 'cancelado'].indexOf(texto(atual.status)) >= 0;
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
    geracao++;
    $('mensagens-chamado-app').replaceChildren();
    $('mensagem-chamado-app').value = '';
    $('prints-resposta-chamado-app').value = '';
    atual = chamado; localStorage.setItem(CHAVE_ATUAL, chamado.id || ''); $('conversa-central-chamados-app').hidden = false; $('status-chamados-app').textContent = 'Carregando conversa…';
    try { await atualizarConversa(false); iniciarTempoReal(); } catch (erro) { $('status-chamados-app').textContent = texto(erro && erro.message ? erro.message : erro); }
  }
  async function enviar(evento) {
    evento.preventDefault(); if (!atual) return;
    if (['resolvido', 'fechado', 'cancelado'].indexOf(texto(atual.status)) >= 0) {
      $('status-chamados-app').textContent = 'Este chamado está encerrado e não aceita novas mensagens.';
      return;
    }
    var campo = $('mensagem-chamado-app'); var mensagem = campo.value.trim(); if (!mensagem) return;
    var botao = evento.currentTarget.querySelector('button'); if(botao.disabled) return;botao.disabled = true;
    var selecionado=atual;var versao=geracao;
    try {
      var acao = atual._modo === 'suporte' ? 'responder_suporte' : atual._modo === 'publico' ? 'responder_publico' : 'responder_autenticado';
      await invocar(acao, { chamadoId: selecionado.id, token: selecionado._token || '', mensagem: mensagem, anexos:await root.SistemaOSAnexosChamado.ler('prints-resposta-chamado-app') });
      if(versao!==geracao || atual?.id!==selecionado.id) return;
      campo.value = ''; $('prints-resposta-chamado-app').value='';await atualizarConversa(true); $('status-chamados-app').textContent = 'Mensagem enviada.';
    } catch (erro) { $('status-chamados-app').textContent = texto(erro && erro.message ? erro.message : erro); }
    finally { botao.disabled = ['resolvido','fechado','cancelado'].includes(atual?.status); }
  }
  async function carregar() {
    var versao = geracao;
    var lista = [];
    var autenticado = false;
    try { var meus = await invocar('listar_meus', {}); autenticado = true; (meus.chamados || []).forEach(function (item) { lista.push(Object.assign({ _modo: 'autenticado' }, item)); }); } catch (erro) {
      if (root.SistemaOSSessao?.obterEstado?.().usuario) throw erro;
    }
    for (var i = 0; !autenticado && i < locais().length; i++) {
      var salvo = locais()[i];
      try { var publico = await invocar('acompanhar_publico', { token: salvo.tokenAcompanhamento }); if (publico.chamado && !lista.some(function (item) { return item.id === publico.chamado.id; })) lista.push(Object.assign({ _modo: 'publico', _token: salvo.tokenAcompanhamento }, publico.chamado)); } catch (_) {}
    }
    if (versao !== geracao) return [];
    chamados = lista.sort(function (a, b) { return texto(b.ultima_mensagem_em).localeCompare(texto(a.ultima_mensagem_em)); }); desenharLista(); return chamados;
  }
  async function carregarEAbrir(chamadoId) {
    await carregar();
    var preferido = chamadoId ? chamados.find(function (item) { return item.id === chamadoId; }) : null;
    $('status-chamados-app').textContent = chamados.length ? 'Atendimento conectado.' : 'Nenhum chamado neste acesso.';
    if (preferido) await abrirConversa(preferido);
  }
  async function abrir(contexto) { estrutura(); if (contexto) novoContexto=Object.assign({},contexto); $('central-chamados-app').hidden = false; ocultarNovo(); chamados=[];desenharLista();$('status-chamados-app').textContent = 'Buscando chamados…'; await carregarEAbrir(''); }
  async function abrirNovo(contexto) { estrutura(); $('central-chamados-app').hidden = false; mostrarNovo(contexto || {}); }
  async function abrirSuporte(chamado) { estrutura(); $('central-chamados-app').hidden = false; chamados = [Object.assign({ _modo: 'suporte' }, chamado)]; desenharLista(); await abrirConversa(chamados[0]); }
  function fechar() { geracao++; clearInterval(timer); if (canal) cliente().removeChannel(canal); canal = null; timer = null; atual = null; if ($('central-chamados-app')) $('central-chamados-app').hidden = true; }
  document.addEventListener('sistema-os:sessao-alterada', function () { fechar(); chamados=[]; novoContexto=null; $('lista-central-chamados-app')?.replaceChildren(); $('mensagens-chamado-app')?.replaceChildren(); });
  root.SistemaOSChamados = Object.freeze({ registrar: registrar, abrir: abrir, abrirNovo: abrirNovo, abrirSuporte: abrirSuporte });
})(typeof globalThis !== 'undefined' ? globalThis : this);
