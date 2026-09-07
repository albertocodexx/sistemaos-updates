-- Permite que o administrador da empresa defina uma senha de exclusao
-- diferente para cada usuario. O hash continua isolado em app_private.

create or replace function public.definir_senha_exclusao_usuario(
  p_usuario_id uuid,
  p_senha text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
begin
  if v_empresa_id is null or not app_private.eh_administrador_empresa(v_empresa_id) then
    raise exception using errcode = '42501', message = 'somente o administrador da empresa pode definir a senha de exclusao de outro usuario';
  end if;
  if char_length(coalesce(p_senha, '')) < 6 then
    raise exception using errcode = '22023', message = 'a senha de exclusao precisa ter pelo menos 6 caracteres';
  end if;
  if not exists (
    select 1 from public.perfis p
    where p.id = p_usuario_id and p.empresa_id = v_empresa_id and p.ativo
  ) then
    raise exception using errcode = '22023', message = 'usuario invalido ou inativo nesta empresa';
  end if;

  insert into app_private.credenciais_exclusao_usuario
    (usuario_id, empresa_id, senha_hash, tentativas_invalidas, bloqueada_ate, atualizada_em)
  values
    (p_usuario_id, v_empresa_id, crypt(p_senha, gen_salt('bf', 12)), 0, null, now())
  on conflict (usuario_id) do update
    set empresa_id = excluded.empresa_id,
        senha_hash = excluded.senha_hash,
        tentativas_invalidas = 0,
        bloqueada_ate = null,
        atualizada_em = now();

  insert into public.auditoria_comercial
    (empresa_id, autor_id, acao, entidade, entidade_id, metadados)
  values
    (v_empresa_id, auth.uid(), 'senha_exclusao_usuario_definida_por_admin',
     'perfil', p_usuario_id::text, '{}'::jsonb);
  return true;
end;
$$;

revoke all on function public.definir_senha_exclusao_usuario(uuid, text) from public, anon;
grant execute on function public.definir_senha_exclusao_usuario(uuid, text) to authenticated;
