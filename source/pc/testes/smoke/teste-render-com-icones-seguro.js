'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..', '..');
const fonte = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const trecho = fonte.match(/function _renderComIcones\(msg\) \{[\s\S]*?\n\}/);
assert.ok(trecho, 'renderizador de ícones deve existir');

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

assert.strictEqual(contexto.renderizar('Ok ' + icone), 'Ok ' + icone, 'ícone interno exato deve renderizar');
const ataque = '<svg onload="globalThis.invadiu=true"><path/></svg>';
const saida = contexto.renderizar('Aviso ' + ataque);
assert.ok(!saida.includes('<svg'), 'SVG recebido como texto não pode virar HTML');
assert.ok(saida.includes('&lt;svg'), 'SVG externo deve ser exibido como texto neutralizado');

console.log('OK: somente SVGs internos exatos são aceitos pelo renderer.');
