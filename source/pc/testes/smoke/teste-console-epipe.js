const assert = require('assert');
const { EventEmitter } = require('events');
const {
  erroDeCanalFechado,
  instalarConsoleSeguro,
  protegerStream
} = require('../../src/safe-console');

assert.strictEqual(erroDeCanalFechado({ code: 'EPIPE' }), true);
assert.strictEqual(erroDeCanalFechado({ code: 'EBADF' }), true);
assert.strictEqual(erroDeCanalFechado({ message: 'broken pipe, write' }), true);
assert.strictEqual(erroDeCanalFechado({ code: 'EACCES' }), false);

const consoleFalso = {};
for (const nome of ['log', 'info', 'warn', 'error', 'debug']) {
  consoleFalso[nome] = () => {
    const erro = new Error('broken pipe, write');
    erro.code = 'EPIPE';
    throw erro;
  };
}

const streamFalso = new EventEmitter();
instalarConsoleSeguro({ consoleAlvo: consoleFalso, streams: [streamFalso] });
assert.doesNotThrow(() => consoleFalso.log('status do WhatsApp'));
assert.doesNotThrow(() => streamFalso.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' })));

const streamComErroReal = new EventEmitter();
protegerStream(streamComErroReal);
assert.throws(
  () => streamComErroReal.emit('error', Object.assign(new Error('acesso negado'), { code: 'EACCES' })),
  /acesso negado/
);

console.log('OK - console do processo principal ignora apenas canais encerrados (EPIPE).');
