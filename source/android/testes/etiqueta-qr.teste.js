'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const qr = require(path.join(raiz, 'www', 'js', 'qr-os.js'));
const html = fs.readFileSync(path.join(raiz, 'www', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'www', 'css', 'app.css'), 'utf8');
const manifest = fs.readFileSync(path.join(raiz, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const consulta = fs.readFileSync(path.join(raiz, 'www', 'js', 'consulta.js'), 'utf8');
const sessao = fs.readFileSync(path.join(raiz, 'www', 'js', 'auth', 'sessao.js'), 'utf8');
const pacote = require(path.join(raiz, 'package.json'));

assert.equal(qr.criarLinkOS('OS-0007'), 'sistemaos://os/OS-0007');
assert.equal(qr.extrairNumeroLinkOS('sistemaos://os/OS-0007'), 'OS-0007');
assert.equal(qr.extrairNumeroConteudo('0007', true), '0007');
assert.equal(qr.extrairNumeroConteudo('OS 7', true), 'OS 7');
assert.equal(qr.extrairNumeroConteudo('https://site.test/os/7', true), '');
assert.equal(qr.extrairNumeroConteudo('texto qualquer', true), '');

assert.match(html, /id="btn-ir-qr"/);
assert.match(html, /id="painel-qr"/);
assert.match(html, /id="btn-iniciar-leitor-qr"/);
assert.match(html, /id="btn-flash-leitor-qr"/);
assert.match(html, /id="leitor-qr-camera"/);
assert.match(html, /js\/qr-os\.js/);
assert.match(css, /body\.qr-camera-ativa/);
assert.match(css, /\.leitor-qr-mira/);

assert.match(manifest, /android\.permission\.CAMERA/);
assert.match(manifest, /android:scheme="sistemaos"\s+android:host="os"/);
assert.match(manifest, /com\.google\.mlkit\.vision\.DEPENDENCIES/);
assert.equal(pacote.dependencies['@capacitor-mlkit/barcode-scanning'], '8.1.0');

assert.match(consulta, /SistemaOSConsulta/);
assert.match(consulta, /var btnIrConsulta = document\.getElementById\('btn-ir-consulta'\)/,
  'a abertura por QR precisa ter a própria referência ao botão de consulta');
assert.match(consulta, /PC pode estar desligado/);
assert.match(consulta, /OS não encontrada\. Confira a etiqueta/);
assert.doesNotMatch(consulta, /OS não encontrada na nuvem/);
assert.match(sessao, /linkRecebido\.protocol/);

console.log('OK: leitor QR usa câmera traseira, flash, deep link e consulta a OS na nuvem.');
