begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

grant select, insert, update, delete on storage.objects to authenticated;

insert into storage.objects (bucket_id, name)
values ('backups-empresa', '20000000-0000-0000-0000-000000000002/ultimo-backup.json');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select public from storage.buckets where id = 'backups-empresa'),
  false,
  'bucket de backup não é público'
);

select is(
  (select count(*) from storage.objects where bucket_id = 'backups-empresa'),
  0::bigint,
  'administrador A não enxerga backup da empresa B'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('backups-empresa', '10000000-0000-0000-0000-000000000001/ultimo-backup.json')$$,
  'administrador grava somente no prefixo da própria empresa'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('backups-empresa', '20000000-0000-0000-0000-000000000002/invasao.json')$$,
  '42501', null,
  'administrador A não grava no backup da empresa B'
);

select lives_ok(
  $$select public.registrar_backup_empresa(128, repeat('a', 64), 'teste')$$,
  'administrador registra metadados do próprio backup'
);

select is(
  (select count(*) from public.backups_empresa
    where empresa_id = '10000000-0000-0000-0000-000000000001'),
  1::bigint,
  'metadados ficam vinculados à empresa autenticada'
);

select is(
  (select count(*) from public.backups_empresa
    where empresa_id = '20000000-0000-0000-0000-000000000002'),
  0::bigint,
  'metadados de outra empresa não ficam visíveis'
);

select * from finish();
rollback;
