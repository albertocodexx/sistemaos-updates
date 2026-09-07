-- Corrige o valor padrão que pode ter sido gravado com codificação incorreta
-- durante a aplicação inicial via painel. Mantém o padrão compatível com a
-- constraint UTF-8 da migração anterior.

alter table public.ordens_servico
  alter column status set default 'Aguardando análise';
