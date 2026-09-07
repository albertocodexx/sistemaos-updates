-- Etapa 2: contrato relacional multiempresa.
-- Arquivos binários/Base64 não pertencem a estas tabelas; public.arquivos guarda apenas metadados.

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome_fantasia text not null check (btrim(nome_fantasia) <> ''),
  razao_social text,
  cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  ativo boolean not null default true,
  licenca_status public.licenca_status not null default 'teste',
  licenca_expira_em timestamptz,
  modo_armazenamento public.modo_armazenamento not null default 'economico',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists empresas_cnpj_uidx
  on public.empresas (cnpj) where cnpj is not null;

create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  nome text not null check (btrim(nome) <> ''),
  cargo text not null default 'Atendente',
  permissoes jsonb not null default '{}'::jsonb check (jsonb_typeof(permissoes) = 'object'),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, id)
);

create index if not exists perfis_empresa_ativo_idx
  on public.perfis (empresa_id, ativo);

create table if not exists public.configuracoes_empresa (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  configuracoes jsonb not null default '{}'::jsonb check (jsonb_typeof(configuracoes) = 'object'),
  feature_flags jsonb not null default '{"cloudProvider":"firebase","fileProvider":"cloudinary","supabaseAtivo":false}'::jsonb
    check (jsonb_typeof(feature_flags) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A tabela é privada para escrita direta. A RPC aloca o número de forma atômica.
create table if not exists public.sequencias_documentos (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('os', 'compra', 'venda')),
  proximo_valor bigint not null default 1 check (proximo_valor > 0),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, tipo)
);

create table if not exists public.dispositivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null,
  tipo public.dispositivo_tipo not null,
  nome text not null check (btrim(nome) <> ''),
  device_id text not null check (btrim(device_id) <> ''),
  ultimo_acesso timestamptz not null default now(),
  ultima_sincronizacao timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, id),
  unique (empresa_id, device_id),
  foreign key (empresa_id, usuario_id)
    references public.perfis(empresa_id, id) on delete cascade
);

create index if not exists dispositivos_empresa_heartbeat_idx
  on public.dispositivos (empresa_id, ultimo_acesso desc);

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  nome text not null check (btrim(nome) <> ''),
  telefone text,
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  email text,
  endereco jsonb not null default '{}'::jsonb check (jsonb_typeof(endereco) = 'object'),
  observacoes text,
  id_exportacao text,
  revision bigint not null default 1 check (revision > 0),
  origem_dispositivo_id uuid,
  dados_extras jsonb not null default '{}'::jsonb check (jsonb_typeof(dados_extras) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empresa_id, id),
  foreign key (empresa_id, origem_dispositivo_id)
    references public.dispositivos(empresa_id, id) on delete restrict
);

create unique index if not exists clientes_empresa_cpf_ativo_uidx
  on public.clientes (empresa_id, cpf)
  where cpf is not null and deleted_at is null;
create unique index if not exists clientes_empresa_exportacao_uidx
  on public.clientes (empresa_id, id_exportacao)
  where id_exportacao is not null;
create index if not exists clientes_empresa_nome_idx
  on public.clientes (empresa_id, nome) where deleted_at is null;
create index if not exists clientes_empresa_updated_idx
  on public.clientes (empresa_id, updated_at desc);

create table if not exists public.ordens_servico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  numero text not null check (numero ~ '^OS-[0-9]+$'),
  numero_sequencial bigint not null check (numero_sequencial > 0),
  id_exportacao text,
  cliente_id uuid,
  cliente_nome_snapshot text not null check (btrim(cliente_nome_snapshot) <> ''),
  cliente_telefone_snapshot text,
  cliente_cpf_snapshot text,
  aparelho text,
  marca text,
  modelo text,
  cor text,
  imei text,
  senha_aparelho text,
  acessorios text,
  estado_aparelho text,
  defeito_relatado text not null check (btrim(defeito_relatado) <> ''),
  diagnostico text,
  servico_realizado text,
  observacoes text,
  termos text,
  status text not null default 'Aguardando análise' check (status in (
    'Aguardando análise', 'Em diagnóstico', 'Aguardando aprovação',
    'Aguardando peça', 'Em reparo', 'Em testes', 'Pronto para retirada',
    'Entregue', 'Cancelado'
  )),
  prioridade text not null default 'Normal' check (prioridade in ('Baixa', 'Normal', 'Alta', 'Urgente')),
  tecnico_id uuid,
  valor numeric(14,2) not null default 0 check (valor >= 0),
  forma_pagamento text,
  status_pagamento text not null default '' check (status_pagamento in (
    '', 'Aguardando Pagamento', 'Aguardando Pagamento na Retirada',
    'Autorizado', 'Pagamento Manual'
  )),
  garantia_dias integer not null default 0 check (garantia_dias >= 0),
  data_abertura timestamptz not null default now(),
  data_prevista date,
  hora_prevista time,
  data_conclusao timestamptz,
  origem text not null default 'desktop' check (origem in ('desktop', 'android', 'migracao')),
  revision bigint not null default 1 check (revision > 0),
  origem_dispositivo_id uuid,
  dados_extras jsonb not null default '{}'::jsonb check (jsonb_typeof(dados_extras) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empresa_id, id),
  unique (empresa_id, numero),
  unique (empresa_id, numero_sequencial),
  foreign key (empresa_id, cliente_id)
    references public.clientes(empresa_id, id) on delete restrict,
  foreign key (empresa_id, tecnico_id)
    references public.perfis(empresa_id, id) on delete restrict,
  foreign key (empresa_id, origem_dispositivo_id)
    references public.dispositivos(empresa_id, id) on delete restrict
);

create unique index if not exists ordens_empresa_exportacao_uidx
  on public.ordens_servico (empresa_id, id_exportacao)
  where id_exportacao is not null;
create index if not exists ordens_empresa_status_updated_idx
  on public.ordens_servico (empresa_id, status, updated_at desc)
  where deleted_at is null;
create index if not exists ordens_empresa_cliente_idx
  on public.ordens_servico (empresa_id, cliente_id, updated_at desc)
  where deleted_at is null;
create index if not exists ordens_empresa_prevista_idx
  on public.ordens_servico (empresa_id, data_prevista)
  where deleted_at is null and data_prevista is not null;

-- Garantia é entidade própria no banco local atual e permanece 1:1 com a OS.
create table if not exists public.garantias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  ordem_servico_id uuid not null,
  numero_os_snapshot text not null,
  cliente_nome_snapshot text not null,
  cliente_telefone_snapshot text,
  aparelho_snapshot text,
  marca_snapshot text,
  modelo_snapshot text,
  imei_snapshot text,
  defeito_garantia text,
  reparo_realizado text,
  observacoes text,
  termos text,
  status public.garantia_status not null default 'ativa',
  garantia_dias integer not null default 0 check (garantia_dias >= 0),
  data_abertura date not null default current_date,
  data_limite date,
  tecnico_id uuid,
  id_exportacao text,
  revision bigint not null default 1 check (revision > 0),
  origem_dispositivo_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empresa_id, id),
  unique (empresa_id, ordem_servico_id),
  foreign key (empresa_id, ordem_servico_id)
    references public.ordens_servico(empresa_id, id) on delete restrict,
  foreign key (empresa_id, tecnico_id)
    references public.perfis(empresa_id, id) on delete restrict,
  foreign key (empresa_id, origem_dispositivo_id)
    references public.dispositivos(empresa_id, id) on delete restrict,
  check (data_limite is null or data_limite >= data_abertura)
);

create unique index if not exists garantias_empresa_exportacao_uidx
  on public.garantias (empresa_id, id_exportacao)
  where id_exportacao is not null;
create index if not exists garantias_empresa_limite_idx
  on public.garantias (empresa_id, status, data_limite)
  where deleted_at is null;

-- Entrega pendente e entrega concluída são estados da mesma entidade, evitando duplicação.
create table if not exists public.entregas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  ordem_servico_id uuid not null,
  numero_os_snapshot text not null,
  cliente_nome_snapshot text not null,
  retirado_por text,
  documento_retirada text,
  aparelho_snapshot text,
  marca_snapshot text,
  modelo_snapshot text,
  reparo_realizado text,
  status public.entrega_status not null default 'pendente_assinatura',
  entregue_em timestamptz,
  garantia_dias integer not null default 0 check (garantia_dias >= 0),
  data_limite_garantia date,
  forma_entrega text,
  observacoes text,
  id_envio_assinatura text,
  id_exportacao text,
  revision bigint not null default 1 check (revision > 0),
  origem_dispositivo_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empresa_id, id),
  unique (empresa_id, ordem_servico_id),
  foreign key (empresa_id, ordem_servico_id)
    references public.ordens_servico(empresa_id, id) on delete restrict,
  foreign key (empresa_id, origem_dispositivo_id)
    references public.dispositivos(empresa_id, id) on delete restrict,
  check (status <> 'concluida' or entregue_em is not null)
);

create unique index if not exists entregas_empresa_exportacao_uidx
  on public.entregas (empresa_id, id_exportacao)
  where id_exportacao is not null;
create unique index if not exists entregas_empresa_envio_assinatura_uidx
  on public.entregas (empresa_id, id_envio_assinatura)
  where id_envio_assinatura is not null;
create index if not exists entregas_empresa_status_updated_idx
  on public.entregas (empresa_id, status, updated_at desc)
  where deleted_at is null;

create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  numero text not null,
  id_exportacao text,
  fornecedor_nome text,
  descricao text not null check (btrim(descricao) <> ''),
  quantidade numeric(14,3) not null default 1 check (quantidade > 0),
  valor_unitario numeric(14,2) not null default 0 check (valor_unitario >= 0),
  valor_total numeric(14,2) not null default 0 check (valor_total >= 0),
  data_compra date not null default current_date,
  observacoes text,
  revision bigint not null default 1 check (revision > 0),
  origem_dispositivo_id uuid,
  dados_extras jsonb not null default '{}'::jsonb check (jsonb_typeof(dados_extras) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empresa_id, id),
  unique (empresa_id, numero),
  foreign key (empresa_id, origem_dispositivo_id)
    references public.dispositivos(empresa_id, id) on delete restrict
);

create unique index if not exists compras_empresa_exportacao_uidx
  on public.compras (empresa_id, id_exportacao) where id_exportacao is not null;
create index if not exists compras_empresa_data_idx
  on public.compras (empresa_id, data_compra desc) where deleted_at is null;

create table if not exists public.vendas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  numero text not null,
  id_exportacao text,
  cliente_id uuid,
  cliente_nome_snapshot text,
  itens jsonb not null default '[]'::jsonb check (jsonb_typeof(itens) = 'array'),
  valor_total numeric(14,2) not null default 0 check (valor_total >= 0),
  forma_pagamento text,
  status text not null default 'concluida' check (status in ('rascunho', 'concluida', 'cancelada')),
  data_venda timestamptz not null default now(),
  observacoes text,
  revision bigint not null default 1 check (revision > 0),
  origem_dispositivo_id uuid,
  dados_extras jsonb not null default '{}'::jsonb check (jsonb_typeof(dados_extras) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empresa_id, id),
  unique (empresa_id, numero),
  foreign key (empresa_id, cliente_id)
    references public.clientes(empresa_id, id) on delete restrict,
  foreign key (empresa_id, origem_dispositivo_id)
    references public.dispositivos(empresa_id, id) on delete restrict
);

create unique index if not exists vendas_empresa_exportacao_uidx
  on public.vendas (empresa_id, id_exportacao) where id_exportacao is not null;
create index if not exists vendas_empresa_data_idx
  on public.vendas (empresa_id, data_venda desc) where deleted_at is null;

create table if not exists public.arquivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  entidade_tipo public.entidade_tipo not null,
  entidade_id uuid not null,
  categoria text not null check (btrim(categoria) <> ''),
  nome_arquivo text not null check (btrim(nome_arquivo) <> ''),
  mime_type text not null check (btrim(mime_type) <> ''),
  tamanho_bytes bigint check (tamanho_bytes is null or tamanho_bytes >= 0),
  largura integer check (largura is null or largura > 0),
  altura integer check (altura is null or altura > 0),
  storage_bucket text,
  miniatura_path text,
  arquivo_nuvem_path text,
  arquivo_local_id text,
  legacy_cloudinary_url text,
  disponibilidade public.disponibilidade_arquivo not null default 'indisponivel',
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-fA-F]{64}$'),
  revision bigint not null default 1 check (revision > 0),
  origem_dispositivo_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empresa_id, id),
  foreign key (empresa_id, origem_dispositivo_id)
    references public.dispositivos(empresa_id, id) on delete restrict,
  check (
    disponibilidade = 'indisponivel'
    or miniatura_path is not null
    or arquivo_nuvem_path is not null
    or arquivo_local_id is not null
    or legacy_cloudinary_url is not null
  )
);

create index if not exists arquivos_empresa_entidade_idx
  on public.arquivos (empresa_id, entidade_tipo, entidade_id, categoria)
  where deleted_at is null;
create unique index if not exists arquivos_empresa_nuvem_uidx
  on public.arquivos (empresa_id, storage_bucket, arquivo_nuvem_path)
  where arquivo_nuvem_path is not null;
create index if not exists arquivos_empresa_updated_idx
  on public.arquivos (empresa_id, updated_at desc);

create table if not exists public.operacoes_sincronizacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  usuario_id uuid not null,
  dispositivo_id uuid,
  entidade public.entidade_tipo not null,
  operacao public.operacao_sync not null,
  entidade_id uuid,
  id_exportacao text,
  revision_esperada bigint check (revision_esperada is null or revision_esperada > 0),
  dados jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object'),
  status public.status_sync not null default 'pendente',
  tentativas integer not null default 0 check (tentativas >= 0),
  ultimo_erro text,
  proxima_tentativa_em timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  concluido_em timestamptz,
  unique (empresa_id, id),
  unique (empresa_id, idempotency_key),
  foreign key (empresa_id, usuario_id)
    references public.perfis(empresa_id, id) on delete restrict,
  foreign key (empresa_id, dispositivo_id)
    references public.dispositivos(empresa_id, id) on delete restrict
);

create index if not exists sync_empresa_status_retry_idx
  on public.operacoes_sincronizacao (empresa_id, status, proxima_tentativa_em, created_at)
  where status in ('pendente', 'erro', 'conflito');

comment on table public.arquivos is
  'Somente metadados e localizadores. Nunca armazenar Base64, bytes de PDF, fotos ou assinaturas.';
comment on column public.arquivos.legacy_cloudinary_url is
  'Fallback temporário para conteúdo legado; não é URL assinada do Supabase.';
comment on table public.sequencias_documentos is
  'Contador interno por empresa, acessível somente por RPC segura.';
