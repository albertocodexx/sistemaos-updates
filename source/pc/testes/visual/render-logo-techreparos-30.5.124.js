const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { gerarHtmlOS } = require('../../src/templates/os-template');

const raiz = path.resolve(__dirname, '../..');
const saida = path.join(raiz, 'output/pdf/Previa-Logo-TechReparos-30.5.125.pdf');
const temporario = path.join(raiz, 'tmp/pdfs/previa-logo-techreparos.html');
const logo = fs.readFileSync(path.join(raiz, 'tmp/pdfs/logo-techreparos-recortada.png'));
const config = {
  nomeEmpresa: 'TechReparos',
  endereco: 'Rua das Begônias, 649, Jardim Laguna, Linhares - ES, CEP 29904-330',
  telefonePrincipal: '(27) 98145-1544',
  whatsapp: '(27) 98145-1544',
  email: 'techreparosassistencia@gmail.com',
  logoBase64: 'data:image/png;base64,' + logo.toString('base64'),
  logoPdfMonocromatica: true,
  tamanhoLogoPdf: 110,
  usarTermosPredefinidosOS: true
};
const os = {
  numero: 'OS-PRÉVIA', data: new Date().toISOString(), status: 'Em análise',
  cliente: { nome: 'Cliente de demonstração', clienteId: '10000', telefone: '(27) 99999-0000' },
  aparelho: { tipoEquipamento: 'Smartphone', marca: 'Motorola', modelo: 'Moto G', cor: 'Preto', defeitoRelatado: 'Avaliação técnica.' },
  diagnosticoTecnico: { diagnostico: 'Em análise.', valorEstimado: 250, prazoEstimado: '2 dias úteis' },
  valorTotalServico: 250
};

app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.mkdirSync(path.dirname(temporario), { recursive: true });
  fs.writeFileSync(temporario, gerarHtmlOS(os, config), 'utf8');
  const janela = new BrowserWindow({ show: false, backgroundColor: '#fff', webPreferences: { sandbox: true } });
  await janela.loadFile(temporario);
  const pdf = await janela.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(saida, pdf);
  janela.destroy();
  console.log(saida);
  app.quit();
}).catch((erro) => { console.error(erro); app.exit(1); });
