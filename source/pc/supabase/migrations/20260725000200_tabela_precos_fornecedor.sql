-- Acrescenta o fornecedor ao cadastro compartilhado da tabela de preços.
-- A RPC anterior é preservada para manter compatibilidade com versões já
-- instaladas; PC e Android novos usam a versão 2.

alter table public.tabela_precos
  add column if not exists fornecedor text not null default '';

create or replace function public.salvar_tabela_preco_v2(
  p_id uuid,
  p_modelo text,
  p_peca text,
  p_valor numeric,
  p_fornecedor text default '',
  p_observacoes text default '',
  p_revision bigint default null
)
returns public.tabela_precos
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_atual public.tabela_precos;
  v_resultado public.tabela_precos;
begin
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'Empresa autenticada não encontrada.';
  end if;
  if nullif(btrim(p_modelo), '') is null or nullif(btrim(p_peca), '') is null
     or p_valor is null or p_valor < 0 then
    raise exception using errcode = '22023', message = 'Informe modelo, peça ou serviço e valor válido.';
  end if;

  if p_id is null then
    if not app_private.tem_permissao('estoque', 'criar') then
      raise exception using errcode = '42501', message = 'Sem permissão para adicionar preços.';
    end if;
    insert into public.tabela_precos (
      empresa_id, modelo, peca, valor, fornecedor, observacoes
    ) values (
      v_empresa_id, btrim(p_modelo), btrim(p_peca), round(p_valor, 2),
      coalesce(btrim(p_fornecedor), ''), coalesce(btrim(p_observacoes), '')
    ) returning * into v_resultado;
  else
    if not app_private.tem_permissao('estoque', 'editar') then
      raise exception using errcode = '42501', message = 'Sem permissão para editar preços.';
    end if;
    select * into v_atual
      from public.tabela_precos
     where id = p_id and empresa_id = v_empresa_id and deleted_at is null
     for update;
    if v_atual.id is null then
      raise exception using errcode = 'P0002', message = 'Preço não encontrado.';
    end if;
    if p_revision is not null and p_revision > 0 and p_revision <> v_atual.revision then
      raise exception using errcode = '40001', message = 'conflito_revision_tabela_preco';
    end if;
    update public.tabela_precos
       set modelo = btrim(p_modelo),
           peca = btrim(p_peca),
           valor = round(p_valor, 2),
           fornecedor = coalesce(btrim(p_fornecedor), ''),
           observacoes = coalesce(btrim(p_observacoes), ''),
           revision = revision + 1,
           updated_at = now()
     where id = p_id and empresa_id = v_empresa_id
     returning * into v_resultado;
  end if;
  return v_resultado;
exception
  when unique_violation then
    raise exception using errcode = '23505',
      message = 'Já existe um preço cadastrado para este modelo e esta peça ou serviço.';
end;
$$;

grant execute on function public.salvar_tabela_preco_v2(uuid, text, text, numeric, text, text, bigint)
  to authenticated;
