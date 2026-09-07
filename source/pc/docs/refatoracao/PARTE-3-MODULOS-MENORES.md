# Parte 3 — Módulos menores do renderer

Data: 17/07/2026

Primeira extração desta etapa: `renderer/modules/licenca/licenca.js`.

O módulo mantém as mesmas APIs `window.api.licenca*`, IDs da tela, mensagens e ações de ativar/remover licença. Ele expõe somente `window.RendererLicenca.init()` e `window.abrirModalLicenca`; `init()` é idempotente para impedir listeners duplicados.

As demais áreas previstas para esta parte (configuração, backup, atualização, usuários, cargos e etiquetas) não foram movidas nesta subetapa porque têm dependências maiores e serão extraídas isoladamente, sem misturar regras de negócio.
