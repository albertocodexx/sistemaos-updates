// Ponto único de registro dos handlers IPC separados do main.js.
const { registerLicencaHandlers } = require('./licenca-handlers');
const { registerSupabaseHandlers } = require('./supabase-handlers');

function registerAllIpcHandlers(deps) {
  registerLicencaHandlers(deps);
  registerSupabaseHandlers(deps);
}

module.exports = { registerAllIpcHandlers };
