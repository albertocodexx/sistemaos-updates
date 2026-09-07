const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');
const runtime = ler('src', 'supabase', 'desktop-runtime.js');
const ipc = ler('src', 'ipc', 'register-legacy.js');
const dominio = ler('src', 'database', 'domain.js');
const migration = ler('supabase', 'migrations', '20260720000200_compras_vendas_mobile_assinaturas.sql');
const migrationArquivos = ler('supabase', 'migrations', '20260720000300_atualizar_comercial_apos_arquivo.sql');
const migrationEntrega = ler('supabase', 'migrations', '20260724000400_entregas_mobile_valor_pagamento.sql');

assert.match(runtime, /from\('compras'\)/, 'desktop deve baixar Compras do Supabase');
assert.match(runtime, /from\('vendas'\)/, 'desktop deve baixar Vendas do Supabase');
assert.match(runtime, /from\('entregas'\)/, 'desktop deve baixar Entregas do Supabase');
assert.match(runtime, /assinatura_vendedor/, 'desktop deve reconstruir assinatura do vendedor');
assert.match(runtime, /assinatura_comprador/, 'desktop deve reconstruir assinatura do comprador');
assert.match(runtime, /assinatura_retirou/, 'desktop deve reconstruir assinatura de quem retirou');
assert.match(runtime, /assinaturaStoragePath/, 'desktop deve recuperar a assinatura da empresa quando o APK antigo nao anexou o snapshot');
assert.match(runtime, /termosDaIdentidade/, 'desktop deve recuperar os termos mobile quando o APK antigo nao enviou o snapshot');
assert.match(runtime, /dados\.fotos = arquivos\.fotos/, 'desktop deve baixar fotos da Compra');
assert.match(migrationArquivos, /trg_tocar_documento_comercial_por_arquivo/, 'arquivo novo deve provocar outro pull da Compra/Venda');
assert.match(ipc, /definirProcessadorDocumentoComercialRemoto/, 'runtime deve importar Compra/Venda no domínio local');
assert.match(ipc, /pdf\.gerarPdfCompra/, 'Compra recebida deve regenerar PDF');
assert.match(ipc, /pdf\.gerarPdfVenda/, 'Venda recebida deve regenerar PDF');
assert.match(ipc, /pdf\.gerarPdfEntrega/, 'Entrega recebida deve regenerar PDF');
assert.match(dominio, /assinaturaVendedorBase64:\s*d\.assinaturaVendedorBase64 !== undefined/, 'reenvio deve atualizar assinatura da Compra');
assert.match(dominio, /assinaturaCompradorBase64:\s*d\.assinaturaCompradorBase64 !== undefined/, 'reenvio deve atualizar assinatura da Venda');
assert.match(migration, /create or replace function public\.criar_documento_comercial_mobile/, 'migração deve criar RPC comercial');
assert.match(migration, /valor_total/, 'valor comercial deve ser persistido para relatórios');
assert.match(migration, /registrar_arquivo_comercial_mobile/, 'migração deve registrar assinaturas privadas');
assert.match(migrationEntrega, /create or replace function public\.criar_entrega_mobile/, 'migração deve criar a entrega móvel');
assert.match(migrationEntrega, /valor_reparo/, 'valor cobrado deve ser persistido na entrega');
assert.match(migrationEntrega, /forma_pagamento/, 'forma de pagamento deve ser persistida na entrega');

// Exercita o caminho real dos valores atÃ© o mesmo banco consumido pelos
// cards financeiros e pelo grÃ¡fico mensal do Electron.
const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-comercial-mobile-'));
const electronPath = require.resolve('electron', { paths: [raiz] });
Module._cache[electronPath] = new Module(electronPath);
Module._cache[electronPath].exports = { app: { getPath: () => dirTemp } };
delete require.cache[require.resolve('../../src/db')];
const db = require('../../src/db');
const agora = new Date();
const importacao = db.importarLoteDoCelular({
  tipoArquivo: 'sistema-os-celular-lote',
  itens: [
    {
      idExportacao: 'compra-grafico-001', tipoDocumento: 'compra',
      dados: {
        vendedor: { nome: 'Fornecedor Mobile' },
        aparelho: { marca: 'Samsung', modelo: 'A55' },
        avaliacao: {}, dadosCompra: { valor: '425.50', formaPagamento: 'Pix' },
        assinaturaVendedorBase64: 'data:image/png;base64,VENDEDOR',
        fotos: [{ base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', supabaseArquivoId: 'foto-compra-001' }]
      }
    },
    {
      idExportacao: 'venda-grafico-001', tipoDocumento: 'venda',
      dados: {
        tipoEquipamento: 'Smartphone', marca: 'Samsung', modelo: 'A55',
        compradorNome: 'Cliente Mobile', valorVenda: '1200.00',
        formaPagamento: 'Pix', dataVenda: agora.toISOString(), compradorSemNumero: true,
        assinaturaCompradorBase64: 'data:image/png;base64,COMPRADOR',
        assinaturaAssistenciaBase64: 'data:image/png;base64,ASSISTENCIA',
        termosVenda: 'Termos congelados no celular.'
      }
    }
  ]
});
assert.strictEqual(importacao.sucesso, true, 'lote comercial deve entrar no banco local');
assert.strictEqual(Number(db.listarCompras()[0].dadosCompra.valor), 425.5, 'valor da Compra deve ser preservado');
assert.strictEqual(db.listarCompras()[0].fotos.length, 1, 'foto da Compra deve ser salva no PC');
assert.ok(fs.existsSync(db.listarCompras()[0].fotos[0].path), 'arquivo da foto da Compra deve existir no disco');
assert.strictEqual(Number(db.listarEstoque()[0].valorVenda), 1200, 'valor da Venda deve ser preservado');
assert.strictEqual(db.listarEstoque()[0].dataVenda, agora.toISOString(), 'data da Venda deve ser preservada');
assert.strictEqual(db.listarEstoque()[0].compradorSemNumero, true, 'opcao sem telefone deve ser preservada');
assert.strictEqual(db.listarEstoque()[0].assinaturaAssistenciaBase64, 'data:image/png;base64,ASSISTENCIA', 'assinatura da assistencia deve ser preservada');
assert.strictEqual(db.listarEstoque()[0].termosVenda, 'Termos congelados no celular.', 'termos da venda devem ser preservados como snapshot');
const clientesMobile = db.listarClientes();
assert.ok(clientesMobile.some((cliente) => cliente.nome === 'Fornecedor Mobile'), 'Compra recebida deve cadastrar o vendedor em Clientes');
assert.ok(clientesMobile.some((cliente) => cliente.nome === 'Cliente Mobile'), 'Venda recebida deve cadastrar o comprador em Clientes');

// Uma venda iniciada no Estoque do Android precisa atualizar o MESMO EST,
// primeiro como reservado e depois como vendido quando a assinatura chegar.
const aparelhoVinculado = db.criarItemEstoque({
  tipoEquipamento: 'Smartphone', marca: 'Motorola', modelo: 'G9 Play',
  cor: 'Azul', status: 'Em reparo', valorVenda: 900
});
const quantidadeAntesDaVendaVinculada = db.listarEstoque().length;
const idVendaVinculada = 'venda-estoque-vinculada-001';
let vendaVinculada = db.importarLoteDoCelular({
  tipoArquivo: 'sistema-os-celular-lote',
  itens: [{
    idExportacao: idVendaVinculada,
    tipoDocumento: 'venda',
    dados: {
      estoqueLocalId: aparelhoVinculado.id,
      tipoEquipamento: 'Smartphone', marca: 'Motorola', modelo: 'G9 Play', cor: 'Azul',
      compradorNome: 'Comprador Vinculado', compradorEmail: 'cliente@example.com',
      compradorSemNumero: true, valorVenda: 975, formaPagamento: 'Pix',
      dataVenda: agora.toISOString(), assinaturaPendente: true
    }
  }]
});
assert.strictEqual(vendaVinculada.sucesso, true);
assert.strictEqual(db.listarEstoque().length, quantidadeAntesDaVendaVinculada,
  'venda vinculada não pode duplicar o aparelho');
assert.strictEqual(db.obterItemEstoquePorId(aparelhoVinculado.id).status, 'Reservado',
  'assinar depois deve reservar o aparelho');
assert.strictEqual(Number(db.obterItemEstoquePorId(aparelhoVinculado.id).valorVenda), 975,
  'valor preenchido no celular deve atualizar o estoque e os gráficos');

vendaVinculada = db.importarLoteDoCelular({
  tipoArquivo: 'sistema-os-celular-lote',
  itens: [{
    idExportacao: idVendaVinculada,
    tipoDocumento: 'venda',
    dados: {
      estoqueLocalId: aparelhoVinculado.id,
      tipoEquipamento: 'Smartphone', marca: 'Motorola', modelo: 'G9 Play', cor: 'Azul',
      compradorNome: 'Comprador Vinculado', compradorEmail: 'cliente@example.com',
      compradorSemNumero: true, valorVenda: 975, formaPagamento: 'Pix',
      dataVenda: agora.toISOString(), assinaturaPendente: false,
      assinaturaCompradorBase64: 'data:image/png;base64,ASSINADO'
    }
  }]
});
assert.strictEqual(vendaVinculada.sucesso, true);
assert.strictEqual(db.listarEstoque().length, quantidadeAntesDaVendaVinculada,
  'assinatura posterior também deve manter um único aparelho');
assert.strictEqual(db.obterItemEstoquePorId(aparelhoVinculado.id).status, 'Vendido',
  'assinatura recebida deve concluir a venda');
assert.strictEqual(db.obterItemEstoquePorId(aparelhoVinculado.id).compradorEmail, 'cliente@example.com');
const financeiro = db.obterRelatorioFinanceiro({ mes: agora.getMonth() + 1, ano: agora.getFullYear() });
assert.strictEqual(financeiro.saidas.compras, 425.5, 'Compra mobile deve alimentar o Financeiro');
assert.strictEqual(financeiro.entradas.vendas, 2175, 'Vendas mobile devem alimentar o Financeiro sem duplicação');
const pontoAtual = financeiro.historico.find((ponto) => ponto.mes === financeiro.periodo.prefixo);
assert.ok(pontoAtual && pontoAtual.entradas >= 1200, 'Venda mobile deve alimentar o grÃ¡fico mensal');
// Venda e estoque sao tabelas distintas no Supabase e podem chegar fora de
// ordem. O PC deve preservar o EST escolhido, nunca gerar outro sequencial.
const quantidadeAntesDaVendaForaDeOrdem = db.listarEstoque().length;
const idExatoForaDeOrdem = 'EST-0471';
const vendaForaDeOrdem = db.importarLoteDoCelular({
  tipoArquivo: 'sistema-os-celular-lote',
  itens: [{
    idExportacao: 'venda-estoque-fora-de-ordem-001', tipoDocumento: 'venda',
    dados: {
      estoqueLocalId: idExatoForaDeOrdem,
      tipoEquipamento: 'Smartphone', marca: 'Apple', modelo: 'iPhone 13', cor: 'Preto',
      compradorNome: 'Venda Exata', compradorSemNumero: true, valorVenda: 2500,
      formaPagamento: 'Pix', dataVenda: agora.toISOString(), assinaturaPendente: false,
      assinaturaCompradorBase64: 'data:image/png;base64,EXATA'
    }
  }]
});
assert.strictEqual(vendaForaDeOrdem.sucesso, true);
assert.strictEqual(db.listarEstoque().length, quantidadeAntesDaVendaForaDeOrdem + 1,
  'venda que chega antes do estoque deve criar somente o espelho do EST selecionado');
assert.strictEqual(db.obterItemEstoquePorId(idExatoForaDeOrdem).status, 'Vendido',
  'o identificador exato selecionado no celular deve ser marcado como vendido no PC');
assert.strictEqual(db.listarEstoque().filter((item) => item.origemIdExportacao === 'venda-estoque-fora-de-ordem-001').length, 1,
  'venda fora de ordem nao pode gerar item duplicado');
fs.rmSync(dirTemp, { recursive: true, force: true });

console.log('OK: PC recebe Compra/Venda/Entrega, valores e assinaturas do APK.');
