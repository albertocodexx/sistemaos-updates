-- Contencao da tempestade observada em producao em 23/07/2026.
--
-- Metas:
-- 1. executar o lookup de empresa/permissoes uma unica vez por statement RLS;
-- 2. serializar alteracoes concorrentes da mesma OS;
-- 3. nao gerar revision, WAL nem evento Realtime para patch semanticamente igual;
-- 4. manter isolamento multiempresa e o contrato atual da RPC.

-- O porteiro anterior chamava calcular_status_licenca_empresa(), que fazia um
-- segundo SELECT em empresas para cada avaliacao. A regra abaixo e equivalente,
-- mas usa a linha que ja foi carregada no JOIN.
create or replace function app_private.current_user_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.empresa_id
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

-- Evita chamar current_user_empresa_id() novamente dentro da verificacao de
-- permissao. A validacao comercial fica na mesma consulta e preserva o bloqueio
-- de empresa/usuario/licenca.
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

-- Checkpoints incrementais usados pelo PC e APK. Tombstones precisam de um
-- indice proprio; compras/vendas ativas podem ignorar linhas excluidas.
create index if not exists ordens_empresa_updated_ativo_idx
  on public.ordens_servico (empresa_id, updated_at)
  where deleted_at is null;
create index if not exists ordens_empresa_deleted_idx
  on public.ordens_servico (empresa_id, deleted_at)
  where deleted_at is not null;
create index if not exists compras_empresa_updated_ativo_idx
  on public.compras (empresa_id, updated_at)
  where deleted_at is null;
create index if not exists vendas_empresa_updated_ativo_idx
  on public.vendas (empresa_id, updated_at)
  where deleted_at is null;
-- A sincronizacao de estoque tambem baixa tombstones; por isso este indice
-- intencionalmente nao e parcial.
create index if not exists estoque_itens_empresa_updated_idx
  on public.estoque_itens (empresa_id, updated_at);

-- Em uma policy, `select helper()` vira InitPlan e e avaliado uma vez por
-- statement. Sem o SELECT, o helper SECURITY DEFINER era reexecutado por linha.
alter policy empresas_select_propria on public.empresas
  using (id = (select app_private.current_user_empresa_id()));
alter policy perfis_select_empresa on public.perfis
  using (empresa_id = (select app_private.current_user_empresa_id()));
alter policy configuracoes_select_empresa on public.configuracoes_empresa
  using (empresa_id = (select app_private.current_user_empresa_id()));
alter policy configuracoes_update_empresa on public.configuracoes_empresa
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('configuracoes', 'editar'))
  )
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('configuracoes', 'editar'))
  );

alter policy dispositivos_select_proprios on public.dispositivos
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and usuario_id = (select auth.uid())
  );
alter policy dispositivos_insert_proprios on public.dispositivos
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and usuario_id = (select auth.uid())
  );
alter policy dispositivos_update_proprios on public.dispositivos
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and usuario_id = (select auth.uid())
  )
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and usuario_id = (select auth.uid())
  );

alter policy clientes_select_empresa on public.clientes
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('clientes', 'ler'))
  );
alter policy clientes_insert_empresa on public.clientes
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('clientes', 'criar'))
  );
alter policy clientes_update_empresa on public.clientes
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('clientes', 'editar'))
  )
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('clientes', 'editar'))
  );

alter policy ordens_select_empresa on public.ordens_servico
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'ler'))
  );
alter policy ordens_insert_empresa on public.ordens_servico
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'criar'))
  );
alter policy ordens_update_empresa on public.ordens_servico
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'editar'))
  )
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'editar'))
  );

alter policy garantias_select_empresa on public.garantias
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'ler'))
  );
alter policy garantias_insert_empresa on public.garantias
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'criar'))
  );
alter policy garantias_update_empresa on public.garantias
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'editar'))
  )
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'editar'))
  );

alter policy entregas_select_empresa on public.entregas
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'ler'))
  );
alter policy entregas_insert_empresa on public.entregas
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'criar'))
  );
alter policy entregas_update_empresa on public.entregas
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'editar'))
  )
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('os', 'editar'))
  );

alter policy compras_select_empresa on public.compras
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('estoque', 'ler'))
  );
alter policy compras_insert_empresa on public.compras
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('estoque', 'criar'))
  );
alter policy compras_update_empresa on public.compras
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('estoque', 'editar'))
  )
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('estoque', 'editar'))
  );

alter policy vendas_select_empresa on public.vendas
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('vendas', 'ler'))
  );
alter policy vendas_insert_empresa on public.vendas
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('vendas', 'criar'))
  );
alter policy vendas_update_empresa on public.vendas
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('vendas', 'editar'))
  )
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('vendas', 'editar'))
  );

alter policy arquivos_select_empresa on public.arquivos
  using (empresa_id = (select app_private.current_user_empresa_id()));
alter policy arquivos_insert_empresa on public.arquivos
  with check (empresa_id = (select app_private.current_user_empresa_id()));
alter policy arquivos_update_empresa on public.arquivos
  using (empresa_id = (select app_private.current_user_empresa_id()))
  with check (empresa_id = (select app_private.current_user_empresa_id()));

alter policy sync_select_proprio on public.operacoes_sincronizacao
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and usuario_id = (select auth.uid())
  );
alter policy sync_insert_proprio on public.operacoes_sincronizacao
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and usuario_id = (select auth.uid())
  );
alter policy sync_update_proprio on public.operacoes_sincronizacao
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and usuario_id = (select auth.uid())
  )
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and usuario_id = (select auth.uid())
  );

-- Policies adicionadas depois do schema principal.
alter policy solicitacoes_arquivo_select_empresa on public.solicitacoes_arquivo
  using (empresa_id = (select app_private.current_user_empresa_id()));
alter policy pagamentos_assinatura_select_empresa on public.pagamentos_assinatura
  using (empresa_id = (select app_private.current_user_empresa_id()));
alter policy eventos_licenca_select_empresa on public.eventos_licenca
  using (empresa_id = (select app_private.current_user_empresa_id()));
alter policy dispositivos_empresa_select_empresa on public.dispositivos_empresa
  using (empresa_id = (select app_private.current_user_empresa_id()));
alter policy backups_empresa_select_propria on public.backups_empresa
  using (empresa_id = (select app_private.current_user_empresa_id()));
alter policy estoque_itens_select_empresa on public.estoque_itens
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    and (select app_private.tem_permissao('estoque', 'ler'))
  );
alter policy relatorios_erros_insert_empresa on public.relatorios_erros
  with check (
    empresa_id = (select app_private.current_user_empresa_id())
    and usuario_id = (select auth.uid())
  );
alter policy relatorios_erros_select_global on public.relatorios_erros
  using ((select app_private.eh_administrador_global()));
alter policy chamados_suporte_select_empresa on public.chamados_suporte
  using (
    empresa_id = (select app_private.current_user_empresa_id())
    or (select app_private.eh_administrador_global())
  );
alter policy chamado_mensagens_select_empresa on public.chamado_mensagens
  using (exists (
    select 1
      from public.chamados_suporte c
     where c.id = chamado_mensagens.chamado_id
       and (
         c.empresa_id = (select app_private.current_user_empresa_id())
         or (select app_private.eh_administrador_global())
       )
  ));

-- Storage tambem recebe InitPlans; isso evita repetir o porteiro para cada
-- objeto retornado em listagens e remocoes em lote.
alter policy storage_select_empresa on storage.objects
  using (
    bucket_id in (
      'miniaturas', 'arquivos-os', 'documentos-pdf',
      'backups-empresa', 'identidade-empresa'
    )
    and (storage.foldername(name))[1] =
      (select app_private.current_user_empresa_id())::text
  );
alter policy storage_insert_empresa on storage.objects
  with check (
    (storage.foldername(name))[1] =
      (select app_private.current_user_empresa_id())::text
    and (
      bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf', 'backups-empresa')
      or (
        bucket_id = 'identidade-empresa'
        and (select app_private.eh_administrador_empresa(
          (select app_private.current_user_empresa_id())
        ))
      )
    )
  );
alter policy storage_update_empresa on storage.objects
  using (
    (storage.foldername(name))[1] =
      (select app_private.current_user_empresa_id())::text
    and (
      bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf', 'backups-empresa')
      or (
        bucket_id = 'identidade-empresa'
        and (select app_private.eh_administrador_empresa(
          (select app_private.current_user_empresa_id())
        ))
      )
    )
  )
  with check (
    (storage.foldername(name))[1] =
      (select app_private.current_user_empresa_id())::text
    and (
      bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf', 'backups-empresa')
      or (
        bucket_id = 'identidade-empresa'
        and (select app_private.eh_administrador_empresa(
          (select app_private.current_user_empresa_id())
        ))
      )
    )
  );
alter policy storage_delete_empresa on storage.objects
  using (
    (storage.foldername(name))[1] =
      (select app_private.current_user_empresa_id())::text
    and (
      bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf', 'backups-empresa')
      or (
        bucket_id = 'identidade-empresa'
        and (select app_private.eh_administrador_empresa(
          (select app_private.current_user_empresa_id())
        ))
      )
    )
  );

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
  v_empresa_id uuid := app_private.current_user_empresa_id();
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
  if v_empresa_id is null or not app_private.tem_permissao('os', 'editar') then
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

  -- O row lock e a serializacao por OS. Chamadas para OS diferentes continuam
  -- concorrentes, mas duas chamadas para o mesmo id nao alteram a revision em
  -- paralelo.
  select o.*
    into v_os
    from public.ordens_servico o
   where o.id = p_id
     and o.empresa_id = v_empresa_id
     and o.deleted_at is null
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'OS nao encontrada';
  end if;

  -- Mantem o comportamento historico: chaves desconhecidas sao ignoradas.
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_patch
    from jsonb_each(p_patch) e
   where e.key = any(v_chaves_permitidas);

  if v_patch = '{}'::jsonb then
    return v_os;
  end if;

  -- A RPC antiga convertia string vazia em NULL nestes campos.
  foreach v_chave in array v_chaves_vazias_como_null loop
    if v_patch ? v_chave and coalesce(v_patch ->> v_chave, '') = '' then
      v_patch := jsonb_set(v_patch, array[v_chave], 'null'::jsonb, false);
    end if;
  end loop;

  -- O PostgreSQL converte JSON para os tipos reais da tabela. Assim "230",
  -- 230 e 230.00 sao comparados como o mesmo numeric, e datas/horas tambem
  -- recebem comparacao semantica.
  select *
    into v_candidata
    from jsonb_populate_record(v_os, v_patch);

  if (
    v_candidata.cliente_id,
    v_candidata.cliente_nome_snapshot,
    v_candidata.cliente_telefone_snapshot,
    v_candidata.cliente_cpf_snapshot,
    v_candidata.aparelho,
    v_candidata.marca,
    v_candidata.modelo,
    v_candidata.cor,
    v_candidata.imei,
    v_candidata.senha_aparelho,
    v_candidata.acessorios,
    v_candidata.estado_aparelho,
    v_candidata.defeito_relatado,
    v_candidata.diagnostico,
    v_candidata.servico_realizado,
    v_candidata.observacoes,
    v_candidata.termos,
    v_candidata.status,
    v_candidata.prioridade,
    v_candidata.tecnico_id,
    v_candidata.valor,
    v_candidata.forma_pagamento,
    v_candidata.status_pagamento,
    v_candidata.garantia_dias,
    v_candidata.data_prevista,
    v_candidata.hora_prevista,
    v_candidata.data_conclusao,
    v_candidata.dados_extras
  ) is not distinct from (
    v_os.cliente_id,
    v_os.cliente_nome_snapshot,
    v_os.cliente_telefone_snapshot,
    v_os.cliente_cpf_snapshot,
    v_os.aparelho,
    v_os.marca,
    v_os.modelo,
    v_os.cor,
    v_os.imei,
    v_os.senha_aparelho,
    v_os.acessorios,
    v_os.estado_aparelho,
    v_os.defeito_relatado,
    v_os.diagnostico,
    v_os.servico_realizado,
    v_os.observacoes,
    v_os.termos,
    v_os.status,
    v_os.prioridade,
    v_os.tecnico_id,
    v_os.valor,
    v_os.forma_pagamento,
    v_os.status_pagamento,
    v_os.garantia_dias,
    v_os.data_prevista,
    v_os.hora_prevista,
    v_os.data_conclusao,
    v_os.dados_extras
  ) then
    -- Retorna a versao atual inclusive quando um cliente antigo repetiu o
    -- mesmo patch com revision atrasada. Nao ha UPDATE, trigger, WAL ou Realtime.
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

  if found then
    return v_os;
  end if;
  raise exception using errcode = 'P0002', message = 'OS nao encontrada';
end
$$;

-- Timeouts limitam o dano de clientes antigos durante disputa de row lock.
alter function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  set statement_timeout = '8s';
alter function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  set lock_timeout = '3s';

revoke all on function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  to authenticated;

comment on function public.atualizar_ordem_servico(uuid, bigint, jsonb) is
  'Atualiza OS com isolamento multiempresa, row lock e no-op para patch semanticamente identico.';
