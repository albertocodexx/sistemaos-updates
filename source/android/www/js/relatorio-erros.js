/** Envia falhas técnicas anonimizadas para a central de suporte. */
(function (root) {
  'use strict';
  var enviados = {};

  function limparSegredos(valor) {
    return String(valor || '')
      .replace(/(gsk_|APP_USR-|Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[protegido]')
      .slice(0, 12000);
  }

  async function registrar(dados) {
    try {
      var estado = root.SistemaOSSessao && root.SistemaOSSessao.obterEstado
        ? root.SistemaOSSessao.obterEstado() : {};
      var contexto = estado.contexto || {};
      var usuario = estado.usuario || {};
      if (!contexto.empresa_id || contexto.administrador_global === true || !usuario.id) return false;
      var mensagem = limparSegredos(dados && dados.mensagem).slice(0, 4000);
      if (!mensagem || /failed to fetch|networkerror|internet/i.test(mensagem)) return false;
      var chave = mensagem.slice(0, 300);
      if (Date.now() - Number(enviados[chave] || 0) < 60000) return false;
      enviados[chave] = Date.now();
      var cliente = root.SupabaseClientApp.obterCliente();
      var resposta = await cliente.from('relatorios_erros').insert({
        empresa_id: contexto.empresa_id,
        usuario_id: usuario.id,
        origem: 'android',
        tela: String(dados.tela || document.querySelector('.aba-conteudo:not([hidden])')?.id || 'android').slice(0, 160),
        funcao: String(dados.funcao || '').slice(0, 160) || null,
        mensagem: mensagem,
        stack_trace: limparSegredos(dados.stack) || null,
        versao: '1.0.34',
        dispositivo: String(navigator.userAgent || 'Android').slice(0, 500),
        detalhes: {},
        prioridade: dados.prioridade || 'alta'
      });
      return !resposta.error;
    } catch (_) { return false; }
  }

  root.addEventListener('error', function (evento) {
    registrar({ mensagem: evento.message, stack: evento.error && evento.error.stack, funcao: evento.filename });
  });
  root.addEventListener('unhandledrejection', function (evento) {
    var motivo = evento.reason || {};
    registrar({ mensagem: motivo.message || motivo, stack: motivo.stack, funcao: 'promise' });
  });
  root.SistemaOSRelatorioErros = Object.freeze({ registrar: registrar });
})(window);
