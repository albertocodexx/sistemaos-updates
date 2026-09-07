'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const raiz = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(raiz, 'www', 'js', 'atualizacao-app.js'), 'utf8');
const telaScript = fs.readFileSync(path.join(raiz, 'www', 'js', 'atualizacao-tela.js'), 'utf8');
const loginScript = fs.readFileSync(path.join(raiz, 'www', 'js', 'auth', 'login-tela.js'), 'utf8');
const estilos = fs.readFileSync(path.join(raiz, 'www', 'css', 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'www', 'index.html'), 'utf8');
const activity = fs.readFileSync(path.join(raiz, 'android', 'app', 'src', 'main', 'java', 'com', 'assistencia', 'sistemaos', 'MainActivity.java'), 'utf8');
const plugin = fs.readFileSync(path.join(raiz, 'android', 'app', 'src', 'main', 'java', 'com', 'assistencia', 'sistemaos', 'AtualizacaoPlugin.java'), 'utf8');
const mainActivity = fs.readFileSync(path.join(raiz, 'android', 'app', 'src', 'main', 'java', 'com', 'assistencia', 'sistemaos', 'MainActivity.java'), 'utf8');
const manifest = fs.readFileSync(path.join(raiz, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const versaoPacote = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version;

assert.match(script, /albertocodexx\/sistemaos-updates/);
assert.match(script, /releases\/latest/);
assert.match(script, /SistemaOS-\\d\+\\\.\\d\+\\\.\\d\+\\\.apk/);
assert.match(script, /\.sha256/);
assert.match(script, /\[a-f0-9\]\{64\}/i);
assert.match(script, /sha256:\s*release\.sha256/);
assert.match(script, /sha256:\s*ultima\.sha256/);
assert.match(script, /asset\.digest/);
assert.match(script, /baixarEInstalar/);
assert.match(script, /sistema-os:atualizacao-disponivel/);
assert.match(html, /btn-verificar-atualizacao-app/);
assert.match(html, /btn-instalar-atualizacao-login/);
assert.match(html, /atualizacao-global-app/);
assert.match(html, /btn-atualizacao-global-app/);
assert.match(html, /btn-mostrar-senha-auth/);
assert.match(loginScript, /senha\.type = mostrar \? 'text' : 'password'/);
assert.match(estilos, /\.auth-mostrar-senha/);
assert.match(html, /js\/atualizacao-app\.js/);
assert.match(html, /js\/atualizacao-tela\.js/);
assert.match(telaScript, /Verificando atualização no GitHub/);
assert.match(telaScript, /dataset\.atualizacaoVinculada/);
assert.match(telaScript, /SistemaOSToast\.mostrar/);
assert.match(telaScript, /TEMPO_LIMITE_MS/);
assert.match(activity, /registerPlugin\(AtualizacaoPlugin\.class\)/);
assert.match(script, /downloadEmAndamento/);
assert.match(script, /fetchComTempoLimite/);
assert.match(script, /AbortController/);
assert.match(script, /FETCH_TIMEOUT_MS\s*=\s*15000/);
assert.match(plugin, /HttpURLConnection/);
assert.match(plugin, /tarefaDownload/);
assert.match(plugin, /handleOnPause/);
assert.match(plugin, /cancelarDownloadAtivo/);
assert.doesNotMatch(plugin, /DownloadManager/);
assert.match(plugin, /FileProvider\.getUriForFile/);
assert.match(plugin, /getActivity\(\)\.startActivity\(instalar\)/);
assert.match(plugin, /handleOnResume/);
assert.match(plugin, /atualizacaoStatus/);
assert.match(plugin, /SHA-256/);
assert.match(plugin, /sha256Esperado/);
assert.match(plugin, /\.part/);
assert.match(plugin, /obterVersaoInstalada/);
assert.match(plugin, /getPackageArchiveInfo/);
assert.match(plugin, /assinaturasCompativeis/);
assert.match(plugin, /urlOficial/);
assert.match(plugin, /\.githubusercontent\.com/);
assert.match(plugin, /TAMANHO_MAXIMO_APK/);
assert.match(plugin, /recebidos\s*>\s*TAMANHO_MAXIMO_APK/);
assert.match(plugin, /assinatura antiga/);
assert.match(script, /atualizacao\.obterVersaoInstalada/);
assert.match(script, new RegExp(versaoPacote.replace(/\./g, '\\.')),
  'fallback da atualização deve acompanhar a versão atual do pacote');
assert.doesNotMatch(script, /atualizacaoErro[\s\S]{0,500}abrirDownloadManual/);
assert(
  mainActivity.indexOf('registerPlugin(AtualizacaoPlugin.class)') < mainActivity.indexOf('super.onCreate(savedInstanceState)'),
  'plugin de atualização precisa ser registrado antes da inicialização do Capacitor'
);
assert.match(manifest, /REQUEST_INSTALL_PACKAGES/);
const filePaths = fs.readFileSync(path.join(raiz, 'android', 'app', 'src', 'main', 'res', 'xml', 'file_paths.xml'), 'utf8');
assert.match(filePaths, /external-files-path[^>]+Download\//);

(async function testarRetornoVisualDoBotao() {
  const dom = new JSDOM(
    '<button id="btn-verificar-atualizacao-app">Verificar atualização</button>' +
    '<button id="btn-instalar-atualizacao-app" hidden>Baixar e instalar</button>' +
    '<p id="status-atualizacao-app" hidden></p>',
    { runScripts: 'outside-only', url: 'https://localhost/' }
  );
  let aviso = '';
  dom.window.SistemaOSToast = { mostrar: mensagem => { aviso = mensagem; } };
  dom.window.SistemaOSAtualizacao = {
    verificar: async () => ({ fase: 'atualizado', mensagem: 'Este celular já está na versão mais recente.' }),
    baixarEInstalar: async () => ({ sucesso: true, mensagem: 'Download iniciado.' }),
    obterUltima: () => null
  };
  dom.window.eval(telaScript);
  dom.window.document.getElementById('btn-verificar-atualizacao-app').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  const status = dom.window.document.getElementById('status-atualizacao-app');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /versão mais recente/i);
  assert.match(aviso, /versão mais recente/i);
  assert.equal(dom.window.document.getElementById('btn-verificar-atualizacao-app').disabled, false);
  console.log('OK: botão do APK sempre exibe o resultado da verificação de atualização.');
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});

(async function testarDigestSemCorsDoAsset() {
  const dom = new JSDOM('', { runScripts: 'outside-only', url: 'https://localhost/' });
  const urls = [];
  const hashApk = 'a'.repeat(64);
  dom.window.SistemaOSVersaoAPK = '1.0.17';
  dom.window.fetch = async url => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        assets: [
          {
            name: 'SistemaOS-1.0.18.apk',
            browser_download_url: 'https://github.com/exemplo/SistemaOS-1.0.18.apk',
            digest: 'sha256:' + hashApk
          },
          {
            name: 'SistemaOS-1.0.18.apk.sha256',
            browser_download_url: 'https://github.com/exemplo/SistemaOS-1.0.18.apk.sha256'
          }
        ]
      })
    };
  };
  dom.window.eval(script);
  const resultado = await dom.window.SistemaOSAtualizacao.verificar(true);
  assert.equal(resultado.fase, 'disponivel');
  assert.equal(resultado.sha256, hashApk);
  assert.equal(urls.length, 1, 'o WebView deve consultar apenas a API, sem baixar o .sha256 bloqueado por CORS');
  assert.match(urls[0], /api\.github\.com/);
  dom.window.close();
  console.log('OK: verificação usa o digest da API e não confunde bloqueio CORS com falta de internet.');
})().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});

console.log('OK: APK verifica o GitHub Releases e encaminha a instalação pelo Android.');
