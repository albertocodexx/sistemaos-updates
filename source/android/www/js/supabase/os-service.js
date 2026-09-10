/**
 * Consulta leve de OS no Supabase.
 * A view aplica RLS; empresa_id nunca é aceito como parâmetro do APK.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSSupabaseOS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var VIEW = 'vw_ordens_servico_leve';
  var CAMPOS_LEVES = [
    'id', 'empresa_id', 'numero', 'cliente_nome_snapshot',
    'cliente_telefone_snapshot', 'aparelho', 'marca', 'modelo',
    'defeito_relatado', 'observacoes', 'status', 'prioridade', 'tecnico_id',
    'valor', 'forma_pagamento', 'status_pagamento', 'garantia_dias', 'data_abertura',
    'data_prevista', 'hora_prevista', 'data_conclusao', 'revision',
    'created_at', 'updated_at', 'quantidade_arquivos',
    'disponibilidades_arquivos'
  ].join(',');
  // Painéis que não exibem arquivos não devem consultar a view de busca: ela
  // calcula metadados de anexos para cada OS. A tabela já possui RLS por
  // empresa; esta projeção explícita mantém a mesma segurança com uma leitura
  // bem menor para Reparos, Estatísticas e notificações.
  var CAMPOS_LISTA_LEVES = [
    'id', 'empresa_id', 'numero', 'cliente_nome_snapshot',
    'cliente_telefone_snapshot', 'aparelho', 'marca', 'modelo',
    'defeito_relatado', 'observacoes', 'status', 'prioridade', 'tecnico_id',
    'valor', 'forma_pagamento', 'status_pagamento', 'garantia_dias', 'data_abertura',
    'data_prevista', 'hora_prevista', 'data_conclusao', 'revision',
    'created_at', 'updated_at', 'dados_extras'
  ].join(',');
  var CAMPOS_COMPLETOS_COMPROVANTE = [
    'id', 'empresa_id', 'numero', 'cliente_nome_snapshot',
    'cliente_telefone_snapshot', 'cliente_cpf_snapshot', 'aparelho',
    'marca', 'modelo', 'cor', 'imei', 'defeito_relatado', 'diagnostico',
    'servico_realizado', 'status', 'prioridade', 'valor', 'forma_pagamento',
    'status_pagamento', 'garantia_dias', 'data_abertura', 'data_prevista',
    'hora_prevista', 'revision', 'created_at', 'updated_at', 'dados_extras'
  ].join(',');

  // As consultas leves são usadas simultaneamente pela busca, Reparos,
  // Estatísticas e notificações. Sem esta pequena camada de coordenação,
  // dois toques no botão ou um evento Realtime podiam disparar várias
  // leituras iguais contra o Supabase. O cache é curto e é invalidado por
  // qualquer alteração Realtime, portanto não troca atualização por dado
  // antigo.
  var CACHE_CONSULTA_MS = 15000;
  var CACHE_LISTA_MS = 8000;
  var consultasEmAndamento = Object.create(null);
  var consultasEmCache = Object.create(null);
  var listaEmAndamento = null;
  var listaEmAndamentoLimite = 0;
  var listaEmCache = null;

  function texto(valor) {
    return String(valor == null ? '' : valor).trim();
  }

  function numeroAlternativo(numero) {
    var semPrefixo = texto(numero).replace(/^os-/i, '');
    if (!/^\d+$/.test(semPrefixo)) return '';
    return 'OS-' + String(Number(semPrefixo)).padStart(4, '0');
  }

  function chaveConsulta(numero) {
    var valor = texto(numero).toUpperCase().replace(/\s+/g, '');
    return numeroAlternativo(valor) || valor;
  }

  async function buscarLinhaNoServidor(numero) {
    var cliente = root.SupabaseClientApp.obterCliente();
    var numeroBuscado = texto(numero);
    var resposta = await cliente
      .from(VIEW)
      .select(CAMPOS_LEVES)
      .eq('numero', numeroBuscado)
      .maybeSingle();
    if (resposta.error) throw resposta.error;
    if (resposta.data || !numeroAlternativo(numeroBuscado) || numeroAlternativo(numeroBuscado) === numeroBuscado) {
      return resposta.data || null;
    }

    resposta = await cliente
      .from(VIEW)
      .select(CAMPOS_LEVES)
      .eq('numero', numeroAlternativo(numeroBuscado))
      .maybeSingle();
    if (resposta.error) throw resposta.error;
    return resposta.data || null;
  }

  function buscarLinha(numero, opcoes) {
    var chave = chaveConsulta(numero);
    var agora = Date.now();
    var emCache = consultasEmCache[chave];
    var forcar = opcoes && opcoes.forcar === true;
    if (!forcar && emCache && agora - emCache.em <= CACHE_CONSULTA_MS) {
      return Promise.resolve(emCache.linha);
    }
    if (!forcar && consultasEmAndamento[chave]) return consultasEmAndamento[chave];

    var consulta = buscarLinhaNoServidor(numero).then(function (linha) {
      consultasEmCache[chave] = { em: Date.now(), linha: linha };
      return linha;
    }).finally(function () {
      delete consultasEmAndamento[chave];
    });
    consultasEmAndamento[chave] = consulta;
    return consulta;
  }

  function invalidarConsultasLeves() {
    consultasEmCache = Object.create(null);
    listaEmCache = null;
  }

  function disponibilidades(valor) {
    return Array.isArray(valor) ? valor.join(', ') : texto(valor);
  }

  function normalizar(linha) {
    if (Array.isArray(linha)) linha = linha[0];
    if (!linha) return null;
    var extras = linha.dados_extras && typeof linha.dados_extras === 'object'
      ? linha.dados_extras : {};
    return {
      id: linha.id,
      empresaId: linha.empresa_id,
      numero: linha.numero,
      idExportacao: linha.id_exportacao,
      cliente: {
        nome: linha.cliente_nome_snapshot,
        telefone: linha.cliente_telefone_snapshot,
        clienteId: extras.cliente_id_numero || ''
      },
      aparelho: {
        nome: linha.aparelho,
        marca: linha.marca,
        modelo: linha.modelo,
        defeitoRelatado: linha.defeito_relatado
      },
      observacoes: linha.observacoes,
      status: linha.status,
      prioridade: linha.prioridade,
      tecnicoId: linha.tecnico_id,
      valor: linha.valor,
      formaPagamento: linha.forma_pagamento,
      statusPagamento: extras.status_pagamento_local
        || (linha.status_pagamento === 'Autorizado' ? 'Pago' : linha.status_pagamento),
      statusAprovacao: extras.status_aprovacao
        || (linha.status_pagamento === 'Autorizado' ? 'Aprovado' : 'Pendente'),
      percentualPagamentoConfirmado: Number(extras.percentual_pagamento_confirmado || 0),
      valorRecebidoConfirmado: Number(extras.valor_recebido_confirmado || 0),
      percentualPagamentoAguardado: Number(extras.percentual_pagamento_aguardado || 0),
      valorTotalServico: Number(extras.valor_total_servico || linha.valor || 0),
      valorRestanteServico: Number(extras.valor_restante_servico || 0),
      entrada50Paga: extras.entrada_50_paga === true,
      modalidadePagamentoAprovacao: extras.modalidade_pagamento_aprovacao || '',
      modalidadeParcela1: extras.modalidade_parcela_1 || '',
      modalidadeParcela2: extras.modalidade_parcela_2 || '',
      lembretesCobranca: Array.isArray(extras.lembretes_cobranca) ? extras.lembretes_cobranca : [],
      assinaturaPendente: extras.assinatura_pendente === true,
      naoAssinado: extras.nao_assinado === true,
      garantiaDias: linha.garantia_dias,
      data: linha.data_abertura,
      dataPrevista: linha.data_prevista,
      horaPrevista: linha.hora_prevista,
      semPrazo: !linha.data_prevista && !linha.hora_prevista,
      dataConclusao: linha.data_conclusao,
      revision: linha.revision,
      createdAt: linha.created_at,
      updatedAt: linha.updated_at,
      deletedAt: linha.deleted_at || null,
      quantidadeArquivos: Number(linha.quantidade_arquivos || 0),
      disponibilidadesArquivos: disponibilidades(linha.disponibilidades_arquivos),
      dadosExtras: extras
    };
  }

  async function consultarPorNumero(numero, opcoes) {
    var valor = texto(numero);
    if (!valor) throw new Error('Informe o número da OS.');
    return normalizar(await buscarLinha(valor, opcoes));
  }

  function normalizarCompleta(linha) {
    var os = normalizar(linha);
    if (!os || !linha) return os;
    var extras = linha.dados_extras || {};
    os.cliente.cpf = linha.cliente_cpf_snapshot || '';
    os.aparelho.cor = linha.cor || '';
    os.aparelho.imei = linha.imei || '';
    os.aparelho.tipoEquipamento = extras.tipo_equipamento || '';
    os.diagnosticoTecnico = {
      diagnostico: linha.diagnostico || '',
      solucao: linha.servico_realizado || '',
      valorEstimado: linha.valor || 0,
      prazoEstimado: extras.sem_prazo ? 'Sem prazo definido' : ''
    };
    os.assinaturaPendente = extras.assinatura_pendente === true;
    os.naoAssinado = extras.nao_assinado === true;
    return os;
  }

  async function consultarCompletaPorNumero(numero) {
    var valor = texto(numero);
    if (!valor) throw new Error('Informe o número da OS.');
    var numeroNormalizado = numeroAlternativo(valor) || valor;
    var resposta = await root.SupabaseClientApp.obterCliente()
      .from('ordens_servico')
      .select(CAMPOS_COMPLETOS_COMPROVANTE)
      .eq('numero', numeroNormalizado)
      .is('deleted_at', null)
      .maybeSingle();
    if (resposta.error) throw resposta.error;
    return normalizarCompleta(resposta.data);
  }

  // Lista compacta para painéis de prazos e estatísticas. Mantém a mesma
  // projeção leve usada na consulta; fotos, PDF, assinaturas e termos nunca
  // seguem nesta requisição.
  function limiteSeguro(limite) {
    return Math.min(Math.max(Number(limite) || 200, 1), 500);
  }

  function normalizarLista(linhas, limite) {
    return (linhas || []).slice(0, limite).map(normalizar);
  }

  async function listarLevesNoServidor(limite) {
    var resposta = await root.SupabaseClientApp.obterCliente()
      .from('ordens_servico')
      .select(CAMPOS_LISTA_LEVES)
      .is('deleted_at', null)
      .order('data_prevista', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(limite);
    if (resposta.error) throw resposta.error;
    return resposta.data || [];
  }

  function listarLeves(limite) {
    var limitePedido = limiteSeguro(limite);
    var agora = Date.now();
    if (listaEmCache && listaEmCache.limite >= limitePedido &&
        agora - listaEmCache.em <= CACHE_LISTA_MS) {
      return Promise.resolve(normalizarLista(listaEmCache.linhas, limitePedido));
    }
    // Um pedido maior contém integralmente o resultado dos pedidos menores.
    // Compartilhamos a mesma Promise para os painéis que acordam juntos.
    if (listaEmAndamento && listaEmAndamentoLimite >= limitePedido) {
      return listaEmAndamento.then(function (linhas) {
        return normalizarLista(linhas, limitePedido);
      });
    }

    listaEmAndamentoLimite = limitePedido;
    var operacaoLista = listarLevesNoServidor(limitePedido).then(function (linhas) {
      listaEmCache = { em: Date.now(), limite: limitePedido, linhas: linhas };
      return linhas;
    }).finally(function () {
      // Se surgiu uma consulta maior enquanto esta ainda terminava, ela é a
      // dona do estado atual e não pode ser apagada por esta Promise antiga.
      if (listaEmAndamento === operacaoLista) {
        listaEmAndamento = null;
        listaEmAndamentoLimite = 0;
      }
    });
    listaEmAndamento = operacaoLista;
    return operacaoLista.then(function (linhas) {
      return normalizarLista(linhas, limitePedido);
    });
  }

  function primeiro() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') return arguments[i];
    }
    return '';
  }

  // O APK envia apenas campos de negocio conhecidos. Numero, empresa e
  // revision nunca atravessam esta fronteira: sao definidos pelo servidor.
  function dadosParaCriacao(dados) {
    dados = dados || {};
    var cliente = dados.cliente || {};
    var aparelho = dados.aparelho || {};
    var semPrazo = dados.semPrazo === true || (!primeiro(dados.data_prevista, dados.dataPrevista) && !primeiro(dados.hora_prevista, dados.horaPrevista));
    return {
      cliente_nome_snapshot: primeiro(dados.cliente_nome_snapshot, cliente.nome),
      cliente_telefone_snapshot: primeiro(dados.cliente_telefone_snapshot, cliente.telefone),
      cliente_cpf_snapshot: primeiro(dados.cliente_cpf_snapshot, cliente.cpf),
      aparelho: primeiro(dados.aparelhoNome, [aparelho.marca, aparelho.modelo].filter(Boolean).join(' ')),
      marca: primeiro(dados.marca, aparelho.marca),
      modelo: primeiro(dados.modelo, aparelho.modelo),
      cor: primeiro(dados.cor, aparelho.cor),
      imei: primeiro(dados.imei, aparelho.imei, aparelho.imei1),
      senha_aparelho: primeiro(dados.senha_aparelho, aparelho.senhaAparelho, aparelho.senha),
      acessorios: primeiro(dados.acessorios, aparelho.acessorios, aparelho.acessoriosTexto),
      defeito_relatado: primeiro(dados.defeito_relatado, aparelho.defeitoRelatado),
      observacoes: primeiro(dados.observacoes, aparelho.observacoes),
      termos: primeiro(dados.termos),
      status: primeiro(dados.status, 'Aguardando análise'),
      prioridade: primeiro(dados.prioridade, 'Normal'),
      valor: primeiro(dados.valor, 0),
      forma_pagamento: primeiro(dados.forma_pagamento, dados.formaPagamento),
      status_pagamento: primeiro(dados.status_pagamento, dados.statusPagamento) === 'Pago'
        ? 'Autorizado'
        : (primeiro(dados.status_pagamento, dados.statusPagamento) === 'Pago 50%'
            ? 'Aguardando Pagamento na Retirada'
            : primeiro(dados.status_pagamento, dados.statusPagamento)),
      garantia_dias: Number(primeiro(dados.garantia_dias, dados.garantiaDias, 0)) || 0,
      data_abertura: primeiro(dados.data_abertura, dados.dataAbertura, dados.data, new Date().toISOString()),
      data_prevista: semPrazo ? null : primeiro(dados.data_prevista, dados.dataPrevista),
      hora_prevista: semPrazo ? null : primeiro(dados.hora_prevista, dados.horaPrevista),
      dados_extras: {
        cliente_email: primeiro(cliente.email),
        cliente_id_numero: primeiro(cliente.clienteId),
        tipo_equipamento: primeiro(aparelho.tipoEquipamento, aparelho.tipo),
        aparelho_observacoes: primeiro(aparelho.observacoes),
        assinatura_pendente: dados.assinaturaPendente === true,
        nao_assinado: dados.naoAssinado === true,
        status_aprovacao: primeiro(dados.statusAprovacao, 'Pendente'),
        status_pagamento_local: primeiro(dados.statusPagamento, dados.status_pagamento),
        lembretes_cobranca: Array.isArray(dados.lembretesCobranca) ? dados.lembretesCobranca : [],
        sem_prazo: semPrazo
      }
    };
  }

  var MAPA_PATCH = {
    'cliente.nome': 'cliente_nome_snapshot',
    'cliente.telefone': 'cliente_telefone_snapshot',
    'cliente.cpf': 'cliente_cpf_snapshot',
    'aparelho.marca': 'marca',
    'aparelho.modelo': 'modelo',
    'aparelho.cor': 'cor',
    'aparelho.imei': 'imei',
    'aparelho.defeitoRelatado': 'defeito_relatado',
    'aparelho.acessorios': 'acessorios',
    'aparelho.senhaAparelho': 'senha_aparelho',
    dataPrevista: 'data_prevista',
    horaPrevista: 'hora_prevista',
    garantiaDias: 'garantia_dias',
    formaPagamento: 'forma_pagamento',
    statusPagamento: 'status_pagamento'
  };
  var CAMPOS_PATCH = [
    'cliente_id', 'cliente_nome_snapshot', 'cliente_telefone_snapshot', 'cliente_cpf_snapshot',
    'aparelho', 'marca', 'modelo', 'cor', 'imei', 'senha_aparelho', 'acessorios',
    'estado_aparelho', 'defeito_relatado', 'diagnostico', 'servico_realizado',
    'observacoes', 'termos', 'status', 'prioridade', 'tecnico_id', 'valor',
    'forma_pagamento', 'status_pagamento', 'garantia_dias', 'data_prevista',
    'hora_prevista', 'data_conclusao', 'dados_extras'
  ];

  function patchParaServidor(patch) {
    var saida = {};
    Object.keys(patch || {}).forEach(function (chave) {
      var destino = MAPA_PATCH[chave] || chave;
      if (CAMPOS_PATCH.indexOf(destino) !== -1) saida[destino] = patch[chave];
    });
    return saida;
  }

  function ehErroRede(erro) {
    if (root.SistemaOSSessao && typeof root.SistemaOSSessao.ehErroRede === 'function') {
      return root.SistemaOSSessao.ehErroRede(erro);
    }
    var mensagem = String(erro && erro.message ? erro.message : erro || '').toLowerCase();
    return !!(erro && (erro.status === 0 || erro.name === 'TypeError' || erro.name === 'FunctionsFetchError')) ||
      /failed to fetch|failed to send|network|internet|offline|fetch failed|networkerror|timeout/.test(mensagem);
  }

  function classificarErro(erro) {
    if (erro && (erro.code === '40001' || /conflito_revision/i.test(erro.message || ''))) return 'conflito';
    if (ehErroRede(erro)) return 'rede';
    if (erro && (erro.code === 'P0002' || /nao encontrada|n.o encontrada/i.test(erro.message || ''))) return 'nao-encontrada';
    if (erro && erro.code === '42501') return 'permissao';
    return 'servidor';
  }

  function lancarResposta(resposta) {
    if (!resposta || !resposta.error) return resposta ? resposta.data : null;
    resposta.error.tipo = classificarErro(resposta.error);
    throw resposta.error;
  }

  async function criar(dados, idExportacao, origemDispositivoId) {
    var id = texto(idExportacao);
    if (!id) throw new Error('idExportacao e obrigatorio para criar a OS.');
    var resposta = await root.SupabaseClientApp.obterCliente().rpc('criar_ordem_servico', {
      p_id_exportacao: id,
      p_dados: dadosParaCriacao(dados),
      p_origem_dispositivo_id: origemDispositivoId || null
    });
    return normalizar(lancarResposta(resposta));
  }

  async function atualizar(id, revisionEsperada, patch) {
    var patchServidor = patchParaServidor(patch);
    if (!texto(id)) throw new Error('Id da OS e obrigatorio para atualizar.');
    if (!Number(revisionEsperada)) throw new Error('Revision esperada e obrigatoria para atualizar.');
    if (!Object.keys(patchServidor).length) throw new Error('Nenhum campo editavel foi informado.');
    var resposta = await root.SupabaseClientApp.obterCliente().rpc('atualizar_ordem_servico', {
      p_id: id,
      p_revision: Number(revisionEsperada),
      p_patch: patchServidor
    });
    return normalizar(lancarResposta(resposta));
  }

  async function excluir(id, revisionEsperada) {
    if (!texto(id)) throw new Error('Id da OS e obrigatorio para excluir.');
    if (!Number(revisionEsperada)) throw new Error('Revision esperada e obrigatoria para excluir.');
    if (root.SistemaOSSupabaseArquivo && typeof root.SistemaOSSupabaseArquivo.removerArquivosOS === 'function') {
      await root.SistemaOSSupabaseArquivo.removerArquivosOS(id);
    }
    var resposta = await root.SupabaseClientApp.obterCliente().rpc('excluir_ordem_servico', {
      p_id: id,
      p_revision: Number(revisionEsperada)
    });
    return normalizar(lancarResposta(resposta));
  }

  // Um único canal atende Reparos e notificações. Antes, cada consumidor
  // abria o próprio canal e recebia o mesmo evento várias vezes; cada um
  // iniciava uma nova consulta leve. Agrupamos alterações próximas para uma
  // única atualização por rajada, sem perder a última versão do servidor.
  var canalRealtime = null;
  var clienteCanalRealtime = null;
  var assinantesRealtime = [];
  var timerRealtime = null;

  function avisarAssinantesRealtime(evento) {
    invalidarConsultasLeves();
    if (timerRealtime) root.clearTimeout(timerRealtime);
    timerRealtime = root.setTimeout(function () {
      timerRealtime = null;
      assinantesRealtime.slice().forEach(function (assinante) {
        try { assinante(evento); } catch (_) { /* um painel não interrompe os demais */ }
      });
    }, 800);
  }

  function garantirCanalRealtime() {
    if (canalRealtime || !assinantesRealtime.length) return;
    var cliente = root.SupabaseClientApp.obterCliente();
    if (!cliente || typeof cliente.channel !== 'function') return;
    clienteCanalRealtime = cliente;
    canalRealtime = cliente.channel('ordens-servico-mobile-compartilhado')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordens_servico' }, avisarAssinantesRealtime)
      .subscribe();
  }

  function encerrarCanalRealtimeSeOcioso() {
    if (assinantesRealtime.length || !canalRealtime) return;
    if (timerRealtime) root.clearTimeout(timerRealtime);
    timerRealtime = null;
    if (clienteCanalRealtime && typeof clienteCanalRealtime.removeChannel === 'function') {
      clienteCanalRealtime.removeChannel(canalRealtime);
    }
    canalRealtime = null;
    clienteCanalRealtime = null;
  }

  // Realtime avisa a tela Reparos sempre que PC ou celular alterar uma OS.
  // A RLS continua isolando os eventos da empresa autenticada.
  function assinar(onChange) {
    if (typeof onChange !== 'function') return function () {};
    assinantesRealtime.push(onChange);
    garantirCanalRealtime();
    var ativo = true;
    return function () {
      if (!ativo) return;
      ativo = false;
      assinantesRealtime = assinantesRealtime.filter(function (assinante) { return assinante !== onChange; });
      encerrarCanalRealtimeSeOcioso();
    };
  }

  return {
    consultarPorNumero: consultarPorNumero,
    consultarCompletaPorNumero: consultarCompletaPorNumero,
    listarLeves: listarLeves,
    criar: criar,
    atualizar: atualizar,
    excluir: excluir,
    assinar: assinar,
    CAMPOS_LEVES: CAMPOS_LEVES,
    CAMPOS_LISTA_LEVES: CAMPOS_LISTA_LEVES,
    CAMPOS_COMPLETOS_COMPROVANTE: CAMPOS_COMPLETOS_COMPROVANTE,
    _normalizar: normalizar,
    _dadosParaCriacao: dadosParaCriacao,
    _patchParaServidor: patchParaServidor,
    _classificarErro: classificarErro,
    _invalidarConsultasLeves: invalidarConsultasLeves
  };
});
