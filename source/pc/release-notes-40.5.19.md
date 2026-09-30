# Sistema OS 40.5.19 / Android 20.5.18

## Correções principais

- Cobranças de OS pelo Mercado Pago agora usam confirmação segura no servidor, referência e idempotência próprias, conciliação com PC fechado e sincronização do valor recebido/restante.
- Confirmações de pagamento entram em uma fila durável de WhatsApp, processada pela Meta Cloud API no servidor ou pelo Baileys quando o PC estiver conectado.
- NFS-e NFE.io ganhou fila idempotente, consulta assíncrona, confirmação exclusiva de produção, cancelamento acompanhado e armazenamento privado do PDF e XML oficiais.
- A assinatura da OS foi realinhada e o checklist interno foi retirado do PDF entregue ao cliente.
- Impressão e compartilhamento permitem escolher via do cliente, via da assistência ou ambas nos documentos com duas vias.
- Cobranças no Android abrem diretamente o item pendente e mostram valores/status consistentes.

## Segurança e validação

- Webhook de cobrança confere empresa, OS, cobrança, ambiente, moeda e valor consultando o Mercado Pago antes de alterar dados.
- Estorno parcial recalcula o líquido sem duplicar pagamento ou mensagem.
- Emissão fiscal falha fechada quando chave, conta, worker ou configuração de produção estiverem ausentes.
- 104 testes de smoke do PC, suíte completa do Android e teste PostgreSQL do fluxo Mercado Pago aprovados.

> NF-e e NFC-e não fazem parte deste conector: esta versão implementa NFS-e. A ativação remota depende das migrações e credenciais NFE.io configuradas exclusivamente no servidor.
