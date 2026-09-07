begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

-- Concessões temporárias validam as policies de escrita; a migration mantém escrita direta revogada.
grant insert, update, delete on public.clientes to authenticated;

create or replace function pg_temp.tentar_inserir_cliente_empresa_b()
returns boolean language plpgsql as $$
begin
  insert into public.clientes (empresa_id, nome, id_exportacao)
  values ('20000000-0000-0000-0000-000000000002', 'Invasão', 'pgtap-cross-company');
  return false;
exception when insufficient_privilege then
  return true;
end
$$;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  app_private.current_user_empresa_id(),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'empresa vem do perfil autenticado'
);

select is(
  (select count(*) from public.clientes),
  1::bigint,
  'usuário A vê inicialmente apenas o cliente A'
);

select is(
  (select count(*) from public.clientes where empresa_id = '20000000-0000-0000-0000-000000000002'),
  0::bigint,
  'usuário A não lê clientes da empresa B'
);

select lives_ok(
  $$insert into public.clientes (empresa_id, nome, id_exportacao)
    values ('10000000-0000-0000-0000-000000000001', 'Cliente RLS A', 'pgtap-own-company')$$,
  'insert da própria empresa passa pela RLS'
);

select is(
  (select count(*) from public.clientes),
  2::bigint,
  'cliente da própria empresa ficou visível'
);

select ok(
  pg_temp.tentar_inserir_cliente_empresa_b(),
  'insert em outra empresa é bloqueado'
);

select is(
  (with alterados as (
    update public.clientes set nome = 'Não pode'
     where id = '22000000-0000-0000-0000-000000000002'
     returning 1
  ) select count(*) from alterados),
  0::bigint,
  'update de outra empresa não alcança nenhuma linha'
);

select is(
  (with excluidos as (
    delete from public.clientes
     where id = '11000000-0000-0000-0000-000000000001'
     returning 1
  ) select count(*) from excluidos),
  0::bigint,
  'sem policy DELETE, exclusão física é bloqueada'
);

select * from finish();
rollback;
