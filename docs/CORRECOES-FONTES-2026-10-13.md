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

Leitura dos caminhos atuais e duas rodadas de revisão focada por agentes para autenticação, Android e renderização; checagem de sintaxe Node --check nos fontes/testes alterados; conferência do diff e arquivos destinados ao commit. Os validadores da auditoria conferiram o formato do ledger e de findings.json vazio (nenhum candidato concluído nas fases 3/5), não o comportamento do produto.

## Testes preparados, não executados

- PC: testes/smoke/teste-revogacao-sessao-cloud.js; teste-render-com-icones-seguro.js ampliado; fixture de cliente estável do backup; novo teste incluído no runner smoke.
- Android: npm run test:security-regression (cache/permissão/troca de usuário e lote/lookup de documento atrasado); fixtures antigas atualizadas com autorização explícita; contrato do retry interrompido ajustado para não exigir escrita na conta sucessora.

A skill exige sandbox OS com rede isolada, ambiente vazio allowlisted, alvo/toolchain somente leitura, scratch exclusivo e todos os limites de recursos. Esse conjunto não existe neste host; portanto testes de execução, browsers, builds e emuladores não foram rodados. Validar em ambiente isolado com fixtures fictícias antes de integrar à main ou gerar release.

## Pendências

Executar as regressões e suítes completas, validar comportamento real do SDK com transporte simulado, revisar as demais hipóteses da auditoria e os fluxos não tratados (recuperação de senha, operações já enviadas, outros serviços de sync). Guards não desfazem requisições remotas que já saíram. Sem prova de funcionamento integral de Mercado Pago, fiscal, WhatsApp, backup/restauração ou isolamento em produção nesta rodada.
