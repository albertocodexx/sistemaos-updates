'use strict';

// Em alguns inícios em segundo plano no Windows, stdout/stderr continuam
// apontando para o processo que abriu o aplicativo. Quando esse processo
// termina, qualquer console.log pode lançar EPIPE e o Electron exibe uma
// caixa de "JavaScript error". Mensagens de diagnóstico nunca devem encerrar
// o Sistema OS, por isso ignoramos somente erros de canal já fechado.
const CODIGOS_CANAL_FECHADO = new Set([
  'EPIPE',
  'EBADF',
  'ERR_STREAM_DESTROYED'
]);

const STREAM_PROTEGIDO = Symbol.for('sistemaos.stream-console-protegido');
const METODO_PROTEGIDO = Symbol.for('sistemaos.metodo-console-protegido');

function erroDeCanalFechado(erro) {
  if (!erro) return false;
  if (CODIGOS_CANAL_FECHADO.has(String(erro.code || '').toUpperCase())) return true;
  return /broken pipe|stream (?:is )?destroyed/i.test(String(erro.message || ''));
}

function protegerStream(stream) {
  if (!stream || typeof stream.on !== 'function' || stream[STREAM_PROTEGIDO]) return;

  Object.defineProperty(stream, STREAM_PROTEGIDO, {
    value: true,
    configurable: false,
    enumerable: false
  });

  stream.on('error', (erro) => {
    if (erroDeCanalFechado(erro)) return;
    throw erro;
  });
}

function protegerMetodoConsole(consoleAlvo, nome) {
  const metodoOriginal = consoleAlvo?.[nome];
  if (typeof metodoOriginal !== 'function' || metodoOriginal[METODO_PROTEGIDO]) return;

  function metodoSeguro(...argumentos) {
    try {
      return Reflect.apply(metodoOriginal, consoleAlvo, argumentos);
    } catch (erro) {
      if (erroDeCanalFechado(erro)) return undefined;
      throw erro;
    }
  }

  Object.defineProperty(metodoSeguro, METODO_PROTEGIDO, {
    value: true,
    configurable: false,
    enumerable: false
  });
  consoleAlvo[nome] = metodoSeguro;
}

function instalarConsoleSeguro({
  consoleAlvo = console,
  streams = [process.stdout, process.stderr]
} = {}) {
  streams.forEach(protegerStream);
  ['log', 'info', 'warn', 'error', 'debug'].forEach((nome) => {
    protegerMetodoConsole(consoleAlvo, nome);
  });
}

module.exports = {
  erroDeCanalFechado,
  instalarConsoleSeguro,
  protegerMetodoConsole,
  protegerStream
};
