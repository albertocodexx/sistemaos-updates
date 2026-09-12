'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');

function clienteFake(nome, log) {
  return {
    channel(canalNome) {
      log.push(nome + ':criar:' + canalNome);
      const canal = {
        on() { return canal; },
        subscribe() { log.push(nome + ':assinar'); return canal; }
      };
      return canal;
    },
    removeChannel() { log.push(nome + ':remover'); }
  };
}

(async () => {
  const dom = new JSDOM('<!doctype html><html></html>', { runScripts: 'outside-only', url: 'https://tempo-real.local/' });
  const log = [];
  let atual = clienteFake('A', log);
  dom.window.SupabaseClientApp = { obterCliente() { return atual; } };
  dom.window.eval(fs.readFileSync(path.join(raiz, 'www/js/supabase/os-service.js'), 'utf8'));
  const parar = dom.window.SistemaOSSupabaseOS.assinar(() => {});
  assert.ok(log.includes('A:assinar'));
  atual = clienteFake('B', log);
  dom.window.document.dispatchEvent(new dom.window.CustomEvent('sistema-os:sessao-alterada', {
    detail: { tipo: 'autenticado', contexto: { empresa_id: 'empresa-b', usuario_id: 'usuario-b' } }
  }));
  assert.ok(log.includes('A:remover'), 'canal da sessão anterior precisa ser encerrado');
  assert.ok(log.includes('B:assinar'), 'nova conta precisa receber eventos do PC');
  parar();
  assert.ok(log.includes('B:remover'), 'unsubscribe deve remover o canal da instância que o criou');
  dom.window.close();

  for (const arquivo of ['estoque-service.js', 'precos-service.js']) {
    const caminho = path.join(raiz, 'www/js/supabase', arquivo);
    delete require.cache[require.resolve(caminho)];
    const eventos = [];
    let clienteAtual = clienteFake('original', eventos);
    global.SupabaseClientApp = { obterCliente() { return clienteAtual; } };
    global.SistemaOSPermissoes = { obterContexto() { return { empresa_id: 'empresa-a' }; } };
    const modulo = require(caminho);
    const cancelar = modulo.assinar(() => {});
    clienteAtual = clienteFake('novo', eventos);
    cancelar();
    assert.ok(eventos.includes('original:remover'), arquivo + ' deve remover o canal no cliente original');
    assert.equal(eventos.includes('novo:remover'), false, arquivo + ' não pode remover canal de outra sessão');
  }

  console.log('OK: canais Realtime são recriados na troca de conta e removidos pelo cliente correto.');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
