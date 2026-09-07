const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (relativo) => fs.readFileSync(path.join(raiz, relativo), 'utf8');

const renderer = ler('renderer/core/legacy-runtime.js');
const htmlPc = ler('renderer/index.html');
const consulta = ler('../sistemaos-android/www/js/consulta.js');
const reparos = ler('../sistemaos-android/www/js/prazos.js');
const appMobile = ler('../sistemaos-android/www/js/app.js');
const comprovanteMobile = ler('../sistemaos-android/www/js/comprovante-os.js');
const htmlMobile = ler('../sistemaos-android/www/index.html');
const preload = ler('src/preload/os-api.js');
const ipc = ler('src/ipc/register-legacy.js');
const servico = ler('src/comprovante-os.js');

[
  'A OS ${numeroAtualizado} foi marcada como entregue.',
  'Deseja emitir agora o comprovante de entrega',
  'abrirFluxoComprovanteEntrega',
  "['Pronto para retirada', 'Entregue'].includes(osDoComprovante?.status)",
  'Comprovante térmico',
  'O comprovante pode ser emitido depois',
  'Imprimir 2 vias',
  'imprimirEntregaTermicaUI'
].forEach((trecho) => assert.ok(renderer.includes(trecho), `Fluxo do PC ausente: ${trecho}`));

[
  'novaEntregaCpfRetirou',
  'novaEntregaTelefoneRetirou',
  'novaEntregaValorReparo',
  'novaEntregaFormaPagamento'
].forEach((id) => assert.ok(htmlPc.includes(`id="${id}"`), `Campo do PC ausente: ${id}`));

[
  'perguntarComprovanteEntrega',
  'Comprovante térmico / imprimir',
  "Object.assign({}, dados, { tipoComprovante: 'entrega' })",
  'Você pode emitir depois'
].forEach((trecho) => assert.ok(consulta.includes(trecho), `Consulta Android incompleta: ${trecho}`));

[
  'foi marcada como entregue',
  'Comprovante térmico / imprimir',
  'SistemaOSEntrega.iniciarPorOS(completa || os)',
  'continuará disponível neste reparo'
].forEach((trecho) => assert.ok(reparos.includes(trecho), `Reparos Android incompleto: ${trecho}`));

[
  'SistemaOSEntrega',
  'entrega-valor-reparo',
  'entrega-forma-pagamento'
].forEach((trecho) => assert.ok(appMobile.includes(trecho), `Formulário Android incompleto: ${trecho}`));

['entrega-valor-reparo', 'entrega-forma-pagamento', 'entrega-cpf-retirou', 'entrega-telefone-retirou']
  .forEach((id) => assert.ok(htmlMobile.includes(`id="${id}"`), `Campo Android ausente: ${id}`));

assert.ok(preload.includes('copias'), 'Preload não repassa o número de vias.');
assert.ok(ipc.includes('copias'), 'IPC não repassa o número de vias.');
assert.ok(servico.includes('opcoes.copies = totalCopias'), 'Impressão do PC não configura duas vias.');
assert.ok(comprovanteMobile.includes('VIA DA ASSISTÊNCIA') && comprovanteMobile.includes('VIA DO CLIENTE'),
  'Android não prepara as duas vias da entrega.');
assert.ok(comprovanteMobile.includes('/pronto.*retir/'),
  'Android não reconhece a OS pronta para retirada como comprovante térmico de retirada.');

assert.ok(htmlPc.includes('<option>Outra</option>'), 'PC não oferece a forma de pagamento Outra.');
assert.ok(htmlMobile.includes('<option value="Outra">Outra</option>') && htmlMobile.includes('<option>Outra</option>'),
  'Android não oferece a forma de pagamento Outra nos formulários comerciais e de entrega.');

console.log('OK: confirmação ao entregar, emissão posterior e impressão em 2 vias integradas no PC e Android.');
