-- Trial comercial definitivo: 45 dias, todos os recursos e bloqueio sem
-- periodo de graca. Tambem endurece privacidade, rastreabilidade e retencao
-- dos chamados de suporte.

create extension if not exists pgcrypto with schema extensions;

update public.planos
set descricao = 'Teste completo do Sistema OS por 45 dias, com acesso a todas as funcionalidades.',
    duracao_dias = 45,
    limites = jsonb_build_object(
      'usuarios', 10,
      'dispositivos', 15,
      'storage_bytes', 10737418240,
      'trial_dias', 45
    ),
    ativo = true,
    updated_at = now()
where lower(nome) = 'trial';

-- Todo recurso presente ou adicionado no futuro da instalacao desta migration
-- fica habilitado no Trial. Limites de capacidade continuam definidos acima.
insert into public.plano_recursos (plano_id, recurso_id, habilitado, limite)
select p.id, r.id, true, null
from public.planos p
cross join public.recursos r
where lower(p.nome) = 'trial'
on conflict (plano_id, recurso_id) do update
set habilitado = true,
    limite = null;

with trial_config as (
  select p.id,
         jsonb_object_agg(r.chave, true) as recursos
  from public.planos p
  cross join public.recursos r
  where lower(p.nome) = 'trial'
  group by p.id
)
update public.empresas e
set fim_trial = case when e.inicio_trial is not null then e.inicio_trial + interval '45 days' else e.fim_trial end,
    limite_usuarios = 10,
    limite_dispositivos = 15,
    limite_storage = 10737418240,
    recursos_habilitados = coalesce(e.recursos_habilitados, '{}'::jsonb)
      || t.recursos
      || jsonb_build_object('fiscal_habilitado', true, 'troca_rapida_contas', true),
    updated_at = now()
from trial_config t
where e.plano_id = t.id;

-- Trial termina exatamente no vencimento. Contas pagas preservam as regras
-- comerciais proprias de periodo de graca.
update public.empresas e
set periodo_graca_ate = null,
    updated_at = now()
from public.planos p
where e.plano_id = p.id
  and lower(p.nome) = 'trial'
  and e.periodo_graca_ate is not null;

alter table public.chamados_suporte
  add column if not exists aberto_por uuid references auth.users(id) on delete set null,
  add column if not exists token_hash text,
  add column if not exists motivo text,
  add column if not exists motivo_outro text,
  add column if not exists telefone_contato text,
  add column if not exists email_contato text,
  add column if not exists preferencia_contato text,
  add column if not exists cargo_empresa text,
  add column if not exists cargo_outro text,
  add column if not exists detalhes_contato jsonb not null default '{}'::jsonb,
  add column if not exists excluido_em timestamptz,
  add column if not exists excluido_por uuid references auth.users(id) on delete set null;

alter table public.chamados_suporte drop constraint if exists chamados_suporte_mensagem_check;
alter table public.chamados_suporte
  add constraint chamados_suporte_mensagem_check
  check (char_length(btrim(mensagem)) between 10 and 8000);

-- Migra tokens antigos para SHA-256 sem invalidar links ja enviados. Chamados
-- novos gravam somente o hash; o campo legado pode ser limpo separadamente
-- depois que todos os chamados antigos forem encerrados.
update public.chamados_suporte
set token_hash = encode(extensions.digest(public_token::text, 'sha256'), 'hex')
where public_token is not null
  and token_hash is null;

alter table public.chamados_suporte alter column public_token drop default;
alter table public.chamados_suporte alter column public_token drop not null;

create unique index if not exists chamados_suporte_token_hash_uidx
  on public.chamados_suporte (token_hash)
  where token_hash is not null;
create index if not exists chamados_suporte_aberto_por_idx
  on public.chamados_suporte (aberto_por, ultima_mensagem_em desc)
  where excluido_em is null;

do $$ begin
  alter table public.chamados_suporte
    add constraint chamados_suporte_token_hash_check
    check (token_hash is null or token_hash ~ '^[a-f0-9]{64}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.chamados_suporte
    add constraint chamados_suporte_motivo_check
    check (motivo is null or motivo in (
      'trial_assinatura','cobranca_pagamento','acesso_login','sincronizacao_backup',
      'documento_assinatura','erro_sistema','configuracao_integracao',
      'duvida_funcionalidade','sugestao','outro'
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.chamados_suporte
    add constraint chamados_suporte_preferencia_contato_check
    check (preferencia_contato is null or preferencia_contato in ('whatsapp','ligacao','email'));
exception when duplicate_object then null; end $$;

-- O suporte publico recebe no maximo cinco aberturas por empresa+usuario+rede
-- a cada hora. A chave e irreversivel e nao armazena o endereco de rede.
create table if not exists public.chamados_suporte_rate_limit (
  chave_hash text primary key check (chave_hash ~ '^[a-f0-9]{64}$'),
  janela_inicio timestamptz not null default now(),
  tentativas integer not null default 1 check (tentativas > 0),
  atualizado_em timestamptz not null default now()
);
alter table public.chamados_suporte_rate_limit enable row level security;
revoke all on public.chamados_suporte_rate_limit from anon, authenticated;

create or replace function public.registrar_limite_chamado_publico(
  p_chave_hash text,
  p_limite integer default 5,
  p_janela_minutos integer default 60
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tentativas integer;
begin
  if p_chave_hash !~ '^[a-f0-9]{64}$'
     or p_limite < 1 or p_limite > 20
     or p_janela_minutos < 1 or p_janela_minutos > 1440 then
    return false;
  end if;

  insert into public.chamados_suporte_rate_limit
    (chave_hash, janela_inicio, tentativas, atualizado_em)
  values (p_chave_hash, now(), 1, now())
  on conflict (chave_hash) do update
  set tentativas = case
        when chamados_suporte_rate_limit.janela_inicio <= now() - make_interval(mins => p_janela_minutos)
          then 1
        else chamados_suporte_rate_limit.tentativas + 1
      end,
      janela_inicio = case
        when chamados_suporte_rate_limit.janela_inicio <= now() - make_interval(mins => p_janela_minutos)
          then now()
        else chamados_suporte_rate_limit.janela_inicio
      end,
      atualizado_em = now()
  returning tentativas into v_tentativas;

  delete from public.chamados_suporte_rate_limit
  where atualizado_em < now() - interval '7 days';
  return v_tentativas <= p_limite;
end;
$$;
revoke all on function public.registrar_limite_chamado_publico(text, integer, integer) from public, anon, authenticated;
grant execute on function public.registrar_limite_chamado_publico(text, integer, integer) to service_role;

-- A leitura direta respeita autoria. Administradores da empresa podem
-- acompanhar a equipe e o suporte global pode atender todos os chamados.
drop policy if exists chamados_suporte_select_empresa on public.chamados_suporte;
drop policy if exists chamados_suporte_select_seguro on public.chamados_suporte;
create policy chamados_suporte_select_seguro on public.chamados_suporte
  for select to authenticated
  using (
    excluido_em is null
    and (
      aberto_por = auth.uid()
      or app_private.eh_administrador_empresa(empresa_id)
      or app_private.eh_administrador_global()
    )
  );

drop policy if exists chamado_mensagens_select_empresa on public.chamado_mensagens;
drop policy if exists chamado_mensagens_select_seguro on public.chamado_mensagens;
create policy chamado_mensagens_select_seguro on public.chamado_mensagens
  for select to authenticated
  using (exists (
    select 1
    from public.chamados_suporte c
    where c.id = chamado_mensagens.chamado_id
      and c.excluido_em is null
      and (
        c.aberto_por = auth.uid()
        or app_private.eh_administrador_empresa(c.empresa_id)
        or app_private.eh_administrador_global()
      )
  ));

comment on column public.chamados_suporte.token_hash is
  'SHA-256 do token publico. O token original existe somente no aparelho solicitante.';
comment on column public.chamados_suporte.public_token is
  'Compatibilidade temporaria com chamados anteriores; novos registros usam somente token_hash.';
comment on column public.chamados_suporte.aberto_por is
  'Usuario autenticado proprietario do chamado; impede leitura lateral por colegas.';
comment on column public.chamados_suporte.detalhes_contato is
  'Campos estruturados adicionais do atendimento, sem segredos de autenticacao.';
