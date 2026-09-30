// src/termos-predefinidos.js
// Termos predefinidos para OS, Venda e Compra.
// Usados quando o usuário ativa "Usar termos predefinidos" nas configurações.
// Se o usuário tiver digitado termos próprios, eles têm prioridade.

'use strict';

const TERMOS_OS = `Ao assinar esta Ordem de Serviço, o cliente declara que:

1. Autoriza a análise do equipamento. O reparo e qualquer alteração de preço dependem de orçamento informado e aprovação prévia do cliente.

2. O orçamento deve indicar serviço, peças, valor, condições de pagamento e prazo. A garantia do serviço e das peças respeita os direitos previstos em lei.

3. Acessórios e condições do aparelho recebidos devem constar nesta OS. Recomenda-se ao cliente manter cópia dos seus dados antes de qualquer intervenção.

4. A assistência informará riscos específicos identificados na avaliação e registrará a autorização do cliente antes de procedimentos adicionais.

5. Quando o serviço estiver concluído, a assistência avisará o cliente para retirar o equipamento. A falta de retirada não transfere automaticamente sua propriedade.

6. A assinatura confirma o recebimento desta OS e a ciência destas condições; a aprovação do orçamento será registrada separadamente quando necessária.`;

const TERMOS_VENDA = `Ao adquirir este equipamento, o comprador declara que:

1. Recebeu e conferiu o funcionamento, estado físico e acessórios descritos.

2. A garantia cobre defeito de funcionamento ligado ao serviço ou às peças, durante o prazo informado. Não cobre quedas, líquidos, oxidação, mau uso, desgaste, terceiros, dados ou contas bloqueadas.

3. Equipamento seminovo pode apresentar sinais normais de uso.

4. Após a entrega, guarda, uso e conservação passam a ser responsabilidade do comprador.

5. A assinatura confirma o recebimento e a aceitação destas condições.`;

const TERMOS_COMPRA = `O vendedor declara que:

1. É proprietário ou autorizado a vender o equipamento e responde por sua origem lícita.

2. Informou defeitos, histórico, quedas, líquidos, oxidação, bloqueios e qualquer condição conhecida, inclusive aparelho sem sinal de vida.

3. Entregou senhas e acessos necessários. Se não puder testar agora, compromete-se a informar a senha e remover contas vinculadas quando o aparelho voltar a ligar.

4. Omissão de defeito, bloqueio, informação relevante ou origem irregular gera responsabilidade pelos prejuízos e medidas legais cabíveis.

5. A propriedade é transferida ao comprador após o pagamento; a assinatura confirma a veracidade das informações e a aceitação destas condições.`;

// Declaração fixa do Comprovante de Retirada/Autorização (aba "Entregas").
// Diferente de TERMOS_OS/COMPRA/VENDA acima (que são o texto de "termos e
// condições", editável pelo usuário em Configurações), esta declaração NÃO
// é editável na tela — é fixa por decisão de arquitetura (ver
// PROMPT-CELULAR-aba-entregas.md, item 2: "texto pré-definido, não editável
// pelo usuário"). Ainda assim mora aqui, junto dos outros textos jurídicos
// do sistema, para manter um único lugar de referência caso precise ser
// revisada no futuro — e porque o próprio texto do momento da assinatura
// é salvo junto do comprovante (`declaracao`), então mudar este texto aqui
// nunca altera comprovantes já assinados, só os próximos.
const DECLARACAO_ENTREGA = `Declaro, para os devidos fins, ser proprietário do aparelho referente à OS acima informada, ou estar devidamente autorizado por seu proprietário a retirá-lo neste estabelecimento. Confirmo o recebimento do equipamento nas condições registradas neste comprovante e declaro que li, compreendi e aceitei os termos, o prazo e as condições da garantia aqui apresentados.`;

const TERMOS_GARANTIA = `1. COBERTURA — Cobre apenas o serviço executado e/ou a peça substituída indicados neste comprovante, dentro do prazo informado.

2. PRAZO — Contado a partir da data de entrega do aparelho, de forma corrida, encerrando-se na data limite indicada.

3. NÃO COBRE — Quedas, impactos, líquidos, umidade, oxidação, picos de energia, mau uso, desgaste natural (bateria, conectores, botões), violação por terceiros, defeitos não relacionados ao serviço, ou danos estéticos.

4. PERDA DA GARANTIA — Ocorre em caso de violação do lacre/componentes ou se o aparelho for levado a outra assistência antes do retorno a esta empresa.

5. COMO ACIONAR — Apresentar este comprovante (ou o nº da OS) e levar o aparelho para avaliação presencial nesta assistência.

6. REINCIDÊNCIA — Se o mesmo defeito voltar por causa coberta, o reparo é refeito sem custo. Defeitos novos não são cobertos.

7. DADOS — Não cobre perda de dados/configurações; backup é responsabilidade do cliente.

Ao receber este comprovante, o cliente declara estar ciente e de acordo com as condições acima.`;

module.exports = { TERMOS_OS, TERMOS_COMPRA, TERMOS_VENDA, DECLARACAO_ENTREGA, TERMOS_GARANTIA };
