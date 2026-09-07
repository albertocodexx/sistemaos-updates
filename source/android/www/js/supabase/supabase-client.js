/**
 * Cliente único do Supabase no APK.
 * Aceita somente URL HTTPS (HTTP apenas em localhost) e chave pública.
 * Nunca aceite service_role/secret no aplicativo distribuído.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SupabaseClientApp = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var cliente = null;
  var assinaturaCliente = '';

  function texto(valor) {
    return String(valor == null ? '' : valor).trim();
  }

  function decodificarBase64Url(valor) {
    var normalizado = valor.replace(/-/g, '+').replace(/_/g, '/');
    while (normalizado.length % 4) normalizado += '=';
    var bruto;
    if (typeof root.atob === 'function') bruto = root.atob(normalizado);
    else if (typeof Buffer !== 'undefined') bruto = Buffer.from(normalizado, 'base64').toString('binary');
    else throw new Error('Decodificador Base64 indisponível.');
    try {
      return decodeURIComponent(Array.prototype.map.call(bruto, function (caractere) {
        return '%' + ('00' + caractere.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    } catch (_) {
      return bruto;
    }
  }

  function papelDaChaveJwt(chave) {
    var partes = chave.split('.');
    if (partes.length !== 3) return '';
    try {
      var payload = JSON.parse(decodificarBase64Url(partes[1]));
      return texto(payload.role).toLowerCase();
    } catch (_) {
      return 'jwt_invalido';
    }
  }

  function normalizarUrl(valor) {
    var url;
    try {
      url = new URL(texto(valor));
    } catch (_) {
      return { ok: false, mensagem: 'A URL do Supabase é inválida.' };
    }
    var hostLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    if (url.protocol !== 'https:' && !(hostLocal && url.protocol === 'http:')) {
      return { ok: false, mensagem: 'A URL do Supabase precisa usar HTTPS.' };
    }
    if (url.username || url.password || url.search || url.hash) {
      return { ok: false, mensagem: 'Use somente a URL base do projeto Supabase.' };
    }
    return { ok: true, url: url.origin.replace(/\/$/, '') };
  }

  function validarConfiguracao(entrada) {
    var cfg = entrada || {};
    var ativo = cfg.supabaseAtivo === true || cfg.ativo === true;
    if (!ativo) return { ok: true, ativo: false };

    var urlValidada = normalizarUrl(cfg.supabaseUrl || cfg.url);
    if (!urlValidada.ok) return urlValidada;

    var chave = texto(cfg.supabasePublishableKey || cfg.publishableKey || cfg.chave);
    if (!chave || chave.length < 20) {
      return { ok: false, mensagem: 'Informe a chave pública publishable/anon do Supabase.' };
    }
    var chaveMinuscula = chave.toLowerCase();
    var papelJwt = papelDaChaveJwt(chave);
    if (chaveMinuscula.indexOf('sb_secret_') === 0 ||
        chaveMinuscula.indexOf('service_role') !== -1 ||
        papelJwt === 'service_role') {
      return { ok: false, mensagem: 'Chave secreta/service_role não pode ser usada no APK.' };
    }
    if (papelJwt === 'jwt_invalido') {
      return { ok: false, mensagem: 'A chave pública JWT do Supabase é inválida.' };
    }
    if (chave.indexOf('.') !== -1 && papelJwt && papelJwt !== 'anon') {
      return { ok: false, mensagem: 'Use a chave anon pública, nunca uma chave privilegiada.' };
    }

    return {
      ok: true,
      ativo: true,
      url: urlValidada.url,
      publishableKey: chave,
      redirectUrl: texto(cfg.supabaseRedirectUrl || cfg.redirectUrl) ||
        'com.assistencia.sistemaos://auth/callback'
    };
  }

  function carregarConfiguracao() {
    // A infraestrutura pertence à distribuição do Sistema OS. Nunca use a
    // configuração local para decidir URL/chave: isso elimina a tela técnica
    // e impede que uma instalação seja apontada para outro projeto.
    var publica = root.SistemaOSPublicConfig || {};
    return validarConfiguracao({
      supabaseAtivo: publica.supabaseObrigatorio !== false,
      supabaseUrl: publica.supabaseUrl,
      supabasePublishableKey: publica.supabasePublishableKey,
      supabaseRedirectUrl: publica.supabaseRedirectUrl
    });

    if (!root.ConfigApp || typeof root.ConfigApp.carregarConfig !== 'function') {
      return { ok: false, mensagem: 'Configuração local do aplicativo indisponível.' };
    }
    return validarConfiguracao(root.ConfigApp.carregarConfig());
  }

  function assinatura(configuracao) {
    var cfg = configuracao && configuracao.ok !== undefined
      ? configuracao
      : validarConfiguracao(configuracao || {});
    return cfg.ok && cfg.ativo ? cfg.url + '|' + cfg.publishableKey : '';
  }

  function sdk() {
    return root.supabase && typeof root.supabase.createClient === 'function' ? root.supabase : null;
  }

  function opcoes(configuracao, persistir) {
    var referencia = 'local';
    try { referencia = new URL(configuracao.url).hostname.split('.')[0] || 'local'; } catch (_) {}
    return {
      db: { schema: 'public' },
      auth: {
        autoRefreshToken: persistir,
        persistSession: persistir,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storage: persistir ? root.localStorage : undefined,
        storageKey: 'sistema-os-auth-' + referencia
      },
      global: { headers: { 'X-Client-Info': 'sistema-os-android-etapa3' } }
    };
  }

  function criar(configuracao, persistir) {
    var validada = configuracao && configuracao.ok !== undefined
      ? configuracao
      : validarConfiguracao(configuracao || {});
    if (!validada.ok || !validada.ativo) {
      throw new Error(validada.mensagem || 'Supabase não está ativo.');
    }
    var biblioteca = sdk();
    if (!biblioteca) throw new Error('Biblioteca do Supabase não foi carregada.');
    return biblioteca.createClient(
      validada.url,
      validada.publishableKey,
      opcoes(validada, persistir)
    );
  }

  function obterCliente() {
    var config = carregarConfiguracao();
    if (!config.ok || !config.ativo) throw new Error(config.mensagem || 'Supabase não está ativo.');
    var atual = assinatura(config);
    if (!cliente || assinaturaCliente !== atual) {
      cliente = criar(config, true);
      assinaturaCliente = atual;
    }
    return cliente;
  }

  function criarClienteTemporario(configuracao) {
    var entrada = Object.assign({}, configuracao || {}, { ativo: true, supabaseAtivo: true });
    return criar(validarConfiguracao(entrada), false);
  }

  function limparCliente() {
    cliente = null;
    assinaturaCliente = '';
  }

  return {
    validarConfiguracao: validarConfiguracao,
    carregarConfiguracao: carregarConfiguracao,
    obterCliente: obterCliente,
    criarClienteTemporario: criarClienteTemporario,
    assinaturaConfiguracao: assinatura,
    limparCliente: limparCliente,
    _papelDaChaveJwt: papelDaChaveJwt
  };
});
