'use strict';

const assert = require('node:assert/strict');
const cryptoNode = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const fonte = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/functions/mercado-pago-saas-webhook/index.ts'),
  'utf8'
);
const prefixo = fonte.slice(0, fonte.indexOf('Deno.serve'))
  .replace(/^import[^\n]*\n/, '');
const contexto = {
  Request, Response, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
  atob, crypto: cryptoNode.webcrypto,
  Deno: { env: { get() { return ''; } } }
};
vm.createContext(contexto);
vm.runInContext(stripTypeScriptTypes(prefixo) + '\nglobalThis.validar = validarAssinatura;', contexto);

function assinatura(segredo, dataIdManifesto, requestId, ts) {
  return cryptoNode.createHmac('sha256', segredo)
    .update(`id:${dataIdManifesto};request-id:${requestId};ts:${ts};`)
    .digest('hex');
}

async function main() {
  const segredo = 'segredo-fixture-com-mais-de-16-caracteres';
  const dataId = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
  const requestId = cryptoNode.randomUUID();
  const tsMs = String(Date.now());
  const valida = assinatura(segredo, dataId.toLowerCase(), requestId, tsMs);
  const requisicao = new Request('https://fixture.invalid/webhook', {
    headers: { 'x-request-id': requestId, 'x-signature': `ts=${tsMs},v1=${valida}` }
  });
  assert.equal(await contexto.validar(requisicao, dataId, segredo), true,
    'merchant_order em maiúsculas deve validar com manifesto em minúsculas');

  const errada = assinatura(segredo, dataId, requestId, tsMs);
  assert.equal(await contexto.validar(new Request('https://fixture.invalid/webhook', {
    headers: { 'x-request-id': requestId, 'x-signature': `ts=${tsMs},v1=${errada}` }
  }), dataId, segredo), false, 'manifesto sem normalização não deve ser aceito');

  const tsSegundos = String(Math.floor(Date.now() / 1000));
  const validaSegundos = assinatura(segredo, '123456', requestId, tsSegundos);
  assert.equal(await contexto.validar(new Request('https://fixture.invalid/webhook', {
    headers: { 'x-request-id': requestId, 'x-signature': `ts=${tsSegundos},v1=${validaSegundos}` }
  }), '123456', segredo), true, 'timestamp em segundos também é aceito');

  const antigo = String(Date.now() - 11 * 60 * 1000);
  const assinaturaAntiga = assinatura(segredo, '123456', requestId, antigo);
  assert.equal(await contexto.validar(new Request('https://fixture.invalid/webhook', {
    headers: { 'x-request-id': requestId, 'x-signature': `ts=${antigo},v1=${assinaturaAntiga}` }
  }), '123456', segredo), false, 'replay fora da janela deve falhar');
  assert.equal(await contexto.validar(requisicao, dataId, 'segredo-incorreto'), false);
  assert.equal(await contexto.validar(new Request('https://fixture.invalid/webhook'), dataId, segredo), false);

  console.log('OK: assinatura HMAC do webhook MP normaliza IDs, aceita timestamps válidos e bloqueia adulteração/replay.');
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
