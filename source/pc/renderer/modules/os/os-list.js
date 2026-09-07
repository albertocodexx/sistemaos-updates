// Listagem e filtros do histórico de Ordens de Serviço.
(function iniciarModuloListaOS() {
  'use strict';

  if (window.RendererOsList) return;

  const { porId: $ } = window.RendererDom;
  const { data: fmtData } = window.RendererFormatters;
  const {
    CARTAO: ICONE_CARTAO,
    OLHO: ICONE_OLHO,
    LAPIS: ICONE_LAPIS,
    DOCUMENTO: ICONE_DOCUMENTO,
    ETIQUETA: ICONE_ETIQUETA,
    LIXEIRA: ICONE_LIXEIRA
  } = window.RendererIcons;

  let iniciado = false;
  let debounceTimer;
  let subAbaHistorico = 'todas';
  const STATUS_TECNICOS_NOVOS = [
    'Aguardando análise',
    'Em diagnóstico',
    'Aguardando aprovação',
    'Aguardando peça',
    'Em reparo',
    'Em testes',
    'Pronto para retirada'
  ];

  function filtrarPorSubaba(ordens, subaba) {
    if (subaba === 'novas') {
      return ordens.filter(os => STATUS_TECNICOS_NOVOS.includes(os.status)
        && !['Pago', 'Autorizado', 'Pago 50%', 'Aguardando Pagamento', 'Aguardando Pagamento Presencial', 'Aguardando Pagamento na Retirada', 'Pagamento 50/50', 'Pagamento 50/50 remoto', 'Pagamento 50/50 presencial'].includes(os.statusPagamento));
    }
    if (subaba === 'aguardando') {
      return ordens.filter(os => ['Pago 50%', 'Aguardando Pagamento', 'Aguardando Pagamento Presencial', 'Aguardando Pagamento na Retirada', 'Pagamento 50/50', 'Pagamento 50/50 remoto', 'Pagamento 50/50 presencial'].includes(os.statusPagamento)
        && os.status !== 'Cancelado' && os.status !== 'Entregue');
    }
    if (subaba === 'pagas') {
      return ordens.filter(os => ['Pago', 'Autorizado'].includes(os.statusPagamento) && os.status !== 'Entregue' && os.status !== 'Cancelado');
    }
    if (subaba === 'finalizadas') return ordens.filter(os => os.status === 'Entregue');
    if (subaba === 'canceladas') return ordens.filter(os => os.status === 'Cancelado');
    return ordens;
  }

  function classeStatus(status) {
    return typeof window.statusClass === 'function' ? window.statusClass(status) : '';
  }

  function classePrioridade(prioridade) {
    return typeof window.prioridadeClass === 'function' ? window.prioridadeClass(prioridade) : '';
  }

  function escaparHtml(valor) {
    return typeof window._escHtml === 'function' ? window._escHtml(valor) : String(valor || '');
  }

  function statusPagamentoVisivel(os) {
    if (os.entrada50Paga === true || Number(os.percentualPagamentoConfirmado) === 50) {
      if (os.modalidadePagamentoAprovacao === 'online') return '50% remoto pago · 50% presencial pendente';
      if (os.modalidadePagamentoAprovacao === 'presencial') return '50% presencial pago · 50% remoto pendente';
      return '50% pago · 50% pendente';
    }
    if (['Pago', 'Autorizado'].includes(os.statusPagamento) || Number(os.percentualPagamentoConfirmado) === 100) return '100% pago';
    if (os.statusPagamento === 'Aguardando Pagamento Presencial') {
      return `Aguardando ${Number(os.percentualPagamentoAguardado) || 100}% presencial`;
    }
    if (os.statusPagamento === 'Pagamento 50/50') return '50% presencial + 50% remoto';
    if (os.statusPagamento === 'Pagamento 50/50 remoto') return '50% remoto + 50% remoto';
    if (os.statusPagamento === 'Pagamento 50/50 presencial') return '50% presencial + 50% presencial';
    return os.statusPagamento || '';
  }

  function valorTotalServico(os) {
    return Number(os?.valorTotalServico || 0)
      || Number(os?.diagnosticoTecnico?.valorEstimado || 0)
      || Number(os?.valorInvestido || 0)
      || Number(os?.valor || 0)
      || 0;
  }

  function valorCobrado(os) {
    const total = valorTotalServico(os);
    const confirmado = Number(os?.valorRecebidoConfirmado || 0) || 0;
    if (confirmado > 0) return total > 0 ? Math.min(total, confirmado) : confirmado;
    if (['Pago', 'Autorizado'].includes(os?.statusPagamento) || Number(os?.percentualPagamentoConfirmado) >= 100) return total;
    if (os?.entrada50Paga === true || Number(os?.percentualPagamentoConfirmado) === 50) return Number((total / 2).toFixed(2));
    return 0;
  }

  function fmtMoeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function aparelhoSemRepeticao(aparelho) {
    const marca = String(aparelho?.marca || '').trim();
    const modelo = String(aparelho?.modelo || '').trim();
    const normalizar = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const mn = normalizar(marca); const dn = normalizar(modelo);
    if (mn && dn && mn === dn) return marca;
    if (mn && dn && dn.startsWith(mn + ' ')) return modelo;
    return [marca, modelo].filter(Boolean).join(' ') || '—';
  }

  function badgeEstadoAssinatura(os) {
    if (os.assinaturaClienteBase64) {
      return '<span class="badge-forma-pagamento" style="color:#067647;border-color:#067647;">Assinado</span>';
    }
    if (os.assinaturaPendente === true) {
      return '<span class="badge-forma-pagamento" style="color:#b54708;border-color:#b54708;">Aguardando assinatura</span>';
    }
    return '<span class="badge-forma-pagamento" style="color:#b42318;border-color:#b42318;">Não assinado</span>';
  }

  function trocarSubabaHistorico(subaba) {
    subAbaHistorico = subaba;
    document.querySelectorAll('#historico-subabas .tab-historico-interna').forEach(botao => {
      botao.classList.toggle('ativa', botao.dataset.subaba === subaba);
    });
    carregarHistorico($('campoBusca')?.value || '');
  }

  async function carregarHistorico(termo = '') {
    const tbody = $('corpoTabelaOS');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" class="vazio">Carregando...</td></tr>';

    try {
      const ordensBrutas = termo ? await window.api.osbuscar(termo) : await window.api.oslistar();
      const ordens = filtrarPorSubaba(ordensBrutas, subAbaHistorico);
      if (!ordens.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="vazio">Nenhuma OS encontrada.</td></tr>';
        return;
      }

      tbody.innerHTML = ordens.map(os => {
        const aparelho = os.aparelho || {};
        const aparelhoTexto = aparelhoSemRepeticao(aparelho);
        const tipoIcone = window.ICONE_TIPO_EQUIPAMENTO?.[aparelho.tipoEquipamento] || '';
        const prioridade = os.prioridade || 'Normal';
        const previsaoTexto = os.dataPrevista
          ? fmtData(os.dataPrevista + 'T' + (os.horaPrevista || '00:00')) + (os.horaPrevista ? ' ' + os.horaPrevista : '')
          : 'Sem prazo';
        const statusTecnico = os.status || 'Aguardando análise';
        const statusAprovacao = os.statusAprovacao
          || (os.aceitouTermos === true ? 'Aprovado' : (os.aceitouTermos === false ? 'Desaprovado' : 'Pendente'));
        const statusPagamento = statusPagamentoVisivel(os);
        const formaPagamento = os.formaPagamento || '';
        const badgeForma = formaPagamento
          ? `<span class="badge-forma-pagamento">${ICONE_CARTAO} ${formaPagamento}</span>`
          : '';
        const badgeAssinatura = badgeEstadoAssinatura(os);
        const totalServico = valorTotalServico(os);
        const cobrado = valorCobrado(os);
        const pendente = Math.max(0, totalServico - cobrado);
        const resumoCobrado = totalServico > 0
          ? `<div class="os-valor-cobrado">${cobrado > 0 ? `Recebido: <strong>${fmtMoeda(cobrado)}</strong> · ` : ''}${pendente > 0 ? `A cobrar: <strong>${fmtMoeda(pendente)}</strong> · ` : ''}Total: ${fmtMoeda(totalServico)}</div>`
          : '<div class="os-valor-cobrado">Valor ainda não informado</div>';
        const statusHtml = statusPagamento
          ? `<div class="os-status-conjunto"><span class="${classeStatus(statusTecnico)}">Téc: ${statusTecnico}</span><span class="${classeStatus(statusAprovacao)}">OS: ${statusAprovacao}</span><span class="${classeStatus(statusPagamento)}">Pag: ${statusPagamento}</span>${badgeForma}${badgeAssinatura}</div>${resumoCobrado}`
          : `<div class="os-status-conjunto"><span class="${classeStatus(statusTecnico)}">Téc: ${statusTecnico}</span><span class="${classeStatus(statusAprovacao)}">OS: ${statusAprovacao}</span>${badgeForma}${badgeAssinatura}</div>${resumoCobrado}`;

        return `<tr class="${os.atrasada ? 'linha-atrasada' : ''}">
          <td><strong>${os.numero}</strong></td>
          <td>${fmtData(os.data)}</td>
          <td>${os.cliente?.nome || '—'}<small class="cliente-id-lista">#${os.cliente?.clienteId || '00000'}</small></td>
          <td>${os.cliente?.telefone || '—'}</td>
          <td>${tipoIcone} ${aparelhoTexto}</td>
          <td><span class="${classePrioridade(prioridade)}">${prioridade}</span></td>
          <td>${statusHtml}</td>
          <td>${previsaoTexto}${os.atrasada ? ' <span class="badge-atraso">Atrasada</span>' : ''}</td>
          <td style="white-space:nowrap;">
            <button class="botao botao-secundario" style="padding:5px 10px;font-size:12px;" onclick="verDetalheOS('${os.numero}')">${ICONE_OLHO} Ver</button>
            <button class="botao botao-secundario" style="padding:5px 10px;font-size:12px;" onclick="abrirEditarOS('${os.numero}')">${ICONE_LAPIS} Editar</button>
            ${os.pdfPath ? `<button class="botao botao-sucesso" style="padding:5px 10px;font-size:12px;" onclick="abrirPdf('${os.pdfPath.replace(/\\/g, '/')}')">${ICONE_DOCUMENTO} PDF</button>` : ''}
            <button class="botao botao-secundario" style="padding:5px 10px;font-size:12px;" onclick="emitirComprovanteOS('${os.numero}')">${ICONE_DOCUMENTO} ${['Pronto para retirada', 'Entregue'].includes(os.status) ? 'Térmico' : 'Comprovante'}</button>
            <button class="botao botao-fantasma" style="padding:5px 10px;font-size:12px;" title="Imprimir etiqueta com QR Code" onclick="abrirEtiqueta('${os.numero}')">${ICONE_ETIQUETA} Etiqueta QR</button>
            <button class="botao botao-perigo" style="padding:5px 10px;font-size:12px;" onclick="excluirOS('${os.numero}')">${ICONE_LIXEIRA}</button>
          </td>
        </tr>`;
      }).join('');
    } catch (erro) {
      tbody.innerHTML = '<tr><td colspan="9" class="vazio">Erro ao carregar: ' + escaparHtml(erro.message) + '</td></tr>';
    }
  }

  async function abrirPdf(caminho) {
    const resultado = await window.api.osabrirpdf(caminho);
    if (!resultado.sucesso && typeof window.toast === 'function') {
      window.toast('Erro ao abrir PDF: ' + resultado.erro, 'erro');
    }
  }

  function init() {
    if (iniciado) return;
    iniciado = true;
    const campoBusca = $('campoBusca');
    if (campoBusca) {
      campoBusca.addEventListener('input', evento => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => carregarHistorico(evento.target.value), 300);
      });
    }
  }

  window.RendererOsList = Object.freeze({ init, carregarHistorico, trocarSubabaHistorico, abrirPdf });
  window.carregarHistorico = carregarHistorico;
  window.trocarSubabaHistorico = trocarSubabaHistorico;
  window.abrirPdf = abrirPdf;
  init();
})();
