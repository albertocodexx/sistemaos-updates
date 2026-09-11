'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

// Simula respostas HTTP e tabelas em memória; executa as funções reais do worker.
function bancoMemoria(tabelas, rpc) {
  return { rpc, from(tabela) {
    const filtros = []; let alteracao, unico = false, limite = Infinity, ordem;
    const q = {
      select() { return q; }, update(v) { alteracao = v; return q; },
      eq(k, v) { filtros.push(r => r[k] === v); return q; },
      is(k, v) { filtros.push(r => (r[k] ?? null) === v); return q; },
      in(k, v) { filtros.push(r => v.includes(r[k])); return q; },
      lt(k, v) { filtros.push(r => r[k] < v); return q; },
      lte(k, v) { filtros.push(r => r[k] <= v); return q; },
      or() { return q; }, order(k) { ordem = k; return q; }, limit(n) { limite = n; return q; },
      maybeSingle() { unico = true; return q; },
      then(resolve, reject) {
        try {
          const lista = (tabelas[tabela] || []).filter(r => filtros.every(f => f(r)));
          if (ordem) lista.sort((a, b) => String(a[ordem]).localeCompare(String(b[ordem])));
          const selecionada = lista.slice(0, limite);
          if (alteracao) selecionada.forEach(r => Object.assign(r, alteracao));
          return Promise.resolve({ data: unico ? selecionada[0] || null : selecionada.map(r => ({ ...r })), error: null }).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(resolve, reject); }
      }
    }; return q;
  } };
}

async function main() {
  const agora = new Date().toISOString();
  const cobrancas = [
    { id: 'c1', referencia_externa: 'SAAS-c1', valor: 50, moeda: 'BRL', status: 'aprovada', aplicado_em: null, updated_at: '2026-01-01' },
    { id: 'c2', referencia_externa: 'SAAS-c2', valor: 70, moeda: 'BRL', status: 'rejeitada', aplicado_em: null, updated_at: '2026-01-02' }
  ];
  const fila = [
    { id: 'f-antiga', status: 'processando', updated_at: '2026-01-01' },
    ...['f1', 'f2'].map(id => ({ id, status: 'pendente', destinatario: '5511999999999', tentativas: 0,
      max_tentativas: 6, agendada_para: agora, created_at: agora, updated_at: agora,
      template_nome: 'sistemaos_pagamento_confirmado', parametros: {} }))
  ];
  let falhaAplicacao = true, aplicacoes = 0, envios = 0;
  const banco = bancoMemoria({ cobrancas_assinatura: cobrancas, fila_whatsapp: fila }, async (_nome, p) => {
    if (falhaAplicacao && p.p_cobranca_id === 'c1') return { error: { message: 'falha simulada' } };
    const c = cobrancas.find(c => c.id === p.p_cobranca_id);
    if (!c.aplicado_em) { c.aplicado_em = agora; aplicacoes++; }
    return { error: null };
  });
  const contexto = {
    console: { log() {}, error() {} }, Request, Response, URL, AbortSignal,
    Deno: { serve() {}, env: { get() { return ''; } } },
    cors: {}, resposta() {}, texto: v => String(v ?? '').trim(),
    mapearStatusMercadoPago: s => s === 'approved' ? 'aprovada' : 'pendente',
    carregarIntegracaoPlataforma: async (_a, tipo) => tipo === 'mercado_pago'
      ? { integracao: {}, segredo: { access_token: 'fixture' } }
      : { integracao: { provedor: 'meta_cloud_api', metadados: { phone_number_id: 'fixture', templates: { pagamento_confirmado: 'confirmado' } } }, segredo: { access_token: 'fixture' } },
    fetch: async url => {
      if (url.includes('graph.facebook.com')) {
        if (++envios === 1) throw new Error('Conexão perdida depois da transmissão');
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.fixture' }] }));
      }
      const ref = new URL(url).searchParams.get('external_reference');
      const c = cobrancas.find(c => c.referencia_externa === ref);
      const valido = { id: c.id === 'c1' ? '1' : '2', external_reference: ref, transaction_amount: c.valor,
        currency_id: 'BRL', status: 'approved', date_approved: agora, live_mode: true };
      return new Response(JSON.stringify({ results: [
        { ...valido, id: '3', status: 'rejected' }, { ...valido, id: '4', currency_id: 'ARS' }, valido
      ] }));
    }
  };
  vm.createContext(contexto);
  const fonte = fs.readFileSync(path.join(__dirname, '../../supabase/functions/assinaturas-worker/index.ts'), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '');
  vm.runInContext(stripTypeScriptTypes(fonte) + '\nglobalThis.reconciliar = reconciliarMercadoPago; globalThis.mensagens = processarWhatsApp;', contexto);
  await contexto.reconciliar(banco);
  assert.equal(aplicacoes, 1, 'falha de uma cobrança não impede pagamento posterior válido');
  assert.equal(cobrancas[0].aplicado_em, null);
  falhaAplicacao = false;
  await contexto.reconciliar(banco);
  assert.equal(aplicacoes, 2, 'aprovada sem aplicado_em volta para reconciliação');
  await contexto.reconciliar(banco);
  assert.equal(aplicacoes, 2, 'repetição não renova dias em dobro');
  const resultado = await contexto.mensagens(banco);
  assert.equal(resultado.enviadas, 1);
  assert.equal(resultado.falhas, 1);
  assert.equal(fila[0].status, 'cancelada', 'interrupção antiga não fica invisível em processando');
  assert.equal(fila[1].status, 'cancelada', 'envio ambíguo não é repetido automaticamente');
  assert.equal(fila[2].status, 'enviada', 'outras mensagens continuam');
  assert.equal(fila[2].id_mensagem_provedor, 'wamid.fixture');
  console.log('OK: worker real recupera pagamento aprovado, prefere transação válida, evita reaplicação e isola falhas de mensagens.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
