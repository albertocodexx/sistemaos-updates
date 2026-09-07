const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const runtime = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');

assert.ok(runtime.includes("dataNotificacao.toLocaleDateString('pt-BR') + ' às '"),
  'notificacoes antigas devem exibir a data acompanhada da hora');
assert.ok(runtime.includes("dataNotificacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })"),
  'hora da notificacao deve usar horas e minutos no formato brasileiro');

console.log('OK: central de notificacoes exibe data e hora no PC.');
