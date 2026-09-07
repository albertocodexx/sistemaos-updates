-- Uma entrega registrada representa a saída física do aparelho. Mantém a OS
-- como Entregue no mesmo commit, inclusive quando o comprovante foi marcado
-- intencionalmente como não assinado ou ficou aguardando assinatura.

create or replace function app_private.marcar_os_entregue_ao_registrar_entrega()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null then
    update public.ordens_servico o
       set status = 'Entregue',
           data_conclusao = coalesce(o.data_conclusao, new.entregue_em, now())
     where o.empresa_id = new.empresa_id
       and o.id = new.ordem_servico_id
       and o.deleted_at is null
       and o.status not in ('Entregue', 'Cancelado');
  end if;
  return new;
end
$$;

drop trigger if exists trg_entrega_atualiza_status_os on public.entregas;
create trigger trg_entrega_atualiza_status_os
after insert or update of status, entregue_em, deleted_at on public.entregas
for each row execute function app_private.marcar_os_entregue_ao_registrar_entrega();

-- Repara registros antigos (inclui a OS 0019) sem tocar em OS canceladas.
update public.ordens_servico o
   set status = 'Entregue',
       data_conclusao = coalesce(o.data_conclusao, e.entregue_em, now())
  from public.entregas e
 where e.empresa_id = o.empresa_id
   and e.ordem_servico_id = o.id
   and e.deleted_at is null
   and o.deleted_at is null
   and o.status not in ('Entregue', 'Cancelado');

comment on function app_private.marcar_os_entregue_ao_registrar_entrega() is
  'Mantem o status tecnico da OS consistente com o comprovante de entrega.';
