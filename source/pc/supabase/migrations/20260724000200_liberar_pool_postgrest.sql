-- Libera conexoes que entraram na fila antes da contencao de concorrencia ser
-- instalada. Nao remove nem altera dados: apenas cancela RPCs antigas ainda
-- executando e pede ao PostgREST para recarregar o schema.
do $$
declare
  v_pid integer;
begin
  for v_pid in
    select a.pid
      from pg_catalog.pg_stat_activity a
     where a.pid <> pg_catalog.pg_backend_pid()
       and a.state = 'active'
       and a.query ilike '%atualizar_ordem_servico%'
  loop
    perform pg_catalog.pg_terminate_backend(v_pid);
  end loop;
end
$$;

select pg_catalog.pg_notify('pgrst', 'reload schema');
