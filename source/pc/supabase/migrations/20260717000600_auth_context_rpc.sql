-- Etapa 3: contexto mínimo necessário para liberar a sessão no APK.
--
-- A função app_private.current_user_empresa_id() retorna NULL de propósito
-- quando usuário, empresa ou licença estão bloqueados. Isso protege todas as
-- tabelas de negócio, mas não permite ao cliente diferenciar o motivo do
-- bloqueio. Esta RPC expõe somente o perfil do próprio auth.uid() e o estado
-- da empresa vinculada, sem aceitar empresa_id informado pelo JavaScript.

create or replace function public.obter_contexto_autenticacao()
returns table (
  usuario_id uuid,
  perfil_nome text,
  cargo text,
  permissoes jsonb,
  usuario_ativo boolean,
  empresa_id uuid,
  empresa_nome text,
  empresa_ativa boolean,
  licenca_status public.licenca_status,
  licenca_expira_em timestamptz,
  modo_armazenamento public.modo_armazenamento,
  feature_flags jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.nome,
    p.cargo,
    p.permissoes,
    p.ativo,
    e.id,
    e.nome_fantasia,
    e.ativo,
    e.licenca_status,
    e.licenca_expira_em,
    e.modo_armazenamento,
    coalesce(c.feature_flags, '{}'::jsonb)
  from public.perfis p
  join public.empresas e on e.id = p.empresa_id
  left join public.configuracoes_empresa c on c.empresa_id = e.id
  where p.id = auth.uid()
  limit 1
$$;

revoke all on function public.obter_contexto_autenticacao() from public, anon, authenticated;
grant execute on function public.obter_contexto_autenticacao() to authenticated;

comment on function public.obter_contexto_autenticacao() is
  'Retorna ao usuário autenticado apenas seu perfil, empresa, licença, modo de armazenamento e feature flags.';
