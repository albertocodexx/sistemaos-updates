-- O suporte geral não deve entrar como se fosse uma empresa cliente. Também
-- torna anexos de OS completos por padrão, pois eles precisam circular entre
-- APK e desktop para compor o mesmo PDF.
alter table public.empresas
  alter column modo_armazenamento set default 'nuvem';

update public.empresas
set modo_armazenamento = 'nuvem', updated_at = now()
where modo_armazenamento = 'economico' and ativo = true;

create or replace function public.obter_contexto_comercial()
returns table (
  usuario_id uuid,
  perfil_nome text,
  cargo text,
  permissoes jsonb,
  usuario_ativo boolean,
  empresa_id uuid,
  empresa_codigo text,
  empresa_nome text,
  empresa_ativa boolean,
  licenca_status public.licenca_status,
  inicio_trial timestamptz,
  fim_trial timestamptz,
  data_vencimento timestamptz,
  periodo_graca_ate timestamptz,
  plano_nome text,
  recursos_habilitados jsonb,
  administrador_global boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with papel as (
    select app_private.eh_administrador_global() as global
  )
  select
    p.id,
    p.nome,
    case when papel.global then 'Suporte do Sistema' else p.cargo end,
    case when papel.global then jsonb_build_object('suporte_global', true) else p.permissoes end,
    p.ativo,
    case when papel.global then null else e.id end,
    case when papel.global then null else e.codigo end,
    case when papel.global then 'Central de Suporte Sistema OS' else e.nome_fantasia end,
    case when papel.global then true else e.ativo end,
    case when papel.global then 'ativa'::public.licenca_status else public.calcular_status_licenca_empresa(e.id, now()) end,
    case when papel.global then null else e.inicio_trial end,
    case when papel.global then null else e.fim_trial end,
    case when papel.global then null else e.data_vencimento end,
    case when papel.global then null else e.periodo_graca_ate end,
    case when papel.global then 'Suporte geral' else pl.nome end,
    case when papel.global then jsonb_build_object('suporte_global', true) else e.recursos_habilitados end,
    papel.global
  from public.perfis p
  join public.empresas e on e.id = p.empresa_id
  left join public.planos pl on pl.id = e.plano_id
  cross join papel
  where p.id = auth.uid();
$$;
