// testes/bloco4-editar-reenviar.teste.js
//
// Bloco 4 (editar no celular depois de salvo, reenviando pro PC). Cobre a
// decisão de arquitetura do bloco: persistir idExportacaoOriginal no
// momento do salvamento (não recalcular ao reenviar), para que editar um
// campo que entra no hash não vire um documento novo do ponto de vista
// do PC.
//
// Usa fake-indexeddb porque js/historico.js depende de IndexedDB.
//
// Rodar: node testes/bloco4-editar-reenviar.teste.js

require('fake-indexeddb/auto');
var assert = require('assert');
var fs = require('fs');
var path = require('path');

global.window = global;
global.self = global;

function carregar(nomeArquivo) {
  var codigo = fs.readFileSync(path.join(__dirname, '..', 'www', 'js', nomeArquivo), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(codigo);
}
carregar('id-exportacao.js');
carregar('historico.js');

var falhas = 0;
var total = 0;
var fila = [];
function teste(nome, fnQueRetornaPromise) {
  fila.push({ nome: nome, fn: fnQueRetornaPromise });
}

// Mesmas funções de montagem de payload que existem em app.js
// (montarDadosOSParaEnvio) — reduzidas aqui só ao necessário para o
// teste, já que app.js inteiro não pode ser `eval`ado sem DOM completo
// (document.getElementById logo na abertura da IIFE). O contrato
// testado é o de historico.js (montarItemReenvio recebe uma função
// injetada) — qual função exata app.js injeta é responsabilidade dele,
// não deste módulo.
function montarDadosOSParaEnvioTeste(dados) {
  return {
    cliente: dados.cliente,
    aparelho: dados.aparelho,
    observacoes: dados.observacoes,
    assinaturaClienteBase64: dados.assinaturaClienteBase64 || ''
  };
}

teste('salvar: persiste idExportacaoOriginal igual ao que IdExportacao.gerar produziria na hora', function () {
  var osDados = { cliente: { nome: 'Cliente 1' }, aparelho: { marca: 'Samsung', modelo: 'A10' }, assinaturaClienteBase64: 'ASSINATURA_X' };
  var idEsperado = window.IdExportacao.gerar('os', osDados);
  return window.SistemaOSHistorico.salvar(osDados, 'os').then(function (registro) {
    assert.strictEqual(registro.idExportacaoOriginal, idEsperado, 'idExportacaoOriginal deveria bater com o hash calculado na hora do salvamento');
  });
});

teste('editarRegistro: muda os campos, mas NÃO muda idExportacaoOriginal mesmo editando campos que entram no hash', function () {
  var osDados = { cliente: { nome: 'Cliente 2' }, aparelho: { marca: 'Motorola', modelo: 'G8' }, assinaturaClienteBase64: 'ASSINATURA_Y' };
  return window.SistemaOSHistorico.salvar(osDados, 'os').then(function (registroSalvo) {
    var idOriginal = registroSalvo.idExportacaoOriginal;
    return window.SistemaOSHistorico.editarRegistro(registroSalvo.id, {
      cliente: { nome: 'Cliente 2 EDITADO' } // campo que ENTRA no hash (cliente não é excluído em id-exportacao.js)
    }).then(function (registroEditado) {
      assert.strictEqual(registroEditado.os.cliente.nome, 'Cliente 2 EDITADO', 'o campo editado deveria ter mudado');
      assert.strictEqual(registroEditado.idExportacaoOriginal, idOriginal, 'idExportacaoOriginal deveria continuar o MESMO após editar um campo que entraria no hash');
      // Confirma que, se recalculado ingenuamente a partir dos dados já
      // editados, o id SERIA diferente — provando que a persistência é
      // o que evita o problema (não é uma coincidência de hash).
      var idSeRecalculasseIngenuamente = window.IdExportacao.gerar('os', registroEditado.os);
      assert.notStrictEqual(idSeRecalculasseIngenuamente, idOriginal, 'pré-condição do teste: editar cliente.nome deveria mesmo mudar o hash recalculado — senão este teste não prova nada');
    });
  });
});

teste('editarRegistro: preserva a assinatura já capturada mesmo editando outros campos', function () {
  var osDados = { cliente: { nome: 'Cliente 3' }, aparelho: { marca: 'Apple', modelo: 'X' }, assinaturaClienteBase64: 'ASSINATURA_ORIGINAL_INTACTA' };
  return window.SistemaOSHistorico.salvar(osDados, 'os').then(function (registroSalvo) {
    return window.SistemaOSHistorico.editarRegistro(registroSalvo.id, {
      observacoes: 'Observação nova adicionada na edição'
    }).then(function (registroEditado) {
      assert.strictEqual(registroEditado.os.assinaturaClienteBase64, 'ASSINATURA_ORIGINAL_INTACTA', 'a assinatura não deveria ter sido tocada pela edição');
      assert.strictEqual(registroEditado.os.observacoes, 'Observação nova adicionada na edição');
    });
  });
});

teste('editarRegistro: marca sincronizadoComPC de volta para false (o PC ainda não tem a edição)', function () {
  var osDados = { cliente: { nome: 'Cliente 4' }, aparelho: { marca: 'LG', modelo: 'K12' } };
  return window.SistemaOSHistorico.salvar(osDados, 'os').then(function (registroSalvo) {
    return window.SistemaOSHistorico.marcarComoSincronizado([registroSalvo.id]).then(function () {
      return window.SistemaOSHistorico.editarRegistro(registroSalvo.id, { observacoes: 'mudou' });
    }).then(function () {
      return window.SistemaOSHistorico.obterPorId(registroSalvo.id);
    }).then(function (registroFinal) {
      assert.strictEqual(registroFinal.sincronizadoComPC, false, 'depois de editar, deveria voltar a ser pendente de sincronização');
    });
  });
});

teste('editarRegistro: rejeita edição de comprovante de entrega (fora do escopo deste bloco)', function () {
  return window.SistemaOSHistorico.salvarEntrega({ numeroOS: '123', nomeRetirou: 'Fulano', assinaturaRetirouBase64: 'X' }).then(function (registroSalvo) {
    return window.SistemaOSHistorico.editarRegistro(registroSalvo.id, { nomeRetirou: 'Outro Nome' }).then(function () {
      throw new Error('não deveria ter resolvido — deveria ter rejeitado');
    }, function (erro) {
      assert.ok(/entrega/i.test(erro.message), 'a mensagem de erro deveria mencionar entrega');
    });
  });
});

teste('editarRegistro: id inexistente resolve null, não lança', function () {
  return window.SistemaOSHistorico.editarRegistro('id-que-nao-existe', { observacoes: 'x' }).then(function (resultado) {
    assert.strictEqual(resultado, null);
  });
});

teste('montarItemReenvio: usa idExportacaoOriginal persistido, não recalcula', function () {
  var osDados = { cliente: { nome: 'Cliente 5' }, aparelho: { marca: 'Xiaomi', modelo: 'Redmi 9' }, assinaturaClienteBase64: 'ASSINATURA_5' };
  return window.SistemaOSHistorico.salvar(osDados, 'os').then(function (registroSalvo) {
    var idOriginal = registroSalvo.idExportacaoOriginal;
    return window.SistemaOSHistorico.editarRegistro(registroSalvo.id, { cliente: { nome: 'Cliente 5 EDITADO' } }).then(function (registroEditado) {
      var item = window.SistemaOSHistorico.montarItemReenvio(registroEditado, montarDadosOSParaEnvioTeste);
      assert.strictEqual(item.idExportacao, idOriginal, 'o item de reenvio deveria usar o idExportacao ORIGINAL, não um recalculado');
      assert.strictEqual(item.tipoDocumento, 'os');
      assert.strictEqual(item.dados.cliente.nome, 'Cliente 5 EDITADO', 'os dados enviados deveriam refletir a edição');
    });
  });
});

teste('montarItemReenvio: registro antigo sem idExportacaoOriginal cai no fallback (recalcula)', function () {
  // Simula um registro salvo ANTES desta mudança existir (sem o campo).
  var registroAntigo = {
    tipoDocumento: 'os',
    os: { cliente: { nome: 'Cliente Antigo' }, aparelho: { marca: 'Nokia', modelo: '3310' } }
    // idExportacaoOriginal ausente de propósito
  };
  var item = window.SistemaOSHistorico.montarItemReenvio(registroAntigo, montarDadosOSParaEnvioTeste);
  var idEsperadoFallback = window.IdExportacao.gerar('os', registroAntigo.os);
  assert.strictEqual(item.idExportacao, idEsperadoFallback, 'sem idExportacaoOriginal persistido, deveria recalcular como fallback (comportamento antigo preservado)');
});

teste('fluxo completo: edita a OS, envia pelo adaptador e marca sincronizado', function () {
  var osDados = { cliente: { nome: 'Cliente 6' }, aparelho: { marca: 'Samsung', modelo: 'S21' }, assinaturaClienteBase64: 'ASSINATURA_6' };
  var chamadasNuvem = [];
  var cloudDataMock = {
    sincronizarRegistroOS: function (registro) {
      chamadasNuvem.push(registro);
      return Promise.resolve({ enviado: true });
    }
  };

  // Réplica mínima da orquestração que window.reenviarEdicaoHistorico faz
  // em app.js (ver comentário no topo do arquivo sobre por que app.js
  // inteiro não pode ser carregado aqui).
  function reenviarEdicaoHistoricoSimulado(id, camposEditados) {
    return window.SistemaOSHistorico.editarRegistro(id, camposEditados).then(function (registroEditado) {
      return cloudDataMock.sincronizarRegistroOS(registroEditado).then(function (resultado) {
        if (resultado.enviado) {
          return window.SistemaOSHistorico.marcarComoSincronizado([id]).then(function () {
            return { sucesso: true, enviado: true };
          });
        }
        return { sucesso: true, enviado: false };
      });
    });
  }

  return window.SistemaOSHistorico.salvar(osDados, 'os').then(function (registroSalvo) {
    var idOriginal = registroSalvo.idExportacaoOriginal;
    return reenviarEdicaoHistoricoSimulado(registroSalvo.id, { observacoes: 'Edição final' }).then(function (resultado) {
      assert.strictEqual(resultado.sucesso, true);
      assert.strictEqual(resultado.enviado, true);
      assert.strictEqual(chamadasNuvem.length, 1, 'o adaptador deveria ser chamado exatamente 1 vez');
      assert.strictEqual(chamadasNuvem[0].idExportacaoOriginal, idOriginal, 'o registro enviado deveria preservar o idExportacao ORIGINAL');
      assert.strictEqual(chamadasNuvem[0].os.observacoes, 'Edição final');
      return window.SistemaOSHistorico.obterPorId(registroSalvo.id);
    }).then(function (registroFinal) {
      assert.strictEqual(registroFinal.sincronizadoComPC, true, 'depois do reenvio bem-sucedido, deveria voltar a ficar marcado como sincronizado');
    });
  });
});

// ── Executor sequencial ──────────────────────────────────────────────
function rodar(i) {
  if (i >= fila.length) {
    console.log('\n' + total + ' teste(s), ' + falhas + ' falha(s).');
    process.exit(falhas > 0 ? 1 : 0);
    return;
  }
  var atual = fila[i];
  total++;
  Promise.resolve().then(atual.fn).then(function () {
    console.log('OK   - ' + atual.nome);
    rodar(i + 1);
  }).catch(function (err) {
    falhas++;
    console.log('FALHA - ' + atual.nome);
    console.log('       ' + (err && err.message ? err.message : err));
    rodar(i + 1);
  });
}
rodar(0);
