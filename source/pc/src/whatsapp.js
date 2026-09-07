// ══════════════════════════════════════════════════════════════════════════════
// src/whatsapp.js — Integração WhatsApp via @whiskeysockets/baileys
// v1.2 — corrige erro ESM: usa dynamic import() em vez de require()
//
// COMO USAR NO main.js:
//   const whatsapp = require('./src/whatsapp');
//   whatsapp.init(mainWindow);
// ══════════════════════════════════════════════════════════════════════════════

'use strict';

const { app } = require('electron');
const path = require('path');
const fs   = require('fs');

// CVE-2026-48063 foi corrigido no Baileys 6.7.22 e 7.0.0-rc12.
// O Sistema OS permanece na linha 6.7.x estavel e recusa iniciar o canal QR
// caso uma instalacao incompleta ou adulterada reintroduza uma versao antiga.
const BAILEYS_MINIMO_SEGURO = [6, 7, 22];

function _compararVersoesBaileys(atual, minimo) {
  const partes = String(atual || '').split(/[.-]/).slice(0, 3).map((parte) => Number(parte) || 0);
  for (let indice = 0; indice < minimo.length; indice += 1) {
    if ((partes[indice] || 0) > minimo[indice]) return 1;
    if ((partes[indice] || 0) < minimo[indice]) return -1;
  }
  return 0;
}

function _validarVersaoSeguraBaileys() {
  const versao = String(require('@whiskeysockets/baileys/package.json').version || '0.0.0');
  if (_compararVersoesBaileys(versao, BAILEYS_MINIMO_SEGURO) < 0) {
    throw new Error('WhatsApp por QR bloqueado: atualize o Sistema OS para corrigir a seguranca do Baileys.');
  }
  return versao;
}

// ─── Módulo de mensagens automáticas ─────────────────────────────────────────
const mensagens = require('./mensagens-whatsapp');

// ─── Banco de dados para log de mensagens ────────────────────────────────────
const db = require('./db');

// ─── v40.2: Classificação por IA (Groq) da forma de pagamento manual ────────
// Ver src/ia-groq.js — sempre tem fallback automático para o classificador
// por regras (_classificarFormaPagamentoManual, definido mais abaixo neste
// arquivo), nunca deixa o cliente sem resposta mesmo se a IA falhar.
const iaGroq = require('./ia-groq');

// ─── Variáveis de estado ──────────────────────────────────────────────────────
let sock            = null;
let mainWindow      = null;
let reconnecting    = false;
let ipcRegistered   = false;
let initialized     = false;
let connectionStatus = 'desconectado';
let geradorPreferenciaMercadoPago = null;
let roteadorApiOficial = null;
let watchdogConexao = null;
let desconexaoSolicitada = false;

function definirGeradorPreferenciaMercadoPago(gerador) {
  geradorPreferenciaMercadoPago = typeof gerador === 'function' ? gerador : null;
}

function definirRoteadorApiOficial(roteador) {
  roteadorApiOficial = typeof roteador === 'function' ? roteador : null;
}

async function enviarMensagemRoteada(tel, msg, codigoPais = '55') {
  if (roteadorApiOficial) {
    try {
      const decisao = await roteadorApiOficial({
        telefone: String(tel || ''), mensagem: String(msg || ''), codigoPais,
        baileysConectado: estaConectado()
      });
      if (decisao?.usarApi) return decisao.resultado || { sucesso: false, canal: 'api', erro: 'Envio automático indisponível.' };
    } catch (erro) {
      console.warn('[WhatsApp] Não foi possível escolher o canal automático:', erro.message);
    }
  }
  const resultado = await enviarMensagem(tel, msg, codigoPais);
  return { ...resultado, canal: 'baileys' };
}

// O Checkout Pro só deve receber um e-mail quando ele realmente foi
// cadastrado na OS. Sem e-mail, o campo é omitido e o próprio Mercado Pago o
// solicita ao comprador durante o pagamento. Nunca usamos endereço fictício.
function _dadosPagadorMercadoPago(os) {
  const cliente = os?.cliente || {};
  const nome = String(cliente.nome || '').trim().slice(0, 120);
  const emailBruto = String(cliente.email || '').trim().toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailBruto) ? emailBruto.slice(0, 254) : '';
  let telefone = String(cliente.telefone || '').replace(/\D/g, '');
  if ((telefone.length === 12 || telefone.length === 13) && telefone.startsWith('55')) telefone = telefone.slice(2);
  const pagador = {};
  if (nome) pagador.name = nome;
  if (email) pagador.email = email;
  if (telefone.length >= 10) {
    pagador.phone = { area_code: telefone.slice(0, 2), number: telefone.slice(2) };
  }
  return pagador;
}

// sendMessage() só confirma que o Baileys colocou a mensagem na fila local.
// A confirmação real do servidor chega depois em `messages.update`.
const STATUS_ACK_SERVIDOR = 2;
const STATUS_ACK_ENTREGUE = 3;
const STATUS_ERRO = 0;
const TEMPO_MAXIMO_ACK_MS = 15_000;
const CONFIRMACOES_PENDENTES = new Map(); // id da mensagem -> { resolve, timer }
const STATUS_MENSAGENS_ENVIADAS = new Map();
let filaEnvio = Promise.resolve();
let ultimoEnvioEm = 0;
let filaMensagensRecebidas = Promise.resolve();

// O WhatsApp passou a entregar parte das conversas usando LID (identificador
// interno, terminado em @lid) em vez do JID que contém o telefone. Mantemos o
// vínculo anunciado pelo próprio Baileys para que a automação sempre encontre
// a OS pelo número real do cliente.
const TELEFONE_POR_LID = new Map(); // LID normalizado -> telefone/JID PN

// Dedupe de mensagens recebidas: o evento 'messages.upsert' do Baileys pode
// entregar a MESMA mensagem mais de uma vez (resync de histórico após
// reconexão, sincronização multi-dispositivo, etc). Sem essa proteção, uma
// única resposta do cliente (ex: "SIM") pode disparar _tratarMensagemRecebida
// várias vezes seguidas, fazendo o sistema tentar enviar a mesma mensagem de
// resposta em rajada — o que o WhatsApp então trata como comportamento
// suspeito e passa a segurar a entrega (aparece como "Aguardando mensagem").
const MENSAGENS_PROCESSADAS = new Map(); // msg.key.id -> timestamp de processamento
const DEDUPE_JANELA_MS = 10 * 60 * 1000; // 10 minutos
const DEDUPE_MAX_ENTRADAS = 500;

function _jaProcessada(msgId) {
  if (!msgId) return false; // sem id, não dá pra deduplicar — deixa passar
  const agora = Date.now();
  // limpeza por tempo: remove entradas velhas antes de checar
  if (MENSAGENS_PROCESSADAS.size > DEDUPE_MAX_ENTRADAS) {
    for (const [id, ts] of MENSAGENS_PROCESSADAS) {
      if (agora - ts > DEDUPE_JANELA_MS) MENSAGENS_PROCESSADAS.delete(id);
    }
  }
  if (MENSAGENS_PROCESSADAS.has(msgId)) return true;
  MENSAGENS_PROCESSADAS.set(msgId, agora);
  return false;
}

const SESSION_DIR = () => path.join(app.getPath('userData'), 'baileys-session');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function emitStatus(status, extra = {}) {
  connectionStatus = status;
  emit('whatsapp:status', { status, ...extra });
  console.log(`[WhatsApp] Status: ${status}`, extra.numero ? `(${extra.numero})` : '');
}

function limparSessao() {
  try {
    const dir = SESSION_DIR();
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log('[WhatsApp] Sessão removida.');
    }
  } catch (e) {
    console.error('[WhatsApp] Erro ao limpar sessão:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// v36.3 — LISTENER AUTOMÁTICO DE RESPOSTAS (aprovação de termos via WhatsApp)
// v45  — reformulado: o SIM/NÃO ao orçamento não pergunta mais forma de
//        pagamento em seguida (isso foi movido para a etapa de retirada).
//
// Fluxo controlado pelo campo `estadoConversaAprovacao` da OS (src/db.js):
//   'aguardando_sim_nao'                  → aguardando SIM/NÃO ao orçamento;
//                                            SIM encerra o fluxo aqui mesmo
//                                            (statusPagamento vira 'Autorizado';
//                                            o status TÉCNICO não muda aqui —
//                                            segue seu fluxo normal de análise/
//                                            diagnóstico/reparo)
//   'aguardando_motivo_recusa'            → aguardando o motivo da recusa
//   'aguardando_forma_pagamento_retirada' → aguardando a forma de pagamento
//                                            escolhida, perguntada só quando
//                                            o aparelho está pronto para
//                                            retirada (fluxo separado, não
//                                            é mais uma continuação do SIM)
// Qualquer outro valor (ou ausência de OS para o telefone) é ignorado por
// este listener — a automação só reage a conversas que ela mesma iniciou.
// ══════════════════════════════════════════════════════════════════════════════

const ESTADOS_AUTOMACAO_ATIVOS = [
  'aguardando_sim_nao',
  'aguardando_motivo_recusa',
  'aguardando_escolha_pagamento_entrada',
  'aguardando_forma_pagamento_retirada', // v45 — pergunta a forma de pagamento só na etapa de retirada, não mais logo após o SIM
  'aguardando_humano' // v40.4 — bot escuta só o "#" de cancelamento nesse estado; ver handler abaixo
];

// ─── Helpers de texto ─────────────────────────────────────────────────────────

function _normalizarTexto(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .trim();
}

function _extrairTextoMensagem(msg) {
  // Respostas podem vir embrulhadas como ephemeral/view-once. Desembrulhar
  // aqui evita ignorar um SIM/NÃO que visualmente chegou como texto normal.
  let m = msg?.message;
  if (!m) return '';
  while (m?.ephemeralMessage?.message || m?.viewOnceMessage?.message || m?.viewOnceMessageV2?.message || m?.viewOnceMessageV2Extension?.message) {
    m = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message;
  }
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ''
  ).trim();
}

function _normalizarIdentificadorJid(jid) {
  return String(jid || '').trim().toLowerCase().replace(/:\d+(?=@)/, '');
}

function _telefoneDeJid(jid) {
  const valor = _normalizarIdentificadorJid(jid);
  if (!valor || valor.endsWith('@lid')) return '';
  return valor.split('@')[0].replace(/\D/g, '');
}

function _registrarMapeamentoLid(lid, jidTelefone) {
  const lidNormalizado = _normalizarIdentificadorJid(lid);
  const telefone = _telefoneDeJid(jidTelefone);
  if (!lidNormalizado.endsWith('@lid') || !telefone) return;
  TELEFONE_POR_LID.set(lidNormalizado, telefone);
  if (TELEFONE_POR_LID.size > 2000) {
    const primeiro = TELEFONE_POR_LID.keys().next().value;
    if (primeiro) TELEFONE_POR_LID.delete(primeiro);
  }
}

function _resolverTelefoneMensagem(msg) {
  const key = msg?.key || {};

  // senderPn/participantPn são enviados pelo Baileys justamente quando o
  // remoteJid está no formato @lid. Eles têm prioridade sobre o identificador
  // anônimo e já representam o telefone real do remetente.
  const paresLidPn = [
    [key.senderLid, key.senderPn],
    [key.participantLid, key.participantPn],
    [String(key.remoteJid || '').endsWith('@lid') ? key.remoteJid : '', key.senderPn || key.participantPn],
  ];
  for (const [lid, pn] of paresLidPn) _registrarMapeamentoLid(lid, pn);

  const candidatosDiretos = [
    key.senderPn,
    key.participantPn,
    key.remoteJid,
    key.participant,
  ];
  for (const candidato of candidatosDiretos) {
    const telefone = _telefoneDeJid(candidato);
    if (telefone) return telefone;
  }

  const candidatosLid = [key.senderLid, key.participantLid, key.remoteJid, key.participant];
  for (const candidato of candidatosLid) {
    const telefone = TELEFONE_POR_LID.get(_normalizarIdentificadorJid(candidato));
    if (telefone) return telefone;
  }
  return '';
}

async function _resolverTelefoneMensagemComEspera(msg) {
  let telefone = _resolverTelefoneMensagem(msg);
  if (telefone) return telefone;

  const key = msg?.key || {};
  const usaLid = [key.senderLid, key.participantLid, key.remoteJid, key.participant]
    .some(jid => _normalizarIdentificadorJid(jid).endsWith('@lid'));
  if (!usaLid) return '';

  // Em alguns aparelhos o evento com o vínculo LID -> telefone chega poucos
  // instantes depois da mensagem. Dá tempo para esse evento sem bloquear o
  // restante do sistema e tenta novamente antes de desistir.
  for (const espera of [150, 350, 700]) {
    await _sleep(espera);
    telefone = _resolverTelefoneMensagem(msg);
    if (telefone) return telefone;
  }
  return '';
}

function _reconhecerSim(texto) {
  const t = _normalizarTexto(texto);
  return ['sim', 's', 'sim.', 'yes', '👍', 'aceito', 'aceitar', 'aceita', 'concordo', 'ok', 'confirmo', 'confirmado'].includes(t);
}

function _reconhecerNao(texto) {
  const t = _normalizarTexto(texto);
  return ['nao', 'n', 'nao.', 'no', '👎', 'recuso', 'recusar', 'recusa', 'não concordo', 'discordo'].includes(t);
}

function _mencionaFormaOnline(texto) {
  const t = _normalizarTexto(texto);
  // "Pix" sozinho é uma forma de pagamento válida e precisa ser classificado
  // como tal. Este atalho fica restrito a um pedido claro pelo link online.
  return ['link', 'pagamento online', 'pagar online', 'pelo site', 'manda o link', 'envia o link', 'quero o link']
    .some(frase => t.includes(frase));
}

// Reconhece o pedido explícito de falar com um atendente humano. O "1" é a
// opção numerada oferecida nas mensagens de termos e de "não entendi" — checa
// a mensagem inteira (não substring) para não disparar à toa em respostas que
// só contenham o dígito 1 em outro contexto (ex.: "modelo 1", "opção 1 do
// aparelho"). Também aceita variações textuais comuns do mesmo pedido.
function _reconhecerPedidoAtendente(texto) {
  const t = _normalizarTexto(texto);
  if (['1', '1.', '1)'].includes(t)) return true;
  return ['falar com atendente', 'quero um atendente', 'atendimento humano', 'falar com humano', 'falar com uma pessoa', 'quero falar com alguem']
    .some(frase => t.includes(frase));
}

// Reconhece o pedido de cancelar o atendimento humano em andamento (cliente
// digita "#"). Só é checado no estado 'aguardando_humano' — checa a
// mensagem inteira (não substring), mesmo critério de _reconhecerPedidoAtendente.
function _reconhecerCancelamentoAtendimento(texto) {
  const t = _normalizarTexto(texto);
  return ['#', 'cancelar'].includes(t);
}

// Checa se `termo` (palavra ou expressão de várias palavras, já sem acento/
// minúsculo) aparece em `textoNormalizado` como unidade inteira — isto é,
// não colado a outras letras/números nas bordas. Isso evita o bug de
// .includes() puro casando substrings dentro de outra palavra maior
// (ex.: "elo" dentro de "Alelo" ou "Cielo"; "vr" dentro de "receber").
function _contemPalavraOuFrase(textoNormalizado, termo) {
  const escapado = termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[^a-z0-9])' + escapado + '([^a-z0-9]|$)', 'i');
  return re.test(textoNormalizado);
}

// Detecta negação perto de uma palavra de pagamento (ex.: "não tenho
// dinheiro agora", "nao vai ser no cartao", "ainda nao consigo pagar").
// Limite conhecido: olha o texto inteiro em busca de um marcador de negação
// — não faz análise gramatical de proximidade/escopo (é keyword, não NLP).
// Quando detecta, _classificarFormaPagamentoManual cai no texto original em
// vez de arriscar classificar errado (ex.: badge "Dinheiro" quando o cliente
// disse o oposto).
function _mencionaNegacaoDePagamento(textoNormalizado) {
  return ['nao ', 'nao,', 'nao.', 'nunca ', 'sem condicao', 'sem condicoes', 'nem consigo', 'nao consigo', 'nao tenho', 'nao vai dar', 'nao posso', 'ainda nao']
    .some(marcador => textoNormalizado.includes(marcador)) || /(^|[^a-z0-9])nao([^a-z0-9]|$)/.test(textoNormalizado);
}

// v40.1 — Classifica o texto livre de "forma de pagamento manual" que o
// cliente digita no WhatsApp em uma categoria curta, para exibir como badge
// na listagem de OS (o texto bruto e completo continua preservado, intacto,
// em os.respostaPreferenciaPagamento — isso aqui só alimenta o badge).
//
// Estrutura em duas dimensões independentes, combinadas no resultado final:
//  (1) categoriaBase  — Cartão / Cartão de Crédito / Cartão de Débito /
//                        Maquininha / Dinheiro / Transferência / Boleto / Pix
//  (2) nomeEspecifico  — bandeira, adquirente/maquininha, carteira digital
//                        ou banco (ex.: Visa, Stone, Apple Pay, Bradesco)
// Quando as duas batem na mesma frase, o rótulo final combina as duas
// (ex.: "Maquininha (Stone)"). Quando só o nome específico aparece (cliente
// respondeu só "Stone", sem dizer "maquininha"), a categoria base é
// INFERIDA a partir do próprio nome específico — nunca aparece um nome
// específico sozinho no badge (decisão de produto confirmada).
//
// Ordem importa dentro de cada lista: termos mais específicos primeiro,
// para reduzir falso-positivo entre categorias parecidas (ex.: pix vs cartão,
// crédito vs débito).
const CATEGORIAS_FORMA_PAGAMENTO = [
  { rotulo: 'Pix',        palavras: ['pix', 'chave pix', 'qr pix', 'copia e cola', 'pix direto', 'pix por fora', 'fazer um pix', 'mandar um pix', 'mando o pix'] },
  {
    rotulo: 'Maquininha',
    palavras: ['maquininha', 'maquineta', 'maquina de cartao', 'maquina la', 'passar o cartao', 'passar cartao', 'passar na maquininha', 'passar na maquina', 'na maquina', 'no pos', 'terminal', 'nfc', 'contactless', 'tap to pay', 'aproximar o cartao', 'cartao por aproximacao', 'encosta o cartao', 'encostar o cartao', 'aproxima o cartao', 'vou passar', 'passa ai', 'pode passar', 'pode passar ai', 'aproxima', 'aproxima ai', 'maquina', 'pos', 'tap'],
  },
  {
    rotulo: 'Cartão de Crédito',
    palavras: ['cartao de credito', 'credito', 'cartao credito', 'no credito', 'parcelado', 'parcelar', 'em vezes', 'x sem juros', 'com juros', 'sem juros', 'faz em 2x', 'faz em 3x', 'faz em 4x', 'faz em 5x', 'faz em 6x', 'faz em 10x', 'faz em 12x', 'divide pra mim', 'parcela pra mim'],
  },
  {
    rotulo: 'Cartão de Débito',
    palavras: ['cartao de debito', 'debito', 'cartao debito', 'no debito', 'debita ai', 'debita aqui'],
  },
  {
    rotulo: 'Cartão',
    // categoria genérica de cartão, só cai aqui se não bateu em nenhuma das
    // mais específicas acima (crédito/débito/maquininha)
    palavras: ['cartao', 'no plastico', 'plastico', 'cartao fisico', 'cartao chip', 'cartao com chip', 'cartao sem contato', 'pode ser no cartao', 'pode cobrar', 'cobra no cartao'],
  },
  {
    rotulo: 'Carteira Digital',
    palavras: ['carteira digital', 'wallet', 'pagar com celular', 'pagar com relogio', 'pagar com smartwatch', 'usar o celular', 'usar o relogio', 'aproxima o celular', 'pagamento digital', 'pagar no app', 'pagamento eletronico'],
  },
  {
    rotulo: 'Dinheiro',
    palavras: ['dinheiro', 'dinheiro vivo', 'especie', 'em maos', 'pago em maos', 'em notas', 'cedulas', 'na entrega em dinheiro', 'cash', 'vou levar em dinheiro', 'a vista em dinheiro'],
  },
  {
    rotulo: 'Transferência',
    palavras: ['transferencia', 'transferencia bancaria', 'deposito', 'deposito bancario', 'conta bancaria', 'ted', 'doc', 'transferir'],
  },
  {
    rotulo: 'Boleto',
    palavras: ['boleto', 'codigo de barras', 'linha digitavel'],
  },
  {
    rotulo: 'Pagamento Presencial',
    palavras: ['na retirada', 'quando buscar', 'quando for buscar', 'quando eu buscar', 'na hora de buscar', 'pagar na loja', 'pago na loja', 'presencialmente', 'no balcao', 'ai na assistencia'],
  },
  {
    rotulo: 'Cheque',
    palavras: ['cheque', 'cheque pre datado', 'pre datado'],
  },
];

// Nomes específicos: bandeira, adquirente/maquininha, carteira digital ou
// banco. `categoriaBaseInferida` é usada quando o nome específico aparece
// sozinho na frase (sem nenhuma palavra de CATEGORIAS_FORMA_PAGAMENTO junto)
// — garante que o badge nunca mostra só "Stone", sempre "Maquininha (Stone)".
// Termos curtos/ambíguos (ex.: "vr", "caixa") usam frases de contexto em vez
// da palavra isolada, para não colidir com outras palavras comuns.
const NOMES_ESPECIFICOS_PAGAMENTO = [
  // Bandeiras de cartão
  { nome: 'Visa',              categoriaBaseInferida: 'Cartão', palavras: ['visa'] },
  { nome: 'Mastercard',        categoriaBaseInferida: 'Cartão', palavras: ['mastercard', 'master card', 'no master'] },
  { nome: 'Elo',               categoriaBaseInferida: 'Cartão', palavras: ['elo'] },
  { nome: 'Hipercard',         categoriaBaseInferida: 'Cartão', palavras: ['hipercard', 'no hipercard'] },
  { nome: 'American Express',  categoriaBaseInferida: 'Cartão', palavras: ['american express', 'amex'] },
  { nome: 'Diners Club',       categoriaBaseInferida: 'Cartão', palavras: ['diners club', 'diners'] },
  { nome: 'Discover',          categoriaBaseInferida: 'Cartão', palavras: ['discover'] },
  { nome: 'Cabal',             categoriaBaseInferida: 'Cartão', palavras: ['cabal'] },
  { nome: 'Aura',              categoriaBaseInferida: 'Cartão', palavras: ['cartao aura', 'bandeira aura'] },
  { nome: 'Banescard',         categoriaBaseInferida: 'Cartão', palavras: ['banescard'] },
  { nome: 'Alelo',             categoriaBaseInferida: 'Cartão', palavras: ['alelo'] },
  { nome: 'Sodexo',            categoriaBaseInferida: 'Cartão', palavras: ['sodexo'] },
  { nome: 'Pluxee',            categoriaBaseInferida: 'Cartão', palavras: ['pluxee'] },
  { nome: 'Swile',             categoriaBaseInferida: 'Cartão', palavras: ['swile'] },
  { nome: 'Caju',              categoriaBaseInferida: 'Cartão', palavras: ['cartao caju', 'caju beneficios'] },
  { nome: 'Flash',             categoriaBaseInferida: 'Cartão', palavras: ['cartao flash', 'flash beneficios'] },
  { nome: 'iFood Benefícios',  categoriaBaseInferida: 'Cartão', palavras: ['ifood beneficios', 'cartao ifood'] },
  { nome: 'Ticket',            categoriaBaseInferida: 'Cartão', palavras: ['cartao ticket', 'ticket alimentacao', 'ticket restaurante'] },
  { nome: 'VR',                categoriaBaseInferida: 'Cartão', palavras: ['cartao vr', 'no vr', 'pagar com vr', 'vale refeicao'] },
  { nome: 'Visa Vale',         categoriaBaseInferida: 'Cartão', palavras: ['visa vale'] },
  { nome: 'Good Card',         categoriaBaseInferida: 'Cartão', palavras: ['good card'] },
  { nome: 'Coopercard',        categoriaBaseInferida: 'Cartão', palavras: ['coopercard'] },
  { nome: 'Senff',             categoriaBaseInferida: 'Cartão', palavras: ['senff'] },

  // Maquininhas / adquirentes
  { nome: 'Stone',             categoriaBaseInferida: 'Maquininha', palavras: ['stone'] },
  { nome: 'Ton',               categoriaBaseInferida: 'Maquininha', palavras: ['maquininha ton', 'na ton', 'pela ton'] },
  { nome: 'SumUp',             categoriaBaseInferida: 'Maquininha', palavras: ['sumup', 'sum up'] },
  { nome: 'Mercado Pago Point',categoriaBaseInferida: 'Maquininha', palavras: ['mercado pago point', 'point do mercado pago'] },
  { nome: 'InfinitePay',       categoriaBaseInferida: 'Maquininha', palavras: ['infinitepay', 'infinite pay'] },
  { nome: 'Safra Pay',         categoriaBaseInferida: 'Maquininha', palavras: ['safrapay', 'safra pay'] },
  { nome: 'Rede',              categoriaBaseInferida: 'Maquininha', palavras: ['maquininha rede', 'na rede', 'pela rede'] },
  { nome: 'Cielo',             categoriaBaseInferida: 'Maquininha', palavras: ['cielo'] },
  { nome: 'Getnet',            categoriaBaseInferida: 'Maquininha', palavras: ['getnet', 'get net'] },
  { nome: 'Azulzinha Bin',     categoriaBaseInferida: 'Maquininha', palavras: ['azulzinha'] },
  { nome: 'Sipag',             categoriaBaseInferida: 'Maquininha', palavras: ['sipag'] },
  { nome: 'PagBank',           categoriaBaseInferida: 'Maquininha', palavras: ['pagbank', 'pagseguro'] },

  // Carteiras digitais / apps de pagamento
  { nome: 'Apple Pay',         categoriaBaseInferida: 'Carteira Digital', palavras: ['apple pay'] },
  { nome: 'Google Pay',        categoriaBaseInferida: 'Carteira Digital', palavras: ['google pay', 'gpay', 'carteira do google'] },
  { nome: 'Samsung Pay',       categoriaBaseInferida: 'Carteira Digital', palavras: ['samsung pay'] },
  { nome: 'Garmin Pay',        categoriaBaseInferida: 'Carteira Digital', palavras: ['garmin pay'] },
  { nome: 'Xiaomi Pay',        categoriaBaseInferida: 'Carteira Digital', palavras: ['xiaomi pay'] },
  { nome: 'Mercado Pago',      categoriaBaseInferida: 'Carteira Digital', palavras: ['mercado pago', 'mercadopago'] },
  { nome: 'PicPay',            categoriaBaseInferida: 'Carteira Digital', palavras: ['picpay', 'pic pay'] },
  { nome: 'PayPal',            categoriaBaseInferida: 'Carteira Digital', palavras: ['paypal', 'pay pal'] },
  { nome: 'RecargaPay',        categoriaBaseInferida: 'Carteira Digital', palavras: ['recargapay', 'recarga pay'] },
  { nome: 'Ame Digital',       categoriaBaseInferida: 'Carteira Digital', palavras: ['ame digital'] },
  { nome: '99Pay',             categoriaBaseInferida: 'Carteira Digital', palavras: ['99pay', '99 pay'] },
  { nome: 'iti',               categoriaBaseInferida: 'Carteira Digital', palavras: ['app iti', 'pelo iti', 'carteira iti'] },
  { nome: 'Nubank',            categoriaBaseInferida: 'Cartão', palavras: ['nubank', 'nu pay', 'nupay'] },

  // Bancos (paga-se "com o cartão do banco" — categoria base = Cartão)
  { nome: 'Inter',             categoriaBaseInferida: 'Cartão', palavras: ['banco inter', 'cartao do inter', 'cartao inter', 'pelo inter'] },
  { nome: 'C6 Bank',           categoriaBaseInferida: 'Cartão', palavras: ['c6 bank', 'c6', 'banco c6'] },
  { nome: 'Bradesco',          categoriaBaseInferida: 'Cartão', palavras: ['bradesco'] },
  { nome: 'Itaú',              categoriaBaseInferida: 'Cartão', palavras: ['itau'] },
  { nome: 'Santander',         categoriaBaseInferida: 'Cartão', palavras: ['santander'] },
  { nome: 'Banco do Brasil',   categoriaBaseInferida: 'Cartão', palavras: ['banco do brasil'] },
  { nome: 'Caixa',             categoriaBaseInferida: 'Cartão', palavras: ['caixa economica', 'banco caixa', 'cartao da caixa', 'cartao caixa', 'pelo caixa', 'app caixa'] },
  { nome: 'Sicredi',           categoriaBaseInferida: 'Cartão', palavras: ['sicredi'] },
  { nome: 'Sicoob',            categoriaBaseInferida: 'Cartão', palavras: ['sicoob', 'sicoobcard'] },
  { nome: 'Neon',              categoriaBaseInferida: 'Cartão', palavras: ['banco neon', 'cartao neon', 'cartao do neon'] },
  { nome: 'Next',              categoriaBaseInferida: 'Cartão', palavras: ['banco next', 'cartao next', 'cartao do next'] },
  { nome: 'Banco Pan',         categoriaBaseInferida: 'Cartão', palavras: ['banco pan'] },
  { nome: 'BTG',               categoriaBaseInferida: 'Cartão', palavras: ['btg', 'btg pactual'] },
  { nome: 'Will Bank',         categoriaBaseInferida: 'Cartão', palavras: ['will bank', 'willbank'] },
];

function _classificarFormaPagamentoManual(texto) {
  const t = _normalizarTexto(texto);
  if (!t) return 'Não informado';

  // Negação tem prioridade sobre qualquer classificação: se o cliente nega
  // (ex.: "nao tenho dinheiro agora"), não arriscamos badge enganoso — cai
  // direto no texto original, igual ao caso "nenhuma palavra reconhecida".
  if (_mencionaNegacaoDePagamento(t)) {
    const originalNeg = String(texto || '').trim();
    return originalNeg.length > 40 ? originalNeg.slice(0, 37) + '...' : (originalNeg || 'Não informado');
  }

  // Dimensão 1: categoria base (Cartão, Maquininha, Dinheiro, Pix, etc.)
  let categoriaBase = null;
  for (const categoria of CATEGORIAS_FORMA_PAGAMENTO) {
    if (categoria.palavras.some(p => _contemPalavraOuFrase(t, _normalizarTexto(p)))) {
      categoriaBase = categoria.rotulo;
      break;
    }
  }

  // Dimensão 2: nome específico (bandeira, adquirente, carteira, banco)
  let nomeEspecifico = null;
  let categoriaBaseInferidaPeloNome = null;
  for (const item of NOMES_ESPECIFICOS_PAGAMENTO) {
    if (item.palavras.some(p => _contemPalavraOuFrase(t, _normalizarTexto(p)))) {
      nomeEspecifico = item.nome;
      categoriaBaseInferidaPeloNome = item.categoriaBaseInferida;
      break;
    }
  }

  if (categoriaBase && nomeEspecifico) {
    return `${categoriaBase} (${nomeEspecifico})`;
  }
  if (nomeEspecifico) {
    // Nome específico apareceu sozinho — nunca mostra sozinho no badge,
    // sempre combina com a categoria base inferida (decisão confirmada).
    return `${categoriaBaseInferidaPeloNome} (${nomeEspecifico})`;
  }
  if (categoriaBase) {
    return categoriaBase;
  }

  // Nenhuma palavra-chave reconhecida — mostra o texto original (truncado
  // para não estourar o layout do badge), em vez de esconder a informação.
  const original = String(texto || '').trim();
  return original.length > 40 ? original.slice(0, 37) + '...' : (original || 'Não informado');
}

function _classificarEscolhaPagamentoEntrada(texto) {
  const t = _normalizarTexto(texto);
  const menciona50 = /(^|\D)50\s*%?(\D|$)/.test(t)
    || ['metade', 'meia entrada', 'entrada', 'sinal', 'cinquenta por cento'].some(p => t.includes(p));
  const menciona100 = /(^|\D)100\s*%?(\D|$)/.test(t)
    || ['valor total', 'pagamento total', 'valor completo', 'pagamento completo', 'total', 'integral', 'inteiro', 'completo', 'tudo', 'cem por cento', 'quitar'].some(p => t.includes(p));
  const percentual = menciona100 ? 100 : (menciona50 ? 50 : 0);
  const formaPagamento = _classificarFormaPagamentoManual(texto);
  const formaReconhecida = formaPagamento && formaPagamento !== 'Não informado'
    && formaPagamento !== String(texto || '').trim().slice(0, 40);
  const presencial = ['presencial', 'na loja', 'no balcao', 'no balcão', 'ai na assistencia', 'aí na assistência', 'vou ai', 'vou aí']
    .some(p => t.includes(_normalizarTexto(p)))
    || ['Dinheiro', 'Maquininha', 'Pagamento Presencial'].some(p => String(formaPagamento).startsWith(p));
  return { percentual, formaPagamento, formaReconhecida, presencial };
}

function _classificarIntencaoPagamentoEntradaPorRegras(texto) {
  const t = _normalizarTexto(texto);
  if (!t) return 'nao_entendido';

  // Uma negação do pagamento integral não pode virar, por substring, um
  // pedido de link de 100%. Se o cliente contrapõe claramente “não quero o
  // total, só a entrada”, respeitamos a parte positiva e mantemos os 50%; nos
  // demais casos negativos pedimos esclarecimento, sem gerar cobrança nova.
  if (_mencionaNegacaoDePagamento(t)) {
    const escolheuSomenteEntrada = ['so a entrada', 'somente a entrada', 'apenas a entrada', 'so 50', 'somente 50', 'apenas 50']
      .some(frase => t.includes(frase));
    return escolheuSomenteEntrada ? 'entrada_50_online' : 'nao_entendido';
  }

  const escolha = _classificarEscolhaPagamentoEntrada(texto);
  if (escolha.presencial) {
    return escolha.percentual === 100 ? 'presencial_100' : 'presencial_50';
  }
  if (_mencionaFormaOnline(texto)) {
    return escolha.percentual === 100 ? 'quitar_100_online' : 'entrada_50_online';
  }
  const pediuQuitacaoPorSaldo = ['restante agora', 'resto agora', 'saldo agora', 'deixar tudo pago', 'ficar tudo pago']
    .some(frase => t.includes(frase));
  if (escolha.percentual === 100 || pediuQuitacaoPorSaldo) return 'quitar_100_online';
  if (escolha.percentual === 50) return 'entrada_50_online';
  if (escolha.formaReconhecida) return 'presencial_50';
  return 'nao_entendido';
}

// ─── Geração do link Mercado Pago já existente na integração ─────────────────
// Reaproveita exatamente a mesma chamada usada em main.js (mp:gerarLink /
// mp:gerarPayload): POST em /checkout/preferences usando o token salvo em
// config.mercadoPagoToken. Não duplica lógica de negócio nova — apenas chama
// a mesma API externa já integrada ao sistema, a partir dos dados já
// existentes na OS (db.obterOSPorNumero / db.loadDB).
async function _gerarLinkMercadoPagoExistente(os, opcoes = {}) {
  const valorOpcional = Number(opcoes.valor) || 0;
  const tipoCobranca = String(opcoes.tipo || 'padrao').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'padrao';
  const valorNum = valorOpcional || (os?.exigirEntrada50Aprovacao === true && os?.entrada50Paga !== true
    ? parseFloat(os?.valorEntradaAprovacao)
    : 0)
    || parseFloat(os?.diagnosticoTecnico?.valorEstimado)
    || parseFloat(os?.valorInvestido)
    || 0;
  if (!valorNum || valorNum <= 0) {
    throw new Error('A OS não possui um valor válido para gerar o link do Mercado Pago.');
  }
  const aparelho = [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' ')
    || 'Serviço de assistência técnica';
  const pagador = _dadosPagadorMercadoPago(os);

  // Caminho atual: a Edge Function usa o token criptografado da empresa no
  // Supabase. O segredo não volta ao processo do WhatsApp nem ao renderer.
  if (geradorPreferenciaMercadoPago) {
    const resultado = await geradorPreferenciaMercadoPago({
      numero: String(os.numero || ''),
      valor: valorNum,
      titulo: `${os.numero} — ${aparelho}`,
      pagador,
      idempotencyKey: `${os.numero}:${valorNum.toFixed(2)}:whatsapp:${tipoCobranca}`
    });
    if (!resultado?.sucesso || !resultado?.link) {
      throw new Error(resultado?.erro || 'O Mercado Pago não devolveu o link de pagamento.');
    }
    return resultado.link;
  }

  // Compatibilidade com instalações anteriores ainda não autenticadas no
  // Supabase. Novas instalações usam exclusivamente o cofre seguro acima.
  return new Promise((resolve, reject) => {
    try {
      const configFull = db.loadDB().config;
      const token = configFull?.mercadoPagoToken || '';

      if (!token) {
        reject(new Error('A conta Mercado Pago não está conectada nesta empresa.'));
        return;
      }

      const https = require('https');
      const body = JSON.stringify({
        items: [{
          title: `${os.numero} — ${aparelho}`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: valorNum
        }],
        payment_methods: {
          excluded_payment_types: [],
          installments: 1
        },
        ...(Object.keys(pagador).length ? { payer: pagador } : {}),
        external_reference: os.numero,
        expires: true,
        expiration_date_to: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '.000-03:00')
      });

      const req = https.request({
        hostname: 'api.mercadopago.com',
        path: '/checkout/preferences',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const link = json.init_point || json.sandbox_init_point || '';
            if (!link) {
              reject(new Error(json.message || `O Mercado Pago recusou a cobrança (HTTP ${res.statusCode}).`));
              return;
            }
            resolve(link);
          } catch {
            reject(new Error('O Mercado Pago devolveu uma resposta inválida.'));
          }
        });
      });
      req.on('error', (erro) => reject(erro));
      req.write(body);
      req.end();
    } catch (erro) {
      reject(erro);
    }
  });
}

function _garantirCobrancaMercadoPagoRegistrada(os, linkPagamento, telefone, opcoes = {}) {
  if (!os?.numero || !linkPagamento || typeof db.registrarCobranca !== 'function') return;
  try {
    const valor = Number(opcoes.valor) || (os?.exigirEntrada50Aprovacao === true && os?.entrada50Paga !== true
      ? parseFloat(os?.valorEntradaAprovacao)
      : 0)
      || parseFloat(os?.diagnosticoTecnico?.valorEstimado)
      || parseFloat(os?.valorInvestido)
      || 0;
    const existente = typeof db.listarCobrancas === 'function'
      ? db.listarCobrancas().find(c => c.osNumero === os.numero
        && c.status === 'aguardando'
        && Math.abs(Number(c.valor || 0) - Number(valor || 0)) < 0.01)
      : null;
    if (existente) return existente;
    if (valor <= 0) return;
    return db.registrarCobranca({
      osNumero: os.numero,
      valor,
      linkML: linkPagamento,
      pixCodigo: null,
      telefone,
      tipo: opcoes.tipo || '',
    });
  } catch (e) {
    console.warn('[Mercado Pago] Link enviado, mas não foi possível registrar a cobrança local:', e.message);
  }
}

// ─── Log auxiliar (não interrompe o fluxo em caso de falha) ───────────────────
function _logAutomacao({ tipo, os, telefone, mensagem, sucesso, erro, statusEnvio, idMensagem }) {
  try {
    db.registrarLogMensagem({
      tipo       : tipo,
      osNumero   : os?.numero        || '',
      clienteNome: os?.cliente?.nome || os?.nome_cliente || '',
      telefone   : telefone          || '',
      mensagem   : mensagem          || '',
      sucesso    : !!sucesso,
      erro       : erro || null,
      statusEnvio: statusEnvio,
      idMensagem : idMensagem || ''
    });
  } catch (eLog) {
    console.warn('[WhatsApp] Erro ao salvar log da automação:', eLog.message);
  }
}

// ─── Pequena pausa entre mensagens sequenciais (evita flood/fora de ordem) ────
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Uma única fila vale para texto e documento. Além de manter a ordem
// (texto antes do PDF), evita rajadas que o WhatsApp costuma deixar pendentes.
function _enfileirarEnvio(tarefa) {
  const execucao = filaEnvio.then(async function () {
    const espera = Math.max(0, 1200 - (Date.now() - ultimoEnvioEm));
    if (espera) await _sleep(espera);
    const resultado = await tarefa();
    ultimoEnvioEm = Date.now();
    return resultado;
  });
  filaEnvio = execucao.catch(function () { /* mantém a fila utilizável */ });
  return execucao;
}

// ─── Envio auxiliar com log automático embutido ───────────────────────────────
async function _enviarELogar({ tipo, os, telefone, codigoPais, msg }) {
  const resultado = await enviarMensagem(telefone, msg, codigoPais);
  _logAutomacao({
    tipo, os, telefone, mensagem: msg,
    sucesso: resultado.sucesso,
    erro: resultado.erro,
    statusEnvio: resultado.statusEnvio,
    idMensagem: resultado.idMensagem
  });
  return resultado;
}

// Confirma o aceite e, somente quando este envio de orçamento foi marcado para
// usar Mercado Pago, cria e envia o link. A conversa continua ativa depois do
// link para classificar uma forma alternativa informada pelo cliente.
async function _processarAceiteTermos({ os, telefone, codigoPais, config }, dependencias = {}) {
  const banco = dependencias.db || db;
  const gerarLink = dependencias.gerarLink || _gerarLinkMercadoPagoExistente;
  const enviarELogar = dependencias.enviarELogar || _enviarELogar;
  const registrarCobranca = dependencias.registrarCobranca || _garantirCobrancaMercadoPagoRegistrada;

  banco.registrarRespostaAprovacao(os.numero, { aceitou: true, classificacao: 'aceite_termos' });

  const usarMercadoPago = os.usarMercadoPagoAprovacao === true;
  const exigirEntrada50 = usarMercadoPago && os.exigirEntrada50Aprovacao === true;
  let linkPagamento = '';
  let linkPagamento50 = '';
  if (usarMercadoPago && !exigirEntrada50) {
    linkPagamento = await gerarLink(os);
  }

  const entradaSalva = Number(os.valorEntradaAprovacao || 0);
  const totalConfigurado = Number(os.valorTotalServico || os.diagnosticoTecnico?.valorEstimado || os.valorInvestido || 0)
    || entradaSalva * 2;
  const entradaConfigurada = entradaSalva || totalConfigurado / 2;
  if (exigirEntrada50) {
    linkPagamento50 = await gerarLink(os, { valor: entradaConfigurada, tipo: 'entrada_50' });
  }
  banco.atualizarOS(os.numero, {
    // No fluxo comum, SIM autoriza o reparo, mas não confirma pagamento.
    // Na entrada de 50%, o reparo só começa depois da confirmação financeira.
    status: exigirEntrada50 ? 'Aguardando aprovação' : 'Em reparo',
    statusPagamento: exigirEntrada50 ? 'Aguardando Pagamento' : 'Aguardando Pagamento na Retirada',
    estadoConversaAprovacao: exigirEntrada50
      ? 'aguardando_escolha_pagamento_entrada'
      : (usarMercadoPago ? 'aguardando_forma_pagamento_retirada' : 'concluido'),
    contextoFormaPagamento: exigirEntrada50 ? 'entrada_50' : (usarMercadoPago ? 'apos_aprovacao' : ''),
    linksPagamentoAprovacao: exigirEntrada50 ? {
      entrada50: linkPagamento50,
    } : (linkPagamento ? { integral100: linkPagamento } : {}),
    percentualPagamentoAguardado: exigirEntrada50 ? 50 : 0,
    modalidadePagamentoAprovacao: exigirEntrada50 ? 'aguardando_escolha' : '',
  });

  const osAtualizada = banco.obterOSPorNumero(os.numero) || os;
  if (exigirEntrada50) {
    const total = Number(osAtualizada.valorTotalServico || osAtualizada.diagnosticoTecnico?.valorEstimado || osAtualizada.valorInvestido || 0)
      || Number(osAtualizada.valorEntradaAprovacao || 0) * 2;
    const entrada = Number(osAtualizada.valorEntradaAprovacao || total / 2);
    const msgEntrada = mensagens.montarPedidoEntrada50({
      nome_cliente: osAtualizada.cliente?.nome || '',
      numero: osAtualizada.numero,
      valor_total: total.toFixed(2).replace('.', ','),
      valor_entrada: entrada.toFixed(2).replace('.', ','),
      link_pagamento_50: linkPagamento50 || '',
    }, config);
    const resultadoEntrada = await enviarELogar({
      tipo: 'pedido_entrada_50',
      os: osAtualizada,
      telefone,
      codigoPais,
      msg: msgEntrada,
    });
    if (resultadoEntrada?.sucesso) {
      registrarCobranca(osAtualizada, linkPagamento50, telefone, {
        valor: entrada, tipo: 'entrada_50'
      });
    }
    return osAtualizada;
  }

  const msgConfirmacao = mensagens.montarConfirmacaoTermosAceitos(
    { nome_cliente: osAtualizada.cliente?.nome || '', numero: osAtualizada.numero },
    config
  );
  await enviarELogar({
    tipo: 'confirmacao_termos_aceitos',
    os: osAtualizada,
    telefone,
    codigoPais,
    msg: msgConfirmacao,
  });

  if (!usarMercadoPago) return osAtualizada;

  await _sleep(700);
  const msgPagamento = mensagens.montarPedidoFormaPagamento({
    nome_cliente: osAtualizada.cliente?.nome || '',
    numero: osAtualizada.numero,
    link_pagamento: linkPagamento || '',
  }, config);
  const resultadoPagamento = await enviarELogar({
    tipo: 'pedido_forma_pagamento_apos_aprovacao',
    os: osAtualizada,
    telefone,
    codigoPais,
    msg: msgPagamento,
  });
  if (resultadoPagamento?.sucesso) {
    registrarCobranca(osAtualizada, linkPagamento, telefone);
  }
  return osAtualizada;
}

// Processa a escolha que vem depois do aceite quando a OS exige entrada.
// O link de 50% já foi enviado no aceite; o integral só nasce aqui, quando o
// cliente pede para quitar tudo online. As dependências opcionais mantêm a
// rotina testável sem conectar ao WhatsApp nem ao Mercado Pago.
async function _processarEscolhaPagamentoEntrada({ os, texto, telefone, codigoPais, config }, dependencias = {}) {
  const banco = dependencias.db || db;
  const gerarLink = dependencias.gerarLink || _gerarLinkMercadoPagoExistente;
  const enviarELogar = dependencias.enviarELogar || _enviarELogar;
  const registrarCobranca = dependencias.registrarCobranca || _garantirCobrancaMercadoPagoRegistrada;
  const classificadorIA = dependencias.iaGroq || iaGroq;

  const estado = os.estadoConversaAprovacao;
  if (_reconhecerPedidoAtendente(texto)) {
    banco.registrarEscaladoAtendimentoHumano(os.numero, 'solicitado_pelo_cliente', estado);
    const msgAtendente = mensagens.montarEncaminhadoAtendimentoHumano(
      { nome_cliente: os.cliente?.nome || '' }, config
    );
    await enviarELogar({ tipo: 'encaminhado_atendimento_humano', os, telefone, codigoPais, msg: msgAtendente });
    return;
  }

  const escolha = _classificarEscolhaPagamentoEntrada(texto);
  const osAtual = banco.obterOSPorNumero(os.numero) || os;
  const total = Number(osAtual.valorTotalServico || osAtual.diagnosticoTecnico?.valorEstimado || osAtual.valorInvestido || 0)
    || Number(osAtual.valorEntradaAprovacao || 0) * 2;
  const entrada = Number(osAtual.valorEntradaAprovacao || total / 2);
  const links = osAtual.linksPagamentoAprovacao || {};

  // Expressões claras são resolvidas localmente. Somente textos ambíguos
  // consomem IA; o próprio classificador remoto recebe esta mesma regra como
  // fallback e sempre devolve uma das cinco intenções válidas.
  const intencaoPorRegras = _classificarIntencaoPagamentoEntradaPorRegras(texto);
  let intencao = intencaoPorRegras;
  if (intencao === 'nao_entendido' && typeof classificadorIA.classificarEscolhaPagamentoEntrada === 'function') {
    try {
      const resultadoIntencao = await classificadorIA.classificarEscolhaPagamentoEntrada(texto, {
        osNumero: os.numero,
        clienteNome: os.cliente?.nome || '',
        telefone,
        classificarPorRegras: _classificarIntencaoPagamentoEntradaPorRegras,
      });
      intencao = resultadoIntencao?.intencao || 'nao_entendido';
    } catch {
      intencao = intencaoPorRegras;
    }
  }

  if (['quitar_100_online', 'entrada_50_online'].includes(intencao)) {
    const percentual = intencao === 'quitar_100_online' ? 100 : 50;
    const chaveLink = percentual === 100 ? 'integral100' : 'entrada50';
    const tipoCobranca = percentual === 100 ? 'integral_100' : 'entrada_50';
    const valor = percentual === 100 ? total : entrada;
    let link = links[chaveLink] || '';
    let osComLink = osAtual;

    if (!link) {
      link = await gerarLink(osAtual, { valor, tipo: tipoCobranca });
      const linksAtualizados = { ...links, [chaveLink]: link };
      osComLink = banco.atualizarOS(os.numero, {
        linksPagamentoAprovacao: linksAtualizados,
      }) || { ...osAtual, linksPagamentoAprovacao: linksAtualizados };
    }

    const msgLink = `Link para pagar *${percentual}%* da OS *#${os.numero}*:\n${link}\n\n*${config.nomeEmpresa}*`;
    const resultado = await enviarELogar({
      tipo: percentual === 100 ? 'link_pagamento_integral_sob_demanda' : 'link_pagamento_entrada_reenviado',
      os: osComLink,
      telefone,
      codigoPais,
      msg: msgLink,
    });

    if (resultado?.sucesso) {
      const osAguardando = banco.atualizarOS(os.numero, {
        statusPagamento: 'Aguardando Pagamento',
        percentualPagamentoAguardado: percentual,
        modalidadePagamentoAprovacao: 'online',
        contextoFormaPagamento: `entrada_${percentual}_online`,
        estadoConversaAprovacao: 'aguardando_escolha_pagamento_entrada',
      }) || osComLink;
      registrarCobranca(osAguardando, link, telefone, { valor, tipo: tipoCobranca });
    }
    return;
  }

  const escolhaPresencial = ['presencial_50', 'presencial_100'].includes(intencao);
  const forma = escolhaPresencial && escolha.formaReconhecida
    ? escolha.formaPagamento
    : (escolhaPresencial ? 'Pagamento Presencial' : '');
  // Forma presencial sem percentual significa a entrada mínima de 50%.
  const percentualPresencial = intencao === 'presencial_100'
    ? 100
    : (intencao === 'presencial_50' ? 50 : 0);

  if (percentualPresencial && forma) {
    banco.registrarFormaPagamento(os.numero, texto);
    banco.atualizarOS(os.numero, {
      status: 'Aguardando aprovação',
      statusPagamento: 'Aguardando Pagamento Presencial',
      formaPagamento: forma,
      percentualPagamentoAguardado: percentualPresencial,
      modalidadePagamentoAprovacao: 'presencial',
      contextoFormaPagamento: `entrada_${percentualPresencial}_presencial`,
      estadoConversaAprovacao: 'concluido',
    });
    const confirmada = banco.obterOSPorNumero(os.numero) || osAtual;
    const msgPresencial = mensagens.montarPagamentoPresencialAguardado({
      nome_cliente: confirmada.cliente?.nome || '',
      numero: confirmada.numero,
      percentual: percentualPresencial,
      forma_pagamento: forma,
    }, config);
    await enviarELogar({ tipo: 'pagamento_presencial_aguardado', os: confirmada, telefone, codigoPais, msg: msgPresencial });
    return;
  }

  const msgNaoEntendi = mensagens.montarEscolhaEntradaNaoEntendida(
    { nome_cliente: os.cliente?.nome || '' }, config
  );
  await enviarELogar({ tipo: 'escolha_entrada_nao_entendida', os, telefone, codigoPais, msg: msgNaoEntendi });
}

// ─── Handler principal do listener automático ─────────────────────────────────
async function _tratarMensagemRecebida(msg) {
  try {
    if (!msg || msg.key?.fromMe) return; // ignora mensagens enviadas pelo próprio sistema

    const remoteJid = msg.key?.remoteJid || '';
    if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return; // ignora grupos/status

    const texto = _extrairTextoMensagem(msg);
    if (!texto) return; // mensagem sem texto reconhecível (áudio, figurinha, etc.) — ignora

    const telefone = await _resolverTelefoneMensagemComEspera(msg);
    if (!telefone) {
      console.warn('[WhatsApp] Resposta recebida, mas não foi possível resolver o telefone do remetente.', {
        id: msg.key?.id || '',
        remoteJid: remoteJid.endsWith('@lid') ? '@lid' : remoteJid,
      });
      return;
    }

    // Se não existir OS aguardando resposta para este telefone, ignora.
    const os = db.obterOSPorTelefone(telefone);
    if (!os) return;

    const estado = os.estadoConversaAprovacao;
    if (!ESTADOS_AUTOMACAO_ATIVOS.includes(estado)) return;

    // Só marca como processada depois de resolver o telefone e encontrar uma
    // automação ativa. Antes, uma mensagem @lid podia ser marcada cedo demais
    // e ser descartada quando o vínculo com o telefone chegasse logo depois.
    const msgId = msg.key?.id;
    if (_jaProcessada(msgId)) {
      _logAutomacao({
        tipo: 'mensagem_duplicada_ignorada',
        os,
        telefone,
        mensagem: `Mensagem repetida (id ${msgId}) recebida do Baileys e descartada automaticamente — nenhuma ação foi tomada.`,
        sucesso: true,
      });
      return;
    }

    const configFull = db.loadDB().config || {};
    const codigoPais = (configFull.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55';
    const config = { nomeEmpresa: configFull.nomeEmpresa || 'Assistência Técnica', codigoPais };

    // ── Estado: aguardando_sim_nao ──────────────────────────────────────────
    if (estado === 'aguardando_sim_nao') {

      // ── Atalho: cliente pediu atendimento humano explicitamente ──────────
      // Checado ANTES de qualquer regra ou IA — é um pedido direto do
      // cliente, não uma dúvida a ser interpretada, então nunca deve passar
      // por classificação nenhuma. Some o texto e para a automação na hora.
      if (_reconhecerPedidoAtendente(texto)) {
        db.registrarEscaladoAtendimentoHumano(os.numero, 'solicitado_pelo_cliente', 'aguardando_sim_nao');

        const msgAtendente = mensagens.montarEncaminhadoAtendimentoHumano(
          { nome_cliente: os.cliente?.nome || '' },
          config
        );

        await _enviarELogar({
          tipo: 'encaminhado_atendimento_humano',
          os,
          telefone,
          codigoPais,
          msg: msgAtendente
        });
        return;
      }

      if (_reconhecerSim(texto)) {
        await _processarAceiteTermos({ os, telefone, codigoPais, config });
        return;
      }

      if (_reconhecerNao(texto)) {
        db.registrarRespostaAprovacao(os.numero, { aceitou: false, classificacao: 'recusa_termos' });
        db.atualizarOS(os.numero, { estadoConversaAprovacao: 'aguardando_motivo_recusa' });

        const osAtualizada = db.obterOSPorNumero(os.numero) || os;
        const msgMotivoRecusa = mensagens.montarPedidoMotivoRecusa(
          { nome_cliente: osAtualizada.cliente?.nome || '', numero: osAtualizada.numero },
          config
        );

        await _enviarELogar({
          tipo: 'pedido_motivo_recusa',
          os: osAtualizada,
          telefone,
          codigoPais,
          msg: msgMotivoRecusa
        });
        return;
      }

      // ── Texto não bateu com as regras rápidas — consulta a IA ────────────
      // As regras (_reconhecerSim/_reconhecerNao) cobrem respostas curtas e
      // exatas ("sim", "ok", "não"). Qualquer coisa fora disso (frases mais
      // naturais como "sim pode fazer" ou "acho que não") passa pela IA antes
      // de declarar "não entendida". A IA nunca força sim/não — devolve
      // 'ambiguo' sempre que não tiver confiança razoável (ver ia-groq.js),
      // e nesse caso o comportamento é idêntico ao texto não reconhecido de
      // antes: reenvia a pergunta, respeitando o limite de tentativas abaixo.
      const resultadoAceite = await iaGroq.classificarAceiteTermos(texto, {
        osNumero: os.numero,
        clienteNome: os.cliente?.nome || '',
        telefone,
      });

      if (resultadoAceite.decisao === 'sim') {
        await _processarAceiteTermos({ os, telefone, codigoPais, config });
        return;
      }

      if (resultadoAceite.decisao === 'nao') {
        db.registrarRespostaAprovacao(os.numero, { aceitou: false, classificacao: 'recusa_termos' });
        db.atualizarOS(os.numero, { estadoConversaAprovacao: 'aguardando_motivo_recusa' });

        const osAtualizada = db.obterOSPorNumero(os.numero) || os;
        const msgMotivoRecusa = mensagens.montarPedidoMotivoRecusa(
          { nome_cliente: osAtualizada.cliente?.nome || '', numero: osAtualizada.numero },
          config
        );
        await _enviarELogar({ tipo: 'pedido_motivo_recusa', os: osAtualizada, telefone, codigoPais, msg: msgMotivoRecusa });
        return;
      }

      // ── decisao === 'ambiguo' (ou IA indisponível): não entendida ────────
      // Conta mais uma tentativa. Na 2ª vez que a automação não conseguir
      // entender a resposta desta OS, para de insistir e encaminha para
      // atendimento humano em vez de reenviar a pergunta de novo.
      const osComTentativas = db.registrarRespostaNaoEntendida(os.numero);
      const tentativas = Number(osComTentativas?.tentativasSimNao) || 0;
      const LIMITE_TENTATIVAS_NAO_ENTENDIDA = 2;

      if (tentativas >= LIMITE_TENTATIVAS_NAO_ENTENDIDA) {
        db.registrarEscaladoAtendimentoHumano(os.numero, 'limite_tentativas', 'aguardando_sim_nao');

        const msgAtendente = mensagens.montarEncaminhadoAtendimentoHumano(
          { nome_cliente: os.cliente?.nome || '' },
          config
        );

        await _enviarELogar({
          tipo: 'encaminhado_atendimento_humano',
          os,
          telefone,
          codigoPais,
          msg: msgAtendente
        });
        return;
      }

      db.atualizarOS(os.numero, { estadoConversaAprovacao: 'aguardando_sim_nao' });

      const msgNaoEntendi = mensagens.montarNaoEntendiReenvio(
        { nome_cliente: os.cliente?.nome || '' },
        config
      );

      await _enviarELogar({
        tipo: 'nao_entendi_reenvio',
        os,
        telefone,
        codigoPais,
        msg: msgNaoEntendi
      });
      return;
    }

    // ── Estado: aguardando_motivo_recusa ────────────────────────────────────
    if (estado === 'aguardando_motivo_recusa') {

      db.atualizarOS(os.numero, {
        motivoRecusaTermos: texto,
        status: 'Cancelado',
        estadoConversaAprovacao: 'concluido'
      });

      const osAtualizada = db.obterOSPorNumero(os.numero) || os;
      const msgRecusaRegistrada = mensagens.montarRecusaRegistrada(
        { nome_cliente: osAtualizada.cliente?.nome || '', numero: osAtualizada.numero },
        config
      );

      await _enviarELogar({
        tipo: 'recusa_registrada',
        os: osAtualizada,
        telefone,
        codigoPais,
        msg: msgRecusaRegistrada
      });
      return;
    }

    // ── Estado: serviço exige pagamento antecipado de 50% ─────────────────
    if (estado === 'aguardando_escolha_pagamento_entrada') {
      await _processarEscolhaPagamentoEntrada({ os, texto, telefone, codigoPais, config });
      return;
    }

    // ── Estado: aguardando_forma_pagamento_retirada ─────────────────────────
    // Fase 5 — aberto pelo handler whatsapp:enviarProntoRetiradaComCobranca
    // (botão "Pronto para Retirada" na tela de edição da OS, que já dispara
    // a cobrança). Diferente do antigo 'aguardando_forma_pagamento' (v45,
    // removido), este só entra em cena na etapa de retirada, não logo após
    // o SIM ao orçamento.
    if (estado === 'aguardando_forma_pagamento_retirada') {

      // ── Atalho: cliente pediu atendente humano explicitamente ────────────
      // Mesmo padrão usado em aguardando_sim_nao — checado antes de qualquer
      // classificação, para nunca cair na lógica de forma de pagamento.
      if (_reconhecerPedidoAtendente(texto)) {
        db.registrarEscaladoAtendimentoHumano(os.numero, 'solicitado_pelo_cliente', 'aguardando_forma_pagamento_retirada');

        const msgAtendente = mensagens.montarEncaminhadoAtendimentoHumano(
          { nome_cliente: os.cliente?.nome || '' },
          config
        );

        await _enviarELogar({
          tipo: 'encaminhado_atendimento_humano',
          os,
          telefone,
          codigoPais,
          msg: msgAtendente
        });
        return;
      }

      // Pedido explícito do link: regenera e responde. "Pix" sozinho não entra
      // aqui; ele segue para a classificação normal logo abaixo.
      if (_mencionaFormaOnline(texto)) {
        const osAtualizada = db.obterOSPorNumero(os.numero) || os;
        const linkPagamento = await _gerarLinkMercadoPagoExistente(osAtualizada);
        const msgPagamento = mensagens.montarPedidoFormaPagamento({
          nome_cliente: osAtualizada.cliente?.nome || '',
          numero: osAtualizada.numero,
          link_pagamento: linkPagamento || '',
        }, config);
        await _enviarELogar({
          tipo: 'link_pagamento_reenviado',
          os: osAtualizada,
          telefone,
          codigoPais,
          msg: msgPagamento,
        });
        return;
      }

      // ── Qualquer outro texto → classifica a forma de pagamento (mesma
      // IA/fallback já usados em outros pontos do sistema) ─────────────────
      const resultadoForma = await iaGroq.classificarFormaPagamento(texto, {
        osNumero: os.numero,
        clienteNome: os.cliente?.nome || '',
        telefone,
        rotulosValidos: rotulosValidosFormaPagamento(),
        classificarPorRegras: _classificarFormaPagamentoManual,
      });

      const rotuloFormaPagamento = resultadoForma.rotulo;

      // ── Reconhecido: qualquer rótulo diferente de "Não informado" ────────
      if (rotuloFormaPagamento && rotuloFormaPagamento !== 'Não informado') {
        db.registrarFormaPagamento(os.numero, texto);
        db.atualizarOS(os.numero, {
          status: /aguardando aprova/i.test(String(os.status || '')) ? 'Em reparo' : os.status,
          statusPagamento: 'Aguardando Pagamento na Retirada',
          formaPagamento: rotuloFormaPagamento,
          estadoConversaAprovacao: 'concluido',
          contextoFormaPagamento: '',
        });

        const osAtualizada = db.obterOSPorNumero(os.numero) || os;
        const msgFormaRegistrada = mensagens.montarFormaPagamentoRetiradaRegistrada(
          {
            nome_cliente: osAtualizada.cliente?.nome || '',
            numero: osAtualizada.numero,
            forma_pagamento: rotuloFormaPagamento,
          },
          config
        );

        await _enviarELogar({
          tipo: 'forma_pagamento_retirada_registrada',
          os: osAtualizada,
          telefone,
          codigoPais,
          msg: msgFormaRegistrada
        });
        return;
      }

      // ── Não reconhecido ("Não informado") — mesmo padrão de tentativas/
      // limite usado em aguardando_sim_nao: 2 tentativas, depois escala. ────
      const osComTentativas = db.registrarRespostaNaoEntendida(os.numero);
      const tentativas = Number(osComTentativas?.tentativasSimNao) || 0;
      const LIMITE_TENTATIVAS_NAO_ENTENDIDA = 2;

      if (tentativas >= LIMITE_TENTATIVAS_NAO_ENTENDIDA) {
        db.registrarEscaladoAtendimentoHumano(os.numero, 'limite_tentativas', 'aguardando_forma_pagamento_retirada');

        const msgAtendente = mensagens.montarEncaminhadoAtendimentoHumano(
          { nome_cliente: os.cliente?.nome || '' },
          config
        );

        await _enviarELogar({
          tipo: 'encaminhado_atendimento_humano',
          os,
          telefone,
          codigoPais,
          msg: msgAtendente
        });
        return;
      }

      db.atualizarOS(os.numero, { estadoConversaAprovacao: 'aguardando_forma_pagamento_retirada' });

      const msgNaoEntendi = mensagens.montarNaoEntendiReenvio(
        { nome_cliente: os.cliente?.nome || '' },
        config
      );

      await _enviarELogar({
        tipo: 'nao_entendi_reenvio',
        os,
        telefone,
        codigoPais,
        msg: msgNaoEntendi
      });
      return;
    }

    // ── Estado: aguardando_humano ───────────────────────────────────────────
    // A conversa já foi encaminhada para um atendente (cliente pediu "1" ou
    // a automação esgotou as tentativas). O bot fica em silêncio aqui — quem
    // responde a partir daqui é a pessoa — exceto para reconhecer o "#" de
    // cancelamento, que devolve a conversa para o fluxo automático.
    if (estado === 'aguardando_humano') {

      if (_reconhecerCancelamentoAtendimento(texto)) {
        // BUGFIX (correcoesbugs.txt #2): precisa ler o estado de origem ANTES
        // de chamar cancelarAtendimentoHumano(), pois essa função já zera o
        // campo estadoOrigemEscalacaoHumana ao devolver a conversa. Antes desta
        // correção, o sistema sempre reenviava a pergunta de aceite de termos
        // (montarAguardandoAprovacao), mesmo quando a escalação tinha partido
        // da etapa de retirada — uma pergunta sobre uma etapa já concluída.
        const vinhaDaRetirada = os.estadoOrigemEscalacaoHumana === 'aguardando_forma_pagamento_retirada';

        db.cancelarAtendimentoHumano(os.numero);
        const osAtualizada = db.obterOSPorNumero(os.numero) || os;

        // ── Mensagem 1/2: confirma o cancelamento do atendimento humano ────
        const msgCancelado = mensagens.montarAtendimentoHumanoCancelado(
          { nome_cliente: osAtualizada.cliente?.nome || '' },
          config
        );
        await _enviarELogar({
          tipo: 'atendimento_humano_cancelado',
          os: osAtualizada,
          telefone,
          codigoPais,
          msg: msgCancelado
        });

        await _sleep(1200);

        if (vinhaDaRetirada) {
          // ── Mensagem 2/2 (etapa de retirada): reenvia a pergunta de forma
          // de pagamento, com o mesmo valor/link já usados na primeira vez.
          // Diferente do fluxo de termos, não depende de um snapshot separado
          // — o valor já está persistido em diagnosticoTecnico.valorEstimado
          // e o link do Mercado Pago é regenerado sob demanda.
          const linkPagamento = await _gerarLinkMercadoPagoExistente(osAtualizada);
          const valorFinal = parseFloat(osAtualizada?.diagnosticoTecnico?.valorEstimado) || parseFloat(osAtualizada?.valorInvestido) || 0;
          const msgRetirada = mensagens.montarProntoRetiradaComCobranca(
            {
              nome_cliente: osAtualizada.cliente?.nome || '',
              numero: osAtualizada.numero,
              marca: osAtualizada.aparelho?.marca || '',
              modelo: osAtualizada.aparelho?.modelo || '',
              valor: valorFinal.toFixed(2).replace('.', ','),
              link_pagamento: linkPagamento || ''
            },
            config
          );
          await _enviarELogar({
            tipo: 'pronto_retirada_reenvio',
            os: osAtualizada,
            telefone,
            codigoPais,
            msg: msgRetirada
          });
          return;
        }

        // ── Mensagem 2/2 (etapa de aceite): reenvia a pergunta de aceite dos
        // termos (SIM/NÃO). Usa o snapshot gravado quando a mensagem de
        // aprovação foi enviada pela primeira vez (marca/modelo/valor/prazo
        // digitados na tela de cobrança) — esses valores não ficam
        // armazenados em outro lugar da OS. Se por algum motivo o snapshot
        // não existir (ex.: OS de uma versão anterior à v40.4), envia mesmo
        // assim com os campos vazios; as linhas correspondentes do template
        // somem sozinhas.
        const snapshotAprovacao = osAtualizada.ultimaAprovacaoEnviada || {};
        const msgTermos = mensagens.montarAguardandoAprovacao(
          {
            nome_cliente: osAtualizada.cliente?.nome || '',
            numero: osAtualizada.numero,
            marca: snapshotAprovacao.marca || osAtualizada.aparelho?.marca || '',
            modelo: snapshotAprovacao.modelo || osAtualizada.aparelho?.modelo || '',
            valor: snapshotAprovacao.valor || '',
            prazo_reparo: snapshotAprovacao.prazoReparo || '',
            tem_pdf: ''
          },
          config
        );
        await _enviarELogar({
          tipo: 'aguardando_aprovacao_reenvio',
          os: osAtualizada,
          telefone,
          codigoPais,
          msg: msgTermos
        });
        return;
      }

      // Qualquer outro texto nesse estado é ignorado pelo bot — a conversa
      // está com um atendente humano.
      return;
    }

  } catch (e) {
    console.error('[WhatsApp] Erro no listener automático de mensagens:', e.message);
    try {
      db.registrarLogMensagem({
        tipo       : 'automacao_erro',
        osNumero   : '',
        clienteNome: '',
        telefone   : msg?.key?.remoteJid ? String(msg.key.remoteJid).split('@')[0] : '',
        mensagem   : '',
        sucesso    : false,
        erro       : e.message
      });
    } catch { /* ignora falha de log */ }
  }
}

function _resultadoConfirmacao(status) {
  if (status === STATUS_ERRO) {
    return { sucesso: false, statusEnvio: 'erro', erro: 'O WhatsApp recusou a mensagem antes de confirmá-la.' };
  }
  if (status >= STATUS_ACK_ENTREGUE) {
    return { sucesso: true, statusEnvio: 'entregue' };
  }
  return { sucesso: true, statusEnvio: 'aceito-servidor' };
}

function _aguardarConfirmacaoEnvio(idMensagem, statusInicial) {
  const statusConhecido = Math.max(
    Number.isFinite(statusInicial) ? statusInicial : -1,
    Number.isFinite(STATUS_MENSAGENS_ENVIADAS.get(idMensagem)) ? STATUS_MENSAGENS_ENVIADAS.get(idMensagem) : -1
  );
  if (statusConhecido === STATUS_ERRO || statusConhecido >= STATUS_ACK_SERVIDOR) {
    return Promise.resolve(_resultadoConfirmacao(statusConhecido));
  }

  return new Promise(function (resolve) {
    const timer = setTimeout(function () {
      CONFIRMACOES_PENDENTES.delete(idMensagem);
      resolve({
        sucesso: false,
        pendente: true,
        statusEnvio: 'pendente',
        erro: 'O WhatsApp não confirmou a mensagem em 15 segundos. Ela não será marcada como enviada; reconecte o WhatsApp e tente novamente.'
      });
    }, TEMPO_MAXIMO_ACK_MS);
    CONFIRMACOES_PENDENTES.set(idMensagem, { resolve, timer });
  });
}

function registrarListenerStatusMensagem() {
  if (!sock) return;
  sock.ev.on('messages.update', function (atualizacoes) {
    (atualizacoes || []).forEach(function (item) {
      const idMensagem = item?.key?.id;
      const status = item?.update?.status;
      if (!idMensagem || !Number.isFinite(status)) return;

      STATUS_MENSAGENS_ENVIADAS.set(idMensagem, status);
      if (STATUS_MENSAGENS_ENVIADAS.size > 500) {
        const primeiro = STATUS_MENSAGENS_ENVIADAS.keys().next().value;
        if (primeiro) STATUS_MENSAGENS_ENVIADAS.delete(primeiro);
      }

      const pendente = CONFIRMACOES_PENDENTES.get(idMensagem);
      if (!pendente || (status !== STATUS_ERRO && status < STATUS_ACK_SERVIDOR)) return;
      clearTimeout(pendente.timer);
      CONFIRMACOES_PENDENTES.delete(idMensagem);
      pendente.resolve(_resultadoConfirmacao(status));
    });
  });
}

function registrarListenerAutomatico() {
  if (!sock) return;

  // Baileys informa os vínculos entre o identificador anônimo (@lid) e o JID
  // com telefone por estes eventos. Registrar os dois formatos cobre tanto
  // contatos já sincronizados quanto números compartilhados em tempo real.
  sock.ev.on('chats.phoneNumberShare', function (dados) {
    _registrarMapeamentoLid(dados?.lid, dados?.jid);
  });
  const registrarContatos = function (contatos) {
    for (const contato of (contatos || [])) {
      _registrarMapeamentoLid(contato?.lid || (String(contato?.id || '').endsWith('@lid') ? contato.id : ''), contato?.jid);
    }
  };
  sock.ev.on('contacts.upsert', registrarContatos);
  sock.ev.on('contacts.update', registrarContatos);

  sock.ev.on('messages.upsert', function (upsert) {
    // Defesa adicional recomendada no aviso GHSA-qvv5-jq5g-4cgg. Um atacante
    // podia usar requestId em um protocolMessage para injetar um upsert falso.
    // A biblioteca ja corrige isso, mas o aplicativo tambem rejeita o evento
    // inteiro antes que ele alcance qualquer automacao de OS ou pagamento.
    if (upsert?.requestId) {
      console.warn('[WhatsApp][Seguranca] Evento messages.upsert suspeito foi descartado.');
      return;
    }
    const mensagensRecebidas = upsert?.messages || [];
    for (const msg of mensagensRecebidas) {
      // Eventos upsert podem chegar em paralelo. A fila faz o dedupe rodar
      // antes da próxima resposta e impede duas automações simultâneas.
      filaMensagensRecebidas = filaMensagensRecebidas.then(function () {
        return _tratarMensagemRecebida(msg);
      }).catch(function (e) {
        console.error('[WhatsApp] Erro ao processar mensagem:', e.message);
      });
    }
  });
}

// ─── Conexão principal ────────────────────────────────────────────────────────

async function conectar() {
  if (desconexaoSolicitada || reconnecting) return;
  reconnecting = true;

  // Safety timeout: se a conexão travar, libera a flag após 60s
  const safetyTimer = setTimeout(() => {
    if (reconnecting) {
      console.log('[WhatsApp] Safety timeout: liberando flag reconnecting');
      reconnecting = false;
    }
  }, 60000);

  try {
    const versaoBaileys = _validarVersaoSeguraBaileys();
    // ── import() dinâmico — único jeito de carregar ESM dentro de CJS ────────
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = await import('@whiskeysockets/baileys');

    const qrcode = require('qrcode');
    const pino   = require('pino');

    const sessionDir = SESSION_DIR();
    fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: [2, 3000, 1015901307],
    }));

    emitStatus('conectando');
    console.log(`[WhatsApp] Baileys seguro carregado: ${versaoBaileys}`);

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      browser: ['A&T Sistema OS', 'Chrome', '120.0.0'],
      logger: pino({ level: 'silent' }),
      // O Sistema OS processa somente mensagens novas. Desativar historico
      // automatico reduz a superficie do vetor de spoofing do CVE-2026-48063.
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
    });

    sock.ev.on('creds.update', saveCreds);
    registrarListenerStatusMensagem();

    // v36.3 — Listener automático de respostas (aprovação de termos via WhatsApp)
    registrarListenerAutomatico();

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const dataUrl = await qrcode.toDataURL(qr, { scale: 6, margin: 2 });
          emit('whatsapp:qr', dataUrl);
          emitStatus('aguardando-qr');
        } catch (e) {
          console.error('[WhatsApp] Erro ao gerar QR code:', e.message);
        }
        return;
      }

      if (connection === 'close') {
        reconnecting = false;
        clearTimeout(safetyTimer);

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const foiLogout  = statusCode === DisconnectReason.loggedOut;

        if (foiLogout) {
          console.log('[WhatsApp] Deslogado do aparelho. Sessão expirada — reiniciando...');
          limparSessao();
          // Notifica o usuário que a sessão expirou (não é só "desconectado" —
          // é preciso escanear o QR code de novo). O renderer pode mostrar
          // um toast/alerta mais informativo que "desconectado" genérico.
          emitStatus('sessao-expirada', {
            mensagem: 'Sessão do WhatsApp expirou. Escaneie o QR code novamente.',
            precisaQR: true
          });
          setTimeout(conectar, 2000);
        } else {
          console.log('[WhatsApp] Conexão perdida. Reconectando em 5s...');
          emitStatus('reconectando');
          setTimeout(conectar, 5000);
        }

      } else if (connection === 'open') {
        reconnecting = false;
        clearTimeout(safetyTimer);
        const numero = sock?.user?.id?.split(':')[0] || '';
        emitStatus('conectado', { numero });

      } else if (connection === 'connecting') {
        emitStatus('conectando');
      }
    });

  } catch (e) {
    console.error('[WhatsApp] Erro fatal ao inicializar:', e.message);
    reconnecting = false;
    clearTimeout(safetyTimer);
    emitStatus('erro', { mensagem: e.message });
    setTimeout(conectar, 10_000);
  }
}

// ─── Envio de mensagem ────────────────────────────────────────────────────────

// Verifica se o WhatsApp está de fato conectado (estado real do socket)
function estaConectado() {
  if (!sock || connectionStatus !== 'conectado') return false;
  // Verificação extra: se o socket foi fechado internamente sem atualizar connectionStatus
  try {
    // Baileys expõe ws.readyState; 1 = OPEN
    const ws = sock.ws;
    if (ws && typeof ws.readyState === 'number' && ws.readyState !== 1) {
      console.warn('[WhatsApp] Socket fechado (readyState=' + ws.readyState + ') mas status=' + connectionStatus + '. Corrigindo...');
      connectionStatus = 'desconectado';
      emitStatus('desconectado');
      return false;
    }
  } catch { /* ignora — nem todo socket expõe ws */ }
  return true;
}

function normalizarDestinoWhatsApp(tel, codigoPais = '55') {
  const codigo = String(codigoPais || '55').replace(/\D/g, '') || '55';
  const somenteDigitos = String(tel || '').replace(/\D/g, '');
  const numero = somenteDigitos.startsWith(codigo)
    ? somenteDigitos
    : `${codigo}${somenteDigitos}`;

  // E.164 aceita no máximo 15 dígitos. Para o Brasil, também impede que um
  // campo vazio ou incompleto seja marcado como "enviado" por engano.
  if (!somenteDigitos || numero.length < 10 || numero.length > 15) {
    return { sucesso: false, erro: 'Informe um telefone válido com DDD antes de enviar pelo WhatsApp.' };
  }

  return { sucesso: true, numero, jid: `${numero}@s.whatsapp.net` };
}

function normalizarNumeroDocumentoOS(numero) {
  let limpo = String(numero || '').trim();
  let anterior = null;
  while (limpo && limpo !== anterior) {
    anterior = limpo;
    limpo = limpo.replace(/^(?:OS)\s*(?:n(?:[º°o.]|ro\.?)?\s*)?[#:\-–—]*\s*/i, '').trim();
  }
  limpo = limpo.replace(/^[#:\-–—\s]+/, '');
  if (/^\d+$/.test(limpo)) limpo = limpo.padStart(4, '0');
  return limpo ? `OS-${limpo}` : 'OS';
}

async function resolverDestinoWhatsApp(tel, codigoPais = '55') {
  const destino = normalizarDestinoWhatsApp(tel, codigoPais);
  if (!destino.sucesso) return destino;

  const meuNumero = String(sock?.user?.id || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
  if (meuNumero && destino.numero === meuNumero) {
    return {
      sucesso: false,
      erro: 'O número informado é o mesmo WhatsApp conectado. Use o telefone do cliente.',
    };
  }

  if (typeof sock?.onWhatsApp !== 'function') {
    return { sucesso: false, erro: 'Não foi possível validar o número no WhatsApp. Reconecte o WhatsApp e tente novamente.' };
  }

  const encontrados = await sock.onWhatsApp(destino.numero);
  const encontrado = Array.isArray(encontrados)
    ? encontrados.find((item) => item && item.exists === true)
    : null;

  if (!encontrado) {
    return { sucesso: false, erro: 'Este telefone não possui uma conta ativa no WhatsApp.' };
  }

  return {
    sucesso: true,
    numero: destino.numero,
    // O WhatsApp pode devolver um JID canônico diferente do número digitado.
    // Sempre reutilizamos esse JID, inclusive nos PDFs anexados.
    jid: encontrado.jid || destino.jid,
  };
}

async function enviarAnexoConfirmado(jid, conteudo) {
  return _enfileirarEnvio(async function () {
    const enviado = await sock.sendMessage(jid, conteudo);
    if (!enviado?.key?.id) {
      throw new Error('O WhatsApp não retornou o identificador do anexo enviado.');
    }
    const confirmacao = await _aguardarConfirmacaoEnvio(enviado.key.id, enviado.status);
    if (!confirmacao.sucesso) {
      throw new Error(confirmacao.erro);
    }
    return enviado;
  });
}

async function enviarMensagem(tel, msg, codigoPais = '55') {
  if (!estaConectado()) {
    return {
      sucesso: false,
      erro: `WhatsApp ${connectionStatus === 'aguardando-qr' ? 'aguardando leitura do QR' : 'não conectado'}. Verifique o painel de status.`,
    };
  }

  try {
    return await _enfileirarEnvio(async function () {
      const destino = await resolverDestinoWhatsApp(tel, codigoPais);
      if (!destino.sucesso) return destino;

      const enviada = await sock.sendMessage(destino.jid, { text: msg });
      if (!enviada?.key?.id) {
        throw new Error('O WhatsApp não retornou o identificador da mensagem enviada.');
      }

      const confirmacao = await _aguardarConfirmacaoEnvio(enviada.key.id, enviada.status);
      if (!confirmacao.sucesso) {
        return {
          ...confirmacao,
          numero: destino.numero,
          jid: destino.jid,
          idMensagem: enviada.key.id,
        };
      }

      console.log(`[WhatsApp] Mensagem confirmada pelo servidor para ${destino.numero}`);
      return {
        sucesso: true,
        numero: destino.numero,
        jid: destino.jid,
        idMensagem: enviada.key.id,
        statusEnvio: confirmacao.statusEnvio,
      };
    });
  } catch (e) {
    console.error('[WhatsApp] Erro ao enviar mensagem:', e.message);
    return { sucesso: false, statusEnvio: 'erro', erro: e.message };
  }
}

// ─── Desconexão / logout manual ───────────────────────────────────────────────

async function desconectar() {
  desconexaoSolicitada = true;
  try {
    if (sock) {
      await sock.logout().catch(() => sock.end());
    }
  } catch { /* ignora */ }

  sock         = null;
  reconnecting = false;
  limparSessao();
  emitStatus('desconectado');
}

// ─── Registro dos canais IPC ──────────────────────────────────────────────────

function registrarIPC(ipcMain) {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('whatsapp:enviar', async (_e, tel, msg) => {
    return enviarMensagemRoteada(tel, msg);
  });

  ipcMain.handle('whatsapp:status', async () => {
    return { status: connectionStatus };
  });

  ipcMain.handle('whatsapp:desconectar', async () => {
    await desconectar();
    return { sucesso: true };
  });

  ipcMain.handle('whatsapp:reconectar', async () => {
    desconexaoSolicitada = false;
    if (sock) {
      try { sock.end(); } catch { }
      sock = null;
    }
    reconnecting = false;
    await conectar();
    return { sucesso: true };
  });

  ipcMain.handle('whatsapp:enviarAguardandoAprovacao', async (_e, dados) => {
    try {
      const { telefone, os, config, caminhoPdf } = dados;
      const codigoPais = (config.codigoPais || '55').replace(/\D/g, '') || '55';

      // Monta mensagem de aprovação com Sim/Não
      const msg = mensagens.montarAguardandoAprovacao(os, config);

      // Envia mensagem de texto primeiro
      const resultadoMsg = await enviarMensagemRoteada(telefone, msg, codigoPais);

      // Envia PDF como documento se disponível
      let resultadoPdf = { sucesso: true };
      if (resultadoMsg.sucesso && resultadoMsg.canal !== 'api' && caminhoPdf && fs.existsSync(caminhoPdf)) {
        try {
          if (!estaConectado()) throw new Error('WhatsApp desconectou durante o envio');
          const { jid, numero } = resultadoMsg;
          const bufPdf   = fs.readFileSync(caminhoPdf);
          await enviarAnexoConfirmado(jid, {
            document: bufPdf,
            mimetype: 'application/pdf',
            fileName: `${normalizarNumeroDocumentoOS(os.numero)}.pdf`,
            caption: `Ordem de Serviço #${os.numero} — Termos e Condições`
          });
          console.log(`[WhatsApp] PDF OS ${os.numero} enviado para ${numero}`);
        } catch (ePdf) {
          console.warn('[WhatsApp] Não foi possível enviar PDF:', ePdf.message);
          resultadoPdf = { sucesso: false, erro: ePdf.message };
        }
      }

      // Log no banco
      try {
        db.registrarLogMensagem({
          tipo       : 'aguardando_aprovacao',
          osNumero   : os.numero        || '',
          clienteNome: os.nome_cliente  || '',
          telefone   : telefone         || '',
          mensagem   : msg,
          sucesso    : resultadoMsg.sucesso,
          erro       : resultadoMsg.erro || null,
          statusEnvio: resultadoMsg.statusEnvio,
          idMensagem : resultadoMsg.idMensagem || ''
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log aprovação:', eLog.message); }

      return { ...resultadoMsg, pdfEnviado: resultadoPdf.sucesso, erroPdf: resultadoPdf.erro || null };

    } catch (e) {
      console.error('[WhatsApp] Erro ao enviar mensagem de aprovação:', e.message);
      try {
        db.registrarLogMensagem({
          tipo       : 'aguardando_aprovacao',
          osNumero   : dados?.os?.numero        || '',
          clienteNome: dados?.os?.nome_cliente  || '',
          telefone   : dados?.telefone          || '',
          mensagem   : '',
          sucesso    : false,
          erro       : e.message
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de falha (aprovação):', eLog.message); }
      return { sucesso: false, erro: e.message };
    }
  });

  ipcMain.handle('whatsapp:enviarCobranca', async (_e, dados) => {
    try {
      const { telefone, os, config, caminhoPdf, tipoFluxo } = dados;
      const codigoPais = (config.codigoPais || '55').replace(/\D/g, '') || '55';

      // Envolve o código Pix em monospace (``` ```) para aparecer azul/copiável no WhatsApp
      // Marca tem_pdf com base na existência real do arquivo, para a mensagem já
      // avisar sobre o PDF anexado (mesmo ele sendo enviado como documento em seguida).
      const temPdfReal = !!(caminhoPdf && fs.existsSync(caminhoPdf));
      const osComPixFormatado = {
        ...os,
        ...(os.codigo_pix ? { codigo_pix: '```' + os.codigo_pix + '```' } : {}),
        tem_pdf: temPdfReal,
      };

      // Monta e envia a mensagem de texto
      const msg = mensagens.montarCobranca(osComPixFormatado, config);
      console.log('[WhatsApp] Enviando cobrança para OS', os.numero);
      const resultado = await enviarMensagemRoteada(telefone, msg, codigoPais);

      // v45 — o fluxo de aprovação (tipoFluxo === 'aprovacao') não ativa mais
      // nenhuma automação de resposta aqui: o SIM/NÃO já é tratado pelo
      // handler whatsapp:enviarAguardandoAprovacao / estado
      // 'aguardando_sim_nao', e a forma de pagamento só é perguntada mais
      // tarde, na etapa de retirada (estado
      // 'aguardando_forma_pagamento_retirada'). O estado
      // 'aguardando_forma_pagamento' não existe mais na máquina de estados —
      // ativá-lo aqui deixaria a OS presa aguardando uma automação que nunca
      // mais roda (ver ESTADOS_AUTOMACAO_ATIVOS).

      // Envia PDF da OS como documento, se disponível
      let resultadoPdf = { sucesso: true };
      if (resultado.sucesso && resultado.canal !== 'api' && caminhoPdf && fs.existsSync(caminhoPdf)) {
        try {
          if (!estaConectado()) throw new Error('WhatsApp desconectou durante o envio');
          const { jid, numero } = resultado;
          const bufPdf   = fs.readFileSync(caminhoPdf);
          await enviarAnexoConfirmado(jid, {
            document: bufPdf,
            mimetype: 'application/pdf',
            fileName: `${normalizarNumeroDocumentoOS(os.numero)}.pdf`,
            caption: `Ordem de Serviço #${os.numero} — Pronto para retirada`
          });
          console.log(`[WhatsApp] PDF OS ${os.numero} (cobrança) enviado para ${numero}`);
        } catch (ePdf) {
          console.warn('[WhatsApp] Não foi possível enviar PDF da cobrança:', ePdf.message);
          resultadoPdf = { sucesso: false, erro: ePdf.message };
        }
      }

      // ── Log no banco ──
      try {
        db.registrarLogMensagem({
          tipo       : 'cobranca',
          osNumero   : os.numero        || '',
          clienteNome: os.nome_cliente  || '',
          telefone   : telefone         || '',
          mensagem   : msg,
          sucesso    : resultado.sucesso,
          erro       : resultado.erro   || null,
          statusEnvio: resultado.statusEnvio,
          idMensagem : resultado.idMensagem || ''
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de cobrança:', eLog.message); }

      return { ...resultado, pdfEnviado: resultadoPdf.sucesso, erroPdf: resultadoPdf.erro || null };

    } catch (e) {
      console.error('[WhatsApp] Erro ao montar mensagem de cobrança:', e.message);
      try {
        db.registrarLogMensagem({
          tipo       : 'cobranca',
          osNumero   : dados?.os?.numero        || '',
          clienteNome: dados?.os?.nome_cliente  || '',
          telefone   : dados?.telefone          || '',
          mensagem   : '',
          sucesso    : false,
          erro       : e.message
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de falha (cobrança):', eLog.message); }
      return { sucesso: false, erro: e.message };
    }
  });

  ipcMain.handle('whatsapp:enviarPagamentoConfirmado', async (_e, dados) => {
    try {
      const { telefone, os, config, caminhoPdf } = dados;
      const codigoPais = (config.codigoPais || '55').replace(/\D/g, '') || '55';
      const msg = mensagens.montarPagamentoConfirmado(os, config);
      console.log('[WhatsApp] Enviando confirmação de pagamento para OS', os.numero);
      const resultado = await enviarMensagemRoteada(telefone, msg, codigoPais);

      // Envia PDF do comprovante de pagamento como documento, se disponível
      let resultadoPdf = { sucesso: true };
      if (resultado.sucesso && resultado.canal !== 'api' && caminhoPdf && fs.existsSync(caminhoPdf)) {
        try {
          if (!estaConectado()) throw new Error('WhatsApp desconectou durante o envio');
          const { jid, numero } = resultado;
          const bufPdf   = fs.readFileSync(caminhoPdf);
          await enviarAnexoConfirmado(jid, {
            document: bufPdf,
            mimetype: 'application/pdf',
            fileName: `Comprovante-Pagamento-OS-${os.numero}.pdf`,
            caption: `Comprovante de Pagamento — ${normalizarNumeroDocumentoOS(os.numero)}`
          });
          console.log(`[WhatsApp] Comprovante de pagamento OS ${os.numero} enviado para ${numero}`);
        } catch (ePdf) {
          console.warn('[WhatsApp] Não foi possível enviar comprovante PDF:', ePdf.message);
          resultadoPdf = { sucesso: false, erro: ePdf.message };
        }
      }

      // ── Log no banco ──
      try {
        db.registrarLogMensagem({
          tipo       : 'pagamento_confirmado',
          osNumero   : os.numero        || '',
          clienteNome: os.nome_cliente  || '',
          telefone   : telefone         || '',
          mensagem   : msg,
          sucesso    : resultado.sucesso,
          erro       : resultado.erro   || null,
          statusEnvio: resultado.statusEnvio,
          idMensagem : resultado.idMensagem || ''
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de pagamento confirmado:', eLog.message); }

      return { ...resultado, pdfEnviado: resultadoPdf.sucesso, erroPdf: resultadoPdf.erro || null };
    } catch (e) {
      console.error('[WhatsApp] Erro ao montar mensagem de pagamento confirmado:', e.message);
      try {
        db.registrarLogMensagem({
          tipo       : 'pagamento_confirmado',
          osNumero   : dados?.os?.numero        || '',
          clienteNome: dados?.os?.nome_cliente  || '',
          telefone   : dados?.telefone          || '',
          mensagem   : '',
          sucesso    : false,
          erro       : e.message
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de falha (pagamento confirmado):', eLog.message); }
      return { sucesso: false, erro: e.message };
    }
  });

  // ── Envio manual do comprovante de Garantia (botão na aba Garantia) ──
  // Mesmo padrão de enviarPagamentoConfirmado/enviarAguardandoAprovacao:
  // mensagem de texto primeiro, depois o PDF como documento anexado.
  // `dados` já vem montado pelo renderer (telefone, garantia, config,
  // caminhoPdf) — este handler só formata e envia, sem consultar o banco.
  ipcMain.handle('whatsapp:enviarGarantia', async (_e, dados) => {
    try {
      const { telefone, garantia, config, caminhoPdf } = dados;
      const codigoPais = (config.codigoPais || '55').replace(/\D/g, '') || '55';

      const msg = mensagens.montarGarantia(garantia, config);

      // Envia mensagem de texto primeiro
      const resultado = await enviarMensagemRoteada(telefone, msg, codigoPais);

      // Envia o PDF da garantia como documento, se disponível
      // Só anexa depois que o telefone foi validado e a mensagem foi aceita
      // pelo servidor. Assim o documento nunca é enviado para um JID montado
      // às cegas a partir de um telefone inválido.
      let resultadoPdf = { sucesso: true };
      if (resultado.sucesso && resultado.canal !== 'api' && caminhoPdf && fs.existsSync(caminhoPdf)) {
        try {
          if (!estaConectado()) throw new Error('WhatsApp desconectou durante o envio');
          const { jid, numero } = resultado;
          const bufPdf   = fs.readFileSync(caminhoPdf);
          await enviarAnexoConfirmado(jid, {
            document: bufPdf,
            mimetype: 'application/pdf',
            fileName: `Garantia-${garantia.numero_os || ''}.pdf`,
            caption: `Comprovante de Garantia — ${normalizarNumeroDocumentoOS(garantia.numero_os || '')}`
          });
          console.log(`[WhatsApp] Comprovante de garantia OS ${garantia.numero_os} enviado para ${numero}`);
        } catch (ePdf) {
          console.warn('[WhatsApp] Não foi possível enviar PDF de garantia:', ePdf.message);
          resultadoPdf = { sucesso: false, erro: ePdf.message };
        }
      }

      // ── Log no banco ──
      try {
        db.registrarLogMensagem({
          tipo       : 'garantia',
          osNumero   : garantia.numero_os   || '',
          clienteNome: garantia.nome_cliente || '',
          telefone   : telefone              || '',
          mensagem   : msg,
          sucesso    : resultado.sucesso,
          erro       : resultado.erro || null,
          statusEnvio: resultado.statusEnvio,
          idMensagem : resultado.idMensagem || ''
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de garantia:', eLog.message); }

      return { ...resultado, pdfEnviado: resultadoPdf.sucesso, erroPdf: resultadoPdf.erro || null };
    } catch (e) {
      console.error('[WhatsApp] Erro ao enviar comprovante de garantia:', e.message);
      try {
        db.registrarLogMensagem({
          tipo       : 'garantia',
          osNumero   : dados?.garantia?.numero_os   || '',
          clienteNome: dados?.garantia?.nome_cliente || '',
          telefone   : dados?.telefone               || '',
          mensagem   : '',
          sucesso    : false,
          erro       : e.message
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de falha (garantia):', eLog.message); }
      return { sucesso: false, erro: e.message };
    }
  });

  ipcMain.handle('whatsapp:enviarEntregue', async (_e, dados) => {
    try {
      const { telefone, os, config } = dados;
      const codigoPais = (config.codigoPais || '55').replace(/\D/g, '') || '55';
      const msg = mensagens.montarEntregue(os, config);
      console.log('[WhatsApp] Enviando mensagem de entrega para', os.nome_cliente);
      const resultado = await enviarMensagemRoteada(telefone, msg, codigoPais);

      // ── Log no banco ──
      try {
        db.registrarLogMensagem({
          tipo       : 'entregue',
          osNumero   : os.numero        || '',
          clienteNome: os.nome_cliente  || '',
          telefone   : telefone         || '',
          mensagem   : msg,
          sucesso    : resultado.sucesso,
          erro       : resultado.erro   || null,
          statusEnvio: resultado.statusEnvio,
          idMensagem : resultado.idMensagem || ''
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de entregue:', eLog.message); }

      return resultado;
    } catch (e) {
      console.error('[WhatsApp] Erro ao montar mensagem de entrega:', e.message);
      try {
        db.registrarLogMensagem({
          tipo       : 'entregue',
          osNumero   : dados?.os?.numero        || '',
          clienteNome: dados?.os?.nome_cliente  || '',
          telefone   : dados?.telefone          || '',
          mensagem   : '',
          sucesso    : false,
          erro       : e.message
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de falha (entregue):', eLog.message); }
      return { sucesso: false, erro: e.message };
    }
  });

  ipcMain.handle('whatsapp:enviarProntoRetirada', async (_e, dados) => {
    try {
      const { telefone, os, config } = dados;
      const codigoPais = (config.codigoPais || '55').replace(/\D/g, '') || '55';
      const msg = mensagens.montarProntoRetirada(os, config);
      console.log('[WhatsApp] Enviando "Pronto para Retirada" para OS', os.numero);
      const resultado = await enviarMensagemRoteada(telefone, msg, codigoPais);

      // ── Log no banco ──
      try {
        db.registrarLogMensagem({
          tipo       : 'pronto_retirada',
          osNumero   : os.numero        || '',
          clienteNome: os.nome_cliente  || '',
          telefone   : telefone         || '',
          mensagem   : msg,
          sucesso    : resultado.sucesso,
          erro       : resultado.erro   || null,
          statusEnvio: resultado.statusEnvio,
          idMensagem : resultado.idMensagem || ''
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de pronto retirada:', eLog.message); }

      return resultado;
    } catch (e) {
      console.error('[WhatsApp] Erro ao montar mensagem de pronto para retirada:', e.message);
      try {
        db.registrarLogMensagem({
          tipo       : 'pronto_retirada',
          osNumero   : dados?.os?.numero        || '',
          clienteNome: dados?.os?.nome_cliente  || '',
          telefone   : dados?.telefone          || '',
          mensagem   : '',
          sucesso    : false,
          erro       : e.message
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de falha (pronto retirada):', eLog.message); }
      return { sucesso: false, erro: e.message };
    }
  });

  // ── Fase 5 — "Pronto para Retirada" COM cobrança ──────────────────────────
  // Reaproveita o mesmo botão de "Pronto para Retirada" na tela de edição da
  // OS, mas além de avisar o cliente já dispara a cobrança: gera o link do
  // Mercado Pago (mesma chamada de _gerarLinkMercadoPagoExistente usada em
  // mp:gerarPayload), envia a mensagem PRONTO_RETIRADA_COM_COBRANCA com valor
  // e link, e deixa a OS aguardando a forma de pagamento na retirada (estado
  // 'aguardando_forma_pagamento_retirada', tratado no listener automático
  // logo acima neste arquivo).
  //
  // `dados.valor`: se a OS ainda não tiver um valor de cobrança salvo
  // (os.diagnosticoTecnico.valorEstimado / os.valorInvestido), o valor
  // informado pelo renderer (pedido ao usuário antes do clique) é gravado
  // na OS antes de gerar o link — assim _gerarLinkMercadoPagoExistente (que
  // lê o valor direto da OS) já enxerga o valor certo.
  ipcMain.handle('whatsapp:enviarProntoRetiradaComCobranca', async (_e, dados) => {
    let osAtualParaLog = null;
    try {
      const { telefone, os, config, valor } = dados;
      const codigoPais = (config.codigoPais || '55').replace(/\D/g, '') || '55';

      let osAtual = db.obterOSPorNumero(os.numero);
      if (!osAtual) return { sucesso: false, erro: 'OS não encontrada.' };

      // Garante que a OS tenha um valor salvo antes de gerar o link — se
      // ainda não tiver (nem diagnosticoTecnico.valorEstimado nem
      // valorInvestido), usa o valor informado pelo chamador e persiste.
      const valorJaSalvo = parseFloat(osAtual?.diagnosticoTecnico?.valorEstimado) || parseFloat(osAtual?.valorInvestido) || 0;
      if (valorJaSalvo <= 0) {
        const valorInformado = parseFloat(valor);
        if (!valorInformado || valorInformado <= 0) {
          return { sucesso: false, erro: 'Informe um valor válido para gerar a cobrança.' };
        }
        osAtual = db.atualizarOS(os.numero, {
          diagnosticoTecnico: { ...(osAtual.diagnosticoTecnico || {}), valorEstimado: valorInformado }
        }) || db.obterOSPorNumero(os.numero);
      }
      osAtualParaLog = osAtual;

      const valorFinal = parseFloat(osAtual?.diagnosticoTecnico?.valorEstimado) || parseFloat(osAtual?.valorInvestido) || 0;

      // ── Gera o link de pagamento do Mercado Pago (reaproveita a mesma
      // geração já usada em mp:gerarPayload / mp:gerarLink) ──────────────────
      const linkPagamento = await _gerarLinkMercadoPagoExistente(osAtual);

      const msg = mensagens.montarProntoRetiradaComCobranca({
        nome_cliente  : os.nome_cliente || osAtual.cliente?.nome || '',
        numero        : os.numero,
        marca         : os.marca  || osAtual.aparelho?.marca  || '',
        modelo        : os.modelo || osAtual.aparelho?.modelo || '',
        valor         : valorFinal.toFixed(2).replace('.', ','),
        link_pagamento: linkPagamento || '',
      }, config);

      console.log('[WhatsApp] Enviando "Pronto para Retirada + Cobrança" para OS', os.numero);
      const resultado = await enviarMensagemRoteada(telefone, msg, codigoPais);

      // ── Atualiza a OS: pronta para retirada, aguardando pagamento, e a
      // automação passa a escutar a resposta de forma de pagamento ──────────
      if (resultado.sucesso) {
        _garantirCobrancaMercadoPagoRegistrada(osAtual, linkPagamento, telefone);
        osAtual = db.atualizarOS(os.numero, {
          status: 'Pronto para retirada',
          statusPagamento: 'Aguardando Pagamento',
          estadoConversaAprovacao: 'aguardando_forma_pagamento_retirada'
        }) || osAtual;
        osAtualParaLog = osAtual;
      }

      // ── Log no banco ──
      try {
        db.registrarLogMensagem({
          tipo       : 'pronto_retirada_com_cobranca',
          osNumero   : os.numero        || '',
          clienteNome: os.nome_cliente  || '',
          telefone   : telefone         || '',
          mensagem   : msg,
          sucesso    : resultado.sucesso,
          erro       : resultado.erro   || null,
          statusEnvio: resultado.statusEnvio,
          idMensagem : resultado.idMensagem || ''
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de pronto retirada com cobrança:', eLog.message); }

      return { ...resultado, linkPagamento: linkPagamento || null, valor: valorFinal };

    } catch (e) {
      console.error('[WhatsApp] Erro ao montar mensagem de pronto para retirada com cobrança:', e.message);
      try {
        db.registrarLogMensagem({
          tipo       : 'pronto_retirada_com_cobranca',
          osNumero   : dados?.os?.numero        || osAtualParaLog?.numero || '',
          clienteNome: dados?.os?.nome_cliente  || '',
          telefone   : dados?.telefone          || '',
          mensagem   : '',
          sucesso    : false,
          erro       : e.message
        });
      } catch (eLog) { console.warn('[WhatsApp] Erro ao salvar log de falha (pronto retirada com cobrança):', eLog.message); }
      return { sucesso: false, erro: e.message };
    }
  });
}

// ─── Envio de documento (PDF) — chamável diretamente do main.js ──────────────
/**
 * Envia um arquivo PDF como documento WhatsApp.
 *
 * @param {string} tel          Telefone do destinatário (só dígitos ou formatado)
 * @param {string} caminhoPdf   Caminho absoluto do PDF no disco
 * @param {string} nomeArquivo  Nome exibido no WhatsApp (ex: "Comprovante-OS-001.pdf")
 * @param {string} [codigoPais] Código do país sem '+' (padrão '55')
 * @returns {Promise<{sucesso: boolean, erro?: string}>}
 */
async function enviarDocumento(tel, caminhoPdf, nomeArquivo, codigoPais = '55') {
  if (!estaConectado()) {
    return {
      sucesso: false,
      erro: `WhatsApp ${connectionStatus === 'aguardando-qr' ? 'aguardando leitura do QR' : 'não conectado'}.`,
    };
  }
  try {
    const destino = await resolverDestinoWhatsApp(tel, codigoPais);
    if (!destino.sucesso) return destino;
    const { numero, jid } = destino;
    const bufPdf = fs.readFileSync(caminhoPdf);
    const enviada = await enviarAnexoConfirmado(jid, {
      document : bufPdf,
      mimetype : 'application/pdf',
      fileName : nomeArquivo,
      caption  : `${nomeArquivo.replace('.pdf', '').replace(/-/g, ' ')}`,
    });
    console.log(`[WhatsApp] Documento "${nomeArquivo}" confirmado pelo servidor para ${numero}`);
    return { sucesso: true, numero, jid, idMensagem: enviada.key.id, statusEnvio: 'aceito-servidor' };
  } catch (e) {
    console.error('[WhatsApp] Erro ao enviar documento:', e.message);
    return { sucesso: false, statusEnvio: 'erro', erro: e.message };
  }
}

// ─── Inicialização pública ────────────────────────────────────────────────────

function init(win, ipcMain) {
  mainWindow = win;
  if (initialized) return;
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('Ponte IPC segura indisponível.');
  initialized = true;
  registrarIPC(ipcMain);
  conectar();
  // O processo principal permanece ativo na bandeja. Este watchdog cobre
  // retomada do Windows, troca de rede e sockets que fecham sem emitir o
  // evento final esperado. Não interfere enquanto há conexão ou QR aberto.
  watchdogConexao = setInterval(() => {
    if (['conectado', 'conectando', 'aguardando-qr', 'sessao-expirada'].includes(connectionStatus)) return;
    conectar().catch((erro) => console.error('[WhatsApp] Falha no watchdog:', erro.message));
  }, 60_000);
  watchdogConexao.unref?.();
}

// v40.2 — expostos para src/ia-groq.js:
//  - classificarFormaPagamentoManualPorRegras: usado como FALLBACK sempre que
//    a classificação por IA (Groq) não está disponível ou falha — o sistema
//    de regras por palavras-chave continua existindo por inteiro, nunca foi
//    removido, só deixou de ser o caminho principal.
//  - rótulosValidosFormaPagamento(): lista de rótulos que a IA tem permissão
//    de retornar, para validar a resposta da API antes de confiar nela (a IA
//    nunca inventa uma categoria nova que o resto do sistema não conhece).
function rotulosValidosFormaPagamento() {
  const base = CATEGORIAS_FORMA_PAGAMENTO.map(c => c.rotulo);
  const combinados = [];
  for (const cat of CATEGORIAS_FORMA_PAGAMENTO) {
    for (const nome of NOMES_ESPECIFICOS_PAGAMENTO) {
      if (nome.categoriaBaseInferida === cat.rotulo) combinados.push(`${cat.rotulo} (${nome.nome})`);
    }
  }
  return [...base, ...combinados];
}

module.exports = {
  init, enviarMensagem, enviarDocumento,
  definirGeradorPreferenciaMercadoPago, definirRoteadorApiOficial,
  classificarFormaPagamentoManualPorRegras: _classificarFormaPagamentoManual,
  classificarEscolhaPagamentoEntradaPorRegras: _classificarEscolhaPagamentoEntrada,
  classificarIntencaoPagamentoEntradaPorRegras: _classificarIntencaoPagamentoEntradaPorRegras,
  rotulosValidosFormaPagamento,
  _normalizarDestinoWhatsApp: normalizarDestinoWhatsApp,
  _normalizarNumeroDocumentoOS: normalizarNumeroDocumentoOS,
  _resolverTelefoneMensagem: _resolverTelefoneMensagem,
  _registrarMapeamentoLid: _registrarMapeamentoLid,
  _processarAceiteTermos: _processarAceiteTermos,
  _processarEscolhaPagamentoEntrada: _processarEscolhaPagamentoEntrada,
  _tratarMensagemRecebida: _tratarMensagemRecebida,
};
