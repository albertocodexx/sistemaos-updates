-- Uma OS possui apenas um PDF atual. A implementacao anterior catalogava cada
-- regeneracao como anexo novo e um desktop podia entrar num ciclo de baixar o
-- PDF, regenerar e publicar outro hash a cada sincronizacao.

-- Preserva a versao mais recente de cada OS e oculta as anteriores sem apagar
-- dados de auditoria. A limpeza dos objetos orfaos do Storage pode ocorrer de
-- forma independente depois desta migracao.
with versoes as (
  select id,
         row_number() over (
           partition by empresa_id, entidade_tipo, entidade_id
           order by created_at desc, id desc
         ) as posicao
    from public.arquivos
   where deleted_at is null
     and (categoria = 'pdf' or mime_type = 'application/pdf')
)
update public.arquivos a
   set deleted_at = now(), updated_at = now(), revision = revision + 1
  from versoes v
 where a.id = v.id and v.posicao > 1;

-- Idempotencias de versoes substituidas nao devem impedir que o mesmo conteudo
-- volte a ser o documento atual no futuro.
drop index if exists public.arquivos_empresa_idempotency_uidx;
create unique index if not exists arquivos_empresa_idempotency_uidx
  on public.arquivos (empresa_id, idempotency_key)
  where idempotency_key is not null and deleted_at is null;

create unique index if not exists arquivos_pdf_atual_uidx
  on public.arquivos (empresa_id, entidade_tipo, entidade_id)
  where deleted_at is null
    and (categoria = 'pdf' or mime_type = 'application/pdf');

create or replace function app_private.manter_somente_pdf_atual()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null
     and (new.categoria = 'pdf' or new.mime_type = 'application/pdf') then
    update public.arquivos
       set deleted_at = now(), updated_at = now(), revision = revision + 1
     where empresa_id = new.empresa_id
       and entidade_tipo = new.entidade_tipo
       and entidade_id = new.entidade_id
       and id <> new.id
       and deleted_at is null
       and (categoria = 'pdf' or mime_type = 'application/pdf');
  end if;
  return new;
end
$$;

drop trigger if exists trg_arquivos_pdf_atual on public.arquivos;
create trigger trg_arquivos_pdf_atual
before insert on public.arquivos
for each row execute function app_private.manter_somente_pdf_atual();

comment on function app_private.manter_somente_pdf_atual() is
  'Substitui o PDF atual da entidade e impede acumulacao por ciclos de sincronizacao.';
