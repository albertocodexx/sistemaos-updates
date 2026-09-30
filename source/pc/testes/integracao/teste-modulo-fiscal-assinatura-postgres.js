'use strict';

// Teste transacional local. Nao usa credenciais nem pagamentos reais.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_PATH || '@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname,
  '../../supabase/migrations/20260926000100_adicional_fiscal_assinatura.sql'), 'utf8');
const trialMigration = fs.readFileSync(path.join(__dirname,
  '../../supabase/migrations/20260926000200_trial_fiscal_30_dias.sql'), 'utf8');
const betaMigration = fs.readFileSync(path.join(__dirname,
  '../../supabase/migrations/20260926000300_beta_45_trial_30.sql'), 'utf8');
const porNotaMigration = fs.readFileSync(path.join(__dirname,
  '../../supabase/migrations/20260927000200_fiscal_por_nota.sql'), 'utf8');
const empresaA = '11111111-1111-4111-8111-111111111111';
const empresaB = '22222222-2222-4222-8222-222222222222';
const empresaTrial = '66666666-6666-4666-8666-666666666666';
const empresaBeta = '88888888-8888-4888-8888-888888888888';
const empresaBetaNova = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const planoId = '33333333-3333-4333-8333-333333333333';
const planoTrialId = '77777777-7777-4777-8777-777777777777';
const cobrancaA = '44444444-4444-4444-8444-444444444444';
const cobrancaB = '55555555-5555-4555-8555-555555555555';

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon; create role authenticated; create role service_role;
      create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
      create table public.empresas (
        id uuid primary key, beta_fundador boolean not null default false,
        plano_id uuid, inicio_trial timestamptz, fim_trial timestamptz,
        created_at timestamptz not null default now(),
        data_vencimento timestamptz, proximo_vencimento_em timestamptz,
        ativo boolean not null default true,
        licenca_status text not null default 'ativa',
        recursos_habilitados jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );
      create table public.planos (id uuid primary key default gen_random_uuid(), nome text not null, descricao text,
        duracao_dias integer, limites jsonb default '{}'::jsonb, ativo boolean default true,
        preco_referencia numeric default 0, periodo text default 'mensal', ordem integer default 100,
        destaque boolean default false, excluido_em timestamptz,
        updated_at timestamptz default now());
      create unique index planos_nome_uidx on public.planos(lower(nome));
      create table public.recursos (id uuid primary key default gen_random_uuid(), chave text not null);
      create table public.plano_recursos (plano_id uuid references public.planos(id),
        recurso_id uuid references public.recursos(id), habilitado boolean default true,
        limite bigint, primary key (plano_id,recurso_id));
      create table public.cobrancas_assinatura (
        id uuid primary key, empresa_id uuid not null references public.empresas(id),
        plano_id uuid not null references public.planos(id), tipo_alteracao text not null,
        status text not null, aplicado_em timestamptz,
        pagamento_provedor_id text, pago_em timestamptz, dados_provedor jsonb default '{}'::jsonb,
        valor numeric(12,2) not null, referencia_externa text not null, provedor text not null default 'mercado_pago',
        updated_at timestamptz not null default now()
      );
      create table public.contas_fiscais (empresa_id uuid primary key references public.empresas(id),
        limite_gratuito_mensal integer not null default 100,
        preco_excedente_centavos integer not null default 20, updated_at timestamptz not null default now());
      create table public.reservas_fiscais (nota_id uuid primary key,
        empresa_id uuid not null references public.empresas(id), status text not null);
      create table public.pagamentos_assinatura (
        id uuid primary key default gen_random_uuid(), empresa_id uuid, plano_id uuid,
        valor numeric, vencimento_em timestamptz, pago_em timestamptz, forma text,
        referencia text, status text, observacao text, cobranca_id uuid unique,
        provedor text, pagamento_provedor_id text unique
      );
      create table public.eventos_licenca (empresa_id uuid, tipo text, motivo text, dados jsonb,
        constraint eventos_licenca_tipo_check check (tipo in ('trial_criado','trial_prorrogado',
          'plano_alterado','vencimento_alterado','pagamento_confirmado',
          'suspensao','reativacao','bloqueio','observacao')));
      insert into public.planos(id,nome) values ('${planoId}','Basico'),('${planoTrialId}','Trial');
      insert into public.recursos(chave) values ('ordens_servico');
      insert into public.plano_recursos(plano_id,recurso_id)
        select '${planoTrialId}', id from public.recursos;
      insert into public.empresas(id,beta_fundador,inicio_trial,data_vencimento) values
        ('${empresaA}',true,now() - interval '6 months',now() + interval '30 days'),
        ('${empresaB}',false,null,now() + interval '20 days');
      insert into public.contas_fiscais(empresa_id) values ('${empresaA}'),('${empresaB}');
    `);
    await db.exec(migration);
    const q = (sql, params = []) => db.query(sql, params);
    const beta = (await q('select beta_fundador_expira_em > now() as vigente from public.empresas where id=$1', [empresaA])).rows[0];
    assert.equal(beta.vigente, true, 'beneficio beta dura um ano a partir do trial');
    assert.equal((await q('select preco_excedente_centavos from public.contas_fiscais where empresa_id=$1', [empresaA])).rows[0].preco_excedente_centavos, 25);
    await assert.rejects(q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', empresaA, 'reservada']), /modulo fiscal nao esta ativo/i);

    await q(`insert into public.cobrancas_assinatura
      (id,empresa_id,plano_id,tipo_alteracao,status,valor,referencia_externa,fiscal_incluso,fiscal_valor_centavos)
      values($1,$2,$3,'renovacao','aprovada',39.90,'SAAS-A',true,3990)`, [cobrancaA, empresaA, planoId]);
    await q('update public.cobrancas_assinatura set aplicado_em=now() where id=$1', [cobrancaA]);
    const validade = (await q('select modulo_fiscal_ativo_ate >= data_vencimento as valido from public.empresas where id=$1', [empresaA])).rows[0];
    assert.equal(validade.valido, true, 'pagamento do plano com adicional libera ate o vencimento');
    await q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', empresaA, 'reservada']);
    await assert.rejects(q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', empresaB, 'reservada']), /modulo fiscal nao esta ativo/i);

    await q(`insert into public.cobrancas_assinatura
      (id,empresa_id,plano_id,tipo_alteracao,status,valor,referencia_externa,fiscal_incluso,fiscal_valor_centavos)
      values($1,$2,$3,'ativacao_fiscal','aprovada',19.90,'SAAS-B',true,1990)`, [cobrancaB, empresaB, planoId]);
    const antes = (await q('select data_vencimento from public.empresas where id=$1', [empresaB])).rows[0].data_vencimento;
    const aplicar = () => q('select public.aplicar_pagamento_modulo_fiscal($1,$2) as resultado', [cobrancaB, 'MP-123']);
    assert.equal((await aplicar()).rows[0].resultado.aplicado, true);
    assert.equal((await aplicar()).rows[0].resultado.ja_aplicado, true, 'callback repetido e idempotente');
    await assert.rejects(q('select public.aplicar_pagamento_modulo_fiscal($1,$2)', [cobrancaB, 'MP-OUTRO']), /pagamento divergente/);
    const depois = (await q('select data_vencimento,modulo_fiscal_ativo_ate from public.empresas where id=$1', [empresaB])).rows[0];
    assert.equal(depois.data_vencimento.getTime(), antes.getTime(), 'adicional nao estende o plano');
    assert.equal(depois.modulo_fiscal_ativo_ate.getTime(), antes.getTime(), 'adicional vale ate a proxima renovacao');
    assert.equal((await q('select count(*)::int as n from public.pagamentos_assinatura where empresa_id=$1', [empresaB])).rows[0].n, 1);
    await q('update public.empresas set modulo_fiscal_ativo_ate=now() - interval \'1 minute\' where id=$1', [empresaA]);
    await assert.rejects(q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', empresaA, 'reservada']), /modulo fiscal nao esta ativo/i);
    await db.exec(trialMigration);
    assert.equal((await q("select duracao_dias from public.planos where lower(nome)='trial'")).rows[0].duracao_dias, 30);
    await q(`insert into public.empresas(id,plano_id,licenca_status,inicio_trial,fim_trial)
      values($1,$2,'teste',now(),now() + interval '30 days')`, [empresaTrial, planoTrialId]);
    await q('insert into public.contas_fiscais(empresa_id) values($1)', [empresaTrial]);
    const contaTrial = (await q('select limite_gratuito_mensal,preco_excedente_centavos from public.contas_fiscais where empresa_id=$1', [empresaTrial])).rows[0];
    assert.equal(contaTrial.limite_gratuito_mensal, 30);
    assert.equal(contaTrial.preco_excedente_centavos, 25);
    await q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', empresaTrial, 'reservada']);
    await q(`insert into public.empresas(id,plano_id,licenca_status,inicio_trial,fim_trial)
      values($1,$2,'teste',now(),now() + interval '45 days')`, [empresaBeta, planoTrialId]);
    await q('insert into public.contas_fiscais(empresa_id) values($1)', [empresaBeta]);
    const vencimentoBeta = (await q('select fim_trial from public.empresas where id=$1', [empresaBeta])).rows[0].fim_trial;
    await db.exec(betaMigration);
    await db.exec(betaMigration);
    const planoBeta = (await q("select id,duracao_dias,limites from public.planos where lower(nome)='beta'")).rows[0];
    assert.equal(planoBeta.duracao_dias, 45);
    assert.equal(planoBeta.limites.trial_dias, 45);
    assert.equal((await q("select duracao_dias from public.planos where lower(nome)='trial'")).rows[0].duracao_dias, 30);
    const betaMigrado = (await q('select plano_id,fim_trial,beta_fundador from public.empresas where id=$1', [empresaBeta])).rows[0];
    assert.equal(betaMigrado.plano_id, planoBeta.id, 'teste antigo usa plano Beta distinto');
    assert.equal(betaMigrado.fim_trial.getTime(), vencimentoBeta.getTime(), 'migracao nao altera vencimento antigo');
    assert.equal((await q('select data_vencimento from public.empresas where id=$1', [empresaBeta])).rows[0].data_vencimento.getTime(), vencimentoBeta.getTime(), 'cobranca parte do fim real do Beta');
    assert.equal(betaMigrado.beta_fundador, true);
    assert.equal((await q('select limite_gratuito_mensal from public.contas_fiscais where empresa_id=$1', [empresaBeta])).rows[0].limite_gratuito_mensal, 100);
    assert.equal((await q('select count(*)::int as n from public.plano_recursos where plano_id=$1 and habilitado', [planoBeta.id])).rows[0].n, 1);
    await q("insert into public.eventos_licenca(empresa_id,tipo) values($1,'beta_criado')", [empresaBeta]);
    await q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['ffffffff-ffff-4fff-8fff-ffffffffffff', empresaBeta, 'reservada']);
    await q(`insert into public.empresas(id,plano_id,licenca_status,inicio_trial,fim_trial,data_vencimento,beta_fundador,beta_fundador_expira_em)
      values($1,$2,'teste',now(),now() + interval '45 days',now() + interval '45 days',true,now() + interval '1 year')`,
    [empresaBetaNova, planoBeta.id]);
    await q('insert into public.contas_fiscais(empresa_id,limite_gratuito_mensal,preco_excedente_centavos) values($1,100,25)', [empresaBetaNova]);
    assert.equal((await q('select limite_gratuito_mensal from public.contas_fiscais where empresa_id=$1', [empresaBetaNova])).rows[0].limite_gratuito_mensal, 100);
    await q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', empresaBetaNova, 'reservada']);
    await q("update public.empresas set fim_trial=now() - interval '1 second' where id=$1", [empresaTrial]);
    await assert.rejects(q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', empresaTrial, 'reservada']), /Periodo de teste encerrado/i);
    await q("update public.empresas set fim_trial=now() - interval '1 second' where id=$1", [empresaBeta]);
    await assert.rejects(q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['99999999-9999-4999-8999-999999999999', empresaBeta, 'reservada']), /Periodo de teste encerrado/i);
    await db.exec(`create table public.configuracoes_fiscais (
      empresa_id uuid primary key references public.empresas(id),
      provedor text not null default 'nuvem_fiscal', ambiente text not null default 'homologacao',
      status text not null default 'nao_configurada', metadados jsonb not null default '{}'::jsonb,
      ultimo_erro text, updated_at timestamptz not null default now());
      insert into public.configuracoes_fiscais(empresa_id,provedor,ambiente,status,metadados)
      values ('${empresaA}','nuvem_fiscal','producao','configurada',
        '{"nome_prestador":"Teste","certificado_a1_sandbox_em":"2026-09-01"}');`);
    await db.exec(porNotaMigration);
    await db.exec(porNotaMigration);
    const contaPorNota = (await q('select limite_gratuito_mensal,preco_excedente_centavos from public.contas_fiscais where empresa_id=$1', [empresaA])).rows[0];
    assert.equal(contaPorNota.limite_gratuito_mensal, 0);
    assert.equal(contaPorNota.preco_excedente_centavos, 99);
    const configDesativada = (await q('select provedor,ambiente,status,metadados from public.configuracoes_fiscais where empresa_id=$1', [empresaA])).rows[0];
    assert.equal(configDesativada.provedor, 'nfse_nacional');
    assert.equal(configDesativada.ambiente, 'homologacao');
    assert.equal(configDesativada.status, 'nao_configurada');
    assert.equal(configDesativada.metadados.nome_prestador, 'Teste', 'cadastro do emitente preservado');
    assert.equal(configDesativada.metadados.certificado_a1_sandbox_em, undefined);
    await q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', empresaA, 'reservada']);
    await q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', empresaB, 'reservada']);
    await q("update public.empresas set licenca_status='bloqueada' where id=$1", [empresaA]);
    await assert.rejects(q("update public.reservas_fiscais set status='reservada' where nota_id=$1",
      ['bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb']), /Assinatura ou periodo de teste encerrado/i);
    await assert.rejects(q('insert into public.reservas_fiscais values($1,$2,$3)',
      ['bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb', empresaA, 'reservada']), /Assinatura ou periodo de teste encerrado/i);
    console.log('OK: Beta 45 e Trial 30 separados, cotas, vencimento, isolamento, pagamento e idempotencia.');
  } finally { await db.close(); }
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
