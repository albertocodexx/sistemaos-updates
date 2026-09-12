/**
 * Metadados e acesso sob demanda a arquivos privados.
 * Listar nunca baixa bytes; somente o Supabase Storage é utilizado.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSSupabaseArquivo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var CAMPOS = [
    'id', 'entidade_tipo', 'entidade_id', 'categoria', 'nome_arquivo',
    'mime_type', 'tamanho_bytes', 'largura', 'altura', 'storage_bucket',
    'miniatura_path', 'arquivo_nuvem_path', 'arquivo_local_id',
    'disponibilidade', 'revision', 'created_at',
    'updated_at'
  ].join(',');

  function cliente() {
    return root.SupabaseClientApp.obterCliente();
  }

  function contexto() {
    return root.SistemaOSPermissoes && root.SistemaOSPermissoes.obterContexto
      ? (root.SistemaOSPermissoes.obterContexto() || {}) : {};
  }

  function texto(valor) { return String(valor == null ? '' : valor).trim(); }

  function normalizar(linha) {
    if (Array.isArray(linha)) linha = linha[0];
    if (!linha) return null;
    return {
      id: linha.id,
      entidadeTipo: linha.entidade_tipo,
      entidadeId: linha.entidade_id,
      categoria: linha.categoria,
      nomeArquivo: linha.nome_arquivo,
      mimeType: linha.mime_type,
      tamanhoBytes: linha.tamanho_bytes == null ? null : Number(linha.tamanho_bytes),
      largura: linha.largura == null ? null : Number(linha.largura),
      altura: linha.altura == null ? null : Number(linha.altura),
      disponibilidade: linha.disponibilidade,
      temMiniatura: !!linha.miniatura_path,
      temArquivoNuvem: !!linha.arquivo_nuvem_path,
      temArquivoLocal: !!linha.arquivo_local_id,
      revision: linha.revision,
      createdAt: linha.created_at,
      updatedAt: linha.updated_at,
      _storageBucket: linha.storage_bucket || '',
      _miniaturaPath: linha.miniatura_path || '',
      _arquivoNuvemPath: linha.arquivo_nuvem_path || '',
      _arquivoLocalId: linha.arquivo_local_id || ''
    };
  }

  // Um PDF de OS e um documento "atual", nao um anexo cumulativo. Versoes
  // antigas podem existir em bancos que rodaram antes da trava de unicidade
  // do servidor; a consulta conserva somente a linha atual pela data efetiva
  // de atualização. Fotos e assinaturas continuam independentes.
  function somenteArquivosAtuais(lista) {
    var categoriasEncontradas = {};
    var ordenada = (lista || []).slice().sort(function (a, b) {
      var dataA = Date.parse((a && (a.updatedAt || a.createdAt)) || '') || 0;
      var dataB = Date.parse((b && (b.updatedAt || b.createdAt)) || '') || 0;
      return dataB - dataA;
    });
    return ordenada.filter(function (arquivo) {
      if (!arquivo) return false;
      var chave = texto(arquivo.categoria) || (arquivo.mimeType === 'application/pdf' ? 'pdf' : arquivo.id);
      if (categoriasEncontradas[chave]) return false;
      categoriasEncontradas[chave] = true;
      return true;
    });
  }

  async function listarArquivos(entidadeTipo, entidadeId) {
    if (!texto(entidadeTipo) || !texto(entidadeId)) throw new Error('Entidade do arquivo invalida.');
    var resposta = await cliente().from('arquivos')
      .select(CAMPOS)
      .eq('entidade_tipo', entidadeTipo)
      .eq('entidade_id', entidadeId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });
    if (resposta.error) throw resposta.error;
    // O celular recebe os campos escritos/editaveis pelas tabelas leves da
    // entidade. Na lista de documentos ele precisa somente do PDF atual;
    // fotos e assinaturas permanecem locais no PC apos o transito seguro.
    return somenteArquivosAtuais((resposta.data || []).map(normalizar).filter(function (arquivo) {
      return arquivo && (arquivo.mimeType === 'application/pdf' || arquivo.categoria === 'pdf' ||
        arquivo.categoria === 'comprovante_termico_assinado');
    }));
  }

  async function obterMetadados(id) {
    if (!texto(id)) throw new Error('Id do arquivo invalido.');
    var resposta = await cliente().from('arquivos')
      .select(CAMPOS)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (resposta.error) throw resposta.error;
    return normalizar(resposta.data);
  }

  function validarPath(path) {
    var valor = texto(path).replace(/^\/+/, '');
    if (!valor || valor.indexOf('..') !== -1) throw new Error('Caminho de arquivo invalido.');
    var empresaId = texto(contexto().empresa_id || contexto().empresaId);
    if (empresaId && valor.split('/')[0] !== empresaId) throw new Error('Arquivo fora da empresa autenticada.');
    return valor;
  }

  async function urlAssinada(bucket, path) {
    var bucketSeguro = texto(bucket);
    if (['miniaturas', 'arquivos-os', 'documentos-pdf'].indexOf(bucketSeguro) === -1) {
      throw new Error('Bucket privado nao permitido.');
    }
    var resposta = await cliente().storage.from(bucketSeguro)
      .createSignedUrl(validarPath(path), 60);
    if (resposta.error) throw resposta.error;
    var url = resposta.data && (resposta.data.signedUrl || resposta.data.signedURL);
    if (!url) throw new Error('Supabase nao devolveu a URL assinada.');
    return url;
  }

  async function solicitarLocal(arquivo) {
    var resposta = await cliente().rpc('solicitar_arquivo_local', { p_arquivo_id: arquivo.id });
    if (resposta.error) {
      if (resposta.error.code === 'P0001' || /desktop_offline/i.test(resposta.error.message || '')) {
        return {
          disponivel: false,
          motivo: 'desktop-offline',
          mensagem: 'Arquivo original disponível quando o computador da assistência estiver ligado e conectado.'
        };
      }
      throw resposta.error;
    }
    var pedido = Array.isArray(resposta.data) ? resposta.data[0] : resposta.data;
    return {
      disponivel: false,
      solicitado: true,
      motivo: 'aguardando-desktop',
      solicitacaoId: pedido && pedido.id,
      mensagem: 'Solicitação enviada ao computador. O arquivo será disponibilizado quando o PC responder.'
    };
  }

  async function obterArquivo(id, opcoes) {
    var arquivo = await obterMetadados(id);
    if (!arquivo) return { disponivel: false, motivo: 'nao-encontrado', mensagem: 'Arquivo não encontrado.' };
    var miniatura = !!(opcoes && opcoes.miniatura);
    if (miniatura) {
      if (!arquivo._miniaturaPath) {
        return { disponivel: false, motivo: 'sem-miniatura', mensagem: 'Este arquivo não possui miniatura.' };
      }
      return {
        disponivel: true,
        origem: 'supabase',
        miniatura: true,
        mimeType: 'image/webp',
        url: await urlAssinada('miniaturas', arquivo._miniaturaPath)
      };
    }
    if (arquivo._arquivoNuvemPath) {
      var bucket = arquivo._storageBucket || (arquivo.mimeType === 'application/pdf' ? 'documentos-pdf' : 'arquivos-os');
      return {
        disponivel: true,
        origem: 'supabase',
        miniatura: false,
        mimeType: arquivo.mimeType,
        nomeArquivo: arquivo.nomeArquivo,
        url: await urlAssinada(bucket, arquivo._arquivoNuvemPath)
      };
    }
    if (arquivo._arquivoLocalId) return solicitarLocal(arquivo);
    return { disponivel: false, motivo: 'indisponivel', mensagem: 'Arquivo indisponível no momento.' };
  }

  async function prepararExclusaoOS(osId) {
    if (!texto(osId)) throw new Error('Id da OS e obrigatorio para limpar os arquivos.');
    var resposta = await cliente().rpc('listar_arquivos_exclusao_os', { p_id: osId });
    if (resposta.error) throw resposta.error;
    var porBucket = {};
    function adicionar(bucket, caminho) {
      bucket = texto(bucket); caminho = texto(caminho);
      if (!bucket || !caminho) return;
      if (!porBucket[bucket]) porBucket[bucket] = {};
      porBucket[bucket][caminho] = true;
    }
    (resposta.data || []).forEach(function (arquivo) {
      adicionar(arquivo.storage_bucket, arquivo.arquivo_nuvem_path);
      adicionar('miniaturas', arquivo.miniatura_path);
    });
    return { osId: texto(osId), porBucket: porBucket };
  }

  async function removerManifestoExclusao(manifesto) {
    var porBucket = manifesto && manifesto.porBucket || {};
    var removidos = 0;
    var buckets = Object.keys(porBucket);
    for (var b = 0; b < buckets.length; b += 1) {
      var bucket = buckets[b];
      var caminhos = Object.keys(porBucket[bucket]);
      for (var i = 0; i < caminhos.length; i += 100) {
        var lote = caminhos.slice(i, i + 100);
        var removido = await cliente().storage.from(bucket).remove(lote);
        if (removido.error) throw removido.error;
        removidos += (removido.data || []).length;
      }
    }
    return { removidos: removidos };
  }

  async function removerArquivosOS(osId) {
    return removerManifestoExclusao(await prepararExclusaoOS(osId));
  }

  function infoDataUrl(dataUrl) {
    var correspondencia = texto(dataUrl).match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
    if (!correspondencia) throw new Error('Arquivo Base64 local invalido.');
    var binario = root.atob(correspondencia[2].replace(/\s/g, ''));
    var bytes = new Uint8Array(binario.length);
    for (var i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
    return { mimeType: correspondencia[1].toLowerCase(), bytes: bytes, tamanho: bytes.length };
  }

  function extensao(mimeType) {
    return ({
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'application/pdf': 'pdf'
    })[mimeType] || 'bin';
  }

  function criarMiniatura(dataUrl) {
    if (!root.document || typeof root.Image !== 'function') return Promise.resolve(null);
    return new Promise(function (resolve) {
      var imagem = new root.Image();
      imagem.onload = function () {
        try {
          var limite = 240;
          var largura = imagem.width;
          var altura = imagem.height;
          if (largura > altura && largura > limite) {
            altura = Math.round(altura * limite / largura); largura = limite;
          } else if (altura > limite) {
            largura = Math.round(largura * limite / altura); altura = limite;
          }
          var canvas = root.document.createElement('canvas');
          canvas.width = largura; canvas.height = altura;
          canvas.getContext('2d').drawImage(imagem, 0, 0, largura, altura);
          resolve({ base64: canvas.toDataURL('image/webp', 0.50), largura: largura, altura: altura });
        } catch (_) { resolve(null); }
      };
      imagem.onerror = function () { resolve(null); };
      imagem.src = dataUrl;
    });
  }

  async function uploadStorage(bucket, path, dataUrl) {
    var info = infoDataUrl(dataUrl);
    var blob = new root.Blob([info.bytes], { type: info.mimeType });
    var resposta = await cliente().storage.from(bucket).upload(validarPath(path), blob, {
      contentType: info.mimeType,
      upsert: true,
      cacheControl: '3600'
    });
    if (resposta.error) throw resposta.error;
    return info;
  }

  function hashLeve(bytes) {
    var hash = 2166136261;
    for (var i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  // Foto/PDF do comprovante térmico assinado. A categoria própria impede
  // que este anexo substitua o PDF oficial da OS.
  async function anexarComprovanteTermicoAssinado(entidadeId, numeroOS, dataUrl, nomeOriginal) {
    if (!texto(entidadeId)) throw new Error('Busque uma OS válida antes de anexar o comprovante.');
    var info = infoDataUrl(dataUrl);
    if (['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].indexOf(info.mimeType) === -1) {
      throw new Error('Escolha uma foto JPG/PNG/WEBP ou um arquivo PDF.');
    }
    if (info.tamanho > 12 * 1024 * 1024) throw new Error('O comprovante deve ter no máximo 12 MB.');
    var quem = identidade();
    if (!quem.empresaId) throw new Error('Sessão da empresa indisponível. Entre novamente.');
    var sufixo = hashLeve(info.bytes);
    var ext = extensao(info.mimeType);
    var nomeSeguro = texto(nomeOriginal).replace(/[^a-z0-9._-]+/gi, '-') || ('comprovante-assinado.' + ext);
    if (!new RegExp('\\.' + ext + '$', 'i').test(nomeSeguro)) nomeSeguro += '.' + ext;
    var basePath = quem.empresaId + '/os/' + texto(entidadeId) + '/comprovante-termico-assinado-' + sufixo;
    var bucket = info.mimeType === 'application/pdf' ? 'documentos-pdf' : 'arquivos-os';
    var arquivoPath = basePath + '.' + ext;
    var miniatura = /^image\//.test(info.mimeType) ? await criarMiniatura(dataUrl) : null;
    var miniaturaPath = null;
    try {
      if (miniatura) {
        miniaturaPath = basePath + '-thumb.webp';
        await uploadStorage('miniaturas', miniaturaPath, miniatura.base64);
      }
      await uploadStorage(bucket, arquivoPath, dataUrl);
      var dispositivoId = root.SistemaOSSupabaseSync && root.SistemaOSSupabaseSync.obterDispositivoId
        ? await root.SistemaOSSupabaseSync.obterDispositivoId() : null;
      var resposta = await cliente().rpc('registrar_arquivo', {
        p_entidade_tipo: 'ordem_servico',
        p_entidade_id: entidadeId,
        p_idempotency_key: 'celular:comprovante-termico:' + entidadeId + ':' + sufixo,
        p_dados: {
          categoria: 'comprovante_termico_assinado',
          nome_arquivo: nomeSeguro,
          mime_type: info.mimeType,
          tamanho_bytes: info.tamanho,
          largura: miniatura ? miniatura.largura : null,
          altura: miniatura ? miniatura.altura : null,
          storage_bucket: bucket,
          miniatura_path: miniaturaPath,
          arquivo_nuvem_path: arquivoPath,
          disponibilidade: 'completa_nuvem'
        },
        p_origem_dispositivo_id: dispositivoId
      });
      if (resposta.error) throw resposta.error;
      return normalizar(resposta.data);
    } catch (erro) {
      try { await cliente().storage.from(bucket).remove([arquivoPath]); } catch (_) { /* melhor esforço */ }
      if (miniaturaPath) {
        try { await cliente().storage.from('miniaturas').remove([miniaturaPath]); } catch (_) { /* melhor esforço */ }
      }
      throw erro;
    }
  }

  // Substitui a assinatura do cliente da MESMA OS. O caminho e a chave de
  // idempotência são estáveis: assinar novamente sobrescreve o binário
  // anterior e nunca cria outra OS nem uma sequência de anexos duplicados.
  async function anexarAssinaturaClienteOS(entidadeId, numeroOS, dataUrl) {
    if (!texto(entidadeId)) throw new Error('Busque uma OS válida antes de assinar.');
    var info = infoDataUrl(dataUrl);
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(info.mimeType) === -1) {
      throw new Error('A assinatura gerada não é uma imagem válida.');
    }
    var quem = identidade();
    if (!quem.empresaId) throw new Error('Sessão da empresa indisponível. Entre novamente.');
    var ext = extensao(info.mimeType);
    var basePath = quem.empresaId + '/os/' + texto(entidadeId) + '/assinatura-cliente';
    var arquivoPath = basePath + '.' + ext;
    var miniatura = await criarMiniatura(dataUrl);
    var miniaturaPath = miniatura ? basePath + '-thumb.webp' : null;
    if (miniatura) await uploadStorage('miniaturas', miniaturaPath, miniatura.base64);
    await uploadStorage('arquivos-os', arquivoPath, dataUrl);
    var dispositivoId = root.SistemaOSSupabaseSync && root.SistemaOSSupabaseSync.obterDispositivoId
      ? await root.SistemaOSSupabaseSync.obterDispositivoId() : null;
    var resposta = await cliente().rpc('registrar_arquivo', {
      p_entidade_tipo: 'ordem_servico',
      p_entidade_id: entidadeId,
      p_idempotency_key: 'celular:assinatura-cliente:' + entidadeId,
      p_dados: {
        categoria: 'assinatura_cliente',
        nome_arquivo: 'assinatura-cliente-' + texto(numeroOS || 'os') + '.' + ext,
        mime_type: info.mimeType,
        tamanho_bytes: info.tamanho,
        largura: miniatura ? miniatura.largura : null,
        altura: miniatura ? miniatura.altura : null,
        storage_bucket: 'arquivos-os',
        miniatura_path: miniaturaPath,
        arquivo_nuvem_path: arquivoPath,
        disponibilidade: 'completa_nuvem'
      },
      p_origem_dispositivo_id: dispositivoId
    });
    if (resposta.error) throw resposta.error;
    return normalizar(resposta.data);
  }

  function identidade() {
    var ctx = contexto();
    return {
      empresaId: texto(ctx.empresa_id || ctx.empresaId),
      usuarioId: texto(ctx.usuario_id || ctx.usuarioId)
    };
  }

  function itensDoRegistro(registro) {
    var dados = registro && registro.os ? registro.os : {};
    var tipo = registro && registro.tipoDocumento ? registro.tipoDocumento : 'os';
    var itens = [];
    (Array.isArray(dados.fotos) ? dados.fotos.slice(0, 10) : []).forEach(function (foto, indice) {
      if (foto && foto.base64) itens.push({
        chave: 'foto:' + indice, categoria: 'foto', nomeArquivo: 'foto-entrada-' + (indice + 1), base64: foto.base64
      });
    });
    var assinaturaParte = tipo === 'compra' ? dados.assinaturaVendedorBase64
      : tipo === 'venda' ? dados.assinaturaCompradorBase64
      : tipo === 'entrega' ? dados.assinaturaRetirouBase64
      : dados.assinaturaClienteBase64;
    var categoriaParte = tipo === 'compra' ? 'assinatura_vendedor'
      : tipo === 'venda' ? 'assinatura_comprador'
      : tipo === 'entrega' ? 'assinatura_retirou' : 'assinatura_cliente';
    if (assinaturaParte) itens.push({
      chave: categoriaParte, categoria: categoriaParte, nomeArquivo: categoriaParte.replace(/_/g, '-'), base64: assinaturaParte
    });
    if (dados.assinaturaAssistenciaBase64) itens.push({
      chave: 'assinatura_assistencia', categoria: 'assinatura_assistencia', nomeArquivo: 'assinatura-assistencia', base64: dados.assinaturaAssistenciaBase64
    });
    return itens;
  }

  function entidadeTipoSupabase(tipoDocumento) {
    return tipoDocumento === 'compra' ? 'compra'
      : tipoDocumento === 'venda' ? 'venda'
      : tipoDocumento === 'entrega' ? 'entrega' : 'ordem_servico';
  }

  async function enfileirarArquivosDocumento(registroLocalId, dadosRemotos, tipoDocumento) {
    if (!registroLocalId || !dadosRemotos || !dadosRemotos.id || !root.SistemaOSHistorico) return [];
    var registro = await root.SistemaOSHistorico.obterPorId(registroLocalId);
    if (!registro) return [];
    var tipo = tipoDocumento || registro.tipoDocumento || 'os';
    var itens = itensDoRegistro(registro);
    if (!itens.length) {
      if (root.SistemaOSHistorico.marcarArquivosSupabaseSincronizados) {
        await root.SistemaOSHistorico.marcarArquivosSupabaseSincronizados(registroLocalId);
      }
      return [];
    }
    var quem = identidade();
    var operacoes = [];
    for (var i = 0; i < itens.length; i += 1) {
      var item = itens[i];
      var operacao = {
        id: 'arquivo:' + tipo + ':' + dadosRemotos.id + ':' + item.chave + ':r' + String(dadosRemotos.revision || 1),
        empresaId: quem.empresaId,
        usuarioId: quem.usuarioId,
        entidade: 'arquivo',
        operacao: 'insert',
        entidadeId: dadosRemotos.id,
        idExportacao: (registro.idExportacaoOriginal || registro.id) + ':' + item.chave + ':r' + String(dadosRemotos.revision || 1),
        revisionEsperada: dadosRemotos.revision || null,
        registroLocalId: registroLocalId,
        dados: {
          itemChave: item.chave,
          entidadeTipo: entidadeTipoSupabase(tipo),
          tipoDocumento: tipo,
          categoria: item.categoria,
          nomeArquivo: item.nomeArquivo,
          numeroOS: dadosRemotos.numero || dadosRemotos.numero_os_snapshot || null
        },
        status: 'pendente',
        tentativas: 0,
        criadoEm: new Date().toISOString(),
        ultimoErro: null
      };
      operacoes.push(await root.SistemaOSHistorico.enfileirarOperacaoNuvem(operacao));
    }
    return operacoes;
  }

  function enfileirarArquivosOS(registroLocalId, dadosRemotos) {
    return enfileirarArquivosDocumento(registroLocalId, dadosRemotos, 'os');
  }

  async function enfileirarArquivosPendentes() {
    if (!root.SistemaOSHistorico || !root.SistemaOSHistorico.listarTodos) return [];
    var registros = await root.SistemaOSHistorico.listarTodos();
    var criadas = [];
    for (var i = 0; i < registros.length; i += 1) {
      var registro = registros[i];
      if (['os', 'compra', 'venda', 'entrega'].indexOf(registro.tipoDocumento || 'os') === -1 || !registro.supabaseId ||
          !registro.supabaseRevision || registro.arquivosSincronizadosSupabase === true ||
          !itensDoRegistro(registro).length) continue;
      var novas = await enfileirarArquivosDocumento(registro.id, {
        id: registro.supabaseId,
        revision: registro.supabaseRevision,
        numero: registro.numeroOSAtribuido || null
      }, registro.tipoDocumento || 'os');
      criadas = criadas.concat(novas);
    }
    return criadas;
  }

  function localizarItem(registro, chave) {
    var itens = itensDoRegistro(registro);
    for (var i = 0; i < itens.length; i += 1) if (itens[i].chave === chave) return itens[i];
    return null;
  }

  function classificarErro(erro) {
    if (root.SistemaOSSessao && root.SistemaOSSessao.ehErroRede && root.SistemaOSSessao.ehErroRede(erro)) return 'rede';
    var mensagem = String(erro && erro.message ? erro.message : erro || '').toLowerCase();
    if (/failed to fetch|network|offline|timeout/.test(mensagem)) return 'rede';
    if (/sem-config|configura/.test(mensagem)) return 'configuracao';
    return 'servidor';
  }

  async function processarOperacao(operacao) {
    var registro = await root.SistemaOSHistorico.obterPorId(operacao.registroLocalId);
    var item = localizarItem(registro, operacao.dados && operacao.dados.itemChave);
    if (!item || !item.base64) {
      var ausente = new Error('Arquivo local nao existe mais no historico.');
      ausente.tipo = 'arquivo-ausente';
      throw ausente;
    }
    var info = infoDataUrl(item.base64);
    var ctx = contexto();
    var empresaId = texto(ctx.empresa_id || ctx.empresaId);
    // Fotos e assinaturas de OS precisam estar disponíveis no PC e no
    // celular. Não permita que a configuração econômica transforme anexos
    // em meras miniaturas, pois isso impede gerar/abrir o PDF em outro
    // dispositivo.
    // Com Storage disponível, mantém o original para que o outro dispositivo
    // consiga baixar a foto, assinatura e PDF. Sem Storage não acessa uma
    // API inexistente: a fila continua pendente para a próxima tentativa.
    var clienteAtual = cliente();
    var modo = clienteAtual && clienteAtual.storage && typeof clienteAtual.storage.from === 'function'
      ? 'nuvem' : 'economico';
    var chavePath = texto(operacao.dados.itemChave).replace(/[^a-z0-9_-]+/gi, '-');
    var entidadeTipo = texto(operacao.dados && operacao.dados.entidadeTipo) || 'ordem_servico';
    var pastaTipo = entidadeTipo === 'ordem_servico' ? 'os' : entidadeTipo;
    var basePath = empresaId + '/' + pastaTipo + '/' + operacao.entidadeId + '/' + chavePath;
    var miniatura = /^image\//.test(info.mimeType) ? await criarMiniatura(item.base64) : null;
    var miniaturaPath = null;
    if (miniatura && modo === 'nuvem') {
      miniaturaPath = basePath + '-thumb.webp';
      await uploadStorage('miniaturas', miniaturaPath, miniatura.base64);
    }

    var dadosRpc = {
      categoria: item.categoria,
      nome_arquivo: item.nomeArquivo + '.' + extensao(info.mimeType),
      mime_type: info.mimeType,
      tamanho_bytes: info.tamanho,
      largura: miniatura ? miniatura.largura : null,
      altura: miniatura ? miniatura.altura : null,
      miniatura_path: miniaturaPath
    };
    if (modo === 'nuvem') {
      var bucket = info.mimeType === 'application/pdf' ? 'documentos-pdf' : 'arquivos-os';
      var arquivoPath = basePath + '.' + extensao(info.mimeType);
      await uploadStorage(bucket, arquivoPath, item.base64);
      dadosRpc.storage_bucket = bucket;
      dadosRpc.arquivo_nuvem_path = arquivoPath;
      dadosRpc.disponibilidade = 'completa_nuvem';
    } else {
      // Modo econômico: mantém o original no dispositivo de origem e envia
      // somente miniatura/metadados privados. Não há upload para serviço
      // externo e nem URL pública persistida.
      dadosRpc.disponibilidade = miniaturaPath ? 'miniatura_nuvem' : 'indisponivel';
    }

    var dispositivoId = root.SistemaOSSupabaseSync && root.SistemaOSSupabaseSync.obterDispositivoId
      ? await root.SistemaOSSupabaseSync.obterDispositivoId() : null;
    var rpcArquivo = entidadeTipo === 'ordem_servico' ? 'registrar_arquivo'
      : entidadeTipo === 'entrega' ? 'registrar_arquivo_entrega_mobile'
      : 'registrar_arquivo_comercial_mobile';
    var resposta = await cliente().rpc(
      rpcArquivo, {
      p_entidade_tipo: entidadeTipo,
      p_entidade_id: operacao.entidadeId,
      p_idempotency_key: operacao.idExportacao,
      p_dados: dadosRpc,
      p_origem_dispositivo_id: dispositivoId
      }
    );
    if (resposta.error) {
      resposta.error.tipo = classificarErro(resposta.error);
      throw resposta.error;
    }
    return normalizar(resposta.data);
  }

  async function aposConfirmarOperacao(operacao) {
    if (!operacao || !operacao.registroLocalId || !root.SistemaOSHistorico.listarOperacoesNuvem) return;
    var fila = await root.SistemaOSHistorico.listarOperacoesNuvem();
    var aindaPendente = fila.some(function (item) {
      return item.entidade === 'arquivo' && item.registroLocalId === operacao.registroLocalId &&
        item.status !== 'concluido';
    });
    if (!aindaPendente && root.SistemaOSHistorico.marcarArquivosSupabaseSincronizados) {
      await root.SistemaOSHistorico.marcarArquivosSupabaseSincronizados(operacao.registroLocalId);
    }
  }

  return {
    listarArquivos: listarArquivos,
    obterArquivo: obterArquivo,
    prepararExclusaoOS: prepararExclusaoOS,
    removerManifestoExclusao: removerManifestoExclusao,
    removerArquivosOS: removerArquivosOS,
    _somenteArquivosAtuais: somenteArquivosAtuais,
    obterMetadados: obterMetadados,
    anexarComprovanteTermicoAssinado: anexarComprovanteTermicoAssinado,
    anexarAssinaturaClienteOS: anexarAssinaturaClienteOS,
    enfileirarArquivosOS: enfileirarArquivosOS,
    enfileirarArquivosDocumento: enfileirarArquivosDocumento,
    enfileirarArquivosPendentes: enfileirarArquivosPendentes,
    processarOperacao: processarOperacao,
    aposConfirmarOperacao: aposConfirmarOperacao,
    CAMPOS: CAMPOS,
    _normalizar: normalizar,
    _infoDataUrl: infoDataUrl,
    _itensDoRegistro: itensDoRegistro,
    _classificarErro: classificarErro
  };
});
