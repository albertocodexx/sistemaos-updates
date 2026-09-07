# Segurança comercial — Sistema OS

## O que pode existir no PC e no APK

- URL pública do Supabase.
- Chave publishable/anon do Supabase.
- Sessão do usuário armazenada de forma protegida no PC e renovada pelo Supabase.
- Identificador aleatório da instalação; o banco registra apenas o SHA-256 desse identificador.

Esses valores não concedem acesso aos dados sem uma sessão válida e RLS.

## O que nunca pode ser distribuído

- `service_role`, secret key, JWT secret e senha do banco.
- Access Token do Mercado Pago.
- Chave Groq ou outro token de infraestrutura.
- Token GitHub de publicação.
- Chaves de criptografia das integrações.

Segredos de integração ficam exclusivamente no backend. A interface mostra apenas conta mascarada, status e data de verificação.

## Controles implementados

- Login por código de empresa + usuário + senha; o e-mail técnico não aparece na interface.
- Contexto de empresa e licença é obtido pelo servidor, não por `empresa_id` enviado pelo cliente.
- Status efetivo de trial, vencimento, tolerância e bloqueio usa hora do banco.
- Operações globais exigem administrador global e registram auditoria.
- Operações da empresa usam as políticas RLS e permissões do perfil.
- APK só instala atualização cujo SHA-256 publicado coincide com o arquivo baixado.
- Dados de OS, arquivos e fotos existentes não são removidos pelas migrations comerciais.

## Rotação e incidente

1. Revogue imediatamente o segredo comprometido no provedor.
2. Atualize o segredo no cofre da Edge Function, nunca no aplicativo.
3. Publique uma nova versão apenas se houver código cliente envolvido.
4. Registre o incidente no log de suporte sem copiar senhas, tokens ou anexos sensíveis.
5. Verifique auditoria, integrações conectadas e usuários administrativos.
