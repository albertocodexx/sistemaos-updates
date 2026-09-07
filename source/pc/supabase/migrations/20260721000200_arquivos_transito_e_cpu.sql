-- Arquivos enviados pelo Android usam o Storage apenas como transporte.
-- O desktop confirma o consumo somente depois de persistir o conteudo local.

create index if not exists arquivos_empresa_transito_android_idx
  on public.arquivos (empresa_id, updated_at, origem_dispositivo_id)
  where deleted_at is null and arquivo_nuvem_path is not null;

create or replace function public.confirmar_consumo_arquivo_mobile(
  p_arquivo_id uuid,
  p_dispositivo_id uuid,
  p_arquivo_local_id text
)
returns public.arquivos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_arquivo public.arquivos;
begin
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'sessao, empresa ou plano invalido';
  end if;
  if nullif(btrim(p_arquivo_local_id), '') is null then
    raise exception using errcode = '22023', message = 'identificador local obrigatorio';
  end if;
  if not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id and d.id = p_dispositivo_id
       and d.usuario_id = auth.uid() and d.tipo = 'desktop'
  ) then
    raise exception using errcode = '42501', message = 'desktop autenticado invalido';
  end if;

  select a.* into v_arquivo
    from public.arquivos a
   where a.empresa_id = v_empresa_id and a.id = p_arquivo_id
     and a.deleted_at is null
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'arquivo nao encontrado';
  end if;
  if not exists (
    select 1 from public.dispositivos origem
     where origem.empresa_id = v_empresa_id
       and origem.id = v_arquivo.origem_dispositivo_id
       and origem.tipo = 'android'
  ) then
    raise exception using errcode = '42501', message = 'somente arquivo originado no Android pode ser consumido';
  end if;

  update public.arquivos set
    storage_bucket = null,
    arquivo_nuvem_path = null,
    miniatura_path = null,
    arquivo_local_id = btrim(p_arquivo_local_id),
    disponibilidade = 'local'
   where id = p_arquivo_id and empresa_id = v_empresa_id
   returning * into v_arquivo;
  return v_arquivo;
end
$$;

revoke all on function public.confirmar_consumo_arquivo_mobile(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirmar_consumo_arquivo_mobile(uuid, uuid, text)
  to authenticated;

comment on function public.confirmar_consumo_arquivo_mobile(uuid, uuid, text) is
  'Confirma persistencia local no desktop e libera o original Android do Storage privado.';
