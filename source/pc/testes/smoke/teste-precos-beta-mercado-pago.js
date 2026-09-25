'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const migracao = ler('supabase', 'migrations', '20260920000100_precos_competitivos_beta_fundador.sql');
const edge = ler('supabase', 'functions', 'assinaturas-saas', 'index.ts');
const pc = ler('renderer', 'modules', 'assinaturas', 'saas.js');
const mobile = fs.readFileSync(path.resolve(raiz, '..', 'sistemaos-android', 'www', 'js', 'assinaturas-saas.js'), 'utf8');
const suporte = ler('renderer', 'modules', 'suporte', 'integracoes-plataforma.js');

assert.match(migracao, /beta_fundador boolean not null default false/i);
assert.match(migracao, /created_at < '2026-09-20/i);
assert.match(migracao, /when 'basico' then 59\.90/i);
assert.match(edge, /betaFundador && ehPlanoBasico\(plano\) \? 49\.90/);
assert.match(edge, /quantidadeMeses >= 12 \? 15/);
assert.match(edge, /integracao\.metadados\?\.webhook_assinado !== true/);
assert.match(edge, /integracao\.metadados\?\.ambiente !== 'producao'/);
assert.match(edge, /\^APP_USR-/);
assert.match(edge, /webhookSecret\.length < 16/);
assert.match(edge, /signal: AbortSignal\.timeout\(15000\)/);
assert.match(edge, /quantity: 1/);
assert.match(edge, /unit_price: valorTotal/);
assert.match(pc, /Preço fundador do beta/);
assert.match(pc, /12 meses · 15% de desconto/);
assert.match(mobile, /Preço fundador exclusivo/);
assert.match(mobile, /quantidadeMeses: oferta\.quantidade/);
assert.match(suporte, /Assinatura secreta do webhook/);
assert.match(suporte, /Obrigatória para validar cada confirmação/);

console.log('OK: preço público, benefício beta e Mercado Pago de produção estão protegidos.');
