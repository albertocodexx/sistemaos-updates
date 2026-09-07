const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const chamadas = [];

global.SistemaOSPermissoes = { obterContexto: () => ({ empresa_id: 'empresa-teste' }) };
global.SistemaOSSupabaseSync = { obterDispositivoId: async () => '11111111-1111-1111-1111-111111111111' };
global.SupabaseClientApp = {
  obterCliente: () => ({
    rpc: async (nome, dados) => {
      chamadas.push({ nome, dados });
      return { data: { id: 'remoto-1', local_id: dados.p_local_id || 'PCA-1', dados: dados.p_dados || {}, revision: 8 }, error: null };
    }
  })
};

delete require.cache[require.resolve('../www/js/supabase/estoque-service.js')];
const estoque = require('../www/js/supabase/estoque-service.js');

const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const tela = ler('www', 'js', 'estoque-tela.js');
const html = ler('www', 'index.html');

(async () => {
  assert.deepStrictEqual(estoque.TIPOS_ITEM_ESTOQUE, ['Peça / Componente', 'Consumível', 'Acessório']);
  assert.strictEqual(estoque.normalizarTipoItem('Consumível'), 'Consumível');
  assert.strictEqual(estoque.normalizarTipoItem('desconhecido'), 'Peça / Componente');

  await estoque.salvarPeca({
    tipoItem: 'Consumível', nome: 'Película 3D', categoria: 'Película',
    fornecedor: 'Fornecedor teste', quantidade: 99, estoqueMinimo: 2, custo: 5
  }, {
    id: 'PCA-1', tipoItem: 'Consumível', quantidade: 5,
    dataCadastro: '2026-08-01T00:00:00.000Z', dataEntrada: '2026-08-01T00:00:00.000Z',
    _revision: 7
  });

  const salvar = chamadas.find((item) => item.nome === 'salvar_item_estoque');
  assert.ok(salvar, 'edição deve usar o RPC compartilhado com o PC');
  assert.strictEqual(salvar.dados.p_dados.tipoItem, 'Consumível');
  assert.strictEqual(salvar.dados.p_dados.fornecedor, 'Fornecedor teste');
  assert.strictEqual(salvar.dados.p_dados.quantidade, 5, 'edição não pode sobrescrever o saldo');
  assert.strictEqual(salvar.dados.p_revision, 7);

  await estoque.movimentar({ _idRemoto: 'remoto-1', _revision: 8, quantidade: 5 }, -3);
  const movimento = chamadas.find((item) => item.nome === 'movimentar_quantidade_peca');
  assert.strictEqual(movimento.dados.p_delta, -3);
  await assert.rejects(
    () => estoque.movimentar({ _idRemoto: 'remoto-1', _revision: 8, quantidade: 2 }, -3),
    /Estoque insuficiente/
  );

  assert.match(html, /id="peca-mobile-tipo"/);
  assert.match(html, />Consumível</);
  assert.match(html, /id="peca-mobile-fornecedor"/);
  assert.match(tela, /estoque-editar-peca/);
  assert.match(tela, /data-operacao="entrada"/);
  assert.match(tela, /data-operacao="saida"/);
  assert.match(tela, /Item excluído no celular e no PC/);

  console.log('OK: Android cadastra, edita, movimenta e exclui consumíveis sincronizados com o PC.');
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
