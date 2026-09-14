'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SupabaseFileService } = require('../../src/supabase/file-service');
const { DesktopSupabaseRuntime } = require('../../src/supabase/desktop-runtime');

(async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-os-pdf-comercial-'));
  try {
    const pdf = path.join(pasta, 'VENDA-EST-0002.pdf');
    fs.writeFileSync(pdf, Buffer.from('%PDF-1.4\nPDF venda assinado\n%%EOF'));
    const uploads = [];
    const rpcs = [];
    const filtros = [];
    const cliente = {
      from(tabela) {
        const q = {
          select() { return q; },
          eq(campo, valor) { filtros.push([tabela, campo, valor]); return q; },
          is() { return q; },
          limit() { return q; },
          async maybeSingle() { return { data: null, error: null }; }
        };
        return q;
      },
      storage: { from(bucket) { return { async upload(remoto, bytes, opcoes) {
        uploads.push({ bucket, remoto, bytes, opcoes });
        return { data: { path: remoto }, error: null };
      } }; } },
      async rpc(nome, parametros) {
        rpcs.push({ nome, parametros });
        return { data: { id: 'arquivo-pdf-1' }, error: null };
      }
    };
    const servico = new SupabaseFileService({
      rootDir: pasta,
      stateStore: { obter: () => ({ deviceKey: 'pc-1' }) },
      getClient: () => cliente,
      getContext: () => ({ empresa_id: 'empresa-1' }),
      nativeImage: null,
      db: {}
    });
    const salvo = await servico.catalogarPdfDocumentoComercial('venda', pdf, { id: 'venda-1' });
    assert.equal(salvo.registrado, true);
    assert.equal(uploads[0].bucket, 'documentos-pdf');
    assert.match(uploads[0].remoto, /^empresa-1\/comerciais\/venda\/venda-1\//);
    assert.equal(rpcs[0].nome, 'registrar_arquivo_comercial_mobile');
    assert.equal(rpcs[0].parametros.p_entidade_tipo, 'venda');
    assert.equal(rpcs[0].parametros.p_origem_dispositivo_id, null);
    assert(filtros.some((item) => item[1] === 'checksum_sha256'));

    const runtime = new DesktopSupabaseRuntime();
    runtime.db = {
      listarCompras: () => [],
      listarEstoque: () => [{ origemIdExportacao: 'exp-venda-1', pdfVendaPath: pdf }]
    };
    runtime.stateStore = {
      obter: () => ({}),
      alterar(fn) { const estado = {}; fn(estado); this.estado = estado; }
    };
    runtime.client = {
      from(tabela) {
        const q = {
          select() { return q; }, in() { return q; }, is() { return q; },
          async limit() { return { data: tabela === 'vendas' ? [{ id: 'venda-1', id_exportacao: 'exp-venda-1' }] : [], error: null }; }
        };
        return q;
      }
    };
    const recuperados = [];
    runtime.fileService = {
      async catalogarPdfDocumentoComercial(tipo, caminho, linha) {
        recuperados.push({ tipo, caminho, linha });
        return { existente: true };
      }
    };
    assert.equal(await runtime._reconciliarPdfsComerciaisLocais(), 1);
    assert.deepEqual(recuperados.map((item) => item.tipo), ['venda']);
    assert.equal(recuperados[0].linha.id, 'venda-1');

    console.log('OK: PDF comercial é publicado e vendas antigas com PDF apenas local são reconciliadas.');
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
