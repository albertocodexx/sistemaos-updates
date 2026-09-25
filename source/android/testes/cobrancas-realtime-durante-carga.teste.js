'use strict';

const assert = require('assert');
const path = require('path');

let liberarPrimeira;
let chamadas = 0;
global.SistemaOSSupabaseOS = {
  listarLeves() {
    chamadas += 1;
    if (chamadas === 1) return new Promise((resolve) => { liberarPrimeira = resolve; });
    return Promise.resolve([]);
  }
};
global.SistemaOSEstoque = { listar: () => Promise.resolve([]) };

const cobrancas = require(path.resolve(__dirname, '..', 'www', 'js', 'cobrancas-tela.js'));

(async () => {
  const primeira = cobrancas.carregar();
  cobrancas.carregar();
  liberarPrimeira([]);
  await primeira;
  assert.strictEqual(chamadas, 2, 'mudança Realtime durante carga deve provocar nova leitura');
  console.log('OK: cobrança alterada durante a sincronização não é perdida.');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
