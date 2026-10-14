# Correções PC e conferência RLS — 14/10/2026

## Comportamento corrigido

- O indicador inferior das abas internas aparece somente na opção ativa. A linha do contêiner deixou de parecer uma seleção simultânea de Visão geral e Financeiro.
- Cobranças inicia a leitura e a sincronização depois de abrir a aba, inclusive quando a sessão restaura essa aba. Eventos e atualização periódica continuam ativos.
- A IA prioriza o valor total da OS e o orçamento informado. Ausência de valor passa a ser `null`; o assistente só declara serviço gratuito com marcação explícita.
- Comprovantes térmicos de OS, pagamento e desbloqueio oferecem 58/80 mm, pré-visualização e impressão. Configurações do administrador definem o padrão; o operador pode escolher outro tamanho nessa operação. Etiquetas também iniciam com esse padrão.
- O padrão térmico integra a configuração compartilhada, preservando o tamanho na publicação/restauração em outro computador da empresa.
- Exportar Painel gera um relatório próprio com dados, período e tabelas, em vez de imprimir a janela do aplicativo. Os dados são escapados. Valores financeiros só entram no documento quando o usuário autenticado tem leitura do módulo financeiro.

## Evidência do banco aplicado

Consulta PostgreSQL somente leitura em 14/10/2026, com TLS e verificação do certificado. Foram consultados catálogos de tabelas, políticas e views; nenhum registro de cliente foi lido ou alterado.

- 59/59 tabelas verificadas em `public` e `storage.objects` com RLS habilitado.
- 44 tabelas com coluna `empresa_id`; nenhuma delas com RLS desabilitado.
- 68 políticas registradas. Clientes, OS e vendas restringem acesso à empresa obtida da sessão e às permissões do usuário.
- Metadados e arquivos de backup possuem política restritiva que exige administrador e a empresa da sessão.
- Nenhuma view pública legível por `authenticated` sem `security_invoker=true` foi encontrada.
- Tabelas internas sem política, como a fila WhatsApp e identidades de login, permanecem com RLS: clientes não recebem acesso às linhas por ausência de política permissiva.

RLS habilitado não demonstra sozinho a ausência de falhas em RPC, Edge Functions ou credenciais com bypass. Esta conferência não substitui a auditoria completa nem comprova todos os cenários entre empresas.

## Validação e distribuição

Quatro regressões direcionadas aprovadas na Windows Sandbox: `pc-ia-cobrancas`, `pc-report`, `pc-thermal` e `pc-report-tabs`. Todas terminaram com código 0, sem timeout e com os processos encerrados. Incluem verificações de código e execução das funções puras de relatório/configuração; não equivalem a testes manuais de impressora ou de toda a interface.

A execução usou rede desativada, ambiente allowlisted, fontes/ferramentas somente leitura, usuário LPAC e Job Object com limites de CPU, memória, processos, quota de disco e tempo. Nenhuma pasta gravável do host foi montada durante os testes. Somente metadados próprios foram exportados depois de encerrar os processos.

Checagens sintáticas, revisão do diff, verificação de espaços e varredura do patch por formatos conhecidos de segredo aprovadas. Os cinco fixtures Android modificados anteriormente e os demais arquivos do espelho foram preservados.

A primeira publicação deste patch continha somente fontes e testes. Na continuação, o instalador Windows 40.5.25 foi recompilado com dependências locais e ambiente sem credenciais de publicação. O arquivo `app.asar` foi conferido: 13 arquivos essenciais idênticos aos fontes corrigidos, dependências de produção presentes, zero arquivos de banco/credenciais proibidos e zero candidatos aos formatos de segredo pesquisados em 108 arquivos próprios. O manifesto do atualizador usa versão, tamanho e SHA-512 do novo instalador; também são distribuídos hashes SHA-256.

O APK permanece 20.5.23. Não houve alteração de políticas RLS nem migração em produção. O instalador permanece sem certificado comercial. A auditoria ampla anterior continua incompleta; a release não representa garantia absoluta de segurança nem teste manual de todos os fluxos/impressoras.
