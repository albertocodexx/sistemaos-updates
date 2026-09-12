'use strict';
// Documentos sintéticos com os mesmos templates usados pelos botões do aplicativo.
const fs = require('node:fs');
const path = require('node:path');
const saida = path.resolve(__dirname, '../android/app/src/androidTest/assets/pdf-qa');
fs.mkdirSync(saida, { recursive: true });
const templates = path.resolve(__dirname, '../www/src/templates');
const config = {
  nomeEmpresa: 'Assistência Teste PDF', nomeFantasia: 'Assistência Teste PDF',
  endereco: 'Rua de Teste, 100', telefone: '(11) 99999-0000', email: 'teste@example.com',
  usarTermosPredefinidosOS: true, usarTermosPredefinidosGarantia: true,
  tema: { corPrincipal: '#111111', corCabecalhos: '#111111' }
};
const registro = {
  numero: 'OS-TESTE', numeroOS: 'OS-TESTE', data: '2026-09-12T12:00:00Z', criadoEm: '2026-09-12T12:00:00Z',
  cliente: { nome: 'Cliente de Teste', clienteId: '10000', telefone: '(11) 99999-0000' },
  aparelho: { marca: 'Samsung', modelo: 'Galaxy S20 FE', cor: 'Branco', tipo: 'Smartphone' },
  defeitoRelatado: 'Tela quebrada', observacoes: 'Documento sintético de validação.',
  diagnosticoTecnico: { servico: 'Troca da tela', valor: 250, valorTotal: 250 },
  valorTotalServico: 250, valor: 250, status: 'Pronto para retirada',
  nomeRetirou: 'Cliente de Teste', dataInicio: '2026-09-12', prazoDias: 90,
  assinaturaStatus: 'nao_assinado', assinaturaNaoAssinada: true
};
for (const [nome, funcao] of [['os', 'gerarHtmlOS'], ['entrega', 'gerarHtmlEntrega'], ['garantia', 'gerarHtmlGarantia'], ['desbloqueio', 'gerarHtmlDesbloqueio']]) {
  fs.writeFileSync(path.join(saida, nome + '.html'), require(path.join(templates, nome + '-template.js'))[funcao](registro, config));
}
fs.writeFileSync(path.join(saida, 'multipagina.html'), '<!doctype html><html><head><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;background:white;color:black}.pagina{width:794px;height:1123px;padding:60px}h1{font:40px Arial}p{font:24px Arial}</style></head><body><div class="pagina"><h1>PRIMEIRA PÁGINA</h1><p>Documento de teste com conteúdo e valores: R$ 250,00</p><div style="background:#e02020;height:220px;width:250px"></div></div><div class="pagina"><h1>SEGUNDA PÁGINA</h1><p>Termos finais e assinatura do cliente</p><div style="background:#20a020;height:220px;width:250px"></div></div></body></html>');
console.log('Fixtures geradas: OS, entrega, garantia, desbloqueio e duas páginas.');
