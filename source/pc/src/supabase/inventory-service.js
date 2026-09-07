const crypto = require('crypto');
const { normalizarTipoItem } = require('../inventory/stock-item');

const CAMPOS = [
  'id', 'empresa_id', 'tipo', 'local_id', 'dados', 'revision',
  'origem_dispositivo_id', 'created_at', 'updated_at', 'deleted_at'
].join(',');

function ordenar(valor) {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.keys(valor).sort().reduce((saida, chave) => {
    saida[chave] = ordenar(valor[chave]);
    return saida;
  }, {});
}

function hash(valor) {
  return crypto.createHash('sha256').update(JSON.stringify(ordenar(valor))).digest('hex');
}

function limparAparelho(item) {
  const copia = Object.assign({}, item || {});
  [
    'pdfVendaPath', 'assinaturaCompradorBase64', 'assinaturaAssistenciaBase64',
    'fotos', 'checklist', 'historicoStatus'
  ].forEach((campo) => delete copia[campo]);
  return copia;
}

function limparPeca(item) {
  const copia = Object.assign({}, item || {});
  copia.tipoItem = normalizarTipoItem(copia.tipoItem);
  return copia;
}

class InventoryService {
  constructor({ getClient, stateStore, db }) {
    this.getClient = getClient;
    this.stateStore = stateStore;
    this.db = db;
  }

  _locais() {
    return [
      ...(this.db.listarEstoque?.() || []).map((dados) => ({ tipo: 'aparelho', localId: dados.id, dados: limparAparelho(dados) })),
      ...(this.db.listarPecas?.() || []).map((dados) => ({ tipo: 'peca', localId: dados.id, dados: limparPeca(dados) }))
    ];
  }

  async baixar() {
    const cliente = this.getClient();
    const estado = this.stateStore.obter();
    const { data, error } = await cliente.from('estoque_itens').select(CAMPOS)
      .gt('updated_at', estado.ultimoPullEstoqueEm || '1970-01-01T00:00:00.000Z')
      .order('updated_at', { ascending: true }).limit(1000);
    if (error) throw error;
    let recebidos = 0;
    let maiorData = estado.ultimoPullEstoqueEm;
    for (const linha of (data || [])) {
      const chave = `${linha.tipo}:${linha.local_id}`;
      const mapeado = this.stateStore.obter().mapeamentosEstoque[chave] || null;
      const local = linha.tipo === 'peca'
        ? this.db.obterPecaPorId?.(linha.local_id)
        : this.db.obterItemEstoquePorId?.(linha.local_id);
      const dadosLocais = local ? (linha.tipo === 'peca' ? limparPeca(local) : limparAparelho(local)) : null;
      const localSujo = !!(local && mapeado?.hashLocal && hash(dadosLocais) !== mapeado.hashLocal);

      if (!localSujo) {
        if (linha.deleted_at) this.db.removerItemEstoqueSupabase?.(linha.tipo, linha.local_id);
        else this.db.aplicarItemEstoqueSupabase?.(linha.tipo, Object.assign({}, linha.dados, { id: linha.local_id }));
        const aplicado = linha.deleted_at ? null : (linha.tipo === 'peca'
          ? this.db.obterPecaPorId?.(linha.local_id)
          : this.db.obterItemEstoquePorId?.(linha.local_id));
        const dadosAplicados = aplicado ? (linha.tipo === 'peca' ? limparPeca(aplicado) : limparAparelho(aplicado)) : null;
        this.stateStore.registrarMapeamentoEstoque(linha.tipo, linha.local_id, linha, dadosAplicados ? hash(dadosAplicados) : '');
        recebidos += 1;
      } else {
        // Mantém a edição local, mas atualiza a revision remota usada no push.
        this.stateStore.registrarMapeamentoEstoque(linha.tipo, linha.local_id, linha, mapeado.hashLocal);
      }
      if (linha.updated_at && linha.updated_at > maiorData) maiorData = linha.updated_at;
    }
    if (data?.length) this.stateStore.alterar((s) => { s.ultimoPullEstoqueEm = maiorData; });
    return recebidos;
  }

  async enviar() {
    const cliente = this.getClient();
    const estado = this.stateStore.obter();
    const locais = this._locais();
    const chavesLocais = new Set(locais.map((item) => `${item.tipo}:${item.localId}`));
    // Reconcilia as chaves de verdade existentes na nuvem. O estado local
    // pode continuar dizendo "já enviado" depois de uma limpeza manual ou
    // restauração do Supabase; nesse cenário o hash era igual e o aparelho
    // nunca era republicado, por isso não aparecia no Android.
    const remotas = await cliente.from('estoque_itens')
      .select('id,tipo,local_id,revision,deleted_at').limit(5000);
    if (remotas.error) throw remotas.error;
    const remotaPorChave = new Map((remotas.data || []).map((linha) => [`${linha.tipo}:${linha.local_id}`, linha]));
    let enviados = 0;

    for (const item of locais) {
      const chave = `${item.tipo}:${item.localId}`;
      const mapeado = this.stateStore.obter().mapeamentosEstoque[chave] || null;
      const remota = remotaPorChave.get(chave) || null;
      const hashLocal = hash(item.dados);
      if (mapeado && remota && !remota.deleted_at && !mapeado.deletedAt && mapeado.hashLocal === hashLocal) continue;
      const { data, error } = await cliente.rpc('salvar_item_estoque', {
        p_tipo: item.tipo,
        p_local_id: item.localId,
        p_dados: item.dados,
        p_revision: remota?.revision || null,
        p_dispositivo_id: estado.dispositivoId || null
      });
      if (error) throw error;
      const linha = Array.isArray(data) ? data[0] : data;
      this.stateStore.registrarMapeamentoEstoque(item.tipo, item.localId, linha, hashLocal);
      enviados += 1;
    }

    for (const [chave, mapeado] of Object.entries(this.stateStore.obter().mapeamentosEstoque || {})) {
      if (chavesLocais.has(chave) || mapeado.deletedAt || !mapeado.id) continue;
      const { data, error } = await cliente.rpc('excluir_item_estoque', {
        p_id: mapeado.id,
        p_revision: mapeado.revision || null,
        p_dispositivo_id: estado.dispositivoId || null
      });
      if (error) throw error;
      const linha = Array.isArray(data) ? data[0] : data;
      this.stateStore.registrarMapeamentoEstoque(mapeado.tipo, mapeado.localId, linha, '');
      enviados += 1;
    }
    return enviados;
  }

  async sincronizar() {
    // Baixa primeiro, mas preserva itens que mudaram localmente desde o último
    // hash conhecido; depois publica essas alterações.
    const recebidos = await this.baixar();
    const enviados = await this.enviar();
    return { recebidos, enviados };
  }
}

module.exports = { InventoryService, limparAparelho, limparPeca };
