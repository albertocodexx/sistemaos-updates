-- Reduz o custo das leituras repetidas do APK sem mudar dados nem contratos.
-- A busca individual filtra por numero; a lista de Reparos usa empresa,
-- prazo e data de atualização. Ambos os índices acompanham exatamente essas
-- consultas e ignoram OS já excluídas logicamente.

create index if not exists ordens_numero_ativo_idx
  on public.ordens_servico (numero)
  where deleted_at is null;

create index if not exists ordens_empresa_painel_leve_idx
  on public.ordens_servico (
    empresa_id,
    data_prevista asc nulls last,
    updated_at desc
  )
  where deleted_at is null;

comment on index public.ordens_numero_ativo_idx is
  'Busca direta de OS pelo celular sem varrer ordens de outras empresas.';
comment on index public.ordens_empresa_painel_leve_idx is
  'Painéis mobile de Reparos, Estatísticas e notificações ordenados por prazo.';
