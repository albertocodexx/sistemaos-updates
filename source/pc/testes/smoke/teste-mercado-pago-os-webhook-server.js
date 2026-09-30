'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const empresaId = '11111111-1111-4111-8111-111111111111';
const cobrancaId = '22222222-2222-4222-8222-222222222222';
const ordemId = '33333333-3333-4333-8333-333333333333';
const tokenWebhook = 'w'.repeat(48);

const base64 = (bytes) => Buffer.from(bytes).toString('base64');

async function cifrar(segredo, chaveBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chave = await crypto.subtle.importKey('raw', chaveBytes, 'AES-GCM', false, ['encrypt']);
  const cifra = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave,
    new TextEncoder().encode(segredo));
  return { iv_base64: base64(iv), segredo_cifrado_base64: base64(new Uint8Array(cifra)) };
}

async function executar(pagamentoAlterado = {}, token = tokenWebhook) {
  const chaveBytes = new Uint8Array(32).fill(7);
  const segredo = await cifrar('APP_USR-token-servidor', chaveBytes);
  const cobranca = {
    id: cobrancaId, empresa_id: empresaId, ordem_id: ordemId, numero_os: 'OS-0001',
    valor_centavos: 17500, moeda: 'BRL', referencia_externa: `OSPAY-${cobrancaId}`,
    status: 'pendente', pagamento_provedor_id: null
  };
  const integracao = { id: '44444444-4444-4444-8444-444444444444', status: 'conectada' };
  const pagamento = {
    id: 987654321, status: 'approved', status_detail: 'accredited', live_mode: true,
    currency_id: 'BRL', transaction_amount: 175, transaction_amount_refunded: 0,
    external_reference: cobranca.referencia_externa, date_created: new Date().toISOString(),
    date_approved: new Date().toISOString(), payment_type_id: 'bank_transfer', payment_method_id: 'pix',
    metadata: { empresa_id: empresaId, cobranca_id: cobrancaId, ordem_id: ordemId },
    ...pagamentoAlterado
  };
  const chamadasRpc = [];
  const atualizacoes = [];
  let consultas = 0;
  function query(tabela) {
    const filtros = [];
    let atualizacao = null;
    const q = {
      select() { return q; },
      update(valor) { atualizacao = valor; return q; },
      eq(campo, valor) { filtros.push([campo, valor]); return q; },
      async maybeSingle() {
        consultas += 1;
        if (tabela === 'cobrancas_os_mp') {
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tokenWebhook));
          const esperado = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
          const corresponde = filtros.every(([campo, valor]) => campo === 'webhook_token_hash'
            ? valor === esperado : cobranca[campo] === valor);
          return { data: corresponde ? { ...cobranca } : null, error: null };
        }
        if (tabela === 'integracoes_empresa') return { data: { ...integracao }, error: null };
        if (tabela === 'integracoes_segredos') return { data: { ...segredo }, error: null };
        return { data: null, error: null };
      },
      then(resolve, reject) {
        if (atualizacao) atualizacoes.push({ tabela, atualizacao, filtros });
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
    };
    return q;
  }
  const admin = {
    from: query,
    async rpc(nome, parametros) {
      chamadasRpc.push({ nome, parametros });
      return { data: { aplicada: true }, error: null };
    }
  };
  let atender;
  const arquivo = path.join(__dirname, '../../supabase/functions/mercado-pago-os-webhook/index.ts');
  let codigo = fs.readFileSync(arquivo, 'utf8').replace(/^import[^\n]+\r?\n/, '');
  const contexto = {
    Request, Response, Headers, URL, AbortSignal, TextEncoder, TextDecoder, atob, crypto,
    console: { error() {} }, createClient: () => admin,
    fetch: async () => new Response(JSON.stringify(pagamento), { status: 200 }),
    Deno: {
      env: { get(nome) {
        if (nome === 'INTEGRATION_ENCRYPTION_KEY') return base64(chaveBytes);
        if (nome === 'SUPABASE_URL') return 'https://qa.invalid';
        if (nome === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-fixture';
        return '';
      } },
      serve(funcao) { atender = funcao; }
    }
  };
  vm.createContext(contexto);
  vm.runInContext(stripTypeScriptTypes(codigo), contexto);
  const resposta = await atender(new Request(
    `https://qa.invalid/functions/v1/mercado-pago-os-webhook?empresa=${empresaId}&token=${token}&type=payment&data.id=987654321`,
    { method: 'POST', body: JSON.stringify({ type: 'payment', data: { id: '987654321' } }) }
  ));
  return { status: resposta.status, corpo: await resposta.json(), chamadasRpc, atualizacoes, consultas };
}

(async () => {
  const ok = await executar();
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.status, 'aprovada');
  assert.equal(ok.chamadasRpc.length, 1);
  assert.equal(ok.chamadasRpc[0].nome, 'aplicar_status_cobranca_os_mp');
  assert.equal(ok.chamadasRpc[0].parametros.p_valor_centavos, 17500);
  assert.equal(ok.chamadasRpc[0].parametros.p_cobranca_id, cobrancaId);

  const adulterado = await executar({ transaction_amount: 350 });
  assert.equal(adulterado.status, 200);
  assert.equal(adulterado.corpo.divergencia, true);
  assert.equal(adulterado.chamadasRpc.length, 0, 'valor divergente nunca chega a transacao');
  assert.equal(adulterado.atualizacoes.length, 1, 'divergencia fica auditavel na cobranca');

  const sandbox = await executar({ live_mode: false });
  assert.equal(sandbox.chamadasRpc.length, 0, 'token de producao recusa pagamento de teste');
  assert.equal(sandbox.corpo.ignorado, true);

  const tokenErrado = await executar({}, 'x'.repeat(48));
  assert.equal(tokenErrado.chamadasRpc.length, 0);
  assert.equal(tokenErrado.corpo.ignorado, true);

  const integracoes = fs.readFileSync(path.join(__dirname,
    '../../supabase/functions/integracoes-empresa/index.ts'), 'utf8');
  assert.match(integracoes, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(integracoes, /sincronizar_preferencia_os_mp/);
  assert.match(integracoes, /X-Idempotency-Key/);
  console.log('OK: webhook de OS confere token, tenant, valor, ambiente e aplica uma unica transacao.');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
