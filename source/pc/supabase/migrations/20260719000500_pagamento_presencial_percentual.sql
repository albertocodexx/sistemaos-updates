-- Permite distinguir pagamento presencial antecipado do pagamento combinado
-- para a retirada, preservando os estados existentes para clientes antigos.
alter table public.ordens_servico
  drop constraint if exists ordens_servico_status_pagamento_check;

alter table public.ordens_servico
  add constraint ordens_servico_status_pagamento_check
  check (status_pagamento in (
    '',
    'Aguardando Pagamento',
    'Aguardando Pagamento Presencial',
    'Aguardando Pagamento na Retirada',
    'Autorizado',
    'Pagamento Manual'
  ));

comment on column public.ordens_servico.status_pagamento is
  'Estado financeiro da OS. Pagamento presencial antecipado é separado do pagamento na retirada.';
