# Auditoria Mercado Pago e WhatsApp — 30/09/2026

Escopo: cobrança de OS e assinatura do Sistema OS, confirmação, envio de texto/PDF, classificação de respostas por IA, Baileys, Meta Cloud API e busca por Evolution API. Revisão local de código e testes; não constitui confirmação de configuração ou entrega em produção.

## Fluxos encontrados

1. **Assinatura SaaS e recarga fiscal:** `mercado-pago-saas-webhook` valida a assinatura da notificação, consulta o pagamento na API do Mercado Pago, compara referência, moeda e valor, e aplica a cobrança de modo idempotente. `assinaturas-worker` reconcilia pagamentos pendentes e processa a fila de WhatsApp. Esse fluxo é executado no servidor e pode funcionar com o PC fechado, desde que funções, cron, credenciais, templates e migrações estejam efetivamente ativos no projeto remoto.
2. **Cobrança de OS:** cada checkout recebe referência, chave de idempotência e token de webhook próprios. O webhook ignora o corpo como fonte de verdade, consulta o pagamento na API do Mercado Pago e confere empresa, cobrança, OS, valor, moeda e ambiente antes da transação PostgreSQL. Pagamento parcial e estorno recalculam recebido/restante; retries não duplicam parcela nem mensagem.
3. **WhatsApp de OS:** a confirmação fica em uma outbox única. O worker servidor envia pela Meta Cloud API quando configurada; o PC conectado pode consumir a mesma fila pelo Baileys. Falhas retornam à fila com limite de tentativas, sem bloquear a OS.

## Limite de publicação desta rodada

O projeto Supabase remoto ainda não registra as migrações posteriores a julho no histórico e não possui as secrets NFE.io. Por isso, o código novo pode ser publicado no GitHub, mas não deve ser ativado no banco de produção até reconciliar/aplicar as migrações e configurar o worker. Publicar o cliente sem essa ativação mantém fiscal e cobrança nova em falha fechada; não equivale a ativação remota.
2. **Cobrança de OS:** `integracoes-empresa` gera a preferência com `external_reference` igual ao número da OS e oferece consulta segura de pagamentos. A confirmação da OS é feita pelo aplicativo PC em `mp:verificarPagamento` ou no poll de `src/backup.js`. O webhook SaaS ignora referências que não começam por `SAAS-` ou `FISCAL-`. Portanto, com o PC fechado a confirmação e a mensagem automática da OS não estão garantidas.
3. **WhatsApp de OS:** o PC envia por Baileys ou, quando configurado, por Meta Cloud API. Baileys aguarda ACK do servidor; a API Meta apenas confirma um ID de mensagem aceito pela Graph API, não a entrega ao destinatário. O envio Meta encontrado é de texto; PDF não é anexado nesse caminho. A correção local desta rodada evita informar `pdfEnviado=true` sem documento e passa a respeitar o roteamento Meta no verificador manual.
4. **Respostas e IA:** as mensagens recebidas e a classificação de aceite/forma de pagamento estão ligadas ao listener Baileys no PC, com fallback por regras. Não foi encontrada função de webhook para receber respostas da Meta nem implementação da Evolution API. Configurar somente Meta não fornece a mesma automação de respostas/classificação.

## Riscos ainda abertos

- **Alto — OS sem webhook próprio:** pagamento de OS enquanto o PC está desligado não atualiza imediatamente o estado nem envia confirmação. É necessário webhook por empresa ou conciliação agendada no servidor, com verificação de assinatura e busca do pagamento no MP.
- **Alto — notificação sem outbox durável para OS:** o pagamento é registrado antes do WhatsApp. Se o PC/renderer fechar ou o envio falhar, o sistema não enfileira a mensagem com retry e estado de entrega; a confirmação pode ficar sem aviso. O reenvio manual existe, mas não é garantia automática.
- **Alto — referência de cobrança não única:** `external_reference` usa só `OS-...`, podendo repetir entre empresas ou cobranças da mesma OS. O verificador local cruza valor e datas, mas aceita metadados de empresa ausentes. Uma referência única por cobrança, vinculada ao tenant e ao ID da preferência, reduz ambiguidade e risco de confirmação indevida.
- **Médio — Meta não envia PDF neste fluxo:** o texto pode ser aceito, mas o PDF precisa de implementação própria de mídia/documento, status separado e testes de entrega. Não anunciar comprovante enviado se só o texto foi aceito.
- **Médio — sem ingestão Meta/Evolution:** classificação de IA e automações dependem do Baileys no PC. Implementar webhooks autenticados, deduplicação e isolamento por empresa antes de ativá-las nesses provedores.
- **Médio — produção não verificada:** testes locais não provam templates Meta aprovados, webhook MP configurado, cron ativo, credenciais válidas, nem entrega real de mensagens. Esses pontos exigem teste controlado no ambiente remoto.

## Ajustes locais verificados

- `integracoes-empresa`: timeout de 20 segundos no envio Meta e exigência do ID de mensagem retornado pela Graph API.
- `src/whatsapp.js`: status do PDF de OS e do comprovante passa a refletir o envio real; o roteador de canal fica disponível ao verificador manual.
- `src/ipc/register-legacy.js`: verificação manual da OS usa o canal configurado; PDF não é tentado pelo Baileys quando o texto saiu pela Meta.
- PC: suíte de 102 smoke tests aprovada e testes direcionados de MP/WhatsApp aprovados. Android: testes direcionados de cobrança/compartilhamento aprovados; a execução completa imprimiu todos os testes até o último, mas exigiu interrupção por processo remanescente, portanto não é registrada como aprovação limpa.

**Estado para publicação:** não publicar como fluxo MP/WhatsApp integralmente automático/offline. As correções desta rodada são locais, sem deploy nem validação de pagamento ou entrega reais.
