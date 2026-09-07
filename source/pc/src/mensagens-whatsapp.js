// ══════════════════════════════════════════════════════════════════════════════
// src/mensagens-whatsapp.js — Módulo central de mensagens automáticas WhatsApp
// v1.0
//
// TEMPLATES disponíveis:
//   montarCobranca(os, config)             → mensagem manual de cobrança
//   montarPagamentoConfirmado(os, config)  → enviada ao confirmar pagamento
//   montarEntregue(os, config)             → enviada ao marcar OS como ENTREGUE
//   montarAguardandoAprovacao(os, config)      → pede SIM/NÃO aos termos (PDF anexado)
//   montarConfirmacaoTermosAceitos(os, config) → confirma aceite dos termos (1ª msg após SIM)
//   montarPedidoFormaPagamento(os, config)     → pede forma de pagamento (2ª msg após SIM)
//   montarPedidoMotivoRecusa(os, config)       → pede motivo da recusa (após NÃO)
//   montarRecusaRegistrada(os, config)         → confirma recusa registrada
//   montarNaoEntendiReenvio(os, config)        → pede reenvio de resposta não entendida
//   montarEncaminhadoAtendimentoHumano(os, config) → avisa que um atendente vai continuar (digitou 1 / limite de tentativas)
//   montarAtendimentoHumanoCancelado(os, config)   → confirma cancelamento do atendimento humano (cliente digitou #)
//   montarProntoRetiradaComCobranca(os, config)    → Fase 5 — "pronto p/ retirada" já com valor + link MP
//   montarFormaPagamentoRetiradaRegistrada(os, config) → Fase 5 — confirma forma de pagamento na retirada
//
// SINTAXE DE VARIÁVEIS:
//   {nome_variavel}   → substituído pelo valor; se vazio, a linha inteira é ocultada
//   {?nome_variavel} → prefixo condicional: a linha só aparece se a variável não
//                       estiver vazia; o prefixo {?...} é removido do texto final
//
// PREPARADO PARA EDIÇÃO VIA CONFIGURAÇÕES (futura implementação):
//   Os templates estão no objeto TEMPLATES (exportado).
//   Quando a UI de personalização for implementada, substituir os valores de
//   TEMPLATES por leitura do banco de dados / arquivo de configuração.
// ══════════════════════════════════════════════════════════════════════════════

'use strict';

// ─── Templates ─────────────────────────────────────────────────────────────────

/**
* Objeto com todos os templates de mensagem do sistema.
*
* Para editar os textos via interface futuramente:
*   - Salvar os templates personalizados na tabela de configurações do banco
*   - Na inicialização, carregar do banco e sobrescrever as chaves deste objeto
*/
const TEMPLATES = {

  /**
   * Mensagem de cobrança — enviada manualmente na tela de cobrança.
   *
   * Variáveis obrigatórias : nome_completo_cliente, numero_os, marca, modelo,
   *                          valor, nome_empresa
   * Variáveis opcionais    : prazo_reparo, link_pagamento, codigo_pix
   *   (linhas com variáveis opcionais ausentes são ocultadas automaticamente)
   */
  COBRANCA:
`Olá, {nome_completo_cliente}!
Seu orçamento foi concluído.

Ordem de Serviço: *#{numero_os}*
Aparelho: *{marca} {modelo}*
Valor do reparo: *{valor}*
Prazo estimado após aprovação: *{prazo_reparo}*

{?tem_pdf}O PDF da Ordem de Serviço com os termos e condições foi anexado a esta mensagem.

━━━━━━━━━━━━━━━━━━━━━━
*FORMAS DE PAGAMENTO*
━━━━━━━━━━━━━━━━━━━━━━
{?link_pagamento}Pague com *Pix, cartão de crédito/débito ou boleto* — é só clicar no link abaixo:

{link_pagamento}

{?codigo_pix}*Pix Copia e Cola* — copie o código abaixo:
{codigo_pix}

Você também pode pagar *presencialmente* na retirada do aparelho:
  • Dinheiro
  • Pix
  • Maquininha (débito ou crédito)

━━━━━━━━━━━━━━━━━━━━━━

*Qual é a sua preferência de pagamento?*
Por favor, nos informe como deseja pagar para agilizarmos o atendimento.

*Ao efetuar o pagamento, você concorda com os termos e condições descritos no PDF da Ordem de Serviço anexado a esta mensagem*, e o serviço será iniciado imediatamente.

A confirmação do pagamento online é automática e pode levar até 2 minutos.

*{nome_empresa}*`,

  /**
   * Mensagem de pagamento confirmado — enviada automaticamente quando
   * o polling ou a confirmação manual detectar o pagamento.
   *
   * Variáveis: nome_completo_cliente, numero_os, marca, modelo, nome_empresa
   */
  /**
   * Mensagem de orçamento aguardando aprovação — enviada quando o técnico
   * coloca a OS em "Aguardando aprovação".
   *
   * v36.4 — Reescrita para a automação de aprovação via WhatsApp: a mensagem
   * NÃO trata mais de pagamento (nem link, nem formas de pagamento). Ela
   * apenas informa que os termos estão no PDF anexado e pede resposta
   * SIM ou NÃO. A forma de pagamento passa a ser tratada em uma etapa
   * separada da conversa, após o aceite (ver template PEDIDO_FORMA_PAGAMENTO).
   *
   * Variáveis obrigatórias : nome_completo_cliente, numero_os, marca, modelo,
   *                          valor, nome_empresa
   * Variáveis opcionais    : prazo_reparo, tem_pdf
   */
  AGUARDANDO_APROVACAO:
`Olá, {nome_completo_cliente}!
O diagnóstico do seu aparelho foi concluído.

Ordem de Serviço: *#{numero_os}*
Aparelho: *{marca} {modelo}*
{?diagnostico_tecnico}Diagnóstico técnico: *{diagnostico_tecnico}*
Valor do reparo: *{valor}*
Prazo estimado após aprovação: *{prazo_reparo}*

{?tem_pdf}Os termos e condições do serviço estão no PDF da Ordem de Serviço anexado a esta mensagem.

━━━━━━━━━━━━━━━━━━━━━━

*Para prosseguir, responda esta mensagem:*

Digite *SIM* para aceitar os termos e autorizar o serviço.

Digite *NÃO* para recusar o orçamento.

Digite *1* para falar com um atendente, se tiver alguma dúvida.

*{nome_empresa}*`,

  /**
   * Mensagem enviada após o cliente responder SIM aos termos — pede a
   * forma de pagamento preferida antes de seguir com o reparo.
   *
   * Variáveis obrigatórias : nome_completo_cliente, numero_os, nome_empresa
   * Variáveis opcionais    : link_pagamento
   *   (se preenchido, exibe o link de pagamento online logo abaixo das opções)
   */
  /**
   * Mensagem enviada após o cliente responder SIM aos termos — confirma o
   * aceite do orçamento e informa que o reparo já foi iniciado. NÃO pede
   * forma de pagamento aqui (v45): isso só acontece bem mais tarde, na
   * etapa de "pronto para retirada" (ver PRONTO_RETIRADA_COM_COBRANCA).
   */
  CONFIRMACAO_TERMOS_ACEITOS:
`Obrigado, {nome_completo_cliente}!
Seu orçamento da OS *#{numero_os}* foi *autorizado*.

Já estamos iniciando o reparo do seu aparelho. Assim que estiver pronto, entraremos em contato para a retirada.

*{nome_empresa}*`,

  PEDIDO_FORMA_PAGAMENTO:
`Seu serviço já está autorizado.

Se quiser adiantar o pagamento agora, use o link abaixo para pagar por Pix, cartão ou boleto:
{?link_pagamento}
{?link_pagamento}{link_pagamento}

Se preferir pagar na retirada, responda apenas com a forma que pretende usar (por exemplo: dinheiro, Pix, débito ou crédito). O reparo já está autorizado; essa resposta somente registra como o pagamento será feito.

*{nome_empresa}*`,

  PEDIDO_ENTRADA_50:
`Recebemos o aceite dos termos da OS *#{numero_os}*.

Este serviço exige uma entrada de *50% antes do início do reparo*.

Valor total: *R$ {valor_total}*
Entrada de 50%: *R$ {valor_entrada}*

Para pagar a entrada de *50% agora* por Pix, cartão ou boleto, use o link abaixo. Os outros 50% ficam para a retirada:
{link_pagamento_50}

Quer quitar *100% agora* pelo link? Responda *pagar tudo* e enviaremos o link integral.

Se preferir pagar presencialmente para autorizar o reparo, responda com uma destas opções:
• *50% presencial* — a outra metade ficará para a retirada;
• *100% presencial* — pagamento integral.

O reparo será iniciado somente depois da confirmação do pagamento online ou presencial.

*{nome_empresa}*`,

  PAGAMENTO_PRESENCIAL_AGUARDADO:
`Entendido, {nome_completo_cliente}.

Registramos que o pagamento de *{percentual}%* da OS *#{numero_os}* será feito presencialmente por *{forma_pagamento}*.

O sistema está aguardando a confirmação desse pagamento na assistência antes de autorizar o início do reparo.
{?saldo_retirada}Depois da entrada, os 50% restantes ficarão para a retirada.

*{nome_empresa}*`,

  ESCOLHA_ENTRADA_NAO_ENTENDIDA:
`Desculpe, {nome_completo_cliente}, preciso que você informe o percentual e como deseja pagar.

Responda, por exemplo:
• *50% presencial em dinheiro*;
• *100% presencial no Pix*;
• *link de 50%*;
• *pagar tudo* — para receber o link de 100%.

*{nome_empresa}*`,

  /**
   * Mensagem "Pronto para Retirada" COM cobrança — Fase 5. Enviada pelo
   * botão "Pronto para Retirada" quando o técnico marca a OS como pronta
   * e já dispara a cobrança junto (reaproveita o link do Mercado Pago já
   * gerado por _gerarLinkMercadoPagoExistente / mp:gerarPayload).
   * Diferente de PRONTO_RETIRADA (aviso simples, sem cobrança): esta
   * versão já informa o valor e o link de pagamento, e pede a forma de
   * pagamento preferida — resposta tratada pelo estado
   * 'aguardando_forma_pagamento_retirada' (src/whatsapp.js).
   *
   * Variáveis obrigatórias : nome_completo_cliente, numero_os, valor, nome_empresa
   * Variáveis opcionais    : marca, modelo, link_pagamento, horario_funcionamento
   */
  PRONTO_RETIRADA_COM_COBRANCA:
`Olá, {nome_completo_cliente}!
Seu aparelho já está pronto para retirada!

Ordem de Serviço: *#{numero_os}*
{?marca}Aparelho: *{marca} {modelo}*
Valor a pagar: *R$ {valor}*

{?horario_funcionamento}Horário de funcionamento: {horario_funcionamento}

━━━━━━━━━━━━━━━━━━━━━━
*FORMAS DE PAGAMENTO*
━━━━━━━━━━━━━━━━━━━━━━
{?link_pagamento}Pague agora com *Pix, cartão de crédito/débito ou boleto* — é só clicar no link abaixo:

{?link_pagamento}{link_pagamento}

Você também pode pagar *presencialmente* na retirada:
  • Dinheiro
  • Pix
  • Maquininha (débito ou crédito)

━━━━━━━━━━━━━━━━━━━━━━

*Qual é a sua preferência de pagamento?*
Responda esta mensagem nos contando como prefere pagar.

Se pagar pelo link, a confirmação é automática e pode levar até 2 minutos.

*{nome_empresa}*`,

  /**
   * Mensagem enviada após a forma de pagamento na retirada ser registrada
   * — Fase 5, encerra o fluxo aberto por PRONTO_RETIRADA_COM_COBRANCA.
   * Só é enviada quando o cliente informa a forma manualmente (Pix
   * combinado, dinheiro, maquininha etc.); se ele pagar pelo link antes,
   * quem confirma é PAGAMENTO_CONFIRMADO (fluxo do polling/webhook do MP),
   * não esta.
   *
   * Variáveis obrigatórias : nome_completo_cliente, numero_os, forma_pagamento, nome_empresa
   */
  FORMA_PAGAMENTO_RETIRADA_REGISTRADA:
`Recebido, {nome_completo_cliente}.

Forma de pagamento registrada na OS *#{numero_os}*: *{forma_pagamento}*.

Combinado! Nossa equipe seguirá o atendimento conforme a forma informada. Se precisar alterar, é só nos chamar.

*{nome_empresa}*`,

  /**
   * Mensagem enviada após o cliente responder NÃO aos termos — pede o
   * motivo da recusa.
   *
   * Variáveis obrigatórias : nome_completo_cliente, numero_os, nome_empresa
   */
  PEDIDO_MOTIVO_RECUSA:
`Entendido, {nome_completo_cliente}.
Você recusou os termos da OS *#{numero_os}* — o reparo *não será iniciado* por enquanto.

Poderia nos contar o motivo da recusa? Isso nos ajuda a te atender melhor e, se for algo que dá pra resolver (ex.: valor, prazo), podemos conversar sobre isso.

Responda com o motivo em uma mensagem.

*{nome_empresa}*`,

  /**
   * Mensagem de confirmação após o motivo da recusa ser registrado,
   * encerrando o fluxo de aprovação.
   *
   * Variáveis obrigatórias : nome_completo_cliente, numero_os, nome_empresa
   */
  RECUSA_REGISTRADA:
`Recebido, {nome_completo_cliente}.

A OS *#{numero_os}* foi *cancelada* em nosso sistema com base no motivo informado. O aparelho fica disponível para retirada em nossa loja.

Caso mude de ideia ou tenha alguma dúvida, é só nos chamar por aqui que reabrimos o orçamento.

*{nome_empresa}*`,

  /**
   * Mensagem de confirmação após o cliente informar a forma de pagamento
   * manual (ex.: maquininha, dinheiro, cartão), encerrando o fluxo de
   * aprovação. Enviada logo após registrarFormaPagamento no ramo
   * aguardando_forma_pagamento (v40.1).
   *
   * Variáveis obrigatórias : nome_completo_cliente, numero_os, forma_pagamento, nome_empresa
   */
  FORMA_PAGAMENTO_MANUAL_REGISTRADA:
`Recebido, {nome_completo_cliente}.

Forma de pagamento registrada na OS *#{numero_os}*: *{forma_pagamento}*.

O aparelho segue agora para o reparo. Qualquer dúvida, é só nos chamar por aqui.

*{nome_empresa}*`,

  /**
   * Mensagem enviada quando a resposta do cliente não pôde ser
   * interpretada pela automação — pede para reenviar de forma mais clara.
   *
   * Variáveis obrigatórias : nome_completo_cliente, nome_empresa
   */
  NAO_ENTENDI_REENVIO:
`Desculpe, {nome_completo_cliente}, não consegui entender sua resposta.

Poderia responder novamente de forma mais direta?
   Ex.: *SIM*, *NÃO*, ou a forma de pagamento (Pix, cartão, dinheiro).

Se preferir, digite *1* para falar com um atendente.

*{nome_empresa}*`,

  /**
   * Mensagem enviada quando a conversa é encaminhada para atendimento
   * humano — seja porque o cliente pediu explicitamente (digitou 1), seja
   * porque a automação não conseguiu entender a resposta depois de algumas
   * tentativas. Confirma o recebimento do pedido, avisa que uma pessoa vai
   * continuar o atendimento, e informa a opção de cancelar com "#" caso o
   * cliente tenha se enganado ou prefira continuar com o SIM/NÃO automático.
   *
   * Variáveis obrigatórias : nome_completo_cliente, nome_empresa
   */
  ENCAMINHADO_ATENDIMENTO_HUMANO:
`Tudo bem, {nome_completo_cliente}!

Encaminhei sua conversa para um de nossos atendentes — em breve alguém vai continuar por aqui mesmo, neste WhatsApp.

Se preferir cancelar e voltar ao atendimento automático, é só digitar *#*.

*{nome_empresa}*`,

  /**
   * Mensagem enviada quando o cliente cancela o atendimento humano (digitou
   * "#" enquanto aguardava um atendente) e a conversa volta para o fluxo
   * automático. É seguida, na sequência, pelo reenvio da pergunta de aceite
   * dos termos (SIM/NÃO) — ver montarAguardandoAprovacao.
   *
   * Variáveis obrigatórias : nome_completo_cliente, nome_empresa
   */
  ATENDIMENTO_HUMANO_CANCELADO:
`Ok, {nome_completo_cliente}! Cancelei o encaminhamento para o atendente.

Vamos voltar ao atendimento automático:

*{nome_empresa}*`,

  PAGAMENTO_CONFIRMADO:
`Olá, {nome_completo_cliente}!
Recebemos e confirmamos o pagamento integral da OS *#{numero_os}*.

Aparelho: *{marca} {modelo}*

{?tem_comprovante}O comprovante de pagamento foi anexado a esta mensagem.

O serviço está pago em *100%*. Nossa equipe seguirá com o reparo conforme o orçamento já autorizado.

Assim que o serviço for finalizado, entraremos em contato para combinar a retirada ou entrega.

{?tem_comprovante}*Na retirada, apresente este comprovante enviado ou um documento de identificação.*
{?sem_comprovante}*Guarde esta mensagem como confirmação do pagamento realizado na retirada.*

Obrigado pela confiança!
*{nome_empresa}*`,

  ENTRADA_50_CONFIRMADA:
`Olá, {nome_completo_cliente}!
Confirmamos o pagamento da entrada de 50% da OS *#{numero_os}*.

Entrada recebida: *R$ {valor_entrada}*
Saldo restante: *R$ {valor_restante}*

O reparo está autorizado e nossa equipe dará continuidade ao serviço. Os *50% restantes deverão ser pagos na retirada* do aparelho.

*{nome_empresa}*`,

  /**
   * Mensagem de entrega — enviada automaticamente quando a OS é marcada ENTREGUE.
   *
   * Variáveis obrigatórias : nome_completo_cliente, nome_empresa
   * Variáveis opcionais    : link_google_avaliacao
   *   (se ausente, todo o bloco de avaliação é ocultado)
   */
  ENTREGUE:
`Olá, {nome_completo_cliente}!
Foi um prazer cuidar do seu aparelho.

Esperamos que tenha ficado satisfeito com nosso atendimento.

{?link_google_avaliacao}Se puder, deixe uma avaliação no Google. Ela ajuda muito nossa empresa a crescer e atender outras pessoas com mais confiança.
{?link_google_avaliacao}
{?link_google_avaliacao}*Avalie aqui:*
{link_google_avaliacao}

Muito obrigado pela preferência.

Sempre que precisar, estaremos à disposição!
*{nome_empresa}*`,

  /**
   * Mensagem manual "Pronto para Retirada" — disparada pelo botão na OS.
   *
   * Variáveis obrigatórias : nome_completo_cliente, numero_os, marca, modelo,
   *                          nome_empresa
   * Variáveis opcionais    : horario_funcionamento
   *   (se preenchido, exibe o bloco de horário de atendimento)
   */
  PRONTO_RETIRADA:
`Olá, {nome_completo_cliente}!
Seu aparelho está *pronto para retirada*!

Ordem de Serviço: *#{numero_os}*
Aparelho: *{marca} {modelo}*

O serviço foi concluído com sucesso e o aparelho está aguardando por você.

{?horario_funcionamento}*Horário de atendimento:*
{horario_funcionamento}

*Na retirada, traga um documento de identificação ou o comprovante recebido por aqui.*

Qualquer dúvida, é só chamar. Até logo!
*{nome_empresa}*`,

  /**
   * Mensagem que acompanha o PDF de garantia enviado por WhatsApp — botão
   * manual na aba Garantia. Deixa claro que o documento (impresso ou
   * digital) precisa ser apresentado para a garantia valer.
   *
   * Variáveis obrigatórias : nome_cliente, numero_os, aparelho, prazo_garantia,
   *                          nome_empresa
   * Variáveis opcionais    : data_limite
   */
  GARANTIA:
`Olá, {nome_cliente}!

Segue o comprovante de garantia do seu atendimento.

Ordem de Serviço: *#{numero_os}*
Aparelho: *{aparelho}*
Prazo de garantia: *{prazo_garantia}*
{?data_limite}Válida até: *{data_limite}*

*Para que a garantia seja válida, é necessário apresentar este documento (o PDF em anexo, impresso ou no próprio celular) caso precise voltar com o aparelho.*

Guarde este comprovante em local seguro.

Qualquer dúvida, estamos à disposição!
*{nome_empresa}*`,

};

// ─── Motor de substituição ─────────────────────────────────────────────────────

/**
* Substitui variáveis em um template e oculta linhas sem conteúdo útil.
*
* Regras de processamento por linha:
*
*   1. {?variavel}(prefixo condicional)
*      - A linha só é incluída se `variavel` não estiver vazia.
*      - O prefixo `{?variavel}` é removido do texto final.
*      - Útil para "labels" que ficam acima de uma variável de link/URL.
*
*   2. {variavel} (substituição normal)
*      - Substituído pelo valor correspondente.
*      - Se TODAS as variáveis da linha estiverem vazias, a linha inteira é omitida.
*      - Garante que linhas como " Prazo: *{prazo_reparo}*" sumam quando vazio.
*
*   3. Linhas sem variáveis
*      - Mantidas como estão (separadores, texto estático, emojis, etc.).
*
* Após montar o texto, 3+ quebras de linha consecutivas são colapsadas para 2,
* garantindo espaçamento uniforme mesmo após a remoção de linhas opcionais.
*
* @param {string} template  Texto com marcadores {variavel} e {?variavel}
* @param {Object} variaveis Mapa { nome_variavel: string }
* @returns {string}         Mensagem final pronta para envio
*/
function substituir(template, variaveis) {
  const linhas   = template.split('\n');
  const resultado = [];

  for (let linha of linhas) {

    // ── 1. Prefixo condicional {?variavel}──────────────────────────────────
    const matchCond = linha.match(/^\{(\?([^}]+))\}/);
    if (matchCond) {
      const nomeVar = matchCond[2];
      const valor   = variaveis[nomeVar];
      if (valor == null || String(valor).trim() === '') {
        continue; // variável vazia → linha inteira omitida
      }
      // Remove o prefixo; o restante da linha ainda pode ter {variavel} normais
      linha = linha.slice(matchCond[0].length);
    }

    // ── 2. Variáveis normais {variavel} ─────────────────────────────────────
    // [^?}] garante que não capturamos prefixos {?...}
    const varNaLinha = [...linha.matchAll(/\{([^?}][^}]*)\}/g)].map(m => m[1]);

    if (varNaLinha.length > 0) {
      const todosVazios = varNaLinha.every(nome => {
        const val = variaveis[nome];
        return val == null || String(val).trim() === '';
      });

      if (todosVazios) {
        continue; // linha sem conteúdo útil → omite
      }

      // Substitui cada variável pelo seu valor
      for (const nome of varNaLinha) {
        const val = variaveis[nome];
        linha = linha.replaceAll(`{${nome}}`, val != null ? String(val) : '');
      }
    }

    resultado.push(linha);
  }

  // Colapsa 3+ quebras de linha em no máximo 2
  return resultado.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ─── Construtores de mensagem ──────────────────────────────────────────────────

function numeroMonetario(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const texto = String(valor == null ? '' : valor).trim().replace(/^R\$\s*/i, '');
  if (!texto) return 0;
  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

function formatarValorBRL(valor) {
  const numero = numeroMonetario(valor);
  const original = String(valor == null ? '' : valor).trim();
  if (numero <= 0 && !original) return '';
  if (numero <= 0 && !/\d/.test(original)) return original;
  return numero.toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function aparelhoSemRepeticao(marca, modelo) {
  const marcaTexto = String(marca || '').trim();
  const modeloTexto = String(modelo || '').trim();
  const normalizar = (valor) => String(valor || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const marcaNormal = normalizar(marcaTexto);
  const modeloNormal = normalizar(modeloTexto);
  if (!marcaNormal || !modeloNormal) return { marca: marcaTexto, modelo: modeloTexto };
  if (marcaNormal === modeloNormal) return { marca: marcaTexto, modelo: '' };
  if (modeloNormal.startsWith(marcaNormal + ' ')) return { marca: '', modelo: modeloTexto };
  return { marca: marcaTexto, modelo: modeloTexto };
}

/**
* Monta a mensagem de cobrança (envio manual na tela de cobrança).
*
* @param {Object} os
* @param {string}   os.nome_cliente     Nome completo do cliente
* @param {string}   os.numero           Número da OS
* @param {string}   os.marca            Marca do aparelho
* @param {string}   os.modelo           Modelo do aparelho
* @param {string}   os.valor            Valor formatado (ex: "150,00")
* @param {string}   [os.prazo_reparo]   Prazo estimado (ex: "2 dias úteis")
* @param {string}   [os.link_pagamento] Link Mercado Pago
* @param {string}   [os.codigo_pix]     Código Pix Copia e Cola
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
/**
* Monta a mensagem de orçamento aguardando aprovação.
* Enviada em "Aguardando aprovação" com PDF da OS anexado.
*
* @param {Object} os
* @param {string}   os.nome_cliente     Nome completo do cliente
* @param {string}   os.numero           Número da OS
* @param {string}   os.marca            Marca do aparelho
* @param {string}   os.modelo           Modelo do aparelho
* @param {string}   os.valor            Valor formatado (ex: "150,00")
* @param {string}   [os.prazo_reparo]   Prazo estimado
* @param {string}   [os.link_pagamento] Link Mercado Pago
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
/**
* Monta a mensagem de orçamento aguardando aprovação.
* Enviada em "Aguardando aprovação" com PDF da OS anexado.
*
* v36.4 — Não trata mais de pagamento; apenas informa que os termos estão
* no PDF e pede resposta SIM ou NÃO.
*
* @param {Object} os
* @param {string}   os.nome_cliente     Nome completo do cliente
* @param {string}   os.numero           Número da OS
* @param {string}   os.marca            Marca do aparelho
* @param {string}   os.modelo           Modelo do aparelho
* @param {string}   os.valor            Valor formatado (ex: "150,00")
* @param {string}   [os.prazo_reparo]   Prazo estimado
* @param {boolean}  [os.tem_pdf]        Se o PDF foi anexado
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
function montarAguardandoAprovacao(os, config) {
  const aparelho = aparelhoSemRepeticao(os.marca, os.modelo);
  return substituir(TEMPLATES.AGUARDANDO_APROVACAO, {
    nome_completo_cliente : os.nome_cliente   || '',
    numero_os             : os.numero         || '',
    marca                 : aparelho.marca,
    modelo                : aparelho.modelo,
    diagnostico_tecnico   : os.diagnostico_tecnico || '',
    valor                 : formatarValorBRL(os.valor),
    prazo_reparo          : os.prazo_reparo   || '',
    tem_pdf               : os.tem_pdf ? 'sim' : '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem que pede a forma de pagamento — enviada após o cliente
* responder SIM ao pedido de aprovação dos termos.
*
* @param {Object} os
* @param {string}   os.nome_cliente     Nome completo do cliente
* @param {string}   os.numero           Número da OS
* @param {string}   [os.link_pagamento] Link Mercado Pago, se disponível
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
function montarPedidoFormaPagamento(os, config) {
  return substituir(TEMPLATES.PEDIDO_FORMA_PAGAMENTO, {
    nome_completo_cliente : os.nome_cliente     || '',
    numero_os             : os.numero           || '',
    link_pagamento        : os.link_pagamento   || '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

function montarPedidoEntrada50(os, config) {
  return substituir(TEMPLATES.PEDIDO_ENTRADA_50, {
    nome_completo_cliente : os.nome_cliente || '',
    numero_os             : os.numero || '',
    valor_total           : os.valor_total || '',
    valor_entrada         : os.valor_entrada || '',
    link_pagamento_50     : os.link_pagamento_50 || os.link_pagamento || '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

function montarPagamentoPresencialAguardado(os, config) {
  return substituir(TEMPLATES.PAGAMENTO_PRESENCIAL_AGUARDADO, {
    nome_completo_cliente : os.nome_cliente || '',
    numero_os             : os.numero || '',
    percentual            : String(os.percentual || '100'),
    forma_pagamento       : os.forma_pagamento || 'pagamento presencial',
    saldo_retirada        : Number(os.percentual) === 50 ? 'sim' : '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

function montarEscolhaEntradaNaoEntendida(os, config) {
  return substituir(TEMPLATES.ESCOLHA_ENTRADA_NAO_ENTENDIDA, {
    nome_completo_cliente : os.nome_cliente || '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem de confirmação de aceite dos termos — enviada como a
* PRIMEIRA das duas mensagens após o cliente responder SIM. A segunda
* mensagem (forma de pagamento) é montada por montarPedidoFormaPagamento.
*
* @param {Object} os
* @param {string}   os.nome_cliente  Nome completo do cliente
* @param {string}   os.numero        Número da OS
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
function montarConfirmacaoTermosAceitos(os, config) {
  return substituir(TEMPLATES.CONFIRMACAO_TERMOS_ACEITOS, {
    nome_completo_cliente : os.nome_cliente || '',
    numero_os             : os.numero       || '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem que pede o motivo da recusa — enviada após o cliente
* responder NÃO ao pedido de aprovação dos termos.
*
* @param {Object} os
* @param {string}   os.nome_cliente  Nome completo do cliente
* @param {string}   os.numero        Número da OS
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
function montarPedidoMotivoRecusa(os, config) {
  return substituir(TEMPLATES.PEDIDO_MOTIVO_RECUSA, {
    nome_completo_cliente : os.nome_cliente || '',
    numero_os             : os.numero       || '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem de confirmação de recusa registrada — enviada após o
* motivo da recusa ser informado pelo cliente, encerrando o fluxo.
*
* @param {Object} os
* @param {string}   os.nome_cliente  Nome completo do cliente
* @param {string}   os.numero        Número da OS
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
function montarRecusaRegistrada(os, config) {
  return substituir(TEMPLATES.RECUSA_REGISTRADA, {
    nome_completo_cliente : os.nome_cliente || '',
    numero_os             : os.numero       || '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem de confirmação enviada ao cliente após ele informar
* a forma de pagamento manual (ex.: maquininha, dinheiro, cartão) em
* resposta ao pedido de forma de pagamento.
*
* @param {Object} os
* @param {string}   os.nome_cliente     Nome completo do cliente
* @param {string}   os.numero           Número da OS
* @param {string}   os.forma_pagamento  Rótulo já classificado (ex.: "Maquininha (Stone)")
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
function montarFormaPagamentoManualRegistrada(os, config) {
  return substituir(TEMPLATES.FORMA_PAGAMENTO_MANUAL_REGISTRADA, {
    nome_completo_cliente : os.nome_cliente    || '',
    numero_os             : os.numero          || '',
    forma_pagamento       : os.forma_pagamento || '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem de reenvio por resposta não compreendida — enviada
* quando a automação não consegue classificar a resposta do cliente.
*
* @param {Object} os
* @param {string}   os.nome_cliente  Nome completo do cliente
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
function montarNaoEntendiReenvio(os, config) {
  return substituir(TEMPLATES.NAO_ENTENDI_REENVIO, {
    nome_completo_cliente : os.nome_cliente || '',
    nome_empresa           : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem de encaminhamento para atendimento humano — enviada
* quando o cliente digita 1 pedindo um atendente, ou quando a automação
* esgota as tentativas de entender a resposta sobre aceite dos termos.
*
* @param {Object} os
* @param {string}   os.nome_cliente  Nome completo do cliente
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
function montarEncaminhadoAtendimentoHumano(os, config) {
  return substituir(TEMPLATES.ENCAMINHADO_ATENDIMENTO_HUMANO, {
    nome_completo_cliente : os.nome_cliente || '',
    nome_empresa           : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem de confirmação de cancelamento do atendimento humano —
* enviada quando o cliente digita "#" enquanto aguardava um atendente.
*
* @param {Object} os
* @param {string}   os.nome_cliente  Nome completo do cliente
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
function montarAtendimentoHumanoCancelado(os, config) {
  return substituir(TEMPLATES.ATENDIMENTO_HUMANO_CANCELADO, {
    nome_completo_cliente : os.nome_cliente || '',
    nome_empresa           : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

function montarCobranca(os, config) {
  // ── Flag de exibição do Pix Copia e Cola na mensagem ──────────────────────
  // Desativado por decisão do usuário: a mensagem deve direcionar o cliente
  // só para o link do Mercado Pago (Pix, cartão, boleto — tudo no mesmo lugar).
  // A geração do código Pix (src/pix.js, mp:gerarPayload, mp:gerarLinkEPix)
  // continua funcionando normalmente nos bastidores — só não entra na mensagem.
  // Para reativar a exibição: troque para `true`.
  const EXIBIR_PIX_COPIA_COLA_NA_MENSAGEM = false;

  return substituir(TEMPLATES.COBRANCA, {
    nome_completo_cliente : os.nome_cliente   || '',
    numero_os             : os.numero         || '',
    marca                 : os.marca          || '',
    modelo                : os.modelo         || '',
    valor                 : os.valor          || '',
    prazo_reparo          : os.prazo_reparo   || '',
    link_pagamento        : os.link_pagamento || '',
    codigo_pix            : EXIBIR_PIX_COPIA_COLA_NA_MENSAGEM ? (os.codigo_pix || '') : '',
    tem_pdf               : os.tem_pdf ? 'sim' : '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}


/**
* Monta a mensagem de pagamento confirmado.
* Enviada automaticamente pelo polling ou confirmação manual.
*
* @param {Object} os
* @param {string}   os.nome_cliente  Nome completo do cliente
* @param {string}   os.numero        Número da OS
* @param {string}   os.marca         Marca do aparelho
* @param {string}   os.modelo        Modelo do aparelho
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @param {Object} [opcoes]
* @param {boolean} [opcoes.semComprovante]  Fase 6 — true quando o pagamento
*   foi confirmado manualmente na retirada (botão "Confirmar Pagamento
*   Presencial") e por isso não existe nenhum comprovante em PDF para anexar.
*   Oculta a linha "comprovante anexado" e a de "apresente este comprovante
*   na retirada" (que não fariam sentido sem um PDF de fato enviado), e
*   mostra em seu lugar um aviso genérico de confirmação.
*
* @returns {string}
*/
function montarPagamentoConfirmado(os, config, opcoes) {
  const semComprovante = !!(opcoes && opcoes.semComprovante);
  if (os && os.exigir_entrada_50 === true && numeroMonetario(os.valor_restante) > 0) {
    return substituir(TEMPLATES.ENTRADA_50_CONFIRMADA, {
      nome_completo_cliente : os.nome_cliente || '',
      numero_os             : os.numero || '',
      valor_entrada         : os.valor_entrada || '',
      valor_restante        : os.valor_restante || '',
      nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
    });
  }
  const aparelho = aparelhoSemRepeticao(os.marca, os.modelo);
  return substituir(TEMPLATES.PAGAMENTO_CONFIRMADO, {
    nome_completo_cliente : os.nome_cliente || '',
    numero_os             : os.numero       || '',
    marca                 : aparelho.marca,
    modelo                : aparelho.modelo,
    tem_comprovante       : semComprovante ? '' : 'sim',
    sem_comprovante       : semComprovante ? 'sim' : '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem enviada quando a OS é marcada como ENTREGUE.
*
* @param {Object} os
* @param {string}   os.nome_cliente  Nome completo do cliente
*
* @param {Object} config
* @param {string}   config.nomeEmpresa           Nome da empresa
* @param {string}   [config.linkGoogleAvaliacao]  Link de avaliação do Google
*
* @returns {string}
*/
function montarEntregue(os, config) {
  return substituir(TEMPLATES.ENTREGUE, {
    nome_completo_cliente : os.nome_cliente                        || '',
    link_google_avaliacao : (config && config.linkGoogleAvaliacao) || '',
    nome_empresa          : (config && config.nomeEmpresa)         || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem manual "Pronto para Retirada".
* Enviada pelo botão manual na tela de edição da OS.
*
* @param {Object} os
* @param {string}   os.nome_cliente  Nome completo do cliente
* @param {string}   os.numero        Número da OS
* @param {string}   os.marca         Marca do aparelho
* @param {string}   os.modelo        Modelo do aparelho
*
* @param {Object} config
* @param {string}   config.nomeEmpresa          Nome da empresa
* @param {string}   [config.horarioFuncionamento] Texto do horário (ex: "Seg–Sex 08h–18h / Sáb 08h–13h")
*
* @returns {string}
*/
function montarProntoRetirada(os, config) {
  return substituir(TEMPLATES.PRONTO_RETIRADA, {
    nome_completo_cliente  : os.nome_cliente                          || '',
    numero_os              : os.numero                                || '',
    marca                  : os.marca                                 || '',
    modelo                 : os.modelo                                || '',
    horario_funcionamento  : (config && config.horarioFuncionamento)  || '',
    nome_empresa           : (config && config.nomeEmpresa)           || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem "Pronto para Retirada" COM cobrança — Fase 5.
* Enviada pelo botão "Enviar Cobrança" (mesmo botão que hoje aciona
* "Pronto para Retirada"), já com valor e link de pagamento do Mercado
* Pago preenchidos.
*
* @param {Object} os
* @param {string}   os.nome_cliente     Nome completo do cliente
* @param {string}   os.numero           Número da OS
* @param {string}   [os.marca]          Marca do aparelho
* @param {string}   [os.modelo]         Modelo do aparelho
* @param {string}   os.valor            Valor a cobrar
* @param {string}   [os.link_pagamento] Link de pagamento (Mercado Pago)
*
* @param {Object} config
* @param {string}   config.nomeEmpresa            Nome da empresa
* @param {string}   [config.horarioFuncionamento] Texto do horário de funcionamento
*
* @returns {string}
*/
function montarProntoRetiradaComCobranca(os, config) {
  return substituir(TEMPLATES.PRONTO_RETIRADA_COM_COBRANCA, {
    nome_completo_cliente  : os.nome_cliente                          || '',
    numero_os              : os.numero                                || '',
    marca                  : os.marca                                 || '',
    modelo                 : os.modelo                                || '',
    valor                  : os.valor                                 || '',
    link_pagamento         : os.link_pagamento                        || '',
    horario_funcionamento  : (config && config.horarioFuncionamento)  || '',
    nome_empresa           : (config && config.nomeEmpresa)           || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem de confirmação após o cliente informar a forma de
* pagamento na etapa de retirada — Fase 5. Encerra o fluxo aberto por
* montarProntoRetiradaComCobranca / estado 'aguardando_forma_pagamento_retirada'.
*
* @param {Object} os
* @param {string}   os.nome_cliente     Nome completo do cliente
* @param {string}   os.numero           Número da OS
* @param {string}   os.forma_pagamento  Rótulo já classificado (ex.: "Maquininha (Stone)")
*
* @param {Object} config
* @param {string}   config.nomeEmpresa  Nome da empresa
*
* @returns {string}
*/
function montarFormaPagamentoRetiradaRegistrada(os, config) {
  return substituir(TEMPLATES.FORMA_PAGAMENTO_RETIRADA_REGISTRADA, {
    nome_completo_cliente : os.nome_cliente    || '',
    numero_os             : os.numero          || '',
    forma_pagamento       : os.forma_pagamento || '',
    nome_empresa          : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

/**
* Monta a mensagem que acompanha o PDF de garantia enviado por WhatsApp.
*
* @param {Object} g
* @param {string}   g.nome_cliente     Nome do cliente
* @param {string}   g.numero_os        Número da OS vinculada
* @param {string}   g.aparelho         "Marca Modelo"
* @param {string}   g.prazo_garantia   Ex: "90 dias"
* @param {string}   [g.data_limite]    Data limite já formatada (dd/mm/aaaa)
*
* @param {Object} config
* @param {string}   config.nomeEmpresa Nome da empresa
*
* @returns {string}
*/
function montarGarantia(g, config) {
  return substituir(TEMPLATES.GARANTIA, {
    nome_cliente   : g.nome_cliente    || '',
    numero_os      : g.numero_os       || '',
    aparelho       : g.aparelho        || '',
    prazo_garantia : g.prazo_garantia  || '',
    data_limite    : g.data_limite     || '',
    nome_empresa   : (config && config.nomeEmpresa) || 'Assistência Técnica',
  });
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  TEMPLATES,                 // acesso direto aos templates (para futura edição via UI)
  substituir,                // motor de substituição (para testes unitários e extensões)
  montarAguardandoAprovacao,
  montarPedidoFormaPagamento,
  montarPedidoEntrada50,
  montarPagamentoPresencialAguardado,
  montarEscolhaEntradaNaoEntendida,
  montarConfirmacaoTermosAceitos,
  montarPedidoMotivoRecusa,
  montarRecusaRegistrada,
  montarFormaPagamentoManualRegistrada,
  montarNaoEntendiReenvio,
  montarEncaminhadoAtendimentoHumano,
  montarAtendimentoHumanoCancelado,
  montarCobranca,
  montarPagamentoConfirmado,
  montarEntregue,
  montarProntoRetirada,
  montarProntoRetiradaComCobranca,
  montarFormaPagamentoRetiradaRegistrada,
  montarGarantia,
};
