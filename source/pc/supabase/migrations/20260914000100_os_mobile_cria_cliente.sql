begin;

-- A criação móvel agora resolve o cliente e a OS na mesma transação. Isso
-- impede uma OS sincronizada de ficar apenas com snapshot, sem aparecer no
-- perfil do cliente, e mantém a numeração de clientes iniciada em 10000.
create or replace function public.criar_ordem_servico_mobile_v2(
  p_id_exportacao text,
  p_dados jsonb,
  p_origem_dispositivo_id uuid default null
)
returns public.ordens_servico
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid := app_private.current_user_empresa_id();
  v_os public.ordens_servico;
  v_cliente public.clientes;
  v_cliente_id uuid;
  v_cliente_numero bigint;
  v_nome text := nullif(btrim(coalesce(p_dados->>'cliente_nome_snapshot', '')), '');
  v_telefone text := nullif(btrim(coalesce(p_dados->>'cliente_telefone_snapshot', '')), '');
  v_telefone_digitos text := nullif(regexp_replace(coalesce(p_dados->>'cliente_telefone_snapshot', ''), '\D', '', 'g'), '');
  v_cpf text := nullif(regexp_replace(coalesce(p_dados->>'cliente_cpf_snapshot', ''), '\D', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_dados #>> '{dados_extras,cliente_email}', ''))), '');
  v_id_texto text := nullif(btrim(coalesce(p_dados->>'cliente_id', '')), '');
  v_extras jsonb;
  v_payload jsonb;
begin
  if v_empresa is null or app_private.tem_permissao('os', 'criar') is distinct from true then
    raise exception using errcode='42501', message='Sem permissão para criar OS.';
  end if;
  if nullif(btrim(coalesce(p_id_exportacao, '')), '') is null
     or p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception using errcode='22023', message='Dados da OS inválidos.';
  end if;
  if v_nome is null then
    raise exception using errcode='23514', message='Nome do cliente é obrigatório.';
  end if;
  if v_cpf is not null and char_length(v_cpf) <> 11 then
    raise exception using errcode='23514', message='CPF inválido.';
  end if;

  -- Uma repetição/retry da mesma fila nunca cria dois clientes nem duas OS.
  perform pg_advisory_xact_lock(hashtextextended(v_empresa::text || ':os-mobile:' || btrim(p_id_exportacao), 0));
  select * into v_os from public.ordens_servico
   where empresa_id=v_empresa and id_exportacao=btrim(p_id_exportacao);
  if v_os.id is not null then return v_os; end if;

  if v_id_texto is not null then
    begin
      v_cliente_id := v_id_texto::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023', message='Cliente selecionado inválido.';
    end;
    select * into v_cliente from public.clientes
     where id=v_cliente_id and empresa_id=v_empresa and deleted_at is null;
    if v_cliente.id is null then
      raise exception using errcode='42501', message='Cliente indisponível para esta empresa.';
    end if;
  else
    -- Serializa identidades equivalentes para evitar duplicação sob dois
    -- celulares salvando ao mesmo tempo.
    perform pg_advisory_xact_lock(hashtextextended(
      v_empresa::text || ':cliente-os:' || coalesce(v_cpf, v_telefone_digitos, v_email, lower(v_nome)), 0
    ));
    if v_cpf is not null then
      select * into v_cliente from public.clientes
       where empresa_id=v_empresa and cpf=v_cpf and deleted_at is null limit 1;
    end if;
    if v_cliente.id is null and v_telefone_digitos is not null then
      select * into v_cliente from public.clientes
       where empresa_id=v_empresa and deleted_at is null
         and regexp_replace(coalesce(telefone, ''), '\D', '', 'g')=v_telefone_digitos
       order by updated_at desc limit 1;
    end if;
    if v_cliente.id is null and v_email is not null then
      select * into v_cliente from public.clientes
       where empresa_id=v_empresa and deleted_at is null and lower(btrim(coalesce(email, '')))=v_email
       order by updated_at desc limit 1;
    end if;
  end if;

  if v_cliente.id is null then
    insert into public.sequencias_documentos as s(empresa_id,tipo,proximo_valor)
      values(v_empresa,'cliente',10001)
    on conflict(empresa_id,tipo) do update
      set proximo_valor=greatest(s.proximo_valor,10000)+1, updated_at=now()
    returning proximo_valor-1 into v_cliente_numero;

    insert into public.clientes(
      empresa_id,nome,telefone,cpf,email,numero_cliente,id_exportacao,
      origem_dispositivo_id,dados_extras
    ) values(
      v_empresa,v_nome,v_telefone,v_cpf,v_email,v_cliente_numero,
      'os-mobile-cliente:' || btrim(p_id_exportacao),p_origem_dispositivo_id,
      jsonb_build_object('cliente_id_numero',v_cliente_numero,'origem','os-mobile')
    ) returning * into v_cliente;
  else
    v_cliente_numero := v_cliente.numero_cliente;
    if v_cliente_numero is null then
      insert into public.sequencias_documentos as s(empresa_id,tipo,proximo_valor)
        values(v_empresa,'cliente',10001)
      on conflict(empresa_id,tipo) do update
        set proximo_valor=greatest(s.proximo_valor,10000)+1, updated_at=now()
      returning proximo_valor-1 into v_cliente_numero;

      update public.clientes set
        numero_cliente=v_cliente_numero,
        dados_extras=coalesce(dados_extras,'{}'::jsonb) || jsonb_build_object('cliente_id_numero',v_cliente_numero),
        revision=revision+1,updated_at=now()
      where id=v_cliente.id and empresa_id=v_empresa
      returning * into v_cliente;
    end if;
  end if;

  v_extras := case when jsonb_typeof(p_dados->'dados_extras')='object'
    then p_dados->'dados_extras' else '{}'::jsonb end;
  v_extras := v_extras || jsonb_build_object(
    'cliente_id_numero',v_cliente.numero_cliente,
    'cliente_email',coalesce(v_email,v_cliente.email)
  );
  v_payload := p_dados || jsonb_build_object(
    'cliente_id',v_cliente.id::text,
    'cliente_cpf_snapshot',v_cpf,
    'dados_extras',v_extras
  );

  return public.criar_ordem_servico(p_id_exportacao,v_payload,p_origem_dispositivo_id);
end;
$$;

revoke all on function public.criar_ordem_servico_mobile_v2(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.criar_ordem_servico_mobile_v2(text,jsonb,uuid) to authenticated;
comment on function public.criar_ordem_servico_mobile_v2(text,jsonb,uuid) is
  'Cria a OS móvel e resolve/cria seu cliente numerado atomicamente, isolado pela empresa autenticada.';

commit;
