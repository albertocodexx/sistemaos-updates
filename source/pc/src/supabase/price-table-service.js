function primeiraLinha(data) {
  return Array.isArray(data) ? data[0] : data;
}

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

class PriceTableService {
  constructor({ getClient, getContext }) {
    this.getClient = getClient;
    this.getContext = getContext;
  }

  _client() {
    const client = this.getClient?.();
    const context = this.getContext?.();
    if (!client || !context?.empresa_id) {
      throw new Error('Entre novamente para acessar a tabela de preços.');
    }
    return client;
  }

  async listar() {
    const { data, error } = await this._client()
      .from('tabela_precos')
      .select('id,modelo,peca,valor,fornecedor,observacoes,revision,created_at,updated_at')
      .is('deleted_at', null)
      .order('modelo', { ascending: true })
      .order('peca', { ascending: true })
      .limit(3000);
    if (error) throw error;
    return (data || []).map(normalizar);
  }

  async salvar(dados = {}) {
    const modelo = String(dados.modelo || '').trim();
    const peca = String(dados.peca || '').trim();
    const valor = Number(dados.valor);
    if (!modelo || !peca || !Number.isFinite(valor) || valor < 0) {
      throw new Error('Informe o modelo, a peça ou serviço e um valor válido.');
    }
    const { data, error } = await this._client().rpc('salvar_tabela_preco_v2', {
      p_id: dados.id || null,
      p_modelo: modelo,
      p_peca: peca,
      p_valor: Math.round(valor * 100) / 100,
      p_fornecedor: String(dados.fornecedor || '').trim(),
      p_observacoes: String(dados.observacoes || '').trim(),
      p_revision: Number(dados.revision) || null
    });
    if (error) throw error;
    return normalizar(primeiraLinha(data));
  }

  async excluir(id, revision) {
    if (!id) throw new Error('Preço não encontrado.');
    const { data, error } = await this._client().rpc('excluir_tabela_preco', {
      p_id: id,
      p_revision: Number(revision) || null
    });
    if (error) throw error;
    return normalizar(primeiraLinha(data));
  }
}

module.exports = { PriceTableService, normalizar };
