'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const chamados = ler('www', 'js', 'chamados.js');
const assinatura = ler('www', 'js', 'assinaturas-saas.js');
const empresa = ler('www', 'js', 'supabase', 'empresa-service.js');

for (const id of ['usuario-novo-chamado-app', 'telefone-novo-chamado-app', 'email-novo-chamado-app', 'cargo-novo-chamado-app', 'motivo-novo-chamado-app', 'preferencia-contato-novo-chamado-app']) {
  assert.match(chamados, new RegExp(id));
}
assert.match(chamados, /trial_assinatura/);
assert.match(chamados, /Outro motivo/);
assert.match(chamados, /Os campos mudam conforme o motivo/);
assert.match(assinatura, /Seu período de teste chegou ao fim/);
assert.match(assinatura, /45 dias/);
assert.match(assinatura, /SistemaOSChamados\.abrirNovo/);
assert.match(assinatura, /motivo: 'trial_assinatura'/);
assert.match(empresa, /fimTrial <= instanteAtual/);
assert.match(empresa, /período de teste de 45 dias chegou ao fim/);

console.log('OK: Android bloqueia o Trial vencido e abre chamado estruturado e autenticado.');
