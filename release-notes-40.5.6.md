# Sistema OS 40.5.6 / Android 20.5.8

Correção de estabilidade e consistência validada antes da publicação.

- A consulta de uma OS no celular volta a trazer o ID do cliente, assinatura, status de pagamento, valor recebido, saldo e lembretes de cobrança.
- Erros, avisos e sucessos do Android agora recebem cores e contraste corretos, em vez de parecerem todos iguais.
- Datas sem horário não voltam um dia em PDFs de venda, compra e desbloqueio, nem em cartões de garantia e entrega.
- Ao trocar de empresa ou usuário durante um envio, a fila offline devolve a operação à conta original sem gastar tentativa, marcar erro ou correr risco de enviar no cadastro errado.
- Notificações de cobrança usam IDs válidos para Android e horários imediatamente futuros, evitando recusas silenciosas em alguns aparelhos.
- O APK foi assinado, subiu para o código interno 100 e pode atualizar a versão Android anterior.

Validação executada: suíte completa do PC, suíte completa do Android, testes de fila offline, pagamento, assinatura, PDFs, notificações, backups, atualização e isolamento entre empresas.
