begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_table('public', 'solicitacoes_arquivo');
select has_column('public', 'arquivos', 'idempotency_key');
select has_function(
  'public', 'registrar_arquivo',
  array['entidade_tipo', 'uuid', 'text', 'jsonb', 'uuid']
);
select has_function('public', 'solicitar_arquivo_local', array['uuid']);

select col_is_pk('public', 'solicitacoes_arquivo', 'id');
select col_not_null('public', 'solicitacoes_arquivo', 'empresa_id');
select col_not_null('public', 'solicitacoes_arquivo', 'arquivo_id');
select col_not_null('public', 'solicitacoes_arquivo', 'usuario_id');

select ok(
  (select c.relrowsecurity and c.relforcerowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'solicitacoes_arquivo'),
  'solicitacoes_arquivo usa RLS e FORCE RLS'
);

select is(
  (select count(*)
     from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'solicitacoes_arquivo'
      and grantee = 'authenticated'
      and privilege_type <> 'SELECT'),
  0::bigint,
  'o app nao recebe escrita direta em solicitacoes_arquivo'
);

select is(
  (select count(*)
     from information_schema.columns
    where table_schema = 'public'
      and table_name in ('arquivos', 'solicitacoes_arquivo')
      and lower(column_name) like '%base64%'),
  0::bigint,
  'o contrato de arquivos nao cria coluna Base64'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.registrar_arquivo(public.entidade_tipo,uuid,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated registra metadados somente pela RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.solicitar_arquivo_local(uuid)',
    'EXECUTE'
  ),
  'authenticated solicita arquivo local somente pela RPC'
);

select is(
  (select count(*) from storage.buckets
    where id in ('miniaturas', 'arquivos-os', 'documentos-pdf') and public = false),
  3::bigint,
  'todos os buckets usados pela Etapa 6 continuam privados'
);

select * from finish();
rollback;
