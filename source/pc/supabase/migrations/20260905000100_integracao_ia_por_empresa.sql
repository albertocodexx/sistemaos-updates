-- Assistente de IA configurável por empresa. A credencial permanece somente
-- em integracoes_segredos (service_role); clientes recebem apenas metadados.
alter table public.integracoes_empresa
  drop constraint if exists integracoes_empresa_tipo_check;

alter table public.integracoes_empresa
  add constraint integracoes_empresa_tipo_check
  check (tipo in ('mercado_pago', 'whatsapp', 'fiscal', 'email', 'banco', 'ia'));

comment on column public.integracoes_empresa.metadados is
  'Configuração pública da integração. Segredos são armazenados separadamente em integracoes_segredos.';
