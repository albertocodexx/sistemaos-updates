-- Assinatura PC -> celular -> PC. O pacote é transitório e só pode ser
-- acessado pela Edge Function autenticada; não há compartilhamento por arquivo.
create table if not exists public.solicitacoes_assinatura_remota (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  id_envio_assinatura text not null,
  tipo_documento text not null check (tipo_documento in ('os', 'compra', 'venda', 'entrega')),
  pacote jsonb not null check (jsonb_typeof(pacote) = 'object'),
  resposta jsonb,
  status text not null default 'pendente' check (status in ('pendente', 'respondida', 'concluida', 'cancelada')),
  enviado_por uuid references auth.users(id) on delete set null,
  respondido_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  respondido_em timestamptz,
  concluido_em timestamptz,
  unique (empresa_id, id_envio_assinatura)
);

create index if not exists solicitacoes_assinatura_remota_empresa_status_idx
  on public.solicitacoes_assinatura_remota (empresa_id, status, updated_at desc);

alter table public.solicitacoes_assinatura_remota enable row level security;
alter table public.solicitacoes_assinatura_remota force row level security;
revoke all on table public.solicitacoes_assinatura_remota from anon, authenticated;

drop trigger if exists solicitacoes_assinatura_remota_updated_at on public.solicitacoes_assinatura_remota;
create trigger solicitacoes_assinatura_remota_updated_at
before update on public.solicitacoes_assinatura_remota
for each row execute function public.touch_updated_at();

comment on table public.solicitacoes_assinatura_remota is
  'Fila transitória de assinatura remota via Supabase. Acesso exclusivo pela Edge Function assinaturas-remotas.';
