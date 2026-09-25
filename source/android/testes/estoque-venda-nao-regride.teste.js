'use strict';

const assert = require('assert');
const path = require('path');

let dadosEnviados = null;
const remoto = {
  id: 'uuid-remoto', tipo: 'aparelho', local_id: 'EST-0001', revision: 9,
  updated_at: new Date().toISOString(),
  dados: { id: 'EST-0001', marca: 'Samsung', modelo: 'S20FE', status: 'Vendido', valorGastoPecas: 290 }
};
global.SupabaseClientApp = { obterCliente() { return {
  from() { return {
    select() { return this; }, eq() { return this; }, is() { return this; },
    maybeSingle: async () => ({ data: remoto, error: null })
  }; },
  rpc: async (_nome, parametros) => {
    dadosEnviados = parametros.p_dados;
    return { data: Object.assign({}, remoto, { revision: 10, dados: dadosEnviados }), error: null };
  }
}; } };
global.SistemaOSSupabaseSync = { obterDispositivoId: async () => 'device-android' };

const estoque = require(path.resolve(__dirname, '..', 'www', 'js', 'supabase', 'estoque-service.js'));

(async () => {
  await estoque.registrarVenda({
    estoqueLocalId: 'EST-0001', marca: 'Samsung', modelo: 'S20FE', valorVenda: 590,
    assinaturaPendente: true, naoAssinado: false, assinaturaCompradorBase64: ''
  });
  assert.strictEqual(dadosEnviados.status, 'Vendido',
    'pedido antigo de assinatura não pode rebaixar venda confirmada pelo PC');
  assert.strictEqual(dadosEnviados.valorGastoPecas, 290, 'custos de peças do PC devem ser preservados');
  console.log('OK: Android preserva venda e peças confirmadas no PC.');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
