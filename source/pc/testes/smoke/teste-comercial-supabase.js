const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

const desktopConfig = require('../../src/supabase/public-config');
assert(/^https:\/\/[^/]+\.supabase\.co$/i.test(desktopConfig.url));
assert(/^sb_publishable_/i.test(desktopConfig.anonKey));
assert(!/secret|service_role|loginAliases/i.test(JSON.stringify(desktopConfig)));

const desktopRuntime = ler('src', 'supabase', 'desktop-runtime.js');
const mobileAuth = ler('..', 'sistemaos-android', 'www', 'js', 'supabase', 'auth-service.js');
const mobileConfig = ler('..', 'sistemaos-android', 'www', 'js', 'supabase', 'public-config.js');
assert(desktopRuntime.includes("functions.invoke('auth-login'"));
assert(mobileAuth.includes("functions.invoke('auth-login'"));
assert(!desktopRuntime.includes('signInWithPassword'));
assert(!mobileAuth.includes('signInWithPassword'));
const contextoMobile = {};
vm.runInNewContext(mobileConfig, contextoMobile);
const configMobilePublica = contextoMobile.SistemaOSPublicConfig;
assert(configMobilePublica && /^https:\/\//.test(configMobilePublica.supabaseUrl));
assert(!/(?:serviceRole|supabaseSecret|loginAliases|gsk_|sb_secret_)/i.test(JSON.stringify(configMobilePublica)));

const migration = ler('supabase', 'migrations', '20260717001400_licenciamento_comercial.sql');
[
  'create table if not exists public.planos',
  'create table if not exists public.identidades_login',
  'create table if not exists public.pagamentos_assinatura',
  'create table if not exists public.auditoria_comercial',
  'create table if not exists public.integracoes_empresa',
  'create or replace function public.calcular_status_licenca_empresa',
  'create or replace function public.obter_contexto_comercial',
  'create or replace function public.atualizar_licenca_empresa',
  'create or replace function public.confirmar_pagamento_assinatura'
].forEach((trecho) => assert(migration.includes(trecho), 'Migração comercial sem: ' + trecho));
assert(migration.includes("in ('ativa', 'teste', 'vencendo', 'periodo_graca')"));
const acessosMigration = ler('supabase', 'migrations', '20260717001600_dispositivos_e_acessos_comerciais.sql');
assert(acessosMigration.includes('create table if not exists public.dispositivos_empresa'));
assert(acessosMigration.includes('create or replace function public.registrar_acesso_comercial'));
assert(acessosMigration.includes("digest(btrim(p_identificador), 'sha256')"));

const globalEdge = ler('supabase', 'functions', 'admin-global', 'index.ts');
['criar_empresa', 'resetar_senha', 'listar_planos', 'salvar_plano', 'atualizar_licenca', 'confirmar_pagamento', 'listar_usuarios_empresa', 'criar_usuario_empresa', 'atualizar_usuario_empresa', 'listar_empresas']
  .forEach((acao) => assert(globalEdge.includes("acao === '" + acao + "'"), 'Ação global ausente: ' + acao));
assert(globalEdge.includes("rpc('obter_contexto_comercial')"));
assert(globalEdge.includes('administrador_global'));
assert(!/console\.error\([^\n]*senha|console\.error\([^\n]*token/i.test(globalEdge));

const painelGlobal = ler('renderer', 'core', 'legacy-runtime.js');
['Adicionar dias', 'Bloquear', 'Arquivar', 'Cobranças:', 'confirmarPagamentoGlobal', 'alterarAcessoEmpresaGlobal', 'carregarUsuariosEmpresaGlobal', 'salvarUsuarioEmpresaGlobal']
  .forEach((trecho) => assert(painelGlobal.includes(trecho), 'Painel global sem ação comercial: ' + trecho));
const painelHtml = ler('renderer', 'index.html');
['metricasSuporteGlobal', 'buscaEmpresaGlobal', 'btnNovoPlanoGlobal', 'modalUsuariosEmpresaGlobal', 'formUsuarioEmpresaGlobal']
  .forEach((id) => assert(painelHtml.includes('id="' + id + '"'), 'Painel global sem componente: ' + id));

const integracoesEdge = ler('supabase', 'functions', 'integracoes-empresa', 'index.ts');
assert(integracoesEdge.includes('INTEGRATION_ENCRYPTION_KEY'));
assert(integracoesEdge.includes('AES-GCM'));
assert(!integracoesEdge.includes('accessToken: token'));

console.log('OK: login direto, licença, painel global e integrações comerciais estão protegidos por contratos locais.');
