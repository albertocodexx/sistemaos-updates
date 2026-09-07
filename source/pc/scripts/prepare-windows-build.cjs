'use strict';

// electron-builder 26.15.3 executa o gerador do desinstalador com apenas
// __COMPAT_LAYER no ambiente. No Windows, isso remove SYSTEMROOT e TEMP
// e pode causar spawn UNKNOWN. Complete só o ambiente básico deste processo,
// sem repassar credenciais, chaves Android ou tokens ao executável auxiliar.
const childProcess = require('child_process');
const path = require('path');
const originalExecFile = childProcess.execFile;
const permitidas = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramData'];

function completarAmbiente(env, ambiente = process.env) {
  const base = {};
  for (const nome of permitidas) {
    const encontrada = Object.keys(ambiente).find(chave => chave.toLowerCase() === nome.toLowerCase());
    if (encontrada) base[encontrada] = ambiente[encontrada];
  }
  return { ...base, ...env };
}

if (process.platform === 'win32') {
  childProcess.execFile = function (arquivo, argumentos, opcoes, callback) {
    if (opcoes?.env?.__COMPAT_LAYER === 'RunAsInvoker' && /^SistemaOS-[\d.]+-Setup\.exe$/i.test(path.basename(arquivo))) {
      opcoes = { ...opcoes, windowsHide: true, env: completarAmbiente(opcoes.env) };
    }
    return originalExecFile.call(this, arquivo, argumentos, opcoes, callback);
  };
}

module.exports = { completarAmbiente };
