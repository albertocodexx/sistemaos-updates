# Publicação comercial no Supabase

Este roteiro publica a camada comercial sem apagar OS, clientes, anexos ou histórico.

## Ordem obrigatória

1. Aplicar `20260717001300_licenca_comercial_enum.sql` e aguardar o término.
2. Aplicar `20260717001400_licenciamento_comercial.sql`.
3. Aplicar `20260717001500_segredos_integracoes.sql`.
4. Aplicar `20260717001600_dispositivos_e_acessos_comerciais.sql`.
5. Cadastrar o administrador global e a identidade do administrador inicial.
6. Criar o segredo `INTEGRATION_ENCRYPTION_KEY` no cofre de secrets do projeto.
7. Publicar as funções `auth-login`, `admin-global` e `integracoes-empresa`.
8. Testar login, permissões, trial, integração e sincronização antes de gerar builds.

Os passos 1 e 2 não devem ser unidos na mesma execução: novos valores de enum precisam do commit da primeira migration antes de serem usados na segunda.

## Secrets das Edge Functions

O projeto deve ter uma chave aleatória de 32 bytes, codificada em Base64, com o nome:

`INTEGRATION_ENCRYPTION_KEY`

Ela fica somente no cofre do Supabase. Não incluir em arquivos, APK, Electron, banco local, logs, documentos ou GitHub.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo ambiente das Edge Functions; a última nunca vai para o cliente.

## Primeiro administrador e login atual

Depois das migrations, cadastrar a conta de suporte já existente como administradora global e associar sua identidade pública de login a uma empresa. O cadastro deve usar o e-mail técnico já existente apenas no servidor; a interface recebe somente:

`código da empresa + usuário + senha`

Para criar as próximas empresas, use o painel global: ele cria o trial no horário do servidor, o usuário inicial e a auditoria em uma única operação.

## Teste de aceite antes do build

- Login com código de empresa, usuário e senha no PC e APK.
- Conferir que um acesso no PC e outro no APK aparecem no inventário como
  identificadores com hash, sem IMEI ou e-mail técnico.
- Verificar que e-mail técnico, URL do Supabase e chaves não aparecem na tela.
- Criar uma OS, sincronizar, abrir no outro dispositivo e confirmar que PDF/fotos continuam sob demanda.
- Criar empresa de trial curto; confirmar aviso, período de graça e bloqueio após a data simulada no servidor.
- Confirmar pagamento como administrador global e validar a reativação.
- Conectar e desconectar Mercado Pago; conferir que a tela mostra somente conta mascarada e status.
- Garantir que administrador comum não vê painel global nem altera licença.
- Rodar `npm run test:smoke` no PC e `npm test` no celular.

## Rollback

Não desfaça migrations comerciais com `DROP` em produção. Se uma função falhar, retire apenas a nova versão da função e mantenha os dados e a sessão existente. As tabelas comerciais são aditivas e não alteram os registros de OS.
