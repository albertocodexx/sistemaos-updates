-- Exclusão permanente de documentos enviados ao celular. Mantém apenas um
-- tombstone de auditoria sem o conteúdo do documento, impedindo que o item
-- reapareça após limpar os dados ou reinstalar o APK.
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
begin
  if v_empresa_id is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'Entre em uma empresa para excluir o documento.';
  end if;
  if nullif(btrim(p_id_envio_assinatura), '') is null then
    raise exception using errcode = '22023', message = 'Documento não informado.';
  end if;

  update public.solicitacoes_assinatura_remota
     set status = 'cancelada',
         pacote = jsonb_build_object(
           'tipoArquivo', 'sistema-os-documento-removido',
           'idEnvioAssinatura', p_id_envio_assinatura,
           'removidoEm', now()
         ),
         resposta = null,
         respondido_por = null,
         respondido_em = null,
         concluido_em = now(),
         updated_at = now()
   where empresa_id = v_empresa_id
     and id_envio_assinatura = btrim(p_id_envio_assinatura)
     and status in ('pendente', 'respondida', 'concluida', 'cancelada')
  returning id into v_id;

  return jsonb_build_object('cancelada', v_id is not null, 'id', v_id);
end;
$$;

revoke all on function public.cancelar_solicitacao_assinatura_remota(text) from public, anon;
grant execute on function public.cancelar_solicitacao_assinatura_remota(text) to authenticated;
