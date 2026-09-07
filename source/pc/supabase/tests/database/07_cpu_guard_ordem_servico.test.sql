begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

delete from public.ordens_servico
 where empresa_id = '10000000-0000-0000-0000-000000000001'
   and id_exportacao = 'pgtap-cpu-guard';

create or replace function pg_temp.patch_diferente_com_revision_antiga(p_id uuid)
returns boolean language plpgsql as $$
begin
  perform public.atualizar_ordem_servico(
    p_id,
    1,
    '{"status":"Em testes"}'::jsonb
  );
  return false;
exception when serialization_failure then
  return sqlerrm like 'conflito_revision:%';
end
$$;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (public.criar_ordem_servico(
    'pgtap-cpu-guard',
    '{"cliente_nome_snapshot":"CPU Guard","defeito_relatado":"Teste"}'::jsonb
  )).revision,
  1::bigint,
  'fixture inicia na revision 1'
);

select is(
  (public.atualizar_ordem_servico(
    (select id from public.ordens_servico where id_exportacao = 'pgtap-cpu-guard'),
    1,
    '{"status":"Em reparo","valor":"230.00"}'::jsonb
  )).revision,
  2::bigint,
  'patch diferente altera uma unica vez'
);

create temporary table pg_temp.estado_apos_update as
select id, revision, updated_at
  from public.ordens_servico
 where id_exportacao = 'pgtap-cpu-guard';

select is(
  (public.atualizar_ordem_servico(
    (select id from pg_temp.estado_apos_update),
    1,
    '{"status":"Em reparo","valor":230}'::jsonb
  )).revision,
  2::bigint,
  'patch semanticamente igual com revision antiga vira no-op'
);

select is(
  (select revision from public.ordens_servico where id_exportacao = 'pgtap-cpu-guard'),
  2::bigint,
  'no-op nao incrementa revision'
);

select is(
  (select updated_at from public.ordens_servico where id_exportacao = 'pgtap-cpu-guard'),
  (select updated_at from pg_temp.estado_apos_update),
  'no-op nao altera updated_at nem gera evento Realtime'
);

select ok(
  pg_temp.patch_diferente_com_revision_antiga(
    (select id from pg_temp.estado_apos_update)
  ),
  'patch diferente com revision antiga continua retornando conflito'
);

select ok(
  (
    select pg_get_expr(p.polqual, p.polrelid)
             like '%SELECT app_private.current_user_empresa_id()%'
      from pg_policy p
     where p.polrelid = 'public.ordens_servico'::regclass
       and p.polname = 'ordens_select_empresa'
  ),
  'policy usa InitPlan para o contexto da empresa'
);

select ok(
  pg_get_functiondef(
    'public.atualizar_ordem_servico(uuid,bigint,jsonb)'::regprocedure
  ) ilike '%for update%',
  'RPC serializa chamadas concorrentes por OS'
);

select * from finish();
rollback;
