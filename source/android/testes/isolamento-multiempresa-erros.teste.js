'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const raiz = path.join(__dirname, '..');
const codigoConfig = fs.readFileSync(path.join(raiz, 'www/js/config.js'), 'utf8');
const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only', url: 'https://app.local/' });
const win = dom.window;
win.eval(codigoConfig);

win.ConfigApp.definirEmpresa('empresa-a');
win.ConfigApp.salvarConfig({ nomeFantasia: 'Empresa A' });
win.ConfigApp.definirEmpresa('empresa-b');
assert.notEqual(win.ConfigApp.carregarConfig().nomeFantasia, 'Empresa A');
win.ConfigApp.salvarConfig({ nomeFantasia: 'Empresa B' });
win.ConfigApp.definirEmpresa('empresa-a');
assert.equal(win.ConfigApp.carregarConfig().nomeFantasia, 'Empresa A');
win.ConfigApp.definirEmpresa('empresa-b');
assert.equal(win.ConfigApp.carregarConfig().nomeFantasia, 'Empresa B');

const historico = fs.readFileSync(path.join(raiz, 'www/js/historico.js'), 'utf8');
assert(/NOME_BANCO_BASE \+ '-empresa-'/.test(historico));
assert(/function definirEmpresa/.test(historico));

const sessao = fs.readFileSync(path.join(raiz, 'www/js/auth/sessao.js'), 'utf8');
assert(/definirEscopoLocal/.test(sessao));
assert(/SistemaOSHistorico\.definirEmpresa/.test(sessao));
assert(/ConfigApp\.definirEmpresa/.test(sessao));

const erros = fs.readFileSync(path.join(raiz, 'www/js/relatorio-erros.js'), 'utf8');
assert(/relatorios_erros/.test(erros));
assert(/unhandledrejection/.test(erros));

const suporte = fs.readFileSync(path.join(raiz, 'www/js/suporte-global.js'), 'utf8');
assert(/listar_erros_usuarios/.test(suporte));
assert(/atualizar_erro_usuario/.test(suporte));

dom.window.close();
console.log('OK - configuracao, historico e erros separados por empresa no Android.');
