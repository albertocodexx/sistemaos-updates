// Ponte mínima e segura entre o renderer e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');
const { criarApiPublica } = require('./src/preload/api');

const api = criarApiPublica({
  invocar: (canal, ...args) => ipcRenderer.invoke(canal, ...args),
  assinar: (canal, listener) => ipcRenderer.on(canal, listener),
  removerAssinatura: (canal, listener) => ipcRenderer.removeListener(canal, listener)
});

contextBridge.exposeInMainWorld('api', api);
