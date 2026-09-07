// Smoke test da Parte 9: o módulo de OS só encaminha canais permitidos.
const assert = require('assert');
const path = require('path');

const { criarApiOS } = require(path.resolve(
  __dirname, '..', '..', 'src', 'preload', 'os-api.js'
));
const chamadas = [];
const api = criarApiOS((canal, ...args) => {
  chamadas.push({ canal, args });
  return { canal, args };
});

assert.deepStrictEqual(api.criar({ defeito: 'Tela' }, 'alberto'), {
  canal: 'os:criar',
  args: [{ defeito: 'Tela' }, 'alberto']
});
assert.deepStrictEqual(api.salvarFoto('OS-0001', 'entrada', 'base64', 'foto.jpg'), {
  canal: 'os:salvarFoto',
  args: ['OS-0001', 'entrada', 'base64', 'foto.jpg']
});
assert.deepStrictEqual(api.confirmarPagamentoPresencial({ osNumero: 'OS-0001' }), {
  canal: 'os:confirmarPagamentoPresencial',
  args: [{ osNumero: 'OS-0001' }]
});
assert.deepStrictEqual(
  chamadas.map(({ canal }) => canal),
  ['os:criar', 'os:salvarFoto', 'os:confirmarPagamentoPresencial']
);

console.log('OK: API de OS do preload encaminha somente os canais previstos.');
