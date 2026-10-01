-- Emitente da plataforma separado dos clientes. Nenhuma chave ou A1 é salvo aqui.
create table public.configuracoes_fiscais_plataforma (
  empresa_id uuid primary key default '00000000-0000-4000-8000-000000000001'
    check (empresa_id = '00000000-0000-4000-8000-000000000001'),
  provedor text not null default 'nfeio', ambiente text not null default 'homologacao',
  status text not null default 'nao_configurada',
  emissao_automatica_os boolean not null default false,
  emissao_automatica_venda boolean not null default false,
  emissao_automatica_assinatura boolean not null default true,
  metadados jsonb not null default '{}'::jsonb,
  ultimo_erro text, updated_at timestamptz not null default now()
);
alter table public.configuracoes_fiscais_plataforma enable row level security;
revoke all on public.configuracoes_fiscais_plataforma from anon, authenticated;
grant all on public.configuracoes_fiscais_plataforma to service_role;

create table public.notas_fiscais_assinatura (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  cobranca_id uuid not null unique references public.cobrancas_assinatura(id) on delete restrict,
  valor numeric(12,2) not null check (valor > 0),
  descricao text not null,
  status text not null default 'aguardando_configuracao' check
    (status in ('aguardando_configuracao','na_fila','processando','autorizada','rejeitada','cancelada')),
  provedor text not null default 'nfeio', referencia_provedor text,
  numero text, codigo_verificacao text,
  danfse_storage_path text, danfse_gerado_em timestamptz, emitida_em timestamptz,
  payload jsonb not null default '{}'::jsonb,
  resposta_provedor jsonb not null default '{}'::jsonb,
  ultimo_erro text, tentativas integer not null default 0,
  bloqueada_ate timestamptz, bloqueio_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.notas_fiscais_assinatura enable row level security;
-- Leitura é feita por endpoint autenticado e filtrado; não há acesso direto.
revoke all on public.notas_fiscais_assinatura from anon, authenticated;
grant all on public.notas_fiscais_assinatura to service_role;
create index notas_assinatura_fila on public.notas_fiscais_assinatura(status,updated_at);

create function public.enfileirar_nota_assinatura(p_cobranca_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cobrancas_assinatura%rowtype; e public.empresas%rowtype;
  f jsonb; ident uuid; plano_nome text;
begin
  select * into c from public.cobrancas_assinatura where id=p_cobranca_id for update;
  if not found or c.status <> 'aprovada' or c.aplicado_em is null or
    c.pagamento_provedor_id is null or c.moeda <> 'BRL' then return null; end if;
  select * into e from public.empresas where id=c.empresa_id;
  select metadados into f from public.configuracoes_fiscais where empresa_id=c.empresa_id;
  select nome into plano_nome from public.planos where id=c.plano_id;
  insert into public.notas_fiscais_assinatura(cobranca_id,empresa_id,valor,descricao,payload)
  values(c.id,c.empresa_id,c.valor,
    'Assinatura Sistema OS, plano ' || coalesce(plano_nome,'Sistema OS') || ', ' || c.duracao_dias || ' dias',
    jsonb_build_object('tomador',jsonb_build_object(
      'cpfCnpj',coalesce(nullif(e.cnpj,''),nullif(f->>'documento_prestador','')),
      'nome',coalesce(nullif(e.razao_social,''),nullif(f->>'nome_prestador',''),e.nome_fantasia),
      'email',e.contato_cobranca_email), 'pagamento_id',c.pagamento_provedor_id))
  on conflict(cobranca_id) do nothing returning id into ident;
  if ident is null then select id into ident from public.notas_fiscais_assinatura where cobranca_id=c.id; end if;
  return ident;
end $$;
revoke all on function public.enfileirar_nota_assinatura(uuid) from public,anon,authenticated;
grant execute on function public.enfileirar_nota_assinatura(uuid) to service_role;

create function public.enfileirar_nota_assinatura_apos_pagamento() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='aprovada' and new.aplicado_em is not null and new.pagamento_provedor_id is not null then
    perform public.enfileirar_nota_assinatura(new.id);
  end if;
  return new;
end $$;
revoke all on function public.enfileirar_nota_assinatura_apos_pagamento() from public,anon,authenticated;
create trigger nota_assinatura_apos_pagamento after insert or update of status,aplicado_em on public.cobrancas_assinatura
for each row execute function public.enfileirar_nota_assinatura_apos_pagamento();

-- Claim com lease impede duas invocações simultâneas de emitirem a mesma nota.
create function public.reservar_nota_assinatura(p_id uuid,p_bloqueio uuid) returns setof public.notas_fiscais_assinatura
language sql security definer set search_path=public,pg_temp as $$
 update public.notas_fiscais_assinatura set bloqueada_ate=now()+interval '3 minutes',bloqueio_id=p_bloqueio,
   tentativas=tentativas+1,updated_at=now()
 where id=p_id and (bloqueada_ate is null or bloqueada_ate<now())
   and status not in ('cancelada','rejeitada') returning *;
$$;
revoke all on function public.reservar_nota_assinatura(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reservar_nota_assinatura(uuid,uuid) to service_role;

-- Importa pagamentos já confirmados sem emitir documentos nesta migração.
select public.enfileirar_nota_assinatura(id) from public.cobrancas_assinatura
where status='aprovada' and aplicado_em is not null and pagamento_provedor_id is not null;
