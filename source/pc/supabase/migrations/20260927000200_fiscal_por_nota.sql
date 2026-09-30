-- O acesso fiscal acompanha a licenca do Sistema OS. Nao ha adicional mensal:
-- cada emissao autorizada consome credito reservado na carteira da empresa.
-- O preco padrao de R$ 0,99 pode ser ajustado pelo suporte; cotas promocionais
-- explicitamente personalizadas sao preservadas.
alter table public.contas_fiscais
  alter column limite_gratuito_mensal set default 0,
  alter column preco_excedente_centavos set default 99;

-- O provedor anterior foi descontinuado. Preservar o cadastro do emitente,
-- mas nunca apresentar a integracao antiga como configurada para producao.
alter table public.configuracoes_fiscais alter column provedor set default 'nfse_nacional';
update public.configuracoes_fiscais
set provedor = 'nfse_nacional', ambiente = 'homologacao', status = 'nao_configurada',
    metadados = metadados - 'certificado_a1_sandbox_em' - 'certificado_a1_sandbox_valido_ate' - 'provedor_fiscal',
    ultimo_erro = 'Emissor fiscal anterior encerrado. O cadastro foi preservado, mas a emissao precisa de um novo provedor validado.',
    updated_at = now()
where provedor = 'nuvem_fiscal';

update public.contas_fiscais
set limite_gratuito_mensal = case when limite_gratuito_mensal in (30, 100) then 0 else limite_gratuito_mensal end,
    preco_excedente_centavos = case when preco_excedente_centavos in (20, 25) then 99 else preco_excedente_centavos end,
    updated_at = now()
where limite_gratuito_mensal in (30, 100) or preco_excedente_centavos in (20, 25);

drop trigger if exists trg_definir_cota_fiscal_trial_ao_criar on public.contas_fiscais;
drop function if exists public.definir_cota_fiscal_trial_ao_criar();

create or replace function public.exigir_adicional_fiscal_na_reserva()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'reservada' and not exists (
    select 1 from public.empresas e
    where e.id = new.empresa_id and e.ativo and
      ((e.licenca_status = 'teste' and e.fim_trial > now() and exists (
         select 1 from public.planos p where p.id = e.plano_id and lower(p.nome) in ('trial', 'beta')))
       or (e.licenca_status = 'ativa' and e.data_vencimento > now()))
  ) then
    raise exception using errcode = '42501',
      message = 'Assinatura ou periodo de teste encerrado para esta empresa.';
  end if;
  return new;
end $$;
revoke all on function public.exigir_adicional_fiscal_na_reserva() from public, anon, authenticated;

-- A reserva pode ser reaberta por UPSERT. Validar INSERT e a mudanca de
-- status impede reativar uma reserva depois que a licenca vencer.
drop trigger if exists trg_exigir_adicional_fiscal_na_reserva on public.reservas_fiscais;
create trigger trg_exigir_adicional_fiscal_na_reserva
  before insert or update of status on public.reservas_fiscais
  for each row execute function public.exigir_adicional_fiscal_na_reserva();

comment on column public.contas_fiscais.preco_excedente_centavos is
  'Preco por nota autorizada em centavos; o debito e reservado antes do envio e estornado se a emissao falhar.';

update public.planos
set descricao = case lower(nome)
      when 'trial' then 'Teste gratuito do Sistema OS por 30 dias. Notas fiscais usam saldo por emissao autorizada.'
      when 'beta' then 'Teste beta do Sistema OS por 45 dias. Notas fiscais usam saldo por emissao autorizada.'
    end,
    updated_at = now()
where lower(nome) in ('trial', 'beta');
