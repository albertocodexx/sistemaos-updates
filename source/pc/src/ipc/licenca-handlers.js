// Canais IPC de licença. Regras continuam no serviço src/licenca.js.
function registerLicencaHandlers({ ipcMain, licenca }) {
  ipcMain.handle('licenca:obter', () => licenca.obterLicenca());
  ipcMain.handle('licenca:verificar', () => licenca.verificarLicenca());
  ipcMain.handle('licenca:ativar', (_event, dados) => licenca.ativarLicenca(dados));
  ipcMain.handle('licenca:resetar', () => licenca.resetarLicenca());
}

module.exports = { registerLicencaHandlers };
