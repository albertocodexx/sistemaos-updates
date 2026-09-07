-- Etapa 2: helpers de segurança, concorrência, revisão, RPCs e consultas leves.

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
   where p.id = auth.uid()
     and p.ativo
     and e.ativo
     and e.licenca_status in ('ativa', 'teste')
     and (e.licenca_expira_em is null or e.licenca_expira_em > now())
   limit 1
$$;

create or replace function app_private.pode_acessar_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app_private.current_user_empresa_id() = p_empresa_id, false)
$$;

create or replace function app_private.tem_permissao(p_modulo text, p_acao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    lower(p.cargo) in ('administrador', 'admin', 'proprietário', 'proprietario')
    or (p.permissoes #> array[p_modulo, p_acao]) = 'true'::jsonb
    or (p.permissoes #> array['*', '*']) = 'true'::jsonb,
    false
  )
  from public.perfis p
  where p.id = auth.uid()
    and p.ativo
    and p.empresa_id = app_private.current_user_empresa_id()
$$;

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create or replace function app_private.bump_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end
$$;

create or replace function app_private.prevent_empresa_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.empresa_id is distinct from old.empresa_id then
    raise exception using
      errcode = '42501',
      message = 'empresa_id não pode ser alterado';
  end if;
  return new;
end
$$;

create or replace function app_private.calcular_data_limite_garantia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or
     new.data_limite is null or
     new.data_abertura is distinct from old.data_abertura or
     new.garantia_dias is distinct from old.garantia_dias then
    new.data_limite := new.data_abertura + new.garantia_dias;
  end if;
  return new;
end
$$;

create or replace function app_private.validar_arquivo_entidade()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_existe boolean := false;
begin
  case new.entidade_tipo
    when 'ordem_servico' then
      select exists(select 1 from public.ordens_servico x where x.empresa_id = new.empresa_id and x.id = new.entidade_id) into v_existe;
    when 'garantia' then
      select exists(select 1 from public.garantias x where x.empresa_id = new.empresa_id and x.id = new.entidade_id) into v_existe;
    when 'entrega' then
      select exists(select 1 from public.entregas x where x.empresa_id = new.empresa_id and x.id = new.entidade_id) into v_existe;
    when 'compra' then
      select exists(select 1 from public.compras x where x.empresa_id = new.empresa_id and x.id = new.entidade_id) into v_existe;
    when 'venda' then
      select exists(select 1 from public.vendas x where x.empresa_id = new.empresa_id and x.id = new.entidade_id) into v_existe;
    when 'cliente' then
      select exists(select 1 from public.clientes x where x.empresa_id = new.empresa_id and x.id = new.entidade_id) into v_existe;
  end case;

  if not v_existe then
    raise exception using
      errcode = '23503',
      message = 'entidade do arquivo não existe na empresa informada';
  end if;

  case new.disponibilidade
    when 'local' then
      if new.arquivo_local_id is null then raise exception 'arquivo local exige arquivo_local_id'; end if;
    when 'miniatura_nuvem' then
      if new.miniatura_path is null then raise exception 'miniatura_nuvem exige miniatura_path'; end if;
    when 'completa_nuvem' then
      if new.arquivo_nuvem_path is null then raise exception 'completa_nuvem exige arquivo_nuvem_path'; end if;
    when 'local_e_nuvem' then
      if new.arquivo_local_id is null or new.arquivo_nuvem_path is null then
        raise exception 'local_e_nuvem exige arquivo_local_id e arquivo_nuvem_path';
      end if;
    when 'legado_cloudinary' then
      if new.legacy_cloudinary_url is null then raise exception 'legado_cloudinary exige URL legada'; end if;
    else
      null;
  end case;

  return new;
end
$$;

-- updated_at para tabelas sem revision.
do $triggers$
declare
  t text;
begin
  foreach t in array array[
    'empresas', 'perfis', 'configuracoes_empresa', 'sequencias_documentos',
    'dispositivos', 'operacoes_sincronizacao'
  ] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I for each row execute function app_private.set_updated_at()',
      t, t
    );
  end loop;
end
$triggers$;

-- revision otimista para todas as entidades sincronizadas.
do $triggers$
declare
  t text;
begin
  foreach t in array array[
    'clientes', 'ordens_servico', 'garantias', 'entregas',
    'compras', 'vendas', 'arquivos'
  ] loop
    execute format('drop trigger if exists trg_%I_revision on public.%I', t, t);
    execute format(
      'create trigger trg_%I_revision before update on public.%I for each row execute function app_private.bump_revision()',
      t, t
    );
  end loop;
end
$triggers$;

-- Defesa adicional à cláusula WITH CHECK das policies.
do $triggers$
declare
  t text;
begin
  foreach t in array array[
    'perfis', 'configuracoes_empresa', 'sequencias_documentos', 'dispositivos',
    'clientes', 'ordens_servico', 'garantias', 'entregas', 'compras',
    'vendas', 'arquivos', 'operacoes_sincronizacao'
  ] loop
    execute format('drop trigger if exists trg_%I_empresa_imutavel on public.%I', t, t);
    execute format(
      'create trigger trg_%I_empresa_imutavel before update on public.%I for each row execute function app_private.prevent_empresa_id_change()',
      t, t
    );
  end loop;
end
$triggers$;

drop trigger if exists trg_garantias_data_limite on public.garantias;
create trigger trg_garantias_data_limite
before insert or update of data_abertura, garantia_dias, data_limite
on public.garantias
for each row execute function app_private.calcular_data_limite_garantia();

drop trigger if exists trg_arquivos_validar_entidade on public.arquivos;
create trigger trg_arquivos_validar_entidade
before insert or update of empresa_id, entidade_tipo, entidade_id, disponibilidade,
  miniatura_path, arquivo_nuvem_path, arquivo_local_id, legacy_cloudinary_url
on public.arquivos
for each row execute function app_private.validar_arquivo_entidade();

create or replace function public.registrar_heartbeat(
  p_device_id text,
  p_tipo public.dispositivo_tipo,
  p_nome text
)
returns public.dispositivos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_dispositivo public.dispositivos;
begin
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'sessão, usuário, empresa ou licença inválida';
  end if;
  if nullif(btrim(p_device_id), '') is null or nullif(btrim(p_nome), '') is null then
    raise exception using errcode = '22023', message = 'device_id e nome são obrigatórios';
  end if;

  insert into public.dispositivos (
    empresa_id, usuario_id, tipo, nome, device_id, ultimo_acesso
  ) values (
    v_empresa_id, auth.uid(), p_tipo, btrim(p_nome), btrim(p_device_id), now()
  )
  on conflict (empresa_id, device_id) do update
    set usuario_id = auth.uid(),
        tipo = excluded.tipo,
        nome = excluded.nome,
        ultimo_acesso = now()
  returning * into v_dispositivo;

  return v_dispositivo;
end
$$;

create or replace function public.criar_ordem_servico(
  p_id_exportacao text,
  p_dados jsonb,
  p_origem_dispositivo_id uuid default null
)
returns public.ordens_servico
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_numero_sequencial bigint;
  v_numero text;
  v_os public.ordens_servico;
  v_cliente_nome text;
begin
  if v_empresa_id is null or not app_private.tem_permissao('os', 'criar') then
    raise exception using errcode = '42501', message = 'sem permissão para criar OS';
  end if;
  if nullif(btrim(p_id_exportacao), '') is null then
    raise exception using errcode = '22023', message = 'idExportacao é obrigatório';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception using errcode = '22023', message = 'dados da OS devem ser um objeto JSON';
  end if;
  if p_dados ? 'empresa_id' or p_dados ? 'numero' or p_dados ? 'revision' then
    raise exception using errcode = '42501', message = 'empresa_id, número e revision são definidos pelo servidor';
  end if;

  select o.* into v_os
    from public.ordens_servico o
   where o.empresa_id = v_empresa_id
     and o.id_exportacao = btrim(p_id_exportacao);
  if found then return v_os; end if;

  if p_origem_dispositivo_id is not null and not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id
       and d.id = p_origem_dispositivo_id
       and d.usuario_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'dispositivo de origem inválido';
  end if;

  v_cliente_nome := coalesce(
    nullif(btrim(p_dados->>'cliente_nome_snapshot'), ''),
    nullif(btrim(p_dados->>'cliente_nome'), ''),
    nullif(btrim(p_dados #>> '{cliente,nome}'), '')
  );
  if v_cliente_nome is null then
    raise exception using errcode = '23514', message = 'nome do cliente é obrigatório';
  end if;

  insert into public.sequencias_documentos as s (
    empresa_id, tipo, proximo_valor
  ) values (
    v_empresa_id, 'os', 2
  )
  on conflict (empresa_id, tipo) do update
    set proximo_valor = s.proximo_valor + 1,
        updated_at = now()
  returning proximo_valor - 1 into v_numero_sequencial;

  v_numero := 'OS-' || lpad(v_numero_sequencial::text, 4, '0');

  insert into public.ordens_servico (
    empresa_id, numero, numero_sequencial, id_exportacao,
    cliente_id, cliente_nome_snapshot, cliente_telefone_snapshot, cliente_cpf_snapshot,
    aparelho, marca, modelo, cor, imei, senha_aparelho, acessorios, estado_aparelho,
    defeito_relatado, diagnostico, servico_realizado, observacoes, termos,
    status, prioridade, tecnico_id, valor, forma_pagamento, status_pagamento,
    garantia_dias, data_abertura, data_prevista, hora_prevista, origem,
    origem_dispositivo_id, dados_extras
  ) values (
    v_empresa_id, v_numero, v_numero_sequencial, btrim(p_id_exportacao),
    nullif(p_dados->>'cliente_id', '')::uuid,
    v_cliente_nome,
    coalesce(nullif(p_dados->>'cliente_telefone_snapshot', ''), nullif(p_dados #>> '{cliente,telefone}', '')),
    coalesce(nullif(p_dados->>'cliente_cpf_snapshot', ''), nullif(p_dados #>> '{cliente,cpf}', '')),
    case
      when jsonb_typeof(p_dados->'aparelho') = 'string' then nullif(p_dados->>'aparelho', '')
      else nullif(concat_ws(' ', p_dados #>> '{aparelho,marca}', p_dados #>> '{aparelho,modelo}'), '')
    end,
    coalesce(nullif(p_dados->>'marca', ''), nullif(p_dados #>> '{aparelho,marca}', '')),
    coalesce(nullif(p_dados->>'modelo', ''), nullif(p_dados #>> '{aparelho,modelo}', '')),
    coalesce(nullif(p_dados->>'cor', ''), nullif(p_dados #>> '{aparelho,cor}', '')),
    coalesce(nullif(p_dados->>'imei', ''), nullif(p_dados #>> '{aparelho,imei}', '')),
    nullif(p_dados->>'senha_aparelho', ''),
    nullif(p_dados->>'acessorios', ''),
    nullif(p_dados->>'estado_aparelho', ''),
    coalesce(nullif(p_dados->>'defeito_relatado', ''), nullif(p_dados #>> '{aparelho,defeitoRelatado}', '')),
    nullif(p_dados->>'diagnostico', ''),
    nullif(p_dados->>'servico_realizado', ''),
    nullif(p_dados->>'observacoes', ''),
    nullif(p_dados->>'termos', ''),
    coalesce(nullif(p_dados->>'status', ''), 'Aguardando análise'),
    coalesce(nullif(p_dados->>'prioridade', ''), 'Normal'),
    nullif(p_dados->>'tecnico_id', '')::uuid,
    coalesce(nullif(p_dados->>'valor', '')::numeric, 0),
    nullif(p_dados->>'forma_pagamento', ''),
    coalesce(p_dados->>'status_pagamento', ''),
    coalesce(nullif(p_dados->>'garantia_dias', '')::integer, 0),
    coalesce(nullif(p_dados->>'data_abertura', '')::timestamptz, now()),
    nullif(p_dados->>'data_prevista', '')::date,
    nullif(p_dados->>'hora_prevista', '')::time,
    case when p_origem_dispositivo_id is null then 'migracao' else 'android' end,
    p_origem_dispositivo_id,
    case when jsonb_typeof(p_dados->'dados_extras') = 'object'
      then p_dados->'dados_extras' else '{}'::jsonb end
  )
  returning * into v_os;

  return v_os;
exception
  when unique_violation then
    select o.* into v_os
      from public.ordens_servico o
     where o.empresa_id = v_empresa_id
       and o.id_exportacao = btrim(p_id_exportacao);
    if found then return v_os; end if;
    raise;
end
$$;

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
begin
  if v_empresa_id is null or not app_private.tem_permissao('os', 'editar') then
    raise exception using errcode = '42501', message = 'sem permissão para editar OS';
  end if;
  if p_revision is null or p_revision < 1 then
    raise exception using errcode = '22023', message = 'revision esperada é obrigatória';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'patch deve ser um objeto não vazio';
  end if;
  if p_patch ?| array[
    'id', 'empresa_id', 'numero', 'numero_sequencial', 'id_exportacao',
    'revision', 'created_at', 'updated_at', 'deleted_at', 'origem_dispositivo_id'
  ] then
    raise exception using errcode = '42501', message = 'patch contém campo protegido';
  end if;

  update public.ordens_servico o
     set cliente_id = case when p_patch ? 'cliente_id' then nullif(p_patch->>'cliente_id', '')::uuid else o.cliente_id end,
         cliente_nome_snapshot = case when p_patch ? 'cliente_nome_snapshot' then p_patch->>'cliente_nome_snapshot' else o.cliente_nome_snapshot end,
         cliente_telefone_snapshot = case when p_patch ? 'cliente_telefone_snapshot' then nullif(p_patch->>'cliente_telefone_snapshot', '') else o.cliente_telefone_snapshot end,
         cliente_cpf_snapshot = case when p_patch ? 'cliente_cpf_snapshot' then nullif(p_patch->>'cliente_cpf_snapshot', '') else o.cliente_cpf_snapshot end,
         aparelho = case when p_patch ? 'aparelho' then nullif(p_patch->>'aparelho', '') else o.aparelho end,
         marca = case when p_patch ? 'marca' then nullif(p_patch->>'marca', '') else o.marca end,
         modelo = case when p_patch ? 'modelo' then nullif(p_patch->>'modelo', '') else o.modelo end,
         cor = case when p_patch ? 'cor' then nullif(p_patch->>'cor', '') else o.cor end,
         imei = case when p_patch ? 'imei' then nullif(p_patch->>'imei', '') else o.imei end,
         senha_aparelho = case when p_patch ? 'senha_aparelho' then nullif(p_patch->>'senha_aparelho', '') else o.senha_aparelho end,
         acessorios = case when p_patch ? 'acessorios' then nullif(p_patch->>'acessorios', '') else o.acessorios end,
         estado_aparelho = case when p_patch ? 'estado_aparelho' then nullif(p_patch->>'estado_aparelho', '') else o.estado_aparelho end,
         defeito_relatado = case when p_patch ? 'defeito_relatado' then p_patch->>'defeito_relatado' else o.defeito_relatado end,
         diagnostico = case when p_patch ? 'diagnostico' then nullif(p_patch->>'diagnostico', '') else o.diagnostico end,
         servico_realizado = case when p_patch ? 'servico_realizado' then nullif(p_patch->>'servico_realizado', '') else o.servico_realizado end,
         observacoes = case when p_patch ? 'observacoes' then nullif(p_patch->>'observacoes', '') else o.observacoes end,
         termos = case when p_patch ? 'termos' then nullif(p_patch->>'termos', '') else o.termos end,
         status = case when p_patch ? 'status' then p_patch->>'status' else o.status end,
         prioridade = case when p_patch ? 'prioridade' then p_patch->>'prioridade' else o.prioridade end,
         tecnico_id = case when p_patch ? 'tecnico_id' then nullif(p_patch->>'tecnico_id', '')::uuid else o.tecnico_id end,
         valor = case when p_patch ? 'valor' then (p_patch->>'valor')::numeric else o.valor end,
         forma_pagamento = case when p_patch ? 'forma_pagamento' then nullif(p_patch->>'forma_pagamento', '') else o.forma_pagamento end,
         status_pagamento = case when p_patch ? 'status_pagamento' then p_patch->>'status_pagamento' else o.status_pagamento end,
         garantia_dias = case when p_patch ? 'garantia_dias' then (p_patch->>'garantia_dias')::integer else o.garantia_dias end,
         data_prevista = case when p_patch ? 'data_prevista' then nullif(p_patch->>'data_prevista', '')::date else o.data_prevista end,
         hora_prevista = case when p_patch ? 'hora_prevista' then nullif(p_patch->>'hora_prevista', '')::time else o.hora_prevista end,
         data_conclusao = case when p_patch ? 'data_conclusao' then nullif(p_patch->>'data_conclusao', '')::timestamptz else o.data_conclusao end,
         dados_extras = case when p_patch ? 'dados_extras' then p_patch->'dados_extras' else o.dados_extras end
   where o.id = p_id
     and o.empresa_id = v_empresa_id
     and o.revision = p_revision
     and o.deleted_at is null
  returning * into v_os;

  if found then return v_os; end if;
  if exists (select 1 from public.ordens_servico o where o.id = p_id and o.empresa_id = v_empresa_id and o.deleted_at is null) then
    raise exception using errcode = '40001', message = 'conflito_revision: a OS possui uma versão mais nova';
  end if;
  raise exception using errcode = 'P0002', message = 'OS não encontrada';
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
begin
  if v_empresa_id is null or not app_private.tem_permissao('os', 'excluir') then
    raise exception using errcode = '42501', message = 'sem permissão para excluir OS';
  end if;

  update public.ordens_servico o
     set deleted_at = now()
   where o.id = p_id
     and o.empresa_id = v_empresa_id
     and o.revision = p_revision
     and o.deleted_at is null
  returning * into v_os;

  if found then return v_os; end if;
  if exists (select 1 from public.ordens_servico o where o.id = p_id and o.empresa_id = v_empresa_id and o.deleted_at is null) then
    raise exception using errcode = '40001', message = 'conflito_revision: a OS possui uma versão mais nova';
  end if;
  raise exception using errcode = 'P0002', message = 'OS não encontrada';
end
$$;

-- Views explícitas: sem termos, Base64, PDF, fotos ou histórico completo.
create or replace view public.vw_ordens_servico_leve
with (security_invoker = true)
as
select
  o.id, o.empresa_id, o.numero, o.cliente_id,
  o.cliente_nome_snapshot, o.cliente_telefone_snapshot,
  o.aparelho, o.marca, o.modelo, o.cor, o.imei,
  o.defeito_relatado, o.observacoes, o.status, o.prioridade,
  o.tecnico_id, o.valor, o.forma_pagamento, o.status_pagamento,
  o.garantia_dias, o.data_abertura, o.data_prevista, o.hora_prevista,
  o.data_conclusao, o.revision, o.created_at, o.updated_at,
  (select count(*) from public.arquivos a
    where a.empresa_id = o.empresa_id and a.entidade_tipo = 'ordem_servico'
      and a.entidade_id = o.id and a.deleted_at is null) as quantidade_arquivos,
  coalesce((select jsonb_agg(distinct to_jsonb(a.disponibilidade)) from public.arquivos a
    where a.empresa_id = o.empresa_id and a.entidade_tipo = 'ordem_servico'
      and a.entidade_id = o.id and a.deleted_at is null), '[]'::jsonb) as disponibilidades_arquivos
from public.ordens_servico o
where o.deleted_at is null;

create or replace view public.vw_garantias_leve
with (security_invoker = true)
as
select
  g.id, g.empresa_id, g.ordem_servico_id, g.numero_os_snapshot,
  g.cliente_nome_snapshot, g.aparelho_snapshot, g.marca_snapshot, g.modelo_snapshot,
  g.defeito_garantia, g.status, g.data_abertura, g.garantia_dias, g.data_limite,
  g.tecnico_id, g.reparo_realizado, g.observacoes,
  g.revision, g.created_at, g.updated_at,
  (select count(*) from public.arquivos a
    where a.empresa_id = g.empresa_id and a.entidade_tipo = 'garantia'
      and a.entidade_id = g.id and a.deleted_at is null) as quantidade_arquivos,
  exists(select 1 from public.arquivos a
    where a.empresa_id = g.empresa_id and a.entidade_tipo = 'garantia'
      and a.entidade_id = g.id and a.categoria in ('foto', 'laudo', 'pdf')
      and a.disponibilidade <> 'indisponivel' and a.deleted_at is null) as arquivos_disponiveis
from public.garantias g
where g.deleted_at is null;

create or replace view public.vw_entregas_leve
with (security_invoker = true)
as
select
  e.id, e.empresa_id, e.ordem_servico_id, e.numero_os_snapshot,
  e.cliente_nome_snapshot, e.retirado_por, e.aparelho_snapshot,
  e.marca_snapshot, e.modelo_snapshot, e.reparo_realizado,
  e.status, e.entregue_em, e.garantia_dias, e.data_limite_garantia,
  e.forma_entrega, e.observacoes, e.revision, e.created_at, e.updated_at,
  exists(select 1 from public.arquivos a where a.empresa_id = e.empresa_id
    and a.entidade_tipo = 'entrega' and a.entidade_id = e.id
    and a.categoria in ('assinatura_cliente', 'assinatura_assistencia')
    and a.disponibilidade <> 'indisponivel' and a.deleted_at is null) as assinatura_disponivel,
  exists(select 1 from public.arquivos a where a.empresa_id = e.empresa_id
    and a.entidade_tipo = 'entrega' and a.entidade_id = e.id
    and a.categoria = 'comprovante' and a.disponibilidade <> 'indisponivel'
    and a.deleted_at is null) as comprovante_disponivel,
  exists(select 1 from public.arquivos a where a.empresa_id = e.empresa_id
    and a.entidade_tipo = 'entrega' and a.entidade_id = e.id
    and a.categoria = 'foto' and a.disponibilidade <> 'indisponivel'
    and a.deleted_at is null) as fotos_disponiveis,
  coalesce((select jsonb_agg(distinct to_jsonb(a.disponibilidade)) from public.arquivos a
    where a.empresa_id = e.empresa_id and a.entidade_tipo = 'entrega'
      and a.entidade_id = e.id and a.deleted_at is null), '[]'::jsonb) as disponibilidades_arquivos
from public.entregas e
where e.deleted_at is null;

create or replace view public.vw_clientes_leve
with (security_invoker = true)
as
select
  c.id, c.empresa_id, c.nome, c.telefone, c.cpf, c.email,
  c.revision, c.created_at, c.updated_at,
  (select count(*) from public.arquivos a
    where a.empresa_id = c.empresa_id and a.entidade_tipo = 'cliente'
      and a.entidade_id = c.id and a.deleted_at is null) as quantidade_arquivos
from public.clientes c
where c.deleted_at is null;

create or replace view public.vw_compras_leve
with (security_invoker = true)
as
select
  c.id, c.empresa_id, c.numero, c.fornecedor_nome, c.descricao,
  c.quantidade, c.valor_unitario, c.valor_total, c.data_compra,
  c.revision, c.created_at, c.updated_at,
  (select count(*) from public.arquivos a
    where a.empresa_id = c.empresa_id and a.entidade_tipo = 'compra'
      and a.entidade_id = c.id and a.deleted_at is null) as quantidade_arquivos
from public.compras c
where c.deleted_at is null;

create or replace view public.vw_vendas_leve
with (security_invoker = true)
as
select
  v.id, v.empresa_id, v.numero, v.cliente_id, v.cliente_nome_snapshot,
  jsonb_array_length(v.itens) as quantidade_itens,
  v.valor_total, v.forma_pagamento, v.status, v.data_venda,
  v.revision, v.created_at, v.updated_at,
  (select count(*) from public.arquivos a
    where a.empresa_id = v.empresa_id and a.entidade_tipo = 'venda'
      and a.entidade_id = v.id and a.deleted_at is null) as quantidade_arquivos
from public.vendas v
where v.deleted_at is null;

comment on view public.vw_ordens_servico_leve is 'Consulta inicial sem conteúdo de arquivos e sem termos extensos.';
comment on view public.vw_garantias_leve is 'Consulta inicial de garantia; arquivos são carregados sob demanda.';
comment on view public.vw_entregas_leve is 'Consulta inicial de entrega; assinaturas e comprovantes não são retornados.';
comment on view public.vw_clientes_leve is 'Lista de clientes sem dados extras nem arquivos.';
comment on view public.vw_compras_leve is 'Lista de compras sem anexos.';
comment on view public.vw_vendas_leve is 'Lista de vendas sem carregar os itens completos ou anexos.';
