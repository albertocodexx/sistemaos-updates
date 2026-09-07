const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const html = ler('www', 'index.html');
const tela = ler('www', 'js', 'estoque-tela.js');
const servico = ler('www', 'js', 'supabase', 'estoque-service.js');
const app = ler('www', 'js', 'app.js');
const estatisticas = ler('www', 'js', 'estatisticas.js');

assert.doesNotMatch(tela, /item\.status\s*!==\s*['"]Pronto para venda['"]/,
  'estoque do celular deve listar aparelhos em qualquer status');
assert.match(tela, /class="btn-secundario estoque-editar"/, 'aparelho deve permitir editar dados e status');
assert.match(tela, /class="btn-primario estoque-vender"/, 'aparelho deve iniciar venda e assinatura');
assert.match(html, /id="modal-editar-aparelho-mobile"/, 'edição deve usar modal próprio');
assert.match(html, /id="aparelho-mobile-status"/, 'modal deve expor o status');
assert.match(html, /id="aparelho-mobile-valor"/, 'modal deve expor o valor de venda');
assert.match(html, /id="venda-data"[^>]*required/, 'venda deve exigir data');
assert.match(app, /estoqueLocalId:\s*\(estoqueVendaAtual && estoqueVendaAtual\.id\)/,
  'documento deve conservar o vínculo com o EST original');
assert.match(app, /SistemaOSVendaEstoque/, 'estoque deve reutilizar o fluxo completo de PDF e assinatura');
assert.match(servico, /status:\s*pendente\s*\?\s*'Reservado'\s*:\s*'Vendido'/,
  'assinar depois reserva e assinatura concluída vende');
assert.match(estatisticas, /quantidadeVendas/, 'estatísticas do APK devem contabilizar vendas');
assert.match(estatisticas, /totalVendas/, 'valor vendido deve alimentar os gráficos do APK');
assert.match(servico, /listarCache/, 'estoque deve manter cache leve por empresa para consulta sem PC');
assert.match(servico, /enfileirarEdicaoAparelho/, 'edicao sem rede deve entrar em fila local');
assert.match(servico, /processarFila/, 'a fila local deve ser reenviada ao recuperar conexao');
assert.match(tela, /Funciona mesmo com o PC desligado/, 'a tela deve explicar que a fonte e a nuvem, nao o PC');

console.log('OK: estoque móvel lista todos os status, edita o item e conclui venda vinculada com valor nos gráficos.');
