(function (global) {
  'use strict';

  var REPOSITORIO = 'albertocodexx/sistemaos-updates';
  var ENDPOINT = 'https://api.github.com/repos/' + REPOSITORIO + '/releases/latest';
  var CHAVE_CACHE = 'sistemaos_atualizacao_github_v1';
  var CACHE_MS = 6 * 60 * 60 * 1000;
  var FETCH_TIMEOUT_MS = 15000;
  var ultima = null;
  var abrindoFallback = false;
  var downloadEmAndamento = null;

  async function fetchComTempoLimite(url, opcoes) {
    var controle = typeof AbortController === 'function' ? new AbortController() : null;
    var entrada = Object.assign({}, opcoes || {});
    var sinalExterno = entrada.signal;
    var aoAbortar = null;
    if (controle) {
      if (sinalExterno && sinalExterno.aborted) controle.abort();
      else if (sinalExterno && typeof sinalExterno.addEventListener === 'function') {
        aoAbortar = function () { controle.abort(); };
        sinalExterno.addEventListener('abort', aoAbortar, { once: true });
      }
      entrada.signal = controle.signal;
    }
    var temporizador = global.setTimeout(function () {
      if (controle) controle.abort();
    }, FETCH_TIMEOUT_MS);
    try {
      return await global.fetch(url, entrada);
    } finally {
      global.clearTimeout(temporizador);
      if (sinalExterno && aoAbortar) sinalExterno.removeEventListener('abort', aoAbortar);
    }
  }

  function normalizarVersao(valor) {
    return String(valor || '').replace(/^v/i, '').trim();
  }

  function compararVersoes(atual, nova) {
    var a = normalizarVersao(atual).split('.');
    var b = normalizarVersao(nova).split('.');
    for (var i = 0; i < 3; i += 1) {
      var na = parseInt(a[i] || '0', 10) || 0;
      var nb = parseInt(b[i] || '0', 10) || 0;
      if (na !== nb) return nb > na ? -1 : 1;
    }
    return 0;
  }

  async function versaoAtual() {
    try {
      var app = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.App;
      if (app && typeof app.getInfo === 'function') {
        var info = await app.getInfo();
        if (info && info.version) return normalizarVersao(info.version);
      }
    } catch (_) {}
    try {
      var atualizacao = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Atualizacao;
      if (atualizacao && typeof atualizacao.obterVersaoInstalada === 'function') {
        var instalada = await atualizacao.obterVersaoInstalada();
        if (instalada && instalada.versao) return normalizarVersao(instalada.versao);
      }
    } catch (_) {}
    // Ultimo recurso para execucao fora do Android. Este valor acompanha o
    // versionName do APK e evita oferecer a propria versao como atualizacao.
    return normalizarVersao(global.SistemaOSVersaoAPK || '1.0.91');
  }

  function lerCache() {
    try {
      var cache = JSON.parse(localStorage.getItem(CHAVE_CACHE) || 'null');
      return cache && Date.now() - cache.em < CACHE_MS ? cache.dados : null;
    } catch (_) { return null; }
  }

  function gravarCache(dados) {
    try { localStorage.setItem(CHAVE_CACHE, JSON.stringify({ em: Date.now(), dados: dados })); } catch (_) {}
  }

  function publicarResultado(dados) {
    // Mantém URL, hash e nome do APK durante as fases de download/instalação.
    // Assim, se o instalador nativo falhar, o fallback oficial ainda funciona.
    ultima = Object.assign({}, ultima || {}, dados || {});
    try {
      global.dispatchEvent(new CustomEvent('sistema-os:atualizacao-disponivel', { detail: ultima }));
    } catch (_) {}
    return ultima;
  }

  function extrairAssetApk(release) {
    var ativos = Array.isArray(release && release.assets) ? release.assets : [];
    return ativos.filter(function (asset) {
      return /^SistemaOS-\d+\.\d+\.\d+\.apk$/i.test(String(asset.name || ''));
    }).sort(function (a, b) {
      return compararVersoes(versaoDoAsset(b), versaoDoAsset(a));
    })[0] || null;
  }

  function versaoDoAsset(asset) {
    var encontrado = String(asset && asset.name || '').match(/(\d+\.\d+\.\d+)/);
    return encontrado ? encontrado[1] : '';
  }

  function extrairAssetChecksum(release, apk) {
    var ativos = Array.isArray(release && release.assets) ? release.assets : [];
    var nomeEsperado = String(apk && apk.name || '') + '.sha256';
    return ativos.find(function (asset) {
      return String(asset.name || '').toLowerCase() === nomeEsperado.toLowerCase();
    }) || null;
  }

  async function lerChecksum(asset) {
    if (!asset || !asset.browser_download_url) throw new Error('Arquivo de verificação não encontrado.');
    var resposta = await fetchComTempoLimite(asset.browser_download_url, { cache: 'no-store' });
    if (!resposta.ok) throw new Error('Não foi possível baixar a verificação da atualização.');
    var texto = await resposta.text();
    var hash = String(texto || '').match(/\b[a-f0-9]{64}\b/i);
    if (!hash) throw new Error('A verificação SHA-256 da atualização é inválida.');
    return hash[0].toLowerCase();
  }

  async function obterRelease(forcar) {
    if (!forcar) {
      var cache = lerCache();
      if (cache) return cache;
    }
    var resposta = await fetchComTempoLimite(ENDPOINT, {
      headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store'
    });
    if (resposta.status === 404) return { disponivel: false, motivo: 'Nenhuma versão do APK foi publicada ainda.' };
    if (!resposta.ok) throw new Error('GitHub retornou status ' + resposta.status + '.');
    var release = await resposta.json();
    var asset = extrairAssetApk(release);
    if (!asset || !asset.browser_download_url) {
      return { disponivel: false, motivo: 'A release mais recente ainda não possui um APK oficial nomeado com a versão.' };
    }
    // O próprio GitHub informa o SHA-256 do APK no JSON da release. Usar esse
    // campo evita baixar o arquivo .sha256 pelo WebView: o redirecionamento dos
    // assets não envia CORS e o Android o interpretava como falha de internet.
    var digest = String(asset.digest || '').match(/^sha256:([a-f0-9]{64})$/i);
    var sha256 = digest ? digest[1].toLowerCase() : '';
    if (!sha256) {
      var checksum = extrairAssetChecksum(release, asset);
      if (!checksum) return { disponivel: false, motivo: 'A release mais recente ainda não possui a verificação SHA-256 do APK.' };
      sha256 = await lerChecksum(checksum);
    }
    var dados = { disponivel: true, release: release, asset: asset, sha256: sha256, versaoNova: versaoDoAsset(asset) };
    gravarCache(dados);
    return dados;
  }

  async function verificar(forcar) {
    var atual = await versaoAtual();
    publicarResultado({ fase: 'verificando', versaoAtual: atual, mensagem: 'Verificando atualização do aplicativo…' });
    try {
      var release = await obterRelease(!!forcar);
      if (!release.disponivel) return publicarResultado({ fase: 'indisponivel', versaoAtual: atual, mensagem: release.motivo });
      var nova = release.versaoNova;
      if (!nova || compararVersoes(atual, nova) >= 0) {
        return publicarResultado({ fase: 'atualizado', versaoAtual: atual, versaoNova: nova, mensagem: 'Este celular já está na versão mais recente.' });
      }
      return publicarResultado({
        fase: 'disponivel', versaoAtual: atual, versaoNova: nova,
        nomeArquivo: release.asset.name, url: release.asset.browser_download_url, sha256: release.sha256,
        paginaDownload: release.release && release.release.html_url ? release.release.html_url : release.asset.browser_download_url,
        mensagem: 'A versão ' + nova + ' está disponível para baixar.'
      });
    } catch (erro) {
      var detalhe = erro && erro.message ? ' (' + erro.message + ')' : '';
      return publicarResultado({ fase: 'erro', versaoAtual: atual, mensagem: 'Não foi possível verificar atualizações. Confira a internet.' + detalhe });
    }
  }

  async function abrirDownloadManual() {
    var url = ultima && (ultima.paginaDownload || ultima.url);
    if (!url || abrindoFallback) return false;
    abrindoFallback = true;
    try {
      var plugin = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Atualizacao;
      if (plugin && typeof plugin.abrirNoNavegador === 'function') {
        await plugin.abrirNoNavegador({ url: url });
      } else {
        global.open(url, '_system');
      }
      return true;
    } catch (_) {
      try {
        global.location.href = url;
        return true;
      } catch (_) {
        return false;
      }
    } finally {
      setTimeout(function () { abrindoFallback = false; }, 1500);
    }
  }

  async function baixarEInstalar() {
    if (downloadEmAndamento) return downloadEmAndamento;
    if (!ultima || ultima.fase !== 'disponivel') return { sucesso: false, erro: 'Verifique a atualização antes de instalar.' };
    var plugin = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Atualizacao;
    if (!plugin || typeof plugin.baixarEInstalar !== 'function') {
      return { sucesso: false, erro: 'O instalador automático não está disponível neste aplicativo.' };
    }
    var dadosDownload = {
      url: ultima.url,
      nome: ultima.nomeArquivo,
      sha256: ultima.sha256,
      versao: ultima.versaoNova
    };
    downloadEmAndamento = (async function () {
      try {
        var retornoNativo = await plugin.baixarEInstalar(dadosDownload);
        var mensagem = retornoNativo && retornoNativo.aguardandoPermissao
          ? (retornoNativo.mensagem || 'Autorize esta fonte. Ao voltar, o download iniciará uma única vez.')
          : (retornoNativo && retornoNativo.reutilizado
            ? 'A atualização já está sendo preparada. Nenhum novo download foi criado.'
            : 'Baixando o APK somente enquanto o aplicativo estiver aberto.');
        publicarResultado({
          fase: retornoNativo && retornoNativo.aguardandoPermissao ? 'confirmacao' : 'baixando',
          versaoAtual: ultima.versaoAtual,
          versaoNova: ultima.versaoNova,
          progresso: Number(retornoNativo && retornoNativo.progresso || 0),
          mensagem: mensagem
        });
        return { sucesso: true, mensagem: mensagem, reutilizado: !!(retornoNativo && retornoNativo.reutilizado) };
      } catch (erro) {
        var detalhe = erro && erro.message ? erro.message : 'Não foi possível baixar o APK.';
        publicarResultado({ fase: 'erro', mensagem: detalhe });
        return { sucesso: false, erro: detalhe };
      } finally {
        downloadEmAndamento = null;
      }
    })();
    return downloadEmAndamento;
  }

  global.SistemaOSAtualizacao = Object.freeze({
    REPOSITORIO: REPOSITORIO,
    verificar: verificar,
    baixarEInstalar: baixarEInstalar,
    abrirDownloadManual: abrirDownloadManual,
    obterUltima: function () { return ultima; }
  });

  // A validação do SHA-256 é feita no código nativo depois do download. Se
  // ela falhar, o Android remove o arquivo e este aviso deixa o motivo claro.
  (function ouvirErrosNativos() {
    try {
      var plugin = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Atualizacao;
      if (!plugin || typeof plugin.addListener !== 'function') return;
      plugin.addListener('atualizacaoErro', function (evento) {
        var detalhe = evento && evento.erro ? evento.erro : 'Falha na verificação da atualização.';
        publicarResultado({ fase: 'erro', mensagem: detalhe });
        if (global.SistemaOSToast && typeof global.SistemaOSToast.mostrar === 'function') {
          global.SistemaOSToast.mostrar(ultima.mensagem, { ehErro: true });
        }
      });
      plugin.addListener('atualizacaoStatus', function (evento) {
        evento = evento || {};
        publicarResultado({
          fase: evento.fase || 'baixando',
          versaoAtual: ultima && ultima.versaoAtual,
          versaoNova: ultima && ultima.versaoNova,
          progresso: Number(evento.progresso || 0),
          mensagem: evento.mensagem || 'Preparando a atualização do aplicativo...'
        });
      });
    } catch (_) {}
  })();

  // Verificação automática: não interrompe o trabalho do técnico, apenas
  // consulta a release oficial em segundo plano ao abrir o aplicativo.
  // A instalação continua exigindo o toque explícito do usuário no Android.
  setTimeout(function () {
    verificar(false).then(function (resultado) {
      if (resultado && resultado.fase === 'disponivel' && global.SistemaOSToast && typeof global.SistemaOSToast.mostrar === 'function') {
        global.SistemaOSToast.mostrar('Atualização ' + resultado.versaoNova + ' disponível. Toque em "Atualizar agora".');
      }
    }).catch(function () {});
  }, 400);
})(window);
