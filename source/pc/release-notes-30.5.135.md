# Sistema OS 30.5.135 / Android 1.0.91

- Correção da confirmação Mercado Pago para OS já entregue e ainda não paga.
- Validação de ID, referência, moeda, valor exato, datas, ambiente e reembolso antes da confirmação automática.
- Duas parcelas online iguais usam IDs de transação distintos; reenvios do mesmo pagamento não duplicam o lançamento.
- Respostas da consulta de pagamento são descartadas quando a empresa muda durante a operação.
- Reconciliação de assinaturas recupera pagamentos aprovados cuja aplicação foi interrompida e alterna as cobranças consultadas.
- Mensagens com confirmação tardia atualizam o histórico. Operações de WhatsApp possuem limite de tempo; envios interrompidos ficam registrados para conferência.
- Android com R8 e redução de recursos; cópia automática dos dados privados pelo backup do Android desabilitada.
- Correções anteriores de sincronização, exclusão de documentos, cotas da IA e autorização preservadas.

Validação: os 88 arquivos da suíte PC passaram na execução completa. As verificações simulam falhas e respostas dos provedores sem cobrar clientes nem disparar mensagens de teste para pessoas reais.

As funções de servidor precisam acompanhar esta versão. O código-fonte e as evidências não equivalem, por si só, à confirmação de publicação no Supabase.
