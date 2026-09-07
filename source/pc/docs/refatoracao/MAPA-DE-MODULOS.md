# Mapa dos módulos atuais

Este mapa registra somente a divisão já feita. O sistema continua compatível
com os nomes e fluxos anteriores.

## Renderer

    renderer/index.html
      ├─ renderer/shared/dom.js
      ├─ renderer/shared/formatters.js
      ├─ renderer/shared/icons.js
      ├─ renderer/core/app-version.js
      ├─ renderer/core/legacy-runtime.js   (runtime compatível)
      ├─ renderer/modules/licenca/licenca.js
      ├─ renderer/modules/os/os-list.js
      ├─ renderer/modules/estoque/dashboard.js
      └─ renderer/modules/mobile/sync-status.js

renderer/renderer.js é somente uma entrada de compatibilidade. Os módulos de
tela continuam sendo carregados depois do runtime quando dependem de funções
globais já existentes.

## Processo principal e IPC

    main.js
      └─ src/ipc/register-legacy.js
           └─ src/ipc/register-all.js
                └─ src/ipc/licenca-handlers.js

main.js concentra somente inicialização, janela e ciclo de vida. Os 178 canais
IPC são registrados fora dele com dependências explícitas.

## Dados

    src/db.js                         (fachada compatível)
      └─ src/database/domain.js       (implementação de domínio)
           └─ src/repositories/clientes-repository.js

O repositório de Clientes recebe as funções de leitura/gravação da camada de
domínio. O formato do database.json continua o mesmo.

## Preload

    preload.js
      └─ src/preload/api.js
           └─ src/preload/os-api.js

O preload é só a ponte segura. A API expõe rotas agrupadas (os, estoque,
financeiro, mobile, usuarios, whatsapp e sistema) e mantém atalhos legados,
como window.api.oscriar.
