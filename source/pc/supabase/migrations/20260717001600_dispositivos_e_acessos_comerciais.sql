-- Etapa comercial: inventário de dispositivos e último acesso.
-- O identificador recebido é um UUID aleatório por instalação e é convertido
-- em SHA-256 no banco; nenhum IMEI, número de telefone ou serial físico é usado.

alter table public.perfis
  add column if not exists ultimo_acesso_em timestamptz;

create table if not exists public.dispositivos_empresa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  identificador_hash text not null check (identificador_hash ~ '^[a-f0-9]{64}$'),
  plataforma text not null check (plataforma in ('windows', 'android', 'web')),
  nome text,
  primeiro_acesso_em timestamptz not null default now(),
  ultimo_acesso_em timestamptz not null default now(),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, usuario_id, identificador_hash)
);

create index if not exists dispositivos_empresa_empresa_ultimo_acesso_idx
  on public.dispositivos_empresa (empresa_id, ultimo_acesso_em desc);

create or replace function public.registrar_acesso_comercial(
  p_identificador text,
  p_plataforma text,
  p_nome text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_empresa_id uuid;
  v_hash text;
  v_dispositivo_id uuid;
begin
  v_empresa_id := app_private.current_user_empresa_id();
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'sessão sem empresa licenciada';
  end if;
  if length(btrim(coalesce(p_identificador, ''))) < 12 then
    raise exception using errcode = '22023', message = 'identificador de dispositivo inválido';
  end if;
  if coalesce(p_plataforma, '') not in ('windows', 'android', 'web') then
    raise exception using errcode = '22023', message = 'plataforma inválida';
  end if;

  v_hash := encode(digest(btrim(p_identificador), 'sha256'), 'hex');
  insert into public.dispositivos_empresa (
    empresa_id, usuario_id, identificador_hash, plataforma, nome, ultimo_acesso_em, updated_at
  ) values (
    v_empresa_id, auth.uid(), v_hash, p_plataforma, nullif(btrim(p_nome), ''), now(), now()
  ) on conflict (empresa_id, usuario_id, identificador_hash) do update
    set plataforma = excluded.plataforma,
        nome = coalesce(excluded.nome, public.dispositivos_empresa.nome),
        ultimo_acesso_em = now(),
        ativo = true,
        updated_at = now()
  returning id into v_dispositivo_id;

  update public.perfis set ultimo_acesso_em = now() where id = auth.uid();
  insert into public.auditoria_comercial (empresa_id, autor_id, acao, entidade, entidade_id, metadados)
  values (v_empresa_id, auth.uid(), 'acesso_registrado', 'dispositivo', v_dispositivo_id::text,
    jsonb_build_object('plataforma', p_plataforma));
  return v_dispositivo_id;
end;
$$;

alter table public.dispositivos_empresa enable row level security;

create policy dispositivos_empresa_select_empresa on public.dispositivos_empresa
  for select to authenticated using (empresa_id = app_private.current_user_empresa_id());

grant execute on function public.registrar_acesso_comercial(text, text, text) to authenticated;

comment on table public.dispositivos_empresa is
  'Inventário comercial com hash de identificador aleatório por instalação; sem identificadores físicos do aparelho.';
