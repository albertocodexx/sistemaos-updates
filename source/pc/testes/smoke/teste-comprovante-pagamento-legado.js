'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { configuracaoMobileDoDesktop, configuracaoDesktopDoMobile } = require('../../src/supabase/company-cloud-service');

const raiz = path.resolve(__dirname, '..', '..');
const ipc = fs.readFileSync(path.join(raiz, 'src', 'ipc', 'register-legacy.js'), 'utf8');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const preload = fs.readFileSync(path.join(raiz, 'src', 'preload', 'api.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');

assert.ok(ipc.includes("path.join(db.getRootDir(), 'Comprovantes')"));
assert.ok(renderer.includes("window.api.paggerarpdf(pagamentoId)"));
assert.ok(renderer.includes("abrirComprovanteExt(caminho, pagamentoId = '')"));
assert.ok(renderer.includes("verDetalhesPagamentoExt('${p.id}')"), 'Ver deve abrir os dados, não repetir o PDF');
assert.ok(renderer.includes("imprimirComprovanteTermicoPagamento('${p.id}')"), 'histórico deve oferecer impressão térmica');
assert.ok(ipc.includes("ipcMain.handle('pag:imprimirTermico'"));
assert.match(preload, /pagimprimirtermico:\s*\(id, formato, modo\)/);
assert.match(renderer, /escolherSaidaTermicaModal/);
assert.match(renderer, /Pré-visualização aberta/);
assert.match(ipc, /modoEntrada === 'visualizar'/);
assert.match(ipc, /larguraMm = formato === '58mm' \? 58 : 80/);
assert.match(html, /id="formatoTermicoPadrao"/);
for (const formato of ['58mm', '80mm']) {
  const compartilhada = configuracaoMobileDoDesktop({ formatoTermicoPadrao: formato });
  assert.strictEqual(configuracaoDesktopDoMobile(compartilhada).formatoTermicoPadrao, formato,
    'o tamanho padrão deve sobreviver à publicação e restauração da configuração da empresa');
}
assert.strictEqual(configuracaoDesktopDoMobile({}).formatoTermicoPadrao, '80mm',
  'configurações antigas devem conservar o padrão de 80 mm');

console.log('OK: detalhes, PDF e impressão térmica de pagamento têm ações distintas.');
