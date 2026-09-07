// Autorizações de desbloqueio no celular. A nuvem é a fonte de verdade:
// o cliente (com ID numérico) e o documento são gravados na mesma transação.
(function () {
  'use strict';

  var painel = document.getElementById('painel-desbloqueios');
  if (!painel) return;

  var form = document.getElementById('form-desbloqueio-mobile');
  var lista = document.getElementById('desbloqueio-lista');
  var listaStatus = document.getElementById('desbloqueio-lista-status');
  var feedback = document.getElementById('desbloqueio-feedback');
  var busca = document.getElementById('desbloqueio-busca');
  var btnAssinar = document.getElementById('btn-desbloqueio-assinar');
  var btnNaoAssinado = document.getElementById('btn-desbloqueio-nao-assinado');
  var btnCancelar = document.getElementById('btn-desbloqueio-cancelar');
  var btnExcluir = document.getElementById('btn-desbloqueio-excluir');
  var btnNovo = document.getElementById('btn-novo-desbloqueio');
  var identificacao = document.getElementById('desbloqueio-identificacao');
  var registros = [];
  var canal = null;
  var salvando = false;
  var idExportacao = novoId();
  var escopoVersao = 0;
  var empresaAtual = '';
  var cargaAtual = null;

  function novoId() { return 'desbloqueio-android:' + (window.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2)); }
  function mensagemErro(erro) {
    if (erro?.code === '40001') return 'Este documento mudou em outro aparelho. Abra-o novamente antes de editar.';
    if (erro?.code === '42501') return 'Seu usuário não tem permissão para esta ação.';
    if (/fetch|network|timeout|PGRST|relation|schema cache/i.test(String(erro?.message || ''))) return 'Não foi possível conectar agora. Confira a internet e tente novamente.';
    return erro?.message || 'Não foi possível concluir. Tente novamente.';
  }

  function campo(id) { return document.getElementById(id); }
  function texto(id) { return String(campo(id)?.value || '').trim(); }
  function escapar(valor) {
    return String(valor == null ? '' : valor).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function moeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function normalizarRpc(data) { return Array.isArray(data) ? data[0] : data; }
  function estadoRotulo(item) {
    if (item.assinatura_estado === 'assinado' || item.assinaturaClienteBase64) return 'Assinado';
    if (item.assinatura_estado === 'aguardando') return 'Aguardando assinatura';
    return 'Não assinado';
  }
  function avisar(mensagem, erro) {
    feedback.textContent = mensagem || '';
    feedback.classList.toggle('erro', !!erro);
    if (mensagem && window.SistemaOSToast) window.SistemaOSToast.mostrar(mensagem, erro ? 'erro' : 'sucesso');
  }

  function limparFormulario() {
    form.reset();
    idExportacao = novoId();
    ['desbloqueio-id', 'desbloqueio-revision', 'desbloqueio-cliente-id'].forEach(function (id) { campo(id).value = ''; });
    identificacao.hidden = true;
    identificacao.textContent = '';
    btnCancelar.hidden = true;
    btnExcluir.hidden = true;
    btnAssinar.textContent = 'Assinar e gerar';
    btnNaoAssinado.textContent = 'Gerar não assinado';
    avisar('');
  }

  function validar() {
    var cpf = texto('desbloqueio-cliente-cpf').replace(/\D/g, '');
    var faltando = [];
    if (!texto('desbloqueio-cliente-nome')) faltando.push('nome do cliente');
    if (!texto('desbloqueio-marca')) faltando.push('marca');
    if (!texto('desbloqueio-modelo')) faltando.push('modelo');
    if (!texto('desbloqueio-tipo')) faltando.push('tipo de bloqueio');
    if (!campo('desbloqueio-titularidade').checked) faltando.push('declaração de titularidade');
    if (cpf && cpf.length !== 11) throw new Error('Confira o CPF: ele deve ter 11 números, ou deixe o campo vazio.');
    if (faltando.length) throw new Error('Preencha: ' + faltando.join(', ') + '.');
  }

  function montarPayload(assinatura, estado) {
    return {
      cliente: {
        id: texto('desbloqueio-cliente-id') || null,
        nome: texto('desbloqueio-cliente-nome'),
        cpf: texto('desbloqueio-cliente-cpf').replace(/\D/g, '') || null,
        telefone: texto('desbloqueio-cliente-telefone') || null
      },
      aparelho: {
        marca: texto('desbloqueio-marca'), modelo: texto('desbloqueio-modelo'),
        cor: texto('desbloqueio-cor') || null, imei: texto('desbloqueio-imei') || null
      },
      tipoBloqueio: texto('desbloqueio-tipo'),
      procedimentoPrevisto: texto('desbloqueio-procedimento') || null,
      observacoes: texto('desbloqueio-observacoes') || null,
      valor: Number(campo('desbloqueio-valor').value || 0),
      declaracaoTitularidade: true,
      assinaturaEstado: estado,
      assinaturaClienteBase64: assinatura || null,
      origem: 'android',
      idExportacao: idExportacao
    };
  }

  function paraDocumento(row) {
    return {
      supabaseId: row.id, numero: row.numero, criadoEm: row.created_at,
      cliente: { id: row.cliente_id, clienteId: row.cliente_numero_snapshot || '00000', nome: row.cliente_nome_snapshot, telefone: row.cliente_telefone_snapshot || '', cpf: row.cliente_cpf_snapshot || '' },
      aparelho: { marca: row.marca, modelo: row.modelo, cor: row.cor || '', imei: row.imei || '' },
      tipoBloqueio: row.tipo_bloqueio, procedimentoPrevisto: row.procedimento_previsto || '',
      observacoes: row.observacoes || '', valor: Number(row.valor || 0),
      assinaturaClienteBase64: row.assinatura_cliente_base64 || '',
      assinaturaPendente: row.assinatura_estado === 'aguardando',
      naoAssinado: row.assinatura_estado === 'nao_assinado'
    };
  }

  function gerarHtml(row, formato) {
    var mod = window.__modules && window.__modules['desbloqueio-template'];
    if (!mod) throw new Error('Gerador do documento ainda não terminou de carregar.');
    var doc = paraDocumento(row);
    var fn = formato ? mod.exports.gerarHtmlDesbloqueioTermico : mod.exports.gerarHtmlDesbloqueio;
    var html = fn(doc, window.ConfigApp.montarDadosEmpresa(), formato);
    return window.AssinaturaInjetor.injetarAssinaturas(html, 'desbloqueio', {
      outraParte: doc.assinaturaClienteBase64,
      estadoOutraParte: doc.assinaturaPendente ? 'AGUARDANDO ASSINATURA' : (doc.naoAssinado ? 'NÃO ASSINADO' : '')
    });
  }

  function abrirPrevia(row, formato) {
    var html = gerarHtml(row, formato || '');
    var camada = document.createElement('div');
    camada.className = 'desbloqueio-preview-modal';
    camada.innerHTML = '<div class="desbloqueio-preview-card"><header><div><strong>' + escapar(row.numero) + '</strong><span>' + (formato ? 'Impressão ' + escapar(formato) : 'Documento A4') + '</span></div><button type="button" aria-label="Fechar">×</button></header><iframe title="Prévia da autorização"></iframe><footer><button type="button" class="btn-secundario" data-formato="58mm">Térmico 58 mm</button><button type="button" class="btn-secundario" data-formato="80mm">Térmico 80 mm</button><button type="button" class="btn-primario" data-imprimir>Imprimir / salvar PDF</button></footer></div>';
    document.body.appendChild(camada);
    var frame = camada.querySelector('iframe');
    var formatoAtual = formato || '';
    frame.srcdoc = html;
    frame.addEventListener('load', function () {
      var doc = frame.contentDocument;
      if (!doc) return;
      var pagina = doc.querySelector('main');
      if (pagina && pagina.offsetWidth > frame.clientWidth) {
        var estilo = doc.createElement('style');
        estilo.textContent = '@media screen { body { zoom:' + Math.min(1, frame.clientWidth / pagina.offsetWidth) + '; } }';
        doc.head.appendChild(estilo);
      }
    });
    function fechar() { camada.remove(); }
    camada.querySelector('header button').addEventListener('click', fechar);
    camada.addEventListener('click', function (evento) { if (evento.target === camada) fechar(); });
    camada.querySelector('[data-imprimir]').addEventListener('click', async function () {
      try {
        var plugin = window.Capacitor?.Plugins?.Impressao;
        if (plugin?.imprimir) await plugin.imprimir({ html: gerarHtml(row, formatoAtual), titulo: row.numero + ' - Autorização' });
        else { frame.contentWindow.focus(); frame.contentWindow.print(); }
      } catch (erro) { avisar(mensagemErro(erro), true); }
    });
    camada.querySelectorAll('[data-formato]').forEach(function (botao) {
      botao.addEventListener('click', function () {
        formatoAtual = botao.dataset.formato;
        frame.srcdoc = gerarHtml(row, formatoAtual);
        camada.querySelector('header span').textContent = 'Impressão ' + formatoAtual;
      });
    });
  }

  async function persistir(assinatura, estado) {
    if (salvando) return;
    var versao = escopoVersao;
    try {
      validar();
      salvando = true;
      btnAssinar.disabled = true;
      btnNaoAssinado.disabled = true;
      avisar('Criando o cliente e preparando o documento…');
      var client = window.SupabaseClientApp.obterCliente();
      var id = texto('desbloqueio-id') || null;
      var revision = Number(texto('desbloqueio-revision') || 0) || null;
      var resposta = await client.rpc('salvar_desbloqueio', { p_id: id, p_revision: revision, p_dados: montarPayload(assinatura, estado) });
      if (resposta.error) throw resposta.error;
      if (versao !== escopoVersao) return;
      var row = normalizarRpc(resposta.data);
      if (!row || !row.id) throw new Error('A nuvem não devolveu a autorização salva.');
      avisar((estado === 'assinado' ? 'Autorização assinada' : 'Autorização marcada como não assinada') + ' e sincronizada.');
      await carregarLista();
      if (versao !== escopoVersao) return;
      preencher(row);
      await (window.__modulosOSPromise || Promise.resolve());
      abrirPrevia(row);
    } catch (erro) {
      if (versao === escopoVersao) avisar(mensagemErro(erro), true);
    } finally {
      salvando = false;
      btnAssinar.disabled = false;
      btnNaoAssinado.disabled = false;
    }
  }

  function solicitarAssinatura() {
    try { validar(); } catch (erro) { avisar(erro.message, true); return; }
    var versao = escopoVersao;
    window.SistemaOSAssinatura.abrir(function (dataUrl) { if (versao === escopoVersao) persistir(dataUrl, 'assinado'); });
  }

  function preencher(row) {
    idExportacao = row.id_exportacao || novoId();
    campo('desbloqueio-id').value = row.id || '';
    campo('desbloqueio-revision').value = row.revision || '';
    campo('desbloqueio-cliente-id').value = row.cliente_id || '';
    campo('desbloqueio-cliente-nome').value = row.cliente_nome_snapshot || '';
    campo('desbloqueio-cliente-cpf').value = row.cliente_cpf_snapshot || '';
    campo('desbloqueio-cliente-telefone').value = row.cliente_telefone_snapshot || '';
    campo('desbloqueio-marca').value = row.marca || '';
    campo('desbloqueio-modelo').value = row.modelo || '';
    campo('desbloqueio-cor').value = row.cor || '';
    campo('desbloqueio-imei').value = row.imei || '';
    var seletor = campo('desbloqueio-tipo');
    if (row.tipo_bloqueio && !Array.from(seletor.options).some(function (o) { return o.value === row.tipo_bloqueio; })) {
      var opcao = document.createElement('option'); opcao.value = row.tipo_bloqueio; opcao.textContent = row.tipo_bloqueio; seletor.appendChild(opcao);
    }
    seletor.value = row.tipo_bloqueio || '';
    campo('desbloqueio-valor').value = Number(row.valor || 0) || '';
    campo('desbloqueio-procedimento').value = row.procedimento_previsto || '';
    campo('desbloqueio-observacoes').value = row.observacoes || '';
    campo('desbloqueio-titularidade').checked = true;
    identificacao.textContent = row.numero + ' · Cliente ' + (row.cliente_numero_snapshot || '00000') + ' · ' + estadoRotulo(row);
    identificacao.hidden = false;
    btnCancelar.hidden = false;
    btnExcluir.hidden = false;
    btnAssinar.textContent = row.assinatura_estado === 'assinado' ? 'Assinar novamente' : 'Assinar e gerar';
    btnNaoAssinado.textContent = 'Salvar como não assinado';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderizarLista() {
    var termo = String(busca.value || '').trim().toLocaleLowerCase('pt-BR');
    var filtrados = registros.filter(function (item) {
      return !termo || [item.numero, item.cliente_nome_snapshot, item.cliente_numero_snapshot, item.marca, item.modelo]
        .some(function (v) { return String(v || '').toLocaleLowerCase('pt-BR').includes(termo); });
    });
    lista.innerHTML = '';
    if (!filtrados.length) { lista.innerHTML = '<p class="historico-vazio">Nenhuma autorização encontrada.</p>'; return; }
    filtrados.forEach(function (item) {
      var card = document.createElement('article');
      card.className = 'desbloqueio-card';
      card.innerHTML = '<div class="desbloqueio-card-topo"><div><strong>' + escapar(item.numero) + '</strong><span>Cliente ' + escapar(item.cliente_numero_snapshot || '00000') + '</span></div><span class="desbloqueio-status desbloqueio-status-' + escapar(item.assinatura_estado) + '">' + escapar(estadoRotulo(item)) + '</span></div><h3>' + escapar(item.cliente_nome_snapshot) + '</h3><p>' + escapar([item.marca, item.modelo].filter(Boolean).join(' ')) + ' · ' + escapar(item.tipo_bloqueio) + '</p>' + (Number(item.valor || 0) ? '<b>' + moeda(item.valor) + '</b>' : '') + '<div class="desbloqueio-card-acoes"><button type="button" class="btn-secundario" data-abrir>Abrir</button><button type="button" class="btn-secundario" data-editar>Editar</button></div>';
      card.querySelector('[data-abrir]').addEventListener('click', function () { abrirDocumento(item.id, false); });
      card.querySelector('[data-editar]').addEventListener('click', function () { abrirDocumento(item.id, true); });
      lista.appendChild(card);
    });
  }

  async function carregarLista() {
    if (cargaAtual) return cargaAtual;
    var promessa = carregarListaAgora().finally(function () { if (cargaAtual === promessa) cargaAtual = null; });
    cargaAtual = promessa;
    return cargaAtual;
  }
  async function carregarListaAgora() {
    var versao = escopoVersao;
    listaStatus.textContent = 'Sincronizando autorizações…';
    try {
      var client = window.SupabaseClientApp.obterCliente();
      var encontrados = [];
      for (var inicio = 0; ; inicio += 200) {
        var resposta = await client.from('desbloqueios').select('id,numero,cliente_numero_snapshot,cliente_nome_snapshot,marca,modelo,tipo_bloqueio,assinatura_estado,valor,revision,updated_at').is('deleted_at', null).order('updated_at', { ascending: false }).range(inicio, inicio + 199);
        if (resposta.error) throw resposta.error;
        if (versao !== escopoVersao) return;
        encontrados = encontrados.concat(resposta.data || []);
        if ((resposta.data || []).length < 200) break;
      }
      registros = encontrados;
      listaStatus.textContent = registros.length + (registros.length === 1 ? ' autorização sincronizada.' : ' autorizações sincronizadas.');
      renderizarLista();
      iniciarTempoReal(client);
    } catch (erro) {
      if (versao !== escopoVersao) return;
      listaStatus.textContent = mensagemErro(erro);
      registros = [];
      renderizarLista();
    }
  }

  function iniciarTempoReal(client) {
    if (canal || !client.channel) return;
    canal = client.channel('desbloqueios-mobile').on('postgres_changes', { event: '*', schema: 'public', table: 'desbloqueios' }, function () {
      if (!painel.hidden) carregarLista().catch(function () {});
    }).subscribe();
  }

  async function excluirAtual() {
    var id = texto('desbloqueio-id');
    if (!id || !confirm('Excluir esta autorização em todos os aparelhos?')) return;
    var versao = escopoVersao;
    try {
      btnExcluir.disabled = true;
      var client = window.SupabaseClientApp.obterCliente();
      var resposta = await client.rpc('excluir_desbloqueio', { p_id: id, p_revision: Number(texto('desbloqueio-revision')) || null });
      if (resposta.error) throw resposta.error;
      if (versao !== escopoVersao) return;
      if (resposta.data !== true) throw new Error('A autorização mudou em outro aparelho. Atualize e tente novamente.');
      limparFormulario();
      await carregarLista();
      if (versao !== escopoVersao) return;
      avisar('Autorização excluída e remoção sincronizada.');
    } catch (erro) { if (versao === escopoVersao) avisar(mensagemErro(erro), true); }
    finally { btnExcluir.disabled = false; }
  }

  btnAssinar.addEventListener('click', solicitarAssinatura);
  btnNaoAssinado.addEventListener('click', function () { persistir('', 'nao_assinado'); });
  btnCancelar.addEventListener('click', limparFormulario);
  btnExcluir.addEventListener('click', excluirAtual);
  btnNovo.addEventListener('click', limparFormulario);
  busca.addEventListener('input', renderizarLista);
  document.addEventListener('sistema-os:tela-desbloqueios-aberta', carregarLista);
  document.addEventListener('sistema-os:sessao-alterada', function (evento) {
    var nova = JSON.stringify([evento.detail?.contexto?.empresa_id || '', evento.detail?.contexto?.usuario_id || evento.detail?.usuario?.id || '', evento.detail?.autenticado === true]);
    if (nova === empresaAtual) return;
    empresaAtual = nova; escopoVersao++;
    cargaAtual = null;
    if (canal) { canal.unsubscribe(); canal = null; }
    registros = []; renderizarLista(); limparFormulario();
    document.querySelectorAll('.desbloqueio-preview-modal').forEach(function (el) { el.remove(); });
  });

  async function abrirDocumento(id, editar) {
    var versao = escopoVersao;
    try {
      var resposta = await window.SupabaseClientApp.obterCliente().from('desbloqueios').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
      if (resposta.error) throw resposta.error;
      if (versao !== escopoVersao) return;
      if (!resposta.data) throw new Error('A autorização foi removida ou não está disponível.');
      await (window.__modulosOSPromise || Promise.resolve());
      if (versao !== escopoVersao) return;
      if (editar) preencher(resposta.data); else abrirPrevia(resposta.data);
    } catch (erro) { if (versao === escopoVersao) avisar(mensagemErro(erro), true); }
  }

  window.SistemaOSDesbloqueiosMobile = Object.freeze({
    recarregar: carregarLista,
    abrir: function (id) { return abrirDocumento(id, true); }
  });
})();
