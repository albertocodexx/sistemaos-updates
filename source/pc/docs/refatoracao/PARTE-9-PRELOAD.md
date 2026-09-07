# Parte 9 — Preload

Primeiro recorte concluído: API de Ordens de Serviço.

- src/preload/os-api.js centraliza os canais públicos de OS.
- preload.js agora expõe window.api.os com métodos organizados.
- Os atalhos legados, como window.api.oscriar e window.api.oslistar,
  continuam apontando para as mesmas operações, sem exigir mudanças no
  renderer.
- A API nova recebe somente uma função de invocação e não expõe ipcRenderer,
  require, arquivos ou execução de comandos.

Os testes validam tanto o módulo isolado quanto a compatibilidade da API
publicada pelo preload.
