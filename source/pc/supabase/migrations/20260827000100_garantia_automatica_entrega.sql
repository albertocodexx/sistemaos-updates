-- Garantia automática no servidor: funciona mesmo com o PC desligado.
-- Mantém RLS, permissões e unicidade empresa/OS já existentes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.garantias add column if not exists dados_extras jsonb not null default '{}'::jsonb;

create or replace function app_private.garantia_automatica_entrega()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o public.ordens_servico;
  d jsonb := coalesce(new.dados_extras->'documento_mobile', '{}'::jsonb);
  inicio date;
  termos_config text;
begin
  if new.deleted_at is not null then return new; end if;
  select * into o from public.ordens_servico where empresa_id = new.empresa_id and id = new.ordem_servico_id and deleted_at is null;
  if not found then return new; end if;
  -- Editar recebedor/assinatura não substitui uma garantia ajustada separadamente.
  if exists (select 1 from public.garantias where empresa_id = new.empresa_id and ordem_servico_id = new.ordem_servico_id and dados_extras->>'origem' = 'manual') then
    if TG_OP = 'INSERT' then return new; end if;
    if new.garantia_dias is not distinct from old.garantia_dias
      and coalesce(d->>'garantiaDataInicio', left(new.entregue_em::text, 10)) is not distinct from coalesce(old.dados_extras #>> '{documento_mobile,garantiaDataInicio}', left(old.entregue_em::text, 10)) then return new; end if;
  end if;
  inicio := coalesce(nullif(d->>'garantiaDataInicio', '')::date, (new.entregue_em at time zone 'America/Sao_Paulo')::date, current_date);
  if new.garantia_dias = 0 then
    update public.garantias set garantia_dias = 0, data_limite = null
      where empresa_id = new.empresa_id and ordem_servico_id = new.ordem_servico_id and garantia_dias <> 0;
    return new;
  end if;
  select coalesce(configuracoes #>> '{identidadeEmpresa,configMobile,termosCustomGarantia}', '') into termos_config
    from public.configuracoes_empresa where empresa_id = new.empresa_id;
  insert into public.garantias as g (
    empresa_id, ordem_servico_id, numero_os_snapshot, cliente_nome_snapshot, cliente_telefone_snapshot,
    aparelho_snapshot, marca_snapshot, modelo_snapshot, imei_snapshot, reparo_realizado,
    garantia_dias, data_abertura, data_limite, termos, dados_extras
  ) values (
    new.empresa_id, o.id, o.numero, o.cliente_nome_snapshot, o.cliente_telefone_snapshot,
    coalesce(new.aparelho_snapshot, o.aparelho), coalesce(new.marca_snapshot, o.marca), coalesce(new.modelo_snapshot, o.modelo), o.imei,
    new.reparo_realizado, new.garantia_dias, inicio, inicio + new.garantia_dias,
    coalesce(d->>'termosGarantia', termos_config, ''),
    jsonb_build_object('origem', 'entrega', 'clienteCpf', o.cliente_cpf_snapshot,
      'clienteId', coalesce(o.dados_extras->'cliente_id_numero', d->'clienteId'),
      'clienteNumero', coalesce(o.dados_extras->'cliente_id_numero', d->'clienteId', '"00000"'::jsonb))
  ) on conflict (empresa_id, ordem_servico_id) do update set
    cliente_nome_snapshot = excluded.cliente_nome_snapshot, cliente_telefone_snapshot = excluded.cliente_telefone_snapshot,
    marca_snapshot = excluded.marca_snapshot, modelo_snapshot = excluded.modelo_snapshot, imei_snapshot = excluded.imei_snapshot,
    aparelho_snapshot = excluded.aparelho_snapshot, reparo_realizado = excluded.reparo_realizado,
    garantia_dias = excluded.garantia_dias, data_abertura = excluded.data_abertura, data_limite = excluded.data_limite,
    termos = coalesce(d->>'termosGarantia', g.termos, excluded.termos),
    dados_extras = g.dados_extras || excluded.dados_extras;
  return new;
end $$;
create or replace trigger trg_garantia_automatica_entrega
after insert or update of garantia_dias, entregue_em, dados_extras, reparo_realizado on public.entregas
for each row execute function app_private.garantia_automatica_entrega();

-- Não regrava entregas antigas nem altera assinaturas na aplicação da migração.
commit;
