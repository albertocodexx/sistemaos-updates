-- Contas rapidas sao opt-in por empresa. O cliente guarda apenas sessoes
-- criptografadas no dispositivo; nenhuma senha e persistida no Supabase.
create or replace function public.configurar_troca_rapida_contas(p_ativa boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_recursos jsonb;
begin
  if v_empresa_id is null or not app_private.eh_administrador_empresa(v_empresa_id) then
    raise exception using errcode = '42501', message = 'somente o administrador da empresa pode alterar a troca rapida de contas';
  end if;

  update public.empresas
     set recursos_habilitados = jsonb_set(
       coalesce(recursos_habilitados, '{}'::jsonb),
       '{troca_rapida_contas}',
       to_jsonb(coalesce(p_ativa, false)),
       true
     ),
     updated_at = now()
   where id = v_empresa_id
   returning recursos_habilitados into v_recursos;

  insert into public.auditoria_comercial
    (empresa_id, autor_id, acao, entidade, entidade_id, metadados)
  values
    (v_empresa_id, auth.uid(), 'troca_rapida_contas_configurada', 'empresa',
     v_empresa_id::text, jsonb_build_object('ativa', coalesce(p_ativa, false)));

  return v_recursos;
end;
$$;

revoke all on function public.configurar_troca_rapida_contas(boolean) from public, anon;
grant execute on function public.configurar_troca_rapida_contas(boolean) to authenticated;

-- PDF de OS e documento atual, nao uma colecao. Antes de inserir uma nova
-- versao, as anteriores deixam de aparecer nas consultas e no APK.
create or replace function app_private.manter_apenas_pdf_atual()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.entidade_tipo = 'ordem_servico'
     and (lower(coalesce(new.categoria, '')) = 'pdf' or lower(coalesce(new.mime_type, '')) = 'application/pdf') then
    update public.arquivos
       set deleted_at = now(), updated_at = now()
     where empresa_id = new.empresa_id
       and entidade_tipo = new.entidade_tipo
       and entidade_id = new.entidade_id
       and deleted_at is null
       and (lower(coalesce(categoria, '')) = 'pdf' or lower(coalesce(mime_type, '')) = 'application/pdf');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_arquivos_pdf_atual on public.arquivos;
create trigger trg_arquivos_pdf_atual
before insert on public.arquivos
for each row execute function app_private.manter_apenas_pdf_atual();

with PDFs_ordenados as (
  select id, row_number() over (
    partition by empresa_id, entidade_tipo, entidade_id
    order by created_at desc, id desc
  ) as posicao
  from public.arquivos
  where deleted_at is null and entidade_tipo = 'ordem_servico'
    and (lower(coalesce(categoria, '')) = 'pdf' or lower(coalesce(mime_type, '')) = 'application/pdf')
)
update public.arquivos a
set deleted_at = now(), updated_at = now()
from PDFs_ordenados p
where a.id = p.id and p.posicao > 1;

-- Exclusao definitiva e propositalmente restrita ao suporte global. Antes
-- da remocao, um resumo imutavel e gravado sem FK para a empresa apagada.
create table if not exists public.auditoria_empresas_excluidas (
  id uuid primary key default gen_random_uuid(),
  empresa_id_original uuid not null,
  empresa_codigo text not null,
  empresa_nome text not null,
  excluida_por uuid not null references auth.users(id) on delete restrict,
  motivo text not null,
  resumo jsonb not null default '{}'::jsonb check (jsonb_typeof(resumo) = 'object'),
  excluida_em timestamptz not null default now()
);

alter table public.auditoria_empresas_excluidas enable row level security;
drop policy if exists auditoria_empresas_excluidas_select_global on public.auditoria_empresas_excluidas;
create policy auditoria_empresas_excluidas_select_global
  on public.auditoria_empresas_excluidas for select to authenticated
  using (app_private.eh_administrador_global());
revoke all on table public.auditoria_empresas_excluidas from public, anon, authenticated;
grant select on table public.auditoria_empresas_excluidas to authenticated;

-- Cargos do time central sao independentes dos cargos internos das empresas.
alter table public.administradores_globais
  add column if not exists papel text not null default 'suporte',
  add column if not exists senha_exclusao_hash text,
  add column if not exists tentativas_senha_exclusao integer not null default 0,
  add column if not exists senha_exclusao_bloqueada_ate timestamptz;

do $$ begin
  alter table public.administradores_globais
    add constraint administradores_globais_papel_check
    check (papel in ('suporte', 'gerente_suporte', 'administrador_geral'));
exception when duplicate_object then null; end $$;

create or replace function app_private.papel_suporte_atual()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((
    select g.papel from public.administradores_globais g
    where g.usuario_id = auth.uid() and g.ativo
  ), '')
$$;

create or replace function app_private.eh_administrador_geral()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select app_private.papel_suporte_atual() = 'administrador_geral'
$$;

create or replace function public.obter_papel_suporte()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$ select app_private.papel_suporte_atual() $$;

revoke all on function public.obter_papel_suporte() from public, anon;
grant execute on function public.obter_papel_suporte() to authenticated;

-- Promove somente a identidade de suporte solicitada. Se ela ainda nao
-- existir, a instrucao nao cria usuario artificial nem afeta empresas.
insert into public.administradores_globais (usuario_id, nome, papel, ativo)
select i.usuario_id, coalesce(p.nome, 'Alberto'), 'administrador_geral', true
from public.identidades_login i
join public.empresas e on e.id = i.empresa_id
left join public.perfis p on p.id = i.usuario_id
where lower(e.codigo) = 'suporte' and lower(i.usuario) = 'alberto'
on conflict (usuario_id) do update
set papel = 'administrador_geral', ativo = true, updated_at = now();

create table if not exists public.solicitacoes_exclusao (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('usuario', 'empresa')),
  empresa_id uuid references public.empresas(id) on delete set null,
  empresa_codigo text not null,
  alvo_id uuid,
  alvo_rotulo text not null,
  motivo text not null check (char_length(btrim(motivo)) between 5 and 1000),
  solicitada_por uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'negada', 'executada', 'falhou')),
  decidida_por uuid references auth.users(id) on delete set null,
  decisao_observacao text,
  decidida_em timestamptz,
  executada_em timestamptz,
  erro_execucao text,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

create index if not exists solicitacoes_exclusao_status_criada_idx
  on public.solicitacoes_exclusao (status, criada_em desc);
alter table public.solicitacoes_exclusao enable row level security;
drop policy if exists solicitacoes_exclusao_select_suporte on public.solicitacoes_exclusao;
create policy solicitacoes_exclusao_select_suporte
  on public.solicitacoes_exclusao for select to authenticated
  using (app_private.eh_administrador_global());
revoke all on table public.solicitacoes_exclusao from public, anon, authenticated;
grant select on table public.solicitacoes_exclusao to authenticated;

create or replace function public.definir_senha_exclusao_suporte(p_senha text)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not app_private.eh_administrador_geral() then
    raise exception using errcode = '42501', message = 'somente o administrador geral pode definir a senha de exclusao';
  end if;
  if char_length(coalesce(p_senha, '')) < 8 then
    raise exception using errcode = '22023', message = 'a senha de exclusao precisa ter pelo menos 8 caracteres';
  end if;
  update public.administradores_globais
     set senha_exclusao_hash = crypt(p_senha, gen_salt('bf', 12)),
         tentativas_senha_exclusao = 0,
         senha_exclusao_bloqueada_ate = null,
         updated_at = now()
   where usuario_id = auth.uid();
  return true;
end;
$$;

create or replace function public.criar_solicitacao_exclusao(
  p_tipo text,
  p_empresa_id uuid,
  p_alvo_id uuid,
  p_alvo_rotulo text,
  p_motivo text
)
returns public.solicitacoes_exclusao
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_empresa public.empresas%rowtype;
  v_resultado public.solicitacoes_exclusao%rowtype;
begin
  if not app_private.eh_administrador_global() then
    raise exception using errcode = '42501', message = 'acao restrita ao suporte';
  end if;
  if p_tipo not in ('usuario', 'empresa') then
    raise exception using errcode = '22023', message = 'tipo de exclusao invalido';
  end if;
  select * into v_empresa from public.empresas where id = p_empresa_id;
  if not found then raise exception using errcode = 'P0002', message = 'empresa nao encontrada'; end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception using errcode = '22023', message = 'informe o motivo da exclusao';
  end if;
  if exists (
    select 1 from public.solicitacoes_exclusao s
    where s.status = 'pendente' and s.tipo = p_tipo
      and s.empresa_id = p_empresa_id and s.alvo_id is not distinct from p_alvo_id
  ) then
    raise exception using errcode = '23505', message = 'ja existe uma solicitacao pendente para este item';
  end if;
  insert into public.solicitacoes_exclusao
    (tipo, empresa_id, empresa_codigo, alvo_id, alvo_rotulo, motivo, solicitada_por)
  values
    (p_tipo, p_empresa_id, v_empresa.codigo, p_alvo_id,
     coalesce(nullif(btrim(p_alvo_rotulo), ''), v_empresa.nome_fantasia),
     btrim(p_motivo), auth.uid())
  returning * into v_resultado;
  return v_resultado;
end;
$$;

create or replace function public.decidir_solicitacao_exclusao(
  p_solicitacao_id uuid,
  p_aprovar boolean,
  p_senha text,
  p_observacao text default null
)
returns public.solicitacoes_exclusao
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_admin public.administradores_globais%rowtype;
  v_resultado public.solicitacoes_exclusao%rowtype;
  v_tentativas integer;
begin
  if not app_private.eh_administrador_geral() then
    raise exception using errcode = '42501', message = 'somente o administrador geral pode decidir exclusoes';
  end if;
  select * into v_admin from public.administradores_globais
  where usuario_id = auth.uid() for update;
  if v_admin.senha_exclusao_hash is null then
    raise exception using errcode = '22023', message = 'defina primeiro a senha administrativa de exclusao';
  end if;
  if v_admin.senha_exclusao_bloqueada_ate is not null and v_admin.senha_exclusao_bloqueada_ate > now() then
    raise exception using errcode = '42501', message = 'senha de exclusao temporariamente bloqueada por excesso de tentativas';
  end if;
  if crypt(coalesce(p_senha, ''), v_admin.senha_exclusao_hash) <> v_admin.senha_exclusao_hash then
    v_tentativas := v_admin.tentativas_senha_exclusao + 1;
    update public.administradores_globais
       set tentativas_senha_exclusao = case when v_tentativas >= 5 then 0 else v_tentativas end,
           senha_exclusao_bloqueada_ate = case when v_tentativas >= 5 then now() + interval '15 minutes' else null end,
           updated_at = now()
     where usuario_id = auth.uid();
    raise exception using errcode = '28P01', message = 'senha administrativa de exclusao incorreta';
  end if;
  update public.administradores_globais
     set tentativas_senha_exclusao = 0, senha_exclusao_bloqueada_ate = null, updated_at = now()
   where usuario_id = auth.uid();
  update public.solicitacoes_exclusao
     set status = case when p_aprovar then 'aprovada' else 'negada' end,
         decidida_por = auth.uid(), decisao_observacao = nullif(btrim(p_observacao), ''),
         decidida_em = now(), atualizada_em = now()
   where id = p_solicitacao_id and status = 'pendente'
   returning * into v_resultado;
  if not found then
    raise exception using errcode = 'P0002', message = 'solicitacao pendente nao encontrada';
  end if;
  return v_resultado;
end;
$$;

revoke all on function public.definir_senha_exclusao_suporte(text) from public, anon;
revoke all on function public.criar_solicitacao_exclusao(text, uuid, uuid, text, text) from public, anon;
revoke all on function public.decidir_solicitacao_exclusao(uuid, boolean, text, text) from public, anon;
grant execute on function public.definir_senha_exclusao_suporte(text) to authenticated;
grant execute on function public.criar_solicitacao_exclusao(text, uuid, uuid, text, text) to authenticated;
grant execute on function public.decidir_solicitacao_exclusao(uuid, boolean, text, text) to authenticated;

create or replace function public.excluir_empresa_definitivamente(
  p_empresa_id uuid,
  p_codigo_confirmacao text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_empresa public.empresas%rowtype;
  v_usuarios uuid[];
  v_resumo jsonb;
begin
  if not app_private.eh_administrador_geral() then
    raise exception using errcode = '42501', message = 'acao restrita ao administrador geral';
  end if;

  select * into v_empresa from public.empresas where id = p_empresa_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'empresa nao encontrada';
  end if;
  if lower(btrim(coalesce(p_codigo_confirmacao, ''))) <> lower(v_empresa.codigo) then
    raise exception using errcode = '22023', message = 'codigo de confirmacao incorreto';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception using errcode = '22023', message = 'informe um motivo para a exclusao';
  end if;
  if exists (
    select 1 from public.perfis p
    join public.administradores_globais g on g.usuario_id = p.id and g.ativo
    where p.empresa_id = p_empresa_id
  ) then
    raise exception using errcode = '42501', message = 'a empresa vinculada ao suporte global nao pode ser excluida';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_usuarios
  from public.perfis where empresa_id = p_empresa_id;

  select jsonb_build_object(
    'empresa', to_jsonb(v_empresa),
    'usuarios', (select count(*) from public.perfis where empresa_id = p_empresa_id),
    'ordens_servico', (select count(*) from public.ordens_servico where empresa_id = p_empresa_id),
    'clientes', (select count(*) from public.clientes where empresa_id = p_empresa_id),
    'vendas', (select count(*) from public.vendas where empresa_id = p_empresa_id),
    'compras', (select count(*) from public.compras where empresa_id = p_empresa_id),
    'arquivos', (select count(*) from public.arquivos where empresa_id = p_empresa_id)
  ) into v_resumo;

  insert into public.auditoria_empresas_excluidas
    (empresa_id_original, empresa_codigo, empresa_nome, excluida_por, motivo, resumo)
  values
    (v_empresa.id, v_empresa.codigo, v_empresa.nome_fantasia, auth.uid(), btrim(p_motivo), v_resumo);

  -- Ordem explicita para respeitar FKs RESTRICT do contrato multiempresa.
  delete from public.solicitacoes_arquivo where empresa_id = p_empresa_id;
  delete from public.backups_empresa where empresa_id = p_empresa_id;
  delete from public.arquivos where empresa_id = p_empresa_id;
  delete from public.garantias where empresa_id = p_empresa_id;
  delete from public.entregas where empresa_id = p_empresa_id;
  delete from public.vendas where empresa_id = p_empresa_id;
  delete from public.compras where empresa_id = p_empresa_id;
  delete from public.ordens_servico where empresa_id = p_empresa_id;
  delete from public.clientes where empresa_id = p_empresa_id;
  delete from public.operacoes_sincronizacao where empresa_id = p_empresa_id;
  delete from public.pagamentos_assinatura where empresa_id = p_empresa_id;
  delete from public.integracoes_empresa where empresa_id = p_empresa_id;
  delete from public.dispositivos_empresa where empresa_id = p_empresa_id;
  delete from public.dispositivos where empresa_id = p_empresa_id;
  delete from public.migracoes_legado where empresa_id = p_empresa_id;
  delete from public.identidades_login where empresa_id = p_empresa_id;
  delete from public.eventos_licenca where empresa_id = p_empresa_id;
  delete from public.sequencias_documentos where empresa_id = p_empresa_id;
  delete from public.configuracoes_empresa where empresa_id = p_empresa_id;
  delete from public.perfis where empresa_id = p_empresa_id;
  delete from public.empresas where id = p_empresa_id;

  return jsonb_build_object(
    'sucesso', true,
    'empresaId', p_empresa_id,
    'codigo', v_empresa.codigo,
    'usuariosAuth', to_jsonb(v_usuarios),
    'resumo', v_resumo
  );
end;
$$;

revoke all on function public.excluir_empresa_definitivamente(uuid, text, text) from public, anon;
grant execute on function public.excluir_empresa_definitivamente(uuid, text, text) to authenticated;
