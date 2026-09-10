begin;

-- O sistema usa os módulos "os" e "estoque". A versão anterior consultava
-- permissões inexistentes (compras/vendas/entregas), impedindo cancelamentos
-- legítimos ou deixando a decisão dependente apenas do cargo administrativo.
create or replace function public.cancelar_solicitacao_assinatura_remota(
  p_id_envio_assinatura text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_id_envio text := btrim(coalesce(p_id_envio_assinatura, ''));
  v_id uuid;
  v_tipo text;
  v_modulo text;
begin
  if v_empresa_id is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'Entre em uma empresa para excluir o documento.';
  end if;
  if v_id_envio = '' or char_length(v_id_envio) > 200 then
    raise exception using errcode = '22023', message = 'Documento não informado ou inválido.';
  end if;

  select tipo_documento into v_tipo
    from public.solicitacoes_assinatura_remota
   where empresa_id = v_empresa_id and id_envio_assinatura = v_id_envio
   for update;

  -- Cancelar algo que já não existe é sucesso idempotente e não revela se o
  -- identificador pertence a outra empresa.
  if v_tipo is null then
    return jsonb_build_object('cancelada', true, 'encontrada', false, 'id', null);
  end if;

  v_modulo := case when v_tipo in ('compra', 'venda') then 'estoque' else 'os' end;
  if app_private.tem_permissao(v_modulo, 'editar') is distinct from true
     and app_private.tem_permissao(v_modulo, 'excluir') is distinct from true then
    raise exception using errcode = '42501', message = 'Sem permissão para remover este documento.';
  end if;

  update public.solicitacoes_assinatura_remota
     set status = 'cancelada',
         pacote = jsonb_build_object(
           'tipoArquivo', 'sistema-os-documento-removido',
           'idEnvioAssinatura', v_id_envio,
           'removidoEm', now()
         ),
         resposta = null,
         respondido_por = null,
         respondido_em = null,
         concluido_em = now(),
         updated_at = now()
   where empresa_id = v_empresa_id and id_envio_assinatura = v_id_envio
  returning id into v_id;

  return jsonb_build_object('cancelada', true, 'encontrada', v_id is not null, 'id', v_id);
end;
$$;

revoke all on function public.cancelar_solicitacao_assinatura_remota(text) from public, anon;
grant execute on function public.cancelar_solicitacao_assinatura_remota(text) to authenticated;

-- Segundo limite, independente do endereço de rede, para conter tentativas
-- distribuídas contra a mesma conta sem tornar o limite normal mais agressivo.
create or replace function public.registrar_falha_login_controlada(
  p_chave text,
  p_limite integer,
  p_bloqueio_minutos integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  registro public.tentativas_login_seguranca%rowtype;
  limite_seguro integer := greatest(5, least(coalesce(p_limite, 20), 100));
  bloqueio_seguro integer := greatest(1, least(coalesce(p_bloqueio_minutos, 15), 1440));
begin
  if p_chave !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Chave de limite inválida.';
  end if;
  select * into registro from public.tentativas_login_seguranca where chave = p_chave for update;
  if not found then
    insert into public.tentativas_login_seguranca(chave, tentativas)
    values (p_chave, 1) returning * into registro;
  elsif registro.janela_inicio < now() - interval '15 minutes' then
    update public.tentativas_login_seguranca
       set tentativas = 1, janela_inicio = now(), bloqueada_ate = null, updated_at = now()
     where chave = p_chave returning * into registro;
  else
    update public.tentativas_login_seguranca
       set tentativas = tentativas + 1,
           bloqueada_ate = case when tentativas + 1 >= limite_seguro
             then now() + make_interval(mins => bloqueio_seguro) else bloqueada_ate end,
           updated_at = now()
     where chave = p_chave returning * into registro;
  end if;
  return jsonb_build_object(
    'bloqueado', registro.bloqueada_ate is not null and registro.bloqueada_ate > now(),
    'tentativas', registro.tentativas
  );
end;
$$;

revoke all on function public.registrar_falha_login_controlada(text, integer, integer) from public, anon, authenticated;
grant execute on function public.registrar_falha_login_controlada(text, integer, integer) to service_role;

commit;
