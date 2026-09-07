-- O backup completo nao e uma via alternativa para acessar modulos bloqueados.
-- Politicas RESTRITIVAS continuam valendo mesmo com permissoes amplas anteriores.
begin;

create or replace function app_private.pode_acessar_backup_empresa()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfis p
    where p.id = (select auth.uid()) and p.ativo
      and p.empresa_id = (select app_private.current_user_empresa_id())
      and lower(btrim(coalesce(p.cargo, ''))) in ('administrador', 'admin', 'proprietario', 'proprietário')
  );
$$;
revoke all on function app_private.pode_acessar_backup_empresa() from public, anon;
grant execute on function app_private.pode_acessar_backup_empresa() to authenticated;

drop policy if exists backups_somente_administrador on storage.objects;
create policy backups_somente_administrador on storage.objects
as restrictive for all to authenticated
using (
  bucket_id <> 'backups-empresa' or (
    (select app_private.pode_acessar_backup_empresa())
    and (storage.foldername(name))[1] = (select app_private.current_user_empresa_id())::text
  )
)
with check (
  bucket_id <> 'backups-empresa' or (
    (select app_private.pode_acessar_backup_empresa())
    and (storage.foldername(name))[1] = (select app_private.current_user_empresa_id())::text
  )
);

drop policy if exists backups_metadados_somente_administrador on public.backups_empresa;
create policy backups_metadados_somente_administrador on public.backups_empresa
as restrictive for all to authenticated
using (
  (select app_private.pode_acessar_backup_empresa())
  and empresa_id = (select app_private.current_user_empresa_id())
)
with check (
  (select app_private.pode_acessar_backup_empresa())
  and empresa_id = (select app_private.current_user_empresa_id())
);

create or replace function public.registrar_backup_empresa(
  p_tamanho_bytes bigint, p_sha256 text, p_versao_aplicativo text default ''
)
returns public.backups_empresa
language plpgsql security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_resultado public.backups_empresa%rowtype;
begin
  if not app_private.pode_acessar_backup_empresa() then
    raise exception 'somente_administrador_pode_acessar_backup' using errcode = '42501';
  end if;
  if p_tamanho_bytes is null or p_tamanho_bytes < 1 or p_tamanho_bytes > 52428800 then
    raise exception 'tamanho_backup_invalido';
  end if;
  if lower(coalesce(p_sha256, '')) !~ '^[a-f0-9]{64}$' then
    raise exception 'sha256_invalido';
  end if;
  insert into public.backups_empresa (
    empresa_id, storage_bucket, storage_path, tamanho_bytes, sha256,
    versao_aplicativo, criado_por, created_at, updated_at
  ) values (
    v_empresa_id, 'backups-empresa', v_empresa_id::text || '/ultimo-backup.json',
    p_tamanho_bytes, lower(p_sha256), left(coalesce(p_versao_aplicativo, ''), 100),
    auth.uid(), now(), now()
  ) on conflict (empresa_id) do update set
    storage_path = excluded.storage_path, tamanho_bytes = excluded.tamanho_bytes,
    sha256 = excluded.sha256, versao_aplicativo = excluded.versao_aplicativo,
    criado_por = excluded.criado_por, updated_at = now()
  returning * into v_resultado;
  return v_resultado;
end;
$$;
revoke all on function public.registrar_backup_empresa(bigint, text, text) from public, anon;
grant execute on function public.registrar_backup_empresa(bigint, text, text) to authenticated;
commit;
