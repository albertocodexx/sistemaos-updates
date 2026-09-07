begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

delete from public.ordens_servico
 where empresa_id = '10000000-0000-0000-0000-000000000001'
   and id_exportacao like 'pgtap-os-%';
delete from public.sequencias_documentos
 where empresa_id = '10000000-0000-0000-0000-000000000001' and tipo = 'os';

create or replace function pg_temp.tentar_revision_antiga(p_id uuid)
returns boolean language plpgsql as $$
begin
  perform public.atualizar_ordem_servico(p_id, 1, '{"status":"Em reparo"}'::jsonb);
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
    'pgtap-os-1',
    '{"cliente_nome_snapshot":"Cliente RPC","defeito_relatado":"Tela quebrada"}'::jsonb
  )).numero,
  'OS-0001',
  'primeira OS recebe número oficial'
);

select is(
  (public.criar_ordem_servico(
    'pgtap-os-1',
    '{"cliente_nome_snapshot":"Cliente RPC","defeito_relatado":"Tela quebrada"}'::jsonb
  )).numero,
  'OS-0001',
  'repetir idExportacao devolve a mesma OS'
);

select is(
  (select count(*) from public.ordens_servico where id_exportacao = 'pgtap-os-1'),
  1::bigint,
  'idempotência não duplica registro'
);

select is(
  (public.criar_ordem_servico(
    'pgtap-os-2',
    '{"cliente_nome_snapshot":"Outro Cliente","defeito_relatado":"Sem áudio"}'::jsonb
  )).numero,
  'OS-0002',
  'contador avança sem calcular último número no cliente'
);

select is(
  (select revision from public.ordens_servico where id_exportacao = 'pgtap-os-1'),
  1::bigint,
  'nova OS começa na revision 1'
);

select is(
  (public.atualizar_ordem_servico(
    (select id from public.ordens_servico where id_exportacao = 'pgtap-os-1'),
    1,
    '{"status":"Em diagnóstico"}'::jsonb
  )).revision,
  2::bigint,
  'update com revision esperada incrementa atomicamente'
);

select ok(
  pg_temp.tentar_revision_antiga(
    (select id from public.ordens_servico where id_exportacao = 'pgtap-os-1')
  ),
  'revision desatualizada retorna conflito'
);

select ok(
  (public.excluir_ordem_servico(
    (select id from public.ordens_servico where id_exportacao = 'pgtap-os-1'),
    2
  )).deleted_at is not null,
  'exclusão pela RPC é lógica'
);

select is(
  (select count(*) from public.vw_ordens_servico_leve where numero = 'OS-0001'),
  0::bigint,
  'registro logicamente excluído sai da consulta leve'
);

select * from finish();
rollback;
