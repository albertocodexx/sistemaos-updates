# Prévia técnica fiscal — 26/09/2026

Esta branch contém o código em desenvolvimento para cota gratuita de 100 documentos fiscais por mês, saldo pré-pago para excedentes, limites de emissão e gasto por usuário/cargo, e telas de administração no PC e Android. **Não é uma atualização para clientes.**

## Estado de publicação

- Não há instalador, APK, release de atualização automática ou implantação das Edge Functions desta prévia.
- A migração `20260925000200_cota_creditos_fiscais.sql` **não foi aplicada ao banco de produção**.
- `FISCAL_EMISSOR_ATIVO` deve permanecer desativado. Não há emissor fiscal homologado nem certificados/credenciais dos emitentes configurados para emissão real.
- Recargas e emissão reais não foram validadas. Os testes de pagamento desta prévia usam simulações; não há comprovação de pagamento real em produção.
- O projeto Supabase consultado não apresentou backup restaurável; seu histórico remoto de migrações diverge do diretório local. Não aplicar todas as migrações automaticamente.

## Verificações locais

Os testes locais de PostgreSQL (PGlite), webhook simulado, funções fiscais e as suítes PC/Android passaram em 26/09/2026. Isso não substitui restauração de backup, homologação fiscal e testes ponta a ponta em ambiente de teste separado.

## Critérios antes de uma release para clientes

1. Obter um backup completo e testar a restauração em ambiente separado.
2. Conciliar histórico de migrações e aplicar somente a migração revisada em homologação; verificar permissões e isolamento com duas empresas.
3. Homologar o provedor fiscal e o cadastro de cada emitente; validar autorização, rejeição, cancelamento oficial e DANFE/documentos correspondentes.
4. Testar recarga, confirmação, estorno, idempotência, limites por usuário/cargo e conciliação após falhas com o Mercado Pago em ambiente apropriado.
5. Só então gerar instalador/APK e publicar release de atualização automática, com monitoramento e plano de reversão.

Detalhes: `outputs/RELATORIO-SALDO-FISCAL-2026-09-25.md` no workspace de desenvolvimento.
