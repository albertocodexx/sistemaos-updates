'use strict';

// Conciliação determinística das parcelas gravadas dentro de dados_extras.
// PC e celular podem editar a mesma OS quase ao mesmo tempo; a revisão do
// Postgres detecta a disputa, mas uma repetição cega do JSON antigo apagaria
// a parcela do outro dispositivo. Este módulo faz merge por ID e mantém
// tombstones de exclusão para a remoção também vencer uma disputa.

function texto(valor) {
  return String(valor == null ? '' : valor).trim();
}

function hashCurto(valor) {
  let hash = 2166136261;
  const entrada = texto(valor);
  for (let i = 0; i < entrada.length; i += 1) {
    hash ^= entrada.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function idLegado(item) {
  const base = [item?.criadoEm, item?.data, Number(item?.valor || 0).toFixed(2), item?.observacao].join('|');
  return `cob-legacy-${hashCurto(base)}`;
}

function instante(valor) {
  const n = Date.parse(valor || '');
  return Number.isFinite(n) ? n : 0;
}

function atualizadoEm(item) {
  return instante(item?.atualizadoEm || item?.pagoEm || item?.confirmadoEm || item?.criadoEm);
}

function normalizarLembretes(lista) {
  const vistos = new Set();
  return (Array.isArray(lista) ? lista : []).filter(Boolean).slice(0, 60).map((original, indice) => {
    const item = { ...original };
    let id = texto(item.id) || idLegado(item);
    if (vistos.has(id)) id = `${id}-${indice + 1}`;
    vistos.add(id);
    item.id = id;
    item.data = texto(item.data).slice(0, 10);
    item.valor = Math.max(0, Number(item.valor || 0) || 0);
    item.status = texto(item.status).toLowerCase() || 'pendente';
    return item;
  }).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.data));
}

function normalizarExclusoes(lista) {
  const mapa = new Map();
  for (const original of (Array.isArray(lista) ? lista : [])) {
    const id = texto(original?.id || original);
    if (!id) continue;
    const item = typeof original === 'object' && original ? { ...original, id } : { id, excluidoEm: '' };
    const anterior = mapa.get(id);
    if (!anterior || instante(item.excluidoEm) >= instante(anterior.excluidoEm)) mapa.set(id, item);
  }
  return [...mapa.values()].slice(-120);
}

function mesclarLembretes(local, remoto, exclusoesLocal, exclusoesRemoto) {
  const exclusoes = normalizarExclusoes([...(exclusoesRemoto || []), ...(exclusoesLocal || [])]);
  const tombstones = new Map(exclusoes.map(item => [item.id, instante(item.excluidoEm) || Number.MAX_SAFE_INTEGER]));
  const mapa = new Map();
  const adicionar = (item, preferirEmEmpate) => {
    const anterior = mapa.get(item.id);
    if (!anterior || atualizadoEm(item) > atualizadoEm(anterior) ||
        (preferirEmEmpate && atualizadoEm(item) === atualizadoEm(anterior))) {
      mapa.set(item.id, item);
    }
  };
  normalizarLembretes(remoto).forEach(item => adicionar(item, false));
  normalizarLembretes(local).forEach(item => adicionar(item, true));
  const lembretes = [...mapa.values()].filter(item => {
    const removidoEm = tombstones.get(item.id);
    return removidoEm === undefined || atualizadoEm(item) > removidoEm;
  }).sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id)).slice(0, 60);
  return { lembretes, exclusoes };
}

function status(item) {
  const salvo = texto(item?.status).toLowerCase();
  if ((item?.confirmadoEm || item?.pagoEm) && salvo !== 'desativada') return 'paga';
  return salvo || 'pendente';
}

function recalcularFinanceiro(extras, valorTotal) {
  const saida = { ...(extras || {}) };
  const total = Math.max(0, Number(valorTotal || saida.valor_total_servico || 0) || 0);
  const lista = normalizarLembretes(saida.lembretes_cobranca);
  const baseSalva = Number(saida.valor_recebido_base_cobrancas);
  const base = Number.isFinite(baseSalva) ? Math.max(0, baseSalva) : 0;
  const pagoNasParcelas = lista.reduce((soma, item) => {
    if (status(item) !== 'paga') return soma;
    return soma + Math.max(0, Number(item.valorRecebido ?? item.valor) || 0);
  }, 0);
  const recebido = total > 0 ? Math.min(total, base + pagoNasParcelas) : base + pagoNasParcelas;
  const percentual = total > 0 ? Math.min(100, Math.round((recebido / total) * 100)) : 0;
  saida.valor_total_servico = total;
  saida.valor_recebido_base_cobrancas = Number(base.toFixed(2));
  saida.valor_recebido_confirmado = Number(recebido.toFixed(2));
  saida.valor_restante_servico = Math.max(0, Number((total - recebido).toFixed(2)));
  saida.percentual_pagamento_confirmado = percentual;
  if (total > 0 && percentual >= 100) saida.status_pagamento_local = 'Pago';
  else if (percentual >= 50) saida.status_pagamento_local = 'Pago 50%';
  else if (saida.status_pagamento_local === 'Pago' || saida.status_pagamento_local === 'Pago 50%') {
    saida.status_pagamento_local = recebido > 0 ? 'Pagamento parcial' : 'Aguardando Pagamento';
  }
  return saida;
}

function mesclarExtrasCobranca(extrasLocal, extrasRemoto, valorTotal) {
  const local = extrasLocal && typeof extrasLocal === 'object' ? extrasLocal : {};
  const remoto = extrasRemoto && typeof extrasRemoto === 'object' ? extrasRemoto : {};
  const mescla = mesclarLembretes(
    local.lembretes_cobranca,
    remoto.lembretes_cobranca,
    local.lembretes_cobranca_excluidos,
    remoto.lembretes_cobranca_excluidos
  );
  const extras = {
    ...remoto,
    ...local,
    lembretes_cobranca: mescla.lembretes,
    lembretes_cobranca_excluidos: mescla.exclusoes
  };
  // A base representa recebimentos externos às parcelas. O maior valor evita
  // perder um pagamento confirmado pelo outro dispositivo durante o conflito.
  extras.valor_recebido_base_cobrancas = Math.max(
    Number(remoto.valor_recebido_base_cobrancas || 0) || 0,
    Number(local.valor_recebido_base_cobrancas || 0) || 0
  );
  return recalcularFinanceiro(extras, valorTotal || local.valor_total_servico || remoto.valor_total_servico);
}

module.exports = {
  normalizarLembretes,
  normalizarExclusoes,
  mesclarLembretes,
  recalcularFinanceiro,
  mesclarExtrasCobranca
};
