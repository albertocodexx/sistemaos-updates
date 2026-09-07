-- Evita que um cliente interrompido mantenha updates de OS aguardando lock
-- ate esgotar a CPU do projeto. O APK tambem deduplica a mesma operacao,
-- mas estes limites protegem o banco contra versoes antigas e varias telas.
alter function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  set statement_timeout = '8s';

alter function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  set lock_timeout = '3s';

comment on function public.atualizar_ordem_servico(uuid, bigint, jsonb) is
  'Atualiza uma OS por revision, com limites de lock e execucao para proteger a CPU.';
