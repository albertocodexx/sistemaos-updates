const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const preload = fs.readFileSync(path.join(raiz, 'src', 'preload', 'api.js'), 'utf8');
const ipc = fs.readFileSync(path.join(raiz, 'src', 'ipc', 'register-legacy.js'), 'utf8');
const dominio = fs.readFileSync(path.join(raiz, 'src', 'database', 'domain.js'), 'utf8');

assert.match(renderer, /lista\.appendChild\(linha\);\s*diagAtualizarResumoCustoPecas\(prefixo\);/);
assert.match(renderer, /valorTotalServico:\s*_numeroMoedaSistema\(\$\('editDiagValorEstimado'\)\.value\)/);
assert.match(renderer, /window\.carregarAutorizadas\(filtroAutorizadas\)/);
assert.match(renderer, /window\.criarNovaEntregaNaoAssinada\s*=\s*async function/);
assert.match(html, /id="btnNovaEntregaCriarNaoAssinada"/);
assert.match(preload, /entregacriarnaoassinada:[^\n]+entrega:criarNaoAssinada/);
assert.match(ipc, /ipcMain\.handle\('entrega:criarNaoAssinada'/);
assert.match(dominio, /function criarEntregaNaoAssinada\(/);
assert.match(dominio, /const assinaturaFoiInformada = Object\.prototype\.hasOwnProperty/);
assert.match(dominio, /assinaturaPendente,\s*naoAssinado,/);
assert.match(dominio, /ordem\.status = 'Entregue'/);
assert.match(renderer, /Não assinado<\/span>/);
assert.match(dominio, /const custoServicos = custoPecas \+ custoPecasManualOS/);
assert.match(dominio, /const lucroServicos = receitaServicos - custoServicos/);

console.log('OK: edicao de OS, custo de pecas e entrega sem assinatura estao integrados.');
