-- Mantem o historico de auditoria sem impedir a exclusao de uma conta Auth.
-- As duas referencias abaixo eram RESTRICT e podiam causar
-- "Database error deleting user" quando o usuario possuia historico antigo.

alter table if exists public.solicitacoes_exclusao
  alter column solicitada_por drop not null;

alter table if exists public.solicitacoes_exclusao
  drop constraint if exists solicitacoes_exclusao_solicitada_por_fkey;

alter table if exists public.solicitacoes_exclusao
  add constraint solicitacoes_exclusao_solicitada_por_fkey
  foreign key (solicitada_por) references auth.users(id) on delete set null;

alter table if exists public.auditoria_empresas_excluidas
  alter column excluida_por drop not null;

alter table if exists public.auditoria_empresas_excluidas
  drop constraint if exists auditoria_empresas_excluidas_excluida_por_fkey;

alter table if exists public.auditoria_empresas_excluidas
  add constraint auditoria_empresas_excluidas_excluida_por_fkey
  foreign key (excluida_por) references auth.users(id) on delete set null;

-- Mantem a mesma regra de saldo do PC no Android: uma saida nunca pode
-- reduzir a quantidade abaixo de zero.
create or replace function public.movimentar_quantidade_peca(
  p_id uuid,
  p_delta integer,
  p_revision bigint default null,
  p_dispositivo_id uuid default null
)
returns public.estoque_itens
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_atual public.estoque_itens;
  v_quantidade_atual integer;
  v_quantidade_nova integer;
  v_resultado public.estoque_itens;
begin
  if v_empresa_id is null or not app_private.tem_permissao('estoque', 'editar') then
    raise exception using errcode = '42501', message = 'Sem permissao para movimentar o estoque.';
  end if;
  if p_delta = 0 then
    raise exception using errcode = '22023', message = 'Informe uma quantidade diferente de zero.';
  end if;

  select * into v_atual from public.estoque_itens
   where id = p_id and empresa_id = v_empresa_id and tipo = 'peca' and deleted_at is null
   for update;
  if v_atual.id is null then
    raise exception using errcode = 'P0002', message = 'Item nao encontrado.';
  end if;
  if p_revision is not null and p_revision > 0 and p_revision <> v_atual.revision then
    raise exception using errcode = '40001', message = 'conflito_revision_estoque';
  end if;

  v_quantidade_atual := greatest(0, coalesce((v_atual.dados->>'quantidade')::integer, 0));
  v_quantidade_nova := v_quantidade_atual + p_delta;
  if v_quantidade_nova < 0 then
    raise exception using errcode = '22023', message = 'Estoque insuficiente para registrar esta saida.';
  end if;

  update public.estoque_itens
     set dados = jsonb_set(dados, '{quantidade}', to_jsonb(v_quantidade_nova), true),
         revision = revision + 1,
         origem_dispositivo_id = coalesce(p_dispositivo_id, origem_dispositivo_id),
         updated_at = now()
   where id = v_atual.id
   returning * into v_resultado;
  return v_resultado;
end;
$$;

revoke all on function public.movimentar_quantidade_peca(uuid, integer, bigint, uuid) from public, anon;
grant execute on function public.movimentar_quantidade_peca(uuid, integer, bigint, uuid) to authenticated;
