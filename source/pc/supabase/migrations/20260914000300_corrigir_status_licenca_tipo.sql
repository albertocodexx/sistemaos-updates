-- Mantém o retorno da função estritamente tipado como public.licenca_status.
-- Isso elimina coerções implícitas e evita diferenças entre versões do PostgreSQL.
create or replace function public.calcular_status_licenca_empresa(
  p_empresa_id uuid,
  p_agora timestamptz default now()
)
returns public.licenca_status
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.empresas%rowtype;
begin
  select * into e from public.empresas where id = p_empresa_id;

  if not found or not e.ativo then
    return 'bloqueada'::public.licenca_status;
  end if;

  if e.licenca_status in ('bloqueada', 'suspensa', 'cancelada') then
    return e.licenca_status;
  end if;

  if e.licenca_status = 'teste' then
    if e.fim_trial is not null and e.fim_trial > p_agora then
      return 'teste'::public.licenca_status;
    end if;
    if e.periodo_graca_ate is not null and e.periodo_graca_ate > p_agora then
      return 'periodo_graca'::public.licenca_status;
    end if;
    return 'vencida'::public.licenca_status;
  end if;

  if e.data_vencimento is not null and e.data_vencimento <= p_agora then
    if e.periodo_graca_ate is not null and e.periodo_graca_ate > p_agora then
      return 'periodo_graca'::public.licenca_status;
    end if;
    return 'vencida'::public.licenca_status;
  end if;

  if e.data_vencimento is not null
     and e.data_vencimento <= p_agora + interval '15 days' then
    return 'vencendo'::public.licenca_status;
  end if;

  return 'ativa'::public.licenca_status;
end;
$$;
