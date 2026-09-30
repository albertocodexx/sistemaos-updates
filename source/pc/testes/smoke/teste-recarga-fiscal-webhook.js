'use strict';
// Executa o webhook real com Mercado Pago e Supabase simulados: nenhum pagamento real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto, createHmac } = require('node:crypto');

async function main() {
  const segredo = 'segredo-qa-fiscal-com-mais-de-24-caracteres';
  const recarga = {
    id: 'recarga-qa', empresa_id: 'empresa-a', referencia_externa: 'FISCAL-empresa-a-recarga-qa',
    valor_centavos: 100, valor_estornado_centavos: 0, status: 'pendente',
    aplicado_em: null, estornado_em: null, pagamento_provedor_id: null
  };
  const pagamento = {
    id: 12345, external_reference: recarga.referencia_externa,
    transaction_amount: 1, transaction_amount_refunded: 0,
    currency_id: 'BRL', live_mode: true, status: 'approved'
  };
  let creditos = 0;
  let estornos = 0;
  const admin = {
    from(tabela) {
      assert.equal(tabela, 'recargas_fiscais');
      let atualizacao = null;
      let referencia = null;
      let id = null;
      let semEstorno = false;
      const q = {
        select() { return q; },
        update(valor) { atualizacao = valor; return q; },
        eq(campo, valor) {
          if (campo === 'referencia_externa') referencia = valor;
          if (campo === 'id') id = valor;
          return q;
        },
        is(campo, valor) { if (campo === 'estornado_em' && valor === null) semEstorno = true; return q; },
        async maybeSingle() {
          if (referencia && referencia !== recarga.referencia_externa) return { data: null, error: null };
          if (id && id !== recarga.id) return { data: null, error: null };
          if (semEstorno && recarga.estornado_em) return { data: null, error: null };
          if (atualizacao) Object.assign(recarga, atualizacao);
          return { data: { ...recarga }, error: null };
        }
      };
      return q;
    },
    async rpc(nome, args) {
      if (nome === 'aplicar_recarga_fiscal') {
        if (!recarga.aplicado_em && recarga.status === 'aprovada' && recarga.pagamento_provedor_id === args.p_pagamento_id) {
          creditos += recarga.valor_centavos - recarga.valor_estornado_centavos;
          recarga.aplicado_em = '2026-09-25T00:00:00Z';
        }
      } else if (nome === 'estornar_recarga_fiscal') {
        const delta = args.p_total_estornado_centavos - recarga.valor_estornado_centavos;
        if (delta > 0) {
          if (recarga.aplicado_em) estornos += delta;
          recarga.valor_estornado_centavos += delta;
          if (recarga.valor_estornado_centavos === recarga.valor_centavos) recarga.estornado_em = '2026-09-25T00:00:00Z';
        }
      } else throw new Error(`RPC inesperada: ${nome}`);
      return { data: {}, error: null };
    }
  };
  let handler;
  let codigo = fs.readFileSync(path.join(__dirname, '../../supabase/functions/mercado-pago-saas-webhook/index.ts'), 'utf8');
  codigo = codigo.replace(/^import .*createClient.*;\r?\n/m, '');
  const ambiente = {
    Request, Response, Headers, URL, TextEncoder, TextDecoder, Uint8Array,
    crypto: webcrypto, AbortSignal, atob,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: (nome) => nome === 'SUPABASE_URL' ? 'https://qa.invalid' : 'fixture-local' },
      serve: (funcao) => { handler = funcao; } },
    createClient: () => admin,
    fetch: async () => new Response(JSON.stringify(pagamento), { status: 200 })
  };
  vm.createContext(ambiente);
  vm.runInContext(stripTypeScriptTypes(codigo), ambiente);
  vm.runInContext(`carregarIntegracaoPlataforma = async () => ({ integracao: { id: 'qa' },
    segredo: { access_token: 'token-qa', webhook_secret: '${segredo}' } });`, ambiente);
  const enviar = async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = `qa-${Math.random()}`;
    const assinatura = createHmac('sha256', segredo)
      .update(`id:${pagamento.id};request-id:${requestId};ts:${ts};`).digest('hex');
    const pedido = new Request('https://qa.invalid/webhook?type=payment&data.id=12345', {
      method: 'POST', body: JSON.stringify({ type: 'payment', data: { id: 12345 } }),
      headers: { 'content-type': 'application/json', 'x-signature': `ts=${ts},v1=${assinatura}`, 'x-request-id': requestId }
    });
    return handler(pedido);
  };
  assert.equal((await enviar()).status, 200);
  assert.equal(creditos, 100);
  assert.equal((await enviar()).status, 200);
  assert.equal(creditos, 100, 'webhook repetido nao duplica credito');
  pagamento.transaction_amount_refunded = 0.3;
  assert.equal((await enviar()).status, 200);
  assert.equal(estornos, 30);
  assert.equal((await enviar()).status, 200);
  assert.equal(estornos, 30, 'webhook repetido nao duplica estorno');
  pagamento.status = 'refunded';
  pagamento.transaction_amount_refunded = 1;
  assert.equal((await enviar()).status, 200);
  assert.equal(estornos, 100);
  pagamento.status = 'approved';
  pagamento.transaction_amount_refunded = 0;
  assert.equal((await enviar()).status, 200);
  assert.equal(creditos, 100, 'pagamento antigo nao reativa recarga estornada');
  pagamento.transaction_amount = 2;
  assert.equal((await enviar()).status, 200);
  assert.equal(creditos, 100, 'valor divergente nao credita');
  console.log('OK: webhook fiscal assinado, valor BRL, confirmacao unica, estorno parcial/total e evento atrasado.');
}
main().catch((erro) => { console.error(erro); process.exitCode = 1; });
