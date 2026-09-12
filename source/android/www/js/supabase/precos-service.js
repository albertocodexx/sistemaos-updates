(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSTabelaPrecos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var PREFIXO_CACHE = 'sistema-os-tabela-precos-v1:';

  function empresaId() {
    var contexto = root.SistemaOSPermissoes?.obterContexto?.() || {};
    return String(contexto.empresa_id || contexto.empresaId || 'sem-sessao');
  }
  function chaveCache() { return PREFIXO_CACHE + empresaId(); }
  function cliente() {
    if (!root.SupabaseClientApp) throw new Error('Conexão com o servidor indisponível.');
    return root.SupabaseClientApp.obterCliente();
  }
  function linha(data) { return Array.isArray(data) ? data[0] : data; }
  function normalizar(item) {
    if (!item) return null;
    return {
      id: item.id,
      modelo: String(item.modelo || '').trim(),
      peca: String(item.peca || '').trim(),
      valor: Number(item.valor) || 0,
      fornecedor: String(item.fornecedor || '').trim(),
      observacoes: String(item.observacoes || '').trim(),
      revision: Number(item.revision) || 1,
      createdAt: item.created_at || '',
      updatedAt: item.updated_at || ''
    };
  }
  function listarCache() {
    try {
      var salvo = JSON.parse(root.localStorage?.getItem(chaveCache()) || '[]');
      return Array.isArray(salvo) ? salvo.slice(0, 3000) : [];
    } catch (_) { return []; }
  }
  function salvarCache(itens) {
    try { root.localStorage?.setItem(chaveCache(), JSON.stringify((itens || []).slice(0, 3000))); }
    catch (_) { /* o cache não pode bloquear o cadastro */ }
  }

  async function listar() {
    var resposta = await cliente().from('tabela_precos')
      .select('id,modelo,peca,valor,fornecedor,observacoes,revision,created_at,updated_at')
      .is('deleted_at', null)
      .order('modelo', { ascending: true })
      .order('peca', { ascending: true })
      .limit(3000);
    if (resposta.error) throw resposta.error;
    var itens = (resposta.data || []).map(normalizar);
    salvarCache(itens);
    return itens;
  }

  async function salvar(dados) {
    dados = dados || {};
    var modelo = String(dados.modelo || '').trim();
    var peca = String(dados.peca || '').trim();
    var valor = Number(dados.valor);
    if (!modelo || !peca || !Number.isFinite(valor) || valor < 0) {
      throw new Error('Informe modelo, peça ou serviço e valor válido.');
    }
    var resposta = await cliente().rpc('salvar_tabela_preco_v2', {
      p_id: dados.id || null,
      p_modelo: modelo,
      p_peca: peca,
      p_valor: Math.round(valor * 100) / 100,
      p_fornecedor: String(dados.fornecedor || '').trim(),
      p_observacoes: String(dados.observacoes || '').trim(),
      p_revision: Number(dados.revision) || null
    });
    if (resposta.error) throw resposta.error;
    return normalizar(linha(resposta.data));
  }

  async function excluir(item) {
    var resposta = await cliente().rpc('excluir_tabela_preco', {
      p_id: item && item.id,
      p_revision: Number(item && item.revision) || null
    });
    if (resposta.error) throw resposta.error;
    return normalizar(linha(resposta.data));
  }

  function assinar(onChange) {
    var clienteAtual = cliente();
    if (typeof clienteAtual.channel !== 'function') return function () {};
    var canal = clienteAtual.channel('tabela-precos-mobile-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tabela_precos' }, function () {
        if (typeof onChange === 'function') onChange();
      }).subscribe();
    return function () {
      if (typeof clienteAtual.removeChannel === 'function') clienteAtual.removeChannel(canal);
    };
  }

  return {
    listar: listar,
    listarCache: listarCache,
    salvar: salvar,
    excluir: excluir,
    assinar: assinar
  };
});
