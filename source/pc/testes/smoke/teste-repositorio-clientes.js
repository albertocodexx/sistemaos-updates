// Smoke test da Parte 8: domínio de Clientes isolado do arquivo físico.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { createClientesRepository } = require(path.resolve(
  __dirname, '..', '..', 'src', 'repositories', 'clientes-repository.js'
));
const dbSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'database', 'domain.js'), 'utf8');
const fachadaDbSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'db.js'), 'utf8');
assert.ok(
  dbSource.includes("require('../repositories/clientes-repository')"),
  'camada de domínio instancia o repositório extraído'
);
assert.ok(fachadaDbSource.includes("require('./database/domain')"), 'db.js mantém a fachada pública');
[
  'buscarHistoricoCliente',
  'listarClientes',
  'buscarClientes',
  'obterPerfilCliente',
  'atualizarDadosCliente'
].forEach((metodo) => {
  assert.ok(
    dbSource.includes(`clientesRepository.${metodo}`),
    `camada de domínio preserva a exportação pública: ${metodo}`
  );
});

let estado = {
  ordens: [{
    numero: 'OS-0001',
    data: '2026-07-17T10:00:00.000Z',
    status: 'Em análise',
    cliente: {
      nome: 'Maria da Silva',
      cpf: '123.456.789-01',
      telefone: '(27) 98888-1111',
      email: 'maria@example.com'
    },
    aparelho: { marca: 'Samsung', modelo: 'Galaxy S23+' },
    diagnosticoTecnico: { valorEstimado: '250' }
  }],
  estoque: [{
    id: 'EST-001',
    status: 'Vendido',
    dataVenda: '2026-07-18T10:00:00.000Z',
    marca: 'Samsung',
    modelo: 'Galaxy S23 Ultra',
    valorVenda: '2450.50',
    compradorNome: 'Maria da Silva',
    compradorCpf: '12345678901',
    compradorTelefone: '(27) 98888-1111'
  }],
  compras: [{
    numero: 'CP-0001',
    data: '2026-07-16T10:00:00.000Z',
    vendedor: {
      nome: 'Maria da Silva',
      cpf: '12345678901',
      telefone: '(27) 98888-1111',
      email: 'maria@example.com'
    },
    aparelho: { marca: 'Apple', modelo: 'iPhone 13' },
    dadosCompra: { valor: '500' }
  }],
  desbloqueios: [{
    numero: 'DES-0001', criadoEm: '2026-07-19T10:00:00.000Z',
    cliente: { nome: 'Maria da Silva', cpf: '12345678901', telefone: '(27) 98888-1111', clienteId: 10000 },
    aparelho: { marca: 'Motorola', modelo: 'Moto G' }, tipoBloqueio: 'PIN'
  }]
};
let salvamentos = 0;
const repositorio = createClientesRepository({
  loadDB: () => estado,
  saveDB: (novoEstado) => {
    estado = novoEstado;
    salvamentos += 1;
  }
});

const clientes = repositorio.listarClientes();
assert.strictEqual(clientes.length, 1, 'agrega registros das três coleções');
const maria = clientes[0];
assert.strictEqual(maria.totalOS, 1);
assert.strictEqual(maria.totalVendas, 2450.5);
assert.strictEqual(maria.totalCompras, 500);
assert.strictEqual(maria.totalDesbloqueios, 1);
assert.strictEqual(maria.qtdInteracoes, 4);

assert.strictEqual(repositorio.buscarClientes('maria').length, 1, 'busca por nome');
assert.strictEqual(repositorio.buscarClientes('123.456').length, 1, 'busca por CPF formatado');
assert.strictEqual(repositorio.buscarHistoricoCliente('12345678901').length, 1, 'histórico por CPF');

const retorno = repositorio.atualizarDadosCliente(maria.chave, {
  telefone: '(27) 99999-0000'
});
assert.strictEqual(retorno.sucesso, true, 'atualização do agregado é aceita');
assert.strictEqual(retorno.registrosAtualizados, 4, 'propaga para todas as origens');
assert.strictEqual(salvamentos, 1, 'persiste uma única vez');
assert.strictEqual(estado.ordens[0].cliente.telefone, '(27) 99999-0000');
assert.strictEqual(estado.estoque[0].compradorTelefone, '(27) 99999-0000');
assert.strictEqual(estado.compras[0].vendedor.telefone, '(27) 99999-0000');
assert.strictEqual(estado.desbloqueios[0].cliente.telefone, '(27) 99999-0000');
assert.strictEqual(
  repositorio.obterPerfilCliente(maria.chave).telefone,
  '(27) 99999-0000',
  'perfil recalculado reflete a alteração'
);

console.log('OK: repositório de Clientes agrega, busca, consulta histórico e atualiza sem banco físico.');
