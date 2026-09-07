'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { indexedDB } = require('fake-indexeddb');

(async () => {
  const raiz = path.resolve(__dirname, '..');
  const ler = arquivo => fs.readFileSync(path.join(raiz, arquivo), 'utf8');
  const dom = new JSDOM('<!doctype html>', { url: 'https://qa.local', runScripts: 'outside-only' });
  dom.window.indexedDB = indexedDB;
  dom.window.eval(ler('www/js/historico.js'));
  const historico = dom.window.SistemaOSHistorico;
  historico.definirEmpresa('empresa-ciclo-qa');

  await historico.salvarEntrega({
    numeroOS: 'OS-0020', cicloEntregaId: 'original',
    assinaturaRetirouBase64: 'assinatura-original', reparoRealizado: 'Primeira entrega'
  });
  await historico.salvarEntrega({
    numeroOS: 'OS-0020', cicloEntregaId: 'RET-20-A', retornoGarantiaId: 'RET-20-A',
    assinaturaPendente: true, reparoRealizado: 'Retorno em garantia'
  });
  let entregas = await historico.listarPorTipo('entrega');
  assert.equal(entregas.length, 2, 'original e retorno precisam coexistir no celular');
  assert.equal((await historico.buscarEntregaPorNumeroOS('OS-0020', 'original')).os.assinaturaRetirouBase64, 'assinatura-original');

  await historico.salvarEntrega({
    numeroOS: 'OS-0020', cicloEntregaId: 'RET-20-A', retornoGarantiaId: 'RET-20-A',
    assinaturaRetirouBase64: 'assinatura-retorno', assinaturaPendente: false,
    reparoRealizado: 'Retorno em garantia concluído'
  });
  entregas = await historico.listarPorTipo('entrega');
  assert.equal(entregas.length, 2, 'editar o retorno deve substituir apenas o mesmo ciclo');
  assert.equal((await historico.buscarEntregaPorNumeroOS('OS-0020', 'original')).os.assinaturaRetirouBase64, 'assinatura-original');
  assert.equal((await historico.buscarEntregaPorNumeroOS('OS-0020', 'RET-20-A')).os.assinaturaRetirouBase64, 'assinatura-retorno');

  const garantia = ler('www/js/supabase/garantia-service.js');
  const entrega = ler('www/js/supabase/entrega-service.js');
  const app = ler('www/js/app.js');
  assert.match(garantia, /preparar_entrega_retorno_garantia/);
  assert.match(garantia, /Conclua a nova entrega com assinatura/);
  assert.match(entrega, /ciclo_entrega_id/);
  assert.match(app, /retornoGarantiaId/);
  assert.match(app, /cicloEntregaId/);
  dom.window.close();
  console.log('OK — Android preserva a entrega original e assina o retorno em um novo ciclo.');
})().catch(erro => { console.error(erro); process.exitCode = 1; });
