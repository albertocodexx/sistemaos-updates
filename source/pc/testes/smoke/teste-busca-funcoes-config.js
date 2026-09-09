'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const organizador = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'form-organizer.js'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');

assert.match(organizador, /function pontuarSecao\(secao, consulta\)/, 'busca deve ordenar resultados por relevancia');
assert.match(organizador, /function distanciaEdicao\(a, b\)/, 'busca deve tolerar pequenos erros de digitacao');
assert.match(organizador, /GRUPOS_SINONIMOS[\s\S]*whatsapp[\s\S]*nfse[\s\S]*mercado[\s\S]*exclusao/, 'busca deve conhecer termos usados no dia a dia');
assert.match(organizador, /evento\.ctrlKey && evento\.key\.toLowerCase\(\) === 'f'/, 'Ctrl+F deve focar a busca de funcoes');
assert.match(organizador, /evento\.key !== 'Enter' \|\| !toolbar\._primeiroResultado/, 'Enter deve levar ao melhor resultado');
assert.match(organizador, /Nenhuma função encontrada/, 'busca vazia deve orientar o usuario');
assert.match(organizador, /const SECOES_IMPORTANTES = \[/, 'configuracoes comuns devem permanecer abertas');
assert.match(organizador, /mostrarSomenteConfiguracoesImportantes\(caixa\)/, 'atalho deve recolher somente opcoes menos usadas');
assert.match(organizador, /const corresponde = !consulta \? disponivel : pontos >= 20/, 'busca deve descartar coincidencias fracas');
assert.match(organizador, /Relatórios › Financeiro[\s\S]*financeiro finanças faturamento/, 'busca deve localizar o relatório financeiro fora da configuração');
assert.match(organizador, /OS autorizadas', aba: 'orcamentos'/, 'atalho de OS autorizadas deve abrir a aba existente');
assert.match(organizador, /Desbloqueios', aba: 'desbloqueios'/, 'busca deve localizar desbloqueios');
assert.match(organizador, /abrirRotaDaBusca\(toolbar\._rotaResultado\)/, 'resultado de navegação deve abrir a função encontrada');
assert.match(organizador, /className = 'config-busca-resultado'/, 'resultados devem usar uma lista única e simples');
assert.match(organizador, /Buscar nas configurações/);
assert.match(css, /\.config-busca-resultados/);
assert.match(css, /\.config-busca-resultado/);
assert.doesNotMatch(organizador, /config-busca-atalho|config-busca-rota/, 'atalhos duplicados não devem poluir a busca');
assert.doesNotMatch(organizador, /data-config-recolher>Recolher seções/, 'acao nao deve induzir o usuario a esconder tudo');
assert.match(css, /\.config-secao\.config-corresponde/);
assert.match(css, /\.config-sem-resultado \.config-busca-status/);
const secaoDatas = html.match(/<div class="config-secao-titulo">Datas e Horários<\/div>[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
assert.ok(secaoDatas, 'configuração de datas e horários deve continuar disponível');
assert.doesNotMatch(secaoDatas, /#icone-relogio/, 'datas e horários não deve voltar a exibir relógio decorativo');

console.log('OK: busca simples por intenção, sinônimos, erros e áreas do sistema.');
