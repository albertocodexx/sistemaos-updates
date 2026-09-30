'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createClientesRepository } = require('../../src/repositories/clientes-repository');

const banco = {
  ordens: [
    { numero: 'OS-0001', data: '2026-09-01', cliente: { clienteId: '10001', nome: 'Ana Silva', cpf: '11111111111', telefone: '27999990000' }, aparelho: {}, pagamentoId: 'PAG-1' },
    { numero: 'OS-0002', data: '2026-09-02', cliente: { clienteId: '10002', nome: 'Ana Souza', cpf: '22222222222', telefone: '27999991111' }, aparelho: {} }
  ],
  estoque: [], pecas: [], compras: [], orcamentos: [], desbloqueios: [],
  entregas: [{ numeroOS: 'OS-0001', documentoEntregaId: 'ENT-1' }, { numeroOS: 'OS-0002', documentoEntregaId: 'ENT-2' }],
  entregasPendentes: [], garantias: [{ numeroOS: 'OS-0001' }, { numeroOS: 'OS-0002' }],
  pagamentos: [{ id: 'PAG-1', osNumero: 'OS-0001', valor: 100 }, { id: 'PAG-2', osNumero: 'OS-0002', valor: 200 }],
  reembolsos: [{ id: 'R-1', pagamentoId: 'PAG-1' }, { id: 'R-2', pagamentoId: 'PAG-2' }],
  cobrancas: [{ id: 'C-1', osNumero: 'OS-0001' }, { id: 'C-2', osNumero: 'OS-0002' }],
  logMensagensWapp: [
    { id: 'M-1', osNumero: '', telefone: '5527999990000' },
    { id: 'M-2', osNumero: '', telefone: '5527999991111' }
  ],
  logIA: [{ id: 'I-1', osNumero: 'OS-0001' }, { id: 'I-2', osNumero: 'OS-0002' }]
};
const repo = createClientesRepository({ loadDB: () => structuredClone(banco), saveDB: () => {} });
const dados = repo.exportarDadosCompletosCliente('cpf:11111111111');
assert.equal(dados.tipo, 'dados-completos-cliente-sistema-os');
assert.deepEqual(dados.ordens.map(item => item.numero), ['OS-0001']);
assert.deepEqual(dados.pagamentos.map(item => item.id), ['PAG-1']);
assert.deepEqual(dados.reembolsos.map(item => item.id), ['R-1']);
assert.deepEqual(dados.cobrancas.map(item => item.id), ['C-1']);
assert.deepEqual(dados.entregas.map(item => item.documentoEntregaId), ['ENT-1']);
assert.deepEqual(dados.mensagensWhatsApp.map(item => item.id), ['M-1']);
assert.deepEqual(dados.logIA.map(item => item.id), ['I-1']);

const raiz = path.resolve(__dirname, '..', '..');
const ipc = fs.readFileSync(path.join(raiz, 'src/ipc/register-legacy.js'), 'utf8');
const preload = fs.readFileSync(path.join(raiz, 'src/preload/api.js'), 'utf8');
const html = fs.readFileSync(path.join(raiz, 'renderer/index.html'), 'utf8');
const dominio = fs.readFileSync(path.join(raiz, 'src/database/domain.js'), 'utf8');
assert.match(ipc, /clientes:exportarCompleto/);
assert.match(ipc, /caminhoDentroDe\(real, db\.getRootDir\(\), extensoes\)/);
assert.match(ipc, /SHA256SUMS\.txt/);
assert.match(preload, /clientesexportarcompleto/);
assert.match(html, /Exportar tudo/);
assert.match(dominio, /versaoBackup: 9/);
assert.match(dominio, /proximoClienteId: db6\.proximoClienteId/);
assert.match(dominio, /pacote\.integridade/);
assert.match(dominio, /timingSafeEqual/);
assert.match(dominio, /mesclarLog\('historicoExclusoes'/);
assert.match(dominio, /mesclarLog\('logEstoque'/);
assert.match(dominio, /mesclarLog\('logPecas'/);
console.log('OK: exportação completa isola o cliente, leva documentos e hashes; backup v9 cobre contador, auditoria e integridade.');
