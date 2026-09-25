'use strict';

const fs = require('fs');
const path = require('path');

const banco = path.resolve(String(process.argv[2] || ''));
if (!process.argv[2] || !fs.existsSync(banco)) {
  throw new Error('Informe o caminho existente do database.json da empresa.');
}

const original = fs.readFileSync(banco, 'utf8');
const dados = JSON.parse(original);
const aparelho = (dados.estoque || []).find((item) => item?.id === 'EST-0001');
if (!aparelho || String(aparelho.marca || '').toLowerCase() !== 'samsung' || !/s20\s*fe/i.test(aparelho.modelo || '')) {
  throw new Error('O EST-0001 Samsung S20 FE não foi encontrado; nada foi alterado.');
}

const agora = new Date().toISOString();
const jaRegistrado = (aparelho.historicoStatus || []).some((item) =>
  item?.status === 'Vendido' && item?.origem === 'correcao-sincronizacao'
);
aparelho.status = 'Vendido';
aparelho.valorGastoPecas = 290;
aparelho.pecasUsadas = [
  { nome: 'Tela', valor: 0 },
  { nome: 'Carcaça completa', valor: 0 }
];
aparelho.historicoStatus = Array.isArray(aparelho.historicoStatus) ? aparelho.historicoStatus : [];
if (!jaRegistrado) {
  aparelho.historicoStatus.push({
    status: 'Vendido', data: agora, origem: 'correcao-sincronizacao',
    observacao: 'Restauração do estado vendido e do total de R$ 290,00 em peças.'
  });
}
dados.logEstoque = Array.isArray(dados.logEstoque) ? dados.logEstoque : [];
dados.logEstoque.push({
  data: agora, tipo: 'correcao', id: aparelho.id,
  descricao: `${aparelho.marca} ${aparelho.modelo}`,
  status: 'Vendido', valorPago: aparelho.valorPago, valorVenda: aparelho.valorVenda,
  usuario: 'Sistema OS',
  obs: 'Corrigida regressão de sincronização: Reservado → Vendido; peças: Tela e Carcaça completa; total preservado em R$ 290,00.'
});

const sufixo = agora.replace(/[:.]/g, '-');
const backup = path.join(path.dirname(banco), `database.antes-correcao-s20fe-${sufixo}.json`);
const temporario = `${banco}.reparo-${process.pid}.tmp`;
fs.writeFileSync(backup, original, 'utf8');
fs.writeFileSync(temporario, JSON.stringify(dados, null, 2), 'utf8');
JSON.parse(fs.readFileSync(temporario, 'utf8'));
fs.renameSync(temporario, banco);

console.log(JSON.stringify({
  sucesso: true, backup, id: aparelho.id, status: aparelho.status,
  valorGastoPecas: aparelho.valorGastoPecas,
  pecasUsadas: aparelho.pecasUsadas.map((item) => item.nome)
}, null, 2));
