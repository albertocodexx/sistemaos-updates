// Estatísticas leves do Supabase. A tela recebe apenas os campos já usados
// pelos cartões; nenhum PDF, foto, assinatura ou anexo é baixado.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Estatisticas = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var timer = null;
  var ultimoResumo = null;
  var resumoEmAndamento = null;

  function valorNumero(valor) { return Number(valor) || 0; }

  function prazoAtrasado(os, agora) {
    if (!os || !os.dataPrevista || ['Entregue', 'Cancelado'].indexOf(os.status) !== -1) return false;
    var quando = new Date(String(os.dataPrevista) + 'T' + String(os.horaPrevista || '23:59') + ':00').getTime();
    return !isNaN(quando) && quando < agora;
  }

  function paraItem(os, agora) {
    return {
      id: os.id,
      revision: os.revision,
      numero: os.numero,
      clienteNome: os.cliente && os.cliente.nome,
      aparelho: os.aparelho && (os.aparelho.nome || [os.aparelho.marca, os.aparelho.modelo].filter(Boolean).join(' ')),
      status: os.status,
      dataPrevista: os.dataPrevista,
      horaPrevista: os.horaPrevista,
      atrasada: prazoAtrasado(os, agora),
      atualizadoEm: os.updatedAt,
      valor: valorNumero(os.valor),
      statusPagamento: os.statusPagamento || ''
    };
  }

  function montarResumo(ordens, aparelhos) {
    var agora = Date.now();
    var itens = (ordens || []).map(function (os) { return paraItem(os, agora); });
    var statusOS = { prontas: 0, entregues: 0 };
    var financeiro = { totalPago: 0, totalVendas: 0, quantidadeVendas: 0, aguardandoPagamento: 0, receitaMeses: {} };
    itens.forEach(function (os) {
      if (os.status === 'Pronto para retirada') statusOS.prontas += 1;
      if (os.status === 'Entregue') statusOS.entregues += 1;
      var pago = /pago|autorizado|confirmado/i.test(os.statusPagamento);
      if (pago) {
        financeiro.totalPago += os.valor;
        var mes = String(os.atualizadoEm || '').slice(0, 7);
        if (mes) financeiro.receitaMeses[mes] = valorNumero(financeiro.receitaMeses[mes]) + os.valor;
      } else if (os.valor > 0 && os.status !== 'Cancelado') {
        financeiro.aguardandoPagamento += 1;
      }
    });
    var atividadesVenda = [];
    (aparelhos || []).forEach(function (item) {
      if (String(item.status || '').toLowerCase() !== 'vendido') return;
      var valorVenda = valorNumero(item.valorVenda);
      financeiro.totalPago += valorVenda;
      financeiro.totalVendas += valorVenda;
      financeiro.quantidadeVendas += 1;
      var atualizado = item.dataVenda || item._atualizadoEm || item.updatedAt || '';
      var mesVenda = String(atualizado).slice(0, 7);
      if (mesVenda) financeiro.receitaMeses[mesVenda] = valorNumero(financeiro.receitaMeses[mesVenda]) + valorVenda;
      atividadesVenda.push({
        tipoDocumento: 'venda', numero: item.id, status: 'Vendido',
        clienteNome: item.compradorNome || '',
        aparelho: [item.marca, item.modelo].filter(Boolean).join(' '),
        atualizadoEm: atualizado,
        valor: valorVenda
      });
    });
    var atividadesOS = itens.map(function (os) {
      return {
        tipoDocumento: 'os', numero: os.numero, status: os.status,
        clienteNome: os.clienteNome, aparelho: os.aparelho, atualizadoEm: os.atualizadoEm
      };
    });
    return {
      geradoEm: new Date().toISOString(),
      ordensAbertas: itens,
      statusOS: statusOS,
      financeiro: financeiro,
      atividadeRecente: atividadesOS.concat(atividadesVenda).sort(function (a, b) {
        return String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || ''));
      }).slice(0, 20)
    };
  }

  async function buscarResumoUmaVez() {
    if (!root.SistemaOSSupabaseOS || !root.SistemaOSSupabaseOS.listarLeves) return null;
    if (resumoEmAndamento) return resumoEmAndamento;
    var estoque = root.SistemaOSEstoque && root.SistemaOSEstoque.listar
      ? root.SistemaOSEstoque.listar('aparelho').catch(function () { return []; })
      : Promise.resolve([]);
    resumoEmAndamento = Promise.all([root.SistemaOSSupabaseOS.listarLeves(300), estoque]).then(function (respostas) {
      ultimoResumo = montarResumo(respostas[0], respostas[1]);
      return ultimoResumo;
    }).catch(function () {
      return null;
    }).finally(function () {
      resumoEmAndamento = null;
    });
    return resumoEmAndamento;
  }

  function escutarResumo(callback) {
    pararEscutaResumo();
    function atualizar() {
      buscarResumoUmaVez().then(function (resumo) { if (resumo) callback(resumo); });
    }
    atualizar();
    timer = root.setInterval(atualizar, 30000);
  }

  function pararEscutaResumo() {
    if (timer) root.clearInterval(timer);
    timer = null;
  }

  var JANELA_PERTO_DO_PRAZO_MS = 48 * 60 * 60 * 1000;
  function classificarOrdens(resumo) {
    var vazio = { prontas: [], atrasadas: [], pertoDoPrazo: [], entregues: [] };
    if (!resumo || !Array.isArray(resumo.ordensAbertas)) return vazio;
    var agora = Date.now();
    resumo.ordensAbertas.forEach(function (os) {
      if (os.status === 'Entregue') { vazio.entregues.push(os); return; }
      if (os.atrasada) { vazio.atrasadas.push(os); return; }
      if (os.status === 'Pronto para retirada') { vazio.prontas.push(os); return; }
      if (os.dataPrevista) {
        var limite = new Date(os.dataPrevista + 'T' + (os.horaPrevista || '23:59') + ':00').getTime();
        if (!isNaN(limite) && limite - agora <= JANELA_PERTO_DO_PRAZO_MS && limite >= agora) vazio.pertoDoPrazo.push(os);
      }
    });
    return vazio;
  }

  return {
    buscarResumoUmaVez: buscarResumoUmaVez,
    escutarResumo: escutarResumo,
    pararEscutaResumo: pararEscutaResumo,
    obterUltimoResumoConhecido: function () { return ultimoResumo; },
    classificarOrdens: classificarOrdens,
    _montarResumo: montarResumo
  };
});
