# NFE.io no Sistema OS — NFS-e, NF-e e NFC-e

O cliente deve preencher seu próprio cadastro fiscal na Configuração Fiscal do Sistema OS. A conta e a chave de integração NFE.io são da Aurevion e ficam somente no servidor. O cliente não precisa abrir o painel NFE.io nem receber uma chave de API.

## Implementado no código

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
- Cadastro separado das inscrições estaduais de NF-e (modelo 55) e NFC-e (modelo 65), sempre iniciado em ambiente `Test`.
- NFC-e exige ID e código CSC. O CSC só existe na requisição HTTPS de cadastro e não é salvo no banco, log, instalador ou APK.
- Teste automático de homologação após cadastro completo: emite um documento sem valor fiscal, acompanha o resultado assíncrono e só promove aquela inscrição para `Production` depois de autorização em `Test`.
- Homologação usa fila separada e não chama a reserva de cota; portanto não reduz cortesia nem saldo.
- A homologação aprovada não é repetida. Uma inscrição já em produção sem teste registrado é bloqueada para revisão, evitando enviar teste ao ambiente real.
- NF-e/NFC-e validam destinatário, itens, NCM, CFOP, unidade, origem, CST/CSOSN, PIS/COFINS e igualdade exata entre o total dos itens e o documento.
- O worker acompanha autorização, rejeição e cancelamento, aceita como oficial somente retorno de `Production`, baixa DANFE e XML e os guarda em Storage privado.
- A carteira mostra operações gratuitas restantes, saldo útil e a quantidade aproximada de novas notas pagas pelo saldo. O suporte ajusta somente a carteira fiscal, com confirmação dupla, justificativa, identificador idempotente e auditoria.

As ações dependem das secrets `NFEIO_INVOICE_KEY` e `NFEIO_ACCOUNT_ID` na Edge Function. Nenhum valor de segredo deve ser colocado no código, instalador, APK ou documentação.

## Estado do servidor antes da publicação desta versão

- `NFEIO_INVOICE_KEY`, `NFEIO_ACCOUNT_ID` e `FISCAL_EMISSOR_ATIVO=true` estão configurados nos segredos do projeto Supabase.
- A credencial foi validada diretamente na API oficial da NFE.io com resposta HTTP 200, sem registrar o valor da chave e sem emitir documento fiscal.
- O worker fiscal continua agendado a cada cinco minutos e o fluxo permanece idempotente e isolado por empresa.
- Nenhuma emissão real foi usada como teste nesta ativação. A primeira emissão de cada cliente continua bloqueada até o administrador da própria empresa concluir os dados fiscais, a inscrição municipal e o certificado/credenciais exigidos pelo município.
- A produção publicada até a versão 40.5.22 possui NFS-e. O código desta revisão acrescenta NF-e/NFC-e e só deve ser considerado disponível ao cliente depois da migração, Edge Functions e aplicativo da versão seguinte serem publicados e verificados.

## Pré-requisitos de cada empresa

- Preencher e validar o cadastro fiscal do emitente legítimo no Sistema OS.
- Para NFS-e, informar inscrição municipal e credenciais exigidas pela prefeitura.
- Para NF-e/NFC-e, a empresa precisa obter previamente IE e credenciamento diretamente na SEFAZ. A API registra os dados na NFE.io, mas não credencia o contribuinte na SEFAZ.
- Transmitir e-CNPJ A1 válido da própria empresa. Para NFC-e, informar também o CSC fornecido pela SEFAZ.
- Confirmar com o contador a numeração e os códigos fiscais dos itens. O Sistema OS não inventa ICMS, NCM ou CFOP.
- O conector atual não aceita e-CPF A1. CPF de produtor rural é preservado no cadastro, mas homologação e emissão automáticas ficam bloqueadas até existir conector oficialmente compatível.

Na ausência de qualquer uma dessas secrets, a aplicação falha fechada: mantém o pedido em `aguardando_configuracao` e não reserva cota nem cobra saldo fiscal.

Referências oficiais: [empresas](https://nfe.io/docs/documentacao/gerenciamento-empresas/api-empresas/), [inscrições municipais](https://nfe.io/docs/documentacao/gerenciamento-empresas/api-inscricoes-municipais/), [inscrições estaduais](https://nfe.io/docs/documentacao/gerenciamento-empresas/api-inscricoes-estaduais/), [certificados](https://nfe.io/docs/documentacao/gerenciamento-empresas/api-certificados/), [NF-e](https://nfe.io/docs/desenvolvedores/rest-api/nota-fiscal-de-produto-v2/product-invoices/) e [NFC-e](https://nfe.io/docs/documentacao/nota-fiscal-consumidor/integracao-api/nfc-primeiros-passos/).
