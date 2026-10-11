# Roteiro manual de liberação do beta — Sistema OS

Este roteiro complementa o checklist geral. Execute no mesmo instalador/APK que será entregue ao cliente e anexe print, vídeo curto ou protocolo para cada falha.

## Registro da rodada

- Versão PC: ____________________
- Versão Android: _______________
- Commit/release: _______________
- Data e hora: __________________
- Responsável: __________________
- PC/Windows/escala: ____________
- Android 1/modelo/versão: ______
- Android 2/modelo/versão: ______
- Impressora A4/térmica: ________
- Empresa A: ____________________
- Empresa B: ____________________

## Regra de severidade

- **P0:** vazamento entre empresas, cobrança/saldo indevido, perda irrecuperável de dados ou execução de código. Interromper o beta.
- **P1:** login, OS, sincronização, pagamento, atualização ou emissão fiscal principal não funciona. Corrigir antes de liberar.
- **P2:** função secundária falha, mas há contorno seguro e documentado. Pode liberar somente no beta fechado com aviso.
- **P3:** texto, alinhamento ou detalhe visual sem impacto operacional. Registrar para a próxima versão.

## Preparação obrigatória

- [ ] Baixar instalador e APK da release pública, sem usar arquivos da pasta de desenvolvimento.
- [ ] Conferir SHA-256 dos dois arquivos.
- [ ] Preparar duas empresas isoladas (A e B), cada uma com administrador e usuário comum.
- [ ] Preparar cargos: Administrador, Técnico, Atendente e Financeiro.
- [ ] Preparar internet que possa ser desligada durante os testes.
- [ ] Usar dados fictícios em homologação. Nunca colocar certificado, token ou senha em print/relatório.
- [ ] Se testar produção fiscal, usar somente empresa legítima e autorizada.

## M01 — Instalação limpa do PC

1. [ ] Desinstalar versão de teste de uma máquina sem dados importantes.
2. [ ] Instalar o Setup oficial e abrir pelo atalho.
3. [ ] Confirmar logo, versão, tela de login e ausência de console/janela extra.
4. [ ] Fechar a janela e reabrir pelo ícone da bandeja.

**Esperado:** instala, abre e fecha sem erro; fechar a janela não encerra o atendimento quando o modo em segundo plano estiver ativo.

## M02 — Instalação e atualização do Android

1. [ ] Instalar o APK oficial em dois aparelhos.
2. [ ] Negar e depois permitir notificações/arquivos quando solicitado.
3. [ ] Atualizar por cima da versão anterior sem desinstalar.
4. [ ] Abrir a galeria do aparelho.

**Esperado:** sessão e dados locais preservados; nenhuma logo/foto interna aparece na galeria; versão correta é mostrada.

## M03 — Login, sessão e bloqueio

1. [ ] Entrar com administrador, sair e entrar com usuário comum.
2. [ ] Errar a senha repetidamente e conferir o bloqueio temporário.
3. [ ] Bloquear o usuário pelo administrador e tentar entrar no PC e Android.
4. [ ] Gerar senha temporária, entrar e trocar a senha.
5. [ ] Excluir o usuário bloqueado e tentar reutilizar a sessão antiga.

**Esperado:** somente credenciais ativas entram; sessão bloqueada/excluída perde acesso; senha temporária exige troca conforme a política.

## M04 — Isolamento entre empresas

1. [ ] Criar OS, cliente, cobrança, venda e anexo exclusivos na Empresa A.
2. [ ] Copiar IDs/links internos desses registros.
3. [ ] Entrar na Empresa B e tentar pesquisar/abrir os IDs e links.
4. [ ] Repetir no PC e Android, inclusive após trocar rapidamente de conta.

**Esperado:** a Empresa B não vê existência, dados, arquivos, valores ou mensagens da Empresa A. Qualquer vazamento é P0.

## M05 — Cargos e permissões

1. [ ] Entrar separadamente como Administrador, Técnico, Atendente e Financeiro.
2. [ ] Tentar ver/criar/editar/excluir em OS, clientes, estoque, financeiro, relatórios, usuários e fiscal.
3. [ ] Tentar chamar a mesma ação por busca, atalho, IA e tela de detalhes.

**Esperado:** menu e servidor aplicam a mesma permissão; esconder botão não é a única barreira.

## M06 — Clientes e pesquisa

1. [ ] Criar cliente “Alberto Parma Couto” no celular.
2. [ ] Buscar por “Alberto”, telefone e trecho do documento no celular e PC.
3. [ ] Criar nova OS digitando parte do nome e selecionar o cliente existente.
4. [ ] Abrir o perfil e conferir OS, vendas, entregas, garantias e arquivos.

**Esperado:** pesquisa parcial encontra o cliente; não cria duplicado silencioso; contagem de arquivos é real.

## M07 — Jornada completa da OS

1. [ ] Criar OS com cliente, aparelho, checklist, fotos, orçamento, prazo e parcelas.
2. [ ] Autorizar e conferir a subaba Autorizadas.
3. [ ] Alterar status de reparo, peças e custo.
4. [ ] Registrar pagamento parcial e depois o restante, informando forma de pagamento.
5. [ ] Assinar, gerar PDF, entregar e finalizar.

**Esperado:** cada status aparece na lista correta; valores recebido/restante fecham exatamente; OS finalizada conserva histórico e documentos.

## M08 — Edição simultânea

1. [ ] Abrir a mesma OS no PC e Android.
2. [ ] Alterar campos diferentes e salvar quase ao mesmo tempo.
3. [ ] Repetir alterando o mesmo campo nos dois dispositivos.

**Esperado:** nenhuma alteração some silenciosamente; conflito de revisão é informado ou reconciliado por regra conhecida; fila não trava.

## M09 — PC offline e recuperação

1. [ ] Desligar a internet.
2. [ ] Criar/editar OS, cliente, assinatura e cobrança permitidas offline.
3. [ ] Fechar e reabrir o aplicativo.
4. [ ] Ligar a internet e sincronizar.

**Esperado:** pendências permanecem após reinício, são enviadas uma vez e ficam na empresa original.

## M10 — Android offline e recuperação

1. [ ] Repetir criação, edição, assinatura, foto e exclusão sem internet.
2. [ ] Forçar encerramento do app e reabrir.
3. [ ] Trocar de conta antes de restaurar a internet.
4. [ ] Voltar à conta original e sincronizar.

**Esperado:** fila sobrevive, não atravessa contas, não duplica e confirma somente depois do servidor.

## M11 — Assinaturas, PDFs e compartilhamento

1. [ ] Assinar OS, compra, venda, entrega, garantia e desbloqueio.
2. [ ] Confirmar tela de assinatura em paisagem e retorno para retrato.
3. [ ] Gerar via cliente, via assistência e duas vias.
4. [ ] Abrir e compartilhar cada PDF com mensagem pronta.
5. [ ] Imprimir A4 e térmico 80 mm.

**Esperado:** fundo branco, assinatura legível e proporcional, linhas alinhadas, uma via por folha e mensagem presente.

## M12 — Entrega, garantia e desbloqueio

1. [ ] Preencher/assinar entrega; registrar retorno sem sobrescrever a entrega original.
2. [ ] Emitir garantia, registrar retorno e conferir prazo.
3. [ ] Criar desbloqueio com marca/modelo/cor, riscos e assinatura.

**Esperado:** documentos e ciclos permanecem separados, pesquisáveis, compartilháveis e sincronizados.

## M13 — Estoque, compra e venda

1. [ ] Cadastrar aparelho, peças e consumíveis no PC.
2. [ ] Vincular peças/custos ao aparelho e marcar vendido.
3. [ ] Conferir Android, fechar/reabrir e sincronizar novamente.
4. [ ] Fazer venda e cancelamento/devolução controlada.

**Esperado:** vendido não volta para reservado; custos e quantidades batem; cancelamento recompõe apenas o que deve.

## M14 — Tabela de preços

1. [ ] Criar, editar e excluir preço no PC.
2. [ ] Pesquisar no Android e usar no orçamento.
3. [ ] Repetir com nomes parecidos e valores com centavos.

**Esperado:** CRUD e pesquisa sincronizam sem misturar empresas; valor aplicado é o selecionado.

## M15 — Cobranças e parcelas PC/Android

1. [ ] Criar cobrança de OS e de venda no celular.
2. [ ] Conferir nas abas Todos, OS e Venda no PC.
3. [ ] Criar duas parcelas, pagar uma e conferir o restante.
4. [ ] Marcar a segunda paga no Android e observar o PC.
5. [ ] Tentar pagar duas vezes e pagar valor acima do restante.

**Esperado:** R$ 175 pagos de R$ 350 deixam R$ 175; repetição não duplica; os dois dispositivos convergem.

## M16 — Mercado Pago

1. [ ] Em homologação, executar aprovado, recusado, pendente, expirado e cancelado.
2. [ ] Repetir o webhook do pagamento aprovado.
3. [ ] Fechar PC e Android antes da confirmação e reabrir depois.
4. [ ] Em produção, se autorizado, fazer compra mínima e estorno.

**Esperado:** licença/saldo ativam uma vez; recusado não ativa; confirmação funciona com apps fechados; estorno é auditável.

## M17 — Trial, Beta e planos

1. [ ] Criar empresa Trial 30 e empresa Beta 45.
2. [ ] Conferir funções, cotas e vencimento.
3. [ ] Simular vencimento no ambiente de teste.
4. [ ] Renovar e trocar de plano.

**Esperado:** acesso bloqueia no vencimento e volta após pagamento confirmado; benefício beta respeita o prazo configurado.

## M18 — WhatsApp e mensagens

1. [ ] Conectar por QR, enviar texto e PDF.
2. [ ] Derrubar a internet/encerrar sessão e usar OS normalmente.
3. [ ] Reconectar e conferir pendências.
4. [ ] Se Meta/Evolution estiver configurada, testar cada provedor separadamente.

**Esperado:** queda do WhatsApp não trava o sistema; envio mostra sucesso/erro real; anexos corretos chegam ao destinatário.

## M19 — Assistente de IA

1. [ ] Perguntar por OS, cliente, estoque, cobrança e uso do sistema.
2. [ ] Pedir alteração de status/pagamento e negar a confirmação.
3. [ ] Confirmar uma ação permitida e tentar outra sem permissão.
4. [ ] Testar resposta longa, Markdown, cota esgotada e provedor indisponível.

**Esperado:** não inventa ID/valor, mantém contexto, pede confirmação, respeita permissões e exibe erro completo sem executar parcialmente.

## M20 — Cadastro fiscal da empresa

1. [ ] Abrir Configurações → Fiscal e seguir o tutorial da tela.
2. [ ] Salvar dados incompletos e observar orientação sem liberar emissão.
3. [ ] Preencher dados oficiais, IM/IE, regime e códigos do contador.
4. [ ] Enviar o A1 pelo formulário seguro.

**Esperado:** dados inválidos são apontados; senha/arquivo A1 não reaparecem nem entram em logs; suporte pode preencher somente a empresa selecionada.

## M21 — Homologação e documentos fiscais

1. [ ] Cadastrar a empresa/inscrição no emissor pelo Sistema OS.
2. [ ] Rodar homologação automática de NF-e e NFC-e.
3. [ ] Confirmar que o teste não consome saldo nem cota.
4. [ ] Após aprovação, emitir NFS-e, NF-e e NFC-e autorizadas.
5. [ ] Consultar, baixar/compartilhar DANFSe/DANFE e cancelar conforme permitido.

**Esperado:** teste fica no ambiente Test; produção só libera o modelo aprovado; chave, status e documento oficial aparecem no PC/Android.

## M22 — Carteira fiscal e concorrência

1. [ ] Adicionar saldo pelo Mercado Pago e conferir valor exato.
2. [ ] Suporte adicionar/remover saldo com motivo.
3. [ ] Tentar remover acima do disponível e repetir a mesma operação.
4. [ ] Disparar duas emissões ao mesmo tempo com saldo para uma.

**Esperado:** não há saldo sem pagamento/ação auditada; idempotência evita duplicação; somente uma reserva consome o último saldo.

## M23 — Notificações e prazos

1. [ ] Criar prazo próximo, cobrança para hoje e cobrança vencida.
2. [ ] Fechar o app, reiniciar o celular e ativar economia de bateria.
3. [ ] Tocar cada notificação.

**Esperado:** texto e horário corretos; toque abre registro certo; não notifica outra empresa/usuário.

## M24 — Suporte e chamados

1. [ ] Abrir chamado sem conta e com conta, escolhendo motivos diferentes.
2. [ ] Anexar print válido e tentar tipo/tamanho inválido.
3. [ ] Responder como suporte e mudar status.
4. [ ] Finalizar/cancelar e tentar enviar nova mensagem.

**Esperado:** campos não repetem identidade; histórico/status sincronizam; finalizado/cancelado fica somente leitura para o cliente.

## M25 — Relatórios e financeiro

1. [ ] Preparar mês com OS paga/parcial/cancelada, venda, compra e custo de peça.
2. [ ] Comparar total recebido, a receber, custo e lucro com cálculo manual.
3. [ ] Repetir com filtro sem dados e com outra empresa.

**Esperado:** sem duplicar parcelas; valores e datas coerentes; nenhum dado da outra empresa.

## M26 — Backup, exportação e restauração

1. [ ] Gerar backup do banco e copiar objetos privados necessários do Storage.
2. [ ] Exportar todos os dados de um cliente.
3. [ ] Restaurar em ambiente separado.
4. [ ] Comparar contagens de empresas, usuários, clientes, OS, estoque, cobranças, notas e arquivos.

**Esperado:** restauração abre e consulta dados/arquivos; backup criptografado; senha guardada fora do pacote compartilhado.

## M27 — Temas, responsividade e acessibilidade

1. [ ] Percorrer todas as telas no tema claro e escuro.
2. [ ] Testar resolução pequena, Full HD e escala 125%/150%.
3. [ ] Usar Tab/Shift+Tab/Enter/Esc nos modais e formulários.
4. [ ] Conferir mensagens de erro, foco e contraste.

**Esperado:** nada cortado/sobreposto; fundo não rola atrás do modal; foco visível; texto legível.

## M28 — Desempenho e volume

1. [ ] Testar com pelo menos 1.000 OS, 1.000 clientes e centenas de itens.
2. [ ] Medir abertura, pesquisa, rolagem, sincronização e geração de relatório.
3. [ ] Enviar fotos grandes e observar memória.

**Esperado:** interface continua responsiva, busca não congela e fotos são comprimidas antes do envio.

## M29 — Exclusões e retenção

1. [ ] Excluir OS, cliente permitido, estoque, cobrança/chamado permitido e usuário.
2. [ ] Conferir outro dispositivo depois de sincronizar.
3. [ ] Fechar/reabrir ambos e conferir novamente.

**Esperado:** exclusão autorizada permanece; registros legais/financeiros protegidos seguem a regra de retenção; arquivos órfãos são tratados.

## M30 — Release final

1. [ ] Rodar novamente as suítes automatizadas no commit final.
2. [ ] Gerar Setup, APK, fontes sanitizadas e checksums do mesmo commit.
3. [ ] Baixar os artefatos publicados e comparar hashes.
4. [ ] Testar atualização automática usando a release publicada.
5. [ ] Confirmar que nenhum `.env`, certificado, dump aberto, token ou senha está nos pacotes.

**Esperado:** artefatos reproduzem a versão testada, atualização aponta para a release correta e não há segredo distribuído.

## Aprovação da rodada

- [ ] Nenhum P0 aberto.
- [ ] Nenhum P1 aberto.
- [ ] P2 registrados com contorno, responsável e prazo.
- [ ] Itens fiscais externos claramente informados ao primeiro cliente.
- [ ] Backup restaurado com sucesso antes da publicação.
- [ ] Responsável autorizou a release exata testada.

Resultado: [ ] APROVADO  [ ] REPROVADO  [ ] APROVADO SOMENTE PARA BETA FECHADO

Observações e links de evidência:

________________________________________________________________________

________________________________________________________________________
