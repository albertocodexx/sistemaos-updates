-- Evolucao SaaS: conversa continua nos chamados e catalogo comercial de planos.
-- Migration exclusivamente aditiva: preserva chamados, empresas e planos atuais.

alter table public.chamados_suporte
  add column if not exists public_token uuid not null default gen_random_uuid(),
  add column if not exists assunto text,
  add column if not exists prioridade text not null default 'normal',
  add column if not exists ultima_mensagem_em timestamptz,
  add column if not exists primeira_resposta_em timestamptz,
  add column if not exists encerrado_em timestamptz,
  add column if not exists avaliacao smallint,
  add column if not exists avaliacao_comentario text;

update public.chamados_suporte
set assunto = coalesce(nullif(btrim(assunto), ''), 'Atendimento de suporte'),
    ultima_mensagem_em = coalesce(ultima_mensagem_em, atualizado_em, criado_em)
where assunto is null or ultima_mensagem_em is null;

alter table public.chamados_suporte
  alter column assunto set default 'Atendimento de suporte',
  alter column assunto set not null;

do $$ begin
  alter table public.chamados_suporte
    add constraint chamados_suporte_prioridade_check
    check (prioridade in ('baixa', 'normal', 'alta', 'critica'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.chamados_suporte
    add constraint chamados_suporte_avaliacao_check
    check (avaliacao is null or avaliacao between 1 and 5);
exception when duplicate_object then null; end $$;

create unique index if not exists chamados_suporte_public_token_uidx
  on public.chamados_suporte (public_token);
create index if not exists chamados_suporte_ultima_mensagem_idx
  on public.chamados_suporte (ultima_mensagem_em desc);

create table if not exists public.chamado_mensagens (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.chamados_suporte(id) on delete cascade,
  autor_tipo text not null check (autor_tipo in ('cliente', 'suporte', 'sistema')),
  autor_id uuid references auth.users(id) on delete set null,
  autor_nome text,
  mensagem text not null check (char_length(btrim(mensagem)) between 1 and 8000),
  anexos jsonb not null default '[]'::jsonb check (jsonb_typeof(anexos) = 'array'),
  visualizado_cliente_em timestamptz,
  visualizado_suporte_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists chamado_mensagens_chamado_criado_idx
  on public.chamado_mensagens (chamado_id, criado_em);

-- Converte o texto original dos chamados existentes na primeira mensagem.
insert into public.chamado_mensagens (chamado_id, autor_tipo, autor_nome, mensagem, criado_em)
select c.id, 'cliente', coalesce(c.contato_nome, c.contato_usuario, 'Cliente'), c.mensagem, c.criado_em
from public.chamados_suporte c
where not exists (
  select 1 from public.chamado_mensagens m where m.chamado_id = c.id
);

insert into public.chamado_mensagens (chamado_id, autor_tipo, autor_id, autor_nome, mensagem, criado_em)
select c.id, 'suporte', c.atendido_por, 'Suporte Sistema OS', c.resolucao, c.atualizado_em
from public.chamados_suporte c
where nullif(btrim(c.resolucao), '') is not null
  and not exists (
    select 1 from public.chamado_mensagens m
    where m.chamado_id = c.id and m.autor_tipo = 'suporte' and m.mensagem = c.resolucao
  );

alter table public.chamado_mensagens enable row level security;

drop policy if exists chamados_suporte_select_empresa on public.chamados_suporte;
create policy chamados_suporte_select_empresa on public.chamados_suporte
  for select to authenticated
  using (
    empresa_id = app_private.current_user_empresa_id()
    or app_private.eh_administrador_global()
  );

drop policy if exists chamado_mensagens_select_empresa on public.chamado_mensagens;
create policy chamado_mensagens_select_empresa on public.chamado_mensagens
  for select to authenticated
  using (exists (
    select 1 from public.chamados_suporte c
    where c.id = chamado_mensagens.chamado_id
      and (
        c.empresa_id = app_private.current_user_empresa_id()
        or app_private.eh_administrador_global()
      )
  ));

grant select on public.chamados_suporte, public.chamado_mensagens to authenticated;

-- Habilita eventos de novos textos/status para clientes autenticados e suporte.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chamados_suporte'
  ) then
    alter publication supabase_realtime add table public.chamados_suporte;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chamado_mensagens'
  ) then
    alter publication supabase_realtime add table public.chamado_mensagens;
  end if;
end $$;

-- Recursos comerciais reutilizados pelo checklist do painel global.
insert into public.recursos (chave, nome, descricao) values
  ('ordens_servico', 'Ordens de servico', 'Criacao, edicao, PDF e historico de OS.'),
  ('clientes', 'Clientes', 'Cadastro, pesquisa e historico de clientes.'),
  ('estoque', 'Estoque', 'Aparelhos, pecas e movimentacoes.'),
  ('compras_vendas', 'Compras e vendas', 'Contratos, estoque e documentos comerciais.'),
  ('financeiro', 'Financeiro', 'Receitas, despesas e pagamentos.'),
  ('relatorios', 'Relatorios', 'Indicadores e exportacoes gerenciais.'),
  ('whatsapp', 'WhatsApp', 'Mensagens, autorizacoes e avisos automaticos.'),
  ('inteligencia_artificial', 'Inteligencia artificial', 'Classificacao e assistente Groq.'),
  ('mercado_pago', 'Mercado Pago', 'Links e acompanhamento de pagamentos.'),
  ('aplicativo_android', 'Aplicativo Android', 'Uso do APK e sincronizacao movel.'),
  ('multiusuario', 'Multiusuario', 'Usuarios, cargos e permissoes.'),
  ('backup', 'Backup', 'Backup, exportacao e restauracao.'),
  ('suporte_prioritario', 'Suporte prioritario', 'Fila prioritaria e SLA comercial.')
on conflict (chave) do update
set nome = excluded.nome, descricao = excluded.descricao;

insert into public.planos (nome, descricao, ativo, preco_referencia, periodo, limites) values
  ('Trial', 'Avaliacao completa por 30 dias.', true, 0, 'mensal',
    '{"usuarios":2,"dispositivos":2,"storage_bytes":1073741824,"trial_dias":30}'::jsonb),
  ('Basico', 'Operacao essencial para pequenas assistencias.', true, 79.90, 'mensal',
    '{"usuarios":3,"dispositivos":3,"storage_bytes":2147483648}'::jsonb),
  ('Profissional', 'Gestao completa para equipes em crescimento.', true, 149.90, 'mensal',
    '{"usuarios":5,"dispositivos":6,"storage_bytes":10737418240}'::jsonb),
  ('Premium', 'Automacoes, IA e integracoes para operacoes avancadas.', true, 249.90, 'mensal',
    '{"usuarios":10,"dispositivos":12,"storage_bytes":26843545600}'::jsonb),
  ('Empresarial', 'Estrutura ampliada para redes e equipes maiores.', true, 449.90, 'mensal',
    '{"usuarios":20,"dispositivos":30,"storage_bytes":107374182400}'::jsonb)
on conflict (lower(nome)) do update
set descricao = excluded.descricao,
    ativo = excluded.ativo,
    preco_referencia = excluded.preco_referencia,
    periodo = excluded.periodo,
    limites = excluded.limites,
    updated_at = now();

-- Matriz padrao. O administrador global pode personaliza-la no painel.
with matriz(plano, recurso) as (values
  ('Trial','ordens_servico'),('Trial','clientes'),('Trial','estoque'),('Trial','compras_vendas'),
  ('Trial','financeiro'),('Trial','relatorios'),('Trial','whatsapp'),('Trial','inteligencia_artificial'),
  ('Trial','mercado_pago'),('Trial','aplicativo_android'),('Trial','multiusuario'),('Trial','backup'),
  ('Basico','ordens_servico'),('Basico','clientes'),('Basico','estoque'),('Basico','compras_vendas'),
  ('Basico','financeiro'),('Basico','aplicativo_android'),('Basico','multiusuario'),('Basico','backup'),
  ('Profissional','ordens_servico'),('Profissional','clientes'),('Profissional','estoque'),('Profissional','compras_vendas'),
  ('Profissional','financeiro'),('Profissional','relatorios'),('Profissional','whatsapp'),
  ('Profissional','aplicativo_android'),('Profissional','multiusuario'),('Profissional','backup'),
  ('Premium','ordens_servico'),('Premium','clientes'),('Premium','estoque'),('Premium','compras_vendas'),
  ('Premium','financeiro'),('Premium','relatorios'),('Premium','whatsapp'),('Premium','inteligencia_artificial'),
  ('Premium','mercado_pago'),('Premium','aplicativo_android'),('Premium','multiusuario'),('Premium','backup'),('Premium','suporte_prioritario'),
  ('Empresarial','ordens_servico'),('Empresarial','clientes'),('Empresarial','estoque'),('Empresarial','compras_vendas'),
  ('Empresarial','financeiro'),('Empresarial','relatorios'),('Empresarial','whatsapp'),('Empresarial','inteligencia_artificial'),
  ('Empresarial','mercado_pago'),('Empresarial','aplicativo_android'),('Empresarial','multiusuario'),('Empresarial','backup'),('Empresarial','suporte_prioritario')
)
insert into public.plano_recursos (plano_id, recurso_id, habilitado)
select p.id, r.id, true
from matriz m
join public.planos p on lower(p.nome) = lower(m.plano)
join public.recursos r on r.chave = m.recurso
on conflict (plano_id, recurso_id) do update set habilitado = excluded.habilitado;

-- Empresas sem plano recebem Trial sem tocar nas contas globais de suporte.
update public.empresas e
set plano_id = p.id,
    limite_usuarios = coalesce(e.limite_usuarios, (p.limites->>'usuarios')::integer),
    limite_dispositivos = coalesce(e.limite_dispositivos, (p.limites->>'dispositivos')::integer),
    limite_storage = coalesce(e.limite_storage, (p.limites->>'storage_bytes')::bigint)
from public.planos p
where lower(p.nome) = 'trial'
  and e.plano_id is null
  and not exists (
    select 1 from public.perfis pf
    join public.administradores_globais ag on ag.usuario_id = pf.id and ag.ativo
    where pf.empresa_id = e.id
  );

-- Remove apenas as flags de runtime legadas; URLs antigas nos registros de
-- arquivos continuam preservadas para leitura/migracao historica.
update public.configuracoes_empresa
set feature_flags = (coalesce(feature_flags, '{}'::jsonb)
  - 'cloudProvider' - 'fileProvider' - 'firebaseAtivo' - 'cloudinaryAtivo')
  || '{"supabaseAtivo":true,"storageProvider":"supabase-storage"}'::jsonb;

-- O limite comercial vale para qualquer caminho de criacao/reativacao, nao
-- apenas para a tela do suporte. Usuarios inativos nao consomem uma vaga.
create or replace function public.validar_limite_usuarios_empresa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limite integer;
  v_ativos integer;
begin
  if not new.ativo then return new; end if;
  select limite_usuarios into v_limite from public.empresas where id = new.empresa_id;
  if v_limite is null or v_limite = 0 then return new; end if;
  select count(*) into v_ativos
  from public.perfis p
  where p.empresa_id = new.empresa_id
    and p.ativo
    and p.id <> new.id;
  if v_ativos >= v_limite then
    raise exception 'O plano desta empresa permite no maximo % usuario(s) ativo(s).', v_limite
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists perfis_validar_limite_usuarios on public.perfis;
create trigger perfis_validar_limite_usuarios
before insert or update of ativo, empresa_id on public.perfis
for each row execute function public.validar_limite_usuarios_empresa();
