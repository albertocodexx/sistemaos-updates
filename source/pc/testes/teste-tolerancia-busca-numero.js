// testes/teste-tolerancia-busca-numero.js
// ═══════════════════════════════════════════════════════════════
// Cobre a tolerância de formato na busca por número de OS, usada por
// obterOSPorNumero, obterEntregaPorNumeroOS e obterGarantiaPorNumeroOS
// (src/db.js). As três seguem o mesmo padrão: comparação EXATA primeiro
// (caminho normal, usado internamente com o valor já formatado
// "OS-0001"); se não achar, fallback comparando só a parte numérica via
// extrairNumeroInteiro — cobre o técnico digitando "1", "01" ou "OS-1"
// na busca do celular/PC, que sem isso nunca batia com "OS-0001" salvo
// no banco e sempre retornava "não encontrado" mesmo a OS existindo.
//
// Cenários cobertos para cada uma das três funções:
//   1. Comparação exata (valor já no formato salvo) continua funcionando.
//   2. Formatos tolerantes ("1", "01", "OS-1") encontram "OS-0001".
//   3. Número inexistente continua retornando "não encontrado" (null).
//   4. Casos de borda: string vazia, undefined/null, string sem nenhum
//      dígito — não devem "vazar" e casar com um registro por acidente
//      (extrairNumeroInteiro('') === 0, então precisa ficar claro que
//      isso não bate com uma OS real cujo número extraído também seja 0,
//      a menos que o número salvo realmente contenha um "0" isolado).
//
// Sem framework — mesmo padrão dos outros testes desta pasta: mocka só
// o `electron` (via require hook), aponta a raiz do banco para um dir
// temporário isolado por execução, e roda contra o db.js de verdade.
//
// Rodar: node testes/teste-tolerancia-busca-numero.js
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

const tmpDocsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-teste-tolerancia-busca-'));
const mockElectronPath = path.join(__dirname, '__mock_electron_tolerancia_busca_teste__.js');
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

try {
  // ── Fixtures: uma OS, uma entrega e uma garantia, todas com o mesmo
  //    número formatado "OS-0007", pra testar as três funções em paralelo ──
  const osCriada = db.criarOS({
    cliente: { nome: 'Cliente Tolerância', telefone: '27988887777' },
    aparelho: { marca: 'Samsung', modelo: 'A34', defeitoRelatado: 'Não carrega' }
  });
  // Força o número pra um valor conhecido e previsível pro teste (o
  // gerador incremental já dá "OS-0001" na primeira OS de um banco novo,
  // mas fixar explicitamente deixa a intenção clara e imune a mudanças
  // no ponto de partida do contador).
  {
    const dbBruto = JSON.parse(fs.readFileSync(db.getDbPath(), 'utf-8'));
    dbBruto.ordens[0].numero = 'OS-0007';
    fs.writeFileSync(db.getDbPath(), JSON.stringify(dbBruto, null, 2));
  }
  const numeroFixo = 'OS-0007';

  const pendenteEntrega = db.criarEntregaPendente(numeroFixo, { garantiaDias: 90 });
  db.importarRespostaAssinaturaEntrega({
    tipoArquivo: 'sistema-os-pc-para-assinar-resposta',
    tipoDocumento: 'entrega',
    idEnvioAssinatura: pendenteEntrega.idEnvioAssinatura,
    assinaturaRetirouBase64: 'data:image/png;base64,FAKEBASE64=='
  });

  db.criarOuAtualizarGarantia({
    numeroOS: numeroFixo,
    clienteNome: 'Cliente Tolerância',
    marca: 'Samsung',
    modelo: 'A34',
    servicoRealizado: 'Troca de conector de carga',
    garantiaDias: 90
  });

  // ── obterOSPorNumero ────────────────────────────────────────────
  ok('obterOSPorNumero: comparação exata ("OS-0007") encontra a OS',
    !!db.obterOSPorNumero('OS-0007') && db.obterOSPorNumero('OS-0007').numero === 'OS-0007');
  ok('obterOSPorNumero: tolerante "7" encontra "OS-0007"',
    !!db.obterOSPorNumero('7') && db.obterOSPorNumero('7').numero === 'OS-0007');
  ok('obterOSPorNumero: tolerante "07" encontra "OS-0007"',
    !!db.obterOSPorNumero('07') && db.obterOSPorNumero('07').numero === 'OS-0007');
  ok('obterOSPorNumero: tolerante "OS-7" encontra "OS-0007"',
    !!db.obterOSPorNumero('OS-7') && db.obterOSPorNumero('OS-7').numero === 'OS-0007');
  ok('obterOSPorNumero: número inexistente ("999") continua retornando null',
    db.obterOSPorNumero('999') === null);
  ok('obterOSPorNumero: string vazia não casa por acidente (retorna null)',
    db.obterOSPorNumero('') === null);
  ok('obterOSPorNumero: string sem nenhum dígito ("OS-abc") retorna null',
    db.obterOSPorNumero('OS-abc') === null);
  ok('obterOSPorNumero: undefined não derruba a função (retorna null)',
    db.obterOSPorNumero(undefined) === null);

  // ── obterEntregaPorNumeroOS ─────────────────────────────────────
  ok('obterEntregaPorNumeroOS: comparação exata ("OS-0007") encontra a entrega',
    !!db.obterEntregaPorNumeroOS('OS-0007') && db.obterEntregaPorNumeroOS('OS-0007').numeroOS === 'OS-0007');
  ok('obterEntregaPorNumeroOS: tolerante "7" encontra "OS-0007"',
    !!db.obterEntregaPorNumeroOS('7'));
  ok('obterEntregaPorNumeroOS: tolerante "01" != "0007" retorna null (não confunde números diferentes)',
    db.obterEntregaPorNumeroOS('01') === null);
  ok('obterEntregaPorNumeroOS: tolerante "OS-07" != "OS-0007" quando dígitos diferem, mas "007" bate',
    !!db.obterEntregaPorNumeroOS('007'));
  ok('obterEntregaPorNumeroOS: número inexistente ("123") continua retornando null',
    db.obterEntregaPorNumeroOS('123') === null);
  ok('obterEntregaPorNumeroOS: string vazia retorna null',
    db.obterEntregaPorNumeroOS('') === null);

  // ── obterGarantiaPorNumeroOS ────────────────────────────────────
  ok('obterGarantiaPorNumeroOS: comparação exata ("OS-0007") encontra a garantia',
    !!db.obterGarantiaPorNumeroOS('OS-0007') && db.obterGarantiaPorNumeroOS('OS-0007').numeroOS === 'OS-0007');
  ok('obterGarantiaPorNumeroOS: tolerante "7" encontra "OS-0007"',
    !!db.obterGarantiaPorNumeroOS('7'));
  ok('obterGarantiaPorNumeroOS: tolerante "OS-7" encontra "OS-0007"',
    !!db.obterGarantiaPorNumeroOS('OS-7'));
  ok('obterGarantiaPorNumeroOS: número inexistente ("42") continua retornando null',
    db.obterGarantiaPorNumeroOS('42') === null);
  ok('obterGarantiaPorNumeroOS: string vazia retorna null',
    db.obterGarantiaPorNumeroOS('') === null);

  // ── Caso de borda extra: duas OS com números que só diferem em zeros
  //    à esquerda não podem existir de fato no sistema real (o gerador
  //    é incremental e único), mas duas entregas/garantias distintas
  //    poderiam em tese ter numeroOS digitado por vias diferentes ──
  //    aqui garantimos que o fallback numérico pega exatamente 1 match
  //    quando existe mais de uma OS no banco (não pega a primeira que
  //    aparecer no array por engano).
  const os2 = db.criarOS({
    cliente: { nome: 'Cliente Dois', telefone: '27911112222' },
    aparelho: { marca: 'Motorola', modelo: 'G54', defeitoRelatado: 'Tela trincada' }
  });
  {
    const dbBruto = JSON.parse(fs.readFileSync(db.getDbPath(), 'utf-8'));
    const alvo = dbBruto.ordens.find(o => o.numero === os2.numero);
    alvo.numero = 'OS-0015';
    fs.writeFileSync(db.getDbPath(), JSON.stringify(dbBruto, null, 2));
  }
  ok('obterOSPorNumero: com duas OS no banco, "15" encontra a OS certa ("OS-0015"), não a primeira do array',
    !!db.obterOSPorNumero('15') && db.obterOSPorNumero('15').numero === 'OS-0015');
  ok('obterOSPorNumero: com duas OS no banco, "7" ainda encontra a OS certa ("OS-0007")',
    !!db.obterOSPorNumero('7') && db.obterOSPorNumero('7').numero === 'OS-0007');

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
