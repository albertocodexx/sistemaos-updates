'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DesktopStateStore } = require('../../src/supabase/desktop-state-store');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const android = path.resolve(raiz, '..', 'sistemaos-android');
const migracao = ler('supabase', 'migrations', '20261011000200_compatibilidade_clientes.sql');
const desktop = ler('src', 'supabase', 'desktop-runtime.js');
const mobileClient = fs.readFileSync(path.join(android, 'www', 'js', 'supabase', 'supabase-client.js'), 'utf8');
const mobileEmpresa = fs.readFileSync(path.join(android, 'www', 'js', 'supabase', 'empresa-service.js'), 'utf8');
const gradle = fs.readFileSync(path.join(android, 'android', 'app', 'build.gradle'), 'utf8');

assert.match(migracao, /verificar_compatibilidade_aplicativo/);
assert.match(migracao, /bloquear_cliente_desatualizado/);
assert.match(migracao, /sistema-os-electron-stage7/);
assert.match(migracao, /sistema-os-android-etapa3/);
assert.match(migracao, /'windows', '40\.5\.24', '40\.5\.24'/);
assert.match(migracao, /'android', '20\.5\.23', '20\.5\.23'/);
assert.match(desktop, /sistema-os\/windows\/\$\{APP_VERSION\}\/schema\/\$\{SYNC_SCHEMA_VERSION\}/);
assert.match(desktop, /_verificarCompatibilidadeAplicativo/);
assert.match(mobileClient, /sistema-os\/android\/.*VERSAO_APP.*schema/);
assert.match(mobileEmpresa, /verificar_compatibilidade_aplicativo/);
assert.match(gradle, /versionCode 114/);
assert.match(gradle, /versionName "20\.5\.23"/);

const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-os-schema-'));
try {
  const estado = new DesktopStateStore(temporario);
  estado.trocarEmpresa('empresa-a');
  estado.enfileirarOS('insert', 'OS-TESTE', { clienteNome: 'Fila preservada' });
  estado.alterar((atual) => { atual.ultimoPullEm = '2026-10-11T10:00:00.000Z'; });
  assert.equal(estado.garantirSchemaSincronizacao(10), true);
  const atualizado = estado.obter();
  assert.equal(atualizado.schemaSincronizacao, 10);
  assert.equal(atualizado.ultimoPullEm, '1970-01-01T00:00:00.000Z');
  assert.equal(atualizado.fila.length, 1, 'upgrade deve preservar a fila offline');
  assert.equal(estado.garantirSchemaSincronizacao(10), false, 'mesmo schema nao refaz o pull');
} finally {
  fs.rmSync(temporario, { recursive: true, force: true });
}

console.log('OK: versoes incompatíveis são bloqueadas e o upgrade preserva a fila offline.');
