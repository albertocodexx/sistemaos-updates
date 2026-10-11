# Checklist de liberação do beta — Sistema OS

Data da revisão: 11/10/2026  
Versões avaliadas: PC 40.5.23 · Android 20.5.22

## Como usar

- `[x]` verificado por teste automatizado, inspeção de código ou build desta revisão.
- `[ ]` exige teste manual antes de convidar os primeiros clientes.
- `[~]` depende de conta, aparelho, credenciamento ou serviço externo do cliente.
- Um item crítico com `[ ]` impede beta público. No beta fechado, só pode permanecer pendente se a limitação estiver informada e houver plano de retorno.

## Critérios obrigatórios para abrir o beta fechado

- [x] Instalação, inicialização e atualização têm testes de regressão.
- [x] Login, sessão, permissões e isolamento por empresa têm testes dedicados.
- [x] Fluxos principais de OS, clientes, documentos, estoque, cobranças e sincronização têm cobertura automatizada.
- [x] Dependências de produção do PC e Android sem vulnerabilidades conhecidas na auditoria desta revisão.
- [x] Segredos fiscais, de pagamento e de IA permanecem no servidor, não no pacote do aplicativo.
- [ ] Fazer uma rodada manual completa em um PC limpo e em pelo menos dois aparelhos Android físicos.
- [ ] Restaurar o backup mais recente em ambiente separado e conferir contagens e arquivos críticos.
- [ ] Confirmar atualização real partindo da versão entregue ao primeiro grupo beta.
- [ ] Registrar canal, prazo e responsável para receber e responder erros dos participantes.

## 1. Instalação, abertura e atualização

- [x] PC abre sem depender da internet para os dados locais já sincronizados.
- [x] Android inicia sem recuperar rascunho inexistente.
- [x] Verificação obrigatória de atualização no PC e Android possui testes.
- [x] Reinício pós-atualização do PC tem tratamento para não ficar preso.
- [x] APK mantém package name e certificado compatíveis com a versão anterior.
- [ ] Instalar o Windows Setup em máquina sem ambiente de desenvolvimento.
- [ ] Atualizar PC e Android a partir da versão imediatamente anterior, preservando dados e sessão.
- [ ] Conferir avisos do SmartScreen e Play Protect e entregar instrução transparente ao beta.
- [ ] Confirmar abertura em telas pequenas, Full HD e escala do Windows em 125%/150%.

## 2. Conta, login, usuários e cargos

- [x] Login local/nuvem e renovação de sessão testados.
- [x] Usuário pertence a uma única empresa ativa em cada sessão.
- [x] Troca rápida de usuário não troca o tenant da empresa.
- [x] Criação automática exige nome e gera senha temporária forte.
- [x] Bloquear, pausar e excluir retiram o acesso conforme o estado da conta.
- [x] Administrador da empresa não ganha permissões de Administrador Geral.
- [x] Permissões de OS, clientes, estoque, financeiro, relatórios, usuários e fiscal são aplicadas no servidor.
- [ ] Testar manualmente cada cargo predefinido com uma conta real separada.
- [ ] Conferir que o último administrador da empresa não pode ser removido sem substituto.

## 3. Isolamento entre empresas e segurança

- [x] Consultas e escritas do Android têm testes de isolamento multiempresa.
- [x] Filas offline do PC são separadas por empresa.
- [x] Tabelas fiscais sensíveis têm RLS e acesso direto revogado para `anon`/`authenticated`.
- [x] Ações globais exigem Administrador Geral no servidor.
- [x] URLs, HTML externo, anexos e PDFs passam por validação antes de abrir/renderizar.
- [x] Webhooks usam assinatura/segredo e operações idempotentes.
- [x] Chaves privadas não são empacotadas no renderer nem no APK.
- [ ] Executar teste manual com duas empresas simultâneas tentando abrir IDs/URLs uma da outra.
- [ ] Revisar periodicamente logs de acesso negado, rate limits e eventos administrativos.

## 4. Clientes

- [x] Cadastro, edição e pesquisa parcial por nome/documento/telefone testados.
- [x] Cliente criado no celular pode sincronizar e ser reutilizado na digitação.
- [x] Histórico reúne documentos associados sem inflar a quantidade de arquivos.
- [x] Exclusões sincronizadas não reaparecem no outro dispositivo.
- [ ] Validar duplicidade de cliente com telefone/CPF iguais e nomes diferentes.
- [ ] Conferir exportação dos dados do cliente e tratamento de anexos grandes.

## 5. Ordem de serviço

- [x] Nova OS, rascunho, edição, checklist, fotos e conclusão têm testes.
- [x] Status autorizada aparece na lista de autorizadas.
- [x] Estados paga, aguardando pagamento na retirada e finalizada são separados.
- [x] Registro de pagamento permite forma, valor e preenchimento inicial pelo total.
- [x] Entrega preserva a OS original e pode registrar retorno.
- [x] Pesquisa por número, nome parcial e aparelho tem cobertura.
- [x] Alterações simultâneas não misturam empresa e usam reconciliação de sincronização.
- [ ] Testar duas pessoas editando a mesma OS ao mesmo tempo e validar a mensagem de conflito.
- [ ] Fazer uma OS completa no balcão: entrada → autorização → reparo → cobrança → assinatura → entrega.

## 6. Entregas, garantias e desbloqueios

- [x] Entrega, garantia e autorização de desbloqueio geram documentos separados.
- [x] Assinatura posterior e retorno de garantia preservam o documento original.
- [x] Modelo, marca e cor usam listas/autocompletar quando disponíveis.
- [x] Consulta de desbloqueio está separada do formulário de criação.
- [ ] Validar manualmente impressão A4 e térmica dos três tipos.
- [ ] Conferir texto jurídico padrão com responsável legal antes do beta comercial.

## 7. PDFs, assinatura, impressão e compartilhamento

- [x] PDF usa fundo claro independente do tema do aplicativo.
- [x] Linhas e áreas de assinatura têm regressões de layout.
- [x] Assinatura no Android usa orientação paisagem e volta à orientação normal ao fechar.
- [x] Cliente/assistência/duas vias podem ser escolhidos nos documentos com duas vias.
- [x] Abrir e compartilhar PDF têm testes no Android e no PC.
- [x] PDF/DANFE somente é liberado depois de autorizado pelo emissor correspondente.
- [ ] Assinar e compartilhar todos os tipos em Android físico com WhatsApp instalado.
- [ ] Imprimir amostras reais em A4 e térmica 80 mm, conferindo cortes e escala.

## 8. Estoque, peças, compras, vendas e preços

- [x] Aparelhos, peças, consumíveis e peças usadas têm testes.
- [x] Venda não regride de `Vendido` para `Reservado` após sincronização.
- [x] Compra e venda geram documento, consulta e compartilhamento.
- [x] Tabela de preços funciona no PC e Android.
- [x] Custos de peças e baixa de estoque participam dos relatórios.
- [ ] Testar devolução/cancelamento de venda e recomposição do estoque.
- [ ] Conferir importação/exportação com valores decimais e grande quantidade de itens.

## 9. Cobranças, parcelas e pagamentos de OS/venda

- [x] Cobranças possuem filtros Todos, OS e Venda no PC/Android.
- [x] Valor recebido, valor restante e parcelas evitam contagem duplicada.
- [x] Marcação paga no celular é reconciliada no PC.
- [x] Eventos em tempo real recebidos durante carregamento não são perdidos.
- [x] Idempotência impede confirmar a mesma cobrança duas vezes.
- [ ] Criar, pagar, cancelar e reabrir cobranças reais de OS e venda em dois dispositivos.
- [ ] Testar pagamento parcial, duas parcelas no mesmo dia e pagamento acima do saldo.

## 10. Mercado Pago e assinaturas do Sistema OS

- [x] Checkout, webhook assinado, conciliação e ativação de dias têm testes de aprovação, recusa e pendência.
- [x] Repetição com a mesma chave não duplica pedido nem licença.
- [x] Recarga fiscal só credita após confirmação do Mercado Pago.
- [x] Estorno/cancelamento possuem trilha financeira e não criam saldo livre.
- [x] Trial de 30 dias e Beta de 45 dias têm regras separadas.
- [x] Benefício fundador do beta possui prazo próprio.
- [ ] Fazer uma compra de valor mínimo em produção e estornar após conferir o ciclo completo.
- [ ] Confirmar bloqueio e renovação com o PC e o Android fechados durante o webhook.

## 11. WhatsApp, mensagens e assistente de IA

- [x] Módulo de WhatsApp não bloqueia a interface quando o provedor cai.
- [x] Anexos e PDFs passam por validação antes do envio.
- [x] Respostas da IA são escapadas e Markdown permitido é renderizado com segurança.
- [x] Uso de chave global/própria respeita a configuração do suporte e a permissão da empresa.
- [x] A IA exige confirmação antes de ações que alteram dados.
- [x] Rate limit e cota por empresa são aplicados no servidor.
- [ ] Testar sessão real do WhatsApp: QR, reconexão, texto, PDF e indisponibilidade temporária.
- [ ] Testar Meta API/Evolution somente se estiverem efetivamente contratadas e configuradas; não anunciar provedor ausente.

## 12. Sincronização e uso offline

- [x] OS, clientes, documentos, estoque, vendas e cobranças têm testes de sincronização.
- [x] Operações pendentes ficam associadas à empresa e ao usuário corretos.
- [x] Exclusão é propagada sem ressuscitar o registro antigo.
- [x] Fotos são armazenadas no diretório privado do app e não poluem a galeria.
- [x] Falhas temporárias preservam a fila e usam novas tentativas.
- [ ] Desligar internet durante criação, edição, assinatura, exclusão e pagamento; religar e conferir resultado.
- [ ] Simular servidor indisponível por período prolongado e medir crescimento/recuperação da fila.
- [ ] Definir e documentar a regra visível para conflito de edição simultânea.

## 13. Notificações, prazos e lembretes

- [x] Reparos, prazos e notificações têm testes no Android.
- [x] Navegação pela notificação abre a cobrança/OS correspondente.
- [x] Datas locais de documentos evitam mudança de dia por fuso horário.
- [ ] Validar permissões de notificação em Android 13 ou superior.
- [ ] Testar aparelho em economia de bateria e reinício do Android.
- [ ] Conferir lembretes perto do vencimento e cobrança vencida em aparelho físico.

## 14. Relatórios e financeiro

- [x] Relatórios separam visão geral e financeiro por permissão.
- [x] Receitas, custos, vendas e estoque usam dados isolados da empresa.
- [x] Datas e valores monetários têm normalização comum.
- [ ] Comparar manualmente um mês completo com OS, vendas, pagamentos parciais e cancelamentos conhecidos.
- [ ] Conferir gráficos com zero dados, um registro e grande volume.

## 15. Suporte e chamados

- [x] Motivo controla os campos exibidos sem perguntas repetidas.
- [x] Empresa e usuário são enviados pelo servidor, sem redigitação.
- [x] Histórico mostra aguardando, atendido, finalizado e cancelado.
- [x] Chamado finalizado/cancelado fica somente leitura para o cliente.
- [x] Anexos possuem validação de tipo, tamanho e empresa.
- [ ] Testar chamado sem login, com login e resposta do suporte em PC e Android.
- [ ] Definir prazo de resposta exibido aos participantes do beta.

## 16. Módulo fiscal — NFS-e, NF-e e NFC-e

- [x] Cadastro fiscal pode ser preenchido pelo administrador da empresa ou pelo suporte autorizado.
- [x] A tela explica onde obter IM, IE, credenciamento, códigos fiscais, A1 e CSC.
- [x] NFS-e usa cadastro municipal; NF-e/NFC-e usam inscrição estadual e códigos de produto.
- [x] Homologação NF-e/NFC-e roda no ambiente Test e não consome saldo/cortesia.
- [x] Produção só é liberada após autorização do teste e promoção da inscrição correspondente.
- [x] Carteira mostra cortesia, uso, saldo, preço e estimativa de notas possíveis.
- [x] Suporte adiciona/remove somente saldo fiscal com motivo, dupla confirmação, auditoria e idempotência.
- [x] Reserva e débito impedem gastar o mesmo saldo duas vezes.
- [x] DANFSe/DANFE e status podem ser abertos/compartilhados no PC e Android.
- [~] A primeira empresa precisa fornecer CNPJ legítimo, e-CNPJ A1, IM/IE credenciada, série/numeração e códigos confirmados pelo contador.
- [~] NFC-e exige CSC válido emitido pela SEFAZ da UF.
- [~] O conector NFE.io atual não ativa emissão por e-CPF A1; CPF de produtor rural permanece bloqueado até haver conector compatível.
- [ ] Executar a primeira homologação com empresa legítima voluntária e guardar somente os IDs/status, nunca a senha do A1.
- [ ] Emitir, consultar, baixar, compartilhar e cancelar uma nota de cada modelo em ambiente autorizado.

## 17. Backup, exportação e recuperação

- [x] Existe exportação dos dados PostgreSQL em formato restaurável e procedimento documentado.
- [x] Backup é criptografado e a senha não entra no Git, Drive ou documentação compartilhada.
- [x] Exportação de dados do cliente não inclui segredos da plataforma.
- [ ] Gerar novo backup após todas as migrações da versão candidata.
- [ ] Restaurar o backup em projeto separado e comparar empresas, usuários, OS, clientes, estoque, cobranças e notas.
- [ ] Copiar e conferir objetos privados do Storage; dump do banco sozinho não contém os arquivos.
- [ ] Registrar retenção, responsável e teste periódico de restauração.

## 18. Privacidade, auditoria e operação

- [x] Operações administrativas relevantes geram registros de auditoria.
- [x] Senhas, A1, tokens e chaves não aparecem em logs normais.
- [x] Suporte só acessa ações globais autenticado como Administrador Geral.
- [ ] Publicar termos, política de privacidade e canal de exclusão/exportação de dados.
- [ ] Definir política de retenção para anexos, logs, chamados e backups.
- [ ] Preparar aviso de incidente e rotação de credenciais.

## 19. Encerramento da rodada beta

- [ ] Congelar a versão candidata e não incluir novas funções durante a rodada final.
- [ ] Executar todos os testes automatizados novamente no commit exato da release.
- [ ] Gerar instalador, APK, hashes e fontes sanitizadas do mesmo commit.
- [ ] Conferir release/latest, download do APK e atualização automática.
- [ ] Entregar instruções de instalação, limitações conhecidas e como enviar erro com print/passos.
- [ ] Selecionar poucas empresas inicialmente e liberar em ondas.
- [ ] Revisar erros, desempenho, sincronização e suporte diariamente durante a primeira semana.

## Decisão

O código pode seguir para **beta fechado controlado** quando todos os itens manuais críticos das seções 1, 3, 5, 9, 10, 12, 16 e 17 forem concluídos. Emissão fiscal real deve continuar apresentada como dependente do cadastro e da autorização fiscal de cada empresa; o Sistema OS automatiza a integração, mas não cria inscrições nem credenciamentos legais.
