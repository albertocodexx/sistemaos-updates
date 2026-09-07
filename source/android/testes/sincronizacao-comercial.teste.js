const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const app = ler('www/js/app.js');
const cloud = ler('www/js/cloud-data.js');
const sync = ler('www/js/supabase/sync-service.js');
const arquivos = ler('www/js/supabase/arquivo-service.js');
const retry = ler('www/js/sync-retry.js');
const html = ler('www/index.html');

assert.ok(app.includes("['os', 'compra', 'venda', 'entrega'].indexOf(tipoDocumento)"), 'salvamento automático deve incluir Compra, Venda e Entrega');
assert.ok(cloud.includes('function sincronizarRegistro(registro)'), 'adaptador deve sincronizar qualquer documento comercial suportado');
assert.ok(sync.includes("'criar_documento_comercial_mobile'"), 'Compra/Venda devem usar RPC transacional');
assert.ok(sync.includes('valor_total'), 'valor comercial deve seguir para relatórios e gráficos');
assert.ok(arquivos.includes('assinatura_vendedor'), 'assinatura do vendedor deve ir ao Storage');
assert.ok(arquivos.includes('assinatura_comprador'), 'assinatura do comprador deve ir ao Storage');
assert.ok(arquivos.includes('registrar_arquivo_comercial_mobile'), 'anexo comercial deve ser registrado no Supabase');
assert.ok(retry.includes("['os', 'compra', 'venda', 'entrega']"), 'retry offline deve incluir Compra, Venda e Entrega');
assert.ok(sync.includes("'criar_entrega_mobile'"), 'Entrega deve usar RPC transacional própria');
assert.ok(arquivos.includes("tipo === 'entrega' ? dados.assinaturaRetirouBase64"), 'assinatura da retirada deve ir ao Storage');
assert.ok(app.includes('valorReparo: Number(dados.valorReparo) || 0'), 'valor da entrega deve seguir para o PC');
assert.ok(app.includes("formaPagamento: dados.formaPagamento || ''"), 'forma de pagamento da entrega deve seguir para o PC');
assert.ok(app.includes('A OS será marcada como Entregue no PC'), 'o celular deve explicar a atualização automática do status');
assert.ok(html.includes('btn-add-foto-compra'), 'Compra deve permitir anexar fotos no APK');
assert.ok(app.includes("SistemaOSFotos.obterFotos('compra')"), 'Compra deve guardar as fotos no documento');
assert.ok(app.includes("fotos: Array.isArray(dados.fotos) ? dados.fotos : []"), 'fotos da Compra devem seguir para o Supabase');
assert.ok(app.includes('dataVenda: dados.dataVenda'), 'Venda deve preservar a data informada no envio');
assert.ok(app.includes('compradorSemNumero: dados.compradorSemNumero === true'), 'Venda deve preservar a opção sem telefone');

console.log('OK: Compra, Venda e Entrega sincronizam automaticamente com valores e assinaturas.');
