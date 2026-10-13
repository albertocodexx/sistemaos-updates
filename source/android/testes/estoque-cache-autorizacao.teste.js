'use strict';
// Fixture isolada: armazenamento, eventos, RPC e contas inteiramente fictícios.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  let permitido = true;
  let contexto = { empresa_id: 'empresa-a', usuario_id: 'usuario-a' };
  let resolver;
  const eventos = new Map();
  const salvo = { versao: 2, aparelhos: [{ id: 'EST-DUMMY', modelo: 'MARCADOR-PRIVADO' }], pecas: [],
    fila: [{ id: 'EST-DUMMY', acao: 'salvar_aparelho', dados: { status: 'Em reparo' }, versao: 'dummy' }] };
  const storage = new Map([['sistema-os-estoque-cache-v2:empresa-a', JSON.stringify(salvo)]]);
  const root = {
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    navigator: { onLine: false },
    document: { addEventListener: (nome, fn) => eventos.set(nome, fn) },
    SistemaOSPermissoes: { obterContexto: () => contexto, pode: () => permitido },
    SupabaseClientApp: { obterCliente: () => ({ from: () => ({
      select() { return this; }, eq() { return this; }, is() { return this; }, order() { return this; },
      limit() { return new Promise(resolve => { resolver = resolve; }); }
    }) }) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../www/js/supabase/estoque-service.js'), 'utf8'), root);
  const api = root.SistemaOSEstoque;
  assert.equal(api.listarCache('aparelho')[0].modelo, 'MARCADOR-PRIVADO');
  const antes = storage.get('sistema-os-estoque-cache-v2:empresa-a');
  permitido = false;
  assert.equal(api.listarCache('aparelho').length, 0);
  await assert.rejects(api.obterAparelho('EST-DUMMY'), /permissão/);
  assert.equal(storage.get('sistema-os-estoque-cache-v2:empresa-a'), antes, 'negação não apaga fila');
  permitido = true;
  root.navigator.onLine = true;
  const leitura = api.listar('aparelho');
  contexto = { empresa_id: 'empresa-a', usuario_id: 'usuario-b' };
  eventos.get('sistema-os:sessao-alterada')();
  resolver({ data: [{ tipo: 'aparelho', local_id: 'EST-DUMMY', dados: { modelo: 'RESPOSTA-A' } }], error: null });
  await assert.rejects(leitura, /conta ativa mudou/);
  assert.equal(storage.get('sistema-os-estoque-cache-v2:empresa-a'), antes, 'resposta tardia não atualiza cache sucessor');
  console.log('OK: autorização do cache e proteção de resposta tardia do estoque.');
})().catch(erro => { console.error(erro); process.exitCode = 1; });
