begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Permite o novo termo de autorização de desbloqueio na mesma fila segura
-- usada pelos demais documentos. O conteúdo continua isolado por empresa.
alter table public.solicitacoes_assinatura_remota
  drop constraint if exists solicitacoes_assinatura_remota_tipo_documento_check;

alter table public.solicitacoes_assinatura_remota
  add constraint solicitacoes_assinatura_remota_tipo_documento_check
  check (tipo_documento in ('os', 'compra', 'venda', 'entrega', 'desbloqueio'));

create or replace function public.enviar_solicitacao_assinatura_remota(
  p_pacote jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_id_envio text := btrim(coalesce(p_pacote ->> 'idEnvioAssinatura', ''));
  v_tipo text := btrim(coalesce(p_pacote ->> 'tipoDocumento', ''));
  v_id uuid;
begin
  if v_empresa_id is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'Entre em uma empresa para enviar o documento.';
  end if;
  if app_private.tem_permissao('os','criar') is distinct from true and app_private.tem_permissao('os','editar') is distinct from true then
    raise exception using errcode='42501',message='Sem permissão para enviar autorizações.';
  end if;
  if p_pacote is null or jsonb_typeof(p_pacote) <> 'object'
     or p_pacote ->> 'tipoArquivo' is distinct from 'sistema-os-pc-para-assinar'
     or octet_length(p_pacote::text)>8000000 or char_length(v_id_envio)>200
     or v_id_envio = '' or v_tipo <> 'desbloqueio' then
    raise exception using errcode = '22023', message = 'Documento de desbloqueio inválido.';
  end if;

  insert into public.solicitacoes_assinatura_remota
    (empresa_id, id_envio_assinatura, tipo_documento, pacote, resposta, status,
     enviado_por, respondido_por, respondido_em, concluido_em)
  values
    (v_empresa_id, v_id_envio, v_tipo, p_pacote, null, 'pendente',
     auth.uid(), null, null, null)
  on conflict (empresa_id, id_envio_assinatura) do update
    set tipo_documento = excluded.tipo_documento,
        pacote = excluded.pacote,
        resposta = null,
        status = 'pendente',
        enviado_por = auth.uid(),
        respondido_por = null,
        respondido_em = null,
        concluido_em = null,
        updated_at = now()
  returning id into v_id;

  return jsonb_build_object(
    'sucesso', true,
    'solicitacao', jsonb_build_object('id', v_id, 'id_envio_assinatura', v_id_envio, 'tipo_documento', v_tipo)
  );
end;
$$;

revoke all on function public.enviar_solicitacao_assinatura_remota(jsonb) from public, anon;
grant execute on function public.enviar_solicitacao_assinatura_remota(jsonb) to authenticated;

-- Idempotente: se o documento já não existe, a intenção de remoção já está
-- satisfeita. Quando existe, mantém um tombstone sem dados pessoais.
create or replace function public.cancelar_solicitacao_assinatura_remota(
  p_id_envio_assinatura text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_id uuid;
  v_tipo text;
  v_modulo text;
begin
  if v_empresa_id is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'Entre em uma empresa para excluir o documento.';
  end if;
  if nullif(btrim(p_id_envio_assinatura), '') is null then
    raise exception using errcode = '22023', message = 'Documento não informado.';
  end if;
  select tipo_documento into v_tipo from public.solicitacoes_assinatura_remota
    where empresa_id=v_empresa_id and id_envio_assinatura=btrim(p_id_envio_assinatura) for update;
  v_modulo:=case v_tipo when 'compra' then 'compras' when 'venda' then 'vendas' when 'entrega' then 'entregas' else 'os' end;
  if app_private.tem_permissao(v_modulo,'excluir') is distinct from true then
    raise exception using errcode='42501',message='Sem permissão para remover este documento.';
  end if;
  update public.solicitacoes_assinatura_remota
     set status = 'cancelada',
         pacote = jsonb_build_object('tipoArquivo', 'sistema-os-documento-removido',
           'idEnvioAssinatura', btrim(p_id_envio_assinatura), 'removidoEm', now()),
         resposta = null, respondido_por = null, respondido_em = null,
         concluido_em = now(), updated_at = now()
   where empresa_id = v_empresa_id
     and id_envio_assinatura = btrim(p_id_envio_assinatura)
  returning id into v_id;
  return jsonb_build_object('cancelada', true, 'encontrada', v_id is not null, 'id', v_id);
end;
$$;

revoke all on function public.cancelar_solicitacao_assinatura_remota(text) from public, anon;
grant execute on function public.cancelar_solicitacao_assinatura_remota(text) to authenticated;
commit;
