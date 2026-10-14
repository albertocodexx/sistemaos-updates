'use strict';

function texto(valor) {
  return String(valor == null ? '' : valor).trim();
}

function escapar(valor) {
  return texto(valor).replace(/[&<>"']/g, caractere => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caractere]);
}

function numero(valor) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

function moeda(valor) {
  return numero(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBr(valor) {
  const partes = texto(valor).slice(0, 10).split('-');
  return partes.length === 3 ? partes.reverse().join('/') : '';
}

function linhasTabela(objeto, colunas = ['Item', 'Quantidade']) {
  const linhas = Object.entries(objeto || {})
    .filter(([, valor]) => numero(valor) !== 0)
    .sort((a, b) => numero(b[1]) - numero(a[1]));
  if (!linhas.length) return '<p class="vazio">Nenhum dado neste período.</p>';
  return `<table><thead><tr>${colunas.map(coluna => `<th>${escapar(coluna)}</th>`).join('')}</tr></thead><tbody>${linhas.map(([nome, valor]) =>
    `<tr><td>${escapar(nome)}</td><td class="numero">${escapar(numero(valor))}</td></tr>`
  ).join('')}</tbody></table>`;
}

function listaRanking(lista) {
  if (!Array.isArray(lista) || !lista.length) return '<p class="vazio">Nenhum dado neste período.</p>';
  return `<table><thead><tr><th>Item</th><th>Quantidade</th></tr></thead><tbody>${lista.map(item =>
    `<tr><td>${escapar(item?.nome || 'Não informado')}</td><td class="numero">${escapar(numero(item?.total))}</td></tr>`
  ).join('')}</tbody></table>`;
}

function tabelaMensal(meses, receitaMeses, incluirFinanceiro) {
  const chaves = [...new Set([...Object.keys(meses || {}), ...Object.keys(incluirFinanceiro ? receitaMeses || {} : {})])].sort();
  if (!chaves.length) return '<p class="vazio">Nenhum movimento mensal neste período.</p>';
  return `<table><thead><tr><th>Mês</th><th>OS recebidas</th><th>OS finalizadas</th>${incluirFinanceiro ? '<th>Receita confirmada</th>' : ''}</tr></thead><tbody>${chaves.map(chave => {
    const item = meses?.[chave] || {};
    const [ano, mes] = chave.split('-');
    const rotulo = ano && mes ? `${mes}/${ano}` : chave;
    return `<tr><td>${escapar(rotulo)}</td><td class="numero">${escapar(numero(item.recebidas))}</td><td class="numero">${escapar(numero(item.finalizadas))}</td>${incluirFinanceiro ? `<td class="numero">${escapar(moeda(receitaMeses?.[chave]))}</td>` : ''}</tr>`;
  }).join('')}</tbody></table>`;
}

function gerarHtmlRelatorioPainel({ config = {}, statsOS = {}, statsEst = {}, statsFin = {}, filtros = {}, incluirFinanceiro = true } = {}) {
  const empresa = config.nomeEmpresa || config.nomeFantasia || 'Assistência Técnica';
  const inicio = dataBr(filtros.dataInicio);
  const fim = dataBr(filtros.dataFim);
  const periodo = inicio && fim ? (inicio === fim ? inicio : `${inicio} a ${fim}`) : 'Últimos 6 meses / visão atual';
  const financeiro = statsFin || {};
  const resumo = [
    ['OS no período', statsOS.totalOS],
    ['Em aberto', statsOS.emAberto],
    ['Em reparo', statsOS.emReparo],
    ['Aguardando peça', statsOS.aguardandoPeca],
    ['Prontas', statsOS.prontas],
    ['Entregues', statsOS.entregues],
    ['Atrasadas', statsOS.atrasadas],
    ['Canceladas', statsOS.canceladas]
  ];
  const resultados = [
    ['Recebido em OS', moeda(financeiro?.entradas?.servicos ?? statsOS.totalPago)],
    ['Custos das OS', moeda(financeiro?.saidas?.custoServicos)],
    ['Lucro em reparos', moeda(financeiro?.resultado?.lucroServicos)],
    ['Lucro em aparelhos', moeda(financeiro?.resultado?.lucroVendas ?? statsEst.lucroTotal)],
    ['Lucro total', moeda(financeiro?.resultado?.lucroTotal)],
    ['A receber', moeda(financeiro?.aReceber?.total)]
  ];
  const estoquePorTipo = Object.fromEntries(Object.entries(statsEst.porTipoEquipamento || {}).map(([nome, item]) => [nome, item?.total]));

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório gerencial</title><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#171717;background:#fff;font:10.5px/1.42 Arial,Helvetica,sans-serif}
    header{display:flex;justify-content:space-between;gap:20px;align-items:flex-end;border-bottom:2px solid #171717;padding-bottom:10px;margin-bottom:14px}h1{font-size:22px;margin:0 0 3px}header p{margin:0;color:#555}.meta{text-align:right;font-size:9px}.grade{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0 16px}.card{border:1px solid #d7d7d7;border-radius:7px;padding:9px;break-inside:avoid}.card strong{display:block;font-size:16px;margin-top:4px}.card span{color:#5d5d5d;text-transform:uppercase;font-size:7.5px;letter-spacing:.45px}.financeiro{grid-template-columns:repeat(3,1fr)}
    h2{font-size:13px;margin:17px 0 7px;padding-bottom:5px;border-bottom:1px solid #bdbdbd}.duas{display:grid;grid-template-columns:1fr 1fr;gap:12px}.secao{break-inside:avoid}table{width:100%;border-collapse:collapse}th,td{padding:5px 6px;border-bottom:1px solid #e5e5e5;text-align:left}th{font-size:8px;text-transform:uppercase;letter-spacing:.35px;background:#f3f3f3}.numero{text-align:right;font-variant-numeric:tabular-nums}.vazio{color:#777;border:1px dashed #ccc;padding:9px;margin:0}.nota{margin-top:16px;padding-top:8px;border-top:1px solid #ccc;color:#666;font-size:8.5px}footer{position:fixed;bottom:0;left:0;right:0;text-align:center;color:#888;font-size:7.5px}
  </style></head><body>
    <header><div><h1>Relatório gerencial</h1><p>${escapar(empresa)}</p></div><div class="meta"><strong>Período: ${escapar(periodo)}</strong><br>Gerado em ${escapar(new Date().toLocaleString('pt-BR'))}</div></header>
    <section><h2>Operação</h2><div class="grade">${resumo.map(([rotulo, valor]) => `<div class="card"><span>${escapar(rotulo)}</span><strong>${escapar(numero(valor))}</strong></div>`).join('')}</div></section>
    ${incluirFinanceiro ? `<section><h2>Resultado financeiro</h2><div class="grade financeiro">${resultados.map(([rotulo, valor]) => `<div class="card"><span>${escapar(rotulo)}</span><strong>${escapar(valor)}</strong></div>`).join('')}</div></section>` : ''}
    <section class="secao"><h2>Evolução mensal</h2>${tabelaMensal(statsOS.meses, statsOS.receitaMeses, incluirFinanceiro)}</section>
    <div class="duas"><section class="secao"><h2>OS por status</h2>${linhasTabela(statsOS.porStatus)}</section><section class="secao"><h2>OS por equipamento</h2>${linhasTabela(statsOS.porTipo)}</section></div>
    <div class="duas"><section class="secao"><h2>Marcas mais atendidas</h2>${listaRanking(statsOS.topMarcas)}</section><section class="secao"><h2>Defeitos mais frequentes</h2>${listaRanking(statsOS.topDefeitos)}</section></div>
    <section class="secao"><h2>Estoque por tipo</h2>${linhasTabela(estoquePorTipo)}</section>
    <p class="nota">Documento gerado diretamente a partir dos dados consolidados do Sistema OS. Não é uma captura da interface e não contém botões, menus ou componentes da Assistente de IA.</p>
    <footer>${escapar(config.textoRodapePdf || 'Sistema OS')}</footer>
  </body></html>`;
}

module.exports = { gerarHtmlRelatorioPainel, escapar };
