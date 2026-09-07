// Smoke test da Parte 4: módulo de listagem do histórico de OS.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..', '..');
const modulo = fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'os', 'os-list.js'), 'utf8');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');

function criarElemento() {
  const listeners = {};
  return {
    value: '', innerHTML: '',
    addEventListener(evento, funcao) { (listeners[evento] ||= []).push(funcao); },
    quantidade(evento) { return (listeners[evento] || []).length; }
  };
}

async function executar() {
  const elementos = new Map();
  let ordens = [];
  const porId = id => {
    if (!elementos.has(id)) elementos.set(id, criarElemento());
    return elementos.get(id);
  };
  const contexto = {
    setTimeout: funcao => { funcao(); return 1; },
    clearTimeout() {},
    document: { querySelectorAll: () => [] },
    window: {
      RendererDom: { porId },
      RendererFormatters: { data: () => '17/07/2026' },
      RendererIcons: { CARTAO: 'cartao', OLHO: 'olho', LAPIS: 'lapis', DOCUMENTO: 'doc', ETIQUETA: 'etiqueta', LIXEIRA: 'lixeira' },
      statusClass: () => 'status',
      prioridadeClass: () => 'prioridade',
      _escHtml: valor => String(valor),
      ICONE_TIPO_EQUIPAMENTO: { Smartphone: 'telefone' },
      api: { oslistar: async () => ordens, osbuscar: async () => ordens, osabrirpdf: async () => ({ sucesso: true }) }
    }
  };
  contexto.window.window = contexto.window;
  vm.runInNewContext(modulo, contexto, { filename: 'renderer/modules/os/os-list.js' });

  contexto.window.RendererOsList.init();
  assert.strictEqual(porId('campoBusca').quantidade('input'), 1);
  await contexto.window.carregarHistorico();
  assert.match(porId('corpoTabelaOS').innerHTML, /Nenhuma OS encontrada/);
  ordens = [{
    numero: 'OS-0001', status: 'Aguardando análise', prioridade: 'Normal', data: '2026-07-17',
    cliente: { nome: 'Cliente teste', telefone: '27999999999' },
    aparelho: { tipoEquipamento: 'Smartphone', marca: 'Samsung', modelo: 'S23' }
  }];
  await contexto.window.carregarHistorico();
  assert.match(porId('corpoTabelaOS').innerHTML, /OS-0001/);
  assert.match(porId('corpoTabelaOS').innerHTML, /telefone Samsung S23/);
  assert.strictEqual(typeof contexto.window.trocarSubabaHistorico, 'function');
  assert.strictEqual(typeof contexto.window.abrirPdf, 'function');

  assert.ok(indexHtml.indexOf('src="core/legacy-runtime.js"') < indexHtml.indexOf('src="modules/os/os-list.js"'));
  assert.doesNotMatch(renderer, /async function carregarHistorico\(/);
  assert.match(renderer, /window\.ICONE_TIPO_EQUIPAMENTO\s*=\s*ICONE_TIPO_EQUIPAMENTO/);
}

executar().then(() => console.log('OK: listagem de OS carregada sem listeners duplicados.')).catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
