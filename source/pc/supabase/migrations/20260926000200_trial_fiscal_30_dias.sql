-- O novo Trial dura 30 dias. Empresas que ja receberam 45 dias conservam
-- seu fim_trial original: esta migracao nao encurta acordos existentes.
update public.planos
set descricao = 'Teste gratuito completo por 30 dias, incluindo 30 operacoes fiscais no mes.',
    duracao_dias = 30,
    limites = jsonb_set(coalesce(limites, '{}'::jsonb), '{trial_dias}', '30'::jsonb, true),
    ativo = true,
    updated_at = now()
where lower(nome) = 'trial';

-- A cota fiscal de novas empresas Trial e 30. A regra cobre inclusive a
-- criacao tardia da carteira pelo RPC de emissao, sem confiar no aplicativo.
create or replace function public.definir_cota_fiscal_trial_ao_criar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.empresas e
    join public.planos p on p.id = e.plano_id
    where e.id = new.empresa_id and lower(p.nome) = 'trial'
      and e.inicio_trial is not null and e.fim_trial is not null
      and e.fim_trial <= e.inicio_trial + interval '31 days'
  ) then
    new.limite_gratuito_mensal := 30;
    new.preco_excedente_centavos := 25;
  end if;
  return new;
end $$;
revoke all on function public.definir_cota_fiscal_trial_ao_criar() from public, anon, authenticated;
drop trigger if exists trg_definir_cota_fiscal_trial_ao_criar on public.contas_fiscais;
create trigger trg_definir_cota_fiscal_trial_ao_criar before insert on public.contas_fiscais
  for each row execute function public.definir_cota_fiscal_trial_ao_criar();

-- Nao exigir adicional pago durante o Trial ativo. A mesma reserva falha
-- fechada no instante do vencimento, mesmo que o APK esteja offline/em cache.
create or replace function public.exigir_adicional_fiscal_na_reserva()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'reservada' and not exists (
    select 1 from public.empresas e where e.id = new.empresa_id and e.ativo and
      ((e.licenca_status = 'teste' and e.fim_trial > now() and exists (
         select 1 from public.planos p where p.id = e.plano_id and lower(p.nome) = 'trial'))
       or (e.licenca_status = 'ativa' and e.data_vencimento > now()
           and e.modulo_fiscal_ativo_ate > now()))
  ) then
    raise exception using errcode = '42501',
      message = 'Trial encerrado ou modulo fiscal nao contratado para esta empresa.';
  end if;
  return new;
end $$;
revoke all on function public.exigir_adicional_fiscal_na_reserva() from public, anon, authenticated;
