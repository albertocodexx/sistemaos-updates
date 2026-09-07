# Supabase — Etapa 7 (Electron)

## Implementado

- Supabase Auth no processo principal do Electron.
- Sessão persistida somente com `safeStorage`; tokens não são expostos ao renderer.
- Rejeição de `service_role` e chaves `sb_secret_*`.
- Contexto autenticado com perfil, `empresa_id`, licença e modo de armazenamento.
- Heartbeat do desktop a cada 30 segundos.
- Cache local em `database.json` e estado de sincronização separado.
- Pull incremental de OS por `updated_at`, sempre protegido por RLS.
- Fila offline local para criar, editar e excluir OS.
- Número local de OS preservado por RPC idempotente do desktop.
- Conflitos de `revision` preservados no estado local; não são sobrescritos silenciosamente.
- Arquivos completos permanecem locais no modo econômico.
- Miniaturas de imagens são criadas e enviadas ao bucket privado.
- Pedidos pontuais do APK recebem uma cópia temporária, expirada após cinco minutos.
- No modo nuvem, o desktop também pode enviar o arquivo completo ao Storage privado.
- Firebase e Cloudinary continuam disponíveis como fallback.

## Configuração no PC

Em **Configurações → Supabase — Conta e Sincronização do PC**:

1. informe a URL HTTPS do projeto;
2. informe somente a anon/publishable key;
3. teste a conexão;
4. ative o Supabase e salve;
5. saia e entre novamente usando o e-mail cadastrado no Supabase.

Se a configuração estiver inválida, o login local permanece acessível para corrigir os dados.

## Migration necessária

Aplicar, na ordem, até:

`supabase/migrations/20260717000800_electron_desktop_sync.sql`

Ela adiciona a criação idempotente de OS do desktop e a resposta segura aos pedidos temporários de arquivo.

## Arquivos locais de controle

- `supabase-session.enc.json`: sessão criptografada pelo sistema operacional.
- `supabase-desktop-state.json`: device ID, cursor incremental, fila, mapeamentos e conflitos; não contém senha nem token.
- `Supabase-Arquivos/`: materialização local de assinaturas e miniaturas.

## Limite desta etapa

A migration não foi aplicada a um projeto remoto porque não há Supabase CLI nem Docker configurados nesta máquina. Nenhum EXE ou APK foi gerado. A Etapa 8 é a ferramenta de migração de dados com dry-run, relatório e idempotência; ela não deve reutilizar credenciais do Electron.

