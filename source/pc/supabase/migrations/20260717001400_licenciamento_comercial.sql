-- Etapa comercial 4/5: contratos de licença, planos e administração global.
-- Tudo é aditivo. OS, arquivos e históricos existentes não são regravados.

create table if not exists public.planos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (btrim(nome) <> ''),
  descricao text,
  ativo boolean not null default true,
  preco_referencia numeric(12,2) not null default 0 check (preco_referencia >= 0),
  periodo text not null default 'mensal' check (periodo in ('mensal', 'trimestral', 'semestral', 'anual', 'vitalicio')),
  limites jsonb not null default '{}'::jsonb check (jsonb_typeof(limites) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists planos_nome_uidx on public.planos (lower(nome));

create table if not exists public.recursos (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique check (chave ~ '^[a-z0-9_]{3,60}$'),
  nome text not null check (btrim(nome) <> ''),
  descricao text,
  created_at timestamptz not null default now()
);

create table if not exists public.plano_recursos (
  plano_id uuid not null references public.planos(id) on delete cascade,
  recurso_id uuid not null references public.recursos(id) on delete cascade,
  habilitado boolean not null default true,
  limite bigint check (limite is null or limite >= 0),
  created_at timestamptz not null default now(),
  primary key (plano_id, recurso_id)
);

alter table public.empresas
  add column if not exists codigo text,
  add column if not exists plano_id uuid references public.planos(id) on delete set null,
  add column if not exists inicio_trial timestamptz,
  add column if not exists fim_trial timestamptz,
  add column if not exists data_vencimento timestamptz,
  add column if not exists periodo_graca_ate timestamptz,
  add column if not exists ultimo_pagamento_em timestamptz,
  add column if not exists proximo_vencimento_em timestamptz,
  add column if not exists bloqueado_em timestamptz,
  add column if not exists motivo_bloqueio text,
  add column if not exists limite_usuarios integer check (limite_usuarios is null or limite_usuarios >= 0),
  add column if not exists limite_dispositivos integer check (limite_dispositivos is null or limite_dispositivos >= 0),
  add column if not exists limite_storage bigint check (limite_storage is null or limite_storage >= 0),
  add column if not exists recursos_habilitados jsonb not null default '{}'::jsonb
    check (jsonb_typeof(recursos_habilitados) = 'object');

update public.empresas
set codigo = coalesce(nullif(lower(regexp_replace(codigo, '[^a-z0-9]+', '-', 'g')), ''), 'empresa-' || left(replace(id::text, '-', ''), 8))
where codigo is null or btrim(codigo) = '';

alter table public.empresas alter column codigo set not null;
create unique index if not exists empresas_codigo_uidx on public.empresas (lower(codigo));

update public.empresas
set inicio_trial = coalesce(inicio_trial, created_at),
    fim_trial = coalesce(
      fim_trial,
      case when licenca_status = 'teste'
        then coalesce(licenca_expira_em, created_at + interval '30 days')
        else null
      end
    ),
    data_vencimento = coalesce(data_vencimento, licenca_expira_em),
    proximo_vencimento_em = coalesce(proximo_vencimento_em, licenca_expira_em);

-- O estado efetivo é sempre calculado pelo servidor, nunca pela data local.
create or replace function public.calcular_status_licenca_empresa(
  p_empresa_id uuid,
  p_agora timestamptz default now()
)
returns public.licenca_status
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.empresas%rowtype;
begin
  select * into e from public.empresas where id = p_empresa_id;
  if not found or not e.ativo then return 'bloqueada'; end if;
  if e.licenca_status in ('bloqueada', 'suspensa', 'cancelada') then
    return e.licenca_status;
  end if;
  if e.licenca_status = 'teste' then
    if e.fim_trial is not null and e.fim_trial > p_agora then return 'teste'; end if;
    if e.periodo_graca_ate is not null and e.periodo_graca_ate > p_agora then return 'periodo_graca'; end if;
    return 'vencida';
  end if;
  if e.data_vencimento is not null and e.data_vencimento <= p_agora then
    if e.periodo_graca_ate is not null and e.periodo_graca_ate > p_agora then return 'periodo_graca'; end if;
    return 'vencida';
  end if;
  if e.data_vencimento is not null and e.data_vencimento <= p_agora + interval '15 days' then
    return 'vencendo';
  end if;
  return 'ativa';
end;
$$;

-- Todas as políticas e RPCs passam por este único porteiro. O período de
-- graça mantém acesso; uma licença vencida deixa de receber empresa_id e
-- portanto não consegue ler nem gravar os dados operacionais.
create or replace function app_private.current_user_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.empresa_id
    from public.perfis p
    join public.empresas e on e.id = p.empresa_id
   where p.id = auth.uid()
     and p.ativo
     and e.ativo
     and public.calcular_status_licenca_empresa(e.id, now()) in ('ativa', 'teste', 'vencendo', 'periodo_graca')
   limit 1
$$;

create table if not exists public.administradores_globais (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A identidade técnica fica inacessível pelo cliente. A Edge Function de
-- login a usa apenas para autenticar empresa + usuário + senha.
create table if not exists public.identidades_login (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  usuario text not null check (usuario ~ '^[a-z0-9._-]{3,30}$'),
  email_tecnico text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, usuario_id),
  unique (empresa_id, usuario)
);

create unique index if not exists identidades_login_empresa_usuario_uidx
  on public.identidades_login (empresa_id, lower(usuario));

create table if not exists public.pagamentos_assinatura (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  plano_id uuid references public.planos(id) on delete set null,
  valor numeric(12,2) not null check (valor >= 0),
  vencimento_em timestamptz,
  pago_em timestamptz,
  forma text,
  referencia text,
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'vencido', 'cancelado', 'estornado')),
  observacao text,
  confirmado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pagamentos_assinatura_empresa_idx
  on public.pagamentos_assinatura (empresa_id, created_at desc);

create table if not exists public.eventos_licenca (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('trial_criado', 'trial_prorrogado', 'plano_alterado', 'vencimento_alterado', 'pagamento_confirmado', 'suspensao', 'reativacao', 'bloqueio', 'observacao')),
  motivo text,
  dados jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object'),
  autor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.auditoria_comercial (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) on delete set null,
  autor_id uuid references auth.users(id) on delete set null,
  acao text not null,
  entidade text not null,
  entidade_id text,
  motivo text,
  metadados jsonb not null default '{}'::jsonb check (jsonb_typeof(metadados) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.integracoes_empresa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('mercado_pago', 'whatsapp', 'fiscal', 'email', 'banco')),
  status text not null default 'desconectada' check (status in ('desconectada', 'conectada', 'erro', 'revogada')),
  conta_mascarada text,
  conectado_em timestamptz,
  ultima_verificacao_em timestamptz,
  ultimo_erro text,
  metadados jsonb not null default '{}'::jsonb check (jsonb_typeof(metadados) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, tipo)
);

create table if not exists public.versoes_aplicativo (
  plataforma text primary key check (plataforma in ('windows', 'android')),
  versao_minima text,
  versao_atual text,
  url_atualizacao text,
  sha256 text,
  obrigatoria boolean not null default false,
  publicada_em timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function app_private.eh_administrador_global()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.administradores_globais g
    where g.usuario_id = auth.uid() and g.ativo
  );
$$;

create or replace function app_private.eh_administrador_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.perfis p
    where p.id = auth.uid()
      and p.empresa_id = p_empresa_id
      and p.ativo
      and (
        lower(coalesce(p.cargo, '')) in ('administrador', 'proprietario', 'proprietário')
        or (
          jsonb_typeof(p.permissoes -> 'configuracoes') = 'boolean'
          and (p.permissoes ->> 'configuracoes')::boolean
        )
      )
  );
$$;

create or replace function public.obter_contexto_comercial()
returns table (
  usuario_id uuid,
  perfil_nome text,
  cargo text,
  permissoes jsonb,
  usuario_ativo boolean,
  empresa_id uuid,
  empresa_codigo text,
  empresa_nome text,
  empresa_ativa boolean,
  licenca_status public.licenca_status,
  inicio_trial timestamptz,
  fim_trial timestamptz,
  data_vencimento timestamptz,
  periodo_graca_ate timestamptz,
  plano_nome text,
  recursos_habilitados jsonb,
  administrador_global boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    p.id,
    p.nome,
    p.cargo,
    p.permissoes,
    p.ativo,
    e.id,
    e.codigo,
    e.nome_fantasia,
    e.ativo,
    public.calcular_status_licenca_empresa(e.id, now()),
    e.inicio_trial,
    e.fim_trial,
    e.data_vencimento,
    e.periodo_graca_ate,
    pl.nome,
    e.recursos_habilitados,
    app_private.eh_administrador_global()
  from public.perfis p
  join public.empresas e on e.id = p.empresa_id
  left join public.planos pl on pl.id = e.plano_id
  where p.id = auth.uid();
$$;

create or replace function public.atualizar_licenca_empresa(
  p_empresa_id uuid,
  p_plano_id uuid default null,
  p_inicio_trial timestamptz default null,
  p_fim_trial timestamptz default null,
  p_vencimento timestamptz default null,
  p_graca_ate timestamptz default null,
  p_status public.licenca_status default null,
  p_motivo text default null,
  p_limite_usuarios integer default null,
  p_limite_dispositivos integer default null,
  p_limite_storage bigint default null,
  p_recursos jsonb default null
)
returns public.empresas
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  resultado public.empresas%rowtype;
begin
  if not app_private.eh_administrador_global() then
    raise exception using errcode = '42501', message = 'ação restrita ao administrador global';
  end if;

  update public.empresas e
  set plano_id = coalesce(p_plano_id, e.plano_id),
      inicio_trial = coalesce(p_inicio_trial, e.inicio_trial),
      fim_trial = coalesce(p_fim_trial, e.fim_trial),
      data_vencimento = coalesce(p_vencimento, e.data_vencimento),
      proximo_vencimento_em = coalesce(p_vencimento, e.proximo_vencimento_em),
      periodo_graca_ate = coalesce(p_graca_ate, e.periodo_graca_ate),
      licenca_status = coalesce(p_status, e.licenca_status),
      bloqueado_em = case when p_status in ('bloqueada', 'suspensa', 'cancelada') then now() else null end,
      motivo_bloqueio = case when p_status in ('bloqueada', 'suspensa', 'cancelada') then nullif(btrim(p_motivo), '') else null end,
      limite_usuarios = coalesce(p_limite_usuarios, e.limite_usuarios),
      limite_dispositivos = coalesce(p_limite_dispositivos, e.limite_dispositivos),
      limite_storage = coalesce(p_limite_storage, e.limite_storage),
      recursos_habilitados = coalesce(p_recursos, e.recursos_habilitados),
      updated_at = now()
  where e.id = p_empresa_id
  returning e.* into resultado;

  if not found then raise exception 'empresa não encontrada'; end if;

  -- Recalcula somente depois de gravar as novas datas. Assim uma renovação
  -- não fica marcada como vencida usando o vencimento antigo da linha.
  if p_status is null then
    update public.empresas e
       set licenca_status = public.calcular_status_licenca_empresa(e.id, now()),
           updated_at = now()
     where e.id = p_empresa_id
     returning e.* into resultado;
  end if;

  insert into public.eventos_licenca (empresa_id, tipo, motivo, dados, autor_id)
  values (
    p_empresa_id,
    case when p_status in ('bloqueada', 'suspensa', 'cancelada') then 'bloqueio'
         when p_status = 'ativa' then 'reativacao'
         else 'vencimento_alterado' end,
    nullif(btrim(p_motivo), ''),
    jsonb_build_object('status', resultado.licenca_status, 'vencimento', resultado.data_vencimento),
    auth.uid()
  );
  insert into public.auditoria_comercial (empresa_id, autor_id, acao, entidade, entidade_id, motivo)
  values (p_empresa_id, auth.uid(), 'licenca_atualizada', 'empresa', p_empresa_id::text, nullif(btrim(p_motivo), ''));
  return resultado;
end;
$$;

create or replace function public.confirmar_pagamento_assinatura(
  p_empresa_id uuid,
  p_plano_id uuid,
  p_valor numeric,
  p_vencimento timestamptz,
  p_pago_em timestamptz,
  p_forma text,
  p_referencia text default null,
  p_observacao text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  pagamento_id uuid;
begin
  if not app_private.eh_administrador_global() then
    raise exception using errcode = '42501', message = 'ação restrita ao administrador global';
  end if;
  insert into public.pagamentos_assinatura (
    empresa_id, plano_id, valor, vencimento_em, pago_em, forma, referencia,
    status, observacao, confirmado_por
  ) values (
    p_empresa_id, p_plano_id, p_valor, p_vencimento, coalesce(p_pago_em, now()),
    nullif(btrim(p_forma), ''), nullif(btrim(p_referencia), ''), 'pago',
    nullif(btrim(p_observacao), ''), auth.uid()
  ) returning id into pagamento_id;

  update public.empresas
  set plano_id = coalesce(p_plano_id, plano_id),
      licenca_status = 'ativa',
      ultimo_pagamento_em = coalesce(p_pago_em, now()),
      data_vencimento = p_vencimento,
      proximo_vencimento_em = p_vencimento,
      periodo_graca_ate = null,
      bloqueado_em = null,
      motivo_bloqueio = null,
      updated_at = now()
  where id = p_empresa_id;

  insert into public.eventos_licenca (empresa_id, tipo, motivo, dados, autor_id)
  values (p_empresa_id, 'pagamento_confirmado', null, jsonb_build_object('pagamento_id', pagamento_id), auth.uid());
  insert into public.auditoria_comercial (empresa_id, autor_id, acao, entidade, entidade_id)
  values (p_empresa_id, auth.uid(), 'pagamento_confirmado', 'pagamentos_assinatura', pagamento_id::text);
  return pagamento_id;
end;
$$;

alter table public.planos enable row level security;
alter table public.recursos enable row level security;
alter table public.plano_recursos enable row level security;
alter table public.administradores_globais enable row level security;
alter table public.identidades_login enable row level security;
alter table public.pagamentos_assinatura enable row level security;
alter table public.eventos_licenca enable row level security;
alter table public.auditoria_comercial enable row level security;
alter table public.integracoes_empresa enable row level security;
alter table public.versoes_aplicativo enable row level security;

create policy pagamentos_assinatura_select_empresa on public.pagamentos_assinatura
  for select to authenticated using (empresa_id = app_private.current_user_empresa_id());
create policy eventos_licenca_select_empresa on public.eventos_licenca
  for select to authenticated using (empresa_id = app_private.current_user_empresa_id());
create policy integracoes_empresa_select_admin on public.integracoes_empresa
  for select to authenticated using (app_private.eh_administrador_empresa(empresa_id));
create policy versoes_aplicativo_select_authenticated on public.versoes_aplicativo
  for select to authenticated using (true);
create policy auditoria_comercial_select_global on public.auditoria_comercial
  for select to authenticated using (app_private.eh_administrador_global());
create policy planos_select_global on public.planos
  for select to authenticated using (app_private.eh_administrador_global());
create policy recursos_select_global on public.recursos
  for select to authenticated using (app_private.eh_administrador_global());
create policy plano_recursos_select_global on public.plano_recursos
  for select to authenticated using (app_private.eh_administrador_global());
create policy administradores_globais_select_self on public.administradores_globais
  for select to authenticated using (usuario_id = auth.uid());

grant execute on function public.obter_contexto_comercial() to authenticated;
grant execute on function public.atualizar_licenca_empresa(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, public.licenca_status, text, integer, integer, bigint, jsonb) to authenticated;
grant execute on function public.confirmar_pagamento_assinatura(uuid, uuid, numeric, timestamptz, timestamptz, text, text, text) to authenticated;
grant execute on function app_private.eh_administrador_global() to authenticated;
grant execute on function app_private.eh_administrador_empresa(uuid) to authenticated;

comment on table public.identidades_login is 'Mapa privado empresa+usuário para e-mail técnico; somente Edge Functions/service role acessam.';
comment on table public.integracoes_empresa is 'Somente metadados e status. Segredos pertencem ao backend e nunca são armazenados nesta tabela.';
