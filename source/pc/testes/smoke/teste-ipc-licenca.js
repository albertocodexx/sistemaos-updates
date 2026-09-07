// Smoke test da Parte 7: canais de licença registrados uma única vez.
const assert = require('assert');
const path = require('path');

const { registerLicencaHandlers } = require(path.resolve(__dirname, '..', '..', 'src', 'ipc', 'licenca-handlers.js'));
const handlers = new Map();
const ipcMain = {
  handle(canal, funcao) {
    assert.ok(!handlers.has(canal), `canal duplicado: ${canal}`);
    handlers.set(canal, funcao);
  }
};
const chamadas = [];
const licenca = {
  obterLicenca: () => { chamadas.push('obter'); return { status: 'ativa' }; },
  verificarLicenca: () => { chamadas.push('verificar'); return { valida: true }; },
  ativarLicenca: dados => { chamadas.push(['ativar', dados]); return { sucesso: true }; },
  resetarLicenca: () => { chamadas.push('resetar'); return { status: 'nao_ativada' }; }
};

registerLicencaHandlers({ ipcMain, licenca });
assert.deepStrictEqual([...handlers.keys()], ['licenca:obter', 'licenca:verificar', 'licenca:ativar', 'licenca:resetar']);
assert.deepStrictEqual(handlers.get('licenca:obter')(), { status: 'ativa' });
assert.deepStrictEqual(handlers.get('licenca:verificar')(), { valida: true });
assert.deepStrictEqual(handlers.get('licenca:ativar')(null, { chave: 'ABCD' }), { sucesso: true });
assert.deepStrictEqual(handlers.get('licenca:resetar')(), { status: 'nao_ativada' });
assert.deepStrictEqual(chamadas, ['obter', 'verificar', ['ativar', { chave: 'ABCD' }], 'resetar']);
console.log('OK: 4 canais de licença foram registrados e delegados corretamente.');
