-- Chamados de suporte podem ser abertos antes do login e acompanhados apenas
-- pela conta de suporte global. A escrita pública ocorre exclusivamente pela
-- Edge Function, que valida empresa, conteúdo e repetição.
create table if not exists public.chamados_suporte (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) on delete set null,
  origem text not null check (origem in ('login_pc', 'login_celular', 'config_pc', 'config_celular')),
  contato_nome text,
  contato_usuario text,
  contato text,
  mensagem text not null check (char_length(mensagem) between 10 and 4000),
  status text not null default 'aberto' check (status in ('aberto', 'em_atendimento', 'resolvido', 'fechado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atendido_por uuid references auth.users(id) on delete set null,
  resolucao text
);

create index if not exists chamados_suporte_status_criado_idx
  on public.chamados_suporte (status, criado_em desc);
create index if not exists chamados_suporte_empresa_criado_idx
  on public.chamados_suporte (empresa_id, criado_em desc);

alter table public.chamados_suporte enable row level security;

