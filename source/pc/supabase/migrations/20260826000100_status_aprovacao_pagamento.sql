-- Separa a decisão do cliente do estado financeiro da OS.
-- O aplicativo mantém compatibilidade via dados_extras enquanto a migração
-- ainda não tiver sido aplicada em uma instalação antiga.
alter table public.ordens_servico
  add column if not exists status_aprovacao text not null default 'Pendente';

alter table public.ordens_servico
  drop constraint if exists ordens_servico_status_aprovacao_check;

alter table public.ordens_servico
  add constraint ordens_servico_status_aprovacao_check
  check (status_aprovacao in ('Pendente', 'Aprovado', 'Desaprovado'));

alter table public.ordens_servico
  drop constraint if exists ordens_servico_status_pagamento_check;

alter table public.ordens_servico
  add constraint ordens_servico_status_pagamento_check
  check (status_pagamento in (
    '',
    'Aguardando Pagamento',
    'Aguardando Pagamento Presencial',
    'Aguardando Pagamento na Retirada',
    'Pagamento 50/50',
    'Pagamento 50/50 remoto',
    'Pagamento 50/50 presencial',
    'Pago 50%',
    'Pago',
    'Autorizado',
    'Pagamento Manual'
  ));

update public.ordens_servico
set status_aprovacao = 'Aprovado'
where status_pagamento = 'Autorizado'
  and status_aprovacao = 'Pendente';

comment on column public.ordens_servico.status_aprovacao is
  'Decisão do cliente sobre a OS, independente do pagamento.';

comment on column public.ordens_servico.status_pagamento is
  'Estado financeiro. Pago 50% e Pago não significam o status técnico da OS.';
