# Parte 4 — OS e clientes

Data: 17/07/2026

Primeira extração desta etapa: `renderer/modules/os/os-list.js`.

O módulo concentra a tabela de histórico de OS: filtros por subaba, busca com debounce, renderização da lista e abertura de PDF. Ele preserva os mesmos IDs, APIs e ações existentes, e expõe `window.carregarHistorico`, `window.trocarSubabaHistorico` e `window.abrirPdf` para as chamadas já existentes no renderer.

O formulário de OS, edição, fotos, checklists, detalhes e Clientes não foram movimentados nesta subetapa porque dependem de estado compartilhado e precisam de extrações próprias.
