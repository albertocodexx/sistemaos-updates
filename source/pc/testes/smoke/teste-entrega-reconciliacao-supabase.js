const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DesktopStateStore } = require('../../src/supabase/desktop-state-store');
const { DesktopSupabaseRuntime } = require('../../src/supabase/desktop-runtime');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-os-entrega-pull-'));
  try {
    const stateStore = new DesktopStateStore(temp);
    const entrega = {
      id: 'entrega-21', numero_os_snapshot: 'OS-0021', id_exportacao: 'entrega-mobile-21',
      revision: 2, valor_reparo: 190, forma_pagamento: 'Pix', deleted_at: null,
      created_at: '2026-07-24T10:00:00.000Z', updated_at: '2026-07-24T10:01:00.000Z',
      dados_extras: {
        documento_mobile: {
          numeroOS: '21', nomeRetirou: 'Cliente', reparoRealizado: 'Tela',
          assinaturaPendente: false, naoAssinado: true
        },
        valor_total: 190
      }
    };
    const queryVazia = () => {
      const q = { select: () => q, gte: () => q, order: () => q, limit: async () => ({ data: [], error: null }) };
      return q;
    };
    const queryEntrega = () => {
      const q = { select: () => q, is: () => q, order: () => q, limit: async () => ({ data: [entrega], error: null }) };
      return q;
    };
    const runtime = new DesktopSupabaseRuntime();
    runtime.stateStore = stateStore;
    runtime.client = {
      from: (tabela) => tabela === 'entregas' ? queryEntrega() : queryVazia()
    };
    runtime._baixarArquivosDocumentoComercial = async () => ({ assinaturas: {}, fotos: [], paraConsumo: [] });
    const recebidos = [];
    runtime.processadorDocumentoComercialRemoto = async (pacote) => {
      recebidos.push(pacote);
      return { sucesso: true };
    };

    assert.strictEqual(await runtime._baixarDocumentosComerciais(), 1);
    assert.strictEqual(recebidos[0].itens[0].dados.numeroOS, '21');
    assert.strictEqual(recebidos[0].itens[0].dados.valorReparo, 190);
    assert.strictEqual(recebidos[0].itens[0].dados.formaPagamento, 'Pix');
    assert.strictEqual(recebidos[0].itens[0].dados.naoAssinado, true);
    assert.strictEqual(await runtime._baixarDocumentosComerciais(), 0, 'mesma versao nao deve ser reimportada');
    assert.strictEqual(recebidos.length, 1);
    console.log('OK: entrega do Android e reconciliada no PC e processada uma unica vez por versao.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
