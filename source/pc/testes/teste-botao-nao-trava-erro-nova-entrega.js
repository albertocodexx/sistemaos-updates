// testes/teste-botao-nao-trava-erro-nova-entrega.js
//
// Regressão pontual (Bloco 3): em enviarNovaEntregaParaAssinatura, o
// bloco `finally` chegou a deixar btnNovaEntregaEnviarAssinatura sempre
// com disabled=true, mesmo quando entregacriarpendente/
// exportarParaAssinaturaCelular lançavam erro. Resultado: se o envio
// falhasse (rede fora, Firebase indisponível etc.), o botão ficava
// travado e o usuário só conseguia tentar de novo saindo da tela e
// buscando a OS outra vez.
//
// Não há DOM/Electron neste ambiente de testes (ver outros arquivos
// desta pasta — todos batem contra src/db.js, não contra o renderer).
// Este teste não simula o DOM: ele analisa o texto-fonte de
// renderer/renderer.js e garante estruturalmente que:
//   1. existe uma flag de sucesso declarada antes do try;
//   2. o finally usa essa flag para decidir `disabled`, em vez de um
//      `disabled = true` incondicional.
// Isso é suficiente para travar a regressão específica sem exigir um
// ambiente gráfico, que este sandbox não tem (ver ONDE_PAREI.md /
// resumo do Bloco 3 sobre a limitação de testar Electron aqui).
//
// Rodar: node testes/teste-botao-nao-trava-erro-nova-entrega.js

const fs = require('fs');
const path = require('path');

const rendererPath = path.join(__dirname, '..', 'renderer', 'core', 'legacy-runtime.js');
const codigo = fs.readFileSync(rendererPath, 'utf8');

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

// Isola o corpo da função enviarNovaEntregaParaAssinatura para não
// acoplar o teste a outras funções do arquivo.
const inicio = codigo.indexOf('window.enviarNovaEntregaParaAssinatura = async function () {');
if (inicio === -1) {
  console.log('FALHOU - função window.enviarNovaEntregaParaAssinatura não encontrada em renderer.js');
  process.exit(1);
}
// Pega até o próximo "window." de nível de topo (próxima função exposta),
// que é o padrão usado em todo o arquivo nesta seção.
const fim = codigo.indexOf('\n  window.', inicio + 10);
const corpo = codigo.slice(inicio, fim === -1 ? inicio + 3000 : fim);

ok(
  'declara uma variável de controle de sucesso antes do try',
  /let\s+sucesso\s*=\s*false/.test(corpo)
);

ok(
  'marca sucesso = true somente após as chamadas assíncronas terem funcionado',
  /sucesso\s*=\s*true/.test(corpo)
);

ok(
  'o finally NÃO contém um `btn.disabled = true` incondicional (a regressão original)',
  !/finally[\s\S]*?\{\s*if\s*\(btn\)\s*\{\s*btn\.disabled\s*=\s*true;/.test(corpo)
);

ok(
  'o finally decide `disabled` a partir da flag de sucesso, não de uma constante',
  /finally[\s\S]*?btn\.disabled\s*=\s*sucesso/.test(corpo)
);

ok(
  'em caso de erro (catch) não chama limparFormNovaEntrega, então o botão só falaria disabled=true de novo via a flag sucesso (defesa em profundidade contra o mesmo bug)',
  (() => {
    const catchIdx = corpo.indexOf('} catch (e) {');
    const finallyIdx = corpo.indexOf('} finally {');
    if (catchIdx === -1 || finallyIdx === -1) return false;
    const trechoCatch = corpo.slice(catchIdx, finallyIdx);
    return !trechoCatch.includes('limparFormNovaEntrega');
  })()
);

console.log('');
if (falhas === 0) {
  console.log(`✅ Todos os testes passaram (0 falhas). ${total} verificação(ões).`);
  process.exit(0);
} else {
  console.log(`❌ ${falhas} falha(s) de ${total}.`);
  process.exit(1);
}
