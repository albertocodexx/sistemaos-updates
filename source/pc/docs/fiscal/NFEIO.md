# NFE.io no Sistema OS — estado e critérios de liberação

O cliente deve preencher seu próprio cadastro fiscal na Configuração Fiscal do Sistema OS. A conta e a chave de integração NFE.io são da Aurevion e ficam somente no servidor. O cliente não precisa abrir o painel NFE.io nem receber uma chave de API.

## Implementado localmente

- Cadastro fiscal no PC pelo administrador da empresa.
- Cadastro do CNPJ como empresa do emissor, com conferência de CNPJ e prevenção de vínculo duplicado entre tenants.
- Cadastro da inscrição municipal em ambiente **Development**, com série e próximo número de RPS informados pela empresa/contador.
- Envio transitório do e-CNPJ A1 da própria empresa ao emissor. Arquivo e senha não são persistidos no banco do Sistema OS; a confirmação de validade é guardada.
- Ativação da inscrição municipal em **Production** pelo administrador da própria empresa, no Sistema OS, após conferência da inscrição, A1 vigente e confirmação de titularidade. Credenciais municipais opcionais são transmitidas ao emissor, não armazenadas. Não é necessário um CNPJ da Aurevion nem emitir nota de teste para cadastrar um cliente.
- Prévia de status e proteção para prestador CPF: a API escolhida para este fluxo de NFS-e exige CNPJ/e-CNPJ A1. Cadastro CPF pode ser salvo, mas não habilita emissão.
- O adaptador de NFS-e preserva o CPF/CNPJ do tomador como texto (inclusive zeros à esquerda), valida dados e não interpreta respostas HTTP 202/204 como autorização ou cancelamento final.
- Worker idempotente consulta pelo `externalId` antes de emitir, acompanha autorização/rejeição/cancelamento e aceita como oficial somente resposta do ambiente `Production`.
- PDF e XML oficiais são baixados, validados e guardados no bucket privado `documentos-fiscais`; a interface entrega somente URL assinada temporária.
- Cancelamento exige justificativa e confirmação do usuário, fica pendente até o emissor confirmar e preserva o histórico.

As ações dependem das secrets `NFEIO_INVOICE_KEY` e `NFEIO_ACCOUNT_ID` na Edge Function. Nenhum valor de segredo deve ser colocado no código, instalador, APK ou documentação.

## Dependências para ativação no servidor

- NF-e e NFC-e: são documentos diferentes de NFS-e e exigem conector/validações próprios; o formulário atual não os emite.
- Configurar no Supabase as secrets `NFEIO_INVOICE_KEY`, `NFEIO_ACCOUNT_ID` e `FISCAL_WORKER_CRON_SECRET`, agendar o worker e só então definir `FISCAL_EMISSOR_ATIVO=true`.
- Aplicar e conferir as migrações fiscais após backup restaurável e reconciliação do histórico remoto.
- Fazer uma emissão de homologação e uma de produção com emitente legítimo e dados autorizados antes de disponibilizar o botão para clientes.

Na ausência de qualquer uma dessas secrets, a aplicação falha fechada: mantém o pedido em `aguardando_configuracao` e não reserva cota nem cobra saldo fiscal.

Referências oficiais: [empresas](https://nfe.io/docs/documentacao/gerenciamento-empresas/api-empresas/), [inscrições municipais](https://nfe.io/docs/documentacao/gerenciamento-empresas/api-inscricoes-municipais/), [certificados](https://nfe.io/docs/documentacao/gerenciamento-empresas/api-certificados/) e [primeiros passos NFS-e](https://nfe.io/docs/documentacao/nota-fiscal-servico-eletronica/primeiros-passos/).
