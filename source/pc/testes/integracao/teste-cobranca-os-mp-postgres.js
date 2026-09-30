'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_PATH || '@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname,
  '../../supabase/migrations/20260930000200_cobrancas_os_mp_webhook.sql'), 'utf8');
const empresaA = '11111111-1111-4111-8111-111111111111';
const empresaB = '22222222-2222-4222-8222-222222222222';
const ordemA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ordemB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cobrancaA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create schema app_private;
      create role anon;
      create role authenticated;
      create role service_role;
      create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
      create function app_private.current_profile_empresa_id() returns uuid language sql stable as $$select null::uuid$$;
      create table public.empresas (id uuid primary key);
      create table public.ordens_servico (
        id uuid not null, empresa_id uuid not null references public.empresas(id), numero text not null,
        valor numeric(14,2) not null default 0, dados_extras jsonb not null default '{}'::jsonb,
        revision bigint not null default 1, updated_at timestamptz not null default now(), deleted_at timestamptz,
        status_pagamento text not null default 'Aguardando Pagamento', forma_pagamento text,
        cliente_telefone_snapshot text, unique(empresa_id,id), unique(empresa_id,numero)
      );
      create table public.fila_whatsapp (
        id uuid primary key default gen_random_uuid(), empresa_id uuid references public.empresas(id),
        origem text, destinatario text, mensagem_fallback text, chave_unica text unique, parametros jsonb
      );
      create table public.auditoria_comercial (
        empresa_id uuid, autor_id uuid, acao text, entidade text, entidade_id text, metadados jsonb
      );
      insert into public.empresas(id) values ('${empresaA}'),('${empresaB}');
      insert into public.ordens_servico(id,empresa_id,numero,valor,dados_extras,cliente_telefone_snapshot) values
        ('${ordemA}','${empresaA}','OS-0001',350,'{}','(27) 98145-1544'),
        ('${ordemB}','${empresaB}','OS-0001',999,'{}','(27) 99999-9999');
    `);
    await db.exec(migration);
    const query = (sql, params = []) => db.query(sql, params);
    await query(`insert into public.cobrancas_os_mp
      (id,empresa_id,ordem_id,numero_os,valor_centavos,referencia_externa,webhook_token_hash)
      values($1,$2,$3,'OS-0001',17500,'OSPAY-QA',repeat('a',64))`, [cobrancaA, empresaA, ordemA]);
    await query('select public.sincronizar_preferencia_os_mp($1,$2)', [cobrancaA, 'https://mp.invalid/checkout']);
    let osA = (await query('select * from public.ordens_servico where id=$1 and empresa_id=$2', [ordemA, empresaA])).rows[0];
    assert.equal(osA.dados_extras.lembretes_cobranca.length, 1);
    await query('select public.sincronizar_preferencia_os_mp($1,$2)', [cobrancaA, 'https://mp.invalid/checkout']);
    osA = (await query('select * from public.ordens_servico where id=$1 and empresa_id=$2', [ordemA, empresaA])).rows[0];
    assert.equal(osA.dados_extras.lembretes_cobranca.length, 1, 'retry da preferência não duplica a parcela');

    const provedor = { status: 'approved', valor_liquido_centavos: 17500 };
    const primeira = await query(`select public.aplicar_status_cobranca_os_mp($1,'987654321','aprovada',17500,now(),$2) resultado`,
      [cobrancaA, JSON.stringify(provedor)]);
    assert.equal(primeira.rows[0].resultado.aplicada, true);
    osA = (await query('select * from public.ordens_servico where id=$1 and empresa_id=$2', [ordemA, empresaA])).rows[0];
    assert.equal(Number(osA.dados_extras.valor_recebido_confirmado), 175);
    assert.equal(Number(osA.dados_extras.valor_restante_servico), 175,
      'cobrança de metade deixa somente a outra metade pendente');
    assert.equal(osA.status_pagamento, 'Pago 50%');
    assert.equal((await query('select count(*)::int total from public.fila_whatsapp')).rows[0].total, 1);

    const repetida = await query(`select public.aplicar_status_cobranca_os_mp($1,'987654321','aprovada',17500,now(),$2) resultado`,
      [cobrancaA, JSON.stringify(provedor)]);
    assert.equal(repetida.rows[0].resultado.aplicada, false);
    assert.equal((await query('select count(*)::int total from public.fila_whatsapp')).rows[0].total, 1,
      'retry não duplica confirmação no WhatsApp');

    const parcial = { status: 'approved', valor_estornado_centavos: 7500, valor_liquido_centavos: 10000 };
    await query(`select public.aplicar_status_cobranca_os_mp($1,'987654321','aprovada',17500,now(),$2)`,
      [cobrancaA, JSON.stringify(parcial)]);
    osA = (await query('select * from public.ordens_servico where id=$1 and empresa_id=$2', [ordemA, empresaA])).rows[0];
    assert.equal(Number(osA.dados_extras.valor_recebido_confirmado), 100,
      'estorno parcial com o mesmo status recalcula o líquido');
    assert.equal(Number(osA.dados_extras.valor_restante_servico), 250);

    await assert.rejects(query(`select public.aplicar_status_cobranca_os_mp($1,'987654321','aprovada',35000,now(),'{}')`,
      [cobrancaA]), /valor ou moeda divergente/);
    const osB = (await query('select * from public.ordens_servico where id=$1', [ordemB])).rows[0];
    assert.equal(Number(osB.valor), 999);
    assert.deepEqual(osB.dados_extras, {}, 'cobrança da empresa A não altera empresa B');
    console.log('OK: PostgreSQL — cobrança OS, 50%, retry, estorno parcial, WhatsApp e isolamento.');
  } finally {
    await db.close();
  }
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
