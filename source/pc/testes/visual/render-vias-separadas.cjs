'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const raizPc = path.resolve(__dirname, '..', '..');
const raizAndroid = path.resolve(raizPc, '..', 'sistemaos-android', 'www', 'src', 'templates');
const saida = path.join(raizPc, 'output', 'pdf', 'qa-vias-separadas');

const config = {
  nomeEmpresa: 'TechReparos', nomeFantasia: 'TechReparos',
  endereco: 'Rua das Begônias, 649, Jardim Laguna, Linhares - ES',
  telefone: '(27) 98145-1544', email: 'techreparosassistencia@gmail.com',
  usarTermosPredefinidosOS: true,
  usarTermosPredefinidosCompra: true,
  usarTermosPredefinidosVenda: true
};

const registro = {
  numero: 'OS-0099', id: 'EST-0099',
  data: '2026-09-13T12:00:00-03:00', dataCompra: '2026-09-13T12:00:00-03:00', dataVenda: '2026-09-13T12:00:00-03:00',
  cliente: { nome: 'Cliente de Validação', clienteId: '10099', telefone: '(27) 99999-0099' },
  aparelho: { tipoEquipamento: 'Smartphone', marca: 'Samsung', modelo: 'Galaxy S20 FE', cor: 'Branco', defeitoRelatado: 'Tela quebrada' },
  vendedorNome: 'Vendedor de Validação', vendedorTelefone: '(27) 99999-0088',
  compradorNome: 'Comprador de Validação', compradorTelefone: '(27) 99999-0077',
  marca: 'Samsung', modelo: 'Galaxy S20 FE', cor: 'Branco',
  valorCompra: 300, valorVenda: 500, formaPagamento: 'Pix', garantia: 90,
  defeitoRelatado: 'Tela quebrada', observacoes: 'Documento de controle visual.',
  diagnosticoTecnico: { diagnostico: 'Tela danificada.', solucao: 'Troca do conjunto frontal.', valorEstimado: 350, prazoEstimado: '2 dias úteis' }
};

const casos = [
  ['pc-os', require(path.join(raizPc, 'src', 'templates', 'os-template.js')).gerarHtmlOS],
  ['pc-compra', require(path.join(raizPc, 'src', 'templates', 'compra-template.js')).gerarHtmlCompra],
  ['pc-venda', require(path.join(raizPc, 'src', 'templates', 'venda-template.js')).gerarHtmlVenda],
  ['android-os', require(path.join(raizAndroid, 'os-template.js')).gerarHtmlOS],
  ['android-compra', require(path.join(raizAndroid, 'compra-template.js')).gerarHtmlCompra],
  ['android-venda', require(path.join(raizAndroid, 'venda-template.js')).gerarHtmlVenda]
];

async function renderizar(janela, nome, gerar) {
  const html = gerar(registro, config);
  const arquivoHtml = path.join(saida, `${nome}.html`);
  fs.writeFileSync(arquivoHtml, html, 'utf8');
  await janela.loadFile(arquivoHtml);
  const pdf = await janela.webContents.printToPDF({
    pageSize: 'A4', landscape: false, printBackground: true, preferCSSPageSize: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });
  fs.writeFileSync(path.join(saida, `${nome}.pdf`), pdf);
}

app.whenReady().then(async () => {
  fs.mkdirSync(saida, { recursive: true });
  const janela = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  for (const [nome, gerar] of casos) await renderizar(janela, nome, gerar);
  janela.destroy();
  console.log(saida);
  app.quit();
}).catch(erro => {
  console.error(erro.stack || erro);
  app.exit(1);
});
