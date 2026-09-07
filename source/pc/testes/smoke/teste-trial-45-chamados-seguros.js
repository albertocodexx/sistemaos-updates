'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const migration = ler('supabase', 'migrations', '20260906000100_trial_45_dias_chamados_seguros.sql');
const admin = ler('supabase', 'functions', 'admin-global', 'index.ts');
const chamados = ler('supabase', 'functions', 'chamados-suporte', 'index.ts');
const runtime = ler('src', 'supabase', 'desktop-runtime.js');
const principal = ler('renderer', 'core', 'legacy-runtime.js');
const formulario = ler('renderer', 'modules', 'suporte', 'chamados.js');
const assinatura = ler('renderer', 'modules', 'assinaturas', 'saas.js');

assert.match(migration, /duracao_dias = 45/);
assert.match(migration, /'trial_dias', 45/);
assert.match(migration, /cross join public\.recursos/);
assert.match(migration, /periodo_graca_ate = null/);
assert.match(migration, /fim_trial = case[\s\S]*interval '45 days'/);
assert.match(migration, /token_hash/);
assert.match(migration, /extensions\.digest\(public_token::text, 'sha256'\)/);
assert.match(migration, /registrar_limite_chamado_publico/);
assert.match(migration, /aberto_por = auth\.uid\(\)/);
assert.match(migration, /excluido_em is null/);

assert.match(admin, /const diasTrial = 45/);
assert.match(admin, /periodo_graca_ate: null/);
assert.match(admin, /fiscal_habilitado: true/);
assert.match(runtime, /contexto\.data_vencimento \|\| contexto\.fim_trial/);
assert.match(principal, /abrirBloqueioTrial/);
assert.match(principal, /value="45" readonly/);
assert.match(assinatura, /Seu período de teste chegou ao fim/);
assert.match(assinatura, /Falar com o suporte/);
assert.match(assinatura, /motivo: 'trial_assinatura'/);

for (const id of ['usuarioNovoChamado', 'telefoneNovoChamado', 'emailNovoChamado', 'cargoEmpresaNovoChamado', 'motivoNovoChamado', 'preferenciaContatoNovoChamado']) {
  assert.match(formulario, new RegExp(id));
}
assert.match(formulario, /outro: 'Outro motivo'/);
assert.match(chamados, /identidades_login/);
assert.match(chamados, /\.eq\('aberto_por', autenticado\.usuario\.id\)/);
assert.match(chamados, /podeAcessarAutenticado/);
assert.match(chamados, /token_hash:\s*tokenHash/);
assert.doesNotMatch(chamados, /\.eq\('public_token', token\)/);
assert.match(chamados, /public_token\.eq\.\$\{token\}/);
assert.doesNotMatch(migration, /set public_token = null/i);
assert.match(chamados, /Retencao segura/);
assert.doesNotMatch(chamados, /from\('chamados_suporte'\)\.delete\(\)/);

const funcaoAdmin = chamados.match(/function ehAdministradorEmpresa\([\s\S]*?\n\}/)[0]
  .replace(/\(contexto: [^\n]+\) \{/, '(contexto) {');
const verificarAdmin = new Function('texto', funcaoAdmin + '; return ehAdministradorEmpresa;')((v) => String(v || '').trim());
assert.equal(verificarAdmin({ cargo: 'Tecnico', permissoes: { configuracoes: { visualizar: true } } }), false,
  'Visualizar configuracoes nao autoriza ler chamados dos colegas.');
assert.equal(verificarAdmin({ cargo: 'Administrador' }), true);
assert.equal(verificarAdmin({ cargo: 'Tecnico', permissoes: { configuracoes: false } }), false);

console.log('OK: Trial de 45 dias e chamados estruturados possuem bloqueio, privacidade e retencao segura.');
