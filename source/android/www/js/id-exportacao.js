// js/id-exportacao.js
//
// Lógica compartilhada de geração do idExportacao. Mantê-la fora de app.js
// evita cópias divergentes do mesmo algoritmo.
//
// Determinístico: dado o mesmo `dados` e o mesmo `tipoDocumento`, sempre
// produz o mesmo id — reexportar o mesmo documento sem alterar nada (ou
// recalcular depois, a partir do que já está salvo no IndexedDB) gera o
// MESMO idExportacao.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.IdExportacao = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function gerarHashSimples(texto) {
    // Hash determinístico não-criptográfico (djb2) — mesmo raciocínio
    // original em app.js: não precisa resistir a colisão adversarial, só
    // precisa ser estável e barato, sem depender de crypto.subtle.
    var hash = 5381;
    for (var i = 0; i < texto.length; i++) {
      hash = ((hash << 5) + hash) + texto.charCodeAt(i);
      hash = hash | 0; // força int32
    }
    return (hash >>> 0).toString(36);
  }

  function jsonEstavel(valor) {
    if (Array.isArray(valor)) {
      return '[' + valor.map(jsonEstavel).join(',') + ']';
    }
    if (valor && typeof valor === 'object') {
      var chaves = Object.keys(valor).sort();
      var partes = chaves.map(function (chave) {
        return JSON.stringify(chave) + ':' + jsonEstavel(valor[chave]);
      });
      return '{' + partes.join(',') + '}';
    }
    return JSON.stringify(valor);
  }

  // Gera o idExportacao de um documento. Exclui do hash os campos que
  // variam sem o conteúdo ter mudado de verdade (timestamps, número
  // atribuído pelo PC) — ver comentário original em app.js.
  function gerar(tipoDocumento, dados) {
    var copia = JSON.parse(JSON.stringify(dados || {}));
    delete copia.data;
    delete copia.dataVenda;
    delete copia.numero;
    delete copia.id;
    delete copia.dataHoraAssinatura;
    delete copia.dataLimiteGarantia;
    var base = tipoDocumento + '|' + jsonEstavel(copia);
    return tipoDocumento + '-' + gerarHashSimples(base);
  }

  return {
    gerar: gerar
  };
});
