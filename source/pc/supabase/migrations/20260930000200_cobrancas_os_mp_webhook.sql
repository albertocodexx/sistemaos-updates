-- Cobranças de OS confirmadas no servidor mesmo com PC e APK fechados.
-- O webhook nunca confia no corpo recebido: ele consulta o pagamento na API
-- do Mercado Pago e a aplicação transacional confere tenant, valor e moeda.

create table if not exists public.cobrancas_os_mp (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  ordem_id uuid not null,
  numero_os text not null,
  valor_centavos bigint not null check (valor_centavos > 0),
  moeda text not null default 'BRL' check (moeda = 'BRL'),
  referencia_externa text not null unique,
  idempotency_key uuid not null default gen_random_uuid() unique,
  webhook_token_hash text not null check (webhook_token_hash ~ '^[0-9a-f]{64}$'),
  preferencia_id text,
  checkout_url text,
  status text not null default 'pendente'
    check (status in ('pendente','em_processamento','aprovada','rejeitada','cancelada','estornada')),
  pagamento_provedor_id text,
  pago_em timestamptz,
  dados_provedor jsonb not null default '{}'::jsonb check (jsonb_typeof(dados_provedor) = 'object'),
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (empresa_id, ordem_id) references public.ordens_servico(empresa_id, id) on delete restrict
);

create unique index if not exists cobrancas_os_mp_pagamento_uidx
  on public.cobrancas_os_mp (pagamento_provedor_id)
  where pagamento_provedor_id is not null and pagamento_provedor_id <> '';
create index if not exists cobrancas_os_mp_empresa_idx
  on public.cobrancas_os_mp (empresa_id, created_at desc);
create index if not exists cobrancas_os_mp_pendentes_idx
  on public.cobrancas_os_mp (status, updated_at)
  where status in ('pendente','em_processamento');

alter table public.cobrancas_os_mp enable row level security;
drop policy if exists cobrancas_os_mp_select_empresa on public.cobrancas_os_mp;
create policy cobrancas_os_mp_select_empresa on public.cobrancas_os_mp
  for select to authenticated using (empresa_id = app_private.current_profile_empresa_id());

create or replace function public.sincronizar_preferencia_os_mp(p_cobranca_id uuid, p_checkout_url text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare c public.cobrancas_os_mp%rowtype; o public.ordens_servico%rowtype;
declare v_extras jsonb; v_lista jsonb; v_item_id text; v_agora text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;
  select * into c from public.cobrancas_os_mp where id = p_cobranca_id for update;
  if not found then raise exception 'cobranca nao encontrada'; end if;
  select * into o from public.ordens_servico where empresa_id = c.empresa_id and id = c.ordem_id and deleted_at is null for update;
  if not found then raise exception 'ordem nao encontrada'; end if;
  v_extras := coalesce(o.dados_extras, '{}'::jsonb);
  v_lista := case when jsonb_typeof(v_extras->'lembretes_cobranca') = 'array'
    then v_extras->'lembretes_cobranca' else '[]'::jsonb end;
  v_item_id := 'mp-' || c.id::text;
  v_agora := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if not exists (select 1 from jsonb_array_elements(v_lista) e where e->>'id' = v_item_id) then
    v_lista := v_lista || jsonb_build_array(jsonb_build_object(
      'id', v_item_id, 'data', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
      'valor', c.valor_centavos / 100.0, 'status', 'pendente',
      'observacao', 'Mercado Pago', 'mercadoPago', true,
      'referenciaExterna', c.referencia_externa, 'checkoutUrl', left(p_checkout_url, 2000),
      'criadoEm', v_agora, 'atualizadoEm', v_agora
    ));
  end if;
  v_extras := jsonb_set(v_extras, '{lembretes_cobranca}', v_lista, true);
  update public.ordens_servico set dados_extras = v_extras, revision = revision + 1, updated_at = now()
    where id = o.id and empresa_id = o.empresa_id;
  return jsonb_build_object('sincronizada', true, 'ordem_id', o.id, 'numero', o.numero);
end $$;

create or replace function public.aplicar_status_cobranca_os_mp(
  p_cobranca_id uuid, p_pagamento_id text, p_status text, p_valor_centavos bigint,
  p_pago_em timestamptz, p_dados_provedor jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare c public.cobrancas_os_mp%rowtype; o public.ordens_servico%rowtype;
declare v_extras jsonb; v_lista jsonb; v_item_id text; v_agora text;
declare v_total numeric; v_base numeric; v_pago numeric; v_recebido numeric; v_percentual integer; v_status_pagamento text;
declare v_valor_pago numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;
  if p_status not in ('pendente','em_processamento','aprovada','rejeitada','cancelada','estornada') then
    raise exception 'status de cobranca invalido';
  end if;
  select * into c from public.cobrancas_os_mp where id = p_cobranca_id for update;
  if not found then raise exception 'cobranca nao encontrada'; end if;
  if c.valor_centavos <> p_valor_centavos or c.moeda <> 'BRL' then raise exception 'valor ou moeda divergente'; end if;
  if c.pagamento_provedor_id is not null and c.pagamento_provedor_id <> p_pagamento_id then
    raise exception 'pagamento divergente';
  end if;
  if c.status = p_status and c.pagamento_provedor_id = p_pagamento_id and
      c.dados_provedor = coalesce(p_dados_provedor, '{}'::jsonb) then
    return jsonb_build_object('aplicada', false, 'reutilizada', true, 'status', c.status);
  end if;
  select * into o from public.ordens_servico where empresa_id = c.empresa_id and id = c.ordem_id and deleted_at is null for update;
  if not found then raise exception 'ordem nao encontrada'; end if;

  v_extras := coalesce(o.dados_extras, '{}'::jsonb);
  v_lista := case when jsonb_typeof(v_extras->'lembretes_cobranca') = 'array'
    then v_extras->'lembretes_cobranca' else '[]'::jsonb end;
  v_item_id := 'mp-' || c.id::text;
  v_agora := to_char(coalesce(p_pago_em, now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_valor_pago := case when p_status = 'aprovada' and coalesce(p_dados_provedor->>'valor_liquido_centavos','') ~ '^\d+$'
    then least(c.valor_centavos, (p_dados_provedor->>'valor_liquido_centavos')::bigint) / 100.0
    when p_status = 'aprovada' then c.valor_centavos / 100.0 else 0 end;
  select coalesce(jsonb_agg(
    case when e->>'id' = v_item_id then e || jsonb_build_object(
      'status', case when p_status = 'aprovada' then 'paga' when p_status = 'estornada' then 'estornada' else p_status end,
      'valorRecebido', v_valor_pago,
      'pagoEm', case when p_status = 'aprovada' then v_agora else null end,
      'confirmadoEm', case when p_status = 'aprovada' then v_agora else null end,
      'paymentId', p_pagamento_id, 'atualizadoEm', v_agora
    ) else e end), '[]'::jsonb)
    into v_lista from jsonb_array_elements(v_lista) e;

  v_base := case when coalesce(v_extras->>'valor_recebido_base_cobrancas','') ~ '^\d+(\.\d+)?$'
    then (v_extras->>'valor_recebido_base_cobrancas')::numeric else 0 end;
  select coalesce(sum(case
    when coalesce(e->>'status','') = 'paga' and coalesce(e->>'valorRecebido',e->>'valor','') ~ '^\d+(\.\d+)?$'
      then coalesce(e->>'valorRecebido',e->>'valor')::numeric else 0 end), 0)
    into v_pago from jsonb_array_elements(v_lista) e;
  v_total := greatest(o.valor, case when coalesce(v_extras->>'valor_total_servico','') ~ '^\d+(\.\d+)?$'
    then (v_extras->>'valor_total_servico')::numeric else 0 end);
  v_recebido := case when v_total > 0 then least(v_total, v_base + v_pago) else v_base + v_pago end;
  v_percentual := case when v_total > 0 then least(100, round(v_recebido / v_total * 100)::integer) else 0 end;
  v_status_pagamento := case when v_total > 0 and v_percentual >= 100 then 'Pago'
    when v_percentual >= 50 then 'Pago 50%' else 'Aguardando Pagamento' end;
  v_extras := jsonb_set(v_extras, '{lembretes_cobranca}', v_lista, true);
  v_extras := jsonb_set(v_extras, '{valor_recebido_confirmado}', to_jsonb(round(v_recebido, 2)), true);
  v_extras := jsonb_set(v_extras, '{valor_restante_servico}', to_jsonb(greatest(0, round(v_total - v_recebido, 2))), true);
  v_extras := jsonb_set(v_extras, '{percentual_pagamento_confirmado}', to_jsonb(v_percentual), true);
  v_extras := jsonb_set(v_extras, '{status_pagamento_local}', to_jsonb(v_status_pagamento), true);

  update public.cobrancas_os_mp set status = p_status, pagamento_provedor_id = p_pagamento_id,
    pago_em = case when p_status = 'aprovada' then coalesce(p_pago_em, now()) else pago_em end,
    dados_provedor = coalesce(p_dados_provedor, '{}'::jsonb), ultimo_erro = null, updated_at = now()
    where id = c.id;
  update public.ordens_servico set dados_extras = v_extras,
    status_pagamento = v_status_pagamento,
    forma_pagamento = case when p_status = 'aprovada' and coalesce(btrim(forma_pagamento),'') = '' then 'Mercado Pago' else forma_pagamento end,
    revision = revision + 1, updated_at = now()
    where id = o.id and empresa_id = o.empresa_id;

  if p_status = 'aprovada' and length(regexp_replace(coalesce(o.cliente_telefone_snapshot,''), '[^0-9]', '', 'g')) between 10 and 15 then
    insert into public.fila_whatsapp (empresa_id,origem,destinatario,mensagem_fallback,chave_unica,parametros)
    values (c.empresa_id,'os',regexp_replace(o.cliente_telefone_snapshot,'[^0-9]','','g'),
      'Pagamento de R$ ' || to_char(c.valor_centavos / 100.0, 'FM999G999G990D00') || ' confirmado na ' || o.numero || '. Obrigado!',
      'whatsapp:os-pagamento:' || c.id::text,
      jsonb_build_object('numero_os',o.numero,'valor',c.valor_centavos / 100.0,'cobranca_id',c.id))
    on conflict (chave_unica) do nothing;
  end if;
  insert into public.auditoria_comercial (empresa_id,autor_id,acao,entidade,entidade_id,metadados)
    values (c.empresa_id,null,'mercado_pago_os_' || p_status,'ordens_servico',o.id,
      jsonb_build_object('cobranca_id',c.id,'numero_os',o.numero,'valor_centavos',c.valor_centavos));
  return jsonb_build_object('aplicada', true, 'status', p_status, 'numero_os', o.numero,
    'recebido', round(v_recebido,2), 'restante', greatest(0,round(v_total-v_recebido,2)));
end $$;

revoke all on function public.sincronizar_preferencia_os_mp(uuid,text) from public, anon, authenticated;
revoke all on function public.aplicar_status_cobranca_os_mp(uuid,text,text,bigint,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_preferencia_os_mp(uuid,text) to service_role;
grant execute on function public.aplicar_status_cobranca_os_mp(uuid,text,text,bigint,timestamptz,jsonb) to service_role;

comment on table public.cobrancas_os_mp is
  'Checkout e confirmacao idempotente de pagamentos de OS pelo Mercado Pago.';
