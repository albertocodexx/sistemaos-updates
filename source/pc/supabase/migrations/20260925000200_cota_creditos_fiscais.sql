-- Cotas e creditos fiscais por empresa. Valores monetarios em centavos.
-- Uma reserva e criada antes do envio ao provedor; rejeicao libera a cota e estorna o credito.
create table if not exists public.contas_fiscais (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  limite_gratuito_mensal integer not null default 100 check (limite_gratuito_mensal between 0 and 1000000),
  preco_excedente_centavos integer not null default 20 check (preco_excedente_centavos between 0 and 10000000),
  saldo_centavos bigint not null default 0 check (saldo_centavos >= 0),
  debito_pendente_centavos bigint not null default 0 check (debito_pendente_centavos >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.recargas_fiscais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  valor_centavos integer not null check (valor_centavos between 100 and 10000000),
  referencia_externa text not null unique,
  idempotency_key uuid not null default gen_random_uuid(),
  status text not null default 'pendente' check (status in ('pendente','em_processamento','aprovada','rejeitada','cancelada','estorno_parcial','estornada')),
  checkout_url text,
  preferencia_id text,
  pagamento_provedor_id text unique,
  expira_em timestamptz,
  aplicado_em timestamptz,
  estornado_em timestamptz,
  valor_estornado_centavos integer not null default 0 check (valor_estornado_centavos >= 0 and valor_estornado_centavos <= valor_centavos),
  ultima_verificacao_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists recargas_fiscais_empresa_idx on public.recargas_fiscais (empresa_id, criado_em desc);
create index if not exists recargas_fiscais_conciliacao_idx on public.recargas_fiscais (ultima_verificacao_em nulls first)
  where estornado_em is null;

create table if not exists public.movimentos_fiscais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  tipo text not null check (tipo in ('recarga_mp','ajuste_suporte','reserva','estorno_reserva','estorno_mp')),
  valor_centavos bigint not null check (valor_centavos <> 0),
  referencia text not null,
  motivo text,
  criado_em timestamptz not null default now(),
  unique (tipo, referencia)
);
create index if not exists movimentos_fiscais_empresa_idx on public.movimentos_fiscais (empresa_id, criado_em desc);

create table if not exists public.reservas_fiscais (
  nota_id uuid primary key references public.notas_fiscais(id) on delete restrict,
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  tentativa_id uuid not null default gen_random_uuid(),
  competencia date not null,
  custo_centavos integer not null check (custo_centavos >= 0),
  status text not null default 'reservada' check (status in ('reservada','consumida','liberada')),
  criada_em timestamptz not null default now(),
  consumida_em timestamptz,
  liberada_em timestamptz
);
create index if not exists reservas_fiscais_cota_idx on public.reservas_fiscais (empresa_id, competencia, status);

-- Limites adicionais da equipe. O limite da empresa e o saldo continuam sendo
-- os tetos finais; as regras de usuario/cargo nunca criam credito.
create table if not exists public.limites_emissao_fiscal (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo_alvo text not null check (tipo_alvo in ('usuario','cargo')),
  alvo text not null check (char_length(btrim(alvo)) between 1 and 120),
  limite_mensal integer check (limite_mensal between 0 and 1000000),
  limite_gasto_centavos bigint check (limite_gasto_centavos between 0 and 1000000000),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, tipo_alvo, alvo),
  check (limite_mensal is not null or limite_gasto_centavos is not null)
);
alter table public.reservas_fiscais
  add column if not exists solicitante_id uuid,
  add column if not exists cargo_solicitante text;
create index if not exists reservas_fiscais_usuario_idx on public.reservas_fiscais
  (empresa_id, solicitante_id, competencia, status);
create index if not exists reservas_fiscais_cargo_idx on public.reservas_fiscais
  (empresa_id, cargo_solicitante, competencia, status);

-- A exclusao antiga da empresa antecede as tabelas fiscais. Falhar de forma
-- explicita e transacional evita apagar OS/cliente e depois descobrir uma FK,
-- alem de preservar documentos fiscais e o historico financeiro para revisao.
create or replace function public.bloquear_exclusao_empresa_com_fiscal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.notas_fiscais where empresa_id = old.id) or
     exists (select 1 from public.recargas_fiscais where empresa_id = old.id) or
     exists (select 1 from public.movimentos_fiscais where empresa_id = old.id) then
    raise exception using errcode = '23503',
      message = 'Empresa possui documentos ou movimentacoes fiscais. Arquive e revise a retencao antes da exclusao definitiva.';
  end if;
  return old;
end $$;
revoke all on function public.bloquear_exclusao_empresa_com_fiscal() from public, anon, authenticated;
drop trigger if exists trg_bloquear_exclusao_empresa_com_fiscal on public.empresas;
create trigger trg_bloquear_exclusao_empresa_com_fiscal before delete on public.empresas
  for each row execute function public.bloquear_exclusao_empresa_com_fiscal();

-- Notas anteriores a esta migracao ja pertencem a uma competencia. Sem esta
-- conciliacao, as 100 notas gratuitas seriam concedidas novamente no mes.
insert into public.reservas_fiscais
  (nota_id, empresa_id, competencia, custo_centavos, status, criada_em, consumida_em)
select n.id, n.empresa_id,
  date_trunc('month', coalesce(n.emitida_em, n.created_at) at time zone 'America/Sao_Paulo')::date,
  0, 'consumida', n.created_at, coalesce(n.emitida_em, n.created_at)
from public.notas_fiscais n where n.status = 'autorizada'
on conflict (nota_id) do nothing;
insert into public.reservas_fiscais
  (nota_id, empresa_id, competencia, custo_centavos, status, criada_em)
select n.id, n.empresa_id,
  date_trunc('month', n.created_at at time zone 'America/Sao_Paulo')::date,
  0, 'reservada', n.created_at
from public.notas_fiscais n where n.status in ('na_fila', 'processando')
on conflict (nota_id) do nothing;

alter table public.contas_fiscais enable row level security;
alter table public.recargas_fiscais enable row level security;
alter table public.movimentos_fiscais enable row level security;
alter table public.reservas_fiscais enable row level security;
alter table public.limites_emissao_fiscal enable row level security;
-- Nenhuma policy de escrita para authenticated/anon: todo mutacao passa por Edge Function e RPC service_role.
revoke all on public.contas_fiscais, public.recargas_fiscais, public.movimentos_fiscais,
  public.reservas_fiscais, public.limites_emissao_fiscal from anon, authenticated;

create or replace function public.definir_limite_emissao_fiscal(
  p_empresa_id uuid, p_tipo_alvo text, p_alvo text,
  p_limite_mensal integer, p_limite_gasto_centavos bigint, p_autor_id uuid
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_alvo text; v_regra public.limites_emissao_fiscal%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;
  if not exists (select 1 from public.perfis where id = p_autor_id and empresa_id = p_empresa_id
      and ativo and lower(btrim(cargo)) in ('administrador','admin','proprietario','proprietário')) then
    raise exception using errcode = '42501', message = 'administrador da empresa invalido';
  end if;
  if p_tipo_alvo not in ('usuario','cargo') or
      (p_limite_mensal is null and p_limite_gasto_centavos is null) or
      (p_limite_mensal is not null and p_limite_mensal not between 0 and 1000000) or
      (p_limite_gasto_centavos is not null and p_limite_gasto_centavos not between 0 and 1000000000) then
    raise exception 'limite fiscal invalido';
  end if;
  v_alvo := lower(btrim(coalesce(p_alvo,'')));
  if length(v_alvo) < 1 or length(v_alvo) > 120 then raise exception 'alvo invalido'; end if;
  if p_tipo_alvo = 'usuario' and not exists (
    select 1 from public.perfis where id::text = v_alvo and empresa_id = p_empresa_id and ativo
  ) then raise exception 'usuario ativo nao pertence a empresa'; end if;
  if p_tipo_alvo = 'cargo' and not exists (
    select 1 from public.perfis where empresa_id = p_empresa_id and lower(btrim(cargo)) = v_alvo and ativo
  ) then raise exception 'cargo ativo nao pertence a empresa'; end if;
  insert into public.contas_fiscais (empresa_id) values (p_empresa_id) on conflict do nothing;
  perform 1 from public.contas_fiscais where empresa_id = p_empresa_id for update;
  insert into public.limites_emissao_fiscal
    (empresa_id,tipo_alvo,alvo,limite_mensal,limite_gasto_centavos)
  values (p_empresa_id,p_tipo_alvo,v_alvo,p_limite_mensal,p_limite_gasto_centavos)
  on conflict (empresa_id,tipo_alvo,alvo) do update set
    limite_mensal = excluded.limite_mensal,
    limite_gasto_centavos = excluded.limite_gasto_centavos,
    atualizado_em = now()
  returning * into v_regra;
  insert into public.auditoria_comercial (empresa_id,autor_id,acao,entidade,entidade_id,metadados)
    values (p_empresa_id,p_autor_id,'limite_fiscal_definido','limite_fiscal',p_tipo_alvo || ':' || v_alvo,
      jsonb_build_object('limite_mensal',p_limite_mensal,'limite_gasto_centavos',p_limite_gasto_centavos));
  return to_jsonb(v_regra);
end $$;

create or replace function public.remover_limite_emissao_fiscal(
  p_empresa_id uuid, p_tipo_alvo text, p_alvo text, p_autor_id uuid
) returns boolean language plpgsql security definer set search_path = public, auth as $$
declare v_removido boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;
  if not exists (select 1 from public.perfis where id = p_autor_id and empresa_id = p_empresa_id
      and ativo and lower(btrim(cargo)) in ('administrador','admin','proprietario','proprietário')) then
    raise exception using errcode = '42501', message = 'administrador da empresa invalido';
  end if;
  perform 1 from public.contas_fiscais where empresa_id = p_empresa_id for update;
  delete from public.limites_emissao_fiscal
    where empresa_id = p_empresa_id and tipo_alvo = p_tipo_alvo and alvo = lower(btrim(coalesce(p_alvo,'')));
  v_removido := found;
  if v_removido then
    insert into public.auditoria_comercial (empresa_id,autor_id,acao,entidade,entidade_id)
      values (p_empresa_id,p_autor_id,'limite_fiscal_removido','limite_fiscal',p_tipo_alvo || ':' || lower(btrim(p_alvo)));
  end if;
  return v_removido;
end $$;

create or replace function public.aplicar_recarga_fiscal(
  p_recarga_id uuid, p_pagamento_id text
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare r public.recargas_fiscais%rowtype; v_liquido integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;
  if nullif(btrim(p_pagamento_id), '') is null then raise exception 'pagamento sem identificador'; end if;
  select * into r from public.recargas_fiscais where id = p_recarga_id for update;
  if not found then raise exception 'recarga nao encontrada'; end if;
  if r.aplicado_em is not null then
    if r.pagamento_provedor_id <> p_pagamento_id then raise exception 'pagamento divergente'; end if;
    return jsonb_build_object('aplicado', false, 'ja_aplicado', true);
  end if;
  if r.status <> 'aprovada' or r.pagamento_provedor_id <> p_pagamento_id then
    raise exception 'recarga nao aprovada';
  end if;
  v_liquido := r.valor_centavos - r.valor_estornado_centavos;
  if v_liquido <= 0 then raise exception 'recarga integralmente estornada'; end if;
  insert into public.contas_fiscais (empresa_id) values (r.empresa_id) on conflict do nothing;
  update public.contas_fiscais set
    saldo_centavos = saldo_centavos + greatest(0, v_liquido - debito_pendente_centavos),
    debito_pendente_centavos = greatest(0, debito_pendente_centavos - v_liquido),
    updated_at = now()
    where empresa_id = r.empresa_id;
  insert into public.movimentos_fiscais (empresa_id,tipo,valor_centavos,referencia)
    values (r.empresa_id,'recarga_mp',v_liquido,r.id::text);
  update public.recargas_fiscais set aplicado_em = now() where id = r.id;
  return jsonb_build_object('aplicado', true, 'valor_centavos', v_liquido);
end $$;

create or replace function public.estornar_recarga_fiscal(p_recarga_id uuid, p_pagamento_id text, p_total_estornado_centavos integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare r public.recargas_fiscais%rowtype; v_delta integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;
  select * into r from public.recargas_fiscais where id = p_recarga_id for update;
  if not found or r.pagamento_provedor_id <> p_pagamento_id then raise exception 'recarga ou pagamento divergente'; end if;
  if p_total_estornado_centavos < 0 or p_total_estornado_centavos > r.valor_centavos then
    raise exception 'valor estornado invalido';
  end if;
  v_delta := p_total_estornado_centavos - r.valor_estornado_centavos;
  if v_delta <= 0 then return jsonb_build_object('estornado', false, 'ja_estornado', true); end if;
  if r.aplicado_em is not null then
    update public.contas_fiscais set
      debito_pendente_centavos = debito_pendente_centavos + greatest(0, v_delta - saldo_centavos),
      saldo_centavos = greatest(0, saldo_centavos - v_delta), updated_at = now()
      where empresa_id = r.empresa_id;
    insert into public.movimentos_fiscais (empresa_id,tipo,valor_centavos,referencia)
      values (r.empresa_id,'estorno_mp',-v_delta,r.id::text || ':' || p_total_estornado_centavos::text);
  end if;
  update public.recargas_fiscais set
    status = case when p_total_estornado_centavos = valor_centavos then 'estornada' else 'estorno_parcial' end,
    valor_estornado_centavos = p_total_estornado_centavos,
    estornado_em = case when p_total_estornado_centavos = valor_centavos then now() else null end
    where id = r.id;
  return jsonb_build_object('estornado', true, 'delta_centavos', v_delta);
end $$;

create or replace function public.ajustar_conta_fiscal(
  p_empresa_id uuid, p_limite integer default null, p_preco_centavos integer default null,
  p_ajuste_centavos bigint default 0, p_referencia text default null, p_motivo text default null
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare c public.contas_fiscais%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;
  if p_limite is not null and p_limite not between 0 and 1000000 then raise exception 'limite invalido'; end if;
  if p_preco_centavos is not null and p_preco_centavos not between 0 and 10000000 then raise exception 'preco invalido'; end if;
  if p_ajuste_centavos <> 0 and nullif(btrim(p_referencia), '') is null then raise exception 'justificativa obrigatoria'; end if;
  if p_ajuste_centavos <> 0 and length(btrim(coalesce(p_motivo,''))) < 8 then raise exception 'motivo insuficiente'; end if;
  insert into public.contas_fiscais (empresa_id) values (p_empresa_id) on conflict do nothing;
  select * into c from public.contas_fiscais where empresa_id = p_empresa_id for update;
  if p_ajuste_centavos <> 0 and exists (
    select 1 from public.movimentos_fiscais where tipo = 'ajuste_suporte' and referencia = p_referencia
      and empresa_id = p_empresa_id and valor_centavos = p_ajuste_centavos
  ) then return to_jsonb(c); end if;
  if c.saldo_centavos + p_ajuste_centavos < 0 then raise exception 'saldo insuficiente'; end if;
  update public.contas_fiscais set
    limite_gratuito_mensal = coalesce(p_limite, limite_gratuito_mensal),
    preco_excedente_centavos = coalesce(p_preco_centavos, preco_excedente_centavos),
    saldo_centavos = case when p_ajuste_centavos > 0
      then saldo_centavos + greatest(0, p_ajuste_centavos - debito_pendente_centavos)
      else saldo_centavos + p_ajuste_centavos end,
    debito_pendente_centavos = case when p_ajuste_centavos > 0
      then greatest(0, debito_pendente_centavos - p_ajuste_centavos)
      else debito_pendente_centavos end,
    updated_at = now()
    where empresa_id = p_empresa_id;
  if p_ajuste_centavos <> 0 then
    insert into public.movimentos_fiscais (empresa_id,tipo,valor_centavos,referencia,motivo)
      values (p_empresa_id,'ajuste_suporte',p_ajuste_centavos,p_referencia,left(btrim(p_motivo),300));
  end if;
  return (select to_jsonb(contas_fiscais) from public.contas_fiscais where empresa_id = p_empresa_id);
end $$;

create or replace function public.reservar_cota_fiscal(p_nota_id uuid, p_usuario_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare n public.notas_fiscais%rowtype; c public.contas_fiscais%rowtype;
declare v_competencia date; v_utilizadas integer; v_custo integer; v_tentativa uuid := gen_random_uuid();
declare v_cargo text; v_regra record; v_usadas integer; v_gasto bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;
  select * into n from public.notas_fiscais where id = p_nota_id for update;
  if not found then raise exception 'nota nao encontrada'; end if;
  if n.status = 'autorizada' then return jsonb_build_object('reutilizada', true); end if;
  if exists (select 1 from public.reservas_fiscais where nota_id = p_nota_id and status in ('reservada','consumida')) then
    return jsonb_build_object('reutilizada', true);
  end if;
  if n.status not in ('rascunho','aguardando_configuracao','rejeitada') then raise exception 'nota ja esta em processamento'; end if;
  select lower(btrim(p.cargo)) into v_cargo from public.perfis p
    where p.id = p_usuario_id and p.empresa_id = n.empresa_id and p.ativo;
  if not found then raise exception using errcode = '42501', message = 'usuario emissor inativo ou de outra empresa'; end if;
  insert into public.contas_fiscais (empresa_id) values (n.empresa_id) on conflict do nothing;
  select * into c from public.contas_fiscais where empresa_id = n.empresa_id for update;
  v_competencia := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  select count(*) into v_utilizadas from public.reservas_fiscais
    where empresa_id = n.empresa_id and competencia = v_competencia and status in ('reservada','consumida');
  v_custo := case when v_utilizadas < c.limite_gratuito_mensal then 0 else c.preco_excedente_centavos end;
  if c.debito_pendente_centavos > 0 or c.saldo_centavos < v_custo then
    raise exception using errcode = 'P0001', message = 'saldo fiscal insuficiente';
  end if;
  for v_regra in
    select * from public.limites_emissao_fiscal
    where empresa_id = n.empresa_id and (
      (tipo_alvo = 'usuario' and alvo = p_usuario_id::text) or
      (tipo_alvo = 'cargo' and alvo = v_cargo)
    )
  loop
    select count(*), coalesce(sum(custo_centavos), 0)
      into v_usadas, v_gasto
      from public.reservas_fiscais
      where empresa_id = n.empresa_id and competencia = v_competencia
        and status in ('reservada','consumida') and
        ((v_regra.tipo_alvo = 'usuario' and solicitante_id = p_usuario_id) or
         (v_regra.tipo_alvo = 'cargo' and cargo_solicitante = v_cargo));
    if v_regra.limite_mensal is not null and v_usadas >= v_regra.limite_mensal then
      raise exception using errcode = 'P0001', message = 'limite mensal de emissao do usuario ou cargo atingido';
    end if;
    if v_regra.limite_gasto_centavos is not null and v_gasto + v_custo > v_regra.limite_gasto_centavos then
      raise exception using errcode = 'P0001', message = 'limite de gasto fiscal do usuario ou cargo atingido';
    end if;
  end loop;
  if v_custo > 0 then
    update public.contas_fiscais set saldo_centavos = saldo_centavos - v_custo, updated_at = now() where empresa_id = n.empresa_id;
    insert into public.movimentos_fiscais (empresa_id,tipo,valor_centavos,referencia)
      values (n.empresa_id,'reserva',-v_custo,p_nota_id::text || ':' || v_tentativa::text);
  end if;
  insert into public.reservas_fiscais (nota_id,empresa_id,tentativa_id,competencia,custo_centavos,status,solicitante_id,cargo_solicitante)
    values (p_nota_id,n.empresa_id,v_tentativa,v_competencia,v_custo,'reservada',p_usuario_id,v_cargo)
    on conflict (nota_id) do update set competencia = excluded.competencia, custo_centavos = excluded.custo_centavos,
      tentativa_id = excluded.tentativa_id, status = 'reservada', criada_em = now(), liberada_em = null,
      solicitante_id = excluded.solicitante_id, cargo_solicitante = excluded.cargo_solicitante;
  update public.notas_fiscais set status = 'na_fila', ultimo_erro = null where id = p_nota_id;
  return jsonb_build_object('reservada', true, 'custo_centavos', v_custo, 'saldo_centavos', c.saldo_centavos - v_custo);
end $$;

create or replace function public.finalizar_reserva_fiscal(p_nota_id uuid, p_autorizada boolean)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare r public.reservas_fiscais%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;
  select * into r from public.reservas_fiscais where nota_id = p_nota_id for update;
  if not found then raise exception 'reserva fiscal ausente'; end if;
  if r.status <> 'reservada' then return jsonb_build_object('alterada', false, 'status', r.status); end if;
  if p_autorizada then
    update public.reservas_fiscais set status = 'consumida', consumida_em = now() where nota_id = p_nota_id;
  else
    if r.custo_centavos > 0 then
      update public.contas_fiscais set
        saldo_centavos = saldo_centavos + greatest(0, r.custo_centavos - debito_pendente_centavos),
        debito_pendente_centavos = greatest(0, debito_pendente_centavos - r.custo_centavos),
        updated_at = now()
        where empresa_id = r.empresa_id;
      insert into public.movimentos_fiscais (empresa_id,tipo,valor_centavos,referencia)
        values (r.empresa_id,'estorno_reserva',r.custo_centavos,p_nota_id::text || ':' || r.tentativa_id::text)
        on conflict (tipo,referencia) do nothing;
    end if;
    update public.reservas_fiscais set status = 'liberada', liberada_em = now() where nota_id = p_nota_id;
  end if;
  return jsonb_build_object('alterada', true, 'status', case when p_autorizada then 'consumida' else 'liberada' end);
end $$;

revoke all on function public.aplicar_recarga_fiscal(uuid,text) from public, anon, authenticated;
revoke all on function public.estornar_recarga_fiscal(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.ajustar_conta_fiscal(uuid,integer,integer,bigint,text,text) from public, anon, authenticated;
revoke all on function public.reservar_cota_fiscal(uuid,uuid) from public, anon, authenticated;
revoke all on function public.finalizar_reserva_fiscal(uuid,boolean) from public, anon, authenticated;
revoke all on function public.definir_limite_emissao_fiscal(uuid,text,text,integer,bigint,uuid) from public, anon, authenticated;
revoke all on function public.remover_limite_emissao_fiscal(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.aplicar_recarga_fiscal(uuid,text) to service_role;
grant execute on function public.estornar_recarga_fiscal(uuid,text,integer) to service_role;
grant execute on function public.ajustar_conta_fiscal(uuid,integer,integer,bigint,text,text) to service_role;
grant execute on function public.reservar_cota_fiscal(uuid,uuid) to service_role;
grant execute on function public.finalizar_reserva_fiscal(uuid,boolean) to service_role;
grant execute on function public.definir_limite_emissao_fiscal(uuid,text,text,integer,bigint,uuid) to service_role;
grant execute on function public.remover_limite_emissao_fiscal(uuid,text,text,uuid) to service_role;

create or replace function public.sincronizar_reserva_fiscal()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if new.status = old.status then return new; end if;
  if new.status = 'autorizada' then
    if not exists (select 1 from public.reservas_fiscais where nota_id = new.id and status = 'reservada') then
      raise exception 'autorizacao fiscal sem reserva';
    end if;
    perform public.finalizar_reserva_fiscal(new.id, true);
  elsif new.status in ('rejeitada','cancelada') and old.status in ('na_fila','processando') then
    if exists (select 1 from public.reservas_fiscais where nota_id = new.id and status = 'reservada') then
      perform public.finalizar_reserva_fiscal(new.id, false);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_sincronizar_reserva_fiscal on public.notas_fiscais;
create trigger trg_sincronizar_reserva_fiscal after update of status on public.notas_fiscais
  for each row execute function public.sincronizar_reserva_fiscal();
