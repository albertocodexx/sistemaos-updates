'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..', '..');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const estilo = fs.readFileSync(path.join(raiz, 'renderer', 'style.css'), 'utf8');

const trechoHelpers = renderer.match(/function _escHtml\(s\) \{[\s\S]*?\n\}\n[\s\S]*?function _argJsUri\(valor\) \{[\s\S]*?\n\}/);
assert.ok(trechoHelpers, 'helpers de renderização segura devem existir');
const contexto = {};
vm.runInNewContext(`${trechoHelpers[0]}; this.esc = _escHtml; this.arg = _argJsUri;`, contexto);

const ataque = `Cliente'><img src=x onerror=alert(1)>\n`;
const htmlSeguro = contexto.esc(ataque);
assert.ok(!htmlSeguro.includes('<img'), 'nome do cliente não pode inserir HTML');
assert.ok(htmlSeguro.includes('&#39;'), 'aspas simples também devem ser neutralizadas');
const argumento = contexto.arg(ataque);
assert.ok(!argumento.includes("'"), 'argumento inline não pode conservar aspas');
assert.ok(!argumento.includes('\n'), 'argumento inline não pode conservar quebra de linha');
assert.strictEqual(decodeURIComponent(argumento), ataque, 'identificador seguro deve chegar íntegro à função');

assert.doesNotMatch(renderer, /para \"<b>\$\{termo\}<\/b>\"/, 'busca não pode inserir o termo sem escape');
assert.doesNotMatch(renderer, /abrirPerfilCliente\('\$\{c\.chave\}'\)/, 'chave do cliente não pode entrar crua no onclick');
assert.match(renderer, /abrirPerfilCliente\(decodeURIComponent\('\$\{chaveSegura\}'\)\)/);
assert.match(renderer, /\$\{_escHtml\(c\.nome \|\| '—'\)\}/, 'perfil deve escapar o nome exibido');
assert.match(renderer, /window\.verDetalheCompra[\s\S]*?const fotosHtml = \(Array\.isArray\(cp\.fotos\)/, 'detalhe da compra deve montar as fotos no próprio escopo');
assert.doesNotMatch(renderer, /onclick="verDetalheCompra\('\$\{cp\.numero\}'\)"/, 'número da compra não pode entrar cru no handler');
assert.match(renderer, /verDetalheCompra\(decodeURIComponent\('\$\{numeroJs\}'\)\)/, 'número da compra deve usar argumento seguro');
assert.match(estilo, /\.cliente-card-resumo\s*\{[\s\S]*?grid-template-columns/, 'resumo deve permanecer responsivo');

console.log('OK: cartões e perfil de clientes mantêm layout legível e neutralizam HTML/handlers maliciosos.');
