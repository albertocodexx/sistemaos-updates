-- O modulo fiscal e um adicional opcional: nao deve vir gratuito em planos pagos.
-- A ativacao depende de pagamento confirmado e nao altera o vencimento do plano.
alter table public.empresas
  add column if not exists beta_fundador_expira_em timestamptz,
  add column if not exists modulo_fiscal_ativo_ate timestamptz;

update public.empresas
   set beta_fundador_expira_em = coalesce(inicio_trial, created_at) + interval '1 year'
 where beta_fundador and beta_fundador_expira_em is null;

comment on column public.empresas.beta_fundador_expira_em is
  'Preco beta ate um ano apos o inicio do teste; a elegibilidade historica permanece para auditoria.';
comment on column public.empresas.modulo_fiscal_ativo_ate is
  'Fim do adicional fiscal pago. A data so avanca por cobranca aprovada e aplicada.';

alter table public.cobrancas_assinatura
  add column if not exists fiscal_incluso boolean not null default false,
  add column if not exists fiscal_valor_centavos integer not null default 0
    check (fiscal_valor_centavos >= 0);
alter table public.cobrancas_assinatura
  drop constraint if exists cobrancas_assinatura_tipo_alteracao_check;
alter table public.cobrancas_assinatura
  add constraint cobrancas_assinatura_tipo_alteracao_check
  check (tipo_alteracao in ('renovacao','upgrade','downgrade','reativacao','primeira_assinatura','ativacao_fiscal'));

alter table public.contas_fiscais alter column preco_excedente_centavos set default 25;
update public.contas_fiscais set preco_excedente_centavos = 25, updated_at = now()
 where preco_excedente_centavos = 20;

-- O gatilho cobre inclusive chamadas diretas ao RPC com service_role. Nao confia
-- apenas no campo de permissao da interface, que pode estar em cache.
create or replace function public.exigir_adicional_fiscal_na_reserva()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'reservada' and not exists (
    select 1 from public.empresas e
     where e.id = new.empresa_id and e.modulo_fiscal_ativo_ate > now()
       and e.ativo and e.licenca_status = 'ativa' and e.data_vencimento > now()
  ) then
    raise exception using errcode = '42501',
      message = 'O modulo fiscal nao esta ativo para esta empresa. Contrate o adicional antes de emitir.';
  end if;
  return new;
end $$;
revoke all on function public.exigir_adicional_fiscal_na_reserva() from public, anon, authenticated;
drop trigger if exists trg_exigir_adicional_fiscal_na_reserva on public.reservas_fiscais;
create trigger trg_exigir_adicional_fiscal_na_reserva before insert on public.reservas_fiscais
  for each row execute function public.exigir_adicional_fiscal_na_reserva();

-- Renovacao do plano com a opcao fiscal paga na mesma cobranca: somente apos o
-- RPC aplicar o pagamento e atualizar o vencimento do plano.
create or replace function public.prorrogar_adicional_fiscal_pago()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.aplicado_em is null and new.aplicado_em is not null and
     new.fiscal_incluso and new.tipo_alteracao <> 'ativacao_fiscal' then
    update public.empresas e set
      modulo_fiscal_ativo_ate = greatest(coalesce(e.modulo_fiscal_ativo_ate, now()), e.data_vencimento),
      recursos_habilitados = coalesce(e.recursos_habilitados, '{}'::jsonb) || '{"fiscal_habilitado":true}'::jsonb,
      updated_at = now()
    where e.id = new.empresa_id;
  end if;
  return new;
end $$;
revoke all on function public.prorrogar_adicional_fiscal_pago() from public, anon, authenticated;
drop trigger if exists trg_prorrogar_adicional_fiscal_pago on public.cobrancas_assinatura;
create trigger trg_prorrogar_adicional_fiscal_pago after update of aplicado_em on public.cobrancas_assinatura
  for each row execute function public.prorrogar_adicional_fiscal_pago();

create or replace function public.aplicar_pagamento_modulo_fiscal(
  p_cobranca_id uuid, p_pagamento_provedor_id text,
  p_pago_em timestamptz default now(), p_forma text default 'mercado_pago',
  p_dados_provedor jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare c public.cobrancas_assinatura%rowtype; e public.empresas%rowtype; v_pagamento_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;
  select * into c from public.cobrancas_assinatura where id = p_cobranca_id for update;
  if not found or c.tipo_alteracao <> 'ativacao_fiscal' or not c.fiscal_incluso then
    raise exception 'cobranca do adicional fiscal invalida';
  end if;
  if c.aplicado_em is not null then
    if c.pagamento_provedor_id <> p_pagamento_provedor_id then raise exception 'pagamento divergente'; end if;
    return jsonb_build_object('aplicado', false, 'ja_aplicado', true);
  end if;
  if c.status <> 'aprovada' or nullif(btrim(p_pagamento_provedor_id), '') is null then
    raise exception 'pagamento fiscal nao aprovado';
  end if;
  select * into e from public.empresas where id = c.empresa_id for update;
  if not found or e.data_vencimento <= now() or e.licenca_status <> 'ativa' then
    raise exception 'plano da empresa nao esta ativo';
  end if;
  insert into public.pagamentos_assinatura
    (empresa_id, plano_id, valor, vencimento_em, pago_em, forma, referencia,
     status, observacao, cobranca_id, provedor, pagamento_provedor_id)
  values (c.empresa_id, c.plano_id, c.valor, e.data_vencimento, coalesce(p_pago_em,now()),
    nullif(btrim(p_forma),''), c.referencia_externa, 'pago',
    'Adicional fiscal proporcional confirmado pelo Mercado Pago.', c.id,
    c.provedor, p_pagamento_provedor_id)
  returning id into v_pagamento_id;
  update public.empresas set
    modulo_fiscal_ativo_ate = greatest(coalesce(modulo_fiscal_ativo_ate, now()), e.data_vencimento),
    recursos_habilitados = coalesce(recursos_habilitados, '{}'::jsonb) || '{"fiscal_habilitado":true}'::jsonb,
    updated_at = now()
  where id = c.empresa_id;
  update public.cobrancas_assinatura set
    pagamento_provedor_id = p_pagamento_provedor_id, pago_em = coalesce(p_pago_em,now()),
    aplicado_em = now(), dados_provedor = coalesce(p_dados_provedor,'{}'::jsonb), updated_at = now()
  where id = c.id;
  insert into public.eventos_licenca (empresa_id,tipo,motivo,dados)
  values (c.empresa_id,'pagamento_confirmado','Adicional fiscal pago',
    jsonb_build_object('cobranca_id',c.id,'pagamento_id',v_pagamento_id,'fiscal_ate',e.data_vencimento));
  return jsonb_build_object('aplicado', true, 'fiscal_ate', e.data_vencimento);
end $$;
revoke all on function public.aplicar_pagamento_modulo_fiscal(uuid,text,timestamptz,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.aplicar_pagamento_modulo_fiscal(uuid,text,timestamptz,text,jsonb)
  to service_role;
