-- Etapa 8: livro-razão privado para tornar a migração legada auditável e
-- idempotente. Somente a ferramenta confiável com service_role acessa esta
-- tabela; APK e Electron não recebem nenhum grant.

create table if not exists public.migracoes_legado (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  origem text not null check (btrim(origem) <> ''),
  entidade_tipo text not null check (entidade_tipo in (
    'empresa', 'usuario', 'ordem_servico', 'garantia', 'entrega', 'arquivo'
  )),
  chave_legada text not null check (btrim(chave_legada) <> ''),
  entidade_id uuid,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'concluido' check (status in ('concluido', 'ignorado', 'erro')),
  detalhes jsonb not null default '{}'::jsonb check (jsonb_typeof(detalhes) = 'object'),
  migrado_em timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (origem, entidade_tipo, chave_legada)
);

create index if not exists migracoes_legado_empresa_idx
  on public.migracoes_legado (empresa_id, migrado_em desc);

drop trigger if exists trg_migracoes_legado_updated_at on public.migracoes_legado;
create trigger trg_migracoes_legado_updated_at
before update on public.migracoes_legado
for each row execute function app_private.set_updated_at();

alter table public.migracoes_legado enable row level security;
alter table public.migracoes_legado force row level security;
revoke all on table public.migracoes_legado from public, anon, authenticated;
grant select, insert, update on table public.migracoes_legado to service_role;

comment on table public.migracoes_legado is
  'Livro-razão privado da migração idempotente; acessível somente em ambiente confiável com service_role.';
