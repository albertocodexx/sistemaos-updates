# Ferramenta confiável de migração Supabase

Esta pasta não é incluída no aplicativo Electron. Execute somente em uma
máquina administrativa e nunca coloque a service role em Configurações do PC,
no APK ou em arquivos versionados.

Primeiro execute o `dry-run`:

```powershell
npm run migrate:supabase -- --fonte "C:\caminho\database.json" --dry-run
```

O relatório informa contagens, usuários sem e-mail, registros inválidos e
arquivos locais ignorados. Senhas locais, tokens, Base64 e caminhos não são
enviados.

Para usuários cujo login local não é um e-mail, crie um arquivo fora do projeto:

```json
{
  "admin": { "email": "administrador@empresa.com.br" }
}
```

Depois de aplicar todas as migrations até `20260717000900`, revisar o relatório
e configurar as variáveis de ambiente, o `apply` exige confirmação literal:

```powershell
$env:SUPABASE_URL="https://projeto.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="..."
npm run migrate:supabase -- --fonte "C:\caminho\database.json" --mapa-usuarios "C:\seguro\usuarios.json" --apply --confirmar MIGRAR
```

A execução é idempotente pelo livro-razão `migracoes_legado`, por
`id_exportacao` e pelos números preservados. Se o conteúdo mudar após uma
migração anterior, a ferramenta gera conflito e não sobrescreve silenciosamente.
URLs de provedores externos antigos não são importadas. Fotos e PDFs locais
só são enviados depois pelo fluxo normal do Supabase Storage.
