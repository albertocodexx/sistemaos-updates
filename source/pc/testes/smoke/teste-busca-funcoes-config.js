'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const organizador = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'form-organizer.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer', 'style.css'), 'utf8');

assert.match(organizador, /function pontuarSecao\(secao, consulta\)/, 'busca deve ordenar resultados por relevancia');
assert.match(organizador, /function distanciaEdicao\(a, b\)/, 'busca deve tolerar pequenos erros de digitacao');
assert.match(organizador, /GRUPOS_SINONIMOS[\s\S]*whatsapp[\s\S]*nfse[\s\S]*mercado[\s\S]*exclusao/, 'busca deve conhecer termos usados no dia a dia');
assert.match(organizador, /data-config-atalho="nota fiscal"/, 'busca deve oferecer atalhos rapidos');
assert.match(organizador, /evento\.ctrlKey && evento\.key\.toLowerCase\(\) === 'f'/, 'Ctrl+F deve focar a busca de funcoes');
assert.match(organizador, /evento\.key !== 'Enter' \|\| !toolbar\._primeiroResultado/, 'Enter deve levar ao melhor resultado');
assert.match(organizador, /Nenhuma função encontrada/, 'busca vazia deve orientar o usuario');
assert.match(organizador, /const SECOES_IMPORTANTES = \[/, 'configuracoes comuns devem permanecer abertas');
assert.match(organizador, /mostrarSomenteConfiguracoesImportantes\(caixa\)/, 'atalho deve recolher somente opcoes menos usadas');
assert.match(organizador, /const corresponde = !consulta \? disponivel : pontos >= 20/, 'busca deve descartar coincidencias fracas');
assert.match(organizador, /melhor: \$\{melhores\.join/, 'busca deve explicar os melhores resultados');
assert.match(organizador, /Relatórios › Financeiro[\s\S]*financeiro finanças faturamento/, 'busca deve localizar o relatório financeiro fora da configuração');
assert.match(organizador, /abrirRotaDaBusca\(toolbar\._rotaResultado\)/, 'resultado de navegação deve abrir a função encontrada');
assert.match(css, /\.config-busca-rota/, 'rota encontrada deve aparecer como botão legível');
assert.doesNotMatch(organizador, /data-config-recolher>Recolher seções/, 'acao nao deve induzir o usuario a esconder tudo');
assert.match(css, /\.config-busca-atalhos/);
assert.match(css, /\.config-secao\.config-corresponde/);
assert.match(css, /\.config-sem-resultado \.config-busca-status/);

console.log('OK: busca de funcoes por intencao, sinonimos, erros e atalhos rapidos.');
