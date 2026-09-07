const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PriceTableService } = require('../../src/supabase/price-table-service');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const tela = fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'precos', 'tabela-precos.js'), 'utf8');
const estilos = fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'precos', 'tabela-precos.css'), 'utf8');
const migracao = fs.readFileSync(path.join(raiz, 'supabase', 'migrations', '20260725000100_tabela_precos_compartilhada.sql'), 'utf8');
const migracaoFornecedor = fs.readFileSync(path.join(raiz, 'supabase', 'migrations', '20260725000200_tabela_precos_fornecedor.sql'), 'utf8');
const legado = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');

assert.match(html, /data-aba="precos"/, 'menu do PC deve conter Tabela de preços');
assert.match(html, /id="tabelaPrecosBusca"/, 'PC deve permitir busca');
assert.match(html, /id="btnBuscarTabelaPrecos"/, 'busca deve usar o mesmo botão com lupa das demais abas');
assert.match(html, /id="tabelaPrecoFornecedor"/, 'PC deve permitir informar fornecedor');
assert.match(estilos, /background:\s*var\(--bg-input/, 'campo de busca deve respeitar o tema escuro');
assert.match(tela, /btnBuscarTabelaPrecos/, 'botão Buscar deve filtrar a tabela');
assert.match(legado, /listaModelosTabelaPrecos/, 'campo de preço deve reutilizar o catálogo amplo de modelos');
assert.match(tela, /tabelaprecossalvar/, 'PC deve salvar no Supabase');
assert.match(tela, /tabelaprecosexcluir/, 'PC deve excluir no Supabase');
assert.match(migracao, /enable row level security/i, 'tabela precisa de RLS');
assert.match(migracao, /supabase_realtime/, 'tabela precisa de Realtime');
assert.match(migracao, /tem_permissao\('estoque', 'editar'\)/, 'edição precisa respeitar permissões');
assert.match(migracaoFornecedor, /add column if not exists fornecedor/i, 'fornecedor deve ser persistido');
assert.match(migracaoFornecedor, /salvar_tabela_preco_v2/, 'RPC nova deve sincronizar fornecedor');

let rpcRecebido = null;
const client = {
  rpc: async (nome, dados) => {
    rpcRecebido = { nome, dados };
    return {
      data: [{
        id: 'preco-1', modelo: dados.p_modelo, peca: dados.p_peca,
        valor: dados.p_valor, fornecedor: dados.p_fornecedor,
        observacoes: dados.p_observacoes, revision: 1
      }],
      error: null
    };
  }
};

(async () => {
  const servico = new PriceTableService({
    getClient: () => client,
    getContext: () => ({ empresa_id: 'empresa-1' })
  });
  const salvo = await servico.salvar({
    modelo: 'Galaxy S23', peca: 'Troca de tela', valor: '899.90', fornecedor: 'Fornecedor Teste'
  });
  assert.strictEqual(rpcRecebido.nome, 'salvar_tabela_preco_v2');
  assert.strictEqual(rpcRecebido.dados.p_valor, 899.9);
  assert.strictEqual(rpcRecebido.dados.p_fornecedor, 'Fornecedor Teste');
  assert.strictEqual(salvo.modelo, 'Galaxy S23');
  await servico.excluir('preco-1', 1);
  assert.strictEqual(rpcRecebido.nome, 'excluir_tabela_preco');
  console.log('OK: tabela de preços do PC usa cadastro multiempresa, permissões, CRUD e Realtime.');
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
