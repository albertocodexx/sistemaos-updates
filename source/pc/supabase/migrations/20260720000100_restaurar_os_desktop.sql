-- Restaura uma OS que continua válida no PC, mas cujo registro remoto ficou
-- com tombstone. A operação é usada somente no fluxo explícito de publicar a
-- OS para o celular/assinatura e nunca por uma atualização comum atrasada.

create or replace function public.restaurar_ordem_servico_desktop(
  p_id uuid,
  p_origem_dispositivo_id uuid
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
    raise exception using errcode = '42501', message = 'sem permissão para restaurar OS';
  end if;
  if not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id
       and d.id = p_origem_dispositivo_id
       and d.usuario_id = auth.uid()
       and d.tipo = 'desktop'
  ) then
    raise exception using errcode = '42501', message = 'dispositivo desktop inválido';
  end if;

  update public.ordens_servico o
     set deleted_at = null,
         origem_dispositivo_id = p_origem_dispositivo_id
   where o.id = p_id
     and o.empresa_id = v_empresa_id
     and o.deleted_at is not null
  returning * into v_os;

  if found then return v_os; end if;
  select o.* into v_os
    from public.ordens_servico o
   where o.id = p_id and o.empresa_id = v_empresa_id and o.deleted_at is null;
  if found then return v_os; end if;
  raise exception using errcode = 'P0002', message = 'OS não encontrada';
end
$$;

revoke all on function public.restaurar_ordem_servico_desktop(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.restaurar_ordem_servico_desktop(uuid, uuid)
  to authenticated;

comment on function public.restaurar_ordem_servico_desktop(uuid, uuid) is
  'Remove tombstone somente durante republicação explícita de uma OS existente no desktop.';
