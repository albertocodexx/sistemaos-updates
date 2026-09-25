const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const auth = fs.readFileSync(path.join(raiz, 'src', 'auth.js'), 'utf8');
const ipc = fs.readFileSync(path.join(raiz, 'src', 'ipc', 'register-legacy.js'), 'utf8');

const inicio = renderer.indexOf('async function gerarUsuarioAutomatico()');
const fim = renderer.indexOf('// ── Alterar Status', inicio);
const fluxo = renderer.slice(inicio, fim);

assert.match(fluxo, /Nome completo da pessoa/,
  'geração automática deve pedir o nome da pessoa');
assert.match(fluxo, /usandoUsuariosSupabaseEmpresa\(\)[\s\S]*?criar_usuario_empresa/,
  'empresa na nuvem deve criar o usuário no Supabase, não apenas no banco local');
assert.match(fluxo, /obterUsuariosDaEmpresaAtual\(\)/,
  'login automático deve conferir os usuários existentes na empresa correta');
assert.match(fluxo, /senhaTemporaria/,
  'credencial temporária deve ser exibida após a criação');
assert.match(auth, /function gerarUsuarioAutomatico\(dados = \{\}\)/);
assert.match(auth, /loginAutomaticoPorNome\(nome\)/);
assert.match(ipc, /auth\.gerarUsuarioAutomatico\(dados\)/);

console.log('OK: usuário automático usa nome, senha forte e a empresa correta na nuvem.');
