'use strict';

const texto = valor => String(valor ?? '').trim();
function centavos(valor) {
  if (valor === null || valor === undefined || texto(valor) === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  const inteiro = Math.round(numero * 100);
  return Number.isSafeInteger(inteiro) && Math.abs(numero * 100 - inteiro) < 0.000001 ? inteiro : null;
}

function idMercadoPago(registro) {
  return texto(registro?.mercadoPagoId) || (texto(registro?.observacao).match(/\bID MP:\s*(\d+)\b/)?.[1] || '');
}

// Somente o objeto consultado na API do provedor pode confirmar uma cobrança.
// Data de criação, e não de aprovação, separa um checkout antigo de um novo.
function pagamentoCorresponde(pagamento, cobranca, empresaId = '', agora = Date.now()) {
  if (!pagamento || !cobranca || cobranca.status !== 'aguardando') return false;
  if (pagamento.status !== 'approved' || !/^\d+$/.test(texto(pagamento.id))) return false;
  if (pagamento.currency_id !== 'BRL' || pagamento.live_mode === false) return false;
  if (Number(pagamento.transaction_amount_refunded || 0) !== 0) return false;
  if (texto(pagamento.external_reference) !== texto(cobranca.osNumero)) return false;
  if (pagamento.empresa_id && texto(pagamento.empresa_id) !== texto(empresaId)) return false;
  if (pagamento.metadata?.empresa_id && texto(pagamento.metadata.empresa_id) !== texto(empresaId)) return false;
  const esperado = centavos(cobranca.valor);
  if (esperado === null || centavos(pagamento.transaction_amount) !== esperado) return false;
  const criada = Date.parse(cobranca.criadoEm);
  const iniciado = Date.parse(pagamento.date_created);
  const aprovado = Date.parse(pagamento.date_approved);
  const margem = 5 * 60 * 1000;
  return Number.isFinite(criada) && Number.isFinite(iniciado) && Number.isFinite(aprovado)
    && iniciado >= criada - margem && iniciado <= agora + margem
    && aprovado >= iniciado - margem && aprovado <= agora + margem;
}

function transacaoJaUtilizada(pagamento, cobranca, registros, cobrancas = []) {
  const id = texto(pagamento?.id);
  const anterior = registros.find(p => p.origem === 'mercadopago' && idMercadoPago(p) === id);
  if (!anterior) return false;
  if (anterior.osNumero !== cobranca.osNumero) return true;
  if (anterior.cobrancaId) return anterior.cobrancaId !== cobranca.id;
  return cobrancas.some(c => c.id !== cobranca.id && c.pagamentoId === anterior.id);
}

module.exports = { centavos, idMercadoPago, pagamentoCorresponde, transacaoJaUtilizada };
