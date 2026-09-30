'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.resolve(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');

const html = ler('www/index.html');
const js = ler('www/js/ia-mobile.js');
const css = ler('www/css/app.css');

assert.match(html, /id="btn-ia-mobile"[^>]*hidden/);
assert.match(html, /id="painel-ia-mobile"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
assert.match(html, /js\/ia-mobile\.js/);
assert.match(js, /PLATAFORMA ATUAL: CELULAR ANDROID/);
assert.match(js, /Configurações > NFS-e e DANFSe/);
assert.match(js, /NF-e e NFC-e de produtos ainda não estão implementadas/);
assert.match(js, /integracoes-empresa/);
assert.match(js, /tipo: 'ia', acao: 'chat'/);
assert.match(js, /A IA do celular é apenas orientativa/);
assert.match(js, /estado\?\.tipo === 'autenticado'/);
assert.match(js, /contexto\?\.administrador_global !== true/);
assert.match(css, /\.ia-mobile-atalho\[hidden\]\{display:none!important\}/);
assert.doesNotMatch(js, /innerHTML\s*=/, 'resposta da IA não pode ser injetada como HTML');
assert.match(js, /textContent/);
assert.match(js, /evento\.key === 'Escape'/);
assert.match(css, /\.ia-mobile-dialogo/);
assert.match(css, /prefers-reduced-motion/);
console.log('OK: IA móvel usa a integração segura da empresa, conhece a plataforma e não injeta HTML.');
