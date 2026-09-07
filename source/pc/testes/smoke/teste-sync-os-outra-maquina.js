const assert = require('assert');
const { DesktopSupabaseRuntime } = require('../../src/supabase/desktop-runtime');

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

(async () => {
  const atualizadaEm = '2026-08-30T16:57:40.433Z';
  const linhas = Array.from({ length: 1205 }, (_, indice) => ({
    id: `remote-${String(indice + 1).padStart(5, '0')}`,
    numero: `OS-${String(indice + 1).padStart(5, '0')}`,
    id_exportacao: `teste:${indice + 1}`,
    cliente_nome_snapshot: `Cliente ${indice + 1}`,
    aparelho: 'Aparelho de teste',
    marca: 'Marca',
    modelo: 'Modelo',
    status: 'Aguardando análise',
    prioridade: 'Normal',
    valor: 100,
    revision: 1,
    dados_extras: {},
    created_at: atualizadaEm,
    updated_at: atualizadaEm,
    deleted_at: null
  }));

  const estado = {
    ultimoPullEm: '1970-01-01T00:00:00.000Z',
    ultimaReconciliacaoOSCompletaEm: '',
    conflitos: [],
    mapeamentosOS: {}
  };
  const ordensLocais = new Map();
  const paginas = [];
  const stateStore = {
    obter: () => clonar(estado),
    alterar: (mutador) => mutador(estado),
    registrarMapeamentoOS: (numero, linha) => {
      estado.mapeamentosOS[numero] = {
        id: linha.id,
        revision: linha.revision,
        idExportacao: linha.id_exportacao,
        updatedAt: linha.updated_at
      };
    },
    confirmarExclusaoOSRemota: () => {}
  };
  const client = {
    from: () => {
      let desde = '';
      const query = {
        select: () => query,
        gte: (_campo, valor) => { desde = valor; return query; },
        order: () => query,
        range: async (inicio, fim) => {
          paginas.push([inicio, fim]);
          const elegiveis = desde ? linhas.filter((linha) => linha.updated_at >= desde) : linhas;
          return { data: elegiveis.slice(inicio, fim + 1), error: null };
        }
      };
      return query;
    }
  };

  const runtime = Object.create(DesktopSupabaseRuntime.prototype);
  runtime.client = client;
  runtime.stateStore = stateStore;
  runtime.db = {
    obterOSPorNumero: (numero) => ordensLocais.get(numero) || null,
    aplicarOSSupabase: (ordem) => ordensLocais.set(ordem.numero, ordem),
    removerOSSupabase: (numero) => ordensLocais.delete(numero)
  };
  runtime.fileService = {
    baixarArquivosOS: async () => {},
    catalogarOS: async () => {}
  };
  runtime.processadorOSRemota = null;

  const primeiroPull = await runtime._baixarMudancas();
  assert.strictEqual(primeiroPull, 1205, 'uma instalação limpa deve receber todas as OS em um único ciclo');
  assert.strictEqual(ordensLocais.size, 1205);
  assert.deepStrictEqual(paginas.slice(0, 3), [[0, 499], [500, 999], [1000, 1499]]);
  assert.strictEqual(estado.ultimoPullEm, atualizadaEm);

  const segundoPull = await runtime._baixarMudancas();
  assert.strictEqual(segundoPull, 0, 'a janela sobreposta deve ser idempotente');

  // Reproduz o defeito observado: o cursor/mapeamento existe, mas uma OS não
  // está no banco local restaurado em outro computador. O catálogo completo
  // precisa detectar e recuperar a lacuna sem duplicar as demais.
  ordensLocais.delete('OS-00042');
  const reparadas = await runtime._reconciliarCatalogoOSCompleto({ forcar: true });
  assert.strictEqual(reparadas, 1);
  assert(ordensLocais.has('OS-00042'));
  assert(estado.ultimaReconciliacaoOSCompletaEm);

  console.log('OK: sincronização paginada recupera 1.205 OS, empates de data e lacunas de outra máquina.');
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
