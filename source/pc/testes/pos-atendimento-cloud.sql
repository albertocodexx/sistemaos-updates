-- Teste transacional: não deixa OS, garantia ou entrega de teste no banco.
begin;
set local statement_timeout = '20s';
do $$
declare empresa uuid; ordem uuid; numero_teste bigint; garantia public.garantias;
begin
  select id into strict empresa from public.empresas order by created_at limit 1;
  select coalesce(max(numero_sequencial),0) + 10000 into numero_teste from public.ordens_servico where empresa_id=empresa;
  insert into public.ordens_servico(empresa_id,numero,numero_sequencial,cliente_nome_snapshot,cliente_telefone_snapshot,defeito_relatado,dados_extras)
    values(empresa,'OS-'||numero_teste,numero_teste,'QA temporário','00000000000','Teste transacional','{"cliente_id_numero":19999}') returning id into ordem;
  insert into public.entregas(empresa_id,ordem_servico_id,numero_os_snapshot,cliente_nome_snapshot,retirado_por,garantia_dias,entregue_em,dados_extras)
    values(empresa,ordem,'OS-'||numero_teste,'QA temporário','QA',90,'2026-08-28T15:00:00Z','{"documento_mobile":{"garantiaDataInicio":"2026-08-25","termosGarantia":"Texto QA","naoAssinado":true}}');
  select * into strict garantia from public.garantias where ordem_servico_id=ordem and empresa_id=empresa;
  if garantia.data_abertura <> '2026-08-25' or garantia.data_limite <> '2026-11-23' or garantia.termos <> 'Texto QA' then raise exception 'Falha em prazo/termos'; end if;
  if garantia.dados_extras->>'clienteNumero' <> '19999' or garantia.cliente_telefone_snapshot <> '00000000000' then raise exception 'Falha nos dados do cliente'; end if;
  if not exists(select 1 from public.vw_entregas_leve where ordem_servico_id=ordem and nao_assinado) then raise exception 'Falha no status Não assinado'; end if;
  update public.garantias set garantia_dias=120,termos='Editado QA',dados_extras=dados_extras||'{"origem":"manual"}' where id=garantia.id;
  update public.entregas set reparo_realizado='Correção de texto' where ordem_servico_id=ordem;
  if not exists(select 1 from public.garantias where id=garantia.id and garantia_dias=120 and termos='Editado QA') then raise exception 'Edição manual perdida'; end if;
  update public.entregas set garantia_dias=0 where ordem_servico_id=ordem;
  if not exists(select 1 from public.garantias where id=garantia.id and garantia_dias=0 and data_limite is null) then raise exception 'Zero não removeu o prazo'; end if;
end $$;
select 'PASSOU: garantia automática, cliente/ID/telefone, datas, termos, edição e zero dias; teste revertido' as verificacao;
rollback;
