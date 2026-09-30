-- O teste antigo de 45 dias passa a ser Beta; novas empresas permanecem
-- no Trial de 30 dias. Nenhum vencimento concedido e recalculado.
alter table public.eventos_licenca drop constraint if exists eventos_licenca_tipo_check;
alter table public.eventos_licenca add constraint eventos_licenca_tipo_check
  check (tipo in ('trial_criado', 'beta_criado', 'trial_prorrogado',
    'plano_alterado', 'vencimento_alterado', 'pagamento_confirmado',
    'suspensao', 'reativacao', 'bloqueio', 'observacao'));

insert into public.planos
  (nome, descricao, ativo, preco_referencia, periodo, duracao_dias, ordem,
   destaque, limites, updated_at)
select 'Beta', 'Beta gratuito completo por 45 dias para empresas convidadas.',
       true, 0, p.periodo, 45, p.ordem, false,
       jsonb_set(coalesce(p.limites, '{}'::jsonb), '{trial_dias}', '45'::jsonb, true), now()
from public.planos p
where lower(p.nome) = 'trial'
  and not exists (select 1 from public.planos b where lower(b.nome) = 'beta');

update public.planos
set descricao = 'Beta gratuito completo por 45 dias para empresas convidadas.',
    preco_referencia = 0, duracao_dias = 45,
    limites = jsonb_set(coalesce(limites, '{}'::jsonb), '{trial_dias}', '45'::jsonb, true),
    ativo = true, excluido_em = null, updated_at = now()
where lower(nome) = 'beta';

-- O Beta preserva a matriz completa de recursos do teste anterior.
insert into public.plano_recursos (plano_id, recurso_id, habilitado, limite)
select b.id, r.id, true, null
from public.planos b cross join public.recursos r
where lower(b.nome) = 'beta'
on conflict (plano_id, recurso_id) do update
set habilitado = true, limite = null;

update public.empresas e
set plano_id = b.id,
    beta_fundador = true,
    data_vencimento = greatest(coalesce(e.data_vencimento, e.fim_trial), e.fim_trial),
    proximo_vencimento_em = greatest(coalesce(e.proximo_vencimento_em, e.fim_trial), e.fim_trial),
    beta_fundador_expira_em = coalesce(
      e.beta_fundador_expira_em, coalesce(e.inicio_trial, e.created_at) + interval '1 year'),
    updated_at = now()
from public.planos t cross join public.planos b
where e.plano_id = t.id
  and lower(t.nome) = 'trial'
  and lower(b.nome) = 'beta'
  and e.inicio_trial is not null
  and e.fim_trial > e.inicio_trial + interval '31 days';

-- Novos Trial anteriores a esta migracao tambem devem usar o fim real do
-- teste no catalogo e na renovacao, nunca uma data comercial mais curta.
update public.empresas e
set data_vencimento = greatest(coalesce(e.data_vencimento, e.fim_trial), e.fim_trial),
    proximo_vencimento_em = greatest(coalesce(e.proximo_vencimento_em, e.fim_trial), e.fim_trial),
    updated_at = now()
from public.planos p
where e.plano_id = p.id and lower(p.nome) = 'trial'
  and e.licenca_status = 'teste' and e.fim_trial is not null;

-- Tanto Beta quanto Trial permitem a cota fiscal durante o teste ativo.
-- A carteira define a cota real (100 no Beta antigo; 30 no Trial novo).
create or replace function public.exigir_adicional_fiscal_na_reserva()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'reservada' and not exists (
    select 1 from public.empresas e where e.id = new.empresa_id and e.ativo and
      ((e.licenca_status = 'teste' and e.fim_trial > now() and exists (
         select 1 from public.planos p where p.id = e.plano_id
           and lower(p.nome) in ('trial', 'beta')))
       or (e.licenca_status = 'ativa' and e.data_vencimento > now()
           and e.modulo_fiscal_ativo_ate > now()))
  ) then
    raise exception using errcode = '42501',
      message = 'Periodo de teste encerrado ou modulo fiscal nao contratado para esta empresa.';
  end if;
  return new;
end $$;
revoke all on function public.exigir_adicional_fiscal_na_reserva() from public, anon, authenticated;
