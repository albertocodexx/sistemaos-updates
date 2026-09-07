// Ícones SVG reutilizados por telas e modais do renderer.
(function iniciarIconesRenderer() {
  'use strict';

  const svg = (conteudo, extra = '') => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;flex:none;${extra}">${conteudo}</svg>`;
  const bolinha = cor => `<svg viewBox="0 0 24 24" width="10" height="10" style="vertical-align:-1px;flex:none;"><circle cx="12" cy="12" r="9" fill="${cor}"/></svg>`;

  window.RendererIcons = Object.freeze({
    CHECK: svg('<path d="M20 6 9 17l-5-5"/>'),
    X: svg('<path d="M18 6 6 18"/><path d="M6 6l12 12"/>'),
    ESTRELA: svg('<path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2z"/>'),
    LAPIS: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    DOCUMENTO: svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>'),
    LISTA: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3"/><path d="M8 11h8M8 15h8M8 19h4"/>'),
    PASTA: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
    CELULAR: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
    CELULAR_OFF: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/><path d="M4 4l16 16"/>'),
    LIXEIRA: svg('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'),
    SYNC: svg('<path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.36-2.64L3 16"/><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.36 2.64L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>'),
    ESCUDO: svg('<path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5Z"/>'),
    OLHO: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
    FERRAMENTA: svg('<path d="M14.7 6.3a4 4 0 1 1-5.4 5.4l-6 6a1.5 1.5 0 0 0 2 2l6-6a4 4 0 1 1 5.4-5.4z"/>'),
    BUSCAR: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    CAIXA: svg('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>'),
    CARRINHO: svg('<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>'),
    CIFRAO: svg('<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
    CARTAO: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
    ETIQUETA: svg('<path d="M20.6 12.6 12 21.2 2.8 12A2 2 0 0 1 2 10.6V4a2 2 0 0 1 2-2h6.6a2 2 0 0 1 1.4.6l8.6 8.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
    EXPORTAR: svg('<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>'),
    IMPORTAR: svg('<path d="M12 21V9"/><path d="m17 16-5 5-5-5"/><path d="M5 3h14"/>'),
    PLUGUE: svg('<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v3a6 6 0 0 1-12 0V8Z"/>'),
    CANETA: svg('<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>'),
    BALAO: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    ENVELOPE: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>'),
    IMPRESSORA: svg('<path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7"/><path d="M6 18H3a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-3"/>'),
    BOLA_VERDE: bolinha('var(--sucesso,#16a34a)'),
    BOLA_AMARELA: bolinha('var(--aviso,#f59e0b)'),
    BOLA_VERMELHA: bolinha('var(--perigo,#dc2626)'),
    BOLA_CINZA: bolinha('var(--texto-sec,#9ca3af)'),
    SOL: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
    LUA: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>'),
    PESSOA: svg('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>'),
    CONFIG: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.32.4.58.72.72.24.1.5.15.76.18H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    SINO: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    RAIO: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
    PIN: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
    CLIPE: svg('<path d="M21.4 11.1 12.6 20a4.5 4.5 0 1 1-6.4-6.4l9-8.9a3 3 0 1 1 4.2 4.3l-9 8.9a1.5 1.5 0 1 1-2.1-2.2l8.3-8.2"/>'),
    CAMERA: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/>'),
    RELOGIO: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
    ACENO: svg('<path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M6.5 12.5c-.7-.7-1.8-.8-2.5 0-.8.8-.8 2 0 2.8L9 20.3c1.5 1.5 3.5 2.2 5.5 1.9l1.9-.3c2.2-.4 4-2 4.6-4.1L22 13.5V11a2 2 0 0 0-4 0v-1"/>'),
    ALERTA: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    INFO: svg('<circle cx="12" cy="12" r="10"/><path d="M12 11v5"/><path d="M12 7h.01"/>'),
    WHATSAPP: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px;flex:none;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.031 0C5.4 0 0 5.4 0 12.03c0 2.13.556 4.11 1.526 5.847L0 24l6.31-1.654a11.98 11.98 0 0 0 5.72 1.454h.005c6.63 0 12.03-5.4 12.03-12.03C24.065 5.14 18.665.005 12.03.005zM12.036 21.85h-.005a9.9 9.9 0 0 1-5.045-1.38l-.362-.215-3.744.982.998-3.65-.236-.375a9.86 9.86 0 0 1-1.51-5.28c0-5.464 4.446-9.91 9.913-9.91 2.646 0 5.133 1.032 7.005 2.905a9.84 9.84 0 0 1 2.903 7.01c0 5.465-4.445 9.913-9.917 9.913z"/></svg>'
  });
})();
