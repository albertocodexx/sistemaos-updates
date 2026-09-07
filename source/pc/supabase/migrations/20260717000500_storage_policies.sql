-- Etapa 2: buckets privados. O primeiro segmento de todo caminho é o empresa_id.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('miniaturas', 'miniaturas', false, 5242880),
  ('arquivos-os', 'arquivos-os', false, 52428800),
  ('documentos-pdf', 'documentos-pdf', false, 26214400)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

drop policy if exists storage_select_empresa on storage.objects;
create policy storage_select_empresa on storage.objects
for select to authenticated
using (
  bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf')
  and (storage.foldername(name))[1] = app_private.current_user_empresa_id()::text
);

drop policy if exists storage_insert_empresa on storage.objects;
create policy storage_insert_empresa on storage.objects
for insert to authenticated
with check (
  bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf')
  and (storage.foldername(name))[1] = app_private.current_user_empresa_id()::text
);

drop policy if exists storage_update_empresa on storage.objects;
create policy storage_update_empresa on storage.objects
for update to authenticated
using (
  bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf')
  and (storage.foldername(name))[1] = app_private.current_user_empresa_id()::text
)
with check (
  bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf')
  and (storage.foldername(name))[1] = app_private.current_user_empresa_id()::text
);

drop policy if exists storage_delete_empresa on storage.objects;
create policy storage_delete_empresa on storage.objects
for delete to authenticated
using (
  bucket_id in ('miniaturas', 'arquivos-os', 'documentos-pdf')
  and (storage.foldername(name))[1] = app_private.current_user_empresa_id()::text
);

comment on policy storage_select_empresa on storage.objects is
  'Permite leitura/URL assinada somente no prefixo da empresa autenticada.';
