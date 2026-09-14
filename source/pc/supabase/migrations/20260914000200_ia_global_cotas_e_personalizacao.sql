-- Cofre global do assistente, personalizacao controlada e cotas server-side.
-- A chave nunca e exposta a clientes autenticados: somente Edge Functions,
-- usando service_role, podem ler as tabelas de segredos e consumir a cota.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.integracoes_plataforma
  drop constraint if exists integracoes_plataforma_tipo_check;
alter table public.integracoes_plataforma
  add constraint integracoes_plataforma_tipo_check
  check (tipo in ('mercado_pago', 'whatsapp', 'fiscal', 'ia'));

insert into public.integracoes_plataforma (
  tipo, status, provedor, conta_mascarada, metadados
) values (
  'ia', 'desconectada', 'groq', null,
  jsonb_build_object(
    'provedor', 'groq',
    'modelo', 'openai/gpt-oss-20b',
    'personalizacao_empresas_ativa', false,
    'limite_minuto_empresa', 3,
    'limite_mensal_empresa', 300,
    'limite_minuto_global', 30,
    'limite_mensal_global', 10000,
    'max_tokens', 600
  )
) on conflict (tipo) do nothing;

create table if not exists public.ia_cotas_empresa (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  minuto_inicio timestamptz not null default date_trunc('minute', now()),
  minuto_total integer not null default 0 check (minuto_total >= 0),
  mes_inicio timestamptz not null default date_trunc('month', now()),
  mes_total integer not null default 0 check (mes_total >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.ia_cota_global (
  id boolean primary key default true check (id),
  minuto_inicio timestamptz not null default date_trunc('minute', now()),
  minuto_total integer not null default 0 check (minuto_total >= 0),
  mes_inicio timestamptz not null default date_trunc('month', now()),
  mes_total integer not null default 0 check (mes_total >= 0),
  updated_at timestamptz not null default now()
);

insert into public.ia_cota_global (id) values (true) on conflict (id) do nothing;

alter table public.ia_cotas_empresa enable row level security;
alter table public.ia_cota_global enable row level security;
alter table public.ia_cotas_empresa force row level security;
alter table public.ia_cota_global force row level security;
alter table public.integracoes_plataforma force row level security;
alter table public.integracoes_plataforma_segredos force row level security;
revoke all on table public.ia_cotas_empresa from public, anon, authenticated;
revoke all on table public.ia_cota_global from public, anon, authenticated;
grant all on table public.ia_cotas_empresa to service_role;
grant all on table public.ia_cota_global to service_role;

create or replace function public.consumir_cota_ia(
  p_empresa_id uuid,
  p_limite_minuto_empresa integer default 3,
  p_limite_mensal_empresa integer default 300,
  p_limite_minuto_global integer default 30,
  p_limite_mensal_global integer default 10000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := clock_timestamp();
  v_empresa public.ia_cotas_empresa;
  v_global public.ia_cota_global;
  v_lim_min_empresa integer := greatest(1, least(coalesce(p_limite_minuto_empresa, 3), 60));
  v_lim_mes_empresa integer := greatest(1, least(coalesce(p_limite_mensal_empresa, 300), 100000));
  v_lim_min_global integer := greatest(1, least(coalesce(p_limite_minuto_global, 30), 1000));
  v_lim_mes_global integer := greatest(1, least(coalesce(p_limite_mensal_global, 10000), 1000000));
begin
  if p_empresa_id is null or not exists (select 1 from public.empresas e where e.id = p_empresa_id and e.ativo) then
    raise exception using errcode = '42501', message = 'empresa invalida para consumo de IA';
  end if;

  -- Bloqueios em ordem fixa evitam corrida entre varios PCs/celulares.
  perform pg_advisory_xact_lock(hashtextextended('sistemaos:ia:global', 0));
  perform pg_advisory_xact_lock(hashtextextended('sistemaos:ia:empresa:' || p_empresa_id::text, 0));

  insert into public.ia_cota_global (id) values (true) on conflict (id) do nothing;
  select * into v_global from public.ia_cota_global where id = true for update;
  if v_global.minuto_inicio < date_trunc('minute', v_agora) then
    v_global.minuto_inicio := date_trunc('minute', v_agora);
    v_global.minuto_total := 0;
  end if;
  if v_global.mes_inicio < date_trunc('month', v_agora) then
    v_global.mes_inicio := date_trunc('month', v_agora);
    v_global.mes_total := 0;
  end if;
  if v_global.minuto_total >= v_lim_min_global then
    raise exception using errcode = 'P0001', message = 'limite global de IA por minuto atingido';
  end if;
  if v_global.mes_total >= v_lim_mes_global then
    raise exception using errcode = 'P0001', message = 'limite global mensal de IA atingido';
  end if;

  insert into public.ia_cotas_empresa (empresa_id) values (p_empresa_id)
  on conflict (empresa_id) do nothing;
  select * into v_empresa from public.ia_cotas_empresa where empresa_id = p_empresa_id for update;
  if v_empresa.minuto_inicio < date_trunc('minute', v_agora) then
    v_empresa.minuto_inicio := date_trunc('minute', v_agora);
    v_empresa.minuto_total := 0;
  end if;
  if v_empresa.mes_inicio < date_trunc('month', v_agora) then
    v_empresa.mes_inicio := date_trunc('month', v_agora);
    v_empresa.mes_total := 0;
  end if;
  if v_empresa.minuto_total >= v_lim_min_empresa then
    raise exception using errcode = 'P0001', message = 'limite de IA por minuto atingido para esta empresa';
  end if;
  if v_empresa.mes_total >= v_lim_mes_empresa then
    raise exception using errcode = 'P0001', message = 'limite mensal de IA atingido para esta empresa';
  end if;

  update public.ia_cota_global set
    minuto_inicio = v_global.minuto_inicio,
    minuto_total = v_global.minuto_total + 1,
    mes_inicio = v_global.mes_inicio,
    mes_total = v_global.mes_total + 1,
    updated_at = v_agora
  where id = true;
  update public.ia_cotas_empresa set
    minuto_inicio = v_empresa.minuto_inicio,
    minuto_total = v_empresa.minuto_total + 1,
    mes_inicio = v_empresa.mes_inicio,
    mes_total = v_empresa.mes_total + 1,
    updated_at = v_agora
  where empresa_id = p_empresa_id;

  return jsonb_build_object(
    'restante_minuto_empresa', v_lim_min_empresa - v_empresa.minuto_total - 1,
    'restante_mes_empresa', v_lim_mes_empresa - v_empresa.mes_total - 1,
    'restante_minuto_global', v_lim_min_global - v_global.minuto_total - 1,
    'restante_mes_global', v_lim_mes_global - v_global.mes_total - 1
  );
end;
$$;

revoke all on function public.consumir_cota_ia(uuid,integer,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.consumir_cota_ia(uuid,integer,integer,integer,integer)
  to service_role;

comment on function public.consumir_cota_ia(uuid,integer,integer,integer,integer) is
  'Cota atomica por empresa e global. Uso exclusivo das Edge Functions com service_role.';

commit;
