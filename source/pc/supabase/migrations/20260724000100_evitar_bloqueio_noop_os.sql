-- Impede que clientes antigos/repetidores disputem row lock ao reenviar um
-- patch que ja esta aplicado. O primeiro teste e feito sem FOR UPDATE; o lock
-- so e adquirido quando existe uma mudanca real a persistir.
create or replace function public.atualizar_ordem_servico(
  p_id uuid,
  p_revision bigint,
  p_patch jsonb
)
returns public.ordens_servico
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_pode_editar boolean := false;
  v_os public.ordens_servico;
  v_candidata public.ordens_servico;
  v_patch jsonb := '{}'::jsonb;
  v_chave text;
  v_chaves_permitidas constant text[] := array[
    'cliente_id', 'cliente_nome_snapshot', 'cliente_telefone_snapshot',
    'cliente_cpf_snapshot', 'aparelho', 'marca', 'modelo', 'cor', 'imei',
    'senha_aparelho', 'acessorios', 'estado_aparelho', 'defeito_relatado',
    'diagnostico', 'servico_realizado', 'observacoes', 'termos', 'status',
    'prioridade', 'tecnico_id', 'valor', 'forma_pagamento',
    'status_pagamento', 'garantia_dias', 'data_prevista', 'hora_prevista',
    'data_conclusao', 'dados_extras'
  ];
  v_chaves_vazias_como_null constant text[] := array[
    'cliente_id', 'cliente_telefone_snapshot', 'cliente_cpf_snapshot',
    'aparelho', 'marca', 'modelo', 'cor', 'imei', 'senha_aparelho',
    'acessorios', 'estado_aparelho', 'diagnostico', 'servico_realizado',
    'observacoes', 'termos', 'tecnico_id', 'forma_pagamento',
    'data_prevista', 'hora_prevista', 'data_conclusao'
  ];
begin
  if v_usuario_id is null then
    raise exception using errcode = '42501', message = 'sem permissao para editar OS';
  end if;
  -- So uma chamada simultanea do mesmo usuario para a mesma OS chega a tocar
  -- nas tabelas. As repetidas recebem um erro transitorio e entram no backoff
  -- do cliente, em vez de consumirem todas as conexoes do PostgREST.
  if not pg_try_advisory_xact_lock(hashtextextended(v_usuario_id::text || ':' || p_id::text, 0)) then
    raise exception using errcode = '55000', message = 'sincronizacao_em_andamento';
  end if;

  -- Empresa, licenca e permissao em um unico lookup indexado. A versao anterior
  -- executava dois helpers quase identicos para cada RPC.
  select p.empresa_id,
         coalesce(
           lower(p.cargo) in ('administrador', 'admin', 'proprietario', 'proprietário')
           or (p.permissoes #> array['os', 'editar']) = 'true'::jsonb
           or (p.permissoes #> array['*', '*']) = 'true'::jsonb,
           false
         )
    into v_empresa_id, v_pode_editar
    from public.perfis p
    join public.empresas e on e.id = p.empresa_id
   where p.id = v_usuario_id
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
   limit 1;
  if v_empresa_id is null or not v_pode_editar then
    raise exception using errcode = '42501', message = 'sem permissao para editar OS';
  end if;
  if p_revision is null or p_revision < 1 then
    raise exception using errcode = '22023', message = 'revision esperada e obrigatoria';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'patch deve ser um objeto nao vazio';
  end if;
  if p_patch ?| array[
    'id', 'empresa_id', 'numero', 'numero_sequencial', 'id_exportacao',
    'revision', 'created_at', 'updated_at', 'deleted_at',
    'origem_dispositivo_id'
  ] then
    raise exception using errcode = '42501', message = 'patch contem campo protegido';
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_patch
    from jsonb_each(p_patch) e
   where e.key = any(v_chaves_permitidas);

  -- Chaves desconhecidas continuam sendo ignoradas como nas versoes antigas.
  if v_patch = '{}'::jsonb then
    select o.* into v_os
      from public.ordens_servico o
     where o.id = p_id and o.empresa_id = v_empresa_id and o.deleted_at is null;
    if not found then
      raise exception using errcode = 'P0002', message = 'OS nao encontrada';
    end if;
    return v_os;
  end if;

  foreach v_chave in array v_chaves_vazias_como_null loop
    if v_patch ? v_chave and coalesce(v_patch ->> v_chave, '') = '' then
      v_patch := jsonb_set(v_patch, array[v_chave], 'null'::jsonb, false);
    end if;
  end loop;

  -- Preflight sem lock: a tempestade de no-ops termina aqui, sem fila de
  -- tuple locks, sem trigger, sem WAL e sem evento Realtime.
  select o.* into v_os
    from public.ordens_servico o
   where o.id = p_id and o.empresa_id = v_empresa_id and o.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'OS nao encontrada';
  end if;
  select * into v_candidata from jsonb_populate_record(v_os, v_patch);
  if to_jsonb(v_candidata) is not distinct from to_jsonb(v_os) then
    return v_os;
  end if;

  -- Existe mudanca real. Serializa somente agora e repete o teste porque outra
  -- sessao pode ter aplicado o mesmo patch enquanto aguardavamos o lock.
  select o.* into v_os
    from public.ordens_servico o
   where o.id = p_id and o.empresa_id = v_empresa_id and o.deleted_at is null
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'OS nao encontrada';
  end if;
  select * into v_candidata from jsonb_populate_record(v_os, v_patch);
  if to_jsonb(v_candidata) is not distinct from to_jsonb(v_os) then
    return v_os;
  end if;

  if v_os.revision <> p_revision then
    raise exception using
      errcode = '40001',
      message = 'conflito_revision: a OS possui uma versao mais nova';
  end if;

  update public.ordens_servico o
     set cliente_id = v_candidata.cliente_id,
         cliente_nome_snapshot = v_candidata.cliente_nome_snapshot,
         cliente_telefone_snapshot = v_candidata.cliente_telefone_snapshot,
         cliente_cpf_snapshot = v_candidata.cliente_cpf_snapshot,
         aparelho = v_candidata.aparelho,
         marca = v_candidata.marca,
         modelo = v_candidata.modelo,
         cor = v_candidata.cor,
         imei = v_candidata.imei,
         senha_aparelho = v_candidata.senha_aparelho,
         acessorios = v_candidata.acessorios,
         estado_aparelho = v_candidata.estado_aparelho,
         defeito_relatado = v_candidata.defeito_relatado,
         diagnostico = v_candidata.diagnostico,
         servico_realizado = v_candidata.servico_realizado,
         observacoes = v_candidata.observacoes,
         termos = v_candidata.termos,
         status = v_candidata.status,
         prioridade = v_candidata.prioridade,
         tecnico_id = v_candidata.tecnico_id,
         valor = v_candidata.valor,
         forma_pagamento = v_candidata.forma_pagamento,
         status_pagamento = v_candidata.status_pagamento,
         garantia_dias = v_candidata.garantia_dias,
         data_prevista = v_candidata.data_prevista,
         hora_prevista = v_candidata.hora_prevista,
         data_conclusao = v_candidata.data_conclusao,
         dados_extras = v_candidata.dados_extras
   where o.id = v_os.id
     and o.empresa_id = v_empresa_id
     and o.deleted_at is null
   returning * into v_os;

  if found then return v_os; end if;
  raise exception using errcode = 'P0002', message = 'OS nao encontrada';
end
$$;

alter function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  set statement_timeout = '4s';
alter function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  set lock_timeout = '750ms';

revoke all on function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  to authenticated;

comment on function public.atualizar_ordem_servico(uuid, bigint, jsonb) is
  'Atualiza OS com preflight sem lock; no-ops repetidos nao disputam tuple lock.';
