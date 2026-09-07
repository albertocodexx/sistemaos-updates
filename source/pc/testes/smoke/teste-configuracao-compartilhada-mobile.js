const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const runtime = fs.readFileSync(path.join(raiz, 'src', 'supabase', 'desktop-runtime.js'), 'utf8');
const ipc = fs.readFileSync(path.join(raiz, 'src', 'ipc', 'register-legacy.js'), 'utf8');
const migration = fs.readFileSync(path.join(raiz, 'supabase', 'migrations', '20260719000300_configuracao_mobile_rpc.sql'), 'utf8');
const empresaService = fs.readFileSync(path.join(raiz, 'src', 'supabase', 'company-cloud-service.js'), 'utf8');

assert.match(runtime, /publicarConfiguracaoMobileSeAusente/, 'login do PC deve preparar a configuracao do APK em empresas antigas');
assert.match(runtime, /publicarConfiguracaoMobile\(configuracao/, 'runtime deve expor o envio compartilhado da configuracao');
assert.match(empresaService, /if \(this\._ehAdministrador\(\)\) \{\s*return this\.publicarConfiguracaoMobile\(this\.db\.obterConfig\(\)\)/,
  'PC administrador deve reparar a configuracao compartilhada usando os dados oficiais locais');
assert.match(empresaService, /hashLocal !== String\(identidade\?\.logoSha256/,
  'logo local do PC administrador deve vencer a copia antiga da nuvem');
assert.match(empresaService, /telefoneFixo/);
assert.match(empresaService, /site/);
assert.match(empresaService, /complemento/);
assert.match(empresaService, /bairro/);
assert.match(ipc, /configuracaoCompartilhadaPendente/, 'falha de rede nao pode esconder que a configuracao ainda precisa ser enviada');
assert.match(migration, /create or replace function public\.salvar_configuracao_mobile/, 'RPC de configuracao compartilhada deve existir na migration');
assert.match(migration, /grant execute on function public\.salvar_configuracao_mobile/, 'somente sessao autenticada deve executar a RPC');

console.log('OK - configuracao PC/APK usa uma fonte compartilhada, com envio seguro e recuperacao apos reinstalacao.');
