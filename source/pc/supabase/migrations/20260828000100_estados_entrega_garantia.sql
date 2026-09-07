begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function app_private.calcular_data_limite_garantia()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.garantia_dias = 0 then new.data_limite := null;
  elsif tg_op = 'INSERT' or new.data_limite is null or new.data_abertura is distinct from old.data_abertura or new.garantia_dias is distinct from old.garantia_dias then
    new.data_limite := new.data_abertura + new.garantia_dias;
  end if;
  return new;
end $$;

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
  coalesce(e.dados_extras #>> '{documento_mobile,assinaturaPendente}', 'false') = 'true' as assinatura_pendente
from public.entregas e where e.deleted_at is null;
commit;
