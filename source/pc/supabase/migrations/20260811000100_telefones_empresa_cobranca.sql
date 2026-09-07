-- Mantém separados o contato geral da empresa e o número usado para avisos
-- de assinatura. O contato de cobrança já existia; estes campos registram
-- explicitamente quando a empresa não possui telefone principal.
alter table public.empresas
  add column if not exists telefone_principal text,
  add column if not exists empresa_sem_telefone boolean not null default false;

comment on column public.empresas.telefone_principal is
  'Telefone geral da empresa, somente dígitos com DDI/DDD quando informado.';
comment on column public.empresas.empresa_sem_telefone is
  'Confirmação explícita de que a empresa não possui telefone principal.';

update public.empresas
set empresa_sem_telefone = true
where telefone_principal is null
  and coalesce(empresa_sem_telefone, false) = false;
