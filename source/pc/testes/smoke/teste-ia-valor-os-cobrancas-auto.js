'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ia = fs.readFileSync(path.join(raiz, 'src', 'ia-chat.js'), 'utf8');
const cobrancas = fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'cobrancas', 'cobrancas.js'), 'utf8');

assert.match(ia, /os\.valorTotalServico,[\s\S]*os\.diagnosticoTecnico\?\.valorEstimado,[\s\S]*os\.valorInvestido/,
  'a IA deve priorizar o valor total e manter fallbacks compatíveis');
assert.match(ia, /vl:\s*valorInformado \?\? null/,
  'valor ausente deve ser representado como não informado, não zero gratuito');
assert.match(ia, /grat:\s*os\.servicoGratuito === true/,
  'gratuidade precisa de marcação explícita');
assert.match(ia, /Só diga "serviço gratuito" quando \\`grat\\` for true/,
  'o prompt deve proibir inferência de gratuidade');

assert.match(cobrancas, /function carregarAposAbrirAba\(\)/,
  'a aba precisa de carga automática após a navegação');
assert.match(cobrancas, /requestAnimationFrame\(\(\) => \{[\s\S]*carregar\(\{ sincronizar: true \}\)/,
  'a leitura deve ocorrer após a classe ativa ser aplicada');
assert.match(cobrancas, /carregarAposAbrirAba\(\);[\s\S]*window\.carregarCobrancas/,
  'sessão restaurada com Cobranças ativa também deve carregar automaticamente');

console.log('OK: IA usa o valor real da OS e Cobranças carrega sem exigir Atualizar.');
