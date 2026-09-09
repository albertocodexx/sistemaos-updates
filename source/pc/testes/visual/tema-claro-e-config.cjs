'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '../..');
const saida = path.join(__dirname, 'saida');
fs.mkdirSync(saida, { recursive: true });

function salvar(nome, imagem) {
  fs.writeFileSync(path.join(saida, nome), imagem.toPNG());
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const janela = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    backgroundColor: '#f6f7f8',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  await janela.loadFile(path.join(raiz, 'renderer', 'index.html'));
  await new Promise(resolve => setTimeout(resolve, 700));
  await janela.webContents.executeJavaScript(`(() => {
    const semAnimacao = document.createElement('style');
    semAnimacao.textContent = '*{transition:none!important;animation:none!important}#telaLogin{display:none!important}';
    document.head.appendChild(semAnimacao);
    document.getElementById('telaLogin')?.remove();
    document.body.classList.remove('tema-escuro');
    document.querySelectorAll('.escondido[data-permissao]').forEach(el => el.classList.remove('escondido'));
    document.querySelector('[data-aba="nova-os"]')?.click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 1000));

  const diagnostico = await janela.webContents.executeJavaScript(`(() => {
    const rgb = valor => {
      const m = String(valor).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
      return m ? { r:+m[1], g:+m[2], b:+m[3], a:m[4] == null ? 1 : +m[4] } : null;
    };
    const luminancia = cor => {
      const canal = n => { n /= 255; return n <= .04045 ? n / 12.92 : Math.pow((n + .055) / 1.055, 2.4); };
      return .2126 * canal(cor.r) + .7152 * canal(cor.g) + .0722 * canal(cor.b);
    };
    const contraste = (a,b) => { const x=luminancia(a), y=luminancia(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
    const fundo = el => {
      let atual = el;
      while (atual) {
        const cor = rgb(getComputedStyle(atual).backgroundColor);
        if (cor && cor.a >= .85) return cor;
        atual = atual.parentElement;
      }
      return {r:255,g:255,b:255,a:1};
    };
    const seletores = ['.topo-nome','.topo-subtitulo','.aba','.aba.ativa','.card-titulo','.campo label','.campo input','.campo select','.botao-primario','.botao-secundario','.dica-campo'];
    const amostras = [];
    seletores.forEach(seletor => document.querySelectorAll(seletor).forEach((el, indice) => {
      if (indice > 5 || !el.getClientRects().length) return;
      const estilo = getComputedStyle(el); const frente=rgb(estilo.color); const tras=fundo(el);
      if (!frente || !tras) return;
      amostras.push({ seletor, texto:(el.textContent || el.value || '').trim().slice(0,80), contraste:+contraste(frente,tras).toFixed(2) });
    }));
    return { amostras, falhas: amostras.filter(x => x.contraste < 4.5) };
  })()`);
  if (diagnostico.falhas.length) {
    throw new Error('Contraste insuficiente no tema claro: ' + JSON.stringify(diagnostico.falhas));
  }
  salvar('tema-claro-nova-os.png', await janela.webContents.capturePage());

  await janela.webContents.executeJavaScript(`(() => {
    document.getElementById('modalConfig')?.classList.remove('escondido');
  })()`);
  await new Promise(resolve => setTimeout(resolve, 150));
  salvar('tema-claro-config.png', await janela.webContents.capturePage());
  await janela.webContents.executeJavaScript(`(() => {
    const busca = document.getElementById('configBuscaFuncoes');
    busca.value = 'whats';
    busca.dispatchEvent(new Event('input', { bubbles:true }));
  })()`);
  await new Promise(resolve => setTimeout(resolve, 120));
  const busca = await janela.webContents.executeJavaScript(`(() => ({
    status: document.getElementById('configBuscaStatus')?.textContent,
    resultados: [...document.querySelectorAll('.config-busca-resultado')].map(el => el.textContent.trim()),
    atalhosAntigos: document.querySelectorAll('.config-busca-atalho,.config-busca-rota').length
  }))()`);
  if (!busca.resultados.length || busca.atalhosAntigos) throw new Error('Busca simplificada não foi renderizada corretamente: ' + JSON.stringify(busca));
  salvar('tema-claro-config-busca.png', await janela.webContents.capturePage());
  fs.writeFileSync(path.join(saida, 'tema-claro-diagnostico.json'), JSON.stringify({ diagnostico, busca }, null, 2));
  console.log('OK: tema claro legível e busca de configurações simplificada.');
  janela.destroy();
  app.quit();
}).catch(erro => {
  console.error(erro);
  app.exit(1);
});
