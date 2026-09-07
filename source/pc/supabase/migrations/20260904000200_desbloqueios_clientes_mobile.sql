-- Autorizações de desbloqueio bidirecionais e ID público numérico do cliente.
-- Toda escrita passa por RPC SECURITY DEFINER e permanece isolada por empresa.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.clientes add column if not exists numero_cliente bigint;

-- Reaproveita o ID já presente na OS do PC quando não há colisão.
with existentes as (
  select distinct on (o.empresa_id,o.cliente_id) o.empresa_id,o.cliente_id,
    (o.dados_extras->>'cliente_id_numero')::bigint as numero
  from public.ordens_servico o
  where o.dados_extras->>'cliente_id_numero' ~ '^[1-9][0-9]{4,8}$'
  order by o.empresa_id,o.cliente_id,o.updated_at desc
), unicos as (
  select *,count(*) over(partition by empresa_id,numero) as repeticoes from existentes
)
update public.clientes c set numero_cliente=u.numero from unicos u
where c.id=u.cliente_id and c.empresa_id=u.empresa_id and c.numero_cliente is null
  and u.repeticoes=1 and not exists(select 1 from public.clientes outro where outro.empresa_id=c.empresa_id and outro.numero_cliente=u.numero);

with numerados as (
  select c.id,c.empresa_id,
    greatest(9999,coalesce((select max(x.numero_cliente) from public.clientes x where x.empresa_id=c.empresa_id),9999))
      + row_number() over (partition by c.empresa_id order by c.created_at,c.id) as numero
  from public.clientes c where c.numero_cliente is null
)
update public.clientes c
set numero_cliente = n.numero
from numerados n
where c.id = n.id and c.empresa_id = n.empresa_id;

alter table public.clientes drop constraint if exists clientes_numero_cliente_check;
alter table public.clientes add constraint clientes_numero_cliente_check
  check (numero_cliente is null or numero_cliente >= 10000);
create unique index if not exists clientes_empresa_numero_cliente_uidx
  on public.clientes(empresa_id, numero_cliente)
  where numero_cliente is not null and deleted_at is null;

alter table public.sequencias_documentos drop constraint if exists sequencias_documentos_tipo_check;
alter table public.sequencias_documentos add constraint sequencias_documentos_tipo_check
  check (tipo in ('os', 'compra', 'venda', 'cliente', 'desbloqueio'));

insert into public.sequencias_documentos(empresa_id, tipo, proximo_valor)
select e.id, 'cliente', greatest(10000, coalesce(max(c.numero_cliente) + 1, 10000))
from public.empresas e left join public.clientes c on c.empresa_id = e.id
group by e.id
on conflict (empresa_id, tipo) do update
set proximo_valor = greatest(public.sequencias_documentos.proximo_valor, excluded.proximo_valor), updated_at = now();

create table if not exists public.desbloqueios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  numero text not null check (numero ~ '^DES-[0-9]+$'),
  numero_sequencial bigint not null check (numero_sequencial > 0),
  cliente_id uuid not null,
  cliente_numero_snapshot bigint not null check (cliente_numero_snapshot >= 10000),
  cliente_nome_snapshot text not null check (btrim(cliente_nome_snapshot) <> ''),
  cliente_telefone_snapshot text,
  cliente_cpf_snapshot text,
  marca text not null check (btrim(marca) <> ''),
  modelo text not null check (btrim(modelo) <> ''),
  cor text,
  imei text,
  tipo_bloqueio text not null check (btrim(tipo_bloqueio) <> ''),
  procedimento_previsto text,
  observacoes text,
  valor numeric(14,2) not null default 0 check (valor >= 0),
  declaracao_titularidade boolean not null default true,
  assinatura_estado text not null default 'nao_assinado'
    check (assinatura_estado in ('assinado', 'aguardando', 'nao_assinado')),
  -- A assinatura é uma imagem pequena, privada por RLS, necessária para o
  -- mesmo PDF poder ser refeito nos dois aparelhos. Limite evita abuso.
  assinatura_cliente_base64 text check (
    assinatura_cliente_base64 is null or char_length(assinatura_cliente_base64) <= 1400000
  ),
  id_envio_assinatura text,
  origem text not null default 'android' check (origem in ('desktop', 'android')),
  id_exportacao text,
  revision bigint not null default 1 check (revision > 0),
  criado_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empresa_id, id),
  unique (empresa_id, numero),
  unique (empresa_id, numero_sequencial),
  foreign key (empresa_id, cliente_id) references public.clientes(empresa_id, id) on delete restrict
);

create index if not exists desbloqueios_empresa_cliente_idx
  on public.desbloqueios(empresa_id, cliente_id, updated_at desc) where deleted_at is null;
create index if not exists desbloqueios_empresa_nome_idx
  on public.desbloqueios(empresa_id, cliente_nome_snapshot, updated_at desc) where deleted_at is null;
create unique index if not exists desbloqueios_empresa_exportacao_uidx
  on public.desbloqueios(empresa_id,id_exportacao) where id_exportacao is not null;

alter table public.desbloqueios enable row level security;
alter table public.desbloqueios force row level security;
revoke all on table public.desbloqueios from public, anon, authenticated;
grant select on table public.desbloqueios to authenticated;

drop policy if exists desbloqueios_select_empresa on public.desbloqueios;
create policy desbloqueios_select_empresa on public.desbloqueios
for select to authenticated
using (
  app_private.pode_acessar_empresa(empresa_id)
  and app_private.tem_permissao('os', 'ler')
);

create or replace function public.salvar_desbloqueio(p_id uuid, p_revision bigint, p_dados jsonb)
returns public.desbloqueios
language plpgsql security definer
set search_path = ''
as $$
declare
  v_empresa uuid := app_private.current_user_empresa_id();
  v_cliente public.clientes;
  v_reg public.desbloqueios;
  v_nome text := nullif(btrim(p_dados #>> '{cliente,nome}'), '');
  v_telefone text := nullif(btrim(p_dados #>> '{cliente,telefone}'), '');
  v_cpf text := nullif(regexp_replace(coalesce(p_dados #>> '{cliente,cpf}', ''), '\D', '', 'g'), '');
  v_cliente_id uuid := nullif(p_dados #>> '{cliente,id}', '')::uuid;
  v_cliente_numero bigint;
  v_seq bigint;
  v_preferido bigint;
  v_estado text := coalesce(nullif(p_dados->>'assinaturaEstado', ''), 'nao_assinado');
begin
  if v_empresa is null or app_private.tem_permissao('os', case when p_id is null then 'criar' else 'editar' end) is distinct from true then
    raise exception using errcode = '42501', message = 'Sem permissão para salvar autorizações.';
  end if;
  if p_dados is null or jsonb_typeof(p_dados)<>'object' or octet_length(p_dados::text)>1600000 then
    raise exception using errcode='23514',message='Dados da autorização inválidos.';
  end if;
  if p_dados->>'declaracaoTitularidade' is distinct from 'true' then
    raise exception using errcode='23514',message='Confirme a declaração de titularidade.';
  end if;
  if v_estado='assinado' and coalesce(p_dados->>'assinaturaClienteBase64','') !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception using errcode='23514',message='Assinatura inválida.';
  end if;
  if v_estado<>'assinado' then p_dados:=p_dados-'assinaturaClienteBase64'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_empresa::text||':desbloqueio',0));
  if p_id is not null then
    select * into v_reg from public.desbloqueios where id=p_id and empresa_id=v_empresa for update;
    if v_reg.id is null or v_reg.deleted_at is not null or p_revision is null or v_reg.revision<>p_revision then
      raise exception using errcode='40001',message='A autorização mudou ou foi excluída. Atualize antes de editar.';
    end if;
  elsif nullif(p_dados->>'idExportacao','') is not null then
    select * into v_reg from public.desbloqueios where empresa_id=v_empresa and id_exportacao=p_dados->>'idExportacao';
    if v_reg.deleted_at is not null then raise exception using errcode='40001',message='Esta autorização já foi excluída.'; end if;
    if v_reg.id is not null then return v_reg; end if;
  end if;
  if v_nome is null then raise exception using errcode = '23514', message = 'Informe o nome do cliente.'; end if;
  if v_cpf is not null and char_length(v_cpf) <> 11 then raise exception using errcode = '23514', message = 'CPF inválido.'; end if;
  if nullif(btrim(p_dados #>> '{aparelho,marca}'), '') is null or nullif(btrim(p_dados #>> '{aparelho,modelo}'), '') is null then
    raise exception using errcode = '23514', message = 'Informe marca e modelo do aparelho.';
  end if;
  if nullif(btrim(p_dados->>'tipoBloqueio'), '') is null then raise exception using errcode = '23514', message = 'Informe o tipo de bloqueio.'; end if;
  if v_estado not in ('assinado','aguardando','nao_assinado') then raise exception using errcode = '23514', message = 'Estado de assinatura inválido.'; end if;

  if v_cliente_id is not null then
    select * into v_cliente from public.clientes where empresa_id=v_empresa and id=v_cliente_id and deleted_at is null;
    if v_cliente.id is null then raise exception using errcode='42501',message='Cliente indisponível para esta empresa.'; end if;
  end if;
  if v_cliente.id is null and v_cpf is not null then
    select * into v_cliente from public.clientes where empresa_id=v_empresa and cpf=v_cpf and deleted_at is null limit 1;
  end if;
  if v_cliente.id is null then
    select * into v_cliente from public.clientes
    where empresa_id=v_empresa and lower(btrim(nome))=lower(v_nome) and deleted_at is null
      and (cpf is null or v_cpf is null or cpf=v_cpf)
    order by updated_at desc limit 1;
  end if;

  if v_cliente.id is null then
    insert into public.sequencias_documentos as s(empresa_id,tipo,proximo_valor)
      values(v_empresa,'cliente',10001)
    on conflict(empresa_id,tipo) do update
      set proximo_valor=greatest(s.proximo_valor,10000)+1, updated_at=now()
    returning proximo_valor-1 into v_cliente_numero;
    insert into public.clientes(empresa_id,nome,telefone,cpf,numero_cliente,id_exportacao,dados_extras)
      values(v_empresa,v_nome,v_telefone,v_cpf,v_cliente_numero,
        'desbloqueio-cliente:'||v_cliente_numero,
        jsonb_build_object('cliente_id_numero',v_cliente_numero,'origem','desbloqueio'))
      returning * into v_cliente;
  else
    v_cliente_numero := v_cliente.numero_cliente;
    if v_cliente_numero is null then
      insert into public.sequencias_documentos as s(empresa_id,tipo,proximo_valor)
        values(v_empresa,'cliente',10001)
      on conflict(empresa_id,tipo) do update
        set proximo_valor=greatest(s.proximo_valor,10000)+1, updated_at=now()
      returning proximo_valor-1 into v_cliente_numero;
    end if;
    -- Criar uma autorização não concede permissão implícita para reescrever
    -- o cadastro de um cliente existente. Os dados do documento são snapshots.
    update public.clientes set
      nome=case when app_private.tem_permissao('clientes','editar') is true then v_nome else nome end,
      telefone=case when app_private.tem_permissao('clientes','editar') is true then coalesce(v_telefone,telefone) else telefone end,
      cpf=case when app_private.tem_permissao('clientes','editar') is true then coalesce(v_cpf,cpf) else cpf end,
      numero_cliente=v_cliente_numero,
      dados_extras=coalesce(dados_extras,'{}'::jsonb)||jsonb_build_object('cliente_id_numero',v_cliente_numero),
      revision=revision+1,updated_at=now()
    where id=v_cliente.id and empresa_id=v_empresa returning * into v_cliente;
  end if;

  if p_id is null then
    if p_dados->>'origem'='desktop' and p_dados->>'numero' ~ '^DES-[0-9]{1,9}$' then
      v_preferido:=substring(p_dados->>'numero' from 5)::bigint;
      if v_preferido<1 or exists(select 1 from public.desbloqueios where empresa_id=v_empresa and numero_sequencial=v_preferido) then v_preferido:=null; end if;
    end if;
    insert into public.sequencias_documentos as s(empresa_id,tipo,proximo_valor)
      values(v_empresa,'desbloqueio',coalesce(v_preferido,1)+1)
    on conflict(empresa_id,tipo) do update
      set proximo_valor=greatest(s.proximo_valor+1,coalesce(v_preferido,0)+1),updated_at=now()
    returning proximo_valor-1 into v_seq;
    v_seq:=coalesce(v_preferido,v_seq);
    insert into public.desbloqueios(
      empresa_id,numero,numero_sequencial,cliente_id,cliente_numero_snapshot,
      cliente_nome_snapshot,cliente_telefone_snapshot,cliente_cpf_snapshot,
      marca,modelo,cor,imei,tipo_bloqueio,procedimento_previsto,observacoes,valor,
      declaracao_titularidade,assinatura_estado,assinatura_cliente_base64,
      id_envio_assinatura,origem,id_exportacao,criado_por
    ) values (
      v_empresa,'DES-'||lpad(v_seq::text,4,'0'),v_seq,v_cliente.id,v_cliente.numero_cliente,
      v_nome,v_telefone,v_cpf,
      btrim(p_dados #>> '{aparelho,marca}'),btrim(p_dados #>> '{aparelho,modelo}'),
      nullif(btrim(p_dados #>> '{aparelho,cor}'),''),nullif(btrim(p_dados #>> '{aparelho,imei}'),''),
      btrim(p_dados->>'tipoBloqueio'),nullif(btrim(p_dados->>'procedimentoPrevisto'),''),
      nullif(btrim(p_dados->>'observacoes'),''),greatest(0,coalesce((p_dados->>'valor')::numeric,0)),true,
      v_estado,nullif(p_dados->>'assinaturaClienteBase64',''),nullif(p_dados->>'idEnvioAssinatura',''),
      case when p_dados->>'origem'='desktop' then 'desktop' else 'android' end,
      nullif(p_dados->>'idExportacao',''),auth.uid()
    ) returning * into v_reg;
  else
    update public.desbloqueios set
      cliente_id=v_cliente.id,cliente_numero_snapshot=v_cliente.numero_cliente,
      cliente_nome_snapshot=v_nome,cliente_telefone_snapshot=v_telefone,
      cliente_cpf_snapshot=v_cpf,marca=btrim(p_dados #>> '{aparelho,marca}'),
      modelo=btrim(p_dados #>> '{aparelho,modelo}'),cor=nullif(btrim(p_dados #>> '{aparelho,cor}'),''),
      imei=nullif(btrim(p_dados #>> '{aparelho,imei}'),''),tipo_bloqueio=btrim(p_dados->>'tipoBloqueio'),
      procedimento_previsto=nullif(btrim(p_dados->>'procedimentoPrevisto'),''),
      observacoes=nullif(btrim(p_dados->>'observacoes'),''),valor=greatest(0,coalesce((p_dados->>'valor')::numeric,0)),
      assinatura_estado=v_estado,assinatura_cliente_base64=nullif(p_dados->>'assinaturaClienteBase64',''),
      id_envio_assinatura=coalesce(nullif(p_dados->>'idEnvioAssinatura',''),id_envio_assinatura),
      revision=revision+1,updated_at=now()
    where id=p_id and empresa_id=v_empresa and deleted_at is null and revision=coalesce(p_revision,revision)
    returning * into v_reg;
    if v_reg.id is null then raise exception using errcode='40001',message='A autorização mudou em outro aparelho. Atualize e tente novamente.'; end if;
  end if;
  return v_reg;
end;
$$;

create or replace function public.excluir_desbloqueio(p_id uuid, p_revision bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_empresa uuid:=app_private.current_user_empresa_id(); v_total integer; v_reg public.desbloqueios;
begin
  if v_empresa is null or app_private.tem_permissao('os','excluir') is distinct from true then
    raise exception using errcode='42501',message='Sem permissão para excluir autorizações.';
  end if;
  select * into v_reg from public.desbloqueios where id=p_id and empresa_id=v_empresa for update;
  if v_reg.id is null then return false; end if;
  if v_reg.deleted_at is not null then return true; end if;
  if p_revision is null or p_revision<>v_reg.revision then return false; end if;
  if v_reg.id_envio_assinatura is not null then
    perform public.cancelar_solicitacao_assinatura_remota(v_reg.id_envio_assinatura);
  end if;
  update public.desbloqueios set deleted_at=now(),revision=revision+1,updated_at=now(),assinatura_cliente_base64=null
    where id=p_id and empresa_id=v_empresa and deleted_at is null and revision=p_revision;
  get diagnostics v_total=row_count;
  return v_total=1;
end;
$$;

create or replace function public.buscar_cliente_documentos(p_termo text)
returns jsonb language sql security invoker set search_path='' stable as $$
with busca as (
  select btrim(coalesce(p_termo,'')) as texto,
         regexp_replace(coalesce(p_termo,''),'\D','','g') as digitos
), encontrados as (
  select c.* from public.clientes c
  cross join busca b
  where c.empresa_id=app_private.current_user_empresa_id() and c.deleted_at is null
    and app_private.tem_permissao('clientes','ler')
    and b.texto <> ''
    and (c.nome ilike '%'||b.texto||'%'
      or (b.digitos <> '' and (
        regexp_replace(coalesce(c.cpf,''),'\D','','g') like '%'||b.digitos||'%'
        or regexp_replace(coalesce(c.telefone,''),'\D','','g') like '%'||b.digitos||'%'
        or c.numero_cliente::text=b.digitos
      )))
  order by c.updated_at desc limit 20
)
select coalesce(jsonb_agg(jsonb_build_object(
  'id',c.id,'clienteId',c.numero_cliente,'nome',c.nome,'telefone',c.telefone,'cpf',c.cpf,'email',c.email,
  'ordens',(select coalesce(jsonb_agg(to_jsonb(o) order by o.updated_at desc),'[]'::jsonb) from public.vw_ordens_servico_leve o where o.cliente_id=c.id),
  'garantias',(select coalesce(jsonb_agg(to_jsonb(g) order by g.updated_at desc),'[]'::jsonb) from public.vw_garantias_leve g join public.ordens_servico o on o.id=g.ordem_servico_id and o.empresa_id=g.empresa_id where o.cliente_id=c.id),
  'entregas',(select coalesce(jsonb_agg(to_jsonb(e) order by e.updated_at desc),'[]'::jsonb) from public.vw_entregas_leve e join public.ordens_servico o on o.id=e.ordem_servico_id and o.empresa_id=e.empresa_id where o.cliente_id=c.id),
  'vendas',(select coalesce(jsonb_agg(to_jsonb(v) order by v.updated_at desc),'[]'::jsonb) from public.vw_vendas_leve v where v.cliente_id=c.id),
  'compras',(select coalesce(jsonb_agg(to_jsonb(cp) order by cp.updated_at desc),'[]'::jsonb) from public.vw_compras_leve cp where cp.empresa_id=c.empresa_id and lower(btrim(cp.fornecedor_nome))=lower(btrim(c.nome))),
  'desbloqueios',(select coalesce(jsonb_agg(to_jsonb(d)-'assinatura_cliente_base64' order by d.updated_at desc),'[]'::jsonb) from public.desbloqueios d where d.empresa_id=c.empresa_id and d.cliente_id=c.id and d.deleted_at is null)
)),'[]'::jsonb) from encontrados c;
$$;

revoke all on function public.salvar_desbloqueio(uuid,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.excluir_desbloqueio(uuid,bigint) from public,anon,authenticated;
revoke all on function public.buscar_cliente_documentos(text) from public,anon,authenticated;
grant execute on function public.salvar_desbloqueio(uuid,bigint,jsonb) to authenticated;
grant execute on function public.excluir_desbloqueio(uuid,bigint) to authenticated;
grant execute on function public.buscar_cliente_documentos(text) to authenticated;

comment on table public.desbloqueios is 'Autorizações de desbloqueio sincronizadas entre PC e Android.';
comment on function public.buscar_cliente_documentos(text) is 'Busca clientes por nome/ID/contato e reúne os documentos associados da empresa atual.';
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='desbloqueios') then
    alter publication supabase_realtime add table public.desbloqueios;
  end if;
end $$;
commit;
