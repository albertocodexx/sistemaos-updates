const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DesktopStateStore } = require('../../src/supabase/desktop-state-store');
const { DesktopSupabaseRuntime } = require('../../src/supabase/desktop-runtime');

const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260724000600_outbox_exclusao_os_desktop.sql'), 'utf8');
assert(migration.includes('create table if not exists public.exclusoes_os_pendentes'));
assert(migration.includes('create or replace function public.listar_exclusoes_os_pendentes'));
assert(migration.includes('create or replace function public.confirmar_exclusao_os_desktop'));
assert(migration.includes("delete from public.garantias"));
assert(migration.includes("delete from public.entregas"));
assert(migration.includes("delete from public.solicitacoes_assinatura_remota"));

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-os-delete-pull-'));
  try {
    const stateStore = new DesktopStateStore(temp);
    stateStore.enfileirarOS('update', 'OS-0042', { dados: { status: 'Em reparo' } });
    stateStore.alterar((estado) => {
      estado.conflitos.push({ numero: 'OS-0042', erro: 'conflito antigo' });
    });

    const tombstone = {
      id: 'remote-42', numero: 'OS-0042', id_exportacao: 'os-celular-42',
      revision: 4, updated_at: '2026-07-20T15:00:00.000Z',
      deleted_at: '2026-07-20T15:00:00.000Z'
    };
    const chamadas = [];
    const query = {
      select: () => query,
      not: (...args) => { chamadas.push(['not', ...args]); return query; },
      gte: (...args) => { chamadas.push(['gte', ...args]); return query; },
      order: () => query,
      limit: async () => ({ data: [tombstone], error: null })
    };
    const removidas = [];
    const runtime = new DesktopSupabaseRuntime();
    runtime.stateStore = stateStore;
    runtime.client = { from: (tabela) => { assert.strictEqual(tabela, 'ordens_servico'); return query; } };
    runtime.db = {
      removerOSSupabase: (numero, linha) => {
        removidas.push({ numero, linha });
        return { sucesso: true, removida: true };
      }
    };

    const total = await runtime._baixarExclusoesOS();
    const estado = stateStore.obter();
    assert.strictEqual(total, 1);
    assert.strictEqual(removidas[0].numero, 'OS-0042');
    assert.strictEqual(estado.fila.length, 0, 'fila antiga nao pode recriar OS excluida no celular');
    assert.strictEqual(estado.conflitos.length, 0, 'conflito antigo deve ser descartado com o tombstone');
    assert.strictEqual(estado.mapeamentosOS['OS-0042'].deletedAt, tombstone.deleted_at);
    assert.strictEqual(estado.ultimoPullExclusoesEm, tombstone.deleted_at);
    assert(chamadas.some((item) => item[0] === 'not' && item[1] === 'deleted_at'));
    assert(chamadas.some((item) => item[0] === 'gte' && item[1] === 'deleted_at'));
    console.log('OK: exclusao feita no celular remove a OS do PC e neutraliza filas antigas.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
