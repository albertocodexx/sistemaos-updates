const crypto = require('crypto');
const { normalizarTipoItem } = require('../inventory/stock-item');
const { mesclarLembretes, recalcularFinanceiro } = require('./cobrancas-sync');

const CAMPOS = [
  'id', 'empresa_id', 'tipo', 'local_id', 'dados', 'revision',
  'origem_dispositivo_id', 'created_at', 'updated_at', 'deleted_at'
].join(',');
const TAMANHO_PAGINA = 500;

function ordenar(valor) {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.keys(valor).sort().reduce((saida, chave) => {
    saida[chave] = ordenar(valor[chave]);
    return saida;
  }, {});
}

function hash(valor) {
  return crypto.createHash('sha256').update(JSON.stringify(ordenar(valor)) ?? 'undefined').digest('hex');
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

// Uma venda concluída não pode voltar para "Reservado" só porque um celular
// reabriu uma fotografia antiga do formulário de assinatura. Para desfazer
// uma venda existem estados explícitos (Cancelado/Pronto para venda); o
// downgrade silencioso para Reservado é sempre um snapshot obsoleto.
function remotoRegrideVenda(local, remoto) {
  return String(local?.status || '') === 'Vendido'
    && String(remoto?.status || '') === 'Reservado';
}

function conciliarEstoque(base, local, remoto) {
  const saida = { ...remoto };
  if (remotoRegrideVenda(local, remoto)) saida.status = 'Vendido';
  const financeiros = new Set(['lembretesCobranca', 'lembretesCobrancaExcluidos', 'valorRecebidoConfirmado', 'valorRestanteVenda', 'valorRecebidoBaseCobrancas']);
  for (const campo of Object.keys(local)) {
    if (financeiros.has(campo) || hash(local[campo]) === hash(base[campo])) continue;
    if (hash(remoto[campo]) !== hash(base[campo]) && hash(local[campo]) !== hash(remoto[campo])) {
      if (campo === 'status' && remotoRegrideVenda(local, remoto)) { saida.status = local.status; continue; }
      throw new Error(`Conflito no estoque ${local.id}, campo ${campo}. Atualize o registro antes de salvar; nenhuma edição foi descartada.`);
    }
    saida[campo] = local[campo];
  }
  if (financeiros.size && (local.lembretesCobranca?.length || remoto.lembretesCobranca?.length || local.lembretesCobrancaExcluidos?.length)) {
    const mescla = mesclarLembretes(local.lembretesCobranca, remoto.lembretesCobranca, local.lembretesCobrancaExcluidos, remoto.lembretesCobrancaExcluidos);
    const financeiro = recalcularFinanceiro({
      lembretes_cobranca: mescla.lembretes,
      valor_recebido_base_cobrancas: Math.max(Number(local.valorRecebidoBaseCobrancas) || 0, Number(remoto.valorRecebidoBaseCobrancas) || 0)
    }, saida.valorVenda);
    Object.assign(saida, { lembretesCobranca: mescla.lembretes, lembretesCobrancaExcluidos: mescla.exclusoes,
      valorRecebidoConfirmado: financeiro.valor_recebido_confirmado, valorRestanteVenda: financeiro.valor_restante_servico,
      valorRecebidoBaseCobrancas: financeiro.valor_recebido_base_cobrancas });
  } else {
    for (const campo of financeiros) if (local[campo] !== undefined && hash(local[campo]) !== hash(base[campo])) saida[campo] = local[campo];
  }
  return saida;
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
    const data = [];
    const desde = estado.ultimoPullEstoqueEm || '1970-01-01T00:00:00.000Z';
    for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
      const pagina = await cliente.from('estoque_itens').select(CAMPOS)
        .gt('updated_at', desde)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (pagina.error) throw pagina.error;
      data.push(...(pagina.data || []));
      if ((pagina.data || []).length < TAMANHO_PAGINA) break;
    }
    let recebidos = 0;
    let maiorData = estado.ultimoPullEstoqueEm;
    for (const linha of data) {
      const chave = `${linha.tipo}:${linha.local_id}`;
      const mapeado = this.stateStore.obter().mapeamentosEstoque[chave] || null;
      const local = linha.tipo === 'peca'
        ? this.db.obterPecaPorId?.(linha.local_id)
        : this.db.obterItemEstoquePorId?.(linha.local_id);
      const dadosLocais = local ? (linha.tipo === 'peca' ? limparPeca(local) : limparAparelho(local)) : null;
      const localSujo = !!(local && (
        (mapeado?.hashLocal && hash(dadosLocais) !== mapeado.hashLocal)
        || (linha.tipo === 'aparelho' && remotoRegrideVenda(dadosLocais, linha.dados))
      ));

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
        // Não avance a revisão-base de uma edição local. O push precisa
        // comparar a base original com ambas as edições, nunca adotar a
        // revisão mais recente para sobrescrever uma fotografia antiga.
      }
      if (linha.updated_at && linha.updated_at > maiorData) maiorData = linha.updated_at;
    }
    if (data.length) this.stateStore.alterar((s) => { s.ultimoPullEstoqueEm = maiorData; });
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
    const linhasRemotas = [];
    for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
      const pagina = await cliente.from('estoque_itens')
        .select(CAMPOS)
        .order('id', { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (pagina.error) throw pagina.error;
      linhasRemotas.push(...(pagina.data || []));
      if ((pagina.data || []).length < TAMANHO_PAGINA) break;
    }
    const remotaPorChave = new Map(linhasRemotas.map((linha) => [`${linha.tipo}:${linha.local_id}`, linha]));
    let enviados = 0;

    for (const item of locais) {
      const chave = `${item.tipo}:${item.localId}`;
      const mapeado = this.stateStore.obter().mapeamentosEstoque[chave] || null;
      const remota = remotaPorChave.get(chave) || null;
      const hashLocal = hash(item.dados);
      if (mapeado && remota && !remota.deleted_at && !mapeado.deletedAt && mapeado.hashLocal === hashLocal && Number(mapeado.revision) === Number(remota.revision)) continue;
      if (remota?.deleted_at && mapeado && !mapeado.deletedAt) throw new Error(`Estoque ${item.localId} excluído em outro aparelho. Edição local preservada para revisão.`);
      let dados = item.dados;
      if (remota && mapeado && Number(remota.revision) !== Number(mapeado.revision)) {
        if (!mapeado.dadosBase) throw new Error(`Conflito no estoque ${item.localId}: versão antiga sem base de comparação. Edição local preservada.`);
        dados = conciliarEstoque(mapeado.dadosBase, item.dados, remota.dados || {});
      }
      const { data, error } = await cliente.rpc('salvar_item_estoque', {
        p_tipo: item.tipo,
        p_local_id: item.localId,
        p_dados: dados,
        p_revision: remota?.revision || null,
        p_dispositivo_id: estado.dispositivoId || null
      });
      if (error) throw error;
      const linha = Array.isArray(data) ? data[0] : data;
      const confirmado = linha?.dados || dados;
      const atual = this._locais().find(x => x.tipo === item.tipo && x.localId === item.localId);
      if (atual && hash(atual.dados) === hashLocal) this.db.aplicarItemEstoqueSupabase?.(item.tipo, { ...confirmado, id: item.localId });
      this.stateStore.registrarMapeamentoEstoque(item.tipo, item.localId, { ...linha, dados: confirmado }, hash(confirmado));
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

module.exports = { InventoryService, limparAparelho, limparPeca, remotoRegrideVenda, conciliarEstoque };
