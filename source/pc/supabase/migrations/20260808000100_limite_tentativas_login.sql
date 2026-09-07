begin;

create table if not exists public.tentativas_login_seguranca (
  chave text primary key check (chave ~ '^[0-9a-f]{64}$'),
  tentativas integer not null default 0 check (tentativas >= 0),
  janela_inicio timestamptz not null default now(),
  bloqueada_ate timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.tentativas_login_seguranca enable row level security;
revoke all on public.tentativas_login_seguranca from public, anon, authenticated;
grant all on public.tentativas_login_seguranca to service_role;

create or replace function public.verificar_limite_login(p_chave text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare registro public.tentativas_login_seguranca%rowtype;
begin
  if p_chave !~ '^[0-9a-f]{64}$' then raise exception 'chave invalida'; end if;
  select * into registro from public.tentativas_login_seguranca where chave = p_chave;
  if not found then return jsonb_build_object('bloqueado', false, 'tentativas', 0); end if;
  if registro.bloqueada_ate is not null and registro.bloqueada_ate > now() then
    return jsonb_build_object('bloqueado', true, 'tentativas', registro.tentativas,
      'tentar_em_segundos', greatest(1, ceil(extract(epoch from (registro.bloqueada_ate - now())))::integer));
  end if;
  if registro.janela_inicio < now() - interval '15 minutes' then
    delete from public.tentativas_login_seguranca where chave = p_chave;
    return jsonb_build_object('bloqueado', false, 'tentativas', 0);
  end if;
  return jsonb_build_object('bloqueado', false, 'tentativas', registro.tentativas);
end;
$$;

create or replace function public.registrar_falha_login(p_chave text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare registro public.tentativas_login_seguranca%rowtype;
begin
  if p_chave !~ '^[0-9a-f]{64}$' then raise exception 'chave invalida'; end if;
  select * into registro from public.tentativas_login_seguranca where chave = p_chave for update;
  if not found then
    insert into public.tentativas_login_seguranca(chave, tentativas) values (p_chave, 1) returning * into registro;
  elsif registro.janela_inicio < now() - interval '15 minutes' then
    update public.tentativas_login_seguranca
      set tentativas = 1, janela_inicio = now(), bloqueada_ate = null, updated_at = now()
      where chave = p_chave returning * into registro;
  else
    update public.tentativas_login_seguranca
      set tentativas = tentativas + 1,
          bloqueada_ate = case when tentativas + 1 >= 5 then now() + interval '15 minutes' else bloqueada_ate end,
          updated_at = now()
      where chave = p_chave returning * into registro;
  end if;
  return jsonb_build_object('bloqueado', registro.bloqueada_ate is not null and registro.bloqueada_ate > now(),
    'tentativas', registro.tentativas);
end;
$$;

create or replace function public.limpar_falhas_login(p_chave text)
returns void language sql security definer set search_path = public as $$
  delete from public.tentativas_login_seguranca where chave = p_chave;
$$;

revoke all on function public.verificar_limite_login(text) from public, anon, authenticated;
revoke all on function public.registrar_falha_login(text) from public, anon, authenticated;
revoke all on function public.limpar_falhas_login(text) from public, anon, authenticated;
grant execute on function public.verificar_limite_login(text) to service_role;
grant execute on function public.registrar_falha_login(text) to service_role;
grant execute on function public.limpar_falhas_login(text) to service_role;

commit;
