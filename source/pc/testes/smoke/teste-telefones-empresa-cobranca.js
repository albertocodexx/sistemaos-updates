'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const estilo = fs.readFileSync(path.join(raiz, 'renderer', 'style.css'), 'utf8');
const edge = fs.readFileSync(path.join(raiz, 'supabase', 'functions', 'admin-global', 'index.ts'), 'utf8');
const migracao = fs.readFileSync(path.join(raiz, 'supabase', 'migrations', '20260811000100_telefones_empresa_cobranca.sql'), 'utf8');

assert.match(runtime, /abrirFormularioNovaEmpresaGlobal/);
assert.match(runtime, /Empresa sem telefone/);
assert.match(runtime, /WhatsApp para cobrança/);
assert.match(runtime, /Usar o telefone principal/);
assert.match(runtime, /editarTelefonesEmpresaGlobal/);
assert.match(runtime, /WhatsApp de cobrança: não informado/);
assert.match(estilo, /\.suporte-nova-empresa-modal/);
assert.match(edge, /acao === 'alterar_telefones_empresa'/);
assert.match(edge, /telefone_principal: telefonePrincipal \|\| null/);
assert.match(edge, /contato_cobranca_whatsapp: telefoneCobranca \|\| null/);
assert.match(edge, /avisos_cobranca_ativos: Boolean\(telefoneCobranca\)/);
assert.match(migracao, /add column if not exists telefone_principal text/);
assert.match(migracao, /add column if not exists empresa_sem_telefone boolean/);

console.log('OK: cadastro de empresa separa telefone principal e WhatsApp de cobrança, com edição e remoção posteriores.');
