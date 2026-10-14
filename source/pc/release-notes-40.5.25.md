# Sistema OS 40.5.25

- Corrigida a indicação da aba ativa em Visão geral, Financeiro e outras abas internas.
- Cobranças carrega e sincroniza automaticamente ao abrir a aba.
- Assistente usa o valor total/orçamento da OS e não confunde valor ausente com serviço gratuito.
- Comprovantes térmicos de OS, pagamentos e desbloqueios permitem escolher 58/80 mm, pré-visualizar e imprimir. O administrador define o padrão da empresa, que também vale para etiquetas e é sincronizado entre computadores.
- Exportar Painel gera relatório gerencial próprio, com período e dados, sem capturar botões da interface. Valores financeiros respeitam a permissão do usuário.
- Instalador mostra a versão correta e direciona o suporte para a Aurevion. O pacote inclui apenas diretórios necessários e exclui arquivos de credenciais/bancos locais.
- Incluídas as correções de fontes anteriores para sessão/autorização, sincronização e escape de conteúdo do PC.

Validação: quatro regressões direcionadas passaram na sandbox, além da revisão de sintaxe, diff e do conteúdo empacotado. Não constitui certificação de toda a auditoria de segurança nem teste de todos os equipamentos de impressão.

Android permanece na versão 20.5.23, sem recompilação neste pacote. A conferência RLS do banco em 14/10/2026 encontrou 59/59 tabelas verificadas com RLS habilitado; nenhuma política foi alterada por esta release.
