const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(raiz, 'www', 'js', 'app.js'), 'utf8');
const historico = fs.readFileSync(path.join(raiz, 'www', 'js', 'historico.js'), 'utf8');
const estoque = fs.readFileSync(path.join(raiz, 'www', 'js', 'estoque-tela.js'), 'utf8');
const auth = fs.readFileSync(path.join(raiz, 'www', 'js', 'supabase', 'auth-service.js'), 'utf8');
const sessao = fs.readFileSync(path.join(raiz, 'www', 'js', 'auth', 'sessao.js'), 'utf8');

assert.match(auth, /TEMPO_LIMITE_SERVIDOR/, 'login do celular deve encerrar espera sem resposta do servidor');
assert.match(sessao, /tempo_limite_servidor/, 'sessao deve tratar o limite como falha de rede recuperavel');

assert.match(app, /var operacaoRascunhoOS = Promise\.resolve/, 'gravações do rascunho devem ser serializadas');
assert.match(app, /function finalizarRascunhoOS\(\)/, 'salvamento definitivo deve concluir o rascunho');
assert.match(app, /return conclusaoRascunho;/, 'conclusão deve ser aguardada antes de liberar o salvamento');
assert.match(historico, /function concluirRascunho\(id\)[\s\S]*?concluidoEm:[\s\S]*?dados:\s*\{\}/, 'rascunho concluído deve virar marcador vazio atômico');
assert.doesNotMatch(estoque, /item\.status !== 'Pronto para venda'/, 'celular deve mostrar também aparelhos em reparo/análise');
assert.match(estoque, /esc\(status\)/, 'card móvel deve exibir o status real do aparelho');

console.log('OK: rascunho concluído não reaparece e estoque móvel mostra todos os aparelhos.');
