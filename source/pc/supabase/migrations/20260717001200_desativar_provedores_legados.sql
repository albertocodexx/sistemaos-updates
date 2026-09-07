-- ETAPA 9 — Supabase passa a ser o único provedor ativo.
-- A coluna legacy_cloudinary_url é preservada apenas para auditoria de migrações
-- antigas, mas é esvaziada e uma restrição impede que ela volte a ser utilizada.

alter table public.configuracoes_empresa
  alter column feature_flags set default
  '{"cloudProvider":"supabase","fileProvider":"supabase","supabaseAtivo":true}'::jsonb;

update public.configuracoes_empresa
   set feature_flags = (
         coalesce(feature_flags, '{}'::jsonb)
         - 'firebaseAtivo'
         - 'firebaseSyncAtivo'
         - 'cloudinaryAtivo'
         - 'cloudProvider'
         - 'fileProvider'
       ) || jsonb_build_object(
         'cloudProvider', 'supabase',
         'fileProvider', 'supabase',
         'supabaseAtivo', true
       ),
       updated_at = now();

-- Não há leitura de Cloudinary no aplicativo após esta migration. Qualquer URL
-- residual é removida para impedir a reativação acidental do provedor antigo.
update public.arquivos
   set legacy_cloudinary_url = null
 where legacy_cloudinary_url is not null;

alter table public.arquivos
  drop constraint if exists arquivos_sem_cloudinary_legado;

alter table public.arquivos
  add constraint arquivos_sem_cloudinary_legado
  check (legacy_cloudinary_url is null);

comment on column public.arquivos.legacy_cloudinary_url is
  'Campo legado desativado na ETAPA 9. Deve permanecer nulo; arquivos usam Supabase Storage.';
