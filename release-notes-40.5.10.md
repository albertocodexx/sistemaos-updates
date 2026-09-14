# Sistema OS 40.5.10 / Android 20.5.9

Correção do reconhecimento da IA global, identidade do assistente e autorização de ações.

- A abertura do chat consulta o estado efetivo da integração no Supabase e reconhece a chave global protegida, eliminando o falso aviso de que a IA não está configurada.
- Falhas temporárias de consulta ao servidor não são mais apresentadas como ausência de configuração.
- O cabeçalho do assistente passa a usar a mesma logo neutra de IA do botão flutuante, no lugar da estrela antiga.
- Consultas da IA permanecem somente leitura e enxergam apenas os módulos permitidos ao cargo autenticado.
- Criar ou alterar OS, excluir OS, enviar mensagem, adicionar custos e alterar cobrança continuam limitados pela permissão específica do cargo.
- Toda ação proposta exibe um cartão de revisão e exige confirmação explícita antes de qualquer alteração ou envio.
- O processo principal também rejeita chamadas de ação sem a confirmação originada pelo cartão da IA.
- Exclusões continuam exigindo a autorização adicional definida pela política da empresa.
- Todas as ações confirmadas permanecem registradas na auditoria.

Validação executada: suíte completa de 92 arquivos de testes, 1.569 verificações locais de autorização e segurança, testes de IA global/empresa, cotas, isolamento, assinaturas, pagamentos, sincronização, sintaxe e compilação final do instalador Windows.

Observação: o instalador ainda não possui assinatura Authenticode comercial. Use somente os arquivos oficiais desta página de Releases e confira o hash SHA-256 publicado.
