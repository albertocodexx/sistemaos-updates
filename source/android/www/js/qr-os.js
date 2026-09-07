// Leitor de etiquetas QR das Ordens de Serviço.
//
// O QR guarda somente um link interno (sistemaos://os/NUMERO). Os dados do
// cliente não ficam expostos no código: depois da leitura, o app consulta a
// OS no Supabase da empresa autenticada, mesmo que o PC esteja desligado.
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSQRCode = api;
  if (root.document) api.inicializar();
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var PROTOCOLO = 'sistemaos:';
  var HOST_OS = 'os';
  var CHAVE_PENDENTE = 'sistema-os-qr-pendente-v1';
  var TAMANHO_MAXIMO_NUMERO = 80;
  var iniciou = false;
  var lendo = false;
  var flashAtivo = false;
  var listenerLeitura = null;

  function normalizarNumeroOS(valor) {
    var numero = String(valor == null ? '' : valor).trim();
    if (!numero || numero.length > TAMANHO_MAXIMO_NUMERO) return '';
    if (/[/\\?#\u0000-\u001f]/.test(numero)) return '';
    return numero;
  }

  function criarLinkOS(numero) {
    var normalizado = normalizarNumeroOS(numero);
    if (!normalizado) throw new Error('Número de OS inválido.');
    return PROTOCOLO + '//' + HOST_OS + '/' + encodeURIComponent(normalizado);
  }

  function extrairNumeroLinkOS(valor) {
    try {
      var url = new URL(String(valor || '').trim());
      if (url.protocol !== PROTOCOLO || url.hostname.toLowerCase() !== HOST_OS) return '';
      var caminho = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      return normalizarNumeroOS(caminho || url.searchParams.get('numero'));
    } catch (_) {
      return '';
    }
  }

  // O leitor interno também reconhece etiquetas antigas que tinham somente
  // "1", "0001" ou "OS-0001". Links externos e textos livres são recusados.
  function extrairNumeroConteudo(valor, aceitarNumeroSimples) {
    var conteudo = String(valor == null ? '' : valor).trim();
    var link = extrairNumeroLinkOS(conteudo);
    if (link) return link;
    if (!aceitarNumeroSimples) return '';
    if (!/^(?:OS[\s-]?)?\d{1,20}$/i.test(conteudo)) return '';
    return normalizarNumeroOS(conteudo);
  }

  function toast(mensagem, erro) {
    if (root.SistemaOSToast && typeof root.SistemaOSToast.mostrar === 'function') {
      root.SistemaOSToast.mostrar(mensagem, { ehErro: !!erro, duracaoMs: erro ? 5600 : 3900 });
    }
  }

  function estadoAutenticado() {
    var estado = root.SistemaOSSessao && root.SistemaOSSessao.obterEstado
      ? root.SistemaOSSessao.obterEstado() : null;
    return !!estado && (estado.tipo === 'autenticado' || estado.tipo === 'offline_com_sessao');
  }

  function salvarPendente(numero) {
    var normalizado = normalizarNumeroOS(numero);
    if (!normalizado || !root.localStorage) return '';
    root.localStorage.setItem(CHAVE_PENDENTE, normalizado);
    return normalizado;
  }

  function lerPendente() {
    try { return normalizarNumeroOS(root.localStorage && root.localStorage.getItem(CHAVE_PENDENTE)); }
    catch (_) { return ''; }
  }

  function removerPendente() {
    try { if (root.localStorage) root.localStorage.removeItem(CHAVE_PENDENTE); } catch (_) {}
  }

  async function abrirPendente() {
    var numero = lerPendente();
    if (!numero) return false;
    if (!estadoAutenticado()) {
      toast('Entre na sua conta. Depois o aplicativo abrirá a OS ' + numero + ' automaticamente.', true);
      return false;
    }
    if (!root.SistemaOSConsulta || typeof root.SistemaOSConsulta.abrirOS !== 'function') return false;
    removerPendente();
    try {
      await root.SistemaOSConsulta.abrirOS(numero, { origem: 'qr' });
      toast('Etiqueta lida. Abrindo a OS ' + numero + '.');
      return true;
    } catch (erro) {
      salvarPendente(numero);
      toast(erro && erro.message ? erro.message : 'Não foi possível abrir esta OS agora.', true);
      return false;
    }
  }

  async function processarConteudoQR(valor, aceitarNumeroSimples) {
    var numero = extrairNumeroConteudo(valor, aceitarNumeroSimples !== false);
    if (!numero) throw new Error('Este QR Code não pertence ao Sistema OS.');
    salvarPendente(numero);
    await cancelarLeitura();
    return abrirPendente();
  }

  function processarLink(valor) {
    var numero = extrairNumeroLinkOS(valor);
    if (!numero) return false;
    salvarPendente(numero);
    abrirPendente();
    return true;
  }

  function pluginScanner() {
    return root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.BarcodeScanner;
  }

  function elementos() {
    if (!root.document) return {};
    return {
      btnIniciar: root.document.getElementById('btn-iniciar-leitor-qr'),
      statusPainel: root.document.getElementById('qr-leitor-status'),
      overlay: root.document.getElementById('leitor-qr-camera'),
      statusCamera: root.document.getElementById('leitor-qr-camera-status'),
      btnCancelar: root.document.getElementById('btn-cancelar-leitor-qr'),
      btnFlash: root.document.getElementById('btn-flash-leitor-qr')
    };
  }

  function informarPainel(mensagem, erro) {
    var el = elementos().statusPainel;
    if (!el) return;
    el.hidden = false;
    el.textContent = mensagem;
    el.classList.toggle('erro', !!erro);
  }

  function informarCamera(mensagem, erro) {
    var el = elementos().statusCamera;
    if (!el) return;
    el.textContent = mensagem;
    el.classList.toggle('erro', !!erro);
  }

  async function removerListener() {
    var atual = listenerLeitura;
    listenerLeitura = null;
    if (atual && typeof atual.remove === 'function') {
      try { await atual.remove(); } catch (_) {}
    }
  }

  async function cancelarLeitura() {
    if (!lendo && !listenerLeitura) return false;
    var plugin = pluginScanner();
    lendo = false;
    try {
      if (flashAtivo && plugin && typeof plugin.disableTorch === 'function') await plugin.disableTorch();
    } catch (_) {}
    flashAtivo = false;
    try { if (plugin && typeof plugin.stopScan === 'function') await plugin.stopScan(); } catch (_) {}
    await removerListener();
    var els = elementos();
    if (els.overlay) els.overlay.hidden = true;
    if (els.btnFlash) {
      els.btnFlash.disabled = true;
      els.btnFlash.textContent = 'Ativar flash';
    }
    if (root.document && root.document.body) root.document.body.classList.remove('qr-camera-ativa');
    return true;
  }

  async function prepararPermissao(plugin) {
    if (!plugin) return false;
    var permissao = typeof plugin.checkPermissions === 'function'
      ? await plugin.checkPermissions() : { camera: 'prompt' };
    if (!permissao || permissao.camera !== 'granted') {
      permissao = typeof plugin.requestPermissions === 'function'
        ? await plugin.requestPermissions() : permissao;
    }
    return !!permissao && permissao.camera === 'granted';
  }

  async function configurarFlash(plugin) {
    var els = elementos();
    if (!els.btnFlash) return;
    var disponivel = false;
    try {
      var resposta = typeof plugin.isTorchAvailable === 'function'
        ? await plugin.isTorchAvailable() : { available: false };
      disponivel = !!(resposta && (resposta.available === true || resposta.isAvailable === true));
    } catch (_) {}
    els.btnFlash.disabled = !disponivel;
    els.btnFlash.textContent = disponivel ? 'Ativar flash' : 'Flash indisponível';
  }

  async function iniciarLeitura() {
    if (lendo) return true;
    var plugin = pluginScanner();
    if (!plugin) {
      informarPainel('Não foi possível abrir o leitor. Atualize o aplicativo e tente novamente.', true);
      toast('Atualize o Sistema OS para usar o leitor.', true);
      return false;
    }
    try {
      var autorizado = await prepararPermissao(plugin);
      if (!autorizado) throw new Error('Permita o acesso à câmera para ler a etiqueta.');

      // Fallback para implementações que oferecem apenas a tela pronta.
      if (typeof plugin.startScan !== 'function') {
        if (typeof plugin.scan !== 'function') throw new Error('Não foi possível abrir o leitor.');
        var resultadoPronto = await plugin.scan({ formats: ['QR_CODE'] });
        var primeiroPronto = resultadoPronto && resultadoPronto.barcodes && resultadoPronto.barcodes[0];
        if (primeiroPronto) await processarConteudoQR(primeiroPronto.rawValue || primeiroPronto.displayValue, true);
        return !!primeiroPronto;
      }

      lendo = true;
      var els = elementos();
      if (els.overlay) els.overlay.hidden = false;
      if (root.document && root.document.body) root.document.body.classList.add('qr-camera-ativa');
      informarCamera('Câmera pronta. Centralize o QR Code.');

      if (typeof plugin.addListener !== 'function') throw new Error('O leitor não conseguiu iniciar a câmera.');
      listenerLeitura = await plugin.addListener('barcodesScanned', function (evento) {
        if (!lendo) return;
        var codigo = evento && evento.barcodes && evento.barcodes[0];
        if (!codigo) return;
        var conteudo = codigo.rawValue || codigo.displayValue || '';
        var numero = extrairNumeroConteudo(conteudo, true);
        if (!numero) {
          informarCamera('QR não reconhecido. Procure uma etiqueta do Sistema OS.', true);
          return;
        }
        informarCamera('Etiqueta encontrada. Abrindo a OS ' + numero + '…');
        processarConteudoQR(conteudo, true).catch(function (erro) {
          informarPainel(erro.message || String(erro), true);
          toast(erro.message || String(erro), true);
        });
      });
      await configurarFlash(plugin);
      await plugin.startScan({ formats: ['QR_CODE'], lensFacing: 'BACK' });
      return true;
    } catch (erro) {
      await cancelarLeitura();
      var mensagem = erro && erro.message ? erro.message : 'Não foi possível abrir a câmera.';
      informarPainel(mensagem, true);
      toast(mensagem, true);
      return false;
    }
  }

  async function alternarFlash() {
    if (!lendo) return false;
    var plugin = pluginScanner();
    if (!plugin) return false;
    try {
      if (flashAtivo) {
        await plugin.disableTorch();
        flashAtivo = false;
      } else {
        await plugin.enableTorch();
        flashAtivo = true;
      }
      var botao = elementos().btnFlash;
      if (botao) botao.textContent = flashAtivo ? 'Desativar flash' : 'Ativar flash';
      return flashAtivo;
    } catch (_) {
      toast('O flash não está disponível nesta câmera.', true);
      return false;
    }
  }

  function registrarDeepLinks() {
    var app = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.App;
    if (!app) return;
    if (typeof app.addListener === 'function') {
      app.addListener('appUrlOpen', function (dados) {
        if (dados && dados.url) processarLink(dados.url);
      });
    }
    if (typeof app.getLaunchUrl === 'function') {
      app.getLaunchUrl().then(function (dados) {
        if (dados && dados.url) processarLink(dados.url);
      }).catch(function () {});
    }
  }

  function inicializar() {
    if (iniciou || !root.document) return;
    iniciou = true;
    var els = elementos();
    if (els.btnIniciar) els.btnIniciar.addEventListener('click', iniciarLeitura);
    if (els.btnCancelar) els.btnCancelar.addEventListener('click', cancelarLeitura);
    if (els.btnFlash) els.btnFlash.addEventListener('click', alternarFlash);
    root.document.addEventListener('sistema-os:sessao-alterada', abrirPendente);
    root.document.addEventListener('sistema-os:consulta-pronta', abrirPendente);
    registrarDeepLinks();
    setTimeout(abrirPendente, 0);
  }

  return Object.freeze({
    inicializar: inicializar,
    iniciarLeitura: iniciarLeitura,
    cancelarLeitura: cancelarLeitura,
    alternarFlash: alternarFlash,
    leituraAtiva: function () { return lendo; },
    processarLink: processarLink,
    processarConteudoQR: processarConteudoQR,
    abrirPendente: abrirPendente,
    normalizarNumeroOS: normalizarNumeroOS,
    criarLinkOS: criarLinkOS,
    extrairNumeroLinkOS: extrairNumeroLinkOS,
    extrairNumeroConteudo: extrairNumeroConteudo,
    CHAVE_PENDENTE: CHAVE_PENDENTE
  });
});
