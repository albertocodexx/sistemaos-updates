'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const codigo = fs.readFileSync(path.join(raiz, 'www', 'js', 'chamados.js'), 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  runScripts: 'outside-only',
  url: 'https://sistema-os.local/'
});
const { window } = dom;
window.SistemaOSSessao = {
  obterEstado: () => ({
    usuario: { user_metadata: { usuario: 'alberto' } },
    contexto: { usuario: 'alberto', perfil_nome: 'Alberto', empresa_id: 'empresa-1' }
  })
};
window.eval(fs.readFileSync(path.join(raiz, 'www', 'js', 'chamado-anexos.js'), 'utf8'));
window.eval(codigo);

(async () => {
  await window.SistemaOSChamados.abrirNovo({ origem: 'config_celular' });
  const documento = window.document;
  assert.strictEqual(documento.getElementById('empresa-novo-chamado-app'), null, 'empresa não deve ser perguntada outra vez');
  assert.strictEqual(documento.getElementById('usuario-novo-chamado-app'), null, 'usuário não deve ser perguntado outra vez');
  assert.strictEqual(documento.getElementById('nome-novo-chamado-app'), null, 'nome não deve ser perguntado outra vez');

  const motivo = documento.getElementById('motivo-novo-chamado-app');
  const alterar = (valor) => {
    motivo.value = valor;
    motivo.dispatchEvent(new window.Event('change', { bubbles: true }));
  };

  alterar('sincronizacao_backup');
  assert.strictEqual(documento.getElementById('campo-detalhe-novo-chamado-app').hidden, false);
  assert.strictEqual(documento.getElementById('campo-plataforma-novo-chamado-app').hidden, false);
  assert.strictEqual(documento.getElementById('campo-complemento-novo-chamado-app').hidden, false);
  assert.strictEqual(documento.getElementById('campo-referencia-novo-chamado-app').hidden, false);
  assert.match(documento.getElementById('detalhe-novo-chamado-app').textContent, /Ordens de serviço/);
  assert.match(documento.getElementById('complemento-novo-chamado-app').textContent, /não chegou ao PC/);

  alterar('duvida_funcionalidade');
  assert.strictEqual(documento.getElementById('campo-detalhe-novo-chamado-app').hidden, false);
  assert.strictEqual(documento.getElementById('campo-plataforma-novo-chamado-app').hidden, true);
  assert.strictEqual(documento.getElementById('campo-complemento-novo-chamado-app').hidden, true);
  assert.strictEqual(documento.getElementById('campo-referencia-novo-chamado-app').hidden, true);
  assert.match(documento.getElementById('label-descricao-novo-chamado-app').textContent, /dúvida/);

  alterar('outro');
  assert.strictEqual(documento.getElementById('campo-motivo-outro-novo-chamado-app').hidden, false);
  assert.strictEqual(documento.getElementById('campo-detalhe-novo-chamado-app').hidden, true);

  console.log('OK: formulário de suporte mostra somente os campos do motivo e não repete a identidade.');
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
