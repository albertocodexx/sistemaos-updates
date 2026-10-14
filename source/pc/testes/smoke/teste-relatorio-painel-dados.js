'use strict';

const assert = require('assert');
const { gerarHtmlRelatorioPainel } = require('../../src/relatorio-painel');

const html = gerarHtmlRelatorioPainel({
  config: { nomeEmpresa: '<img src=x onerror=alert(1)>', textoRodapePdf: 'Rodapé QA' },
  filtros: { dataInicio: '2026-10-01', dataFim: '2026-10-13' },
  statsOS: {
    totalOS: 3, emAberto: 1, emReparo: 1, aguardandoPeca: 0, prontas: 1,
    entregues: 1, atrasadas: 0, canceladas: 0, totalPago: 420,
    porStatus: { Entregue: 1, 'Em reparo': 1 }, porTipo: { Smartphone: 2 },
    meses: { '2026-10': { recebidas: 3, finalizadas: 1 } },
    receitaMeses: { '2026-10': 420 },
    topMarcas: [{ nome: 'Apple', total: 2 }], topDefeitos: [{ nome: 'Tela', total: 1 }]
  },
  statsEst: { lucroTotal: 120, porTipoEquipamento: { Smartphone: { total: 2 } } },
  statsFin: {
    entradas: { servicos: 420 }, saidas: { custoServicos: 100 },
    resultado: { lucroServicos: 320, lucroVendas: 120, lucroTotal: 440 },
    aReceber: { total: 80 }
  }
});

assert.match(html, /Relatório gerencial/);
assert.match(html, /01\/10\/2026 a 13\/10\/2026/);
assert.match(html, /R\$\s*420,00/);
assert.match(html, /OS por status/);
assert.doesNotMatch(html, /<button|Assistente Sistema OS|btnExportarPainelPDF/,
  'o PDF não pode ser uma captura da interface');
assert.doesNotMatch(html, /<img src=x onerror/,
  'dados da empresa devem ser escapados no documento');
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);

const operacional = gerarHtmlRelatorioPainel({
  incluirFinanceiro: false,
  statsOS: { totalOS: 3, totalPago: 999, meses: { '2026-10': { recebidas: 3, finalizadas: 1 } }, receitaMeses: { '2026-10': 999 } },
  statsEst: { lucroTotal: 999 },
  statsFin: { entradas: { servicos: 999 }, resultado: { lucroTotal: 999 } }
});
assert.match(operacional, /OS recebidas/);
assert.doesNotMatch(operacional, /Resultado financeiro|Receita confirmada|R\$|999/,
  'relatório operacional não pode revelar valores sem permissão financeira');

console.log('OK: exportação usa relatório de dados limpo, paginado e sem controles da interface.');
