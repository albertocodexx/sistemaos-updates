begin;

alter table if exists public.integracoes_segredos enable row level security;
revoke all on table public.integracoes_segredos from public, anon, authenticated;
grant all on table public.integracoes_segredos to service_role;

alter table if exists public.integracoes_plataforma_segredos enable row level security;
revoke all on table public.integracoes_plataforma_segredos from public, anon, authenticated;
grant all on table public.integracoes_plataforma_segredos to service_role;

commit;
