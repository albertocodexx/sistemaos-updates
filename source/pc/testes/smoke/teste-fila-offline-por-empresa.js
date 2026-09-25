'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DesktopStateStore } = require('../../src/supabase/desktop-state-store');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-fila-empresa-'));
try {
  const store = new DesktopStateStore(pasta);
  store.trocarEmpresa('empresa-a');
  store.enfileirarOS('insert', 'OS-100', { dados: { cliente: { nome: 'A' } } });
  store.enfileirarAssinatura({ idEnvioAssinatura: 'assinatura-a', empresaId: 'empresa-a' });
  assert.strictEqual(store.obter().fila.length, 1);

  store.trocarEmpresa('empresa-b');
  assert.strictEqual(store.obter().fila.length, 0, 'empresa B não pode enxergar fila da A');
  assert.strictEqual(store.obter().filaAssinaturas.length, 0, 'empresa B não pode enxergar assinatura da A');
  store.enfileirarOS('insert', 'OS-200', { dados: { cliente: { nome: 'B' } } });

  store.trocarEmpresa('empresa-a');
  assert.deepStrictEqual(store.obter().fila.map((item) => item.numero), ['OS-100'],
    'fila offline da empresa A deve sobreviver à troca de conta');
  assert.deepStrictEqual(store.obter().filaAssinaturas.map((item) => item.idEnvioAssinatura), ['assinatura-a']);

  const recarregado = new DesktopStateStore(pasta);
  assert.deepStrictEqual(recarregado.obter().fila.map((item) => item.numero), ['OS-100'],
    'fila deve sobreviver ao fechamento do PC');
  recarregado.trocarEmpresa('empresa-b');
  assert.deepStrictEqual(recarregado.obter().fila.map((item) => item.numero), ['OS-200']);
  console.log('OK: filas offline persistem por empresa sem vazamento entre contas.');
} finally {
  fs.rmSync(pasta, { recursive: true, force: true });
}
