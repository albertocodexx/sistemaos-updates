'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const assinatura = fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'assinaturas', 'saas.js'), 'utf8');
const plataforma = fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'suporte', 'integracoes-plataforma.js'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const edge = fs.readFileSync(path.join(raiz, 'supabase', 'functions', 'assinaturas-saas', 'index.ts'), 'utf8');
const worker = fs.readFileSync(path.join(raiz, 'supabase', 'functions', 'assinaturas-worker', 'index.ts'), 'utf8');

assert.match(plataforma, /Baileys por QR Code/);
assert.match(plataforma, /Automático \(recomendado\)/);
assert.match(plataforma, /Meta como reserva/);
assert.match(plataforma, /processarFilaBaileys/);
assert.match(edge, /acao === 'buscar_fila_baileys'/);
assert.match(edge, /acao === 'confirmar_envio_baileys'/);
assert.match(edge, /hibrido_baileys_meta/);
assert.match(worker, /Date\.now\(\) - 120000/, 'Meta deve aguardar o Baileys no modo hibrido');
assert.match(assinatura, /dias > 7/, 'aviso deve começar sete dias antes');
assert.match(assinatura, /acao: 'abrir_assinatura'/);
assert.match(runtime, /window\._abrirNotificacao/);
assert.match(runtime, /SistemaOSAssinaturasUI\?\.abrir/);

console.log('OK: lembretes no sininho e WhatsApp híbrido usam Baileys primeiro e Meta como reserva.');
