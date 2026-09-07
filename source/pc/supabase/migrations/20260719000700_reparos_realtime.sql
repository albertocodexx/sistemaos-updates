-- Atualizacao automatica da aba Reparos entre PC, Android e Supabase.
-- A publicacao transmite somente eventos autorizados pelas politicas RLS.
alter table if exists public.ordens_servico replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'ordens_servico'
     ) then
    alter publication supabase_realtime add table public.ordens_servico;
  end if;
end $$;
