// Garante que a extração de todos os handlers preserva os canais públicos.
const assert = require('assert');
const path = require('path');

const { registerLegacyHandlers } = require(path.resolve(
  __dirname, '..', '..', 'src', 'ipc', 'register-legacy.js'
));
const { registerAllIpcHandlers } = require(path.resolve(
  __dirname, '..', '..', 'src', 'ipc', 'register-all.js'
));

const handlers = new Map();
const ipcMain = {
  handle(canal, handler) {
    assert.ok(!handlers.has(canal), 'canal duplicado: ' + canal);
    handlers.set(canal, handler);
  }
};
const runtime = registerLegacyHandlers({
  ipcMain,
  registerAllIpcHandlers,
  licenca: {},
  supabaseDesktop: {},
  getJanelaPrincipal: () => null,
  raizApp: process.cwd(),
  caminhoDentroDe: () => true
});

[
  'os:criar',
  'estoque:listar',
  'compra:listar',
  'clientes:listar',
  'supabase:status',
  'wappfly:enviar',
  'update:versaoAtual',
  'licenca:obter'
].forEach((canal) => assert.strictEqual(typeof handlers.get(canal), 'function', 'canal registrado: ' + canal));

assert.ok(handlers.size >= 176, 'todos os canais atuais foram registrados');
assert.strictEqual(handlers.has('firebase:testarConexao'), false);
assert.strictEqual(handlers.has('cloudinary:testarConexao'), false);
assert.strictEqual(typeof runtime.sincronizarSupabaseEmSegundoPlano, 'function');

console.log('OK: ' + handlers.size + ' canais IPC registrados sem duplicidade pelo módulo extraído.');
