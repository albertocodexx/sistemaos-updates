begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select has_table('public', 'ia_cotas_empresa');
select has_table('public', 'ia_cota_global');

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'integracoes_plataforma_segredos'),
  'cofre global possui RLS e FORCE RLS'
);

select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('integracoes_plataforma_segredos', 'ia_cotas_empresa', 'ia_cota_global')
      and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0::bigint,
  'clientes não recebem privilégios sobre segredos ou cotas'
);

select is(
  has_function_privilege('authenticated', 'public.consumir_cota_ia(uuid,integer,integer,integer,integer)', 'EXECUTE'),
  false,
  'usuário autenticado não pode consumir ou manipular cota diretamente'
);

select is(
  has_function_privilege('anon', 'public.consumir_cota_ia(uuid,integer,integer,integer,integer)', 'EXECUTE'),
  false,
  'usuário anônimo não pode consumir cota'
);

select is(
  (select count(*) from public.integracoes_plataforma where tipo = 'ia'),
  1::bigint,
  'existe uma única configuração global de IA'
);

select is(
  (select metadados->>'personalizacao_empresas_ativa'
     from public.integracoes_plataforma where tipo = 'ia'),
  'false',
  'personalização por empresa nasce desativada'
);

select * from finish();
rollback;
