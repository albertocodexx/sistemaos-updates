# Supabase — Etapas 2 e 3

Contrato de banco preparado para a migração gradual do Sistema OS. Na Etapa 3, o APK passou a usar o contrato de autenticação; o Electron continua para a Etapa 7.

## Conteúdo

- `migrations/20260717000100_extensions_and_types.sql`: tipos e schema privado.
- `migrations/20260717000200_core_schema.sql`: tabelas, FKs, índices e constraints.
- `migrations/20260717000300_functions_triggers_rpc_views.sql`: triggers, RPCs e views leves.
- `migrations/20260717000400_rls_and_grants.sql`: RLS, privilégios e bloqueio multiempresa.
- `migrations/20260717000500_storage_policies.sql`: buckets privados e policies por prefixo.
- `migrations/20260717000600_auth_context_rpc.sql`: contexto seguro de usuário, empresa e licença para o login do APK.
- `seed.sql`: duas empresas/usuários para teste local.
- `tests/database/*.test.sql`: pgTAP para schema, RLS, RPC/revision, Storage e contexto de autenticação.

O modelo e as decisões estão em `../docs/supabase-etapa2-modelo.md`.

## Execução local

Pré-requisitos: Supabase CLI e Docker Desktop.

Na raiz do ERP:

```powershell
supabase start
supabase db reset
supabase test db
supabase db lint
```

`config.toml` já está versionado sem segredos. `db reset` aplica as migrations na ordem, executa `seed.sql` e só deve ser usado no ambiente local.

Usuários do seed:

| Empresa | E-mail | Senha |
|---|---|---|
| A | `admin-a@teste.local` | `Teste123456!` |
| B | `admin-b@teste.local` | `Teste123456!` |

Essas credenciais são exclusivamente de teste e não devem ser aplicadas em produção.

## Publicação controlada

Depois dos testes locais:

```powershell
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push --dry-run
supabase db push
```

Antes do `db push`, revisar o dry-run, fazer backup e confirmar que `app_private` não está na lista de schemas expostos pela API. Os buckets devem continuar privados.

## Regras do contrato

- O cliente nunca escolhe `empresa_id`.
- Criação, edição e exclusão de OS passam pelas RPCs.
- DML direto das tabelas sincronizadas permanece revogado nesta etapa; as policies de escrita já documentam o limite para a Etapa 5.
- `DELETE` físico não é concedido nas tabelas de negócio.
- Views leves não retornam arquivos ou termos extensos.
- `service_role` é somente para ferramentas confiáveis de backend/migração e nunca deve ir ao APK ou ao renderer Electron.
- Supabase Auth, PostgreSQL, Storage e Realtime são os únicos serviços de nuvem do sistema.

## Etapa 3 no APK

As instruções para ativar o login, cadastrar o callback de recuperação e criar o primeiro perfil estão em `../../CelularOS/celular/ETAPA-3-LOGIN-SUPABASE.md`.

## O que ainda não pertence às Etapas 2 e 3

- troca do provedor de consultas;
- fila IndexedDB adaptada;
- upload/URL assinada;
- migração dos dados reais;
- importação automática de arquivos hospedados em provedores externos antigos;
- geração de APK ou EXE.
