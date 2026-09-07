// js/documentos-recebidos.js
//
// Aba "Documentos" (5ª posição em .nav-topo-5). Fluxo PC → celular → PC:
// o PC gera uma OS/Compra/Venda já existente (sem assinatura) e manda um
// .json pro celular assinar remotamente; esta tela importa esse .json,
// mostra a prévia (mesmos templates do PC, via browser-shim — nenhuma
// lógica nova de render), abre a mesma tela de assinatura já usada nos
// outros fluxos, e gera o .json de resposta pro PC.
//
// Reaproveita sem alteração: window.__modules (browser-shim.js),
// window.AssinaturaInjetor.injetarAssinaturas, window.SistemaOSAssinatura.abrir,
// window.SistemaOSHistorico.*DocumentoRecebido* (js/historico.js).

(function () {
  'use strict';

  var TIPO_ARQUIVO_ENVIO = 'sistema-os-pc-para-assinar';
  var TIPO_ARQUIVO_RESPOSTA = 'sistema-os-pc-para-assinar-resposta';

  var inputImportar = document.getElementById('doc-input-importar');
  var listaDocs = document.getElementById('lista-documentos');
  var feedbackDocs = document.getElementById('feedback-documentos');
  var painelDocDetalhe = document.getElementById('painel-doc-detalhe');
  var painelDocLista = document.getElementById('painel-doc-lista');
  var frameDoc = document.getElementById('frame-doc-detalhe');
  var btnAssinarDoc = document.getElementById('btn-assinar-doc');
  var btnNaoAssinadoDoc = document.getElementById('btn-nao-assinado-doc');
  var btnExportarRespostaDoc = document.getElementById('btn-exportar-resposta-doc');
  var btnVoltarDocs = document.getElementById('btn-voltar-doc-lista');
  var avisoDocAssinado = document.getElementById('aviso-doc-assinado');

  // Se os elementos não existirem (index.html desatualizado), a tela
  // simplesmente não é ativada — sem quebrar o resto do app.
  if (!inputImportar || !listaDocs) return;

  var documentoEmEdicaoId = null; // id do registro (IndexedDB) aberto agora

  // Mesma troca aplicada em app.js: o destino da mensagem passa a ser o
  // toast flutuante (js/toast.js) em vez do elemento .feedback-acao fixo
  // desta tela — assinatura preservada, nenhuma das chamadas existentes
  // precisou mudar.
  function mostrarFeedback(msg, ehErro) {
    window.SistemaOSToast.mostrar(msg, { ehErro: !!ehErro });
  }

  function escaparHtml(t) {
    return String(t || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatarData(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso || ''; }
  }

  var ROTULO_TIPO = { os: 'OS', compra: 'Compra', venda: 'Venda', entrega: 'Entrega', desbloqueio: 'Desbloqueio' };

  // Lógica de importação de um pacote recebido do PC. A mesma validação e
  // regra de idempotência atendem ao arquivo JSON manual e à fila Supabase.
  //
  // Resolve com true/false (nunca rejeita) — quem chama decide o que
  // fazer com pacotes inválidos; usado tanto por um único arquivo (feedback
  // imediato) quanto por um lote automático (silencioso, ver
  // verificarDocsParaCelularAutomatico).
  function importarPacoteRecebido(pacote, opcoes) {
    var silencioso = !!(opcoes && opcoes.silencioso);
    function falhar(msg) {
      if (!silencioso) mostrarFeedback(msg, true);
      return Promise.resolve(false);
    }

    if (!pacote || pacote.tipoArquivo !== TIPO_ARQUIVO_ENVIO) {
      return falhar('Este arquivo não é um documento do PC para assinar.');
    }
    if (!pacote.tipoDocumento || !pacote.dados || !pacote.idEnvioAssinatura) {
      return falhar('Arquivo incompleto: faltam campos obrigatórios do pacote.');
    }

    // Idempotência na importação: mesmo pacote importado de novo não
    // duplica o registro — atualiza o existente (mantendo statusLocal
    // se já estiver assinado, para não perder uma assinatura já feita).
    return window.SistemaOSHistorico.obterDocumentoRecebidoPorIdEnvio(pacote.idEnvioAssinatura)
      .then(function (existente) {
        if (existente && existente.statusLocal === 'excluido') return null;
        var registro = existente || {
          id: 'doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
          statusLocal: 'pendente'
        };
        registro.recebidoEm = registro.recebidoEm || new Date().toISOString();
        registro.tipoDocumento = pacote.tipoDocumento;
        registro.idEnvioAssinatura = pacote.idEnvioAssinatura;
        registro.identificador = pacote.identificador || {};
        // A origem determina se a resposta volta automaticamente.
        registro._origemSupabase = !!pacote._origemSupabase;
        // Só sobrescreve `dados` se ainda não foi assinado localmente —
        // se já assinamos e o técnico reimportar o mesmo arquivo antes
        // de exportar de volta, não queremos perder a assinatura já
        // capturada substituindo por uma cópia sem assinatura.
        if (['assinado', 'nao_assinado', 'enviado'].indexOf(registro.statusLocal) === -1) {
          registro.dados = pacote.dados;
        }
        return window.SistemaOSHistorico.salvarDocumentoRecebido(registro);
      })
      .then(function (registroSalvo) { return !!registroSalvo; })
      .catch(function (err) {
        if (!silencioso) {
          mostrarFeedback('Falha ao importar: ' + (err && err.message ? err.message : String(err)), true);
        }
        return false;
      });
  }

  // ── Verificação automática da fila Supabase ──────────────────────
  // Chamada ao abrir o app e ao abrir esta aba. Silenciosa: sem sessão,
  // sem internet ou
  // nada pendente, não mostra feedback nenhum (evita ruído toda vez que o
  // técnico abre a aba); só avisa quando importa algo de fato novo.
  function verificarDocsParaCelularAutomatico() {
    function buscarPeloSupabase() {
      if (!window.SupabaseClientApp) return Promise.resolve([]);
      var cliente;
      try { cliente = window.SupabaseClientApp.obterCliente(); } catch (_) { return Promise.resolve([]); }
      return cliente.functions.invoke('assinaturas-remotas', { body: { acao: 'buscar_pendentes', dados: {} } })
        .then(function (resposta) {
          if (resposta.error || resposta.data?.erro) return [];
          return (resposta.data?.solicitacoes || []).map(function (solicitacao) {
            return Object.assign({}, solicitacao.pacote || {}, { _origemSupabase: true });
          });
        }).catch(function () { return []; });
    }
    return sincronizarExclusoesPendentes().then(buscarPeloSupabase).then(function (pacotes) {
      if (!pacotes.length) return;
      var importados = 0;
      var promessa = Promise.resolve();
      pacotes.forEach(function (pacote) {
        promessa = promessa.then(function () {
          return importarPacoteRecebido(pacote, { silencioso: true }).then(function (ok) {
            if (ok) importados++;
          });
        });
      });
      return promessa.then(function () {
        if (importados > 0) {
          mostrarFeedback(
            importados === 1
              ? '1 documento novo recebido do PC para assinar.'
              : importados + ' documentos novos recebidos do PC para assinar.'
          );
          carregarListaDocumentos();
        }
      });
    }).catch(function () { /* verificação automática nunca deve quebrar a tela */ });
  }

  function cancelarSolicitacaoNaNuvem(registro) {
    if (!registro || !String(registro.idEnvioAssinatura || '').trim()) {
      return Promise.resolve({ confirmada: true, semIdentificadorRemoto: true });
    }
    if (!window.SupabaseClientApp) {
      return Promise.reject(new Error('A conexão com a nuvem ainda não está pronta.'));
    }
    var cliente;
    try { cliente = window.SupabaseClientApp.obterCliente(); } catch (erro) { return Promise.reject(erro); }
    return cliente.rpc('cancelar_solicitacao_assinatura_remota', {
      p_id_envio_assinatura: String(registro.idEnvioAssinatura).trim()
    }).then(function (resposta) {
      if (resposta.error) throw resposta.error;
      var dados = Array.isArray(resposta.data) ? resposta.data[0] : resposta.data;
      if (!dados || dados.cancelada !== true) throw new Error('A solicitação não pôde ser removida da nuvem.');
      return { confirmada: true, encontrada: dados.encontrada !== false };
    });
  }

  function sincronizarExclusoesPendentes() {
    if (!window.SistemaOSHistorico.listarDocumentosRecebidosExcluidos) return Promise.resolve();
    return window.SistemaOSHistorico.listarDocumentosRecebidosExcluidos().then(function (registros) {
      var sequencia = Promise.resolve();
      registros.forEach(function (registro) {
        sequencia = sequencia.then(function () {
          return cancelarSolicitacaoNaNuvem(registro)
            .then(function () {
              return window.SistemaOSHistorico.confirmarExclusaoDocumentoRecebido(registro.id);
            })
            .catch(function () { return false; });
        });
      });
      return sequencia;
    });
  }

  // ── Importar .json do PC ─────────────────────────────────────────
  inputImportar.addEventListener('change', function () {
    var arquivo = inputImportar.files && inputImportar.files[0];
    inputImportar.value = ''; // permite reimportar o mesmo arquivo depois
    if (!arquivo) return;

    var leitor = new FileReader();
    leitor.onerror = function () {
      mostrarFeedback('Não foi possível ler o arquivo selecionado.', true);
    };
    leitor.onload = function () {
      var pacote;
      try {
        pacote = JSON.parse(String(leitor.result || ''));
      } catch (e) {
        mostrarFeedback('Arquivo inválido: não é um .json legível.', true);
        return;
      }
      importarPacoteRecebido(pacote).then(function (ok) {
        if (ok) {
          mostrarFeedback('Documento importado com sucesso.');
          carregarListaDocumentos();
        }
      });
    };
    leitor.readAsText(arquivo);
  });

  // ── Listagem ──────────────────────────────────────────────────────
  function renderizarLista(registros) {
    listaDocs.innerHTML = '';
    if (!registros.length) {
      var vazio = document.createElement('p');
      vazio.className = 'historico-vazio';
      vazio.textContent = 'Nenhum documento recebido do PC ainda.';
      listaDocs.appendChild(vazio);
      return;
    }

    registros.forEach(function (registro) {
      var tipo = registro.tipoDocumento || 'os';
      var dados = registro.dados || {};
      var nomeOutraParte = (dados.cliente && dados.cliente.nome) ||
        (dados.vendedor && dados.vendedor.nome) ||
        dados.compradorNome || dados.nomeRetirou || '';
      // Venda e Entrega usam contrato "flat" (marca/modelo direto na
      // raiz); OS/Compra usam `aparelho.marca`/`aparelho.modelo` aninhado.
      // Entrega sempre mostra "OS nº X" primeiro e, se marca/modelo
      // vieram preenchidos no payload do PC, junto com o aparelho (mesmo
      // padrão de app.js:renderizarListaHistorico).
      var a = (tipo === 'venda' || tipo === 'entrega') ? dados : (dados.aparelho || {});
      // temConteudo em vez de Boolean puro: mesma correção espelhada de
      // app.js — Boolean('   ') é true, então marca/modelo só-espaço
      // passava pelo filter.
      var temConteudo = function (v) { return !!String(v || '').trim(); };
      var linhaObjeto = tipo === 'entrega'
        ? ((window.SistemaOSNumero && window.SistemaOSNumero.comFallback
            ? window.SistemaOSNumero.comFallback(dados.numeroOS, 'OS —')
            : String(dados.numeroOS || 'OS —')) +
          ([a.marca, a.modelo].filter(temConteudo).length ? ' · ' + [a.marca, a.modelo].filter(temConteudo).join(' ') : ''))
        : ([a.marca, a.modelo].filter(temConteudo).join(' ') || '—');
      var assinado = registro.statusLocal === 'assinado';
      var naoAssinado = registro.statusLocal === 'nao_assinado';
      var enviadoAoPc = registro.statusLocal === 'enviado';
      var resultadoNaoAssinado = naoAssinado || registro.resultadoAssinatura === 'nao_assinado' ||
        (enviadoAoPc && registro.dados && registro.dados.naoAssinado === true);

      var item = document.createElement('article');
      item.className = 'item-historico';

      var thumb = document.createElement('div');
      thumb.className = 'item-historico-thumb';
      thumb.textContent = assinado ? '✓' : (resultadoNaoAssinado ? '—' : '✎');

      var selo = assinado
        ? '<span class="selo-sincronizado">Assinado — pronto para enviar</span>'
        : naoAssinado
          ? '<span class="selo-pendente">Não assinado — pronto para enviar</span>'
        : enviadoAoPc
          ? '<span class="selo-sincronizado">' + (resultadoNaoAssinado ? 'Não assinado — enviado ao PC' : 'Assinado — enviado ao PC') + '</span>'
          : '<span class="selo-pendente">Pendente de assinatura</span>';

      var info = document.createElement('div');
      info.className = 'item-historico-info';
      info.innerHTML =
        '<p class="item-historico-tipo">' + escaparHtml(ROTULO_TIPO[tipo] || tipo) + ' ' + selo + '</p>' +
        '<p class="item-historico-cliente">' + escaparHtml(nomeOutraParte || '(sem nome)') + '</p>' +
        '<p class="item-historico-aparelho">' + escaparHtml(linhaObjeto) + '</p>' +
        '<p class="item-historico-data">Recebido em ' + escaparHtml(formatarData(registro.recebidoEm)) + '</p>';

      var btnAbrir = document.createElement('button');
      btnAbrir.type = 'button';
      btnAbrir.className = 'btn-secundario btn-abrir-historico';
      btnAbrir.textContent = assinado || naoAssinado || enviadoAoPc ? 'Ver documento' : 'Assinar';
      btnAbrir.addEventListener('click', function () { abrirDocumento(registro.id); });

      var btnNaoAssinado = null;
      if (!assinado && !naoAssinado && !enviadoAoPc) {
        btnNaoAssinado = document.createElement('button');
        btnNaoAssinado.type = 'button';
        btnNaoAssinado.className = 'btn-secundario';
        btnNaoAssinado.textContent = 'Não assinado';
        btnNaoAssinado.addEventListener('click', function () {
          marcarComoNaoAssinado(registro.id, false);
        });
      }

      var btnExcluir = document.createElement('button');
      btnExcluir.type = 'button';
      btnExcluir.className = 'btn-excluir-historico';
      btnExcluir.textContent = 'Excluir';
      btnExcluir.addEventListener('click', function () { excluirDocumento(registro, item); });

      var acoes = document.createElement('div');
      acoes.className = 'item-historico-acoes';
      acoes.appendChild(btnAbrir);
      if (btnNaoAssinado) acoes.appendChild(btnNaoAssinado);
      acoes.appendChild(btnExcluir);

      item.appendChild(thumb);
      item.appendChild(info);
      item.appendChild(acoes);
      listaDocs.appendChild(item);
    });
  }

  function carregarListaDocumentos() {
    listaDocs.innerHTML = '<p class="historico-carregando">Carregando…</p>';
    window.SistemaOSHistorico.listarDocumentosRecebidos()
      .then(renderizarLista)
      .catch(function (err) {
        listaDocs.innerHTML = '';
        var erro = document.createElement('p');
        erro.className = 'historico-erro';
        erro.textContent = 'Não foi possível abrir os documentos: ' + (err && err.message ? err.message : String(err));
        listaDocs.appendChild(erro);
      });
  }

  async function excluirDocumento(registro, elementoItem) {
    var confirmou = window.confirm('Excluir este documento do celular e da nuvem? Ele não voltará após reinstalar o app.');
    if (!confirmou) return;
    try {
      if (window.SistemaOSExclusao && !await window.SistemaOSExclusao.autorizar('excluir este documento')) return;
    } catch (erroAutorizacao) {
      if (window.SistemaOSToast) {
        window.SistemaOSToast.mostrar(erroAutorizacao.message || String(erroAutorizacao), 'erro');
      }
      return;
    }
    // Primeiro grava um tombstone durável e remove os dados pessoais. Mesmo
    // offline, o documento não volta ao fechar e abrir o app. A exclusão na
    // nuvem é repetida automaticamente até ser confirmada.
    window.SistemaOSHistorico.marcarDocumentoRecebidoExcluido(registro, false)
      .then(function () {
        if (elementoItem && elementoItem.parentNode) elementoItem.parentNode.removeChild(elementoItem);
        if (!listaDocs.querySelector('.item-historico')) renderizarLista([]);
        return cancelarSolicitacaoNaNuvem(registro)
          .then(function () {
            return window.SistemaOSHistorico.confirmarExclusaoDocumentoRecebido(registro.id);
          })
          .then(function () {
            mostrarFeedback('Documento excluído do celular e da nuvem.');
          })
          .catch(function () {
            mostrarFeedback('Documento excluído do celular. A nuvem será atualizada automaticamente quando houver conexão.');
          });
      })
      .catch(function (err) {
        mostrarFeedback('Não foi possível excluir: ' + (err && err.message ? err.message : String(err)), true);
      });
  }

  // ── Prévia + assinatura de um documento aberto ───────────────────

  // Espera os templates originais do PC já estarem carregados
  // (window.__carregarModulosOS, disparado em app.js) antes de gerar
  // qualquer HTML — mesmo princípio usado em app.js.
  function aguardarTemplates() {
    return window.__modulosOSPromise || Promise.resolve();
  }

  function gerarHtmlParaTipo(tipo, dados) {
    var mod;
    if (tipo === 'compra') mod = window.__modules['compra-template'].exports.gerarHtmlCompra;
    else if (tipo === 'venda') mod = window.__modules['venda-template'].exports.gerarHtmlVenda;
    else if (tipo === 'entrega') mod = window.__modules['entrega-template'].exports.gerarHtmlEntrega;
    else if (tipo === 'desbloqueio') mod = window.__modules['desbloqueio-template'].exports.gerarHtmlDesbloqueio;
    else mod = window.__modules['os-template'].exports.gerarHtmlOS;
    if (typeof mod !== 'function') throw new Error('Template original do PC não carregou.');
    return mod(dados, obterConfigEmpresaAtual());
  }

  function obterConfigEmpresaAtual() {
    // Usa montarDadosEmpresa() (não carregarConfig() direto) para que os
    // templates recebam os campos no formato certo (telefonePrincipal em vez
    // de telefone, enderecoEmpresa em vez de endereco, etc.).
    return window.ConfigApp.montarDadosEmpresa();
  }

  function campoAssinaturaPorTipo(tipo) {
    if (tipo === 'compra') return 'assinaturaVendedorBase64';
    if (tipo === 'venda') return 'assinaturaCompradorBase64';
    if (tipo === 'entrega') return 'assinaturaRetirouBase64';
    return 'assinaturaClienteBase64';
  }

  function aplicarAssinaturas(tipo, html, dados) {
    var campo = campoAssinaturaPorTipo(tipo);
    // Entrega tem só UMA assinatura por design (quem retirou o aparelho) —
    // sem segunda parte/assistência técnica co-assinando (ver
    // MAPA_ROTULOS.entrega.rotulosAssistencia = [] em assinatura-injetor.js
    // e aplicarAssinaturasNaEntrega em app.js, que propositalmente nunca
    // passa `assistencia`). Replicamos aqui a mesma decisão de arquitetura
    // já tomada em app.js, em vez de deixar a função genérica sempre
    // passar `assistencia` para todo tipo — mesmo não causando bug visual
    // (rotulosAssistencia vazio nunca casa com nenhum label), manter a
    // exclusão explícita evita depender implicitamente disso e deixa a
    // intenção clara no código.
    if (tipo === 'entrega' || tipo === 'desbloqueio') {
      return window.AssinaturaInjetor.injetarAssinaturas(html, tipo, {
        outraParte: dados[campo] || '',
        estadoOutraParte: dados[campo] ? '' : (dados.assinaturaPendente === true ? 'AGUARDANDO ASSINATURA' : 'NÃO ASSINADO')
      });
    }
    return window.AssinaturaInjetor.injetarAssinaturas(html, tipo, {
      outraParte: dados[campo] || '',
      estadoOutraParte: dados[campo] ? '' : (dados.assinaturaPendente === true ? 'AGUARDANDO ASSINATURA' : 'NÃO ASSINADO'),
      assistencia: obterAssinaturaAssistenciaAtual(),
      numerar: obterNumerarAssinaturas()
    });
  }

  // Mesmo critério de app.js:obterAssinaturaAssistenciaAtual — o toggle
  // "Numerar as assinaturas como 1/2 e 2/2" (cfg.exigirAssinaturaAssistencia
  // — nome do campo interno mantido por compatibilidade com configs já
  // salvas; só o rótulo na UI mudou) só afeta a NUMERAÇÃO impressa, não
  // se a assinatura padrão salva é injetada. Antes desta correção,
  // desmarcar o toggle fazia esta tela também parar de injetar a
  // assinatura padrão automaticamente nos documentos recebidos do PC
  // para assinar.
  function obterAssinaturaAssistenciaAtual() {
    var cfg = window.ConfigApp.carregarConfig();
    return cfg.assinaturaAssistenciaBase64 || '';
  }

  // Mesmo critério de app.js:obterNumerarAssinaturas — `false` força
  // nunca numerar (toggle desmarcado); `undefined` deixa o
  // AssinaturaInjetor decidir sozinho pela presença das duas assinaturas
  // (toggle marcado, comportamento automático de sempre).
  function obterNumerarAssinaturas() {
    var cfg = window.ConfigApp.carregarConfig();
    return cfg.exigirAssinaturaAssistencia === false ? false : undefined;
  }

  function definirConteudoDoFrameDoc(html) {
    return new Promise(function (resolve) {
      var doc = null;
      try {
        doc = frameDoc.contentDocument || (frameDoc.contentWindow && frameDoc.contentWindow.document);
      } catch (e) { doc = null; }
      if (doc) {
        try {
          doc.open(); doc.write(html); doc.close();
          resolve();
          return;
        } catch (e2) { /* cai no fallback abaixo */ }
      }
      frameDoc.addEventListener('load', function aoCarregar() {
        frameDoc.removeEventListener('load', aoCarregar);
        resolve();
      });
      frameDoc.srcdoc = html;
    });
  }

  function abrirDocumento(id) {
    window.SistemaOSHistorico.obterDocumentoRecebidoPorId(id)
      .then(function (registro) {
        if (!registro) throw new Error('Documento não encontrado (pode ter sido excluído).');
        return aguardarTemplates().then(function () {
          documentoEmEdicaoId = registro.id;
          var tipo = registro.tipoDocumento || 'os';
          var html = aplicarAssinaturas(tipo, gerarHtmlParaTipo(tipo, registro.dados), registro.dados);
          atualizarAcoesDetalhe(registro);
          return definirConteudoDoFrameDoc(html);
        });
      })
      .then(function () {
        painelDocLista.hidden = true;
        painelDocDetalhe.hidden = false;
      })
      .catch(function (err) {
        mostrarFeedback('Não foi possível abrir: ' + (err && err.message ? err.message : String(err)), true);
      });
  }

  btnVoltarDocs.addEventListener('click', function () {
    documentoEmEdicaoId = null;
    painelDocDetalhe.hidden = true;
    painelDocLista.hidden = false;
    carregarListaDocumentos();
  });

  btnAssinarDoc.addEventListener('click', function () {
    if (!documentoEmEdicaoId) return;
    window.SistemaOSAssinatura.abrir(function (dataUrl) {
      window.SistemaOSHistorico.obterDocumentoRecebidoPorId(documentoEmEdicaoId)
        .then(function (registro) {
          if (!registro) throw new Error('Documento não encontrado.');
          var tipo = registro.tipoDocumento || 'os';
          var campo = campoAssinaturaPorTipo(tipo);
          registro.dados[campo] = dataUrl;
          registro.dados.assinaturaPendente = false;
          registro.dados.naoAssinado = false;
          registro.dados.dataHoraAssinatura = new Date().toISOString();
          registro.statusLocal = 'assinado';
          registro.resultadoAssinatura = 'assinado';
          return window.SistemaOSHistorico.salvarDocumentoRecebido(registro).then(function () {
            var html = aplicarAssinaturas(tipo, gerarHtmlParaTipo(tipo, registro.dados), registro.dados);
            return definirConteudoDoFrameDoc(html);
          });
        })
        .then(function () {
          return window.SistemaOSHistorico.obterDocumentoRecebidoPorId(documentoEmEdicaoId);
        })
        .then(function (registroAtualizado) {
          atualizarAcoesDetalhe(registroAtualizado);
        })
        .catch(function (err) {
          mostrarFeedback('Falha ao gravar a assinatura: ' + (err && err.message ? err.message : String(err)), true);
        });
    });
  });

  function atualizarAcoesDetalhe(registro) {
    var enviado = registro.statusLocal === 'enviado';
    var decidido = registro.statusLocal === 'assinado' || registro.statusLocal === 'nao_assinado' || enviado;
    var naoAssinado = registro.statusLocal === 'nao_assinado' || registro.resultadoAssinatura === 'nao_assinado' ||
      (registro.dados && registro.dados.naoAssinado === true);
    btnAssinarDoc.hidden = decidido;
    if (btnNaoAssinadoDoc) btnNaoAssinadoDoc.hidden = decidido;
    btnExportarRespostaDoc.hidden = !decidido || enviado;
    avisoDocAssinado.hidden = !decidido;
    avisoDocAssinado.textContent = enviado
      ? (naoAssinado ? 'Não assinado — decisão enviada ao PC.' : 'Assinado — enviado ao PC.')
      : (naoAssinado ? 'Documento marcado como não assinado.' : 'Assinatura capturada.');
  }

  function marcarComoNaoAssinado(id, manterDetalhe) {
    if (!window.confirm('Confirmar que este documento não foi assinado?')) return Promise.resolve(false);
    return window.SistemaOSHistorico.obterDocumentoRecebidoPorId(id)
      .then(function (registro) {
        if (!registro) throw new Error('Documento não encontrado.');
        var tipo = registro.tipoDocumento || 'os';
        var campo = campoAssinaturaPorTipo(tipo);
        registro.dados[campo] = '';
        registro.dados.assinaturaPendente = false;
        registro.dados.naoAssinado = true;
        registro.dados.dataHoraAssinatura = new Date().toISOString();
        registro.statusLocal = 'nao_assinado';
        registro.resultadoAssinatura = 'nao_assinado';
        return window.SistemaOSHistorico.salvarDocumentoRecebido(registro).then(function () { return registro; });
      })
      .then(function (registro) {
        mostrarFeedback('Documento marcado como não assinado. Envie a decisão para o PC.');
        if (manterDetalhe) {
          var tipo = registro.tipoDocumento || 'os';
          var html = aplicarAssinaturas(tipo, gerarHtmlParaTipo(tipo, registro.dados), registro.dados);
          return definirConteudoDoFrameDoc(html).then(function () {
            atualizarAcoesDetalhe(registro);
            return true;
          });
        }
        carregarListaDocumentos();
        return true;
      })
      .catch(function (err) {
        mostrarFeedback('Não foi possível marcar: ' + (err && err.message ? err.message : String(err)), true);
        return false;
      });
  }

  if (btnNaoAssinadoDoc) {
    btnNaoAssinadoDoc.addEventListener('click', function () {
      if (documentoEmEdicaoId) marcarComoNaoAssinado(documentoEmEdicaoId, true);
    });
  }

  // ── Exportar resposta assinada para o PC ─────────────────────────
  // Delega para js/compartilhar-arquivo.js — mesmo módulo usado por
  // app.js (compartilharOuBaixarLote), evitando a duplicação que existia
  // antes (esta função e a de app.js tinham a mesma lógica copiada).
  function compartilharOuBaixarResposta(resposta) {
    var nomeArquivo = 'sistema-os-resposta-assinatura-' +
      new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    return window.SistemaOSCompartilhar.compartilharOuBaixarArquivo(
      resposta,
      nomeArquivo,
      'Assinatura para o PC',
      'Documento assinado — importar de volta no sistema do PC.'
    );
  }

  btnExportarRespostaDoc.addEventListener('click', function () {
    if (!documentoEmEdicaoId) return;
    window.SistemaOSHistorico.obterDocumentoRecebidoPorId(documentoEmEdicaoId)
      .then(function (registro) {
        if (!registro || ['assinado', 'nao_assinado'].indexOf(registro.statusLocal) === -1) {
          throw new Error('Assine ou marque como não assinado antes de enviar a resposta.');
        }
        var tipo = registro.tipoDocumento || 'os';
        var campo = campoAssinaturaPorTipo(tipo);
        var assinaturaBase64 = registro.dados[campo] || '';

        // Documento recebido pela fila atual do Supabase: responde no
        // próprio app, sem gerar/compartilhar arquivo .json.
        if (registro._origemSupabase && window.SupabaseClientApp) {
          var respostaAutomatica = {
            tipoArquivo: TIPO_ARQUIVO_RESPOSTA,
            versaoFormato: 1,
            geradoEm: new Date().toISOString(),
            tipoDocumento: tipo,
            idEnvioAssinatura: registro.idEnvioAssinatura,
            identificador: registro.identificador || {}
          };
          respostaAutomatica[campo] = assinaturaBase64;
          respostaAutomatica.assinaturaPendente = false;
          respostaAutomatica.naoAssinado = registro.statusLocal === 'nao_assinado';
          if (tipo !== 'entrega' && tipo !== 'desbloqueio') respostaAutomatica.assinaturaAssistenciaBase64 = obterAssinaturaAssistenciaAtual();
          return window.SupabaseClientApp.obterCliente().functions.invoke('assinaturas-remotas', {
            body: { acao: 'responder', dados: { idEnvioAssinatura: registro.idEnvioAssinatura, resposta: respostaAutomatica } }
          }).then(function (resposta) {
            if (resposta.error) throw resposta.error;
            if (resposta.data && resposta.data.erro) throw new Error(resposta.data.erro);
            mostrarFeedback((resposta.data && resposta.data.mensagem) || 'Assinatura enviada automaticamente ao PC.');
            registro.statusLocal = 'enviado';
            return window.SistemaOSHistorico.salvarDocumentoRecebido(registro).then(function () {
              btnExportarRespostaDoc.hidden = true;
            });
          });
        }

        return exportarRespostaManual(tipo, registro, campo, assinaturaBase64);
      })
      .catch(function (err) {
        mostrarFeedback('Não foi possível exportar: ' + (err && err.message ? err.message : String(err)), true);
      });
  });

  function exportarRespostaManual(tipo, registro, campo, assinaturaBase64) {
    var resposta = {
      tipoArquivo: TIPO_ARQUIVO_RESPOSTA,
      versaoFormato: 1,
      geradoEm: new Date().toISOString(),
      tipoDocumento: tipo,
      idEnvioAssinatura: registro.idEnvioAssinatura,
      identificador: registro.identificador || {}
    };
    resposta[campo] = assinaturaBase64;
    resposta.assinaturaPendente = false;
    resposta.naoAssinado = registro.statusLocal === 'nao_assinado';
    if (tipo !== 'entrega' && tipo !== 'desbloqueio') {
      resposta.assinaturaAssistenciaBase64 = obterAssinaturaAssistenciaAtual();
    }

    return compartilharOuBaixarResposta(resposta).then(function (resultado) {
      if (resultado.metodo === 'cancelado') {
        mostrarFeedback('Envio cancelado — nada foi alterado.');
        return;
      }
      mostrarFeedback(
        resultado.metodo === 'compartilhado'
          ? 'Resposta enviada pelo menu de compartilhar.'
          : 'Arquivo de resposta baixado (compartilhamento direto não disponível).'
      );
    });
  }

  // Carrega a lista assim que a aba "Documentos" é aberta (chamado por
  // app.js via mostrarTela, ver alteração em index.html/app.js). Também
  // consulta a fila ao abrir o app ou esta aba.
  document.addEventListener('sistema-os:tela-documentos-aberta', function () {
    painelDocDetalhe.hidden = true;
    painelDocLista.hidden = false;
    carregarListaDocumentos();
    verificarDocsParaCelularAutomatico();
  });

  // Verificação automática também ao abrir o APP (não só a aba) — mesmo
  // "puxar agora" disparado uma vez no carregamento inicial. Roda em
  // segundo plano; se a aba de Documentos não existir nesta versão do
  // HTML já teria retornado no `if (!inputImportar...)` lá em cima.
  verificarDocsParaCelularAutomatico();
})();
