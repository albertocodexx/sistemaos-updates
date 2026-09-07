/** Consulta leve de entrega no Supabase; arquivos ficam apenas como metadados. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSSupabaseEntrega = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var VIEW = 'vw_entregas_leve';
  var CAMPOS_LEVES = [
    'id', 'empresa_id', 'ordem_servico_id', 'numero_os_snapshot',
    'cliente_nome_snapshot', 'retirado_por', 'aparelho_snapshot',
    'marca_snapshot', 'modelo_snapshot', 'reparo_realizado', 'status',
    'entregue_em', 'garantia_dias', 'data_limite_garantia',
    'forma_entrega', 'observacoes', 'revision', 'created_at', 'updated_at',
    'assinatura_disponivel', 'comprovante_disponivel', 'fotos_disponiveis',
    'disponibilidades_arquivos', 'nao_assinado', 'assinatura_pendente',
    'ciclo_entrega_id', 'retorno_garantia_id', 'tipo_entrega', 'garantia_id'
  ].join(',');

  function texto(valor) {
    return String(valor == null ? '' : valor).trim();
  }

  function numeroAlternativo(numero) {
    var semPrefixo = texto(numero).replace(/^os-/i, '');
    if (!/^\d+$/.test(semPrefixo)) return '';
    return 'OS-' + String(Number(semPrefixo)).padStart(4, '0');
  }

  function aplicarCiclo(consulta, cicloId) {
    return cicloId == null ? consulta : consulta.eq('ciclo_entrega_id', texto(cicloId) || 'original');
  }

  async function buscarLinha(numero, cicloId) {
    var cliente = root.SupabaseClientApp.obterCliente();
    var numeroBuscado = texto(numero);
    var consulta = cliente
      .from(VIEW)
      .select(CAMPOS_LEVES)
      .eq('numero_os_snapshot', numeroBuscado);
    var resposta = await aplicarCiclo(consulta, cicloId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (resposta.error) throw resposta.error;
    if (resposta.data || !numeroAlternativo(numeroBuscado) || numeroAlternativo(numeroBuscado) === numeroBuscado) {
      return resposta.data || null;
    }

    consulta = cliente
      .from(VIEW)
      .select(CAMPOS_LEVES)
      .eq('numero_os_snapshot', numeroAlternativo(numeroBuscado));
    resposta = await aplicarCiclo(consulta, cicloId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (resposta.error) throw resposta.error;
    return resposta.data || null;
  }

  function disponibilidades(valor) {
    return Array.isArray(valor) ? valor.join(', ') : texto(valor);
  }

  function normalizar(linha) {
    if (!linha) return null;
    return {
      id: linha.id,
      empresaId: linha.empresa_id,
      ordemServicoId: linha.ordem_servico_id,
      numeroOS: linha.numero_os_snapshot,
      cliente: { nome: linha.cliente_nome_snapshot },
      nomeRetirou: linha.retirado_por,
      aparelho: {
        nome: linha.aparelho_snapshot,
        marca: linha.marca_snapshot,
        modelo: linha.modelo_snapshot
      },
      reparoRealizado: linha.reparo_realizado,
      status: linha.assinatura_pendente || linha.status === 'pendente_assinatura' ? 'Aguardando assinatura' : linha.nao_assinado ? 'Não assinado' : linha.assinatura_disponivel ? 'Assinado' : 'Sem assinatura registrada',
      naoAssinado: linha.nao_assinado === true,
      assinaturaPendente: linha.assinatura_pendente === true || linha.status === 'pendente_assinatura',
      dataHoraEntrega: linha.entregue_em,
      garantiaDias: linha.garantia_dias,
      dataLimiteGarantia: linha.data_limite_garantia,
      formaEntrega: linha.forma_entrega,
      observacoes: linha.observacoes,
      cicloEntregaId: linha.ciclo_entrega_id || 'original',
      retornoGarantiaId: linha.retorno_garantia_id || '',
      tipoEntrega: linha.tipo_entrega || (linha.retorno_garantia_id ? 'retorno_garantia' : 'original'),
      garantiaId: linha.garantia_id || '',
      revision: linha.revision,
      createdAt: linha.created_at,
      updatedAt: linha.updated_at,
      assinaturaDisponivel: linha.assinatura_disponivel === true,
      comprovanteDisponivel: linha.comprovante_disponivel === true,
      fotosDisponiveis: linha.fotos_disponiveis === true,
      disponibilidadesArquivos: disponibilidades(linha.disponibilidades_arquivos)
    };
  }

  async function consultarPorNumero(numero, cicloId) {
    var valor = texto(numero);
    if (!valor) throw new Error('Informe o número da OS.');
    return normalizar(await buscarLinha(valor, cicloId));
  }

  function documentoCompleto(linha, leve) {
    if (!linha) return null;
    var d = Object.assign({}, linha.dados_extras && linha.dados_extras.documento_mobile || {});
    var retornoId = linha.retorno_garantia_id || d.retornoGarantiaId || '';
    return Object.assign(d, {
      id: linha.id, revision: linha.revision, numeroOS: linha.numero_os_snapshot,
      nomeRetirou: linha.retirado_por || d.nomeRetirou || '', cpfRetirou: linha.documento_retirada || '',
      marca: linha.marca_snapshot || '', modelo: linha.modelo_snapshot || '', reparoRealizado: linha.reparo_realizado || '',
      garantiaDias: linha.garantia_dias, dataHoraAssinatura: linha.entregue_em,
      valorReparo: linha.valor_reparo, formaPagamento: linha.forma_pagamento || '',
      cicloEntregaId: linha.ciclo_entrega_id || d.cicloEntregaId || retornoId || 'original',
      retornoGarantiaId: retornoId,
      tipoEntrega: linha.tipo_entrega || d.tipoEntrega || (retornoId ? 'retorno_garantia' : 'original'),
      garantiaId: linha.garantia_id || d.garantiaId || '',
      assinaturaPendente: linha.assinatura_pendente === true || linha.status === 'pendente_assinatura' || d.assinaturaPendente === true,
      naoAssinado: linha.nao_assinado === true || d.naoAssinado === true,
      assinado: !!(leve && leve.assinatura_disponivel === true && d.naoAssinado !== true && d.assinaturaPendente !== true)
    });
  }

  return {
    obterCompleta: async function(numero, cicloId) {
      var leve = await buscarLinha(numero, cicloId);
      if (!leve) return null;
      var r = await root.SupabaseClientApp.obterCliente().from('entregas').select('*').eq('id', leve.id).is('deleted_at', null).maybeSingle();
      if (r.error) throw r.error;
      return documentoCompleto(r.data, leve);
    },
    obterPorCiclo: function(numero, cicloId) { return this.obterCompleta(numero, cicloId); },
    consultarPorNumero: consultarPorNumero,
    CAMPOS_LEVES: CAMPOS_LEVES,
    _normalizar: normalizar,
    _documentoCompleto: documentoCompleto
  };
});
