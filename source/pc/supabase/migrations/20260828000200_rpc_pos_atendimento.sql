-- Escrita restrita: a empresa vem da sessão, nunca do aplicativo.
-- Tabelas continuam sem INSERT/UPDATE/DELETE direto para authenticated.
create or replace function public.salvar_pos_atendimento(
  p_tipo text, p_dados jsonb default '{}'::jsonb,
  p_id uuid default null, p_revision bigint default null,
  p_excluir boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  empresa uuid := app_private.current_user_empresa_id();
  tabela text;
  anterior jsonb;
  dados jsonb;
  salvo jsonb;
  ordem public.ordens_servico;
  permitidos text[];
  colunas text;
  valores text;
  atribuicoes text;
  acao text := case when p_excluir then 'excluir' when p_id is null then 'criar' else 'editar' end;
begin
  if p_tipo not in ('entrega','garantia') or p_tipo is null then
    raise exception using errcode='22023', message='Tipo de documento inválido.';
  end if;
  if empresa is null or not coalesce(app_private.tem_permissao('os',acao),false) then
    raise exception using errcode='42501', message='Sua conta não tem permissão para esta alteração.';
  end if;
  tabela := case p_tipo when 'entrega' then 'entregas' else 'garantias' end;
  if p_id is not null then
    execute format('select to_jsonb(t) from public.%I t where id=$1 and empresa_id=$2 and deleted_at is null for update',tabela)
      into anterior using p_id,empresa;
    if anterior is null then raise exception using errcode='P0002', message='Documento não encontrado nesta empresa.'; end if;
    if p_revision is null or p_revision <> (anterior->>'revision')::bigint then
      raise exception using errcode='40001', message='O documento mudou em outro aparelho. Busque novamente antes de editar.';
    end if;
  elsif p_excluir then
    raise exception using errcode='22023', message='Informe o documento a excluir.';
  end if;
  if p_excluir then
    execute format('update public.%I t set deleted_at=now() where id=$1 and empresa_id=$2 returning to_jsonb(t)',tabela)
      into salvo using p_id,empresa;
    return salvo;
  end if;
  if jsonb_typeof(p_dados) is distinct from 'object' or octet_length(p_dados::text)>1048576 then
    raise exception using errcode='22023', message='Dados do documento inválidos.';
  end if;
  select * into ordem from public.ordens_servico
    where empresa_id=empresa and id=coalesce((anterior->>'ordem_servico_id')::uuid,(p_dados->>'ordem_servico_id')::uuid)
      and deleted_at is null;
  if not found then raise exception using errcode='P0002', message='OS não encontrada nesta empresa.'; end if;
  permitidos := array['cliente_nome_snapshot','aparelho_snapshot','marca_snapshot','modelo_snapshot','reparo_realizado','garantia_dias','observacoes','dados_extras'];
  if p_tipo='entrega' then
    permitidos := permitidos || array['retirado_por','documento_retirada','status','entregue_em','data_limite_garantia','valor_reparo','forma_pagamento','id_exportacao'];
  else
    permitidos := permitidos || array['cliente_telefone_snapshot','imei_snapshot','termos','data_abertura','data_limite'];
  end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into dados from jsonb_each(p_dados) where key=any(permitidos);
  dados := dados || jsonb_build_object('empresa_id',empresa,'ordem_servico_id',ordem.id,'numero_os_snapshot',ordem.numero);
  if dados ? 'dados_extras' then
    if jsonb_typeof(dados->'dados_extras') is distinct from 'object' then raise exception using errcode='22023', message='Informações adicionais inválidas.'; end if;
    dados := jsonb_set(dados,'{dados_extras}',coalesce(anterior->'dados_extras','{}'::jsonb)||(dados->'dados_extras'));
  end if;
  if dados ? 'garantia_dias' and ((dados->>'garantia_dias')::integer not between 0 and 36500 or dados->>'garantia_dias' is null) then
    raise exception using errcode='22023', message='Informe a garantia em dias, entre 0 e 36500.';
  end if;
  if dados ? 'cliente_nome_snapshot' and nullif(btrim(dados->>'cliente_nome_snapshot'),'') is null then
    raise exception using errcode='22023', message='Informe o nome do cliente.';
  end if;
  select string_agg(format('%I',key),',' order by key), string_agg(format('p.%I',key),',' order by key),
    string_agg(format('%I=p.%I',key,key),',' order by key)
    into colunas,valores,atribuicoes from jsonb_object_keys(dados) as campos(key);
  if p_id is null then
    execute format('insert into public.%1$I as t (%2$s) select %3$s from jsonb_populate_record(null::public.%1$I,$1) p returning to_jsonb(t)',tabela,colunas,valores)
      into salvo using dados;
  else
    execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) p where t.id=$2 and t.empresa_id=$3 returning to_jsonb(t)',tabela,atribuicoes)
      into salvo using dados,p_id,empresa;
  end if;
  return salvo;
end $$;
revoke all on function public.salvar_pos_atendimento(text,jsonb,uuid,bigint,boolean) from public,anon,authenticated;
grant execute on function public.salvar_pos_atendimento(text,jsonb,uuid,bigint,boolean) to authenticated;
