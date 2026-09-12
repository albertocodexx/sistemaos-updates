'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { indexedDB } = require('fake-indexeddb');

const raiz = path.resolve(__dirname, '..');
const ler = arquivo => fs.readFileSync(path.join(raiz, arquivo), 'utf8');
const tela = ler('www/index.html');
const fluxo = ler('www/js/documentos-recebidos.js');
const historico = ler('www/js/historico.js');
const migracao = fs.readFileSync(
  path.resolve(raiz, '..', 'sistemaos-pc', 'supabase', 'migrations', '20260905000100_reforcar_permissoes_assinatura_remota.sql'),
  'utf8'
);

assert.match(tela, /id="btn-assinar-doc"[^>]*>Assinar documento</);
assert.match(tela, /id="btn-nao-assinado-doc"[^>]*>Marcar como não assinado</);
assert.match(tela, /Enviar decisão para o PC/);
assert.match(fluxo, /statusLocal = 'nao_assinado'/);
assert.match(fluxo, /respostaAutomatica\.naoAssinado = registro\.statusLocal === 'nao_assinado'/);
assert.match(fluxo, /cancelar_solicitacao_assinatura_remota/);
assert.match(fluxo, /marcarDocumentoRecebidoExcluido\(registro, false\)[\s\S]*cancelarSolicitacaoNaNuvem\(registro\)/,
  'o bloqueio local durável deve ser gravado antes da tentativa de exclusão na nuvem');
assert.match(fluxo, /sincronizarExclusoesPendentes\(\)\.then\(buscarPeloSupabase\)/,
  'a exclusão pendente deve ser sincronizada antes de buscar novamente a fila');
assert.match(fluxo, /existente && existente\.statusLocal === 'excluido'/,
  'um documento com tombstone nunca deve ser reimportado');
assert.match(fluxo, /verificacaoAutomaticaEmAndamento/,
  'consultas simultâneas de documentos devem compartilhar a mesma execução');
assert.match(fluxo, /addEventListener\('online', verificarDocsParaCelularAutomatico\)/,
  'fila de documentos deve voltar a sincronizar quando a internet retornar');
assert.match(fluxo, /appStateChange[\s\S]*estado\.isActive/,
  'documentos enviados pelo PC devem ser buscados ao voltar ao aplicativo');
assert.match(historico, /statusLocal: 'excluido'/);
assert.match(historico, /exclusaoNuvemConfirmada/);
assert.match(migracao, /status = 'cancelada'/);
assert.match(migracao, /pacote = jsonb_build_object/);

function criarAppReiniciado() {
  const dom = new JSDOM('<!doctype html>', { url: 'https://app.local', runScripts: 'outside-only' });
  Object.defineProperty(dom.window, 'indexedDB', { value: indexedDB });
  dom.window.eval(historico);
  dom.window.SistemaOSHistorico.definirEmpresa('empresa-qa');
  return dom;
}

(async () => {
  const primeiroApp = criarAppReiniciado();
  const registro = {
    id: 'doc-exclusao-reinicio',
    recebidoEm: '2026-09-07T10:00:00.000Z',
    tipoDocumento: 'entrega',
    idEnvioAssinatura: 'envio-exclusao-reinicio',
    identificador: { numeroOS: 'OS-0020' },
    _origemSupabase: true,
    statusLocal: 'pendente',
    dados: {
      cliente: { nome: 'Cliente deve ser removido' },
      assinaturaRetirouBase64: 'data:image/png;base64,SEGREDO'
    }
  };
  await primeiroApp.window.SistemaOSHistorico.salvarDocumentoRecebido(registro);
  await primeiroApp.window.SistemaOSHistorico.marcarDocumentoRecebidoExcluido(registro, false);
  assert.deepEqual(await primeiroApp.window.SistemaOSHistorico.listarDocumentosRecebidos(), [],
    'a lista normal deve esconder o documento logo após excluir');
  primeiroApp.window.close();

  // Simula encerrar e abrir novamente o APK usando a mesma IndexedDB.
  const segundoApp = criarAppReiniciado();
  assert.deepEqual(await segundoApp.window.SistemaOSHistorico.listarDocumentosRecebidos(), [],
    'o documento excluído não pode reaparecer depois de reiniciar o app');
  const tombstone = await segundoApp.window.SistemaOSHistorico.obterDocumentoRecebidoPorIdEnvio('envio-exclusao-reinicio');
  assert.equal(tombstone.statusLocal, 'excluido');
  assert.equal(tombstone.dados, undefined, 'dados pessoais e assinatura devem ser apagados do tombstone');
  assert.equal((await segundoApp.window.SistemaOSHistorico.listarDocumentosRecebidosExcluidos()).length, 1,
    'a exclusão offline deve permanecer na fila de sincronização');
  await segundoApp.window.SistemaOSHistorico.confirmarExclusaoDocumentoRecebido(tombstone.id);
  assert.deepEqual(await segundoApp.window.SistemaOSHistorico.listarDocumentosRecebidosExcluidos(), [],
    'após confirmação da nuvem não deve restar retry pendente');
  segundoApp.window.close();

  console.log('OK — excluir no celular permanece após fechar/abrir e sincroniza com a nuvem.');
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
