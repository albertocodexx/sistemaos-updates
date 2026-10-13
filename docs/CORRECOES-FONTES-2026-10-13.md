# Correções de fonte: sessão, cache e conteúdo dinâmico

Rodada iniciada em 12/10/2026, encerramento em 13/10/2026.

## Entrega e limite

Correções publicadas somente em uma branch de revisão. Versões de instalação permanecem PC 40.5.24 e Android 20.5.23. Não houve novo instalador/APK, deploy de Edge Function/SQL, alteração de credenciais, teste de pagamento/emissão real ou substituição de assets do Drive. Não descrever esta publicação como atualização já recebida pelos aplicativos.

A auditoria Cloudflare deep foi encerrada explicitamente como incompleta por mudança do pedido para correção/publicação. 111 unidades: 32 covered, 64 candidate, 12 blocked, 3 deferred; 46 hipóteses ainda não passaram todas as revisões independentes. Relatório completo da auditoria mantido localmente com o proprietário. Isso não é uma certificação de segurança nem uma liberação integral do Beta.

## Alterações

- PC: SIGNED_OUT retira imediatamente a autoridade do IPC local, sem apagar filas/cache/cofre. Geração de autenticação impede uma RPC antiga de restaurar identidade depois de invalidação, timeout ou troca de cliente. Falha intencional na troca rápida conserva a mensagem e limpa seu marcador.
- PC: configuração, logo e backup conferem geração, empresa, usuário, cliente e diretório antes de commits tardios, inclusive após rollback de login. Não-admin é recusado antes de consultar o cliente do backup.
- PC: Markdown aceita apenas SVG exatamente igual ao catálogo interno; estoque/peças/busca escapam texto e os IDs de handlers são codificados para não virarem código.
- Android: estoque/cache só permite leitura autorizada, sem apagar a fila ao negar acesso. Retornos assíncronos validam empresa/usuário/revisão/permissão. Criação de peça continua usando criar; edição usa editar.
- Android: recebimento/importação/listagem/assinatura/exclusão de documentos conserva snapshot de sessão e descarta resposta anterior. O lock pertence à sua promessa; troca de conta limpa a prévia.
- Android: sessão invalida validações antigas no evento Auth, protege continu ações após configuração/refresh/logout, e configuração compartilhada verifica o destino antes de gravar.
- Android: sincronização verifica identidade antes/depois das fronteiras de envio e confirmação, não regrava o retry de A no banco de B. Pendência interrompida permanece no banco original, com janela de recuperação já existente.

## Verificações realizadas

Leitura dos caminhos atuais e duas rodadas de revisão focada por agentes para autenticação, Android e renderização; checagem de sintaxe `node --check` nos fontes/testes alterados; conferência do diff e arquivos destinados ao commit. Os validadores da auditoria conferiram o formato do ledger e de `findings.json` vazio (nenhum candidato concluído nas fases 3/5), não o comportamento integral do produto.

Em 13/10/2026, um runner no Windows Sandbox foi validado com rede ausente, entrada somente leitura, ambiente vazio com allowlist, scratch privado, limites de CPU, memória, processos, tempo, stdout e disco, além de encerramento conferido dos jobs. Foram executadas três regressões direcionadas com dados fictícios:

- PC: `testes/smoke/teste-revogacao-sessao-cloud.js` — aprovado, código 0.
- Android: `testes/seguranca/estoque-cache-autorizacao.teste.js` — aprovado, código 0.
- Android: `testes/seguranca/documentos-escopo-assinatura.teste.js` — aprovado, código 0.

As três execuções terminaram sem timeout; sete arquivos de fonte/teste usados mantiveram hashes SHA-256 idênticos antes e depois. O runner não reteve arquivos do alvo. Os metadados locais ficam em `outputs/sandbox-2026-10-13/scratch/export-v2/readonly-test-metadata.json` e não contêm credenciais nem dados de produção.

Os resultados permitem integrar somente as correções cobertas por essas regressões direcionadas. Não equivalem a build de release, teste completo do PC/Android ou certificação do sistema inteiro.

## Pendências

Executar as suítes completas, builds de release e validações de interface; validar comportamento real do SDK com transporte simulado; revisar as demais hipóteses da auditoria e os fluxos não tratados (recuperação de senha, operações já enviadas, outros serviços de sync). Guards não desfazem requisições remotas que já saíram. Sem prova nova de funcionamento integral de Mercado Pago, fiscal, WhatsApp, backup/restauração ou isolamento em produção nesta rodada. Instalador e APK permanecem nas versões já publicadas PC 40.5.24 e Android 20.5.23.
