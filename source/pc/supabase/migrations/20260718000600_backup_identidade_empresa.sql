-- Backup mais recente e identidade visual compartilhada por empresa.
-- Mantem somente um objeto de backup por empresa e reaproveita
-- configuracoes_empresa para a referencia da logo, sem duplicar cadastro.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('backups-empresa', 'backups-empresa', false, 52428800),
  ('identidade-empresa', 'identidade-empresa', false, 5242880)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create table if not exists public.backups_empresa (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  storage_bucket text not null default 'backups-empresa'
    check (storage_bucket = 'backups-empresa'),
  storage_path text not null,
  tamanho_bytes bigint not null default 0 check (tamanho_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  versao_aplicativo text not null default '',
  criado_por uuid not null references public.perfis(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.backups_empresa enable row level security;
alter table public.backups_empresa force row level security;
revoke all on table public.backups_empresa from anon, authenticated;
grant select on table public.backups_empresa to authenticated;

drop policy if exists backups_empresa_select_propria on public.backups_empresa;
create policy backups_empresa_select_propria on public.backups_empresa
for select to authenticated
using (empresa_id = app_private.current_user_empresa_id());

create or replace function public.registrar_backup_empresa(
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_versao_aplicativo text default ''
)
returns public.backups_empresa
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_resultado public.backups_empresa%rowtype;
begin
  if v_empresa_id is null then
    raise exception 'usuario_sem_empresa';
  end if;
  if p_tamanho_bytes < 1 or p_tamanho_bytes > 52428800 then
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
    p_tamanho_bytes, lower(p_sha256), coalesce(p_versao_aplicativo, ''),
    auth.uid(), now(), now()
  )
  on conflict (empresa_id) do update set
    storage_path = excluded.storage_path,
    tamanho_bytes = excluded.tamanho_bytes,
    sha256 = excluded.sha256,
    versao_aplicativo = excluded.versao_aplicativo,
    criado_por = excluded.criado_por,
    updated_at = now()
  returning * into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.registrar_backup_empresa(bigint, text, text) from public, anon;
grant execute on function public.registrar_backup_empresa(bigint, text, text) to authenticated;

create or replace function public.definir_logo_empresa(
  p_storage_path text,
  p_sha256 text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_identidade jsonb;
begin
  if v_empresa_id is null or not app_private.eh_administrador_empresa(v_empresa_id) then
    raise exception 'somente_administrador_pode_alterar_logo';
  end if;
  if coalesce(p_storage_path, '') <> '' and
     p_storage_path <> (v_empresa_id::text || '/logo.png') then
    raise exception 'caminho_logo_invalido';
  end if;
  if coalesce(p_sha256, '') <> '' and lower(p_sha256) !~ '^[a-f0-9]{64}$' then
    raise exception 'sha256_invalido';
  end if;

  v_identidade := jsonb_build_object(
    'logoStorageBucket', 'identidade-empresa',
    'logoStoragePath', coalesce(p_storage_path, ''),
    'logoSha256', lower(coalesce(p_sha256, '')),
    'logoAtualizadaEm', now(),
    'logoAtualizadaPor', auth.uid()
  );

  insert into public.configuracoes_empresa (empresa_id, configuracoes, feature_flags)
  values (v_empresa_id, jsonb_build_object('identidadeEmpresa', v_identidade), '{}'::jsonb)
  on conflict (empresa_id) do update set
    configuracoes = coalesce(public.configuracoes_empresa.configuracoes, '{}'::jsonb)
      || jsonb_build_object('identidadeEmpresa', v_identidade),
    updated_at = now();

  return v_identidade;
end;
$$;

revoke all on function public.definir_logo_empresa(text, text) from public, anon;
grant execute on function public.definir_logo_empresa(text, text) to authenticated;

-- Amplia as politicas existentes. Arquivos operacionais e backup podem ser
-- enviados pelo usuario autenticado; a identidade visual so pelo admin/dono.
drop policy if exists storage_select_empresa on storage.objects;
create policy storage_select_empresa on storage.objects
for select to authenticated
using (
  bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf', 'backups-empresa', 'identidade-empresa')
  and (storage.foldername(name))[1] = app_private.current_user_empresa_id()::text
);

drop policy if exists storage_insert_empresa on storage.objects;
create policy storage_insert_empresa on storage.objects
for insert to authenticated
with check (
  (storage.foldername(name))[1] = app_private.current_user_empresa_id()::text
  and (
    bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf', 'backups-empresa')
    or (bucket_id = 'identidade-empresa' and app_private.eh_administrador_empresa(app_private.current_user_empresa_id()))
  )
);

drop policy if exists storage_update_empresa on storage.objects;
create policy storage_update_empresa on storage.objects
for update to authenticated
using (
  (storage.foldername(name))[1] = app_private.current_user_empresa_id()::text
  and (
    bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf', 'backups-empresa')
    or (bucket_id = 'identidade-empresa' and app_private.eh_administrador_empresa(app_private.current_user_empresa_id()))
  )
)
with check (
  (storage.foldername(name))[1] = app_private.current_user_empresa_id()::text
  and (
    bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf', 'backups-empresa')
    or (bucket_id = 'identidade-empresa' and app_private.eh_administrador_empresa(app_private.current_user_empresa_id()))
  )
);

drop policy if exists storage_delete_empresa on storage.objects;
create policy storage_delete_empresa on storage.objects
for delete to authenticated
using (
  (storage.foldername(name))[1] = app_private.current_user_empresa_id()::text
  and (
    bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf', 'backups-empresa')
    or (bucket_id = 'identidade-empresa' and app_private.eh_administrador_empresa(app_private.current_user_empresa_id()))
  )
);

comment on table public.backups_empresa is
  'Metadados do unico backup mais recente de cada empresa; o JSON fica no Storage privado.';
