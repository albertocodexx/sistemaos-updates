-- A mesma pessoa juridica nao pode controlar o mesmo emitente por tenants
-- diferentes. Se houver duplicatas legadas, a migracao falha de proposito:
-- revisar com os titulares antes de aplicar, sem mover notas ou credenciais.
create unique index if not exists configuracoes_fiscais_cnpj_emitente_unico
  on public.configuracoes_fiscais ((regexp_replace(metadados->>'cnpj', '[^0-9]', '', 'g')))
  where length(regexp_replace(coalesce(metadados->>'cnpj', ''), '[^0-9]', '', 'g')) = 14;

create unique index if not exists configuracoes_fiscais_nfeio_empresa_unica
  on public.configuracoes_fiscais ((metadados->>'nfeio_empresa_id'))
  where nullif(metadados->>'nfeio_empresa_id', '') is not null;
