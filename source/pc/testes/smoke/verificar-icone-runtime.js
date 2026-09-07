const path = require('path');
const { app, nativeImage } = require('electron');

app.whenReady().then(() => {
  const raiz = process.argv[2];
  const arquivos = ['tray-icon.png', 'app-icon.ico'];
  const resultado = arquivos.map((arquivo) => {
    const caminho = path.join(raiz, arquivo);
    const imagem = nativeImage.createFromPath(caminho);
    return { arquivo, vazio: imagem.isEmpty(), tamanho: imagem.getSize() };
  });
  console.log(JSON.stringify(resultado));
  app.exit(resultado.some((item) => item.vazio) ? 1 : 0);
});
