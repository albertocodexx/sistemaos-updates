'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const migration = ler('supabase', 'migrations', '20260906000100_trial_45_dias_chamados_seguros.sql');
const trialNovo = ler('supabase', 'migrations', '20260926000200_trial_fiscal_30_dias.sql');
const betaSeparado = ler('supabase', 'migrations', '20260926000300_beta_45_trial_30.sql');
const admin = ler('supabase', 'functions', 'admin-global', 'index.ts');
const chamados = ler('supabase', 'functions', 'chamados-suporte', 'index.ts');
const acessoEdge = ler('supabase', 'functions', '_shared', 'access.ts');
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

assert.match(trialNovo, /duracao_dias = 30/);
assert.match(trialNovo, /new\.limite_gratuito_mensal := 30/);
assert.match(trialNovo, /e\.fim_trial > now\(\)/);
assert.match(betaSeparado, /select 'Beta'/);
assert.match(betaSeparado, /duracao_dias = 45/);
assert.match(betaSeparado, /lower\(p\.nome\) in \('trial', 'beta'\)/);
assert.match(admin, /tipoTeste === 'beta' \? 45 : 30/);
assert.match(admin, /limite_gratuito_mensal: 0/);
assert.match(admin, /beta_fundador: tipoTeste === 'beta'/);
assert.match(admin, /data_vencimento: fim\.toISOString\(\)/);
assert.match(admin, /periodo_graca_ate: null/);
assert.match(admin, /fiscal_habilitado: true/);
assert.match(runtime, /contexto\.data_vencimento \|\| contexto\.fim_trial/);
assert.match(principal, /abrirBloqueioTrial/);
assert.match(principal, /<option value="trial">Trial — 30 dias<\/option><option value="beta">Beta — 45 dias<\/option>/);
assert.match(assinatura, /Seu período de teste chegou ao fim/);
assert.match(assinatura, /Falar com o suporte/);
assert.match(assinatura, /motivo: 'trial_assinatura'/);

for (const id of ['telefoneNovoChamado', 'emailNovoChamado', 'motivoNovoChamado', 'detalheNovoChamado', 'complementoNovoChamado', 'preferenciaContatoNovoChamado']) {
  assert.match(formulario, new RegExp(id));
}
assert.doesNotMatch(formulario, /for="(?:empresa|usuario|nome)NovoChamado"/);
assert.match(formulario, /Empresa e usuário identificados automaticamente/);
for (const fluxo of ['cobranca_pagamento', 'acesso_login', 'sincronizacao_backup', 'documento_assinatura', 'erro_sistema', 'configuracao_integracao']) {
  assert.match(formulario, new RegExp(fluxo + ':'));
}
assert.match(formulario, /outro: 'Outro motivo'/);
assert.match(chamados, /detalhe: detalhe \|\| null/);
assert.match(chamados, /complemento: complemento \|\| null/);
assert.match(chamados, /cargoEmpresa && !cargosEmpresaValidos/);
assert.match(chamados, /identidades_login/);
assert.match(chamados, /\.eq\('aberto_por', autenticado\.usuario\.id\)/);
assert.match(chamados, /podeAcessarAutenticado/);
assert.match(chamados, /token_hash:\s*tokenHash/);
assert.doesNotMatch(chamados, /\.eq\('public_token', token\)/);
assert.match(chamados, /public_token\.eq\.\$\{token\}/);
assert.doesNotMatch(migration, /set public_token = null/i);
assert.match(chamados, /Retencao segura/);
assert.doesNotMatch(chamados, /from\('chamados_suporte'\)\.delete\(\)/);

assert.match(chamados, /import \{ contextoUsuarioAtivo, ehAdministradorEmpresa \}/);
assert.match(acessoEdge, /CARGOS_ADMINISTRATIVOS\.has\(textoNormalizado\(contexto\.cargo\)\)/);
assert.doesNotMatch(acessoEdge, /Boolean\(.*configuracoes/,
  'Visualizar configurações não pode autorizar leitura dos chamados dos colegas.');

console.log('OK: Beta antigo de 45 dias separado do Trial novo de 30 dias; chamados mantêm bloqueio e privacidade.');
