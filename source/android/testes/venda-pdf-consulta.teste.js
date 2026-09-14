'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');

function recarregar(rel) {
  const arquivo = path.join(raiz, rel);
  delete require.cache[require.resolve(arquivo)];
  return require(arquivo);
}

(async () => {
  const chamadas = [];
  global.SupabaseClientApp = {
    obterCliente() {
      return {
        from(tabela) {
          const chamada = { tabela };
          chamadas.push(chamada);
          const q = {
            select(campos) { chamada.campos = campos; return q; },
            is(campo, valor) { chamada.exclusao = [campo, valor]; return q; },
            or(filtro) { chamada.filtro = filtro; return q; },
            order() { return q; },
            async limit() {
              return { data: [{
                id: 'venda-1', numero: 'VD-0001', cliente_nome_snapshot: null,
                itens: [{}], valor_total: 250, revision: 1,
                dados_extras: { documento_mobile: { compradorNome: 'Alberto Parma Couto', marca: 'Samsung', modelo: 'S23' } }
              }], error: null };
            }
          };
          return q;
        }
      };
    }
  };

  const consultas = recarregar('www/js/supabase/consultas-service.js');
  const resposta = await consultas.buscar('venda', 'Alberto');
  assert.equal(chamadas[0].tabela, 'vendas');
  assert.match(chamadas[0].filtro, /cliente_nome_snapshot\.ilike\."%Alberto%"/);
  assert.match(chamadas[0].filtro, /dados_extras->documento_mobile->>compradorNome\.ilike\."%Alberto%"/);
  assert.equal(resposta.itens[0].dados.clienteNome, 'Alberto Parma Couto');
  assert.equal(resposta.itens[0].dados.aparelhoMarca, 'Samsung');

  const arquivos = recarregar('www/js/supabase/arquivo-service.js');
  const itens = arquivos._itensDoRegistro({
    tipoDocumento: 'venda',
    os: {
      documentoPdfBase64: 'data:application/pdf;base64,JVBERi0xLjQ=',
      documentoPdfNome: 'comprovante-de-venda-VD-0001.pdf',
      assinaturaCompradorBase64: 'data:image/png;base64,QQ=='
    }
  });
  assert.deepEqual(itens.map((item) => item.categoria), ['pdf', 'assinatura_comprador']);
  assert.equal(arquivos._nomeArquivoComExtensao(itens[0].nomeArquivo, 'application/pdf'), 'comprovante-de-venda-VD-0001.pdf');
  assert.equal(arquivos._nomeArquivoComExtensao('assinatura-venda', 'image/png'), 'assinatura-venda.png');

  const compartilhar = ler('www/js/compartilhar-arquivo.js');
  const historico = ler('www/js/historico.js');
  const sync = ler('www/js/supabase/sync-service.js');
  const app = ler('www/js/app.js');
  const java = ler('android/app/src/main/java/com/assistencia/sistemaos/ImpressaoPlugin.java');
  assert.match(compartilhar, /function gerarPdfHtml/);
  assert.match(historico, /documentoPdfBase64/);
  assert.match(sync, /delete seguro\.documentoPdfBase64/);
  assert.match(app, /prepararPdfAtualParaSincronizacao/);
  assert.match(app, /garantirPdfConsultado/);
  assert.match(java, /@PluginMethod\s+public void gerarPdf/);
  assert.match(java, /data:application\/pdf;base64,/);

  console.log('OK: venda por nome parcial encontra legado e PDF assinado entra na fila privada com reparo sob demanda.');
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
