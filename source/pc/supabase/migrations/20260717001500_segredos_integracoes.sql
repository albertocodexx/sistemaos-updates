-- Segredos de integrações são acessíveis somente por Edge Functions usando
-- service role. O conteúdo é cifrado antes de chegar ao banco.

create table if not exists public.integracoes_segredos (
  integracao_id uuid primary key references public.integracoes_empresa(id) on delete cascade,
  algoritmo text not null default 'AES-GCM-256',
  iv_base64 text not null,
  segredo_cifrado_base64 text not null,
  atualizado_em timestamptz not null default now()
);

alter table public.integracoes_segredos enable row level security;
comment on table public.integracoes_segredos is 'Cifra AES-GCM de segredos individuais. Sem políticas para anon/authenticated; apenas Edge Functions service role.';
