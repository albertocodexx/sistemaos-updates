-- Corrige uma eventual execução via console que tenha convertido acentos em
-- rótulos de status. É idempotente e preserva os mesmos valores de domínio.

alter table public.ordens_servico
  drop constraint if exists ordens_servico_status_check;

alter table public.ordens_servico
  add constraint ordens_servico_status_check check (status in (
    'Aguardando análise', 'Em diagnóstico', 'Aguardando aprovação',
    'Aguardando peça', 'Em reparo', 'Em testes', 'Pronto para retirada',
    'Entregue', 'Cancelado'
  ));
