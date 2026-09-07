-- Entrega Android -> Supabase -> Electron.
-- Mantem uma unica entrega por OS, com valor/forma de pagamento e payload
-- editavel para o importador legado reconstruir o comprovante local.

alter table public.entregas
  add column if not exists valor_reparo numeric(14,2) not null default 0
    check (valor_reparo >= 0),
  add column if not exists forma_pagamento text,
  add column if not exists dados_extras jsonb not null default '{}'::jsonb;

create or replace function public.criar_entrega_mobile(
  p_id_exportacao text,
  p_dados jsonb,
  p_origem_dispositivo_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_documento jsonb := coalesce(p_dados->'documento_mobile', '{}'::jsonb);
  v_numero_informado text := nullif(btrim(coalesce(p_dados->'documento_mobile'->>'numeroOS', '')), '');
  v_ordem public.ordens_servico;
  v_entrega public.entregas;
  v_status public.entrega_status;
  v_entregue_em timestamptz;
  v_valor numeric(14,2) := greatest(coalesce(nullif(p_dados->>'valor_total', '')::numeric, 0), 0);
begin
  if v_empresa_id is null or not (
    app_private.tem_permissao('os', 'criar') or app_private.tem_permissao('os', 'editar')
  ) then
    raise exception using errcode = '42501', message = 'sem permissao para registrar entrega';
  end if;
  if nullif(btrim(p_id_exportacao), '') is null or v_numero_informado is null or
     jsonb_typeof(v_documento) <> 'object' then
    raise exception using errcode = '22023', message = 'numero da OS e dados da entrega sao obrigatorios';
  end if;
  if p_origem_dispositivo_id is not null and not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id and d.id = p_origem_dispositivo_id
       and d.usuario_id = auth.uid() and d.tipo = 'android'
  ) then
    raise exception using errcode = '42501', message = 'dispositivo Android invalido';
  end if;

  select o.* into v_ordem
    from public.ordens_servico o
   where o.empresa_id = v_empresa_id and o.deleted_at is null
     and (
       upper(btrim(o.numero)) = upper(v_numero_informado) or
       regexp_replace(o.numero, '[^0-9]', '', 'g') = regexp_replace(v_numero_informado, '[^0-9]', '', 'g')
     )
   order by o.updated_at desc
   limit 1;
  if not found then
    raise exception using errcode = 'P0002', message = 'OS informada nao foi encontrada nesta empresa';
  end if;

  select e.* into v_entrega from public.entregas e
   where e.empresa_id = v_empresa_id and e.id_exportacao = btrim(p_id_exportacao);
  if found then return to_jsonb(v_entrega); end if;

  v_status := case when coalesce((v_documento->>'assinaturaPendente')::boolean, false)
    then 'pendente_assinatura'::public.entrega_status else 'concluida'::public.entrega_status end;
  v_entregue_em := coalesce(nullif(v_documento->>'dataHoraAssinatura', '')::timestamptz, now());

  insert into public.entregas as e (
    empresa_id, ordem_servico_id, numero_os_snapshot, cliente_nome_snapshot,
    retirado_por, documento_retirada, aparelho_snapshot, marca_snapshot,
    modelo_snapshot, reparo_realizado, status, entregue_em, garantia_dias,
    data_limite_garantia, forma_entrega, observacoes, id_exportacao,
    origem_dispositivo_id, valor_reparo, forma_pagamento, dados_extras
  ) values (
    v_empresa_id, v_ordem.id, v_ordem.numero,
    coalesce(nullif(btrim(v_documento->>'nomeRetirou'), ''), v_ordem.cliente_nome_snapshot),
    nullif(btrim(v_documento->>'nomeRetirou'), ''),
    nullif(btrim(v_documento->>'cpfRetirou'), ''),
    nullif(btrim(concat_ws(' ', v_documento->>'marca', v_documento->>'modelo')), ''),
    nullif(btrim(v_documento->>'marca'), ''), nullif(btrim(v_documento->>'modelo'), ''),
    nullif(btrim(v_documento->>'reparoRealizado'), ''), v_status, v_entregue_em,
    greatest(coalesce(nullif(v_documento->>'garantiaDias', '')::integer, 0), 0),
    nullif(v_documento->>'dataLimiteGarantia', '')::date,
    'retirada', nullif(btrim(v_documento->>'declaracao'), ''), btrim(p_id_exportacao),
    p_origem_dispositivo_id, v_valor, nullif(btrim(v_documento->>'formaPagamento'), ''), p_dados
  )
  on conflict (empresa_id, ordem_servico_id) do update set
    numero_os_snapshot = excluded.numero_os_snapshot,
    cliente_nome_snapshot = excluded.cliente_nome_snapshot,
    retirado_por = excluded.retirado_por,
    documento_retirada = excluded.documento_retirada,
    aparelho_snapshot = excluded.aparelho_snapshot,
    marca_snapshot = excluded.marca_snapshot,
    modelo_snapshot = excluded.modelo_snapshot,
    reparo_realizado = excluded.reparo_realizado,
    status = excluded.status,
    entregue_em = excluded.entregue_em,
    garantia_dias = excluded.garantia_dias,
    data_limite_garantia = excluded.data_limite_garantia,
    observacoes = excluded.observacoes,
    id_exportacao = excluded.id_exportacao,
    origem_dispositivo_id = excluded.origem_dispositivo_id,
    valor_reparo = excluded.valor_reparo,
    forma_pagamento = excluded.forma_pagamento,
    dados_extras = excluded.dados_extras,
    revision = e.revision + 1,
    updated_at = now(),
    deleted_at = null
  returning * into v_entrega;
  return to_jsonb(v_entrega);
end
$$;

create or replace function public.atualizar_entrega_mobile(
  p_id uuid,
  p_revision bigint,
  p_dados jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_documento jsonb := coalesce(p_dados->'documento_mobile', '{}'::jsonb);
  v_entrega public.entregas;
  v_valor numeric(14,2) := greatest(coalesce(nullif(p_dados->>'valor_total', '')::numeric, 0), 0);
begin
  if v_empresa_id is null or not app_private.tem_permissao('os', 'editar') then
    raise exception using errcode = '42501', message = 'sem permissao para atualizar entrega';
  end if;
  update public.entregas e set
    cliente_nome_snapshot = coalesce(nullif(btrim(v_documento->>'nomeRetirou'), ''), e.cliente_nome_snapshot),
    retirado_por = nullif(btrim(v_documento->>'nomeRetirou'), ''),
    documento_retirada = nullif(btrim(v_documento->>'cpfRetirou'), ''),
    aparelho_snapshot = nullif(btrim(concat_ws(' ', v_documento->>'marca', v_documento->>'modelo')), ''),
    marca_snapshot = nullif(btrim(v_documento->>'marca'), ''),
    modelo_snapshot = nullif(btrim(v_documento->>'modelo'), ''),
    reparo_realizado = nullif(btrim(v_documento->>'reparoRealizado'), ''),
    status = case when coalesce((v_documento->>'assinaturaPendente')::boolean, false)
      then 'pendente_assinatura'::public.entrega_status else 'concluida'::public.entrega_status end,
    entregue_em = coalesce(nullif(v_documento->>'dataHoraAssinatura', '')::timestamptz, e.entregue_em, now()),
    garantia_dias = greatest(coalesce(nullif(v_documento->>'garantiaDias', '')::integer, 0), 0),
    data_limite_garantia = nullif(v_documento->>'dataLimiteGarantia', '')::date,
    observacoes = nullif(btrim(v_documento->>'declaracao'), ''),
    valor_reparo = v_valor,
    forma_pagamento = nullif(btrim(v_documento->>'formaPagamento'), ''),
    dados_extras = p_dados,
    revision = e.revision + 1,
    updated_at = now()
   where e.empresa_id = v_empresa_id and e.id = p_id and e.revision = p_revision and e.deleted_at is null
   returning * into v_entrega;
  if not found then raise exception using errcode = '40001', message = 'conflito de revisao na entrega'; end if;
  return to_jsonb(v_entrega);
end
$$;

create or replace function public.registrar_arquivo_entrega_mobile(
  p_entidade_tipo public.entidade_tipo,
  p_entidade_id uuid,
  p_idempotency_key text,
  p_dados jsonb,
  p_origem_dispositivo_id uuid default null
)
returns public.arquivos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_arquivo public.arquivos;
  v_bucket text := nullif(btrim(p_dados->>'storage_bucket'), '');
  v_path text := nullif(btrim(p_dados->>'arquivo_nuvem_path'), '');
begin
  if v_empresa_id is null or p_entidade_tipo <> 'entrega' or not (
    app_private.tem_permissao('os', 'criar') or app_private.tem_permissao('os', 'editar')
  ) then raise exception using errcode = '42501', message = 'sem permissao para enviar arquivo da entrega'; end if;
  if not exists (select 1 from public.entregas e where e.empresa_id = v_empresa_id and e.id = p_entidade_id and e.deleted_at is null) then
    raise exception using errcode = 'P0002', message = 'entrega nao encontrada';
  end if;
  if p_origem_dispositivo_id is not null and not exists (
    select 1 from public.dispositivos d where d.empresa_id = v_empresa_id
      and d.id = p_origem_dispositivo_id and d.usuario_id = auth.uid() and d.tipo = 'android'
  ) then raise exception using errcode = '42501', message = 'dispositivo Android invalido'; end if;
  select a.* into v_arquivo from public.arquivos a
   where a.empresa_id = v_empresa_id and a.idempotency_key = btrim(p_idempotency_key);
  if found then return v_arquivo; end if;
  if v_bucket not in ('arquivos-os', 'documentos-pdf') or v_path is null or
     split_part(ltrim(v_path, '/'), '/', 1) <> v_empresa_id::text then
    raise exception using errcode = '22023', message = 'arquivo fora do armazenamento privado da empresa';
  end if;
  insert into public.arquivos (
    empresa_id, entidade_tipo, entidade_id, categoria, nome_arquivo, mime_type,
    tamanho_bytes, largura, altura, storage_bucket, miniatura_path,
    arquivo_nuvem_path, disponibilidade, origem_dispositivo_id, idempotency_key
  ) values (
    v_empresa_id, 'entrega', p_entidade_id,
    coalesce(nullif(btrim(p_dados->>'categoria'), ''), 'arquivo'),
    coalesce(nullif(btrim(p_dados->>'nome_arquivo'), ''), 'arquivo'),
    coalesce(nullif(btrim(p_dados->>'mime_type'), ''), 'application/octet-stream'),
    nullif(p_dados->>'tamanho_bytes', '')::bigint,
    nullif(p_dados->>'largura', '')::integer, nullif(p_dados->>'altura', '')::integer,
    v_bucket, nullif(btrim(p_dados->>'miniatura_path'), ''), v_path,
    'completa_nuvem', p_origem_dispositivo_id, btrim(p_idempotency_key)
  ) returning * into v_arquivo;
  return v_arquivo;
exception when unique_violation then
  select a.* into v_arquivo from public.arquivos a
   where a.empresa_id = v_empresa_id and a.idempotency_key = btrim(p_idempotency_key);
  if found then return v_arquivo; end if;
  raise;
end
$$;

revoke all on function public.criar_entrega_mobile(text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.atualizar_entrega_mobile(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.registrar_arquivo_entrega_mobile(public.entidade_tipo, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.criar_entrega_mobile(text, jsonb, uuid) to authenticated;
grant execute on function public.atualizar_entrega_mobile(uuid, bigint, jsonb) to authenticated;
grant execute on function public.registrar_arquivo_entrega_mobile(public.entidade_tipo, uuid, text, jsonb, uuid) to authenticated;

