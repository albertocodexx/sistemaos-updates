// testes/teste-bloco4-reenvio-edicao.js
//
// Bloco 4 (editar no celular depois de salvo, reenviando pro PC): valida
// que importarLoteDoCelular, ao receber um item com o MESMO idExportacao
// de um registro já importado (os/compra/venda), ATUALIZA esse registro
// em vez de criar um duplicado ou pular silenciosamente — desde que o
// tipoDocumento do item bata com o tipo do registro encontrado.
//
// Roda db.js real contra um diretório de dados temporário e isolado,
// mesmo padrão dos outros testes desta pasta (só mocka 'electron').
//
// Rodar: node testes/teste-bloco4-reenvio-edicao.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

let total = 0, falhas = 0;
function ok(desc, condicao) {
  total++;
  if (condicao) { console.log('OK   - ' + desc); }
  else { falhas++; console.log('FALHOU - ' + desc); }
}

function instalarMock(nomeModulo, exportsMock) {
  const caminhoResolvido = require.resolve(nomeModulo, { paths: [path.join(__dirname, '..')] });
  Module._cache[caminhoResolvido] = new Module(caminhoResolvido);
  Module._cache[caminhoResolvido].exports = exportsMock;
}

const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-bloco4-'));
instalarMock('electron', { app: { getPath: () => dirTemp } });

delete require.cache[require.resolve('../src/db')];
const db = require('../src/db');

function itemOS(idExportacao, overrides) {
  return {
    idExportacao,
    tipoDocumento: 'os',
    dados: Object.assign({
      cliente: { nome: 'Cliente Original', telefone: '27977775555' },
      aparelho: { marca: 'Samsung', modelo: 'A54', defeitoRelatado: 'Tela quebrada' },
      observacoes: '',
      prioridade: 'normal',
      dataPrevista: '',
      horaPrevista: '',
      assinaturaClienteBase64: '',
      assinaturaAssistenciaBase64: ''
    }, overrides || {})
  };
}

function itemCompra(idExportacao, overrides) {
  return {
    idExportacao,
    tipoDocumento: 'compra',
    dados: Object.assign({
      vendedor: { nome: 'Vendedor Original', telefone: '27977776666' },
      aparelho: { marca: 'Motorola', modelo: 'Edge 30' },
      avaliacao: {},
      dadosCompra: { valor: 500, formaPagamento: 'Pix' },
      assinaturaVendedorBase64: 'data:image/png;base64,ASSINATURA_ORIGINAL_VENDEDOR'
    }, overrides || {})
  };
}

function itemVenda(idExportacao, overrides) {
  return {
    idExportacao,
    tipoDocumento: 'venda',
    dados: Object.assign({
      tipoEquipamento: 'celular',
      marca: 'Apple',
      modelo: 'iPhone 12',
      cor: 'Preto',
      imei: '123456789012345',
      observacoes: '',
      garantia: '90 dias',
      compradorNome: 'Comprador Original',
      compradorTelefone: '27977777777',
      compradorCpf: '',
      valorVenda: 1500,
      formaPagamento: 'Pix',
      assinaturaCompradorBase64: 'data:image/png;base64,ASSINATURA_ORIGINAL_COMPRADOR'
    }, overrides || {})
  };
}

try {

  // ── Cenário 1: OS — reenvio com mesmo idExportacao ATUALIZA, não duplica ──
  const idExpOS = 'os-abc123';
  const r1 = db.importarLoteDoCelular({ tipoArquivo: 'sistema-os-celular-lote', itens: [itemOS(idExpOS)] });
  ok('OS: importação inicial bem-sucedida', r1.sucesso === true);
  ok('OS: 1 OS importada (criada)', r1.importados.os === 1);

  const osOriginal = (db.listarOrdens()).find(o => o.origemIdExportacao === idExpOS);
  ok('OS: registro criado com origemIdExportacao correto', !!osOriginal);
  const numeroOSOriginal = osOriginal.numero;

  // Reenvia o MESMO idExportacao, com cliente editado e a assinatura
  // coletada depois. Deve atualizar o registro original, não duplicar.
  const r2 = db.importarLoteDoCelular({
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [itemOS(idExpOS, {
      cliente: { nome: 'Cliente EDITADO', telefone: '27977775555' },
      assinaturaClienteBase64: 'data:image/png;base64,ASSINATURA_COLETADA_DEPOIS'
    })]
  });
  ok('OS: reenvio processado com sucesso', r2.sucesso === true);
  ok('OS: reenvio NÃO cria uma segunda OS (importados.os continua 0 nesta chamada)', r2.importados.os === 0);
  ok('OS: reenvio é contado como atualização', r2.atualizados.os === 1);

  const todasOS = db.listarOrdens().filter(o => o.origemIdExportacao === idExpOS);
  ok('OS: continua existindo só 1 OS com este idExportacao (não duplicou)', todasOS.length === 1);
  ok('OS: mesmo número de OS preservado (não recriou)', todasOS[0].numero === numeroOSOriginal);
  ok('OS: nome do cliente foi atualizado', todasOS[0].cliente.nome === 'Cliente EDITADO');
  ok('OS: assinatura coletada depois atualizou o mesmo registro',
    todasOS[0].assinaturaClienteBase64 === 'data:image/png;base64,ASSINATURA_COLETADA_DEPOIS');

  // ── Cenário 2: Compra — mesmo comportamento ──
  const idExpCompra = 'compra-xyz789';
  db.importarLoteDoCelular({ tipoArquivo: 'sistema-os-celular-lote', itens: [itemCompra(idExpCompra)] });
  const compraOriginal = db.listarCompras().find(c => c.origemIdExportacao === idExpCompra);
  ok('Compra: registro original criado', !!compraOriginal);

  const r3 = db.importarLoteDoCelular({
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [itemCompra(idExpCompra, { vendedor: { nome: 'Vendedor EDITADO', telefone: '27977776666' } })]
  });
  ok('Compra: reenvio contado como atualização', r3.atualizados.compra === 1);
  const comprasComEsseId = db.listarCompras().filter(c => c.origemIdExportacao === idExpCompra);
  ok('Compra: não duplicou (continua 1 registro)', comprasComEsseId.length === 1);
  ok('Compra: vendedor atualizado', comprasComEsseId[0].vendedor.nome === 'Vendedor EDITADO');
  ok('Compra: assinatura do vendedor preservada',
    comprasComEsseId[0].assinaturaVendedorBase64 === 'data:image/png;base64,ASSINATURA_ORIGINAL_VENDEDOR');

  // ── Cenário 3: Venda — mesmo comportamento ──
  const idExpVenda = 'venda-qwe456';
  db.importarLoteDoCelular({ tipoArquivo: 'sistema-os-celular-lote', itens: [itemVenda(idExpVenda)] });
  const vendaOriginal = db.listarEstoque().find(e => e.origemIdExportacao === idExpVenda);
  ok('Venda: registro original criado', !!vendaOriginal);

  const r4 = db.importarLoteDoCelular({
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [itemVenda(idExpVenda, { compradorNome: 'Comprador EDITADO' })]
  });
  ok('Venda: reenvio contado como atualização', r4.atualizados.venda === 1);
  const vendasComEsseId = db.listarEstoque().filter(e => e.origemIdExportacao === idExpVenda);
  ok('Venda: não duplicou (continua 1 registro)', vendasComEsseId.length === 1);
  ok('Venda: comprador atualizado', vendasComEsseId[0].compradorNome === 'Comprador EDITADO');
  ok('Venda: assinatura do comprador preservada',
    vendasComEsseId[0].assinaturaCompradorBase64 === 'data:image/png;base64,ASSINATURA_ORIGINAL_COMPRADOR');

  // ── Cenário 4: idExportacao nunca visto continua criando normalmente ──
  const r5 = db.importarLoteDoCelular({
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [itemOS('os-nunca-visto-999')]
  });
  ok('idExportacao novo: continua criando (não tenta atualizar nada)', r5.importados.os === 1 && r5.atualizados.os === 0);

  // ── Cenário 5: lote misto (edição de OS + criação de Compra nova) num único lote ──
  const idExpOSJaExiste = idExpOS; // já criada no cenário 1
  const r6 = db.importarLoteDoCelular({
    tipoArquivo: 'sistema-os-celular-lote',
    itens: [
      itemOS(idExpOSJaExiste, { observacoes: 'Segunda edição' }),
      itemCompra('compra-nova-lote-misto')
    ]
  });
  ok('Lote misto: sucesso geral', r6.sucesso === true);
  ok('Lote misto: OS existente foi atualizada, não recriada', r6.atualizados.os === 1 && r6.importados.os === 0);
  ok('Lote misto: Compra nova foi criada normalmente', r6.importados.compra === 1);

} catch (err) {
  console.error('ERRO INESPERADO:', err);
  falhas++;
  total++;
} finally {
  try { fs.rmSync(dirTemp, { recursive: true, force: true }); } catch (e) { /* ignora */ }
}

console.log(`\n${total} teste(s), ${falhas} falha(s).`);
process.exit(falhas > 0 ? 1 : 0);
