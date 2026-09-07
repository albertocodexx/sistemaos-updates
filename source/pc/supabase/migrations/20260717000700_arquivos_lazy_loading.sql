-- Etapa 6: metadados idempotentes, arquivos privados sob demanda e pedidos
-- para o desktop no modo economico. Binarios/Base64 nunca entram no Postgres.

alter table public.arquivos
  add column if not exists idempotency_key text;

create unique index if not exists arquivos_empresa_idempotency_uidx
  on public.arquivos (empresa_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.solicitacoes_arquivo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  arquivo_id uuid not null,
  usuario_id uuid not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'disponibilizado', 'indisponivel', 'erro', 'expirado')),
  solicitado_em timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '5 minutes'),
  respondido_em timestamptz,
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, id),
  foreign key (empresa_id, arquivo_id)
    references public.arquivos(empresa_id, id) on delete cascade,
  foreign key (empresa_id, usuario_id)
    references public.perfis(empresa_id, id) on delete cascade
);

create index if not exists solicitacoes_arquivo_pendentes_idx
  on public.solicitacoes_arquivo (empresa_id, status, solicitado_em)
  where status = 'pendente';

drop trigger if exists trg_solicitacoes_arquivo_updated_at on public.solicitacoes_arquivo;
create trigger trg_solicitacoes_arquivo_updated_at
before update on public.solicitacoes_arquivo
for each row execute function app_private.set_updated_at();

create or replace function public.registrar_arquivo(
  p_entidade_tipo public.entidade_tipo,
  p_entidade_id uuid,
  p_idempotency_key text,
  p_dados jsonb,
  p_origem_dispositivo_id uuid default null
)
returns public.arquivos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_modo public.modo_armazenamento;
  v_arquivo public.arquivos;
  v_disponibilidade public.disponibilidade_arquivo;
  v_bucket text;
  v_miniatura_path text;
  v_arquivo_nuvem_path text;
  v_arquivo_local_id text;
  v_legacy_url text;
begin
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'sessao, empresa ou licenca invalida';
  end if;
  if p_entidade_tipo = 'ordem_servico' and not (
    app_private.tem_permissao('os', 'criar') or app_private.tem_permissao('os', 'editar')
  ) then
    raise exception using errcode = '42501', message = 'sem permissao para registrar arquivo da OS';
  end if;
  if p_entidade_tipo <> 'ordem_servico' then
    raise exception using errcode = '0A000', message = 'upload deste modulo sera habilitado apos adaptar o Electron';
  end if;
  if p_entidade_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'entidade e idempotency_key sao obrigatorios';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception using errcode = '22023', message = 'metadados devem ser um objeto JSON';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_dados) as chave
     where lower(chave) not in (
       'categoria', 'nome_arquivo', 'mime_type', 'tamanho_bytes', 'largura', 'altura',
       'storage_bucket', 'miniatura_path', 'arquivo_nuvem_path', 'arquivo_local_id',
       'legacy_cloudinary_url', 'disponibilidade', 'checksum_sha256'
     )
  ) then
    raise exception using errcode = '42501', message = 'metadados contem campo protegido, desconhecido ou conteudo binario';
  end if;

  select a.* into v_arquivo
    from public.arquivos a
   where a.empresa_id = v_empresa_id
     and a.idempotency_key = btrim(p_idempotency_key);
  if found then return v_arquivo; end if;

  if p_origem_dispositivo_id is not null and not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id
       and d.id = p_origem_dispositivo_id
       and d.usuario_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'dispositivo de origem invalido';
  end if;

  select e.modo_armazenamento into v_modo
    from public.empresas e where e.id = v_empresa_id;

  begin
    if nullif(btrim(p_dados->>'disponibilidade'), '') is null then
      raise exception using errcode = '22023', message = 'disponibilidade de arquivo obrigatoria';
    end if;
    v_disponibilidade := (p_dados->>'disponibilidade')::public.disponibilidade_arquivo;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'disponibilidade de arquivo invalida';
  end;
  v_bucket := nullif(btrim(p_dados->>'storage_bucket'), '');
  v_miniatura_path := nullif(btrim(p_dados->>'miniatura_path'), '');
  v_arquivo_nuvem_path := nullif(btrim(p_dados->>'arquivo_nuvem_path'), '');
  v_arquivo_local_id := nullif(btrim(p_dados->>'arquivo_local_id'), '');
  v_legacy_url := nullif(btrim(p_dados->>'legacy_cloudinary_url'), '');

  if v_disponibilidade in ('completa_nuvem', 'local_e_nuvem') and v_modo <> 'nuvem' then
    raise exception using errcode = '42501', message = 'arquivo completo na nuvem nao permitido no modo economico';
  end if;
  if v_bucket is not null and v_bucket not in ('arquivos-os', 'documentos-pdf') then
    raise exception using errcode = '22023', message = 'bucket de arquivo invalido';
  end if;
  if (v_bucket is null) <> (v_arquivo_nuvem_path is null) then
    raise exception using errcode = '22023', message = 'bucket e caminho do arquivo devem ser informados juntos';
  end if;
  if v_miniatura_path is not null and split_part(ltrim(v_miniatura_path, '/'), '/', 1) <> v_empresa_id::text then
    raise exception using errcode = '42501', message = 'miniatura fora do prefixo da empresa';
  end if;
  if v_arquivo_nuvem_path is not null and split_part(ltrim(v_arquivo_nuvem_path, '/'), '/', 1) <> v_empresa_id::text then
    raise exception using errcode = '42501', message = 'arquivo fora do prefixo da empresa';
  end if;
  if v_legacy_url is not null and v_legacy_url !~* '^https://res[.]cloudinary[.]com/' then
    raise exception using errcode = '22023', message = 'URL legada do Cloudinary invalida';
  end if;
  if v_arquivo_local_id is not null and not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id
       and d.id = p_origem_dispositivo_id
       and d.usuario_id = auth.uid()
       and d.tipo = 'desktop'
  ) then
    raise exception using errcode = '42501', message = 'arquivo local exige dispositivo desktop autenticado';
  end if;

  insert into public.arquivos (
    empresa_id, entidade_tipo, entidade_id, categoria, nome_arquivo, mime_type,
    tamanho_bytes, largura, altura, storage_bucket, miniatura_path,
    arquivo_nuvem_path, arquivo_local_id, legacy_cloudinary_url,
    disponibilidade, checksum_sha256, origem_dispositivo_id, idempotency_key
  ) values (
    v_empresa_id, p_entidade_tipo, p_entidade_id,
    coalesce(nullif(btrim(p_dados->>'categoria'), ''), 'arquivo'),
    coalesce(nullif(btrim(p_dados->>'nome_arquivo'), ''), 'arquivo'),
    coalesce(nullif(btrim(p_dados->>'mime_type'), ''), 'application/octet-stream'),
    nullif(p_dados->>'tamanho_bytes', '')::bigint,
    nullif(p_dados->>'largura', '')::integer,
    nullif(p_dados->>'altura', '')::integer,
    v_bucket, v_miniatura_path, v_arquivo_nuvem_path, v_arquivo_local_id,
    v_legacy_url, v_disponibilidade,
    nullif(btrim(p_dados->>'checksum_sha256'), ''),
    p_origem_dispositivo_id, btrim(p_idempotency_key)
  ) returning * into v_arquivo;

  return v_arquivo;
exception
  when unique_violation then
    select a.* into v_arquivo
      from public.arquivos a
     where a.empresa_id = v_empresa_id
       and a.idempotency_key = btrim(p_idempotency_key);
    if found then return v_arquivo; end if;
    raise;
end
$$;

create or replace function public.solicitar_arquivo_local(p_arquivo_id uuid)
returns public.solicitacoes_arquivo
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_arquivo public.arquivos;
  v_solicitacao public.solicitacoes_arquivo;
begin
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'sessao, empresa ou licenca invalida';
  end if;
  select a.* into v_arquivo from public.arquivos a
   where a.id = p_arquivo_id and a.empresa_id = v_empresa_id and a.deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'arquivo nao encontrado'; end if;
  if v_arquivo.disponibilidade not in ('local', 'local_e_nuvem') or v_arquivo.arquivo_local_id is null then
    raise exception using errcode = '22023', message = 'arquivo nao depende do desktop';
  end if;
  if not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id and d.tipo = 'desktop'
       and d.ultimo_acesso >= now() - interval '90 seconds'
  ) then
    raise exception using errcode = 'P0001', message = 'desktop_offline';
  end if;

  select s.* into v_solicitacao from public.solicitacoes_arquivo s
   where s.empresa_id = v_empresa_id and s.arquivo_id = p_arquivo_id
     and s.usuario_id = auth.uid() and s.status = 'pendente' and s.expira_em > now()
   order by s.solicitado_em desc limit 1;
  if found then return v_solicitacao; end if;

  insert into public.solicitacoes_arquivo (empresa_id, arquivo_id, usuario_id)
  values (v_empresa_id, p_arquivo_id, auth.uid())
  returning * into v_solicitacao;
  return v_solicitacao;
end
$$;

alter table public.solicitacoes_arquivo enable row level security;
alter table public.solicitacoes_arquivo force row level security;
revoke all on table public.solicitacoes_arquivo from public, anon, authenticated;
grant select on table public.solicitacoes_arquivo to authenticated;

drop policy if exists solicitacoes_arquivo_select_propria on public.solicitacoes_arquivo;
drop policy if exists solicitacoes_arquivo_select_empresa on public.solicitacoes_arquivo;
create policy solicitacoes_arquivo_select_empresa on public.solicitacoes_arquivo
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
);

revoke all on function public.registrar_arquivo(public.entidade_tipo, uuid, text, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.solicitar_arquivo_local(uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_arquivo(public.entidade_tipo, uuid, text, jsonb, uuid)
  to authenticated;
grant execute on function public.solicitar_arquivo_local(uuid)
  to authenticated;

comment on table public.solicitacoes_arquivo is
  'Pedidos sob demanda para arquivos que existem somente no desktop; o Electron responde na Etapa 7.';
comment on function public.registrar_arquivo(public.entidade_tipo, uuid, text, jsonb, uuid) is
  'Registra somente metadados/localizadores idempotentes; rejeita Base64 e deriva empresa da sessao.';
