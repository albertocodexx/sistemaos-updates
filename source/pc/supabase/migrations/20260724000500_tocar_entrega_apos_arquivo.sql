-- Faz o PC puxar novamente a entrega quando assinatura/fotos terminarem
-- de subir depois do registro principal.
create or replace function app_private.tocar_documento_comercial_por_arquivo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entidade_tipo = 'compra'::public.entidade_tipo then
    update public.compras
       set updated_at = now()
     where id = new.entidade_id
       and empresa_id = new.empresa_id;
  elsif new.entidade_tipo = 'venda'::public.entidade_tipo then
    update public.vendas
       set updated_at = now()
     where id = new.entidade_id
       and empresa_id = new.empresa_id;
  elsif new.entidade_tipo = 'entrega'::public.entidade_tipo then
    update public.entregas
       set updated_at = now()
     where id = new.entidade_id
       and empresa_id = new.empresa_id;
  end if;
  return new;
end
$$;

drop trigger if exists trg_tocar_documento_comercial_por_arquivo on public.arquivos;
create trigger trg_tocar_documento_comercial_por_arquivo
after insert or update of arquivo_nuvem_path, deleted_at on public.arquivos
for each row
when (new.entidade_tipo in (
  'compra'::public.entidade_tipo,
  'venda'::public.entidade_tipo,
  'entrega'::public.entidade_tipo
))
execute function app_private.tocar_documento_comercial_por_arquivo();
