-- Etapa 7: contrato do Electron offline-first. O desktop preserva números
-- locais novos, mantém arquivos completos locais no modo econômico e responde
-- pedidos pontuais sem receber empresa_id do cliente.

alter table public.arquivos
  add column if not exists arquivo_temporario_expira_em timestamptz;

create index if not exists arquivos_temporarios_expiracao_idx
  on public.arquivos (empresa_id, arquivo_temporario_expira_em)
  where arquivo_temporario_expira_em is not null and deleted_at is null;

create or replace function public.criar_ordem_servico_desktop(
  p_numero text,
  p_id_exportacao text,
  p_dados jsonb,
  p_origem_dispositivo_id uuid
)
returns public.ordens_servico
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_numero text := upper(btrim(p_numero));
  v_sequencial bigint;
  v_os public.ordens_servico;
  v_cliente_nome text;
begin
  if v_empresa_id is null or not app_private.tem_permissao('os', 'criar') then
    raise exception using errcode = '42501', message = 'sem permissão para criar OS';
  end if;
  if v_numero !~ '^OS-[0-9]+$' then
    raise exception using errcode = '22023', message = 'número da OS inválido';
  end if;
  if nullif(btrim(p_id_exportacao), '') is null then
    raise exception using errcode = '22023', message = 'idExportacao é obrigatório';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception using errcode = '22023', message = 'dados da OS devem ser um objeto JSON';
  end if;
  if p_dados ?| array['id','empresa_id','numero','numero_sequencial','revision','created_at','updated_at','deleted_at'] then
    raise exception using errcode = '42501', message = 'dados contêm campo protegido';
  end if;
  if not exists (
    select 1 from public.dispositivos d
     where d.empresa_id = v_empresa_id and d.id = p_origem_dispositivo_id
       and d.usuario_id = auth.uid() and d.tipo = 'desktop'
  ) then
    raise exception using errcode = '42501', message = 'dispositivo desktop inválido';
  end if;

  select o.* into v_os from public.ordens_servico o
   where o.empresa_id = v_empresa_id and o.id_exportacao = btrim(p_id_exportacao);
  if found then return v_os; end if;

  select o.* into v_os from public.ordens_servico o
   where o.empresa_id = v_empresa_id and o.numero = v_numero;
  if found then
    raise exception using errcode = '23505', message = 'conflito_numero: o número já pertence a outra OS';
  end if;

  v_sequencial := substring(v_numero from '[0-9]+$')::bigint;
  if v_sequencial < 1 then
    raise exception using errcode = '22023', message = 'sequencial da OS deve ser positivo';
  end if;
  v_cliente_nome := coalesce(
    nullif(btrim(p_dados->>'cliente_nome_snapshot'), ''),
    nullif(btrim(p_dados #>> '{cliente,nome}'), '')
  );
  if v_cliente_nome is null then
    raise exception using errcode = '23514', message = 'nome do cliente é obrigatório';
  end if;

  insert into public.ordens_servico (
    empresa_id, numero, numero_sequencial, id_exportacao,
    cliente_nome_snapshot, cliente_telefone_snapshot, cliente_cpf_snapshot,
    aparelho, marca, modelo, cor, imei, senha_aparelho, acessorios, estado_aparelho,
    defeito_relatado, diagnostico, servico_realizado, observacoes, termos,
    status, prioridade, valor, forma_pagamento, status_pagamento, garantia_dias,
    data_abertura, data_prevista, hora_prevista, origem, origem_dispositivo_id, dados_extras
  ) values (
    v_empresa_id, v_numero, v_sequencial, btrim(p_id_exportacao),
    v_cliente_nome,
    coalesce(nullif(p_dados->>'cliente_telefone_snapshot', ''), nullif(p_dados #>> '{cliente,telefone}', '')),
    coalesce(nullif(p_dados->>'cliente_cpf_snapshot', ''), nullif(p_dados #>> '{cliente,cpf}', '')),
    nullif(p_dados->>'aparelho', ''), nullif(p_dados->>'marca', ''),
    nullif(p_dados->>'modelo', ''), nullif(p_dados->>'cor', ''),
    nullif(p_dados->>'imei', ''), nullif(p_dados->>'senha_aparelho', ''),
    nullif(p_dados->>'acessorios', ''), nullif(p_dados->>'estado_aparelho', ''),
    coalesce(nullif(p_dados->>'defeito_relatado', ''), 'Não informado'),
    nullif(p_dados->>'diagnostico', ''), nullif(p_dados->>'servico_realizado', ''),
    nullif(p_dados->>'observacoes', ''), nullif(p_dados->>'termos', ''),
    coalesce(nullif(p_dados->>'status', ''), 'Aguardando análise'),
    coalesce(nullif(p_dados->>'prioridade', ''), 'Normal'),
    coalesce(nullif(p_dados->>'valor', '')::numeric, 0),
    nullif(p_dados->>'forma_pagamento', ''), coalesce(p_dados->>'status_pagamento', ''),
    coalesce(nullif(p_dados->>'garantia_dias', '')::integer, 0),
    coalesce(nullif(p_dados->>'data_abertura', '')::timestamptz, now()),
    nullif(p_dados->>'data_prevista', '')::date,
    nullif(p_dados->>'hora_prevista', '')::time,
    'desktop', p_origem_dispositivo_id,
    case when jsonb_typeof(p_dados->'dados_extras') = 'object' then p_dados->'dados_extras' else '{}'::jsonb end
  ) returning * into v_os;

  insert into public.sequencias_documentos as s (empresa_id, tipo, proximo_valor)
  values (v_empresa_id, 'os', v_sequencial + 1)
  on conflict (empresa_id, tipo) do update
    set proximo_valor = greatest(s.proximo_valor, excluded.proximo_valor), updated_at = now();

  return v_os;
exception when unique_violation then
  select o.* into v_os from public.ordens_servico o
   where o.empresa_id = v_empresa_id and o.id_exportacao = btrim(p_id_exportacao);
  if found then return v_os; end if;
  raise;
end
$$;

create or replace function public.responder_solicitacao_arquivo(
  p_solicitacao_id uuid,
  p_storage_bucket text,
  p_arquivo_nuvem_path text,
  p_dispositivo_id uuid,
  p_erro text default null
)
returns public.solicitacoes_arquivo
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_id uuid := app_private.current_user_empresa_id();
  v_solicitacao public.solicitacoes_arquivo;
begin
  if v_empresa_id is null then
    raise exception using errcode = '42501', message = 'sessão, empresa ou licença inválida';
  end if;
  if not exists (
    select 1 from public.dispositivos d where d.empresa_id = v_empresa_id
      and d.id = p_dispositivo_id and d.usuario_id = auth.uid() and d.tipo = 'desktop'
  ) then
    raise exception using errcode = '42501', message = 'dispositivo desktop inválido';
  end if;
  select s.* into v_solicitacao from public.solicitacoes_arquivo s
   where s.id = p_solicitacao_id and s.empresa_id = v_empresa_id and s.status = 'pendente'
   for update;
  if not found then raise exception using errcode = 'P0002', message = 'solicitação pendente não encontrada'; end if;

  if nullif(btrim(p_erro), '') is not null then
    update public.solicitacoes_arquivo set status = 'indisponivel', respondido_em = now(),
      ultimo_erro = left(btrim(p_erro), 500)
     where id = v_solicitacao.id returning * into v_solicitacao;
    return v_solicitacao;
  end if;
  if p_storage_bucket is null or p_storage_bucket not in ('arquivos-os', 'documentos-pdf') then
    raise exception using errcode = '22023', message = 'bucket inválido';
  end if;
  if nullif(btrim(p_arquivo_nuvem_path), '') is null
     or split_part(ltrim(p_arquivo_nuvem_path, '/'), '/', 1) <> v_empresa_id::text then
    raise exception using errcode = '42501', message = 'arquivo fora do prefixo da empresa';
  end if;

  update public.arquivos a set storage_bucket = p_storage_bucket,
    arquivo_nuvem_path = p_arquivo_nuvem_path, disponibilidade = 'local_e_nuvem',
    arquivo_temporario_expira_em = now() + interval '5 minutes'
   where a.id = v_solicitacao.arquivo_id and a.empresa_id = v_empresa_id
     and a.arquivo_local_id is not null and a.deleted_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'arquivo local não encontrado'; end if;

  update public.solicitacoes_arquivo set status = 'disponibilizado', respondido_em = now(),
    expira_em = now() + interval '5 minutes', ultimo_erro = null
   where id = v_solicitacao.id returning * into v_solicitacao;
  return v_solicitacao;
end
$$;

create or replace function public.listar_arquivos_temporarios_expirados(p_dispositivo_id uuid)
returns table (id uuid, storage_bucket text, arquivo_nuvem_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare v_empresa_id uuid := app_private.current_user_empresa_id();
begin
  if v_empresa_id is null or not exists (
    select 1 from public.dispositivos d where d.empresa_id = v_empresa_id
      and d.id = p_dispositivo_id and d.usuario_id = auth.uid() and d.tipo = 'desktop'
  ) then raise exception using errcode = '42501', message = 'dispositivo desktop inválido'; end if;
  return query select a.id, a.storage_bucket, a.arquivo_nuvem_path from public.arquivos a
   where a.empresa_id = v_empresa_id and a.origem_dispositivo_id = p_dispositivo_id
     and a.arquivo_temporario_expira_em <= now() and a.deleted_at is null;
end
$$;

create or replace function public.expirar_arquivo_temporario(p_arquivo_id uuid, p_dispositivo_id uuid)
returns public.arquivos
language plpgsql
security definer
set search_path = ''
as $$
declare v_empresa_id uuid := app_private.current_user_empresa_id(); v_arquivo public.arquivos;
begin
  if v_empresa_id is null or not exists (
    select 1 from public.dispositivos d where d.empresa_id = v_empresa_id
      and d.id = p_dispositivo_id and d.usuario_id = auth.uid() and d.tipo = 'desktop'
  ) then raise exception using errcode = '42501', message = 'dispositivo desktop inválido'; end if;
  update public.arquivos a set storage_bucket = null, arquivo_nuvem_path = null,
    disponibilidade = case when a.miniatura_path is not null then 'local'::public.disponibilidade_arquivo else 'local'::public.disponibilidade_arquivo end,
    arquivo_temporario_expira_em = null
   where a.id = p_arquivo_id and a.empresa_id = v_empresa_id
     and a.origem_dispositivo_id = p_dispositivo_id
     and a.arquivo_temporario_expira_em <= now()
   returning * into v_arquivo;
  if not found then raise exception using errcode = 'P0002', message = 'arquivo temporário não encontrado ou ainda válido'; end if;
  update public.solicitacoes_arquivo set status = 'expirado' where arquivo_id = p_arquivo_id and status = 'disponibilizado';
  return v_arquivo;
end
$$;

revoke all on function public.criar_ordem_servico_desktop(text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.responder_solicitacao_arquivo(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.listar_arquivos_temporarios_expirados(uuid) from public, anon, authenticated;
revoke all on function public.expirar_arquivo_temporario(uuid, uuid) from public, anon, authenticated;
grant execute on function public.criar_ordem_servico_desktop(text, text, jsonb, uuid) to authenticated;
grant execute on function public.responder_solicitacao_arquivo(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.listar_arquivos_temporarios_expirados(uuid) to authenticated;
grant execute on function public.expirar_arquivo_temporario(uuid, uuid) to authenticated;

comment on function public.criar_ordem_servico_desktop(text, text, jsonb, uuid) is
  'Cria idempotentemente uma OS offline do desktop preservando o número local e avançando a sequência da empresa.';
comment on function public.responder_solicitacao_arquivo(uuid, text, text, uuid, text) is
  'Permite ao desktop autenticado disponibilizar temporariamente um arquivo local solicitado pelo APK.';

