'use strict';

const assert = require('assert');
const {
  DesktopSupabaseRuntime,
  sincronizacaoOcupada
} = require('../../src/supabase/desktop-runtime');

(async () => {
  assert.equal(sincronizacaoOcupada({ code: '55000', message: 'sincronizacao_em_andamento' }), true);
  assert.equal(sincronizacaoOcupada(new Error('falha definitiva')), false);

  const item = {
    id: 'fila-cobranca-os-21', numero: 'OS-0021', operacao: 'update',
    status: 'pendente', tentativas: 35, dados: {}
  };
  const estado = { fila: [item], filaAssinaturas: [], conflitos: [], mapeamentosOS: {} };
  const runtime = Object.create(DesktopSupabaseRuntime.prototype);
  runtime.stateStore = {
    obter: () => estado,
    alterar: (mutador) => mutador(estado)
  };
  let chamadas = 0;
  runtime._enviarItem = async () => {
    chamadas += 1;
    if (chamadas < 3) {
      const erro = new Error('sincronizacao_em_andamento');
      erro.code = '55000';
      throw erro;
    }
    return { id: 'remote-os-21', revision: 8 };
  };

  const enviados = await runtime._processarFila();
  assert.equal(enviados, 1, 'a cobrança deve ser confirmada no mesmo ciclo após a trava curta');
  assert.equal(chamadas, 3, 'o retry curto deve ocorrer sem esperar o ciclo de três minutos');
  assert.equal(estado.fila.length, 0, 'o item confirmado deve sair da fila durável');

  const antigo = {
    id: 'fila-antiga', numero: 'OS-0021', operacao: 'update', status: 'pendente',
    dados: {
      remoteId: 'remote-os-21', revision: 6,
      dados: {
        dados_extras: {
          valor_total_servico: 270,
          lembretes_cobranca: [{ id: 'cob-1', data: '2026-09-30', valor: 0, status: 'pendente' }]
        }
      }
    }
  };
  estado.fila = [antigo];
  estado.deviceKey = 'desktop-teste';
  estado.mapeamentosOS['OS-0021'] = { id: 'remote-os-21', revision: 7 };
  runtime.db = {
    obterOSPorNumero: () => ({
      numero: 'OS-0021', valorTotalServico: 270, valorRestanteServico: 270,
      lembretesCobranca: [{
        id: 'cob-1', data: '2026-09-30', valor: 270, status: 'pendente',
        atualizadoEm: '2026-09-21T21:16:46.820Z'
      }]
    })
  };
  const curado = runtime._reconciliarItemPendenteComEstadoAtual(antigo);
  assert.equal(curado.dados.revision, 7, 'a fila deve acompanhar a revisão já baixada do celular');
  assert.equal(curado.dados.dados.dados_extras.lembretes_cobranca[0].valor, 270,
    'a fotografia antiga de R$ 0 não pode sobrescrever a cobrança atual do celular');
  assert.equal(estado.fila[0].dados.revision, 7, 'a cura precisa permanecer no arquivo da fila');

  console.log('OK: cobranças presas por sincronização concorrente são reenviadas e confirmadas no mesmo ciclo.');
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
