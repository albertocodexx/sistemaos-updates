const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  gerarHtmlComprovanteOS,
  montarModeloComprovanteOS,
  mapearEntregaParaComprovante
} = require('../../src/templates/comprovante-os-template');
const { gerarHtmlEntrega } = require('../../src/templates/entrega-template');

const LOGO_TESTE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+O8yZVwAAAABJRU5ErkJggg==';
const config = {
  nomeFantasia: 'TechReparos Assistência Técnica',
  possuiCnpj: true,
  cnpj: '00.000.000/0001-00',
  inscricaoEstadual: '123.456.789',
  telefonePrincipal: '(27) 98145-1544',
  enderecoEmpresa: 'Rua de teste, 123',
  logoBase64: LOGO_TESTE
};

function criarOS(status, extras) {
  return {
    id: 'os-teste',
    numero: 'OS OS-0042',
    revision: 7,
    updatedAt: '2026-07-23T14:30:00-03:00',
    status,
    cliente: {
      nome: 'Maria da Silva',
      telefone: '(27) 99999-0000',
      cpf: '123.456.789-00'
    },
    aparelho: {
      tipoEquipamento: 'Smartphone',
      marca: 'Samsung',
      modelo: 'Galaxy S23 Ultra',
      cor: 'Preto',
      imei: '123456789012345',
      defeitoRelatado: 'Não liga.',
      senhaAparelho: 'SEGREDO-987'
    },
    diagnosticoTecnico: {
      diagnostico: 'Conector danificado.',
      solucao: 'Substituição do conector e testes funcionais.',
      valorEstimado: 280,
      prazoEstimado: '2 dias úteis',
      pecasTrocar: [{ nome: 'Conector de carga', custo: 35, quantidade: 1 }]
    },
    formaPagamento: 'Pix',
    garantiaDias: 90,
    custoInterno: 35,
    margem: 245,
    observacoesInternas: 'Não mostrar ao cliente.',
    ...extras
  };
}

function verificarSeguranca(html, formato) {
  [
    'SEGREDO-987',
    'senhaAparelho',
    'custoInterno',
    'Não mostrar ao cliente',
    '<img class="logo"',
    'DOCUMENTO NÃO FISCAL',
    'Documento não fiscal'
  ].forEach((segredo) => {
    assert.ok(!html.includes(segredo), `Conteúdo proibido no comprovante: ${segredo}`);
  });
  assert.ok(!html.includes('OS OS-0042'), 'O prefixo OS não pode ser repetido.');
  assert.ok(html.includes('OS-0042'), 'O número normalizado da OS deve aparecer.');
  assert.ok(!html.includes('<span>Status</span>'), 'O status não deve aparecer no comprovante.');
  if (formato === 'a4') {
    assert.ok(html.includes('class="empresa-logo"'), 'O A4 deve exibir a logo da empresa.');
    assert.ok(html.includes('Inscrição Estadual'), 'O A4 deve exibir os dados completos da empresa.');
  } else {
    assert.ok(!html.includes('class="empresa-logo"'), 'O comprovante térmico deve manter o cabeçalho compacto.');
  }
}

const osAutorizacao = criarOS('Aguardando aprovação');
const modeloAutorizacao = montarModeloComprovanteOS(osAutorizacao, config);
assert.strictEqual(modeloAutorizacao.numero, 'OS-0042');
assert.strictEqual(modeloAutorizacao.tipo, 'autorizacao');
assert.strictEqual(modeloAutorizacao.titulo, 'AUTORIZAÇÃO DE SERVIÇO');
assert.strictEqual(modeloAutorizacao.valor, 280);
assert.deepStrictEqual(modeloAutorizacao.pecas, ['1x Conector de carga']);

['58mm', '80mm', 'a4'].forEach((formato) => {
  const html = gerarHtmlComprovanteOS(osAutorizacao, config, { formato });
  assert.ok(html.includes('AUTORIZAÇÃO DE SERVIÇO'));
  assert.ok(html.includes('A assinatura deste comprovante formaliza a aceitação dos termos.'));
  assert.ok(!html.includes('ASSISTÊNCIA TÉCNICA<br>'), 'não deve pedir assinatura da assistência');
  assert.ok(html.includes('SERVIÇO PROPOSTO'));
  assert.ok(html.includes('ASSINATURA PARA AUTORIZAR'));
  assert.ok(html.includes('VALOR AUTORIZADO'));
  assert.ok(!html.includes('Forma de pagamento'));
  assert.ok(!html.includes('Garantia'));
  verificarSeguranca(html, formato);
});

const osEntrega = criarOS('Entregue', {
  dataHoraEntrega: '2026-07-23T18:45:00-03:00',
  nomeRetirou: 'João Responsável',
  telefoneRetirou: '(27) 98888-7777',
  cpfRetirou: '987.654.321-00',
  assinaturaRetirouBase64: 'data:image/png;base64,QUJDREVGRw=='
});
const modeloEntrega = montarModeloComprovanteOS(osEntrega, config);
assert.strictEqual(modeloEntrega.tipo, 'entrega');
assert.strictEqual(modeloEntrega.titulo, 'COMPROVANTE DE ENTREGA');
assert.strictEqual(modeloEntrega.entrega.recebidoPor, 'João Responsável');

['58mm', '80mm', 'a4'].forEach((formato) => {
  const html = gerarHtmlComprovanteOS(osEntrega, config, { formato });
  assert.ok(html.includes('COMPROVANTE DE ENTREGA'));
  assert.ok(html.includes('REPAROS REALIZADOS'));
  assert.ok(html.includes('Forma de pagamento'));
  assert.ok(html.includes('Pix'));
  assert.ok(html.includes('Data e hora da entrega'));
  assert.ok(html.includes('João Responsável'));
  assert.ok(html.includes('987.654.321-00'));
  assert.ok(html.includes('ASSINATURA DE QUEM RECEBEU'));
  assert.ok(html.includes('R$&nbsp;280,00') || html.includes('R$ 280,00') || html.includes('R$ 280,00'));
  verificarSeguranca(html, formato);
});

const osProntaRetirada = criarOS('Pronto para retirada', {
  formaPagamento: 'Outra'
});
const modeloProntaRetirada = montarModeloComprovanteOS(osProntaRetirada, config);
assert.strictEqual(modeloProntaRetirada.tipo, 'entrega');
const htmlProntaRetirada = gerarHtmlComprovanteOS(osProntaRetirada, config, { formato: '80mm' });
assert.ok(htmlProntaRetirada.includes('COMPROVANTE DE ENTREGA'));
assert.ok(htmlProntaRetirada.includes('Forma de pagamento'));
assert.ok(htmlProntaRetirada.includes('Outra'));
assert.ok(htmlProntaRetirada.includes('ASSINATURA DE QUEM RECEBEU'));
assert.ok(!htmlProntaRetirada.includes('Data e hora da entrega'),
  'OS apenas pronta para retirada não pode declarar uma data de entrega que ainda não aconteceu.');

const entregaLegada = {
  numeroOS: '42',
  nomeRetirou: 'João Responsável',
  cpfRetirou: '987.654.321-00',
  telefoneRetirou: '(27) 98888-7777',
  marca: 'Samsung',
  modelo: 'Galaxy S23 Ultra',
  reparoRealizado: 'Substituição do conector e testes funcionais.',
  valorReparo: 280,
  formaPagamento: 'Pix',
  dataHoraAssinatura: '2026-07-23T18:45:00-03:00',
  assinaturaRetirouBase64: 'data:image/png;base64,QUJDREVGRw=='
};
const entregaMapeada = mapearEntregaParaComprovante(entregaLegada);
assert.strictEqual(entregaMapeada.numero, 'OS-0042');
assert.strictEqual(entregaMapeada.tipoComprovante, 'entrega');
assert.strictEqual(entregaMapeada.entrega.nomeRetirou, 'João Responsável');
const htmlEntregaUnificada = gerarHtmlEntrega(entregaLegada, config);
assert.ok(htmlEntregaUnificada.includes('COMPROVANTE DE ENTREGA'));
assert.ok(htmlEntregaUnificada.includes('class="empresa-logo"'));
assert.ok(htmlEntregaUnificada.includes('ASSINATURA DE QUEM RECEBEU'));
assert.ok(!htmlEntregaUnificada.includes('ASSINATURA DA ASSISTÊNCIA'));
assert.ok(!htmlEntregaUnificada.includes('VIA DA ASSISTÊNCIA'));

const osGeral = criarOS('Em reparo');
const modeloGeral = montarModeloComprovanteOS(osGeral, config);
assert.strictEqual(modeloGeral.tipo, 'geral');
assert.strictEqual(modeloGeral.titulo, 'COMPROVANTE DA ORDEM DE SERVIÇO');
const htmlGeral = gerarHtmlComprovanteOS(osGeral, config, { formato: '80mm' });
assert.ok(htmlGeral.includes('COMPROVANTE DA ORDEM DE SERVIÇO'));
verificarSeguranca(htmlGeral, '80mm');

const pc = fs.readFileSync(path.join(__dirname, '../../src/templates/comprovante-os-template.js'), 'utf8');
const mobile = fs.readFileSync(path.join(__dirname, '../../../sistemaos-android/www/src/templates/comprovante-os-template.js'), 'utf8');
assert.strictEqual(mobile, pc, 'O template do PC e do Android deve ser idêntico.');

console.log('OK - autorização, entrega e OS geral em A4/58/80 mm, segurança e paridade PC/Android.');
