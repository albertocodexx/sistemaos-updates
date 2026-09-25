// Aba Cobranças: agenda financeira das OS, sincronizada pelo mesmo registro
// usado no PC. Cada lembrete vive em dados_extras.lembretes_cobranca da OS.
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.SistemaOSCobrancas = api;
    if (root.document && typeof root.CustomEvent === 'function') {
      root.document.dispatchEvent(new root.CustomEvent('sistema-os:cobrancas-pronta'));
    }
  }
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  var listaEl = root.document && root.document.getElementById('cobrancas-mobile-lista');
  var statusEl = root.document && root.document.getElementById('cobrancas-mobile-status');
  var buscaEl = root.document && root.document.getElementById('cobrancas-mobile-busca');
  var modalEl = root.document && root.document.getElementById('modal-cobranca-mobile');
  var formEl = root.document && root.document.getElementById('form-cobranca-mobile');
  var filtroAtual = 'todas';
  var tipoAtual = 'todos';
  var ordensAtuais = [];
  var vendasAtuais = [];
  var cobrancasAtuais = [];
  var pararRealtime = null;
  var pararRealtimeEstoque = null;
  var carregando = false;
  var recarregarPendente = false;
  var revisaoContexto = 0;

  function texto(valor) { return String(valor == null ? '' : valor).trim(); }
  function escapar(valor) {
    return texto(valor).replace(/[&<>"']/g, function (caractere) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[caractere];
    });
  }
  function numero(valor) {
    var convertido = Number(valor);
    return Number.isFinite(convertido) ? convertido : 0;
  }
  function moeda(valor) {
    try { return numero(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
    catch (_) { return 'R$ ' + numero(valor).toFixed(2).replace('.', ','); }
  }
  function rotuloOS(valor) {
    return root.SistemaOSNumero && root.SistemaOSNumero.formatar
      ? root.SistemaOSNumero.formatar(valor)
      : ('OS-' + texto(valor).replace(/\D/g, ''));
  }
  function referencia(tipo, registro) {
    return tipo === 'venda' ? texto(registro && registro.id) : rotuloOS(registro && registro.numero);
  }
  function clienteRegistro(tipo, registro) {
    return tipo === 'venda'
      ? texto(registro && registro.compradorNome)
      : texto(registro && registro.cliente && registro.cliente.nome);
  }
  function aparelhoRegistro(tipo, registro) {
    var aparelho = tipo === 'venda' ? (registro || {}) : (registro && registro.aparelho || {});
    return texto(aparelho.nome || [aparelho.marca, aparelho.modelo].filter(Boolean).join(' ')) || 'Aparelho não informado';
  }
  function totalRegistro(tipo, registro) {
    return tipo === 'venda' ? numero(registro && registro.valorVenda) : numero(registro && (registro.valorTotalServico || registro.valor));
  }
  function dataHoje() {
    var agora = new Date();
    return new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function dataBr(valor) {
    var partes = texto(valor).slice(0, 10).split('-');
    return partes.length === 3 ? partes.reverse().join('/') : texto(valor) || 'Sem data';
  }
  function dataValida(valor) {
    var data = new Date(texto(valor).slice(0, 10) + 'T12:00:00');
    return Number.isFinite(data.getTime());
  }
  function hashCurto(valor) {
    var hash = 2166136261;
    var entrada = texto(valor);
    for (var i = 0; i < entrada.length; i += 1) {
      hash ^= entrada.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function normalizarLembretes(lista) {
    var vistos = Object.create(null);
    return (Array.isArray(lista) ? lista : []).filter(Boolean).slice(0, 60).map(function (original, indice) {
      var item = Object.assign({}, original);
      var id = texto(item.id) || ('cob-legacy-' + hashCurto([
        item.criadoEm, item.data, numero(item.valor).toFixed(2), item.observacao
      ].join('|')));
      if (vistos[id]) id += '-' + (indice + 1);
      vistos[id] = true;
      item.id = id;
      item.data = texto(item.data).slice(0, 10);
      item.valor = Math.max(0, numero(item.valor));
      item.status = texto(item.status).toLowerCase() || 'pendente';
      return item;
    }).filter(function (item) { return /^\d{4}-\d{2}-\d{2}$/.test(item.data); });
  }
  function normalizarExclusoes(lista) {
    var mapa = Object.create(null);
    (Array.isArray(lista) ? lista : []).forEach(function (original) {
      var id = texto(original && original.id || original);
      if (!id) return;
      var item = original && typeof original === 'object'
        ? Object.assign({}, original, { id: id })
        : { id: id, excluidoEm: '' };
      var anterior = mapa[id];
      if (!anterior || Date.parse(item.excluidoEm || 0) >= Date.parse(anterior.excluidoEm || 0)) mapa[id] = item;
    });
    return Object.keys(mapa).map(function (id) { return mapa[id]; }).slice(-120);
  }
  function toast(mensagem, tipo) {
    if (root.SistemaOSToast && root.SistemaOSToast.mostrar) root.SistemaOSToast.mostrar(mensagem, tipo || 'sucesso');
  }

  function statusCobranca(item) {
    var salvo = texto(item && item.status).toLowerCase();
    if (item && (item.confirmadoEm || item.pagoEm) && salvo !== 'desativada') return 'paga';
    if (salvo === 'paga' || salvo === 'desativada' || salvo === 'atrasada') return salvo;
    var limite = new Date(texto(item && item.data).slice(0, 10) + 'T23:59:59');
    return Number.isFinite(limite.getTime()) && limite.getTime() < Date.now() ? 'atrasada' : 'pendente';
  }

  function nomeStatus(status) {
    return ({ pendente: 'Pendente', atrasada: 'Atrasada', paga: 'Paga', desativada: 'Desativada' })[status] || 'Pendente';
  }

  function aparelhoOS(os) {
    var aparelho = os && os.aparelho || {};
    return texto(aparelho.nome || [aparelho.marca, aparelho.modelo].filter(Boolean).join(' ')) || 'Aparelho não informado';
  }

  function achatar(ordens, vendas) {
    var resultado = [];
    (ordens || []).forEach(function (os) {
      normalizarLembretes(os.lembretesCobranca).forEach(function (item) {
        if (!item || !item.data) return;
        resultado.push({ tipo: 'os', registro: os, os: os, item: Object.assign({}, item), status: statusCobranca(item) });
      });
    });
    (vendas || []).filter(function (venda) {
      return ['Vendido', 'Reservado'].indexOf(venda.status) >= 0 || normalizarLembretes(venda.lembretesCobranca).length > 0;
    }).forEach(function (venda) {
      normalizarLembretes(venda.lembretesCobranca).forEach(function (item) {
        if (!item || !item.data) return;
        resultado.push({ tipo: 'venda', registro: venda, venda: venda, item: Object.assign({}, item), status: statusCobranca(item) });
      });
    });
    var prioridade = { atrasada: 0, pendente: 1, paga: 2, desativada: 3 };
    resultado.sort(function (a, b) {
      return (prioridade[a.status] - prioridade[b.status]) || texto(a.item.data).localeCompare(texto(b.item.data));
    });
    return resultado;
  }

  function atualizarResumo() {
    var pendentes = cobrancasAtuais.filter(function (c) { return c.status === 'pendente'; });
    var atrasadas = cobrancasAtuais.filter(function (c) { return c.status === 'atrasada'; });
    var aReceber = pendentes.concat(atrasadas).reduce(function (soma, c) { return soma + numero(c.item.valor); }, 0);
    var elPendentes = root.document.getElementById('cobrancas-resumo-pendentes');
    var elAtrasadas = root.document.getElementById('cobrancas-resumo-atrasadas');
    var elValor = root.document.getElementById('cobrancas-resumo-valor');
    if (elPendentes) elPendentes.textContent = String(pendentes.length);
    if (elAtrasadas) elAtrasadas.textContent = String(atrasadas.length);
    if (elValor) elValor.textContent = moeda(aReceber);
  }

  function cobrancasFiltradas() {
    var termo = texto(buscaEl && buscaEl.value).toLowerCase();
    return cobrancasAtuais.filter(function (cobranca) {
      if (tipoAtual !== 'todos' && cobranca.tipo !== tipoAtual) return false;
      if (filtroAtual !== 'todas' && cobranca.status !== filtroAtual) return false;
      if (!termo) return true;
      var registro = cobranca.registro || cobranca.os || {};
      var base = [referencia(cobranca.tipo || 'os', registro), clienteRegistro(cobranca.tipo || 'os', registro), aparelhoRegistro(cobranca.tipo || 'os', registro), cobranca.item.observacao]
        .map(texto).join(' ').toLowerCase();
      return base.indexOf(termo) !== -1;
    });
  }

  function botao(rotulo, classe, acao) {
    var elemento = root.document.createElement('button');
    elemento.type = 'button';
    elemento.className = classe || 'btn-secundario';
    elemento.textContent = rotulo;
    elemento.addEventListener('click', acao);
    return elemento;
  }

  function renderizar() {
    if (!listaEl) return;
    atualizarResumo();
    var cobrancas = cobrancasFiltradas();
    listaEl.innerHTML = '';
    if (!cobrancas.length) {
      listaEl.innerHTML = '<div class="cobranca-mobile-vazio">Nenhuma cobrança neste filtro. Toque em <strong>Nova cobrança</strong> para programar um lembrete.</div>';
      return;
    }
    cobrancas.forEach(function (cobranca) {
      var os = cobranca.registro || cobranca.os;
      var tipo = cobranca.tipo || 'os';
      var item = cobranca.item;
      var total = totalRegistro(tipo, os);
      var recebido = valorRecebidoOS(os);
      var valorParcela = Math.min(numero(item.valor), Math.max(0, total - recebido)) || numero(item.valor);
      var saldoApos = Math.max(0, total - recebido - (cobranca.status === 'paga' ? 0 : valorParcela));
      var card = root.document.createElement('article');
      card.className = 'cobranca-mobile-card';
      card.dataset.status = cobranca.status;
      card.dataset.lembreteId = texto(item.id || item.data);
      card.innerHTML = '<div class="cobranca-mobile-card-topo"><div><span class="cobranca-mobile-tipo">' + (tipo === 'os' ? 'OS' : 'VENDA') + '</span><h3>' + escapar(referencia(tipo, os)) + '</h3><p>' +
        escapar(clienteRegistro(tipo, os) || 'Cliente não informado') + ' · ' + escapar(aparelhoRegistro(tipo, os)) +
        '</p></div><strong class="cobranca-mobile-valor">' + escapar(moeda(item.valor)) + '</strong></div>' +
        '<div class="cobranca-mobile-card-detalhe"><span>Vencimento: <strong>' + escapar(dataBr(item.data)) +
        '</strong></span><span>Após esta cobrança resta: <strong>' + escapar(moeda(saldoApos)) + '</strong></span><span>Aviso: ' + (numero(item.avisarAntesDias) > 0 ? numero(item.avisarAntesDias) + ' dia(s) antes' : 'no dia') +
        '</span></div>' + (texto(item.observacao) ? '<p class="cobranca-mobile-card-observacao">' + escapar(item.observacao) + '</p>' : '') +
        '<div class="cobranca-mobile-card-rodape"><span class="cobranca-mobile-situacao">' + escapar(nomeStatus(cobranca.status)) +
        '</span><div class="cobranca-mobile-acoes"></div></div>';
      var acoes = card.querySelector('.cobranca-mobile-acoes');
      acoes.appendChild(botao('Editar', 'btn-secundario', function () { abrirFormulario(os, item, tipo); }));
      if (cobranca.status !== 'paga') {
        acoes.appendChild(botao('Marcar paga', 'btn-secundario', function () { alterarSituacao(os, item, 'paga', tipo); }));
      } else {
        acoes.appendChild(botao('Reabrir', 'btn-secundario', function () { alterarSituacao(os, item, 'pendente', tipo); }));
      }
      if (cobranca.status !== 'atrasada' && cobranca.status !== 'paga') {
        acoes.appendChild(botao('Atrasada', 'btn-secundario', function () { alterarSituacao(os, item, 'atrasada', tipo); }));
      }
      acoes.appendChild(botao(cobranca.status === 'desativada' ? 'Ativar' : 'Desativar', 'btn-secundario', function () {
        alterarSituacao(os, item, cobranca.status === 'desativada' ? 'pendente' : 'desativada', tipo);
      }));
      acoes.appendChild(botao('Excluir', 'btn-perigo', function () { excluirCobranca(os, item, tipo); }));
      listaEl.appendChild(card);
    });
  }

  async function carregar() {
    if (carregando) { recarregarPendente = true; return; }
    if (!root.SistemaOSSupabaseOS || !root.SistemaOSSupabaseOS.listarLeves) return;
    carregando = true;
    var revisaoDaCarga = revisaoContexto;
    if (statusEl) statusEl.textContent = 'Sincronizando cobranças…';
    try {
      var dados = await Promise.all([
        root.SistemaOSSupabaseOS.listarLeves(500),
        root.SistemaOSEstoque && root.SistemaOSEstoque.listar ? root.SistemaOSEstoque.listar('aparelho') : Promise.resolve([])
      ]);
      if (revisaoDaCarga !== revisaoContexto) return;
      ordensAtuais = dados[0] || [];
      vendasAtuais = dados[1] || [];
      cobrancasAtuais = achatar(ordensAtuais, vendasAtuais);
      if (statusEl) statusEl.textContent = cobrancasAtuais.length + ' cobrança(s): ' + cobrancasAtuais.filter(function (c) { return c.tipo === 'os'; }).length + ' de OS e ' + cobrancasAtuais.filter(function (c) { return c.tipo === 'venda'; }).length + ' de vendas.';
      renderizar();
      if (root.SistemaOSNotificacoes && root.SistemaOSNotificacoes.agendarLembretesCobranca) {
        var registrosComCobranca = ordensAtuais.concat(vendasAtuais.map(function (venda) {
          return Object.assign({ _tipoCobranca: 'venda' }, venda);
        }));
        root.SistemaOSNotificacoes.agendarLembretesCobranca(registrosComCobranca).catch(function () {});
      }
    } catch (erro) {
      if (statusEl) statusEl.textContent = erro && erro.message ? erro.message : 'Não foi possível carregar as cobranças.';
      toast('Não foi possível sincronizar as cobranças.', 'erro');
    } finally {
      carregando = false;
      if (recarregarPendente) {
        recarregarPendente = false;
        await carregar();
      }
    }
  }

  function abrirFormulario(os, item, tipo) {
    if (!modalEl || !formEl) return;
    formEl.reset();
    var editando = !!(os && item);
    tipo = tipo || 'os';
    root.document.getElementById('titulo-cobranca-mobile').textContent = editando ? 'Editar cobrança' : 'Nova cobrança';
    root.document.getElementById('cobranca-mobile-id').value = editando ? texto(item.id || item.data) : '';
    var campoTipo = root.document.getElementById('cobranca-mobile-tipo');
    if (campoTipo) { campoTipo.value = editando ? tipo : 'os'; campoTipo.disabled = editando; }
    var campoOS = root.document.getElementById('cobranca-mobile-os');
    campoOS.value = editando ? referencia(tipo, os) : '';
    campoOS.disabled = editando;
    var rotuloReferencia = root.document.getElementById('cobranca-mobile-referencia-label');
    if (rotuloReferencia) rotuloReferencia.textContent = tipo === 'venda' ? 'Número da venda *' : 'Número da OS *';
    root.document.getElementById('cobranca-mobile-valor').value = editando ? numero(item.valor) || '' : '';
    root.document.getElementById('cobranca-mobile-data').value = editando ? texto(item.data).slice(0, 10) : dataHoje();
    root.document.getElementById('cobranca-mobile-situacao').value = editando ? statusCobranca(item) : 'pendente';
    root.document.getElementById('cobranca-mobile-antecedencia').value = String(Math.max(0, numero(item && item.avisarAntesDias)));
    root.document.getElementById('cobranca-mobile-observacao').value = editando ? texto(item.observacao) : '';
    modalEl.dataset.tipo = editando ? tipo : 'os';
    modalEl.dataset.referencia = editando ? referencia(tipo, os) : '';
    modalEl.hidden = false;
    if (!editando) root.setTimeout(function () { campoOS.focus(); }, 50);
  }

  function fecharFormulario() {
    if (!modalEl) return;
    modalEl.hidden = true;
    delete modalEl.dataset.tipo;
    delete modalEl.dataset.referencia;
  }

  async function obterOSAtual(numeroOS, forcar) {
    if (!root.SistemaOSSupabaseOS || !root.SistemaOSSupabaseOS.consultarPorNumero) throw new Error('Sincronização da OS indisponível.');
    var os = await root.SistemaOSSupabaseOS.consultarPorNumero(numeroOS, { forcar: forcar !== false });
    if (!os || !os.id) throw new Error('OS não encontrada nesta empresa.');
    return os;
  }

  async function obterVendaAtual(id) {
    if (!root.SistemaOSEstoque || !root.SistemaOSEstoque.obterAparelho) throw new Error('Sincronização de vendas indisponível.');
    var venda = await root.SistemaOSEstoque.obterAparelho(texto(id));
    if (!venda || !venda.id) throw new Error('Venda não encontrada nesta empresa. Use o número EST da venda.');
    venda._tipoCobranca = 'venda';
    return venda;
  }

  function valorRecebidoOS(os) {
    var valorExato = numero(os.valorRecebidoConfirmado);
    if (valorExato > 0) return valorExato;
    var total = numero(os.valorTotalServico || os.valorVenda || os.valor);
    return total * Math.max(0, Math.min(100, numero(os.percentualPagamentoConfirmado))) / 100;
  }

  function prepararSituacao(item, situacao, anterior) {
    var novo = Object.assign({}, item, { status: situacao, atualizadoEm: new Date().toISOString() });
    if (situacao === 'paga') {
      novo.confirmadoEm = texto(anterior && anterior.confirmadoEm) || novo.atualizadoEm;
      novo.pagoEm = novo.confirmadoEm;
      novo.valorRecebido = numero(novo.valor);
      if (!anterior || statusCobranca(anterior) !== 'paga') novo.impactaRecebimento = true;
      delete novo.desativadoEm;
    } else {
      delete novo.confirmadoEm;
      delete novo.pagoEm;
      delete novo.valorRecebido;
      delete novo.impactaRecebimento;
      if (situacao === 'desativada') novo.desativadoEm = novo.atualizadoEm;
      else delete novo.desativadoEm;
    }
    if (situacao === 'atrasada') novo.atrasadoEm = novo.atualizadoEm;
    else delete novo.atrasadoEm;
    return novo;
  }

  function recalcularFinanceiro(os, extras, anteriores, novos) {
    var total = numero(os.valorTotalServico || os.valorVenda || os.valor);
    var impactosAntigos = (anteriores || []).reduce(function (soma, item) {
      return soma + (item.impactaRecebimento && statusCobranca(item) === 'paga' ? numero(item.valorRecebido || item.valor) : 0);
    }, 0);
    var baseSalva = Number(extras.valor_recebido_base_cobrancas);
    var base = Number.isFinite(baseSalva) ? baseSalva : Math.max(0, valorRecebidoOS(os) - impactosAntigos);
    var impactosNovos = (novos || []).reduce(function (soma, item) {
      return soma + (item.impactaRecebimento && statusCobranca(item) === 'paga' ? numero(item.valorRecebido || item.valor) : 0);
    }, 0);
    var recebido = total > 0 ? Math.min(total, base + impactosNovos) : base + impactosNovos;
    var percentual = total > 0 ? Math.min(100, Math.round(recebido / total * 100)) : 0;
    extras.valor_recebido_base_cobrancas = Number(base.toFixed(2));
    extras.valor_recebido_confirmado = Number(recebido.toFixed(2));
    extras.valor_restante_servico = Math.max(0, Number((total - recebido).toFixed(2)));
    extras.percentual_pagamento_confirmado = percentual;
    if (total > 0 && percentual >= 100) extras.status_pagamento_local = 'Pago';
    else if (percentual >= 50) extras.status_pagamento_local = 'Pago 50%';
    return extras;
  }

  async function salvarNaOS(os, lembretes, exclusoes) {
    var anteriores = Array.isArray(os.lembretesCobranca) ? os.lembretesCobranca.map(function (item) { return Object.assign({}, item); }) : [];
    var extras = Object.assign({}, os.dadosExtras || {}, {
      lembretes_cobranca: normalizarLembretes(lembretes),
      lembretes_cobranca_excluidos: normalizarExclusoes(exclusoes || os.dadosExtras && os.dadosExtras.lembretes_cobranca_excluidos)
    });
    recalcularFinanceiro(os, extras, anteriores, lembretes);
    var patch = { dados_extras: extras };
    if (extras.status_pagamento_local === 'Pago') patch.status_pagamento = 'Autorizado';
    var resultado = await root.CloudData.atualizarOS(os, os.revision, patch);
    if (!resultado || (!resultado.enviado && !resultado.enfileirado)) {
      var erro = new Error(resultado && resultado.motivo === 'conflito'
        ? 'A cobrança mudou em outro dispositivo. Reconciliando…'
        : 'A nuvem não confirmou a alteração.');
      erro.tipo = resultado && resultado.motivo || 'servidor';
      throw erro;
    }
    if (root.SistemaOSSupabaseOS._invalidarConsultasLeves) root.SistemaOSSupabaseOS._invalidarConsultasLeves();
    return resultado;
  }

  async function salvarNaVenda(venda, lembretes, exclusoes) {
    var anteriores = normalizarLembretes(venda.lembretesCobranca);
    var extras = {
      valor_recebido_base_cobrancas: venda.valorRecebidoBaseCobrancas,
      lembretes_cobranca: normalizarLembretes(lembretes),
      lembretes_cobranca_excluidos: normalizarExclusoes(exclusoes || venda.lembretesCobrancaExcluidos)
    };
    recalcularFinanceiro(venda, extras, anteriores, lembretes);
    var salvo = await root.SistemaOSEstoque.salvarAparelho({
      lembretesCobranca: extras.lembretes_cobranca,
      lembretesCobrancaExcluidos: extras.lembretes_cobranca_excluidos,
      valorRecebidoBaseCobrancas: extras.valor_recebido_base_cobrancas,
      valorRecebidoConfirmado: extras.valor_recebido_confirmado,
      valorRestanteVenda: extras.valor_restante_servico
    }, venda);
    return { enviado: !salvo._pendenteNuvem, enfileirado: !!salvo._pendenteNuvem };
  }

  function aplicarMutacao(os, mutacao) {
    var lembretes = normalizarLembretes(os.lembretesCobranca);
    var exclusoes = normalizarExclusoes(os.lembretesCobrancaExcluidos || os.dadosExtras && os.dadosExtras.lembretes_cobranca_excluidos);
    var alvoId = texto(mutacao.alvoId);
    var indice = alvoId ? lembretes.findIndex(function (item) { return item.id === alvoId; }) : -1;
    if (mutacao.tipo === 'excluir') {
      if (indice >= 0) lembretes.splice(indice, 1);
      exclusoes = exclusoes.filter(function (item) { return item.id !== alvoId; });
      exclusoes.push({ id: alvoId, excluidoEm: new Date().toISOString() });
    } else {
      var anterior = indice >= 0 ? lembretes[indice] : null;
      var novo = mutacao.criar(anterior);
      novo = Object.assign({}, anterior || {}, novo, {
        id: texto(novo && novo.id) || alvoId || ('cob-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7))
      });
      exclusoes = exclusoes.filter(function (item) { return item.id !== novo.id; });
      if (indice >= 0) lembretes[indice] = novo;
      else lembretes.push(novo);
    }
    lembretes.sort(function (a, b) { return texto(a.data).localeCompare(texto(b.data)) || texto(a.id).localeCompare(texto(b.id)); });
    return { lembretes: lembretes, exclusoes: exclusoes };
  }

  async function salvarMutacaoCobranca(osResumo, mutacao, tipoRegistro) {
    var ultimaFalha = null;
    tipoRegistro = tipoRegistro || (osResumo && osResumo._tipoCobranca) || 'os';
    for (var tentativa = 0; tentativa < 3; tentativa += 1) {
      var referenciaRegistro = tipoRegistro === 'venda'
        ? texto(osResumo && (osResumo.id || osResumo.referencia) || osResumo)
        : texto(osResumo && osResumo.numero || osResumo);
      var os = tipoRegistro === 'venda'
        ? await obterVendaAtual(referenciaRegistro)
        : await obterOSAtual(referenciaRegistro, true);
      var alteracao = aplicarMutacao(os, mutacao);
      try {
        return tipoRegistro === 'venda'
          ? await salvarNaVenda(os, alteracao.lembretes, alteracao.exclusoes)
          : await salvarNaOS(os, alteracao.lembretes, alteracao.exclusoes);
      } catch (erro) {
        ultimaFalha = erro;
        if (erro.tipo !== 'conflito') throw erro;
        if (root.SistemaOSSupabaseOS._invalidarConsultasLeves) root.SistemaOSSupabaseOS._invalidarConsultasLeves();
      }
    }
    throw ultimaFalha || new Error('Não foi possível reconciliar a cobrança com o PC.');
  }

  async function alterarSituacao(osResumo, itemResumo, situacao, tipoRegistro) {
    try {
      var resultado = await salvarMutacaoCobranca(osResumo, {
        tipo: 'alterar',
        alvoId: texto(itemResumo.id || itemResumo.data),
        criar: function (item) {
          if (!item) throw new Error('Esta cobrança não existe mais. Atualize a lista.');
          return prepararSituacao(item, situacao, item);
        }
      }, tipoRegistro || 'os');
      toast(resultado.enfileirado ? 'Situação salva e aguardando conexão.' : 'Cobrança marcada como ' + nomeStatus(situacao).toLowerCase() + '.', resultado.enfileirado ? 'aviso' : 'sucesso');
      await carregar();
    } catch (erro) {
      toast(erro && erro.message ? erro.message : 'Não foi possível alterar a cobrança.', 'erro');
    }
  }

  async function excluirCobranca(osResumo, itemResumo, tipoRegistro) {
    tipoRegistro = tipoRegistro || 'os';
    if (!root.confirm('Excluir esta cobrança de ' + referencia(tipoRegistro, osResumo) + '? Ela também será removida do PC.')) return;
    try {
      var id = texto(itemResumo.id || itemResumo.data);
      await salvarMutacaoCobranca(osResumo, { tipo: 'excluir', alvoId: id }, tipoRegistro);
      if (tipoRegistro === 'os' && root.SistemaOSNotificacoes && root.SistemaOSNotificacoes.cancelarLembreteCobranca) {
        root.SistemaOSNotificacoes.cancelarLembreteCobranca(osResumo, itemResumo).catch(function () {});
      }
      toast('Cobrança excluída do celular e da nuvem.', 'sucesso');
      await carregar();
    } catch (erro) {
      toast(erro && erro.message ? erro.message : 'Não foi possível excluir a cobrança.', 'erro');
    }
  }

  async function salvarFormulario(evento) {
    evento.preventDefault();
    var botaoSalvar = root.document.getElementById('btn-salvar-cobranca-mobile');
    var numeroOS = root.document.getElementById('cobranca-mobile-os').value;
    var tipoRegistro = root.document.getElementById('cobranca-mobile-tipo')?.value || 'os';
    var valor = numero(root.document.getElementById('cobranca-mobile-valor').value);
    var data = root.document.getElementById('cobranca-mobile-data').value;
    var situacao = root.document.getElementById('cobranca-mobile-situacao').value;
    var antecedencia = Math.max(0, Math.min(30, numero(root.document.getElementById('cobranca-mobile-antecedencia').value)));
    var observacao = texto(root.document.getElementById('cobranca-mobile-observacao').value);
    var idEdicao = root.document.getElementById('cobranca-mobile-id').value;
    if (!(valor > 0)) return toast('Informe um valor maior que zero.', 'erro');
    if (!dataValida(data)) return toast('Informe uma data de vencimento válida.', 'erro');
    botaoSalvar.disabled = true;
    botaoSalvar.textContent = 'Salvando…';
    try {
      var agora = new Date().toISOString();
      var resumo = tipoRegistro === 'venda' ? { id: numeroOS, _tipoCobranca: 'venda' } : { numero: numeroOS };
      var resultado = await salvarMutacaoCobranca(resumo, {
        tipo: 'salvar',
        alvoId: idEdicao,
        criar: function (anterior) {
          var base = Object.assign({}, anterior || {}, {
            id: anterior && anterior.id || ('cob-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
            data: data,
            valor: Number(valor.toFixed(2)),
            avisarAntesDias: antecedencia,
            observacao: observacao,
            criadoEm: anterior && anterior.criadoEm || agora,
            atualizadoEm: agora
          });
          return prepararSituacao(base, situacao, anterior);
        }
      }, tipoRegistro);
      fecharFormulario();
      toast(resultado.enfileirado ? 'Cobrança salva. Será sincronizada ao reconectar.' : 'Cobrança salva e sincronizada com o PC.', resultado.enfileirado ? 'aviso' : 'sucesso');
      await carregar();
    } catch (erro) {
      toast(erro && erro.message ? erro.message : 'Não foi possível salvar a cobrança.', 'erro');
    } finally {
      botaoSalvar.disabled = false;
      botaoSalvar.textContent = 'Salvar cobrança';
    }
  }

  async function testarNotificacao() {
    var preferida = cobrancasAtuais.find(function (c) { return c.tipo === 'os' && /(?:^|-)0*20$/.test(texto(c.os && c.os.numero)); });
    var cobranca = preferida || cobrancasAtuais.find(function (c) { return c.status === 'pendente' || c.status === 'atrasada'; });
    if (!cobranca) return toast('Cadastre uma cobrança antes de testar a notificação.', 'aviso');
    if (!root.SistemaOSNotificacoes || !root.SistemaOSNotificacoes.notificarTesteCobranca) {
      return toast('Notificações locais indisponíveis neste aparelho.', 'erro');
    }
    var resultado = await root.SistemaOSNotificacoes.notificarTesteCobranca(Object.assign({ _tipoCobranca: cobranca.tipo }, cobranca.registro || cobranca.os), cobranca.item);
    toast(resultado && resultado.agendada ? 'Notificação de teste enviada pelo aplicativo.' : 'Autorize as notificações do Sistema OS para concluir o teste.', resultado && resultado.agendada ? 'sucesso' : 'erro');
  }

  function abrir(numeroOS, lembreteId) {
    var botaoNav = root.document && root.document.getElementById('btn-ir-cobrancas');
    if (botaoNav) botaoNav.click();
    if (numeroOS) {
      if (buscaEl) buscaEl.value = rotuloOS(numeroOS);
      filtroAtual = 'todas';
      tipoAtual = 'todos';
    }
    carregar().then(function () {
      renderizar();
      if (!lembreteId) return;
      var alvo = listaEl && listaEl.querySelector('[data-lembrete-id="' + String(lembreteId).replace(/"/g, '\\"') + '"]');
      if (alvo && alvo.scrollIntoView) alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  if (root.document) {
    root.document.getElementById('btn-nova-cobranca-mobile')?.addEventListener('click', function () { abrirFormulario(null, null); });
    root.document.getElementById('btn-atualizar-cobrancas-mobile')?.addEventListener('click', carregar);
    root.document.getElementById('btn-testar-notificacao-cobranca')?.addEventListener('click', function () { testarNotificacao().catch(function (erro) { toast(erro.message, 'erro'); }); });
    root.document.getElementById('btn-fechar-cobranca-mobile')?.addEventListener('click', fecharFormulario);
    root.document.getElementById('btn-cancelar-cobranca-mobile')?.addEventListener('click', fecharFormulario);
    if (formEl) formEl.addEventListener('submit', salvarFormulario);
    if (buscaEl) buscaEl.addEventListener('input', renderizar);
    root.document.getElementById('cobranca-mobile-tipo')?.addEventListener('change', function (evento) {
      var venda = evento.target.value === 'venda';
      var rotulo = root.document.getElementById('cobranca-mobile-referencia-label');
      var campo = root.document.getElementById('cobranca-mobile-os');
      if (rotulo) rotulo.textContent = venda ? 'Número da venda *' : 'Número da OS *';
      if (campo) campo.placeholder = venda ? 'Ex.: EST-0002' : 'Ex.: 20 ou OS-0020';
    });
    root.document.getElementById('cobrancas-mobile-tipos')?.addEventListener('click', function (evento) {
      var botao = evento.target.closest('button[data-tipo]');
      if (!botao) return;
      tipoAtual = botao.dataset.tipo;
      Array.prototype.forEach.call(botao.parentNode.querySelectorAll('button[data-tipo]'), function (item) {
        var ativo = item === botao;
        item.classList.toggle('ativo', ativo);
        item.setAttribute('aria-selected', String(ativo));
      });
      renderizar();
    });
    root.document.getElementById('cobrancas-mobile-filtros')?.addEventListener('click', function (evento) {
      var botao = evento.target.closest('button[data-status]');
      if (!botao) return;
      filtroAtual = botao.dataset.status;
      Array.prototype.forEach.call(botao.parentNode.querySelectorAll('button[data-status]'), function (item) { item.classList.toggle('ativo', item === botao); });
      renderizar();
    });
    root.document.addEventListener('sistema-os:tela-cobrancas-aberta', function () {
      carregar();
      if (!pararRealtime && root.SistemaOSSupabaseOS && root.SistemaOSSupabaseOS.assinar) {
        pararRealtime = root.SistemaOSSupabaseOS.assinar(function () { carregar(); });
      }
      if (!pararRealtimeEstoque && root.SistemaOSEstoque && root.SistemaOSEstoque.assinar) {
        pararRealtimeEstoque = root.SistemaOSEstoque.assinar(function () { carregar(); });
      }
    });
    root.document.addEventListener('sistema-os:tela-cobrancas-fechada', function () {
      if (pararRealtime) pararRealtime();
      if (pararRealtimeEstoque) pararRealtimeEstoque();
      pararRealtime = null;
      pararRealtimeEstoque = null;
    });
    root.document.addEventListener('sistema-os:sessao-alterada', function () {
      revisaoContexto += 1;
      ordensAtuais = [];
      vendasAtuais = [];
      cobrancasAtuais = [];
      if (statusEl) statusEl.textContent = '';
      renderizar();
      if (carregando) recarregarPendente = true;
    });
  }

  return {
    abrir: abrir,
    carregar: carregar,
    statusCobranca: statusCobranca,
    achatar: achatar,
    prepararSituacao: prepararSituacao,
    recalcularFinanceiro: recalcularFinanceiro
    ,normalizarLembretes: normalizarLembretes
    ,aplicarMutacao: aplicarMutacao
    ,salvarMutacaoCobranca: salvarMutacaoCobranca
  };
});
