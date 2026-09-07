// Retry automático das OS pendentes pelo Supabase.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SyncRetry = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var tentativaEmAndamento = false;

  function tentarReenviarPendentes() {
    if (tentativaEmAndamento) {
      return Promise.resolve({ executado: false, motivo: 'ja-em-andamento' });
    }
    tentativaEmAndamento = true;

    function liberar(resultado) {
      tentativaEmAndamento = false;
      return resultado;
    }

    var nuvemAtiva = !!(window.CloudData && window.CloudData.providerEscritas &&
      window.CloudData.providerEscritas() === 'supabase' &&
      window.CloudData.sincronizarRegistro && window.CloudData.processarFila);
    if (!window.SistemaOSHistorico || !nuvemAtiva) {
      return Promise.resolve(liberar({ executado: false, motivo: 'sem-sessao' }));
    }

    return window.CloudData.processarFila()
      .then(function () {
        return window.SistemaOSHistorico.listarPendentesSincronizacao();
      })
      .then(function (pendentes) {
        var ordens = (pendentes || []).filter(function (registro) {
          return ['os', 'compra', 'venda', 'entrega'].indexOf(registro.tipoDocumento || 'os') !== -1;
        });
        if (!ordens.length) {
          return liberar({ executado: false, motivo: 'sem-pendentes' });
        }

        return ordens.reduce(function (promessa, registro) {
          return promessa.then(function (contagem) {
            return window.CloudData.sincronizarRegistro(registro)
              .then(function (resultado) {
                if (resultado && resultado.enviado) {
                  return window.SistemaOSHistorico.marcarComoSincronizado([registro.id])
                    .then(function () {
                      contagem.enviados += 1;
                      return contagem;
                    });
                }
                contagem.falharam += 1;
                if (window.SistemaOSHistorico.marcarTentativaSincronizacaoFalhou) {
                  return window.SistemaOSHistorico.marcarTentativaSincronizacaoFalhou([registro.id])
                    .then(function () { return contagem; })
                    .catch(function () { return contagem; });
                }
                return contagem;
              })
              .catch(function () {
                contagem.falharam += 1;
                return contagem;
              });
          });
        }, Promise.resolve({ enviados: 0, falharam: 0 })).then(function (contagem) {
          return window.CloudData.processarFila()
            .catch(function () { return null; })
            .then(function () {
              return liberar({
                executado: true,
                enviados: contagem.enviados,
                falharam: contagem.falharam
              });
            });
        });
      })
      .catch(function (erro) {
        console.error('sync-retry.js: falha ao tentar reenviar pendentes.', erro);
        return liberar({ executado: false, motivo: 'erro', erro: erro });
      });
  }

  function iniciarRetryPeriodico(_montarItemFn, intervaloMs) {
    var id = setInterval(function () {
      tentarReenviarPendentes();
    }, intervaloMs || 5 * 60 * 1000);
    return function pararRetryPeriodico() {
      clearInterval(id);
    };
  }

  return {
    tentarReenviarPendentes: tentarReenviarPendentes,
    iniciarRetryPeriodico: iniciarRetryPeriodico
  };
});
