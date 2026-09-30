'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'renderer/style.css'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'renderer/core/legacy-runtime.js'), 'utf8');
const planos = fs.readFileSync(path.join(raiz, 'renderer/modules/assinaturas/saas.js'), 'utf8');
const edge = fs.readFileSync(path.join(raiz, 'supabase/functions/integracoes-empresa/index.ts'), 'utf8');
const chat = fs.readFileSync(path.join(raiz, 'src/ia-chat.js'), 'utf8');

assert.match(html, /id="configIntegracaoIAEmpresa" hidden aria-hidden="true"/);
assert.match(css, /#configIntegracaoIAEmpresa\[hidden\]\s*\{\s*display:\s*none\s*!important/);
assert.match(edge, /personalizacaoEmpresaPermitida\s*=\s*personalizacaoGlobalAtiva\s*&&/);
assert.ok(edge.indexOf("if (!personalizacaoEmpresaPermitida) {") < edge.indexOf("if (acao === 'desconectar')"),
  'desconectar chave da empresa também exige personalização liberada');
assert.match(planos, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(planos, /assinatura-plano-selos.*gap:6px 10px/);
assert.match(planos, /<div class="assinatura-plano-selos">/);
assert.match(planos, /@media\(max-width:700px\)\{\.assinatura-planos/);

const inicio = runtime.indexOf('function atualizarFluxoIAConfig(');
const fim = runtime.indexOf('\nasync function carregarIntegracaoIAEmpresa(', inicio);
assert.ok(inicio >= 0 && fim > inicio);
const elementos = Object.fromEntries([
  'configIntegracaoIAEmpresa', 'iaChatProviderConfig', 'iaChatModelConfig', 'iaChatApiKeyConfig',
  'labelChaveIAConfig', 'ajudaChaveIAConfig', 'btnTestarGroqChat'
].map((id) => [id, { value: '', hidden: true, disabled: false, setAttribute(nome, valor) { this[nome] = valor; } }]));
elementos.iaChatProviderConfig.value = 'groq';
const contexto = {
  $: (id) => elementos[id],
  document: { querySelector: () => null },
  configAtual: {},
  integracaoIAEmpresaCache: null,
  integracaoIAContextoCache: null,
  usuarioAtual: { admin: true, origemAuth: 'supabase' },
  PROVEDORES_IA_CONFIG: { groq: { nome: 'Groq', flagLocal: 'possuiGroqChatKey', placeholder: 'gsk_...' } },
  exibirChipChaveSalva: () => {}
};
vm.createContext(contexto);
vm.runInContext(`${runtime.slice(inicio, fim)}\nthis.atualizarFluxoIAConfig = atualizarFluxoIAConfig;`, contexto);
const verificar = (global, empresa, admin, visivel) => {
  contexto.integracaoIAContextoCache = { configuracao_global: {
    personalizacao_empresas_ativa: global,
    personalizacao_empresa_permitida: empresa
  } };
  contexto.usuarioAtual.admin = admin;
  elementos.iaChatApiKeyConfig.value = 'chave-temporaria';
  contexto.atualizarFluxoIAConfig();
  assert.equal(elementos.configIntegracaoIAEmpresa.hidden, !visivel);
  assert.equal(elementos.configIntegracaoIAEmpresa['aria-hidden'], visivel ? 'false' : 'true');
  assert.equal(elementos.iaChatApiKeyConfig.disabled, !visivel);
  assert.equal(elementos.btnTestarGroqChat.disabled, !visivel);
  assert.equal(elementos.iaChatApiKeyConfig.value, '');
};
contexto.atualizarFluxoIAConfig();
assert.equal(elementos.configIntegracaoIAEmpresa.hidden, true, 'sem resposta do servidor deve ficar oculto');
verificar(false, false, true, false);
verificar(true, false, true, false);
verificar(true, true, false, false);
verificar(true, true, true, true);
verificar(false, false, true, false);

const inicioChamada = chat.indexOf('const executarChamada = async (mensagensDaVez) => {');
const fimChamada = chat.indexOf('\n\n    let respostaGroq', inicioChamada);
assert.ok(inicioChamada >= 0 && fimChamada > inicioChamada);
let chamadasLocais = 0;
let opcoesRecebidas = null;
const testeChamada = {
  usuario: { origemAuth: 'supabase' },
  opcoesIA: { apiKey: 'CHAVE_LOCAL_TESTE', maxTokens: 250 },
  apiKey: 'CHAVE_LOCAL_TESTE',
  configFull: {},
  chamarIARemota: async (_mensagens, opcoes) => { opcoesRecebidas = opcoes; return { sucesso: true }; },
  chamarIA: async () => { chamadasLocais += 1; return { sucesso: true }; }
};
vm.createContext(testeChamada);
vm.runInContext(`${chat.slice(inicioChamada, fimChamada)}\nthis.executarChamada = executarChamada;`, testeChamada);

(async () => {
  await testeChamada.executarChamada([{ role: 'user', content: 'teste' }]);
  assert.equal(opcoesRecebidas.apiKey, undefined, 'chave local não pode sair no payload remoto');
  testeChamada.chamarIARemota = async () => { throw new Error('limite global'); };
  await assert.rejects(testeChamada.executarChamada([]), /limite global/);
  assert.equal(chamadasLocais, 0, 'conta Supabase não pode contornar bloqueio nem cota com chave local');
  testeChamada.usuario = { origemAuth: 'local' };
  await testeChamada.executarChamada([]);
  assert.equal(chamadasLocais, 1, 'instalação legada local mantém sua chave');
  console.log('OK: API da empresa oculta sem permissão global; cards legíveis e sem fallback de chave local na nuvem.');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
