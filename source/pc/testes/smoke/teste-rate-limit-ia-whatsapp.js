'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-rate-ia-'));
process.env.SISTEMAOS_IA_RATE_LIMIT_FILE = path.join(pasta, 'estado.json');
const limite = require('../../src/ia-rate-limit');

limite._resetarParaTestes();
limite.consumirLimiteIA({ provedor: 'groq', chave: 'empresa-a', limiteMinuto: 2, limiteMes: 3, agora: 1000 });
limite.consumirLimiteIA({ provedor: 'groq', chave: 'empresa-a', limiteMinuto: 2, limiteMes: 3, agora: 1001 });
assert.throws(
  () => limite.consumirLimiteIA({ provedor: 'groq', chave: 'empresa-a', limiteMinuto: 2, limiteMes: 3, agora: 1002 }),
  erro => erro?.code === 'IA_RATE_LIMIT' && erro?.tipoLimite === 'minuto'
);

// Outra empresa/chave não compartilha a cota.
assert.doesNotThrow(() => limite.consumirLimiteIA({
  provedor: 'groq', chave: 'empresa-b', limiteMinuto: 2, limiteMes: 3, agora: 1002
}));

// A janela por minuto abre novamente, mas a mensal permanece persistida.
assert.doesNotThrow(() => limite.consumirLimiteIA({
  provedor: 'groq', chave: 'empresa-a', limiteMinuto: 2, limiteMes: 3, agora: 61_100
}));
assert.throws(
  () => limite.consumirLimiteIA({ provedor: 'groq', chave: 'empresa-a', limiteMinuto: 2, limiteMes: 3, agora: 61_101 }),
  erro => erro?.code === 'IA_RATE_LIMIT' && erro?.tipoLimite === 'mes'
);

const persistido = fs.readFileSync(process.env.SISTEMAOS_IA_RATE_LIMIT_FILE, 'utf8');
assert(!persistido.includes('empresa-a'), 'o arquivo de cota não pode conter a chave da API');

const whatsapp = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'whatsapp.js'), 'utf8');
assert.match(whatsapp, /TEMPO_MAXIMO_OPERACAO_MS\s*=\s*20_000/);
assert.match(whatsapp, /_comTempoLimite\(\s*sock\.onWhatsApp/);
assert.match(whatsapp, /_comTempoLimite\(\s*sock\.sendMessage/g);

fs.rmSync(pasta, { recursive: true, force: true });
delete process.env.SISTEMAOS_IA_RATE_LIMIT_FILE;
console.log('OK: IA possui cotas persistentes por empresa e Baileys libera a fila em timeout.');
