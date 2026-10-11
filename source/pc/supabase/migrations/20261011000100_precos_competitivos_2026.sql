-- Faixas comerciais revisadas em 11/10/2026 a partir de concorrentes
-- brasileiros de OS/assistencia tecnica. O beneficio fundador continua
-- calculado no servidor e nao e alterado por esta migracao.
update public.planos
   set preco_referencia = case lower(nome)
         when 'basico' then 59.90
         when 'profissional' then 79.90
         when 'premium' then 119.90
         when 'empresarial' then 199.90
         else preco_referencia
       end,
       descricao = case lower(nome)
         when 'basico' then 'Operacao essencial para pequenas assistencias com PC e aplicativo Android.'
         when 'profissional' then 'Gestao completa, relatorios e WhatsApp para equipes em crescimento.'
         when 'premium' then 'Automacoes, IA, Mercado Pago e suporte prioritario para operacoes avancadas.'
         when 'empresarial' then 'Maior capacidade, armazenamento e controle para varias equipes.'
         else descricao
       end,
       destaque = lower(nome) = 'profissional',
       updated_at = now()
 where lower(nome) in ('basico', 'profissional', 'premium', 'empresarial')
   and excluido_em is null;

comment on column public.planos.preco_referencia is
  'Preco mensal de tabela. Faixas revisadas em 11/10/2026; ofertas elegiveis sao calculadas no servidor.';
