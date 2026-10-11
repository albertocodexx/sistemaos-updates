# Sistema OS 40.5.24

## Melhorias

- Planos comerciais reposicionados em R$ 59,90, R$ 79,90, R$ 119,90 e R$ 199,90 por mês, mantendo o preço fundador do Beta em R$ 49,90 pelo período elegível.
- Tutorial fiscal completo dentro das Configurações para orientar cadastro de NFS-e, NF-e e NFC-e.
- Checklist técnico e roteiro manual de liberação do Beta adicionados à documentação.

## Segurança e sincronização

- PC e Android agora informam versão e versão do esquema de sincronização ao servidor.
- Clientes incompatíveis são bloqueados antes de gravar dados, inclusive se já estavam abertos quando uma atualização foi publicada.
- A fila offline é preservada durante a atualização; o PC refaz a leitura integral para receber campos que versões antigas não conheciam.

## Validação

- 108 arquivos de smoke test aprovados no PC.
- Suíte completa do Android aprovada.
- Tutorial fiscal renderizado e inspecionado sem estouro horizontal.
- Instalador Windows e APK Android recompilados; APK validado com assinatura v2, versionCode 114 e versionName 20.5.23.
