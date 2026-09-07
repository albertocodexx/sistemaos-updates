const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

const dominio = ler('src', 'database', 'domain.js');
const mapper = ler('src', 'supabase', 'os-mapper.js');
const renderer = ler('renderer', 'core', 'legacy-runtime.js');
const html = ler('renderer', 'index.html');
const runtime = ler('src', 'supabase', 'desktop-runtime.js');
const ipc = ler('src', 'ipc', 'register-legacy.js');
const backup = ler('src', 'backup.js');
const edgeIntegracoes = ler('supabase', 'functions', 'integracoes-empresa', 'index.ts');
const osMapper = require('../../src/supabase/os-mapper');

assert.match(dominio, /usarMercadoPagoAprovacao:\s*dadosOS\.usarMercadoPagoAprovacao !== undefined/,
  'a opção MP deste envio precisa ser persistida pela atualização da OS');
assert.match(dominio, /contextoFormaPagamento:\s*dadosOS\.contextoFormaPagamento !== undefined/,
  'o contexto da forma de pagamento precisa ser persistido');
assert.match(mapper, /usar_mercado_pago_aprovacao/,
  'o estado do fluxo MP precisa sobreviver à sincronização');
assert.ok(renderer.indexOf('const osPreparada = await window.api.osatualizar') <
  renderer.indexOf('resultado = await window.api.wappenviaraprovacao'),
  'a escolha MP deve ser salva antes de enviar a mensagem');
assert.match(renderer, /tipoFluxo === 'aprovacao' \|\| usarMercadoPago/,
  'o orçamento exige o valor mesmo quando o Mercado Pago está desligado');
assert.match(renderer, /valorTotalServico: valor/,
  'o total do orçamento é persistido independentemente da forma de pagamento');
assert.ok(renderer.indexOf('const caminhoPdfAtualizado = await window.api.osgerarPdf(numero);') <
  renderer.indexOf('resultado = await window.api.wappenviaraprovacao'),
  'o PDF do orçamento é atualizado antes de ser anexado ao WhatsApp');
assert.match(renderer, /resultado\.status !== 'Cancelado'/,
  'cancelamento deve validar o resultado gravado');
assert.match(renderer, /confirmado\.status !== 'Cancelado'/,
  'cancelamento deve reler o banco antes de informar sucesso');
assert.match(renderer, /if \(os\.status === 'Cancelado' \|\| os\.status === 'Entregue'\) return false/,
  'OS cancelada não deve permanecer na aba de autorizadas');
assert.match(renderer, /os\.statusAprovacao.*=== 'Aprovado'/,
  'a aba de autorizadas deve usar o estado de aprovação, não o pagamento');
assert.match(renderer, /prompt-senha-toggle/,
  'prompts protegidos devem permitir mostrar e ocultar senha');
assert.equal((html.match(/id="mercadoPagoWhatsAppAtivoConfig"/g) || []).length, 1,
  'o check global MP deve existir uma única vez');
assert.ok(html.indexOf('id="mercadoPagoWhatsAppAtivoConfig"') <
  html.indexOf('Integrações antigas'),
  'o check global MP deve estar na seção visível');
assert.match(runtime, /if \(assinaturas > 0\) enviados \+= await this\._processarFila\(\)/,
  'o PDF regenerado após assinatura deve ser publicado no mesmo ciclo');
assert.match(ipc, /PDF não pôde ser atualizado/,
  'falha ao regenerar PDF não pode confirmar e perder a resposta de assinatura');
assert.match(ipc, /Comprovante de Entrada — \$\{percentualQuitado\}%/,
  'comprovante parcial não identifica claramente os 50%');
assert.match(ipc, /Comprovante de Quitação — 100%/,
  'comprovante final não identifica claramente a quitação de 100%');
assert.match(ipc, /comprovanteGerado:/,
  'confirmação presencial não disponibiliza o comprovante silencioso');
assert.match(renderer, /enviarWhatsapp:\s*false/,
  'confirmação presencial não deve enviar o comprovante ao cliente');

// O zero vindo do Supabase é um valor financeiro válido e deve limpar um
// saldo local antigo. O antigo uso de `||` mantinha R$ 100,00 fantasma.
const osComSaldoRemotoZerado = osMapper.remotoParaLocal({
  numero: 'OS-TESTE-MP',
  status: 'Em reparo',
  dados_extras: {
    valor_total_servico: 200,
    valor_entrada_aprovacao: 100,
    valor_restante_servico: 0,
    percentual_pagamento_confirmado: 100,
    percentual_pagamento_aguardado: 0
  }
}, {
  valorTotalServico: 200,
  valorEntradaAprovacao: 100,
  valorRestanteServico: 100,
  percentualPagamentoConfirmado: 50,
  percentualPagamentoAguardado: 50
});
assert.equal(osComSaldoRemotoZerado.valorRestanteServico, 0,
  'o mapper preservou saldo local mesmo com zero confirmado no Supabase');
assert.equal(osComSaldoRemotoZerado.percentualPagamentoConfirmado, 100,
  'o mapper não aplicou o percentual confirmado remoto');
assert.equal(osComSaldoRemotoZerado.percentualPagamentoAguardado, 0,
  'o mapper não limpou o percentual aguardado remoto');

assert.doesNotMatch(renderer, /const\s+_pollingAtivos|new\s+Map\(\)\s*;\s*\/\/.*poll/i,
  'o renderer ainda mantém um segundo poller concorrente do Mercado Pago');
assert.match(backup, /definirConsultorMercadoPago/,
  'o poller do backend não recebeu o consultor seguro do Mercado Pago');
assert.match(runtime, /acao:\s*'consultar_pagamentos'/,
  'o runtime não consulta pagamentos pelo cofre Supabase');
assert.match(edgeIntegracoes, /acao === 'consultar_pagamentos'/,
  'a Edge Function não oferece a consulta segura de pagamentos');
assert.match(ipc, /cobId:\s*cobrancaSolicitada\?\.id|cobId:\s*cobReferencia\?\.id/,
  'a confirmação não devolve a cobrança exata processada');
assert.doesNotMatch(ipc, /cliente@email\.com/,
  'o checkout não pode receber e-mail fictício quando a OS não possui e-mail');
assert.match(ipc, /Object\.keys\(pagador\)\.length \? \{ payer: pagador \} : \{\}/,
  'o fluxo local não envia os dados reais do cliente ao Mercado Pago');
assert.match(edgeIntegracoes, /emailPagador/,
  'a Edge Function não valida o e-mail real do cliente');
assert.match(edgeIntegracoes, /Object\.keys\(pagador\)\.length \? \{ payer: pagador \} : \{\}/,
  'a preferência segura não preenche condicionalmente os dados do cliente');

console.log('OK: Mercado Pago, cancelamento, senha e publicação do PDF assinado validados.');
