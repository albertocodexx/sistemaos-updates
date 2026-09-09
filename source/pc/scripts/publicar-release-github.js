'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DONO = 'albertocodexx';
const REPOSITORIO = 'sistemaos-updates';
const VERSAO_PC = require('../package.json').version;
const VERSAO_ANDROID = '1.0.86';
const TAG = `v${VERSAO_PC}`;
const raiz = path.resolve(__dirname, '..');
const dist = path.join(raiz, 'dist');

function obterToken() {
  const resposta = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    timeout: 15000,
    windowsHide: true
  });
  const linha = resposta.split(/\r?\n/).find((item) => item.startsWith('password='));
  if (!linha) throw new Error('Credencial do GitHub não encontrada no Gerenciador de Credenciais.');
  return linha.slice('password='.length);
}

async function github(token, url, opcoes = {}) {
  const resposta = await fetch(url, {
    ...opcoes,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SistemaOS-Release',
      ...(opcoes.headers || {})
    }
  });
  const texto = await resposta.text();
  let dados = null;
  if (texto) {
    try { dados = JSON.parse(texto); } catch (_) { dados = texto; }
  }
  if (!resposta.ok) {
    const mensagem = dados && typeof dados === 'object' ? dados.message : String(dados || resposta.statusText);
    const erro = new Error(`GitHub ${resposta.status}: ${mensagem}`);
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

async function obterOuCriarRelease(token) {
  const base = `https://api.github.com/repos/${DONO}/${REPOSITORIO}`;
  try {
    return await github(token, `${base}/releases/tags/${TAG}`);
  } catch (erro) {
    if (erro.status !== 404) throw erro;
  }
  // Uma tag nova só existe publicamente depois de publicar o rascunho.
  // Reaproveite o mesmo rascunho se o upload foi interrompido.
  const recentes = await github(token, `${base}/releases?per_page=100`);
  const rascunho = recentes.find(item => item.tag_name === TAG);
  if (rascunho) return rascunho;
  const corpo = fs.readFileSync(path.join(raiz, `release-notes-${VERSAO_PC}.md`), 'utf8');
  return github(token, `${base}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: TAG,
      target_commitish: 'main',
      name: `Sistema OS ${VERSAO_PC}`,
      body: corpo,
      draft: true,
      prerelease: false
    })
  });
}

async function publicarArquivo(token, release, arquivo, nome, tipo) {
  const existente = (release.assets || []).find((asset) => asset.name === nome);
  if (existente) {
    const digest = 'sha256:' + require('crypto').createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
    if (existente.digest === digest && existente.size === fs.statSync(arquivo).size) {
      console.log(`Já conferido: ${nome}`);
      return;
    }
    throw new Error(`Asset existente diferente: ${nome}. Nada foi sobrescrito.`);
  }
  const blob = await fs.openAsBlob(arquivo, { type: tipo });
  const url = `https://uploads.github.com/repos/${DONO}/${REPOSITORIO}/releases/${release.id}/assets?name=${encodeURIComponent(nome)}`;
  const asset = await github(token, url, {
    method: 'POST',
    headers: { 'Content-Type': tipo, 'Content-Length': String(blob.size) },
    body: blob
  });
  console.log(`Publicado: ${asset.name} (${asset.size} bytes)`);
}

(async () => {
  const token = obterToken();
  if (process.argv.includes('--verificar-acesso')) {
    const repo = await github(token, `https://api.github.com/repos/${DONO}/${REPOSITORIO}`);
    const releases = await github(token, `https://api.github.com/repos/${DONO}/${REPOSITORIO}/releases?per_page=5`);
    console.log(JSON.stringify({ repositorio: repo.full_name, escrita: repo.permissions?.push === true, recentes: releases.map(r => ({tag:r.tag_name,draft:r.draft})) }));
    return;
  }
  const installer = path.join(dist, `SistemaOS-${VERSAO_PC}-Setup.exe`);
  const blockmap = `${installer}.blockmap`;
  const latest = path.join(dist, 'latest.yml');
  const apk = path.join(dist, `SistemaOS-${VERSAO_ANDROID}.apk`);
  const apkHash = `${apk}.sha256`;
  const fontePc = path.join(dist, `SistemaOS-PC-Codigo-Fonte-v${VERSAO_PC}.zip`);
  const fonteAndroid = path.join(dist, `SistemaOS-Android-Codigo-Fonte-v${VERSAO_ANDROID}.zip`);
  for (const arquivo of [installer, blockmap, latest, apk, apkHash, fontePc, fonteAndroid]) {
    if (!fs.existsSync(arquivo) || fs.statSync(arquivo).size === 0) throw new Error(`Arquivo de release ausente: ${arquivo}`);
  }

  let release = await obterOuCriarRelease(token);
  const arquivos = [
    [installer, path.basename(installer), 'application/vnd.microsoft.portable-executable'],
    [blockmap, path.basename(blockmap), 'application/octet-stream'],
    [latest, 'latest.yml', 'text/yaml'],
    [apk, path.basename(apk), 'application/vnd.android.package-archive'],
    [apkHash, path.basename(apkHash), 'text/plain'],
    [installer, 'SistemaOS-PC.exe', 'application/vnd.microsoft.portable-executable'],
    [apk, 'SistemaOS-Android.apk', 'application/vnd.android.package-archive'],
    [apkHash, 'SistemaOS-Android.apk.sha256', 'text/plain'],
    [fontePc, path.basename(fontePc), 'application/zip'],
    [fonteAndroid, path.basename(fonteAndroid), 'application/zip']
  ];
  for (const item of arquivos) await publicarArquivo(token, release, ...item);

  release = await github(token, `https://api.github.com/repos/${DONO}/${REPOSITORIO}/releases/${release.id}`);
  const publicados = new Set((release.assets || []).map((asset) => asset.name));
  const faltando = arquivos.map((item) => item[1]).filter((nome) => !publicados.has(nome));
  if (faltando.length) throw new Error(`Assets não confirmados: ${faltando.join(', ')}`);
  for (const [arquivo, nome] of arquivos) {
    const asset = release.assets.find(item => item.name === nome);
    if (asset.size !== fs.statSync(arquivo).size) throw new Error(`Tamanho do arquivo publicado diverge: ${nome}`);
    const digest = 'sha256:' + require('crypto').createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
    if (asset.digest !== digest) throw new Error(`Integridade do arquivo publicado diverge: ${nome}`);
  }
  // Só passa a ser a atualização mais recente quando todos os downloads existem.
  release = await github(token, `https://api.github.com/repos/${DONO}/${REPOSITORIO}/releases/${release.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: false, make_latest: 'true' })
  });
  console.log(`Release confirmada: ${release.html_url}`);
})().catch((erro) => {
  console.error(erro.message);
  process.exitCode = 1;
});
