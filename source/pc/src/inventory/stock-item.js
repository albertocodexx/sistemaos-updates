const TIPOS_ITEM_ESTOQUE = [
  'Peça / Componente',
  'Consumível',
  'Acessório'
];

function normalizarTipoItem(valor) {
  const tipo = String(valor || '').trim();
  return TIPOS_ITEM_ESTOQUE.includes(tipo) ? tipo : TIPOS_ITEM_ESTOQUE[0];
}

function calcularMovimentacaoEstoque(saldoAtual, tipo, quantidade) {
  const saldo = Number.parseInt(saldoAtual, 10);
  const qtd = Number.parseInt(quantidade, 10);
  if (!Number.isInteger(saldo) || saldo < 0) {
    throw new Error('Saldo atual do item é inválido.');
  }
  if (!['entrada', 'saida'].includes(tipo)) {
    throw new Error('Tipo de movimentação inválido.');
  }
  if (!Number.isInteger(qtd) || qtd <= 0) {
    throw new Error('Informe uma quantidade inteira maior que zero.');
  }
  if (tipo === 'saida' && qtd > saldo) {
    throw new Error(`Estoque insuficiente. Disponível: ${saldo}`);
  }
  return {
    saldoAnterior: saldo,
    saldoAtual: tipo === 'entrada' ? saldo + qtd : saldo - qtd,
    quantidade: qtd,
    tipo
  };
}

module.exports = {
  TIPOS_ITEM_ESTOQUE,
  normalizarTipoItem,
  calcularMovimentacaoEstoque
};
