-- Relatórios técnicos enviados pelos aplicativos. Cada registro pertence à
-- empresa autenticada; somente a equipe global pode consultar e tratar.
create table if not exists public.relatorios_erros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid references auth.users(id) on delete set null,
  origem text not null check (origem in ('pc', 'android')),
  tela text,
  funcao text,
  mensagem text not null,
  stack_trace text,
  versao text,
  dispositivo text,
  detalhes jsonb not null default '{}'::jsonb check (jsonb_typeof(detalhes) = 'object'),
  prioridade text not null default 'normal' check (prioridade in ('baixa','normal','alta','critica')),
  status text not null default 'aberto' check (status in ('aberto','analisando','resolvido','ignorado')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists relatorios_erros_empresa_data_idx
  on public.relatorios_erros (empresa_id, criado_em desc);
create index if not exists relatorios_erros_status_data_idx
  on public.relatorios_erros (status, criado_em desc);
create index if not exists auditoria_empresas_excluidas_codigo_data_idx
  on public.auditoria_empresas_excluidas (lower(empresa_codigo), excluida_em desc);

alter table public.relatorios_erros enable row level security;
alter table public.relatorios_erros force row level security;
revoke all on table public.relatorios_erros from public, anon, authenticated;
grant insert, select on table public.relatorios_erros to authenticated;

drop policy if exists relatorios_erros_insert_empresa on public.relatorios_erros;
create policy relatorios_erros_insert_empresa on public.relatorios_erros
for insert to authenticated
with check (
  empresa_id = app_private.current_user_empresa_id()
  and usuario_id = auth.uid()
);

drop policy if exists relatorios_erros_select_global on public.relatorios_erros;
create policy relatorios_erros_select_global on public.relatorios_erros
for select to authenticated
using (app_private.eh_administrador_global());

comment on table public.relatorios_erros is
  'Falhas técnicas reportadas pelos clientes PC/Android e tratadas na central global.';
