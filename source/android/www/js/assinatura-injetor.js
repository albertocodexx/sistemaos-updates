/**
 * assinatura-injetor.js
 *
 * Módulo compartilhado responsável por injetar as DUAS assinaturas
 * (a "outra parte" + a assistência técnica) no HTML final de qualquer
 * um dos 3 documentos: OS, Venda, Compra.
 *
 * PROBLEMA QUE ESTE MÓDULO RESOLVE:
 * 1) A assistência técnica nunca tinha sua assinatura injetada em lugar
 *    nenhum do sistema (nem PC nem celular) — só o campo do cliente era
 *    preenchido. Por isso "assinei e não aparece nada no PDF": só metade
 *    do que devia aparecer, aparecia.
 * 2) O rótulo que identifica "quem é a outra parte" muda de sentido
 *    dependendo do documento:
 *      - OS:      "ASSINATURA DO CLIENTE"                  -> outra parte = cliente
 *      - Venda:   "VENDEDOR — ASSISTÊNCIA TÉCNICA"          -> assistência (loja)
 *                 "COMPRADOR"                                -> outra parte = comprador
 *      - Compra:  "ASSINATURA DO VENDEDOR (CLIENTE)"        -> outra parte = cliente
 *                 "ASSINATURA DA ASSISTÊNCIA TÉCNICA"        -> assistência
 *    Ou seja, em Venda o texto "VENDEDOR" identifica a ASSISTÊNCIA, e em
 *    Compra o mesmo termo "vendedor" identifica o CLIENTE — papéis opostos
 *    no mesmo sistema. Por isso a injeção precisa saber o tipoDocumento,
 *    não pode confiar só no texto do rótulo isolado.
 *
 *    venda-template.js usa hoje "ASSINATURA DA ASSISTÊNCIA TÉCNICA" e
 *    "ASSINATURA DO COMPRADOR" — os mesmos rótulos usados no PC e no
 *    documento de Compra, sincronizados nesta sessão (ver
 *    RESUMO-sincronizacao-templates.md). Os rótulos anteriores
 *    ("VENDEDOR — ASSISTÊNCIA TÉCNICA", "VENDEDOR (LOJA)", "VENDEDOR",
 *    "COMPRADOR" sozinho) continuam reconhecidos como alias (ver
 *    MAPA_ROTULOS abaixo) para não quebrar a reinjeção em documentos de
 *    Venda salvos no histórico antes desta mudança.
 *
 * A numeração "1/2" / "2/2" é sempre:
 *   1/2 = a outra parte (cliente / comprador / vendedor-pessoa-física)
 *   2/2 = a assistência técnica
 *
 * A injeção é IDEMPOTENTE: se o HTML já tiver assinaturas injetadas
 * (ex: reabrir um documento do histórico para reimprimir), reinjetar não
 * duplica a numeração nem duplica as imagens.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AssinaturaInjetor = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Para cada tipo de documento, define:
  //  - rotulosOutraParte: possíveis textos exatos do label da "outra parte" (1/2)
  //  - rotulosAssistencia: possíveis textos exatos do label da assistência (2/2)
  var MAPA_ROTULOS = {
    os: {
      rotulosOutraParte: ['ASSINATURA DO CLIENTE'],
      rotulosAssistencia: ['ASSINATURA DA ASSISTÊNCIA TÉCNICA']
    },
    venda: {
      // Na venda, o bloco identificado como "vendedor" no papel é a
      // assistência técnica (quem vende o aparelho ao cliente), não o
      // "vendedor" do documento de Compra (que é o cliente vendendo um
      // aparelho usado — papel oposto).
      //
      // Rótulo atualizado nesta sessão para bater com o PC (documentado
      // em RESUMO-sincronizacao-templates.md): venda-template.js agora
      // escreve "ASSINATURA DO COMPRADOR" e "ASSINATURA DA ASSISTÊNCIA
      // TÉCNICA" — os mesmos textos usados no PC e no rótulo irmão do
      // documento de Compra, eliminando a divergência entre os dois lados.
      //
      // Todos os rótulos anteriores continuam na lista como alias — sem
      // eles, reabrir do histórico um documento de Venda gerado ANTES
      // desta mudança (com o rótulo antigo gravado no HTML salvo) faria a
      // numeração/reinjeção de assinatura falhar silenciosamente, por não
      // encontrar mais nenhum rótulo correspondente.
      rotulosOutraParte: ['ASSINATURA DO COMPRADOR', 'COMPRADOR'],
      rotulosAssistencia: [
        // O injetor compara a string CRUA do HTML (ver cabeçalho do
        // arquivo), então o texto aqui precisa bater com o que o
        // template realmente escreve — incluindo a entity &mdash;
        // literal, que só vira "—" depois do navegador renderizar.
        'ASSINATURA DA ASSISTÊNCIA TÉCNICA',
        'VENDEDOR &mdash; ASSISTÊNCIA TÉCNICA',
        'VENDEDOR (LOJA)',
        'VENDEDOR'
      ]
    },
    compra: {
      // Na compra, "VENDEDOR (CLIENTE)" é a outra parte (o cliente vendendo
      // o aparelho usado); a assistência tem rótulo próprio explícito.
      rotulosOutraParte: [
        'ASSINATURA DO VENDEDOR (CLIENTE)',
        'ASSINATURA DO VENDEDOR'
      ],
      rotulosAssistencia: ['ASSINATURA DA ASSISTÊNCIA TÉCNICA']
    },
    // Comprovante de Retirada/Autorização (aba "Entregas" — ver
    // PROMPT-CELULAR-aba-entregas.md). Documento novo, mais simples que os
    // outros 3: só UMA assinatura (quem retirou o aparelho), sem segunda
    // parte/assistência técnica co-assinando. `rotulosAssistencia` fica
    // como array vazio (em vez de omitido) para não quebrar o `for` de
    // PARES_CLASSE em injetarAssinaturas — a chamada em app.js nunca passa
    // `assinaturas.assistencia` para este tipo, então esse ramo nunca
    // encontra rótulo nenhum para casar, e não injeta/numera nada.
    entrega: {
      rotulosOutraParte: ['ASSINATURA DE QUEM RETIROU'],
      rotulosAssistencia: []
    },
    desbloqueio: {
      rotulosOutraParte: ['ASSINATURA DO CLIENTE'],
      rotulosAssistencia: []
    }
  };

  // Nomes de classe usados para o "espaço" da assinatura (onde a imagem
  // vai entrar) e para o "label" (onde comparamos o texto), nos 2 padrões
  // de nomenclatura existentes nos templates.
  var PARES_CLASSE = [
    { espaco: 'assinatura-espaco', label: 'assinatura-label' }, // os-template.js
    { espaco: 'assin-esp', label: 'assin-label' } // venda/compra-template.js
  ];

  // Altura mínima (px) reservada para o "-espaço" da assinatura quando
  // injetada, e altura máxima (px) permitida para a própria imagem.
  //
  // Estas duas constantes são o núcleo da correção do bug "assinatura
  // aparece acima, sobre a seção de termos": a imagem é position:absolute
  // e não empurra nada, então se ela puder crescer mais do que o espaço
  // que o layout reserva para ela, o excesso necessariamente cobre o
  // conteúdo ANTERIOR na página (a seção de termos, logo acima do bloco
  // de assinaturas) em vez de "flutuar" isolada. Por isso IMG_ALTURA_MAX
  // nunca deve ser maior que ESPACO_ALTURA_MIN.
  //
  // 56px foi escolhido por caber com folga em todos os documentos
  // testados mesmo no cenário mais apertado (termos longos + autofit já
  // no tamanho mínimo de fonte — ver ONDE_PAREI.md), sem estourar a
  // altura da folha A4 nos 3 templates (OS/Venda/Compra validados via
  // Playwright). Continua grande o suficiente para uma assinatura feita
  // com o dedo (traço largo e baixo) ficar legível.
  var ESPACO_ALTURA_MIN = 56;
  var IMG_ALTURA_MAX = 56;

  function normalizarTexto(txt) {
    return String(txt || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  // Recusa URL, texto ou base64 corrompido antes de montar o atributo src.
  // Sem essa barreira, uma sincronização interrompida colocava um <img>
  // inválido no HTML e o PDF mostrava o ícone de imagem quebrada.
  function normalizarAssinaturaParaImagem(valor) {
    var bruto = String(valor || '').trim();
    if (!bruto) return '';
    var encontrada = bruto.match(/^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
    var base64 = (encontrada ? encontrada[1] : bruto).replace(/\s/g, '');
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return '';

    try {
      var inicio = atob(base64.slice(0, 64));
      var ehPng = inicio.length >= 8 && inicio.charCodeAt(0) === 0x89 && inicio.slice(1, 4) === 'PNG';
      var ehJpeg = inicio.length >= 3 && inicio.charCodeAt(0) === 0xFF && inicio.charCodeAt(1) === 0xD8 && inicio.charCodeAt(2) === 0xFF;
      var ehWebp = inicio.length >= 12 && inicio.slice(0, 4) === 'RIFF' && inicio.slice(8, 12) === 'WEBP';
      if (!ehPng && !ehJpeg && !ehWebp) return '';
      return 'data:' + (ehPng ? 'image/png' : (ehJpeg ? 'image/jpeg' : 'image/webp')) + ';base64,' + base64;
    } catch (_) {
      return '';
    }
  }

  /**
   * Encontra, dentro do HTML completo, o trecho correspondente a um bloco de
   * assinatura cujo label bate com um dos rótulos esperados, e substitui a
   * div "-espaco" (vazia ou já preenchida antes) pela versão assinada.
   *
   * Estratégia: como não temos um DOM real disponível de forma garantida em
   * todos os ambientes (Node puro / WebView), fazemos isso via string, mas de
   * forma estrutural: localizamos a posição do texto do label, e a partir
   * dela caminhamos para trás até achar a divs de espaço/linha mais próxima
   * que pertence ao mesmo "assinatura-bloco"/"assin-bloco".
   *
   * @param {boolean} numerar - Se true, insere/atualiza a numeração "N/total"
   *   junto com a imagem. Se false, insere só a imagem (ou nada, se base64
   *   vazio) e REMOVE qualquer numeração já existente nesse rótulo — usado
   *   quando o toggle "exigir assinatura da assistência" está desativado:
   *   nesse caso só existe uma assinatura, então não faz sentido mostrar
   *   "1/2" sozinho no papel. Ver injetarAssinaturas() para a decisão de
   *   quando numerar=true vs false.
   */
  function injetarPorRotulo(html, rotulosPossiveis, base64, numero, total, numerar, estadoTexto) {
    if (!html) return html;
    if (numerar === undefined) numerar = true; // compatibilidade com chamadas antigas

    for (var p = 0; p < PARES_CLASSE.length; p++) {
      var classeEspaco = PARES_CLASSE[p].espaco;
      var classeLabel = PARES_CLASSE[p].label;

      // Regex do bloco inteiro: espaço (com ou sem conteúdo já injetado) +
      // linha + label com um dos textos esperados.
      // Usa [\s\S]*? (não guloso) para o conteúdo do espaço, e permite que a
      // linha de assinatura apareça (documento nunca assinado) ou não
      // (reinjeção, quando já removemos/mantemos a linha).
      var reEspacoAberto = new RegExp(
        '(<div class="' + classeEspaco + '"[^>]*>)([\\s\\S]*?)(</div>\\s*' +
          '(?:<div class="linha-assinatura"[^>]*></div>\\s*|<div class="assin-linha"[^>]*></div>\\s*)?' +
          '<div class="' + classeLabel + '"[^>]*>\\s*([^<]*?)\\s*</div>)',
        'g'
      );

      html = html.replace(
        reEspacoAberto,
        function (m, aberturaDiv, conteudoAtual, resto, textoLabel) {
          var labelNormalizado = normalizarTexto(textoLabel);
          var bateRotulo = rotulosPossiveis.some(function (r) {
            return normalizarTexto(r) === labelNormalizado;
          });
          if (!bateRotulo) return m; // não mexe em blocos de outro rótulo

          // A abertura da div "-espaco" ganha position:relative inline aqui,
          // na hora da injeção — não confiamos no CSS embutido no HTML (que
          // em documentos salvos no histórico antes desta correção não tem
          // essa regra), então garantimos a âncora sempre, direto na tag.
          // Sem isso, a imagem position:absolute abaixo subiria até o
          // ancestral posicionado mais próximo (ex: a folha inteira),
          // aparecendo colada no topo da página em vez de sobre a linha.
          //
          // TAMBÉM força aqui a altura mínima real do "-espaço" via
          // min-height inline (ver ESPACO_ALTURA_MIN abaixo). O CSS
          // estático de cada template reserva só 20-22px para esta div,
          // que é o suficiente para o texto "1/2" mas não para uma
          // assinatura legível. Como a imagem é position:absolute (não
          // participa do fluxo), ela NÃO empurra o conteúdo anterior nem é
          // "avisada" por ele — se o espaço reservado for pequeno demais,
          // a imagem cresce por cima do que vem ANTES dela na página (ex:
          // a seção de termos, quando o texto é longo e o autofit já
          // reduziu a fonte ao mínimo). Reservar altura de verdade aqui
          // garante uma "almofada" visual entre o fim dos termos e a
          // linha de assinatura, mesmo em documentos antigos do histórico
          // cujo CSS embutido não tem essa correção.
          var aberturaComAncora = aberturaDiv.replace(
            /^(<div class="[^"]*")([^>]*)>$/,
            function (mm, inicio, atributosResto) {
              // Remove um eventual style="..." pré-existente para não duplicar,
              // preservando o valor dentro do novo style consolidado.
              var styleExistente = '';
              atributosResto = atributosResto.replace(
                /\s*style="([^"]*)"/,
                function (_, s) {
                  styleExistente = s.replace(/;?\s*$/, ';');
                  return '';
                }
              );
              return (
                inicio +
                atributosResto +
                ' style="' +
                styleExistente +
                'position:relative;overflow:visible;' +
                'min-height:' + ESPACO_ALTURA_MIN + 'px;">'
              );
            }
          );

          // Reconstrói o bloco já assinado, e remove numeração antiga (se
          // houver) logo depois do "resto" para evitar duplicar ao reinjetar.
          // A imagem fica position:absolute ancorada na base do próprio
          // "-espaco" (bottom:0), pousando exatamente onde a linha de
          // assinatura começa em seguida, em vez de empilhada no fluxo
          // normal empurrando a linha/rótulo/numeração para baixo.
          //
          // max-height da imagem = IMG_ALTURA_MAX, que é MENOR OU IGUAL à
          // altura mínima agora reservada no container (ESPACO_ALTURA_MIN).
          // Antes a imagem podia crescer até 90px dentro de um espaço de
          // só ~22px — ou seja, até 68px dela ficavam necessariamente para
          // fora do próprio container, sobre o que estivesse acima na
          // página. Com as duas medidas alinhadas, o pior caso (traço
          // largo e baixo, tipo assinatura feita com o dedo) ainda cabe
          // inteiro dentro da área que o layout já reservou para ele.
          var assinaturaSegura = normalizarAssinaturaParaImagem(base64);
          var marcadorEstado = !assinaturaSegura && estadoTexto
            ? '<span data-assinatura-estado="1" style="position:absolute;left:0;right:0;bottom:5px;text-align:center;font-size:10px;font-weight:800;letter-spacing:.08em;color:' +
              (estadoTexto === 'AGUARDANDO ASSINATURA' ? '#9a6700' : '#b42318') + ';">' + estadoTexto + '</span>'
            : '';
          var blocoNovo =
            aberturaComAncora +
            (assinaturaSegura
              ? '<img src="' + assinaturaSegura + '" alt="assinatura" onerror="this.remove()" ' +
                'style="position:absolute;left:50%;bottom:0;' +
                'transform:translateX(-50%);max-height:' + IMG_ALTURA_MAX +
                'px;max-width:95%;' +
                'object-fit:contain;pointer-events:none;" ' +
                'data-assinatura-injetada="1" />'
              : marcadorEstado) +
            resto;

          return blocoNovo;
        }
      );

      // Agora insere/atualiza (ou remove, se numerar=false) a numeração
      // "N/total" logo depois do bloco do label que acabamos de tratar
      // (busca de novo, já com a assinatura presente, para inserir a
      // numeração exatamente após o label certo).
      var reLabelParaNumero = new RegExp(
        '(<div class="' + classeLabel + '"[^>]*>\\s*([^<]*?)\\s*</div>)' +
          '(\\s*(?:<div class="assinatura-numero"[^>]*>[\\s\\S]*?</div>\\s*)?)',
        'g'
      );

      html = html.replace(
        reLabelParaNumero,
        function (m, labelDiv, textoLabel, numeracaoAntigaOuVazio) {
          var labelNormalizado = normalizarTexto(textoLabel);
          var bateRotulo = rotulosPossiveis.some(function (r) {
            return normalizarTexto(r) === labelNormalizado;
          });
          if (!bateRotulo) return m;

          // numerar=false: remove qualquer numeração antiga e não insere
          // nova — cobre o caso do usuário ter assinado antes com o toggle
          // ligado (ficou "1/2" salvo) e depois desligado o toggle; ao
          // reabrir esse documento do histórico, a numeração órfã some.
          if (!numerar) return labelDiv;

          var badge =
            '<div class="assinatura-numero" data-assinatura-numero="1" ' +
            'style="font-size:8px;color:#888;letter-spacing:.05em;' +
            'margin-top:2px;text-align:center;">' +
            numero + '/' + total + '</div>';

          return labelDiv + badge;
        }
      );
    }

    return html;
  }

  /**
   * Função principal exportada.
   *
   * @param {string} html - HTML completo do documento (OS/venda/compra) já gerado
   *   pelo template (os-template.js / venda-template.js / compra-template.js).
   * @param {'os'|'venda'|'compra'|'entrega'} tipoDocumento
   * @param {object} assinaturas
   * @param {string|null} assinaturas.outraParte - base64 da assinatura da outra
   *   parte (cliente/comprador/vendedor-pessoa-física), ou null/undefined se
   *   ainda não assinou.
   * @param {string|null} assinaturas.assistencia - base64 da assinatura da
   *   assistência técnica (vem da assinatura padrão salva em config, ou de uma
   *   assinatura feita na hora só para aquele documento), ou null/undefined.
   * @param {boolean} [assinaturas.numerar] - Controle explícito da numeração
   *   "1/2, 2/2". Omitido (undefined): comportamento automático — numera só
   *   quando as DUAS assinaturas estão presentes. Passado como `false`:
   *   nunca numera, mesmo com as duas presentes — usado quando o usuário
   *   desativou "Numerar as assinaturas como 1/2 e 2/2" em Configurações
   *   (cfg.exigirAssinaturaAssistencia), já que esse toggle não decide mais
   *   SE a assinatura da assistência é injetada (ver
   *   app.js:obterAssinaturaAssistenciaAtual), só a numeração.
   * @returns {string} HTML com as assinaturas injetadas (idempotente).
   */
  function injetarAssinaturas(html, tipoDocumento, assinaturas) {
    if (!html) return html;
    assinaturas = assinaturas || {};

    var mapa = MAPA_ROTULOS[tipoDocumento];
    if (!mapa) {
      throw new Error(
        'assinatura-injetor: tipoDocumento inválido "' + tipoDocumento +
        '". Use "os", "venda", "compra" ou "entrega".'
      );
    }

    var resultado = html;

    // A numeração "1/2, 2/2" só faz sentido quando as DUAS assinaturas
    // existem de fato — nunca "1/2" sozinho. Se `assinaturas.numerar` foi
    // passado explicitamente (true/false), ele manda; se foi omitido
    // (undefined), cai no comportamento automático de sempre: numera só
    // quando outraParte E assistencia estão as duas presentes.
    var ambasPresentes = assinaturas.numerar !== undefined
      ? !!assinaturas.numerar
      : !!(assinaturas.outraParte && assinaturas.assistencia);

    if (assinaturas.outraParte || assinaturas.estadoOutraParte) {
      resultado = injetarPorRotulo(
        resultado,
        mapa.rotulosOutraParte,
        assinaturas.outraParte,
        1,
        2,
        ambasPresentes,
        assinaturas.estadoOutraParte || ''
      );
    }

    if (assinaturas.assistencia) {
      resultado = injetarPorRotulo(
        resultado,
        mapa.rotulosAssistencia,
        assinaturas.assistencia,
        2,
        2,
        ambasPresentes
      );
    } else {
      // Não há assinatura da assistência para injetar agora — mas pode
      // haver uma numeração ÓRFÃ de uma injeção anterior (documento salvo
      // no histórico quando o toggle estava ligado, reaberto agora com o
      // toggle desligado). injetarPorRotulo com base64='' e numerar=false
      // limpa essa numeração antiga sem inserir imagem nenhuma.
      resultado = injetarPorRotulo(
        resultado,
        mapa.rotulosAssistencia,
        '',
        2,
        2,
        false
      );
    }

    return resultado;
  }

  return {
    injetarAssinaturas: injetarAssinaturas,
    // expostos para teste/depuração
    _MAPA_ROTULOS: MAPA_ROTULOS,
    _normalizarTexto: normalizarTexto,
    _normalizarAssinaturaParaImagem: normalizarAssinaturaParaImagem
  };
});
