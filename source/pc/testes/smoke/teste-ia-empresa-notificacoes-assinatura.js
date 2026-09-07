'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(raiz, 'renderer', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(raiz, 'renderer', 'core', 'legacy-runtime.js'), 'utf8');
const saas = fs.readFileSync(path.join(raiz, 'renderer', 'modules', 'assinaturas', 'saas.js'), 'utf8');
const runtime = fs.readFileSync(path.join(raiz, 'src', 'supabase', 'desktop-runtime.js'), 'utf8');
const integracoes = fs.readFileSync(path.join(raiz, 'supabase', 'functions', 'integracoes-empresa', 'index.ts'), 'utf8');
const admin = fs.readFileSync(path.join(raiz, 'supabase', 'functions', 'admin-global', 'index.ts'), 'utf8');
const migracao = fs.readFileSync(path.join(raiz, 'supabase', 'migrations', '20260905000100_integracao_ia_por_empresa.sql'), 'utf8');

assert.match(html, /id="iaChatProviderConfig"/);
assert.match(html, /id="iaChatModelConfig"[^>]*><\/select>/);
assert.match(html, /id="iaChatApiKeyConfig"/);
['groqChatApiKeyConfig', 'openaiApiKeyConfig', 'anthropicApiKeyConfig', 'deepseekApiKeyConfig'].forEach((id) => {
  assert.ok(!html.includes(`id="${id}"`), `o formulário não deve exibir o campo antigo ${id}`);
});
assert.match(renderer, /const PROVEDORES_IA_CONFIG/);
assert.match(renderer, /abrirIntegracaoIAEmpresaGlobal/);
assert.match(renderer, /Assistente IA/);
assert.match(renderer, /sistemaos_notificacoes_v2/);
assert.match(renderer, /usuarioAtual\.administradorGlobal \|\| usuarioAtual\.acessoSomenteCobranca/);
assert.match(renderer, /statusAtual = empresaInternaSuporte/);
assert.match(renderer, /vencimentoMs <= Date\.now\(\)/);
assert.match(saas, /quantidadeMesesAssinatura/);
assert.match(saas, /quantidadeMeses \}/);
assert.match(saas, /quantidadeMeses = 1;/);
assert.match(runtime, /venceuPelaData/);
assert.match(runtime, /async integracaoIA/);
assert.match(integracoes, /tipo === 'ia'/);
assert.match(integracoes, /integracao_ia_configurada/);
assert.match(admin, /configurar_integracao_ia_empresa/);
assert.match(admin, /integracao_ia_configurada_suporte/);
assert.match(migracao, /'ia'/);

console.log('OK: IA por empresa, cobrança SaaS em meses e notificações isoladas por conta estão protegidas por regressão.');
