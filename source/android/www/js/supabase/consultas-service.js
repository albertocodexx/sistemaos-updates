/* Consultas por documento, independentes do vínculo legado com clientes.
 * Somente o cliente autenticado/RLS; nunca aceita empresa ou usuário na busca.
 * Retorna campos leves, sem baixar PDFs, fotos ou assinaturas.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSConsultasBusca = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var TIPOS = {
    os: { view: 'vw_ordens_servico_leve', campos: ['numero','cliente_nome_snapshot','cliente_telefone_snapshot','marca','modelo','imei'], numero: 'numero', prefixo: 'OS', servico: 'SistemaOSSupabaseOS' },
    entrega: { view: 'vw_entregas_leve', campos: ['numero_os_snapshot','cliente_nome_snapshot','retirado_por','marca_snapshot','modelo_snapshot'], numero: 'numero_os_snapshot', prefixo: 'OS', servico: 'SistemaOSSupabaseEntrega' },
    garantia: { view: 'vw_garantias_leve', campos: ['numero_os_snapshot','cliente_nome_snapshot','marca_snapshot','modelo_snapshot'], numero: 'numero_os_snapshot', prefixo: 'OS', servico: 'SistemaOSSupabaseGarantia' },
    compra: { view: 'vw_compras_leve', campos: ['numero','fornecedor_nome','descricao'], numero: 'numero', prefixo: 'CP' },
    venda: { view: 'vw_vendas_leve', campos: ['numero','cliente_nome_snapshot'], numero: 'numero', prefixo: 'VD' },
    desbloqueio: { view: 'desbloqueios', campos: ['numero','cliente_nome_snapshot','cliente_telefone_snapshot','cliente_cpf_snapshot','marca','modelo','cor'], numero: 'numero', prefixo: 'DES' }
  };
  var CAMPOS_DESBLOQUEIO = 'id,numero,cliente_numero_snapshot,cliente_nome_snapshot,cliente_telefone_snapshot,cliente_cpf_snapshot,marca,modelo,cor,assinatura_estado,created_at,updated_at,revision';
  function texto(v) { return String(v == null ? '' : v).trim(); }
  function literal(v) { return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function padrao(termo) {
    // %, _ e * digitados são literais, nunca ampliam toda a consulta.
    return '%' + termo.replace(/[\\%_*]/g, '\\$&').replace(/\s+/g, '%') + '%';
  }
  function normalizar(tipo, linha) {
    var servico = root[TIPOS[tipo].servico];
    if (servico && servico._normalizar) return servico._normalizar(linha);
    return {
      id: linha.id, numero: linha.numero, revision: linha.revision,
      clienteNome: linha.cliente_nome_snapshot || linha.fornecedor_nome,
      clienteId: linha.cliente_numero_snapshot,
      clienteTelefone: linha.cliente_telefone_snapshot, clienteCpf: linha.cliente_cpf_snapshot,
      aparelhoMarca: linha.marca, aparelhoModelo: linha.modelo, cor: linha.cor,
      descricao: linha.descricao, valor: linha.valor_total, formaPagamento: linha.forma_pagamento,
      status: linha.status, estadoAssinatura: linha.assinatura_estado === 'assinado' ? 'Assinado'
        : linha.assinatura_estado === 'aguardando' ? 'Aguardando assinatura' : tipo === 'desbloqueio' ? 'Não assinado' : '',
      data: linha.data_compra || linha.data_venda || linha.created_at
    };
  }
  async function buscar(tipo, termo) {
    if (!Object.hasOwn(TIPOS, tipo)) throw new Error('Tipo de documento inválido.');
    termo = texto(termo);
    if (!termo || termo.length > 120) throw new Error('Informe um nome ou número com até 120 caracteres.');
    var config = TIPOS[tipo];
    var client = root.SupabaseClientApp.obterCliente();
    var q = client.from(config.view).select(tipo === 'desbloqueio' ? CAMPOS_DESBLOQUEIO : '*');
    if (tipo === 'desbloqueio') q = q.is('deleted_at', null);
    var numero = termo.match(/^(?:(?:OS|CP|VD|VEN|DES)[-\s]*)?(\d+)$/i);
    var filtros = config.campos.map(function (campo) { return campo + '.ilike.' + literal(padrao(termo)); });
    if (numero) filtros.push(config.numero + '.eq.' + literal(config.prefixo + '-' + String(Number(numero[1])).padStart(4, '0')));
    var resposta = await q.or(filtros.join(',')).order('updated_at', { ascending: false }).limit(51);
    if (resposta.error) throw resposta.error;
    return { itens: (resposta.data || []).slice(0, 50).map(function (linha) { return { tipo: tipo, dados: normalizar(tipo, linha) }; }), mais: (resposta.data || []).length > 50 };
  }
  return { buscar: buscar, normalizar: normalizar, tipos: Object.keys(TIPOS), _padrao: padrao, _literal: literal };
});
