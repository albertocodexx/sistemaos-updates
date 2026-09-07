-- Estoque compartilhado entre o Electron e o aplicativo Android.
-- Mantém o identificador local já usado pelo desktop (EST-/PCA-) e usa
-- exclusão lógica para impedir que registros removidos reapareçam no pull.

create table if not exists public.estoque_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('aparelho', 'peca')),
  local_id text not null,
  dados jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object'),
  revision bigint not null default 1,
  origem_dispositivo_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  unique (empresa_id, tipo, local_id)
);

create index if not exists estoque_itens_empresa_tipo_atualizado_idx
  on public.estoque_itens (empresa_id, tipo, updated_at desc);

alter table public.estoque_itens enable row level security;

drop policy if exists estoque_itens_select_empresa on public.estoque_itens;
create policy estoque_itens_select_empresa on public.estoque_itens
for select to authenticated
using (
  empresa_id = app_private.current_user_empresa_id()
  and app_private.tem_permissao('estoque', 'ler')
);

create or replace function public.salvar_item_estoque(
  p_tipo text,
  p_local_id text,
  p_dados jsonb,
  p_revision bigint default null,
  p_dispositivo_id uuid default null
)
returns public.estoque_itens
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_atual public.estoque_itens;
  v_resultado public.estoque_itens;
begin
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'Empresa autenticada não encontrada.';
  end if;
  if p_tipo not in ('aparelho', 'peca') or nullif(btrim(p_local_id), '') is null
     or p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception using errcode = '22023', message = 'Item de estoque inválido.';
  end if;

  select * into v_atual
    from public.estoque_itens
   where empresa_id = v_empresa_id and tipo = p_tipo and local_id = btrim(p_local_id)
   for update;

  if v_atual.id is null then
    if not app_private.tem_permissao('estoque', 'criar') then
      raise exception using errcode = '42501', message = 'Sem permissão para adicionar itens ao estoque.';
    end if;
    insert into public.estoque_itens (
      empresa_id, tipo, local_id, dados, origem_dispositivo_id
    ) values (
      v_empresa_id, p_tipo, btrim(p_local_id), p_dados, p_dispositivo_id
    ) returning * into v_resultado;
  else
    if not app_private.tem_permissao('estoque', 'editar') then
      raise exception using errcode = '42501', message = 'Sem permissão para alterar o estoque.';
    end if;
    if p_revision is not null and p_revision > 0 and p_revision <> v_atual.revision then
      raise exception using errcode = '40001', message = 'conflito_revision_estoque';
    end if;
    update public.estoque_itens
       set dados = p_dados,
           revision = revision + 1,
           origem_dispositivo_id = coalesce(p_dispositivo_id, origem_dispositivo_id),
           deleted_at = null,
           updated_at = now()
     where id = v_atual.id
     returning * into v_resultado;
  end if;
  return v_resultado;
end;
$$;

create or replace function public.movimentar_quantidade_peca(
  p_id uuid,
  p_delta integer,
  p_revision bigint default null,
  p_dispositivo_id uuid default null
)
returns public.estoque_itens
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_atual public.estoque_itens;
  v_quantidade integer;
  v_resultado public.estoque_itens;
begin
  if v_empresa_id is null or not app_private.tem_permissao('estoque', 'editar') then
    raise exception using errcode = '42501', message = 'Sem permissão para movimentar o estoque.';
  end if;
  if p_delta = 0 then
    raise exception using errcode = '22023', message = 'Informe uma quantidade diferente de zero.';
  end if;
  select * into v_atual from public.estoque_itens
   where id = p_id and empresa_id = v_empresa_id and tipo = 'peca' and deleted_at is null
   for update;
  if v_atual.id is null then
    raise exception using errcode = 'P0002', message = 'Peça não encontrada.';
  end if;
  if p_revision is not null and p_revision > 0 and p_revision <> v_atual.revision then
    raise exception using errcode = '40001', message = 'conflito_revision_estoque';
  end if;
  v_quantidade := greatest(0, coalesce((v_atual.dados->>'quantidade')::integer, 0) + p_delta);
  update public.estoque_itens
     set dados = jsonb_set(dados, '{quantidade}', to_jsonb(v_quantidade), true),
         revision = revision + 1,
         origem_dispositivo_id = coalesce(p_dispositivo_id, origem_dispositivo_id),
         updated_at = now()
   where id = v_atual.id
   returning * into v_resultado;
  return v_resultado;
end;
$$;

create or replace function public.excluir_item_estoque(
  p_id uuid,
  p_revision bigint default null,
  p_dispositivo_id uuid default null
)
returns public.estoque_itens
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_atual public.estoque_itens;
  v_resultado public.estoque_itens;
begin
  if v_empresa_id is null or not app_private.tem_permissao('estoque', 'excluir') then
    raise exception using errcode = '42501', message = 'Sem permissão para excluir itens do estoque.';
  end if;
  select * into v_atual from public.estoque_itens
   where id = p_id and empresa_id = v_empresa_id and deleted_at is null
   for update;
  if v_atual.id is null then
    raise exception using errcode = 'P0002', message = 'Item de estoque não encontrado.';
  end if;
  if p_revision is not null and p_revision > 0 and p_revision <> v_atual.revision then
    raise exception using errcode = '40001', message = 'conflito_revision_estoque';
  end if;
  update public.estoque_itens
     set deleted_at = now(), updated_at = now(), revision = revision + 1,
         origem_dispositivo_id = coalesce(p_dispositivo_id, origem_dispositivo_id)
   where id = v_atual.id
   returning * into v_resultado;
  return v_resultado;
end;
$$;

revoke all on table public.estoque_itens from anon;
grant select on table public.estoque_itens to authenticated;
grant execute on function public.salvar_item_estoque(text, text, jsonb, bigint, uuid) to authenticated;
grant execute on function public.movimentar_quantidade_peca(uuid, integer, bigint, uuid) to authenticated;
grant execute on function public.excluir_item_estoque(uuid, bigint, uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'estoque_itens'
  ) then
    alter publication supabase_realtime add table public.estoque_itens;
  end if;
end $$;
