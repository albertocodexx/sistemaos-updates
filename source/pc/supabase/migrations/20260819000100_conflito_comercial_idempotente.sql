-- Impede que APKs antigos derrubem o PostgREST ao reenviar indefinidamente
-- uma Compra/Venda cuja revision ja foi atualizada por outro dispositivo.
--
-- Em vez de lançar SQLSTATE 40001 (que aborta a transacao, ocupa uma conexao
-- e faz clientes antigos tentarem de novo), devolvemos o registro atual com
-- um marcador. Versoes antigas entendem como sucesso idempotente e param de
-- reenviar; as novas podem avisar que prevaleceu a versao mais recente.
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
    raise exception using errcode = '42501', message = 'sessao ou documento invalido';
  end if;

  if p_tipo = 'compra' then
    if not app_private.tem_permissao('estoque', 'editar') then
      raise exception using errcode = '42501', message = 'sem permissao para atualizar compra';
    end if;
    update public.compras c set
      fornecedor_nome = nullif(btrim(v_documento #>> '{vendedor,nome}'), ''),
      descricao = coalesce(nullif(btrim(concat_ws(' ', v_documento #>> '{aparelho,marca}', v_documento #>> '{aparelho,modelo}')), ''), c.descricao),
      valor_unitario = v_valor,
      valor_total = v_valor,
      observacoes = nullif(v_documento #>> '{dadosCompra,observacoes}', ''),
      dados_extras = p_dados,
      revision = c.revision + 1,
      updated_at = now()
    where c.empresa_id = v_empresa_id
      and c.id = p_id
      and c.revision = p_revision
      and c.deleted_at is null
    returning * into v_compra;

    if found then return to_jsonb(v_compra); end if;

    select c.* into v_compra
      from public.compras c
     where c.empresa_id = v_empresa_id and c.id = p_id and c.deleted_at is null;
    if found then
      return to_jsonb(v_compra) || jsonb_build_object(
        '_sync_conflito', true,
        '_sync_mensagem', 'A versao mais recente da compra foi mantida.'
      );
    end if;
    raise exception using errcode = 'P0002', message = 'compra nao encontrada';
  end if;

  if not app_private.tem_permissao('vendas', 'editar') then
    raise exception using errcode = '42501', message = 'sem permissao para atualizar venda';
  end if;
  update public.vendas v set
    cliente_nome_snapshot = nullif(v_documento->>'compradorNome', ''),
    itens = jsonb_build_array(v_documento),
    valor_total = v_valor,
    forma_pagamento = nullif(v_documento->>'formaPagamento', ''),
    observacoes = nullif(v_documento->>'observacoes', ''),
    dados_extras = p_dados,
    revision = v.revision + 1,
    updated_at = now()
  where v.empresa_id = v_empresa_id
    and v.id = p_id
    and v.revision = p_revision
    and v.deleted_at is null
  returning * into v_venda;

  if found then return to_jsonb(v_venda); end if;

  select v.* into v_venda
    from public.vendas v
   where v.empresa_id = v_empresa_id and v.id = p_id and v.deleted_at is null;
  if found then
    return to_jsonb(v_venda) || jsonb_build_object(
      '_sync_conflito', true,
      '_sync_mensagem', 'A versao mais recente da venda foi mantida.'
    );
  end if;
  raise exception using errcode = 'P0002', message = 'venda nao encontrada';
end
$$;

revoke all on function public.atualizar_documento_comercial_mobile(text, uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.atualizar_documento_comercial_mobile(text, uuid, bigint, jsonb)
  to authenticated;

