# Sistema OS 40.5.9 / Android 20.5.9

Atualização final da configuração global e segura do assistente de IA.

- Armazena a chave global do Groq exclusivamente no cofre de segredos do Supabase, fora do código, do instalador, do APK, do banco de dados de negócio e do Git.
- Faz as funções protegidas do servidor consumirem a credencial diretamente do cofre, sem enviá-la ao PC ou ao celular.
- Mantém a personalização de chaves por empresa desativada; somente o Administrador Geral pode alterar essa política.
- Aplica limites econômicos de 3 solicitações por minuto e 300 por mês para cada empresa, além de 30 por minuto e 10.000 por mês globalmente.
- Limita cada resposta a 600 tokens para reduzir consumo inesperado.
- Revoga a credencial anterior antes de ativar a substituta.
- Mantém o provedor Groq e o modelo `openai/gpt-oss-20b` como configuração global.

Validação executada: verificação de sintaxe das funções, regressão automatizada de IA global e por empresa, cotas, notificações e assinaturas; confirmação do segredo no cofre; confirmação da configuração sanitizada no PostgreSQL/Supabase; e compilação final do instalador Windows.

Observação: o instalador ainda não possui assinatura Authenticode comercial. O arquivo oficial deve ser obtido somente nesta página de Releases e pode ser conferido pelo hash SHA-256 publicado.
