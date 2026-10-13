'use strict';
// DOM e servidor falsos; não usa SDK, conta real, rede nem dados de cliente.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

(async () => {
  const raiz = path.resolve(__dirname, '..');
  const dom = new JSDOM(fs.readFileSync(path.join(raiz, 'www/index.html'), 'utf8'),
    { runScripts: 'outside-only', url: 'https://dummy.invalid/' });
  const win = dom.window;
  let empresa = 'empresa-a';
  let usuario = 'usuario-a';
  const requisicoes = [];
  const gravacoes = [];
  let resolverLookup;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  async function esperar(predicado) { for (let n = 0; n < 20 && !predicado(); n++) await tick(); assert.ok(predicado()); }
  win.SistemaOSToast = { mostrar() {} };
  win.SistemaOSSessao = { obterEstado: () => ({ tipo: 'autenticado', usuario: { id: usuario }, contexto: { empresa_id: empresa } }) };
  win.SistemaOSHistorico = {
    obterEmpresaAtiva: () => empresa,
    obterDocumentoRecebidoPorIdEnvio: () => new Promise(resolve => { resolverLookup = resolve; }),
    salvarDocumentoRecebido: async registro => { gravacoes.push({ empresa, registro }); return registro; },
    listarDocumentosRecebidos: async () => []
  };
  win.SupabaseClientApp = { obterCliente: () => ({ functions: { invoke: () => new Promise(resolve => requisicoes.push({ empresa, resolve })) } }) };
  const pacote = { tipoArquivo: 'sistema-os-pc-para-assinar', tipoDocumento: 'os',
    idEnvioAssinatura: 'dummy-a', dados: { cliente: { nome: 'MARCADOR-A' } } };
  function trocar(e, u) {
    empresa = e; usuario = u;
    win.document.dispatchEvent(new win.CustomEvent('sistema-os:sessao-alterada', { detail: { tipo: 'autenticado' } }));
  }
  win.eval(fs.readFileSync(path.join(raiz, 'www/js/documentos-recebidos.js'), 'utf8'));
  await esperar(() => requisicoes.length === 1);
  trocar('empresa-b', 'usuario-b');
  await esperar(() => requisicoes.length === 2);
  requisicoes[0].resolve({ data: { solicitacoes: [{ pacote }] } });
  requisicoes[1].resolve({ data: { solicitacoes: [{ pacote: { ...pacote, idEnvioAssinatura: 'dummy-b' } }] } });
  await esperar(() => !!resolverLookup);
  trocar('empresa-c', 'usuario-c');
  resolverLookup(null);
  await esperar(() => requisicoes.length === 3);
  requisicoes[2].resolve({ data: { solicitacoes: [] } });
  for (let n = 0; n < 5; n++) await tick();
  assert.equal(gravacoes.length, 0, 'resposta e lookup antigos não podem salvar no banco sucessor');
  assert.equal(win.document.getElementById('painel-doc-detalhe').hidden, true);
  assert.equal(win.document.getElementById('frame-doc-detalhe').srcdoc, '');
  dom.window.close();
  console.log('OK: troca de empresa descarta lote e lookup de assinatura anteriores.');
})().catch(erro => { console.error(erro); process.exitCode = 1; });
