'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const ler = rel => fs.readFileSync(path.join(raiz, rel), 'utf8');
const template = require(path.join(raiz, 'www', 'src', 'templates', 'desbloqueio-template.js'));
const tela = ler('www/js/desbloqueios-tela.js');
const consulta = ler('www/js/consulta.js');
const htmlApp = ler('www/index.html');
const migracao = fs.readFileSync(path.resolve(raiz, '..', 'sistemaos-pc', 'supabase', 'migrations', '20260904000200_desbloqueios_clientes_mobile.sql'), 'utf8');

const documento = {
  numero: 'DES-0001', criadoEm: '2026-09-04T12:00:00.000Z',
  cliente: { nome: 'Cliente Teste', clienteId: 10000, cpf: '' },
  aparelho: { marca: 'Samsung', modelo: 'Galaxy S23' },
  tipoBloqueio: 'Senha ou PIN', valor: 90
};
const a4 = template.gerarHtmlDesbloqueio(documento, { nomeEmpresa: 'Assistência Teste' });
const t58 = template.gerarHtmlDesbloqueioTermico(documento, { nomeEmpresa: 'Assistência Teste' }, '58mm');
const t80 = template.gerarHtmlDesbloqueioTermico(documento, { nomeEmpresa: 'Assistência Teste' }, '80mm');

assert.match(a4, /Cliente Teste/);
assert.match(a4, /10000/);
assert.doesNotMatch(a4, />CPF<|AVISO ESSENCIAL|Aviso essencial/);
assert.doesNotMatch(a4, /<div class="assin-label">DATA<\/div>/);
assert.match(t58, /width:58mm/);
assert.match(t80, /width:80mm/);
assert.match(htmlApp, /btn-desbloqueio-assinar/);
assert.match(htmlApp, /btn-desbloqueio-nao-assinado/);
assert.match(htmlApp, /btn-desbloqueio-excluir/);
const trechoCriacao = htmlApp.slice(htmlApp.indexOf('id="painel-desbloqueios"'), htmlApp.indexOf('id="painel-qr"'));
const trechoConsulta = htmlApp.slice(htmlApp.indexOf('id="painel-consulta"'), htmlApp.indexOf('id="painel-cobrancas"'));
assert.doesNotMatch(trechoCriacao, /id="desbloqueio-busca"/);
assert.match(trechoConsulta, /Autorizações de desbloqueio/);
assert.match(trechoConsulta, /id="desbloqueio-busca"/);
assert.match(tela, /salvar_desbloqueio/);
assert.match(tela, /excluir_desbloqueio/);
assert.match(tela, /assinaturaEstado: estado/);
assert.match(tela, /'nao_assinado'/);
assert.match(tela, /postgres_changes/);
assert.match(tela, /sistema-os:tela-consulta-aberta/);
assert.match(consulta, /buscar_cliente_documentos/);
['ordens', 'garantias', 'entregas', 'vendas', 'compras', 'desbloqueios'].forEach(tipo => assert.match(consulta, new RegExp('cliente\\.' + tipo)));
assert.match(migracao, /numero_cliente >= 10000/);
assert.match(migracao, /security definer[\s\S]+set search_path\s*=\s*''/i);
assert.match(migracao, /force row level security/);
assert.doesNotMatch(migracao, /grant\s+(insert|update|delete)\s+on\s+table\s+public\.desbloqueios/i);

console.log('OK: desbloqueio móvel cria cliente/ID, assina ou encerra sem assinatura, edita, exclui, busca e imprime A4/58/80.');
