# Parte 7 — IPCs do main

Data: 17/07/2026

Primeira extração desta etapa:

- `src/ipc/licenca-handlers.js`
- `src/ipc/register-all.js`

Os quatro canais de licença foram removidos do `main.js` e passaram a ser registrados por `registerAllIpcHandlers({ ipcMain, licenca })`. Os nomes dos canais, argumentos e retornos foram mantidos.

Os demais IPCs continuam no `main.js`; serão transferidos por domínio e sempre com o mesmo padrão de dependências explícitas.
