'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const raiz = path.join(__dirname, '..');
const caminhoServico = path.join(raiz, 'www/js/supabase/arquivo-service.js');
const caminhoSync = path.join(raiz, 'www/js/supabase/sync-service.js');
const caminhoOS = path.join(raiz, 'www/js/supabase/os-service.js');

function recarregar(caminho) {
  delete require.cache[require.resolve(caminho)];
  return require(caminho);
}

function linhaArquivo(extra) {
  return Object.assign({
    id: 'arq-1', entidade_tipo: 'ordem_servico', entidade_id: 'os-1',
    categoria: 'foto', nome_arquivo: 'foto-1.jpg', mime_type: 'image/jpeg',
    tamanho_bytes: 12345, largura: 1024, altura: 768,
    storage_bucket: 'arquivos-os', miniatura_path: 'empresa-a/os/os-1/foto-1-thumb.webp',
    arquivo_nuvem_path: 'empresa-a/os/os-1/foto-1.jpg', arquivo_local_id: null,
    disponibilidade: 'completa_nuvem', revision: 1,
    created_at: '2026-07-17T10:00:00Z', updated_at: '2026-07-17T10:00:00Z'
  }, extra || {});
}

function clienteLeitura(respostas, chamadas, storageChamadas) {
  return {
    from(tabela) {
      const chamada = { tabela, filtros: [] };
      chamadas.push(chamada);
      const builder = {
        select(campos) { chamada.campos = campos; return builder; },
        eq(coluna, valor) { chamada.filtros.push([coluna, valor]); return builder; },
        is(coluna, valor) { chamada.filtros.push([coluna, valor]); return builder; },
        async order(coluna, opcoes) { chamada.order = [coluna, opcoes]; return respostas.shift(); },
        async maybeSingle() { return respostas.shift(); }
      };
      return builder;
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(caminho, segundos) {
            storageChamadas.push({ tipo: 'signed', bucket, caminho, segundos });
            return { data: { signedUrl: 'https://signed.local/' + bucket + '/' + caminho }, error: null };
          }
        };
      }
    },
    async rpc(nome, parametros) {
      chamadas.push({ rpc: nome, parametros });
      return { data: { id: 'pedido-1', status: 'pendente' }, error: null };
    }
  };
}

async function executar() {
  let total = 0;
  const fonteArquivos = fs.readFileSync(caminhoServico, 'utf8');
  const fonteOS = fs.readFileSync(caminhoOS, 'utf8');
  assert.match(fonteArquivos, /listar_arquivos_exclusao_os/);
  assert.match(fonteArquivos, /removerArquivosOS/);
  assert.match(fonteOS, /SistemaOSSupabaseArquivo\.removerArquivosOS\(id\)/);
  async function teste(nome, fn) {
    await fn();
    total += 1;
    console.log('✓ ' + nome);
  }

  await teste('listar busca somente metadados explícitos e não toca Storage', async () => {
    const chamadas = [];
    const storageChamadas = [];
    global.SistemaOSPermissoes = { obterContexto() { return { empresa_id: 'empresa-a' }; } };
    global.SupabaseClientApp = {
      obterCliente() { return clienteLeitura([{ data: [linhaArquivo({ categoria: 'pdf', mime_type: 'application/pdf' })], error: null }], chamadas, storageChamadas); }
    };
    const servico = recarregar(caminhoServico);
    const lista = await servico.listarArquivos('ordem_servico', 'os-1');
    assert.equal(chamadas[0].tabela, 'arquivos');
    assert.equal(chamadas[0].campos.includes('*'), false);
    assert.equal(chamadas[0].campos.includes('base64'), false);
    assert.deepEqual(chamadas[0].filtros.slice(0, 2), [['entidade_tipo', 'ordem_servico'], ['entidade_id', 'os-1']]);
    assert.equal(storageChamadas.length, 0);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].mimeType, 'application/pdf');
  });

  await teste('consulta conserva o PDF oficial e o comprovante termico atuais sem misturar categorias', async () => {
    const chamadas = [];
    const storageChamadas = [];
    global.SistemaOSPermissoes = { obterContexto() { return { empresa_id: 'empresa-a' }; } };
    global.SupabaseClientApp = {
      obterCliente() {
        return clienteLeitura([{ data: [
          linhaArquivo({ id: 'pdf-antigo-2', categoria: 'pdf', nome_arquivo: 'OS-0003.pdf', mime_type: 'application/pdf', created_at: '2026-07-18T12:00:00Z', updated_at: '2026-07-18T12:00:00Z' }),
          linhaArquivo({ id: 'pdf-novo', categoria: 'pdf', nome_arquivo: 'OS-0003.pdf', mime_type: 'application/pdf', created_at: '2026-07-18T10:00:00Z', updated_at: '2026-07-18T13:00:00Z' }),
          linhaArquivo({ id: 'pdf-antigo-1', categoria: 'pdf', nome_arquivo: 'OS-0003.pdf', mime_type: 'application/pdf', created_at: '2026-07-18T11:00:00Z', updated_at: '2026-07-18T11:00:00Z' }),
          linhaArquivo({ id: 'termico-antigo', categoria: 'comprovante_termico_assinado', nome_arquivo: 'termico-antigo.pdf', mime_type: 'application/pdf', created_at: '2026-07-18T11:30:00Z', updated_at: '2026-07-18T11:30:00Z' }),
          linhaArquivo({ id: 'termico-novo', categoria: 'comprovante_termico_assinado', nome_arquivo: 'termico-novo.pdf', mime_type: 'application/pdf', created_at: '2026-07-18T14:00:00Z', updated_at: '2026-07-18T14:00:00Z' }),
          linhaArquivo({ id: 'foto-1', categoria: 'foto', nome_arquivo: 'foto.jpg', mime_type: 'image/jpeg' })
        ], error: null }], chamadas, storageChamadas);
      }
    };
    const servico = recarregar(caminhoServico);
    const lista = await servico.listarArquivos('ordem_servico', 'os-1');
    assert.deepEqual(lista.map((item) => item.id), ['termico-novo', 'pdf-novo']);
  });

  await teste('miniatura e original recebem URL assinada somente quando solicitados', async () => {
    const chamadas = [];
    const storageChamadas = [];
    global.SistemaOSPermissoes = { obterContexto() { return { empresa_id: 'empresa-a' }; } };
    global.SupabaseClientApp = {
      obterCliente() {
        return clienteLeitura([
          { data: linhaArquivo(), error: null },
          { data: linhaArquivo(), error: null }
        ], chamadas, storageChamadas);
      }
    };
    const servico = recarregar(caminhoServico);
    const mini = await servico.obterArquivo('arq-1', { miniatura: true });
    const original = await servico.obterArquivo('arq-1');
    assert.equal(mini.origem, 'supabase');
    assert.equal(original.origem, 'supabase');
    assert.deepEqual(storageChamadas.map((c) => c.bucket), ['miniaturas', 'arquivos-os']);
    assert.ok(storageChamadas.every((c) => c.segundos === 60));
  });

  await teste('arquivo apenas local informa PC offline e não inventa URL', async () => {
    const chamadas = [];
    const storageChamadas = [];
    const cliente = clienteLeitura([{ data: linhaArquivo({
      storage_bucket: null, miniatura_path: null, arquivo_nuvem_path: null,
      arquivo_local_id: 'pc:arquivo-1', disponibilidade: 'local'
    }), error: null }], chamadas, storageChamadas);
    cliente.rpc = async () => ({ data: null, error: { code: 'P0001', message: 'desktop_offline' } });
    global.SistemaOSPermissoes = { obterContexto() { return { empresa_id: 'empresa-a' }; } };
    global.SupabaseClientApp = { obterCliente() { return cliente; } };
    const servico = recarregar(caminhoServico);
    const resultado = await servico.obterArquivo('arq-1');
    assert.equal(resultado.disponivel, false);
    assert.equal(resultado.motivo, 'desktop-offline');
    assert.match(resultado.mensagem, /computador.*ligado/i);
  });

  await teste('fila de arquivos referencia o histórico sem duplicar Base64 na operação', async () => {
    const fila = [];
    global.SistemaOSPermissoes = { obterContexto() { return { empresa_id: 'empresa-a', usuario_id: 'usuario-a' }; } };
    global.SistemaOSHistorico = {
      async obterPorId() {
        return {
          id: 'hist-1', idExportacaoOriginal: 'exp-1', tipoDocumento: 'os',
          os: { fotos: [{ base64: 'data:image/jpeg;base64,QQ==' }], assinaturaClienteBase64: 'data:image/png;base64,QQ==' }
        };
      },
      async enfileirarOperacaoNuvem(item) { fila.push(item); return item; }
    };
    const servico = recarregar(caminhoServico);
    await servico.enfileirarArquivosOS('hist-1', { id: 'os-1', revision: 2, numero: 'OS-0001' });
    assert.equal(fila.length, 2);
    assert.equal(fila[0].entidade, 'arquivo');
    assert.equal(JSON.stringify(fila).includes('data:image'), false);
    assert.equal(fila[0].idExportacao, 'exp-1:foto:0:r2');
  });

  await teste('venda nao assinada ainda envia a assinatura da assistencia', async () => {
    const servico = recarregar(caminhoServico);
    const itens = servico._itensDoRegistro({
      tipoDocumento: 'venda',
      os: {
        naoAssinado: true,
        assinaturaCompradorBase64: '',
        assinaturaAssistenciaBase64: 'data:image/png;base64,QQ=='
      }
    });
    assert.deepEqual(itens.map((item) => item.categoria), ['assinatura_assistencia']);
  });

  await teste('modo nuvem envia original ao bucket privado e registra só metadados', async () => {
    const chamadas = [];
    const uploads = [];
    const base64 = 'data:image/jpeg;base64,QQ==';
    global.SistemaOSPermissoes = {
      obterContexto() {
        return { empresa_id: 'empresa-a', usuario_id: 'usuario-a', modo_armazenamento: 'nuvem', feature_flags: { fileProvider: 'supabase' } };
      }
    };
    global.SistemaOSHistorico = {
      async obterPorId() { return { os: { fotos: [{ base64 }] } }; }
    };
    global.SistemaOSSupabaseSync = { async obterDispositivoId() { return 'device-a'; } };
    global.SupabaseClientApp = {
      obterCliente() {
        return {
          storage: { from(bucket) { return { async upload(caminho, blob, opcoes) {
            uploads.push({ bucket, caminho, tipo: blob.type, opcoes });
            return { data: { path: caminho }, error: null };
          } }; } },
          async rpc(nome, parametros) {
            chamadas.push({ nome, parametros });
            return { data: linhaArquivo(), error: null };
          }
        };
      }
    };
    const servico = recarregar(caminhoServico);
    const resultado = await servico.processarOperacao({
      entidade: 'arquivo', entidadeId: 'os-1', idExportacao: 'exp-1:foto:0',
      registroLocalId: 'hist-1', dados: { itemChave: 'foto:0' }
    });
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].bucket, 'arquivos-os');
    assert.equal(chamadas[0].nome, 'registrar_arquivo');
    assert.equal(chamadas[0].parametros.p_dados.disponibilidade, 'completa_nuvem');
    assert.equal(JSON.stringify(chamadas[0].parametros.p_dados).includes('base64'), false);
    assert.equal(resultado.id, 'arq-1');
  });

  await teste('comprovante termico assinado usa categoria propria e nao substitui o PDF oficial', async () => {
    const uploads = [];
    const chamadas = [];
    global.SistemaOSPermissoes = {
      obterContexto() { return { empresa_id: 'empresa-a', usuario_id: 'usuario-a' }; }
    };
    global.SistemaOSSupabaseSync = { async obterDispositivoId() { return 'device-mobile'; } };
    global.SupabaseClientApp = {
      obterCliente() {
        return {
          storage: { from(bucket) { return {
            async upload(caminho, blob, opcoes) {
              uploads.push({ bucket, caminho, tipo: blob.type, opcoes });
              return { data: { path: caminho }, error: null };
            },
            async remove() { return { data: [], error: null }; }
          }; } },
          async rpc(nome, parametros) {
            chamadas.push({ nome, parametros });
            return { data: linhaArquivo({
              id: 'termico-1', categoria: 'comprovante_termico_assinado',
              nome_arquivo: 'comprovante.pdf', mime_type: 'application/pdf',
              storage_bucket: 'documentos-pdf', arquivo_nuvem_path: 'empresa-a/os/os-1/comprovante.pdf'
            }), error: null };
          }
        };
      }
    };
    const servico = recarregar(caminhoServico);
    const resultado = await servico.anexarComprovanteTermicoAssinado(
      'os-1', 'OS-0001', 'data:application/pdf;base64,JVBERi0xLjQ=', 'comprovante-assinado.pdf'
    );
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].bucket, 'documentos-pdf');
    assert.equal(chamadas[0].nome, 'registrar_arquivo');
    assert.equal(chamadas[0].parametros.p_dados.categoria, 'comprovante_termico_assinado');
    assert.match(chamadas[0].parametros.p_idempotency_key, /^celular:comprovante-termico:os-1:/);
    assert.equal(resultado.categoria, 'comprovante_termico_assinado');
  });

  await teste('sem Storage mantém o arquivo local pendente sem publicar URL', async () => {
    const chamadas = [];
    global.SistemaOSPermissoes = {
      obterContexto() {
        return { empresa_id: 'empresa-a', usuario_id: 'usuario-a', modo_armazenamento: 'economico', feature_flags: { fileProvider: 'supabase' } };
      }
    };
    global.SistemaOSHistorico = { async obterPorId() { return { os: { fotos: [{ base64: 'data:image/jpeg;base64,QQ==' }] } }; } };
    global.SistemaOSSupabaseSync = { async obterDispositivoId() { return 'device-a'; } };
    global.SupabaseClientApp = { obterCliente() { return { async rpc(nome, parametros) {
      chamadas.push({ nome, parametros });
      return { data: linhaArquivo({ disponibilidade: 'indisponivel' }), error: null };
    } }; } };
    const servico = recarregar(caminhoServico);
    await servico.processarOperacao({
      entidade: 'arquivo', entidadeId: 'os-1', idExportacao: 'exp-1:foto:0',
      registroLocalId: 'hist-1', dados: { itemChave: 'foto:0' }
    });
    assert.equal(chamadas[0].parametros.p_dados.disponibilidade, 'indisponivel');
  });

  await teste('retry conclui na mesma sincronização os arquivos criados ao confirmar uma OS', async () => {
    const ordem = [];
    const estados = new Map([['os:create:exp-1', {
      id: 'os:create:exp-1', entidade: 'ordem_servico', operacao: 'insert',
      idExportacao: 'exp-1', registroLocalId: 'hist-1', dados: { cliente_nome_snapshot: 'Ana' },
      status: 'pendente', empresaId: 'empresa-a', usuarioId: 'usuario-a', criadoEm: '2026-07-17T10:00:00Z'
    }]]);
    Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true });
    global.SistemaOSSessao = {
      obterEstado() { return { tipo: 'autenticado', contexto: { empresa_id: 'empresa-a', usuario_id: 'usuario-a' } }; },
      async revalidar() { ordem.push('validar'); return this.obterEstado(); }
    };
    global.SistemaOSPermissoes = { obterContexto() { return { empresa_id: 'empresa-a', usuario_id: 'usuario-a' }; } };
    global.SistemaOSSupabaseOS = {
      _dadosParaCriacao(dados) { return dados; },
      _patchParaServidor(dados) { return dados; },
      _classificarErro() { return 'servidor'; },
      async criar() { ordem.push('os'); return { id: 'os-1', numero: 'OS-0001', revision: 1 }; }
    };
    global.SistemaOSSupabaseArquivo = {
      async enfileirarArquivosDocumento() {
        ordem.push('enfileirar-arquivo');
        const item = {
          id: 'arquivo:os-1:foto:0', entidade: 'arquivo', operacao: 'insert',
          entidadeId: 'os-1', registroLocalId: 'hist-1', dados: { itemChave: 'foto:0' },
          status: 'pendente', empresaId: 'empresa-a', usuarioId: 'usuario-a', criadoEm: '2026-07-17T10:00:01Z'
        };
        estados.set(item.id, item);
        return [item];
      },
      async processarOperacao() { ordem.push('arquivo'); return { id: 'arq-1', revision: 1 }; },
      async aposConfirmarOperacao() { ordem.push('confirmar-arquivo'); }
    };
    global.SupabaseClientApp = { obterCliente() { return { async rpc() { return { data: { id: 'device-a' }, error: null }; } }; } };
    global.SistemaOSHistorico = {
      async enfileirarOperacaoNuvem(item) { estados.set(item.id, item); return item; },
      async listarOperacoesNuvemPendentes() {
        return Array.from(estados.values()).filter((item) => ['pendente', 'erro', 'enviando'].includes(item.status));
      },
      async atualizarOperacaoNuvem(id, patch) {
        estados.set(id, Object.assign({}, estados.get(id), patch));
        return estados.get(id);
      },
      async gravarEstadoSupabase() { ordem.push('confirmar-os'); }
    };
    const sync = recarregar(caminhoSync);
    const resultado = await sync.processarFila();
    assert.equal(resultado.enviados, 2);
    assert.equal(estados.get('os:create:exp-1').status, 'concluido');
    assert.equal(estados.get('arquivo:os-1:foto:0').status, 'concluido');
    assert.ok(ordem.indexOf('arquivo') > ordem.indexOf('enfileirar-arquivo'));
  });

  await teste('tela consulta não lista nem baixa arquivo antes do toque', async () => {
    const html = fs.readFileSync(path.join(raiz, 'www/index.html'), 'utf8');
    const codigo = fs.readFileSync(path.join(raiz, 'www/js/consulta.js'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://app.local/' });
    const win = dom.window;
    let listagens = 0;
    let aberturas = 0;
    win.CloudData = {
      providerConsultas() { return 'supabase'; },
      async consultar() {
        return { encontrada: true, origem: 'supabase', dados: {
          id: 'os-1', revision: 1, numero: 'OS-0001', status: 'Em reparo',
          cliente: { nome: 'Ana' }, quantidadeArquivos: 1
        } };
      },
      async listarArquivos() {
        listagens += 1;
        return [{ id: 'arq-1', nomeArquivo: 'foto.jpg', categoria: 'foto', temMiniatura: true, temArquivoNuvem: true }];
      },
      async obterArquivo() {
        aberturas += 1;
        return { disponivel: true, miniatura: true, url: 'https://signed.local/thumb.webp' };
      }
    };
    win.eval(codigo);
    win.document.getElementById('consulta-os-numero').value = '1';
    win.document.getElementById('btn-consultar-os').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(listagens, 0);
    assert.equal(aberturas, 0);
    assert.equal(win.document.querySelector('.arquivo-consulta-miniatura'), null);
    win.document.querySelector('.btn-listar-arquivos-consulta').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(listagens, 1);
    assert.equal(aberturas, 0);
    win.document.querySelector('.arquivo-consulta-acoes .btn-secundario').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(aberturas, 1);
    assert.ok(win.document.querySelector('.arquivo-consulta-miniatura'));
    dom.window.close();
  });

  await teste('migration cria RPCs seguras, modo econômico e heartbeat de 90 segundos', async () => {
    const candidatos = [
      path.join(raiz, '..', 'stage6-pc', 'supabase/migrations/20260717000700_arquivos_lazy_loading.sql'),
      path.join(raiz, '..', '..', 'sistema-os-atualizado(1)', 'supabase/migrations/20260717000700_arquivos_lazy_loading.sql')
    ];
    const caminhoMigration = candidatos.find((caminho) => fs.existsSync(caminho));
    assert.ok(caminhoMigration, 'migration da Etapa 6 não encontrada ao lado dos projetos');
    const sql = fs.readFileSync(caminhoMigration, 'utf8');
    assert.match(sql, /create or replace function public[.]registrar_arquivo/i);
    assert.match(sql, /app_private[.]current_user_empresa_id[(][)]/i);
    assert.match(sql, /conteudo binario/i);
    assert.match(sql, /modo economico/i);
    assert.match(sql, /now[(][)] - interval '90 seconds'/i);
    assert.match(sql, /desktop_offline/i);
    assert.match(sql, /force row level security/i);
    assert.doesNotMatch(sql, /service_role/i);
  });

  console.log('\n' + total + ' testes da Etapa 6 passaram.');
}

executar().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
