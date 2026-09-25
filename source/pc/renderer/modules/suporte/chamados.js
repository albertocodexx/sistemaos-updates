(function (root) {
  'use strict';

  const CHAVE = 'sistemaos_chamados_acompanhamento_v2';
  const CHAVE_ATUAL = 'sistemaos_chamado_atual_v2';
  let chamados = [];
  let atual = null;
  let timer = null;
  let novoContexto = null;
  let geracao = 0;

  const $ = (id) => document.getElementById(id);
  const texto = (valor) => String(valor == null ? '' : valor);
  const somenteDigitos = (valor) => texto(valor).replace(/\D/g, '');
  const motivos = Object.freeze({
    trial_assinatura: 'Período de teste / assinatura',
    cobranca_pagamento: 'Cobrança ou pagamento',
    acesso_login: 'Acesso, senha ou login',
    sincronizacao_backup: 'Sincronização ou backup',
    documento_assinatura: 'PDF, documento ou assinatura',
    erro_sistema: 'Erro no sistema',
    configuracao_integracao: 'Configuração ou integração',
    duvida_funcionalidade: 'Dúvida sobre uma função',
    sugestao: 'Sugestão de melhoria',
    outro: 'Outro motivo'
  });
  const fluxosMotivo = Object.freeze({
    trial_assinatura: {
      pergunta: 'O que você precisa?',
      opcoes: [['contratar', 'Contratar após o período de teste'], ['renovar', 'Renovar assinatura'], ['trocar_plano', 'Trocar de plano'], ['acesso_bloqueado', 'Acesso bloqueado ou vencido'], ['outro', 'Outra questão sobre assinatura']],
      mensagem: 'Conte o que você precisa sobre o teste ou a assinatura *',
      placeholder: 'Ex.: meu período de teste terminou e quero contratar o plano…'
    },
    cobranca_pagamento: {
      pergunta: 'O que aconteceu com o pagamento?',
      opcoes: [['nao_reconhecido', 'Pagamento ainda não reconhecido'], ['checkout', 'Não consigo abrir ou concluir o pagamento'], ['valor_incorreto', 'Valor ou vencimento incorreto'], ['duplicado', 'Cobrança ou pagamento duplicado'], ['reembolso', 'Reembolso ou cancelamento'], ['outro', 'Outro problema de pagamento']],
      referencia: 'Pagamento, cobrança, plano ou protocolo (opcional)',
      mensagem: 'Explique o problema com a cobrança *',
      placeholder: 'Informe o valor, a data e o que apareceu na tela…'
    },
    acesso_login: {
      pergunta: 'Qual é o problema de acesso?',
      opcoes: [['nao_entra', 'Não consigo entrar'], ['senha', 'Senha ou troca de senha'], ['bloqueado', 'Usuário bloqueado ou pausado'], ['trocar_usuario', 'Troca de usuário não funciona'], ['conta', 'Conta ou empresa não aparece'], ['outro', 'Outro problema de acesso']],
      plataforma: true,
      mensagem: 'Explique o que acontece ao tentar entrar *',
      placeholder: 'Ex.: após tocar em Entrar, volto para a mesma tela…'
    },
    sincronizacao_backup: {
      pergunta: 'O que não está sincronizando?',
      opcoes: [['os', 'Ordens de serviço'], ['assinaturas', 'Assinaturas ou documentos'], ['estoque', 'Estoque ou vendas'], ['clientes', 'Clientes'], ['cobrancas', 'Cobranças ou pagamentos'], ['configuracoes', 'Configurações da empresa'], ['backup', 'Backup ou restauração'], ['outro', 'Outro dado']],
      plataforma: true,
      complemento: { pergunta: 'Onde o dado está faltando?', opcoes: [['no_pc', 'Foi criado no celular e não chegou ao PC'], ['no_celular', 'Foi criado no PC e não chegou ao celular'], ['ambos', 'Está diferente nos dois'], ['backup', 'Problema no backup ou restauração']] },
      referencia: 'Número da OS, venda ou registro (opcional)',
      mensagem: 'Diga o que está diferente *',
      placeholder: 'Informe o registro, onde foi criado e o que aparece em cada aparelho…'
    },
    documento_assinatura: {
      pergunta: 'Qual é o problema?',
      opcoes: [['pdf', 'PDF vazio, preto ou incorreto'], ['assinatura_nao_chega', 'Assinatura não chega ao outro aparelho'], ['assinatura_visual', 'Assinatura pequena, torta ou fora do lugar'], ['compartilhar', 'Compartilhar não abre ou não envia'], ['documento_reaparece', 'Documento excluído reaparece'], ['outro', 'Outro problema com documento']],
      plataforma: true,
      complemento: { pergunta: 'Qual documento?', opcoes: [['os', 'Ordem de serviço'], ['entrega', 'Entrega'], ['garantia', 'Garantia'], ['desbloqueio', 'Desbloqueio'], ['compra', 'Compra'], ['venda', 'Venda'], ['outro', 'Outro documento']] },
      referencia: 'Número do documento (opcional)',
      mensagem: 'Explique o problema com o documento *',
      placeholder: 'Conte o que fez e como o PDF ou a assinatura ficou…'
    },
    erro_sistema: {
      pergunta: 'Em qual área ocorreu o erro?',
      opcoes: [['os', 'Ordens de serviço'], ['clientes', 'Clientes'], ['estoque', 'Estoque ou vendas'], ['financeiro', 'Financeiro ou cobranças'], ['usuarios', 'Usuários e permissões'], ['ia', 'Assistente de IA'], ['relatorios', 'Relatórios'], ['configuracoes', 'Configurações'], ['atualizacao', 'Atualização do aplicativo'], ['outro', 'Outra área']],
      plataforma: true,
      complemento: { pergunta: 'Com que frequência acontece?', opcoes: [['sempre', 'Acontece sempre'], ['as_vezes', 'Acontece às vezes'], ['uma_vez', 'Aconteceu uma vez'], ['apos_atualizar', 'Começou depois de uma atualização']] },
      referencia: 'OS, venda ou registro relacionado (opcional)',
      mensagem: 'Descreva o erro *',
      placeholder: 'Informe o que estava fazendo, o que esperava e a mensagem exibida…'
    },
    configuracao_integracao: {
      pergunta: 'Qual configuração ou integração?',
      opcoes: [['whatsapp', 'WhatsApp'], ['mercado_pago', 'Mercado Pago'], ['ia', 'Assistente de IA'], ['nota_fiscal', 'Nota fiscal'], ['backup', 'Backup'], ['atualizacao', 'Atualizações'], ['empresa', 'Dados da empresa'], ['outro', 'Outra configuração']],
      plataforma: true,
      mensagem: 'Diga o que você precisa configurar *',
      placeholder: 'Explique qual resultado deseja e onde encontrou dificuldade…'
    },
    duvida_funcionalidade: {
      pergunta: 'Sobre qual área é a dúvida?',
      opcoes: [['os', 'Ordens de serviço'], ['clientes', 'Clientes'], ['documentos', 'Documentos e assinaturas'], ['estoque', 'Estoque, compras ou vendas'], ['financeiro', 'Financeiro e cobranças'], ['usuarios', 'Usuários e permissões'], ['ia', 'Assistente de IA'], ['relatorios', 'Relatórios'], ['outro', 'Outra área']],
      mensagem: 'Qual é a sua dúvida? *',
      placeholder: 'Conte o que deseja fazer no sistema…'
    },
    sugestao: {
      pergunta: 'Qual área pode melhorar?',
      opcoes: [['os', 'Ordens de serviço'], ['clientes', 'Clientes'], ['documentos', 'Documentos e assinaturas'], ['estoque', 'Estoque, compras ou vendas'], ['financeiro', 'Financeiro e cobranças'], ['usuarios', 'Usuários e permissões'], ['ia', 'Assistente de IA'], ['relatorios', 'Relatórios'], ['outro', 'Outra área']],
      mensagem: 'Conte sua sugestão *',
      placeholder: 'Explique a melhoria e como ela ajudaria no trabalho…'
    },
    outro: {
      mensagem: 'Explique como podemos ajudar *',
      placeholder: 'Descreva sua solicitação…'
    }
  });
  const statusNome = (valor) => ({
    aberto: 'Aguardando suporte', em_atendimento: 'Atendido', resolvido: 'Finalizado', fechado: 'Finalizado', cancelado: 'Cancelado'
  })[texto(valor)] || 'Aberto';

  function notificar(mensagem, tipo) {
    if (typeof root.toast === 'function') root.toast(mensagem, tipo || 'info');
  }

  function carregarLocais() {
    try {
      const dados = JSON.parse(localStorage.getItem(CHAVE) || '[]');
      return Array.isArray(dados) ? dados.filter((item) => item && item.tokenAcompanhamento) : [];
    } catch (_) { return []; }
  }

  function salvarLocais(lista) {
    localStorage.setItem(CHAVE, JSON.stringify(lista.slice(0, 30)));
  }

  function registrar(resultado) {
    if (!resultado?.tokenAcompanhamento || !resultado?.chamadoId) return;
    const lista = carregarLocais().filter((item) => item.chamadoId !== resultado.chamadoId);
    lista.unshift({
      chamadoId: resultado.chamadoId,
      protocolo: resultado.protocolo,
      tokenAcompanhamento: resultado.tokenAcompanhamento,
      registradoEm: new Date().toISOString()
    });
    salvarLocais(lista);
  }

  function criarEstrutura() {
    if ($('modalCentralChamados')) return;
    const modal = document.createElement('div');
    modal.id = 'modalCentralChamados';
    modal.className = 'modal-fundo escondido';
    modal.innerHTML = `
      <div class="modal-caixa suporte-chat-modal">
        <div class="modal-cabecalho suporte-chat-topo">
          <div><h2>Suporte Sistema OS</h2><p class="campo-desc">Abra um chamado ou continue uma conversa anterior.</p></div>
          <button type="button" class="botao-fechar" id="btnFecharCentralChamados" aria-label="Fechar">×</button>
        </div>
        <form id="formNovoChamadoCentral" class="suporte-novo-chamado escondido" novalidate>
          <div class="suporte-novo-chamado-titulo"><strong>Como podemos ajudar?</strong><span>Escolha o motivo. Mostraremos somente o que for necessário.</span></div>
          <div class="suporte-novo-chamado-grade">
            <div class="campo campo-largo suporte-motivo-principal"><label for="motivoNovoChamado">Motivo do chamado *</label><select id="motivoNovoChamado"><option value="">Selecione o motivo</option>${Object.entries(motivos).map(([valor, nome]) => `<option value="${valor}">${nome}</option>`).join('')}</select></div>
            <div class="campo campo-largo" id="campoMotivoOutroNovoChamado" hidden><label for="motivoOutroNovoChamado">Qual é o motivo? *</label><input id="motivoOutroNovoChamado" maxlength="160" /></div>
            <div id="detalhesNovoChamado" class="suporte-detalhes-motivo campo-largo" hidden>
              <div class="campo campo-largo" id="campoDetalheNovoChamado" hidden><label for="detalheNovoChamado" id="labelDetalheNovoChamado">O que aconteceu?</label><select id="detalheNovoChamado"></select></div>
              <div class="campo" id="campoPlataformaNovoChamado" hidden><label for="plataformaNovoChamado">Onde acontece? *</label><select id="plataformaNovoChamado"><option value="pc">Computador</option><option value="celular">Celular</option><option value="ambos">Computador e celular</option></select></div>
              <div class="campo" id="campoComplementoNovoChamado" hidden><label for="complementoNovoChamado" id="labelComplementoNovoChamado">Detalhe</label><select id="complementoNovoChamado"></select></div>
              <div class="campo" id="campoReferenciaNovoChamado" hidden><label for="referenciaNovoChamado" id="labelReferenciaNovoChamado">OS ou documento relacionado</label><input id="referenciaNovoChamado" maxlength="80" placeholder="Ex.: OS-0020" /></div>
              <div class="campo campo-largo"><label for="mensagemNovoChamado" id="labelMensagemNovoChamado">Explique o que aconteceu *</label><textarea id="mensagemNovoChamado" rows="5" maxlength="8000" placeholder="Conte o que tentou fazer e o que apareceu na tela…"></textarea></div>
              <div class="suporte-identidade-automatica campo-largo"><strong>Empresa e usuário identificados automaticamente</strong><span>O chamado será vinculado com segurança ao acesso atual.</span></div>
              <div class="suporte-form-secao campo-largo"><strong>Contato para retorno</strong><span>Informe apenas como o suporte pode falar com você.</span></div>
              <div class="campo"><label for="telefoneNovoChamado">Telefone ou WhatsApp *</label><input id="telefoneNovoChamado" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" placeholder="(00) 00000-0000" /></div>
              <div class="campo"><label for="emailNovoChamado">E-mail <span class="campo-opcional">opcional</span></label><input id="emailNovoChamado" type="email" maxlength="160" autocomplete="email" /></div>
            </div>
            <input type="hidden" id="cargoEmpresaNovoChamado" value="" />
            <input type="hidden" id="cargoOutroNovoChamado" />
            <input type="hidden" id="preferenciaContatoNovoChamado" value="whatsapp" />
            <input type="hidden" id="horarioContatoNovoChamado" />
            <input type="hidden" id="prioridadeNovoChamado" value="normal" />
            <input type="hidden" id="assuntoNovoChamado" />
          </div>
          <p id="statusNovoChamadoCentral" class="campo-desc" role="status"></p>
          <div class="linha-acoes suporte-novo-chamado-acoes"><button type="button" class="botao botao-fantasma" id="btnCancelarNovoChamado">Cancelar</button><button type="submit" class="botao botao-primario" id="btnEnviarNovoChamado">Enviar chamado</button></div>
        </form>
        <div class="suporte-chat-layout" id="layoutCentralChamados">
          <aside class="suporte-chat-lista" id="listaCentralChamados"></aside>
          <section class="suporte-chat-conversa">
            <header id="cabecalhoConversaChamado" class="suporte-chat-cabecalho">
              <strong>Selecione um chamado</strong>
              <span>O histórico aparecerá aqui.</span>
            </header>
            <div id="mensagensCentralChamados" class="suporte-chat-mensagens"></div>
            <form id="formMensagemChamado" class="suporte-chat-form">
              <textarea id="textoMensagemChamado" rows="2" maxlength="8000" placeholder="Escreva uma mensagem para continuar o atendimento…" disabled></textarea>
              <button type="submit" class="botao botao-primario" id="btnEnviarMensagemChamado" disabled>Enviar mensagem</button>
            </form>
            <p id="statusCentralChamados" class="campo-desc suporte-chat-status"></p>
          </section>
        </div>
      </div>`;
    document.body.appendChild(modal);
    root.SistemaOSAnexosChamado.montar($('formNovoChamadoCentral'), 'printsNovoChamado');
    root.SistemaOSAnexosChamado.montar($('formMensagemChamado'), 'printsRespostaChamado');
    const navegacao = document.createElement('div'); navegacao.className='linha-acoes';
    const historico=document.createElement('button');historico.type='button';historico.className='botao botao-secundario';historico.textContent='Histórico de chamados';historico.onclick=()=>abrir().catch(e=>notificar(e.message,'erro'));
    const novo=document.createElement('button');novo.type='button';novo.className='botao botao-primario';novo.textContent='Novo chamado';novo.onclick=()=>mostrarNovoChamado(novoContexto || {origem:'config_pc'});
    navegacao.append(historico,novo);modal.querySelector('.modal-cabecalho').after(navegacao);
    const visitante=document.createElement('div');visitante.id='visitanteChamado';visitante.hidden=true;
    visitante.innerHTML='<label><input type="checkbox" id="semContaChamado"> Ainda não tenho conta</label><label>Seu nome<input id="nomeVisitanteChamado" maxlength="120"></label><p>Sem conta, acompanhe pelo histórico neste aparelho. Somente quem tem o acesso de acompanhamento e o suporte pode ler este chamado.</p>';
    $('formNovoChamadoCentral').prepend(visitante);
    $('btnFecharCentralChamados').addEventListener('click', fechar);
    $('btnCancelarNovoChamado').addEventListener('click', () => abrir().catch(e => notificar(e.message, 'erro')));
    modal.addEventListener('click', (evento) => { if (evento.target === modal) fechar(); });
    $('formMensagemChamado').addEventListener('submit', enviarMensagem);
    $('formNovoChamadoCentral').addEventListener('submit', enviarNovoChamado);
    $('motivoNovoChamado').addEventListener('change', atualizarCamposCondicionais);
    $('textoMensagemChamado').addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter' && !evento.shiftKey) {
        evento.preventDefault();
        if (!$('btnEnviarMensagemChamado').disabled) $('formMensagemChamado').requestSubmit();
      }
    });
  }

  function atualizarCamposCondicionais() {
    const motivo = $('motivoNovoChamado')?.value || '';
    const fluxo = fluxosMotivo[motivo] || null;
    $('detalhesNovoChamado').hidden = !motivo;
    $('campoMotivoOutroNovoChamado').hidden = motivo !== 'outro';
    if (motivo !== 'outro') $('motivoOutroNovoChamado').value = '';
    if (!fluxo?.opcoes) $('detalheNovoChamado').replaceChildren();
    if (!fluxo?.complemento) $('complementoNovoChamado').replaceChildren();
    if (!fluxo?.referencia) $('referenciaNovoChamado').value = '';
    const preencherSelect = (id, pergunta, opcoes) => {
      const select = $(id);
      select.replaceChildren();
      const inicial = document.createElement('option');
      inicial.value = '';
      inicial.textContent = 'Selecione';
      select.appendChild(inicial);
      (opcoes || []).forEach(([valor, rotulo]) => {
        const opcao = document.createElement('option');
        opcao.value = valor;
        opcao.textContent = rotulo;
        select.appendChild(opcao);
      });
      if (pergunta) select.setAttribute('aria-label', pergunta);
    };
    $('campoDetalheNovoChamado').hidden = !fluxo?.opcoes?.length;
    if (fluxo?.opcoes?.length) {
      $('labelDetalheNovoChamado').textContent = fluxo.pergunta + ' *';
      preencherSelect('detalheNovoChamado', fluxo.pergunta, fluxo.opcoes);
    }
    $('campoPlataformaNovoChamado').hidden = !fluxo?.plataforma;
    $('campoComplementoNovoChamado').hidden = !fluxo?.complemento;
    if (fluxo?.complemento) {
      $('labelComplementoNovoChamado').textContent = fluxo.complemento.pergunta + ' *';
      preencherSelect('complementoNovoChamado', fluxo.complemento.pergunta, fluxo.complemento.opcoes);
    }
    $('campoReferenciaNovoChamado').hidden = !fluxo?.referencia;
    if (fluxo?.referencia) $('labelReferenciaNovoChamado').textContent = fluxo.referencia;
    $('labelMensagemNovoChamado').textContent = fluxo?.mensagem || 'Explique o que aconteceu *';
    $('mensagemNovoChamado').placeholder = fluxo?.placeholder || 'Conte o que tentou fazer e o que apareceu na tela…';
    $('assuntoNovoChamado').value = motivo ? motivos[motivo] : '';
  }

  function mostrarNovoChamado(contexto) {
    geracao++; atual = null;
    criarEstrutura();
    novoContexto = Object.assign({}, contexto || {});
    $('visitanteChamado').hidden=!String(novoContexto.origem||'').startsWith('login_');
    $('semContaChamado').checked=false;$('nomeVisitanteChamado').value=novoContexto.nome||novoContexto.usuario||'';
    $('printsNovoChamado').value='';
    $('telefoneNovoChamado').value = novoContexto.telefone || novoContexto.contato || '';
    $('emailNovoChamado').value = novoContexto.email || '';
    $('cargoEmpresaNovoChamado').value = novoContexto.cargoEmpresa || '';
    $('motivoNovoChamado').value = novoContexto.motivo || '';
    $('motivoOutroNovoChamado').value = '';
    $('plataformaNovoChamado').value = novoContexto.plataforma || (novoContexto.origem === 'config_celular' ? 'celular' : 'pc');
    $('detalheNovoChamado').replaceChildren();
    $('complementoNovoChamado').replaceChildren();
    $('referenciaNovoChamado').value = '';
    $('assuntoNovoChamado').value = novoContexto.assunto || '';
    $('mensagemNovoChamado').value = novoContexto.mensagem || '';
    atualizarCamposCondicionais();
    $('statusNovoChamadoCentral').textContent = '';
    $('formNovoChamadoCentral').classList.remove('escondido');
    $('layoutCentralChamados').classList.add('escondido');
    setTimeout(() => $('motivoNovoChamado')?.focus(), 60);
  }

  function ocultarNovoChamado() {
    geracao++;
    $('formNovoChamadoCentral')?.classList.add('escondido');
    $('layoutCentralChamados')?.classList.remove('escondido');
    atual=null;
    $('mensagensCentralChamados')?.replaceChildren();
    if ($('formMensagemChamado')) $('formMensagemChamado').classList.add('escondido');
    if ($('cabecalhoConversaChamado')) $('cabecalhoConversaChamado').textContent='Selecione um chamado para consultar o histórico.';
  }

  async function enviarNovoChamado(evento) {
    evento.preventDefault();
    if ($('btnEnviarNovoChamado').disabled) return;
    const publico = String(novoContexto?.origem || '').startsWith('login_');
    const semConta = publico && $('semContaChamado').checked;
    const empresa = texto(novoContexto?.empresa).trim().toLowerCase();
    const usuario = texto(novoContexto?.usuario).trim().toLowerCase();
    const nome = texto(semConta ? $('nomeVisitanteChamado').value : novoContexto?.nome || novoContexto?.usuario).trim();
    const telefone = somenteDigitos($('telefoneNovoChamado').value);
    const email = $('emailNovoChamado').value.trim().toLowerCase();
    const preferenciaContato = $('preferenciaContatoNovoChamado').value;
    const cargoEmpresa = $('cargoEmpresaNovoChamado').value;
    const cargoOutro = $('cargoOutroNovoChamado').value.trim();
    const motivo = $('motivoNovoChamado').value;
    const motivoOutro = $('motivoOutroNovoChamado').value.trim();
    const fluxo = fluxosMotivo[motivo] || null;
    const detalhe = $('detalheNovoChamado').value;
    const complemento = $('complementoNovoChamado').value;
    const detalheRotulo = $('detalheNovoChamado').selectedOptions?.[0]?.textContent || '';
    const assunto = [motivos[motivo], detalheRotulo && detalheRotulo !== 'Selecione' ? detalheRotulo : ''].filter(Boolean).join(' — ');
    const mensagem = $('mensagemNovoChamado').value.trim();
    if (publico && !semConta && !/^[a-z0-9-]{3,40}$/.test(empresa)) {
      $('statusNovoChamadoCentral').textContent = 'Preencha o código da empresa na tela de entrada antes de abrir o suporte.';
      return;
    }
    if (publico && ((!semConta && !/^[a-z0-9._-]{3,30}$/.test(usuario)) || nome.length < 2)) {
      $('statusNovoChamadoCentral').textContent = 'Preencha o usuário na tela de entrada antes de abrir o suporte.';
      return;
    }
    if (!/^\d{10,15}$/.test(telefone)) {
      $('statusNovoChamadoCentral').textContent = 'Informe um telefone ou WhatsApp com DDD.';
      $('telefoneNovoChamado').focus(); return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      $('statusNovoChamadoCentral').textContent = 'Confira o e-mail informado.';
      $('emailNovoChamado').focus(); return;
    }
    if (!motivo || (motivo === 'outro' && motivoOutro.length < 3)) {
      $('statusNovoChamadoCentral').textContent = 'Selecione ou descreva o motivo do chamado.';
      $('motivoNovoChamado').focus(); return;
    }
    if (fluxo?.opcoes?.length && !detalhe) {
      $('statusNovoChamadoCentral').textContent = 'Escolha a opção que melhor descreve sua solicitação.';
      $('detalheNovoChamado').focus(); return;
    }
    if (fluxo?.complemento && !complemento) {
      $('statusNovoChamadoCentral').textContent = 'Preencha o detalhe solicitado para este motivo.';
      $('complementoNovoChamado').focus(); return;
    }
    if (!assunto || mensagem.length < 10) {
      $('statusNovoChamadoCentral').textContent = 'Explique a solicitação com pelo menos 10 caracteres.';
      $('mensagemNovoChamado').focus();
      return;
    }
    const botao = $('btnEnviarNovoChamado');
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    $('statusNovoChamadoCentral').textContent = 'Criando o chamado com segurança…';
    try {
      const resposta = await root.api?.supabasecriarchamadosuporte?.({
        origem: novoContexto?.origem || 'config_pc',
        ...(publico ? { empresa, nome, usuario } : {}), telefone, email, preferenciaContato,
        horarioContato: $('horarioContatoNovoChamado').value.trim(),
        cargoEmpresa, cargoOutro, motivo, motivoOutro,
        detalhe, complemento,
        plataforma: fluxo?.plataforma ? $('plataformaNovoChamado').value : '',
        referencia: fluxo?.referencia ? $('referenciaNovoChamado').value.trim() : '',
        assunto, prioridade: $('prioridadeNovoChamado').value, mensagem, semConta,
        anexos: await root.SistemaOSAnexosChamado.ler('printsNovoChamado')
      });
      if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível abrir o chamado.');
      registrar(resposta);
      ocultarNovoChamado();
      notificar('Chamado ' + (resposta.protocolo || '') + ' criado.', 'sucesso');
      try { await carregarListaEAbrir(''); }
      catch (_) { $('statusCentralChamados').textContent = 'Chamado ' + (resposta.protocolo || '') + ' enviado. Reabra o suporte para carregar a conversa.'; }
    } catch (erro) {
      $('statusNovoChamadoCentral').textContent = erro.message || String(erro);
    } finally {
      botao.disabled = false;
      botao.textContent = 'Enviar chamado';
    }
  }

  async function invocar(acao, dados) {
    const resultado = await root.api?.supabasechamadosuporte?.(acao, dados || {});
    if (!resultado?.sucesso) throw new Error(resultado?.erro || 'Não foi possível acessar o suporte.');
    return resultado;
  }

  function desenharLista() {
    const lista = $('listaCentralChamados');
    lista.replaceChildren();
    if (!chamados.length) {
      const vazio = document.createElement('p');
      vazio.className = 'historico-vazio';
      vazio.textContent = 'Nenhum chamado encontrado neste acesso.';
      lista.appendChild(vazio);
      return;
    }
    chamados.forEach((chamado) => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'suporte-chat-item' + (atual?.id === chamado.id ? ' ativo' : '');
      const titulo = document.createElement('strong');
      titulo.textContent = chamado.protocolo || ('CH-' + texto(chamado.id).slice(0, 8).toUpperCase());
      const assunto = document.createElement('span');
      assunto.textContent = chamado.assunto || 'Atendimento de suporte';
      const meta = document.createElement('small');
      meta.textContent = statusNome(chamado.status) + (chamado.ultima_mensagem_em ? ' · ' + new Date(chamado.ultima_mensagem_em).toLocaleString('pt-BR') : '');
      botao.append(titulo, assunto, meta);
      botao.addEventListener('click', () => abrirConversa(chamado));
      lista.appendChild(botao);
    });
  }

  function desenharMensagens(mensagens) {
    const alvo = $('mensagensCentralChamados');
    alvo.replaceChildren();
    (mensagens || []).forEach((mensagem) => {
      const balao = document.createElement('article');
      balao.className = 'suporte-chat-balao ' + (mensagem.autor_tipo || 'sistema');
      const autor = document.createElement('strong');
      autor.textContent = mensagem.autor_nome || (mensagem.autor_tipo === 'suporte' ? 'Suporte Sistema OS' : 'Cliente');
      const corpo = document.createElement('p');
      corpo.textContent = mensagem.mensagem || '';
      const data = document.createElement('time');
      data.textContent = mensagem.criado_em ? new Date(mensagem.criado_em).toLocaleString('pt-BR') : '';
      balao.append(autor, corpo, data);
      root.SistemaOSAnexosChamado.mostrar(balao,mensagem.anexos);
      alvo.appendChild(balao);
    });
    alvo.scrollTop = alvo.scrollHeight;
  }

  async function carregarConversa(chamado, silencioso) {
    const versao = geracao;
    let resposta;
    if (chamado._modo === 'publico') {
      resposta = await invocar('acompanhar_publico', { token: chamado._token });
    } else {
      resposta = await invocar('listar_mensagens', { chamadoId: chamado.id });
    }
    if (versao !== geracao || !atual || atual.id !== chamado.id) return;
    const atualizado = Object.assign({}, chamado, resposta.chamado || {});
    atual = atualizado;
    chamados = chamados.map((item) => item.id === atualizado.id ? atualizado : item);
    $('cabecalhoConversaChamado').innerHTML = '';
    const titulo = document.createElement('strong');
    titulo.textContent = (atual.protocolo || 'Chamado') + ' · ' + statusNome(atual.status);
    const assunto = document.createElement('span');
    assunto.textContent = atual.assunto || 'Atendimento de suporte';
    $('cabecalhoConversaChamado').append(titulo, assunto);
    desenharMensagens(resposta.mensagens || []);
    desenharLista();
    const encerrado = ['resolvido', 'fechado', 'cancelado'].includes(String(atual.status));
    $('formMensagemChamado').classList.toggle('escondido', encerrado);
    $('textoMensagemChamado').disabled = encerrado;
    $('btnEnviarMensagemChamado').disabled = encerrado;
    if (encerrado) {
      $('statusCentralChamados').textContent = `Chamado ${statusNome(atual.status).toLowerCase()}. O chat foi encerrado e não aceita novas mensagens.`;
    } else if (!silencioso) $('statusCentralChamados').textContent = 'Conversa atualizada.';
    invocar('marcar_visualizado', { chamadoId: atual.id, token: atual._token || '' }).catch(() => {});
  }

  async function abrirConversa(chamado) {
    geracao++;
    $('mensagensCentralChamados').replaceChildren();
    $('textoMensagemChamado').value = '';
    $('printsRespostaChamado').value = '';
    atual = chamado;
    localStorage.setItem(CHAVE_ATUAL, chamado.id || '');
    $('statusCentralChamados').textContent = 'Carregando conversa…';
    try { await carregarConversa(chamado, false); }
    catch (erro) { $('statusCentralChamados').textContent = erro.message || String(erro); }
  }

  async function enviarMensagem(evento) {
    evento.preventDefault();
    if (!atual) return;
    if (['resolvido', 'fechado', 'cancelado'].includes(String(atual.status))) {
      $('statusCentralChamados').textContent = 'Este chamado está encerrado e não aceita novas mensagens.';
      return;
    }
    const campo = $('textoMensagemChamado');
    const mensagem = campo.value.trim();
    if (!mensagem) return;
    const botao = $('btnEnviarMensagemChamado');
    if (botao.disabled) return;
    const selecionado = atual;
    const versao = geracao;
    botao.disabled = true;
    $('statusCentralChamados').textContent = 'Enviando…';
    try {
      const acao = atual._modo === 'suporte' ? 'responder_suporte'
        : atual._modo === 'publico' ? 'responder_publico' : 'responder_autenticado';
      await invocar(acao, { chamadoId: atual.id, token: atual._token || '', mensagem, anexos:await root.SistemaOSAnexosChamado.ler('printsRespostaChamado') });
      if (versao !== geracao || atual?.id !== selecionado.id) return;
      $('printsRespostaChamado').value='';
      campo.value = '';
      await carregarConversa(atual, true);
      $('statusCentralChamados').textContent = 'Mensagem enviada.';
    } catch (erro) {
      $('statusCentralChamados').textContent = erro.message || String(erro);
    } finally { botao.disabled = ['resolvido', 'fechado', 'cancelado'].includes(String(atual?.status)); }
  }

  async function listarDoAcesso() {
    const encontrados = [];
    try {
      const resposta = await invocar('listar_meus', {});
      (resposta.chamados || []).forEach((item) => encontrados.push(Object.assign({ _modo: 'autenticado' }, item)));
      return encontrados;
    } catch (erro) {
      // Falha na rede numa conta autenticada não deve mostrar chamados públicos de outro acesso.
      if (!String(novoContexto?.origem || '').startsWith('login_')) throw erro;
    }
    for (const salvo of carregarLocais()) {
      try {
        const resposta = await invocar('acompanhar_publico', { token: salvo.tokenAcompanhamento });
        if (resposta.chamado && !encontrados.some((item) => item.id === resposta.chamado.id)) {
          encontrados.push(Object.assign({ _modo: 'publico', _token: salvo.tokenAcompanhamento }, resposta.chamado));
        }
      } catch (_) { /* Token removido ou chamado indisponível. */ }
    }
    return encontrados.sort((a, b) => texto(b.ultima_mensagem_em).localeCompare(texto(a.ultima_mensagem_em)));
  }

  async function carregarListaEAbrir(chamadoId) {
    const versao = geracao;
    const lista = await listarDoAcesso();
    if (versao !== geracao) return;
    chamados = lista;
    desenharLista();
    const preferido = chamadoId ? chamados.find((item) => item.id === chamadoId) : null;
    $('statusCentralChamados').textContent = chamados.length ? 'Atendimento conectado.' : 'Nenhum chamado neste acesso.';
    if (preferido) await abrirConversa(preferido);
  }

  async function abrir(contexto) {
    criarEstrutura();
    if (contexto) novoContexto = Object.assign({}, contexto);
    $('modalCentralChamados').classList.remove('escondido');
    ocultarNovoChamado();
    chamados=[];desenharLista();
    $('statusCentralChamados').textContent = 'Buscando chamados…';
    await carregarListaEAbrir('');
    clearInterval(timer);
    timer = setInterval(() => {
      if (document.hidden || root.__SISTEMA_OS_MODO_SEGUNDO_PLANO__ === true) return;
      if (atual && !$('modalCentralChamados').classList.contains('escondido')) carregarConversa(atual, true).catch(() => {});
    }, 12000);
  }

  async function abrirSuporte(chamado) {
    criarEstrutura();
    $('modalCentralChamados').classList.remove('escondido');
    chamados = [Object.assign({ _modo: 'suporte' }, chamado)];
    desenharLista();
    await abrirConversa(chamados[0]);
    clearInterval(timer);
    timer = setInterval(() => {
      if (document.hidden || root.__SISTEMA_OS_MODO_SEGUNDO_PLANO__ === true) return;
      if (atual) carregarConversa(atual, true).catch(() => {});
    }, 8000);
  }

  async function abrirNovo(contexto) {
    criarEstrutura();
    $('modalCentralChamados').classList.remove('escondido');
    mostrarNovoChamado(contexto || {});
  }

  function fechar() {
    geracao++;
    clearInterval(timer);
    timer = null;
    atual = null;
    $('modalCentralChamados')?.classList.add('escondido');
  }

  root.SistemaOSChamados = Object.freeze({ registrar, abrir, abrirNovo, abrirSuporte });
})(window);
