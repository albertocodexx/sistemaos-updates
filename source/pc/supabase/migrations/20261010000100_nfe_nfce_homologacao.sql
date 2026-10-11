-- NF-e/NFC-e no mesmo ledger fiscal da NFS-e, sem misturar testes de
-- homologacao com cota ou saldo financeiro.
alter table public.notas_fiscais
  add column if not exists tipo_documento text not null default 'nfse';

alter table public.notas_fiscais
  drop constraint if exists notas_fiscais_tipo_documento_check;
alter table public.notas_fiscais
  add constraint notas_fiscais_tipo_documento_check
  check (tipo_documento in ('nfse', 'nfe', 'nfce'));

alter table public.notas_fiscais
  drop constraint if exists notas_fiscais_empresa_id_origem_tipo_origem_id_key;
create unique index if not exists notas_fiscais_origem_tipo_documento_uidx
  on public.notas_fiscais (empresa_id, origem_tipo, origem_id, tipo_documento);
create index if not exists notas_fiscais_empresa_tipo_idx
  on public.notas_fiscais (empresa_id, tipo_documento, created_at desc);

create table if not exists public.homologacoes_fiscais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo_documento text not null check (tipo_documento in ('nfse', 'nfe', 'nfce')),
  status text not null default 'aguardando_dados'
    check (status in ('aguardando_dados', 'na_fila', 'processando', 'aprovada', 'rejeitada')),
  referencia_provedor text,
  requisitos jsonb not null default '{}'::jsonb check (jsonb_typeof(requisitos) = 'object'),
  resposta_provedor jsonb not null default '{}'::jsonb check (jsonb_typeof(resposta_provedor) = 'object'),
  tentativas integer not null default 0 check (tentativas between 0 and 1000),
  proxima_tentativa_em timestamptz,
  ultimo_erro text,
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, tipo_documento)
);

create index if not exists homologacoes_fiscais_fila_idx
  on public.homologacoes_fiscais (status, coalesce(proxima_tentativa_em, created_at))
  where status in ('na_fila', 'processando');

alter table public.homologacoes_fiscais enable row level security;
revoke all on public.homologacoes_fiscais from public, anon, authenticated;
grant all on public.homologacoes_fiscais to service_role;

drop trigger if exists trg_homologacoes_fiscais_updated_at on public.homologacoes_fiscais;
create trigger trg_homologacoes_fiscais_updated_at before update on public.homologacoes_fiscais
  for each row execute function app_private.set_updated_at();

-- Homologacoes ficam em tabela propria e nao possuem nota_id. Assim elas nao
-- conseguem chamar reservar_cota_fiscal nem movimentar a carteira por engano.

-- O saldo abaixo e exclusivamente fiscal. Ajustes do suporte exigem uma
-- referencia unica por empresa e nunca podem produzir saldo negativo.
create unique index if not exists movimentos_fiscais_ajuste_suporte_empresa_uidx
  on public.movimentos_fiscais (empresa_id, referencia)
  where tipo = 'ajuste_suporte';
