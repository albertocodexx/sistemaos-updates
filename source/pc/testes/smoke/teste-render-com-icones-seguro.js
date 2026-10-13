'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..', '..');
const fonte = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const trecho = fonte.match(/function _renderComIcones\(msg\) \{[\s\S]*?\n\}/);
assert.ok(trecho, 'renderizador de ícones deve existir');
const markdown = fonte.match(/function _renderMarkdownSeguro\(msg\) \{[\s\S]*?\n\}/);
assert.ok(markdown, 'renderizador de Markdown deve existir');

const icone = '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>';
const contexto = {
  window: { RendererIcons: { TESTE: icone } },
  normalizarReferenciasOS: String,
  document: {
    createElement() {
      let valor = '';
      return {
        set textContent(texto) {
          valor = String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },
        get innerHTML() { return valor; }
      };
    }
  }
};
vm.runInNewContext(`${trecho[0]}; this.renderizar = _renderComIcones;`, contexto);
vm.runInNewContext(`${markdown[0]}; this.markdown = _renderMarkdownSeguro;`, contexto);

assert.strictEqual(contexto.renderizar('Ok ' + icone), 'Ok ' + icone, 'ícone interno exato deve renderizar');
const ataque = '<svg onload="globalThis.invadiu=true"><path/></svg>';
const saida = contexto.renderizar('Aviso ' + ataque);
assert.ok(!saida.includes('<svg'), 'SVG recebido como texto não pode virar HTML');
assert.ok(saida.includes('&lt;svg'), 'SVG externo deve ser exibido como texto neutralizado');
assert.equal(contexto.markdown('Ok ' + icone), 'Ok ' + icone);
for (const texto of [ataque, '<svg><foreignObject><b>externo</b></foreignObject></svg>',
  '<svg viewBox="0 0 1 1" onload="acao()"><path d="M0 0"/></svg>', '<svg onload="acao()">']) {
  assert.ok(!contexto.markdown(texto).includes('<svg'), 'Markdown não pode liberar SVG desconhecido');
}
assert.equal(contexto.markdown('**forte** __forte__ *forte*'),
  '<strong>forte</strong> <strong>forte</strong> <strong>forte</strong>');
assert.equal(contexto.markdown('<b>literal</b>'), '&lt;b&gt;literal&lt;/b&gt;');
assert.ok(fonte.includes("abrirModalEstoque(decodeURIComponent('${_argJsUri(item.id)}'))"));
assert.ok(fonte.includes("abrirModalPeca(decodeURIComponent('${_argJsUri(p.id)}'))"));
for (const campo of ['item.marca', 'item.modelo', 'subInfo', 'item.status', 'p.nome', 'p.categoria', 'p.localizacao']) {
  assert.ok(fonte.includes('_escHtml(' + campo), 'campo dinâmico de estoque deve ser escapado: ' + campo);
}

console.log('OK: somente SVGs internos exatos são aceitos pelo renderer.');
