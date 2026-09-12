/**
 * Escritas de OS com fila offline duravel (Etapa 5).
 * A fila reaproveita o IndexedDB do historico e o retry global do app.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSSupabaseSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var CHAVE_DEVICE = 'sistema-os-device-id-v1';
  var processamento = null;
  var operacoesEmVoo = Object.create(null);
  var dispositivoRegistrado = null;
  var dispositivoIdentidade = '';
  var registroDispositivoEmVoo = null;
  var registroDispositivoIdentidade = '';
  var sessaoValidadaParaRetryEm = 0;

  function uuid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function deviceIdLocal() {
    var atual = root.localStorage && root.localStorage.getItem(CHAVE_DEVICE);
    if (atual) return atual;
    atual = uuid();
    if (root.localStorage) root.localStorage.setItem(CHAVE_DEVICE, atual);
    return atual;
  }

  function estadoSessao() {
    return root.SistemaOSSessao && root.SistemaOSSessao.obterEstado
      ? root.SistemaOSSessao.obterEstado()
      : { tipo: 'erro' };
  }

  function identidade() {
    var estado = estadoSessao();
    var contexto = estado.contexto || (root.SistemaOSPermissoes && root.SistemaOSPermissoes.obterContexto
      ? root.SistemaOSPermissoes.obterContexto() : {}) || {};
    var usuario = estado.usuario || {};
    return {
      empresaId: contexto.empresa_id || contexto.empresaId || '',
      usuarioId: contexto.usuario_id || contexto.usuarioId || usuario.id || ''
    };
  }

  function chaveIdentidade(quem) {
    quem = quem || identidade();
    return String(quem.empresaId || '') + ':' + String(quem.usuarioId || '');
  }

  function erroSessaoAlterada() {
    var erro = new Error('A conta ativa mudou durante a sincronização. Entre novamente na conta anterior para concluir o envio.');
    erro.tipo = 'sessao-alterada';
    return erro;
  }

  function validarIdentidadeOperacao(operacao) {
    var atual = identidade();
    if (!atual.empresaId || !atual.usuarioId ||
        (operacao && operacao.empresaId && operacao.empresaId !== atual.empresaId) ||
        (operacao && operacao.usuarioId && operacao.usuarioId !== atual.usuarioId)) {
      throw erroSessaoAlterada();
    }
    return atual;
  }

  function serializarEstavel(valor) {
    if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
    if (Array.isArray(valor)) return '[' + valor.map(serializarEstavel).join(',') + ']';
    return '{' + Object.keys(valor).sort().map(function (chave) {
      return JSON.stringify(chave) + ':' + serializarEstavel(valor[chave]);
    }).join(',') + '}';
  }

  function assinaturaDados(valor) {
    var texto = serializarEstavel(valor || {});
    var a = 2166136261;
    var b = 2246822507;
    for (var i = 0; i < texto.length; i += 1) {
      var codigo = texto.charCodeAt(i);
      a = Math.imul(a ^ codigo, 16777619);
      b = Math.imul(b ^ codigo, 3266489909);
    }
    return texto.length.toString(36) + '-' + (a >>> 0).toString(36) + '-' + (b >>> 0).toString(36);
  }

  function estaOnline() {
    return !root.navigator || root.navigator.onLine !== false;
  }

  function servico() {
    if (!root.SistemaOSSupabaseOS) throw new Error('Servico de OS Supabase indisponivel.');
    return root.SistemaOSSupabaseOS;
  }

  function tipoParaEntidade(tipo) {
    if (tipo === 'compra') return 'compra';
    if (tipo === 'venda') return 'venda';
    if (tipo === 'entrega') return 'entrega';
    return 'ordem_servico';
  }

  function tipoDaEntidade(entidade) {
    if (entidade === 'compra') return 'compra';
    if (entidade === 'venda') return 'venda';
    if (entidade === 'entrega') return 'entrega';
    return 'os';
  }

  // Binários são enviados pelo Storage/arquivos. O registro relacional leva
  // somente os dados necessários para o PC reconstruir Compra ou Venda.
  function dadosDocumento(tipo, dados) {
    if (tipo === 'os') return servico()._dadosParaCriacao(dados);
    var seguro = JSON.parse(JSON.stringify(dados || {}));
    delete seguro.fotos;
    delete seguro.assinaturaClienteBase64;
    delete seguro.assinaturaVendedorBase64;
    delete seguro.assinaturaCompradorBase64;
    delete seguro.assinaturaRetirouBase64;
    delete seguro.assinaturaAssistenciaBase64;
    var bruto = tipo === 'compra' ? dados && dados.dadosCompra && dados.dadosCompra.valor
      : tipo === 'venda' ? dados && dados.valorVenda
      : dados && dados.valorReparo;
    var normalizado = String(bruto == null ? '' : bruto).replace(/[^0-9,.-]/g, '');
    if (normalizado.indexOf(',') !== -1) normalizado = normalizado.replace(/\./g, '').replace(',', '.');
    var valor = Number(normalizado);
    return {
      documento_mobile: seguro,
      valor_total: Number.isFinite(valor) && valor >= 0 ? valor : 0
    };
  }

  function historico() {
    if (!root.SistemaOSHistorico || !root.SistemaOSHistorico.enfileirarOperacaoNuvem) {
      throw new Error('Fila offline local indisponivel.');
    }
    return root.SistemaOSHistorico;
  }

  async function registrarDispositivo() {
    var quem = identidade();
    var chave = chaveIdentidade(quem);
    if (!quem.empresaId || !quem.usuarioId) throw erroSessaoAlterada();
    if (dispositivoRegistrado && dispositivoIdentidade === chave) return dispositivoRegistrado;
    if (registroDispositivoEmVoo && registroDispositivoIdentidade === chave) return registroDispositivoEmVoo;

    registroDispositivoIdentidade = chave;
    registroDispositivoEmVoo = (async function () {
      var resposta = await root.SupabaseClientApp.obterCliente().rpc('registrar_heartbeat', {
        p_device_id: deviceIdLocal(),
        p_tipo: 'android',
        p_nome: 'Sistema OS Android'
      });
      if (resposta.error) {
        resposta.error.tipo = servico()._classificarErro(resposta.error);
        throw resposta.error;
      }
      var dados = Array.isArray(resposta.data) ? resposta.data[0] : resposta.data;
      if (chaveIdentidade() !== chave ||
          (dados && dados.empresa_id && String(dados.empresa_id) !== String(quem.empresaId)) ||
          (dados && dados.usuario_id && String(dados.usuario_id) !== String(quem.usuarioId))) {
        throw erroSessaoAlterada();
      }
      var confirmado = dados && dados.id ? dados.id : null;
      if (!confirmado) throw new Error('Servidor nao confirmou o dispositivo Android.');
      dispositivoRegistrado = confirmado;
      dispositivoIdentidade = chave;
      return confirmado;
    })().finally(function () {
      if (registroDispositivoIdentidade === chave) {
        registroDispositivoEmVoo = null;
        registroDispositivoIdentidade = '';
      }
    });
    return registroDispositivoEmVoo;
  }

  function baseOperacao(tipo, parametros) {
    var quem = identidade();
    return Object.assign({
      empresaId: quem.empresaId,
      usuarioId: quem.usuarioId,
      entidade: 'ordem_servico',
      operacao: tipo,
      status: 'pendente',
      tentativas: 0,
      criadoEm: new Date().toISOString(),
      ultimoErro: null
    }, parametros || {});
  }

  function operacaoCriacao(dados, idExportacao, registroLocalId) {
    return baseOperacao('insert', {
      id: 'os:create:' + String(idExportacao),
      entidadeId: null,
      idExportacao: String(idExportacao),
      revisionEsperada: null,
      dados: servico()._dadosParaCriacao(dados),
      registroLocalId: registroLocalId || null
    });
  }


  function operacaoCriacaoDocumento(tipo, dados, idExportacao, registroLocalId) {
    if (tipo === 'os') return operacaoCriacao(dados, idExportacao, registroLocalId);
    return baseOperacao('insert', {
      id: tipo + ':create:' + String(idExportacao),
      entidade: tipoParaEntidade(tipo),
      entidadeId: null,
      idExportacao: String(idExportacao),
      revisionEsperada: null,
      dados: dadosDocumento(tipo, dados),
      registroLocalId: registroLocalId || null
    });
  }

  function operacaoAtualizacao(id, revision, patch, registroLocalId, numero) {
    var dados = servico()._patchParaServidor(patch);
    return baseOperacao('update', {
      id: 'os:update:' + String(id) + ':' + String(revision) + ':' + assinaturaDados(dados),
      entidadeId: String(id),
      idExportacao: null,
      revisionEsperada: Number(revision),
      dados: dados,
      registroLocalId: registroLocalId || null,
      numero: numero || null
    });
  }


  function operacaoAtualizacaoDocumento(tipo, id, revision, dados, registroLocalId, numero) {
    if (tipo === 'os') return operacaoAtualizacao(id, revision, dados, registroLocalId, numero);
    var dadosSeguros = dadosDocumento(tipo, dados);
    return baseOperacao('update', {
      id: tipo + ':update:' + String(id) + ':' + String(revision) + ':' + assinaturaDados(dadosSeguros),
      entidade: tipoParaEntidade(tipo),
      entidadeId: String(id),
      idExportacao: null,
      revisionEsperada: Number(revision),
      dados: dadosSeguros,
      registroLocalId: registroLocalId || null,
      numero: numero || null
    });
  }

  function operacaoExclusao(id, revision, numero) {
    return baseOperacao('delete', {
      id: 'os:delete:' + String(id) + ':' + String(revision),
      entidadeId: String(id),
      idExportacao: null,
      revisionEsperada: Number(revision),
      dados: {},
      numero: numero || null
    });
  }

  function operacaoRespostaAssinatura(idEnvioAssinatura, resposta, registroLocalId) {
    var idEnvio = String(idEnvioAssinatura || '').trim();
    if (!idEnvio || !resposta || typeof resposta !== 'object') {
      throw new Error('Resposta de assinatura incompleta.');
    }
    return baseOperacao('responder', {
      id: 'assinatura-remota:responder:' + idEnvio,
      entidade: 'assinatura_remota',
      entidadeId: idEnvio,
      idExportacao: idEnvio,
      revisionEsperada: null,
      dados: { idEnvioAssinatura: idEnvio, resposta: resposta },
      registroLocalId: registroLocalId || null
    });
  }

  async function enfileirar(operacao, motivo) {
    var salvo = await historico().enfileirarOperacaoNuvem(operacao);
    emitir('sistema-os:operacao-nuvem-enfileirada', salvo);
    return { enviado: false, enfileirado: true, motivo: motivo || 'offline', operacao: salvo, origem: 'supabase' };
  }

  function emitir(nome, detalhe) {
    if (root.document && typeof root.CustomEvent === 'function') {
      root.document.dispatchEvent(new root.CustomEvent(nome, { detail: detalhe }));
    }
  }

  async function confirmarLocal(operacao, dadosRemotos) {
    if (operacao.entidade === 'assinatura_remota' && operacao.registroLocalId &&
        historico().obterDocumentoRecebidoPorId && historico().salvarDocumentoRecebido) {
      var documento = await historico().obterDocumentoRecebidoPorId(operacao.registroLocalId);
      if (documento && ['assinado', 'nao_assinado', 'enviado'].indexOf(documento.statusLocal) !== -1) {
        documento.statusLocal = 'enviado';
        documento.enviadoAoPostgresqlEm = new Date().toISOString();
        await historico().salvarDocumentoRecebido(documento);
      }
      return 0;
    }
    if (['ordem_servico', 'compra', 'venda', 'entrega'].indexOf(operacao.entidade) === -1) return 0;
    if (operacao.registroLocalId && historico().gravarEstadoSupabase) {
      try { await historico().gravarEstadoSupabase(operacao.registroLocalId, dadosRemotos); } catch (_) {}
    }
    if (operacao.registroLocalId && root.SistemaOSSupabaseArquivo &&
        root.SistemaOSSupabaseArquivo.enfileirarArquivosDocumento) {
      var arquivos = await root.SistemaOSSupabaseArquivo.enfileirarArquivosDocumento(
        operacao.registroLocalId, dadosRemotos, tipoDaEntidade(operacao.entidade)
      );
      // Quando esta confirmacao acontece dentro do retry, a fila atual ja
      // foi fotografada antes de estes arquivos existirem. processarFila()
      // executa novas rodadas ao final para inclui-los na mesma sincronizacao.
      // Se a fila de arquivos falhar, a operacao principal tambem permanece
      // pendente e o RPC idempotente permite tentar novamente sem duplicar.
      return arquivos && arquivos.length ? arquivos.length : 0;
    }
    return 0;
  }

  async function executar(operacao) {
    validarIdentidadeOperacao(operacao);
    if (operacao.entidade === 'assinatura_remota') {
      var respostaAssinatura = await root.SupabaseClientApp.obterCliente().functions.invoke('assinaturas-remotas', {
        body: { acao: 'responder', dados: operacao.dados }
      });
      if (respostaAssinatura.error) throw respostaAssinatura.error;
      if (respostaAssinatura.data && respostaAssinatura.data.erro) {
        throw new Error(respostaAssinatura.data.erro);
      }
      return respostaAssinatura.data || { sucesso: true };
    }
    if (operacao.entidade === 'arquivo') {
      if (!root.SistemaOSSupabaseArquivo || !root.SistemaOSSupabaseArquivo.processarOperacao) {
        throw new Error('Servico de arquivos Supabase indisponivel.');
      }
      return root.SistemaOSSupabaseArquivo.processarOperacao(operacao);
    }
    if (operacao.entidade === 'entrega') {
      var dispositivoEntregaId = await registrarDispositivo();
      var respostaEntrega = await root.SupabaseClientApp.obterCliente().rpc(
        operacao.operacao === 'insert' ? 'criar_entrega_mobile' : 'atualizar_entrega_mobile',
        operacao.operacao === 'insert' ? {
          p_id_exportacao: operacao.idExportacao,
          p_dados: operacao.dados,
          p_origem_dispositivo_id: dispositivoEntregaId
        } : {
          p_id: operacao.entidadeId,
          p_revision: operacao.revisionEsperada,
          p_dados: operacao.dados
        }
      );
      if (respostaEntrega.error) {
        respostaEntrega.error.tipo = servico()._classificarErro(respostaEntrega.error);
        throw respostaEntrega.error;
      }
      return Array.isArray(respostaEntrega.data) ? respostaEntrega.data[0] : respostaEntrega.data;
    }
    if (operacao.entidade === 'compra' || operacao.entidade === 'venda') {
      var dispositivoDocumentoId = await registrarDispositivo();
      var respostaDocumento = await root.SupabaseClientApp.obterCliente().rpc(
        operacao.operacao === 'insert' ? 'criar_documento_comercial_mobile' : 'atualizar_documento_comercial_mobile',
        operacao.operacao === 'insert' ? {
          p_tipo: tipoDaEntidade(operacao.entidade),
          p_id_exportacao: operacao.idExportacao,
          p_dados: operacao.dados,
          p_origem_dispositivo_id: dispositivoDocumentoId
        } : {
          p_tipo: tipoDaEntidade(operacao.entidade),
          p_id: operacao.entidadeId,
          p_revision: operacao.revisionEsperada,
          p_dados: operacao.dados
        }
      );
      if (respostaDocumento.error) {
        respostaDocumento.error.tipo = servico()._classificarErro(respostaDocumento.error);
        throw respostaDocumento.error;
      }
      return Array.isArray(respostaDocumento.data) ? respostaDocumento.data[0] : respostaDocumento.data;
    }
    if (operacao.operacao === 'insert') {
      var dispositivoId = await registrarDispositivo();
      return servico().criar(operacao.dados, operacao.idExportacao, dispositivoId);
    }
    if (operacao.operacao === 'update') {
      return servico().atualizar(operacao.entidadeId, operacao.revisionEsperada, operacao.dados);
    }
    if (operacao.operacao === 'delete') {
      return servico().excluir(operacao.entidadeId, operacao.revisionEsperada);
    }
    throw new Error('Operacao de fila desconhecida: ' + operacao.operacao);
  }

  function podeEnviarAgora() {
    return estaOnline() && estadoSessao().tipo === 'autenticado';
  }

  async function executarOuEnfileirarSemDuplicar(operacao) {
    if (!podeEnviarAgora()) return enfileirar(operacao, 'offline');
    try {
      var dados = await executar(operacao);
      await confirmarLocal(operacao, dados);
      return {
        enviado: true,
        enfileirado: false,
        reconciliado: !!(dados && dados._sync_conflito),
        mensagem: dados && dados._sync_mensagem ? dados._sync_mensagem : '',
        dados: dados,
        origem: 'supabase'
      };
    } catch (erro) {
      var tipo = erro.tipo || servico()._classificarErro(erro);
      // DELETE e idempotente: se o servidor confirma que a OS ja nao existe,
      // o estado final desejado foi alcancado. Tratar como sucesso impede que
      // um card antigo fique preso no historico ou reapareca no proximo pull.
      if (operacao.operacao === 'delete' && tipo === 'nao-encontrada') {
        return {
          enviado: true,
          enfileirado: false,
          jaAusente: true,
          dados: { id: operacao.entidadeId, numero: operacao.numero || null, removida: true },
          origem: 'supabase'
        };
      }
      if (tipo === 'rede') return enfileirar(operacao, 'rede');
      return { enviado: false, enfileirado: false, motivo: tipo, erro: erro, origem: 'supabase' };
    }
  }

  // Salvar, retomar o app e o retry periodico podem acontecer na mesma
  // janela de tempo. A operacao possui um ID deterministico (entidade,
  // registro e revision), portanto chamadas iguais devem compartilhar a
  // mesma Promise em vez de abrir varios updates concorrentes no Postgres.
  // Isso evita lock contention e protege a CPU do projeto Supabase.
  function executarOuEnfileirar(operacao) {
    var chave = operacao && operacao.id ? String(operacao.id) : '';
    if (!chave) return executarOuEnfileirarSemDuplicar(operacao);
    if (operacoesEmVoo[chave]) return operacoesEmVoo[chave];

    operacoesEmVoo[chave] = Promise.resolve(executarOuEnfileirarSemDuplicar(operacao))
      .then(function (resultado) {
        delete operacoesEmVoo[chave];
        return resultado;
      }, function (erro) {
        delete operacoesEmVoo[chave];
        throw erro;
      });
    return operacoesEmVoo[chave];
  }

  function criarOS(dados, idExportacao, registroLocalId) {
    return executarOuEnfileirar(operacaoCriacao(dados, idExportacao, registroLocalId));
  }

  function atualizarOS(id, revision, patch, registroLocalId, numero) {
    return executarOuEnfileirar(operacaoAtualizacao(id, revision, patch, registroLocalId, numero));
  }


  function criarDocumento(tipo, dados, idExportacao, registroLocalId) {
    return executarOuEnfileirar(operacaoCriacaoDocumento(tipo, dados, idExportacao, registroLocalId));
  }

  function atualizarDocumento(tipo, id, revision, dados, registroLocalId, numero) {
    return executarOuEnfileirar(operacaoAtualizacaoDocumento(tipo, id, revision, dados, registroLocalId, numero));
  }

  function excluirOS(id, revision, numero) {
    return executarOuEnfileirar(operacaoExclusao(id, revision, numero));
  }

  function enviarRespostaAssinatura(idEnvioAssinatura, resposta, registroLocalId) {
    return executarOuEnfileirar(operacaoRespostaAssinatura(
      idEnvioAssinatura, resposta, registroLocalId
    ));
  }

  function cancelarCriacaoOS(idExportacao) {
    if (!idExportacao) return Promise.resolve(false);
    return historico().atualizarOperacaoNuvem('os:create:' + String(idExportacao), {
      status: 'concluido',
      cancelado: true,
      concluidoEm: new Date().toISOString(),
      ultimoErro: null,
      proximaTentativaEm: null
    }).then(function (item) { return !!item; });
  }

  function atrasoMs(tentativas) {
    return Math.min(5 * 60 * 1000, 1000 * Math.pow(2, Math.max(0, Number(tentativas || 1) - 1)));
  }

  async function validarAntesDoRetry() {
    if (!estaOnline()) return false;
    if (estadoSessao().tipo === 'autenticado' && Date.now() - sessaoValidadaParaRetryEm < 90000) {
      return true;
    }
    if (root.SistemaOSSessao && typeof root.SistemaOSSessao.revalidar === 'function') {
      var estado = await root.SistemaOSSessao.revalidar();
      var autenticada = !!(estado && estado.tipo === 'autenticado');
      if (autenticada) sessaoValidadaParaRetryEm = Date.now();
      return autenticada;
    }
    var autenticadaLocal = estadoSessao().tipo === 'autenticado';
    if (autenticadaLocal) sessaoValidadaParaRetryEm = Date.now();
    return autenticadaLocal;
  }

  async function processarInterno() {
    var atual = identidade();
    var fila = await historico().listarOperacoesNuvemPendentes(atual);
    if (!fila.length) return { executado: false, motivo: 'sem-pendentes', enviados: 0, conflitos: 0, falharam: 0 };
    if (!await validarAntesDoRetry()) return { executado: false, motivo: 'sessao-invalida', enviados: 0, conflitos: 0, falharam: 0 };

    atual = identidade();
    var contagem = { executado: true, enviados: 0, conflitos: 0, falharam: 0 };
    for (var i = 0; i < fila.length; i += 1) {
      var item = fila[i];
      if ((item.empresaId && item.empresaId !== atual.empresaId) ||
          (item.usuarioId && item.usuarioId !== atual.usuarioId)) continue;
      var tentativas = Number(item.tentativas || 0) + 1;
      var inicioTentativa = new Date();
      await historico().atualizarOperacaoNuvem(item.id, {
        status: 'enviando',
        tentativas: tentativas,
        ultimaTentativaEm: inicioTentativa.toISOString(),
        // Uma WebView encerrada durante a requisicao nao deve repetir a mesma
        // operacao assim que o aplicativo abrir novamente.
        proximaTentativaEm: new Date(inicioTentativa.getTime() + (5 * 60 * 1000)).toISOString()
      });
      try {
        var remoto = await executar(item);
        await historico().atualizarOperacaoNuvem(item.id, {
          status: 'concluido',
          concluidoEm: new Date().toISOString(),
          entidadeId: remoto.id || item.entidadeId,
          revisionConfirmada: remoto.revision || null,
          numeroConfirmado: remoto.numero || item.numero || null,
          ultimoErro: null,
          proximaTentativaEm: null
        });
        contagem.novosPendentes = Number(contagem.novosPendentes || 0) +
          Number(await confirmarLocal(item, remoto) || 0);
        if (item.entidade === 'arquivo' && root.SistemaOSSupabaseArquivo &&
            root.SistemaOSSupabaseArquivo.aposConfirmarOperacao) {
          try { await root.SistemaOSSupabaseArquivo.aposConfirmarOperacao(item); } catch (_) {}
        }
        contagem.enviados += 1;
        emitir('sistema-os:operacao-nuvem-concluida', { operacao: item, dados: remoto });
      } catch (erro) {
        var tipo = erro.tipo || servico()._classificarErro(erro);
        if (tipo === 'conflito') {
          await historico().atualizarOperacaoNuvem(item.id, {
            status: 'conflito', ultimoErro: erro.message || String(erro), proximaTentativaEm: null
          });
          contagem.conflitos += 1;
          emitir('sistema-os:conflito-sincronizacao', { operacao: item, erro: erro });
        } else {
          await historico().atualizarOperacaoNuvem(item.id, {
            status: 'erro',
            ultimoErro: erro.message || String(erro),
            proximaTentativaEm: new Date(Date.now() + atrasoMs(tentativas)).toISOString()
          });
          contagem.falharam += 1;
        }
        // Preserva a ordem: nenhuma operacao posterior ultrapassa uma que
        // ainda nao foi confirmada ou que entrou em conflito.
        break;
      }
    }
    return contagem;
  }

  async function processarAteEsvaziar() {
    var total = { executado: false, enviados: 0, conflitos: 0, falharam: 0 };
    // Uma rodada envia a fila fotografada no inicio. Confirmar uma OS pode
    // criar itens de arquivo, por isso repetimos ate nao haver novo envio.
    // O limite impede um loop infinito caso outro processo alimente a fila
    // continuamente enquanto esta sincronizacao esta em andamento.
    for (var rodada = 0; rodada < 20; rodada += 1) {
      var resultado = await processarInterno();
      total.executado = total.executado || !!resultado.executado;
      total.enviados += Number(resultado.enviados || 0);
      total.conflitos += Number(resultado.conflitos || 0);
      total.falharam += Number(resultado.falharam || 0);
      if (resultado.motivo && !total.motivo) total.motivo = resultado.motivo;
      if (resultado.erro && !total.erro) total.erro = resultado.erro;
      if (!resultado.executado || !resultado.enviados ||
          resultado.conflitos || resultado.falharam) break;
    }
    return total;
  }

  function processarFila() {
    if (processamento) return processamento;
    processamento = processarAteEsvaziar().catch(function (erro) {
      return { executado: false, motivo: 'erro', erro: erro, enviados: 0, conflitos: 0, falharam: 1 };
    }).then(function (resultado) {
      processamento = null;
      return resultado;
    });
    return processamento;
  }

  if (root.addEventListener) {
    root.addEventListener('online', function () { processarFila(); });
  }
  if (root.document) {
    root.document.addEventListener('sistema-os:sessao-alterada', function (evento) {
      if (evento.detail && evento.detail.tipo === 'autenticado') processarFila();
    });
  }

  return {
    criarOS: criarOS,
    atualizarOS: atualizarOS,
    criarDocumento: criarDocumento,
    atualizarDocumento: atualizarDocumento,
    excluirOS: excluirOS,
    enviarRespostaAssinatura: enviarRespostaAssinatura,
    cancelarCriacaoOS: cancelarCriacaoOS,
    obterDispositivoId: registrarDispositivo,
    processarFila: processarFila,
    _operacaoCriacao: operacaoCriacao,
    _operacaoAtualizacao: operacaoAtualizacao,
    _operacaoExclusao: operacaoExclusao,
    _operacaoCriacaoDocumento: operacaoCriacaoDocumento,
    _operacaoAtualizacaoDocumento: operacaoAtualizacaoDocumento,
    _operacaoRespostaAssinatura: operacaoRespostaAssinatura,
    _dadosDocumento: dadosDocumento,
    _atrasoMs: atrasoMs,
    _assinaturaDados: assinaturaDados,
    _resetDispositivo: function () {
      dispositivoRegistrado = null;
      dispositivoIdentidade = '';
      registroDispositivoEmVoo = null;
      registroDispositivoIdentidade = '';
    }
  };
});
