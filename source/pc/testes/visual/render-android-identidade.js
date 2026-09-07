'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const janela = new BrowserWindow({
    width: 390,
    height: 844,
    show: false,
    backgroundColor: '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  const androidHtml = path.resolve(__dirname, '..', '..', '..', 'sistemaos-android', 'www', 'index.html');
  await janela.loadFile(androidHtml);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await janela.webContents.executeJavaScript(`(() => {
    const status = document.getElementById('auth-status');
    const carregando = document.getElementById('auth-carregando');
    const form = document.getElementById('form-login');
    if (status) status.textContent = '';
    if (carregando) carregando.hidden = true;
    if (form) form.hidden = false;
  })()`);
  await janela.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const imagem = await janela.webContents.capturePage();
  const destino = path.resolve(__dirname, 'saida-android-login.png');
  fs.writeFileSync(destino, imagem.toPNG());
  console.log(destino);
  janela.destroy();
  app.quit();
}).catch((erro) => {
  console.error(erro);
  app.exit(1);
});
