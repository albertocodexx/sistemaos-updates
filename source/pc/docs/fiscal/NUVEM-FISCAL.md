# Gateway fiscal: Nuvem Fiscal

> Histórico, **não é o gateway ativo em desenvolvimento**. O fluxo atual de cadastro do emitente usa NFE.io; veja [NFEIO.md](NFEIO.md). Não configure as credenciais abaixo nem remova a trava de emissão com base neste documento.

O Sistema OS usa a Nuvem Fiscal como gateway técnico previsto para NF-e, NFC-e e NFS-e. A conta da software house e as credenciais de API pertencem à Aurevion; cada empresa cliente preenche seus dados fiscais e envia **o próprio** certificado A1 na Configuração Fiscal. A Aurevion não precisa ter CNPJ emissor nem certificado A1 para desenvolver o produto.

## Estado desta implementação

- Cadastro fiscal da empresa e envio transitório do A1 para **sandbox** pelo administrador da própria empresa estão preparados no PC. O A1 e a senha não são gravados no banco ou em arquivos do Sistema OS. Somente data/validade do cadastro de teste são registradas.
- O envio só aparece habilitado quando as secrets `NUVEM_FISCAL_SANDBOX_CLIENT_ID` e `NUVEM_FISCAL_SANDBOX_CLIENT_SECRET` estão configuradas na Edge Function. Não colocar os valores no código, APK, instalador, repositório ou documentação.
- Emissão, cancelamento fiscal real, consulta de status e recebimento de DANFE/DANFSe pela Nuvem Fiscal **ainda não estão integrados**. Há um bloqueio explícito no código (`conectorNuvemValidado = false`): nem `FISCAL_EMISSOR_ATIVO` nem `NUVEM_FISCAL_EMISSAO_ATIVA` liberam cobrança ou emissão nesta etapa. Alterar esse bloqueio somente depois de implementar e testar o worker.
- O cadastro de A1 em sandbox não é homologação concluída e não converte rascunhos em notas autorizadas.
- Aplicar `20260927000100_emitente_nuvem_unico.sql` apenas após validar migrações anteriores e duplicidades fiscais. A migração impede que tenants distintos controlem o mesmo CPF/CNPJ emissor sob a credencial compartilhada do gateway.

## Próximos requisitos antes de vender a emissão

1. A Aurevion cria uma conta própria na Nuvem Fiscal e configura credenciais de **sandbox** somente nas secrets do servidor. Nenhum cliente precisa se cadastrar no gateway.
2. Integrar por tipo de documento os esquemas oficiais, configuração de serviço (incluindo numeração, regime e CSC quando aplicável), emissão idempotente, consulta/retentativa, cancelamento e arquivos oficiais. A tributação deve ser informada/validada pelo contador do cliente; não calcular alíquotas presumidas no Sistema OS.
3. Testar com uma empresa emissora que voluntariamente forneça seus dados e A1, primeiro em sandbox. Depois configurar credenciais de produção separadas, conferir o credenciamento fiscal e executar a primeira emissão real controlada.
4. Conferir a cota e o custo da conta do gateway antes de ativar os preços de 100 operações por empresa: a cota do provedor é compartilhada pela conta da Aurevion e também pode ser consumida por eventos como cancelamentos e downloads.
5. Validar backup restaurável, histórico de migrações e reconciliação de cobrança/cota antes de qualquer deploy comercial.

Referências oficiais: <https://dev.nuvemfiscal.com.br/docs/empresas/>, <https://dev.nuvemfiscal.com.br/docs/autenticacao/>, <https://dev.nuvemfiscal.com.br/docs/limites/>.
