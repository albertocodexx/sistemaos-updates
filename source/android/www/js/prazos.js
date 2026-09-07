// Aba Reparos: consulta leve no Supabase, alertas de prazo e alteração de status.
// O desktop recebe a alteração pelo ciclo de sincronização do próprio banco.
(function () {
  'use strict';

  var painel = document.getElementById('painel-prazos');
  if (!painel) return;
  var aviso = document.getElementById('prazos-status-sync');
  var atualizadoEm = document.getElementById('prazos-atualizado-em');
  var lista = document.getElementById('prazos-lista');
  var btnAtualizar = document.getElementById('btn-prazos-sincronizar');
  var itensAtuais = [];
  var pararRealtime = null;
  var timerAtualizacao = null;
  var atualizacaoEmAndamento = null;

  var STATUS = [
    'Aguardando análise', 'Em diagnóstico', 'Aguardando aprovação',
    'Aguardando peça', 'Em reparo', 'Em testes',
    'Pronto para retirada', 'Entregue', 'Cancelado'
  ];

  function escaparHtml(valor) {
    return String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function rotuloOS(valor) {
    return window.SistemaOSNumero && window.SistemaOSNumero.formatar
      ? (window.SistemaOSNumero.formatar(valor) || 'OS')
      : String(valor || 'OS');
  }

  function formatarData(valor) {
    if (!valor) return 'Sem prazo definido';
    var partes = String(valor).slice(0, 10).split('-');
    return partes.length === 3 ? partes.reverse().join('/') : String(valor);
  }

  function chavePrazo(os) {
    return os && os.dataPrevista ? String(os.dataPrevista) + 'T' + String(os.horaPrevista || '23:59') : '9999-12-31T23:59';
  }

  function situacaoPrazo(os) {
    if (!os.dataPrevista) return { classe: 'sem-prazo', rotulo: 'Sem prazo' };
    if (['Entregue', 'Cancelado'].indexOf(os.status) !== -1) return { classe: 'concluido', rotulo: os.status };
    var limite = new Date(String(os.dataPrevista) + 'T' + String(os.horaPrevista || '23:59') + ':00').getTime();
    var restante = limite - Date.now();
    if (!Number.isFinite(limite)) return { classe: 'sem-prazo', rotulo: 'Prazo inválido' };
    if (restante < 0) return { classe: 'atrasado', rotulo: 'Atrasado' };
    if (restante <= 24 * 60 * 60 * 1000) return { classe: 'perto', rotulo: 'Vence em até 24h' };
    if (restante <= 3 * 24 * 60 * 60 * 1000) return { classe: 'atencao', rotulo: 'Prazo próximo' };
    return { classe: 'normal', rotulo: 'No prazo' };
  }

  function setMensagemVazia(texto) {
    if (lista) lista.innerHTML = '<p class="historico-vazio">' + escaparHtml(texto) + '</p>';
  }

  function normalizar(os) {
    var aparelho = os.aparelho || {};
    var situacao = situacaoPrazo(os);
    return {
      id: os.id,
      revision: os.revision,
      numero: os.numero,
      clienteNome: os.cliente && os.cliente.nome,
      aparelho: aparelho.nome || [aparelho.marca, aparelho.modelo].filter(Boolean).join(' '),
      defeito: aparelho.defeitoRelatado || os.defeitoRelatado || 'Não informado',
      status: os.status,
      dataPrevista: os.dataPrevista,
      horaPrevista: os.horaPrevista,
      atrasada: situacao.classe === 'atrasado',
      situacaoPrazo: situacao
    };
  }

  function renderizar(ordens) {
    if (!lista) return;
    itensAtuais = (ordens || []).map(normalizar).sort(function (a, b) { return chavePrazo(a).localeCompare(chavePrazo(b)); });
    if (!itensAtuais.length) return setMensagemVazia('Nenhum reparo em acompanhamento no momento.');
    lista.innerHTML = itensAtuais.map(function (os) {
      var prazo = formatarData(os.dataPrevista) + (os.horaPrevista ? ' às ' + os.horaPrevista : '');
      var situacao = os.situacaoPrazo || { classe: 'sem-prazo', rotulo: 'Sem prazo' };
      var opcoes = STATUS.map(function (status) {
        return '<option' + (status === os.status ? ' selected' : '') + '>' + escaparHtml(status) + '</option>';
      }).join('');
      return '<article class="item-historico" data-os-id="' + escaparHtml(os.id) + '">' +
        '<div class="item-historico-info"><p class="item-historico-tipo">' + escaparHtml(rotuloOS(os.numero)) + '</p>' +
        '<p class="item-historico-cliente">' + escaparHtml(os.clienteNome || '(sem cliente)') + '</p>' +
        '<div class="reparo-dados"><p><strong>Aparelho:</strong> ' + escaparHtml(os.aparelho || '—') + '</p>' +
        '<p><strong>Defeito:</strong> ' + escaparHtml(os.defeito) + '</p>' +
        '<p><strong>Reparo:</strong> ' + escaparHtml(os.status || 'Sem status') + '</p>' +
        '<p><strong>Prazo:</strong> ' + escaparHtml(prazo) + ' <span class="reparo-prazo-selo reparo-prazo-' + escaparHtml(situacao.classe) + '">' + escaparHtml(situacao.rotulo) + '</span></p></div>' +
        '<div class="prazo-status-linha"><select class="prazo-status" aria-label="Status da ' + escaparHtml(rotuloOS(os.numero)) + '">' + opcoes +
        '</select><button type="button" class="btn-secundario btn-salvar-prazo">Salvar</button>' +
        '<button type="button" class="btn-secundario btn-comprovante-prazo">' +
        (/pronto.*retir|entreg|finaliz|conclu/i.test(String(os.status || '')) ? 'Comprovante térmico / imprimir' : 'Emitir comprovante') +
        '</button></div></div></article>';
    }).join('');
    instalarAcoes();
    if (window.Notificacoes && window.Notificacoes.agendarAvisosReparos) {
      window.Notificacoes.agendarAvisosReparos(itensAtuais);
    }
  }

  function instalarAcoes() {
    lista.querySelectorAll('.btn-comprovante-prazo').forEach(function (botao) {
      botao.addEventListener('click', async function () {
        var card = botao.closest('[data-os-id]');
        var os = itensAtuais.find(function (item) { return item.id === (card && card.getAttribute('data-os-id')); });
        if (!os || !window.SistemaOSSupabaseOS) return;
        try {
          var completa = await window.SistemaOSSupabaseOS.consultarCompletaPorNumero(os.numero);
          if (!window.SistemaOSComprovante) throw new Error('Emissor de comprovante indisponível.');
          var config = window.ConfigApp && window.ConfigApp.carregarConfig ? window.ConfigApp.carregarConfig() : {};
          var ehComprovanteTermicoRetirada = /pronto.*retir|entreg|finaliz|conclu/i.test(String(os.status || ''));
          await window.SistemaOSComprovante.abrir({
            dados: ehComprovanteTermicoRetirada
              ? Object.assign({}, completa || os, { tipoComprovante: 'entrega' })
              : (completa || os),
            config: config,
            gerarHtml: window.SistemaOSGerarHtmlComprovante
          });
        } catch (erro) {
          if (window.SistemaOSToast) window.SistemaOSToast.mostrar('Não foi possível emitir o comprovante.', 'erro');
        }
      });
    });
    lista.querySelectorAll('.btn-salvar-prazo').forEach(function (botao) {
      botao.addEventListener('click', function () {
        var card = botao.closest('[data-os-id]');
        var os = itensAtuais.find(function (item) { return item.id === (card && card.getAttribute('data-os-id')); });
        var select = card && card.querySelector('.prazo-status');
        if (!os || !select || !window.CloudData) return;
        var statusAnterior = os.status;
        var novoStatus = select.value;
        var textoOriginal = botao.textContent;
        botao.disabled = true; select.disabled = true; botao.textContent = 'Salvando…';
        window.CloudData.atualizarOS(os, os.revision, { status: novoStatus }).then(async function (resposta) {
          if (resposta && (resposta.enviado || resposta.enfileirado)) {
            if (window.SistemaOSToast) window.SistemaOSToast.mostrar(
              resposta.enfileirado ? 'Sem internet: alteração salva na fila.' : 'Status atualizado.',
              resposta.enfileirado ? 'aviso' : 'sucesso'
            );
            if (statusAnterior !== 'Entregue' && novoStatus === 'Entregue') {
              var emitir = window.confirm(
                'A ' + rotuloOS(os.numero) + ' foi marcada como entregue.\n\n' +
                'Deseja preencher, assinar e emitir agora o comprovante de entrega?'
              );
              if (emitir && window.SistemaOSEntrega) {
                var completa = window.SistemaOSSupabaseOS &&
                  typeof window.SistemaOSSupabaseOS.consultarCompletaPorNumero === 'function'
                  ? await window.SistemaOSSupabaseOS.consultarCompletaPorNumero(os.numero).catch(function () { return null; })
                  : null;
                window.SistemaOSEntrega.iniciarPorOS(completa || os);
              } else if (!emitir && window.SistemaOSToast) {
                window.SistemaOSToast.mostrar(
                  'O comprovante continuará disponível neste reparo e na Consulta.',
                  'aviso'
                );
              }
            }
            return atualizarAgora();
          }
          throw new Error((resposta && resposta.motivo) || 'Não foi possível atualizar o status.');
        }).catch(function (erro) {
          if (window.SistemaOSToast) window.SistemaOSToast.mostrar(erro.message || 'Não foi possível atualizar o status.', 'erro');
          botao.disabled = false; select.disabled = false; botao.textContent = textoOriginal;
        });
      });
    });
  }

  function atualizarAgora(silencioso) {
    if (!window.SistemaOSSupabaseOS || !window.SistemaOSSupabaseOS.listarLeves) return Promise.resolve();
    // Um clique manual, o timer e o Realtime podem chegar juntos. Reutiliza a
    // mesma leitura em vez de mandar três consultas idênticas ao servidor.
    if (atualizacaoEmAndamento) return atualizacaoEmAndamento;
    if (btnAtualizar && !silencioso) { btnAtualizar.disabled = true; btnAtualizar.textContent = 'Atualizando…'; }
    atualizacaoEmAndamento = window.SistemaOSSupabaseOS.listarLeves(300).then(function (ordens) {
      renderizar(ordens);
      if (atualizadoEm) { atualizadoEm.textContent = 'Atualizado em ' + new Date().toLocaleString('pt-BR'); atualizadoEm.hidden = false; }
    }).catch(function () {
      setMensagemVazia('Não foi possível obter os reparos agora. Verifique a internet.');
    }).finally(function () {
      if (btnAtualizar && !silencioso) { btnAtualizar.disabled = false; btnAtualizar.textContent = 'Atualizar agora'; }
      atualizacaoEmAndamento = null;
    });
    return atualizacaoEmAndamento;
  }

  function pararEscuta() {
    if (pararRealtime) pararRealtime();
    pararRealtime = null;
    if (timerAtualizacao) window.clearInterval(timerAtualizacao);
    timerAtualizacao = null;
  }

  function iniciarEscuta() {
    pararEscuta();
    if (window.SistemaOSSupabaseOS && window.SistemaOSSupabaseOS.assinar) {
      pararRealtime = window.SistemaOSSupabaseOS.assinar(function () { atualizarAgora(true); });
    }
    // Fallback resiliente caso o Realtime esteja temporariamente indisponivel.
    timerAtualizacao = window.setInterval(function () { atualizarAgora(true); }, 30000);
  }

  function iniciar() {
    if (aviso) aviso.hidden = true;
    if (window.Notificacoes) {
      window.Notificacoes.solicitarPermissao().finally(function () {
        atualizarAgora(false);
        iniciarEscuta();
      });
    } else {
      atualizarAgora(false);
      iniciarEscuta();
    }
  }

  if (btnAtualizar) btnAtualizar.addEventListener('click', function () { atualizarAgora(false); });
  document.addEventListener('sistema-os:tela-prazos-aberta', iniciar);
  document.addEventListener('sistema-os:tela-prazos-fechada', pararEscuta);
})();
