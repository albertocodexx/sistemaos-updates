'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const raizPc = path.resolve(__dirname, '..');
const raizAndroid = path.resolve(raizPc, '..', 'sistemaos-android');
const marcaFonte = path.join(raizPc, 'brand', 'os-mark-source.png');

function garantirPasta(caminho) {
  fs.mkdirSync(caminho, { recursive: true });
}

function gravarRecursoAndroid(caminho, conteudo) {
  const relativo = path.relative(path.join(raizAndroid, 'android'), caminho);
  const copiaAnterior = path.join(raizAndroid, 'brand', 'native-assets-anteriores', relativo);
  const temporario = path.join(path.dirname(caminho), `.${path.basename(caminho)}.monocromatico-${process.pid}`);

  garantirPasta(path.dirname(copiaAnterior));
  if (fs.existsSync(caminho) && !fs.existsSync(copiaAnterior)) fs.copyFileSync(caminho, copiaAnterior);
  fs.writeFileSync(temporario, conteudo);

  // No Windows, alguns recursos WebP ficam temporariamente sem escrita direta.
  // A troca por renomeação é atômica e mantém uma cópia do recurso anterior.
  const deslocado = `${caminho}.substituindo-${process.pid}`;
  if (fs.existsSync(caminho)) fs.renameSync(caminho, deslocado);
  try {
    fs.renameSync(temporario, caminho);
    if (fs.existsSync(deslocado)) fs.unlinkSync(deslocado);
  } catch (erro) {
    if (fs.existsSync(deslocado) && !fs.existsSync(caminho)) fs.renameSync(deslocado, caminho);
    if (fs.existsSync(temporario)) fs.unlinkSync(temporario);
    throw erro;
  }
}

async function marcaRecortada(cor) {
  const origem = await sharp(marcaFonte)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let esquerda = origem.info.width;
  let topo = origem.info.height;
  let direita = -1;
  let base = -1;
  for (let y = 0; y < origem.info.height; y += 1) {
    for (let x = 0; x < origem.info.width; x += 1) {
      const alfa = origem.data[(y * origem.info.width + x) * 4 + 3];
      if (alfa < 32) continue;
      esquerda = Math.min(esquerda, x);
      topo = Math.min(topo, y);
      direita = Math.max(direita, x);
      base = Math.max(base, y);
    }
  }
  if (direita < esquerda || base < topo) throw new Error('A marca-fonte não possui pixels visíveis.');
  const recorte = await sharp(marcaFonte)
    .ensureAlpha()
    .extract({ left: esquerda, top: topo, width: direita - esquerda + 1, height: base - topo + 1 })
    .png()
    .toBuffer();
  const meta = await sharp(recorte).metadata();
  return sharp({
    create: {
      width: meta.width,
      height: meta.height,
      channels: 4,
      background: { ...cor, alpha: 1 }
    }
  })
    .composite([{ input: recorte, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function marcaQuadrada(cor, tamanho = 1024, ocupacao = 0.74) {
  const recorte = await marcaRecortada(cor);
  const marca = await sharp(recorte)
    .resize({
      width: Math.round(tamanho * ocupacao),
      height: Math.round(tamanho * ocupacao),
      fit: 'inside',
      kernel: sharp.kernel.lanczos3
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: tamanho,
      height: tamanho,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: marca, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function iconeAplicativo(tamanho = 1024) {
  const margem = Math.round(tamanho * 0.055);
  const raio = Math.round(tamanho * 0.18);
  const borda = Math.max(1, Math.round(tamanho * 0.008));
  const fundo = Buffer.from(
    `<svg width="${tamanho}" height="${tamanho}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${margem}" y="${margem}" width="${tamanho - margem * 2}" height="${tamanho - margem * 2}" rx="${raio}" fill="#fff" stroke="#000" stroke-width="${borda}"/>` +
    '</svg>'
  );
  const marca = await marcaQuadrada({ r: 0, g: 0, b: 0 }, tamanho, 0.60);
  return sharp({
    create: {
      width: tamanho,
      height: tamanho,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: fundo }, { input: marca }])
    .png()
    .toBuffer();
}

function montarIco(frames) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0);
  cabecalho.writeUInt16LE(1, 2);
  cabecalho.writeUInt16LE(frames.length, 4);

  const diretorio = Buffer.alloc(frames.length * 16);
  let deslocamento = 6 + diretorio.length;
  frames.forEach((frame, indice) => {
    const entrada = indice * 16;
    diretorio.writeUInt8(frame.tamanho === 256 ? 0 : frame.tamanho, entrada);
    diretorio.writeUInt8(frame.tamanho === 256 ? 0 : frame.tamanho, entrada + 1);
    diretorio.writeUInt8(0, entrada + 2);
    diretorio.writeUInt8(0, entrada + 3);
    diretorio.writeUInt16LE(1, entrada + 4);
    diretorio.writeUInt16LE(32, entrada + 6);
    diretorio.writeUInt32LE(frame.buffer.length, entrada + 8);
    diretorio.writeUInt32LE(deslocamento, entrada + 12);
    deslocamento += frame.buffer.length;
  });
  return Buffer.concat([cabecalho, diretorio, ...frames.map((frame) => frame.buffer)]);
}

function montarBmp24(largura, altura, rgb) {
  const passoLinha = Math.ceil((largura * 3) / 4) * 4;
  const tamanhoPixels = passoLinha * altura;
  const buffer = Buffer.alloc(54 + tamanhoPixels);
  buffer.write('BM', 0, 2, 'ascii');
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(largura, 18);
  buffer.writeInt32LE(altura, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(tamanhoPixels, 34);
  buffer.writeInt32LE(3780, 38);
  buffer.writeInt32LE(3780, 42);

  for (let y = 0; y < altura; y += 1) {
    const origemY = altura - 1 - y;
    const destinoLinha = 54 + y * passoLinha;
    for (let x = 0; x < largura; x += 1) {
      const origem = (origemY * largura + x) * 3;
      const destino = destinoLinha + x * 3;
      buffer[destino] = rgb[origem + 2];
      buffer[destino + 1] = rgb[origem + 1];
      buffer[destino + 2] = rgb[origem];
    }
  }
  return buffer;
}

async function escreverBmp(caminho, largura, altura, fundo, corMarca, ocupacao) {
  const marca = await marcaQuadrada(corMarca, Math.min(largura, altura), ocupacao);
  const marcaMeta = await sharp(marca).metadata();
  const composicao = await sharp({
    create: { width: largura, height: altura, channels: 3, background: fundo }
  })
    .composite([{ input: marca, left: Math.round((largura - marcaMeta.width) / 2), top: Math.round((altura - marcaMeta.height) / 2) }])
    .raw()
    .toBuffer();
  fs.writeFileSync(caminho, montarBmp24(largura, altura, composicao));
}

async function gerarPc() {
  const preto = await marcaQuadrada({ r: 0, g: 0, b: 0 });
  const branco = await marcaQuadrada({ r: 255, g: 255, b: 255 });
  const icone = await iconeAplicativo();

  const rendererAssets = path.join(raizPc, 'renderer', 'assets');
  const buildResources = path.join(raizPc, 'build-resources');
  const appAssets = path.join(raizPc, 'assets');
  garantirPasta(rendererAssets);
  garantirPasta(buildResources);
  garantirPasta(appAssets);

  fs.writeFileSync(path.join(rendererAssets, 'logo-os-black.png'), preto);
  fs.writeFileSync(path.join(rendererAssets, 'logo-os-white.png'), branco);
  fs.writeFileSync(path.join(rendererAssets, 'logo.png'), preto);
  fs.writeFileSync(path.join(buildResources, 'icon.png'), icone);
  fs.writeFileSync(path.join(buildResources, 'icon-icon-256.png'), await sharp(icone).resize(256, 256).png().toBuffer());

  const frames = [];
  for (const tamanho of [16, 24, 32, 48, 64, 128, 256]) {
    frames.push({ tamanho, buffer: await sharp(icone).resize(tamanho, tamanho).png().toBuffer() });
  }
  const ico = montarIco(frames);
  fs.writeFileSync(path.join(buildResources, 'icon.ico'), ico);
  fs.writeFileSync(path.join(appAssets, 'app-icon.ico'), ico);
  fs.writeFileSync(path.join(appAssets, 'tray-icon.png'), await sharp(icone).resize(32, 32).png().toBuffer());

  await escreverBmp(path.join(buildResources, 'header.bmp'), 150, 57, '#ffffff', { r: 0, g: 0, b: 0 }, 0.68);
  await escreverBmp(path.join(buildResources, 'welcome.bmp'), 164, 314, '#000000', { r: 255, g: 255, b: 255 }, 0.72);
}

async function gerarAndroid() {
  const preto = await marcaQuadrada({ r: 0, g: 0, b: 0 });
  const branco = await marcaQuadrada({ r: 255, g: 255, b: 255 });
  const webAssets = path.join(raizAndroid, 'www', 'assets');
  garantirPasta(webAssets);
  fs.writeFileSync(path.join(webAssets, 'logo-os-black.png'), preto);
  fs.writeFileSync(path.join(webAssets, 'logo-os-white.png'), branco);

  const res = path.join(raizAndroid, 'android', 'app', 'src', 'main', 'res');
  const pastasMipmap = fs.readdirSync(res).filter((nome) => /^mipmap-(mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi)$/.test(nome));
  for (const pasta of pastasMipmap) {
    const diretorio = path.join(res, pasta);
    for (const nome of ['ic_launcher.webp', 'ic_launcher_round.webp']) {
      const arquivo = path.join(diretorio, nome);
      if (!fs.existsSync(arquivo)) continue;
      const meta = await sharp(fs.readFileSync(arquivo)).metadata();
      const icone = await iconeAplicativo(Math.max(meta.width, meta.height));
      gravarRecursoAndroid(arquivo, await sharp(icone).resize(meta.width, meta.height).webp({ quality: 100, lossless: true }).toBuffer());
    }

    const foreground = path.join(diretorio, 'ic_launcher_foreground.webp');
    if (fs.existsSync(foreground)) {
      const meta = await sharp(fs.readFileSync(foreground)).metadata();
      const marca = await marcaQuadrada({ r: 0, g: 0, b: 0 }, Math.max(meta.width, meta.height), 0.52);
      gravarRecursoAndroid(foreground, await sharp(marca).resize(meta.width, meta.height).webp({ quality: 100, lossless: true }).toBuffer());
    }

    const logoNotificacao = path.join(diretorio, 'ic_logo.png');
    if (fs.existsSync(logoNotificacao)) {
      const meta = await sharp(fs.readFileSync(logoNotificacao)).metadata();
      const marca = await marcaQuadrada({ r: 255, g: 255, b: 255 }, Math.max(meta.width, meta.height), 0.64);
      gravarRecursoAndroid(logoNotificacao, await sharp(marca).resize(meta.width, meta.height).png().toBuffer());
    }
  }

  const playStore = path.join(raizAndroid, 'android', 'app', 'src', 'main', 'ic_launcher-playstore.png');
  gravarRecursoAndroid(playStore, await iconeAplicativo(512));

  const pastasSplash = fs.readdirSync(res).filter((nome) => nome === 'drawable' || /^drawable-(land|port)-/.test(nome));
  for (const pasta of pastasSplash) {
    const arquivo = path.join(res, pasta, 'splash.png');
    if (!fs.existsSync(arquivo)) continue;
    const meta = await sharp(fs.readFileSync(arquivo)).metadata();
    const lado = Math.min(meta.width, meta.height);
    const marca = await marcaQuadrada({ r: 255, g: 255, b: 255 }, lado, 0.42);
    const splash = await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: '#000000' } })
      .composite([{ input: marca, left: Math.round((meta.width - lado) / 2), top: Math.round((meta.height - lado) / 2) }])
      .png()
      .toBuffer();
    gravarRecursoAndroid(arquivo, splash);
  }
}

(async () => {
  if (!fs.existsSync(marcaFonte)) throw new Error(`Marca-fonte não encontrada: ${marcaFonte}`);
  await gerarPc();
  await gerarAndroid();
  console.log('Identidade monocromática gerada para PC e Android.');
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
