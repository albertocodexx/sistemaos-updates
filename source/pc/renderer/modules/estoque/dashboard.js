// Painel resumido do estoque: somente leitura de estatísticas e gráficos.
(function iniciarDashboardEstoque() {
  'use strict';

  if (window.RendererEstoqueDashboard) return;

  const { porId: $ } = window.RendererDom;
  const { moeda: fmtMoeda } = window.RendererFormatters;
  let iniciado = false;

  async function carregarPainel() {
    if (!$('painelCards') || !$('graficoMeses')) return;

    const estatisticas = await window.api.estoquestats();
    const cards = [
      { label: 'Total de Aparelhos', valor: estatisticas.totalAparelhos, classe: '' },
      { label: 'Para Venda', valor: estatisticas.disponiveis, classe: 'verde' },
      { label: 'Em Reparo', valor: estatisticas.emReparo, classe: 'laranja' },
      { label: 'Aguardando peça', valor: estatisticas.aguardandoPeca || 0, classe: 'laranja' },
      { label: 'Aguardando', valor: estatisticas.aguardando, classe: '' },
      { label: 'Reservados', valor: estatisticas.reservados, classe: '' },
      { label: 'Vendidos', valor: estatisticas.totalVendidos, classe: 'verde' },
      { label: 'Total Investido', valor: fmtMoeda(estatisticas.valorTotalInvestido), classe: 'vermelho' },
      { label: 'Total Vendido', valor: fmtMoeda(estatisticas.valorTotalVendido), classe: 'verde' },
      { label: 'Lucro Total', valor: fmtMoeda(estatisticas.lucroTotal), classe: estatisticas.lucroTotal >= 0 ? 'verde' : 'vermelho' },
      { label: 'Compras Registradas', valor: estatisticas.quantidadeComprasRegistradas || 0, classe: '' },
      { label: 'Valor Pago em Compras', valor: fmtMoeda(estatisticas.valorPagoEmCompras || 0), classe: 'vermelho' },
      { label: 'Peças nas Compras', valor: fmtMoeda(estatisticas.valorPecasEmCompras || 0), classe: 'vermelho' },
      { label: 'Gasto Total em Compras', valor: fmtMoeda(estatisticas.gastoTotalCompras || 0), classe: 'vermelho' },
      { label: 'Média por Compra', valor: fmtMoeda(estatisticas.ticketMedioCompras || 0), classe: '' }
    ];
    $('painelCards').innerHTML = cards.map(card => `
      <div class="painel-card ${card.classe}">
        <div class="valor">${card.valor}</div>
        <div class="label">${card.label}</div>
      </div>`).join('');

    const grafico = estatisticas.grafico || {};
    const meses = Object.keys(grafico);
    const maximo = Math.max(...meses.map(mes => Math.max(grafico[mes].compras || 0, grafico[mes].vendas || 0)), 1);
    $('graficoMeses').innerHTML = `
      <div style="display:flex;gap:4px;align-items:flex-end;height:140px;padding-top:10px;overflow-x:auto;">
        ${meses.map(mes => {
          const compras = grafico[mes].compras || 0;
          const vendas = grafico[mes].vendas || 0;
          const alturaCompras = Math.round((compras / maximo) * 100);
          const alturaVendas = Math.round((vendas / maximo) * 100);
          const [ano, numeroMes] = mes.split('-');
          const nomeMes = new Date(ano, parseInt(numeroMes) - 1).toLocaleDateString('pt-BR', { month: 'short' });
          return `<div class="barra-grupo">
            <div class="barra-wrap">
              <div class="barra compra" style="height:${alturaCompras}px;" title="Compras: ${compras}"></div>
              <div class="barra venda" style="height:${alturaVendas}px;" title="Vendas: ${vendas}"></div>
            </div>
            <div class="barra-mes">${nomeMes}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;">
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:var(--primario);display:inline-block;border-radius:2px;"></span> Compras</span>
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:var(--sucesso);display:inline-block;border-radius:2px;"></span> Vendas</span>
      </div>`;
  }

  function init() {
    if (iniciado) return;
    iniciado = true;
  }

  window.RendererEstoqueDashboard = Object.freeze({ init, carregarPainel });
  window.carregarPainel = carregarPainel;
  init();
})();
