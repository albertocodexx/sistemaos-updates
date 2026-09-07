const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const fonte = fs.readFileSync(path.join(raiz, 'www', 'js', 'fotos.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'www', 'index.html'), 'utf8');

assert.match(fonte, /Camera\.pickImages\s*\(/, 'galeria nativa deve permitir seleção múltipla');
assert.match(fonte, /limit:\s*vagas/, 'seletor nativo deve respeitar as vagas até o máximo de 10');
assert.match(fonte, /processarFotosNativas\([\s\S]*?proxima\(\)/, 'fotos nativas devem ser processadas em sequência');
assert.match(fonte, /URL\.createObjectURL\(arquivo\)/, 'foto grande deve ser lida sem criar uma cópia Base64 original');
assert.match(fonte, /URL\.revokeObjectURL\(urlTemporaria\)/, 'memória da foto original deve ser liberada após compressão');
assert.match(fonte, /width:\s*LADO_MAXIMO[\s\S]*height:\s*LADO_MAXIMO/, 'plugin deve reduzir a imagem antes de atravessar a WebView');
assert.match(fonte, /var MAX_FOTOS = 10/, 'limite total deve ser de dez fotos');

['os', 'compra', 'entrega'].forEach((contexto) => {
  const padrao = new RegExp('id="input-foto-' + contexto + '"[^>]*multiple');
  assert.match(html, padrao, 'fallback web também deve selecionar várias fotos em ' + contexto);
});

console.log('OK: seleção múltipla e compressão de fotos grandes protegidas contra pico de memória.');
