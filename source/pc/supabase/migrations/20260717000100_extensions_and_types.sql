-- Etapa 2: tipos compartilhados e schema privado para funções de segurança.
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

do $$ begin
  create type public.modo_armazenamento as enum ('economico', 'nuvem');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.licenca_status as enum ('ativa', 'teste', 'bloqueada', 'vencida');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.dispositivo_tipo as enum ('desktop', 'android');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entidade_tipo as enum (
    'ordem_servico', 'garantia', 'entrega', 'compra', 'venda', 'cliente'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.disponibilidade_arquivo as enum (
    'local', 'miniatura_nuvem', 'completa_nuvem', 'local_e_nuvem',
    'legado_cloudinary', 'indisponivel'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.operacao_sync as enum ('insert', 'update', 'delete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.status_sync as enum (
    'pendente', 'enviando', 'concluido', 'conflito', 'erro'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.entrega_status as enum (
    'pendente_assinatura', 'concluida', 'cancelada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.garantia_status as enum ('ativa', 'expirada', 'cancelada');
exception when duplicate_object then null; end $$;
