insert into public.integracoes_plataforma (
  tipo, status, provedor, conta_mascarada, conectado_em,
  ultima_verificacao_em, ultimo_erro, metadados, updated_at
)
values (
  'mercado_pago', 'conectada', 'mercado_pago', 'Conta Mercado Pago de produção', now(),
  now(), null,
  jsonb_build_object(
    'webhook_assinado', true,
    'ambiente', 'producao',
    'checkout_automatico', true,
    'ativacao_automatica', true,
    'segredo_em_cofre_supabase', true
  ),
  now()
)
on conflict (tipo) do update set
  status = excluded.status,
  provedor = excluded.provedor,
  conta_mascarada = excluded.conta_mascarada,
  conectado_em = excluded.conectado_em,
  ultima_verificacao_em = excluded.ultima_verificacao_em,
  ultimo_erro = null,
  metadados = excluded.metadados,
  updated_at = excluded.updated_at;
