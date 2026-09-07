# IPCs do processo principal

Esta pasta foi criada na Parte 1 da modularização.

Nas partes 7 e 9, os handlers registrados hoje em `main.js` serão movidos para
arquivos por domínio, por exemplo `os.ipc.js`, `estoque.ipc.js` e
`config.ipc.js`.

Por enquanto, nenhum handler foi movido e `main.js` continua sendo a única
fonte de registro dos canais IPC.
