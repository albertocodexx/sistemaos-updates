begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select ok(
  (public.criar_ordem_servico_mobile_v2(
    'pgtap-os-mobile-cliente-1',
    '{"cliente_nome_snapshot":"Cliente Mobile Perfil","cliente_telefone_snapshot":"11987654321","cliente_cpf_snapshot":"98765432109","defeito_relatado":"Tela"}'::jsonb
  )).cliente_id is not null,
  'OS móvel fica vinculada a um cliente'
);

select ok(
  (select c.numero_cliente >= 10000 from public.clientes c
    join public.ordens_servico o on o.cliente_id=c.id and o.empresa_id=c.empresa_id
   where o.id_exportacao='pgtap-os-mobile-cliente-1'),
  'cliente criado recebe número a partir de 10000'
);

select is(
  (public.criar_ordem_servico_mobile_v2(
    'pgtap-os-mobile-cliente-1',
    '{"cliente_nome_snapshot":"Cliente Mobile Perfil","cliente_telefone_snapshot":"11987654321","cliente_cpf_snapshot":"98765432109","defeito_relatado":"Tela"}'::jsonb
  )).id,
  (select id from public.ordens_servico where id_exportacao='pgtap-os-mobile-cliente-1'),
  'retry devolve a mesma OS'
);

select is(
  (public.criar_ordem_servico_mobile_v2(
    'pgtap-os-mobile-cliente-2',
    '{"cliente_nome_snapshot":"Cliente Mobile Perfil","cliente_telefone_snapshot":"11987654321","cliente_cpf_snapshot":"98765432109","defeito_relatado":"Bateria"}'::jsonb
  )).cliente_id,
  (select cliente_id from public.ordens_servico where id_exportacao='pgtap-os-mobile-cliente-1'),
  'nova OS com o mesmo CPF reutiliza o perfil'
);

select * from finish();
rollback;
