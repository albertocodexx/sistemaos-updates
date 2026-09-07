-- Etapa 2: isolamento multiempresa. Não há policies para anon.

do $rls$
declare
  t text;
begin
  foreach t in array array[
    'empresas', 'perfis', 'configuracoes_empresa', 'sequencias_documentos',
    'dispositivos', 'clientes', 'ordens_servico', 'garantias', 'entregas',
    'compras', 'vendas', 'arquivos', 'operacoes_sincronizacao'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end
$rls$;

revoke all on table public.vw_ordens_servico_leve from anon, authenticated;
revoke all on table public.vw_garantias_leve from anon, authenticated;
revoke all on table public.vw_entregas_leve from anon, authenticated;
revoke all on table public.vw_clientes_leve from anon, authenticated;
revoke all on table public.vw_compras_leve from anon, authenticated;
revoke all on table public.vw_vendas_leve from anon, authenticated;

-- Nesta etapa, clientes autenticados só leem tabelas. Escritas de OS/heartbeat passam por RPC.
-- As policies de escrita já definem o contrato para os RPCs adicionais da Etapa 5,
-- mas privilégios diretos de INSERT/UPDATE/DELETE não são concedidos.
grant select on table public.empresas, public.perfis, public.configuracoes_empresa,
  public.dispositivos, public.clientes, public.ordens_servico, public.garantias,
  public.entregas, public.compras, public.vendas, public.arquivos,
  public.operacoes_sincronizacao to authenticated;
grant select on table public.vw_ordens_servico_leve,
  public.vw_garantias_leve, public.vw_entregas_leve,
  public.vw_clientes_leve, public.vw_compras_leve,
  public.vw_vendas_leve to authenticated;

drop policy if exists empresas_select_propria on public.empresas;
create policy empresas_select_propria on public.empresas
for select to authenticated
using (id = app_private.current_user_empresa_id());

drop policy if exists perfis_select_empresa on public.perfis;
create policy perfis_select_empresa on public.perfis
for select to authenticated
using (empresa_id = app_private.current_user_empresa_id());

drop policy if exists configuracoes_select_empresa on public.configuracoes_empresa;
create policy configuracoes_select_empresa on public.configuracoes_empresa
for select to authenticated
using (empresa_id = app_private.current_user_empresa_id());

drop policy if exists configuracoes_update_empresa on public.configuracoes_empresa;
create policy configuracoes_update_empresa on public.configuracoes_empresa
for update to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('configuracoes', 'editar')
)
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('configuracoes', 'editar')
);

-- Sem policy em sequencias_documentos: somente a RPC SECURITY DEFINER acessa o contador.

drop policy if exists dispositivos_select_proprios on public.dispositivos;
create policy dispositivos_select_proprios on public.dispositivos
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and usuario_id = auth.uid()
);

drop policy if exists dispositivos_insert_proprios on public.dispositivos;
create policy dispositivos_insert_proprios on public.dispositivos
for insert to authenticated
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and usuario_id = auth.uid()
);

drop policy if exists dispositivos_update_proprios on public.dispositivos;
create policy dispositivos_update_proprios on public.dispositivos
for update to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and usuario_id = auth.uid()
)
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and usuario_id = auth.uid()
);

drop policy if exists clientes_select_empresa on public.clientes;
create policy clientes_select_empresa on public.clientes
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('clientes', 'ler')
);

drop policy if exists clientes_insert_empresa on public.clientes;
create policy clientes_insert_empresa on public.clientes
for insert to authenticated
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('clientes', 'criar')
);

drop policy if exists clientes_update_empresa on public.clientes;
create policy clientes_update_empresa on public.clientes
for update to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('clientes', 'editar')
)
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('clientes', 'editar')
);

drop policy if exists ordens_select_empresa on public.ordens_servico;
create policy ordens_select_empresa on public.ordens_servico
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'ler')
);

drop policy if exists ordens_insert_empresa on public.ordens_servico;
create policy ordens_insert_empresa on public.ordens_servico
for insert to authenticated
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'criar')
);

drop policy if exists ordens_update_empresa on public.ordens_servico;
create policy ordens_update_empresa on public.ordens_servico
for update to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'editar')
)
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'editar')
);

drop policy if exists garantias_select_empresa on public.garantias;
create policy garantias_select_empresa on public.garantias
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'ler')
);

drop policy if exists garantias_insert_empresa on public.garantias;
create policy garantias_insert_empresa on public.garantias
for insert to authenticated
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'criar')
);

drop policy if exists garantias_update_empresa on public.garantias;
create policy garantias_update_empresa on public.garantias
for update to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'editar')
)
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'editar')
);

drop policy if exists entregas_select_empresa on public.entregas;
create policy entregas_select_empresa on public.entregas
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'ler')
);

drop policy if exists entregas_insert_empresa on public.entregas;
create policy entregas_insert_empresa on public.entregas
for insert to authenticated
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'criar')
);

drop policy if exists entregas_update_empresa on public.entregas;
create policy entregas_update_empresa on public.entregas
for update to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'editar')
)
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'editar')
);

drop policy if exists compras_select_empresa on public.compras;
create policy compras_select_empresa on public.compras
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('estoque', 'ler')
);

drop policy if exists compras_insert_empresa on public.compras;
create policy compras_insert_empresa on public.compras
for insert to authenticated
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('estoque', 'criar')
);

drop policy if exists compras_update_empresa on public.compras;
create policy compras_update_empresa on public.compras
for update to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('estoque', 'editar')
)
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('estoque', 'editar')
);

drop policy if exists vendas_select_empresa on public.vendas;
create policy vendas_select_empresa on public.vendas
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('vendas', 'ler')
);

drop policy if exists vendas_insert_empresa on public.vendas;
create policy vendas_insert_empresa on public.vendas
for insert to authenticated
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('vendas', 'criar')
);

drop policy if exists vendas_update_empresa on public.vendas;
create policy vendas_update_empresa on public.vendas
for update to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('vendas', 'editar')
)
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('vendas', 'editar')
);

drop policy if exists arquivos_select_empresa on public.arquivos;
create policy arquivos_select_empresa on public.arquivos
for select to authenticated
using (app_private.pode_acessar_empresa(empresa_id));

drop policy if exists arquivos_insert_empresa on public.arquivos;
create policy arquivos_insert_empresa on public.arquivos
for insert to authenticated
with check (app_private.pode_acessar_empresa(empresa_id));

drop policy if exists arquivos_update_empresa on public.arquivos;
create policy arquivos_update_empresa on public.arquivos
for update to authenticated
using (app_private.pode_acessar_empresa(empresa_id))
with check (app_private.pode_acessar_empresa(empresa_id));

drop policy if exists sync_select_proprio on public.operacoes_sincronizacao;
create policy sync_select_proprio on public.operacoes_sincronizacao
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and usuario_id = auth.uid()
);

drop policy if exists sync_insert_proprio on public.operacoes_sincronizacao;
create policy sync_insert_proprio on public.operacoes_sincronizacao
for insert to authenticated
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and usuario_id = auth.uid()
);

drop policy if exists sync_update_proprio on public.operacoes_sincronizacao;
create policy sync_update_proprio on public.operacoes_sincronizacao
for update to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and usuario_id = auth.uid()
)
with check (
  app_private.pode_acessar_empresa(empresa_id)
  and usuario_id = auth.uid()
);

-- Funções SECURITY DEFINER ficam em schema não exposto e com execução mínima.
revoke all on all functions in schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.current_user_empresa_id() to authenticated;
grant execute on function app_private.pode_acessar_empresa(uuid) to authenticated;
grant execute on function app_private.tem_permissao(text, text) to authenticated;

revoke all on function public.registrar_heartbeat(text, public.dispositivo_tipo, text)
  from public, anon, authenticated;
revoke all on function public.criar_ordem_servico(text, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.excluir_ordem_servico(uuid, bigint)
  from public, anon, authenticated;

grant execute on function public.registrar_heartbeat(text, public.dispositivo_tipo, text)
  to authenticated;
grant execute on function public.criar_ordem_servico(text, jsonb, uuid)
  to authenticated;
grant execute on function public.atualizar_ordem_servico(uuid, bigint, jsonb)
  to authenticated;
grant execute on function public.excluir_ordem_servico(uuid, bigint)
  to authenticated;

comment on schema app_private is
  'Schema não exposto pela API; contém helpers SECURITY DEFINER e funções de trigger.';
