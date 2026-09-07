'use strict';
// Executa os handlers reais, substituindo apenas Supabase, HTTP e relogio.
// Nenhuma requisicao sai deste processo e todos os usuarios sao ficticios.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto, createHmac } = require('node:crypto');
function carregar(nome, extras, expoe = '') {
  let codigo = fs.readFileSync(path.join(__dirname, '../../supabase/functions', nome, 'index.ts'), 'utf8');
  codigo = codigo.replace(/^import .*createClient.*;\r?\n/m, '');
  let handler;
  const ambiente = { Request, Response, Headers, URL, TextEncoder, TextDecoder, Uint8Array,
    crypto: webcrypto, AbortSignal, atob, console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: nome => nome === 'SUPABASE_URL' ? 'https://qa.invalid' : 'fixture-local' }, serve: fn => { handler = fn; } }, ...extras };
  vm.createContext(ambiente);
  vm.runInContext(stripTypeScriptTypes(codigo) + '\n' + expoe, ambiente);
  return { ambiente, handler };
}
async function main() {
  let bancoChamadas = 0, authChamadas = 0, falhas = 0, limiteFalha = false, bloqueadoBanco = false, authStatus = 401;
  const admin = {
    async rpc(nome) {
      bancoChamadas++;
      if (nome === 'verificar_limite_login') return { data: { bloqueado: bloqueadoBanco }, error: limiteFalha ? { code: 'PGRST002' } : null };
      if (nome === 'registrar_falha_login') falhas++;
      return { data: {}, error: null };
    },
    from(tabela) {
      const q = { select: () => q, eq: () => q, insert: async () => ({ error: null }), maybeSingle: async () => {
        bancoChamadas++;
        return { data: tabela === 'empresas' ? { id: 'empresa-qa' } : { email_tecnico: 'qa@example.invalid', empresa_id: 'empresa-qa', usuario_id: 'operador-qa' }, error: null };
      } }; return q;
    }
  };
  const carregarLogin = () => carregar('auth-login', { createClient: () => admin,
    fetch: async () => { authChamadas++; return new Response(JSON.stringify(authStatus === 200 ? { access_token: 'qa-access', refresh_token: 'qa-refresh' } : {}), { status: authStatus }); }
  });
  let { handler } = carregarLogin();
  const pedido = (corpo = { empresa: 'empresa-qa', usuario: 'operador', senha: 'senha-de-fixture' }) => new Request('https://qa.invalid/login', {
    method: 'POST', body: JSON.stringify(corpo), headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.1' }
  });
  for (const corpo of [{}, { empresa: '../escape', usuario: 'abc', senha: 'x' }, { empresa: 'abc', usuario: 'admin', senha: 'x'.repeat(129) }]) {
    assert.equal((await handler(pedido(corpo))).status, 401);
  }
  assert.equal(bancoChamadas, 0, 'entradas invalidas nao chegam ao banco');
  for (let i = 0; i < 5; i++) assert.equal((await handler(pedido())).status, 401);
  assert.equal(authChamadas, 5);
  const antes = bancoChamadas;
  for (let i = 0; i < 100; i++) assert.equal((await handler(pedido())).status, 429);
  assert.equal(bancoChamadas, antes, 'rajada bloqueada antes do banco');
  assert.equal(authChamadas, 5, 'rajada bloqueada antes de Auth');
  assert.equal(falhas, 5);
  ({ handler } = carregarLogin()); bloqueadoBanco = true;
  assert.equal((await handler(pedido())).status, 429);
  assert.equal(authChamadas, 5);
  bloqueadoBanco = false; limiteFalha = true;
  assert.equal((await handler(pedido())).status, 503);
  assert.equal(authChamadas, 5, 'indisponibilidade do limite falha fechado');
  limiteFalha = false; ({ handler } = carregarLogin()); authStatus = 503;
  assert.equal((await handler(pedido())).status, 503);
  assert.equal(falhas, 5, 'queda de Auth nao penaliza senha');
  authStatus = 200;
  assert.equal((await handler(pedido())).status, 200);
  console.log('OK: login isolado — validacao, 100 tentativas bloqueadas, limite persistente, falha fechada e indisponibilidade.');

  const webhook = carregar('mercado-pago-saas-webhook', { createClient: () => { throw Error('rede proibida'); } }, 'globalThis.verificar = validarAssinatura;');
  const segredo = 'segredo-aleatorio-exclusivo-do-teste';
  const criar = (id = '123', ts = String(Date.now()), requestId = 'qa-request') => {
    const hash = createHmac('sha256', segredo).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
    return new Request('https://qa.invalid/webhook', { method: 'POST', headers: { 'x-signature': `ts=${ts},v1=${hash}`, 'x-request-id': requestId } });
  };
  assert.equal(await webhook.ambiente.verificar(criar(), '123', segredo), true);
  assert.equal(await webhook.ambiente.verificar(criar(), '456', segredo), false);
  assert.equal(await webhook.ambiente.verificar(criar(), '123', 'outro'), false);
  assert.equal(await webhook.ambiente.verificar(criar(), '123', ''), false);
  assert.equal(await webhook.ambiente.verificar(criar('123', String(Date.now() - 700000)), '123', segredo), false);
  assert.equal(await webhook.ambiente.verificar(criar('123', String(Date.now() + 700000)), '123', segredo), false);
  assert.equal(await webhook.ambiente.verificar(criar('123', 'NaN'), '123', segredo), false);
  assert.equal(await webhook.ambiente.verificar(criar('123', String(Date.now()), ''), '123', segredo), false);
  assert.equal(await webhook.ambiente.verificar(new Request('https://qa.invalid'), '123', segredo), false);
  assert.equal((await webhook.handler(new Request('https://qa.invalid'))).status, 405);
  console.log('OK: webhook isolado — assinatura valida, adulteracao, segredo ausente, replay expirado e metodos invalidos.');
}
main().catch(erro => { console.error(erro); process.exitCode = 1; });
