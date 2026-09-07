begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

select has_table('public', 'empresas');
select has_table('public', 'perfis');
select has_table('public', 'configuracoes_empresa');
select has_table('public', 'sequencias_documentos');
select has_table('public', 'dispositivos');
select has_table('public', 'clientes');
select has_table('public', 'ordens_servico');
select has_table('public', 'garantias');
select has_table('public', 'entregas');
select has_table('public', 'compras');
select has_table('public', 'vendas');
select has_table('public', 'arquivos');
select has_table('public', 'operacoes_sincronizacao');

select has_view('public', 'vw_ordens_servico_leve');
select has_view('public', 'vw_garantias_leve');
select has_view('public', 'vw_entregas_leve');
select has_view('public', 'vw_clientes_leve');
select has_view('public', 'vw_compras_leve');
select has_view('public', 'vw_vendas_leve');

select has_function('public', 'registrar_heartbeat', array['text', 'dispositivo_tipo', 'text']);
select has_function('public', 'criar_ordem_servico', array['text', 'jsonb', 'uuid']);
select has_function('public', 'atualizar_ordem_servico', array['uuid', 'bigint', 'jsonb']);
select has_function('public', 'excluir_ordem_servico', array['uuid', 'bigint']);

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name in ('clientes', 'ordens_servico', 'garantias', 'entregas', 'arquivos')
      and lower(column_name) like '%base64%'),
  0::bigint,
  'nenhuma coluna Base64 foi criada'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'empresas', 'perfis', 'configuracoes_empresa', 'sequencias_documentos',
        'dispositivos', 'clientes', 'ordens_servico', 'garantias', 'entregas',
        'compras', 'vendas', 'arquivos', 'operacoes_sincronizacao'
      ) and c.relrowsecurity and c.relforcerowsecurity),
  13::bigint,
  'RLS e FORCE RLS estão ativos em todas as tabelas do contrato'
);

select is(
  (select count(*) from storage.buckets
    where id in ('miniaturas', 'arquivos-os', 'documentos-pdf') and public = false),
  3::bigint,
  'os três buckets são privados'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'vw_ordens_servico_leve', 'vw_garantias_leve', 'vw_entregas_leve',
        'vw_clientes_leve', 'vw_compras_leve', 'vw_vendas_leve'
      )
      and c.reloptions @> array['security_invoker=true']),
  6::bigint,
  'views leves executam com as policies do usuário'
);

select * from finish();
rollback;
