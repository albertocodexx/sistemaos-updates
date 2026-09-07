(function (root) {
  'use strict';

  const CHAVE = 'sistemaos_chamados_acompanhamento_v2';
  const CHAVE_ATUAL = 'sistemaos_chamado_atual_v2';
  let chamados = [];
  let atual = null;
  let timer = null;
  let novoContexto = null;

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
  const statusNome = (valor) => ({
    aberto: 'Aberto', em_atendimento: 'Em atendimento', resolvido: 'Resolvido', fechado: 'Fechado'
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
        <form id="formNovoChamadoCentral" class="suporte-novo-chamado escondido">
          <div class="suporte-novo-chamado-titulo"><strong>Como podemos ajudar?</strong><span>Seu chamado ficará salvo na nuvem e vinculado ao usuário informado.</span></div>
          <div class="suporte-novo-chamado-grade">
            <div class="suporte-form-secao campo-largo"><strong>Identificação</strong><span>Confirme quem está solicitando o atendimento.</span></div>
            <div class="campo" id="campoEmpresaNovoChamado"><label for="empresaNovoChamado">Código da empresa *</label><input id="empresaNovoChamado" maxlength="40" autocomplete="organization" /></div>
            <div class="campo" id="campoUsuarioNovoChamado"><label for="usuarioNovoChamado">Usuário do Sistema OS *</label><input id="usuarioNovoChamado" maxlength="30" autocomplete="username" required /></div>
            <div class="campo" id="campoNomeNovoChamado"><label for="nomeNovoChamado">Nome completo *</label><input id="nomeNovoChamado" maxlength="120" autocomplete="name" required /></div>
            <div class="campo"><label for="cargoEmpresaNovoChamado">Cargo na empresa *</label><select id="cargoEmpresaNovoChamado" required><option value="">Selecione</option><option value="proprietario">Proprietário(a)</option><option value="administrador">Administrador(a)</option><option value="gerente">Gerente</option><option value="tecnico">Técnico(a)</option><option value="atendente">Atendente</option><option value="financeiro">Financeiro</option><option value="outro">Outro</option></select></div>
            <div class="campo campo-largo" id="campoCargoOutroNovoChamado" hidden><label for="cargoOutroNovoChamado">Informe seu cargo *</label><input id="cargoOutroNovoChamado" maxlength="80" /></div>
            <div class="suporte-form-secao campo-largo"><strong>Contato</strong><span>Informe como o suporte pode retornar.</span></div>
            <div class="campo"><label for="telefoneNovoChamado">Telefone ou WhatsApp *</label><input id="telefoneNovoChamado" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" placeholder="(00) 00000-0000" required /></div>
            <div class="campo"><label for="emailNovoChamado">E-mail <span class="campo-opcional">opcional</span></label><input id="emailNovoChamado" type="email" maxlength="160" autocomplete="email" /></div>
            <div class="campo"><label for="preferenciaContatoNovoChamado">Prefiro receber retorno por *</label><select id="preferenciaContatoNovoChamado" required><option value="whatsapp">WhatsApp</option><option value="ligacao">Ligação</option><option value="email">E-mail</option></select></div>
            <div class="campo"><label for="horarioContatoNovoChamado">Melhor horário <span class="campo-opcional">opcional</span></label><input id="horarioContatoNovoChamado" maxlength="80" placeholder="Ex.: 9h às 18h" /></div>
            <div class="suporte-form-secao campo-largo"><strong>Solicitação</strong><span>Escolha o motivo para exibirmos somente os campos necessários.</span></div>
            <div class="campo campo-largo"><label for="motivoNovoChamado">Motivo do chamado *</label><select id="motivoNovoChamado" required><option value="">Selecione o motivo</option>${Object.entries(motivos).map(([valor, nome]) => `<option value="${valor}">${nome}</option>`).join('')}</select></div>
            <div class="campo campo-largo" id="campoMotivoOutroNovoChamado" hidden><label for="motivoOutroNovoChamado">Qual é o motivo? *</label><input id="motivoOutroNovoChamado" maxlength="160" /></div>
            <div class="campo" id="campoPlataformaNovoChamado" hidden><label for="plataformaNovoChamado">Onde acontece? *</label><select id="plataformaNovoChamado"><option value="pc">Computador</option><option value="celular">Celular</option><option value="ambos">Computador e celular</option></select></div>
            <div class="campo" id="campoReferenciaNovoChamado" hidden><label for="referenciaNovoChamado" id="labelReferenciaNovoChamado">OS ou documento relacionado</label><input id="referenciaNovoChamado" maxlength="80" placeholder="Ex.: OS-0020" /></div>
            <div class="campo"><label for="prioridadeNovoChamado">Prioridade</label><select id="prioridadeNovoChamado"><option value="normal">Normal</option><option value="baixa">Baixa</option><option value="alta">Alta</option><option value="critica">Crítica</option></select></div>
            <div class="campo"><label for="assuntoNovoChamado">Resumo do pedido *</label><input id="assuntoNovoChamado" maxlength="160" placeholder="Descreva em uma frase" required /></div>
            <div class="campo campo-largo"><label for="mensagemNovoChamado">Explique o que aconteceu *</label><textarea id="mensagemNovoChamado" rows="5" maxlength="8000" placeholder="Conte o que tentou fazer e o que apareceu na tela…" required></textarea></div>
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
    $('btnFecharCentralChamados').addEventListener('click', fechar);
    $('btnCancelarNovoChamado').addEventListener('click', ocultarNovoChamado);
    modal.addEventListener('click', (evento) => { if (evento.target === modal) fechar(); });
    $('formMensagemChamado').addEventListener('submit', enviarMensagem);
    $('formNovoChamadoCentral').addEventListener('submit', enviarNovoChamado);
    $('motivoNovoChamado').addEventListener('change', atualizarCamposCondicionais);
    $('cargoEmpresaNovoChamado').addEventListener('change', atualizarCamposCondicionais);
    $('textoMensagemChamado').addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter' && !evento.shiftKey) {
        evento.preventDefault();
        if (!$('btnEnviarMensagemChamado').disabled) $('formMensagemChamado').requestSubmit();
      }
    });
  }

  function atualizarCamposCondicionais() {
    const motivo = $('motivoNovoChamado')?.value || '';
    const cargo = $('cargoEmpresaNovoChamado')?.value || '';
    const tecnico = ['acesso_login', 'sincronizacao_backup', 'documento_assinatura', 'erro_sistema', 'configuracao_integracao'].includes(motivo);
    const referencia = ['cobranca_pagamento', 'sincronizacao_backup', 'documento_assinatura', 'erro_sistema'].includes(motivo);
    $('campoMotivoOutroNovoChamado').hidden = motivo !== 'outro';
    $('motivoOutroNovoChamado').required = motivo === 'outro';
    $('campoCargoOutroNovoChamado').hidden = cargo !== 'outro';
    $('cargoOutroNovoChamado').required = cargo === 'outro';
    $('campoPlataformaNovoChamado').hidden = !tecnico;
    $('plataformaNovoChamado').required = tecnico;
    $('campoReferenciaNovoChamado').hidden = !referencia;
    if (motivo === 'cobranca_pagamento') $('labelReferenciaNovoChamado').textContent = 'Cobrança, plano ou protocolo relacionado';
    else $('labelReferenciaNovoChamado').textContent = 'OS ou documento relacionado';
    if ($('assuntoNovoChamado').dataset.automatico === 'true') {
      $('assuntoNovoChamado').value = motivo ? motivos[motivo] : '';
    }
  }

  function mostrarNovoChamado(contexto) {
    criarEstrutura();
    novoContexto = Object.assign({}, contexto || {});
    const publico = String(novoContexto.origem || '').startsWith('login_');
    $('campoEmpresaNovoChamado').hidden = !publico;
    $('empresaNovoChamado').value = novoContexto.empresa || '';
    $('nomeNovoChamado').value = novoContexto.nome || novoContexto.usuario || '';
    $('nomeNovoChamado').readOnly = !publico;
    $('usuarioNovoChamado').value = novoContexto.usuario || '';
    $('usuarioNovoChamado').readOnly = !publico;
    $('telefoneNovoChamado').value = novoContexto.telefone || novoContexto.contato || '';
    $('emailNovoChamado').value = novoContexto.email || '';
    $('cargoEmpresaNovoChamado').value = novoContexto.cargoEmpresa || '';
    $('cargoOutroNovoChamado').value = '';
    $('preferenciaContatoNovoChamado').value = 'whatsapp';
    $('horarioContatoNovoChamado').value = '';
    $('motivoNovoChamado').value = novoContexto.motivo || '';
    $('motivoOutroNovoChamado').value = '';
    $('plataformaNovoChamado').value = novoContexto.plataforma || (novoContexto.origem === 'config_celular' ? 'celular' : 'pc');
    $('referenciaNovoChamado').value = '';
    $('assuntoNovoChamado').value = novoContexto.assunto || '';
    $('assuntoNovoChamado').dataset.automatico = novoContexto.assunto ? 'false' : 'true';
    $('mensagemNovoChamado').value = novoContexto.mensagem || '';
    $('prioridadeNovoChamado').value = 'normal';
    atualizarCamposCondicionais();
    $('statusNovoChamadoCentral').textContent = '';
    $('formNovoChamadoCentral').classList.remove('escondido');
    $('layoutCentralChamados').classList.add('escondido');
    setTimeout(() => (publico ? $('empresaNovoChamado') : $('assuntoNovoChamado'))?.focus(), 60);
  }

  function ocultarNovoChamado() {
    $('formNovoChamadoCentral')?.classList.add('escondido');
    $('layoutCentralChamados')?.classList.remove('escondido');
  }

  async function enviarNovoChamado(evento) {
    evento.preventDefault();
    const publico = String(novoContexto?.origem || '').startsWith('login_');
    const empresa = $('empresaNovoChamado').value.trim().toLowerCase();
    const usuario = $('usuarioNovoChamado').value.trim().toLowerCase();
    const nome = $('nomeNovoChamado').value.trim();
    const telefone = somenteDigitos($('telefoneNovoChamado').value);
    const email = $('emailNovoChamado').value.trim().toLowerCase();
    const preferenciaContato = $('preferenciaContatoNovoChamado').value;
    const cargoEmpresa = $('cargoEmpresaNovoChamado').value;
    const cargoOutro = $('cargoOutroNovoChamado').value.trim();
    const motivo = $('motivoNovoChamado').value;
    const motivoOutro = $('motivoOutroNovoChamado').value.trim();
    const assunto = $('assuntoNovoChamado').value.trim();
    const mensagem = $('mensagemNovoChamado').value.trim();
    if (publico && !/^[a-z0-9-]{3,40}$/.test(empresa)) {
      $('statusNovoChamadoCentral').textContent = 'Informe o código correto da empresa.';
      $('empresaNovoChamado').focus();
      return;
    }
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
      $('statusNovoChamadoCentral').textContent = 'Informe o usuário usado para entrar no Sistema OS.';
      $('usuarioNovoChamado').focus(); return;
    }
    if (nome.length < 2) {
      $('statusNovoChamadoCentral').textContent = 'Informe seu nome completo.';
      $('nomeNovoChamado').focus(); return;
    }
    if (!/^\d{10,15}$/.test(telefone)) {
      $('statusNovoChamadoCentral').textContent = 'Informe um telefone ou WhatsApp com DDD.';
      $('telefoneNovoChamado').focus(); return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      $('statusNovoChamadoCentral').textContent = 'Confira o e-mail informado.';
      $('emailNovoChamado').focus(); return;
    }
    if (preferenciaContato === 'email' && !email) {
      $('statusNovoChamadoCentral').textContent = 'Informe o e-mail escolhido para retorno.';
      $('emailNovoChamado').focus(); return;
    }
    if (!cargoEmpresa || (cargoEmpresa === 'outro' && cargoOutro.length < 2)) {
      $('statusNovoChamadoCentral').textContent = 'Selecione seu cargo na empresa.'; return;
    }
    if (!motivo || (motivo === 'outro' && motivoOutro.length < 3)) {
      $('statusNovoChamadoCentral').textContent = 'Selecione ou descreva o motivo do chamado.'; return;
    }
    if (!assunto || mensagem.length < 10) {
      $('statusNovoChamadoCentral').textContent = 'Informe o assunto e descreva o problema com pelo menos 10 caracteres.';
      return;
    }
    const botao = $('btnEnviarNovoChamado');
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    $('statusNovoChamadoCentral').textContent = 'Criando o chamado com segurança…';
    try {
      const resposta = await root.api?.supabasecriarchamadosuporte?.({
        origem: novoContexto?.origem || 'config_pc', empresa,
        nome, usuario, telefone, email, preferenciaContato,
        horarioContato: $('horarioContatoNovoChamado').value.trim(),
        cargoEmpresa, cargoOutro, motivo, motivoOutro,
        plataforma: $('plataformaNovoChamado').value,
        referencia: $('referenciaNovoChamado').value.trim(),
        assunto, prioridade: $('prioridadeNovoChamado').value, mensagem
      });
      if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível abrir o chamado.');
      registrar(resposta);
      ocultarNovoChamado();
      notificar('Chamado ' + (resposta.protocolo || '') + ' criado.', 'sucesso');
      await carregarListaEAbrir(resposta.chamadoId);
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
      alvo.appendChild(balao);
    });
    alvo.scrollTop = alvo.scrollHeight;
  }

  async function carregarConversa(chamado, silencioso) {
    let resposta;
    if (chamado._modo === 'publico') {
      resposta = await invocar('acompanhar_publico', { token: chamado._token });
    } else {
      resposta = await invocar('listar_mensagens', { chamadoId: chamado.id });
    }
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
    const encerrado = ['resolvido', 'fechado'].includes(String(atual.status));
    $('formMensagemChamado').classList.toggle('escondido', encerrado);
    $('textoMensagemChamado').disabled = encerrado;
    $('btnEnviarMensagemChamado').disabled = encerrado;
    if (encerrado) {
      $('statusCentralChamados').textContent = `Chamado ${statusNome(atual.status).toLowerCase()}. O chat foi encerrado e não aceita novas mensagens.`;
    } else if (!silencioso) $('statusCentralChamados').textContent = 'Conversa atualizada.';
    invocar('marcar_visualizado', { chamadoId: atual.id, token: atual._token || '' }).catch(() => {});
  }

  async function abrirConversa(chamado) {
    atual = chamado;
    localStorage.setItem(CHAVE_ATUAL, chamado.id || '');
    $('statusCentralChamados').textContent = 'Carregando conversa…';
    try { await carregarConversa(chamado, false); }
    catch (erro) { $('statusCentralChamados').textContent = erro.message || String(erro); }
  }

  async function enviarMensagem(evento) {
    evento.preventDefault();
    if (!atual) return;
    if (['resolvido', 'fechado'].includes(String(atual.status))) {
      $('statusCentralChamados').textContent = 'Este chamado está encerrado e não aceita novas mensagens.';
      return;
    }
    const campo = $('textoMensagemChamado');
    const mensagem = campo.value.trim();
    if (!mensagem) return;
    const botao = $('btnEnviarMensagemChamado');
    botao.disabled = true;
    $('statusCentralChamados').textContent = 'Enviando…';
    try {
      const acao = atual._modo === 'suporte' ? 'responder_suporte'
        : atual._modo === 'publico' ? 'responder_publico' : 'responder_autenticado';
      await invocar(acao, { chamadoId: atual.id, token: atual._token || '', mensagem });
      campo.value = '';
      await carregarConversa(atual, true);
      $('statusCentralChamados').textContent = 'Mensagem enviada.';
    } catch (erro) {
      $('statusCentralChamados').textContent = erro.message || String(erro);
    } finally { botao.disabled = false; }
  }

  async function listarDoAcesso() {
    const encontrados = [];
    try {
      const resposta = await invocar('listar_meus', {});
      (resposta.chamados || []).forEach((item) => encontrados.push(Object.assign({ _modo: 'autenticado' }, item)));
    } catch (_) { /* Tela de login: ainda não existe sessão autenticada. */ }
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
    chamados = await listarDoAcesso();
    desenharLista();
    const preferido = chamados.find((item) => item.id === chamadoId)
      || chamados.find((item) => !['resolvido', 'fechado'].includes(String(item.status)))
      || chamados[0];
    $('statusCentralChamados').textContent = chamados.length ? 'Atendimento conectado.' : 'Nenhum chamado neste acesso.';
    if (preferido) await abrirConversa(preferido);
  }

  async function abrir() {
    criarEstrutura();
    $('modalCentralChamados').classList.remove('escondido');
    ocultarNovoChamado();
    $('statusCentralChamados').textContent = 'Buscando chamados…';
    await carregarListaEAbrir(localStorage.getItem(CHAVE_ATUAL) || '');
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
    clearInterval(timer);
    timer = null;
    atual = null;
    $('modalCentralChamados')?.classList.add('escondido');
  }

  root.SistemaOSChamados = Object.freeze({ registrar, abrir, abrirNovo, abrirSuporte });
})(window);
