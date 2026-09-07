-- Etapa comercial 4.1: amplia os estados da licença.
-- Esta migration deve permanecer isolada: valores novos de enum só podem ser
-- utilizados com segurança pelas migrations seguintes após o commit.

alter type public.licenca_status add value if not exists 'vencendo';
alter type public.licenca_status add value if not exists 'periodo_graca';
alter type public.licenca_status add value if not exists 'suspensa';
alter type public.licenca_status add value if not exists 'cancelada';
