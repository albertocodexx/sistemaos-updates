// Smoke test da Parte 2: módulos puros do renderer sem abrir o Electron.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..', '..');
const arquivo = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

async function executar() {
  const elementos = new Map([
    ['.login-brand-versao', { textContent: '' }],
    ['.login-brand-footer', { innerHTML: '' }]
  ]);
  const document = {
    title: '',
    getElementById: id => ({ id }),
    querySelector: seletor => elementos.get(seletor) || null
  };
  const contexto = {
    document,
    window: {
      api: { updateVersaoAtual: () => Promise.resolve('30.5.4') }
    }
  };
  contexto.window.window = contexto.window;

  for (const caminho of [
    ['renderer', 'shared', 'dom.js'],
    ['renderer', 'shared', 'formatters.js'],
    ['renderer', 'shared', 'icons.js'],
    ['renderer', 'core', 'app-version.js']
  ]) {
    vm.runInNewContext(arquivo(...caminho), contexto, { filename: caminho.join('/') });
  }

  await Promise.resolve();
  await Promise.resolve();

  assert.strictEqual(typeof contexto.window.RendererDom.porId, 'function');
  assert.strictEqual(contexto.window.RendererDom.porId('campo').id, 'campo');
  assert.strictEqual(contexto.window.RendererFormatters.moeda(12.5), 'R$ 12,50');
  assert.strictEqual(typeof contexto.window.RendererFormatters.dataHora, 'function');
  assert.match(contexto.window.RendererIcons.CHECK, /<svg\b/);
  assert.match(contexto.window.RendererIcons.WHATSAPP, /<svg\b/);
  assert.strictEqual(document.title, 'Sistema OS');
  assert.strictEqual(elementos.get('.login-brand-versao').textContent, 'v30.5.4');

  const indexHtml = arquivo('renderer', 'index.html');
  const scripts = [
    'shared/dom.js',
    'shared/formatters.js',
    'shared/icons.js',
    'core/app-version.js',
    'core/legacy-runtime.js'
  ];
  let posicaoAnterior = -1;
  for (const script of scripts) {
    const posicao = indexHtml.indexOf(`src="${script}"`);
    assert.ok(posicao > posicaoAnterior, `${script} deve carregar antes do próximo módulo`);
    posicaoAnterior = posicao;
  }

  const renderer = arquivo('renderer', 'core', 'legacy-runtime.js');
  const estilo = arquivo('renderer', 'style.css');
  assert.match(renderer, /window\.RendererDom/);
  assert.match(renderer, /window\.RendererFormatters/);
  assert.match(renderer, /window\.RendererIcons/);
assert.match(indexHtml, /data-orc-subaba="todas"[^>]*>Todas</, 'Autorizadas deve abrir na subaba Todas');
assert.match(renderer, /let _autorizadasSubaba = 'todas'/, 'filtro inicial deve reunir pagas e retirada');
assert.match(indexHtml, /id="historico-subabas"[\s\S]*?data-subaba="todas"[\s\S]*?data-subaba="novas"/, 'Histórico deve exibir Todas antes das demais subabas');
assert.match(fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'os', 'os-list.js'), 'utf8'), /let subAbaHistorico = 'todas'/, 'Histórico deve abrir reunindo todas as OS');
  assert.match(renderer, /class="card-est-valores cliente-card-resumo"/, 'resumo do cliente deve ter layout próprio');
  assert.match(estilo, /\.cliente-card-resumo\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, 'resumo deve distribuir os registros em duas colunas');
  assert.match(estilo, /\.cliente-card-resumo\s*>\s*span\s*\{[\s\S]*?gap:\s*6px/, 'ícone e texto de cada total devem permanecer separados');
  assert.match(indexHtml, /id="btnDefinirPagamentoRetirada"/, 'PC deve permitir definir pagamento na retirada');
  assert.match(renderer, /statusPagamento:\s*'Aguardando Pagamento na Retirada'/, 'ação manual deve persistir o status financeiro correto');
  assert.match(renderer, /OS \$\{numero\} autorizada/, 'autorização deve entrar na Central de Notificações');
}

executar().then(() => {
  console.log('OK: renderer core compartilhado carregado e compatível.');
}).catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
