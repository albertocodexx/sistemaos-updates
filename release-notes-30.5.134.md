# Sistema OS 30.5.134 / Android 1.0.90

Hotfix final de segurança, atualização e resiliência.

- isolamento multiempresa validado no PostgreSQL em todas as relações acessíveis;
- execução pública e anônima removida das funções privilegiadas do banco;
- edições concorrentes usam revisão esperada e não sobrescrevem silenciosamente outro dispositivo;
- IA limitada por empresa/credencial por minuto e por mês, com contador persistente sem gravar a chave;
- WhatsApp por QR libera a fila após timeout de validação ou envio, sem travar a interface;
- assinatura do celular permanece na fila offline e é reenviada sem duplicação;
- exclusão remota de documentos permanece após reiniciar o aplicativo;
- sincronização paginada recupera OS e estoque cadastrados em outros computadores;
- troca de conta e autenticação protegidas contra alteração de empresa por URL;
- Android corrigido para identificar a versão 1.0.90 também no modo de fallback do atualizador;
- backup local atômico e fila de backup em nuvem validados.

Testes desta versão: 86 arquivos de smoke test no PC, suíte completa do Android, 1.569 verificações locais de segurança e auditoria dinâmica de 36 relações multiempresa em produção.
