-- Executar no SQL Editor. Tudo é revertido, inclusive os registros QA.
begin;
set local statement_timeout = '25s';
do $$
declare perfil public.perfis; empresa_outra uuid; ordem uuid; ordem_outra uuid; n bigint;
begin
  select p.* into strict perfil from public.perfis p join public.empresas e on e.id=p.empresa_id
    where p.ativo and e.ativo and lower(p.cargo) in ('administrador','admin','proprietario')
    and e.licenca_status not in ('bloqueada','suspensa','cancelada')
    order by p.created_at limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',perfil.id,'role','authenticated')::text,true);
  select coalesce(max(numero_sequencial),0)+10000 into n from public.ordens_servico where empresa_id=perfil.empresa_id;
  insert into public.ordens_servico(empresa_id,numero,numero_sequencial,cliente_nome_snapshot,cliente_telefone_snapshot,defeito_relatado,dados_extras)
    values(perfil.empresa_id,'OS-'||n,n,'QA RPC','00000000000','QA transacional','{"cliente_id_numero":19999}') returning id into ordem;
  insert into public.empresas(nome_fantasia,codigo) values('QA temporário: isolamento RPC','qa-rpc-'||gen_random_uuid()::text) returning id into empresa_outra;
  insert into public.ordens_servico(empresa_id,numero,numero_sequencial,cliente_nome_snapshot,defeito_relatado)
    values(empresa_outra,'OS-99999',99999,'QA outra empresa','QA transacional') returning id into ordem_outra;
  perform set_config('qa.ordem',ordem::text,true);
  perform set_config('qa.outra_ordem',ordem_outra::text,true);
  perform set_config('qa.outra_empresa',empresa_outra::text,true);
end $$;
set local role authenticated;
do $$
declare entrega jsonb; garantia jsonb; revisao bigint;
begin
  if has_table_privilege(current_user,'public.entregas','INSERT') or has_table_privilege(current_user,'public.garantias','UPDATE') then
    raise exception 'Teste requer tabelas protegidas contra escrita direta';
  end if;
  entrega := public.salvar_pos_atendimento('entrega',jsonb_build_object(
    'empresa_id',current_setting('qa.outra_empresa'),'ordem_servico_id',current_setting('qa.ordem'),
    'cliente_nome_snapshot','QA RPC','retirado_por','QA recebedor','garantia_dias',90,
    'entregue_em','2026-08-28T15:00:00Z','dados_extras',
    jsonb_build_object('documento_mobile',jsonb_build_object('garantiaDataInicio','2026-08-25','termosGarantia','Termos QA','naoAssinado',true))));
  if entrega->>'empresa_id'=current_setting('qa.outra_empresa') then raise exception 'Empresa fornecida não pode substituir a sessão'; end if;
  select to_jsonb(g) into strict garantia from public.garantias g where ordem_servico_id=current_setting('qa.ordem')::uuid;
  if garantia->>'data_abertura'<>'2026-08-25' or garantia->>'data_limite'<>'2026-11-23'
    or garantia #>> '{dados_extras,clienteNumero}'<>'19999' or garantia->>'cliente_telefone_snapshot'<>'00000000000' then
    raise exception 'Garantia/identidade automática incorreta';
  end if;
  revisao := (garantia->>'revision')::bigint;
  garantia := public.salvar_pos_atendimento('garantia','{"termos":"Editado no celular QA","garantia_dias":120,"dados_extras":{"origem":"manual"}}',
    (garantia->>'id')::uuid,revisao);
  if garantia->>'termos'<>'Editado no celular QA' then raise exception 'Edição não persistiu'; end if;
  begin
    perform public.salvar_pos_atendimento('garantia','{"termos":"conflito"}',(garantia->>'id')::uuid,revisao);
    raise exception 'Revisão antiga aceita indevidamente';
  exception when serialization_failure then null;
  end;
  begin
    perform public.salvar_pos_atendimento('entrega',jsonb_build_object('ordem_servico_id',current_setting('qa.outra_ordem')));
    raise exception 'OS de outra empresa aceita indevidamente';
  exception when no_data_found then null;
  end;
  entrega := public.salvar_pos_atendimento('entrega','{"retirado_por":"Recebedor corrigido"}',(entrega->>'id')::uuid,(entrega->>'revision')::bigint);
  if not exists(select 1 from public.garantias where id=(garantia->>'id')::uuid and garantia_dias=120) then
    raise exception 'Alteração de recebedor perdeu garantia manual';
  end if;
  garantia := public.salvar_pos_atendimento('garantia','{}',(garantia->>'id')::uuid,(garantia->>'revision')::bigint,true);
  if garantia->>'deleted_at' is null then raise exception 'Exclusão não registrada'; end if;
end $$;
select 'PASSOU: authenticated cria e edita, garantia automática, cliente/ID/telefone, conflito bloqueado, empresas isoladas, exclusão segura; tudo revertido' as verificacao;
rollback;
