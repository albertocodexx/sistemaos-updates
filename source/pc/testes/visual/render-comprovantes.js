const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');
const { gerarHtmlComprovanteOS } = require('../../src/templates/comprovante-os-template');

const saida = path.join(__dirname, 'saida');
const config = {
  nomeFantasia: 'TechReparos Assistência Técnica',
  possuiCnpj: true,
  cnpj: '00.000.000/0001-00',
  inscricaoEstadual: '123.456.789',
  telefonePrincipal: '(27) 98145-1544',
  email: 'contato@techreparos.com.br',
  enderecoEmpresa: 'Rua das Begônias, 649 — Jardim Laguna',
  logoBase64: `data:image/png;base64,${fs.readFileSync(path.join(__dirname, '../../build-resources/icon-icon-256.png')).toString('base64')}`
};

const base = {
  numero: 'OS OS-0042',
  revision: 3,
  updatedAt: '2026-07-23T18:45:00-03:00',
  cliente: {
    nome: 'Maria da Silva',
    telefone: '(27) 99999-0000',
    cpf: '123.456.789-00'
  },
  aparelho: {
    tipoEquipamento: 'Smartphone',
    marca: 'Samsung',
    modelo: 'Galaxy S23 Ultra',
    cor: 'Preto',
    imei: '123456789012345',
    defeitoRelatado: 'Aparelho não liga e não reconhece o carregador.'
  },
  diagnosticoTecnico: {
    diagnostico: 'Conector de carga danificado.',
    solucao: 'Substituição do conector e testes completos de carga.',
    valorEstimado: 280,
    prazoEstimado: '2 dias úteis',
    pecasTrocar: [{ nome: 'Conector de carga', quantidade: 1 }]
  },
  formaPagamento: 'Pix',
  garantiaDias: 90
};

async function pdf(janela, html, destino, formato) {
    const htmlTemporario = destino.replace(/\.pdf$/i, '.html');
    fs.writeFileSync(htmlTemporario, html, 'utf8');
    await janela.loadURL(pathToFileURL(htmlTemporario).href);
    const alturaPx = await janela.webContents.executeJavaScript(
      'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)'
    );
    const opcoes = formato === 'a4'
      ? { printBackground: true, pageSize: 'A4', preferCSSPageSize: true }
      : {
          printBackground: true,
          pageSize: {
            width: 80 / 25.4,
            height: Math.max(2.4, (alturaPx / 96) + 0.15)
          },
          preferCSSPageSize: false,
          margins: { marginType: 'none' }
        };
    fs.writeFileSync(destino, await janela.webContents.printToPDF(opcoes));
}

app.whenReady().then(async () => {
  fs.mkdirSync(saida, { recursive: true });
  const janela = new BrowserWindow({
    show: false,
    width: 900,
    height: 1400,
    webPreferences: { sandbox: true, contextIsolation: true }
  });
  const autorizacao = { ...base, status: 'Aguardando aprovação' };
  const prontaRetirada = { ...base, status: 'Pronto para retirada', formaPagamento: 'Outra' };
  const entrega = {
    ...base,
    status: 'Entregue',
    tipoComprovante: 'entrega',
    entrega: {
      nomeRetirou: 'João Responsável',
      telefoneRetirou: '(27) 98888-7777',
      cpfRetirou: '987.654.321-00',
      dataHoraEntrega: '2026-07-23T18:45:00-03:00',
      formaPagamento: 'Pix',
      valorReparo: 280
    }
  };
  await pdf(
    janela,
    gerarHtmlComprovanteOS(autorizacao, config, { formato: '80mm' }),
    path.join(saida, 'autorizacao-80mm.pdf'),
    '80mm'
  );
  await pdf(
    janela,
    gerarHtmlComprovanteOS(prontaRetirada, config, { formato: '80mm' }),
    path.join(saida, 'pronto-retirada-80mm.pdf'),
    '80mm'
  );
  await pdf(
    janela,
    gerarHtmlComprovanteOS(entrega, config, { formato: '80mm' }),
    path.join(saida, 'entrega-80mm.pdf'),
    '80mm'
  );
  await pdf(
    janela,
    gerarHtmlComprovanteOS(entrega, config, { formato: 'a4' }),
    path.join(saida, 'entrega-a4.pdf'),
    'a4'
  );
  janela.destroy();
  app.quit();
}).catch((erro) => {
  console.error(erro);
  app.exit(1);
});
