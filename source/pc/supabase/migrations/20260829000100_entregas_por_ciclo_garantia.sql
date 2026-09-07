-- Mantém o primeiro comprovante de entrega e cria um documento independente
-- para cada retorno em garantia. A identidade deixa de ser apenas a OS e
-- passa a ser OS + ciclo_entrega_id (original ou o id do retorno).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.entregas
  add column if not exists ciclo_entrega_id text not null default 'original',
  add column if not exists tipo_entrega text not null default 'original',
  add column if not exists retorno_garantia_id text,
  add column if not exists garantia_id uuid;

update public.entregas
   set ciclo_entrega_id = coalesce(nullif(btrim(ciclo_entrega_id), ''), 'original'),
       tipo_entrega = case when retorno_garantia_id is null then 'original' else 'retorno_garantia' end;

alter table public.entregas drop constraint if exists entregas_empresa_id_ordem_servico_id_key;
alter table public.entregas drop constraint if exists entregas_tipo_entrega_check;
alter table public.entregas add constraint entregas_tipo_entrega_check
  check (tipo_entrega in ('original', 'retorno_garantia'));
alter table public.entregas drop constraint if exists entregas_retorno_coerente_check;
alter table public.entregas add constraint entregas_retorno_coerente_check check (
  (tipo_entrega = 'original' and retorno_garantia_id is null and ciclo_entrega_id = 'original') or
  (tipo_entrega = 'retorno_garantia' and retorno_garantia_id is not null and ciclo_entrega_id = retorno_garantia_id)
);
alter table public.entregas drop constraint if exists entregas_empresa_garantia_fkey;
alter table public.entregas add constraint entregas_empresa_garantia_fkey
  foreign key (empresa_id, garantia_id) references public.garantias(empresa_id, id) on delete restrict;

create unique index if not exists entregas_empresa_os_ciclo_ativo_uidx
  on public.entregas (empresa_id, ordem_servico_id, ciclo_entrega_id)
  where deleted_at is null;
create index if not exists entregas_empresa_retorno_idx
  on public.entregas (empresa_id, retorno_garantia_id)
  where retorno_garantia_id is not null and deleted_at is null;

create or replace view public.vw_entregas_leve with (security_invoker = true) as
select
  e.id, e.empresa_id, e.ordem_servico_id, e.numero_os_snapshot,
  e.cliente_nome_snapshot, e.retirado_por, e.aparelho_snapshot,
  e.marca_snapshot, e.modelo_snapshot, e.reparo_realizado,
  e.status, e.entregue_em, e.garantia_dias, e.data_limite_garantia,
  e.forma_entrega, e.observacoes, e.revision, e.created_at, e.updated_at,
  exists(select 1 from public.arquivos a where a.empresa_id = e.empresa_id
    and a.entidade_tipo = 'entrega' and a.entidade_id = e.id
    and a.categoria = 'assinatura_cliente'
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
      and a.entidade_id = e.id and a.deleted_at is null), '[]'::jsonb) as disponibilidades_arquivos,
  coalesce(e.dados_extras #>> '{documento_mobile,naoAssinado}', 'false') = 'true' as nao_assinado,
  coalesce(e.dados_extras #>> '{documento_mobile,assinaturaPendente}', 'false') = 'true' as assinatura_pendente,
  -- PostgreSQL exige que novas colunas sejam anexadas ao final no CREATE OR REPLACE VIEW.
  e.ciclo_entrega_id, e.tipo_entrega, e.retorno_garantia_id, e.garantia_id
from public.entregas e where e.deleted_at is null;

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
  v_numero text := nullif(btrim(coalesce(p_dados->'documento_mobile'->>'numeroOS', '')), '');
  v_ciclo text := coalesce(nullif(btrim(p_dados->'documento_mobile'->>'cicloEntregaId'), ''),
                           nullif(btrim(p_dados->'documento_mobile'->>'retornoGarantiaId'), ''), 'original');
  v_retorno text := nullif(btrim(p_dados->'documento_mobile'->>'retornoGarantiaId'), '');
  v_tipo text;
  v_garantia uuid := nullif(p_dados->'documento_mobile'->>'garantiaId', '')::uuid;
  v_ordem public.ordens_servico;
  v_entrega public.entregas;
  v_status public.entrega_status;
  v_entregue_em timestamptz;
  v_valor numeric(14,2) := greatest(coalesce(nullif(p_dados->>'valor_total', '')::numeric, 0), 0);
begin
  if v_empresa_id is null or not (
    app_private.tem_permissao('os', 'criar') or app_private.tem_permissao('os', 'editar')
  ) then raise exception using errcode = '42501', message = 'sem permissao para registrar entrega'; end if;
  if nullif(btrim(p_id_exportacao), '') is null or v_numero is null or jsonb_typeof(v_documento) <> 'object' then
    raise exception using errcode = '22023', message = 'numero da OS e dados da entrega sao obrigatorios';
  end if;
  if v_ciclo <> 'original' and v_retorno is null then v_retorno := v_ciclo; end if;
  v_tipo := case when v_retorno is null then 'original' else 'retorno_garantia' end;
  if v_tipo = 'original' then v_ciclo := 'original'; end if;
  if p_origem_dispositivo_id is not null and not exists (
    select 1 from public.dispositivos d where d.empresa_id = v_empresa_id
      and d.id = p_origem_dispositivo_id and d.usuario_id = auth.uid() and d.tipo = 'android'
  ) then raise exception using errcode = '42501', message = 'dispositivo Android invalido'; end if;

  select o.* into v_ordem from public.ordens_servico o
   where o.empresa_id = v_empresa_id and o.deleted_at is null and (
     upper(btrim(o.numero)) = upper(v_numero) or
     regexp_replace(o.numero, '[^0-9]', '', 'g') = regexp_replace(v_numero, '[^0-9]', '', 'g')
   ) order by o.updated_at desc limit 1;
  if not found then raise exception using errcode = 'P0002', message = 'OS informada nao foi encontrada nesta empresa'; end if;

  select e.* into v_entrega from public.entregas e
   where e.empresa_id = v_empresa_id and e.id_exportacao = btrim(p_id_exportacao);
  if found then return to_jsonb(v_entrega); end if;
  select e.* into v_entrega from public.entregas e
   where e.empresa_id = v_empresa_id and e.ordem_servico_id = v_ordem.id
     and e.ciclo_entrega_id = v_ciclo and e.deleted_at is null for update;

  v_status := case when coalesce((v_documento->>'assinaturaPendente')::boolean, false)
    then 'pendente_assinatura'::public.entrega_status else 'concluida'::public.entrega_status end;
  v_entregue_em := case when v_status = 'concluida'
    then coalesce(nullif(v_documento->>'dataHoraAssinatura', '')::timestamptz, now()) else null end;
  if found and v_entrega.status = 'concluida' then return to_jsonb(v_entrega); end if;

  if found then
    update public.entregas e set
      cliente_nome_snapshot = coalesce(nullif(btrim(v_documento->>'nomeRetirou'), ''), v_ordem.cliente_nome_snapshot),
      retirado_por = nullif(btrim(v_documento->>'nomeRetirou'), ''), documento_retirada = nullif(btrim(v_documento->>'cpfRetirou'), ''),
      aparelho_snapshot = nullif(btrim(concat_ws(' ', v_documento->>'marca', v_documento->>'modelo')), ''),
      marca_snapshot = nullif(btrim(v_documento->>'marca'), ''), modelo_snapshot = nullif(btrim(v_documento->>'modelo'), ''),
      reparo_realizado = nullif(btrim(v_documento->>'reparoRealizado'), ''), status = v_status, entregue_em = v_entregue_em,
      garantia_dias = greatest(coalesce(nullif(v_documento->>'garantiaDias', '')::integer, 0), 0),
      data_limite_garantia = nullif(v_documento->>'dataLimiteGarantia', '')::date,
      observacoes = nullif(btrim(v_documento->>'declaracao'), ''), id_exportacao = btrim(p_id_exportacao),
      origem_dispositivo_id = p_origem_dispositivo_id, valor_reparo = v_valor,
      forma_pagamento = nullif(btrim(v_documento->>'formaPagamento'), ''), dados_extras = p_dados,
      revision = e.revision + 1, updated_at = now()
     where e.id = v_entrega.id returning * into v_entrega;
  else
    insert into public.entregas (
      empresa_id, ordem_servico_id, numero_os_snapshot, ciclo_entrega_id, tipo_entrega,
      retorno_garantia_id, garantia_id, cliente_nome_snapshot, retirado_por,
      documento_retirada, aparelho_snapshot, marca_snapshot, modelo_snapshot,
      reparo_realizado, status, entregue_em, garantia_dias, data_limite_garantia,
      forma_entrega, observacoes, id_exportacao, origem_dispositivo_id,
      valor_reparo, forma_pagamento, dados_extras
    ) values (
      v_empresa_id, v_ordem.id, v_ordem.numero, v_ciclo, v_tipo, v_retorno, v_garantia,
      coalesce(nullif(btrim(v_documento->>'nomeRetirou'), ''), v_ordem.cliente_nome_snapshot),
      nullif(btrim(v_documento->>'nomeRetirou'), ''), nullif(btrim(v_documento->>'cpfRetirou'), ''),
      nullif(btrim(concat_ws(' ', v_documento->>'marca', v_documento->>'modelo')), ''),
      nullif(btrim(v_documento->>'marca'), ''), nullif(btrim(v_documento->>'modelo'), ''),
      nullif(btrim(v_documento->>'reparoRealizado'), ''), v_status, v_entregue_em,
      greatest(coalesce(nullif(v_documento->>'garantiaDias', '')::integer, 0), 0),
      nullif(v_documento->>'dataLimiteGarantia', '')::date, 'retirada',
      nullif(btrim(v_documento->>'declaracao'), ''), btrim(p_id_exportacao), p_origem_dispositivo_id,
      v_valor, nullif(btrim(v_documento->>'formaPagamento'), ''), p_dados
    ) returning * into v_entrega;
  end if;
  return to_jsonb(v_entrega);
end $$;

create or replace function public.preparar_entrega_retorno_garantia(
  p_numero_os text,
  p_retorno_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  empresa uuid := app_private.current_user_empresa_id();
  ordem public.ordens_servico;
  garantia public.garantias;
  anterior public.entregas;
  entrega public.entregas;
  retorno jsonb;
  documento jsonb;
begin
  if empresa is null or not (app_private.tem_permissao('os','criar') or app_private.tem_permissao('os','editar')) then
    raise exception using errcode='42501', message='Sua conta não tem permissão para preparar esta entrega.';
  end if;
  if nullif(btrim(p_numero_os),'') is null or nullif(btrim(p_retorno_id),'') is null then
    raise exception using errcode='22023', message='Informe a OS e o retorno em garantia.';
  end if;
  select o.* into ordem from public.ordens_servico o where o.empresa_id=empresa and o.deleted_at is null
    and (upper(btrim(o.numero))=upper(btrim(p_numero_os)) or regexp_replace(o.numero,'[^0-9]','','g')=regexp_replace(p_numero_os,'[^0-9]','','g'))
    order by o.updated_at desc limit 1;
  if not found then raise exception using errcode='P0002', message='OS não encontrada nesta empresa.'; end if;
  select g.* into garantia from public.garantias g where g.empresa_id=empresa and g.ordem_servico_id=ordem.id and g.deleted_at is null for update;
  if not found then raise exception using errcode='P0002', message='Garantia não encontrada para esta OS.'; end if;
  select item into retorno from jsonb_array_elements(coalesce(garantia.dados_extras->'retornosGarantia','[]'::jsonb)) item
    where item->>'id'=p_retorno_id limit 1;
  if retorno is null then raise exception using errcode='P0002', message='Retorno em garantia não encontrado.'; end if;
  select e.* into entrega from public.entregas e where e.empresa_id=empresa and e.ordem_servico_id=ordem.id
    and e.ciclo_entrega_id=p_retorno_id and e.deleted_at is null;
  if found then return to_jsonb(entrega); end if;
  select e.* into anterior from public.entregas e where e.empresa_id=empresa and e.ordem_servico_id=ordem.id
    and e.deleted_at is null order by e.created_at desc limit 1;
  documento := jsonb_build_object(
    'numeroOS', ordem.numero, 'documentoEntregaId', 'ENTREGA-'||ordem.numero||'-'||p_retorno_id,
    'cicloEntregaId', p_retorno_id, 'tipoEntrega', 'retorno_garantia',
    'retornoGarantiaId', p_retorno_id, 'garantiaId', garantia.id,
    'nomeRetirou', coalesce(anterior.retirado_por, ordem.cliente_nome_snapshot),
    'cpfRetirou', coalesce(anterior.documento_retirada,''), 'telefoneRetirou', coalesce(ordem.cliente_telefone_snapshot,''),
    'marca', coalesce(ordem.marca,''), 'modelo', coalesce(ordem.modelo,''),
    'reparoRealizado', 'Retorno em garantia — '||coalesce(retorno->>'motivo','atendimento em garantia'),
    'valorReparo', 0, 'formaPagamento', '', 'garantiaDias', 0,
    'assinaturaPendente', true, 'naoAssinado', false, 'dataHoraAssinatura', now()
  );
  insert into public.entregas (
    empresa_id, ordem_servico_id, numero_os_snapshot, ciclo_entrega_id, tipo_entrega,
    retorno_garantia_id, garantia_id, cliente_nome_snapshot, retirado_por,
    documento_retirada, aparelho_snapshot, marca_snapshot, modelo_snapshot,
    reparo_realizado, status, entregue_em, garantia_dias, id_envio_assinatura,
    id_exportacao, valor_reparo, dados_extras
  ) values (
    empresa, ordem.id, ordem.numero, p_retorno_id, 'retorno_garantia', p_retorno_id, garantia.id,
    ordem.cliente_nome_snapshot, coalesce(anterior.retirado_por,ordem.cliente_nome_snapshot),
    anterior.documento_retirada, ordem.aparelho, ordem.marca, ordem.modelo,
    documento->>'reparoRealizado', 'pendente_assinatura', null, 0,
    'entrega-'||ordem.numero||'-'||p_retorno_id, 'retorno-garantia-'||garantia.id||'-'||p_retorno_id,
    0, jsonb_build_object('documento_mobile',documento,'valor_total',0)
  ) returning * into entrega;
  return to_jsonb(entrega);
end $$;

create or replace function app_private.marcar_os_entregue_ao_registrar_entrega()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is null and new.status='concluida' then
    update public.ordens_servico o set status='Entregue', data_conclusao=coalesce(o.data_conclusao,new.entregue_em,now())
     where o.empresa_id=new.empresa_id and o.id=new.ordem_servico_id and o.deleted_at is null and o.status not in ('Entregue','Cancelado');
  end if;
  return new;
end $$;

create or replace function app_private.finalizar_retorno_com_entrega()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  garantia public.garantias;
  retornos jsonb;
  agora text := now()::text;
begin
  if new.deleted_at is not null or new.status <> 'concluida' or new.retorno_garantia_id is null then return new; end if;
  select g.* into garantia from public.garantias g where g.empresa_id=new.empresa_id
    and g.id=coalesce(new.garantia_id,g.id) and g.ordem_servico_id=new.ordem_servico_id and g.deleted_at is null for update;
  if not found then return new; end if;
  select coalesce(jsonb_agg(case when item->>'id'=new.retorno_garantia_id then
    item || jsonb_build_object(
      'status','Entregue','atualizadoEm',agora,'encerradoEm',coalesce(nullif(item->>'encerradoEm',''),agora),
      'entregaSupabaseId',new.id,'cicloEntregaId',new.ciclo_entrega_id,
      'historico', case when item->>'status'='Entregue' then coalesce(item->'historico','[]'::jsonb) else
        coalesce(item->'historico','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'status','Entregue','em',agora,'observacao','Nova entrega do retorno concluída.','usuario',jsonb_build_object('id','sistema','nome','Sistema OS')
        )) end
    ) else item end),'[]'::jsonb) into retornos
    from jsonb_array_elements(coalesce(garantia.dados_extras->'retornosGarantia','[]'::jsonb)) item;
  update public.garantias set dados_extras=jsonb_set(
      jsonb_set(jsonb_set(dados_extras,'{retornosGarantia}',retornos,true),'{retornoAtualId}',to_jsonb(new.retorno_garantia_id),true),
      '{statusRetorno}','"Entregue"'::jsonb,true), updated_at=now(), revision=revision+1
    where id=garantia.id;
  return new;
end $$;

drop trigger if exists trg_finalizar_retorno_com_entrega on public.entregas;
create trigger trg_finalizar_retorno_com_entrega
after insert or update of status, deleted_at on public.entregas
for each row execute function app_private.finalizar_retorno_com_entrega();

create or replace function app_private.garantia_automatica_entrega()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o public.ordens_servico;
  d jsonb := coalesce(new.dados_extras->'documento_mobile', '{}'::jsonb);
  inicio date;
  termos_config text;
begin
  if new.deleted_at is not null or new.retorno_garantia_id is not null then return new; end if;
  select * into o from public.ordens_servico where empresa_id=new.empresa_id and id=new.ordem_servico_id and deleted_at is null;
  if not found then return new; end if;
  if exists (select 1 from public.garantias where empresa_id=new.empresa_id and ordem_servico_id=new.ordem_servico_id and dados_extras->>'origem'='manual') then
    if TG_OP='INSERT' then return new; end if;
    if new.garantia_dias is not distinct from old.garantia_dias and coalesce(d->>'garantiaDataInicio',left(new.entregue_em::text,10))
      is not distinct from coalesce(old.dados_extras #>> '{documento_mobile,garantiaDataInicio}',left(old.entregue_em::text,10)) then return new; end if;
  end if;
  inicio := coalesce(nullif(d->>'garantiaDataInicio','')::date,(new.entregue_em at time zone 'America/Sao_Paulo')::date,current_date);
  if new.garantia_dias=0 then
    update public.garantias set garantia_dias=0,data_limite=null where empresa_id=new.empresa_id and ordem_servico_id=new.ordem_servico_id and garantia_dias<>0;
    return new;
  end if;
  select coalesce(configuracoes #>> '{identidadeEmpresa,configMobile,termosCustomGarantia}','') into termos_config
    from public.configuracoes_empresa where empresa_id=new.empresa_id;
  insert into public.garantias as g (
    empresa_id,ordem_servico_id,numero_os_snapshot,cliente_nome_snapshot,cliente_telefone_snapshot,
    aparelho_snapshot,marca_snapshot,modelo_snapshot,imei_snapshot,reparo_realizado,
    garantia_dias,data_abertura,data_limite,termos,dados_extras
  ) values (
    new.empresa_id,o.id,o.numero,o.cliente_nome_snapshot,o.cliente_telefone_snapshot,
    coalesce(new.aparelho_snapshot,o.aparelho),coalesce(new.marca_snapshot,o.marca),coalesce(new.modelo_snapshot,o.modelo),o.imei,
    new.reparo_realizado,new.garantia_dias,inicio,inicio+new.garantia_dias,coalesce(d->>'termosGarantia',termos_config,''),
    jsonb_build_object('origem','entrega','clienteCpf',o.cliente_cpf_snapshot,
      'clienteId',coalesce(o.dados_extras->'cliente_id_numero',d->'clienteId'),
      'clienteNumero',coalesce(o.dados_extras->'cliente_id_numero',d->'clienteId','"00000"'::jsonb))
  ) on conflict (empresa_id,ordem_servico_id) do update set
    cliente_nome_snapshot=excluded.cliente_nome_snapshot,cliente_telefone_snapshot=excluded.cliente_telefone_snapshot,
    marca_snapshot=excluded.marca_snapshot,modelo_snapshot=excluded.modelo_snapshot,imei_snapshot=excluded.imei_snapshot,
    aparelho_snapshot=excluded.aparelho_snapshot,reparo_realizado=excluded.reparo_realizado,
    garantia_dias=excluded.garantia_dias,data_abertura=excluded.data_abertura,data_limite=excluded.data_limite,
    termos=coalesce(d->>'termosGarantia',g.termos,excluded.termos),dados_extras=g.dados_extras||excluded.dados_extras;
  return new;
end $$;

revoke all on function public.preparar_entrega_retorno_garantia(text,text) from public,anon,authenticated;
grant execute on function public.preparar_entrega_retorno_garantia(text,text) to authenticated;
revoke all on function public.criar_entrega_mobile(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.criar_entrega_mobile(text,jsonb,uuid) to authenticated;

commit;
