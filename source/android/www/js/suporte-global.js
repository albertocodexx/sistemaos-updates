/* Central exclusiva da conta de suporte. Não reutiliza telas de uma empresa. */
(function (root) {
  'use strict';
  var painel = document.getElementById('painel-suporte-global');
  if (!painel) return;
  var lista = document.getElementById('suporte-lista-empresas');
  var busca = document.getElementById('suporte-busca-empresa');
  var status = document.getElementById('suporte-status');
  var listaChamados = document.getElementById('suporte-lista-chamados');
  var listaErros = document.getElementById('suporte-lista-erros');
  var filtroErros = document.getElementById('suporte-filtro-erros');
  var btnSair = document.getElementById('btn-suporte-sair');
  var cache = [];
  var chamados = [];
  var errosUsuarios = [];

  function ehSuporte(estado) {
    return !!(estado && estado.contexto && estado.contexto.administrador_global === true);
  }
  function texto(valor) { return String(valor == null ? '' : valor); }
  function estadoLicenca(valor) {
    return ({ ativa: 'Ativa', teste: 'Trial', vencendo: 'Vencendo', vencida: 'Vencida',
      periodo_graca: 'Período de graça', suspensa: 'Suspensa', cancelada: 'Cancelada', bloqueada: 'Bloqueada' })[texto(valor).toLowerCase()] || 'Sem status';
  }
  function desenhar() {
    var termo = texto(busca.value).trim().toLowerCase();
    var empresas = cache.filter(function (empresa) {
      return !termo || (texto(empresa.nome_fantasia) + ' ' + texto(empresa.codigo)).toLowerCase().indexOf(termo) !== -1;
    });
    lista.innerHTML = '';
    if (!empresas.length) {
      lista.innerHTML = '<p class="suporte-vazio">Nenhuma empresa encontrada.</p>';
      return;
    }
    empresas.forEach(function (empresa) {
      var card = document.createElement('article');
      card.className = 'suporte-empresa-card';
      var vencimento = empresa.data_vencimento || empresa.fim_trial;
      card.innerHTML = '<strong></strong><p></p><small></small>';
      card.querySelector('strong').textContent = empresa.nome_fantasia || empresa.codigo || 'Empresa sem nome';
      card.querySelector('p').textContent = 'Código: ' + (empresa.codigo || '—') + ' · ' + estadoLicenca(empresa.licenca_status);
      card.querySelector('small').textContent = vencimento ? 'Vencimento: ' + new Date(vencimento).toLocaleDateString('pt-BR') : 'Sem vencimento definido';
      lista.appendChild(card);
    });
  }

  function origemChamado(origem) {
    return ({ login_pc: 'Login do PC', login_celular: 'Login do celular', config_pc: 'Configurações do PC', config_celular: 'Configurações do celular' })[texto(origem)] || 'Origem não informada';
  }
  function statusChamado(valor) {
    return ({ aberto: 'Aberto', em_atendimento: 'Em atendimento', resolvido: 'Resolvido', fechado: 'Fechado' })[texto(valor)] || 'Aberto';
  }
  function motivoChamado(valor, outro) {
    if (valor === 'outro' && outro) return outro;
    return ({ trial_assinatura: 'Trial / assinatura', cobranca_pagamento: 'Cobrança / pagamento',
      acesso_login: 'Acesso / login', sincronizacao_backup: 'Sincronização / backup',
      documento_assinatura: 'Documento / assinatura', erro_sistema: 'Erro no sistema',
      configuracao_integracao: 'Configuração / integração', duvida_funcionalidade: 'Dúvida',
      sugestao: 'Sugestão', outro: 'Outro motivo' })[texto(valor)] || 'Motivo não informado';
  }
  function desenharChamados() {
    if (!listaChamados) return;
    listaChamados.innerHTML = '';
    if (!chamados.length) {
      listaChamados.innerHTML = '<p class="suporte-vazio">Nenhum chamado recebido.</p>';
      return;
    }
    chamados.forEach(function (chamado) {
      var card = document.createElement('article');
      card.className = 'suporte-chamado-card';
      var titulo = document.createElement('strong');
      titulo.textContent = 'CH-' + texto(chamado.id).slice(0, 8).toUpperCase() + ' — ' + (chamado.empresa && (chamado.empresa.nome_fantasia || chamado.empresa.codigo) || 'Empresa removida');
      var meta = document.createElement('small');
      meta.textContent = [statusChamado(chamado.status), origemChamado(chamado.origem), motivoChamado(chamado.motivo, chamado.motivo_outro), chamado.contato_nome || 'Sem nome', chamado.contato_usuario ? 'usuário ' + chamado.contato_usuario : '', chamado.criado_em ? new Date(chamado.criado_em).toLocaleString('pt-BR') : ''].filter(Boolean).join(' · ');
      var contato = document.createElement('small');
      contato.textContent = [chamado.telefone_contato ? 'Tel. ' + chamado.telefone_contato : '', chamado.email_contato || '', chamado.preferencia_contato ? 'retorno por ' + chamado.preferencia_contato : '', chamado.cargo_outro || chamado.cargo_empresa || ''].filter(Boolean).join(' · ');
      var mensagem = document.createElement('p');
      mensagem.textContent = texto(chamado.mensagem);
      card.append(titulo, meta, contato, mensagem);
      if (chamado.resolucao) {
        var resposta = document.createElement('small');
        resposta.textContent = 'Resposta: ' + texto(chamado.resolucao);
        card.appendChild(resposta);
      }
      var acoes = document.createElement('div'); acoes.className = 'suporte-chamado-acoes';
      if (['resolvido', 'fechado'].indexOf(texto(chamado.status)) === -1) {
        if (chamado.status === 'aberto') {
          var assumir = document.createElement('button'); assumir.type = 'button'; assumir.className = 'btn-secundario'; assumir.textContent = 'Assumir';
          assumir.addEventListener('click', function () { atualizarChamado(chamado, 'em_atendimento'); }); acoes.appendChild(assumir);
        }
        var resolver = document.createElement('button'); resolver.type = 'button'; resolver.className = 'btn-primario'; resolver.textContent = 'Finalizar';
        resolver.addEventListener('click', function () { atualizarChamado(chamado, 'resolvido'); });
        acoes.appendChild(resolver);
      } else {
        var reabrir = document.createElement('button'); reabrir.type = 'button'; reabrir.className = 'btn-secundario'; reabrir.textContent = 'Reabrir';
        reabrir.addEventListener('click', function () { atualizarChamado(chamado, 'aberto'); });
        acoes.appendChild(reabrir);
      }
      var conversa = document.createElement('button');
      conversa.type = 'button'; conversa.className = 'btn-secundario suporte-abrir-conversa';
      conversa.textContent = (chamado.nao_lidas_suporte ? '(' + chamado.nao_lidas_suporte + ') ' : '') + 'Abrir conversa';
      conversa.addEventListener('click', function () {
        if (root.SistemaOSChamados) root.SistemaOSChamados.abrirSuporte(chamado).catch(function (erro) {
          status.textContent = 'Não foi possível abrir a conversa: ' + texto(erro && erro.message ? erro.message : erro);
        });
      });
      var excluir = document.createElement('button'); excluir.type = 'button'; excluir.className = 'btn-perigo'; excluir.textContent = 'Excluir';
      excluir.addEventListener('click', function () { excluirChamado(chamado); });
      acoes.append(conversa, excluir);
      card.appendChild(acoes);
      listaChamados.appendChild(card);
    });
  }
  function desenharErros() {
    if (!listaErros) return;
    var filtro = filtroErros ? filtroErros.value : 'aberto';
    var registros = errosUsuarios.filter(function (registro) {
      return filtro === 'todos' || texto(registro.status || 'aberto') === filtro;
    });
    listaErros.innerHTML = '';
    if (!registros.length) {
      listaErros.innerHTML = '<p class="suporte-vazio">Nenhum relatorio de erro neste filtro.</p>';
      return;
    }
    registros.forEach(function (registro) {
      var card = document.createElement('article');
      card.className = 'suporte-erro-card';
      card.dataset.prioridade = texto(registro.prioridade || 'normal');
      var empresa = registro.empresa && (registro.empresa.nome_fantasia || registro.empresa.codigo) || 'Empresa removida';
      var titulo = document.createElement('strong');
      titulo.textContent = empresa + ' - ' + texto(registro.origem || 'sistema').toUpperCase();
      var meta = document.createElement('small');
      meta.textContent = [texto(registro.status || 'aberto'), texto(registro.prioridade || 'normal'), registro.tela, registro.versao ? 'v' + registro.versao : '', registro.criado_em ? new Date(registro.criado_em).toLocaleString('pt-BR') : ''].filter(Boolean).join(' | ');
      var mensagem = document.createElement('p');
      mensagem.textContent = texto(registro.mensagem || 'Erro sem mensagem.');
      var acoes = document.createElement('div');
      acoes.className = 'suporte-erro-acoes';
      [['analisando', 'Analisar'], ['resolvido', 'Resolver'], ['ignorado', 'Ignorar']].forEach(function (opcao) {
        if (texto(registro.status) === opcao[0]) return;
        var botao = document.createElement('button');
        botao.type = 'button';
        botao.className = opcao[0] === 'resolvido' ? 'btn-primario' : 'btn-secundario';
        botao.textContent = opcao[1];
        botao.addEventListener('click', function () { atualizarErro(registro, opcao[0], botao); });
        acoes.appendChild(botao);
      });
      card.append(titulo, meta, mensagem, acoes);
      listaErros.appendChild(card);
    });
  }
  async function atualizarErro(registro, novoStatus, botao) {
    botao.disabled = true;
    try {
      var resposta = await root.SupabaseClientApp.obterCliente().functions.invoke('admin-global', { body: { acao: 'atualizar_erro_usuario', dados: { erroId: registro.id, status: novoStatus } } });
      if (resposta.error && root.SistemaOSEdgeError) await root.SistemaOSEdgeError.lancar(resposta.error, 'Nao foi possivel atualizar o relatorio.');
      if (resposta.error) throw resposta.error;
      if (resposta.data && resposta.data.erro) throw new Error(resposta.data.erro);
      registro.status = novoStatus;
      status.textContent = 'Relatorio de erro atualizado.';
      desenharErros();
    } catch (erro) {
      status.textContent = 'Nao foi possivel atualizar o relatorio: ' + texto(erro && erro.message ? erro.message : erro);
      botao.disabled = false;
    }
  }
  async function atualizarChamado(chamado, novoStatus) {
    var resolucao = '';
    if (novoStatus === 'resolvido' || novoStatus === 'fechado') {
      var valor = window.prompt(novoStatus === 'resolvido' ? 'Resumo da solução (opcional):' : 'Motivo do fechamento (opcional):');
      if (valor === null) return;
      resolucao = texto(valor);
    }
    try {
      var cliente = root.SupabaseClientApp.obterCliente();
      var resposta = await cliente.functions.invoke('chamados-suporte', { body: { acao: 'atualizar', dados: { chamadoId: chamado.id, status: novoStatus, resolucao: resolucao } } });
      if (resposta.error && root.SistemaOSEdgeError) await root.SistemaOSEdgeError.lancar(resposta.error, 'Não foi possível atualizar o chamado.');
      if (resposta.error) throw resposta.error;
      if (resposta.data && resposta.data.erro) throw new Error(resposta.data.erro);
      await carregar();
    } catch (erro) { status.textContent = 'Não foi possível atualizar o chamado: ' + texto(erro && erro.message ? erro.message : erro); }
  }
  async function excluirChamado(chamado) {
    var protocolo = chamado.protocolo || ('CH-' + texto(chamado.id).slice(0, 8).toUpperCase());
    if (!window.confirm('Excluir permanentemente o chamado ' + protocolo + '?\n\nA conversa inteira será apagada e esta ação não pode ser desfeita.')) return;
    var digitado = window.prompt('Digite ' + protocolo + ' para confirmar:');
    if (digitado === null) return;
    if (texto(digitado).trim().toUpperCase() !== protocolo.toUpperCase()) { status.textContent = 'Protocolo de confirmação incorreto.'; return; }
    try {
      if (root.SistemaOSExclusao &&
          !await root.SistemaOSExclusao.autorizar('excluir o chamado ' + protocolo)) return;
      var resposta = await root.SupabaseClientApp.obterCliente().functions.invoke('chamados-suporte', { body: { acao: 'excluir', dados: { chamadoId: chamado.id } } });
      if (resposta.error && root.SistemaOSEdgeError) await root.SistemaOSEdgeError.lancar(resposta.error, 'Não foi possível excluir o chamado.');
      if (resposta.error) throw resposta.error;
      if (resposta.data && resposta.data.erro) throw new Error(resposta.data.erro);
      await carregar();
    } catch (erro) { status.textContent = 'Não foi possível excluir o chamado: ' + texto(erro && erro.message ? erro.message : erro); }
  }
  async function carregar() {
    status.textContent = 'Carregando empresas…';
    try {
      var cliente = root.SupabaseClientApp.obterCliente();
      var resultados = await Promise.all([
        cliente.functions.invoke('admin-global', { body: { acao: 'listar_empresas', dados: {} } }),
        cliente.functions.invoke('chamados-suporte', { body: { acao: 'listar', dados: {} } }),
        cliente.functions.invoke('admin-global', { body: { acao: 'listar_erros_usuarios', dados: {} } })
      ]);
      var resposta = resultados[0];
      var respostaChamados = resultados[1];
      var respostaErros = resultados[2];
      if (resposta.error && root.SistemaOSEdgeError) await root.SistemaOSEdgeError.lancar(resposta.error, 'Não foi possível carregar as empresas.');
      if (resposta.error) throw resposta.error;
      if (resposta.data && resposta.data.erro) throw new Error(resposta.data.erro);
      if (respostaChamados.error && root.SistemaOSEdgeError) await root.SistemaOSEdgeError.lancar(respostaChamados.error, 'Não foi possível carregar os chamados.');
      if (respostaChamados.error) throw respostaChamados.error;
      if (respostaChamados.data && respostaChamados.data.erro) throw new Error(respostaChamados.data.erro);
      if (respostaErros.error && root.SistemaOSEdgeError) await root.SistemaOSEdgeError.lancar(respostaErros.error, 'Nao foi possivel carregar os relatorios de erros.');
      if (respostaErros.error) throw respostaErros.error;
      if (respostaErros.data && respostaErros.data.erro) throw new Error(respostaErros.data.erro);
      cache = resposta.data && Array.isArray(resposta.data.empresas) ? resposta.data.empresas : [];
      chamados = respostaChamados.data && Array.isArray(respostaChamados.data.chamados) ? respostaChamados.data.chamados : [];
      errosUsuarios = respostaErros.data && Array.isArray(respostaErros.data.erros) ? respostaErros.data.erros : [];
      status.textContent = cache.length + ' empresa(s) carregada(s).';
      desenhar();
      desenharChamados();
      desenharErros();
    } catch (erro) {
      status.textContent = 'Não foi possível carregar a central: ' + texto(erro && erro.message ? erro.message : erro);
      lista.innerHTML = '';
      if (listaChamados) listaChamados.innerHTML = '';
      if (listaErros) listaErros.innerHTML = '';
    }
  }
  function aplicar(estado) {
    var suporte = ehSuporte(estado);
    painel.hidden = !suporte;
    document.getElementById('app-topo').hidden = suporte;
    document.getElementById('app-conteudo').hidden = suporte;
    if (suporte) carregar();
  }
  async function sairDoSuporte() {
    if (!root.SistemaOSSessao || typeof root.SistemaOSSessao.sair !== 'function') {
      status.textContent = 'Não foi possível encerrar esta sessão. Feche e abra o aplicativo novamente.';
      return;
    }
    btnSair.disabled = true;
    status.textContent = 'Encerrando sessão…';
    try {
      await root.SistemaOSSessao.sair();
    } catch (erro) {
      status.textContent = 'Não foi possível sair: ' + texto(erro && erro.message ? erro.message : erro);
      btnSair.disabled = false;
    }
  }
  busca.addEventListener('input', desenhar);
  if (filtroErros) filtroErros.addEventListener('change', desenharErros);
  document.getElementById('btn-suporte-atualizar').addEventListener('click', carregar);
  if (btnSair) btnSair.addEventListener('click', sairDoSuporte);
  document.addEventListener('sistema-os:sessao-alterada', function (evento) { aplicar(evento.detail); });
  setTimeout(function () { aplicar(root.SistemaOSSessao && root.SistemaOSSessao.obterEstado()); }, 0);
})(typeof globalThis !== 'undefined' ? globalThis : this);
