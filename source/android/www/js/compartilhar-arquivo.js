// js/compartilhar-arquivo.js
//
// Ponto único que decide COMO tirar um .json de dentro do app e entregar
// pro usuário — seja pelo menu nativo de compartilhar do Android
// (WhatsApp, Mensagens, E-mail, Drive etc.) ou por download direto.
//
// Substitui as 2 cópias que existiam antes (compartilharOuBaixarLote em
// app.js, compartilharOuBaixarResposta em documentos-recebidos.js) —
// ambas tinham a MESMA lógica de decisão, só o nome do arquivo e o texto
// do título mudavam. Este módulo recebe esses dois como parâmetro e
// centraliza o resto.
//
// PROBLEMA QUE ISTO RESOLVE: antes, o app usava só navigator.share (Web
// Share API do navegador). Dentro do WebView que o Capacitor usa para
// empacotar o APK, essa API para compartilhar ARQUIVO (não link/texto)
// costuma não funcionar de verdade sem um plugin nativo — o resultado
// observado era o app sempre cair no fallback de "baixar o arquivo" e
// nunca abrir o menu de compartilhar de verdade. A correção usa
// @capacitor/share + @capacitor/filesystem (exige os 2 instalados — ver
// GUIA-GERAR-APK-CAPACITOR.md, Passo 4 — e um novo APK gerado), que
// conversam de verdade com o Intent nativo do Android.
//
// ORDEM DE TENTATIVA, do melhor caso ao pior:
//   1. @capacitor/share + @capacitor/filesystem — menu nativo de verdade.
//      Só tentado se os 2 plugins estiverem presentes neste ambiente.
//   2. navigator.share do navegador (Web Share API) — mantido como
//      fallback para quem abrir o app direto num navegador (fora do
//      APK) que tenha suporte nativo a compartilhar arquivo.
//   3. Download puro (<a download>) — último recurso, sempre funciona.

(function () {
  'use strict';

  function baixarArquivo(blob, nomeArquivo) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function nomeArquivoSeguro(nomeArquivo, extensaoPadrao) {
    var nome = String(nomeArquivo || ('documento.' + (extensaoPadrao || 'bin')))
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return nome || ('documento.' + (extensaoPadrao || 'bin'));
  }

  // Converte um Blob de texto (o .json) para uma string base64 pura, sem
  // o prefixo "data:...;base64," — é o formato que Filesystem.writeFile
  // espera quando nenhum `encoding` é passado (grava como binário
  // decodificado a partir de base64). Ver:
  // https://capacitorjs.com/docs/apis/filesystem
  function blobParaBase64(blob) {
    return new Promise(function (resolve, reject) {
      var leitor = new FileReader();
      leitor.onloadend = function () {
        var resultado = String(leitor.result || '');
        var virgula = resultado.indexOf(',');
        resolve(virgula >= 0 ? resultado.slice(virgula + 1) : resultado);
      };
      leitor.onerror = reject;
      leitor.readAsDataURL(blob);
    });
  }

  // Grava o .json em Directory.Cache (a ÚNICA pasta de onde o Android
  // permite compartilhar arquivo por padrão, sem precisar configurar
  // file_paths.xml nativo — ver README do @capacitor/share) e devolve o
  // file:// URI para passar ao plugin de Share.
  function gravarArquivoTemporario(blob, nomeArquivo) {
    return blobParaBase64(blob).then(function (base64) {
      return window.Capacitor.Plugins.Filesystem.writeFile({
        path: nomeArquivo,
        data: base64,
        directory: 'CACHE'
      });
    }).then(function () {
      return window.Capacitor.Plugins.Filesystem.getUri({
        path: nomeArquivo,
        directory: 'CACHE'
      });
    }).then(function (resultado) {
      return resultado.uri;
    });
  }

  // true quando os plugins nativos do Capacitor (Filesystem + Share)
  // estão disponíveis neste ambiente — ou seja, quando o app está
  // rodando dentro do APK gerado (ver GUIA-GERAR-APK-CAPACITOR.md).
  // Quando false (ex: alguém abrindo index.html direto num navegador de
  // desktop para testar), cai nos fallbacks abaixo em vez de quebrar.
  function pluginsNativosDisponiveis() {
    return !!(window.Capacitor && window.Capacitor.Plugins &&
      window.Capacitor.Plugins.Filesystem && window.Capacitor.Plugins.Share);
  }

  // compartilharOuBaixarArquivo(dadosObj, nomeArquivo, titulo, textoCompartilhar)
  //   dadosObj            — objeto a serializar como JSON (lote ou resposta)
  //   nomeArquivo         — nome do arquivo .json final
  //   titulo              — título mostrado no menu de compartilhar
  //   textoCompartilhar   — texto de acompanhamento (campo `text` do Share)
  //
  // Retorna uma Promise que resolve com { metodo }, sempre — nunca com
  // "nem baixado nem compartilhado" silenciosamente. `metodo` é um destes:
  //   'compartilhado'                  — usuário escolheu um app no menu
  //   'cancelado'                      — usuário fechou o menu sem escolher
  //                                      (só distinguível via navigator.share;
  //                                      ver comentário abaixo sobre o plugin nativo)
  //   'baixado'                        — nenhum compartilhamento disponível
  //   'baixado-apos-erro-compartilhar' — tentou compartilhar, falhou/cancelou,
  //                                      caiu pro download como garantia
  function compartilharBlob(blob, nomeArquivo, titulo, textoCompartilhar) {
    var nomeSeguro = nomeArquivoSeguro(nomeArquivo, 'bin');

    if (pluginsNativosDisponiveis()) {
      return gravarArquivoTemporario(blob, nomeSeguro)
        .then(function (uri) {
          return window.Capacitor.Plugins.Share.share({
            title: titulo,
            text: textoCompartilhar,
            files: [uri],
            dialogTitle: titulo
          });
        })
        .then(function () {
          return { metodo: 'compartilhado' };
        })
        .catch(function () {
          // Cancelamento do menu de compartilhar não é erro de verdade —
          // o Share plugin do Capacitor rejeita a Promise tanto em
          // cancelamento quanto em falha real; não há um jeito confiável
          // de distinguir os dois casos entre plataformas, então tratamos
          // ambos da mesma forma: cai para o download, garantindo que o
          // arquivo sempre chega às mãos do usuário de um jeito ou de
          // outro.
          baixarArquivo(blob, nomeSeguro);
          return { metodo: 'baixado-apos-erro-compartilhar' };
        });
    }

    // Sem os plugins nativos (rodando fora do APK) — mantém o
    // comportamento anterior via Web Share API, com fallback para
    // download puro.
    var arquivo;
    try {
      arquivo = new File([blob], nomeSeguro, { type: blob.type || 'application/octet-stream' });
    } catch (e) {
      arquivo = null; // navegador muito antigo sem suporte a File — cai pro download
    }

    return new Promise(function (resolve) {
      if (arquivo && navigator.canShare && navigator.canShare({ files: [arquivo] })) {
        navigator.share({
          files: [arquivo],
          title: titulo,
          text: textoCompartilhar
        }).then(function () {
          resolve({ metodo: 'compartilhado' });
        }).catch(function (err) {
          if (err && err.name === 'AbortError') {
            resolve({ metodo: 'cancelado' }); // usuário cancelou — não sincroniza
            return;
          }
          baixarArquivo(blob, nomeSeguro);
          resolve({ metodo: 'baixado-apos-erro-compartilhar' });
        });
        return;
      }
      baixarArquivo(blob, nomeSeguro);
      resolve({ metodo: 'baixado' });
    });
  }

  function compartilharOuBaixarArquivo(dadosObj, nomeArquivo, titulo, textoCompartilhar) {
    var blob = new Blob([JSON.stringify(dadosObj, null, 2)], { type: 'application/json' });
    return compartilharBlob(blob, nomeArquivo, titulo, textoCompartilhar);
  }

  function compartilharPdfPorUrl(url, nomeArquivo, titulo, textoCompartilhar) {
    return fetch(String(url || '')).then(function (resposta) {
      if (!resposta.ok) throw new Error('O PDF não pôde ser baixado agora.');
      return resposta.blob();
    }).then(function (blob) {
      var pdf = blob.type === 'application/pdf'
        ? blob
        : new Blob([blob], { type: 'application/pdf' });
      return compartilharBlob(pdf, nomeArquivoSeguro(nomeArquivo, 'pdf'), titulo, textoCompartilhar);
    });
  }

  function compartilharPdfHtml(html, nomeArquivo, titulo, textoCompartilhar) {
    var impressao = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Impressao;
    if (!impressao || typeof impressao.compartilharPdf !== 'function') {
      return Promise.reject(new Error('Atualize o aplicativo para compartilhar o PDF diretamente.'));
    }
    return impressao.compartilharPdf({
      html: String(html || ''),
      nomeArquivo: nomeArquivoSeguro(nomeArquivo, 'pdf'),
      titulo: String(titulo || 'Compartilhar documento'),
      mensagem: String(textoCompartilhar || '')
    }).then(function () { return { metodo: 'compartilhado' }; });
  }

  window.SistemaOSCompartilhar = {
    compartilharOuBaixarArquivo: compartilharOuBaixarArquivo,
    compartilharBlob: compartilharBlob,
    compartilharPdfPorUrl: compartilharPdfPorUrl,
    compartilharPdfHtml: compartilharPdfHtml
  };
})();
