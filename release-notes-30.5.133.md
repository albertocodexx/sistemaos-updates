# Sistema OS 30.5.133 / Android 1.0.89

Atualização de segurança, sincronização e confiabilidade.

- isolamento multiempresa validado no PostgreSQL em todas as relações acessíveis;
- execução pública e anônima removida das funções privilegiadas do banco;
- assinatura do celular preservada offline e reenviada sem duplicação;
- exclusão remota de documentos permanece após reiniciar o aplicativo;
- sincronização paginada recupera OS e estoque cadastrados em outros computadores;
- troca de conta e autenticação protegidas contra alteração de empresa por URL;
- mensagens de erro das funções remotas não expõem detalhes internos;
- backup local atômico e fila de backup em nuvem validados.

Testes desta versão: 85 arquivos de smoke test no PC, suíte completa do Android, 1.569 verificações locais de segurança e auditoria dinâmica de 36 relações multiempresa em produção.
