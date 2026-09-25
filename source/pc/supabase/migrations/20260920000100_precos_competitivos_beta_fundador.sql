-- Tabela publica competitiva e beneficio permanente para quem participou do beta
-- antes desta politica entrar em vigor. O marcador e persistente: trocar ou renovar
-- o plano nao remove a elegibilidade conquistada.
alter table public.empresas
  add column if not exists beta_fundador boolean not null default false;

update public.empresas
   set beta_fundador = true
 where inicio_trial is not null
   and created_at < '2026-09-20 00:00:00-03'::timestamptz;

comment on column public.empresas.beta_fundador is
  'Elegivel ao preco fundador do plano Basico (R$ 49,90), reservado a empresas que participaram do beta antes de 20/09/2026.';

update public.planos
   set preco_referencia = case lower(nome)
         when 'basico' then 59.90
         when 'profissional' then 89.90
         when 'premium' then 139.90
         when 'empresarial' then 219.90
         else preco_referencia
       end,
       descricao = case lower(nome)
         when 'basico' then 'Operacao essencial para assistencias tecnicas pequenas.'
         when 'profissional' then 'Gestao completa para equipes e atendimento em crescimento.'
         when 'premium' then 'Automacoes, inteligencia e integracoes para operacoes avancadas.'
         when 'empresarial' then 'Maior capacidade, controle e suporte para operacoes com varias equipes.'
         else descricao
       end,
       destaque = lower(nome) = 'profissional',
       updated_at = now()
 where lower(nome) in ('basico', 'profissional', 'premium', 'empresarial')
   and excluido_em is null;

update public.planos
   set limites = case lower(nome)
         when 'basico' then limites || '{"usuarios":3,"dispositivos":3,"storage_bytes":2147483648}'::jsonb
         when 'profissional' then limites || '{"usuarios":6,"dispositivos":8,"storage_bytes":10737418240}'::jsonb
         when 'premium' then limites || '{"usuarios":12,"dispositivos":16,"storage_bytes":26843545600}'::jsonb
         when 'empresarial' then limites || '{"usuarios":25,"dispositivos":40,"storage_bytes":107374182400}'::jsonb
         else limites
       end,
       updated_at = now()
 where lower(nome) in ('basico', 'profissional', 'premium', 'empresarial')
   and excluido_em is null;

