begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select has_function('public', 'obter_contexto_autenticacao', array[]::text[]);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select empresa_id from public.obter_contexto_autenticacao()),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'o contexto deriva a empresa exclusivamente do auth.uid()'
);

select is(
  (select usuario_id from public.obter_contexto_autenticacao()),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'a RPC não retorna perfil de outro usuário'
);

select ok(
  (select usuario_ativo and empresa_ativa from public.obter_contexto_autenticacao()),
  'o contexto informa os estados ativos sem depender da policy de negócio'
);

select is(
  (select count(*) from public.obter_contexto_autenticacao()),
  1::bigint,
  'o usuário autenticado recebe no máximo o próprio contexto'
);

select * from finish();
rollback;
