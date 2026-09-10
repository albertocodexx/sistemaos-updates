-- Funcoes SECURITY DEFINER nao devem herdar EXECUTE do papel PUBLIC.
-- Edge Functions internas continuam usando service_role; os aplicativos so
-- recebem as RPCs autenticadas que fazem parte do contrato publico abaixo.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_funcao record;
begin
  for v_funcao in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_funcao.assinatura);
    execute format('grant execute on function %s to service_role', v_funcao.assinatura);
  end loop;
end
$$;

-- Allowlist das RPCs chamadas por PC/APK ou por uma Edge Function usando o
-- JWT do proprio usuario. Cada funcao ainda valida empresa, cargo e licenca.
do $$
declare
  v_funcao record;
  v_permitidas text[];
begin
  v_permitidas := array[
    'atualizar_licenca_empresa', 'atualizar_ordem_servico',
    'auditar_integridade_postgresql', 'buscar_cliente_documentos',
    'cancelar_solicitacao_assinatura_remota', 'enviar_solicitacao_assinatura_remota',
    'confirmar_consumo_arquivo_mobile', 'confirmar_exclusao_os_desktop',
    'confirmar_pagamento_assinatura',
    'criar_entrega_mobile', 'atualizar_entrega_mobile',
    'criar_ordem_servico', 'criar_ordem_servico_desktop', 'excluir_ordem_servico',
    'criar_solicitacao_exclusao', 'decidir_solicitacao_exclusao',
    'excluir_empresa_definitivamente',
    'criar_documento_mobile', 'atualizar_documento_mobile',
    'criar_documento_venda_mobile', 'atualizar_documento_venda_mobile',
    'criar_documento_compra_mobile', 'atualizar_documento_compra_mobile',
    'criar_documento_comercial_mobile', 'atualizar_documento_comercial_mobile',
    'obter_politica_exclusao', 'definir_minha_senha_exclusao',
    'definir_senha_exclusao_suporte', 'definir_senha_exclusao_usuario',
    'configurar_politica_exclusao', 'validar_minha_senha_exclusao',
    'salvar_pos_atendimento', 'preparar_entrega_retorno_garantia',
    'registrar_backup_empresa', 'salvar_configuracao_mobile', 'definir_logo_empresa',
    'solicitar_arquivo_local', 'listar_arquivos_exclusao_os',
    'responder_solicitacao_arquivo', 'listar_arquivos_temporarios_expirados',
    'expirar_arquivo_temporario',
    'registrar_arquivo', 'registrar_arquivo_local', 'registrar_arquivo_mobile',
    'registrar_arquivo_entrega_mobile', 'registrar_arquivo_documento_mobile',
    'registrar_arquivo_comercial_mobile',
    'obter_contexto_comercial', 'obter_papel_suporte',
    'registrar_acesso_comercial', 'configurar_troca_rapida_contas',
    'registrar_heartbeat', 'restaurar_ordem_servico_desktop',
    'listar_exclusoes_os_pendentes',
    'salvar_item_estoque', 'excluir_item_estoque', 'movimentar_quantidade_peca',
    'salvar_tabela_preco_v2', 'excluir_tabela_preco',
    'salvar_desbloqueio', 'excluir_desbloqueio'
  ];

  for v_funcao in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.proname = any(v_permitidas)
  loop
    execute format('grant execute on function %s to authenticated', v_funcao.assinatura);
  end loop;
end
$$;

-- Funcao antiga detectada pelo Security Advisor. Ela e chamada apenas por
-- trigger e nao precisa resolver nenhum objeto por search_path dinamico.
do $$
declare
  v_funcao record;
begin
  for v_funcao in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'touch_solicitacoes_assinatura_remota_updated_at'
  loop
    execute format('alter function %s set search_path = ''''', v_funcao.assinatura);
  end loop;
end
$$;

commit;
