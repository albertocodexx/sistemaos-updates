-- Salva configurações compartilhadas do APK sem conceder UPDATE direto na
-- tabela. Também corrige a função da logo para preservar assinatura e
-- configMobile já existentes dentro de identidadeEmpresa.

create or replace function public.definir_logo_empresa(
  p_storage_path text,
  p_sha256 text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_identidade jsonb := '{}'::jsonb;
begin
  if v_empresa_id is null or not app_private.eh_administrador_empresa(v_empresa_id) then
    raise exception 'somente_administrador_pode_alterar_logo';
  end if;
  if coalesce(p_storage_path, '') <> ''
     and p_storage_path <> (v_empresa_id::text || '/logo.png') then
    raise exception 'caminho_logo_invalido';
  end if;
  if coalesce(p_sha256, '') <> '' and lower(p_sha256) !~ '^[a-f0-9]{64}$' then
    raise exception 'sha256_invalido';
  end if;

  select coalesce(configuracoes -> 'identidadeEmpresa', '{}'::jsonb)
    into v_identidade
    from public.configuracoes_empresa
   where empresa_id = v_empresa_id;

  v_identidade := coalesce(v_identidade, '{}'::jsonb) || jsonb_build_object(
    'logoStorageBucket', 'identidade-empresa',
    'logoStoragePath', coalesce(p_storage_path, ''),
    'logoSha256', lower(coalesce(p_sha256, '')),
    'logoAtualizadaEm', now(),
    'logoAtualizadaPor', auth.uid()
  );

  insert into public.configuracoes_empresa (empresa_id, configuracoes, feature_flags)
  values (v_empresa_id, jsonb_build_object('identidadeEmpresa', v_identidade), '{}'::jsonb)
  on conflict (empresa_id) do update set
    configuracoes = coalesce(public.configuracoes_empresa.configuracoes, '{}'::jsonb)
      || jsonb_build_object('identidadeEmpresa', v_identidade),
    updated_at = now();

  return v_identidade;
end;
$$;

revoke all on function public.definir_logo_empresa(text, text) from public, anon;
grant execute on function public.definir_logo_empresa(text, text) to authenticated;

create or replace function public.salvar_configuracao_mobile(
  p_config_mobile jsonb,
  p_assinatura_storage_path text default '',
  p_assinatura_sha256 text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_identidade jsonb := '{}'::jsonb;
  v_path text := coalesce(p_assinatura_storage_path, '');
  v_sha text := lower(coalesce(p_assinatura_sha256, ''));
begin
  if v_empresa_id is null or not app_private.eh_administrador_empresa(v_empresa_id) then
    raise exception 'somente_administrador_pode_alterar_configuracao';
  end if;
  if jsonb_typeof(coalesce(p_config_mobile, '{}'::jsonb)) <> 'object' then
    raise exception 'configuracao_mobile_invalida';
  end if;
  if v_path <> '' and v_path <> (v_empresa_id::text || '/assinatura-assistencia.png') then
    raise exception 'caminho_assinatura_invalido';
  end if;
  if v_sha <> '' and v_sha !~ '^[a-f0-9]{64}$' then
    raise exception 'sha256_invalido';
  end if;

  select coalesce(configuracoes -> 'identidadeEmpresa', '{}'::jsonb)
    into v_identidade
    from public.configuracoes_empresa
   where empresa_id = v_empresa_id;

  v_identidade := coalesce(v_identidade, '{}'::jsonb)
    || jsonb_build_object(
      'configMobile', coalesce(p_config_mobile, '{}'::jsonb),
      'configMobileAtualizadaEm', now(),
      'configMobileAtualizadaPor', auth.uid()
    );

  if v_path = '' then
    v_identidade := v_identidade
      - 'assinaturaStoragePath'
      - 'assinaturaSha256'
      - 'assinaturaAtualizadaEm'
      - 'assinaturaAtualizadaPor';
  else
    v_identidade := v_identidade || jsonb_build_object(
      'assinaturaStoragePath', v_path,
      'assinaturaSha256', v_sha,
      'assinaturaAtualizadaEm', now(),
      'assinaturaAtualizadaPor', auth.uid()
    );
  end if;

  insert into public.configuracoes_empresa (empresa_id, configuracoes, feature_flags)
  values (v_empresa_id, jsonb_build_object('identidadeEmpresa', v_identidade), '{}'::jsonb)
  on conflict (empresa_id) do update set
    configuracoes = coalesce(public.configuracoes_empresa.configuracoes, '{}'::jsonb)
      || jsonb_build_object('identidadeEmpresa', v_identidade),
    updated_at = now();

  return v_identidade;
end;
$$;

revoke all on function public.salvar_configuracao_mobile(jsonb, text, text) from public, anon;
grant execute on function public.salvar_configuracao_mobile(jsonb, text, text) to authenticated;

comment on function public.salvar_configuracao_mobile(jsonb, text, text) is
  'Persiste preferências compartilhadas e assinatura do APK preservando a identidade da empresa.';
