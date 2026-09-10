'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LIMITE_PADRAO_MINUTO = 30;
const LIMITE_PADRAO_MES = 5000;
const JANELA_MINUTO_MS = 60_000;
const TAMANHO_MAXIMO_ESTADO = 256 * 1024;

let estadoEmMemoria = null;

function inteiroSeguro(valor, padrao, minimo, maximo) {
  const numero = Number.parseInt(String(valor ?? ''), 10);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, numero));
}

function caminhoEstado() {
  if (process.env.SISTEMAOS_IA_RATE_LIMIT_FILE) {
    return path.resolve(process.env.SISTEMAOS_IA_RATE_LIMIT_FILE);
  }
  try {
    const { app } = require('electron');
    if (app?.isReady?.()) return path.join(app.getPath('userData'), 'ia-rate-limit.json');
  } catch (_) { /* testes Node usam somente memória */ }
  return '';
}

function carregarEstado() {
  if (estadoEmMemoria) return estadoEmMemoria;
  estadoEmMemoria = { versao: 1, escopos: {} };
  const arquivo = caminhoEstado();
  if (!arquivo || !fs.existsSync(arquivo)) return estadoEmMemoria;
  try {
    const stat = fs.statSync(arquivo);
    if (!stat.isFile() || stat.size > TAMANHO_MAXIMO_ESTADO) return estadoEmMemoria;
    const lido = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (lido?.versao === 1 && lido.escopos && typeof lido.escopos === 'object') estadoEmMemoria = lido;
  } catch (_) {
    // Um contador local danificado não pode derrubar o assistente. O arquivo
    // será refeito atomicamente na próxima requisição.
  }
  return estadoEmMemoria;
}

function salvarEstado(estado) {
  const arquivo = caminhoEstado();
  if (!arquivo) return;
  const temporario = `${arquivo}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(temporario, JSON.stringify(estado), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporario, arquivo);
  } catch (_) {
    try { if (fs.existsSync(temporario)) fs.unlinkSync(temporario); } catch {}
  }
}

function chaveEscopo(provedor, chave) {
  // A credencial nunca é persistida; só um hash não reversível identifica a
  // empresa/conta do provedor. Empresas com chaves diferentes têm cotas
  // independentes, mesmo quando usam o mesmo computador.
  return crypto.createHash('sha256')
    .update(`${String(provedor || 'ia').toLowerCase()}\0${String(chave || '')}`)
    .digest('hex');
}

function erroLimite(mensagem, tipo) {
  const erro = new Error(mensagem);
  erro.code = 'IA_RATE_LIMIT';
  erro.tipoLimite = tipo;
  return erro;
}

function consumirLimiteIA({ provedor, chave, limiteMinuto, limiteMes, agora = Date.now() } = {}) {
  if (!String(chave || '').trim()) throw new Error('A chave da IA não foi informada.');
  const maxMinuto = inteiroSeguro(limiteMinuto ?? process.env.SISTEMAOS_IA_LIMITE_MINUTO,
    LIMITE_PADRAO_MINUTO, 1, 300);
  const maxMes = inteiroSeguro(limiteMes ?? process.env.SISTEMAOS_IA_LIMITE_MES,
    LIMITE_PADRAO_MES, 1, 100_000);
  const instante = Number.isFinite(Number(agora)) ? Number(agora) : Date.now();
  const mes = new Date(instante).toISOString().slice(0, 7);
  const escopo = chaveEscopo(provedor, chave);
  const estado = carregarEstado();
  const atual = estado.escopos[escopo] || { mes, totalMes: 0, inicioMinuto: instante, totalMinuto: 0 };

  if (atual.mes !== mes) {
    atual.mes = mes;
    atual.totalMes = 0;
  }
  if (!Number.isFinite(atual.inicioMinuto) || instante - atual.inicioMinuto >= JANELA_MINUTO_MS || instante < atual.inicioMinuto) {
    atual.inicioMinuto = instante;
    atual.totalMinuto = 0;
  }
  if ((Number(atual.totalMinuto) || 0) >= maxMinuto) {
    const segundos = Math.max(1, Math.ceil((JANELA_MINUTO_MS - (instante - atual.inicioMinuto)) / 1000));
    throw erroLimite(`Limite de IA por minuto atingido. Aguarde ${segundos}s e tente novamente.`, 'minuto');
  }
  if ((Number(atual.totalMes) || 0) >= maxMes) {
    throw erroLimite('Limite mensal de IA atingido para esta empresa.', 'mes');
  }

  atual.totalMinuto = (Number(atual.totalMinuto) || 0) + 1;
  atual.totalMes = (Number(atual.totalMes) || 0) + 1;
  estado.escopos[escopo] = atual;
  salvarEstado(estado);
  return { restanteMinuto: maxMinuto - atual.totalMinuto, restanteMes: maxMes - atual.totalMes };
}

function _resetarParaTestes() {
  estadoEmMemoria = null;
}

module.exports = { consumirLimiteIA, _resetarParaTestes, LIMITE_PADRAO_MINUTO, LIMITE_PADRAO_MES };
