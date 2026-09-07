// js/estatisticas-tela.js
//
// Aba "Estatísticas" (8ª posição na nav). Duas sub-abas:
//
// 1) Status das OS: 4 cards (Atrasadas / Perto do prazo / Prontas /
//    Entregues) — toca num card, lista as OS daquele grupo abaixo.
// 2) Financeiro: total recebido, aguardando pagamento, receita por mês.
//
// Delegado a js/estatisticas.js (leitura do Supabase) e
// js/notificacoes.js (alertas locais). Este módulo decide quando buscar
// e como renderizar.

(function () {
  'use strict';

  var painel = document.getElementById('painel-estatisticas');
  if (!painel) return; // painel-estatisticas não existe nesta versão do HTML

  var avisoStatusSync = document.getElementById('estatisticas-status-sync');
  var atualizadoEm = document.getElementById('estatisticas-atualizado-em');
  var filtroSubAba = document.getElementById('filtro-estatisticas');
  var subAbaStatus = document.getElementById('estatisticas-sub-status');
  var subAbaFinanceiro = document.getElementById('estatisticas-sub-financeiro');
  var listaOS = document.getElementById('estatisticas-lista-os');
  var listaAtividadeRecente = document.getElementById('estatisticas-atividade-recente');
  var graficoReceita = document.getElementById('estatisticas-grafico-receita');

  var numAtrasadas = document.getElementById('est-num-atrasadas');
  var numPertoPrazo = document.getElementById('est-num-perto-prazo');
  var numProntas = document.getElementById('est-num-prontas');
  var numEntregues = document.getElementById('est-num-entregues');
  var totalPagoEl = document.getElementById('est-total-pago');
  var aguardandoPagamentoEl = document.getElementById('est-aguardando-pagamento');
  var totalVendasEl = document.getElementById('est-total-vendas');
  var qtdVendasEl = document.getElementById('est-qtd-vendas');

  var subAbaAtual = 'status';
  var grupoAtual = null;
  var classificadoAtual = null;
  var telaEstaAberta = false;

  function escaparHtml(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function rotuloOS(valor) {
    return window.SistemaOSNumero && window.SistemaOSNumero.formatar
      ? (window.SistemaOSNumero.formatar(valor) || 'OS')
      : String(valor || 'OS');
  }

  function formatarMoeda(valorEmCentavosOuReais) {
    var n = Number(valorEmCentavosOuReais) || 0;
    return 'R$ ' + n.toFixed(2).replace('.', ',');
  }

  function formatarDataHora(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('pt-BR'); } catch (e) { return ''; }
  }

  function alternarSubAba(nome) {
    subAbaAtual = nome;
    if (subAbaStatus) subAbaStatus.hidden = nome !== 'status';
    if (subAbaFinanceiro) subAbaFinanceiro.hidden = nome !== 'financeiro';
    if (filtroSubAba) {
      var botoes = filtroSubAba.querySelectorAll('[data-sub-aba]');
      for (var i = 0; i < botoes.length; i++) {
        botoes[i].classList.toggle('filtro-ativo', botoes[i].getAttribute('data-sub-aba') === nome);
      }
    }
  }

  if (filtroSubAba) {
    filtroSubAba.addEventListener('click', function (ev) {
      var botao = ev.target.closest('[data-sub-aba]');
      if (!botao) return;
      alternarSubAba(botao.getAttribute('data-sub-aba'));
    });
  }

  function marcarCardSelecionado(grupo) {
    var cards = painel.querySelectorAll('.card-estatistica[data-grupo]');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('card-estatistica-selecionada', cards[i].getAttribute('data-grupo') === grupo);
    }
  }

  function renderizarListaGrupo(grupo) {
    grupoAtual = grupo;
    marcarCardSelecionado(grupo);
    if (!listaOS) return;
    var itens = (classificadoAtual && classificadoAtual[grupo]) || [];
    if (!itens.length) {
      listaOS.innerHTML = '<p class="historico-vazio">Nenhuma OS neste grupo agora.</p>';
      return;
    }
    listaOS.innerHTML = itens.map(function (os) {
      var prazo = os.dataPrevista ? escaparHtml(os.dataPrevista.split('-').reverse().join('/')) + (os.horaPrevista ? ' ' + escaparHtml(os.horaPrevista) : '') : '—';
      return '<article class="item-historico">' +
        '<div class="item-historico-info">' +
        '<p class="item-historico-tipo">' + escaparHtml(rotuloOS(os.numero)) + '</p>' +
        '<p class="item-historico-cliente">' + escaparHtml(os.clienteNome || '(sem nome)') + '</p>' +
        '<p class="item-historico-aparelho">' + escaparHtml(os.aparelho || '—') + '</p>' +
        '<p class="item-historico-aparelho">Prazo: ' + prazo + '</p>' +
        '</div>' +
        '<div class="item-historico-acoes">' +
        '<button type="button" class="btn-excluir-os-estatistica" data-os-numero="' + escaparHtml(os.numero) + '" style="border:none;background:transparent;cursor:pointer;font-size:12px;opacity:0.6;padding:4px 8px;color:#e55;">Excluir</button>' +
        '</div>' +
        '</article>';
    }).join('');

    // As OS listadas em Estatísticas vêm do resumo remoto do Supabase,
    // não do histórico local do celular —
    // que só guarda documentos que o próprio celular criou/importou. Na
    // prática a maioria das OS aqui foi criada direto no PC e NUNCA
    // existiu no histórico local, então o código antigo (que buscava em
    // SistemaOSHistorico.listarTodos() antes de notificar o PC) não
    // encontrava o alvo e não fazia nada — sem toast de erro, sem
    // feedback: o botão "parecia" existir mas não funcionava. A correção
    // usa diretamente os dados já disponíveis no próprio item do resumo
    // (os.origemIdExportacao / os.numero) para notificar o PC, sem
    // depender do histórico local, e mostra feedback em todo caso
    // (sucesso, sem config, sem identificador ou erro).
    //
    // A exclusão só remove o item visual depois da confirmação do servidor.
    listaOS.querySelectorAll('.btn-excluir-os-estatistica').forEach(function (btn) {
      btn.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        var numero = btn.getAttribute('data-os-numero');
        if (!numero) return;
        if (!window.confirm('Excluir a ' + rotuloOS(numero) + '?')) return;
        try {
          if (window.SistemaOSExclusao && !await window.SistemaOSExclusao.autorizar('excluir a ' + rotuloOS(numero))) return;
        } catch (erroAutorizacao) {
          window.SistemaOSToast.mostrar(erroAutorizacao.message || String(erroAutorizacao), 'erro');
          return;
        }

        var alvo = itens.find(function (r) { return String(r.numero) === String(numero); });
        if (!window.CloudData || !window.CloudData.excluirOS) {
          window.SistemaOSToast.mostrar('Sincronização não configurada — não foi possível excluir.', 'erro');
          return;
        }

        var textoOriginal = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Excluindo…';

        window.CloudData.excluirOS(alvo || { numero: numero }, alvo && alvo.revision).then(function (resultado) {
          if (!resultado || (resultado.enviado !== true && resultado.enfileirado !== true)) {
            var motivo = (resultado && resultado.motivo) || 'desconhecido';
            var mensagem = motivo === 'nao-encontrada'
                ? 'O PC não encontrou a ' + rotuloOS(numero) + ' (pode já ter sido excluída).'
                : 'Não foi possível excluir a ' + rotuloOS(numero) + ' (' + motivo + ').';
            window.SistemaOSToast.mostrar(mensagem, 'erro');
            btn.disabled = false;
            btn.textContent = textoOriginal;
            return;
          }
          // Remove da lista visual — agora só depois de confirmação real do PC.
          var article = btn.closest('.item-historico');
          if (article) article.remove();
          // Atualiza contagem do card
          if (itens.length <= 1) {
            renderizarListaGrupo(grupo);
          }
          window.SistemaOSToast.mostrar(
            resultado.enfileirado ? 'Exclusão salva. Ela será enviada ao reconectar.' : rotuloOS(numero) + ' excluída.',
            resultado.enfileirado ? 'aviso' : 'sucesso'
          );
        }).catch(function () {
          window.SistemaOSToast.mostrar('Erro ao excluir a ' + rotuloOS(numero) + '.', 'erro');
          btn.disabled = false;
          btn.textContent = textoOriginal;
        });
      });
    });
  }

  var ROTULO_TIPO_DOCUMENTO = { os: 'OS', compra: 'Compra', venda: 'Venda' };

  // Renderiza a atividade recente. Deliberadamente só leitura — sem botão
  // de editar/excluir aqui: o PC é a única fonte de verdade dessas 3
  // coleções, o celular só avisa "isto mudou", e a aba Consulta (busca
  // por número) é o canal pra ver/agir sobre o conteúdo completo.
  function renderizarAtividadeRecente(resumo) {
    if (!listaAtividadeRecente) return;
    var itens = (resumo && Array.isArray(resumo.atividadeRecente)) ? resumo.atividadeRecente : [];
    if (!itens.length) {
      listaAtividadeRecente.innerHTML = '<p class="historico-vazio">Nenhuma atividade recente.</p>';
      return;
    }
    listaAtividadeRecente.innerHTML = itens.map(function (item) {
      var rotuloTipo = ROTULO_TIPO_DOCUMENTO[item.tipoDocumento] || item.tipoDocumento || '';
      var subtitulo = item.clienteNome || item.vendedorNome || '';
      return '<article class="item-historico">' +
        '<div class="item-historico-info">' +
        '<p class="item-historico-tipo">' + escaparHtml(rotuloTipo) + ' nº ' + escaparHtml(item.numero) + (item.status ? ' — ' + escaparHtml(item.status) : '') + '</p>' +
        (subtitulo ? '<p class="item-historico-cliente">' + escaparHtml(subtitulo) + '</p>' : '') +
        (item.aparelho ? '<p class="item-historico-aparelho">' + escaparHtml(item.aparelho) + '</p>' : '') +
        (item.tipoDocumento === 'venda' ? '<p class="item-historico-aparelho">Valor: <strong>' + escaparHtml(formatarMoeda(item.valor)) + '</strong></p>' : '') +
        '<p class="item-historico-aparelho">' + escaparHtml(formatarDataHora(item.atualizadoEm)) + '</p>' +
        '</div>' +
        '</article>';
    }).join('');
  }

  function renderizarCards(resumo) {
    classificadoAtual = window.Estatisticas ? window.Estatisticas.classificarOrdens(resumo) : null;
    var contagem = resumo && resumo.statusOS ? resumo.statusOS : {};
    if (numAtrasadas) numAtrasadas.textContent = String((classificadoAtual && classificadoAtual.atrasadas.length) || 0);
    if (numPertoPrazo) numPertoPrazo.textContent = String((classificadoAtual && classificadoAtual.pertoDoPrazo.length) || 0);
    if (numProntas) numProntas.textContent = String(contagem.prontas || 0);
    if (numEntregues) numEntregues.textContent = String(contagem.entregues || 0);
    renderizarListaGrupo(grupoAtual || 'atrasadas');
  }

  function renderizarFinanceiro(resumo) {
    var fin = (resumo && resumo.financeiro) || {};
    if (totalPagoEl) totalPagoEl.textContent = formatarMoeda(fin.totalPago);
    if (aguardandoPagamentoEl) aguardandoPagamentoEl.textContent = String(fin.aguardandoPagamento || 0);
    if (totalVendasEl) totalVendasEl.textContent = formatarMoeda(fin.totalVendas);
    if (qtdVendasEl) qtdVendasEl.textContent = String(fin.quantidadeVendas || 0) + ' venda(s) concluída(s)';

    var meses = fin.receitaMeses || {};
    var chaves = Object.keys(meses).sort();
    if (!graficoReceita) return;
    if (!chaves.length) {
      graficoReceita.innerHTML = '<p class="historico-vazio">Sem dados de receita ainda.</p>';
      return;
    }
    var maxVal = Math.max.apply(null, chaves.map(function (k) { return meses[k] || 0; }).concat([1]));
    graficoReceita.innerHTML = chaves.map(function (k) {
      var valor = meses[k] || 0;
      var altura = Math.max(4, Math.round((valor / maxVal) * 100));
      return '<div class="barra-receita-mes" title="' + escaparHtml(k) + ': ' + escaparHtml(formatarMoeda(valor)) + '">' +
        '<div class="barra-receita-mes-preenchimento" style="height:' + altura + '%"></div>' +
        '<span class="barra-receita-mes-rotulo">' + escaparHtml(k.slice(5)) + '</span>' +
        '</div>';
    }).join('');
  }

  function renderizarTudo(resumo) {
    renderizarCards(resumo);
    renderizarFinanceiro(resumo);
    renderizarAtividadeRecente(resumo);
    if (atualizadoEm) {
      var texto = formatarDataHora(resumo && resumo.geradoEm);
      atualizadoEm.textContent = texto ? 'Atualizado em ' + texto : '';
      atualizadoEm.hidden = !texto;
    }
    // Alerta local (Capacitor) para atrasadas/perto do prazo — só
    // dispara se a tela estiver de fato aberta (evita notificar toda
    // vez que o listener em segundo plano recebe uma atualização do
    // PC sem o técnico ter aberto a aba).
    if (telaEstaAberta && window.Notificacoes && window.Notificacoes.disponivel()) {
      window.Notificacoes.checarPendentesEAlertar(classificadoAtual);
    }
  }

  var containerCards = painel.querySelector('.cards-estatisticas');
  if (containerCards) {
    containerCards.addEventListener('click', function (ev) {
      var card = ev.target.closest('[data-grupo]');
      if (!card) return;
      renderizarListaGrupo(card.getAttribute('data-grupo'));
    });
  }

  function iniciar() {
    telaEstaAberta = true;
    var ativo = !!(window.CloudData && window.CloudData.providerConsultas &&
      window.CloudData.providerConsultas() === 'supabase');
    if (avisoStatusSync) avisoStatusSync.hidden = ativo;
    if (!ativo || !window.Estatisticas) return;

    var conhecido = window.Estatisticas.obterUltimoResumoConhecido();
    if (conhecido) renderizarTudo(conhecido);
    else window.Estatisticas.buscarResumoUmaVez().then(function (resumo) {
      if (resumo) renderizarTudo(resumo);
    });

    window.Estatisticas.escutarResumo(renderizarTudo);
    if (window.Notificacoes) window.Notificacoes.solicitarPermissao();
  }

  function parar() {
    telaEstaAberta = false;
    if (window.Estatisticas) window.Estatisticas.pararEscutaResumo();
  }

  document.addEventListener('sistema-os:tela-estatisticas-aberta', iniciar);
  document.addEventListener('sistema-os:tela-estatisticas-fechada', parar);
})();
