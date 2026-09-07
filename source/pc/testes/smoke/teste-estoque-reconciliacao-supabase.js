const assert = require('assert');
const { InventoryService } = require('../../src/supabase/inventory-service');

const estado = {
  dispositivoId: 'device-pc-1',
  ultimoPullEstoqueEm: '1970-01-01T00:00:00.000Z',
  mapeamentosEstoque: {}
};
const stateStore = {
  obter: () => estado,
  alterar: (fn) => fn(estado),
  registrarMapeamentoEstoque(tipo, localId, linha, hashLocal) {
    estado.mapeamentosEstoque[`${tipo}:${localId}`] = {
      id: linha.id,
      tipo,
      localId,
      revision: linha.revision,
      deletedAt: linha.deleted_at || null,
      hashLocal
    };
  }
};

let chamadasRpc = 0;
const cliente = {
  from(tabela) {
    assert.strictEqual(tabela, 'estoque_itens');
    return {
      select() {
        return {
          limit: async () => ({ data: [], error: null })
        };
      }
    };
  },
  async rpc(nome, parametros) {
    assert.strictEqual(nome, 'salvar_item_estoque');
    chamadasRpc += 1;
    return {
      data: {
        id: `nuvem-${chamadasRpc}`,
        tipo: parametros.p_tipo,
        local_id: parametros.p_local_id,
        revision: chamadasRpc,
        deleted_at: null
      },
      error: null
    };
  }
};
const db = {
  listarEstoque: () => [{
    id: 'EST-0001', tipoEquipamento: 'Smartphone', marca: 'Samsung',
    modelo: 'Galaxy S23', status: 'Em reparo', valorVenda: 750
  }],
  listarPecas: () => []
};

(async () => {
  const servico = new InventoryService({ getClient: () => cliente, stateStore, db });
  assert.strictEqual(await servico.enviar(), 1, 'primeiro push deve publicar o aparelho');
  assert.strictEqual(await servico.enviar(), 1,
    'mapeamento local não pode ocultar que a linha foi removida da nuvem');
  assert.strictEqual(chamadasRpc, 2, 'item ausente deve ser republicado mesmo com hash inalterado');
  console.log('OK: estoque do PC se reconcilia após limpeza da nuvem e reaparece no APK.');
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
