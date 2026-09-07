'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

const migracao = ler('supabase', 'migrations', '20260807000100_assinaturas_saas_automaticas.sql');
const webhook = ler('supabase', 'functions', 'mercado-pago-saas-webhook', 'index.ts');
const worker = ler('supabase', 'functions', 'assinaturas-worker', 'index.ts');
const assinaturas = ler('supabase', 'functions', 'assinaturas-saas', 'index.ts');
const renderer = ler('renderer', 'modules', 'assinaturas', 'saas.js');
const fiscal = ler('supabase', 'functions', 'fiscal-documentos', 'index.ts');
const whatsapp = ler('src', 'whatsapp.js');

assert.match(migracao, /create table if not exists public\.cobrancas_assinatura/i);
assert.match(migracao, /create or replace function public\.aplicar_pagamento_assinatura/i);
assert.match(migracao, /on public\.cobrancas_assinatura \(provedor, pagamento_provedor_id\)/i);
assert.match(migracao, /create table if not exists public\.fila_whatsapp/i);
assert.match(migracao, /create table if not exists public\.notas_fiscais/i);
assert.match(webhook, /x-signature/i);
assert.match(webhook, /aplicar_pagamento_assinatura/i);
assert.match(worker, /gerar_alertas_assinatura/i);
assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/i);
assert.match(assinaturas, /X-Idempotency-Key/i);
assert.match(assinaturas, /notification_url/i);
assert.match(renderer, /criar_checkout/i);
assert.match(renderer, /Minha assinatura/i);
assert.match(renderer, /function escaparHtml/);
assert.match(renderer, /escaparHtml\(plano\.nome\)/);
assert.match(renderer, /Number\.isNaN\(data\.getTime\(\)\)/);
assert.match(renderer, /status\.planoNome/);
assert.match(renderer, /contingencia: true/);
assert.match(renderer, /if \(!resumo\?\.empresa\) return null/);
assert.match(fiscal, /aguardando_configuracao/i);
assert.match(whatsapp, /enviarMensagemRoteada/i);
assert.doesNotMatch(renderer, /service_role|access_token/i);

console.log('OK: assinaturas SaaS, confirmação automática, WhatsApp e base fiscal protegidos.');
