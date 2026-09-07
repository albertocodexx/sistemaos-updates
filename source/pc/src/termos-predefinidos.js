// src/termos-predefinidos.js
// Termos predefinidos para OS, Venda e Compra.
// Usados quando o usuário ativa "Usar termos predefinidos" nas configurações.
// Se o usuário tiver digitado termos próprios, eles têm prioridade.

'use strict';

const TERMOS_OS = `Ao assinar esta Ordem de Serviço, o cliente declara que:

1. Autoriza a análise, a abertura do equipamento e os procedimentos necessários. Orçamento e prazo, quando informados, são estimados.

2. A garantia cobre somente o serviço e as peças descritos, no prazo indicado. Não cobre quedas, líquidos, oxidação, mau uso, desgaste, surtos, terceiros ou danos posteriores.

3. Backup, senhas e bloqueios necessários são responsabilidade do cliente. A assistência não responde por dados, contas, chips ou acessórios não descritos nesta OS.

4. Avarias ou defeitos preexistentes podem causar novas falhas durante ou após o reparo, sem responsabilidade da assistência por esses efeitos.

5. Em iPhones, a abertura envolve risco de dano à tela. Em aparelhos Android com tampa traseira já trincada, a avaria pode se agravar ou causar quebra. A assistência não responde por danos decorrentes da fragilidade ou avaria preexistente.

6. Eventual ajuste no preço estimado será informado previamente ao cliente e dependerá de sua aprovação antes da continuidade do serviço.

7. Equipamento não retirado em até 90 dias após o aviso de conclusão poderá ser considerado abandonado, conforme a lei.

8. A assinatura confirma a leitura e a aceitação destas condições.`;

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

// Termos padrão do Comprovante de Garantia (aba Garantia). Resumido de
// propósito: cobre os pontos essenciais (cobertura, prazo, exclusões,
// perda de direito, como acionar e dados) em linguagem direta, para caber
// numa única página em fonte legível junto com o resto do documento.
const TERMOS_GARANTIA = `1. COBERTURA — Cobre apenas o serviço executado e/ou a peça substituída indicados neste comprovante, dentro do prazo informado.

2. PRAZO — Contado a partir da data de entrega do aparelho, de forma corrida, encerrando-se na data limite indicada.

3. NÃO COBRE — Quedas, impactos, líquidos, umidade, oxidação, picos de energia, mau uso, desgaste natural (bateria, conectores, botões), violação por terceiros, defeitos não relacionados ao serviço, ou danos estéticos.

4. PERDA DA GARANTIA — Ocorre em caso de violação do lacre/componentes ou se o aparelho for levado a outra assistência antes do retorno a esta empresa.

5. COMO ACIONAR — Apresentar este comprovante (ou o nº da OS) e levar o aparelho para avaliação presencial nesta assistência.

6. REINCIDÊNCIA — Se o mesmo defeito voltar por causa coberta, o reparo é refeito sem custo. Defeitos novos não são cobertos.

7. DADOS — Não cobre perda de dados/configurações; backup é responsabilidade do cliente.

Ao receber este comprovante, o cliente declara estar ciente e de acordo com as condições acima.`;

// Declaração fixa do Comprovante de Entrega — MESMO texto usado do lado
// celular (ver celular/src/termos-predefinidos.js:DECLARACAO_ENTREGA),
// para que uma entrega criada no PC (Bloco 3) gere o mesmo texto que uma
// entrega criada no celular (aba Entregas de lá). Não editável pelo
// usuário, igual ao original.
const DECLARACAO_ENTREGA = `Declaro, para os devidos fins, ser proprietário do aparelho referente à OS acima informada, ou estar devidamente autorizado por seu proprietário a retirá-lo neste estabelecimento. Confirmo o recebimento do equipamento nas condições registradas neste comprovante e declaro que li, compreendi e aceitei os termos, o prazo e as condições da garantia aqui apresentados.`;

module.exports = { TERMOS_OS, TERMOS_COMPRA, TERMOS_VENDA, TERMOS_GARANTIA, DECLARACAO_ENTREGA };
