(function (root) {
  'use strict';

  var estado = null;
  var modal = null;
  var frame = null;
  var campoRecebedor = null;
  var formatoAtual = '80mm';

  function criarModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'modal-comprovante-os';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="modal-comprovante-os-caixa">' +
        '<header><div><span>ORDEM DE SERVIÇO</span><h2>Emitir comprovante</h2></div>' +
        '<button type="button" data-acao="fechar" aria-label="Fechar">Fechar</button></header>' +
        '<p class="comprovante-ajuda">Escolha a largura da impressora. O Android abrirá a lista de impressoras instaladas e também permite salvar em PDF.</p>' +
        '<label class="comprovante-recebedor" hidden><span>Quem recebeu / retirou o aparelho *</span>' +
          '<input type="text" autocomplete="name" placeholder="Nome completo de quem recebeu" />' +
          '<small>Este nome aparecerá nas duas vias do comprovante.</small>' +
        '</label>' +
        '<div class="comprovante-formatos">' +
          '<button type="button" data-formato="58mm">58 mm</button>' +
          '<button type="button" data-formato="80mm" class="ativo">80 mm</button>' +
          '<button type="button" data-formato="a4">A4</button>' +
        '</div>' +
        '<div class="comprovante-frame"><iframe title="Prévia do comprovante"></iframe></div>' +
        '<footer>' +
          '<button type="button" data-acao="fechar" class="btn-secundario">Voltar</button>' +
          '<button type="button" data-acao="compartilhar" class="btn-secundario">Compartilhar PDF</button>' +
          '<button type="button" data-acao="imprimir" class="btn-primario">Imprimir / salvar PDF</button>' +
        '</footer>' +
      '</div>';
    document.body.appendChild(modal);
    frame = modal.querySelector('iframe');
    campoRecebedor = modal.querySelector('.comprovante-recebedor input');
    campoRecebedor.addEventListener('input', function () {
      if (!estado || !estado.dados) return;
      estado.dados.nomeRetirou = campoRecebedor.value;
      estado.dados.recebidoPor = campoRecebedor.value;
      estado.dados.entrega = Object.assign({}, estado.dados.entrega || {}, {
        nomeRetirou: campoRecebedor.value,
        recebidoPor: campoRecebedor.value
      });
      renderizar();
    });

    modal.addEventListener('click', function (evento) {
      var botao = evento.target.closest('button');
      if (!botao) return;
      if (botao.dataset.acao === 'fechar') {
        modal.hidden = true;
        return;
      }
      if (botao.dataset.formato) {
        formatoAtual = botao.dataset.formato;
        modal.querySelectorAll('[data-formato]').forEach(function (item) {
          item.classList.toggle('ativo', item.dataset.formato === formatoAtual);
        });
        renderizar();
        return;
      }
      if (botao.dataset.acao === 'imprimir') imprimir();
      if (botao.dataset.acao === 'compartilhar') compartilhar(botao);
    });
  }

  function htmlAtual() {
    if (!estado || typeof estado.gerarHtml !== 'function') return '';
    return estado.gerarHtml(estado.dados, estado.config, { formato: formatoAtual });
  }

  function ehEntrega() {
    var dados = estado && estado.dados ? estado.dados : {};
    var status = String(dados.status || '').toLowerCase();
    return String(dados.tipoComprovante || '').toLowerCase() === 'entrega' ||
      /pronto.*retir/.test(status) || status.indexOf('entreg') !== -1 || status.indexOf('finaliz') !== -1;
  }

  function htmlDuasVias(html) {
    if (!ehEntrega()) return html;
    var encontrou = String(html || '').match(/<main class="folha">[\s\S]*?<\/main>/i);
    if (!encontrou) return html;
    var folha = encontrou[0];
    var viaAssistencia = folha.replace(
      '<main class="folha">',
      '<main class="folha folha-via"><div class="rotulo-via">VIA DA ASSISTÊNCIA</div>'
    );
    var viaCliente = folha.replace(
      '<main class="folha">',
      '<main class="folha folha-via"><div class="rotulo-via">VIA DO CLIENTE</div>'
    );
    var estilo =
      '.rotulo-via{text-align:center;font-size:.82em;font-weight:900;letter-spacing:.08em;' +
      'border:1px solid #111;padding:3px;margin-bottom:6px}' +
      '@media print{.folha-via{break-after:page;page-break-after:always}.folha-via:last-child{break-after:auto;page-break-after:auto}}';
    return String(html)
      .replace('</style>', estilo + '</style>')
      .replace(encontrou[0], viaAssistencia + viaCliente);
  }

  function renderizar() {
    var html = htmlAtual();
    if (!html || !frame) return;
    frame.srcdoc = html;
  }

  async function imprimir() {
    if (ehEntrega()) {
      var nomeRecebedor = String(campoRecebedor && campoRecebedor.value || '').trim();
      if (!nomeRecebedor) {
        if (root.SistemaOSToast) root.SistemaOSToast.mostrar('Informe quem recebeu o aparelho.', 'aviso');
        if (campoRecebedor) campoRecebedor.focus();
        return;
      }
      estado.dados.nomeRetirou = nomeRecebedor;
      estado.dados.recebidoPor = nomeRecebedor;
      estado.dados.entrega = Object.assign({}, estado.dados.entrega || {}, {
        nomeRetirou: nomeRecebedor,
        recebidoPor: nomeRecebedor
      });
      if (root.CloudData && typeof root.CloudData.atualizarRecebedorOS === 'function') {
        try { await root.CloudData.atualizarRecebedorOS(estado.dados, nomeRecebedor); }
        catch (_) { /* a impressão continua; a próxima sincronização tentará novamente */ }
      }
    }
    var html = htmlDuasVias(htmlAtual());
    if (!html) return;
    var numero = estado && estado.dados && estado.dados.numero
      ? estado.dados.numero
      : 'OS';
    try {
      var plugin = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Impressao;
      if (plugin && typeof plugin.imprimir === 'function') {
        await plugin.imprimir({
          html: html,
          titulo: (ehEntrega() ? 'Entrega em 2 vias ' : 'Comprovante ') + numero + ' - ' + formatoAtual
        });
      } else if (frame && frame.contentWindow) {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } else {
        throw new Error('Serviço de impressão indisponível.');
      }
    } catch (erro) {
      var mensagem = erro && erro.message ? erro.message : String(erro);
      if (root.SistemaOSToast && typeof root.SistemaOSToast.mostrar === 'function') {
        root.SistemaOSToast.mostrar('Não foi possível imprimir: ' + mensagem, 'erro');
      } else {
        window.alert('Não foi possível imprimir: ' + mensagem);
      }
    }
  }

  async function compartilhar(botao) {
    var dados = estado && estado.dados ? estado.dados : {};
    var numero = String(dados.numeroOSAtribuido || dados.numeroOS || dados.numero || 'OS').trim();
    var cliente = ehEntrega()
      ? String(dados.nomeRetirou || dados.recebidoPor || dados.entrega?.nomeRetirou || '').trim()
      : String(dados.cliente?.nome || '').trim();
    var empresa = estado && estado.config ? estado.config : {};
    var nomeEmpresa = String(empresa.nomeFantasia || empresa.nomeEmpresa || empresa.razaoSocial || 'assistência técnica').trim();
    var saudacao = cliente ? 'Olá, ' + cliente + '. ' : 'Olá! ';
    var descricao = ehEntrega()
      ? 'Segue o comprovante de entrega da ' + numero
      : 'Segue a Ordem de Serviço ' + numero;
    var html = estado && typeof estado.gerarHtml === 'function'
      ? estado.gerarHtml(dados, estado.config, { formato: 'a4' })
      : '';
    if (!html) return;
    botao.disabled = true;
    botao.textContent = 'Preparando PDF…';
    try {
      var resultado = await root.SistemaOSCompartilhar.compartilharPdfHtml(
        html,
        (ehEntrega() ? 'entrega-' : 'ordem-de-servico-') + numero + '.pdf',
        ehEntrega() ? 'Compartilhar comprovante de entrega' : 'Compartilhar Ordem de Serviço',
        saudacao + descricao + ', ' + (ehEntrega() ? 'emitido' : 'emitida') + ' pela ' + nomeEmpresa + '.'
      );
      root.SistemaOSToast?.mostrar(root.SistemaOSCompartilhar.mensagemResultado(resultado), 'sucesso');
    } catch (erro) {
      root.SistemaOSToast?.mostrar('Não foi possível compartilhar: ' + (erro.message || erro), 'erro');
    } finally {
      botao.disabled = false;
      botao.textContent = 'Compartilhar PDF';
    }
  }

  function obterNumeroOficial(dados) {
    var candidatos = dados ? [dados.numeroOSAtribuido, dados.numeroOS, dados.numero] : [];
    for (var i = 0; i < candidatos.length; i += 1) {
      var numero = String(candidatos[i] || '').trim();
      if (numero && !/PR[ÉE]VIA|SEM N[ÚU]MERO/i.test(numero)) return numero;
    }
    return '';
  }

  async function enriquecerDados(dados) {
    var numero = obterNumeroOficial(dados);
    var consulta = root.SistemaOSSupabaseOS &&
      root.SistemaOSSupabaseOS.consultarCompletaPorNumero;
    if (!numero || typeof consulta !== 'function' || /PR[ÉE]VIA|SEM N[ÚU]MERO/i.test(numero)) {
      return dados;
    }
    try {
      var remoto = await consulta(numero);
      if (!remoto) return dados;
      return Object.assign({}, dados, remoto, {
        cliente: Object.assign({}, dados.cliente || {}, remoto.cliente || {}),
        aparelho: Object.assign({}, dados.aparelho || {}, remoto.aparelho || {}),
        diagnosticoTecnico: Object.assign(
          {},
          dados.diagnosticoTecnico || {},
          remoto.diagnosticoTecnico || {}
        ),
        assinaturaClienteBase64: dados.assinaturaClienteBase64 || '',
        assinaturaAssistenciaBase64: dados.assinaturaAssistenciaBase64 || ''
      });
    } catch (_) {
      return dados;
    }
  }

  async function abrir(opcoes) {
    criarModal();
    var dados = opcoes && opcoes.dados;
    var numeroOficial = obterNumeroOficial(dados);
    if (!numeroOficial) {
      var aviso = 'O comprovante será emitido assim que a OS receber o número oficial na sincronização.';
      if (root.SistemaOSToast && typeof root.SistemaOSToast.mostrar === 'function') {
        root.SistemaOSToast.mostrar(aviso, 'aviso');
      } else {
        window.alert(aviso);
      }
      return;
    }
    dados = Object.assign({}, dados, {
      numero: numeroOficial,
      numeroOSAtribuido: dados.numeroOSAtribuido || numeroOficial
    });
    estado = Object.assign({}, opcoes, { dados: await enriquecerDados(dados) });
    formatoAtual = '80mm';
    modal.querySelectorAll('[data-formato]').forEach(function (item) {
      item.classList.toggle('ativo', item.dataset.formato === formatoAtual);
    });
    renderizar();
    var titulo = modal.querySelector('header h2');
    if (titulo) titulo.textContent = ehEntrega() ? 'Comprovante térmico de retirada — 2 vias' : 'Emitir comprovante';
    var grupoRecebedor = modal.querySelector('.comprovante-recebedor');
    if (grupoRecebedor) grupoRecebedor.hidden = !ehEntrega();
    if (campoRecebedor) {
      campoRecebedor.value = estado.dados.nomeRetirou || estado.dados.recebidoPor ||
        (estado.dados.entrega && estado.dados.entrega.nomeRetirou) ||
        (estado.dados.cliente && estado.dados.cliente.nome) || '';
      if (ehEntrega()) {
        estado.dados.nomeRetirou = campoRecebedor.value;
        estado.dados.recebidoPor = campoRecebedor.value;
        estado.dados.entrega = Object.assign({}, estado.dados.entrega || {}, {
          nomeRetirou: campoRecebedor.value,
          recebidoPor: campoRecebedor.value
        });
        renderizar();
      }
    }
    modal.hidden = false;
  }

  root.SistemaOSComprovante = Object.freeze({ abrir: abrir });
})(typeof globalThis !== 'undefined' ? globalThis : window);
