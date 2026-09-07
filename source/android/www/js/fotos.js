// js/fotos.js
//
// Captura, compressão e preview de fotos anexadas em Nova OS ("como
// chegou") e Entregas ("como saiu"). Isolado do app.js como os demais
// componentes (assinatura.js, toast.js) — mantém um array em memória por
// contexto e expõe métodos simples para o app.js ler na hora de montar o
// objeto (montarObjetoOS/montarObjetoEntrega).
//
// Fotos de câmera podem vir enormes (4000x3000+, vários MB) — isso
// estouraria o JSON do lote rapidinho com até 10 fotos por documento.
// Por isso, toda foto é redimensionada (lado maior <= 1280px) e
// recomprimida em JPEG via canvas antes de entrar no array.
//
// PROBLEMA QUE ISTO RESOLVE: <input type="file" accept="image/*"> sozinho,
// dentro do WebView que o Capacitor usa para empacotar o APK, não garante
// um menu "Câmera ou Galeria" — em muitos aparelhos/versões de Android ele
// vai direto pro seletor de arquivos/galeria, sem oferecer a câmera como
// opção clara. A correção usa @capacitor/camera (exige instalado — ver
// GUIA-GERAR-APK-CAPACITOR.md — e um novo APK gerado), cujo
// Camera.getPhoto({ source: CameraSource.Prompt }) abre nativamente o
// menu "Câmera / Galeria / Cancelar", garantido em qualquer Android/iOS.
//
// ORDEM DE TENTATIVA, do melhor caso ao pior:
//   1. @capacitor/camera — menu nativo Câmera/Galeria de verdade. Só
//      tentado se o plugin estiver presente neste ambiente (dentro do
//      APK, depois de instalado — ver Passo 4 do guia).
//   2. <input type="file" accept="image/*" multiple> — fallback mantido
//      para quem abrir o app direto num navegador (fora do APK), onde
//      não existe window.Capacitor.

(function () {
  'use strict';

  // Evita manter vários megapixels em memória ao voltar da câmera nativa.
  var LADO_MAXIMO = 900;
  // Mantém cada anexo pequeno o bastante para que uma sequência de fotos não
  // faça o Android recriar a WebView e apagar o formulário em andamento.
  var QUALIDADE_JPEG = 0.46;
  var MAX_FOTOS = 10;

  // true quando o plugin nativo @capacitor/camera está disponível neste
  // ambiente — ou seja, quando o app está rodando dentro do APK gerado
  // (ver GUIA-GERAR-APK-CAPACITOR.md) com o plugin instalado. Quando
  // false (navegador comum, ou APK antigo sem o plugin ainda), cai no
  // fallback de <input type="file"> em vez de quebrar.
  function pluginCameraDisponivel() {
    return !!(window.Capacitor && window.Capacitor.Plugins &&
      window.Capacitor.Plugins.Camera);
  }

  function lerFotoNativa(foto, callback) {
    if (!foto) { callback(null); return; }
    if (foto.webPath) {
      fetch(foto.webPath)
        .then(function (resposta) {
          if (!resposta.ok) throw new Error('Não foi possível ler a foto selecionada.');
          return resposta.blob();
        })
        .then(function (arquivo) { comprimirImagem(arquivo, callback); })
        .catch(function () { callback(null); });
      return;
    }
    if (foto.dataUrl) { comprimirImagemDataUrl(foto.dataUrl, callback); return; }
    callback(null);
  }

  // Processa uma imagem por vez para evitar picos de memória na WebView.
  function processarFotosNativas(fotos, limite, callback) {
    var lista = Array.isArray(fotos) ? fotos.slice(0, limite) : [];
    var resultados = [];
    var indice = 0;
    function proxima() {
      if (indice >= lista.length || resultados.length >= limite) {
        callback(resultados);
        return;
      }
      lerFotoNativa(lista[indice++], function (base64) {
        if (base64) resultados.push(base64);
        proxima();
      });
    }
    proxima();
  }

  // getPhoto devolve somente uma imagem. pickImages abre a seleção múltipla.
  function selecionarGaleriaNativa(vagas, callback) {
    var Camera = window.Capacitor.Plugins.Camera;
    if (typeof Camera.pickImages !== 'function') {
      capturarComCameraNativa('galeria', function (base64) {
        callback(base64 ? [base64] : []);
      });
      return;
    }
    Camera.pickImages({
      quality: 46,
      width: LADO_MAXIMO,
      height: LADO_MAXIMO,
      correctOrientation: true,
      limit: vagas
    }).then(function (resultado) {
      processarFotosNativas(resultado && resultado.photos, vagas, callback);
    }).catch(function () {
      callback([]);
    });
  }

  // Pede uma URI ao plugin em vez de transferir a foto inteira em base64 pela
  // ponte nativa. Isso reduz o pico de memória que reiniciava a WebView.
  function capturarComCameraNativa(fonte, callback) {
    var finalizado = false;
    function concluir(valor) {
      if (finalizado) return;
      finalizado = true;
      callback(valor || null);
    }
    var Camera = window.Capacitor.Plugins.Camera;
    Camera.getPhoto({
      quality: 46,
      width: LADO_MAXIMO,
      height: LADO_MAXIMO,
      allowEditing: false,
      correctOrientation: true,
      resultType: 'uri',
      // O seletor PROMPT do Android não respeita o idioma nem o visual do
      // aplicativo em todos os aparelhos. A escolha é feita no painel
      // próprio, em português, e aqui recebemos apenas CAMERA ou PHOTOS.
      source: fonte === 'camera' ? 'CAMERA' : 'PHOTOS',
      saveToGallery: false
    }).then(function (foto) {
      if (!foto) { concluir(null); return; }
      lerFotoNativa(foto, concluir);
    }).catch(function (erro) {
      // Usuário cancelou o menu (toque fora, botão voltar) — não é erro
      // de verdade, só não gera foto nenhuma.
      concluir(null);
    });
  }

  // Um estado por contexto ('os' | 'entrega'), cada um com seu próprio
  // array de fotos e referências de DOM — assim os dois formulários não
  // compartilham estado entre si.
  var contextos = {};
  var seletorFonte = null;
  var contextoFonteAtual = null;

  function garantirSeletorFonte() {
    if (seletorFonte) return seletorFonte;
    var fundo = document.createElement('div');
    fundo.id = 'seletor-fonte-foto';
    fundo.className = 'seletor-fonte-foto';
    fundo.hidden = true;
    fundo.innerHTML =
      '<div class="seletor-fonte-foto-fundo" data-fechar-fonte-foto></div>' +
      '<section class="seletor-fonte-foto-painel" role="dialog" aria-modal="true" aria-labelledby="titulo-fonte-foto">' +
        '<span class="seletor-fonte-foto-alca" aria-hidden="true"></span>' +
        '<div class="seletor-fonte-foto-cabecalho">' +
          '<div><strong id="titulo-fonte-foto">Adicionar foto</strong><small>Escolha de onde a imagem será obtida</small></div>' +
          '<button type="button" class="seletor-fonte-foto-fechar" data-fechar-fonte-foto aria-label="Fechar">×</button>' +
        '</div>' +
        '<div class="seletor-fonte-foto-opcoes">' +
          '<button type="button" class="seletor-fonte-foto-opcao" data-fonte-foto="camera">' +
            '<span class="seletor-fonte-foto-icone" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 7.5h3l1.4-2h7.2l1.4 2h3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/></svg></span>' +
            '<span><strong>Tirar foto</strong><small>Abrir a câmera do aparelho</small></span>' +
          '</button>' +
          '<button type="button" class="seletor-fonte-foto-opcao" data-fonte-foto="galeria">' +
            '<span class="seletor-fonte-foto-icone" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m4 17 4.8-4.8a2 2 0 0 1 2.8 0L14 14.6l1.2-1.2a2 2 0 0 1 2.8 0l3 3"/></svg></span>' +
            '<span><strong>Escolher da galeria</strong><small>Selecionar uma ou várias imagens</small></span>' +
          '</button>' +
        '</div>' +
      '</section>';
    document.body.appendChild(fundo);
    fundo.addEventListener('click', function (evento) {
      var fechar = evento.target.closest('[data-fechar-fonte-foto]');
      if (fechar) { fecharSeletorFonte(); return; }
      var opcao = evento.target.closest('[data-fonte-foto]');
      if (!opcao || !contextoFonteAtual) return;
      var nomeContexto = contextoFonteAtual;
      var fonte = opcao.getAttribute('data-fonte-foto');
      fecharSeletorFonte();
      iniciarEscolhaFonte(nomeContexto, fonte);
    });
    seletorFonte = fundo;
    return seletorFonte;
  }

  function abrirSeletorFonte(nomeContexto) {
    contextoFonteAtual = nomeContexto;
    var seletor = garantirSeletorFonte();
    seletor.hidden = false;
    document.documentElement.classList.add('modal-aberto');
    requestAnimationFrame(function () { seletor.classList.add('seletor-fonte-foto-visivel'); });
  }

  function fecharSeletorFonte() {
    if (!seletorFonte) return;
    seletorFonte.classList.remove('seletor-fonte-foto-visivel');
    document.documentElement.classList.remove('modal-aberto');
    setTimeout(function () {
      if (seletorFonte && !seletorFonte.classList.contains('seletor-fonte-foto-visivel')) seletorFonte.hidden = true;
    }, 180);
  }

  function abrirCameraNoNavegador(nomeContexto) {
    var ctxState = contextos[nomeContexto];
    var inputCamera = document.createElement('input');
    inputCamera.type = 'file';
    inputCamera.accept = 'image/*';
    inputCamera.setAttribute('capture', 'environment');
    inputCamera.hidden = true;
    document.body.appendChild(inputCamera);
    inputCamera.addEventListener('change', function () {
      if (inputCamera.files && inputCamera.files.length) processarArquivos(nomeContexto, inputCamera.files);
      inputCamera.remove();
    }, { once: true });
    inputCamera.click();
    setTimeout(function () {
      if (inputCamera.isConnected && (!inputCamera.files || !inputCamera.files.length)) inputCamera.remove();
      if (ctxState) renderizarGrade(nomeContexto);
    }, 30000);
  }

  function iniciarEscolhaFonte(nomeContexto, fonte) {
    var ctxState = contextos[nomeContexto];
    if (!ctxState || ctxState.fotos.length >= MAX_FOTOS || ctxState.capturando || ctxState.processando) return;
    if (pluginCameraDisponivel()) {
      ctxState.capturando = true;
      renderizarGrade(nomeContexto);
      if (fonte === 'galeria') {
        var vagas = MAX_FOTOS - ctxState.fotos.length;
        selecionarGaleriaNativa(vagas, function (imagens) {
          imagens.forEach(function (base64) {
            if (base64 && ctxState.fotos.length < MAX_FOTOS) {
              ctxState.fotos.push({ base64: base64 });
            }
          });
          ctxState.capturando = false;
          renderizarGrade(nomeContexto);
        });
        return;
      }
      capturarComCameraNativa(fonte, function (base64) {
        ctxState.capturando = false;
        if (base64 && ctxState.fotos.length < MAX_FOTOS) ctxState.fotos.push({ base64: base64 });
        renderizarGrade(nomeContexto);
      });
      return;
    }
    if (fonte === 'camera') abrirCameraNoNavegador(nomeContexto);
    else ctxState.input.click();
  }

  function notificarAlteracao(nomeContexto) {
    try {
      document.dispatchEvent(new CustomEvent('sistemaos:fotos-alteradas', {
        detail: { contexto: nomeContexto }
      }));
    } catch (_) { /* navegador antigo: não impede as fotos */ }
  }

  function registrarContexto(nomeContexto, ids) {
    contextos[nomeContexto] = {
      fotos: [], // [{ base64 }]
      capturando: false,
      processando: false,
      input: document.getElementById(ids.input),
      btnAdicionar: document.getElementById(ids.btnAdicionar),
      grade: document.getElementById(ids.grade),
      contador: document.getElementById(ids.contador)
    };

    var ctxState = contextos[nomeContexto];
    if (!ctxState.input || !ctxState.btnAdicionar || !ctxState.grade) return;

    ctxState.btnAdicionar.addEventListener('click', function () {
      if (ctxState.fotos.length >= MAX_FOTOS || ctxState.capturando || ctxState.processando) return;
      abrirSeletorFonte(nomeContexto);
    });

    ctxState.input.addEventListener('change', function () {
      var arquivos = ctxState.input.files;
      if (!arquivos || !arquivos.length) return;
      processarArquivos(nomeContexto, arquivos);
      // Limpa o input para permitir selecionar o mesmo arquivo de novo
      // (ex.: usuário remove uma foto e quer tirar outra igual em seguida).
      ctxState.input.value = '';
    });

    renderizarGrade(nomeContexto);
  }

  function processarArquivos(nomeContexto, arquivos) {
    var ctxState = contextos[nomeContexto];
    if (ctxState.processando) return;
    var vagas = MAX_FOTOS - ctxState.fotos.length;
    var lista = Array.prototype.slice.call(arquivos, 0, Math.max(0, vagas));
    if (!lista.length) return;
    ctxState.processando = true;
    renderizarGrade(nomeContexto);

    // Processa uma por vez para não criar vários canvases/base64 em paralelo.
    var indice = 0;
    function proxima() {
      if (indice >= lista.length || ctxState.fotos.length >= MAX_FOTOS) {
        ctxState.processando = false;
        renderizarGrade(nomeContexto);
        return;
      }
      var arquivo = lista[indice++];
      comprimirImagem(arquivo, function (base64) {
        if (base64) ctxState.fotos.push({ base64: base64 });
        renderizarGrade(nomeContexto);
        proxima();
      });
    }
    proxima();
  }

  function comprimirImagem(arquivo, callback) {
    // Evita transformar a foto original inteira em Base64 antes de reduzi-la.
    // Em fotos de alta resolução essa cópia extra podia reiniciar a WebView.
    if (arquivo && typeof Blob !== 'undefined' && arquivo instanceof Blob &&
        window.URL && typeof window.URL.createObjectURL === 'function') {
      var urlTemporaria = window.URL.createObjectURL(arquivo);
      comprimirImagemOrigem(urlTemporaria, function () {
        try { window.URL.revokeObjectURL(urlTemporaria); } catch (_) { /* sem efeito */ }
      }, callback);
      return;
    }
    var leitor = new FileReader();
    leitor.onload = function () {
      comprimirImagemDataUrl(String(leitor.result || ''), callback);
    };
    leitor.onerror = function () { callback(null); };
    leitor.readAsDataURL(arquivo);
  }

  // Núcleo da compressão, compartilhado pelos dois caminhos de entrada
  // (<input type="file"> via FileReader, e @capacitor/camera via
  // resultType: 'dataUrl'): redimensiona (lado maior <= LADO_MAXIMO) e
  // recomprime em JPEG via canvas.
  function comprimirImagemDataUrl(dataUrl, callback) {
    comprimirImagemOrigem(dataUrl, null, callback);
  }

  function comprimirImagemOrigem(origem, liberarOrigem, callback) {
    var img = new Image();
    var finalizado = false;
    function concluir(resultado) {
      if (finalizado) return;
      finalizado = true;
      img.onload = null;
      img.onerror = null;
      img.src = '';
      if (typeof liberarOrigem === 'function') liberarOrigem();
      callback(resultado || null);
    }
    img.onload = function () {
      var canvas = null;
      try {
        var largura = img.naturalWidth || img.width;
        var altura = img.naturalHeight || img.height;
        if (!largura || !altura) { concluir(null); return; }
        if (largura > altura && largura > LADO_MAXIMO) {
          altura = Math.round((altura * LADO_MAXIMO) / largura);
          largura = LADO_MAXIMO;
        } else if (altura > LADO_MAXIMO) {
          largura = Math.round((largura * LADO_MAXIMO) / altura);
          altura = LADO_MAXIMO;
        }
        canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        var ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) { concluir(null); return; }
        ctx.drawImage(img, 0, 0, largura, altura);
        var resultado = canvas.toDataURL('image/jpeg', QUALIDADE_JPEG);
        canvas.width = 1;
        canvas.height = 1;
        concluir(resultado);
      } catch (_) {
        if (canvas) {
          canvas.width = 1;
          canvas.height = 1;
        }
        concluir(null);
      }
    };
    img.onerror = function () { concluir(null); };
    img.decoding = 'async';
    img.src = origem;
  }

  function renderizarGrade(nomeContexto) {
    var ctxState = contextos[nomeContexto];
    ctxState.grade.innerHTML = '';
    ctxState.fotos.forEach(function (foto, indice) {
      var item = document.createElement('div');
      item.className = 'foto-anexo-item';

      var img = document.createElement('img');
      img.src = foto.base64;
      img.alt = 'Foto anexada ' + (indice + 1);
      item.appendChild(img);

      var btnRemover = document.createElement('button');
      btnRemover.type = 'button';
      btnRemover.className = 'foto-anexo-remover';
      btnRemover.setAttribute('aria-label', 'Remover foto');
      btnRemover.textContent = '✕';
      btnRemover.addEventListener('click', function () {
        ctxState.fotos.splice(indice, 1);
        renderizarGrade(nomeContexto);
      });
      item.appendChild(btnRemover);

      ctxState.grade.appendChild(item);
    });

    if (ctxState.contador) {
      ctxState.contador.textContent = ctxState.fotos.length + '/' + MAX_FOTOS;
    }
    if (ctxState.btnAdicionar) {
      ctxState.btnAdicionar.disabled = ctxState.fotos.length >= MAX_FOTOS || ctxState.capturando || ctxState.processando;
    }
    notificarAlteracao(nomeContexto);
  }

  function obterFotos(nomeContexto) {
    var ctxState = contextos[nomeContexto];
    return ctxState ? ctxState.fotos.slice() : [];
  }

  // Substitui o array de fotos do contexto (usado ao reabrir um item do
  // histórico, para repopular a grade a partir de dados já salvos).
  function definirFotos(nomeContexto, fotos) {
    var ctxState = contextos[nomeContexto];
    if (!ctxState) return;
    ctxState.fotos = Array.isArray(fotos) ? fotos.slice(0, MAX_FOTOS) : [];
    renderizarGrade(nomeContexto);
  }

  function limparFotos(nomeContexto) {
    definirFotos(nomeContexto, []);
  }

  window.SistemaOSFotos = {
    registrarContexto: registrarContexto,
    obterFotos: obterFotos,
    definirFotos: definirFotos,
    limparFotos: limparFotos,
    MAX_FOTOS: MAX_FOTOS
  };

  // Registro automático dos contextos existentes no app — roda no
  // carregamento do script, que fica no fim do <body> (DOM já disponível).
  registrarContexto('os', {
    input: 'input-foto-os',
    btnAdicionar: 'btn-add-foto-os',
    grade: 'grade-foto-os',
    contador: 'contador-foto-os'
  });
  registrarContexto('entrega', {
    input: 'input-foto-entrega',
    btnAdicionar: 'btn-add-foto-entrega',
    grade: 'grade-foto-entrega',
    contador: 'contador-foto-entrega'
  });
  registrarContexto('compra', {
    input: 'input-foto-compra',
    btnAdicionar: 'btn-add-foto-compra',
    grade: 'grade-foto-compra',
    contador: 'contador-foto-compra'
  });
})();
