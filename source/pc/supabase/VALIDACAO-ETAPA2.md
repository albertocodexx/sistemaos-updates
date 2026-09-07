# Validação da Etapa 2

Data: 17/07/2026

## Executado

- Parser PostgreSQL (`pglast`) em todas as 5 migrations, no seed e nos 4 arquivos pgTAP: aprovado, sem erro sintático.
- Execução das 5 migrations em PostgreSQL 17 isolado (`PGlite`) com schemas mínimos de Auth/Storage: aprovada.
- Resultado estrutural isolado: 13 tabelas públicas, 6 views leves, 31 policies públicas e 4 policies de Storage.
- Execução do seed no banco isolado: aprovada.
- Simulação autenticada da empresa A: enxergou 1 cliente (não o cliente B).
- Chamadas da RPC de criação: números `OS-0001` e `OS-0002`.
- Varredura de migrations: zero colunas Base64.
- Varredura da pasta Supabase: zero atribuições de `service_role`.
- Carregamento do `config.toml` pelo Supabase CLI: aprovado.
- Pasta do APK: não recebeu pasta/configuração Supabase nesta etapa.

## Preparado, mas não executado nesta máquina

Os 4 testes pgTAP estão prontos para `supabase test db`, porém o daemon do Docker não está disponível nesta máquina. O Supabase CLI chegou a carregar a configuração e parou ao tentar acessar `//./pipe/docker_engine`.

Assim, não se declara a suíte pgTAP verde ainda. Em uma máquina com Docker Desktop ativo, executar:

```powershell
supabase start
supabase db reset
supabase test db
supabase db lint
```

O `db reset` é local e destrutivo apenas para o banco local do Supabase; não executar contra dados de produção.
