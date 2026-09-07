const assert = require('assert');
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const html = ler('www', 'index.html');
const app = ler('www', 'js', 'app.js');
const tela = ler('www', 'js', 'precos-tela.js');
const servico = ler('www', 'js', 'supabase', 'precos-service.js');
const estilos = ler('www', 'css', 'precos.css');

assert.match(html, /id="btn-ir-precos"/, 'Android deve ter a aba Preços');
assert.match(html, /id="precos-mobile-busca"/, 'Android deve ter busca');
assert.match(html, /id="form-preco-mobile"/, 'Android deve ter formulário de cadastro e edição');
assert.match(html, /id="preco-mobile-fornecedor"/, 'Android deve permitir informar fornecedor');
assert.match(app, /precos:\s*\{\s*elemento:\s*painelPrecos/, 'navegação deve registrar a nova tela');
assert.match(tela, /preco-mobile-editar/, 'celular deve editar preços');
assert.match(tela, /preco-mobile-excluir/, 'celular deve excluir preços');
assert.match(tela, /precos-mobile-valor/, 'valor deve ter classe própria e não deformar o fornecedor');
assert.match(estilos, /font-size:\s*clamp\(28px,\s*7\.5vw,\s*36px\)/, 'valor do reparo deve ser grande e proporcional');
assert.match(tela, /catalogo-modelos-precos-mobile/, 'celular deve usar o catálogo amplo no campo de modelo');
assert.match(servico, /salvar_tabela_preco_v2/, 'celular deve usar a RPC compartilhada com fornecedor');
assert.match(servico, /excluir_tabela_preco/, 'exclusão deve ser compartilhada');
assert.match(servico, /postgres_changes/, 'alterações devem chegar em tempo real');
assert.match(servico, /listarCache/, 'última tabela deve ficar disponível sem internet');

console.log('OK: tabela de preços no Android possui busca, CRUD, cache e sincronização em tempo real.');
