/** Consulta leve de garantia no Supabase; sem PDF, fotos ou assinaturas. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSSupabaseGarantia = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var VIEW = 'vw_garantias_leve';
  var CAMPOS_LEVES = [
    'id', 'empresa_id', 'ordem_servico_id', 'numero_os_snapshot',
    'cliente_nome_snapshot', 'aparelho_snapshot', 'marca_snapshot',
    'modelo_snapshot', 'defeito_garantia', 'status', 'data_abertura',
    'garantia_dias', 'data_limite', 'tecnico_id', 'reparo_realizado',
    'observacoes', 'revision', 'created_at', 'updated_at',
    'quantidade_arquivos', 'arquivos_disponiveis'
  ].join(',');

  function texto(valor) {
    return String(valor == null ? '' : valor).trim();
  }

  function numeroAlternativo(numero) {
    var semPrefixo = texto(numero).replace(/^os-/i, '');
    if (!/^\d+$/.test(semPrefixo)) return '';
    return 'OS-' + String(Number(semPrefixo)).padStart(4, '0');
  }

  async function buscarLinha(numero) {
    var cliente = root.SupabaseClientApp.obterCliente();
    var numeroBuscado = texto(numero);
    var resposta = await cliente
      .from(VIEW)
      .select(CAMPOS_LEVES)
      .eq('numero_os_snapshot', numeroBuscado)
      .maybeSingle();
    if (resposta.error) throw resposta.error;
    if (resposta.data || !numeroAlternativo(numeroBuscado) || numeroAlternativo(numeroBuscado) === numeroBuscado) {
      return resposta.data || null;
    }

    resposta = await cliente
      .from(VIEW)
      .select(CAMPOS_LEVES)
      .eq('numero_os_snapshot', numeroAlternativo(numeroBuscado))
      .maybeSingle();
    if (resposta.error) throw resposta.error;
    return resposta.data || null;
  }

  function normalizar(linha) {
    if (!linha) return null;
    return {
      id: linha.id,
      empresaId: linha.empresa_id,
      ordemServicoId: linha.ordem_servico_id,
      numeroOS: linha.numero_os_snapshot,
      cliente: { nome: linha.cliente_nome_snapshot },
      aparelho: {
        nome: linha.aparelho_snapshot,
        marca: linha.marca_snapshot,
        modelo: linha.modelo_snapshot
      },
      defeitoGarantia: linha.defeito_garantia,
      status: linha.status,
      data: linha.data_abertura,
      garantiaDias: linha.garantia_dias,
      dataLimiteGarantia: linha.data_limite,
      tecnicoId: linha.tecnico_id,
      reparoRealizado: linha.reparo_realizado,
      observacoes: linha.observacoes,
      revision: linha.revision,
      createdAt: linha.created_at,
      updatedAt: linha.updated_at,
      quantidadeArquivos: Number(linha.quantidade_arquivos || 0),
      arquivosDisponiveis: linha.arquivos_disponiveis === true
    };
  }

  async function consultarPorNumero(numero) {
    var valor = texto(numero);
    if (!valor) throw new Error('Informe o número da OS.');
    return normalizar(await buscarLinha(valor));
  }

  var STATUS_RETORNO = ['Em análise', 'Em reparo', 'Pronto para retirada', 'Entregue'];

  function usuarioAtual() {
    var contexto = root.SupabaseClientApp?.obterContexto?.() || {};
    return {
      id: texto(contexto.usuario_id || contexto.user_id || contexto.email || 'celular'),
      nome: texto(contexto.nome_usuario || contexto.nome || contexto.email || 'Aplicativo celular')
    };
  }

  async function salvarExtras(linha, extras) {
    var payload = { dados_extras: Object.assign({}, linha.dados_extras || {}, extras || {}) };
    var r = await root.SupabaseClientApp.obterCliente().rpc('salvar_pos_atendimento', {
      p_tipo: 'garantia', p_id: linha.id, p_revision: linha.revision, p_dados: payload
    });
    if (r.error) throw r.error;
    if (!r.data) throw new Error('Esta garantia mudou em outro aparelho. Feche e busque novamente.');
    return r.data;
  }

  async function atualizarStatusOS(numeroOS, statusRetorno) {
    var mapa = { 'Em análise': 'Aguardando análise', 'Em reparo': 'Em reparo', 'Pronto para retirada': 'Pronto para retirada', 'Entregue': 'Entregue' };
    if (!root.CloudData?.consultarOS || !root.CloudData?.atualizarOS) return false;
    try {
      var os = await root.CloudData.consultarOS(numeroOS);
      if (!os?.id) return false;
      await root.CloudData.atualizarOS(os, os.revision, { status: mapa[statusRetorno] });
      return true;
    } catch (erro) {
      console.warn('[Garantia] O retorno foi salvo, mas o status da OS aguardará a próxima sincronização:', erro?.message || erro);
      return false;
    }
  }

  function entregaConcluida(entrega) {
    return !!(entrega && entrega.assinaturaPendente !== true &&
      (entrega.assinado === true || entrega.naoAssinado === true || entrega.assinaturaRetirouBase64));
  }

  async function obterEntregaDoRetorno(numeroOS, retornoId) {
    if (!root.SistemaOSSupabaseEntrega?.obterPorCiclo) return null;
    return root.SistemaOSSupabaseEntrega.obterPorCiclo(numeroOS, retornoId);
  }

  async function prepararEntregaRetorno(linha, retorno) {
    var resposta = await root.SupabaseClientApp.obterCliente().rpc('preparar_entrega_retorno_garantia', {
      p_numero_os: linha.numero_os_snapshot,
      p_retorno_id: retorno.id
    });
    if (resposta.error) throw resposta.error;
    var entrega = await obterEntregaDoRetorno(linha.numero_os_snapshot, retorno.id);
    if (!entrega) throw new Error('A nova entrega da garantia não foi preparada. Tente novamente.');
    return entrega;
  }

  async function registrarRetorno(linha, dados) {
    var motivo = texto(dados?.motivo).slice(0, 600);
    if (motivo.length < 3) throw new Error('Informe o motivo do retorno.');
    var agora = new Date().toISOString();
    var extras = Object.assign({}, linha.dados_extras || {});
    var retornos = Array.isArray(extras.retornosGarantia) ? extras.retornosGarantia.slice() : [];
    var duplicado = retornos.find(function(item) { return item.status !== 'Entregue' && texto(item.motivo).toLowerCase() === motivo.toLowerCase(); });
    if (duplicado) return { linha: linha, retorno: duplicado, duplicado: true };
    var responsavel = usuarioAtual();
    var retorno = {
      id: 'RET-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      status: 'Em análise', motivo: motivo,
      observacaoInicial: texto(dados?.observacao).slice(0, 2000),
      abertoEm: agora, atualizadoEm: agora, encerradoEm: '', responsavel: responsavel,
      historico: [{ status: 'Em análise', em: agora, observacao: texto(dados?.observacao || motivo).slice(0, 2000), usuario: responsavel }]
    };
    retornos.unshift(retorno);
    var salva = await salvarExtras(linha, { retornosGarantia: retornos, retornoAtualId: retorno.id, statusRetorno: retorno.status });
    await atualizarStatusOS(linha.numero_os_snapshot, retorno.status);
    return { linha: salva, retorno: retorno, duplicado: false };
  }

  async function atualizarRetorno(linha, retornoId, dados) {
    var status = texto(dados?.status);
    if (STATUS_RETORNO.indexOf(status) < 0) throw new Error('Selecione um status válido.');
    var extras = Object.assign({}, linha.dados_extras || {});
    var retornos = Array.isArray(extras.retornosGarantia) ? extras.retornosGarantia.slice() : [];
    var indice = retornos.findIndex(function(item) { return item.id === retornoId; });
    if (indice < 0) throw new Error('Retorno não encontrado.');
    var retorno = Object.assign({}, retornos[indice]);
    if (status === 'Entregue') {
      var entregaFinal = await obterEntregaDoRetorno(linha.numero_os_snapshot, retorno.id);
      if (!entregaConcluida(entregaFinal)) {
        throw new Error('Conclua a nova entrega com assinatura ou marque Não assinado antes de finalizar a garantia.');
      }
    }
    var agora = new Date().toISOString();
    var observacao = texto(dados?.observacao).slice(0, 2000);
    retorno.historico = Array.isArray(retorno.historico) ? retorno.historico.slice() : [];
    if (retorno.status !== status || observacao) retorno.historico.push({ status: status, em: agora, observacao: observacao, usuario: usuarioAtual() });
    retorno.status = status;
    retorno.atualizadoEm = agora;
    retorno.encerradoEm = status === 'Entregue' ? agora : '';
    retornos[indice] = retorno;
    var salva = await salvarExtras(linha, { retornosGarantia: retornos, retornoAtualId: retorno.id, statusRetorno: retorno.status });
    await atualizarStatusOS(linha.numero_os_snapshot, retorno.status);
    var entrega = status === 'Pronto para retirada'
      ? await prepararEntregaRetorno(Object.assign({}, linha, salva), retorno)
      : null;
    return { linha: salva, retorno: retorno, entrega: entrega };
  }

  return {
    obterCompleta: async function(numero) {
      var leve = await buscarLinha(numero);
      if (!leve) return null;
      var r = await root.SupabaseClientApp.obterCliente().from('garantias').select('*').eq('id', leve.id).is('deleted_at', null).maybeSingle();
      if (r.error) throw r.error;
      return r.data;
    },
    salvar: async function(linha, alteracoes) {
      var dias = Number(alteracoes.garantia_dias);
      if (!Number.isInteger(dias) || dias < 0 || dias > 36500) throw new Error('Informe um prazo válido, em dias.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(alteracoes.data_abertura || '')) throw new Error('Informe a data inicial.');
      if (!String(alteracoes.cliente_nome_snapshot || '').trim()) throw new Error('Informe o nome do cliente.');
      var campos = ['cliente_nome_snapshot','cliente_telefone_snapshot','marca_snapshot','modelo_snapshot','imei_snapshot','reparo_realizado','termos','data_abertura'];
      var payload = Object.fromEntries(campos.filter(function(c){return Object.hasOwn(alteracoes,c);}).map(function(c){return [c,alteracoes[c]];}));
      payload.garantia_dias = dias;
      payload.dados_extras = Object.assign({}, linha.dados_extras || {}, { clienteCpf: alteracoes.dados_extras?.clienteCpf ?? linha.dados_extras?.clienteCpf ?? '', origem: 'manual' });
      var r = await root.SupabaseClientApp.obterCliente().rpc('salvar_pos_atendimento', {p_tipo:'garantia',p_id:linha.id,p_revision:linha.revision,p_dados:payload});
      if (r.error) throw r.error;
      if (!r.data) throw new Error('Esta garantia mudou em outro aparelho. Feche e busque novamente antes de editar.');
      return r.data;
    },
    registrarRetorno: registrarRetorno,
    atualizarRetorno: atualizarRetorno,
    prepararEntregaRetorno: prepararEntregaRetorno,
    entregaConcluida: entregaConcluida,
    STATUS_RETORNO: STATUS_RETORNO,
    consultarPorNumero: consultarPorNumero,
    CAMPOS_LEVES: CAMPOS_LEVES,
    _normalizar: normalizar
  };
});
