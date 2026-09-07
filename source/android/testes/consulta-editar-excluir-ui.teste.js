// testes/consulta-editar-excluir-ui.teste.js
// ═══════════════════════════════════════════════════════════════
// Teste funcional (DOM real via jsdom) dos botões "Editar"/"Excluir"
// adicionados ao resultado da busca de OS na aba Consulta
// (www/js/consulta.js). Os testes com stub manual (ver
// teste-consulta-envelope-resposta.teste.js) não cobrem o clique em
// "Editar" nem "Excluir", porque o stub de elemento não implementa
// querySelector/parentNode/remove/insertAdjacentElement — este teste
// usa um DOM real (o mesmo trecho de HTML de www/index.html) para
// cobrir o fluxo ponta a ponta dentro do celular.
//
// Cobre:
// 1. Botões Editar/Excluir só aparecem para consulta de OS.
// 2. Clicar em Editar abre o formulário inline pré-preenchido; clicar
//    de novo fecha (toggle).
// 3. Salvar edição: só envia os campos que mudaram, mostra sucesso e
//    reconsulta a OS.
// 4. Salvar sem nenhuma mudança: não chama atualizarOS,
//    avisa "nenhuma alteração".
// 5. Excluir: pede confirmação (window.confirm), só chama excluirOS se
//    confirmado, limpa o card em caso de
//    sucesso.
// 6. Excluir cancelado no confirm(): não chama excluirOS.
//
// Rodar: node testes/consulta-editar-excluir-ui.teste.js

var assert = require('assert');
var { JSDOM } = require('jsdom');

var HTML_PAINEL_CONSULTA = `
<section class="painel-documentos" id="painel-consulta" hidden>
  <p class="banner-historico-local" id="consulta-status-sync" hidden></p>
  <fieldset class="secao-config">
    <input type="text" id="consulta-os-numero" />
    <button type="button" id="btn-consultar-os" class="btn-primario">Buscar</button>
    <div id="consulta-os-resultado" class="resultado-consulta" hidden></div>
  </fieldset>
  <fieldset class="secao-config">
    <input type="text" id="consulta-garantia-numero" />
    <button type="button" id="btn-consultar-garantia" class="btn-primario">Buscar</button>
    <div id="consulta-garantia-resultado" class="resultado-consulta" hidden></div>
  </fieldset>
  <fieldset class="secao-config">
    <input type="text" id="consulta-entrega-numero" />
    <button type="button" id="btn-consultar-entrega" class="btn-primario">Buscar</button>
    <div id="consulta-entrega-resultado" class="resultado-consulta" hidden></div>
  </fieldset>
</section>
`;

function dadosOsEncontrada(overrides) {
  return Object.assign({
    id: 'os-4',
    revision: 1,
    numero: '4',
    status: 'Aguardando análise',
    prioridade: 'Normal',
    observacoes: '',
    cliente: { nome: 'Alberto', telefone: '27996044952' },
    aparelho: { marca: 'S23', modelo: 'S23', defeitoRelatado: 'Tela' },
    pdfUrl: 'https://signed.local/consultas/os/4.pdf'
  }, overrides || {});
}

function montarAmbiente() {
  var dom = new JSDOM('<!DOCTYPE html><html><body>' + HTML_PAINEL_CONSULTA + '</body></html>', {
    url: 'http://localhost/'
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.self = dom.window;
  return dom;
}

function carregarConsultaJs(mockCloudData, mockToast, mockConfirm) {
  var dom = montarAmbiente();
  window.CloudData = Object.assign({ providerConsultas: function () { return 'supabase'; } }, mockCloudData);
  window.SistemaOSToast = mockToast || { mostrar: function () {} };
  window.confirm = mockConfirm || function () { return true; };
  var resolvido = require.resolve('../www/js/consulta.js');
  delete require.cache[resolvido];
  require('../www/js/consulta.js');
  return dom;
}

function esperar(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms || 20); });
}

async function buscarOS(dom, numero) {
  document.getElementById('consulta-os-numero').value = numero;
  document.getElementById('btn-consultar-os').dispatchEvent(new dom.window.Event('click'));
  await esperar(30);
}

// ── Runner ───────────────────────────────────────────────────────
(async function main() {
  var falhas = 0;
  var total = 0;

  async function testeAsync(nome, fn) {
    total++;
    try {
      await fn();
      console.log('OK   -', nome);
    } catch (e) {
      falhas++;
      console.error('FALHOU -', nome, '\n   ', e.stack || e.message);
    }
  }

  await testeAsync('busca de OS mostra botões Editar e Excluir', async function () {
    var dom = carregarConsultaJs({
      consultar: function () { return Promise.resolve({ encontrada: true, origem: 'supabase', dados: dadosOsEncontrada() }); }
    });
    await buscarOS(dom, '4');
    var resultado = document.getElementById('consulta-os-resultado');
    assert.ok(resultado.querySelector('.btn-editar-consulta'), 'botão Editar está presente');
    assert.ok(resultado.querySelector('.btn-excluir-consulta'), 'botão Excluir está presente');
  });

  await testeAsync('busca de garantia NÃO mostra botões Editar/Excluir (só OS)', async function () {
    var dom = carregarConsultaJs({
      consultar: function () {
        return Promise.resolve({
          encontrada: true,
          origem: 'supabase', dados: { numero: '4', garantiaDias: 90 }
        });
      }
    });
    document.getElementById('consulta-garantia-numero').value = '4';
    document.getElementById('btn-consultar-garantia').dispatchEvent(new dom.window.Event('click'));
    await esperar(30);
    var resultado = document.getElementById('consulta-garantia-resultado');
    assert.ok(!resultado.querySelector('.btn-editar-consulta'), 'garantia não tem botão Editar');
    assert.ok(!resultado.querySelector('.btn-excluir-consulta'), 'garantia não tem botão Excluir');
  });

  await testeAsync('clicar em Editar abre o formulário pré-preenchido; clicar de novo fecha', async function () {
    var dom = carregarConsultaJs({
      consultar: function () { return Promise.resolve({ encontrada: true, origem: 'supabase', dados: dadosOsEncontrada() }); }
    });
    await buscarOS(dom, '4');
    var resultado = document.getElementById('consulta-os-resultado');
    var btnEditar = resultado.querySelector('.btn-editar-consulta');

    btnEditar.dispatchEvent(new dom.window.Event('click'));
    var form = resultado.querySelector('.form-edicao-consulta');
    assert.ok(form, 'formulário de edição foi aberto');
    assert.strictEqual(form.querySelector('.campo-edicao-status').value, 'Aguardando análise', 'status vem pré-preenchido com o valor atual');
    assert.strictEqual(form.querySelector('.campo-edicao-defeito').value, 'Tela', 'defeito relatado vem pré-preenchido');

    btnEditar.dispatchEvent(new dom.window.Event('click'));
    assert.ok(!resultado.querySelector('.form-edicao-consulta'), 'segundo clique em Editar fecha o formulário (toggle)');
  });

  await testeAsync('salvar edição: envia só os campos alterados e reconsulta a OS em caso de sucesso', async function () {
    var camposEnviados = null;
    var chamouConsultarDeNovo = 0;
    var dom = carregarConsultaJs({
      consultar: function () {
        chamouConsultarDeNovo++;
        return Promise.resolve({ encontrada: true, origem: 'supabase', dados: dadosOsEncontrada() });
      },
      atualizarOS: function (_referencia, _revision, campos) {
        camposEnviados = campos;
        return Promise.resolve({ enviado: true });
      }
    });
    await buscarOS(dom, '4');
    assert.strictEqual(chamouConsultarDeNovo, 1, 'sanity: 1 busca inicial');

    var resultado = document.getElementById('consulta-os-resultado');
    resultado.querySelector('.btn-editar-consulta').dispatchEvent(new dom.window.Event('click'));
    var form = resultado.querySelector('.form-edicao-consulta');

    var selectStatus = form.querySelector('.campo-edicao-status');
    selectStatus.value = 'Em reparo';
    var textareaDefeito = form.querySelector('.campo-edicao-defeito');
    textareaDefeito.value = 'Tela trincada, não liga';

    form.querySelector('.btn-salvar-edicao-consulta').dispatchEvent(new dom.window.Event('click'));
    await esperar(30);

    assert.deepStrictEqual(
      camposEnviados,
      { status: 'Em reparo', 'aparelho.defeitoRelatado': 'Tela trincada, não liga' },
      'só os campos de fato alterados foram enviados (não prioridade/observações, que não mudaram)'
    );
    assert.strictEqual(chamouConsultarDeNovo, 2, 'reconsultou a OS depois de salvar com sucesso, para refletir o estado real do PC');
  });

  await testeAsync('salvar sem nenhuma alteração: não chama atualizarOS, avisa "nenhuma alteração"', async function () {
    var chamouNotificar = false;
    var avisos = [];
    var dom = carregarConsultaJs({
      consultar: function () { return Promise.resolve({ encontrada: true, origem: 'supabase', dados: dadosOsEncontrada() }); },
      atualizarOS: function () { chamouNotificar = true; return Promise.resolve({ enviado: true }); }
    }, { mostrar: function (msg, tipo) { avisos.push({ msg: msg, tipo: tipo }); } });

    await buscarOS(dom, '4');
    var resultado = document.getElementById('consulta-os-resultado');
    resultado.querySelector('.btn-editar-consulta').dispatchEvent(new dom.window.Event('click'));
    var form = resultado.querySelector('.form-edicao-consulta');

    // Não muda nada — clica direto em Salvar.
    form.querySelector('.btn-salvar-edicao-consulta').dispatchEvent(new dom.window.Event('click'));
    await esperar(20);

    assert.strictEqual(chamouNotificar, false, 'atualizarOS não foi chamada sem mudanças reais');
    assert.ok(avisos.some(function (a) { return a.msg.indexOf('Nenhuma alteração') !== -1; }), 'avisou que não havia alteração para salvar');
  });

  await testeAsync('excluir: pede confirmação e só chama excluirOS se confirmado', async function () {
    var chamouExcluir = 0;
    var dom = carregarConsultaJs({
      consultar: function () { return Promise.resolve({ encontrada: true, origem: 'supabase', dados: dadosOsEncontrada() }); },
      excluirOS: function () { chamouExcluir++; return Promise.resolve({ enviado: true }); }
    }, null, function () { return false; }); // confirm() cancelado

    await buscarOS(dom, '4');
    var resultado = document.getElementById('consulta-os-resultado');
    resultado.querySelector('.btn-excluir-consulta').dispatchEvent(new dom.window.Event('click'));
    await esperar(20);

    assert.strictEqual(chamouExcluir, 0, 'não exclui quando o técnico cancela a confirmação');
  });

  await testeAsync('excluir confirmado: chama excluirOS e limpa o card em caso de sucesso', async function () {
    var chamouExcluirComNumero = null;
    var dom = carregarConsultaJs({
      consultar: function () { return Promise.resolve({ encontrada: true, origem: 'supabase', dados: dadosOsEncontrada() }); },
      excluirOS: function (referencia) {
        chamouExcluirComNumero = referencia.numero;
        return Promise.resolve({ enviado: true });
      }
    }, null, function () { return true; }); // confirm() aceito

    await buscarOS(dom, '4');
    var resultado = document.getElementById('consulta-os-resultado');
    resultado.querySelector('.btn-excluir-consulta').dispatchEvent(new dom.window.Event('click'));
    await esperar(30);

    assert.strictEqual(chamouExcluirComNumero, '4', 'excluirOS foi chamada com o número certo');
    assert.strictEqual(resultado.hidden, true, 'o card de resultado foi escondido depois da exclusão confirmada pelo PC');
    assert.strictEqual(resultado.innerHTML, '', 'o card de resultado foi limpo depois da exclusão confirmada pelo PC');
  });

  console.log('\n' + total + ' teste(s), ' + falhas + ' falha(s).');
  process.exit(falhas > 0 ? 1 : 0);
})();
