// Teste ad-hoc: excluirLogMensagem (excluir mensagem do WhatsApp) e
// atualizarDadosCliente (editar cliente na aba Clientes — já existia no
// db.js, aqui só confirmamos que a integração via handler funciona).
// Roda db.js real contra um diretório de dados temporário e isolado.
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

let falhas = 0;
function assert(cond, msg) {
  if (!cond) { falhas++; console.error('❌ FALHOU:', msg); }
  else console.log('✅', msg);
}

function instalarMock(nomeModulo, exportsMock) {
  const caminhoResolvido = require.resolve(nomeModulo, { paths: [path.join(__dirname, '..')] });
  Module._cache[caminhoResolvido] = new Module(caminhoResolvido);
  Module._cache[caminhoResolvido].exports = exportsMock;
}

const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-cliente-msg-'));
instalarMock('electron', {
  app: { getPath: () => dirTemp },
});

delete require.cache[require.resolve('../src/db')];
const db = require('../src/db');

function testeExcluirMensagem() {
  const m1 = db.registrarLogMensagem({ tipo: 'manual', telefone: '11999990000', clienteNome: 'Fulano', mensagem: 'oi', sucesso: true });
  const m2 = db.registrarLogMensagem({ tipo: 'manual', telefone: '11999990000', clienteNome: 'Fulano', mensagem: 'tudo bem?', sucesso: true });

  const antes = db.listarLogMensagens();
  assert(antes.length === 2, 'as 2 mensagens foram registradas');

  const r1 = db.excluirLogMensagem(m1.id);
  assert(r1.sucesso === true, 'excluiu a primeira mensagem com sucesso');

  const depois = db.listarLogMensagens();
  assert(depois.length === 1, 'sobrou só 1 mensagem no histórico');
  assert(depois[0].id === m2.id, 'a mensagem que sobrou é a correta (m2)');

  const r2 = db.excluirLogMensagem('id-que-nao-existe');
  assert(r2.sucesso === false, 'excluir um id inexistente retorna sucesso:false');

  const r3 = db.excluirLogMensagem();
  assert(r3.sucesso === false, 'excluir sem id retorna erro claro, não lança exceção');
}

function testeEditarCliente() {
  const osCriada = db.criarOS({
    cliente: { nome: 'Maria Teste', telefone: '11988887777', cpf: '', email: '' },
    aparelho: { marca: 'Samsung', modelo: 'A10', defeitoRelatado: 'Tela quebrada' }
  });
  const perfil = db.listarClientes().find(c => c.nome === 'Maria Teste');
  assert(!!perfil, 'cliente "Maria Teste" aparece na listagem agregada');

  const r = db.atualizarDadosCliente(perfil.chave, { telefone: '11900001111', cpf: '123.456.789-00' });
  assert(r.sucesso === true, 'atualizarDadosCliente retornou sucesso');
  assert(r.registrosAtualizados === 1, 'atualizou exatamente 1 registro de origem (a OS)');

  const osAtualizada = db.obterOSPorNumero(osCriada.numero);
  assert(osAtualizada.cliente.telefone === '11900001111', 'telefone da OS foi atualizado');
  assert(osAtualizada.cliente.cpf === '123.456.789-00', 'CPF da OS foi atualizado');
  assert(osAtualizada.cliente.nome === 'Maria Teste', 'nome não informado na edição permaneceu intacto');
}

(async () => {
  testeExcluirMensagem();
  console.log('');
  testeEditarCliente();

  console.log('');
  if (falhas > 0) {
    console.error(`❌ ${falhas} falha(s).`);
    process.exit(1);
  } else {
    console.log('✅ Todos os testes passaram (0 falhas).');
  }
})();
