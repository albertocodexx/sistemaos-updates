begin;
alter table public.chamados_suporte drop constraint if exists chamados_suporte_status_check;
alter table public.chamados_suporte add constraint chamados_suporte_status_check
  check (status in ('aberto','em_atendimento','resolvido','fechado','cancelado'));
create or replace function public.validar_resposta_chamado_aberto()
returns trigger language plpgsql security definer set search_path = public as $$
declare situacao text;
begin
  select status into situacao from public.chamados_suporte where id=new.chamado_id for update;
  if new.autor_tipo='cliente' and situacao in ('resolvido','fechado','cancelado') then
    raise exception 'Chamado encerrado: histórico disponível somente para leitura.' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_resposta_chamado_aberto() from public, anon, authenticated;
drop trigger if exists validar_resposta_chamado_aberto on public.chamado_mensagens;
create trigger validar_resposta_chamado_aberto before insert on public.chamado_mensagens
  for each row execute function public.validar_resposta_chamado_aberto();
commit;
