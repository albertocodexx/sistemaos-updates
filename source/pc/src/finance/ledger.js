'use strict';

const DIRECOES = Object.freeze(['entrada', 'saida']);
const TIPOS = Object.freeze([
  'recebimento_os',
  'custo_os',
  'venda_aparelho',
  'custo_aparelho',
  'compra_estoque',
  'reembolso'
]);

function numero(valor) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

function diaIso(valor) {
  const texto = String(valor || '').trim();
  const correspondencia = /^(\d{4}-\d{2}-\d{2})/.exec(texto);
  if (correspondencia) return correspondencia[1];
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? '' : data.toISOString().slice(0, 10);
}

function textoBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function custoManualOS(os) {
  return (os?.diagnosticoTecnico?.pecasTrocar || [])
    .reduce((soma, item) => soma + numero(item?.valor), 0);
}

function custoEstoqueOS(db, numeroOS) {
  return (db.logPecas || [])
    .filter((item) => item?.tipo === 'saida' && item?.osRef === numeroOS)
    .reduce((soma, item) => {
      const peca = (db.pecas || []).find((cadastrada) => cadastrada?.id === item?.id);
      const custoUnitario = numero(item?.custo) || numero(peca?.custo);
      return soma + custoUnitario * Math.max(1, numero(item?.quantidade) || 1);
    }, 0);
}

function valorTotalOS(os) {
  return numero(os?.valorTotalServico)
    || numero(os?.diagnosticoTecnico?.valorEstimado)
    || numero(os?.valorInvestido);
}

function criarLancamento(dados) {
  const valor = Math.abs(numero(dados.valor));
  const direcao = dados.direcao === 'saida' ? 'saida' : 'entrada';
  return {
    id: String(dados.id),
    data: diaIso(dados.data),
    dataHora: String(dados.data || ''),
    tipo: dados.tipo,
    direcao,
    grupo: dados.grupo,
    descricao: dados.descricao,
    contraparte: dados.contraparte || '',
    documento: dados.documento || '',
    clienteId: dados.clienteId || '',
    metodo: dados.metodo || '',
    valor,
    valorAssinado: direcao === 'saida' ? -valor : valor,
    impactaCaixa: dados.impactaCaixa === true,
    impactaResultado: dados.impactaResultado === true,
    observacao: dados.observacao || '',
    detalhes: dados.detalhes || {}
  };
}

/**
 * Monta um livro-caixa auditável a partir do banco existente.
 *
 * A movimentação de caixa e o resultado são propositalmente independentes:
 * - compra para estoque sai do caixa quando é comprada;
 * - o custo do aparelho só reduz o lucro quando ele é vendido;
 * - custo de peça de OS acompanha proporcionalmente os recebimentos da OS,
 *   evitando duplicação quando 50% é pago em um mês e 50% em outro.
 */
function montarLancamentos(dbEntrada) {
  const db = dbEntrada || {};
  const ordens = Array.isArray(db.ordens) ? db.ordens : [];
  const pagamentos = (Array.isArray(db.pagamentos) ? db.pagamentos : [])
    .filter((item) => item?.status !== 'reembolsado');
  const reembolsos = Array.isArray(db.reembolsos) ? db.reembolsos : [];
  const lancamentos = [];

  const pagamentosPorOS = new Map();
  pagamentos.forEach((pagamento) => {
    if (!pagamento?.osNumero) return;
    if (!pagamentosPorOS.has(pagamento.osNumero)) pagamentosPorOS.set(pagamento.osNumero, []);
    pagamentosPorOS.get(pagamento.osNumero).push(pagamento);
  });

  pagamentosPorOS.forEach((lista, numeroOS) => {
    const os = ordens.find((item) => item?.numero === numeroOS) || {};
    const totalOS = valorTotalOS(os);
    const custoManual = custoManualOS(os);
    const custoEstoque = custoEstoqueOS(db, numeroOS);
    const custoTotal = custoManual + custoEstoque;
    let baseJaReconhecida = 0;

    lista.sort((a, b) => String(a?.dataPagamento || '').localeCompare(String(b?.dataPagamento || '')))
      .forEach((pagamento) => {
        const valorPagamento = Math.abs(numero(pagamento?.valor));
        const cliente = pagamento?.clienteNome || os?.cliente?.nome || '';
        const clienteId = pagamento?.clienteId || os?.cliente?.clienteId || '';
        lancamentos.push(criarLancamento({
          id: `pag:${pagamento?.id || numeroOS + ':' + pagamento?.dataPagamento}`,
          data: pagamento?.dataPagamento || pagamento?.criadoEm || os?.data,
          tipo: 'recebimento_os',
          direcao: 'entrada',
          grupo: 'os',
          descricao: `Recebimento da ${numeroOS}`,
          contraparte: cliente,
          documento: numeroOS,
          clienteId,
          metodo: pagamento?.metodo || pagamento?.origem || '',
          valor: valorPagamento,
          impactaCaixa: true,
          impactaResultado: true,
          observacao: pagamento?.observacao || '',
          detalhes: {
            aparelho: pagamento?.aparelho || [os?.aparelho?.marca, os?.aparelho?.modelo].filter(Boolean).join(' '),
            origem: pagamento?.origem || '',
            valorTotalOS: totalOS,
            pagamentoId: pagamento?.id || ''
          }
        }));

        if (custoTotal <= 0) return;
        const baseRestante = totalOS > 0 ? Math.max(0, totalOS - baseJaReconhecida) : 0;
        const baseDestePagamento = totalOS > 0 ? Math.min(valorPagamento, baseRestante) : 0;
        const proporcao = totalOS > 0 ? baseDestePagamento / totalOS : (baseJaReconhecida === 0 ? 1 : 0);
        baseJaReconhecida += baseDestePagamento;
        const custoReconhecido = custoTotal * proporcao;
        if (custoReconhecido <= 0) return;

        lancamentos.push(criarLancamento({
          id: `custo-os:${pagamento?.id || numeroOS + ':' + pagamento?.dataPagamento}`,
          data: pagamento?.dataPagamento || pagamento?.criadoEm || os?.data,
          tipo: 'custo_os',
          direcao: 'saida',
          grupo: 'os',
          descricao: `Custo reconhecido da ${numeroOS}`,
          contraparte: cliente,
          documento: numeroOS,
          clienteId,
          valor: custoReconhecido,
          impactaCaixa: false,
          impactaResultado: true,
          observacao: 'Custo proporcional ao valor recebido; não representa uma nova saída de caixa.',
          detalhes: {
            custoPecasEstoque: custoEstoque * proporcao,
            custoPecasManuais: custoManual * proporcao,
            proporcaoReconhecida: proporcao,
            custoTotalOS: custoTotal
          }
        }));
      });
  });

  (db.estoque || []).filter((item) => item?.status === 'Vendido' && item?.dataVenda).forEach((item) => {
    const documento = item?.id || 'Venda';
    const descricao = [item?.marca, item?.modelo].filter(Boolean).join(' ') || 'Aparelho';
    const custoAquisicao = numero(item?.valorPago);
    const custoPecas = numero(item?.valorGastoPecas);
    const gastosExtras = numero(item?.gastosExtras);
    const custoTotal = custoAquisicao + custoPecas + gastosExtras;
    lancamentos.push(criarLancamento({
      id: `venda:${documento}`,
      data: item?.dataVenda,
      tipo: 'venda_aparelho',
      direcao: 'entrada',
      grupo: 'vendas',
      descricao: `Venda de ${descricao}`,
      contraparte: item?.compradorNome || '',
      documento,
      clienteId: item?.compradorClienteId || item?.clienteId || '',
      metodo: item?.formaPagamentoVenda || item?.formaPagamento || '',
      valor: numero(item?.valorVenda),
      impactaCaixa: true,
      impactaResultado: true,
      detalhes: { marca: item?.marca || '', modelo: item?.modelo || '' }
    }));
    if (custoTotal > 0) {
      lancamentos.push(criarLancamento({
        id: `custo-venda:${documento}`,
        data: item?.dataVenda,
        tipo: 'custo_aparelho',
        direcao: 'saida',
        grupo: 'vendas',
        descricao: `Custo do aparelho vendido — ${descricao}`,
        contraparte: item?.compradorNome || '',
        documento,
        clienteId: item?.compradorClienteId || item?.clienteId || '',
        valor: custoTotal,
        impactaCaixa: false,
        impactaResultado: true,
        observacao: 'Custo reconhecido na venda; a compra não é descontada novamente do lucro.',
        detalhes: { custoAquisicao, custoPecas, gastosExtras }
      }));
    }
  });

  (db.compras || []).forEach((compra) => {
    const valorCompra = numero(compra?.dadosCompra?.valor) + numero(compra?.dadosCompra?.custoPecas);
    if (valorCompra <= 0) return;
    const descricao = [compra?.aparelho?.marca, compra?.aparelho?.modelo].filter(Boolean).join(' ') || 'aparelho';
    lancamentos.push(criarLancamento({
      id: `compra:${compra?.numero || compra?.data}`,
      data: compra?.data,
      tipo: 'compra_estoque',
      direcao: 'saida',
      grupo: 'investimentos',
      descricao: `Compra para estoque — ${descricao}`,
      contraparte: compra?.vendedor?.nome || '',
      documento: compra?.numero || '',
      clienteId: compra?.vendedor?.clienteId || '',
      metodo: compra?.dadosCompra?.formaPagamento || '',
      valor: valorCompra,
      impactaCaixa: true,
      impactaResultado: false,
      observacao: 'Investimento em estoque. O custo afeta o lucro somente quando o aparelho é vendido.',
      detalhes: {
        valorAquisicao: numero(compra?.dadosCompra?.valor),
        custoPecasInicial: numero(compra?.dadosCompra?.custoPecas)
      }
    }));
  });

  reembolsos.forEach((reembolso) => {
    const pagamento = pagamentos.find((item) => item?.id === reembolso?.pagamentoId) || {};
    lancamentos.push(criarLancamento({
      id: `reembolso:${reembolso?.id || reembolso?.dataReembolso}`,
      data: reembolso?.dataReembolso || reembolso?.criadoEm,
      tipo: 'reembolso',
      direcao: 'saida',
      grupo: 'os',
      descricao: `Reembolso da ${reembolso?.osNumero || pagamento?.osNumero || 'OS'}`,
      contraparte: pagamento?.clienteNome || '',
      documento: reembolso?.osNumero || pagamento?.osNumero || '',
      clienteId: pagamento?.clienteId || '',
      metodo: pagamento?.metodo || pagamento?.origem || '',
      valor: numero(reembolso?.valor),
      impactaCaixa: true,
      impactaResultado: true,
      observacao: reembolso?.motivo || '',
      detalhes: { pagamentoId: reembolso?.pagamentoId || '' }
    }));
  });

  return lancamentos.sort((a, b) => {
    const data = String(b.dataHora || b.data).localeCompare(String(a.dataHora || a.data));
    return data || a.id.localeCompare(b.id);
  });
}

function periodoDosFiltros(filtros = {}) {
  if (filtros.dataInicio || filtros.dataFim) {
    return { inicio: diaIso(filtros.dataInicio), fim: diaIso(filtros.dataFim) };
  }
  const agora = new Date();
  const mes = Number.parseInt(filtros.mes, 10) || agora.getMonth() + 1;
  const ano = Number.parseInt(filtros.ano, 10) || agora.getFullYear();
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const fim = new Date(ano, mes, 0).toISOString().slice(0, 10);
  return { inicio, fim, mes, ano, prefixo: `${ano}-${String(mes).padStart(2, '0')}` };
}

function normalizarLista(valor, validos) {
  const lista = Array.isArray(valor) ? valor : (valor ? [valor] : []);
  return lista.map(String).filter((item) => validos.includes(item));
}

function filtrarLancamentos(lancamentos, filtros = {}) {
  const periodo = periodoDosFiltros(filtros);
  const busca = textoBusca(filtros.busca);
  const tipos = normalizarLista(filtros.tipos, TIPOS);
  const direcoes = normalizarLista(filtros.direcoes, DIRECOES);
  const metodos = (Array.isArray(filtros.metodos) ? filtros.metodos : []).map(textoBusca).filter(Boolean);
  const valorMin = filtros.valorMin === '' || filtros.valorMin === undefined ? null : Math.abs(numero(filtros.valorMin));
  const valorMax = filtros.valorMax === '' || filtros.valorMax === undefined ? null : Math.abs(numero(filtros.valorMax));

  return lancamentos.filter((item) => {
    if (periodo.inicio && item.data < periodo.inicio) return false;
    if (periodo.fim && item.data > periodo.fim) return false;
    if (tipos.length && !tipos.includes(item.tipo)) return false;
    if (direcoes.length && !direcoes.includes(item.direcao)) return false;
    if (metodos.length && !metodos.includes(textoBusca(item.metodo))) return false;
    if (valorMin !== null && item.valor < valorMin) return false;
    if (valorMax !== null && item.valor > valorMax) return false;
    if (busca) {
      const palheiro = textoBusca([
        item.descricao, item.contraparte, item.documento, item.clienteId,
        item.metodo, item.observacao, JSON.stringify(item.detalhes)
      ].join(' '));
      if (!palheiro.includes(busca)) return false;
    }
    return true;
  });
}

function somar(lista, seletor) {
  return lista.reduce((total, item) => total + numero(seletor(item)), 0);
}

function resumoLancamentos(lancamentos) {
  const entradasCaixa = somar(lancamentos.filter((item) => item.impactaCaixa && item.direcao === 'entrada'), (item) => item.valor);
  const saidasCaixa = somar(lancamentos.filter((item) => item.impactaCaixa && item.direcao === 'saida'), (item) => item.valor);
  const receitasResultado = somar(lancamentos.filter((item) => item.impactaResultado && item.direcao === 'entrada'), (item) => item.valor);
  const custosResultado = somar(lancamentos.filter((item) => item.impactaResultado && item.direcao === 'saida'), (item) => item.valor);
  const receitaOS = somar(lancamentos.filter((item) => item.tipo === 'recebimento_os'), (item) => item.valor)
    - somar(lancamentos.filter((item) => item.tipo === 'reembolso'), (item) => item.valor);
  const custoOS = somar(lancamentos.filter((item) => item.tipo === 'custo_os'), (item) => item.valor);
  const receitaVendas = somar(lancamentos.filter((item) => item.tipo === 'venda_aparelho'), (item) => item.valor);
  const custoVendas = somar(lancamentos.filter((item) => item.tipo === 'custo_aparelho'), (item) => item.valor);
  const investimentos = somar(lancamentos.filter((item) => item.tipo === 'compra_estoque'), (item) => item.valor);
  const reembolsos = somar(lancamentos.filter((item) => item.tipo === 'reembolso'), (item) => item.valor);
  const lucroTotal = receitasResultado - custosResultado;
  return {
    caixa: { entradas: entradasCaixa, saidas: saidasCaixa, saldo: entradasCaixa - saidasCaixa },
    resultado: {
      receitas: receitasResultado,
      custos: custosResultado,
      lucroOS: receitaOS - custoOS,
      lucroVendas: receitaVendas - custoVendas,
      lucroTotal,
      margem: receitasResultado > 0 ? (lucroTotal / receitasResultado) * 100 : 0
    },
    composicao: {
      receitaOS,
      custoOS,
      receitaVendas,
      custoVendas,
      investimentos,
      reembolsos,
      descontos: 0,
      acrescimos: 0
    }
  };
}

function montarRelatorio(db, filtros = {}) {
  const todos = montarLancamentos(db);
  const extrato = filtrarLancamentos(todos, filtros);
  const resumo = resumoLancamentos(extrato);
  const periodo = periodoDosFiltros(filtros);
  const metodosDisponiveis = [...new Set(todos.map((item) => item.metodo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const tiposDisponiveis = TIPOS.map((tipo) => ({ tipo, quantidade: todos.filter((item) => item.tipo === tipo).length }));
  return { periodo, filtros, extrato, resumo, metodosDisponiveis, tiposDisponiveis, totalLancamentos: extrato.length };
}

module.exports = {
  DIRECOES,
  TIPOS,
  diaIso,
  valorTotalOS,
  montarLancamentos,
  filtrarLancamentos,
  resumoLancamentos,
  montarRelatorio
};
