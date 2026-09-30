-- Fila NFE.io e armazenamento privado dos documentos oficiais.
-- O caminho do XML fica no payload da nota para manter compatibilidade com
-- bancos anteriores; o arquivo nunca e publicado diretamente.

update storage.buckets
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array['application/pdf', 'application/xml', 'text/xml']
where id = 'documentos-fiscais';

create index if not exists notas_fiscais_fila_processamento_idx
  on public.notas_fiscais (status, updated_at)
  where status in ('na_fila', 'processando', 'autorizada');

comment on index public.notas_fiscais_fila_processamento_idx is
  'Busca incremental do worker NFE.io e recuperacao de processamentos interrompidos.';
