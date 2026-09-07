'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const raiz = path.join(__dirname, '..');

function limparModulo(caminho) {
  delete require.cache[require.resolve(caminho)];
  return require(caminho);
}

function criarCliente(respostas, chamadas) {
  function criarConsulta(indiceChamada) {
    const consulta = {
      eq(coluna, valor) {
        chamadas[indiceChamada].coluna = coluna;
        chamadas[indiceChamada].valor = valor;
        return consulta;
      },
      order(coluna, opcoes) {
        chamadas[indiceChamada].ordenacao = { coluna, opcoes };
        return consulta;
      },
      limit(valor) {
        chamadas[indiceChamada].limite = valor;
        return consulta;
      },
      async maybeSingle() {
        return respostas.shift() || { data: null, error: null };
      }
    };
    return consulta;
  }

  return {
    from(tabela) {
      return {
        select(campos) {
          chamadas.push({ tabela, campos });
          return criarConsulta(chamadas.length - 1);
        }
      };
    }
  };
}

async function executar() {
  let total = 0;
  async function teste(nome, fn) {
    await fn();
    total += 1;
    console.log('✓ ' + nome);
  }

  const caminhoOS = path.join(raiz, 'www/js/supabase/os-service.js');
  const caminhoGarantia = path.join(raiz, 'www/js/supabase/garantia-service.js');
  const caminhoEntrega = path.join(raiz, 'www/js/supabase/entrega-service.js');
  const caminhoCloudData = path.join(raiz, 'www/js/cloud-data.js');

  await teste('OS consulta a view leve com colunas explícitas e sem empresa_id livre', async () => {
    const chamadas = [];
    global.SupabaseClientApp = {
      obterCliente() {
        return criarCliente([{ data: {
          id: 'os-a', empresa_id: 'empresa-a', numero: 'OS-0003',
          cliente_nome_snapshot: 'Ana', cliente_telefone_snapshot: '11999999999',
          aparelho: 'Celular', marca: 'Marca', modelo: 'Modelo', imei: '123',
          defeito_relatado: 'Tela', observacoes: 'Obs', status: 'Em reparo',
          prioridade: 'Alta', tecnico_id: 'tec-a', valor: 150, forma_pagamento: 'Pix',
          garantia_dias: 90, data_abertura: '2026-07-17T10:00:00Z',
          data_prevista: null, hora_prevista: null, data_conclusao: null,
          revision: 2, created_at: '2026-07-17T10:00:00Z', updated_at: '2026-07-17T10:00:00Z',
          quantidade_arquivos: 2, disponibilidades_arquivos: ['local', 'completa_nuvem']
        }, error: null }], chamadas);
      }
    };
    const servico = limparModulo(caminhoOS);
    const dados = await servico.consultarPorNumero('3');
    assert.equal(chamadas[0].tabela, 'vw_ordens_servico_leve');
    assert.equal(chamadas[0].coluna, 'numero');
    assert.equal(chamadas[0].valor, '3');
    assert.equal(chamadas[0].campos.includes('*'), false);
    assert.equal(chamadas[0].campos.includes('senha_aparelho'), false);
    assert.equal(chamadas[0].campos.includes('imei'), false);
    assert.equal(dados.cliente.nome, 'Ana');
    assert.equal(dados.aparelho.defeitoRelatado, 'Tela');
    assert.equal(dados.disponibilidadesArquivos, 'local, completa_nuvem');
  });

  await teste('buscas repetidas da mesma OS compartilham uma única leitura leve', async () => {
    const chamadas = [];
    global.SupabaseClientApp = {
      obterCliente() {
        return criarCliente([{ data: {
          id: 'os-cache', empresa_id: 'empresa-a', numero: 'OS-0017',
          cliente_nome_snapshot: 'Ana', status: 'Em reparo', prioridade: 'Normal',
          revision: 1, created_at: '2026-07-17T10:00:00Z', updated_at: '2026-07-17T10:00:00Z'
        }, error: null }], chamadas);
      }
    };
    const servico = limparModulo(caminhoOS);
    const resultados = await Promise.all([
      servico.consultarPorNumero('OS-0017'),
      servico.consultarPorNumero('OS-0017')
    ]);
    assert.equal(chamadas.length, 1);
    assert.equal(resultados[0].numero, 'OS-0017');
    assert.equal(resultados[1].numero, 'OS-0017');
  });

  await teste('Realtime da OS compartilha um único canal entre telas e o encerra ao sair', async () => {
    const canais = [];
    let removidos = 0;
    global.SupabaseClientApp = {
      obterCliente() {
        return {
          channel(nome) {
            const canal = {
              nome,
              on(_tipo, _filtro, callback) { this.callback = callback; return this; },
              subscribe() { return this; }
            };
            canais.push(canal);
            return canal;
          },
          removeChannel() { removidos += 1; }
        };
      }
    };
    const servico = limparModulo(caminhoOS);
    const sairReparos = servico.assinar(function () {});
    const sairNotificacoes = servico.assinar(function () {});
    assert.equal(canais.length, 1);
    sairReparos();
    assert.equal(removidos, 0);
    sairNotificacoes();
    assert.equal(removidos, 1);
  });

  await teste('garantia e entrega usam suas views leves, sem carregar conteúdo de arquivos', async () => {
    const chamadas = [];
    const respostas = [
      { data: {
        id: 'gar-a', empresa_id: 'empresa-a', ordem_servico_id: 'os-a', numero_os_snapshot: 'OS-0004',
        cliente_nome_snapshot: 'Bia', aparelho_snapshot: 'Notebook', marca_snapshot: 'Marca',
        modelo_snapshot: 'Modelo', defeito_garantia: 'Bateria', status: 'ativa',
        data_abertura: '2026-07-17', garantia_dias: 30, data_limite: '2026-08-16',
        tecnico_id: 'tec-a', reparo_realizado: 'Troca', observacoes: null, revision: 1,
        created_at: '2026-07-17T10:00:00Z', updated_at: '2026-07-17T10:00:00Z',
        quantidade_arquivos: 1, arquivos_disponiveis: true
      }, error: null },
      { data: {
        id: 'ent-a', empresa_id: 'empresa-a', ordem_servico_id: 'os-a', numero_os_snapshot: 'OS-0004',
        cliente_nome_snapshot: 'Bia', retirado_por: 'Carlos', aparelho_snapshot: 'Notebook',
        marca_snapshot: 'Marca', modelo_snapshot: 'Modelo', reparo_realizado: 'Troca',
        status: 'concluida', entregue_em: '2026-07-17T12:00:00Z', garantia_dias: 30,
        data_limite_garantia: '2026-08-16', forma_entrega: 'Balcão', observacoes: null,
        revision: 1, created_at: '2026-07-17T12:00:00Z', updated_at: '2026-07-17T12:00:00Z',
        assinatura_disponivel: true, comprovante_disponivel: true, fotos_disponiveis: false,
        disponibilidades_arquivos: ['local']
      }, error: null }
    ];
    global.SupabaseClientApp = {
      obterCliente() {
        return criarCliente(respostas, chamadas);
      }
    };
    const garantia = limparModulo(caminhoGarantia);
    const entrega = limparModulo(caminhoEntrega);
    const dadosGarantia = await garantia.consultarPorNumero('OS-0004');
    const dadosEntrega = await entrega.consultarPorNumero('OS-0004');
    assert.equal(chamadas[0].tabela, 'vw_garantias_leve');
    assert.equal(chamadas[1].tabela, 'vw_entregas_leve');
    chamadas.forEach((chamada) => {
      assert.equal(chamada.campos.includes('*'), false);
      assert.equal(chamada.campos.includes('arquivo_nuvem_path'), false);
      assert.equal(chamada.campos.includes('storage_bucket'), false);
    });
    assert.equal(dadosGarantia.arquivosDisponiveis, true);
    assert.equal(dadosEntrega.assinaturaDisponivel, true);
    assert.equal(dadosEntrega.fotosDisponiveis, false);
  });

  await teste('CloudData usa Supabase só com feature flag recebida do servidor', async () => {
    global.ConfigApp = { carregarConfig() { return {}; } };
    global.SupabaseClientApp = { carregarConfiguracao() { return { ok: true, ativo: true }; } };
    global.SistemaOSPermissoes = { obterContexto() { return { feature_flags: { cloudProvider: 'supabase' } }; } };
    global.SistemaOSSupabaseOS = { async consultarPorNumero() { return { numero: 'OS-0005' }; } };
    const cloudData = limparModulo(caminhoCloudData);
    const resultado = await cloudData.consultarOS('OS-0005');
    assert.equal(resultado.origem, 'supabase');
    assert.equal(resultado.dados.numero, 'OS-0005');
  });

  await teste('CloudData informa ausência quando a view Supabase não encontra o registro', async () => {
    global.SupabaseClientApp = { carregarConfiguracao() { return { ok: true, ativo: true }; } };
    global.SistemaOSPermissoes = { obterContexto() { return { feature_flags: { cloudProvider: 'supabase' } }; } };
    global.SistemaOSSupabaseOS = { async consultarPorNumero() { return null; } };
    const cloudData = limparModulo(caminhoCloudData);
    const resultado = await cloudData.consultarOS('OS-0006');
    assert.equal(resultado.origem, 'supabase');
    assert.equal(resultado.encontrada, false);
    assert.equal(resultado.motivo, 'nao-encontrada');
  });

  await teste('a busca unificada consulta OS, garantia e entrega e libera acoes da OS direta', async () => {
    const html = fs.readFileSync(path.join(raiz, 'www/index.html'), 'utf8');
    const codigo = fs.readFileSync(path.join(raiz, 'www/js/consulta.js'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://app.local/' });
    const win = dom.window;
    let chamadas = 0;
    win.CloudData = {
      providerConsultas() { return 'supabase'; },
      async consultar(tipo, numero) {
        chamadas += 1;
        if (tipo === 'garantia') return {
          encontrada: true, origem: 'supabase', dados: {
            id: 'gar-7', numeroOS: numero, cliente: 'Ana', garantiaDias: 90, quantidadeArquivos: 1
          }
        };
        if (tipo === 'entrega') return {
          encontrada: true, origem: 'supabase', dados: {
            id: 'ent-7', numeroOS: numero, cliente: 'Ana', formaPagamento: 'Pix', quantidadeArquivos: 1
          }
        };
        return {
          encontrada: true,
          origem: 'supabase',
          dados: {
            id: 'os-7', revision: 2, numero: numero, status: 'Em reparo', cliente: { nome: 'Ana' },
            quantidadeArquivos: 2, disponibilidadesArquivos: 'local'
          }
        };
      },
      async anexarComprovanteTermicoAssinado() { return { id: 'termico-1' }; }
    };
    win.SistemaOSEntrega = { iniciarPorOS() {}, editar() {} };
    win.SistemaOSGarantiaUI = { abrir() {} };
    win.eval(codigo);
    win.document.getElementById('consulta-os-numero').value = 'OS-0007';
    win.document.getElementById('btn-consultar-os').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resultado = win.document.getElementById('consulta-os-resultado');
    assert.equal(chamadas, 3);
    assert.match(resultado.textContent, /Ana/);
    assert.match(resultado.textContent, /Quantidade de arquivos/);
    assert.ok(resultado.querySelector('.resultado-consulta-acoes'));
    assert.equal(win.document.querySelectorAll('#consulta-os-numero').length, 1);
    assert.ok(win.document.getElementById('consulta-garantia-resultado'));
    assert.ok(win.document.getElementById('consulta-entrega-resultado'));
    assert.match(win.document.getElementById('consulta-garantia-resultado').textContent, /90/);
    assert.match(win.document.getElementById('consulta-entrega-resultado').textContent, /Pix/);
    assert.ok(win.document.querySelector('.btn-emitir-comprovante-consulta'));
    assert.ok(win.document.querySelector('.anexo-comprovante-consulta'));
    assert.match(win.document.getElementById('consulta-entrega-resultado').textContent, /Editar entrega \/ assinatura/);
    assert.match(win.document.getElementById('consulta-garantia-resultado').textContent, /Editar garantia/);
    dom.window.close();
  });

  console.log('\n' + total + ' testes da Etapa 4 passaram.');
}

executar().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
