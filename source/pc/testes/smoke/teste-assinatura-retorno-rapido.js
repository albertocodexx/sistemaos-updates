'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DesktopSupabaseRuntime } = require('../../src/supabase/desktop-runtime');

const fonte = fs.readFileSync(path.resolve(__dirname, '../../src/supabase/desktop-runtime.js'), 'utf8');
assert.match(fonte, /timerAssinaturas\s*=\s*setInterval[\s\S]{0,180}12000/);
assert.match(fonte, /arquivos:\s*arquivos\.respondidas\s*\+\s*arquivosRemotos\.aplicados,\s*\n\s*assinaturas,/);

(async () => {
  const runtime = new DesktopSupabaseRuntime();
  const eventos = [];
  let consultas = 0;
  let sincronizacoesAgendadas = 0;
  runtime.client = {};
  runtime.contexto = { empresa_id: 'empresa-teste' };
  runtime.janela = () => ({ webContents: { send: (canal, dados) => eventos.push({ canal, dados }) } });
  runtime.solicitarSincronizacao = () => { sincronizacoesAgendadas += 1; };
  runtime._baixarRespostasAssinatura = async () => {
    consultas += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return 1;
  };

  const [a, b] = await Promise.all([
    runtime.verificarRespostasAssinatura(),
    runtime.verificarRespostasAssinatura()
  ]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(consultas, 1, 'consultas simultâneas devem compartilhar o mesmo pedido');
  assert.equal(eventos.length, 1, 'a interface deve receber somente um aviso por resposta');
  assert.equal(eventos[0].canal, 'supabase:sincronizado');
  assert.equal(eventos[0].dados.assinaturas, 1);
  assert.equal(sincronizacoesAgendadas, 1);
  console.log('OK: assinatura do celular é consultada em até 12 segundos, sem sincronizações duplicadas.');
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
