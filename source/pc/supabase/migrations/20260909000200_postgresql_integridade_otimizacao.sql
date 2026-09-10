-- PostgreSQL e a fonte compartilhada oficial do Sistema OS.
-- O JSON do desktop e o IndexedDB do Android continuam apenas como cache
-- offline/outbox; esta migracao melhora buscas, cursores de sincronizacao e
-- oferece uma auditoria agregada sem expor registros de clientes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create extension if not exists pg_trgm with schema extensions;

-- Buscas com ILIKE "%texto%" nao aproveitam um indice btree comum.
create index if not exists clientes_empresa_nome_trgm_idx
  on public.clientes using gin (lower(nome) extensions.gin_trgm_ops)
  where deleted_at is null;
create index if not exists ordens_empresa_cliente_nome_trgm_idx
  on public.ordens_servico using gin (lower(cliente_nome_snapshot) extensions.gin_trgm_ops)
  where deleted_at is null;
create index if not exists desbloqueios_empresa_cliente_nome_trgm_idx
  on public.desbloqueios using gin (lower(cliente_nome_snapshot) extensions.gin_trgm_ops)
  where deleted_at is null;

-- Os sincronizadores ordenam por updated_at e id. Incluir o desempate no
-- indice evita sort, torna a paginacao deterministica e reduz CPU/IO.
create index if not exists ordens_empresa_cursor_idx
  on public.ordens_servico (empresa_id, updated_at, id)
  where deleted_at is null;
create index if not exists clientes_empresa_cursor_idx
  on public.clientes (empresa_id, updated_at, id);
create index if not exists estoque_itens_empresa_cursor_idx
  on public.estoque_itens (empresa_id, updated_at, id);
create index if not exists compras_empresa_cursor_idx
  on public.compras (empresa_id, updated_at, id);
create index if not exists vendas_empresa_cursor_idx
  on public.vendas (empresa_id, updated_at, id);
create index if not exists entregas_empresa_cursor_idx
  on public.entregas (empresa_id, updated_at, id)
  where deleted_at is null;
create index if not exists garantias_empresa_cursor_idx
  on public.garantias (empresa_id, updated_at, id)
  where deleted_at is null;
create index if not exists desbloqueios_empresa_cursor_idx
  on public.desbloqueios (empresa_id, updated_at, id)
  where deleted_at is null;
create index if not exists arquivos_empresa_cursor_idx
  on public.arquivos (empresa_id, updated_at, id);
create index if not exists assinaturas_remotas_empresa_cursor_idx
  on public.solicitacoes_assinatura_remota (empresa_id, status, updated_at, id);

-- CPF/telefone sao filtros exatos frequentes no perfil e na busca mobile.
create index if not exists clientes_empresa_telefone_idx
  on public.clientes (empresa_id, telefone)
  where telefone is not null and deleted_at is null;
create index if not exists ordens_empresa_cliente_telefone_idx
  on public.ordens_servico (empresa_id, cliente_telefone_snapshot)
  where cliente_telefone_snapshot is not null and deleted_at is null;

-- Compatibilidade entre os nomes de modulo do banco e os nomes realmente
-- administrados pela tela de cargos. Sem este alias, um tecnico com acesso ao
-- estoque podia ver o aparelho, mas a RLS recusava a venda correspondente.
create or replace function app_private.tem_permissao(p_modulo text, p_acao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    lower(p.cargo) in ('administrador', 'admin', 'proprietario', 'proprietário')
    or (p.permissoes #> array[p_modulo, p_acao]) = 'true'::jsonb
    or (p.permissoes #> array[
      case p_modulo
        when 'vendas' then 'estoque'
        when 'compras' then 'estoque'
        when 'entregas' then 'os'
        when 'garantias' then 'os'
        else p_modulo
      end,
      p_acao
    ]) = 'true'::jsonb
    or (p.permissoes #> array['*', '*']) = 'true'::jsonb,
    false
  )
    from public.perfis p
    join public.empresas e on e.id = p.empresa_id
   where p.id = (select auth.uid())
     and p.ativo
     and e.ativo
     and case
       when e.licenca_status in ('bloqueada', 'suspensa', 'cancelada') then false
       when e.licenca_status = 'teste' then
         (e.fim_trial is not null and e.fim_trial > now())
         or (e.periodo_graca_ate is not null and e.periodo_graca_ate > now())
       when e.data_vencimento is not null and e.data_vencimento <= now() then
         e.periodo_graca_ate is not null and e.periodo_graca_ate > now()
       else true
     end
   limit 1
$$;

create or replace function app_private.modulo_entidade_arquivo(p_tipo public.entidade_tipo)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_tipo
    when 'compra' then 'estoque'
    when 'venda' then 'estoque'
    when 'cliente' then 'clientes'
    else 'os'
  end
$$;

-- Metadados de fotos, PDFs e assinaturas tambem respeitam o cargo. O filtro
-- por empresa sozinho impedia vazamento entre empresas, mas ainda permitia a
-- um colaborador sem acesso ao modulo enumerar os arquivos daquele modulo.
drop policy if exists arquivos_select_empresa on public.arquivos;
create policy arquivos_select_empresa on public.arquivos
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao(app_private.modulo_entidade_arquivo(entidade_tipo), 'ler')
);

create or replace function public.solicitar_arquivo_local(p_arquivo_id uuid)
returns public.solicitacoes_arquivo
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_arquivo public.arquivos;
  v_solicitacao public.solicitacoes_arquivo;
begin
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'sessao, empresa ou licenca invalida';
  end if;
  select a.* into v_arquivo from public.arquivos a
   where a.id = p_arquivo_id and a.empresa_id = v_empresa_id and a.deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'arquivo nao encontrado'; end if;
  if not app_private.tem_permissao(app_private.modulo_entidade_arquivo(v_arquivo.entidade_tipo), 'ler') then
    raise exception using errcode = '42501', message = 'sem permissao para acessar este arquivo';
  end if;
  if v_arquivo.disponibilidade not in ('local', 'local_e_nuvem') or v_arquivo.arquivo_local_id is null then
    raise exception using errcode = '22023', message = 'arquivo nao depende do desktop';
  end if;
  if not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id and d.tipo = 'desktop'
       and d.ultimo_acesso >= now() - interval '90 seconds'
  ) then
    raise exception using errcode = 'P0001', message = 'desktop_offline';
  end if;

  select s.* into v_solicitacao from public.solicitacoes_arquivo s
   where s.empresa_id = v_empresa_id and s.arquivo_id = p_arquivo_id
     and s.usuario_id = auth.uid() and s.status = 'pendente' and s.expira_em > now()
   order by s.solicitado_em desc limit 1;
  if found then return v_solicitacao; end if;

  insert into public.solicitacoes_arquivo (empresa_id, arquivo_id, usuario_id)
  values (v_empresa_id, p_arquivo_id, auth.uid())
  returning * into v_solicitacao;
  return v_solicitacao;
end
$$;

revoke all on function app_private.modulo_entidade_arquivo(public.entidade_tipo) from public, anon;
grant execute on function app_private.modulo_entidade_arquivo(public.entidade_tipo) to authenticated;
revoke all on function public.solicitar_arquivo_local(uuid) from public, anon;
grant execute on function public.solicitar_arquivo_local(uuid) to authenticated;

-- Retorna somente contagens e inconsistencias. E restrita ao administrador
-- da propria empresa e usa search_path fechado para evitar object hijacking.
create or replace function public.auditar_integridade_postgresql()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa uuid := app_private.current_user_empresa_id();
  v_resultado jsonb;
begin
  if v_empresa is null or not app_private.eh_administrador_empresa(v_empresa) then
    raise exception using errcode = '42501', message = 'Somente o administrador da empresa pode auditar o banco.';
  end if;

  select jsonb_build_object(
    'motor', 'PostgreSQL',
    'empresaId', v_empresa,
    'verificadoEm', now(),
    'registros', jsonb_build_object(
      'clientes', (select count(*) from public.clientes c where c.empresa_id=v_empresa and c.deleted_at is null),
      'ordensServico', (select count(*) from public.ordens_servico o where o.empresa_id=v_empresa and o.deleted_at is null),
      'estoque', (select count(*) from public.estoque_itens e where e.empresa_id=v_empresa and e.deleted_at is null),
      'compras', (select count(*) from public.compras c where c.empresa_id=v_empresa and c.deleted_at is null),
      'vendas', (select count(*) from public.vendas v where v.empresa_id=v_empresa and v.deleted_at is null),
      'entregas', (select count(*) from public.entregas e where e.empresa_id=v_empresa and e.deleted_at is null),
      'garantias', (select count(*) from public.garantias g where g.empresa_id=v_empresa and g.deleted_at is null),
      'desbloqueios', (select count(*) from public.desbloqueios d where d.empresa_id=v_empresa and d.deleted_at is null)
    ),
    'pendencias', jsonb_build_object(
      'assinaturas', (select count(*) from public.solicitacoes_assinatura_remota s where s.empresa_id=v_empresa and s.status in ('pendente','respondida')),
      'sincronizacao', (select count(*) from public.operacoes_sincronizacao o where o.empresa_id=v_empresa and o.status in ('pendente','erro','conflito'))
    ),
    'inconsistencias', jsonb_build_object(
      'ordensSemClienteRelacionado', (
        select count(*) from public.ordens_servico o
        left join public.clientes c on c.empresa_id=o.empresa_id and c.id=o.cliente_id
        where o.empresa_id=v_empresa and o.deleted_at is null and o.cliente_id is not null and c.id is null
      ),
      'entregasSemOrdem', (
        select count(*) from public.entregas e
        left join public.ordens_servico o on o.empresa_id=e.empresa_id and o.id=e.ordem_servico_id
        where e.empresa_id=v_empresa and e.deleted_at is null and o.id is null
      ),
      'garantiasSemOrdem', (
        select count(*) from public.garantias g
        left join public.ordens_servico o on o.empresa_id=g.empresa_id and o.id=g.ordem_servico_id
        where g.empresa_id=v_empresa and g.deleted_at is null and o.id is null
      ),
      'desbloqueiosSemCliente', (
        select count(*) from public.desbloqueios d
        left join public.clientes c on c.empresa_id=d.empresa_id and c.id=d.cliente_id
        where d.empresa_id=v_empresa and d.deleted_at is null and c.id is null
      ),
      'clientesSemIdPublico', (
        select count(*) from public.clientes c
        where c.empresa_id=v_empresa and c.deleted_at is null and c.numero_cliente is null
      )
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.auditar_integridade_postgresql() from public, anon;
grant execute on function public.auditar_integridade_postgresql() to authenticated;
comment on function public.auditar_integridade_postgresql() is
  'Auditoria agregada de integridade do PostgreSQL, restrita ao administrador da empresa atual.';

commit;
