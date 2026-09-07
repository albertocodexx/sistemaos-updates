-- Assinaturas SaaS automaticas, cobranca central, notificacoes e base fiscal.
-- A conta Mercado Pago da plataforma e separada das contas usadas pelas
-- assistencias para cobrar suas proprias ordens de servico.

create or replace function app_private.current_profile_empresa_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.empresa_id
    from public.perfis p
    join public.empresas e on e.id = p.empresa_id
   where p.id = auth.uid()
     and p.ativo
     and e.ativo
   limit 1
$$;

create or replace function app_private.eh_administrador_geral()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
      from public.administradores_globais g
     where g.usuario_id = auth.uid()
       and g.ativo
       and g.papel = 'administrador_geral'
  )
$$;

alter table public.planos
  add column if not exists duracao_dias integer check (duracao_dias is null or duracao_dias > 0),
  add column if not exists ordem integer not null default 100,
  add column if not exists destaque boolean not null default false,
  add column if not exists excluido_em timestamptz;

update public.planos
set duracao_dias = case periodo
  when 'mensal' then 30
  when 'trimestral' then 90
  when 'semestral' then 180
  when 'anual' then 365
  when 'vitalicio' then 36500
  else 30 end
where duracao_dias is null;

alter table public.planos alter column duracao_dias set default 30;
alter table public.planos alter column duracao_dias set not null;

alter table public.empresas
  add column if not exists contato_cobranca_nome text,
  add column if not exists contato_cobranca_email text,
  add column if not exists contato_cobranca_whatsapp text,
  add column if not exists avisos_cobranca_ativos boolean not null default true,
  add column if not exists whatsapp_modo text not null default 'baileys'
    check (whatsapp_modo in ('baileys', 'api', 'hibrido'));

update public.empresas e
set contato_cobranca_email = coalesce(e.contato_cobranca_email, nullif(btrim(c.configuracoes->>'email'), '')),
    contato_cobranca_whatsapp = coalesce(
      e.contato_cobranca_whatsapp,
      nullif(regexp_replace(coalesce(c.configuracoes->>'whatsapp', ''), '[^0-9]', '', 'g'), '')
    )
from public.configuracoes_empresa c
where c.empresa_id = e.id
  and (e.contato_cobranca_email is null or e.contato_cobranca_whatsapp is null);

create table if not exists public.integracoes_plataforma (
  id uuid primary key default gen_random_uuid(),
  tipo text not null unique check (tipo in ('mercado_pago', 'whatsapp', 'fiscal')),
  status text not null default 'desconectada'
    check (status in ('desconectada', 'conectada', 'erro', 'revogada')),
  provedor text,
  conta_mascarada text,
  conectado_em timestamptz,
  ultima_verificacao_em timestamptz,
  ultimo_erro text,
  metadados jsonb not null default '{}'::jsonb check (jsonb_typeof(metadados) = 'object'),
  criado_por uuid references auth.users(id) on delete set null,
  atualizado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.integracoes_plataforma_segredos (
  integracao_id uuid primary key references public.integracoes_plataforma(id) on delete cascade,
  iv_base64 text not null,
  segredo_cifrado_base64 text not null,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.cobrancas_assinatura (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  plano_anterior_id uuid references public.planos(id) on delete set null,
  plano_id uuid not null references public.planos(id) on delete restrict,
  tipo_alteracao text not null default 'renovacao'
    check (tipo_alteracao in ('renovacao', 'upgrade', 'downgrade', 'reativacao', 'primeira_assinatura')),
  valor numeric(12,2) not null check (valor > 0),
  moeda char(3) not null default 'BRL' check (moeda = 'BRL'),
  duracao_dias integer not null check (duracao_dias > 0),
  referencia_externa text not null unique,
  idempotency_key uuid not null default gen_random_uuid() unique,
  provedor text not null default 'mercado_pago',
  preferencia_id text,
  pagamento_provedor_id text,
  status text not null default 'pendente'
    check (status in ('pendente', 'em_processamento', 'aprovada', 'rejeitada', 'cancelada', 'estornada', 'expirada')),
  checkout_url text,
  expira_em timestamptz,
  pago_em timestamptz,
  aplicado_em timestamptz,
  status_detalhe text,
  dados_provedor jsonb not null default '{}'::jsonb check (jsonb_typeof(dados_provedor) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cobrancas_assinatura_pagamento_uidx
  on public.cobrancas_assinatura (provedor, pagamento_provedor_id)
  where pagamento_provedor_id is not null;
create index if not exists cobrancas_assinatura_empresa_idx
  on public.cobrancas_assinatura (empresa_id, created_at desc);
create index if not exists cobrancas_assinatura_pendentes_idx
  on public.cobrancas_assinatura (status, created_at)
  where status in ('pendente', 'em_processamento');

alter table public.pagamentos_assinatura
  add column if not exists cobranca_id uuid unique references public.cobrancas_assinatura(id) on delete set null,
  add column if not exists provedor text,
  add column if not exists pagamento_provedor_id text;

create unique index if not exists pagamentos_assinatura_provedor_uidx
  on public.pagamentos_assinatura (provedor, pagamento_provedor_id)
  where pagamento_provedor_id is not null;

create table if not exists public.alertas_assinatura (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('vence_3_dias', 'vence_hoje', 'vencida', 'pagamento_confirmado', 'pagamento_falhou')),
  titulo text not null,
  mensagem text not null,
  chave_unica text not null unique,
  lido_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists alertas_assinatura_empresa_idx
  on public.alertas_assinatura (empresa_id, created_at desc);

create table if not exists public.fila_whatsapp (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) on delete cascade,
  origem text not null check (origem in ('assinatura', 'os', 'venda', 'fiscal', 'suporte', 'sistema')),
  destinatario text not null check (destinatario ~ '^[0-9]{10,15}$'),
  template_nome text,
  template_idioma text not null default 'pt_BR',
  parametros jsonb not null default '{}'::jsonb check (jsonb_typeof(parametros) = 'object'),
  mensagem_fallback text,
  chave_unica text not null unique,
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'enviada', 'falhou', 'cancelada')),
  tentativas integer not null default 0 check (tentativas >= 0),
  max_tentativas integer not null default 6 check (max_tentativas between 1 and 20),
  agendada_para timestamptz not null default now(),
  processada_em timestamptz,
  proxima_tentativa_em timestamptz,
  id_mensagem_provedor text,
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fila_whatsapp_pendentes_idx
  on public.fila_whatsapp (coalesce(proxima_tentativa_em, agendada_para), created_at)
  where status in ('pendente', 'falhou');

create table if not exists public.configuracoes_fiscais (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  provedor text not null default 'nfse_nacional',
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  status text not null default 'nao_configurada'
    check (status in ('nao_configurada', 'configurada', 'erro', 'revogada')),
  emissao_automatica_os boolean not null default false,
  emissao_automatica_venda boolean not null default false,
  emissao_automatica_assinatura boolean not null default false,
  metadados jsonb not null default '{}'::jsonb check (jsonb_typeof(metadados) = 'object'),
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  origem_tipo text not null check (origem_tipo in ('assinatura', 'os', 'venda', 'compra', 'avulsa')),
  origem_id text not null,
  valor numeric(12,2) not null check (valor >= 0),
  descricao text not null,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'aguardando_configuracao', 'na_fila', 'processando', 'autorizada', 'rejeitada', 'cancelada')),
  provedor text,
  referencia_provedor text,
  numero text,
  codigo_verificacao text,
  url_consulta text,
  pdf_url text,
  xml_url text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  resposta_provedor jsonb not null default '{}'::jsonb check (jsonb_typeof(resposta_provedor) = 'object'),
  emitida_em timestamptz,
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, origem_tipo, origem_id)
);

create index if not exists notas_fiscais_empresa_idx
  on public.notas_fiscais (empresa_id, created_at desc);

do $$
declare tabela text;
begin
  foreach tabela in array array[
    'integracoes_plataforma', 'cobrancas_assinatura', 'fila_whatsapp',
    'configuracoes_fiscais', 'notas_fiscais'
  ] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', tabela, tabela);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I for each row execute function app_private.set_updated_at()',
      tabela, tabela
    );
  end loop;
end $$;

-- Aplica o pagamento uma unica vez, mesmo que o Mercado Pago reenvie o webhook.
-- Somente service_role/postgres pode chamar esta funcao.
create or replace function public.aplicar_pagamento_assinatura(
  p_cobranca_id uuid,
  p_pagamento_provedor_id text,
  p_pago_em timestamptz default now(),
  p_forma text default 'mercado_pago',
  p_dados_provedor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  c public.cobrancas_assinatura%rowtype;
  p public.planos%rowtype;
  e public.empresas%rowtype;
  v_pagamento_id uuid;
  v_vencimento timestamptz;
  v_recursos jsonb := '{}'::jsonb;
  v_telefone text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'acao exclusiva do servidor';
  end if;

  select * into c from public.cobrancas_assinatura where id = p_cobranca_id for update;
  if not found then raise exception 'cobranca nao encontrada'; end if;
  if c.aplicado_em is not null then
    select id into v_pagamento_id from public.pagamentos_assinatura where cobranca_id = c.id;
    return jsonb_build_object('aplicado', false, 'ja_aplicado', true, 'pagamento_id', v_pagamento_id);
  end if;
  if c.status <> 'aprovada' then raise exception 'cobranca ainda nao esta aprovada'; end if;
  if nullif(btrim(p_pagamento_provedor_id), '') is null then raise exception 'pagamento sem identificador'; end if;

  select * into p from public.planos where id = c.plano_id and ativo and excluido_em is null;
  if not found then raise exception 'plano indisponivel'; end if;
  select * into e from public.empresas where id = c.empresa_id for update;
  if not found then raise exception 'empresa nao encontrada'; end if;

  if p.periodo = 'vitalicio' then
    v_vencimento := '9999-12-31 23:59:59+00'::timestamptz;
  else
    v_vencimento := greatest(coalesce(e.data_vencimento, now()), now()) + make_interval(days => c.duracao_dias);
  end if;

  select coalesce(jsonb_object_agg(
    r.chave,
    case when pr.habilitado = false then 'false'::jsonb
         when pr.limite is not null then to_jsonb(pr.limite)
         else 'true'::jsonb end
  ), '{}'::jsonb)
  into v_recursos
  from public.plano_recursos pr
  join public.recursos r on r.id = pr.recurso_id
  where pr.plano_id = p.id;

  insert into public.pagamentos_assinatura (
    empresa_id, plano_id, valor, vencimento_em, pago_em, forma, referencia,
    status, observacao, cobranca_id, provedor, pagamento_provedor_id
  ) values (
    c.empresa_id, c.plano_id, c.valor, v_vencimento, coalesce(p_pago_em, now()),
    nullif(btrim(p_forma), ''), c.referencia_externa, 'pago',
    'Confirmado automaticamente pelo webhook do Mercado Pago.', c.id,
    c.provedor, p_pagamento_provedor_id
  ) returning id into v_pagamento_id;

  update public.empresas
     set plano_id = c.plano_id,
         licenca_status = 'ativa',
         ultimo_pagamento_em = coalesce(p_pago_em, now()),
         data_vencimento = v_vencimento,
         proximo_vencimento_em = v_vencimento,
         periodo_graca_ate = null,
         bloqueado_em = null,
         motivo_bloqueio = null,
         limite_usuarios = coalesce((p.limites->>'usuarios')::integer, limite_usuarios),
         limite_dispositivos = coalesce((p.limites->>'dispositivos')::integer, limite_dispositivos),
         limite_storage = coalesce((p.limites->>'storage_bytes')::bigint, limite_storage),
         recursos_habilitados = v_recursos,
         updated_at = now()
   where id = c.empresa_id;

  update public.cobrancas_assinatura
     set pagamento_provedor_id = p_pagamento_provedor_id,
         pago_em = coalesce(p_pago_em, now()),
         aplicado_em = now(),
         dados_provedor = coalesce(p_dados_provedor, '{}'::jsonb),
         updated_at = now()
   where id = c.id;

  insert into public.eventos_licenca (empresa_id, tipo, motivo, dados)
  values (
    c.empresa_id, 'pagamento_confirmado', 'Mercado Pago confirmado automaticamente',
    jsonb_build_object('cobranca_id', c.id, 'pagamento_id', v_pagamento_id, 'plano_id', c.plano_id, 'vencimento', v_vencimento)
  );

  insert into public.alertas_assinatura (empresa_id, tipo, titulo, mensagem, chave_unica)
  values (
    c.empresa_id, 'pagamento_confirmado', 'Pagamento confirmado',
    'Seu pagamento foi confirmado e o plano ' || p.nome || ' esta ativo ate ' || to_char(v_vencimento at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '.',
    'pagamento:' || c.id::text
  ) on conflict (chave_unica) do nothing;

  v_telefone := regexp_replace(coalesce(e.contato_cobranca_whatsapp, ''), '[^0-9]', '', 'g');
  if e.avisos_cobranca_ativos and length(v_telefone) between 10 and 15 then
    insert into public.fila_whatsapp (
      empresa_id, origem, destinatario, template_nome, parametros, mensagem_fallback, chave_unica
    ) values (
      c.empresa_id, 'assinatura', v_telefone, 'sistemaos_pagamento_confirmado',
      jsonb_build_object('empresa', e.nome_fantasia, 'plano', p.nome, 'valor', c.valor, 'vencimento', to_char(v_vencimento at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')),
      'Pagamento confirmado. O plano ' || p.nome || ' do Sistema OS esta ativo ate ' || to_char(v_vencimento at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '.',
      'whatsapp:pagamento:' || c.id::text
    ) on conflict (chave_unica) do nothing;
  end if;

  return jsonb_build_object('aplicado', true, 'pagamento_id', v_pagamento_id, 'vencimento', v_vencimento, 'plano', p.nome);
end;
$$;

-- Gera avisos por chave unica. Pode rodar varias vezes por dia sem duplicar.
create or replace function public.gerar_alertas_assinatura(p_agora timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  registro record;
  v_tipo text;
  v_dia text;
  v_chave text;
  v_mensagem text;
  v_total integer := 0;
begin
  for registro in
    select e.id, e.nome_fantasia, e.data_vencimento, e.contato_cobranca_whatsapp,
           e.avisos_cobranca_ativos, p.nome as plano_nome
      from public.empresas e
      left join public.planos p on p.id = e.plano_id
     where e.ativo
       and e.avisos_cobranca_ativos
       and e.data_vencimento is not null
       and e.data_vencimento <= p_agora + interval '3 days'
       and e.data_vencimento >= p_agora - interval '30 days'
  loop
    if registro.data_vencimento < p_agora then v_tipo := 'vencida';
    elsif registro.data_vencimento < p_agora + interval '1 day' then v_tipo := 'vence_hoje';
    else v_tipo := 'vence_3_dias'; end if;
    v_dia := to_char(registro.data_vencimento at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
    v_chave := registro.id::text || ':' || v_tipo || ':' || v_dia;
    v_mensagem := case v_tipo
      when 'vencida' then 'Sua assinatura do Sistema OS venceu. Renove para restabelecer todos os recursos.'
      when 'vence_hoje' then 'Sua assinatura do Sistema OS vence hoje. Voce pode renovar agora sem perder dias.'
      else 'Sua assinatura do Sistema OS vence em ate 3 dias. Confira o plano atual, faca upgrade ou downgrade.' end;

    insert into public.alertas_assinatura (empresa_id, tipo, titulo, mensagem, chave_unica)
    values (registro.id, v_tipo, 'Assinatura do Sistema OS', v_mensagem, v_chave)
    on conflict (chave_unica) do nothing;
    if found then v_total := v_total + 1; end if;

    if length(regexp_replace(coalesce(registro.contato_cobranca_whatsapp, ''), '[^0-9]', '', 'g')) between 10 and 15 then
      insert into public.fila_whatsapp (
        empresa_id, origem, destinatario, template_nome, parametros, mensagem_fallback, chave_unica
      ) values (
        registro.id, 'assinatura', regexp_replace(registro.contato_cobranca_whatsapp, '[^0-9]', '', 'g'),
        case when v_tipo = 'vencida' then 'sistemaos_assinatura_vencida' else 'sistemaos_lembrete_assinatura' end,
        jsonb_build_object('empresa', registro.nome_fantasia, 'plano', coalesce(registro.plano_nome, 'Atual'), 'vencimento', to_char(registro.data_vencimento at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')),
        v_mensagem,
        'whatsapp:' || v_chave
      ) on conflict (chave_unica) do nothing;
    end if;
  end loop;
  return v_total;
end;
$$;

alter table public.integracoes_plataforma enable row level security;
alter table public.integracoes_plataforma_segredos enable row level security;
alter table public.cobrancas_assinatura enable row level security;
alter table public.alertas_assinatura enable row level security;
alter table public.fila_whatsapp enable row level security;
alter table public.configuracoes_fiscais enable row level security;
alter table public.notas_fiscais enable row level security;

create policy integracoes_plataforma_select_admin_geral on public.integracoes_plataforma
  for select to authenticated using (app_private.eh_administrador_geral());
create policy cobrancas_assinatura_select_empresa on public.cobrancas_assinatura
  for select to authenticated using (empresa_id = app_private.current_profile_empresa_id());
create policy cobrancas_assinatura_select_global on public.cobrancas_assinatura
  for select to authenticated using (app_private.eh_administrador_global());
create policy alertas_assinatura_select_empresa on public.alertas_assinatura
  for select to authenticated using (empresa_id = app_private.current_profile_empresa_id());
create policy alertas_assinatura_update_empresa on public.alertas_assinatura
  for update to authenticated using (empresa_id = app_private.current_profile_empresa_id())
  with check (empresa_id = app_private.current_profile_empresa_id());
create policy configuracoes_fiscais_select_empresa on public.configuracoes_fiscais
  for select to authenticated using (empresa_id = app_private.current_profile_empresa_id());
create policy notas_fiscais_select_empresa on public.notas_fiscais
  for select to authenticated using (empresa_id = app_private.current_profile_empresa_id());

-- Clientes autenticados precisam ver o catalogo inclusive quando a licenca
-- venceu, para escolher e pagar um plano. Escrita continua somente no backend.
create policy planos_select_catalogo on public.planos
  for select to authenticated using (ativo and excluido_em is null);
create policy recursos_select_catalogo on public.recursos
  for select to authenticated using (true);
create policy plano_recursos_select_catalogo on public.plano_recursos
  for select to authenticated using (
    exists (select 1 from public.planos p where p.id = plano_id and p.ativo and p.excluido_em is null)
  );

grant execute on function app_private.current_profile_empresa_id() to authenticated;
grant execute on function app_private.eh_administrador_geral() to authenticated;
revoke all on function public.aplicar_pagamento_assinatura(uuid, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_pagamento_assinatura(uuid, text, timestamptz, text, jsonb) to service_role;
revoke all on function public.gerar_alertas_assinatura(timestamptz) from public, anon, authenticated;
grant execute on function public.gerar_alertas_assinatura(timestamptz) to service_role;

-- O alerta e 100% server-side; nao depende de Electron ou Android abertos.
create extension if not exists pg_cron with schema extensions;
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'sistemaos-alertas-assinatura';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'sistemaos-alertas-assinatura',
    '17 */6 * * *',
    $cron$select public.gerar_alertas_assinatura();$cron$
  );
exception when undefined_table or insufficient_privilege then
  raise notice 'pg_cron indisponivel neste ambiente; configure o job no Supabase Cron.';
end $$;

comment on table public.integracoes_plataforma is 'Integracoes centrais do SaaS. Segredos ficam cifrados na tabela privada separada.';
comment on table public.cobrancas_assinatura is 'Checkout, status e idempotencia das assinaturas do Sistema OS.';
comment on table public.fila_whatsapp is 'Outbox server-side para WhatsApp Cloud API com tentativas e deduplicacao.';
comment on table public.notas_fiscais is 'Fila e historico fiscal; autorizacao real exige credenciais/certificado do emissor.';
