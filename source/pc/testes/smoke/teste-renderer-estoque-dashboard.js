// Smoke test da Parte 5: dashboard do estoque em modo somente leitura.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..', '..');
const modulo = fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'estoque', 'dashboard.js'), 'utf8');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');

async function executar() {
  const elementos = new Map();
  const porId = id => {
    if (!elementos.has(id)) elementos.set(id, { innerHTML: '' });
    return elementos.get(id);
  };
  const contexto = {
    window: {
      RendererDom: { porId },
      RendererFormatters: { moeda: valor => `R$ ${Number(valor || 0).toFixed(2)}` },
      api: {
        estoquestats: async () => ({
          totalAparelhos: 3, disponiveis: 2, emReparo: 1, aguardando: 0, reservados: 0,
          totalVendidos: 4, valorTotalInvestido: 100, valorTotalVendido: 180, lucroTotal: 80,
          grafico: { '2026-07': { compras: 2, vendas: 1 } }
        })
      }
    }
  };
  contexto.window.window = contexto.window;
  vm.runInNewContext(modulo, contexto, { filename: 'renderer/modules/estoque/dashboard.js' });

  contexto.window.RendererEstoqueDashboard.init();
  await contexto.window.carregarPainel();
  assert.match(porId('painelCards').innerHTML, /Total de Aparelhos/);
  assert.match(porId('painelCards').innerHTML, /R\$ 80\.00/);
  assert.match(porId('graficoMeses').innerHTML, /Compras: 2/);
  assert.ok(indexHtml.indexOf('src="core/legacy-runtime.js"') < indexHtml.indexOf('src="modules/estoque/dashboard.js"'));
  assert.doesNotMatch(renderer, /async function carregarPainel\(/);
}

executar().then(() => console.log('OK: dashboard do estoque consulta e renderiza estatísticas.')).catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
