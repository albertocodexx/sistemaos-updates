-- Impede que uma versao antiga do PC ou Android grave um formato que nao
-- compreende. Atualizacoes continuam sendo distribuidas pelo GitHub, mas o
-- banco tambem aplica o limite para clientes que ja estavam abertos.

alter table public.versoes_aplicativo
  add column if not exists schema_minimo integer not null default 1
    check (schema_minimo between 1 and 100000),
  add column if not exists mensagem_atualizacao text;

create or replace function app_private.versao_semantica_inferior(p_atual text, p_minima text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  a integer[] := array[0, 0, 0];
  b integer[] := array[0, 0, 0];
  i integer;
begin
  if coalesce(p_minima, '') = '' then return false; end if;
  if coalesce(p_atual, '') !~ '^\d+\.\d+\.\d+$' then return true; end if;
  if p_minima !~ '^\d+\.\d+\.\d+$' then return true; end if;
  for i in 1..3 loop
    a[i] := split_part(p_atual, '.', i)::integer;
    b[i] := split_part(p_minima, '.', i)::integer;
    if a[i] < b[i] then return true; end if;
    if a[i] > b[i] then return false; end if;
  end loop;
  return false;
end;
$$;

create or replace function public.verificar_compatibilidade_aplicativo(
  p_plataforma text,
  p_versao text,
  p_schema integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app_private, auth
as $$
declare
  v public.versoes_aplicativo%rowtype;
  v_compativel boolean;
begin
  if auth.uid() is null then raise exception 'Sessao invalida.'; end if;
  if p_plataforma not in ('windows', 'android') then raise exception 'Plataforma invalida.'; end if;
  select * into v from public.versoes_aplicativo where plataforma = p_plataforma;
  if not found then
    return jsonb_build_object('compativel', true, 'plataforma', p_plataforma,
      'versao_atual', p_versao, 'schema_atual', p_schema);
  end if;
  v_compativel := not v.obrigatoria or (
    not app_private.versao_semantica_inferior(p_versao, v.versao_minima)
    and coalesce(p_schema, 0) >= v.schema_minimo
  );
  return jsonb_build_object(
    'compativel', v_compativel,
    'plataforma', p_plataforma,
    'versao_atual', p_versao,
    'versao_minima', v.versao_minima,
    'versao_publicada', v.versao_atual,
    'schema_atual', coalesce(p_schema, 0),
    'schema_minimo', v.schema_minimo,
    'obrigatoria', v.obrigatoria,
    'url_atualizacao', v.url_atualizacao,
    'mensagem', coalesce(v.mensagem_atualizacao,
      'Atualizacao obrigatoria. Instale a versao mais recente para continuar com seguranca.')
  );
end;
$$;

revoke all on function public.verificar_compatibilidade_aplicativo(text, text, integer) from public, anon;
grant execute on function public.verificar_compatibilidade_aplicativo(text, text, integer) to authenticated;

create or replace function app_private.bloquear_cliente_desatualizado()
returns trigger
language plpgsql
security definer
set search_path = public, app_private, auth
as $$
declare
  v_headers jsonb := '{}'::jsonb;
  v_info text := '';
  v_partes text[];
  v_plataforma text;
  v_versao text;
  v_schema integer := 0;
  v_regra public.versoes_aplicativo%rowtype;
begin
  if coalesce(auth.role(), '') = 'service_role' or auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;
  v_info := coalesce(v_headers ->> 'x-client-info', '');

  if v_info = 'sistema-os-electron-stage7' then
    v_plataforma := 'windows';
  elsif v_info = 'sistema-os-android-etapa3' then
    v_plataforma := 'android';
  elsif v_info ~ '^sistema-os/(windows|android)/\d+\.\d+\.\d+/schema/\d+$' then
    v_partes := regexp_match(v_info,
      '^sistema-os/(windows|android)/(\d+\.\d+\.\d+)/schema/(\d+)$');
    v_plataforma := v_partes[1];
    v_versao := v_partes[2];
    v_schema := v_partes[3]::integer;
  else
    -- Integracoes externas autenticadas nao sao declaradas como Sistema OS e
    -- continuam submetidas a RLS/permissoes normais.
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select * into v_regra from public.versoes_aplicativo where plataforma = v_plataforma;
  if found and v_regra.obrigatoria and (
    app_private.versao_semantica_inferior(v_versao, v_regra.versao_minima)
    or v_schema < v_regra.schema_minimo
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ATUALIZACAO_OBRIGATORIA',
      detail = coalesce(v_regra.mensagem_atualizacao,
        'Instale a versao mais recente antes de sincronizar alteracoes. A fila local foi preservada.');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array[
    'arquivos','backups_empresa','clientes','compras','configuracoes_empresa',
    'desbloqueios','dispositivos_empresa','entregas','estoque_itens',
    'exclusoes_os_pendentes','garantias','ordens_servico','relatorios_erros',
    'solicitacoes_arquivo','solicitacoes_assinatura_remota','tabela_precos','vendas'
  ] loop
    if to_regclass('public.' || v_tabela) is not null then
      execute format('drop trigger if exists trg_compatibilidade_cliente on public.%I', v_tabela);
      execute format(
        'create trigger trg_compatibilidade_cliente before insert or update or delete on public.%I for each row execute function app_private.bloquear_cliente_desatualizado()',
        v_tabela
      );
    end if;
  end loop;
end;
$$;

insert into public.versoes_aplicativo
  (plataforma, versao_minima, versao_atual, url_atualizacao, obrigatoria,
   publicada_em, updated_at, schema_minimo, mensagem_atualizacao)
values
  ('windows', '40.5.24', '40.5.24',
   'https://github.com/albertocodexx/sistemaos-updates/releases/latest', true,
   now(), now(), 10,
   'Atualize o Sistema OS no Windows. Seus dados e alteracoes pendentes serao preservados.'),
  ('android', '20.5.23', '20.5.23',
   'https://github.com/albertocodexx/sistemaos-updates/releases/latest', true,
   now(), now(), 10,
   'Atualize o aplicativo no celular. Seus rascunhos e envios pendentes serao preservados.')
on conflict (plataforma) do update set
  versao_minima = excluded.versao_minima,
  versao_atual = excluded.versao_atual,
  url_atualizacao = excluded.url_atualizacao,
  obrigatoria = excluded.obrigatoria,
  publicada_em = excluded.publicada_em,
  updated_at = excluded.updated_at,
  schema_minimo = excluded.schema_minimo,
  mensagem_atualizacao = excluded.mensagem_atualizacao;
