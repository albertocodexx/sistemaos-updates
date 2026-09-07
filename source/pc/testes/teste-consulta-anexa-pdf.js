// testes/teste-consulta-anexa-pdf.js
// ═══════════════════════════════════════════════════════════════
// Testa a correção "aba Garantia fala que puxou mas não abre nada" /
// "poder abrir o PDF": a resposta de consulta (OS e garantia) agora
// inclui `dados.pdfUrl`, obtida subindo o PDF já gerado em disco para o
// Cloudinary (ou gerando o PDF na hora, se ainda não existir/o arquivo
// sumiu do disco).
//
// Cobre:
// 1. OS com pdfPath válido no disco → sobe para o Cloudinary, devolve
//    a URL em dados.pdfUrl.
// 2. Garantia com pdfPath ausente → gera o PDF sob demanda
//    (obterModuloPdf().gerarPdfGarantia) antes de subir.
// 3. Falha ao consultar um número inexistente → encontrado:false, sem
//    tentar gerar/subir PDF nenhum.
// 4. Falha no upload do Cloudinary não derruba a consulta inteira —
//    dados.pdfUrl fica '' e o resto dos campos continua presente.
//
// Rodar: node testes/teste-consulta-anexa-pdf.js
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

let falhas = 0;
function assert(cond, msg) {
  if (!cond) { falhas++; console.error('❌ FALHOU:', msg); }
  else console.log('✅', msg);
}

function instalarMock(nomeModulo, exportsMock) {
  const caminhoResolvido = require.resolve(nomeModulo, { paths: [path.join(__dirname, '..')] });
  Module._cache[caminhoResolvido] = new Module(caminhoResolvido);
  Module._cache[caminhoResolvido].exports = exportsMock;
}

// Cria um PDF-fake real em disco (só precisa existir para fs.existsSync
// encontrar — o conteúdo não importa para este teste).
function criarArquivoFake(nome) {
  const caminho = path.join(os.tmpdir(), 'teste-consulta-pdf-' + Date.now() + '-' + nome);
  fs.writeFileSync(caminho, Buffer.from('conteudo-pdf-fake'));
  return caminho;
}



// A função montarRespostaConsulta não está no module.exports público (é
// interna, chamada só de dentro do listener onSnapshot). Para testar seu
// comportamento de verdade sem duplicar a lógica, usamos uma cópia do
// arquivo-fonte carregada isoladamente e extraímos a função via truque de
// module.exports temporário — mais simples e robusto: lemos o arquivo,
// adicionamos uma linha de exports extra ao final, e o executamos num
// contexto de módulo próprio. Isso testa o CÓDIGO REAL (não uma
// reimplementação), sem exigir mudar a superfície pública do módulo em
// produção.
function carregarComExportsInternos() {
  const caminhoOriginal = path.join(__dirname, '..', 'src', 'firebase-sync.js');
  let codigo = fs.readFileSync(caminhoOriginal, 'utf8');
  codigo += '\nmodule.exports.montarRespostaConsulta = montarRespostaConsulta;\nmodule.exports.anexarPdfComoUrl = anexarPdfComoUrl;\n';
  // Escreve no MESMO diretório do arquivo original (src/), não em
  // os.tmpdir() — o código faz require('./db'), require('./cloudinary-
  // storage') etc. relativos à sua própria pasta; copiar para outro
  // diretório quebra essa resolução.
  const caminhoTemp = path.join(__dirname, '..', 'src', '_firebase-sync-teste-temp.js');
  fs.writeFileSync(caminhoTemp, codigo);
  delete require.cache[require.resolve(caminhoTemp)];
  const mod = require(caminhoTemp);
  fs.unlinkSync(caminhoTemp);
  return mod;
}

async function testeMontarRespostaOsComPdfExistente() {
  const caminhoPdf = criarArquivoFake('os.pdf');
  const chamadasUpload = [];

  instalarMock('./src/db', {
    loadDB: () => ({ config: {}, ordens: [] }),
    obterOSPorNumero: (numero) => ({ numero, status: 'Em andamento', cliente: { nome: 'Cliente X' }, aparelho: { marca: 'A' }, data: '2026-01-01', pdfPath: caminhoPdf }),
    obterGarantiaPorNumeroOS: () => null,
  });
  instalarMock('./src/cloudinary-storage', {
    uploadBase64: async (caminhoLogico) => {
      chamadasUpload.push(caminhoLogico);
      return { url: 'https://res.cloudinary.com/fake/' + caminhoLogico + '.pdf', publicId: caminhoLogico };
    },
    apagarArquivo: async () => {},
    baixarComoBase64: async () => 'base64fake',
  });
  instalarMock('firebase/app', { initializeApp: (cfg) => ({ cfg }) });
  instalarMock('firebase/auth', { getAuth: () => ({}), signInAnonymously: async () => ({ user: { uid: 'x' } }) });
  instalarMock('firebase/firestore', { getFirestore: () => ({}) });

  const mod = carregarComExportsInternos();
  const resposta = await mod.montarRespostaConsulta({ tipo: 'os', numero: '123' });

  assert(resposta.encontrado === true, 'OS encontrada');
  assert(chamadasUpload.length === 1, 'fez exatamente 1 upload para o Cloudinary');
  assert(chamadasUpload[0] === 'consultas/os/123', 'usou public_id determinístico por número de OS: ' + chamadasUpload[0]);
  assert(resposta.dados.pdfUrl === 'https://res.cloudinary.com/fake/consultas/os/123.pdf', 'devolveu a URL do PDF: ' + resposta.dados.pdfUrl);
  assert(resposta.dados.status === 'Em andamento', 'campos de texto continuam presentes junto do PDF');
  assert(!('pdfFalhou' in resposta.dados), 'upload bem-sucedido: NÃO inclui pdfFalhou (Firestore rejeita undefined, campo simplesmente ausente)');

  fs.unlinkSync(caminhoPdf);
}

async function testeMontarRespostaGarantiaSemPdfGeraNaHora() {
  const chamadasGerarPdf = [];
  const caminhoGerado = criarArquivoFake('garantia-gerada.pdf');

  instalarMock('./src/db', {
    loadDB: () => ({ config: {}, ordens: [] }),
    obterOSPorNumero: () => null,
    obterGarantiaPorNumeroOS: (numero) => ({ numeroOS: numero, garantiaDias: 90, pdfPath: '' }), // sem PDF ainda
  });
  instalarMock('./src/cloudinary-storage', {
    uploadBase64: async (caminhoLogico) => ({ url: 'https://res.cloudinary.com/fake/' + caminhoLogico + '.pdf', publicId: caminhoLogico }),
    apagarArquivo: async () => {},
    baixarComoBase64: async () => 'base64fake',
  });
  instalarMock('./src/pdf', {
    gerarPdfGarantia: async (garantia) => {
      chamadasGerarPdf.push(garantia.numeroOS);
      return caminhoGerado;
    },
    regenerarPdfPorNumero: async () => { throw new Error('não deveria ser chamado para garantia'); },
  });
  instalarMock('firebase/app', { initializeApp: (cfg) => ({ cfg }) });
  instalarMock('firebase/auth', { getAuth: () => ({}), signInAnonymously: async () => ({ user: { uid: 'x' } }) });
  instalarMock('firebase/firestore', { getFirestore: () => ({}) });

  const mod = carregarComExportsInternos();
  const resposta = await mod.montarRespostaConsulta({ tipo: 'garantia', numero: '456' });

  assert(chamadasGerarPdf.length === 1 && chamadasGerarPdf[0] === '456', 'gerou o PDF sob demanda quando pdfPath estava vazio');
  assert(resposta.dados.pdfUrl === 'https://res.cloudinary.com/fake/consultas/garantia/456.pdf', 'devolveu a URL do PDF recém-gerado: ' + resposta.dados.pdfUrl);
  assert(resposta.dados.garantiaDias === 90, 'campos originais da garantia continuam presentes');

  fs.unlinkSync(caminhoGerado);
}

async function testeNumeroInexistenteNaoTentaGerarPdf() {
  let chamouGerarPdf = false;

  instalarMock('./src/db', {
    loadDB: () => ({ config: {}, ordens: [] }),
    obterOSPorNumero: () => null,
    obterGarantiaPorNumeroOS: () => null,
  });
  instalarMock('./src/cloudinary-storage', {
    uploadBase64: async () => { throw new Error('não deveria tentar upload'); },
    apagarArquivo: async () => {},
    baixarComoBase64: async () => 'base64fake',
  });
  instalarMock('./src/pdf', {
    gerarPdfGarantia: async () => { chamouGerarPdf = true; return ''; },
    regenerarPdfPorNumero: async () => { chamouGerarPdf = true; return ''; },
  });
  instalarMock('firebase/app', { initializeApp: (cfg) => ({ cfg }) });
  instalarMock('firebase/auth', { getAuth: () => ({}), signInAnonymously: async () => ({ user: { uid: 'x' } }) });
  instalarMock('firebase/firestore', { getFirestore: () => ({}) });

  const mod = carregarComExportsInternos();
  const respostaOS = await mod.montarRespostaConsulta({ tipo: 'os', numero: '999' });
  const respostaGarantia = await mod.montarRespostaConsulta({ tipo: 'garantia', numero: '999' });

  assert(respostaOS.encontrado === false, 'OS inexistente: encontrado:false');
  assert(respostaGarantia.encontrado === false, 'Garantia inexistente: encontrado:false');
  assert(chamouGerarPdf === false, 'não tentou gerar PDF para número inexistente');
}

async function testeFalhaNoUploadNaoQuebraConsulta() {
  const caminhoPdf = criarArquivoFake('os-falha.pdf');

  instalarMock('./src/db', {
    loadDB: () => ({ config: {}, ordens: [] }),
    obterOSPorNumero: (numero) => ({ numero, status: 'Pronto', cliente: {}, aparelho: {}, data: '', pdfPath: caminhoPdf }),
    obterGarantiaPorNumeroOS: () => null,
  });
  instalarMock('./src/cloudinary-storage', {
    uploadBase64: async () => { throw new Error('Cloudinary fora do ar'); },
    apagarArquivo: async () => {},
    baixarComoBase64: async () => 'base64fake',
  });
  instalarMock('firebase/app', { initializeApp: (cfg) => ({ cfg }) });
  instalarMock('firebase/auth', { getAuth: () => ({}), signInAnonymously: async () => ({ user: { uid: 'x' } }) });
  instalarMock('firebase/firestore', { getFirestore: () => ({}) });

  const mod = carregarComExportsInternos();
  const resposta = await mod.montarRespostaConsulta({ tipo: 'os', numero: '321' });

  assert(resposta.encontrado === true, 'OS ainda é encontrada mesmo com falha no upload do PDF');
  assert(resposta.dados.pdfUrl === '', 'pdfUrl fica vazio quando o upload falha, sem lançar: "' + resposta.dados.pdfUrl + '"');
  assert(resposta.dados.pdfFalhou === 'upload-falhou', 'sinaliza pdfFalhou="upload-falhou" no envelope para o celular poder dar feedback');
  assert(resposta.dados.status === 'Pronto', 'demais campos continuam presentes mesmo com PDF falhando');

  fs.unlinkSync(caminhoPdf);
}

(async () => {
  await testeMontarRespostaOsComPdfExistente();
  await testeMontarRespostaGarantiaSemPdfGeraNaHora();
  await testeNumeroInexistenteNaoTentaGerarPdf();
  await testeFalhaNoUploadNaoQuebraConsulta();

  if (falhas > 0) {
    console.error(`\n${falhas} teste(s) falharam.`);
    process.exit(1);
  } else {
    console.log('\n✅ Todos os testes passaram (0 falhas).');
  }
})();
