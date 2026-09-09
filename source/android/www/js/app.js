// js/app.js
//
// Orquestra: carrega os 4 arquivos originais do PC (via browser-shim.js) em
// segundo plano assim que a página abre; ao enviar o formulário, valida os
// dados (js/validacao.js, espelhando validarDadosOS do PC), monta o objeto
// `os` a partir dos campos preenchidos, chama gerarHtmlOS(os, config) e
// escreve o resultado dentro do <iframe> de prévia.

(function () {
  // Aplica o modo escuro salvo (js/config.js) assim que o app abre, antes
  // de qualquer outra coisa — evita o "flash" da tela clara antes de trocar
  // pra escura em quem já deixou essa preferência salva.
  window.TemaApp.inicializarDeConfig(window.ConfigApp.carregarConfig());

  var form = document.getElementById('form-os');
  var btnGerar = document.getElementById('btn-gerar-previa');
  var btnEditar = document.getElementById('btn-editar');
  var painelStatus = document.getElementById('painel-status');
  var painelPreview = document.getElementById('painel-preview');
  var erroGeral = document.getElementById('erro-geral');
  var frame = document.getElementById('frame-preview');

  function aplicarEstadoSemPrazoOS() {
    var marcado = document.getElementById('os-sem-prazo')?.checked === true;
    ['os-data-prevista', 'os-hora-prevista'].forEach(function (id) {
      var campo = document.getElementById(id);
      if (!campo) return;
      campo.disabled = marcado;
      if (marcado) campo.value = '';
    });
  }

  var campoSemPrazoOS = document.getElementById('os-sem-prazo');
  if (campoSemPrazoOS) campoSemPrazoOS.addEventListener('change', aplicarEstadoSemPrazoOS);

  // Parte 3 — elementos da assinatura e das ações finais.
  var btnAssinar = document.getElementById('btn-assinar');
  var avisoAssinado = document.getElementById('aviso-assinado');
  var btnAssinarAssistencia = document.getElementById('btn-assinar-assistencia');
  var avisoAssinadoAssistencia = document.getElementById('aviso-assinado-assistencia');
  var btnSalvarHistorico = document.getElementById('btn-salvar-historico');
  var btnExportarPC = document.getElementById('btn-exportar-pc');
  var btnEmitirComprovante = document.getElementById('btn-emitir-comprovante');
  var feedbackAcao = document.getElementById('feedback-acao');

  // Trava síncrona contra clique duplo/toque longo em "Salvar no
  // histórico". `btnSalvarHistorico.disabled = true` sozinho não bastava:
  // em WebView Android, segurar o dedo ou tocar duas vezes bem rápido pode
  // gerar mais de um evento 'click' real antes do `disabled` ser aplicado
  // pelo motor de render (é uma trava visual/de DOM, não atômica). Uma
  // variável booleana comum, checada na primeira linha do handler, é
  // atômica em JS (single-thread) e não depende do DOM ter processado nada
  // ainda — por isso resolve mesmo quando os cliques chegam "juntos".
  var salvandoNoHistorico = false;

  // Parte 4 — navegação e tela de histórico.
  var btnIrNovo = document.getElementById('btn-ir-novo');
  var btnIrHistorico = document.getElementById('btn-ir-historico');
  var painelHistorico = document.getElementById('painel-historico');
  var listaHistorico = document.getElementById('lista-historico');
  var bannerModoHistorico = document.getElementById('banner-modo-historico');
  var btnVoltarHistorico = document.getElementById('btn-voltar-historico');

  // Parte 2.1 — as outras 2 abas que passam a existir na navegação
  // (Compra e Venda têm formulário próprio; Configurações tem painel
  // próprio). Os formulários de Compra/Venda em si — validação, geração
  // de prévia, assinatura — continuam de fora desta parte.
  var btnIrCompra = document.getElementById('btn-ir-compra');
  var btnIrVenda = document.getElementById('btn-ir-venda');
  var btnIrEntrega = document.getElementById('btn-ir-entrega');
  var btnIrDesbloqueios = document.getElementById('btn-ir-desbloqueios');
  var btnIrConfig = document.getElementById('btn-ir-config');
  var btnIrDocumentos = document.getElementById('btn-ir-documentos');
  var btnIrConsulta = document.getElementById('btn-ir-consulta');
  var btnIrCobrancas = document.getElementById('btn-ir-cobrancas');
  var btnIrQr = document.getElementById('btn-ir-qr');
  var btnIrEstatisticas = document.getElementById('btn-ir-estatisticas');
  var btnIrPrazos = document.getElementById('btn-ir-prazos');
  var btnIrEstoque = document.getElementById('btn-ir-estoque');
  var btnIrPrecos = document.getElementById('btn-ir-precos');
  var formCompra = document.getElementById('form-compra');
  var formVenda = document.getElementById('form-venda');
  var formEntrega = document.getElementById('form-entrega');
  var painelDesbloqueios = document.getElementById('painel-desbloqueios');
  // Vínculo com um aparelho já existente no estoque. Mantê-lo durante a
  // venda evita criar outro EST-xxxx quando a assinatura chegar ao PC.
  var estoqueVendaAtual = null;
  var painelConfig = document.getElementById('painel-config');
  var painelDocumentos = document.getElementById('painel-documentos');
  var painelConsulta = document.getElementById('painel-consulta');
  var painelCobrancas = document.getElementById('painel-cobrancas');
  var painelQr = document.getElementById('painel-qr');
  var painelEstatisticas = document.getElementById('painel-estatisticas');
  var painelPrazos = document.getElementById('painel-prazos');
  var painelEstoque = document.getElementById('painel-estoque');
  var painelPrecos = document.getElementById('painel-precos');

  // Número da OS (Entregas) — só dígitos. inputmode="numeric" no HTML já
  // troca o teclado do Android para o numérico, mas não bloqueia colar
  // texto nem teclado físico; este listener garante o filtro de verdade,
  // removendo qualquer caractere não-numérico a cada digitação.
  var campoEntregaNumeroOS = document.getElementById('entrega-numero-os');
  if (campoEntregaNumeroOS) {
    campoEntregaNumeroOS.addEventListener('input', function () {
      var somenteDigitos = campoEntregaNumeroOS.value.replace(/\D/g, '');
      if (somenteDigitos !== campoEntregaNumeroOS.value) {
        campoEntregaNumeroOS.value = somenteDigitos;
      }
    });
  }

  // Checkbox "não tem número" — desabilita o campo de telefone quando marcado
  function configurarCheckboxNumero(checkboxId, inputId) {
    var checkbox = document.getElementById(checkboxId);
    var input = document.getElementById(inputId);
    if (checkbox && input) {
      checkbox.addEventListener('change', function () {
        input.disabled = checkbox.checked;
        if (checkbox.checked) {
          input.value = '';
          input.placeholder = 'Não informado';
        } else {
          input.placeholder = '(00) 00000-0000';
        }
      });
    }
  }
  configurarCheckboxNumero('cliente-sem-numero', 'cliente-telefone');
  configurarCheckboxNumero('compra-vendedor-sem-numero', 'compra-vendedor-telefone');
  configurarCheckboxNumero('venda-comprador-sem-numero', 'venda-comprador-telefone');

  // Guarda o nome da última tela mostrada — usado só para saber quando o
  // técnico está SAINDO da aba 'consulta' (ver mostrarTela abaixo), para
  // parar a escuta em tempo real de numerosAtribuidos nesse momento em
  // vez de deixá-la rodando pra sempre em segundo plano.
  var telaAnterior = null;

  // Mapa nome-da-tela -> { elemento, botãoDeNavCorrespondente } usado por
  // mostrarTela(). "preview" e "historico" não têm um botão de nav próprio
  // dedicado (a prévia é alcançada a partir de qualquer formulário, e o
  // destaque do botão de histórico já é tratado à parte, mais abaixo,
  // porque também precisa considerar o modo "preview a partir do histórico").
  var TELAS = {
    form: { elemento: form, botaoNav: btnIrNovo },
    compra: { elemento: formCompra, botaoNav: btnIrCompra },
    venda: { elemento: formVenda, botaoNav: btnIrVenda },
    entrega: { elemento: formEntrega, botaoNav: btnIrEntrega },
    desbloqueios: { elemento: painelDesbloqueios, botaoNav: btnIrDesbloqueios },
    preview: { elemento: painelPreview, botaoNav: null },
    historico: { elemento: painelHistorico, botaoNav: btnIrHistorico },
    config: { elemento: painelConfig, botaoNav: btnIrConfig },
    documentos: { elemento: painelDocumentos, botaoNav: btnIrDocumentos },
    consulta: { elemento: painelConsulta, botaoNav: btnIrConsulta },
    cobrancas: { elemento: painelCobrancas, botaoNav: btnIrCobrancas },
    qr: { elemento: painelQr, botaoNav: btnIrQr },
    estatisticas: { elemento: painelEstatisticas, botaoNav: btnIrEstatisticas },
    prazos: { elemento: painelPrazos, botaoNav: btnIrPrazos },
    estoque: { elemento: painelEstoque, botaoNav: btnIrEstoque },
    precos: { elemento: painelPrecos, botaoNav: btnIrPrecos }
  };

  // `os` (ou, a partir de agora, o documento de Compra) da prévia
  // atualmente exibida — vive aqui (fora do handler de submit) porque a
  // assinatura, o histórico e a exportação acontecem em passos depois,
  // sobre este MESMO objeto. O nome da variável ficou `osAtual` por
  // herança (Parte 3, só-OS); mantido assim para não caçar-substituir
  // sem necessidade em todo o arquivo — `documentoAtualTipo` é quem diz
  // se o conteúdo de osAtual é uma OS ou uma Compra.
  var osAtual = null;

  // 'os' | 'compra' — qual tipo de documento está em osAtual agora.
  // Decide qual gerarHtmlXxx/validarDadosXxx/aplicarAssinaturasXxx usar
  // nos passos de assinar/salvar/exportar, que são compartilhados pelos
  // 3 formulários através do mesmo painel de prévia.
  var documentoAtualTipo = 'os';
  var camposAssinarDepois = {
    os: document.getElementById('os-assinar-depois'),
    compra: document.getElementById('compra-assinar-depois'),
    venda: document.getElementById('venda-assinar-depois'),
    entrega: document.getElementById('entrega-assinar-depois')
  };
  var camposNaoAssinado = {
    os: document.getElementById('os-nao-assinado'),
    compra: document.getElementById('compra-nao-assinado'),
    venda: document.getElementById('venda-nao-assinado'),
    entrega: document.getElementById('entrega-nao-assinado')
  };
  var campoAssinarDepois = camposAssinarDepois.os; // alias legado

  function assinarDepoisMarcado(tipo) {
    var campo = camposAssinarDepois[tipo];
    return !!(campo && campo.checked);
  }

  function naoAssinadoMarcado(tipo) {
    var campo = camposNaoAssinado[tipo];
    return !!(campo && campo.checked);
  }

  // As duas escolhas têm significados diferentes e são mutuamente
  // exclusivas: "Assinar depois" mantém uma pendência; "Não assinado"
  // encerra o documento sem assinatura por decisão explícita do usuário.
  Object.keys(camposAssinarDepois).forEach(function (tipo) {
    var depois = camposAssinarDepois[tipo];
    var naoAssinado = camposNaoAssinado[tipo];
    if (depois) depois.addEventListener('change', function () {
      if (depois.checked && naoAssinado) naoAssinado.checked = false;
    });
    if (naoAssinado) naoAssinado.addEventListener('change', function () {
      if (naoAssinado.checked && depois) depois.checked = false;
    });
  });

  function assinaturaDoDocumento(dados, tipo) {
    if (!dados) return '';
    if (tipo === 'compra') return dados.assinaturaVendedorBase64 || '';
    if (tipo === 'venda') return dados.assinaturaCompradorBase64 || '';
    if (tipo === 'entrega') return dados.assinaturaRetirouBase64 || '';
    return dados.assinaturaClienteBase64 || '';
  }

  function assinaturaEstaPendente(dados, tipo) {
    return !!(dados && dados.assinaturaPendente === true && !assinaturaDoDocumento(dados, tipo));
  }

  function documentoFoiMarcadoNaoAssinado(dados, tipo) {
    return !!(dados && dados.naoAssinado === true && !assinaturaDoDocumento(dados, tipo));
  }

  // true quando a prévia em tela veio de "Abrir" no histórico (releitura
  // de algo já salvo e já assinado) — nesse modo escondemos as ações que
  // só fazem sentido pra uma OS nova (assinar, editar, salvar de novo).
  var emModoHistorico = false;

  // Id do registro do histórico local (IndexedDB) correspondente ao
  // documento atualmente em osAtual — null quando osAtual é uma prévia
  // nova ainda não salva. Setado em 2 pontos: (a) abrirItemHistorico, ao
  // reabrir um item já salvo; (b) depois que "Salvar no histórico"
  // termina com sucesso. Resetado (null) em cada um dos 3 handlers de
  // submit (nova OS/Compra/Venda), já que uma prévia nova ainda não tem
  // registro correspondente. Usado pelo botão "Exportar para o PC" da
  // tela de prévia para saber se deve marcar aquele registro específico
  // como sincronizado depois de exportar — sem isso, reexportar um item
  // do histórico deixava o selo "Pendente" preso pra sempre mesmo depois
  // de já ter sido exportado com sucesso.
  var registroHistoricoAtualId = null;

  // Bloco 4: estado de edição de item do histórico. Quando true, o salvar
  // usa editarRegistro() em vez de salvar(), preservando o MESMO id e
  // idExportacaoOriginal.
  var emEdicaoHistorico = false;
  var idEmEdicaoHistorico = null;
  var entregaReferenciaRemota = null;
  var entregaOriginal = null;


  var gerarHtmlOS = null;
  var gerarHtmlComprovanteOS = null;
  var gerarHtmlCompra = null;
  var gerarHtmlVenda = null;
  var gerarHtmlEntrega = null;
  var carregamentoModulos = window.__carregarModulosOS([
    { nome: 'termos-predefinidos', src: 'src/termos-predefinidos.js' },
    { nome: 'tema-pdf', src: 'src/templates/tema-pdf.js' },
    { nome: 'empresa-compositor', src: 'src/templates/empresa-compositor.js' },
    { nome: 'os-template', src: 'src/templates/os-template.js' },
    { nome: 'comprovante-os-template', src: 'src/templates/comprovante-os-template.js' },
    { nome: 'compra-template', src: 'src/templates/compra-template.js' },
    { nome: 'venda-template', src: 'src/templates/venda-template.js' },
    { nome: 'entrega-template', src: 'src/templates/entrega-template.js' }
    ,{ nome: 'fonte-termos-pdf', src: 'src/templates/fonte-termos-pdf.js' }
    ,{ nome: 'garantia-template', src: 'src/templates/garantia-template.js' }
    ,{ nome: 'desbloqueio-template', src: 'src/templates/desbloqueio-template.js' }
  ])
    .then(function () {
      gerarHtmlOS = window.__modules['os-template'].exports.gerarHtmlOS;
      gerarHtmlComprovanteOS = window.__modules['comprovante-os-template'].exports.gerarHtmlComprovanteOS;
      window.SistemaOSGerarHtmlComprovante = gerarHtmlComprovanteOS;
      gerarHtmlCompra = window.__modules['compra-template'].exports.gerarHtmlCompra;
      gerarHtmlVenda = window.__modules['venda-template'].exports.gerarHtmlVenda;
      gerarHtmlEntrega = window.__modules['entrega-template'].exports.gerarHtmlEntrega;
      window.SistemaOSGerarHtmlGarantia = window.__modules['garantia-template'].exports.gerarHtmlGarantia;
      if (typeof gerarHtmlOS !== 'function') {
        throw new Error(
          'gerarHtmlOS não foi encontrado em module.exports de os-template.js — ' +
          'confira se o arquivo copiado do PC não foi alterado.'
        );
      }
      if (typeof gerarHtmlComprovanteOS !== 'function') {
        throw new Error('O template do comprovante da OS não foi carregado.');
      }
      if (typeof gerarHtmlCompra !== 'function') {
        throw new Error(
          'gerarHtmlCompra não foi encontrado em module.exports de compra-template.js — ' +
          'confira se o arquivo copiado do PC não foi alterado.'
        );
      }
      if (typeof gerarHtmlVenda !== 'function') {
        throw new Error(
          'gerarHtmlVenda não foi encontrado em module.exports de venda-template.js — ' +
          'confira se o arquivo copiado do PC não foi alterado.'
        );
      }
      if (typeof gerarHtmlEntrega !== 'function') {
        throw new Error(
          'gerarHtmlEntrega não foi encontrado em module.exports de entrega-template.js.'
        );
      }
      // Preenche o texto de prévia da declaração fixa no form-entrega
      // (elemento estático, só para o técnico ler ANTES de gerar a prévia
      // de verdade — o texto que efetivamente vai no PDF é lido de novo,
      // fresco, dentro de montarObjetoEntrega() a cada submit).
      var elDeclaracaoPreview = document.getElementById('entrega-declaracao-preview-texto');
      if (elDeclaracaoPreview) {
        elDeclaracaoPreview.textContent = window.__modules['termos-predefinidos'].exports.DECLARACAO_ENTREGA;
      }
      ['os', 'compra', 'venda'].forEach(function (tipo) {
        preencherTermosPadraoDocumento(tipo, false);
      });
    })
    .catch(function (err) {
      mostrarErroCarregamento(err && err.message ? err.message : String(err));
    });

  // Exposto para js/documentos-recebidos.js (aba "Documentos") esperar os
  // templates originais do PC terminarem de carregar antes de gerar
  // qualquer prévia — mesma promise usada internamente aqui em cima, só
  // republicada em window porque aquele módulo é um arquivo separado e
  // não tem acesso a esta variável fechada no IIFE.
  window.__modulosOSPromise = carregamentoModulos;

  if (btnEmitirComprovante) {
    btnEmitirComprovante.addEventListener('click', function () {
      if (documentoAtualTipo !== 'os' && documentoAtualTipo !== 'entrega') {
        mostrarFeedback('O comprovante térmico está disponível para OS e Entrega.', true);
        return;
      }
      carregamentoModulos.then(function () {
        var dadosComprovante = Object.assign({}, osAtual || {});
        var promessaNumero = Promise.resolve(dadosComprovante);
        if (registroHistoricoAtualId && window.SistemaOSHistorico &&
            typeof window.SistemaOSHistorico.obterPorId === 'function') {
          promessaNumero = window.SistemaOSHistorico.obterPorId(registroHistoricoAtualId)
            .then(function (registro) {
              if (registro && registro.numeroOSAtribuido) {
                dadosComprovante.numeroOSAtribuido = registro.numeroOSAtribuido;
                if (documentoAtualTipo === 'os') dadosComprovante.numero = registro.numeroOSAtribuido;
              }
              return dadosComprovante;
            });
        }
        if (documentoAtualTipo === 'entrega') {
          dadosComprovante = Object.assign({}, osAtual, {
            numero: osAtual.numero || osAtual.numeroOS,
            status: 'Entregue',
            tipoComprovante: 'entrega',
            cliente: {
              nome: osAtual.nomeRetirou || '',
              cpf: osAtual.cpfRetirou || '',
              telefone: osAtual.telefoneRetirou || ''
            },
            aparelho: {
              marca: osAtual.marca || '',
              modelo: osAtual.modelo || ''
            },
            entrega: osAtual,
            dadosEntrega: osAtual,
            valorTotalServico: osAtual.valorReparo || 0,
            formaPagamento: osAtual.formaPagamento || ''
          });
          promessaNumero = Promise.resolve(dadosComprovante);
        }
        return promessaNumero.then(function (dadosNumerados) {
          return window.SistemaOSComprovante.abrir({
            dados: dadosNumerados,
            config: obterConfigEmpresaAtual(),
            gerarHtml: gerarHtmlComprovanteOS
          });
        });
      }).catch(function (erro) {
        mostrarFeedback('Não foi possível emitir o comprovante: ' + (erro.message || erro), true);
      });
    });
  }

  function mostrarErroCarregamento(mensagem) {
    painelStatus.hidden = false;
    painelStatus.innerHTML =
      '<p class="erro">Falha ao carregar o template original do PC.</p>' +
      '<pre class="erro-detalhe"></pre>';
    painelStatus.querySelector('.erro-detalhe').textContent = mensagem;
  }

  function texto(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  // Os templates já priorizam o termo salvo no próprio documento. Este
  // bloco torna essa capacidade visível no celular e resolve o mesmo texto
  // que sairia da configuração (customizado > padrão do usuário > fábrica),
  // para o técnico poder revisá-lo e alterá-lo antes de gerar o PDF.
  var CAMPOS_TERMOS_DOCUMENTO = {
    os: {
      campo: 'os-termos', usar: 'usarTermosPredefinidosOS',
      custom: 'termosOS', padraoUsuario: 'termosPadraoUsuarioOS', fabrica: 'TERMOS_OS'
    },
    compra: {
      campo: 'compra-termos', usar: 'usarTermosPredefinidosCompra',
      custom: 'termosCompra', padraoUsuario: 'termosPadraoUsuarioCompra', fabrica: 'TERMOS_COMPRA'
    },
    venda: {
      campo: 'venda-termos', usar: 'usarTermosPredefinidosVenda',
      custom: 'termosVenda', padraoUsuario: 'termosPadraoUsuarioVenda', fabrica: 'TERMOS_VENDA'
    }
  };
  var termosPadraoAtual = { os: '', compra: '', venda: '' };

  function resolverTermosPadraoDocumento(tipo) {
    var meta = CAMPOS_TERMOS_DOCUMENTO[tipo];
    if (!meta) return '';
    var config = obterConfigEmpresaAtual();
    var custom = String(config[meta.custom] || '').trim();
    if (custom) return custom;
    if (config[meta.usar]) {
      var padraoUsuario = String(config[meta.padraoUsuario] || '').trim();
      if (padraoUsuario) return padraoUsuario;
      var modulo = window.__modules && window.__modules['termos-predefinidos'];
      return String(modulo && modulo.exports && modulo.exports[meta.fabrica] || '').trim();
    }
    return '';
  }

  function atualizarEstadoTermosDocumento(tipo) {
    var meta = CAMPOS_TERMOS_DOCUMENTO[tipo];
    var campo = meta && document.getElementById(meta.campo);
    var estado = document.querySelector('[data-termos-status="' + tipo + '"]');
    if (!campo || !estado) return;
    var atual = String(campo.value || '').trim();
    var padrao = String(termosPadraoAtual[tipo] || '').trim();
    var personalizado = atual !== padrao;
    estado.textContent = personalizado
      ? 'Alterado somente neste documento'
      : (padrao ? 'Usando o padrão atual' : 'Nenhum termo padrão configurado');
    estado.classList.toggle('termos-alterados', personalizado);
  }

  function preencherTermosPadraoDocumento(tipo, forcar) {
    var meta = CAMPOS_TERMOS_DOCUMENTO[tipo];
    var campo = meta && document.getElementById(meta.campo);
    if (!campo) return;
    var padraoAnterior = String(termosPadraoAtual[tipo] || '').trim();
    var valorAtual = String(campo.value || '').trim();
    var novoPadrao = resolverTermosPadraoDocumento(tipo);
    termosPadraoAtual[tipo] = novoPadrao;
    // Se o texto ainda era o padrão antigo, acompanhe uma configuração que
    // acabou de ser atualizada. Texto realmente editado pelo técnico não é
    // sobrescrito ao alternar entre as abas.
    if (forcar || !valorAtual || valorAtual === padraoAnterior) campo.value = novoPadrao;
    atualizarEstadoTermosDocumento(tipo);
  }

  function definirTermosDocumento(tipo, valorSalvo) {
    var meta = CAMPOS_TERMOS_DOCUMENTO[tipo];
    var campo = meta && document.getElementById(meta.campo);
    if (!campo) return;
    termosPadraoAtual[tipo] = resolverTermosPadraoDocumento(tipo);
    campo.value = String(valorSalvo || '').trim() || termosPadraoAtual[tipo];
    atualizarEstadoTermosDocumento(tipo);
  }

  Object.keys(CAMPOS_TERMOS_DOCUMENTO).forEach(function (tipo) {
    var campo = document.getElementById(CAMPOS_TERMOS_DOCUMENTO[tipo].campo);
    if (campo) campo.addEventListener('input', function () { atualizarEstadoTermosDocumento(tipo); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-restaurar-termos-documento]'), function (botao) {
    botao.addEventListener('click', function () {
      preencherTermosPadraoDocumento(botao.getAttribute('data-restaurar-termos-documento'), true);
    });
  });

  // Rascunho da Nova OS: a câmera nativa pode recriar a WebView em aparelhos
  // com pouca memória. Guardar campos e fotos já comprimidas em IndexedDB
  // faz o formulário voltar exatamente de onde o técnico parou.
  var timerRascunhoOS = null;
  var operacaoRascunhoOS = Promise.resolve(true);
  var restaurandoRascunhoOS = false;
  var rascunhoOSConcluido = false;
  var RASCUNHO_OS_ID = 'nova-os-em-andamento';

  function coletarRascunhoOS() {
    var campos = {};
    if (form) {
      Array.prototype.forEach.call(form.querySelectorAll('input, select, textarea'), function (el) {
        if (!el.id || el.type === 'file' || el.type === 'submit' || el.type === 'button' || el.type === 'reset') return;
        campos[el.id] = el.type === 'checkbox' ? !!el.checked : el.value;
      });
    }
    return {
      campos: campos,
      fotos: window.SistemaOSFotos ? window.SistemaOSFotos.obterFotos('os') : [],
      acessoriosChecklist: checkboxesMarcados('.os-acessorio-check'),
      testesEntrada: checkboxesMarcados('.os-teste-entrada')
    };
  }

  function rascunhoOSPossuiConteudo(rascunho) {
    if (!rascunho) return false;
    if (Array.isArray(rascunho.fotos) && rascunho.fotos.length) return true;
    return Object.keys(rascunho.campos || {}).some(function (id) {
      var valor = rascunho.campos[id];
      if (id === 'os-termos' && String(valor || '').trim() === String(termosPadraoAtual.os || '').trim()) return false;
      return valor !== '' && valor !== false && valor !== null && valor !== undefined;
    });
  }

  function salvarRascunhoOS(imediato) {
    if (restaurandoRascunhoOS || rascunhoOSConcluido || emEdicaoHistorico || !window.SistemaOSHistorico?.salvarRascunho) return;
    if (timerRascunhoOS) {
      clearTimeout(timerRascunhoOS);
      timerRascunhoOS = null;
    }
    function salvarAgora() {
      timerRascunhoOS = null;
      var dados = coletarRascunhoOS();
      // Serializa as gravações. Sem isso, uma escrita iniciada antes do
      // salvamento definitivo podia terminar depois da remoção e recriar o
      // rascunho fantasma.
      operacaoRascunhoOS = operacaoRascunhoOS.catch(function () { return false; }).then(function () {
        if (rascunhoOSConcluido) return false;
        return window.SistemaOSHistorico.salvarRascunho(RASCUNHO_OS_ID, dados);
      });
      operacaoRascunhoOS.catch(function () {
        // O rascunho é proteção extra; uma falha de armazenamento não pode
        // travar o preenchimento normal da OS.
      });
      return operacaoRascunhoOS;
    }
    if (imediato) salvarAgora();
    else timerRascunhoOS = setTimeout(salvarAgora, 700);
  }

  function finalizarRascunhoOS() {
    rascunhoOSConcluido = true;
    if (timerRascunhoOS) {
      clearTimeout(timerRascunhoOS);
      timerRascunhoOS = null;
    }
    // Espera qualquer escrita anterior e então grava um marcador vazio. A
    // promessa é aguardada pelo fluxo de salvar antes de liberar a tela.
    operacaoRascunhoOS = operacaoRascunhoOS.catch(function () { return false; }).then(function () {
      if (window.SistemaOSHistorico?.concluirRascunho) {
        return window.SistemaOSHistorico.concluirRascunho(RASCUNHO_OS_ID);
      }
      if (window.SistemaOSHistorico?.removerRascunho) {
        return window.SistemaOSHistorico.removerRascunho(RASCUNHO_OS_ID);
      }
      return false;
    });
    return operacaoRascunhoOS;
  }

  function restaurarRascunhoOS() {
    if (!window.SistemaOSHistorico?.obterRascunho || !form) return;
    window.SistemaOSHistorico.obterRascunho(RASCUNHO_OS_ID).then(function (registro) {
      var rascunho = registro && registro.dados;
      if (!rascunhoOSPossuiConteudo(rascunho)) return;
      restaurandoRascunhoOS = true;
      var campos = rascunho.campos || {};
      Object.keys(campos).forEach(function (id) {
        var el = document.getElementById(id);
        if (!el || el.type === 'checkbox' || el.type === 'file') return;
        el.value = campos[id] === undefined || campos[id] === null ? '' : campos[id];
      });
      Object.keys(campos).forEach(function (id) {
        var el = document.getElementById(id);
        if (!el || el.type !== 'checkbox') return;
        el.checked = !!campos[id];
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      if (window.SistemaOSFotos) window.SistemaOSFotos.definirFotos('os', rascunho.fotos || []);
      marcarCheckboxes('.os-acessorio-check', rascunho.acessoriosChecklist);
      marcarCheckboxes('.os-teste-entrada', rascunho.testesEntrada);
      restaurandoRascunhoOS = false;
      mostrarFeedback('Rascunho da Nova OS recuperado.', false);
    }).catch(function () {
      restaurandoRascunhoOS = false;
    });
  }

  if (form) {
    form.addEventListener('input', function () { rascunhoOSConcluido = false; salvarRascunhoOS(false); });
    form.addEventListener('change', function () { rascunhoOSConcluido = false; salvarRascunhoOS(false); });
  }
  document.addEventListener('sistemaos:fotos-alteradas', function (ev) {
    if (ev?.detail?.contexto !== 'os') return;
    if (window.SistemaOSFotos?.obterFotos('os').length) rascunhoOSConcluido = false;
    // A câmera pode pausar/recriar a WebView. Para fotos, o rascunho precisa
    // estar gravado antes de permitir outra captura, não apenas no debounce.
    salvarRascunhoOS(true);
  });
  window.addEventListener('pagehide', function () { salvarRascunhoOS(true); });
  // Deixa os listeners acima prontos antes de preencher os valores salvos.
  setTimeout(restaurarRascunhoOS, 0);

  // Lê todos os checkboxes marcados que casam com o seletor CSS informado
  // e devolve os respectivos `value` em um array — mesmo formato que
  // compra-template.js espera para `aparelho.situacao` (join(', ') na
  // hora de renderizar). Usado por enquanto só na Situação do aparelho
  // (Compra), mas é genérico o bastante para qualquer grupo futuro.
  function checkboxesMarcados(seletor) {
    var els = document.querySelectorAll(seletor + ':checked');
    var valores = [];
    for (var i = 0; i < els.length; i++) valores.push(els[i].value);
    return valores;
  }

  function marcarCheckboxes(seletor, valores) {
    var selecionados = Array.isArray(valores) ? valores : [];
    Array.prototype.forEach.call(document.querySelectorAll(seletor), function (campo) {
      campo.checked = selecionados.indexOf(campo.value) >= 0;
    });
  }

  // Monta o objeto `os` a partir do formulário, usando EXATAMENTE os campos
  // do contrato do .json fixado na Parte 1 (mesma forma que criarOS espera
  // em dadosOS.cliente / dadosOS.aparelho / raiz). Campos que existem em
  // criarOS mas não fazem parte do formulário do celular (diagnóstico
  // técnico, controle interno, técnico responsável etc.) não são incluídos
  // aqui — são preenchidos depois, no PC.
  function montarObjetoOS() {
    return {
      // Placeholder definitivo desta fase — o celular nunca numera OS de
      // verdade (ver decisão de arquitetura). O PC gera o número oficial
      // no momento da importação.
      numero: 'PRÉVIA — sem número',
      data: new Date().toISOString(),
      status: texto('os-status') || 'Aguardando análise',
      valor: texto('os-valor'),
      diagnosticoTecnico: Object.assign({}, emEdicaoHistorico && osAtual ? osAtual.diagnosticoTecnico : {}, { valorEstimado: texto('os-valor') }),
      cliente: {
        nome: texto('cliente-nome'),
        cpf: texto('cliente-cpf'),
        email: texto('cliente-email'),
        telefone: document.getElementById('cliente-sem-numero')?.checked ? '' : texto('cliente-telefone'),
        semNumero: document.getElementById('cliente-sem-numero')?.checked || false
      },
      aparelho: {
        tipo: '',
        tipoEquipamento: texto('aparelho-tipo-equipamento') || 'Smartphone',
        marca: texto('aparelho-marca'),
        modelo: texto('aparelho-modelo'),
        cor: texto('aparelho-cor'),
        imei: texto('aparelho-imei'),
        defeitoRelatado: texto('aparelho-defeito'),
        observacoes: texto('aparelho-observacoes'),
        acessorios: texto('aparelho-acessorios'),
        acessoriosChecklist: checkboxesMarcados('.os-acessorio-check'),
        testesEntrada: checkboxesMarcados('.os-teste-entrada'),
        senhaAparelho: texto('aparelho-senha')
      },
      observacoes: texto('os-observacoes'),
      prioridade: window.SistemaOSValidacao.PRIORIDADES_OS_VALIDAS.indexOf(texto('os-prioridade')) !== -1
        ? texto('os-prioridade')
        : 'Normal',
      semPrazo: document.getElementById('os-sem-prazo')?.checked === true,
      dataPrevista: document.getElementById('os-sem-prazo')?.checked ? '' : texto('os-data-prevista'),
      horaPrevista: document.getElementById('os-sem-prazo')?.checked ? '' : texto('os-hora-prevista'),
      // Prazo de garantia em dias — registrado só para controle interno/PC,
      // NÃO é lido por os-template.js (não aparece no PDF da OS, ver
      // decisão do usuário). Campo vazio cai para o padrão configurado em
      // Configurações (garantiaDiasPadrao, padrão de fábrica 90).
      garantiaDias: garantiaDiasResolvida('os-garantia-dias'),
      termos: texto('os-termos'),
      fotos: window.SistemaOSFotos ? window.SistemaOSFotos.obterFotos('os') : [],
      assinaturaClienteBase64: '',
      assinaturaPendente: assinarDepoisMarcado('os') && !naoAssinadoMarcado('os'),
      naoAssinado: naoAssinadoMarcado('os'),
      assinaturaAssistenciaBase64: (window.ConfigApp.carregarConfig().assinaturaAssistenciaBase64 || '')
    };
  }

  // Resolve o valor de garantia (dias) de um campo numérico do formulário:
  // se o técnico digitou algo, usa o valor digitado (nunca negativo); se
  // deixou vazio, cai para o padrão salvo em Configurações
  // (garantiaDiasPadrao). Usado tanto por montarObjetoOS quanto por
  // montarObjetoEntrega para não duplicar a mesma regra em dois lugares.
  function garantiaDiasResolvida(idCampo) {
    var el = document.getElementById(idCampo);
    var bruto = el ? String(el.value || '').trim() : '';
    if (bruto === '') {
      var cfg = window.ConfigApp.carregarConfig();
      return Number(cfg.garantiaDiasPadrao) || 0;
    }
    return Math.max(0, Number(bruto) || 0);
  }

  function normalizarGarantiaVenda(valor) {
    var textoGarantia = String(valor == null ? '' : valor).trim();
    if (!textoGarantia) return '';
    return /^0(?:[.,]0+)?(?:\s*(?:dia(?:s)?|m[e\u00ea]s(?:es)?|ano(?:s)?))?$/i.test(textoGarantia)
      ? 'Sem garantia'
      : textoGarantia;
  }

  // Monta o objeto `cp` a partir do form-compra, no formato exato que
  // gerarHtmlCompra(cp, config) espera (src/templates/compra-template.js):
  // { numero, data, vendedor, aparelho, avaliacao, dadosCompra }. Mesmo
  // placeholder de número que a OS usa — o celular também não numera
  // contratos de compra (mesma decisão de arquitetura da Parte 1).
  function montarObjetoCompra() {
    return {
      numero: 'PRÉVIA — sem número',
      data: new Date().toISOString(),
      vendedor: {
        nome: texto('compra-vendedor-nome'),
        telefone: document.getElementById('compra-vendedor-sem-numero')?.checked ? '' : texto('compra-vendedor-telefone'),
        semNumero: document.getElementById('compra-vendedor-sem-numero')?.checked || false,
        cpf: texto('compra-vendedor-cpf'),
        rg: texto('compra-vendedor-rg'),
        endereco: texto('compra-vendedor-endereco')
      },
      aparelho: {
        tipo: texto('compra-aparelho-tipo') || 'Smartphone',
        marca: texto('compra-aparelho-marca'),
        modelo: texto('compra-aparelho-modelo'),
        cor: texto('compra-aparelho-cor'),
        capacidade: texto('compra-aparelho-capacidade'),
        imei1: texto('compra-aparelho-imei'),
        imei2: texto('compra-aparelho-imei2'),
        estadoConservacao: texto('compra-aparelho-estado'),
        acessoriosTexto: texto('compra-aparelho-acessorios'),
        senha: texto('compra-aparelho-senha'),
        // Mesmos nomes de campo usados pelo PC (renderer.js/compra-template.js),
        // para que o objeto exportado seja compatível 1:1 com o que
        // criarCompra() já grava sem transformação nenhuma.
        situacao: checkboxesMarcados('.compra-situacao'),
        contaVinculada: texto('compra-conta-vinculada') || 'Não',
        emailConta: texto('compra-conta-email'),
        emailSenha: texto('compra-conta-email-senha'),
        contaRemovida: texto('compra-conta-removida') === 'Sim'
      },
      avaliacao: {
        descricaoGeral: texto('compra-avaliacao-descricao'),
        defeitosEncontrados: texto('compra-avaliacao-defeitos'),
        observacoes: texto('compra-avaliacao-observacoes')
      },
      dadosCompra: {
        valor: texto('compra-valor'),
        formaPagamento: texto('compra-forma-pagamento'),
        chavePix: texto('compra-chave-pix'),
        observacoes: texto('compra-observacoes')
      },
      termosCompra: texto('compra-termos'),
      fotos: window.SistemaOSFotos ? window.SistemaOSFotos.obterFotos('compra') : [],
      assinaturaVendedorBase64: '',
      assinaturaPendente: assinarDepoisMarcado('compra') && !naoAssinadoMarcado('compra'),
      naoAssinado: naoAssinadoMarcado('compra'),
      assinaturaAssistenciaBase64: (window.ConfigApp.carregarConfig().assinaturaAssistenciaBase64 || '')
    };
  }

  // Monta o objeto `vd` a partir do form-venda, no formato "flat" exato que
  // gerarHtmlVenda(vd, config) espera (src/templates/venda-template.js):
  // { id, dataVenda, marca, modelo, cor, imei, tipoEquipamento,
  // observacoes, garantia, compradorNome, compradorCpf, compradorTelefone,
  // valorVenda, formaPagamento }. Mesmo placeholder de número que OS/Compra
  // usam — o celular também não numera comprovantes de venda (mesma decisão
  // de arquitetura da Parte 1). Note que aqui não há "avaliação" nem
  // "dadosCompra" aninhados — o contrato de Venda é flat, ao contrário do
  // de Compra.
  function montarObjetoVenda() {
    var dataInformada = texto('venda-data');
    return {
      id: (estoqueVendaAtual && estoqueVendaAtual.id) || 'PRÉVIA — sem número',
      estoqueLocalId: (estoqueVendaAtual && estoqueVendaAtual.id) || (osAtual && osAtual.estoqueLocalId) || '',
      dataVenda: dataInformada ? dataInformada + 'T12:00:00.000Z' : '',
      tipoEquipamento: texto('venda-tipo-equipamento') || 'Smartphone',
      marca: texto('venda-marca'),
      modelo: texto('venda-modelo'),
      cor: texto('venda-cor'),
      imei: texto('venda-imei'),
      observacoes: texto('venda-observacoes'),
      garantia: normalizarGarantiaVenda(texto('venda-garantia')),
      compradorNome: texto('venda-comprador-nome'),
      compradorTelefone: document.getElementById('venda-comprador-sem-numero')?.checked ? '' : texto('venda-comprador-telefone'),
      compradorSemNumero: document.getElementById('venda-comprador-sem-numero')?.checked || false,
      compradorCpf: texto('venda-comprador-cpf'),
      compradorEmail: texto('venda-comprador-email'),
      valorVenda: texto('venda-valor'),
      formaPagamento: texto('venda-forma-pagamento'),
      termosVenda: texto('venda-termos'),
      assinaturaCompradorBase64: '',
      assinaturaPendente: assinarDepoisMarcado('venda') && !naoAssinadoMarcado('venda'),
      naoAssinado: naoAssinadoMarcado('venda'),
      assinaturaAssistenciaBase64: (window.ConfigApp.carregarConfig().assinaturaAssistenciaBase64 || '')
    };
  }

  // Monta o objeto `en` a partir do form-entrega, no formato exato que
  // gerarHtmlEntrega(en, config) espera (src/templates/entrega-template.js):
  // { numeroOS, nomeRetirou, declaracao, dataHoraAssinatura,
  // assinaturaRetirouBase64 }. Diferente dos outros 3: numeroOS é texto
  // livre digitado pelo técnico (NÃO um placeholder de "sem número" — o
  // celular não numera OS/Compra/Venda porque quem numera é o PC na hora
  // de criar o registro, mas aqui o número da OS já existe de antemão no
  // PC e é só referenciado, texto livre e sem checagem, ver
  // PROMPT-CELULAR-aba-entregas.md, decisão de arquitetura 3).
  //
  // `declaracao` é congelada no momento da geração (não uma referência a
  // uma config que pode mudar depois) — para manter histórico fiel caso o
  // texto padrão da declaração mude no futuro (ver item 5 do prompt).
  function montarObjetoEntrega() {
    var dataEscolhida = texto('entrega-data');
    var dataHoraAssinatura = entregaOriginal && dataEscolhida === String(entregaOriginal.dataHoraAssinatura || '').slice(0, 10)
      ? entregaOriginal.dataHoraAssinatura : dataEscolhida ? new Date(dataEscolhida + 'T12:00:00').toISOString() : new Date().toISOString();
    var garantiaInicio = texto('entrega-garantia-inicio') || dataHoraAssinatura.slice(0, 10);
    var garantiaDias = garantiaDiasResolvida('entrega-garantia-dias');
    var valorReparoTexto = texto('entrega-valor-reparo').trim();
    return {
      numeroOS: texto('entrega-numero-os'),
      nomeRetirou: texto('entrega-nome-retirou'),
      cpfRetirou: texto('entrega-cpf-retirou'),
      telefoneRetirou: texto('entrega-telefone-retirou'),
      marca: texto('entrega-marca'),
      modelo: texto('entrega-modelo'),
      reparoRealizado: texto('entrega-reparo-realizado'),
      // Mantem vazio como null para exigir uma escolha consciente. O valor
      // zero continua permitido quando for digitado pelo usuario.
      valorReparo: valorReparoTexto === ''
        ? null
        : Number(valorReparoTexto.replace(',', '.')),
      formaPagamento: texto('entrega-forma-pagamento'),
      declaracao: window.__modules['termos-predefinidos'].exports.DECLARACAO_ENTREGA,
      dataHoraAssinatura: dataHoraAssinatura,
      garantiaDataInicio: garantiaInicio,
      termosGarantia: texto('entrega-termos-garantia'),
      clienteId: entregaOriginal && entregaOriginal.clienteId || '',
      // Identifica a versão documental. `original` mantém compatibilidade
      // com entregas antigas; retornos usam o id imutável do retorno para
      // que o primeiro comprovante nunca seja sobrescrito.
      cicloEntregaId: entregaOriginal && (entregaOriginal.cicloEntregaId || entregaOriginal.retornoGarantiaId) || 'original',
      retornoGarantiaId: entregaOriginal && entregaOriginal.retornoGarantiaId || '',
      garantiaId: entregaOriginal && entregaOriginal.garantiaId || '',
      documentoEntregaId: entregaOriginal && entregaOriginal.documentoEntregaId || '',
      idEnvioAssinatura: entregaOriginal && entregaOriginal.idEnvioAssinatura || '',
      tipoEntrega: entregaOriginal && entregaOriginal.tipoEntrega ||
        (entregaOriginal && entregaOriginal.retornoGarantiaId ? 'retorno_garantia' : 'original'),
      // Prazo de garantia (dias) + data limite já calculada a partir da
      // data/hora desta assinatura (congelada aqui, no momento da geração
      // — mesmo princípio de `declaracao` acima: se o padrão de
      // Configurações mudar depois, este comprovante já gerado não muda
      // retroativamente). Ambos aparecem no PDF (entrega-template.js).
      garantiaDias: garantiaDias,
      dataLimiteGarantia: garantiaDias > 0 ? calcularDataLimiteGarantia(garantiaInicio + 'T12:00:00', garantiaDias) : '',
      fotos: window.SistemaOSFotos ? window.SistemaOSFotos.obterFotos('entrega') : [],
      assinaturaRetirouBase64: '',
      assinaturaPendente: assinarDepoisMarcado('entrega') && !naoAssinadoMarcado('entrega'),
      naoAssinado: naoAssinadoMarcado('entrega')
    };
  }

  // Soma `dias` a partir da data/hora ISO informada e devolve só a data
  // (sem hora) em formato ISO (YYYY-MM-DD), pronta para o template
  // formatar com formatarData/toLocaleDateString. dias <= 0 ainda calcula
  // normalmente (data limite = mesma data, ou até uma data anterior se
  // alguém digitar um valor estranho — não é validado aqui como erro,
  // só uma soma direta).
  function calcularDataLimiteGarantia(dataHoraIso, dias) {
    try {
      var base = new Date(dataHoraIso);
      base.setDate(base.getDate() + (Number(dias) || 0));
      return base.toISOString();
    } catch (erro) {
      return '';
    }
  }

  // Config da empresa: antes era uma constante fixa (CONFIG_FIXO) só de
  // exemplo. Agora é montada em cada uso a partir do que está salvo em
  // js/config.js (tela de Configurações) — assim, se o usuário editar o
  // nome, logo, CNPJ etc. e voltar pra Nova OS, a próxima prévia já sai
  // com os dados atualizados, sem precisar recarregar a página.
  function obterConfigEmpresaAtual() {
    return window.ConfigApp.montarDadosEmpresa();
  }

  // Generalizadas para aceitar qualquer formulário (`formularioAlvo`) e seu
  // elemento de erro geral correspondente — usadas tanto pelo form-os
  // quanto pelo form-compra (cada um com seu próprio erro-geral no HTML).
  function limparErrosDeCampo(formularioAlvo, erroGeralAlvo) {
    var elementos = formularioAlvo.querySelectorAll('.erro-campo');
    for (var i = 0; i < elementos.length; i++) {
      elementos[i].textContent = '';
      elementos[i].hidden = true;
    }
    erroGeralAlvo.hidden = true;
    erroGeralAlvo.textContent = '';
  }

  function exibirErrosDeCampo(formularioAlvo, erros) {
    var primeiroCampoComErro = null;
    Object.keys(erros).forEach(function (chave) {
      var el = formularioAlvo.querySelector('[data-erro-de="' + chave + '"]');
      if (el) {
        el.textContent = erros[chave];
        el.hidden = false;
        if (!primeiroCampoComErro) primeiroCampoComErro = el;
      }
    });
    if (primeiroCampoComErro && typeof primeiroCampoComErro.scrollIntoView === 'function') {
      primeiroCampoComErro.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    limparErrosDeCampo(form, erroGeral);

    var os = montarObjetoOS();
    var erros = window.SistemaOSValidacao.validarDadosOS(os);
    if (erros) {
      exibirErrosDeCampo(form, erros);
      return;
    }

    btnGerar.disabled = true;
    btnGerar.textContent = 'Gerando…';

    carregamentoModulos
      .then(function () {
        if (!gerarHtmlOS) return; // erro de carregamento já mostrado
        if (emEdicaoHistorico && osAtual) {
          os.assinaturaClienteBase64 = osAtual.assinaturaClienteBase64 || '';
          os.assinaturaAssistenciaOverrideBase64 = osAtual.assinaturaAssistenciaOverrideBase64 || '';
          os.assinaturaAssistenciaBase64 = osAtual.assinaturaAssistenciaBase64 || os.assinaturaAssistenciaBase64;
        }
        var html = aplicarAssinaturasNaOS(gerarHtmlOS(os, obterConfigEmpresaAtual()), os);
        return definirConteudoDoFrame(html).then(function () {
          osAtual = os;
          documentoAtualTipo = 'os';
          registroHistoricoAtualId = emEdicaoHistorico ? idEmEdicaoHistorico : null;
          resetarEstadoDeAssinatura();
          configurarPainelPreview(false); // modo "nova OS", não histórico
          mostrarTela('preview');
        });
      })
      .catch(function (err) {
        erroGeral.hidden = false;
        erroGeral.textContent =
          'Não foi possível gerar a prévia: ' + (err && err.message ? err.message : String(err));
      })
      .then(function () {
        btnGerar.disabled = false;
        btnGerar.textContent = 'Gerar prévia';
      });
  });

  // ── Compra: gerar prévia (mesmo padrão do form-os, formulário e
  // elemento de erro geral próprios) ───────────────────────────────
  var btnGerarPreviaCompra = document.getElementById('btn-gerar-previa-compra');
  var erroGeralCompra = document.getElementById('erro-geral-compra');

  formCompra.addEventListener('submit', function (ev) {
    ev.preventDefault();
    limparErrosDeCampo(formCompra, erroGeralCompra);

    var cp = montarObjetoCompra();
    var erros = window.SistemaOSValidacao.validarDadosCompra(cp);
    if (erros) {
      exibirErrosDeCampo(formCompra, erros);
      return;
    }

    btnGerarPreviaCompra.disabled = true;
    btnGerarPreviaCompra.textContent = 'Gerando…';

    carregamentoModulos
      .then(function () {
        if (!gerarHtmlCompra) return; // erro de carregamento já mostrado
        if (emEdicaoHistorico && osAtual) {
          cp.assinaturaVendedorBase64 = osAtual.assinaturaVendedorBase64 || '';
          cp.assinaturaAssistenciaOverrideBase64 = osAtual.assinaturaAssistenciaOverrideBase64 || '';
          cp.assinaturaAssistenciaBase64 = osAtual.assinaturaAssistenciaBase64 || cp.assinaturaAssistenciaBase64;
        }
        var html = aplicarAssinaturasNaCompra(gerarHtmlCompra(cp, obterConfigEmpresaAtual()), cp);
        return definirConteudoDoFrame(html).then(function () {
          osAtual = cp;
          documentoAtualTipo = 'compra';
          registroHistoricoAtualId = emEdicaoHistorico ? idEmEdicaoHistorico : null;
          resetarEstadoDeAssinatura();
          configurarPainelPreview(false); // modo "nova compra", não histórico
          mostrarTela('preview');
        });
      })
      .catch(function (err) {
        erroGeralCompra.hidden = false;
        erroGeralCompra.textContent =
          'Não foi possível gerar a prévia: ' + (err && err.message ? err.message : String(err));
      })
      .then(function () {
        btnGerarPreviaCompra.disabled = false;
        btnGerarPreviaCompra.textContent = 'Gerar prévia';
      });
  });

  // ── Venda: gerar prévia (mesmo padrão de form-os/form-compra,
  // formulário e elemento de erro geral próprios) ───────────────────
  var btnGerarPreviaVenda = document.getElementById('btn-gerar-previa-venda');
  var erroGeralVenda = document.getElementById('erro-geral-venda');

  formVenda.addEventListener('submit', function (ev) {
    ev.preventDefault();
    limparErrosDeCampo(formVenda, erroGeralVenda);

    var vd = montarObjetoVenda();
    var erros = window.SistemaOSValidacao.validarDadosVenda(vd);
    if (erros) {
      exibirErrosDeCampo(formVenda, erros);
      return;
    }

    btnGerarPreviaVenda.disabled = true;
    btnGerarPreviaVenda.textContent = 'Gerando…';

    carregamentoModulos
      .then(function () {
        if (!gerarHtmlVenda) return; // erro de carregamento já mostrado
        if (emEdicaoHistorico && osAtual) {
          vd.assinaturaCompradorBase64 = osAtual.assinaturaCompradorBase64 || '';
          vd.assinaturaAssistenciaOverrideBase64 = osAtual.assinaturaAssistenciaOverrideBase64 || '';
          vd.assinaturaAssistenciaBase64 = osAtual.assinaturaAssistenciaBase64 || vd.assinaturaAssistenciaBase64;
        }
        var html = aplicarAssinaturasNaVenda(gerarHtmlVenda(vd, obterConfigEmpresaAtual()), vd);
        return definirConteudoDoFrame(html).then(function () {
          osAtual = vd;
          documentoAtualTipo = 'venda';
          registroHistoricoAtualId = emEdicaoHistorico ? idEmEdicaoHistorico : null;
          resetarEstadoDeAssinatura();
          configurarPainelPreview(false); // modo "nova venda", não histórico
          mostrarTela('preview');
        });
      })
      .catch(function (err) {
        erroGeralVenda.hidden = false;
        erroGeralVenda.textContent =
          'Não foi possível gerar a prévia: ' + (err && err.message ? err.message : String(err));
      })
      .then(function () {
        btnGerarPreviaVenda.disabled = false;
        btnGerarPreviaVenda.textContent = 'Gerar prévia';
      });
  });

  // ── Entrega: gerar prévia (mesmo padrão de form-os/form-compra/
  // form-venda, formulário e elemento de erro geral próprios) ────────
  var btnGerarPreviaEntrega = document.getElementById('btn-gerar-previa-entrega');
  var erroGeralEntrega = document.getElementById('erro-geral-entrega');

  formEntrega.addEventListener('submit', function (ev) {
    ev.preventDefault();
    limparErrosDeCampo(formEntrega, erroGeralEntrega);

    var en = montarObjetoEntrega();
    var erros = window.SistemaOSValidacao.validarDadosEntrega(en);
    if (erros) {
      exibirErrosDeCampo(formEntrega, erros);
      return;
    }

    btnGerarPreviaEntrega.disabled = true;
    btnGerarPreviaEntrega.textContent = 'Gerando…';

    carregamentoModulos
      .then(function () {
        if (!gerarHtmlEntrega) return; // erro de carregamento já mostrado
        // A prévia editada exige uma nova assinatura; não reutilizar a
        // assinatura de outro texto. "Não assinado" e "Assinar depois" valem aqui.
        var html = aplicarAssinaturasNaEntrega(gerarHtmlEntrega(en, obterConfigEmpresaAtual()), en);
        return definirConteudoDoFrame(html).then(function () {
          osAtual = en;
          documentoAtualTipo = 'entrega';
          registroHistoricoAtualId = emEdicaoHistorico ? idEmEdicaoHistorico : null;
          resetarEstadoDeAssinatura();
          configurarPainelPreview(false); // modo "nova entrega", não histórico
          mostrarTela('preview');
        });
      })
      .catch(function (err) {
        erroGeralEntrega.hidden = false;
        erroGeralEntrega.textContent =
          'Não foi possível gerar a prévia: ' + (err && err.message ? err.message : String(err));
      })
      .then(function () {
        btnGerarPreviaEntrega.disabled = false;
        btnGerarPreviaEntrega.textContent = 'Gerar prévia';
      });
  });

  btnEditar.addEventListener('click', function () {
    if (documentoAtualTipo === 'compra') { mostrarTela('compra'); return; }
    if (documentoAtualTipo === 'venda') { mostrarTela('venda'); return; }
    if (documentoAtualTipo === 'entrega') { mostrarTela('entrega'); return; }
    mostrarTela('form');
  });

  // ── Parte 4 — Navegação entre telas ──────────────────────────
  // Único ponto que decide qual seção de <main> fica visível e qual
  // botão do nav-topo fica destacado. `tela-assinatura` é uma camada à
  // parte (tela cheia por cima de tudo) e não entra aqui.

  // Esconde todos os painéis/formulários e mostra só o correspondente a
  // `nome` (uma das chaves de TELAS). Generalizado para as 5 abas: antes
  // só existiam 3 estados possíveis (form/preview/historico) porque só
  // havia um formulário; agora há 3 formulários (OS/Compra/Venda) + preview
  // + histórico + configurações, todos alternados pelo mesmo mecanismo.
  //
  // `nome === 'preview'` continua podendo ser alcançado tanto a partir de
  // "Nova OS"/"Compra"/"Venda" (fluxo normal, emModoHistorico = false)
  // quanto a partir de "Abrir" no histórico (emModoHistorico = true) — por
  // isso o destaque do botão de nav para esse caso é tratado à parte,
  // olhando emModoHistorico, e não faz parte do mapa TELAS.
  function mostrarTela(nome) {
    Object.keys(TELAS).forEach(function (chave) {
      var tela = TELAS[chave];
      if (tela.elemento) tela.elemento.hidden = chave !== nome;
    });

    var abaHistoricoAtiva = nome === 'historico' || (nome === 'preview' && emModoHistorico);
    btnIrHistorico.classList.toggle('btn-nav-ativo', abaHistoricoAtiva);

    // Os demais botões de nav só ficam ativos quando a tela deles mesmos
    // está em foco (nunca durante "preview", já que a prévia não tem um
    // botão de nav próprio — ela é alcançada a partir de outra aba).
    [
      { botao: btnIrNovo, chave: 'form' },
      { botao: btnIrCompra, chave: 'compra' },
      { botao: btnIrVenda, chave: 'venda' },
      { botao: btnIrEntrega, chave: 'entrega' },
      { botao: btnIrDesbloqueios, chave: 'desbloqueios' },
      { botao: btnIrConfig, chave: 'config' },
      { botao: btnIrDocumentos, chave: 'documentos' },
      { botao: btnIrConsulta, chave: 'consulta' },
      { botao: btnIrCobrancas, chave: 'cobrancas' },
      { botao: btnIrQr, chave: 'qr' },
      { botao: btnIrEstatisticas, chave: 'estatisticas' },
      { botao: btnIrPrazos, chave: 'prazos' }
      ,{ botao: btnIrEstoque, chave: 'estoque' }
      ,{ botao: btnIrPrecos, chave: 'precos' }
    ].forEach(function (par) {
      if (par.botao) par.botao.classList.toggle('btn-nav-ativo', nome === par.chave && !abaHistoricoAtiva);
    });

    if (nome === 'historico') carregarTelaHistorico();
    // config-tela.js escuta este evento pra recarregar o formulário com o
    // que está salvo agora (garante que, se o usuário salvou numa visita
    // anterior e voltou sem recarregar a página, o form reflita o valor
    // realmente persistido). app.js não conhece os campos internos da
    // tela de Configurações — só avisa que ela foi aberta.
    if (nome === 'config') document.dispatchEvent(new CustomEvent('sistema-os:tela-config-aberta'));
    // Mesmo princípio, para js/documentos-recebidos.js recarregar a lista
    // de documentos pendentes toda vez que a aba é reaberta.
    if (nome === 'documentos') document.dispatchEvent(new CustomEvent('sistema-os:tela-documentos-aberta'));
    if (nome === 'desbloqueios') document.dispatchEvent(new CustomEvent('sistema-os:tela-desbloqueios-aberta'));
    // A tela de consulta usa estes eventos para atualizar o estado da sessão.
    if (nome === 'consulta') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-consulta-aberta'));
    } else if (telaAnterior === 'consulta') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-consulta-fechada'));
    }
    if (nome === 'cobrancas') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-cobrancas-aberta'));
    } else if (telaAnterior === 'cobrancas') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-cobrancas-fechada'));
    }
    if (nome !== 'qr' && window.SistemaOSQRCode && window.SistemaOSQRCode.leituraAtiva()) {
      window.SistemaOSQRCode.cancelarLeitura().catch(function () {});
    }
    // Mesmo princípio, para js/estatisticas-tela.js (re)iniciar a
    // escuta do resumo do PC ao abrir, e parar ao sair da aba.
    if (nome === 'estatisticas') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-estatisticas-aberta'));
    } else if (telaAnterior === 'estatisticas') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-estatisticas-fechada'));
    }
    if (nome === 'prazos') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-prazos-aberta'));
    } else if (telaAnterior === 'prazos') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-prazos-fechada'));
    }
    if (nome === 'estoque') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-estoque-aberta'));
    } else if (telaAnterior === 'estoque') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-estoque-fechada'));
    }
    if (nome === 'precos') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-precos-aberta'));
    } else if (telaAnterior === 'precos') {
      document.dispatchEvent(new CustomEvent('sistema-os:tela-precos-fechada'));
    }
    telaAnterior = nome;
  }

  function dataHojeInput() {
    var agora = new Date();
    var local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  // Reaproveita o formulário e o gerador de PDF de Venda já consolidados.
  // A tela de estoque só informa qual aparelho será vendido e este método
  // preenche os dados conhecidos; os campos faltantes continuam obrigatórios.
  function iniciarVendaDoEstoque(item) {
    if (!item || !item.id) return;
    estoqueVendaAtual = JSON.parse(JSON.stringify(item));
    formVenda.reset();
    preencherTermosPadraoDocumento('venda', true);
    setarValor('venda-tipo-equipamento', item.tipoEquipamento || 'Smartphone');
    setarValor('venda-marca', item.marca);
    setarValor('venda-modelo', item.modelo);
    setarValor('venda-cor', item.cor);
    setarValor('venda-imei', item.imei);
    setarValor('venda-observacoes', item.observacoes);
    var garantiaVenda = item.garantia;
    setarValor('venda-garantia',
      garantiaVenda !== undefined && garantiaVenda !== null && String(garantiaVenda).trim() !== ''
        ? normalizarGarantiaVenda(garantiaVenda)
        : '90 dias'
    );
    setarValor('venda-comprador-nome', item.compradorNome);
    setarValor('venda-comprador-cpf', item.compradorCpf);
    setarValor('venda-comprador-email', item.compradorEmail);
    setarValor('venda-valor', Number(item.valorVenda || 0) > 0 ? item.valorVenda : '');
    setarValor('venda-forma-pagamento', item.formaPagamento || 'Dinheiro');
    setarValor('venda-data', String(item.dataVenda || '').slice(0, 10) || dataHojeInput());
    var semNumero = document.getElementById('venda-comprador-sem-numero');
    var telefone = document.getElementById('venda-comprador-telefone');
    if (semNumero && telefone) {
      semNumero.checked = item.compradorSemNumero === true;
      telefone.disabled = semNumero.checked;
      telefone.placeholder = semNumero.checked ? 'Não informado' : '(00) 00000-0000';
      telefone.value = semNumero.checked ? '' : (item.compradorTelefone || '');
    }
    emEdicaoHistorico = false;
    idEmEdicaoHistorico = null;
    registroHistoricoAtualId = null;
    mostrarTela('venda');
    setTimeout(function () {
      var pendente = !item.compradorNome
        ? document.getElementById('venda-comprador-nome')
        : (!Number(item.valorVenda || 0) ? document.getElementById('venda-valor') : document.getElementById('venda-comprador-telefone'));
      if (pendente && !pendente.disabled) pendente.focus();
    }, 80);
    if (window.SistemaOSToast) {
      window.SistemaOSToast.mostrar('Complete os dados da venda. Depois gere a prévia e colete a assinatura.');
    }
  }

  window.SistemaOSVendaEstoque = { iniciar: iniciarVendaDoEstoque };

  function iniciarEntregaDaOS(os, registro) {
    if (!os) return;
    var cliente = os.cliente || {};
    var aparelho = os.aparelho || {};
    var diagnostico = os.diagnosticoTecnico || {};
    formEntrega.reset();
    entregaOriginal = os.numeroOS ? os : null;
    entregaReferenciaRemota = os.numeroOS && os.id ? {
      id: os.id,
      revision: os.revision,
      cicloEntregaId: os.cicloEntregaId || os.retornoGarantiaId || 'original',
      retornoGarantiaId: os.retornoGarantiaId || ''
    } : null;
    emEdicaoHistorico = !!registro;
    idEmEdicaoHistorico = registro ? registro.id : null;
    registroHistoricoAtualId = registro ? registro.id : null;
    setarValor('entrega-data', String(os.dataHoraAssinatura || os.dataHoraEntrega || '').slice(0, 10) || dataHojeInput());
    setarValor('entrega-garantia-inicio', String(os.garantiaDataInicio || os.dataHoraAssinatura || '').slice(0, 10) || dataHojeInput());
    setarValor('entrega-garantia-dias', os.garantiaDias ?? '');
    var configGarantia = window.ConfigApp.carregarConfig();
    var termosGarantiaPadrao = configGarantia.usarTermosPredefinidosGarantia !== false
      ? (window.__modules['termos-predefinidos']?.exports.TERMOS_GARANTIA || '') : (configGarantia.termosCustomGarantia || '');
    setarValor('entrega-termos-garantia', os.termosGarantia ?? termosGarantiaPadrao);
    if (camposNaoAssinado.entrega) camposNaoAssinado.entrega.checked = os.naoAssinado === true;
    if (camposAssinarDepois.entrega) camposAssinarDepois.entrega.checked = os.assinaturaPendente === true || !!os.assinaturaRetirouBase64;
    setarValor('entrega-numero-os', String(os.numero || os.numeroOS || '').replace(/\D/g, ''));
    setarValor('entrega-nome-retirou', os.nomeRetirou ?? cliente.nome ?? os.clienteNome ?? '');
    setarValor('entrega-cpf-retirou', os.cpfRetirou ?? cliente.cpf ?? os.clienteCpf ?? '');
    setarValor('entrega-telefone-retirou', os.telefoneRetirou ?? cliente.telefone ?? os.clienteTelefone ?? '');
    setarValor('entrega-marca', aparelho.marca || os.marca || '');
    setarValor('entrega-modelo', aparelho.modelo || os.modelo || '');
    setarValor(
      'entrega-reparo-realizado',
      diagnostico.solucao || os.servicoRealizado || os.reparoRealizado || os.observacoesSaida || ''
    );
    setarValor(
      'entrega-valor-reparo',
      os.numeroOS && os.valorReparo != null ? Number(os.valorReparo) : Number(
        os.valorTotalServico || os.valorReparo || os.valorCobrado ||
        (os.entrega && os.entrega.valorReparo) ||
        diagnostico.valorEstimado || os.valorTotal || os.valor || 0
      ) || ''
    );
    setarValor(
      'entrega-forma-pagamento',
      os.formaPagamento || os.pagamentoForma ||
      (os.entrega && os.entrega.formaPagamento) ||
      (os.pagamento && os.pagamento.forma) ||
      (/mercado\s*pago/i.test(String(os.statusPagamento || '')) ? 'Mercado Pago' : '')
    );
    mostrarTela('entrega');
    setTimeout(function () {
      var valorCampo = document.getElementById('entrega-valor-reparo');
      var pagamentoCampo = document.getElementById('entrega-forma-pagamento');
      var primeiroCampo = !valorCampo.value ? valorCampo
        : (!pagamentoCampo.value ? pagamentoCampo : document.getElementById('entrega-nome-retirou'));
      if (primeiroCampo) primeiroCampo.focus();
      formEntrega.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    if (window.SistemaOSToast) {
      window.SistemaOSToast.mostrar('Informe o valor e a forma de pagamento, confira os dados e colete a assinatura de quem recebeu.');
    }
  }

  window.SistemaOSEntrega = { iniciarPorOS: iniciarEntregaDaOS, editar: async function (numeroOS) {
    var dados = await window.SistemaOSSupabaseEntrega.obterCompleta(numeroOS);
    if (!dados) throw new Error('Entrega não encontrada.');
    if (dados.assinado && !confirm('Ao editar, será necessário assinar o comprovante corrigido ou marcar Não assinado. Continuar?')) return;
    iniciarEntregaDaOS(dados);
  } };
  if (document.getElementById('venda-data') && !document.getElementById('venda-data').value) {
    document.getElementById('venda-data').value = dataHojeInput();
  }

  btnIrNovo.addEventListener('click', function () {
    emEdicaoHistorico = false;
    idEmEdicaoHistorico = null;
    preencherTermosPadraoDocumento('os', false);
    mostrarTela('form');
  });

  btnIrCompra.addEventListener('click', function () {
    preencherTermosPadraoDocumento('compra', false);
    mostrarTela('compra');
  });

  btnIrVenda.addEventListener('click', function () {
    estoqueVendaAtual = null;
    if (!document.getElementById('venda-data').value) document.getElementById('venda-data').value = dataHojeInput();
    preencherTermosPadraoDocumento('venda', false);
    mostrarTela('venda');
  });

  btnIrEntrega.addEventListener('click', function () {
    if (entregaOriginal) formEntrega.reset();
    entregaOriginal = null;
    entregaReferenciaRemota = null;
    emEdicaoHistorico = false;
    idEmEdicaoHistorico = null;
    registroHistoricoAtualId = null;
    if (!texto('entrega-data')) setarValor('entrega-data', dataHojeInput());
    if (!texto('entrega-garantia-inicio')) setarValor('entrega-garantia-inicio', dataHojeInput());
    if (!texto('entrega-termos-garantia')) {
      var cfg = window.ConfigApp.carregarConfig();
      setarValor('entrega-termos-garantia', cfg.usarTermosPredefinidosGarantia !== false
        ? (window.__modules['termos-predefinidos']?.exports.TERMOS_GARANTIA || '') : (cfg.termosCustomGarantia || ''));
    }
    mostrarTela('entrega');
  });

  if (btnIrDesbloqueios) {
    btnIrDesbloqueios.addEventListener('click', function () {
      mostrarTela('desbloqueios');
    });
  }

  btnIrConfig.addEventListener('click', function () {
    mostrarTela('config');
  });

  if (btnIrDocumentos) {
    btnIrDocumentos.addEventListener('click', function () {
      mostrarTela('documentos');
    });
  }

  if (btnIrConsulta) {
    btnIrConsulta.addEventListener('click', function () {
      mostrarTela('consulta');
    });
  }

  if (btnIrCobrancas) {
    btnIrCobrancas.addEventListener('click', function () {
      mostrarTela('cobrancas');
    });
  }

  if (btnIrQr) {
    btnIrQr.addEventListener('click', function () {
      mostrarTela('qr');
    });
  }

  if (btnIrEstatisticas) {
    btnIrEstatisticas.addEventListener('click', function () {
      mostrarTela('estatisticas');
    });
  }

  if (btnIrPrazos) {
    btnIrPrazos.addEventListener('click', function () {
      mostrarTela('prazos');
    });
  }

  if (btnIrEstoque) {
    btnIrEstoque.addEventListener('click', function () {
      mostrarTela('estoque');
    });
  }

  if (btnIrPrecos) {
    btnIrPrecos.addEventListener('click', function () {
      mostrarTela('precos');
    });
  }

  btnIrHistorico.addEventListener('click', function () {
    mostrarTela('historico');
  });

  btnVoltarHistorico.addEventListener('click', function () {
    mostrarTela('historico');
  });

  // Alterna a UI do painel de prévia entre "nova OS" (fluxo normal:
  // assinar, salvar, editar) e "reaberta do histórico" (só reler +
  // exportar de novo pro PC; não faz sentido assinar/editar/salvar algo
  // que já está salvo e já assinado).
  function configurarPainelPreview(modoHistorico) {
    emModoHistorico = modoHistorico;
    bannerModoHistorico.hidden = !modoHistorico;
    btnVoltarHistorico.hidden = !modoHistorico;
    btnEditar.hidden = modoHistorico;
    btnAssinar.hidden = modoHistorico;
    // BUGFIX: btnAssinarAssistencia ficava de fora desta função — o botão
    // "Assinar assistência (só este documento)" continuava visível e
    // clicável mesmo reabrindo um documento já salvo do histórico. Clicar
    // nele mutava osAtual.assinaturaAssistenciaOverrideBase64 em memória
    // (osAtual, em modo histórico, é a referência retornada por
    // obterPorId — ver abrirItemHistorico), sem nenhum "Salvar" visível
    // para persistir essa mudança (btnSalvarHistorico também já fica
    // escondido aqui). O documento aparentava ter sido re-assinado na
    // tela, mas a mudança se perdia ao sair — e, se o técnico clicasse
    // "Exportar para o PC" antes de sair (esse botão continua visível de
    // propósito em modo histórico, ver comentário abaixo), o .json
    // exportado incluiria essa assinatura "fantasma" que nunca chegou a
    // ser salva no histórico local do celular. Mesmo princípio do
    // comentário desta função: não faz sentido assinar algo que já está
    // salvo e já assinado.
    if (btnAssinarAssistencia) {
      // Escondido em modo histórico (motivo original, ver comentário
      // acima) E também sempre que o documento atual é do tipo 'entrega'
      // — este documento não tem uma segunda assinatura de assistência
      // técnica por design (ver aplicarAssinaturasNaEntrega). Sem esta
      // segunda condição, o botão continuaria aparecendo (e clicável) na
      // tela de prévia de uma Entrega recém-gerada, mesmo não havendo
      // rótulo nenhum no PDF para a assinatura resultante ser injetada.
      btnAssinarAssistencia.hidden = modoHistorico || documentoAtualTipo === 'entrega';
    }
    btnSalvarHistorico.hidden = modoHistorico;
    // Reflete o estado real: se este documento (osAtual) já tem um registro
    // salvo (registroHistoricoAtualId setado), o botão fica travado — evita
    // reaparecer clicável e permitir salvar a mesma coisa de novo. Só fica
    // habilitado quando é de fato uma prévia nova (registroHistoricoAtualId
    // null), que é quando faz sentido salvar pela primeira vez.
    btnSalvarHistorico.disabled = !!registroHistoricoAtualId && !emEdicaoHistorico;
    // Exportar pro PC agora existe para os 3 tipos (OS, Compra e Venda) —
    // o formato de lote v2 cobre todos. Fica visível também em modo
    // histórico: como registroHistoricoAtualId é setado ao reabrir um
    // item, reexportar dali marca corretamente aquele registro como
    // sincronizado (ver btnExportarPC.addEventListener).
    btnExportarPC.hidden = false;
    avisoAssinado.hidden = modoHistorico ? true : avisoAssinado.hidden;
    var assinaturaPodeFicarPendente = assinaturaEstaPendente(osAtual, documentoAtualTipo);
    btnAssinar.textContent = assinaturaPodeFicarPendente ? 'Assinar agora (opcional)' : 'Assinar';
    btnSalvarHistorico.textContent = assinaturaPodeFicarPendente
      ? 'Salvar e enviar sem assinatura'
      : (emEdicaoHistorico ? 'Salvar e reenviar atualização' : 'Salvar no histórico do celular');
    btnExportarPC.textContent = assinaturaPodeFicarPendente ? 'Enviar ao PC sem assinatura' : 'Exportar para o PC';
    esconderFeedback();
  }

  // ── Parte 3 — Assinatura ──────────────────────────────────────

  function resetarEstadoDeAssinatura() {
    avisoAssinado.hidden = true;
    if (avisoAssinadoAssistencia) avisoAssinadoAssistencia.hidden = true;
    esconderFeedback();
  }

  // Mesma assinatura de sempre (mensagem, ehErro) — só troca ONDE a
  // mensagem aparece: antes escrevia em .feedback-acao (fixo, "no final da
  // tela"); agora dispara um toast flutuante (js/toast.js), que some
  // sozinho. Nenhum dos ~15 pontos que chamam mostrarFeedback(...) neste
  // arquivo precisou mudar.
  function mostrarFeedback(mensagem, ehErro) {
    window.SistemaOSToast.mostrar(mensagem, { ehErro: !!ehErro });
  }

  // O toast se dispensa sozinho (timer + clique) — não há mais um
  // elemento fixo para "esconder" antes da próxima ação. Mantida como
  // no-op, e não removida, porque resetarEstadoDeAssinatura() e outros
  // pontos ainda chamam esconderFeedback() ao trocar de tela/documento;
  // remover a função exigiria caçar e remover cada chamada também, sem
  // ganho real (a função já não faz nada de errado ficando vazia).
  function esconderFeedback() {}

  // Lê a assinatura da assistência técnica a usar em UM documento
  // específico (`dados`).
  // Prioridade:
  //   1) assinatura feita NA HORA para este documento específico
  //      (dados.assinaturaAssistenciaOverrideBase64, via botão
  //      "Assinar assistência (só este documento)") — se existir, vence
  //      sempre, independente do toggle "Exigir assinatura da
  //      assistência", porque assinar na hora é um ato explícito do
  //      usuário para ESTE documento.
  //   2) a assinatura padrão salva em Configurações
  //      (cfg.assinaturaAssistenciaBase64), SEMPRE que existir — o
  //      toggle "Exigir assinatura da assistência" não decide mais SE a
  //      assinatura padrão é usada, só decide a NUMERAÇÃO (ver
  //      AssinaturaInjetor.injetarAssinaturas: numerar=true só quando as
  //      duas assinaturas — outra parte + assistência — estão presentes
  //      ao mesmo tempo). Antes desta correção, desmarcar o toggle fazia
  //      esta função devolver '' mesmo com uma assinatura padrão salva —
  //      ou seja, desligar "numerar 1/2-2/2" tinha o efeito colateral de
  //      também desligar a injeção automática por completo, obrigando a
  //      assinar manualmente (botão "Assinar assistência — só este
  //      documento") em TODO documento novo. O toggle deveria só afetar
  //      a numeração; a assinatura padrão salva deve continuar entrando
  //      sozinha sempre que existir.
  //   3) vazio (nem 1 nem 2 aplicável) — o AssinaturaInjetor simplesmente
  //      não injeta nada nesse campo, nem numera.
  //
  // BUGFIX: o parâmetro `dados` é opcional e cai para `osAtual` (o
  // documento em edição na tela agora) quando omitido — cobre os
  // pontos que já chamavam esta função sem argumento (gerar prévia,
  // assinar, aplicarAssinaturasNaOS/Compra/Venda em cima do documento
  // atual). MAS "Exportar pendentes" (tela de Histórico) itera vários
  // REGISTROS SALVOS de uma vez, cada um com seu próprio
  // assinaturaAssistenciaOverrideBase64 já gravado — nenhum deles é
  // necessariamente osAtual (que é só o último documento que esteve na
  // tela de prévia, podendo até estar vazio). Antes desta correção, a
  // função sempre lia osAtual e ignorava por completo o `dados` de cada
  // item do lote — todo o lote saía com a MESMA assinatura de
  // assistência (a de osAtual), em vez da assinatura correta de cada
  // documento individual. Passar `dados` explicitamente nos pontos que
  // montam o envio (montarDados{OS,Compra,Venda}ParaEnvio) corrige isso.
  function obterAssinaturaAssistenciaAtual(dados) {
    var alvo = dados || osAtual;
    if (alvo && alvo.assinaturaAssistenciaOverrideBase64) {
      return alvo.assinaturaAssistenciaOverrideBase64;
    }
    // O documento guarda uma fotografia da assinatura padrão usada no dia.
    // Assim uma alteração futura na Config não muda documentos antigos e a
    // assinatura também segue para o PC/Supabase junto com o registro.
    if (alvo && alvo.assinaturaAssistenciaBase64) {
      return alvo.assinaturaAssistenciaBase64;
    }
    var cfg = window.ConfigApp.carregarConfig();
    return cfg.assinaturaAssistenciaBase64 || '';
  }

  // Lê o valor atual do toggle "Numerar as assinaturas como 1/2 e 2/2"
  // (cfg.exigirAssinaturaAssistencia — nome do campo interno mantido por
  // compatibilidade com configs já salvas; só o rótulo na UI mudou) e
  // devolve o `numerar` a passar pro AssinaturaInjetor: `false` força
  // nunca numerar; `undefined` deixa o injetor decidir sozinho pela
  // presença das duas assinaturas (comportamento de sempre, usado quando
  // o toggle está marcado). Ver comentário de
  // AssinaturaInjetor.injetarAssinaturas para os dois modos.
  function obterNumerarAssinaturas() {
    var cfg = window.ConfigApp.carregarConfig();
    return cfg.exigirAssinaturaAssistencia === false ? false : undefined;
  }

  function obterEstadoVisualAssinatura(dados, campoAssinatura) {
    if (dados && dados[campoAssinatura]) return '';
    return dados && dados.assinaturaPendente === true
      ? 'AGUARDANDO ASSINATURA'
      : 'NÃO ASSINADO';
  }

  // Ponto único de injeção de assinaturas para documentos de OS: usa
  // AssinaturaInjetor.injetarAssinaturas (js/assinatura-injetor.js), que
  // centraliza a lógica antes dividida entre o PC (injetarAssinaturaClienteNoHtml,
  // só cliente) e o celular (injetarAssinaturaNoIframe, também só cliente).
  // Substitui as DUAS assinaturas (cliente + assistência técnica) de uma
  // vez, de forma idempotente — corrige o bug em que a assinatura da
  // assistência nunca era inserida em lugar nenhum.
  function aplicarAssinaturasNaOS(html, os) {
    return window.AssinaturaInjetor.injetarAssinaturas(html, 'os', {
      outraParte: os.assinaturaClienteBase64 || '',
      estadoOutraParte: obterEstadoVisualAssinatura(os, 'assinaturaClienteBase64'),
      // Passa `os` explicitamente (em vez de deixar
      // obterAssinaturaAssistenciaAtual cair para osAtual) — hoje os
      // dois sempre coincidem nos pontos que chamam esta função, mas
      // depender disso implicitamente foi exatamente o tipo de acoplamento
      // que causou o bug corrigido em montarDadosOSParaEnvio (ver
      // comentário de obterAssinaturaAssistenciaAtual). Passar o parâmetro
      // aqui também deixa a função correta por construção.
      assistencia: obterAssinaturaAssistenciaAtual(os),
      numerar: obterNumerarAssinaturas()
    });
  }

  // Mesma ideia de aplicarAssinaturasNaOS, para documentos de Compra —
  // 'outraParte' aqui é o vendedor (pessoa física vendendo o aparelho),
  // rótulo "ASSINATURA DO VENDEDOR (CLIENTE)" em compra-template.js.
  function aplicarAssinaturasNaCompra(html, cp) {
    return window.AssinaturaInjetor.injetarAssinaturas(html, 'compra', {
      outraParte: cp.assinaturaVendedorBase64 || '',
      estadoOutraParte: obterEstadoVisualAssinatura(cp, 'assinaturaVendedorBase64'),
      assistencia: obterAssinaturaAssistenciaAtual(cp),
      numerar: obterNumerarAssinaturas()
    });
  }

  // Mesma ideia de aplicarAssinaturasNaOS, para documentos de Venda — aqui
  // os papéis são invertidos frente a OS/Compra: 'outraParte' é o
  // COMPRADOR (rótulo "ASSINATURA DO COMPRADOR" em venda-template.js), e
  // o rótulo "ASSINATURA DA ASSISTÊNCIA TÉCNICA" — sincronizado com o PC
  // nesta sessão, mesmo texto usado no documento de Compra — é, na
  // verdade, a própria assistência técnica vendendo o aparelho (ver
  // MAPA_ROTULOS.venda em assinatura-injetor.js, que também aceita os
  // rótulos antigos como alias para documentos salvos no histórico antes
  // desta mudança).
  function aplicarAssinaturasNaVenda(html, vd) {
    return window.AssinaturaInjetor.injetarAssinaturas(html, 'venda', {
      outraParte: vd.assinaturaCompradorBase64 || '',
      estadoOutraParte: obterEstadoVisualAssinatura(vd, 'assinaturaCompradorBase64'),
      assistencia: obterAssinaturaAssistenciaAtual(vd),
      numerar: obterNumerarAssinaturas()
    });
  }

  // Mesma ideia de aplicarAssinaturasNaOS, para o Comprovante de Entrega —
  // aqui 'outraParte' é quem retirou o aparelho (rótulo "ASSINATURA DE QUEM
  // RETIROU" em entrega-template.js). Diferente dos outros 3, NÃO passa
  // `assistencia`: este documento não tem uma segunda assinatura de
  // assistência técnica (ver PROMPT-CELULAR-aba-entregas.md — é um
  // documento novo e simples, só com a declaração de quem retirou). Como
  // MAPA_ROTULOS.entrega.rotulosAssistencia é um array vazio (ver
  // assinatura-injetor.js), o ramo de "sem assistência" do injetor (que
  // limpa numeração órfã) simplesmente não encontra nenhum rótulo para
  // casar — nunca numera "1/2" neste documento, mesmo que o toggle de
  // "Numerar as assinaturas" esteja ligado em Configurações.
  function aplicarAssinaturasNaEntrega(html, en) {
    return window.AssinaturaInjetor.injetarAssinaturas(html, 'entrega', {
      outraParte: en.assinaturaRetirouBase64 || '',
      estadoOutraParte: obterEstadoVisualAssinatura(en, 'assinaturaRetirouBase64')
    });
  }

  btnAssinar.addEventListener('click', function () {
    window.SistemaOSAssinatura.abrir(function (dataUrl) {
      carregamentoModulos.then(function () {
        var html;
        if (documentoAtualTipo === 'compra') {
          if (!gerarHtmlCompra) return; // erro de carregamento já mostrado
          osAtual.assinaturaVendedorBase64 = dataUrl;
          osAtual.assinaturaPendente = false;
          osAtual.naoAssinado = false;
          html = aplicarAssinaturasNaCompra(gerarHtmlCompra(osAtual, obterConfigEmpresaAtual()), osAtual);
        } else if (documentoAtualTipo === 'venda') {
          if (!gerarHtmlVenda) return; // erro de carregamento já mostrado
          osAtual.assinaturaCompradorBase64 = dataUrl;
          osAtual.assinaturaPendente = false;
          osAtual.naoAssinado = false;
          html = aplicarAssinaturasNaVenda(gerarHtmlVenda(osAtual, obterConfigEmpresaAtual()), osAtual);
        } else if (documentoAtualTipo === 'entrega') {
          if (!gerarHtmlEntrega) return; // erro de carregamento já mostrado
          osAtual.assinaturaRetirouBase64 = dataUrl;
          osAtual.assinaturaPendente = false;
          osAtual.naoAssinado = false;
          html = aplicarAssinaturasNaEntrega(gerarHtmlEntrega(osAtual, obterConfigEmpresaAtual()), osAtual);
        } else {
          if (!gerarHtmlOS) return; // erro de carregamento já mostrado
          osAtual.assinaturaClienteBase64 = dataUrl;
          osAtual.assinaturaPendente = false;
          osAtual.naoAssinado = false;
          html = aplicarAssinaturasNaOS(gerarHtmlOS(osAtual, obterConfigEmpresaAtual()), osAtual);
        }
        if (registroHistoricoAtualId) {
          emEdicaoHistorico = true;
          idEmEdicaoHistorico = registroHistoricoAtualId;
          btnSalvarHistorico.disabled = false;
          btnSalvarHistorico.textContent = 'Salvar e reenviar atualização';
          btnExportarPC.textContent = 'Exportar atualização para o PC';
        }
        definirConteudoDoFrame(html).then(function () {
          avisoAssinado.hidden = false;
          esconderFeedback();
        });
      });
    });
  });

  // Assina a assistência técnica AGORA, só para este documento — não
  // toca na assinatura padrão salva em Configurações. Usado quando o
  // técnico quer/precisa assinar na hora (ex: assinatura padrão ainda não
  // configurada, ou uma pessoa diferente está assinando por este
  // documento específico). O valor fica em
  // osAtual.assinaturaAssistenciaOverrideBase64 e tem prioridade sobre a
  // padrão em obterAssinaturaAssistenciaAtual() — inclusive vai junto no
  // .json exportado (ver montarDados*ParaEnvio), então o PC recebe
  // exatamente essa assinatura, não a padrão configurada no celular.
  if (btnAssinarAssistencia) {
    btnAssinarAssistencia.addEventListener('click', function () {
      if (!osAtual) return;
      // Reforço de segurança: este botão já fica `hidden` para documentos
      // do tipo 'entrega' (ver configurarPainelPreview), mas um clique não
      // deveria ser possível em elemento oculto por engano de qualquer
      // jeito — sem este guard, se algo re-exibisse o botão por engano no
      // futuro, entrega-template.js não tem rótulo de assistência nenhum
      // para a assinatura ser injetada, então o clique não faria nada
      // visível e confundiria o técnico.
      if (documentoAtualTipo === 'entrega') return;
      window.SistemaOSAssinatura.abrir(function (dataUrl) {
        carregamentoModulos.then(function () {
          var html;
          osAtual.assinaturaAssistenciaOverrideBase64 = dataUrl;
          if (documentoAtualTipo === 'compra') {
            if (!gerarHtmlCompra) return;
            html = aplicarAssinaturasNaCompra(gerarHtmlCompra(osAtual, obterConfigEmpresaAtual()), osAtual);
          } else if (documentoAtualTipo === 'venda') {
            if (!gerarHtmlVenda) return;
            html = aplicarAssinaturasNaVenda(gerarHtmlVenda(osAtual, obterConfigEmpresaAtual()), osAtual);
          } else {
            if (!gerarHtmlOS) return;
            html = aplicarAssinaturasNaOS(gerarHtmlOS(osAtual, obterConfigEmpresaAtual()), osAtual);
          }
          definirConteudoDoFrame(html).then(function () {
            if (avisoAssinadoAssistencia) avisoAssinadoAssistencia.hidden = false;
            esconderFeedback();
          });
        });
      });
    });
  }

  // Verdadeiro quando o documento atual já foi assinado pela outra parte
  // (cliente, na OS; vendedor, na Compra; comprador, na Venda) — cada um
  // usa seu próprio campo de assinatura porque representam papéis
  // diferentes em cada documento.
  function documentoAtualEstaAssinado() {
    if (!osAtual) return false;
    if (documentoAtualTipo === 'compra') return !!osAtual.assinaturaVendedorBase64;
    if (documentoAtualTipo === 'venda') return !!osAtual.assinaturaCompradorBase64;
    if (documentoAtualTipo === 'entrega') return !!osAtual.assinaturaRetirouBase64;
    return !!osAtual.assinaturaClienteBase64;
  }

  // ── Salvar no histórico do celular ───────────────────────────
  // Guarda uma cópia completa de osAtual (com a assinatura já embutida)
  // no IndexedDB local (js/historico.js) — não é enviado a lugar nenhum,
  // é só pra permitir reabrir/reler depois (ver "Voltar ao histórico").

  var MENSAGEM_ASSINE_ANTES_DE_SALVAR = {
    compra: 'Assine a Compra antes de salvar no histórico.',
    venda: 'Assine a Venda antes de salvar no histórico.',
    entrega: 'Assine o comprovante de Entrega antes de salvar no histórico.',
    os: 'Assine a OS antes de salvar no histórico.'
  };

  // Ponto único que decide COMO persistir o documento atual no histórico
  // local, de acordo com o tipo — usado tanto pelo clique manual em
  // "Salvar no histórico" quanto pelo salvamento automático de
  // "Exportar para o PC" (ver btnExportarPC.addEventListener), para as
  // duas rotas aplicarem exatamente a mesma regra.
  //
  // Só o tipo 'entrega' tem uma regra diferente aqui: "uma versão por
  // ciclo". Reemitir para a mesma OS+ciclo substitui aquela versão,
  // enquanto um retorno em garantia cria outro ciclo e preserva a original,
  // em vez de empilhar mais um registro igual acontece com OS/Compra/Venda
  // (cada submissão delas é sempre um documento novo e independente,
  // mesmo que repita os mesmos dados). window.SistemaOSHistorico.salvarEntrega
  // (js/historico.js) já encapsula essa checagem de duplicidade+substituição.
  function salvarDocumentoAtualNoHistorico() {
    if (documentoAtualTipo === 'entrega') {
      return window.SistemaOSHistorico.salvarEntrega(osAtual);
    }
    return window.SistemaOSHistorico.salvar(osAtual, documentoAtualTipo);
  }

  // Sincronização automática das OS pelo Supabase. Os demais tipos seguem
  // disponíveis no histórico e no fluxo de exportação manual.
  function tentarSincronizarAutomaticamente(registroId, tipoDocumento, dados) {
    if (!registroId || ['os', 'compra', 'venda', 'entrega'].indexOf(tipoDocumento) === -1) return;
    if (!window.CloudData || !window.CloudData.providerEscritas ||
        window.CloudData.providerEscritas() !== 'supabase' ||
        !window.CloudData.sincronizarRegistro) return;
    // Bloco 4: busca o registro no histórico para usar
    // montarItemReenvio (preserva idExportacaoOriginal) quando disponível.
    window.SistemaOSHistorico.obterPorId(registroId)
      .then(function (registro) {
        return window.CloudData.sincronizarRegistro(registro).then(function (resultadoOS) {
          if (!resultadoOS || !resultadoOS.enviado || !window.CloudData.processarFila) return resultadoOS;
          // A confirmação da OS cria operações separadas para assinatura,
          // fotos e PDF. Processa essas operações já neste salvamento, em
          // vez de esperar o timer, para o PC receber a assinatura posterior
          // imediatamente.
          return window.CloudData.processarFila().then(function (resultadoFila) {
            if (resultadoFila && Number(resultadoFila.falhas || 0) > 0) {
              return { enviado: false, motivo: 'arquivos-pendentes' };
            }
            return resultadoOS;
          });
        });
      })
      .then(function (resultado) {
        if (resultado && resultado.enviado) {
          // Se a gravação local falhar mesmo o servidor tendo recebido
          // o documento (ex.: IndexedDB ocupado nesse instante), grava
          // o carimbo de falha em vez de deixar silencioso — sem isso,
          // o registro ficaria pendente pra sempre sem o badge indicar
          // que já tentou (mesmo bug corrigido em sync-retry.js).
          return window.SistemaOSHistorico.marcarComoSincronizado([registroId])
            .catch(function () {
              if (window.SistemaOSHistorico.marcarTentativaSincronizacaoFalhou) {
                return window.SistemaOSHistorico.marcarTentativaSincronizacaoFalhou([registroId]);
              }
            });
        }
        // sem-config / upload-incompleto / erro: silenciosamente deixa
        // pendente — o técnico ainda pode exportar manualmente depois,
        // e uma próxima tentativa automática (retry em segundo plano,
        // próximo salvamento de outro documento, ou "Exportar
        // pendentes") pode ter sucesso. 'sem-config' não conta como
        // tentativa real (nada foi tentado de fato), então só grava o
        // carimbo de falha nos outros motivos.
        if (resultado && resultado.motivo !== 'sem-sessao' && window.SistemaOSHistorico.marcarTentativaSincronizacaoFalhou) {
          return window.SistemaOSHistorico.marcarTentativaSincronizacaoFalhou([registroId]);
        }
      })
      .catch(function () { /* nunca deixa a sincronização automática quebrar a tela */ });
  }

  // Retry automático em segundo plano para pendentes (nunca tentado, ou
  // tentou e falhou) — complementa tentarSincronizarAutomaticamente
  // (que só cobre o documento recém-salvo). Uma tentativa ao carregar o
  // app + uma a cada 5 minutos enquanto o app estiver aberto. Passa
  // montarItemDeLote como dependência (sync-retry.js não a duplica).
  // Se a lista de histórico estiver visível quando algo for sincronizado
  // em segundo plano, recarrega para o selo atualizar sem exigir ação
  // do técnico.
  function tentarRetryPendentesEmSegundoPlano() {
    if (!window.SyncRetry) return;
    var prepararArquivos = window.CloudData && window.CloudData.providerEscritas &&
      window.CloudData.providerEscritas() === 'supabase' &&
      window.SistemaOSSupabaseArquivo && window.SistemaOSSupabaseArquivo.enfileirarArquivosPendentes
      ? window.SistemaOSSupabaseArquivo.enfileirarArquivosPendentes().catch(function () { return []; })
      : Promise.resolve([]);
    prepararArquivos.then(function () {
      return window.SyncRetry.tentarReenviarPendentes(montarItemDeLote);
    }).then(function (resultado) {
      if (resultado && resultado.executado && resultado.enviados > 0) {
        if (painelHistorico && !painelHistorico.hidden) {
          carregarTelaHistorico();
        }
      }
    });
  }
  // Botao manual de sincronizacao: reenvia a fila deste celular e so
  // confirma depois que o PC publicou o snapshot atualizado de prazos e
  // status. O PC continua sendo a fonte de verdade para o banco principal.
  window.SistemaOSSincronizacaoManual = {
    sincronizarAgora: function () {
      var prepararArquivos = window.CloudData && window.CloudData.providerEscritas &&
        window.CloudData.providerEscritas() === 'supabase' &&
        window.SistemaOSSupabaseArquivo && window.SistemaOSSupabaseArquivo.enfileirarArquivosPendentes
        ? window.SistemaOSSupabaseArquivo.enfileirarArquivosPendentes().catch(function () { return []; })
        : Promise.resolve([]);
      var reenvio = prepararArquivos.then(function () {
        return window.SyncRetry
          ? window.SyncRetry.tentarReenviarPendentes(montarItemDeLote)
          : { executado: false, enviados: 0, falharam: 0 };
      });

      return reenvio.then(function (resultadoReenvio) {
        if (!window.CloudData || !window.CloudData.providerEscritas ||
            window.CloudData.providerEscritas() !== 'supabase' || !window.CloudData.processarFila) {
          return { sucesso: false, motivo: 'sem-sessao', reenvio: resultadoReenvio };
        }
        return window.CloudData.processarFila().then(function (resultadoNuvem) {
          return { sucesso: true, provider: 'supabase', reenvio: resultadoReenvio, nuvem: resultadoNuvem };
        });
      }).catch(function (erro) {
        return { sucesso: false, motivo: 'erro', erro: erro };
      });
    }
  };

  tentarRetryPendentesEmSegundoPlano();
  if (window.SyncRetry) {
    window.SyncRetry.iniciarRetryPeriodico(montarItemDeLote);
  }
  btnSalvarHistorico.addEventListener('click', function () {
    if (salvandoNoHistorico) return;

    // Bloco 4: quando emEdicaoHistorico, NÃO bloqueia por "já salvo".
    if (!emEdicaoHistorico && registroHistoricoAtualId) {
      mostrarFeedback('Este documento já foi salvo no histórico do celular.');
      return;
    }

    var permiteSalvarSemAssinatura = assinaturaEstaPendente(osAtual, documentoAtualTipo) ||
      documentoFoiMarcadoNaoAssinado(osAtual, documentoAtualTipo);
    if (!documentoAtualEstaAssinado() && !permiteSalvarSemAssinatura) {
      mostrarFeedback(
        MENSAGEM_ASSINE_ANTES_DE_SALVAR[documentoAtualTipo] || MENSAGEM_ASSINE_ANTES_DE_SALVAR.os,
        true
      );
      return;
    }

    salvandoNoHistorico = true;
    btnSalvarHistorico.disabled = true;
    var eraNovaOS = documentoAtualTipo === 'os' && !emEdicaoHistorico;

    // Bloco 4: rota de atualização (edição) vs criação de item novo.
    var promessaSalvar;
    if (emEdicaoHistorico && idEmEdicaoHistorico) {
      // Atualiza o registro existente — preserva id e idExportacaoOriginal.
      promessaSalvar = window.SistemaOSHistorico.editarRegistro(idEmEdicaoHistorico, osAtual)
        .then(function (registro) {
          return registro || { id: idEmEdicaoHistorico };
        });
    } else {
      promessaSalvar = salvarDocumentoAtualNoHistorico();
    }

    promessaSalvar
      .then(function (registro) {
        if (documentoAtualTipo === 'entrega' && entregaReferenciaRemota && registro && registro.id) {
          return window.SistemaOSHistorico.gravarEstadoSupabase(registro.id, entregaReferenciaRemota, { pendente: true }).then(function () { return registro; });
        }
        return registro;
      })
      .then(function (registro) {
        registroHistoricoAtualId = registro && registro.id ? registro.id : null;
        var mensagem = emEdicaoHistorico
          ? 'Item do histórico atualizado. Será reenviado ao PC na próxima sincronização.'
          : (documentoAtualTipo === 'entrega'
            ? 'Entrega registrada. A OS será marcada como Entregue no PC, inclusive quando o comprovante estiver sem assinatura.'
            : 'Salvo no histórico do celular.');
        mostrarFeedback(mensagem);
        tentarSincronizarAutomaticamente(registroHistoricoAtualId, documentoAtualTipo, osAtual);
        var atualizacaoEstoque = Promise.resolve();
        if (documentoAtualTipo === 'venda' && osAtual.estoqueLocalId &&
            window.SistemaOSEstoque && window.SistemaOSEstoque.registrarVenda) {
          atualizacaoEstoque = window.SistemaOSEstoque.registrarVenda(osAtual)
            .then(function () {
              document.dispatchEvent(new CustomEvent('sistema-os:estoque-alterado'));
              if (osAtual.assinaturaPendente === true && osAtual.naoAssinado !== true) {
                mostrarFeedback('Venda reservada e enviada ao PC. Depois da assinatura, o mesmo aparelho será concluído como vendido.');
              } else {
                mostrarFeedback('Venda concluída. Aparelho, valor e comprador foram atualizados no PC e nos gráficos.');
              }
            })
            .catch(function (erroEstoque) {
              // O documento permanece na fila comercial e será reaplicado no
              // PC. Mostra uma mensagem clara sem apagar o PDF já salvo.
              mostrarFeedback('Documento salvo, mas a atualização imediata do estoque ficou pendente: ' +
                (erroEstoque && erroEstoque.message ? erroEstoque.message : String(erroEstoque)), true);
            });
        }
        btnSalvarHistorico.disabled = true;
        if (emEdicaoHistorico) {
          emEdicaoHistorico = false;
          idEmEdicaoHistorico = null;
        }
        // O texto personalizado já ficou congelado no registro salvo. O
        // próximo documento volta ao padrão atual da empresa.
        if (CAMPOS_TERMOS_DOCUMENTO[documentoAtualTipo]) {
          preencherTermosPadraoDocumento(documentoAtualTipo, true);
        }
        var conclusaoRascunho = eraNovaOS ? finalizarRascunhoOS() : Promise.resolve(true);
        if (window.SistemaOSFotos && (documentoAtualTipo === 'os' || documentoAtualTipo === 'entrega' || documentoAtualTipo === 'compra')) {
          window.SistemaOSFotos.limparFotos(documentoAtualTipo);
        }
        return Promise.all([conclusaoRascunho, atualizacaoEstoque]).then(function () {
          // Mantém explícito que a conclusão atômica do rascunho faz parte da
          // operação de salvamento. Isto também evita uma futura refatoração
          // liberar o botão antes de o marcador vazio chegar ao IndexedDB.
          return conclusaoRascunho;
        });
      })
      .catch(function (err) {
        mostrarFeedback(
          'Não foi possível salvar no histórico: ' + (err && err.message ? err.message : String(err)),
          true
        );
        btnSalvarHistorico.disabled = false; // falhou: permite tentar de novo
      })
      .then(function () {
        salvandoNoHistorico = false;
      });
  });

  // ── Exportar para o PC ────────────────────────────────────────
  //
  // FORMATO DE EXPORTAÇÃO — LOTE (v2)
  // ----------------------------------------------------------------
  // Substitui o formato antigo (um .json por OS, só-OS) por um formato de
  // LOTE que cobre os 3 tipos de documento (OS, Compra, Venda) de uma vez.
  // Motivo: um técnico gera vários documentos por dia no celular; exportar
  // um arquivo por documento e importar um por um no PC não escala e é
  // fácil esquecer algum. Um sistema profissional sincroniza em lote.
  //
  // O botão "Exportar para o PC" da tela de prévia (exporta só o
  // documento atual) e o botão "Exportar pendentes para o PC" da tela de
  // Histórico (exporta tudo que ainda não foi sincronizado) GERAM O MESMO
  // FORMATO — o de 1 item é só um lote de tamanho 1. Assim o PC só precisa
  // entender um único formato de importação.
  //
  // { tipoArquivo: 'sistema-os-celular-lote', versaoFormato: 2, geradoEm,
  //   itens: [ { idExportacao, tipoDocumento: 'os'|'compra'|'venda', dados } ] }
  //
  // idExportacao: identificador determinístico (hash simples do conteúdo +
  // tipo), gerado no celular, ESTÁVEL entre exportações do mesmo item (se
  // o usuário exportar de novo o mesmo documento sem alterar nada, o
  // idExportacao é idêntico). Isso é o que permite o PC detectar duplicata
  // de forma confiável, em vez de confiar só no nome do arquivo ou no
  // conteúdo do PDF gerado (ver PROMPT-PC.md, gerado junto com esta
  // entrega).
  //
  // IMPORTANTE: o celular NUNCA numera OS/Compra/Venda (placeholder
  // "PRÉVIA — sem número" em todos) — a numeração oficial continua sendo
  // responsabilidade exclusiva do PC na importação, como já era.

  // Extraído para js/id-exportacao.js (window.IdExportacao). Wrapper mantido
  // aqui com o nome antigo para não alterar nenhuma outra chamada abaixo.
  function gerarIdExportacao(tipoDocumento, dados) {
    return window.IdExportacao.gerar(tipoDocumento, dados);
  }

  // Cada um dos 3 monta o "pacote de dados" que sai no .json exportado.
  // assinaturaAssistenciaBase64 é uma FOTO do que valia no momento da
  // exportação (obterAssinaturaAssistenciaAtual()), com esta prioridade:
  //   1) assinatura feita NA HORA para este documento (botão "Assinar
  //      assistência (só este documento)"), se houver;
  //   2) a padrão salva em Configurações, SEMPRE que existir — "Exigir
  //      assinatura da assistência" não decide mais SE ela é usada, só
  //      decide a NUMERAÇÃO (ver comentário de
  //      obterAssinaturaAssistenciaAtual acima, que documenta a correção);
  //   3) '' — nenhuma assinatura de assistência para este documento.
  // Antes deste campo existir, a assinatura da assistência aparecia certa
  // na prévia dentro do próprio celular (ela é aplicada visualmente a
  // cada geração de HTML, lendo Configurações na hora) mas nunca chegava
  // ao PC — o .json não carregava informação nenhuma sobre ela existir.
  // O PC precisa reconhecer este campo e aplicá-lo tal como veio (não
  // substituir pela própria config do PC) — combinado explicitamente com
  // o usuário.
  function montarDadosOSParaEnvio(dados) {
    return {
      cliente: dados.cliente,
      aparelho: dados.aparelho,
      observacoes: dados.observacoes,
      prioridade: dados.prioridade,
      semPrazo: dados.semPrazo === true,
      dataPrevista: dados.dataPrevista,
      horaPrevista: dados.horaPrevista,
      // Registrado para o PC, sem uso no PDF do celular (ver montarObjetoOS).
      garantiaDias: Number(dados.garantiaDias) || 0,
      termos: dados.termos || '',
      // Fotos "de como chegou" — vão para o PC, que já sabe classificar
      // em categoria 'entrada' na galeria de fotos da OS (ver
      // CATEGORIAS_FOTO_OS no schema do PC).
      fotos: Array.isArray(dados.fotos) ? dados.fotos : [],
      assinaturaClienteBase64: dados.assinaturaClienteBase64 || '',
      assinaturaPendente: dados.assinaturaPendente === true,
      naoAssinado: dados.naoAssinado === true,
      // BUGFIX: passa `dados` (o documento deste item específico), não
      // o documento atualmente aberto na tela — ver comentário de
      // obterAssinaturaAssistenciaAtual() para o bug que isso corrige
      // (todo o lote saindo com a assinatura de assistência de osAtual).
      assinaturaAssistenciaBase64: obterAssinaturaAssistenciaAtual(dados)
    };
  }

  function montarDadosCompraParaEnvio(dados) {
    return {
      vendedor: dados.vendedor,
      aparelho: dados.aparelho,
      avaliacao: dados.avaliacao,
      dadosCompra: dados.dadosCompra,
      termosCompra: dados.termosCompra || '',
      fotos: Array.isArray(dados.fotos) ? dados.fotos : [],
      assinaturaVendedorBase64: dados.assinaturaVendedorBase64 || '',
      assinaturaPendente: dados.assinaturaPendente === true,
      naoAssinado: dados.naoAssinado === true,
      assinaturaAssistenciaBase64: obterAssinaturaAssistenciaAtual(dados)
    };
  }

  function montarDadosVendaParaEnvio(dados) {
    return {
      dataVenda: dados.dataVenda || new Date().toISOString(),
      estoqueLocalId: dados.estoqueLocalId || '',
      tipoEquipamento: dados.tipoEquipamento,
      marca: dados.marca,
      modelo: dados.modelo,
      cor: dados.cor,
      imei: dados.imei,
      observacoes: dados.observacoes,
      garantia: normalizarGarantiaVenda(dados.garantia),
      compradorNome: dados.compradorNome,
      compradorTelefone: dados.compradorTelefone,
      compradorSemNumero: dados.compradorSemNumero === true,
      compradorCpf: dados.compradorCpf,
      compradorEmail: dados.compradorEmail,
      valorVenda: dados.valorVenda,
      formaPagamento: dados.formaPagamento,
      termosVenda: dados.termosVenda || '',
      assinaturaCompradorBase64: dados.assinaturaCompradorBase64 || '',
      assinaturaPendente: dados.assinaturaPendente === true,
      naoAssinado: dados.naoAssinado === true,
      assinaturaAssistenciaBase64: obterAssinaturaAssistenciaAtual(dados)
    };
  }

  // Comprovante de Entrega — contrato de campos originalmente definido em
  // PROMPT-CELULAR-aba-entregas.md, item 5 ("O que a exportação deve
  // conter"). ATUALIZADO nesta sessão para incluir marca/modelo/
  // reparoRealizado (campos novos da seção "DADOS DO APARELHO" — ver
  // entrega-template.js): numeroOS, nomeRetirou, marca, modelo,
  // reparoRealizado, declaracao, dataHoraAssinatura e a assinatura em
  // base64. Diferente dos outros 3, NÃO tem assinaturaAssistenciaBase64 —
  // este documento não tem uma segunda assinatura (ver
  // aplicarAssinaturasNaEntrega). Todos os campos de texto vão exatamente
  // como digitados no celular, sem nenhuma transformação — é
  // responsabilidade do PC validar contra o banco na hora de importar (ver
  // decisão de arquitetura 3 do prompt).
  //
  // ⚠️ PROMPT-CELULAR-aba-entregas.md, item 5, ficou desatualizado com
  // esta mudança — não está neste pacote de arquivos pra eu editar junto.
  // Atualize a doc e confira se o importador do PC (lote v2) já espera
  // marca/modelo/reparoRealizado no payload de 'entrega' antes de mandar
  // um lote de verdade, senão os campos chegam no JSON mas o PC ignora.
  function montarDadosEntregaParaEnvio(dados) {
    return {
      numeroOS: dados.numeroOS,
      nomeRetirou: dados.nomeRetirou,
      cpfRetirou: dados.cpfRetirou || '',
      telefoneRetirou: dados.telefoneRetirou || '',
      marca: dados.marca || '',
      modelo: dados.modelo || '',
      reparoRealizado: dados.reparoRealizado || '',
      valorReparo: Number(dados.valorReparo) || 0,
      formaPagamento: dados.formaPagamento || '',
      declaracao: dados.declaracao,
      dataHoraAssinatura: dados.dataHoraAssinatura,
      garantiaDataInicio: dados.garantiaDataInicio || dados.dataHoraAssinatura,
      termosGarantia: dados.termosGarantia,
      clienteId: dados.clienteId,
      cicloEntregaId: dados.cicloEntregaId || dados.retornoGarantiaId || 'original',
      retornoGarantiaId: dados.retornoGarantiaId || '',
      garantiaId: dados.garantiaId || '',
      documentoEntregaId: dados.documentoEntregaId || '',
      idEnvioAssinatura: dados.idEnvioAssinatura || '',
      tipoEntrega: dados.tipoEntrega || (dados.retornoGarantiaId ? 'retorno_garantia' : 'original'),
      // Garantia (dias) e data limite já calculada — mesmos valores que
      // saíram no PDF (congelados no momento da assinatura, ver
      // montarObjetoEntrega/calcularDataLimiteGarantia).
      garantiaDias: Number(dados.garantiaDias) || 0,
      dataLimiteGarantia: dados.dataLimiteGarantia || '',
      // Fotos "de como saiu" — campo novo, o PC ainda precisa aceitar
      // fotos em Entrega (ver prompt-pc gerado a seguir).
      fotos: Array.isArray(dados.fotos) ? dados.fotos : [],
      assinaturaRetirouBase64: dados.assinaturaRetirouBase64 || '',
      assinaturaPendente: dados.assinaturaPendente === true,
      naoAssinado: dados.naoAssinado === true
    };
  }

  // Ponto único que decide, por tipo de documento, quais campos vão no
  // envio (mesmo princípio de "só o que o PC precisa" que já existia só
  // para OS) e monta o item de lote correspondente.
  function montarItemDeLote(tipoDocumento, dados) {
    var dadosParaEnvio;
    if (tipoDocumento === 'compra') dadosParaEnvio = montarDadosCompraParaEnvio(dados);
    else if (tipoDocumento === 'venda') dadosParaEnvio = montarDadosVendaParaEnvio(dados);
    else if (tipoDocumento === 'entrega') dadosParaEnvio = montarDadosEntregaParaEnvio(dados);
    else dadosParaEnvio = montarDadosOSParaEnvio(dados);

    return {
      idExportacao: gerarIdExportacao(tipoDocumento, dados),
      tipoDocumento: tipoDocumento,
      dados: dadosParaEnvio
    };
  }

  // BUG CORRIGIDO AQUI: listarPendentesSincronizacao() (via listarTodos())
  // ordena por 'salvoEm' decrescente (mais recente primeiro) — critério
  // certo para a tela de Histórico, mas errado para a ordem de um lote de
  // exportação. Como uma Entrega é sempre salva DEPOIS da OS
  // correspondente (fluxo natural: recebe -> conserta -> entrega), ela
  // tem salvoEm mais recente e por isso entrava ANTES da OS no array
  // 'itens' sempre que as duas estivessem pendentes de exportação juntas.
  // O PC processa o lote na ordem em que os itens chegam, e uma Entrega só
  // é aceita se a OS correspondente já estiver gravada — então a Entrega
  // era rejeitada com "OS não encontrada" mesmo a OS estando no mesmo
  // arquivo, só que mais adiante. A correção reordena aqui, colocando
  // todo item tipoDocumento:'os' antes dos demais, sem depender de o PC
  // também estar corrigido (ver mesma correção espelhada em
  // importarLoteDoCelular, src/db.js do sistema de PC — defesa nos dois
  // lados). Array.prototype.sort é estável (ES2019+): a ordem relativa
  // ENTRE itens do mesmo grupo (duas OS entre si, duas Entregas entre si)
  // continua exatamente como veio de listarPendentesSincronizacao.
  function ordenarItensParaLote(itensOriginais) {
    return itensOriginais
      .map(function (item, indiceOriginal) { return { item: item, indiceOriginal: indiceOriginal }; })
      .sort(function (a, b) {
        var pesoA = a.item && a.item.tipoDocumento === 'os' ? 0 : 1;
        var pesoB = b.item && b.item.tipoDocumento === 'os' ? 0 : 1;
        if (pesoA !== pesoB) return pesoA - pesoB;
        return a.indiceOriginal - b.indiceOriginal;
      })
      .map(function (par) { return par.item; });
  }

  function montarLote(itensDeLote) {
    return {
      tipoArquivo: 'sistema-os-celular-lote',
      versaoFormato: 2,
      geradoEm: new Date().toISOString(),
      itens: ordenarItensParaLote(itensDeLote)
    };
  }

  function nomeArquivoLote(quantidade) {
    var carimbo = new Date().toISOString().replace(/[:.]/g, '-');
    return 'sistema-os-celular-lote-' + quantidade + 'item-' + carimbo + '.json';
  }

  function baixarArquivo(blob, nomeArquivo) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Delega toda a decisão de "compartilhar via menu nativo do Android vs.
  // baixar" para js/compartilhar-arquivo.js — ver esse arquivo para o
  // diagnóstico completo do bug que motivou a mudança (navigator.share
  // sozinho não abria o menu nativo dentro do APK) e a ordem de fallback.
  // Esta função mantém a MESMA assinatura de antes (lote, título) para
  // não exigir mudança nos pontos que já chamavam compartilharOuBaixarLote.
  function compartilharOuBaixarLote(lote, tituloCompartilhamento) {
    var nomeArquivo = nomeArquivoLote(lote.itens.length);
    return window.SistemaOSCompartilhar.compartilharOuBaixarArquivo(
      lote,
      nomeArquivo,
      tituloCompartilhamento,
      'Exportação para importar no sistema do PC.'
    );
  }

  function montarItemAtualPreservandoId() {
    if (!registroHistoricoAtualId || !window.SistemaOSHistorico.montarItemReenvio) {
      return Promise.resolve(montarItemDeLote(documentoAtualTipo, osAtual));
    }
    return window.SistemaOSHistorico.obterPorId(registroHistoricoAtualId).then(function (registro) {
      if (!registro) return montarItemDeLote(documentoAtualTipo, osAtual);
      return window.SistemaOSHistorico.montarItemReenvio(
        registro,
        montarDadosParaEnvioPorTipo(documentoAtualTipo)
      );
    });
  }

  btnExportarPC.addEventListener('click', function () {
    var permiteExportarSemAssinatura = assinaturaEstaPendente(osAtual, documentoAtualTipo) ||
      documentoFoiMarcadoNaoAssinado(osAtual, documentoAtualTipo);
    if (!documentoAtualEstaAssinado() && !permiteExportarSemAssinatura) {
      var rotuloTipo = documentoAtualTipo === 'compra' ? 'a Compra'
        : documentoAtualTipo === 'venda' ? 'a Venda'
        : documentoAtualTipo === 'entrega' ? 'o comprovante de Entrega' : 'a OS';
      mostrarFeedback('Assine ' + rotuloTipo + ' antes de exportar para o PC.', true);
      return;
    }

    // BUGFIX: se o técnico clicar direto em "Exportar para o PC" sem ter
    // clicado antes em "Salvar no histórico", registroHistoricoAtualId é
    // null — e o documento, embora exportado com sucesso, nunca fica
    // registrado em lugar nenhum do celular (não dá pra reabrir, reexportar
    // ou sequer confirmar depois que o atendimento aconteceu). Como
    // "assinar → exportar" é o caminho mais natural de seguir, isso
    // acontecia com frequência, não só em casos extremos.
    //
    // Correção: garante um registro no histórico ANTES de exportar,
    // salvando automaticamente se ainda não houver um. Assim os dois
    // caminhos (salvar-depois-exportar OU exportar-direto) sempre terminam
    // com o documento rastreado no celular. Usa
    // salvarDocumentoAtualNoHistorico() (não window.SistemaOSHistorico.salvar
    // direto) para que uma Entrega exportada sem passar por "Salvar" antes
    // também respeite a regra "um vale por OS" — sem isso, exportar direto
    // duas entregas seguidas para o mesmo numeroOS criaria dois registros
    // no histórico local, só o botão "Salvar" aplicaria a substituição.
    var garantirRegistroHistorico = registroHistoricoAtualId
      ? Promise.resolve()
      : salvarDocumentoAtualNoHistorico()
        .then(function (registro) {
          registroHistoricoAtualId = registro && registro.id ? registro.id : null;
          if (registroHistoricoAtualId) {
            btnSalvarHistorico.disabled = true; // já salvo: mantém consistência com o clique manual
            tentarSincronizarAutomaticamente(registroHistoricoAtualId, documentoAtualTipo, osAtual);
          }
        })
        .catch(function () {
          // Não bloqueia a exportação se o salvamento automático falhar
          // (ex: IndexedDB indisponível) — o técnico ainda consegue exportar
          // o documento; só não haverá rastro local dessa vez.
        });

    garantirRegistroHistorico.then(function () {
      if (documentoAtualTipo === 'venda' && osAtual.estoqueLocalId &&
          window.SistemaOSEstoque && window.SistemaOSEstoque.registrarVenda) {
        return window.SistemaOSEstoque.registrarVenda(osAtual)
          .then(function () { document.dispatchEvent(new CustomEvent('sistema-os:estoque-alterado')); })
          .catch(function () { /* o documento comercial continua na fila */ });
      }
    }).then(function () {
      return montarItemAtualPreservandoId();
    }).then(function (item) {
      var lote = montarLote([item]);
      var nomeCliente = (osAtual.cliente && osAtual.cliente.nome) ||
        osAtual.compradorNome ||
        (osAtual.vendedor && osAtual.vendedor.nome) ||
        osAtual.nomeRetirou || '';

      compartilharOuBaixarLote(lote, 'Documento — ' + nomeCliente).then(function (resultado) {
        if (resultado.metodo === 'cancelado') return;
        var sufixoSincronizado = '';

        // Se este documento corresponde a um registro salvo no histórico do
        // celular (veio de "Abrir" no histórico, foi salvo com "Salvar no
        // histórico" antes de exportar, ou acabou de ser salvo automatica-
        // mente acima), marca aquele registro específico como sincronizado
        // — sem isso, o item continuava aparecendo como "Pendente" na
        // listagem mesmo já tendo sido exportado por aqui.
        var marcarSincronizado = registroHistoricoAtualId
          ? window.SistemaOSHistorico.marcarComoSincronizado([registroHistoricoAtualId])
            .then(function () { sufixoSincronizado = ' Salvo e marcado como sincronizado no histórico.'; })
            .catch(function () { /* exportação já concluiu; falha ao marcar não deve bloquear o feedback */ })
          : Promise.resolve();

        marcarSincronizado.then(function () {
          if (resultado.metodo === 'compartilhado') {
            mostrarFeedback('Exportação enviada pelo menu de compartilhar.' + sufixoSincronizado);
          } else {
            mostrarFeedback('Arquivo .json baixado' +
              (resultado.metodo === 'baixado-apos-erro-compartilhar'
                ? ' (não foi possível compartilhar diretamente).'
                : ' (compartilhamento direto não disponível neste navegador).') + sufixoSincronizado);
          }
        });
      });
    });
  });

  // ── Exportar PENDENTES em lote (tela de Histórico) ────────────
  var btnExportarPendentes = document.getElementById('btn-exportar-pendentes');

  // Mesma troca de mostrarFeedback logo acima: só o destino da mensagem
  // muda (toast em vez de .feedback-acao fixo), assinatura preservada.
  function mostrarFeedbackPendentes(mensagem, ehErro) {
    window.SistemaOSToast.mostrar(mensagem, { ehErro: !!ehErro });
  }

  if (btnExportarPendentes) {
    btnExportarPendentes.addEventListener('click', function () {
      btnExportarPendentes.disabled = true;
      window.SistemaOSHistorico.listarPendentesSincronizacao()
        .then(function (pendentes) {
          if (!pendentes.length) {
            mostrarFeedbackPendentes('Nada pendente — tudo já foi exportado para o PC.');
            return null;
          }

          var itens = pendentes.map(function (registro) {
            // Bloco 4: usa montarItemReenvio (preserva idExportacaoOriginal)
            // quando disponível, senão montarItemDeLote (recalcula).
            if (registro.idExportacaoOriginal && window.SistemaOSHistorico.montarItemReenvio) {
              var montarDados = montarDadosParaEnvioPorTipo(registro.tipoDocumento || 'os');
              return window.SistemaOSHistorico.montarItemReenvio(registro, montarDados);
            }
            return montarItemDeLote(registro.tipoDocumento || 'os', registro.os);
          });
          var lote = montarLote(itens);

          return compartilharOuBaixarLote(lote, 'Lote — ' + pendentes.length + ' documento(s)')
            .then(function (resultado) {
              if (resultado.metodo === 'cancelado') {
                mostrarFeedbackPendentes('Exportação cancelada — nada foi marcado como sincronizado.');
                return;
              }
              var ids = pendentes.map(function (registro) { return registro.id; });
              return window.SistemaOSHistorico.marcarComoSincronizado(ids).then(function () {
                mostrarFeedbackPendentes(
                  pendentes.length + ' documento(s) exportado(s)' +
                  (resultado.metodo === 'compartilhado'
                    ? ' e enviado(s) pelo menu de compartilhar.'
                    : ' (arquivo .json baixado).')
                );
                // Atualiza a lista para refletir o novo status "Sincronizado".
                carregarTelaHistorico();
              });
            });
        })
        .catch(function (err) {
          mostrarFeedbackPendentes(
            'Não foi possível exportar: ' + (err && err.message ? err.message : String(err)),
            true
          );
        })
        .then(function () {
          btnExportarPendentes.disabled = false;
        });
    });
  }

  // ── Parte 4 — Listagem e reabertura do histórico local ───────

  function escaparHtml(t) {
    return String(t || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatarDataListagem(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return iso;
    }
  }

  var RESUMO_TIPO_DOCUMENTO = { os: 'OS', compra: 'Compra', venda: 'Venda', entrega: 'Entrega' };

  function renderizarListaHistorico(registros) {
    listaHistorico.innerHTML = '';

    if (!registros.length) {
      var vazio = document.createElement('p');
      vazio.className = 'historico-vazio';
      vazio.textContent = 'Nada salvo neste aparelho ainda.';
      listaHistorico.appendChild(vazio);
      return;
    }

    registros.forEach(function (registro) {
      var dados = registro.os || {};
      var tipo = registro.tipoDocumento || 'os';
      // Nome da "outra parte": cliente na OS, vendedor na Compra, comprador
      // na Venda. Assinatura correspondente segue a mesma distinção (ver
      // aplicarAssinaturasNaOS / aplicarAssinaturasNaCompra /
      // aplicarAssinaturasNaVenda).
      var nomeOutraParte;
      var assinaturaBase64;
      if (tipo === 'compra') {
        nomeOutraParte = (dados.vendedor && dados.vendedor.nome) || '';
        assinaturaBase64 = dados.assinaturaVendedorBase64;
      } else if (tipo === 'venda') {
        nomeOutraParte = dados.compradorNome || '';
        assinaturaBase64 = dados.assinaturaCompradorBase64;
      } else if (tipo === 'entrega') {
        nomeOutraParte = dados.nomeRetirou || '';
        assinaturaBase64 = dados.assinaturaRetirouBase64;
      } else {
        nomeOutraParte = (dados.cliente && dados.cliente.nome) || '';
        assinaturaBase64 = dados.assinaturaClienteBase64;
      }
      // Venda e Entrega usam contrato "flat" (marca/modelo direto na
      // raiz); OS/Compra usam `aparelho.marca`/`aparelho.modelo` aninhado.
      // Entrega sempre mostra "OS nº X" primeiro (é o dado que a vincula
      // ao registro do PC) e, se marca/modelo tiverem sido preenchidos,
      // junto com o aparelho — comprovantes salvos antes desses campos
      // existirem seguem mostrando só o número da OS.
      var a = (tipo === 'venda' || tipo === 'entrega') ? dados : (dados.aparelho || {});
      // temConteudo (não só Boolean) para marca/modelo: Boolean('   ') é
      // true (string não-vazia), então um valor só de espaço passava pelo
      // filter e virava " · " solto na linha (ou " " sozinho no ramo
      // else). Aplica ao ramo 'entrega' E ao ramo genérico (OS/Compra/
      // Venda) abaixo — mesma causa raiz nos dois, não é exclusivo de
      // Entrega.
      var temConteudo = function (v) { return !!String(v || '').trim(); };
      var linhaObjeto = tipo === 'entrega'
        ? ((window.SistemaOSNumero && window.SistemaOSNumero.comFallback
            ? window.SistemaOSNumero.comFallback(dados.numeroOS, 'OS —')
            : String(dados.numeroOS || 'OS —')) +
          ([a.marca, a.modelo].filter(temConteudo).length ? ' · ' + [a.marca, a.modelo].filter(temConteudo).join(' ') : ''))
        : ([a.marca, a.modelo].filter(temConteudo).join(' ') || '—');
      var rotuloCicloEntrega = tipo === 'entrega' && (dados.retornoGarantiaId ||
        (dados.cicloEntregaId && dados.cicloEntregaId !== 'original'))
        ? ' · retorno em garantia'
        : '';

      var item = document.createElement('article');
      item.className = 'item-historico';

      var thumb = document.createElement('div');
      thumb.className = 'item-historico-thumb';
      if (assinaturaBase64) {
        var img = document.createElement('img');
        img.src = assinaturaBase64;
        img.alt = 'Assinatura';
        thumb.appendChild(img);
      } else {
        thumb.textContent = '—';
      }

      // 3 estados possíveis (em vez do binário sincronizado/pendente
      // anterior): sincronizado; tentou e falhou (há uma próxima
      // tentativa automática vindo, via retry em segundo plano); ou
      // simplesmente ainda não teve nenhuma tentativa (documento recém
      // salvo, antes da primeira sincronização automática rodar).
      var sincronizado = registro.sincronizadoComPC === true;
      var jaTentouEFalhou = !sincronizado && !!registro.ultimaTentativaSincFalhouEm;
      // Quando o servidor já devolveu o número oficial da OS
      // (registro.numeroOSAtribuido),
      // mostra "Nº 1234" no lugar do selo genérico "Sincronizado" — sem
      // isso, o técnico via só "✓ Sincronizado" e continuava sem saber
      // qual é o número real da OS sem entrar na aba Consulta.
      var seloSincronizacao = registro.numeroOSAtribuido
        ? '<span class="selo-sincronizado">Nº ' + escaparHtml(String(registro.numeroOSAtribuido)) + '</span>'
        : sincronizado
          ? '<span class="selo-sincronizado">✓ Sincronizado</span>'
          : jaTentouEFalhou
            ? '<span class="selo-tentando-novamente">↻ Tentando novamente</span>'
            : '<span class="selo-pendente">Pendente</span>';
      if (assinaturaEstaPendente(dados, tipo)) {
        seloSincronizacao += ' <span class="selo-assinatura-pendente">Assinatura pendente</span>';
      } else if (documentoFoiMarcadoNaoAssinado(dados, tipo)) {
        seloSincronizacao += ' <span class="selo-assinatura-pendente">Não assinado</span>';
      }

      // Resumo de garantia — só para Entregas (é o tipo em que a garantia
      // aparece de fato no PDF gerado; em OS o campo existe só para
      // controle interno/PC, ver montarObjetoOS, então não aparece aqui
      // pra não sugerir algo que o PDF da OS não mostra). Omitido quando
      // garantiaDias vier vazio/0 (comprovantes antigos ou sem garantia).
      // Data sem hora (a hora do limite é irrelevante, só herdada da hora
      // da assinatura) — mesmo critério do "VÁLIDA ATÉ" no PDF
      // (entrega-template.js, formatarDataSimples).
      var linhaGarantia = '';
      if (tipo === 'entrega' && Number(dados.garantiaDias) > 0) {
        var dataLimiteFormatada = '';
        try { dataLimiteFormatada = new Date(dados.dataLimiteGarantia).toLocaleDateString('pt-BR'); } catch (e) { dataLimiteFormatada = ''; }
        linhaGarantia = '<p class="item-historico-garantia">Garantia: ' +
          escaparHtml(String(dados.garantiaDias)) + ' dias (até ' +
          escaparHtml(dataLimiteFormatada) + ')</p>';
      }

      var info = document.createElement('div');
      info.className = 'item-historico-info';
      info.innerHTML =
        '<p class="item-historico-tipo">' + escaparHtml((RESUMO_TIPO_DOCUMENTO[tipo] || tipo) + rotuloCicloEntrega) + ' ' + seloSincronizacao + '</p>' +
        '<p class="item-historico-cliente">' + escaparHtml(nomeOutraParte || '(sem nome)') + '</p>' +
        '<p class="item-historico-aparelho">' + escaparHtml(linhaObjeto) + '</p>' +
        linhaGarantia +
        '<p class="item-historico-data">' + escaparHtml(formatarDataListagem(registro.salvoEm)) + '</p>';

      var btnAbrir = document.createElement('button');
      btnAbrir.type = 'button';
      btnAbrir.className = 'btn-secundario btn-abrir-historico';
      btnAbrir.textContent = 'Abrir';
      btnAbrir.addEventListener('click', function () { abrirItemHistorico(registro.id); });

      // Bloco 4: botão "Editar" — só para OS/Compra/Venda (entrega não
      // tem campos editáveis no celular). Permite reabrir o item no
      // formulário com os dados preenchidos, editar e re-salvar.
      var btnEditar = null;
      if (['os', 'compra', 'venda', 'entrega'].indexOf(tipo) !== -1) {
        btnEditar = document.createElement('button');
        btnEditar.type = 'button';
        btnEditar.className = 'btn-secundario btn-editar-historico';
        btnEditar.textContent = 'Editar';
        btnEditar.addEventListener('click', function () { editarItemHistorico(registro.id); });
      }

      var btnExcluir = document.createElement('button');
      btnExcluir.type = 'button';
      btnExcluir.className = 'btn-excluir-historico';
      btnExcluir.textContent = 'Excluir';
      btnExcluir.setAttribute('aria-label', 'Excluir este item do histórico');
      btnExcluir.addEventListener('click', function () { excluirItemHistorico(registro.id, item); });

      var acoes = document.createElement('div');
      acoes.className = 'item-historico-acoes';
      acoes.appendChild(btnAbrir);
      if (btnEditar) acoes.appendChild(btnEditar);
      acoes.appendChild(btnExcluir);

      item.appendChild(thumb);
      item.appendChild(info);
      item.appendChild(acoes);
      listaHistorico.appendChild(item);
    });
  }

  // Exclusão com confirmação: usa confirm() nativo (suficiente para este
  // fluxo simples, sem precisar de um modal customizado) — se confirmado,
  // exclui do IndexedDB (js/historico.js) e remove o card da tela sem
  // precisar recarregar a lista inteira. Note que "possibilidade de
  // excluir depois também" (pedido original) já está coberta: a exclusão
  // funciona em qualquer momento a partir da tela de histórico, incluindo
  // itens salvos há muito tempo — não há prazo/expiração.
  async function excluirItemHistorico(id, elementoItem) {
    var confirmou = window.confirm('Excluir este item do histórico do celular? Esta ação não pode ser desfeita.');
    if (!confirmou) return;
    try {
      if (window.SistemaOSExclusao && !await window.SistemaOSExclusao.autorizar('excluir este documento')) return;
    } catch (erroAutorizacao) {
      if (window.SistemaOSToast) {
        window.SistemaOSToast.mostrar(erroAutorizacao.message || String(erroAutorizacao), 'erro');
      } else {
        window.alert(erroAutorizacao.message || String(erroAutorizacao));
      }
      return;
    }

    // Antes de excluir, busca o registro para obter o idExportacao
    // e notificar o PC sobre a exclusão (se a sincronização estiver ativa).
    var registroParaNotificar = null;
    var excluirCascataOS = false;
    var numeroCascataOS = '';
    window.SistemaOSHistorico.obterPorId(id)
      .then(function (registro) {
        registroParaNotificar = registro;
        var tipo = registro && (registro.tipoDocumento || 'os');
        excluirCascataOS = tipo === 'os';
        numeroCascataOS = registro && (
          registro.numeroOSAtribuido ||
          (registro.os && (registro.os.numero || registro.os.numeroOS))
        ) || '';
        var usaSupabase = tipo === 'os' && window.CloudData &&
          window.CloudData.providerEscritas &&
          window.CloudData.providerEscritas() === 'supabase';
        if (!usaSupabase || !registro) return true;

        var idExp = registro.idExportacaoOriginal ||
          (window.IdExportacao && registro.os ? window.IdExportacao.gerar('os', registro.os) : null);
        if (!registro.supabaseId || !registro.supabaseRevision) {
          // Se a criacao ainda estiver apenas na fila local, cancela a fila.
          // Registros antigos ja sincronizados podem nao ter gravado id/revision:
          // nesse caso o CloudData resolve a identidade pelo numero antes de
          // excluir, impedindo que a OS reapareca ao abrir o aplicativo.
          if (registro.sincronizadoComPC === true) {
            var numeroAntigo = registro.numeroOSAtribuido ||
              (registro.os && (registro.os.numero || registro.os.numeroOS));
            if (!numeroAntigo) {
              throw new Error('A OS antiga nao possui numero para confirmar a exclusao no servidor.');
            }
            return window.CloudData.excluirOS({ numero: numeroAntigo }).then(function (resultadoAntigo) {
              if (resultadoAntigo && (resultadoAntigo.enviado || resultadoAntigo.enfileirado || resultadoAntigo.jaAusente)) return true;
              var motivoAntigo = resultadoAntigo && resultadoAntigo.motivo
                ? resultadoAntigo.motivo
                : 'erro';
              throw new Error(motivoAntigo === 'nao-encontrada'
                ? 'A OS nao foi encontrada no servidor. Atualize a lista e tente novamente.'
                : 'A exclusao nao foi confirmada pelo servidor (' + motivoAntigo + ').');
            });
          }
          return window.CloudData.cancelarCriacaoOSPendente(idExp);
        }
        return window.CloudData.excluirOS({
          id: registro.supabaseId,
          revision: registro.supabaseRevision,
          numero: registro.numeroOSAtribuido
        }).then(function (resultado) {
          if (resultado && (resultado.enviado || resultado.enfileirado || resultado.jaAusente)) return true;
          var motivo = resultado && resultado.motivo ? resultado.motivo : 'erro';
          throw new Error(motivo === 'conflito'
            ? 'A OS foi alterada em outro dispositivo. Consulte a versao atual antes de excluir.'
            : 'A exclusao nao foi confirmada pelo servidor (' + motivo + ').');
        });
      })
      .then(function () {
        if (excluirCascataOS && numeroCascataOS && window.SistemaOSHistorico.excluirRelacionadosOS) {
          return window.SistemaOSHistorico.excluirRelacionadosOS(numeroCascataOS);
        }
        return window.SistemaOSHistorico.excluir(id);
      })
      .then(function () {
        if (elementoItem && elementoItem.parentNode) {
          elementoItem.parentNode.removeChild(elementoItem);
        }
        if (!listaHistorico.querySelector('.item-historico')) {
          renderizarListaHistorico([]);
        }
      })
      .catch(function (err) {
        window.alert('Não foi possível excluir: ' + (err && err.message ? err.message : String(err)));
      });
  }

  var filtroHistorico = document.getElementById('filtro-historico');
  var filtroTipoAtual = 'todos';

  function carregarTelaHistorico() {
    listaHistorico.innerHTML = '<p class="historico-carregando">Carregando…</p>';
    window.SistemaOSHistorico.listarPorTipo(filtroTipoAtual)
      .then(renderizarListaHistorico)
      .catch(function (err) {
        listaHistorico.innerHTML = '';
        var erro = document.createElement('p');
        erro.className = 'historico-erro';
        erro.textContent = 'Não foi possível abrir o histórico: ' + (err && err.message ? err.message : String(err));
        listaHistorico.appendChild(erro);
      });
  }

  if (filtroHistorico) {
    filtroHistorico.addEventListener('click', function (ev) {
      var botao = ev.target.closest('[data-filtro-tipo]');
      if (!botao) return;
      filtroTipoAtual = botao.getAttribute('data-filtro-tipo');
      var todosBotoes = filtroHistorico.querySelectorAll('[data-filtro-tipo]');
      for (var i = 0; i < todosBotoes.length; i++) {
        todosBotoes[i].classList.toggle('filtro-ativo', todosBotoes[i] === botao);
      }
      carregarTelaHistorico();
    });
  }

  // Escreve o HTML no iframe.
  //
  // Antes, isto só fazia `frame.srcdoc = html` e esperava o evento 'load'
  // para resolver a Promise. Só que `srcdoc` só dispara 'load' quando o
  // navegador realmente TROCA o documento do iframe — e ao assinar, o HTML
  // novo (com a assinatura injetada) é quase idêntico ao HTML anterior (a
  // prévia sem assinatura, que o usuário já estava olhando). Em vários
  // WebViews Android esse "quase igual" não dispara um novo 'load' de
  // forma confiável, então a Promise nunca resolvia: a tela ficava parada
  // sem erro nenhum, e a assinatura só aparecia depois, ao reabrir pelo
  // histórico (que usa abrirItemHistorico, um caminho que força um
  // conteúdo inicial diferente o bastante para sempre disparar 'load').
  //
  // Correção: sempre que o iframe já tiver um documento acessível (ou
  // seja, depois da primeiríssima carga), escreve DIRETO via
  // contentDocument.open/write/close — isso é síncrono, não depende de
  // nenhum evento, e resolve a Promise imediatamente após escrever. Só cai
  // para `srcdoc` + listener de 'load' como fallback: na primeira carga
  // (frame ainda sem documento) ou se o acesso a contentDocument falhar
  // por qualquer motivo (ex.: alguma restrição do WebView).
  function definirConteudoDoFrame(html) {
    return new Promise(function (resolve) {
      var doc = null;
      try {
        doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
      } catch (erroAcesso) {
        doc = null; // segue para o fallback de srcdoc
      }

      if (doc) {
        try {
          doc.open();
          doc.write(html);
          doc.close();
          resolve();
          return;
        } catch (erroEscrita) {
          // Falhou a escrita direta (caso raro) — cai para o fallback abaixo.
        }
      }

      frame.addEventListener('load', function aoCarregar() {
        frame.removeEventListener('load', aoCarregar);
        resolve();
      });
      frame.srcdoc = html;
    });
  }

  // Reabre a MESMA prévia já renderizada (dados + assinatura), sem
  // precisar assinar de novo: reusa o objeto salvo, chama o gerador de
  // HTML certo pro tipo do registro (OS ou Compra) e reinjeta as
  // assinaturas.
  function abrirItemHistorico(id) {
    window.SistemaOSHistorico.obterPorId(id)
      .then(function (registro) {
        if (!registro || !registro.os) {
          throw new Error('Item não encontrado (pode ter sido removido).');
        }
        return carregamentoModulos.then(function () {
          documentoAtualTipo = registro.tipoDocumento || 'os';
          osAtual = Object.assign({}, registro.os);
          if (registro.numeroOSAtribuido) {
            osAtual.numeroOSAtribuido = registro.numeroOSAtribuido;
            if (documentoAtualTipo === 'os') osAtual.numero = registro.numeroOSAtribuido;
            if (documentoAtualTipo === 'entrega' && !osAtual.numeroOS) {
              osAtual.numeroOS = registro.numeroOSAtribuido;
            }
          }
          registroHistoricoAtualId = registro.id;
          var html;
          if (documentoAtualTipo === 'compra') {
            if (!gerarHtmlCompra) throw new Error('Template original do PC não carregou.');
            html = aplicarAssinaturasNaCompra(gerarHtmlCompra(osAtual, obterConfigEmpresaAtual()), osAtual);
          } else if (documentoAtualTipo === 'venda') {
            if (!gerarHtmlVenda) throw new Error('Template original do PC não carregou.');
            html = aplicarAssinaturasNaVenda(gerarHtmlVenda(osAtual, obterConfigEmpresaAtual()), osAtual);
          } else if (documentoAtualTipo === 'entrega') {
            if (!gerarHtmlEntrega) throw new Error('Template original do PC não carregou.');
            html = aplicarAssinaturasNaEntrega(gerarHtmlEntrega(osAtual, obterConfigEmpresaAtual()), osAtual);
          } else {
            if (!gerarHtmlOS) throw new Error('Template original do PC não carregou.');
            html = aplicarAssinaturasNaOS(gerarHtmlOS(osAtual, obterConfigEmpresaAtual()), osAtual);
          }
          return definirConteudoDoFrame(html);
        });
      })
      .then(function () {
        var assinaturaPendente = assinaturaEstaPendente(osAtual, documentoAtualTipo);
        if (assinaturaPendente) {
          emEdicaoHistorico = true;
          idEmEdicaoHistorico = registroHistoricoAtualId;
          configurarPainelPreview(false);
          mostrarFeedback('Este documento já foi enviado sem assinatura. Assine e salve para atualizar o mesmo registro no PC.', false);
        } else {
          configurarPainelPreview(true); // modo histórico
        }
        mostrarTela('preview');
      })
      .catch(function (err) {
        listaHistorico.innerHTML = '';
        var erro = document.createElement('p');
        erro.className = 'historico-erro';
        erro.textContent = 'Não foi possível abrir este item: ' + (err && err.message ? err.message : String(err));
        listaHistorico.appendChild(erro);
      });
  }

  // ── Bloco 4: Editar item do histórico (UI) ──────────────────────
  // Reabre um item salvo PARA EDIÇÃO: popula o formulário com os dados
  // salvos (sem a assinatura — o campo de assinatura fica vazio no
  // formulário, mas a assinatura EM BASE64 dentro de registro.os é
  // preservada e reexportada junto). O técnico edita e clica "Gerar
  // prévia" → "Salvar" → usa editarRegistro() em vez de salvar().

  function editarItemHistorico(id) {
    window.SistemaOSHistorico.obterPorId(id)
      .then(function (registro) {
        if (!registro || !registro.os) {
          throw new Error('Item não encontrado no histórico.');
        }

        var dados = registro.os;
        var tipo = registro.tipoDocumento || 'os';

        if (tipo === 'entrega') {
          if (dados.assinaturaRetirouBase64 && !confirm('Ao editar, será necessário assinar o comprovante corrigido ou marcar Não assinado. Continuar?')) return;
          iniciarEntregaDaOS(dados, registro);
          return;
        }

        // Preenche o formulário correspondente ao tipo do documento.
        if (tipo === 'os') {
          setarValor('cliente-nome', dados.cliente && dados.cliente.nome);
          setarValor('cliente-cpf', dados.cliente && dados.cliente.cpf);
          setarValor('cliente-email', dados.cliente && dados.cliente.email);
          // Marca checkbox "não tem número" ANTES de setar valor do telefone
          var chkSemNumero = document.getElementById('cliente-sem-numero');
          var campoTelefone = document.getElementById('cliente-telefone');
          if (chkSemNumero && campoTelefone) {
            chkSemNumero.checked = dados.cliente && dados.cliente.semNumero;
            campoTelefone.disabled = chkSemNumero.checked;
            campoTelefone.placeholder = chkSemNumero.checked ? 'Não informado' : '(00) 00000-0000';
          }
          setarValor('cliente-telefone', chkSemNumero && chkSemNumero.checked ? '' : (dados.cliente && dados.cliente.telefone));
          setarValor('aparelho-tipo-equipamento', dados.aparelho && dados.aparelho.tipoEquipamento);
          setarValor('aparelho-marca', dados.aparelho && dados.aparelho.marca);
          setarValor('aparelho-modelo', dados.aparelho && dados.aparelho.modelo);
          setarValor('aparelho-cor', dados.aparelho && dados.aparelho.cor);
          setarValor('aparelho-imei', dados.aparelho && dados.aparelho.imei);
          setarValor('aparelho-defeito', dados.aparelho && dados.aparelho.defeitoRelatado);
          setarValor('aparelho-observacoes', dados.aparelho && dados.aparelho.observacoes);
          setarValor('aparelho-acessorios', dados.aparelho && dados.aparelho.acessorios);
          marcarCheckboxes('.os-acessorio-check', dados.aparelho && dados.aparelho.acessoriosChecklist);
          marcarCheckboxes('.os-teste-entrada', dados.aparelho && dados.aparelho.testesEntrada);
          setarValor('aparelho-senha', dados.aparelho && dados.aparelho.senhaAparelho);
          setarValor('os-observacoes', dados.observacoes);
          setarValor('os-prioridade', dados.prioridade);
          setarValor('os-status', dados.status || 'Aguardando análise');
          setarValor('os-valor', dados.diagnosticoTecnico?.valorEstimado ?? dados.valor ?? '');
          if (campoSemPrazoOS) campoSemPrazoOS.checked = dados.semPrazo === true || (!dados.dataPrevista && !dados.horaPrevista);
          setarValor('os-data-prevista', dados.dataPrevista);
          setarValor('os-hora-prevista', dados.horaPrevista);
          aplicarEstadoSemPrazoOS();
          setarValor('os-garantia-dias', dados.garantiaDias);
          definirTermosDocumento('os', dados.termos);
          if (campoAssinarDepois) campoAssinarDepois.checked = dados.assinaturaPendente === true;
          if (camposNaoAssinado.os) camposNaoAssinado.os.checked = dados.naoAssinado === true;
        } else if (tipo === 'compra') {
          setarValor('compra-vendedor-nome', dados.vendedor && dados.vendedor.nome);
          // Marca checkbox "não tem número" ANTES de setar valor do telefone
          var chkVendedorSemNumero = document.getElementById('compra-vendedor-sem-numero');
          var campoVendedorTelefone = document.getElementById('compra-vendedor-telefone');
          if (chkVendedorSemNumero && campoVendedorTelefone) {
            chkVendedorSemNumero.checked = dados.vendedor && dados.vendedor.semNumero;
            campoVendedorTelefone.disabled = chkVendedorSemNumero.checked;
            campoVendedorTelefone.placeholder = chkVendedorSemNumero.checked ? 'Não informado' : '(00) 00000-0000';
          }
          setarValor('compra-vendedor-telefone', chkVendedorSemNumero && chkVendedorSemNumero.checked ? '' : (dados.vendedor && dados.vendedor.telefone));
          setarValor('compra-vendedor-cpf', dados.vendedor && dados.vendedor.cpf);
          setarValor('compra-vendedor-rg', dados.vendedor && dados.vendedor.rg);
          setarValor('compra-vendedor-endereco', dados.vendedor && dados.vendedor.endereco);
          setarValor('compra-aparelho-tipo', dados.aparelho && dados.aparelho.tipo);
          setarValor('compra-aparelho-marca', dados.aparelho && dados.aparelho.marca);
          setarValor('compra-aparelho-modelo', dados.aparelho && dados.aparelho.modelo);
          setarValor('compra-aparelho-cor', dados.aparelho && dados.aparelho.cor);
          setarValor('compra-aparelho-capacidade', dados.aparelho && dados.aparelho.capacidade);
          setarValor('compra-aparelho-imei', dados.aparelho && dados.aparelho.imei1);
          setarValor('compra-aparelho-imei2', dados.aparelho && dados.aparelho.imei2);
          setarValor('compra-aparelho-estado', dados.aparelho && dados.aparelho.estadoConservacao);
          setarValor('compra-aparelho-acessorios', dados.aparelho && dados.aparelho.acessoriosTexto);
          setarValor('compra-aparelho-senha', dados.aparelho && dados.aparelho.senha);
          setarValor('compra-avaliacao-descricao', dados.avaliacao && dados.avaliacao.descricaoGeral);
          setarValor('compra-avaliacao-defeitos', dados.avaliacao && dados.avaliacao.defeitosEncontrados);
          setarValor('compra-avaliacao-observacoes', dados.avaliacao && dados.avaliacao.observacoes);
          setarValor('compra-valor', dados.dadosCompra && dados.dadosCompra.valor);
          setarValor('compra-forma-pagamento', dados.dadosCompra && dados.dadosCompra.formaPagamento);
          setarValor('compra-chave-pix', dados.dadosCompra && dados.dadosCompra.chavePix);
          setarValor('compra-observacoes', dados.dadosCompra && dados.dadosCompra.observacoes);
          definirTermosDocumento('compra', dados.termosCompra);
          if (window.SistemaOSFotos) window.SistemaOSFotos.definirFotos('compra', dados.fotos || []);
          if (camposAssinarDepois.compra) camposAssinarDepois.compra.checked = dados.assinaturaPendente === true;
          if (camposNaoAssinado.compra) camposNaoAssinado.compra.checked = dados.naoAssinado === true;
        } else if (tipo === 'venda') {
          estoqueVendaAtual = dados.estoqueLocalId ? { id: dados.estoqueLocalId } : null;
          setarValor('venda-tipo-equipamento', dados.tipoEquipamento);
          setarValor('venda-marca', dados.marca);
          setarValor('venda-modelo', dados.modelo);
          setarValor('venda-cor', dados.cor);
          setarValor('venda-imei', dados.imei);
          setarValor('venda-observacoes', dados.observacoes);
          setarValor('venda-garantia', normalizarGarantiaVenda(dados.garantia));
          setarValor('venda-comprador-nome', dados.compradorNome);
          // Marca checkbox "não tem número" ANTES de setar valor do telefone
          var chkCompradorSemNumero = document.getElementById('venda-comprador-sem-numero');
          var campoCompradorTelefone = document.getElementById('venda-comprador-telefone');
          if (chkCompradorSemNumero && campoCompradorTelefone) {
            chkCompradorSemNumero.checked = dados.compradorSemNumero;
            campoCompradorTelefone.disabled = chkCompradorSemNumero.checked;
            campoCompradorTelefone.placeholder = chkCompradorSemNumero.checked ? 'Não informado' : '(00) 00000-0000';
          }
          setarValor('venda-comprador-telefone', chkCompradorSemNumero && chkCompradorSemNumero.checked ? '' : dados.compradorTelefone);
          setarValor('venda-comprador-cpf', dados.compradorCpf);
          setarValor('venda-comprador-email', dados.compradorEmail);
          setarValor('venda-data', String(dados.dataVenda || '').slice(0, 10) || dataHojeInput());
          setarValor('venda-valor', dados.valorVenda);
          setarValor('venda-forma-pagamento', dados.formaPagamento);
          definirTermosDocumento('venda', dados.termosVenda);
          if (camposAssinarDepois.venda) camposAssinarDepois.venda.checked = dados.assinaturaPendente === true;
          if (camposNaoAssinado.venda) camposNaoAssinado.venda.checked = dados.naoAssinado === true;
        }

        // Configura o estado de edição: quando salvar, usa editarRegistro()
        // em vez de salvar() — preservando id e idExportacaoOriginal.
        emEdicaoHistorico = true;
        idEmEdicaoHistorico = registro.id;

        // Preserva a assinatura original para reexportação.
        documentoAtualTipo = tipo;
        osAtual = JSON.parse(JSON.stringify(dados));
        registroHistoricoAtualId = registro.id;

        // Navega para o formulário para edição.
        mostrarTela(tipo === 'compra' ? 'compra' : tipo === 'venda' ? 'venda' : 'form');
        mostrarFeedback('Editando item do histórico. Altere os campos e clique em "Gerar prévia" para visualizar.', false);
      })
      .catch(function (err) {
        mostrarFeedback('Não foi possível abrir para edição: ' + (err && err.message ? err.message : String(err)), true);
      });
  }

  function setarValor(id, valor) {
    var el = document.getElementById(id);
    if (el) el.value = (valor !== undefined && valor !== null) ? valor : '';
  }

  // ── Editar no celular depois de salvo ─────────────────────────────
  // Para OS, a alteração local é enviada pelo adaptador Supabase. Outros
  // tipos permanecem locais e podem ser exportados manualmente.
  //
  // `id` é o id do registro no histórico local (js/historico.js, store
  // 'historico'). `camposEditados` é o mesmo objeto parcial documentado em
  // SistemaOSHistorico.editarRegistro (mesclado um nível sobre registro.os
  // já salvo — ex.: { cliente: {...} } substitui o objeto cliente inteiro).
  //
  // Resolve sempre (nunca rejeita) com:
  //   { sucesso: true, enviado: true }   — editou local E reenviou ao PC
  //   { sucesso: true, enviado: false, motivo: '...' } — editou local, mas
  //       a sincronização não completou agora; a edição continua salva.
  //   { sucesso: false, erro: '...' }    — falha ao editar localmente
  //       (ex.: tipo 'entrega', ou id não encontrado) — nada foi enviado.
  function montarDadosParaEnvioPorTipo(tipoDocumento) {
    if (tipoDocumento === 'compra') return montarDadosCompraParaEnvio;
    if (tipoDocumento === 'venda') return montarDadosVendaParaEnvio;
    if (tipoDocumento === 'entrega') return montarDadosEntregaParaEnvio;
    return montarDadosOSParaEnvio;
  }

  function reenviarEdicaoHistorico(id, camposEditados) {
    return window.SistemaOSHistorico.editarRegistro(id, camposEditados)
      .then(function (registroEditado) {
        if (!registroEditado) return { sucesso: false, erro: 'Item não encontrado (pode ter sido removido).' };
        if (['os', 'compra', 'venda'].indexOf(registroEditado.tipoDocumento || 'os') === -1) {
          return { sucesso: true, enviado: false, motivo: 'tipo-nao-sincronizado' };
        }
        if (!window.CloudData || !window.CloudData.providerEscritas ||
            window.CloudData.providerEscritas() !== 'supabase' ||
            !window.CloudData.sincronizarRegistro) {
          return { sucesso: true, enviado: false, motivo: 'sem-sessao' };
        }
        return window.CloudData.sincronizarRegistro(registroEditado).then(function (resultado) {
          if (resultado && resultado.enviado) {
            return window.SistemaOSHistorico.marcarComoSincronizado([id])
              .then(function () { return { sucesso: true, enviado: true }; })
              .catch(function () { return { sucesso: true, enviado: true }; });
          }
          return {
            sucesso: true,
            enviado: false,
            motivo: (resultado && resultado.motivo) || (resultado && resultado.enfileirado ? 'offline' : 'erro')
          };
        });
      })
      .catch(function (err) {
        return { sucesso: false, erro: err && err.message ? err.message : String(err) };
      });
  }
  window.reenviarEdicaoHistorico = reenviarEdicaoHistorico;
})();
