# Backup e recuperação — Sistema OS

Backup não substitui a sincronização. A sincronização mantém os dados da empresa disponíveis entre PC e celular; o backup permite recuperar uma cópia após falha, perda do equipamento ou erro operacional.

## O que cada cópia protege

- **Backup automático do PC:** banco local, configurações da empresa e histórico local. O aplicativo mantém as 15 cópias automáticas mais recentes.
- **Backup manual do PC:** arquivo JSON exportado pelo administrador para um local escolhido por ele.
- **Backup do celular:** configurações locais, histórico, documentos pendentes e fila offline em JSON.
- **Supabase:** registros sincronizados e arquivos no Storage. A recuperação de produção deve ser feita por conta administrativa, nunca sobrescrevendo tabelas manualmente sem teste.

Arquivos grandes (fotos e PDFs) podem existir no Storage e não devem ser assumidos como incluídos em um export local antigo. Antes de uma restauração completa, confirme a presença dos anexos pelo sistema e pelo Storage.

## Rotina recomendada

1. Verifique semanalmente se há backup automático recente no PC.
2. Exporte um backup manual antes de limpeza, migração ou troca de computador.
3. Guarde a cópia manual fora do computador principal (pendrive criptografado ou serviço corporativo autorizado).
4. Não salve senhas, Access Tokens, chaves privadas ou arquivos `.env` dentro de backups compartilhados.

## Recuperação segura

1. Trabalhe primeiro em uma cópia do arquivo de backup.
2. Pare o uso do sistema no outro dispositivo para evitar alterações concorrentes.
3. Importe o backup pela tela própria do sistema; não edite JSON manualmente.
4. Abra o sistema, confira clientes, OS, estoque e uma amostra de anexos.
5. Rode a sincronização somente depois da conferência. Em caso de conflito, preserve a cópia mais recente e registre o ocorrido.

## Teste trimestral de restauração

Em um computador separado ou perfil de teste:

1. Gere um backup manual com dados de demonstração.
2. Restaure-o no ambiente de teste.
3. Compare quantidade de OS, clientes, estoque e documentos pendentes.
4. Registre data, versão do aplicativo, resultado e qualquer divergência.

Nunca use a restauração para apagar dados de produção. Em caso de incidente real, faça primeiro uma nova cópia do estado atual e peça apoio ao suporte do Sistema OS.
