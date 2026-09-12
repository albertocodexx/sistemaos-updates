'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const ler = rel => fs.readFileSync(path.join(raiz, rel), 'utf8');

(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://qa.local',
    runScripts: 'outside-only'
  });
  const w = dom.window;
  let chamadaNativa = null;
  let arquivoEscrito = null;
  let compartilhamento = null;

  try {
    w.Capacitor = {
      Plugins: {
        Impressao: {
          async compartilharPdf(payload) {
            chamadaNativa = payload;
            return { sucesso: true };
          }
        },
        Filesystem: {
          async writeFile(payload) {
            arquivoEscrito = payload;
            return {};
          },
          async getUri() {
            return { uri: 'file:///cache/ordem-de-servico-0001.pdf' };
          }
        },
        Share: {
          async share(payload) {
            compartilhamento = payload;
            return {};
          }
        }
      }
    };
    w.fetch = async () => ({
      ok: true,
      async blob() {
        return new w.Blob(['%PDF-1.4 teste'], { type: 'application/pdf' });
      }
    });

    w.eval(ler('www/js/compartilhar-arquivo.js'));

    await w.SistemaOSCompartilhar.compartilharPdfHtml(
      '<html><body>OS-0001</body></html>',
      'ordem-de-servico-0001.pdf',
      'Compartilhar ordem de serviço',
      'Olá! Segue a ordem de serviço OS-0001.'
    );
    assert.equal(chamadaNativa.nomeArquivo, 'ordem-de-servico-0001.pdf');
    assert.equal(chamadaNativa.mensagem, 'Olá! Segue a ordem de serviço OS-0001.');
    assert.match(chamadaNativa.html, /OS-0001/);

    await w.SistemaOSCompartilhar.compartilharPdfPorUrl(
      'https://arquivos.test/garantia.pdf',
      'garantia-0001.pdf',
      'Compartilhar garantia',
      'Olá! Segue o comprovante de garantia.'
    );
    assert.equal(arquivoEscrito.path, 'garantia-0001.pdf');
    assert.equal(compartilhamento.text, 'Olá! Segue o comprovante de garantia.');
    assert.equal(compartilhamento.files.length, 1);
    assert.equal(compartilhamento.files[0], 'file:///cache/ordem-de-servico-0001.pdf');

    const java = ler('android/app/src/main/java/com/assistencia/sistemaos/ImpressaoPlugin.java');
    assert.match(java, /void compartilharPdf\(PluginCall call\)/);
    assert.match(java, /Intent\.EXTRA_STREAM/);
    assert.match(java, /Intent\.EXTRA_TEXT/);
    assert.match(java, /FileProvider\.getUriForFile/);

    const app = ler('www/js/app.js');
    const garantia = ler('www/js/garantia-tela.js');
    const desbloqueio = ler('www/js/desbloqueios-tela.js');
    const consulta = ler('www/js/consulta.js');
    const html = ler('www/index.html');
    assert.match(html, /id="btn-compartilhar-pdf"/);
    assert.match(app, /compartilharPdfHtml/);
    assert.match(garantia, /compartilharPdfHtml/);
    assert.match(desbloqueio, /compartilharPdfHtml/);
    assert.match(consulta, /compartilharPdfPorUrl/);

    console.log('OK: OS, entrega, garantia e desbloqueio compartilham PDF com mensagem pronta no Android.');
  } finally {
    dom.window.close();
  }
})().catch(erro => {
  console.error(erro.stack || erro);
  process.exitCode = 1;
});
