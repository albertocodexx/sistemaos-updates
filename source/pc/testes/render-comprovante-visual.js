const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { gerarHtmlComprovanteOS } = require('../src/templates/comprovante-os-template');

const amostra = {
  id: 'os-visual',
  numero: 'OS-0042',
  revision: 3,
  updatedAt: '2026-07-23T15:42:00-03:00',
  status: 'Em reparo',
  cliente: { nome: 'Maria da Silva', telefone: '(27) 99999-0000', cpf: '123.456.789-00' },
  aparelho: {
    tipoEquipamento: 'Smartphone',
    marca: 'Samsung',
    modelo: 'Galaxy S23 Ultra',
    cor: 'Preto',
    imei: '123456789012345',
    defeitoRelatado: 'Aparelho não liga e não reconhece o carregador.'
  },
  diagnosticoTecnico: {
    diagnostico: 'Conector de carga danificado após testes elétricos.',
    solucao: 'Substituição do conector, limpeza técnica e testes completos.',
    valorEstimado: 280,
    prazoEstimado: '2 dias úteis',
    pecasTrocar: [{ nome: 'Conector de carga', quantidade: 1 }]
  },
  formaPagamento: 'Pix',
  garantiaDias: 90,
  assinaturaPendente: true
};

const config = {
  nomeFantasia: 'TechReparos Assistência Técnica',
  possuiCnpj: true,
  cnpj: '00.000.000/0001-00',
  telefonePrincipal: '(27) 98145-1544',
  email: 'techreparosassistencia@gmail.com',
  enderecoEmpresa: 'Rua das Begônias, 649 — Jardim Laguna, Linhares/ES'
};

async function renderizar(formato, destino) {
  const html = gerarHtmlComprovanteOS(amostra, config, { formato });
  const janela = new BrowserWindow({ show: false, width: 900, height: 1200 });
  try {
    await janela.loadURL(`data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`);
    const alturaPx = await janela.webContents.executeJavaScript(
      'Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)'
    );
    const opcoes = formato === 'a4'
      ? { printBackground: true, pageSize: 'A4', preferCSSPageSize: true }
      : {
          printBackground: true,
          pageSize: {
            width: (formato === '58mm' ? 58 : 80) / 25.4,
            height: (alturaPx / 96) + 0.12
          },
          preferCSSPageSize: false,
          margins: { marginType: 'none' }
        };
    fs.writeFileSync(destino, await janela.webContents.printToPDF(opcoes));
  } finally {
    janela.destroy();
  }
}

app.whenReady().then(async () => {
  const pasta = path.join(__dirname, 'artefatos-comprovante');
  fs.mkdirSync(pasta, { recursive: true });
  const formato = process.argv.find((item) => ['58mm', '80mm', 'a4'].includes(item)) || '80mm';
  console.log(`Renderizando comprovante visual em ${formato}...`);
  await renderizar(formato, path.join(pasta, `comprovante-${formato}.pdf`));
  console.log(`Comprovante ${formato} renderizado.`);
  app.quit();
}).catch((erro) => {
  console.error(erro);
  app.exit(1);
});
