-- Compra/Venda APK -> Supabase -> Electron, com anexos privados e idempotência.

create or replace function public.criar_documento_comercial_mobile(
  p_tipo text,
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
  v_sequencial bigint;
  v_numero text;
  v_valor numeric(14,2) := greatest(coalesce(nullif(p_dados->>'valor_total', '')::numeric, 0), 0);
  v_compra public.compras;
  v_venda public.vendas;
begin
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'sessão ou empresa inválida';
  end if;
  if p_tipo not in ('compra', 'venda') then
    raise exception using errcode = '22023', message = 'tipo de documento comercial inválido';
  end if;
  if p_tipo = 'compra' and not app_private.tem_permissao('estoque', 'criar') then
    raise exception using errcode = '42501', message = 'sem permissão para registrar compra';
  end if;
  if p_tipo = 'venda' and not app_private.tem_permissao('vendas', 'criar') then
    raise exception using errcode = '42501', message = 'sem permissão para registrar venda';
  end if;
  if nullif(btrim(p_id_exportacao), '') is null or jsonb_typeof(v_documento) <> 'object' then
    raise exception using errcode = '22023', message = 'identificador e dados do documento são obrigatórios';
  end if;
  if p_origem_dispositivo_id is not null and not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id and d.id = p_origem_dispositivo_id
       and d.usuario_id = auth.uid() and d.tipo = 'android'
  ) then
    raise exception using errcode = '42501', message = 'dispositivo Android inválido';
  end if;

  if p_tipo = 'compra' then
    select c.* into v_compra from public.compras c
     where c.empresa_id = v_empresa_id and c.id_exportacao = btrim(p_id_exportacao);
    if found then return to_jsonb(v_compra); end if;
  else
    select v.* into v_venda from public.vendas v
     where v.empresa_id = v_empresa_id and v.id_exportacao = btrim(p_id_exportacao);
    if found then return to_jsonb(v_venda); end if;
  end if;

  insert into public.sequencias_documentos as s (empresa_id, tipo, proximo_valor)
  values (v_empresa_id, p_tipo, 2)
  on conflict (empresa_id, tipo) do update
    set proximo_valor = s.proximo_valor + 1, updated_at = now()
  returning proximo_valor - 1 into v_sequencial;
  v_numero := case when p_tipo = 'compra' then 'CP-' else 'VD-' end || lpad(v_sequencial::text, 4, '0');

  if p_tipo = 'compra' then
    insert into public.compras (
      empresa_id, numero, id_exportacao, fornecedor_nome, descricao,
      quantidade, valor_unitario, valor_total, data_compra, observacoes,
      origem_dispositivo_id, dados_extras
    ) values (
      v_empresa_id, v_numero, btrim(p_id_exportacao),
      nullif(btrim(v_documento #>> '{vendedor,nome}'), ''),
      coalesce(nullif(btrim(concat_ws(' ', v_documento #>> '{aparelho,marca}', v_documento #>> '{aparelho,modelo}')), ''), 'Compra pelo aplicativo'),
      1, v_valor, v_valor,
      coalesce(nullif(v_documento->>'data', '')::timestamptz::date, current_date),
      nullif(v_documento #>> '{dadosCompra,observacoes}', ''),
      p_origem_dispositivo_id, p_dados
    ) returning * into v_compra;
    return to_jsonb(v_compra);
  end if;

  insert into public.vendas (
    empresa_id, numero, id_exportacao, cliente_nome_snapshot, itens,
    valor_total, forma_pagamento, status, data_venda, observacoes,
    origem_dispositivo_id, dados_extras
  ) values (
    v_empresa_id, v_numero, btrim(p_id_exportacao),
    nullif(v_documento->>'compradorNome', ''), jsonb_build_array(v_documento),
    v_valor, nullif(v_documento->>'formaPagamento', ''), 'concluida',
    coalesce(nullif(v_documento->>'dataVenda', '')::timestamptz, now()),
    nullif(v_documento->>'observacoes', ''), p_origem_dispositivo_id, p_dados
  ) returning * into v_venda;
  return to_jsonb(v_venda);
exception when unique_violation then
  if p_tipo = 'compra' then
    select c.* into v_compra from public.compras c
     where c.empresa_id = v_empresa_id and c.id_exportacao = btrim(p_id_exportacao);
    if found then return to_jsonb(v_compra); end if;
  else
    select v.* into v_venda from public.vendas v
     where v.empresa_id = v_empresa_id and v.id_exportacao = btrim(p_id_exportacao);
    if found then return to_jsonb(v_venda); end if;
  end if;
  raise;
end
$$;

create or replace function public.atualizar_documento_comercial_mobile(
  p_tipo text,
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
  v_valor numeric(14,2) := greatest(coalesce(nullif(p_dados->>'valor_total', '')::numeric, 0), 0);
  v_compra public.compras;
  v_venda public.vendas;
begin
  if v_empresa_id is null or p_tipo not in ('compra', 'venda') then
    raise exception using errcode = '42501', message = 'sessão ou documento inválido';
  end if;
  if p_tipo = 'compra' then
    if not app_private.tem_permissao('estoque', 'editar') then
      raise exception using errcode = '42501', message = 'sem permissão para atualizar compra';
    end if;
    update public.compras c set
      fornecedor_nome = nullif(btrim(v_documento #>> '{vendedor,nome}'), ''),
      descricao = coalesce(nullif(btrim(concat_ws(' ', v_documento #>> '{aparelho,marca}', v_documento #>> '{aparelho,modelo}')), ''), c.descricao),
      valor_unitario = v_valor, valor_total = v_valor,
      observacoes = nullif(v_documento #>> '{dadosCompra,observacoes}', ''),
      dados_extras = p_dados, revision = c.revision + 1, updated_at = now()
     where c.empresa_id = v_empresa_id and c.id = p_id and c.revision = p_revision and c.deleted_at is null
     returning * into v_compra;
    if not found then raise exception using errcode = '40001', message = 'conflito de revisão na compra'; end if;
    return to_jsonb(v_compra);
  end if;

  if not app_private.tem_permissao('vendas', 'editar') then
    raise exception using errcode = '42501', message = 'sem permissão para atualizar venda';
  end if;
  update public.vendas v set
    cliente_nome_snapshot = nullif(v_documento->>'compradorNome', ''),
    itens = jsonb_build_array(v_documento), valor_total = v_valor,
    forma_pagamento = nullif(v_documento->>'formaPagamento', ''),
    observacoes = nullif(v_documento->>'observacoes', ''),
    dados_extras = p_dados, revision = v.revision + 1, updated_at = now()
   where v.empresa_id = v_empresa_id and v.id = p_id and v.revision = p_revision and v.deleted_at is null
   returning * into v_venda;
  if not found then raise exception using errcode = '40001', message = 'conflito de revisão na venda'; end if;
  return to_jsonb(v_venda);
end
$$;

create or replace function public.registrar_arquivo_comercial_mobile(
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
  if v_empresa_id is null or p_entidade_tipo not in ('compra', 'venda') then
    raise exception using errcode = '42501', message = 'sessão ou entidade comercial inválida';
  end if;
  if (p_entidade_tipo = 'compra' and not (
        app_private.tem_permissao('estoque', 'criar') or app_private.tem_permissao('estoque', 'editar')
      )) or (p_entidade_tipo = 'venda' and not (
        app_private.tem_permissao('vendas', 'criar') or app_private.tem_permissao('vendas', 'editar')
      )) then
    raise exception using errcode = '42501', message = 'sem permissão para enviar assinatura';
  end if;
  if (p_entidade_tipo = 'compra' and not exists (
        select 1 from public.compras c where c.empresa_id = v_empresa_id and c.id = p_entidade_id and c.deleted_at is null
      )) or (p_entidade_tipo = 'venda' and not exists (
        select 1 from public.vendas v where v.empresa_id = v_empresa_id and v.id = p_entidade_id and v.deleted_at is null
      )) then
    raise exception using errcode = 'P0002', message = 'documento comercial não encontrado';
  end if;
  if p_origem_dispositivo_id is not null and not exists (
    select 1 from public.dispositivos d where d.empresa_id = v_empresa_id
      and d.id = p_origem_dispositivo_id and d.usuario_id = auth.uid() and d.tipo = 'android'
  ) then
    raise exception using errcode = '42501', message = 'dispositivo Android inválido';
  end if;
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
    v_empresa_id, p_entidade_tipo, p_entidade_id,
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

revoke all on function public.criar_documento_comercial_mobile(text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.atualizar_documento_comercial_mobile(text, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.registrar_arquivo_comercial_mobile(public.entidade_tipo, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.criar_documento_comercial_mobile(text, text, jsonb, uuid) to authenticated;
grant execute on function public.atualizar_documento_comercial_mobile(text, uuid, bigint, jsonb) to authenticated;
grant execute on function public.registrar_arquivo_comercial_mobile(public.entidade_tipo, uuid, text, jsonb, uuid) to authenticated;
