-- Supabase é o único backend e provedor de arquivos aceito pelo Sistema OS.
-- Esta migration remove credenciais e seletores antigos que possam ter
-- permanecido nas configurações das empresas após atualizações anteriores.

alter table public.configuracoes_empresa
  alter column feature_flags set default
  '{"supabaseAtivo":true,"storageProvider":"supabase-storage"}'::jsonb;

update public.configuracoes_empresa
   set feature_flags = (
         coalesce(feature_flags, '{}'::jsonb)
         - 'firebaseAtivo'
         - 'firebaseSyncAtivo'
         - 'cloudinaryAtivo'
         - 'cloudProvider'
         - 'fileProvider'
       ) || jsonb_build_object(
         'supabaseAtivo', true,
         'storageProvider', 'supabase-storage'
       ),
       configuracoes = (
         (
           (
             (
               (
                 coalesce(configuracoes, '{}'::jsonb)
                 - 'firebaseConfig'
                 - 'cloudinaryConfig'
                 - 'firebaseSyncAtivo'
                 - 'cloudProvider'
                 - 'fileProvider'
               ) #- '{configMobile,firebaseConfig}'
             ) #- '{configMobile,cloudinaryConfig}'
           ) #- '{configMobile,firebaseSyncAtivo}'
         ) #- '{configMobile,cloudProvider}'
       ) #- '{configMobile,fileProvider}',
       updated_at = now();

comment on column public.configuracoes_empresa.feature_flags is
  'Recursos opcionais da empresa. Supabase é o único backend e Supabase Storage o único armazenamento remoto.';
