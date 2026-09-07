'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer', 'style.css'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');

assert.match(html, /id="contadorEquipeSuporte"/, 'equipe deve exibir quantidade de integrantes');
assert.match(html, /class="suporte-equipe-legenda"/, 'cargos devem ter uma legenda clara de permissoes');
assert.match(html, /class="suporte-equipe-lista"/, 'lista deve usar layout dedicado');
assert.match(css, /\.suporte-equipe-membro\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/, 'membro deve alinhar identidade e acoes');
assert.match(css, /\.suporte-equipe-controles\s*\{/, 'cargo e botao devem ficar agrupados');
assert.match(css, /\.suporte-equipe-cargo\.papel-administrador_geral/, 'cargo de administrador deve ter estado visual proprio');
assert.match(runtime, /function iniciaisMembroSuporte\(membro\)/, 'lista deve gerar avatar com iniciais');
assert.match(runtime, /const papel = await escolherOpcaoModal\(\{[\s\S]*Administrador Geral[\s\S]*Gerente de Suporte[\s\S]*Analista de Suporte/, 'alteracao de cargo deve usar opcoes visuais em portugues');
assert.doesNotMatch(runtime, /Novo cargo: suporte, gerente_suporte ou administrador_geral/, 'usuario nao deve digitar codigos internos de cargo');

console.log('OK: equipe central e cargos organizados com selecao visual.');
