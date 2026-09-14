# Sistema OS 40.5.8 / Android 20.5.9

Atualização de segurança, administração da IA e identidade do produto.

- Reforça o isolamento multiempresa no PostgreSQL/Supabase, com políticas RLS, bloqueio explícito de acesso entre empresas e testes automatizados de tenant.
- Mantém os backups da empresa em armazenamento privado, separados por empresa, com validação de integridade antes da restauração e histórico de recuperação.
- Centraliza a IA no suporte: somente o Administrador Geral pode configurar a chave global, os limites econômicos e a permissão de personalização por empresa.
- As chaves de IA continuam fora do aplicativo e são armazenadas cifradas no servidor; o PC e o celular recebem apenas o estado sanitizado da integração.
- Adiciona limites atômicos por minuto e por mês, por empresa e globalmente, evitando loops e consumo inesperado da API.
- Na empresa, somente administradores autorizados podem configurar uma chave própria, e a configuração vale para todos os usuários daquela empresa.
- Adiciona a identificação oficial “Sistema OS by Aurevion Tecnologia” em Sobre, com copyright 2026, site e e-mail de contato.
- Substitui o símbolo do botão flutuante da IA por um ícone neutro que combina com qualquer identidade visual de empresa.
- Corrige a tipagem do cálculo de licença e elimina os avisos do lint remoto do banco.
- Preserva no histórico de pagamentos as ações distintas de visualizar, abrir o PDF e imprimir o comprovante térmico.
- Mantém a criação automática do perfil do cliente ao receber uma OS do celular e evita falsos avisos de rascunho recuperado.

Validação executada: 92 testes automatizados do PC, suíte completa do Android, 1.569 verificações locais de segurança, testes de adulteração de URL e isolamento entre empresas, auditoria de backup, lint remoto do PostgreSQL sem erros ou avisos e compilação final do instalador Windows.

Observação: o instalador ainda não possui assinatura Authenticode comercial. O arquivo oficial deve ser obtido somente nesta página de Releases e pode ser conferido pelo hash SHA-256 publicado.
