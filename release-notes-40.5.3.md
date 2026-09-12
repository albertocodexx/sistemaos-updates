# Sistema OS 40.5.3 / Android 20.5.5

## Correções

- A aba **Reparos** no Android volta a usar toda a largura da tela, sem quebrar palavras nem comprimir os controles.
- A sincronização distingue corretamente empresa, usuário e aparelho depois de uma troca de conta.
- Filas offline esvaziam todas as operações confirmadas sem esperar o ciclo seguinte.
- Alterações simultâneas de estoque feitas no PC e no celular preservam campos independentes.
- A exclusão de uma OS só remove fotos e PDFs depois da confirmação no PostgreSQL.
- Documentos e assinaturas são verificados ao abrir, voltar ao aplicativo e recuperar a internet.
- Canais Realtime duplicados foram eliminados, reduzindo tráfego, eventos repetidos e uso de CPU.

## Atualização obrigatória

- PC e Android verificam a versão mais recente antes de liberar o sistema.
- O Android inicia o download automaticamente; a confirmação final continua sendo a tela segura do próprio Android.
- O PC baixa e instala antes de abrir a tela operacional e retoma o download após uma queda temporária.

## Validações

- Suíte completa do Android aprovada.
- 89 grupos de smoke tests do PC aprovados.
- Fluxos de assinatura, exclusão persistente, Mercado Pago, renovação de licença e isolamento de empresa revalidados.
