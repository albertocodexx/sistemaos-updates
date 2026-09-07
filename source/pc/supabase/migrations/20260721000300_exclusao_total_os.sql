-- Exclusao definitiva de OS e de todos os documentos vinculados.
-- Os clientes chamam listar_arquivos_exclusao_os(), removem os objetos pelo
-- Storage API e somente entao chamam excluir_ordem_servico(). Assim o objeto
-- fisico tambem deixa de existir e nao sobra lixo invisivel no bucket.

create or replace function public.listar_arquivos_exclusao_os(p_id uuid)
returns table (
  id uuid,
  storage_bucket text,
  arquivo_nuvem_path text,
  miniatura_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
begin
  if v_empresa_id is null or not app_private.tem_permissao('os', 'excluir') then
    raise exception using errcode = '42501', message = 'sem permissao para excluir OS';
  end if;

  if not exists (
    select 1 from public.ordens_servico o
    where o.id = p_id and o.empresa_id = v_empresa_id
  ) then
    raise exception using errcode = 'P0002', message = 'OS nao encontrada';
  end if;

  return query
  with entidades as (
    select 'ordem_servico'::public.entidade_tipo as tipo, p_id as entidade_id
    union all
    select 'garantia'::public.entidade_tipo, g.id
      from public.garantias g
     where g.empresa_id = v_empresa_id and g.ordem_servico_id = p_id
    union all
    select 'entrega'::public.entidade_tipo, e.id
      from public.entregas e
     where e.empresa_id = v_empresa_id and e.ordem_servico_id = p_id
  )
  select a.id, a.storage_bucket, a.arquivo_nuvem_path, a.miniatura_path
    from public.arquivos a
    join entidades x
      on x.tipo = a.entidade_tipo and x.entidade_id = a.entidade_id
   where a.empresa_id = v_empresa_id;
end
$$;

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
   where s.empresa_id = v_empresa_id
     and s.entidade_id = any(v_ids_relacionados);

  delete from public.arquivos a
   where a.empresa_id = v_empresa_id
     and a.entidade_id = any(v_ids_relacionados);

  delete from public.garantias g
   where g.empresa_id = v_empresa_id and g.ordem_servico_id = p_id;
  delete from public.entregas e
   where e.empresa_id = v_empresa_id and e.ordem_servico_id = p_id;
  delete from public.ordens_servico o
   where o.id = p_id and o.empresa_id = v_empresa_id;

  return v_os;
end
$$;

revoke all on function public.listar_arquivos_exclusao_os(uuid) from public;
grant execute on function public.listar_arquivos_exclusao_os(uuid) to authenticated;

revoke all on function public.excluir_ordem_servico(uuid, bigint) from public;
grant execute on function public.excluir_ordem_servico(uuid, bigint) to authenticated;

comment on function public.excluir_ordem_servico(uuid, bigint) is
  'Exclui definitivamente a OS, garantia, entrega, metadados e fila vinculados; objetos do Storage sao removidos antes pelo cliente autenticado.';
