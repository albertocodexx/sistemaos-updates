# Sistema OS — PC 40.5.2 / Android 20.5.4

## Versões

- Windows: `40.5.2`.
- Android: `20.5.4` (`versionCode 96`).

## Assinaturas e planos no Android

- O selo **Não assinado** agora permanece alinhado e separado das ações, inclusive em celulares estreitos.
- A tela de assinatura deixa de ficar presa indefinidamente em **Carregando planos**.
- A consulta possui limite de espera, nova tentativa e fallback autenticado no catálogo protegido por RLS.
- Falhas temporárias exibem uma mensagem objetiva e o botão **Tentar novamente**, sem bloquear a conta.

## Consultas e documentos no Android

- Busca por nome, número e dados do cliente, mesmo em registros antigos sem vínculo de cliente completo.
- Subabas para OS, entregas, garantias, desbloqueios, compras, vendas e clientes.
- Contagem de arquivos baseada somente nos arquivos realmente disponíveis.
- Botão de compartilhar PDF com mensagem pronta também nos resultados da busca.
- Assinaturas recortadas e dimensionadas para ficarem legíveis em OS, entrega, compra, venda e desbloqueio.
- Proteção contra compartilhamento de PDF preto ou vazio mantida e validada no Android real.

## Pagamentos e estados das OS no Windows

- OS aprovadas aparecem em Autorizadas sem serem confundidas com OS pagas.
- Mais ações oferece Registrar pagamento e Pagamento na retirada.
- Registro pede forma e valor, sugere uma lista ampla e preenche o saldo da OS automaticamente.
- Alterar diretamente o status para Pago exige o mesmo registro financeiro auditável.
- Pagamentos parciais mantêm o saldo correto; OS Pagas contém somente quitações integrais.
- OS Finalizadas contém somente serviços entregues e integralmente pagos; entregas pendentes continuam em Aguardando Pagamento.

## Verificação

- 89 arquivos de testes automatizados do PC aprovados.
- Suíte Android aprovada, incluindo busca, compartilhamento e sincronização.
- Testes instrumentais no emulador Android aprovados para OS, entrega, garantia, desbloqueio, compra, venda e documento multipágina.
- EXE e APK tiveram versão, assinatura e SHA-256 conferidos antes da publicação.
