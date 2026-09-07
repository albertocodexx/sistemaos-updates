# Parte 1 — Baseline de modularização

Esta etapa prepara a divisão do código sem alterar o comportamento do sistema.

## Estado preservado

- `renderer/renderer.js` continua sendo carregado normalmente pelo HTML.
- `main.js` continua registrando todos os handlers IPC.
- `src/db.js` continua sendo a única camada de persistência.
- `preload.js` continua expondo a API atual para a interface.
- Não houve mudança de banco, HTML, IPC, PDF, APK, WhatsApp ou build.

## Estrutura criada

```text
src/ipc/
src/repositories/
src/services/
renderer/core/
renderer/modules/
renderer/shared/
testes/smoke/
```

## Testes de fumaça

Execute antes e depois de cada extração:

```powershell
node testes/smoke/teste-inicializacao-electron.js
node testes/smoke/teste-preload-api.js
node testes/smoke/teste-ipcs-duplicados.js
```

Os testes não iniciam a janela do Electron e não acessam o banco real. Eles
somente verificam a estrutura de entrada, a API pública do preload e a
duplicidade literal dos canais registrados no `main.js`.

## Próxima etapa

A Parte 2 poderá extrair somente utilitários puros do renderer. Nenhum módulo
de negócio deve ser movido antes de os três testes de fumaça passarem.
