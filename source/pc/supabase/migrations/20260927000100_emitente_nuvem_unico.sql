-- Uma credencial da software house atende varias empresas; o mesmo emitente
-- nao pode ser controlado por tenants diferentes no gateway fiscal.
-- A migracao falha se houver cadastros duplicados: revise-os antes de aplicar,
-- sem apagar ou reassociar dados fiscais automaticamente.
alter table public.configuracoes_fiscais alter column provedor set default 'nuvem_fiscal';

create unique index if not exists configuracoes_fiscais_nuvem_documento_unico
  on public.configuracoes_fiscais ((upper(regexp_replace(
    coalesce(nullif(metadados->>'documento_prestador', ''), nullif(metadados->>'cnpj', ''), nullif(metadados->>'cpf', '')),
    '[^0-9A-Za-z]', '', 'g'
  ))))
  where provedor = 'nuvem_fiscal'
    and coalesce(nullif(metadados->>'documento_prestador', ''), nullif(metadados->>'cnpj', ''), nullif(metadados->>'cpf', '')) is not null;
