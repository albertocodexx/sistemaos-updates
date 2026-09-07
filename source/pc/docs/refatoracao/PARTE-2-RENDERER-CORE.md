# Parte 2 — Renderer core seguro

Data: 17/07/2026

Esta etapa separa somente código visual e sem regra de negócio do renderer monolítico.

## Módulos criados

- `renderer/core/app-version.js`: versão exibida na tela de login.
- `renderer/shared/dom.js`: acesso por ID ao DOM.
- `renderer/shared/formatters.js`: data, data/hora e moeda em pt-BR.
- `renderer/shared/icons.js`: ícones SVG usados em botões, listas e modais.

`renderer/index.html` carrega esses arquivos antes de `renderer.js`. O renderer principal apenas recebe os mesmos nomes locais já usados pelas telas, portanto não houve alteração de fluxo, IPC, banco, Cloudinary, WhatsApp ou formulários.

## Limite desta etapa

Não foram extraídos ainda modais, navegação, notificações, estado nem nenhuma funcionalidade de OS, venda, compra, garantia ou entrega. Eles exigem uma etapa própria para não mudar comportamento sem teste manual.

## Validação

Execute:

```powershell
node testes/smoke/teste-renderer-core.js
```

O teste verifica a carga dos módulos, os formatadores, os ícones, a atualização da versão e a ordem dos scripts no HTML.
