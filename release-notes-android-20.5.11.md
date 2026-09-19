# Sistema OS Android 20.5.11

Atualização corretiva do aplicativo móvel.

- impede o aviso falso de rascunho recuperado quando havia somente termos ou IDs preenchidos automaticamente;
- permite instalar o aplicativo em tablets e Chromebooks sem câmera, mantendo o leitor QR disponível em aparelhos compatíveis;
- evita espera indefinida ao baixar um PDF remoto para compartilhar;
- corrige a normalização do nome de arquivos PDF em qualquer idioma do Android;
- bloqueia scripts e eventos vindos do conteúdo HTML durante a geração e impressão de documentos;
- acrescenta um teste de inicialização completa dos 61 scripts do aplicativo.

Validações executadas: suíte completa do Android, smoke de inicialização, Android Lint, build Release com R8, assinatura do APK, versão/código do pacote e auditoria de dependências de produção.
