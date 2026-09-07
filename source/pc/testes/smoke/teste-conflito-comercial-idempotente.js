'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..', '..');
const caminho = path.join(
  raiz,
  'supabase',
  'migrations',
  '20260819000100_conflito_comercial_idempotente.sql'
);
const sql = fs.readFileSync(caminho, 'utf8');

assert.match(sql, /create or replace function public\.atualizar_documento_comercial_mobile/i);
assert.match(sql, /'_sync_conflito', true/g);
assert.doesNotMatch(sql, /errcode\s*=\s*'40001'/i,
  'conflito comercial não pode abortar a transação e alimentar retry infinito');
assert.match(sql, /where v\.empresa_id = v_empresa_id and v\.id = p_id/i,
  'a reconciliação deve continuar isolada por empresa');

console.log('OK: conflito comercial é idempotente e não derruba o pool do PostgREST.');

