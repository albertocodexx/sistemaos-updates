const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { gerarHtmlOS } = require('../../src/templates/os-template');

const saida = path.resolve(__dirname, '../../output/pdf/Previa-OS-termos-completos-v30.5.95.pdf');
const htmlTemporario = path.resolve(__dirname, '../../tmp/pdfs/previa-os-termos-completos.html');

const termos = `1. O cliente declara que as informações e os acessórios descritos nesta ordem de serviço estão corretos.

2. O orçamento será executado somente após autorização. Peças substituídas poderão ser descartadas após a conclusão, salvo solicitação prévia do cliente.

3. Aparelhos iPhone: durante a abertura existe risco técnico de dano à tela, especialmente quando já apresenta trincas, empenamento, descolamento ou reparos anteriores. Nesses casos, a assistência não se responsabiliza por agravamentos decorrentes da condição pré-existente.

4. Aparelhos Android: tampas traseiras trincadas, ressecadas, deformadas ou anteriormente coladas podem quebrar durante a abertura necessária ao reparo. A assistência não se responsabiliza por danos decorrentes dessa condição pré-existente.

5. A garantia cobre exclusivamente o serviço e as peças descritas neste documento. Danos por queda, líquido, oxidação, mau uso, impacto elétrico, violação por terceiros ou defeito diferente do reparado não estão incluídos.

6. Equipamentos não retirados em até 90 dias após a comunicação de conclusão poderão gerar cobrança de armazenagem, conforme aviso enviado ao cliente e legislação aplicável.

7. Ao assinar, o cliente confirma que leu, compreendeu e aceitou estas condições e autoriza os testes necessários antes e depois do reparo.`;

const os = {
  numero: 'OS-TESTE',
  data: '2026-08-24T15:30:00-03:00',
  status: 'Pronto para retirada',
  dataPrevista: '2026-08-26',
  horaPrevista: '17:00',
  cliente: {
    nome: 'Cliente de Teste',
    cpf: '000.000.000-00',
    telefone: '(27) 99999-0000',
    email: 'cliente@exemplo.com'
  },
  aparelho: {
    tipoEquipamento: 'Smartphone',
    marca: 'Motorola',
    modelo: 'Moto G5',
    cor: 'Ciano',
    acessorios: 'Chip / SIM',
    testesEntrada: ['Liga normalmente', 'Flash funcionando', 'Áudio funcionando', 'Carregamento funcionando', 'Wi-Fi funcionando'],
    defeitoRelatado: 'Tela e bateria com falha intermitente.'
  },
  tecnicoResponsavel: 'Técnico de Teste',
  observacoes: 'Troca de tela e bateria autorizada pelo cliente.',
  diagnosticoTecnico: {
    diagnostico: 'Tela sem imagem e bateria abaixo da capacidade esperada.',
    solucao: 'Substituição da tela e da bateria, seguida de testes completos.',
    pecasTrocar: ['Tela completa', 'Bateria'],
    valorEstimado: 350,
    prazoEstimado: '2 dias úteis'
  },
  valorTotalServico: 350,
  termos
};

const config = {
  nomeEmpresa: 'TechReparos',
  endereco: 'Rua de Exemplo, 100, Centro, Linhares - ES',
  telefone: '(27) 99999-0000',
  email: 'contato@exemplo.com',
  usarTermosPredefinidosOS: true,
  tamanhoFonteTermosPdf: 7.8
};

app.whenReady().then(async () => {
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.mkdirSync(path.dirname(htmlTemporario), { recursive: true });
  fs.writeFileSync(htmlTemporario, gerarHtmlOS(os, config), 'utf8');

  const janela = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await janela.loadFile(htmlTemporario);
  const buffer = await janela.webContents.printToPDF({
    pageSize: 'A4',
    landscape: false,
    printBackground: true,
    preferCSSPageSize: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });
  fs.writeFileSync(saida, buffer);
  console.log(saida);
  app.quit();
}).catch((erro) => {
  console.error(erro);
  app.exit(1);
});
