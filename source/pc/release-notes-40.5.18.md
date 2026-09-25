# Sistema OS 40.5.18 / Android 20.5.17

## Correções principais

- Estoque conciliado sem regredir aparelho vendido para reservado e sem apagar peças usadas.
- Cobranças concorrentes do celular e do PC agora preservam parcelas, pagamentos e saldo.
- Histórico de chamados no PC e no celular; a central não abre automaticamente a última conversa.
- Estados de atendimento padronizados: Aguardando suporte, Atendido, Finalizado e Cancelado.
- Chamados finalizados ou cancelados permanecem consultáveis e não aceitam novas mensagens.
- Prints PNG, JPG e WebP podem ser anexados ao chamado, com validação de formato, conteúdo, tamanho e quantidade.
- Chamado sem conta gera acesso de acompanhamento restrito ao aparelho e ao suporte.
- Troca rápida de conta disponível sem configuração administrativa, mantendo autenticação e cofre cifrado.
- Android protege as pastas exclusivas do aplicativo contra indexação indevida de imagens pela galeria.

## Verificações

- 95 testes de fumaça no PC.
- Suíte completa do Android.
- Testes de concorrência de estoque/cobranças, exclusão sincronizada, PDFs e compartilhamento.
- Build Windows e APK Release assinados.
- Migração e função `chamados-suporte` publicadas no Supabase.

## Observação Android

A proteção da galeria impede novas indexações das pastas internas do app. Imagens que já estavam indexadas pelo Android podem continuar visíveis até a galeria atualizar seu índice. Nenhuma foto pessoal é removida.
