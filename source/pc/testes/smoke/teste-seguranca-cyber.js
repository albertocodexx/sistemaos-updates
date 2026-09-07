const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const main = ler('main.js');
const html = ler('renderer', 'index.html');
const db = ler('src', 'database', 'domain.js');
const auth = ler('src', 'auth.js');
const webhook = ler('supabase', 'functions', 'mercado-pago-saas-webhook', 'index.ts');
const login = ler('supabase', 'functions', 'auth-login', 'index.ts');
const integracoes = ler('supabase', 'functions', 'integracoes-empresa', 'index.ts');
const pacote = require('../../package.json');

assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
assert.match(main, /will-navigate/);
assert.match(main, /will-attach-webview/);
assert.match(main, /devTools: !app\.isPackaged/);
assert.match(main, /if \(!app\.isPackaged\)[\s\S]*?toggleDevTools/);
assert.match(html, /Content-Security-Policy/);
assert.match(html, /object-src 'none'/);
assert.match(html, /connect-src 'none'/);

assert.match(main, /criarIpcMainSeguro/);
assert(fs.existsSync(path.join(raiz, 'src', 'ipc', 'secure-ipc.js')));
const ipcSeguro = require('../../src/ipc/secure-ipc');
assert(ipcSeguro.CANAIS_SOMENTE_ADMIN.has('sistema:zerar'));
assert.equal(ipcSeguro.moduloDoCanal('mp:gerarLink'), 'financeiro');

assert.match(db, /sistemaos-safe-storage-v1:/);
assert.match(db, /encryptString/);
assert.match(db, /decryptString/);
assert.match(db, /configBackup/);
assert.doesNotMatch(db, /configSemSenha\.mascara(?:TokenMP|WappflyKey|GroqKey|GroqChatKey)/);

assert.match(auth, /ITERACOES_SENHA_ATUAIS = 210_000/);
assert.match(auth, /MAX_TENTATIVAS_LOGIN = 5/);
assert.match(auth, /timingSafeEqual/);
assert.match(auth, /Credenciais inválidas/);
assert.match(auth, /senhaIteracoes/);

assert.match(webhook, /if \(!segredo\) return false/);
assert.doesNotMatch(webhook, /if \(!segredo\) return true/);
assert.match(webhook, /Math\.abs\(Date\.now\(\) - timestampMs\)/);
assert.match(webhook, /req\.method !== 'POST'/);
assert.match(login, /verificar_limite_login/);
assert.match(login, /registrar_falha_login/);
assert.match(login, /token\.status === 408 \|\| token\.status >= 500/);
assert.match(login, /servico_auth_indisponivel/);
assert.match(login, /token\.status === 429/);
assert.match(login, /const admin = createClient/);
assert.match(login, /cacheEmpresas/);
assert.match(login, /circuitoBancoAbertoAte/);
assert.match(login, /AbortSignal\.timeout\(8_000\)/);
assert.match(login, /Promise\.allSettled/);
assert.doesNotMatch(login, /consultarComRetry/);
assert(fs.existsSync(path.join(raiz, 'supabase', 'migrations', '20260808000100_limite_tentativas_login.sql')));

assert.match(integracoes, /podeOperarFinanceiro/);
assert.match(integracoes, /eq\('empresa_id', atual\.empresa_id\)\.eq\('numero', numero\)/);
assert.match(integracoes, /valor > valorMaximo/);
assert.match(integracoes, /host\.endsWith\('\.mercadopago\.com\.br'\)/);
assert.equal(pacote.dependencies['electron-updater'], '6.8.9');
assert.equal(pacote.build.asar, true);
for (const exclusao of ['!supabase/**', '!tmp/**', '!.env*', '!**/*.pfx', '!**/*.p12', '!**/*.pem', '!**/*.key']) {
  assert(pacote.build.files.includes(exclusao), `pacote precisa excluir ${exclusao}`);
}

console.log('OK: cofre, login, IPC, Electron, Supabase e Mercado Pago possuem barreiras de seguranca verificadas.');
