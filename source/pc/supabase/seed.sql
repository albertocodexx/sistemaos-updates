-- Seed exclusivamente local/de teste. Não executar em produção sem trocar credenciais.

insert into public.empresas (
  id, nome_fantasia, razao_social, cnpj, ativo,
  licenca_status, licenca_expira_em, modo_armazenamento
) values
  ('10000000-0000-0000-0000-000000000001', 'Assistência Teste A', 'Assistência Teste A Ltda', '11111111111111', true, 'ativa', now() + interval '1 year', 'economico'),
  ('20000000-0000-0000-0000-000000000002', 'Assistência Teste B', 'Assistência Teste B Ltda', '22222222222222', true, 'ativa', now() + interval '1 year', 'nuvem')
on conflict (id) do update set
  nome_fantasia = excluded.nome_fantasia,
  ativo = excluded.ativo,
  licenca_status = excluded.licenca_status,
  licenca_expira_em = excluded.licenca_expira_em,
  modo_armazenamento = excluded.modo_armazenamento;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'admin-a@teste.local',
    extensions.crypt('Teste123456!', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nome":"Administrador A"}'::jsonb, now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'bbbbbbbb-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'admin-b@teste.local',
    extensions.crypt('Teste123456!', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nome":"Administrador B"}'::jsonb, now(), now(), '', '', '', ''
  )
on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  updated_at = now();

insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","email":"admin-a@teste.local"}'::jsonb,
    'email', now(), now(), now()
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000002',
    'bbbbbbbb-0000-0000-0000-000000000002',
    '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","email":"admin-b@teste.local"}'::jsonb,
    'email', now(), now(), now()
  )
on conflict (provider_id, provider) do update set
  identity_data = excluded.identity_data,
  updated_at = now();

insert into public.perfis (
  id, empresa_id, nome, cargo, permissoes, ativo
) values
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Administrador A', 'Administrador',
    '{"*":{"*":true},"os":{"ler":true,"criar":true,"editar":true,"excluir":true},"clientes":{"ler":true,"criar":true,"editar":true},"estoque":{"ler":true,"criar":true,"editar":true},"vendas":{"ler":true,"criar":true,"editar":true},"configuracoes":{"editar":true}}'::jsonb,
    true
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'Administrador B', 'Administrador',
    '{"*":{"*":true},"os":{"ler":true,"criar":true,"editar":true,"excluir":true},"clientes":{"ler":true,"criar":true,"editar":true},"estoque":{"ler":true,"criar":true,"editar":true},"vendas":{"ler":true,"criar":true,"editar":true},"configuracoes":{"editar":true}}'::jsonb,
    true
  )
on conflict (id) do update set
  empresa_id = excluded.empresa_id,
  nome = excluded.nome,
  cargo = excluded.cargo,
  permissoes = excluded.permissoes,
  ativo = excluded.ativo;

insert into public.configuracoes_empresa (empresa_id, configuracoes, feature_flags)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '{"janelaHeartbeatSegundos":90}'::jsonb,
    '{"supabaseAtivo":true,"storageProvider":"supabase-storage"}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '{"janelaHeartbeatSegundos":90}'::jsonb,
    '{"supabaseAtivo":true,"storageProvider":"supabase-storage"}'::jsonb
  )
on conflict (empresa_id) do update set
  configuracoes = excluded.configuracoes,
  feature_flags = excluded.feature_flags;

insert into public.clientes (
  id, empresa_id, nome, telefone, cpf, email, id_exportacao
) values
  (
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Cliente da Empresa A', '27999990001', '11111111111',
    'cliente-a@teste.local', 'seed-cliente-a'
  ),
  (
    '22000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'Cliente da Empresa B', '27999990002', '22222222222',
    'cliente-b@teste.local', 'seed-cliente-b'
  )
on conflict (id) do update set
  nome = excluded.nome,
  telefone = excluded.telefone,
  email = excluded.email,
  deleted_at = null;
