begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

grant select, insert, update, delete on storage.objects to authenticated;

insert into storage.objects (bucket_id, name)
values ('arquivos-os', '20000000-0000-0000-0000-000000000002/os/teste-b.pdf');

create or replace function pg_temp.tentar_arquivo_empresa_b()
returns boolean language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name)
  values ('arquivos-os', '20000000-0000-0000-0000-000000000002/os/invasao.pdf');
  return false;
exception when insufficient_privilege then
  return true;
end
$$;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*) from storage.buckets
    where id in ('miniaturas', 'arquivos-os', 'documentos-pdf') and public = false),
  3::bigint,
  'buckets permanecem privados'
);

select is(
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'storage_select_empresa', 'storage_insert_empresa',
        'storage_update_empresa', 'storage_delete_empresa'
      )),
  4::bigint,
  'quatro operações do Storage possuem policy multiempresa'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('arquivos-os', '10000000-0000-0000-0000-000000000001/os/teste-a.pdf')$$,
  'empresa A grava no próprio prefixo'
);

select ok(pg_temp.tentar_arquivo_empresa_b(), 'empresa A não grava no prefixo B');

select is(
  (select count(*) from storage.objects
    where name like '20000000-0000-0000-0000-000000000002/%'),
  0::bigint,
  'empresa A não enxerga objetos da empresa B'
);

select * from finish();
rollback;
