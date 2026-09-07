(function (global) {
  'use strict';

  var TEMPO_LIMITE_MS = 25000;
  var btnVerificar = document.getElementById('btn-verificar-atualizacao-app');
  var btnInstalar = document.getElementById('btn-instalar-atualizacao-app');
  var status = document.getElementById('status-atualizacao-app');
  var textoOriginal = btnVerificar ? btnVerificar.textContent : 'Verificar atualização';

  function avisar(mensagem, ehErro) {
    try {
      if (global.SistemaOSToast && typeof global.SistemaOSToast.mostrar === 'function') {
        global.SistemaOSToast.mostrar(mensagem, { ehErro: !!ehErro });
      }
    } catch (_) {}
  }

  function exibir(resultado, mostrarToast) {
    resultado = resultado || {};
    var mensagem = String(resultado.mensagem || resultado.erro || 'Não foi possível obter o estado da atualização.');
    var ehErro = resultado.fase === 'erro' || resultado.sucesso === false;
    if (status) {
      status.hidden = false;
      status.textContent = mensagem;
      status.classList.toggle('erro', ehErro);
      status.setAttribute('role', ehErro ? 'alert' : 'status');
    }
    if (btnInstalar) btnInstalar.hidden = resultado.fase !== 'disponivel';
    if (mostrarToast) avisar(mensagem, ehErro);
    return resultado;
  }

  function comTempoLimite(promessa) {
    return Promise.race([
      promessa,
      new Promise(function (_, rejeitar) {
        setTimeout(function () {
          rejeitar(new Error('A verificação demorou demais. Confira a internet e tente novamente.'));
        }, TEMPO_LIMITE_MS);
      })
    ]);
  }

  async function verificar(forcar, manual) {
    if (btnVerificar) {
      btnVerificar.disabled = true;
      btnVerificar.textContent = 'Verificando...';
    }
    exibir({ fase: 'verificando', mensagem: 'Verificando atualização no GitHub...' }, false);
    try {
      if (!global.SistemaOSAtualizacao || typeof global.SistemaOSAtualizacao.verificar !== 'function') {
        throw new Error('O recurso de atualização não foi carregado. Feche e abra o aplicativo novamente.');
      }
      var resultado = await comTempoLimite(global.SistemaOSAtualizacao.verificar(!!forcar));
      return exibir(resultado, !!manual);
    } catch (erro) {
      console.warn('[atualizacao-tela] Falha ao verificar atualização:', erro);
      return exibir({ fase: 'erro', mensagem: erro && erro.message ? erro.message : 'Não foi possível verificar atualizações.' }, !!manual);
    } finally {
      if (btnVerificar) {
        btnVerificar.disabled = false;
        btnVerificar.textContent = textoOriginal;
      }
    }
  }

  async function instalar() {
    if (btnInstalar) btnInstalar.disabled = true;
    exibir({ fase: 'baixando', mensagem: 'Preparando o download seguro do APK...' }, false);
    try {
      if (!global.SistemaOSAtualizacao || typeof global.SistemaOSAtualizacao.baixarEInstalar !== 'function') {
        throw new Error('O instalador automático não está disponível neste APK.');
      }
      var resultado = await global.SistemaOSAtualizacao.baixarEInstalar();
      return exibir({
        fase: resultado && resultado.sucesso ? 'baixando' : 'erro',
        mensagem: resultado && (resultado.mensagem || resultado.erro),
        sucesso: !!(resultado && resultado.sucesso)
      }, true);
    } catch (erro) {
      console.warn('[atualizacao-tela] Falha ao instalar atualização:', erro);
      return exibir({ fase: 'erro', mensagem: erro && erro.message ? erro.message : 'Não foi possível iniciar o download do APK.' }, true);
    } finally {
      if (btnInstalar) btnInstalar.disabled = false;
    }
  }

  if (btnVerificar && !btnVerificar.dataset.atualizacaoVinculada) {
    btnVerificar.dataset.atualizacaoVinculada = '1';
    btnVerificar.addEventListener('click', function () { verificar(true, true); });
  }
  if (btnInstalar && !btnInstalar.dataset.atualizacaoVinculada) {
    btnInstalar.dataset.atualizacaoVinculada = '1';
    btnInstalar.addEventListener('click', instalar);
  }

  global.addEventListener('sistema-os:atualizacao-disponivel', function (evento) {
    if (evento && evento.detail) exibir(evento.detail, false);
  });
  document.addEventListener('sistema-os:tela-config-aberta', function () {
    var ultima = global.SistemaOSAtualizacao && global.SistemaOSAtualizacao.obterUltima
      ? global.SistemaOSAtualizacao.obterUltima()
      : null;
    if (ultima) exibir(ultima, false);
    else verificar(false, false);
  });

  global.SistemaOSAtualizacaoTela = Object.freeze({ verificar: verificar, instalar: instalar, exibir: exibir });
})(window);
