-- Entrega confiavel da exclusao feita no Android para todos os PCs da empresa.
-- A OS continua sendo apagada definitivamente, mas um evento minimo e mantido
-- por 90 dias para que cada desktop confirme que removeu a copia local.

create table if not exists public.exclusoes_os_pendentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_servico_id uuid not null,
  numero text not null,
  id_exportacao text,
  revision bigint not null default 1,
  excluido_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  unique (empresa_id, ordem_servico_id)
);

create index if not exists exclusoes_os_pendentes_empresa_data_idx
  on public.exclusoes_os_pendentes (empresa_id, excluido_em desc);

create table if not exists public.confirmacoes_exclusao_os (
  evento_id uuid not null references public.exclusoes_os_pendentes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  dispositivo_id uuid not null,
  confirmado_em timestamptz not null default now(),
  primary key (evento_id, dispositivo_id),
  foreign key (empresa_id, dispositivo_id)
    references public.dispositivos(empresa_id, id) on delete cascade
);

alter table public.exclusoes_os_pendentes enable row level security;
alter table public.confirmacoes_exclusao_os enable row level security;
revoke all on public.exclusoes_os_pendentes from public, anon, authenticated;
revoke all on public.confirmacoes_exclusao_os from public, anon, authenticated;

create or replace function public.listar_exclusoes_os_pendentes(
  p_dispositivo_id uuid
)
returns table (
  evento_id uuid,
  id uuid,
  numero text,
  id_exportacao text,
  revision bigint,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
begin
  if v_empresa_id is null or not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id and d.id = p_dispositivo_id
       and d.usuario_id = auth.uid() and d.tipo = 'desktop'
  ) then
    raise exception using errcode = '42501', message = 'dispositivo desktop invalido';
  end if;

  return query
  select e.id, e.ordem_servico_id, e.numero, e.id_exportacao,
         e.revision, e.excluido_em
    from public.exclusoes_os_pendentes e
   where e.empresa_id = v_empresa_id
     and e.excluido_em >= now() - interval '90 days'
     and not exists (
       select 1 from public.confirmacoes_exclusao_os c
        where c.evento_id = e.id and c.empresa_id = v_empresa_id
          and c.dispositivo_id = p_dispositivo_id
     )
   order by e.excluido_em asc
   limit 500;
end
$$;

create or replace function public.confirmar_exclusao_os_desktop(
  p_evento_id uuid,
  p_dispositivo_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
begin
  if v_empresa_id is null or not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id and d.id = p_dispositivo_id
       and d.usuario_id = auth.uid() and d.tipo = 'desktop'
  ) then
    raise exception using errcode = '42501', message = 'dispositivo desktop invalido';
  end if;
  if not exists (
    select 1 from public.exclusoes_os_pendentes e
     where e.id = p_evento_id and e.empresa_id = v_empresa_id
  ) then
    raise exception using errcode = 'P0002', message = 'evento de exclusao nao encontrado';
  end if;

  insert into public.confirmacoes_exclusao_os (evento_id, empresa_id, dispositivo_id)
  values (p_evento_id, v_empresa_id, p_dispositivo_id)
  on conflict (evento_id, dispositivo_id) do update
    set confirmado_em = now();
  return true;
end
$$;

-- Mantem a exclusao fisica existente e grava o aviso ANTES de remover a OS.
create or replace function public.excluir_ordem_servico(
  p_id uuid,
  p_revision bigint
)
returns public.ordens_servico
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_os public.ordens_servico;
  v_ids_relacionados uuid[];
begin
  if v_empresa_id is null or not app_private.tem_permissao('os', 'excluir') then
    raise exception using errcode = '42501', message = 'sem permissao para excluir OS';
  end if;

  select o.* into v_os
    from public.ordens_servico o
   where o.id = p_id and o.empresa_id = v_empresa_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'OS nao encontrada';
  end if;
  if v_os.deleted_at is null and v_os.revision <> p_revision then
    raise exception using errcode = '40001', message = 'conflito_revision: a OS possui uma versao mais nova';
  end if;

  insert into public.exclusoes_os_pendentes (
    empresa_id, ordem_servico_id, numero, id_exportacao, revision, excluido_em, criado_por
  ) values (
    v_empresa_id, v_os.id, v_os.numero, v_os.id_exportacao, v_os.revision, now(), auth.uid()
  )
  on conflict (empresa_id, ordem_servico_id) do update set
    numero = excluded.numero,
    id_exportacao = excluded.id_exportacao,
    revision = excluded.revision,
    excluido_em = excluded.excluido_em,
    criado_por = excluded.criado_por;

  select array_agg(x.id) into v_ids_relacionados
    from (
      select p_id as id
      union all
      select g.id from public.garantias g
       where g.empresa_id = v_empresa_id and g.ordem_servico_id = p_id
      union all
      select e.id from public.entregas e
       where e.empresa_id = v_empresa_id and e.ordem_servico_id = p_id
    ) x;

  delete from public.operacoes_sincronizacao s
   where s.empresa_id = v_empresa_id and s.entidade_id = any(v_ids_relacionados);
  delete from public.arquivos a
   where a.empresa_id = v_empresa_id and a.entidade_id = any(v_ids_relacionados);
  delete from public.solicitacoes_assinatura_remota s
   where s.empresa_id = v_empresa_id
     and s.tipo_documento in ('os', 'entrega')
     and (
       upper(btrim(coalesce(s.pacote->'identificador'->>'numero', ''))) = upper(btrim(v_os.numero))
       or upper(btrim(coalesce(s.pacote->'dados'->>'numeroOS', ''))) = upper(btrim(v_os.numero))
       or upper(btrim(coalesce(s.pacote->'dados'->>'numero', ''))) = upper(btrim(v_os.numero))
     );
  delete from public.garantias g
   where g.empresa_id = v_empresa_id and g.ordem_servico_id = p_id;
  delete from public.entregas e
   where e.empresa_id = v_empresa_id and e.ordem_servico_id = p_id;
  delete from public.ordens_servico o
   where o.id = p_id and o.empresa_id = v_empresa_id;

  return v_os;
end
$$;

revoke all on function public.listar_exclusoes_os_pendentes(uuid) from public, anon, authenticated;
revoke all on function public.confirmar_exclusao_os_desktop(uuid, uuid) from public, anon, authenticated;
revoke all on function public.excluir_ordem_servico(uuid, bigint) from public, anon, authenticated;
grant execute on function public.listar_exclusoes_os_pendentes(uuid) to authenticated;
grant execute on function public.confirmar_exclusao_os_desktop(uuid, uuid) to authenticated;
grant execute on function public.excluir_ordem_servico(uuid, bigint) to authenticated;

comment on table public.exclusoes_os_pendentes is
  'Outbox minima que entrega a exclusao definitiva da OS a cada desktop da empresa.';
