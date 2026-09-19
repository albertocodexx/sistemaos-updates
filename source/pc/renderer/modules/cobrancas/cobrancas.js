(function () {
  'use strict';

  const estado = { tipo: 'todos', status: 'todas', registros: [], cobrancas: [], carregando: false };
  const $ = (id) => document.getElementById(id);
  const texto = (valor) => String(valor == null ? '' : valor).trim();
  const numero = (valor) => Number.isFinite(Number(valor)) ? Number(valor) : 0;
  const moeda = (valor) => numero(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dataBr = (valor) => {
    const partes = texto(valor).slice(0, 10).split('-');
    return partes.length === 3 ? partes.reverse().join('/') : 'Sem data';
  };
  const escapar = (valor) => texto(valor).replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caractere]);
  const avisar = (mensagem, tipo) => {
    if (typeof window.toast === 'function') window.toast(mensagem, tipo || '');
    else if ($('cobrancasPCMensagem')) $('cobrancasPCMensagem').textContent = mensagem;
  };

  function hashCurto(valor) {
    let hash = 2166136261;
    const entrada = texto(valor);
    for (let i = 0; i < entrada.length; i += 1) {
      hash ^= entrada.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizarLembretes(lista) {
    const vistos = new Set();
    return (Array.isArray(lista) ? lista : []).filter(Boolean).slice(0, 60).map((original, indice) => {
      const item = Object.assign({}, original);
      let id = texto(item.id) || `cob-legacy-${hashCurto([item.criadoEm, item.data, numero(item.valor).toFixed(2), item.observacao].join('|'))}`;
      if (vistos.has(id)) id += `-${indice + 1}`;
      vistos.add(id);
      item.id = id;
      item.data = texto(item.data).slice(0, 10);
      item.valor = Math.max(0, numero(item.valor));
      item.status = texto(item.status).toLowerCase() || 'pendente';
      return item;
    }).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.data));
  }

  function normalizarExclusoes(lista) {
    const mapa = new Map();
    for (const original of (Array.isArray(lista) ? lista : [])) {
      const id = texto(original?.id || original);
      if (!id) continue;
      const item = original && typeof original === 'object' ? Object.assign({}, original, { id }) : { id, excluidoEm: '' };
      const anterior = mapa.get(id);
      if (!anterior || Date.parse(item.excluidoEm || 0) >= Date.parse(anterior.excluidoEm || 0)) mapa.set(id, item);
    }
    return [...mapa.values()].slice(-120);
  }

  function situacao(item) {
    const salva = texto(item?.status).toLowerCase();
    if ((item?.confirmadoEm || item?.pagoEm) && salva !== 'desativada') return 'paga';
    if (['paga', 'desativada', 'atrasada'].includes(salva)) return salva;
    const limite = new Date(`${texto(item?.data).slice(0, 10)}T23:59:59`);
    return Number.isFinite(limite.getTime()) && limite.getTime() < Date.now() ? 'atrasada' : 'pendente';
  }

  function prepararSituacao(item, proxima, anterior) {
    const agora = new Date().toISOString();
    const novo = Object.assign({}, item, { status: proxima, atualizadoEm: agora });
    if (proxima === 'paga') {
      novo.confirmadoEm = texto(anterior?.confirmadoEm) || agora;
      novo.pagoEm = novo.confirmadoEm;
      novo.valorRecebido = numero(novo.valor);
      if (!anterior || situacao(anterior) !== 'paga') novo.impactaRecebimento = true;
      delete novo.desativadoEm;
    } else {
      delete novo.confirmadoEm;
      delete novo.pagoEm;
      delete novo.valorRecebido;
      delete novo.impactaRecebimento;
      if (proxima === 'desativada') novo.desativadoEm = agora;
      else delete novo.desativadoEm;
    }
    if (proxima === 'atrasada') novo.atrasadoEm = agora;
    else delete novo.atrasadoEm;
    return novo;
  }

  function totalRegistro(tipo, registro) {
    return tipo === 'os'
      ? numero(registro.valorTotalServico || registro.diagnosticoTecnico?.valorEstimado)
      : numero(registro.valorVenda);
  }

  function recebidoRegistro(registro) {
    return Math.max(0, numero(registro.valorRecebidoConfirmado));
  }

  function referencia(tipo, registro) { return tipo === 'os' ? texto(registro.numero) : texto(registro.id); }
  function cliente(tipo, registro) { return tipo === 'os' ? texto(registro.cliente?.nome) : texto(registro.compradorNome); }
  function aparelho(tipo, registro) {
    const base = tipo === 'os' ? (registro.aparelho || {}) : registro;
    return texto(base.nome || [base.marca, base.modelo].filter(Boolean).join(' ')) || 'Aparelho não informado';
  }

  function achatar(ordens, vendas) {
    const resultado = [];
    const adicionar = (tipo, registro) => normalizarLembretes(registro.lembretesCobranca).forEach((item) => {
      resultado.push({ tipo, registro, item, status: situacao(item) });
    });
    (ordens || []).forEach((registro) => adicionar('os', registro));
    (vendas || []).filter((registro) => ['Vendido', 'Reservado'].includes(registro.status) || normalizarLembretes(registro.lembretesCobranca).length).forEach((registro) => adicionar('venda', registro));
    const prioridade = { atrasada: 0, pendente: 1, paga: 2, desativada: 3 };
    return resultado.sort((a, b) => (prioridade[a.status] - prioridade[b.status]) || texto(a.item.data).localeCompare(texto(b.item.data)));
  }

  function filtradas() {
    const termo = texto($('cobrancasPCBusca')?.value).toLowerCase();
    return estado.cobrancas.filter((cobranca) => {
      if (estado.tipo !== 'todos' && cobranca.tipo !== estado.tipo) return false;
      if (estado.status !== 'todas' && cobranca.status !== estado.status) return false;
      if (!termo) return true;
      return [referencia(cobranca.tipo, cobranca.registro), cliente(cobranca.tipo, cobranca.registro), aparelho(cobranca.tipo, cobranca.registro), cobranca.item.observacao]
        .map(texto).join(' ').toLowerCase().includes(termo);
    });
  }

  function atualizarResumo() {
    const pendentes = estado.cobrancas.filter((c) => c.status === 'pendente');
    const atrasadas = estado.cobrancas.filter((c) => c.status === 'atrasada');
    $('cobrancasPCPendentes').textContent = String(pendentes.length);
    $('cobrancasPCAtrasadas').textContent = String(atrasadas.length);
    $('cobrancasPCValor').textContent = moeda(pendentes.concat(atrasadas).reduce((soma, c) => soma + numero(c.item.valor), 0));
  }

  function renderizar() {
    const lista = $('cobrancasPCLista');
    if (!lista) return;
    atualizarResumo();
    const itens = filtradas();
    if (!itens.length) {
      lista.innerHTML = '<div class="cobrancas-pc-vazio">Nenhuma cobrança neste filtro.</div>';
      return;
    }
    lista.innerHTML = itens.map((cobranca) => {
      const total = totalRegistro(cobranca.tipo, cobranca.registro);
      const recebido = recebidoRegistro(cobranca.registro);
      const valor = Math.min(numero(cobranca.item.valor), Math.max(0, total - recebido)) || numero(cobranca.item.valor);
      const saldoApos = Math.max(0, total - recebido - (cobranca.status === 'paga' ? 0 : valor));
      const chave = encodeURIComponent(`${cobranca.tipo}|${referencia(cobranca.tipo, cobranca.registro)}|${cobranca.item.id}`);
      return `<article class="cobrancas-pc-card" data-status="${escapar(cobranca.status)}">
        <div><span class="cobrancas-pc-badge">${cobranca.tipo === 'os' ? 'OS' : 'Venda'} · ${escapar(cobranca.status)}</span><h3>${escapar(referencia(cobranca.tipo, cobranca.registro))} · ${escapar(cliente(cobranca.tipo, cobranca.registro) || 'Cliente não informado')}</h3><p>${escapar(aparelho(cobranca.tipo, cobranca.registro))}${texto(cobranca.item.observacao) ? ` · ${escapar(cobranca.item.observacao)}` : ''}</p></div>
        <div class="cobrancas-pc-card-valor"><strong>${escapar(moeda(cobranca.item.valor))}</strong><span>Após esta cobrança resta ${escapar(moeda(saldoApos))}</span></div>
        <div class="cobrancas-pc-card-data"><strong>${escapar(dataBr(cobranca.item.data))}</strong><span>${numero(cobranca.item.avisarAntesDias) ? `Avisar ${numero(cobranca.item.avisarAntesDias)} dia(s) antes` : 'Avisar no dia'}</span></div>
        <div class="cobrancas-pc-card-acoes"><button class="botao botao-fantasma" data-cobranca-acao="editar" data-chave="${chave}">Editar</button><button class="botao botao-fantasma" data-cobranca-acao="${cobranca.status === 'paga' ? 'pendente' : 'paga'}" data-chave="${chave}">${cobranca.status === 'paga' ? 'Reabrir' : 'Marcar paga'}</button><button class="botao botao-perigo" data-cobranca-acao="excluir" data-chave="${chave}">Excluir</button></div>
      </article>`;
    }).join('');
  }

  async function carregar({ sincronizar = false } = {}) {
    if (estado.carregando) return;
    estado.carregando = true;
    $('cobrancasPCMensagem').textContent = sincronizar ? 'Sincronizando com o celular…' : 'Carregando cobranças…';
    try {
      if (sincronizar && window.api.supabasesincronizaragora) await window.api.supabasesincronizaragora();
      const [ordens, estoque] = await Promise.all([window.api.oslistar(), window.api.estoquelistar()]);
      estado.registros = [{ tipo: 'os', itens: ordens || [] }, { tipo: 'venda', itens: estoque || [] }];
      estado.cobrancas = achatar(ordens, estoque);
      $('cobrancasPCMensagem').textContent = `${estado.cobrancas.length} cobrança(s) sincronizada(s): ${estado.cobrancas.filter((c) => c.tipo === 'os').length} de OS e ${estado.cobrancas.filter((c) => c.tipo === 'venda').length} de vendas.`;
      renderizar();
    } catch (erro) {
      $('cobrancasPCMensagem').textContent = erro?.message || 'Não foi possível carregar as cobranças.';
      avisar('Não foi possível sincronizar as cobranças.', 'erro');
    } finally { estado.carregando = false; }
  }

  function encontrarCobranca(chaveCodificada) {
    const [tipo, ref, id] = decodeURIComponent(chaveCodificada || '').split('|');
    return estado.cobrancas.find((c) => c.tipo === tipo && referencia(tipo, c.registro) === ref && c.item.id === id);
  }

  function hoje() {
    const data = new Date();
    return new Date(data.getTime() - data.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function abrirFormulario(cobranca) {
    const form = $('formCobrancaPC');
    form.reset();
    const editando = !!cobranca;
    $('tituloModalCobrancaPC').textContent = editando ? 'Editar cobrança' : 'Nova cobrança';
    $('cobrancaPCId').value = editando ? cobranca.item.id : '';
    $('cobrancaPCTipo').value = editando ? cobranca.tipo : 'os';
    $('cobrancaPCTipo').disabled = editando;
    $('cobrancaPCReferencia').value = editando ? referencia(cobranca.tipo, cobranca.registro) : '';
    $('cobrancaPCReferencia').disabled = editando;
    $('cobrancaPCValorCampo').value = editando ? numero(cobranca.item.valor) : '';
    $('cobrancaPCData').value = editando ? cobranca.item.data : hoje();
    $('cobrancaPCSituacao').value = editando ? cobranca.status : 'pendente';
    $('cobrancaPCAntes').value = String(Math.max(0, numero(cobranca?.item.avisarAntesDias)));
    $('cobrancaPCObservacao').value = editando ? texto(cobranca.item.observacao) : '';
    $('modalCobrancaPC').dataset.chave = editando ? encodeURIComponent(`${cobranca.tipo}|${referencia(cobranca.tipo, cobranca.registro)}|${cobranca.item.id}`) : '';
    $('modalCobrancaPC').classList.remove('escondido');
    if (!editando) setTimeout(() => $('cobrancaPCReferencia').focus(), 40);
  }

  function fecharFormulario() { $('modalCobrancaPC').classList.add('escondido'); }

  function encontrarRegistro(tipo, ref) {
    const lista = estado.registros.find((grupo) => grupo.tipo === tipo)?.itens || [];
    const alvo = texto(ref).toLowerCase();
    const digitos = alvo.replace(/\D/g, '').replace(/^0+/, '');
    return lista.find((registro) => {
      const valor = referencia(tipo, registro).toLowerCase();
      return valor === alvo || (digitos && valor.replace(/\D/g, '').replace(/^0+/, '') === digitos);
    });
  }

  function recalcularVenda(registro, lembretes) {
    const anteriores = normalizarLembretes(registro.lembretesCobranca);
    const pagoAnterior = anteriores.reduce((soma, item) => soma + (item.impactaRecebimento && situacao(item) === 'paga' ? numero(item.valorRecebido || item.valor) : 0), 0);
    const baseSalva = Number(registro.valorRecebidoBaseCobrancas);
    const base = Number.isFinite(baseSalva) ? Math.max(0, baseSalva) : Math.max(0, recebidoRegistro(registro) - pagoAnterior);
    const pagoNovo = lembretes.reduce((soma, item) => soma + (item.impactaRecebimento && situacao(item) === 'paga' ? numero(item.valorRecebido || item.valor) : 0), 0);
    const total = totalRegistro('venda', registro);
    const recebido = total > 0 ? Math.min(total, base + pagoNovo) : base + pagoNovo;
    return { valorRecebidoBaseCobrancas: Number(base.toFixed(2)), valorRecebidoConfirmado: Number(recebido.toFixed(2)), valorRestanteVenda: Math.max(0, Number((total - recebido).toFixed(2))) };
  }

  async function persistir(tipo, registro, lembretes, exclusoes) {
    if (tipo === 'os') {
      await window.api.osatualizar(registro.numero, { lembretesCobranca: lembretes, lembretesCobrancaExcluidos: exclusoes });
    } else {
      const financeiro = recalcularVenda(registro, lembretes);
      await window.api.estoqueatualizar(registro.id, Object.assign({}, registro, financeiro, { lembretesCobranca: lembretes, lembretesCobrancaExcluidos: exclusoes }));
    }
    if (window.api.supabasesincronizaragora) await window.api.supabasesincronizaragora();
  }

  async function salvar(evento) {
    evento.preventDefault();
    const botao = $('btnSalvarCobrancaPC');
    const tipo = $('cobrancaPCTipo').value;
    const ref = $('cobrancaPCReferencia').value;
    const registro = encontrarRegistro(tipo, ref);
    if (!registro) return avisar(tipo === 'os' ? 'OS não encontrada nesta empresa.' : 'Venda não encontrada. Informe o código EST da venda.', 'erro');
    const valor = numero($('cobrancaPCValorCampo').value);
    const data = $('cobrancaPCData').value;
    if (!(valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return avisar('Informe valor e vencimento válidos.', 'erro');
    const id = $('cobrancaPCId').value;
    const lembretes = normalizarLembretes(registro.lembretesCobranca);
    const exclusoes = normalizarExclusoes(registro.lembretesCobrancaExcluidos);
    const indice = id ? lembretes.findIndex((item) => item.id === id) : -1;
    const anterior = indice >= 0 ? lembretes[indice] : null;
    const agora = new Date().toISOString();
    let item = Object.assign({}, anterior || {}, { id: anterior?.id || `cob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, data, valor: Number(valor.toFixed(2)), avisarAntesDias: numero($('cobrancaPCAntes').value), observacao: texto($('cobrancaPCObservacao').value), criadoEm: anterior?.criadoEm || agora, atualizadoEm: agora });
    item = prepararSituacao(item, $('cobrancaPCSituacao').value, anterior);
    if (indice >= 0) lembretes[indice] = item; else lembretes.push(item);
    botao.disabled = true; botao.textContent = 'Salvando…';
    try {
      await persistir(tipo, registro, lembretes, exclusoes.filter((x) => x.id !== item.id));
      fecharFormulario();
      avisar('Cobrança salva no PC e sincronizada com o celular.', 'sucesso');
      await carregar();
    } catch (erro) { avisar(erro?.message || 'Não foi possível salvar a cobrança.', 'erro'); }
    finally { botao.disabled = false; botao.textContent = 'Salvar cobrança'; }
  }

  async function executarAcao(cobranca, acao) {
    const registro = cobranca.registro;
    const lembretes = normalizarLembretes(registro.lembretesCobranca);
    let exclusoes = normalizarExclusoes(registro.lembretesCobrancaExcluidos);
    const indice = lembretes.findIndex((item) => item.id === cobranca.item.id);
    if (indice < 0) return avisar('A cobrança mudou em outro dispositivo. Atualize a lista.', 'erro');
    if (acao === 'excluir') {
      if (!window.confirm(`Excluir esta cobrança de ${referencia(cobranca.tipo, registro)}?`)) return;
      lembretes.splice(indice, 1);
      exclusoes = exclusoes.filter((item) => item.id !== cobranca.item.id);
      exclusoes.push({ id: cobranca.item.id, excluidoEm: new Date().toISOString() });
    } else lembretes[indice] = prepararSituacao(lembretes[indice], acao, lembretes[indice]);
    try {
      await persistir(cobranca.tipo, registro, lembretes, exclusoes);
      avisar(acao === 'excluir' ? 'Cobrança excluída no PC e no celular.' : 'Situação da cobrança atualizada.', 'sucesso');
      await carregar();
    } catch (erro) { avisar(erro?.message || 'Não foi possível atualizar a cobrança.', 'erro'); }
  }

  document.querySelector('[data-aba="cobrancas"]')?.addEventListener('click', () => carregar({ sincronizar: true }));
  $('btnAtualizarCobrancasPC')?.addEventListener('click', () => carregar({ sincronizar: true }));
  $('btnNovaCobrancaPC')?.addEventListener('click', () => abrirFormulario(null));
  $('btnFecharCobrancaPC')?.addEventListener('click', fecharFormulario);
  $('btnCancelarCobrancaPC')?.addEventListener('click', fecharFormulario);
  $('formCobrancaPC')?.addEventListener('submit', salvar);
  $('cobrancasPCBusca')?.addEventListener('input', renderizar);
  $('cobrancasPCStatus')?.addEventListener('change', (evento) => { estado.status = evento.target.value; renderizar(); });
  $('cobrancasPCTipos')?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-cobranca-tipo]');
    if (!botao) return;
    estado.tipo = botao.dataset.cobrancaTipo;
    document.querySelectorAll('[data-cobranca-tipo]').forEach((item) => { const ativo = item === botao; item.classList.toggle('ativa', ativo); item.setAttribute('aria-selected', String(ativo)); });
    renderizar();
  });
  $('cobrancasPCLista')?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-cobranca-acao]');
    if (!botao) return;
    const cobranca = encontrarCobranca(botao.dataset.chave);
    if (!cobranca) return avisar('Cobrança não encontrada. Atualize a lista.', 'erro');
    if (botao.dataset.cobrancaAcao === 'editar') abrirFormulario(cobranca);
    else executarAcao(cobranca, botao.dataset.cobrancaAcao);
  });
  window.api.onSupabaseSincronizado?.(() => {
    if (document.querySelector('[data-aba="cobrancas"]')?.classList.contains('ativa')) carregar();
  });

  window.carregarCobrancas = carregar;
  window.SistemaOSCobrancasPC = { achatar, situacao, prepararSituacao, normalizarLembretes };
})();
