-- DANFSe oficial vinculado a cada NFS-e autorizada.
-- O PDF fica em bucket privado e somente a Edge Function entrega URL assinada.

alter table public.notas_fiscais
  add column if not exists chave_acesso text,
  add column if not exists danfse_url text,
  add column if not exists danfse_storage_path text,
  add column if not exists danfse_gerado_em timestamptz;

create unique index if not exists notas_fiscais_chave_acesso_idx
  on public.notas_fiscais (chave_acesso)
  where chave_acesso is not null and chave_acesso <> '';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-fiscais', 'documentos-fiscais', false, 20971520, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on column public.notas_fiscais.chave_acesso is
  'Chave oficial da NFS-e autorizada, usada para consulta e DANFSe.';
comment on column public.notas_fiscais.danfse_storage_path is
  'Caminho privado do DANFSe oficial no bucket documentos-fiscais.';
comment on column public.notas_fiscais.danfse_url is
  'URL HTTPS oficial do DANFSe quando o provedor entrega o documento por link.';
