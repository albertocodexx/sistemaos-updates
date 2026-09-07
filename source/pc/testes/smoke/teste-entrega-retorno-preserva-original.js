'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-entrega-ciclo-qa-'));
const electron = require.resolve('electron');
Module._cache[electron] = new Module(electron);
Module._cache[electron].exports = { app: { getPath: () => temp } };
const db = require('../../src/db');

try {
  const ordem = db.criarOS({
    cliente: { nome: 'Cliente Retorno', telefone: '27999999999' },
    aparelho: { marca: 'Teste', modelo: 'Ciclo', defeitoRelatado: 'Tela' },
    valorTotalServico: 300
  });
  const original = db.criarOuSubstituirEntrega({
    numeroOS: ordem.numero,
    nomeRetirou: 'Cliente Retorno',
    marca: 'Teste', modelo: 'Ciclo', reparoRealizado: 'Troca da tela',
    valorReparo: 300, formaPagamento: 'Pix', garantiaDias: 90,
    dataHoraAssinatura: '2026-08-01T12:00:00Z', garantiaDataInicio: '2026-08-01T12:00:00Z',
    assinaturaRetirouBase64: 'assinatura-original', assinaturaPendente: false, naoAssinado: false
  }).entrega;
  db.atualizarCaminhoPdfEntrega(ordem.numero, path.join(temp, 'original.pdf'), 'original');
  const retorno = db.registrarRetornoGarantia(ordem.numero, { motivo: 'Vidro descolando do LCD' }, 'QA').retorno;
  assert.equal(db.obterOSPorNumero(ordem.numero).status, 'Aguardando análise');

  const editado = db.atualizarStatusRetornoGarantia(ordem.numero, retorno.id, {
    status: 'Em reparo', motivo: 'Vidro descolando após o reparo', observacao: 'Descrição conferida na bancada.'
  }, 'QA');
  assert.equal(editado.retorno.motivo, 'Vidro descolando após o reparo');
  assert.equal(db.obterOSPorNumero(ordem.numero).status, 'Em reparo');

  const pronta = db.atualizarStatusRetornoGarantia(ordem.numero, retorno.id, {
    status: 'Pronto para retirada', observacao: 'Recolagem concluída e testada.'
  }, 'QA');
  assert.ok(pronta.entregaPendente, 'deve criar uma nova solicitação de assinatura');
  assert.equal(pronta.entregaPendente.cicloEntregaId, retorno.id);
  assert.equal(pronta.entregaPendente.garantiaDias, 90, 'retorno deve herdar o prazo da garantia original');
  assert.equal(pronta.entregaPendente.dataLimiteGarantia.slice(0, 10), '2026-10-30', 'retorno não pode reiniciar o prazo');
  assert.equal(pronta.entrega, null, 'preparar a retirada não pode criar uma entrega concluída');
  assert.equal(db.obterOSPorNumero(ordem.numero).status, 'Pronto para retirada');

  const documentosAntes = db.listarEntregasPorNumeroOS(ordem.numero);
  assert.equal(documentosAntes.length, 1, 'antes da retirada deve existir somente o comprovante original');
  const originalIntacto = db.obterEntregaPorNumeroOS(ordem.numero, 'original');
  assert.equal(originalIntacto.assinaturaRetirouBase64, 'assinatura-original');
  assert.equal(originalIntacto.pdfPath, path.join(temp, 'original.pdf'));
  assert.throws(() => db.atualizarStatusRetornoGarantia(ordem.numero, retorno.id, { status: 'Entregue' }, 'QA'), /Conclua a nova entrega/);

  const resposta = db.importarRespostaAssinaturaEntrega({
    tipoArquivo: 'sistema-os-pc-para-assinar-resposta',
    tipoDocumento: 'entrega',
    idEnvioAssinatura: pronta.entregaPendente.idEnvioAssinatura,
    assinaturaRetirouBase64: 'assinatura-retorno',
    naoAssinado: false
  });
  assert.equal(resposta.sucesso, true);
  assert.equal(db.listarEntregasPorNumeroOS(ordem.numero).length, 2);
  assert.equal(db.obterEntregaPorNumeroOS(ordem.numero, retorno.id).assinaturaRetirouBase64, 'assinatura-retorno');
  assert.equal(db.obterEntregaPorNumeroOS(ordem.numero, 'original').assinaturaRetirouBase64, 'assinatura-original');
  assert.equal(db.obterGarantiaPorNumeroOS(ordem.numero).retornosGarantia[0].status, 'Entregue');
  assert.equal(db.obterOSPorNumero(ordem.numero).status, 'Entregue');
  assert.equal(db.listarEntregasPendentes().length, 0);

  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260829000100_entregas_por_ciclo_garantia.sql'), 'utf8');
  assert.match(migration, /ciclo_entrega_id/);
  assert.match(migration, /preparar_entrega_retorno_garantia/);
  assert.match(migration, /new\.retorno_garantia_id is not null/);
  assert.match(migration, /new\.status='concluida'/);
  console.log('OK — a entrega original é preservada e cada retorno possui novo documento e assinatura.');
} finally {
  if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('sistemaos-entrega-ciclo-qa-')) {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
