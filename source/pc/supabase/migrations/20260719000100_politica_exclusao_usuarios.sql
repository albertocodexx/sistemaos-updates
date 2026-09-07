-- Politica de exclusao compartilhada entre Electron e Android.
-- As senhas individuais ficam fora do schema publico e nunca sao devolvidas
-- aos clientes. Administradores da empresa sempre podem excluir sem senha.

create table if not exists app_private.credenciais_exclusao_usuario (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  senha_hash text not null,
  tentativas_invalidas integer not null default 0,
  bloqueada_ate timestamptz,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

create index if not exists credenciais_exclusao_empresa_idx
  on app_private.credenciais_exclusao_usuario (empresa_id);

revoke all on table app_private.credenciais_exclusao_usuario
  from public, anon, authenticated;

create or replace function app_private.politica_exclusao_atual()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_config jsonb := '{}'::jsonb;
  v_usuario_id uuid := auth.uid();
  v_admin boolean := false;
  v_liberado boolean := false;
  v_configurada boolean := false;
begin
  if v_empresa_id is null or v_usuario_id is null then
    return jsonb_build_object(
      'autenticado', false,
      'administrador', false,
      'sem_senha', false,
      'exige_senha', true,
      'senha_configurada', false
    );
  end if;

  v_admin := app_private.eh_administrador_empresa(v_empresa_id);

  select coalesce(c.configuracoes -> 'exclusao', '{}'::jsonb)
    into v_config
  from public.configuracoes_empresa c
  where c.empresa_id = v_empresa_id;

  v_liberado := v_admin
    or coalesce((v_config ->> 'sem_senha_todos')::boolean, false)
    or coalesce(v_config -> 'usuarios_sem_senha', '[]'::jsonb) ? v_usuario_id::text;

  select exists (
    select 1
    from app_private.credenciais_exclusao_usuario c
    where c.usuario_id = v_usuario_id
      and c.empresa_id = v_empresa_id
  ) into v_configurada;

  return jsonb_build_object(
    'autenticado', true,
    'empresa_id', v_empresa_id,
    'usuario_id', v_usuario_id,
    'administrador', v_admin,
    'sem_senha', v_liberado,
    'exige_senha', not v_liberado,
    'senha_configurada', v_configurada,
    'sem_senha_todos', coalesce((v_config ->> 'sem_senha_todos')::boolean, false),
    'usuarios_sem_senha', coalesce(v_config -> 'usuarios_sem_senha', '[]'::jsonb)
  );
end;
$$;

create or replace function public.obter_politica_exclusao()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_private.politica_exclusao_atual()
$$;

create or replace function public.definir_minha_senha_exclusao(p_senha text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
begin
  if v_empresa_id is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'sessao invalida';
  end if;
  if char_length(coalesce(p_senha, '')) < 6 then
    raise exception using errcode = '22023', message = 'a senha de exclusao precisa ter pelo menos 6 caracteres';
  end if;

  insert into app_private.credenciais_exclusao_usuario
    (usuario_id, empresa_id, senha_hash, tentativas_invalidas, bloqueada_ate, atualizada_em)
  values
    (auth.uid(), v_empresa_id, crypt(p_senha, gen_salt('bf', 12)), 0, null, now())
  on conflict (usuario_id) do update
    set empresa_id = excluded.empresa_id,
        senha_hash = excluded.senha_hash,
        tentativas_invalidas = 0,
        bloqueada_ate = null,
        atualizada_em = now();

  insert into public.auditoria_comercial
    (empresa_id, autor_id, acao, entidade, entidade_id, metadados)
  values
    (v_empresa_id, auth.uid(), 'senha_exclusao_usuario_definida',
     'perfil', auth.uid()::text, '{}'::jsonb);

  return app_private.politica_exclusao_atual();
end;
$$;

create or replace function public.configurar_politica_exclusao(
  p_sem_senha_todos boolean,
  p_usuarios_sem_senha uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_usuarios jsonb;
begin
  if v_empresa_id is null or not app_private.eh_administrador_empresa(v_empresa_id) then
    raise exception using errcode = '42501', message = 'somente o administrador da empresa pode alterar a protecao de exclusao';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_usuarios_sem_senha, '{}'::uuid[])) u(id)
    where not exists (
      select 1 from public.perfis p
      where p.id = u.id and p.empresa_id = v_empresa_id and p.ativo
    )
  ) then
    raise exception using errcode = '22023', message = 'um dos usuarios informados nao pertence a esta empresa';
  end if;

  select coalesce(jsonb_agg(u.id::text order by u.id::text), '[]'::jsonb)
    into v_usuarios
  from (
    select distinct id
    from unnest(coalesce(p_usuarios_sem_senha, '{}'::uuid[])) x(id)
  ) u;

  insert into public.configuracoes_empresa (empresa_id, configuracoes, feature_flags)
  values (
    v_empresa_id,
    jsonb_build_object('exclusao', jsonb_build_object(
      'sem_senha_todos', coalesce(p_sem_senha_todos, false),
      'usuarios_sem_senha', v_usuarios
    )),
    '{}'::jsonb
  )
  on conflict (empresa_id) do update
    set configuracoes = jsonb_set(
      coalesce(public.configuracoes_empresa.configuracoes, '{}'::jsonb),
      '{exclusao}',
      jsonb_build_object(
        'sem_senha_todos', coalesce(p_sem_senha_todos, false),
        'usuarios_sem_senha', v_usuarios
      ),
      true
    ),
    updated_at = now();

  insert into public.auditoria_comercial
    (empresa_id, autor_id, acao, entidade, entidade_id, metadados)
  values
    (v_empresa_id, auth.uid(), 'politica_exclusao_configurada', 'empresa',
     v_empresa_id::text, jsonb_build_object(
       'sem_senha_todos', coalesce(p_sem_senha_todos, false),
       'usuarios_sem_senha', v_usuarios
     ));

  return app_private.politica_exclusao_atual();
end;
$$;

create or replace function public.validar_minha_senha_exclusao(p_senha text)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_politica jsonb;
  v_credencial app_private.credenciais_exclusao_usuario%rowtype;
  v_tentativas integer;
begin
  v_politica := app_private.politica_exclusao_atual();
  if coalesce((v_politica ->> 'sem_senha')::boolean, false) then
    return true;
  end if;

  select * into v_credencial
  from app_private.credenciais_exclusao_usuario c
  where c.usuario_id = auth.uid() and c.empresa_id = v_empresa_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'defina primeiro sua senha de exclusao nas configuracoes';
  end if;
  if v_credencial.bloqueada_ate is not null and v_credencial.bloqueada_ate > now() then
    raise exception using errcode = '42501', message = 'senha temporariamente bloqueada; tente novamente em 15 minutos';
  end if;

  if crypt(coalesce(p_senha, ''), v_credencial.senha_hash) <> v_credencial.senha_hash then
    v_tentativas := v_credencial.tentativas_invalidas + 1;
    update app_private.credenciais_exclusao_usuario
       set tentativas_invalidas = case when v_tentativas >= 5 then 0 else v_tentativas end,
           bloqueada_ate = case when v_tentativas >= 5 then now() + interval '15 minutes' else null end,
           atualizada_em = now()
     where usuario_id = auth.uid();
    return false;
  end if;

  update app_private.credenciais_exclusao_usuario
     set tentativas_invalidas = 0, bloqueada_ate = null, atualizada_em = now()
   where usuario_id = auth.uid();
  return true;
end;
$$;

revoke all on function public.obter_politica_exclusao() from public, anon;
revoke all on function public.definir_minha_senha_exclusao(text) from public, anon;
revoke all on function public.configurar_politica_exclusao(boolean, uuid[]) from public, anon;
revoke all on function public.validar_minha_senha_exclusao(text) from public, anon;
grant execute on function public.obter_politica_exclusao() to authenticated;
grant execute on function public.definir_minha_senha_exclusao(text) to authenticated;
grant execute on function public.configurar_politica_exclusao(boolean, uuid[]) to authenticated;
grant execute on function public.validar_minha_senha_exclusao(text) to authenticated;
