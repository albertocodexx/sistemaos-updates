# Etapa 9 — remoção do legado

Concluída após a validação de login no Electron e no APK, consultas leves,
escrita com revision, fila offline e arquivos sob demanda.

- Firebase foi removido das dependências do Electron e dos scripts carregados
  pelo APK.
- Cloudinary foi removido do fluxo ativo e das telas de configuração.
- O Supabase é a única origem de consultas, criação, edição e exclusão de OS.
- O modo `economico` envia somente metadados e miniaturas privadas; o modo
  `nuvem` também armazena o original no Supabase Storage.
- Credenciais locais legadas são eliminadas automaticamente na abertura do
  desktop e no carregamento da configuração do APK.
- O login visível usa apenas usuário e senha; o e-mail interno do Supabase não
  é mostrado na interface.

Os arquivos `.json` de importação/exportação permanecem para backup e uso
offline. Não há service_role key no Electron nem no APK.
