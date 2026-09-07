// Formatações puras compartilhadas pelo renderer.
(function iniciarFormatadoresRenderer() {
  'use strict';

  function data(iso) {
    try {
      const texto = String(iso == null ? '' : iso).trim();
      // `new Date('2026-09-15')` é UTC e, no Brasil, aparece como 14/09.
      // Datas civis (vencimento/previsão) são formatadas sem conversão de fuso.
      if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
        const [ano, mes, dia] = texto.split('-');
        return `${dia}/${mes}/${ano}`;
      }
      return new Date(texto).toLocaleDateString('pt-BR');
    } catch {
      return '';
    }
  }

  function dataHora(iso) {
    try {
      const dataLocal = new Date(iso);
      return dataLocal.toLocaleDateString('pt-BR') + ' ' + dataLocal.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function moeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  window.RendererFormatters = Object.freeze({ data, dataHora, moeda });
})();
