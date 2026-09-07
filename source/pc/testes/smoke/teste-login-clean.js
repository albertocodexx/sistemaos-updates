'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer', 'style.css'), 'utf8');

for (const id of [
  'telaLogin', 'loginEmpresa', 'loginUsuario', 'loginSenha', 'btnVerSenha',
  'loginLembrar', 'loginErro', 'loginAtualizacao', 'loginAtualizacaoTexto',
  'loginAtualizacaoPercentual', 'loginAtualizacaoBarra',
  'btnInstalarAtualizacaoLogin', 'btnLogin', 'loginBtnTexto', 'loginLoading',
  'btnAbrirChamadoLogin', 'contasRapidasLogin', 'listaContasRapidasLogin'
]) {
  assert.match(html, new RegExp(`id="${id}"`), `controle funcional ausente no login: ${id}`);
}

assert.match(html, /id="telaLogin" class="login-fundo login-clean"/);
assert.match(html, /id="loginTitulo">Sistema OS</);
assert.doesNotMatch(html, /Sua opera[cç][aã]o,[\s\S]*mais inteligente/i);
assert.doesNotMatch(html, /Plataforma completa para assist[eê]ncia t[eé]cnica/i);
assert.doesNotMatch(html, /Bem-vindo de volta/i);
assert.doesNotMatch(html, /Primeiro acesso\?/i);
assert.doesNotMatch(html, /class="login-painel-img"/);
assert.doesNotMatch(html, /id="btnEsqueciSenha"/);

assert.match(css, /\.login-fundo\.login-clean\s*\{[\s\S]*?place-items:\s*center/);
assert.match(css, /\.login-fundo\.login-clean\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 420px\)/);
assert.match(css, /\.login-clean \.login-caixa\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*420px/);
assert.match(css, /@media \(max-height: 650px\)[\s\S]*?place-items:\s*start center/);
assert.match(css, /@media \(max-width: 520px\)[\s\S]*?padding:\s*18px 14px/);

console.log('OK: login clean, centralizado e responsivo preserva os controles funcionais.');
