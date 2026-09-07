-- Tabela de preços compartilhada entre o Electron e o Android.
-- Cada empresa enxerga somente os próprios registros. As alterações passam
-- por RPCs com a mesma permissão já usada pelo módulo de estoque.

create table if not exists public.tabela_precos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  modelo text not null,
  peca text not null,
  valor numeric(12,2) not null check (valor >= 0),
  observacoes text not null default '',
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists tabela_precos_empresa_atualizado_idx
  on public.tabela_precos (empresa_id, updated_at desc);

create unique index if not exists tabela_precos_empresa_modelo_peca_ativo_uidx
  on public.tabela_precos (
    empresa_id,
    lower(btrim(modelo)),
    lower(btrim(peca))
  )
  where deleted_at is null;

alter table public.tabela_precos enable row level security;

drop policy if exists tabela_precos_select_empresa on public.tabela_precos;
create policy tabela_precos_select_empresa on public.tabela_precos
for select to authenticated
using (
  empresa_id = app_private.current_user_empresa_id()
  and app_private.tem_permissao('estoque', 'ler')
);

create or replace function public.salvar_tabela_preco(
  p_id uuid,
  p_modelo text,
  p_peca text,
  p_valor numeric,
  p_observacoes text default '',
  p_revision bigint default null
)
returns public.tabela_precos
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_atual public.tabela_precos;
  v_resultado public.tabela_precos;
begin
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'Empresa autenticada não encontrada.';
  end if;
  if nullif(btrim(p_modelo), '') is null or nullif(btrim(p_peca), '') is null
     or p_valor is null or p_valor < 0 then
    raise exception using errcode = '22023', message = 'Informe modelo, peça ou serviço e valor válido.';
  end if;

  if p_id is null then
    if not app_private.tem_permissao('estoque', 'criar') then
      raise exception using errcode = '42501', message = 'Sem permissão para adicionar preços.';
    end if;
    insert into public.tabela_precos (
      empresa_id, modelo, peca, valor, observacoes
    ) values (
      v_empresa_id, btrim(p_modelo), btrim(p_peca), round(p_valor, 2),
      coalesce(btrim(p_observacoes), '')
    ) returning * into v_resultado;
  else
    if not app_private.tem_permissao('estoque', 'editar') then
      raise exception using errcode = '42501', message = 'Sem permissão para editar preços.';
    end if;
    select * into v_atual
      from public.tabela_precos
     where id = p_id and empresa_id = v_empresa_id and deleted_at is null
     for update;
    if v_atual.id is null then
      raise exception using errcode = 'P0002', message = 'Preço não encontrado.';
    end if;
    if p_revision is not null and p_revision > 0 and p_revision <> v_atual.revision then
      raise exception using errcode = '40001', message = 'conflito_revision_tabela_preco';
    end if;
    update public.tabela_precos
       set modelo = btrim(p_modelo),
           peca = btrim(p_peca),
           valor = round(p_valor, 2),
           observacoes = coalesce(btrim(p_observacoes), ''),
           revision = revision + 1,
           updated_at = now()
     where id = p_id and empresa_id = v_empresa_id
     returning * into v_resultado;
  end if;
  return v_resultado;
exception
  when unique_violation then
    raise exception using errcode = '23505',
      message = 'Já existe um preço cadastrado para este modelo e esta peça ou serviço.';
end;
$$;

create or replace function public.excluir_tabela_preco(
  p_id uuid,
  p_revision bigint default null
)
returns public.tabela_precos
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_atual public.tabela_precos;
  v_resultado public.tabela_precos;
begin
  if v_empresa_id is null or not app_private.tem_permissao('estoque', 'excluir') then
    raise exception using errcode = '42501', message = 'Sem permissão para excluir preços.';
  end if;
  select * into v_atual
    from public.tabela_precos
   where id = p_id and empresa_id = v_empresa_id and deleted_at is null
   for update;
  if v_atual.id is null then
    raise exception using errcode = 'P0002', message = 'Preço não encontrado.';
  end if;
  if p_revision is not null and p_revision > 0 and p_revision <> v_atual.revision then
    raise exception using errcode = '40001', message = 'conflito_revision_tabela_preco';
  end if;
  update public.tabela_precos
     set deleted_at = now(), updated_at = now(), revision = revision + 1
   where id = p_id and empresa_id = v_empresa_id
   returning * into v_resultado;
  return v_resultado;
end;
$$;

revoke all on table public.tabela_precos from anon;
grant select on table public.tabela_precos to authenticated;
grant execute on function public.salvar_tabela_preco(uuid, text, text, numeric, text, bigint) to authenticated;
grant execute on function public.excluir_tabela_preco(uuid, bigint) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'tabela_precos'
  ) then
    alter publication supabase_realtime add table public.tabela_precos;
  end if;
end $$;
