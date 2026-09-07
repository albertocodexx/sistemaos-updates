const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'www', 'index.html'), 'utf8');
const reparos = fs.readFileSync(path.join(raiz, 'www', 'js', 'prazos.js'), 'utf8');
const servicoOS = fs.readFileSync(path.join(raiz, 'www', 'js', 'supabase', 'os-service.js'), 'utf8');
const consulta = fs.readFileSync(path.join(raiz, 'www', 'js', 'consulta.js'), 'utf8');
const catalogo = fs.readFileSync(path.join(raiz, 'www', 'js', 'catalogo-aparelhos.js'), 'utf8');
const migrationRealtime = fs.readFileSync(path.join(raiz, '..', 'pc', 'supabase', 'migrations', '20260719000700_reparos_realtime.sql'), 'utf8');
const pacote = require(path.join(raiz, 'package.json'));
const NumeroOS = require(path.join(raiz, 'www', 'js', 'numero-os.js'));

assert.equal(NumeroOS.formatar('OS-0019'), 'OS-0019');
assert.equal(NumeroOS.formatar('OS OS-0019'), 'OS-0019');
assert.equal(NumeroOS.formatar('OS-OS-0019'), 'OS-0019');
assert.equal(NumeroOS.formatar('OS nº OS-0019'), 'OS-0019');
assert.ok(html.includes('<script src="js/numero-os.js"></script>'), 'formatador central de OS deve carregar antes das telas');

assert.ok(html.includes('<span>Reparos</span>'), 'aba deve se chamar Reparos');
assert.ok(html.includes('id="os-sem-prazo"'), 'formulario do celular deve permitir criar OS sem prazo');
assert.ok(servicoOS.includes('sem_prazo: semPrazo') && servicoOS.includes('data_prevista: semPrazo ? null'),
  'estado Sem prazo deve seguir ao Supabase sem datas invalidas');
assert.ok(consulta.includes("dadosPlanos.semPrazo = 'Sem prazo'"), 'busca do celular deve exibir Sem prazo');
assert.ok(catalogo.includes('Moto G9 Play'), 'catalogo ampliado deve incluir Moto G9 Play');
assert.ok(html.includes('Acompanhamento de reparos'), 'painel deve apresentar o acompanhamento de reparos');
assert.ok(reparos.includes('<strong>Aparelho:</strong>') && reparos.includes('<strong>Defeito:</strong>') && reparos.includes('<strong>Reparo:</strong>'),
  'card deve mostrar aparelho, defeito e etapa do reparo');
assert.ok(pacote.dependencies['@capacitor/local-notifications'], 'plugin nativo de notificacoes deve estar instalado');
assert.ok(servicoOS.includes("table: 'ordens_servico'") && servicoOS.includes('postgres_changes'), 'Reparos deve receber alteracoes do PC por Realtime');
assert.ok(reparos.includes('SistemaOSSupabaseOS.assinar') && reparos.includes('setInterval') && reparos.includes('30000'),
  'Reparos deve combinar Realtime com atualizacao automatica de seguranca');
assert.ok(reparos.includes('sistema-os:tela-prazos-fechada'), 'assinatura deve ser encerrada ao sair da aba');
assert.ok(migrationRealtime.includes('alter publication supabase_realtime add table public.ordens_servico'),
  'tabela de OS deve estar habilitada na publicacao Realtime');

let agendada = null;
global.window = {
  Capacitor: {
    Plugins: {
      LocalNotifications: {
        requestPermissions: async () => ({ display: 'granted' }),
        schedule: async (dados) => { agendada = dados.notifications[0]; },
        cancel: async () => {}
      }
    }
  }
};
global.window.SistemaOSNumero = NumeroOS;

const Notificacoes = require(path.join(raiz, 'www', 'js', 'notificacoes.js'));

(async () => {
  const amanha = new Date(Date.now() + 26 * 60 * 60 * 1000);
  const data = [amanha.getFullYear(), String(amanha.getMonth() + 1).padStart(2, '0'), String(amanha.getDate()).padStart(2, '0')].join('-');
  const hora = String(amanha.getHours()).padStart(2, '0') + ':' + String(amanha.getMinutes()).padStart(2, '0');
  const resultado = await Notificacoes.agendarAvisoReparo({
    numero: 'OS-0099', aparelho: 'Samsung Galaxy S23', defeito: 'Tela quebrada',
    clienteNome: 'Ana', status: 'Em reparo', dataPrevista: data, horaPrevista: hora
  });
  assert.equal(resultado.agendada, true);
  assert.ok(agendada.title.includes('OS-0099') && agendada.title.includes('perto do prazo'));
  assert.ok(agendada.body.includes('Samsung Galaxy S23') && agendada.body.includes('Tela quebrada'));
  assert.ok(/aviso: \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/.test(agendada.body),
    'aviso de reparo deve manter data e hora visiveis');
  assert.ok(agendada.schedule && agendada.schedule.at instanceof Date);
  const autorizada = await Notificacoes.notificarOSAutorizada({
    numero: 'OS-0100', aparelho: { marca: 'Apple', modelo: 'iPhone 15' }
  });
  assert.equal(autorizada.agendada, true);
  assert.ok(agendada.title.includes('OS-0100') && agendada.title.includes('autorizada'));
  assert.equal(agendada.title, 'OS-0100 autorizada', 'titulo nao deve repetir o prefixo OS');
  assert.ok(agendada.body.includes('Apple iPhone 15'));
  assert.ok(/\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/.test(agendada.body),
    'notificacao de autorizacao deve mostrar data e hora');
  const idCanonico = agendada.id;
  await Notificacoes.notificarOSAutorizada({
    numero: 'OS OS-0100', aparelho: { marca: 'Apple', modelo: 'iPhone 15' }
  });
  assert.equal(agendada.title, 'OS-0100 autorizada', 'dado antigo nao deve produzir OS OS-0100');
  assert.equal(agendada.id, idCanonico, 'variacoes do mesmo numero devem substituir a notificacao, sem duplicar');
  assert.equal(Notificacoes.osEstaAutorizada({ status: 'Em reparo', statusPagamento: 'Aguardando Pagamento na Retirada' }), true);
  assert.equal(Notificacoes.assinaturaPagamentoRecebido({ statusPagamento: 'Aguardando Pagamento' }), '',
    'cobranca pendente nao pode ser anunciada como recebida');
  assert.ok(Notificacoes.assinaturaPagamentoRecebido({ statusPagamento: 'Autorizado' }).startsWith('100|'),
    'OS antiga paga deve continuar reconhecida');
  const pagamento = await Notificacoes.notificarPagamentoRecebido({
    numero: 'OS OS-0101', valorTotalServico: 200, percentualPagamentoConfirmado: 50,
    formaPagamento: 'Pix', cliente: { nome: 'Ana' }
  });
  assert.equal(pagamento.agendada, true);
  assert.equal(agendada.title, 'Pagamento recebido — OS-0101');
  assert.ok(agendada.body.includes('R$ 100,00') || agendada.body.includes('R$ 100,00'));
  assert.ok(agendada.body.includes('50% confirmado') && agendada.body.includes('Pix') && agendada.body.includes('Ana'));
  assert.ok(/\d{2}\/\d{2}\/\d{4}[^\d]+\d{2}:\d{2}/.test(agendada.body),
    'notificacao de pagamento deve mostrar data e hora');
  console.log('OK: aba Reparos e notificacoes nativas de prazo/autorizacao validadas.');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
