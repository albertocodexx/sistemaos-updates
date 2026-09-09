'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer', 'monochrome-theme.css'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const templateOS = fs.readFileSync(path.join(raiz, 'src', 'templates', 'os-template.js'), 'utf8');

assert(html.includes('monochrome-theme.css'), 'tema monocromático precisa ser carregado no renderer');
assert(html.indexOf('monochrome-theme.css') > html.indexOf('modules/precos/tabela-precos.css'), 'tema monocromático deve vir depois dos módulos');
assert(html.indexOf('theme-accessibility.css') > html.indexOf('monochrome-theme.css'), 'acessibilidade deve ser a última camada visual');
assert(!html.includes('id="icone-robo"'), 'ícone antigo de robô não deve permanecer no sistema');
assert.match(html, /data-aba="log-ia"[^>]+title="[^"]+"[\s\S]*?#icone-estrela/, 'Log IA deve usar estrela e explicar a aba');
const abasPrincipais = [...html.matchAll(/<button class="aba(?: ativa)?"[^>]*data-aba="([^"]+)"[^>]*>/g)];
assert(abasPrincipais.length >= 13, 'menu principal deve manter todas as áreas');
abasPrincipais.forEach(([tag, aba]) => assert.match(tag, /title="[^\"]{12,}"/, `aba ${aba} precisa explicar seu conteúdo ao passar o mouse`));
assert(html.includes('assets/logo-os-white.png'), 'login e cabeçalho devem usar a nova marca');
assert(css.includes('--cor-principal: #ffffff !important'), 'modo escuro deve usar branco como ação principal');
assert(css.includes('--cor-principal: #000000 !important'), 'modo claro deve usar preto como ação principal');
assert(css.includes('.card-estatistica') === false, 'CSS do PC não deve depender de componentes Android');
assert(runtime.includes("corPrincipal: '#FFFFFF'"), 'tema salvo de fábrica deve ser monocromático');
assert(runtime.includes('normalizarLogoParaDocumentos'), 'upload da logo deve remover margens vazias antes de salvar');
assert(runtime.includes("temTransparencia"), 'normalização da logo deve preservar PNG transparente');
assert.match(templateOS, /\.cabecalho\{[\s\S]*align-items:center/, 'logo e dados da empresa devem ficar alinhados no PDF');
assert.match(templateOS, /\.logo-img\{display:block;/, 'a imagem da logo não deve criar desalinhamento de linha no PDF');

for (const arquivo of [
  'renderer/assets/logo-os-black.png',
  'renderer/assets/logo-os-white.png',
  'build-resources/icon.png',
  'build-resources/icon.ico',
  'assets/tray-icon.png'
]) {
  const caminho = path.join(raiz, arquivo);
  assert(fs.existsSync(caminho) && fs.statSync(caminho).size > 100, `recurso visual ausente: ${arquivo}`);
}

console.log('OK: PC usa identidade monocromática, marca nova e recursos nativos consistentes.');
