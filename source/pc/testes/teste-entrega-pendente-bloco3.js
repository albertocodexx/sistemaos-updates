// testes/teste-entrega-pendente-bloco3.js
//
// Bloco 3 — Nova Entrega criada no PC. Cobre o pipeline PARALELO ao de
// assinatura de OS/Compra/Venda: criar pendente a partir de uma OS
// existente, gerar o pacote no formato que o app celular já espera
// (tipoDocumento 'entrega' — ver documentos-recebidos.js do celular, que
// já suporta esse tipo sem alteração nenhuma), e importar a resposta
// assinada de volta, virando um registro real em db.entregas.
//
// Sem framework — mesmo padrão dos outros testes desta pasta: mocka só
// o `electron` (via require hook), aponta a raiz do banco para um dir
// temporário isolado por execução, e roda contra o db.js de verdade.
//
// Rodar: node testes/teste-entrega-pendente-bloco3.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

const tmpDocsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-teste-entrega-'));
const mockElectronPath = path.join(__dirname, '__mock_electron_entrega_teste__.js');
fs.writeFileSync(mockElectronPath, `module.exports = { app: { getPath: () => ${JSON.stringify(tmpDocsDir)} } };`);

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return mockElectronPath;
  return originalResolve.call(this, request, ...args);
};

const db = require('../src/db.js');

let total = 0, falhas = 0;
function ok(desc, condicao) {
  total++;
  if (condicao) {
    console.log('OK   - ' + desc);
  } else {
    falhas++;
    console.log('FALHOU - ' + desc);
  }
}

function criarOSTeste(overrides) {
  return db.criarOS(Object.assign({
    cliente: { nome: 'Teste Cliente', telefone: '27999999999' },
    aparelho: { marca: 'Samsung', modelo: 'A54', defeitoRelatado: 'Tela quebrada' }
  }, overrides || {}));
}

try {
  // ── Cenário 1: criação + idempotência ──────────────────────────
  const os1 = criarOSTeste();
  const pendente = db.criarEntregaPendente(os1.numero, { garantiaDias: 90 });
  ok('criarEntregaPendente: puxa nomeRetirou/marca/modelo da OS por padrão',
    pendente.nomeRetirou === 'Teste Cliente' && pendente.marca === 'Samsung' && pendente.modelo === 'A54');
  ok('criarEntregaPendente: calcula dataLimiteGarantia quando garantiaDias > 0',
    !!pendente.dataLimiteGarantia);
  ok('criarEntregaPendente: preenche a declaração fixa',
    typeof pendente.declaracao === 'string' && pendente.declaracao.length > 0);

  const pendente2 = db.criarEntregaPendente(os1.numero, { garantiaDias: 60, nomeRetirou: 'Outra Pessoa' });
  ok('criarEntregaPendente: reemitir para a mesma OS mantém o MESMO idEnvioAssinatura (idempotente)',
    pendente.idEnvioAssinatura === pendente2.idEnvioAssinatura);
  ok('criarEntregaPendente: reemitir SUBSTITUI a pendente anterior (não duplica)',
    db.listarEntregasPendentes().length === 1);

  // ── Cenário 2: pacote no formato esperado pelo celular ─────────
  const pacote = db.gerarPacoteEntregaParaAssinar(os1.numero);
  ok('gerarPacoteEntregaParaAssinar: tipoArquivo correto (mesmo dos outros tipos)',
    pacote.tipoArquivo === 'sistema-os-pc-para-assinar');
  ok('gerarPacoteEntregaParaAssinar: tipoDocumento "entrega"',
    pacote.tipoDocumento === 'entrega');
  ok('gerarPacoteEntregaParaAssinar: dados refletem a versão mais recente da pendente',
    pacote.dados.nomeRetirou === 'Outra Pessoa');

  // ── Cenário 3: importar resposta assinada ───────────────────────
  const resposta = {
    tipoArquivo: 'sistema-os-pc-para-assinar-resposta',
    tipoDocumento: 'entrega',
    idEnvioAssinatura: pacote.idEnvioAssinatura,
    assinaturaRetirouBase64: 'data:image/png;base64,FAKEBASE64=='
  };
  const resultado = db.importarRespostaAssinaturaEntrega(resposta);
  ok('importarRespostaAssinaturaEntrega: sucesso', resultado.sucesso === true);
  ok('importarRespostaAssinaturaEntrega: grava em db.entregas (não em ordens/compras/estoque)',
    db.listarEntregas().length === 1 && db.listarEntregas()[0].numeroOS === os1.numero);
  ok('importarRespostaAssinaturaEntrega: assinatura gravada corretamente',
    db.listarEntregas()[0].assinaturaRetirouBase64.includes('FAKEBASE64'));
  ok('importarRespostaAssinaturaEntrega: remove da fila de pendentes depois de processar',
    db.listarEntregasPendentes().length === 0);

  // ── Cenário 4: idEnvioAssinatura desconhecido não lança, só rejeita ──
  const resultadoDesconhecido = db.importarRespostaAssinaturaEntrega({
    tipoArquivo: 'sistema-os-pc-para-assinar-resposta',
    tipoDocumento: 'entrega',
    idEnvioAssinatura: 'entrega-inexistente-999',
    assinaturaRetirouBase64: 'x'
  });
  ok('importarRespostaAssinaturaEntrega: idEnvioAssinatura desconhecido resolve sucesso:false sem lançar',
    resultadoDesconhecido.sucesso === false);

  // ── Cenário 5: OS excluída entre o envio e a resposta não vira órfã ──
  const os2 = criarOSTeste({ cliente: { nome: 'Cliente2', telefone: '27988887777' }, aparelho: { marca: 'Apple', modelo: 'iPhone 12', defeitoRelatado: 'Bateria' } });
  db.criarEntregaPendente(os2.numero, { garantiaDias: 30 });
  const pacote2 = db.gerarPacoteEntregaParaAssinar(os2.numero);
  db.excluirOS(os2.numero, null);
  const resultadoOSExcluida = db.importarRespostaAssinaturaEntrega({
    tipoArquivo: 'sistema-os-pc-para-assinar-resposta',
    tipoDocumento: 'entrega',
    idEnvioAssinatura: pacote2.idEnvioAssinatura,
    assinaturaRetirouBase64: 'x'
  });
  ok('importarRespostaAssinaturaEntrega: OS excluída antes da resposta voltar não cria comprovante órfão',
    resultadoOSExcluida.sucesso === false);

  // ── Cenário 6: fotos de categoria 'entrega' já anexadas na OS são puxadas ──
  const os3 = criarOSTeste({ cliente: { nome: 'Cliente3', telefone: '27977776666' }, aparelho: { marca: 'Motorola', modelo: 'Edge 30', defeitoRelatado: 'Não liga' } });
  const fotoPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  db.salvarFotoOS(os3.numero, 'entrega', fotoPngBase64, 'saida.png');
  db.salvarFotoOS(os3.numero, 'defeito', fotoPngBase64, 'defeito.png'); // categoria diferente — NÃO deve entrar
  const pendente3 = db.criarEntregaPendente(os3.numero, { garantiaDias: 0 });
  ok('criarEntregaPendente: puxa só fotos de categoria "entrega" da OS (ignora outras categorias)',
    pendente3.fotos.length === 1 && pendente3.fotos[0].categoria === 'entrega');
  ok('criarEntregaPendente: garantiaDias 0 não gera dataLimiteGarantia',
    pendente3.dataLimiteGarantia === '');

  const pacote3 = db.gerarPacoteEntregaParaAssinar(os3.numero);
  ok('gerarPacoteEntregaParaAssinar: injeta base64 da foto lida do disco',
    pacote3.dados.fotos.length === 1 && typeof pacote3.dados.fotos[0].base64 === 'string' && pacote3.dados.fotos[0].base64.startsWith('data:image'));

  // Cenário 7: comprovante definitivo sem assinatura criado no PC.
  const os4 = criarOSTeste({ cliente: { nome: 'Cliente4', telefone: '27966665555' }, aparelho: { marca: 'Motorola', modelo: 'G9 Play', defeitoRelatado: 'Conector' } });
  const resultadoNaoAssinado = db.criarEntregaNaoAssinada(os4.numero, { garantiaDias: 45 });
  ok('criarEntregaNaoAssinada: cria comprovante definitivo sem assinatura',
    resultadoNaoAssinado.entrega.numeroOS === os4.numero && resultadoNaoAssinado.entrega.assinaturaRetirouBase64 === '');
  ok('criarEntregaNaoAssinada: nao deixa item na fila de assinatura',
    db.obterEntregaPendentePorNumeroOS(os4.numero) === null);
  const garantiaAutomatica = db.obterGarantiaPorNumeroOS(os4.numero);
  ok('criarEntregaNaoAssinada: emite a garantia automaticamente quando o prazo foi preenchido',
    garantiaAutomatica?.garantiaDias === 45 &&
    garantiaAutomatica?.origem === 'entrega' &&
    !!garantiaAutomatica?.dataLimite);

  const osSemGarantia = criarOSTeste({
    cliente: { nome: 'Sem Garantia', telefone: '27955554444' },
    aparelho: { marca: 'Samsung', modelo: 'A14', defeitoRelatado: 'Teste' }
  });
  db.criarEntregaNaoAssinada(osSemGarantia.numero, { garantiaDias: 0 });
  ok('criarEntregaNaoAssinada: prazo zero continua sendo sem garantia',
    db.obterGarantiaPorNumeroOS(osSemGarantia.numero) === null);

  const os5 = criarOSTeste({
    dataManual: '2026-07-21T10:00:00.000Z',
    diagnosticoTecnico: { pecasTrocar: [{ nome: 'Tela', valor: 95 }], valorEstimado: 230 }
  });
  const relatorioJulho = db.obterRelatorioFinanceiro({ mes: 7, ano: 2026 });
  ok('relatorio financeiro: contabiliza peca manual da OS mesmo antes do pagamento',
    relatorioJulho.saidas.custoPecasManualOS === 95);

} catch (err) {
  console.error('ERRO INESPERADO:', err);
  falhas++;
  total++;
} finally {
  try { fs.unlinkSync(mockElectronPath); } catch (e) { /* ignora */ }
  try { fs.rmSync(tmpDocsDir, { recursive: true, force: true }); } catch (e) { /* ignora */ }
}

console.log(`\n${total} teste(s), ${falhas} falha(s).`);
process.exit(falhas > 0 ? 1 : 0);
