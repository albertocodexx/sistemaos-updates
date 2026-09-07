/**
 * Adaptador único de dados do Supabase.
 * A empresa é obtida da sessão autenticada e protegida por RLS; não existe
 * fallback para outro provedor de consulta, escrita ou arquivo.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CloudData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var SERVICOS = {
    os: 'SistemaOSSupabaseOS',
    garantia: 'SistemaOSSupabaseGarantia',
    entrega: 'SistemaOSSupabaseEntrega'
  };

  function configuracaoSupabaseAtiva() {
    if (!root.SupabaseClientApp || !root.SupabaseClientApp.carregarConfiguracao) return false;
    var configuracao = root.SupabaseClientApp.carregarConfiguracao();
    return !!(configuracao && configuracao.ok && configuracao.ativo);
  }

  function obterContexto() {
    if (!root.SistemaOSPermissoes || !root.SistemaOSPermissoes.obterContexto) return {};
    return root.SistemaOSPermissoes.obterContexto() || {};
  }

  function providerConsultas() {
    return configuracaoSupabaseAtiva() ? 'supabase' : 'indisponivel';
  }

  function providerEscritas() {
    return providerConsultas();
  }

  async function consultarSupabase(tipo, numero) {
    var nomeServico = SERVICOS[tipo];
    var servico = nomeServico && root[nomeServico];
    if (!servico || typeof servico.consultarPorNumero !== 'function') {
      throw new Error('Serviço de consulta Supabase indisponível para ' + tipo + '.');
    }
    var dados = await servico.consultarPorNumero(numero);
    return dados
      ? { encontrada: true, dados: dados, origem: 'supabase' }
      : { encontrada: false, motivo: 'nao-encontrada', origem: 'supabase' };
  }

  async function consultar(tipo, numero) {
    if (['os', 'garantia', 'entrega'].indexOf(tipo) === -1) {
      return { encontrada: false, motivo: 'tipo-invalido', origem: providerConsultas() };
    }
    if (providerConsultas() !== 'supabase') {
      return { encontrada: false, motivo: 'sem-sessao', origem: 'supabase' };
    }
    try {
      return await consultarSupabase(tipo, numero);
    } catch (erro) {
      return { encontrada: false, motivo: 'erro-supabase', erro: erro, origem: 'supabase' };
    }
  }

  function syncSupabase() {
    if (!root.SistemaOSSupabaseSync) throw new Error('Sincronização Supabase indisponível.');
    return root.SistemaOSSupabaseSync;
  }

  function referenciaOS(referencia) {
    return referencia && typeof referencia === 'object' ? referencia : { numero: referencia };
  }

  function indisponivelSemSessao() {
    return Promise.resolve({ enviado: false, motivo: 'sem-sessao', origem: 'supabase' });
  }

  function criarOS(dados, idExportacao, registroLocalId) {
    if (providerEscritas() !== 'supabase') return indisponivelSemSessao();
    return syncSupabase().criarOS(dados, idExportacao, registroLocalId);
  }

  function atualizarOS(referencia, revision, patch, registroLocalId) {
    var ref = referenciaOS(referencia);
    if (providerEscritas() !== 'supabase') return indisponivelSemSessao();
    if (!ref.id || !(revision || ref.revision)) {
      return Promise.resolve({ enviado: false, motivo: 'referencia-invalida', origem: 'supabase' });
    }
    return syncSupabase().atualizarOS(ref.id, revision || ref.revision, patch, registroLocalId, ref.numero);
  }

  async function excluirOS(referencia, revision) {
    var ref = referenciaOS(referencia);
    var numeroOriginal = ref.numero || '';
    async function limparLocalSeConfirmado(resultado, numero) {
      if (resultado && (resultado.enviado || resultado.enfileirado || resultado.jaAusente) &&
          numero && root.SistemaOSHistorico && root.SistemaOSHistorico.excluirRelacionadosOS) {
        await root.SistemaOSHistorico.excluirRelacionadosOS(numero);
      }
      return resultado;
    }
    if (providerEscritas() !== 'supabase') return indisponivelSemSessao();
    var revisionResolvida = revision || ref.revision;
    if ((!ref.id || !revisionResolvida) && ref.numero) {
      try {
        var servicoOS = root.SistemaOSSupabaseOS;
        var remoto = servicoOS && typeof servicoOS.consultarPorNumero === 'function'
          ? await servicoOS.consultarPorNumero(ref.numero)
          : null;
        if (!remoto) {
          // A ausencia remota confirma o resultado de uma exclusao. Isso e
          // sucesso idempotente, nao um erro que deve prender o item local.
          return limparLocalSeConfirmado(
            { enviado: true, enfileirado: false, jaAusente: true, origem: 'supabase' },
            numeroOriginal
          );
        }
        ref = remoto;
        revisionResolvida = remoto.revision;
      } catch (erro) {
        var tipo = root.SistemaOSSupabaseOS && root.SistemaOSSupabaseOS._classificarErro
          ? root.SistemaOSSupabaseOS._classificarErro(erro)
          : 'servidor';
        return { enviado: false, motivo: tipo, erro: erro, origem: 'supabase' };
      }
    }
    if (!ref.id || !revisionResolvida) {
      return { enviado: false, motivo: 'referencia-invalida', origem: 'supabase' };
    }
    var resultado = await syncSupabase().excluirOS(ref.id, revisionResolvida, ref.numero);
    return limparLocalSeConfirmado(resultado, ref.numero || numeroOriginal);
  }

  function patchCompletoRegistro(dados) {
    var servico = root.SistemaOSSupabaseOS;
    var patch = servico && servico._dadosParaCriacao ? servico._dadosParaCriacao(dados) : dados;
    patch = Object.assign({}, patch);
    delete patch.data_abertura;
    return patch;
  }

  function sincronizarRegistroOS(registro) {
    if (!registro || !registro.os) return Promise.resolve({ enviado: false, motivo: 'registro-invalido' });
    if (providerEscritas() !== 'supabase') return indisponivelSemSessao();
    var idExportacao = registro.idExportacaoOriginal ||
      (root.IdExportacao ? root.IdExportacao.gerar('os', registro.os) : 'os-' + registro.id);
    if (registro.supabaseId && registro.supabaseRevision) {
      return atualizarOS({
        id: registro.supabaseId,
        revision: registro.supabaseRevision,
        numero: registro.numeroOSAtribuido
      }, registro.supabaseRevision, patchCompletoRegistro(registro.os), registro.id);
    }
    return criarOS(registro.os, idExportacao, registro.id);
  }

  function sincronizarRegistro(registro) {
    if (!registro || !registro.os) return Promise.resolve({ enviado: false, motivo: 'registro-invalido' });
    var tipo = registro.tipoDocumento || 'os';
    if (['os', 'compra', 'venda', 'entrega'].indexOf(tipo) === -1) {
      return Promise.resolve({ enviado: false, motivo: 'tipo-nao-sincronizavel' });
    }
    if (tipo === 'os') return sincronizarRegistroOS(registro);
    if (providerEscritas() !== 'supabase') return indisponivelSemSessao();
    var idExportacao = registro.idExportacaoOriginal ||
      (root.IdExportacao ? root.IdExportacao.gerar(tipo, registro.os) : tipo + '-' + registro.id);
    if (registro.supabaseId && registro.supabaseRevision) {
      return syncSupabase().atualizarDocumento(
        tipo, registro.supabaseId, registro.supabaseRevision, registro.os,
        registro.id, registro.numeroOSAtribuido
      );
    }
    return syncSupabase().criarDocumento(tipo, registro.os, idExportacao, registro.id);
  }

  function processarFila() {
    if (providerEscritas() !== 'supabase' || !root.SistemaOSSupabaseSync) {
      return Promise.resolve({ executado: false, motivo: 'sem-sessao' });
    }
    return root.SistemaOSSupabaseSync.processarFila();
  }

  function cancelarCriacaoOSPendente(idExportacao) {
    if (providerEscritas() !== 'supabase' || !root.SistemaOSSupabaseSync ||
        !root.SistemaOSSupabaseSync.cancelarCriacaoOS) return Promise.resolve(false);
    return root.SistemaOSSupabaseSync.cancelarCriacaoOS(idExportacao);
  }

  function providerArquivos() {
    return providerConsultas() === 'supabase' && root.SistemaOSSupabaseArquivo
      ? 'supabase'
      : 'indisponivel';
  }

  function modoArmazenamento() {
    var ctx = obterContexto();
    return ctx.modo_armazenamento || ctx.modoArmazenamento || 'economico';
  }

  function listarArquivos(entidadeTipo, entidadeId) {
    if (providerArquivos() !== 'supabase') return Promise.resolve([]);
    return root.SistemaOSSupabaseArquivo.listarArquivos(entidadeTipo, entidadeId);
  }

  function obterArquivo(id, opcoes) {
    if (providerArquivos() !== 'supabase') {
      return Promise.resolve({ disponivel: false, motivo: 'sem-sessao' });
    }
    return root.SistemaOSSupabaseArquivo.obterArquivo(id, opcoes);
  }

  function anexarComprovanteTermicoAssinado(entidadeId, numeroOS, dataUrl, nomeArquivo) {
    if (providerArquivos() !== 'supabase' ||
        !root.SistemaOSSupabaseArquivo.anexarComprovanteTermicoAssinado) {
      return Promise.reject(new Error('Envio de comprovante indisponível nesta sessão.'));
    }
    return root.SistemaOSSupabaseArquivo.anexarComprovanteTermicoAssinado(
      entidadeId, numeroOS, dataUrl, nomeArquivo
    );
  }

  async function atualizarExtrasOS(referencia, extrasPatch) {
    var ref = referenciaOS(referencia);
    if (providerEscritas() !== 'supabase' || !ref.id) {
      throw new Error('Busque novamente a OS antes de atualizá-la.');
    }
    var cliente = root.SupabaseClientApp.obterCliente();
    var consulta = await cliente.from('ordens_servico')
      .select('id,numero,revision,dados_extras')
      .eq('id', ref.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (consulta.error) throw consulta.error;
    if (!consulta.data) throw new Error('A OS não foi encontrada no servidor.');
    var extras = Object.assign({}, consulta.data.dados_extras || {}, extrasPatch || {});
    var resposta = await cliente.rpc('atualizar_ordem_servico', {
      p_id: consulta.data.id,
      p_revision: Number(consulta.data.revision),
      p_patch: { dados_extras: extras }
    });
    if (resposta.error) throw resposta.error;
    return Array.isArray(resposta.data) ? resposta.data[0] : resposta.data;
  }

  function atualizarRecebedorOS(referencia, nome) {
    var nomeLimpo = String(nome || '').trim();
    if (!nomeLimpo) return Promise.reject(new Error('Informe quem recebeu o aparelho.'));
    return atualizarExtrasOS(referencia, { nome_retirou: nomeLimpo, recebido_por: nomeLimpo });
  }

  async function assinarOSConsultada(referencia, assinaturaBase64) {
    var ref = referenciaOS(referencia);
    if (!ref.id || !assinaturaBase64) throw new Error('OS ou assinatura inválida. Busque a OS novamente.');
    if (!root.SistemaOSSupabaseArquivo ||
        typeof root.SistemaOSSupabaseArquivo.anexarAssinaturaClienteOS !== 'function') {
      throw new Error('O serviço de assinatura não está disponível.');
    }
    // Primeiro substitui o binário pelo caminho idempotente; depois remove
    // o estado "não assinado" da mesma linha. O PC recebe a assinatura pelo
    // catálogo de arquivos sem criação de uma segunda OS.
    await root.SistemaOSSupabaseArquivo.anexarAssinaturaClienteOS(
      ref.id, ref.numero || referencia.numeroOS, assinaturaBase64
    );
    var atualizado = await atualizarExtrasOS(ref, {
      assinatura_pendente: false,
      nao_assinado: false,
      assinatura_cliente_atualizada_em: new Date().toISOString()
    });
    return { enviado: true, os: atualizado };
  }

  return {
    consultarOS: function (numero) { return consultar('os', numero); },
    consultarGarantia: function (numero) { return consultar('garantia', numero); },
    consultarEntrega: function (numero) { return consultar('entrega', numero); },
    consultar: consultar,
    providerConsultas: providerConsultas,
    providerEscritas: providerEscritas,
    criarOS: criarOS,
    atualizarOS: atualizarOS,
    excluirOS: excluirOS,
    sincronizarRegistroOS: sincronizarRegistroOS,
    sincronizarRegistro: sincronizarRegistro,
    processarFila: processarFila,
    cancelarCriacaoOSPendente: cancelarCriacaoOSPendente,
    providerArquivos: providerArquivos,
    modoArmazenamento: modoArmazenamento,
    listarArquivos: listarArquivos,
    obterArquivo: obterArquivo,
    anexarComprovanteTermicoAssinado: anexarComprovanteTermicoAssinado,
    atualizarRecebedorOS: atualizarRecebedorOS,
    assinarOSConsultada: assinarOSConsultada
  };
});
