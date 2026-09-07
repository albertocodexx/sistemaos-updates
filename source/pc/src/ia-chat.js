// ══════════════════════════════════════════════════════════════════════════════
// src/ia-chat.js — Assistente de chat da IA (Groq) — v42.2
//
// CONTEXTO:
// Chatbot flutuante do sistema (botão arrastável, visível em todas as telas —
// ver renderer/index.html + renderer/renderer.js). O usuário faz uma pergunta
// em linguagem natural ("quantas OS estão atrasadas?", "como cadastro uma
// compra?") e este módulo monta um contexto com (1) o texto do manual
// (src/manual.html) e (2) um retrato compacto e atual dos dados do sistema
// (OS, clientes, estoque, compras, financeiro, conversas do WhatsApp), envia
// tudo pra Groq e devolve a resposta em texto livre.
//
// v42.1 BUGFIX (erro 413 "Request too large" até em "oi"): antes, TODA
// pergunta disparava uma única chamada com o manual inteiro + amostra de
// TODAS as categorias de dado juntas (~13,5k tokens fixos), estourando o
// limite de 8k tokens/min da Groq. Agora existe um roteador (ver
// _classificarCategoriasNecessarias) que faz uma 1ª chamada curta e barata
// (só a pergunta, sem manual/dados) pra decidir quais categorias de dado e
// se o manual são realmente necessários — a 2ª chamada (a que já existia)
// então monta só esse contexto reduzido. "oi" agora não carrega manual nem
// nenhuma categoria; perguntas específicas carregam só o que precisam.
//
// v42.2 OTIMIZAÇÕES EXTRAS (reduzir ainda mais o custo, sem tirar
// informação de nenhuma resposta que já funcionava):
// - "resumo" (números agregados) virou categoria do roteador em vez de
//   sempre incluído — pra "oi" nem isso entra mais.
// - Categorias não pedidas somem do JSON (antes ficavam como "[]").
// - Listas grandes (ordensRecentes, clientes, estoque, compras, whatsapp)
//   usam chaves curtas (n, st, cli, tel...) com uma legenda curta no prompt
//   de sistema — mesma informação, chave mais barata, repetida até 150x.
// - Histórico de conversa: 8→4 turnos, e cada turno agora tem limite próprio
//   de 500 chars (antes 2000) — chat de suporte não precisa reler parágrafos
//   inteiros de mensagens antigas.
// - maxTokens/reasoningEffort da resposta final agora escalam com a
//   pergunta: sem nenhuma categoria de dado nem manual (conversa fiada),
//   usa 250 tokens / reasoning 'low' em vez de 900 / 'medium'. Qualquer
//   pergunta com categoria e/ou manual envolvidos mantém os valores originais
//   — nenhuma resposta que já tinha contexto real perde espaço.
//
// REAPROVEITAMENTO (nada de novo foi criado onde já existia):
// - A chamada HTTP à Groq é a mesma de src/ia-groq.js (_chamarGroqAPI,
//   exportada como chamarGroqAPI) — mesmo timeout, mesmos headers, mesmo
//   tratamento de erro. O roteador da v42.1 usa essa mesma função, no mesmo
//   estilo das classificações curtas que já existiam nesse arquivo
//   (classificarFormaPagamento / classificarAceiteTermos).
// - Os dados vêm direto das funções já existentes em src/db.js (listarOrdens,
//   listarClientes, listarEstoque, listarPecas, listarCompras,
//   obterEstatisticasOS, obterEstatisticasDashboard, obterRelatorioFinanceiro,
//   listarLogMensagens) — nenhuma nova consulta/agregação foi escrita.
//
// GARANTIA: responderPergunta() nunca lança exceção — sempre resolve com
// { sucesso, resposta } ou { sucesso:false, erro }, mesmo padrão defensivo
// de ia-groq.js, pra nunca travar o widget do chat. Se o roteador falhar,
// cai de volta no comportamento anterior à v42.1 (contexto completo, 900
// tokens, reasoning 'medium') em vez de deixar a pergunta sem contexto ou
// com espaço de resposta insuficiente.
// ══════════════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { chamarIA, normalizarProvedor, PROVEDORES } = require('./ia-provider');
const { chamarGroqAPI } = require('./ia-groq');
const { enviarMensagem } = require('./whatsapp');
const { podeModulo, podeAcaoIA, podeCategoriaIA } = require('./access-policy');

const LIMITE_HISTORICO_TURNOS = 4;     // últimas N mensagens do histórico da conversa
const LIMITE_HISTORICO_CHARS = 500;    // por turno — v42.2: era 2000, sem limite dedicado
const LIMITE_MANUAL_CHARS = 20000;     // ~5k tokens — margem de segurança
const LIMITE_PERGUNTA_CHARS = 1000;
const MODELO_CHAT_COM_WEB = 'groq/compound-mini';

// A hora vem do relogio do PC, com fuso explicitamente brasileiro. Assim a
// resposta a "que horas sao?" nunca depende de memoria do modelo ou de uma
// pesquisa externa que pode estar atrasada.
function _obterDataHoraBrasil() {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full', timeStyle: 'medium', timeZone: 'America/Sao_Paulo'
  }).format(new Date());
}

function _perguntaEhHoraBrasil(pergunta) {
  const texto = String(pergunta || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(que horas|horas sao|hora atual|hora agora|horario atual|horario agora)\b/.test(texto)
    && (!texto.includes('outro pais') && !texto.includes('outro país'));
}

// Pesquisa externa so entra em perguntas explicitamente atuais. Perguntas
// sobre OS, clientes e financeiro continuam estritamente locais, sem levar
// dados do sistema para uma pesquisa na web.
function _perguntaEhDataBrasil(pergunta) {
  const texto = String(pergunta || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(que dia e hoje|qual a data|data de hoje|dia de hoje)\b/.test(texto);
}

function _respostaLocal(pergunta) {
  const saudacao = _normalizarBuscaLocal(pergunta);
  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|obrigado|obrigada)$/.test(saudacao)) {
    return /obrigad/.test(saudacao)
      ? 'Por nada! Se precisar, posso consultar OS, compras, estoque, clientes e financeiro.'
      : 'Olá! Como posso ajudar você hoje?';
  }
  if (_perguntaEhHoraBrasil(pergunta)) {
    return `Agora são ${new Intl.DateTimeFormat('pt-BR', {
      timeStyle: 'short', timeZone: 'America/Sao_Paulo'
    }).format(new Date())} (horário de Brasília).`;
  }
  if (_perguntaEhDataBrasil(pergunta)) {
    return `Hoje é ${new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'full', timeZone: 'America/Sao_Paulo'
    }).format(new Date())}.`;
  }
  return '';
}

function _normalizarBuscaLocal(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function _formatarNomeItemLocal(valor) {
  const nome = String(valor || '')
    .replace(/^(?:mais\s+)?(?:um|uma|outro|outra)\s+/i, '')
    .replace(/^(?:mais\s+)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : '';
}

function _extrairItensCustoLocal(pergunta) {
  let trecho = String(pergunta || '').trim();

  // Aceita tanto "... mais custos, flex 15, traseira 45" quanto
  // "... mais custos: flex 15, traseira 45". Quando há dois-pontos, ele é
  // sempre o delimitador da lista; assim a primeira peça não é descartada.
  const doisPontos = trecho.indexOf(':');
  if (doisPontos >= 0) {
    trecho = trecho.slice(doisPontos + 1);
  } else {
    const primeiraVirgula = trecho.indexOf(',');
    if (primeiraVirgula >= 0) trecho = trecho.slice(primeiraVirgula + 1);
  }

  // Remove a identificação da compra quando ela vem depois dos itens.
  trecho = trecho
    .replace(/\b(?:na|para\s+a|para)\s+compra\s+CP-\d+\b.*$/i, '')
    .replace(/\bCP-\d+\b/ig, '')
    .replace(/^(?:adicionar?|acrescentar?|incluir?|somar?|colocar?)\s+/i, '')
    .replace(/^(?:na\s+compra\s+[^,;]+\s+)?(?:mais\s+)?(?:custos?|pecas?|peças?|componentes?)\s*/i, '')
    .trim();

  // "flex 15 e traseira 45" deve se comportar como uma lista, assim como
  // a forma com vírgulas. Só divide no "e" quando há um valor à frente.
  // Também aceita "traseira 45 mais um flex 15", forma comum em mensagem
  // ditada, sem confundir o "mais 15" que introduz o valor do próprio item.
  trecho = trecho.replace(
    /(\d(?:[.,]\d{1,2})?)\s+(?=mais\s+(?:um|uma|outro|outra)\b)/gi,
    '$1, '
  );
  // E aceita a ordem invertida "mais 15 de outro flex power".
  trecho = trecho.replace(
    /\s+mais\s+(?:R\$\s*)?(\d+(?:[.,]\d{1,2})?)\s+de\s+(?=(?:um|uma|outro|outra)\b)/gi,
    ', $1 de '
  );
  trecho = trecho.replace(/\s+e\s+(?=[^,;]*?(?:R\$\s*)?\d+(?:[.,]\d{1,2})?(?:\s|$))/gi, ', ');

  return trecho.split(/[;,]+/).map(parte => {
    const limpa = parte.trim();
    const match = limpa.match(/^(.*?)(?:\s+(?:por|de|mais))?\s+(?:R\$\s*)?(\d+(?:[.,]\d{1,2})?)\s*$/i);
    const matchInvertido = !match
      ? limpa.match(/^(?:R\$\s*)?(\d+(?:[.,]\d{1,2})?)\s+(?:de\s+)?(.+)$/i)
      : null;
    if (!match && !matchInvertido) return null;
    const nome = _formatarNomeItemLocal(match ? match[1] : matchInvertido[2]);
    const valorTexto = String(match ? match[2] : matchInvertido[1]);
    const valor = Number(valorTexto.includes(',')
      ? valorTexto.replace(/\./g, '').replace(',', '.')
      : valorTexto);
    return nome && Number.isFinite(valor) && valor > 0 ? { nome, valor } : null;
  }).filter(Boolean).slice(0, 20);
}

function _localizarCompraDoPedidoLocal(pergunta, banco) {
  const compras = banco.listarCompras();
  const texto = _normalizarBuscaLocal(pergunta);
  const numeroInformado = String(pergunta || '').match(/\bCP\s*[-#]?\s*(\d+)\b/i);
  if (numeroInformado) {
    const numero = `CP-${numeroInformado[1].padStart(4, '0')}`;
    return { compra: banco.obterCompraPorNumero(numero), ambiguas: [] };
  }

  const textoCompacto = texto.replace(/\s+/g, '');
  const correspondencias = compras.filter(compra => {
    const aparelho = compra.aparelho || {};
    const modelo = _normalizarBuscaLocal(aparelho.modelo);
    const marcaModelo = _normalizarBuscaLocal([aparelho.marca, aparelho.modelo].filter(Boolean).join(' '));
    const palavrasModelo = modelo.split(/\s+/).filter(Boolean);
    const sufixosModelo = palavrasModelo.map((_item, indice) => palavrasModelo.slice(indice).join(''));
    const candidatos = [modelo, marcaModelo, ...sufixosModelo]
      .map(item => item.replace(/\s+/g, ''))
      .filter(item => item.length >= 3);
    return candidatos.some(item => textoCompacto.includes(item));
  });

  return {
    compra: correspondencias.length === 1 ? correspondencias[0] : null,
    ambiguas: correspondencias
  };
}

function _responderConsultaCompraLocal(pergunta, banco = db) {
  const texto = _normalizarBuscaLocal(pergunta);
  const numeroInformado = String(pergunta || '').match(/\bCP\s*[-#]?\s*(\d+)\b/i);
  const consultaFinanceira = /\b(gasto|gastos|gastei|custo|custos|total|investido|investimento|valor|pago|peca|pecas)\b/.test(texto);
  if (!numeroInformado || !consultaFinanceira) return null;

  const numero = `CP-${numeroInformado[1].padStart(4, '0')}`;
  const compra = banco.obterCompraPorNumero(numero);
  if (!compra) {
    return {
      sucesso: true,
      resposta: `Não encontrei a compra ${numero}.`,
      acaoProposta: null,
      origem: 'local'
    };
  }

  const dadosCompra = compra.dadosCompra || {};
  const valorAparelho = Number(dadosCompra.valor) || 0;
  const itens = Array.isArray(dadosCompra.pecasTrocar) ? dadosCompra.pecasTrocar : [];
  const custoPecas = Number(dadosCompra.custoPecas) || itens.reduce((total, item) => total + (Number(item?.valor) || 0), 0);
  const totalInvestido = Number(dadosCompra.custoTotal) || valorAparelho + custoPecas;
  const moeda = valor => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const aparelho = [compra.aparelho?.marca, compra.aparelho?.modelo].filter(Boolean).join(' ');
  const resumoItens = itens.length
    ? ` Custos cadastrados: ${itens.map(item => `${item.nome || 'Item'} (${moeda(item.valor)})`).join(', ')}.`
    : ' Não há peças ou custos adicionais cadastrados.';
  return {
    sucesso: true,
    resposta: `${numero}${aparelho ? ` — ${aparelho}` : ''}: compra ${moeda(valorAparelho)}, peças/custos ${moeda(custoPecas)} e total investido ${moeda(totalInvestido)}.${resumoItens}`,
    acaoProposta: null,
    origem: 'local'
  };
}

// Ações operacionais simples não devem depender da internet nem de o modelo
// obedecer perfeitamente ao formato JSON. Este interpretador cobre o pedido
// de acrescentar custos a uma compra e devolve a MESMA proposta revisável que
// o renderer já usa; a gravação continua exigindo confirmação do usuário.
function _interpretarAcaoLocal(pergunta, banco = db) {
  const texto = _normalizarBuscaLocal(pergunta);
  const pediuAdicionar = /\b(adicionar?|acrescentar?|incluir?|somar?|colocar?)\b/.test(texto);
  const falaDeCompra = /\b(compra|compras)\b/.test(texto);
  const falaDeCusto = /\b(custo|custos|peca|pecas|componente|componentes|gasto|gastos)\b/.test(texto);
  if (!pediuAdicionar || !falaDeCompra || !falaDeCusto) return null;

  const { compra, ambiguas } = _localizarCompraDoPedidoLocal(pergunta, banco);
  if (!compra) {
    if (ambiguas.length > 1) {
      const numeros = ambiguas.map(item => item.numero).filter(Boolean).join(', ');
      return {
        sucesso: true,
        resposta: `Encontrei mais de uma compra desse aparelho (${numeros}). Informe o número CP exato para eu alterar a compra correta.`,
        acaoProposta: null,
        origem: 'local'
      };
    }
    return {
      sucesso: true,
      resposta: 'Não encontrei essa compra. Informe o número da compra (por exemplo, CP-0003) ou o modelo exato do aparelho.',
      acaoProposta: null,
      origem: 'local'
    };
  }

  const itens = _extrairItensCustoLocal(pergunta);
  if (!itens.length) {
    return {
      sucesso: true,
      resposta: `Encontrei a ${compra.numero}, mas não consegui identificar os itens e valores. Escreva, por exemplo: "adicionar custos na compra ${compra.numero}, flex power 15, tampa traseira 45".`,
      acaoProposta: null,
      origem: 'local'
    };
  }

  const total = itens.reduce((soma, item) => soma + item.valor, 0);
  const resumo = itens.map(item => `${item.nome} (R$ ${item.valor.toFixed(2).replace('.', ',')})`).join(', ');
  return {
    sucesso: true,
    resposta: `Preparei a inclusão de ${resumo} na compra ${compra.numero}, totalizando R$ ${total.toFixed(2).replace('.', ',')}. Confira abaixo e confirme para salvar.`,
    acaoProposta: {
      tipo: 'adicionar_custos_compra',
      dados: { numero: compra.numero, itens }
    },
    origem: 'local'
  };
}

const STATUS_COBRANCA_VALIDOS = ['pendente', 'atrasada', 'paga', 'desativada'];

function _statusCobranca(item) {
  const salvo = _normalizarBuscaLocal(item?.status || '');
  if ((item?.confirmadoEm || item?.pagoEm) && salvo !== 'desativada') return 'paga';
  if (STATUS_COBRANCA_VALIDOS.includes(salvo)) return salvo;
  const limite = new Date(`${String(item?.data || '').slice(0, 10)}T23:59:59`);
  return Number.isFinite(limite.getTime()) && limite.getTime() < Date.now() ? 'atrasada' : 'pendente';
}

function _prepararStatusCobranca(item, novoStatus) {
  const agora = new Date().toISOString();
  const atualizado = { ...item, status: novoStatus, atualizadoEm: agora };
  if (novoStatus === 'paga') {
    atualizado.confirmadoEm = atualizado.confirmadoEm || agora;
    atualizado.pagoEm = atualizado.pagoEm || atualizado.confirmadoEm;
    atualizado.valorRecebido = Number(atualizado.valor || 0);
    atualizado.impactaRecebimento = atualizado.impactaRecebimento !== false;
    delete atualizado.desativadoEm;
  } else {
    delete atualizado.confirmadoEm;
    delete atualizado.pagoEm;
    delete atualizado.valorRecebido;
    delete atualizado.impactaRecebimento;
    if (novoStatus === 'desativada') atualizado.desativadoEm = agora;
    else delete atualizado.desativadoEm;
  }
  if (novoStatus === 'atrasada') atualizado.atrasadoEm = agora;
  else delete atualizado.atrasadoEm;
  return atualizado;
}

function _normalizarNumeroOS(numero) {
  const digitos = String(numero || '').replace(/\D/g, '');
  return digitos ? `OS-${digitos.padStart(4, '0')}` : '';
}

function _interpretarAcaoCobrancaLocal(pergunta, banco = db) {
  const texto = _normalizarBuscaLocal(pergunta);
  const pediuMudanca = /\b(marcar|mudar|alterar|colocar|definir|registrar|desativar|ativar|reativar|reabrir|cancelar)\b/.test(texto);
  if (!pediuMudanca || !/\bcobranca(s)?\b/.test(texto)) return null;

  let novoStatus = '';
  if (/\b(paga|pago|quitada|quitado|recebida|recebido)\b/.test(texto)) novoStatus = 'paga';
  else if (/\b(atrasada|atrasado|vencida|vencido)\b/.test(texto)) novoStatus = 'atrasada';
  else if (/\b(desativada|desativado|cancelada|cancelado|pausada|pausado)\b/.test(texto)) novoStatus = 'desativada';
  else if (/\b(pendente|reativar|reabrir|ativa|ativo)\b/.test(texto)) novoStatus = 'pendente';
  if (!novoStatus) return null;

  const numeroEncontrado = String(pergunta || '').match(/\bOS\s*[-#]?\s*(\d+)\b/i);
  if (!numeroEncontrado) {
    return { sucesso: true, resposta: 'Informe o número da OS da cobrança, por exemplo OS-0020.', acaoProposta: null, origem: 'local' };
  }
  const numero = _normalizarNumeroOS(numeroEncontrado[1]);
  const os = banco.obterOSPorNumero(numero);
  if (!os) return { sucesso: true, resposta: `Não encontrei a ${numero}.`, acaoProposta: null, origem: 'local' };
  const lembretes = Array.isArray(os.lembretesCobranca) ? os.lembretesCobranca : [];
  if (!lembretes.length) return { sucesso: true, resposta: `A ${numero} não tem cobranças programadas.`, acaoProposta: null, origem: 'local' };

  const dataCompleta = String(pergunta || '').match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  const diaEncontrado = dataCompleta ? Number(dataCompleta[1]) : Number(String(pergunta || '').match(/\bdia\s+(\d{1,2})\b/i)?.[1]);
  const informouDia = Number.isInteger(diaEncontrado) && diaEncontrado >= 1 && diaEncontrado <= 31;
  let candidatas = lembretes;
  if (informouDia) {
    candidatas = lembretes.filter(item => Number(String(item?.data || '').slice(8, 10)) === diaEncontrado);
  }
  if (candidatas.length !== 1) {
    const datas = lembretes.map(item => String(item?.data || '').slice(0, 10).split('-').reverse().join('/')).filter(Boolean).join(', ');
    return {
      sucesso: true,
      resposta: informouDia && candidatas.length > 1
        ? `Há mais de uma cobrança da ${numero} nessa data. Abra a OS para escolher a cobrança correta.`
        : `Informe qual cobrança da ${numero} deve mudar. Datas disponíveis: ${datas}.`,
      acaoProposta: null,
      origem: 'local'
    };
  }
  const alvo = candidatas[0];
  if (_statusCobranca(alvo) === novoStatus) {
    return { sucesso: true, resposta: `A cobrança da ${numero} em ${String(alvo.data).split('-').reverse().join('/')} já está ${novoStatus}.`, acaoProposta: null, origem: 'local' };
  }
  return {
    sucesso: true,
    resposta: `Preparei a alteração da cobrança da ${numero}, com vencimento em ${String(alvo.data).split('-').reverse().join('/')}, para ${novoStatus}. Confira e confirme abaixo.`,
    acaoProposta: {
      tipo: 'alterar_status_cobranca',
      dados: { numero, lembreteId: String(alvo.id || alvo.data), data: alvo.data, novoStatus }
    },
    origem: 'local'
  };
}

function _traduzirFalhaGroq(erro) {
  const detalhe = String(erro && erro.message ? erro.message : erro || '');
  const codigo = String(erro && erro.code || '');
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(codigo) || /getaddrinfo|enotfound|eai_again/i.test(detalhe)) {
    return 'Não foi possível localizar o serviço da IA na internet. Verifique a conexão ou o DNS e tente novamente em alguns segundos.';
  }
  if (/ECONNRESET|ECONNREFUSED|socket hang up|network/i.test(detalhe)) {
    return 'A conexão com a IA foi interrompida. Verifique a internet e tente novamente.';
  }
  if (/status 401|status 403/i.test(detalhe)) {
    return 'A chave da IA foi recusada. Confira a integração Groq nas Configurações.';
  }
  if (/status 429/i.test(detalhe)) {
    const espera = detalhe.match(/try again in\s+([^"}.]+)/i)?.[1]?.trim();
    return espera
      ? `A cota da Groq foi atingida. Tente novamente em ${espera}. Consultas básicas do sistema continuam funcionando sem usar essa cota.`
      : 'A cota da Groq foi atingida. Consultas básicas do sistema continuam funcionando localmente; para perguntas gerais, aguarde a liberação da conta Groq.';
  }
  if (/status 5\d\d/i.test(detalhe)) {
    return 'O serviço da IA está temporariamente indisponível. Tente novamente em alguns instantes.';
  }
  if (/Tempo limite/i.test(detalhe)) {
    return 'A IA demorou demais para responder. Verifique a conexão e tente novamente.';
  }
  return 'Não foi possível consultar a IA agora. Tente novamente.';
}

function _perguntaPedePesquisaWeb(pergunta) {
  if (_perguntaEhHoraBrasil(pergunta)) return false;
  const texto = String(pergunta || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(pesquis\w*|busc\w*|internet|web|noticia\w*|clima|previsao|cotacao|dolar|bitcoin|bolsa|hoje|agora|atual|ultimas?|presidente|governador|prefeito)\b/.test(texto);
}

// ─── Texto do manual (src/manual.html) sem HTML/CSS, em cache de memória ────
// O manual não muda em tempo de execução, então é lido e limpo uma única vez
// por sessão do app (evita reler/reprocessar o arquivo a cada pergunta).
let _manualTextoCache = null;
function _obterManualTexto() {
  if (_manualTextoCache !== null) return _manualTextoCache;
  try {
    const html = fs.readFileSync(path.join(__dirname, 'manual.html'), 'utf-8');
    const texto = html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    _manualTextoCache = texto.slice(0, LIMITE_MANUAL_CHARS);
  } catch (e) {
    console.warn('[IA-Chat] Não foi possível ler o manual:', e.message);
    _manualTextoCache = '';
  }
  return _manualTextoCache;
}

// ─── v42.1 — Categorias de dado que o roteador pode pedir ─────────────────
// Cada categoria mapeia pro pedaço de _montarContextoDados que ela liga.
// v42.2: "resumo" agora é uma categoria como as outras (antes era sempre
// incluída) — pra "oi" e conversa fiada, nem os números agregados entram
// mais, já que não têm relação nenhuma com a pergunta.
const CATEGORIAS_CONTEXTO = [
  'resumo', 'os', 'clientes', 'estoque', 'pecas', 'compras',
  'entregas', 'garantias', 'financeiro', 'whatsapp'
];

// ─── Retrato compacto e atual dos dados do sistema ────────────────────────
// Amostra recente de cada área (não o banco inteiro) para manter o contexto
// enxuto e rápido. Cada bloco usa uma função que já existe em db.js.
//
// v42.1 BUGFIX (causa raiz de "oi" custar 13k+ tokens): antes, TODAS as
// categorias abaixo eram sempre montadas e enviadas pra Groq, pergunta
// fizesse sentido pra elas ou não. Agora `categorias` (vindo do roteador —
// ver _classificarCategoriasNecessarias) decide quais blocos entram. Se
// vier undefined/null, monta tudo (usado pelo fallback, quando o roteador
// falha — nunca deixamos a pergunta sem contexto nenhum por causa disso).
//
// v42.2 — três otimizações extras de tokens, todas só no formato dos dados
// que já eram enviados (nenhuma informação a menos chega pro modelo quando
// uma categoria está incluída):
// 1. resumoGeral agora é a categoria "resumo" (antes era sempre incluído,
//    mesmo pra "oi" — ver CATEGORIAS_CONTEXTO acima).
// 2. Categorias não pedidas nem aparecem no JSON (antes entravam como "[]",
//    o que ainda gasta ~4-6 tokens de chave+colchetes por categoria vazia).
// 3. Listas grandes (ordensRecentes, clientes, estoque, comprasRecentes,
//    conversasWhatsappRecentes) usam chaves curtas — essas chaves se repetem
//    uma vez por item (até 150x), então cada caractere cortado da chave
//    economiza uma vez por linha. Uma legenda curta no prompt de sistema
//    (ver _montarPromptSistema) explica o significado de cada chave pro
//    modelo, então nenhuma informação se perde, só o rótulo fica mais curto.
function _montarContextoDados(categorias, usuario) {
  const quer = (c) => podeCategoriaIA(usuario, c) && (!categorias || categorias.includes(c));
  const ctx = {};

  if (quer('resumo')) {
    const dashboard = db.obterEstatisticasDashboard();
    const statsOS = db.obterEstatisticasOS();
    const financeiro = db.obterRelatorioFinanceiro();
    ctx.resumoGeral = {
      totalOS: statsOS.totalOS, osAbertas: statsOS.abertas, osFinalizadas: statsOS.finalizadas,
      osAtrasadas: statsOS.atrasadas, porStatus: statsOS.porStatus,
      aguardandoPagamento: statsOS.aguardandoPagamento, totalPagoRecente: statsOS.totalPago,
      topMarcas: statsOS.topMarcas, topDefeitos: statsOS.topDefeitos,
      valorTotalEstoque: dashboard.valorTotalEstoque, lucroPotencialEstoque: dashboard.lucroPotencial,
      pecasCriticas: dashboard.pecasCriticas, pecasZeradas: dashboard.pecasZeradas,
      financeiroMesAtual: {
        entradas: financeiro.entradas, saidas: financeiro.saidas, lucroLiquido: financeiro.lucroLiquido,
        qtdOsEntregues: financeiro.qtdOsEntregues, qtdAparelhoVendidos: financeiro.qtdAparelhoVendidos,
        historicoUltimos6Meses: financeiro.historico
      }
    };
  }

  // Chaves curtas: n=numero, d=data, st=status, sp=statusPagamento,
  // cli=cliente, tel=telefone, ap=aparelho, def=defeito, vl=valor,
  // dp=dataPrevista, atr=atrasada
  if (quer('os')) {
    ctx.ordensRecentes = db.listarOrdens().slice(0, 60).map(os => ({
      n: os.numero, d: os.data, st: os.status, sp: os.statusPagamento,
      cli: os.cliente?.nome, tel: os.cliente?.telefone,
      ap: [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' '),
      def: os.aparelho?.defeitoRelatado, vl: os.valorInvestido,
      dp: os.dataPrevista, atr: !!os.atrasada,
      cob: (os.lembretesCobranca || []).slice(0, 12).map(item => ({
        id: item.id || item.data, d: item.data, vl: Number(item.valor || 0), st: _statusCobranca(item)
      }))
    }));
  }

  // Chaves curtas: n=nome, tel=telefone, cpf=cpf, os=totalOS, vd=totalVendas,
  // cp=totalCompras, int=qtdInteracoes, uv=ultimaVisita
  if (quer('clientes')) {
    ctx.clientes = db.listarClientes().slice(0, 150).map(c => ({
      n: c.nome, tel: c.telefone, cpf: c.cpf,
      os: c.totalOS, vd: c.totalVendas, cp: c.totalCompras,
      int: c.qtdInteracoes, uv: c.ultimaData
    }));
  }

  // Chaves curtas: tp=tipo, mc=marca, md=modelo, st=status, vv=valorVenda,
  // cp=compradorNome
  if (quer('estoque')) {
    ctx.estoque = db.listarEstoque().slice(0, 100).map(e => ({
      tp: e.tipoEquipamento, mc: e.marca, md: e.modelo, st: e.status,
      vv: e.valorVenda, cp: e.compradorNome || undefined
    }));
  }

  if (quer('pecas')) {
    try {
      // Chaves curtas: n=nome, cat=categoria, qt=quantidade, ct=custo
      ctx.pecas = db.listarPecas().slice(0, 100).map(p => ({
        n: p.nome, cat: p.categoria, qt: p.quantidade, ct: p.custo
      }));
    } catch (e) { /* módulo de peças é opcional em bancos antigos */ }
  }

  // Chaves curtas: n=numero, d=data, vd=vendedor, ap=aparelho, vl=valor,
  // cp=custos adicionais e it=itens. Fotos, PDF e assinaturas não entram.
  if (quer('compras')) {
    ctx.comprasRecentes = db.listarCompras().slice(0, 40).map(c => ({
      n: c.numero, d: c.data, vd: c.vendedor?.nome,
      ap: [c.aparelho?.marca, c.aparelho?.modelo].filter(Boolean).join(' '),
      vl: c.dadosCompra?.valor,
      cp: Number(c.dadosCompra?.custoPecas || 0),
      it: (c.dadosCompra?.pecasTrocar || []).slice(0, 12).map(item => ({
        n: item.nome, vl: Number(item.valor || 0)
      }))
    }));
  }

  if (quer('entregas')) {
    try {
      // n=numeroOS, cli=cliente/retirou, ap=aparelho, dh=dataHora,
      // gd=garantiaDias, dl=dataLimite
      ctx.entregasRecentes = db.listarEntregas().slice(0, 40).map(e => ({
        n: e.numeroOS, cli: e.nomeRetirou,
        ap: [e.marca, e.modelo].filter(Boolean).join(' '),
        dh: e.dataHoraAssinatura, gd: e.garantiaDias, dl: e.dataLimiteGarantia
      }));
    } catch (e) { /* bancos antigos podem ainda não ter entregas */ }
  }

  if (quer('garantias')) {
    try {
      // n=numeroOS, cli=cliente, ap=aparelho, di=inicio, dl=limite, gd=dias
      ctx.garantiasRecentes = db.listarGarantias().slice(0, 40).map(g => ({
        n: g.numeroOS, cli: g.clienteNome || g.nomeCliente,
        ap: [g.marca, g.modelo].filter(Boolean).join(' '),
        di: g.dataInicio || g.criadoEm, dl: g.dataLimite, gd: g.garantiaDias
      }));
    } catch (e) { /* módulo opcional em bancos antigos */ }
  }

  if (quer('financeiro')) {
    try {
      const rel = db.obterRelatorioFinanceiro();
      ctx.financeiro = {
        e: rel.entradas, s: rel.saidas, l: rel.lucroLiquido,
        pagamentos: db.listarPagamentos().slice(0, 30).map(p => ({
          d: p.dataPagamento, os: p.osNumero, cli: p.clienteNome,
          vl: p.valor, fp: p.formaPagamento || p.metodo, st: p.status
        })),
        cobrancas: db.listarCobrancas().slice(0, 30).map(c => ({
          d: c.criadoEm, os: c.osNumero, cli: c.clienteNome,
          vl: c.valor, st: c.status
        }))
      };
    } catch (e) { /* financeiro nunca deve impedir o restante da resposta */ }
  }

  if (quer('whatsapp')) {
    try {
      // Chaves curtas: d=data, tp=tipo, os=osNumero, cli=clienteNome,
      // tel=telefone, msg=mensagem, ok=sucesso
      ctx.conversasWhatsappRecentes = db.listarLogMensagens({ limite: 60 }).map(m => ({
        d: m.data, tp: m.tipo, os: m.osNumero, cli: m.clienteNome,
        tel: m.telefone, msg: (m.mensagem || '').slice(0, 300), ok: m.sucesso
      }));
    } catch (e) { /* nunca deve derrubar o contexto por falha no log de mensagens */ }
  }

  return ctx;
}

// ─── v42 — Ações que a IA pode propor sobre OS (e mensagens WhatsApp) ─────
// A IA NUNCA executa nada sozinha: ela só pode devolver uma PROPOSTA de ação
// (bloco ```acao_os``` em JSON), que o renderer sempre mostra ao usuário como
// confirmação explícita antes de chamar ia:executarAcao (main.js), que por
// sua vez só chama as mesmas funções de db.js já usadas pelos formulários
// manuais (db.criarOS / db.atualizarOS / db.excluirOS) ou, para propostas de
// mensagem de WhatsApp, whatsapp.enviarMensagem — nenhuma lógica de
// escrita/envio nova é criada aqui, só orquestração. Para mensagem de
// WhatsApp em especial, a proposta inclui o texto sugerido, que o usuário
// pode editar no renderer antes de confirmar o envio.
const STATUS_OS_VALIDOS = require('./db').STATUS_OS_VALIDOS;

// v42.1: manualTexto agora pode ser null (roteador decidiu que a pergunta
// não precisa do manual) — nesse caso a seção 1 nem entra no prompt, em vez
// de mandar até 20k caracteres de manual pra perguntas como "oi" ou "quantas
// OS estão atrasadas?", que não têm nada a ver com "como usar a tela X".
function _montarPromptSistema(contextoJson, manualTexto, categorias, pesquisaWebHabilitada) {
  const listaStatus = STATUS_OS_VALIDOS.map(s => `- ${s}`).join('\n');
  const temManual = typeof manualTexto === 'string' && manualTexto.length > 0;
  const dataHoraBrasil = _obterDataHoraBrasil();
  const notaPesquisaWeb = pesquisaWebHabilitada
    ? '\nNesta pergunta, a pesquisa na web esta habilitada. Se precisar de informacao atual, use a busca integrada; nunca use a web para procurar dados de clientes, OS, pagamentos ou qualquer dado do sistema.\n'
    : '';

  const secaoManual = temManual ? `1) MANUAL DO SISTEMA (explica como usar cada tela e funcionalidade):
"""
${manualTexto}
"""

2) ` : '1) ';

  const notaSemManual = temManual ? '' : `\n(Nesta pergunta o manual do sistema não foi carregado, por não parecer necessário. Se, ao responder, você perceber que precisava dele — por exemplo o usuário pergunta "como faço X" — diga que pode explicar melhor se ele reformular a pergunta pedindo instruções de uso.)\n`;

  // v42.2: legenda das chaves compactas usadas nas listas do JSON (ver
  // _montarContextoDados) — só entra quando pelo menos uma lista com chaves
  // curtas está presente no contexto, pra não gastar tokens à toa quando o
  // contexto é só o resumo (ou está vazio, ex. "oi").
  const LEGENDAS = {
    os: 'ordensRecentes: n=número, d=data, st=status, sp=statusPagamento, cli=cliente, tel=telefone, ap=aparelho, def=defeito relatado, vl=valor, dp=dataPrevista, atr=atrasada, cob=cobranças programadas (id, d=data, vl=valor, st=situação)',
    clientes: 'clientes: n=nome, tel=telefone, cpf=cpf, os=totalOS, vd=totalVendas, cp=totalCompras, int=qtdInteracoes, uv=últimaVisita',
    estoque: 'estoque: tp=tipo, mc=marca, md=modelo, st=status, vv=valorVenda, cp=compradorNome',
    pecas: 'pecas: n=nome, cat=categoria, qt=quantidade, ct=custo',
    compras: 'comprasRecentes: n=número, d=data, vd=vendedor, ap=aparelho, vl=valor pago no aparelho, cp=custos adicionais, it=itens de custo (n=nome, vl=valor)',
    entregas: 'entregasRecentes: n=número da OS, cli=quem retirou, ap=aparelho, dh=data/hora, gd=dias de garantia, dl=data limite',
    garantias: 'garantiasRecentes: n=número da OS, cli=cliente, ap=aparelho, di=início, dl=limite, gd=dias',
    financeiro: 'financeiro: e=entradas, s=saídas, l=lucro; pagamentos/cobranças: d=data, os=número da OS, cli=cliente, vl=valor, fp=forma de pagamento, st=status',
    whatsapp: 'conversasWhatsappRecentes: d=data, tp=tipo, os=número da OS, cli=cliente, tel=telefone, msg=mensagem, ok=sucesso'
  };
  const legendasAtivas = (categorias && Array.isArray(categorias) ? categorias : Object.keys(LEGENDAS))
    .filter(c => LEGENDAS[c]);
  const notaLegendas = legendasAtivas.length
    ? `\nCHAVES ABREVIADAS usadas nas listas do JSON acima (pra economizar espaço — o significado de cada uma é este, use os nomes por extenso ao responder ao usuário):\n${legendasAtivas.map(c => `- ${LEGENDAS[c]}`).join('\n')}\n`
    : '';

  return `Você é o assistente virtual embutido no "Sistema OS", um sistema de gestão para assistências técnicas (Ordens de Serviço, clientes, estoque, peças, compras, entregas, garantias, financeiro e automação de atendimento por WhatsApp).

Você tem acesso a estas fontes de informação:

${secaoManual}DADOS ATUAIS DO SISTEMA (amostra recente em JSON: somente as áreas relevantes para a pergunta; categorias sem relação não aparecem):
"""
${contextoJson}
"""
DATA E HORA ATUAL NO BRASIL (fonte: relogio deste computador, fuso America/Sao_Paulo):
"""
${dataHoraBrasil}
"""
${notaLegendas}${notaSemManual}${notaPesquisaWeb}
REGRAS PARA RESPONDER PERGUNTAS:
- Responda sempre em português do Brasil, de forma direta, curta e prática. Use listas quando ajudar a organizar a resposta.
- Perguntas sobre "como fazer", "onde fica" ou "o que significa" algo no sistema: responda com base no MANUAL.
- Perguntas sobre números, OS, clientes, estoque, compras, financeiro ou conversas específicas: responda com base nos DADOS ATUAIS.
- Os dados fornecidos são uma AMOSTRA recente e limitada (não o banco completo). Se a pergunta exigir um dado que claramente não está na amostra, diga isso em vez de inventar.
- Nunca invente números, nomes, valores ou instruções que não estejam nas fontes acima.
- Se não encontrar a resposta em nenhuma das duas fontes, diga isso claramente.
- Para perguntas sobre a hora ou data atual no Brasil, use exatamente a DATA E HORA ATUAL NO BRASIL acima; não estime nem use conhecimento antigo.
- Quando a pesquisa na web estiver habilitada, use-a apenas para fatos externos e atuais; deixe claro quando não encontrar uma fonte confiável.

REGRAS PARA AÇÕES SEGURAS DO SISTEMA:
Você PODE propor (nunca executar) as seguintes ações, quando o usuário pedir algo equivalente a isso:
- criar_os: nova Ordem de Serviço.
- alterar_status_os: mudar o status técnico de uma OS existente.
- excluir_os: excluir definitivamente uma OS existente.
- enviar_mensagem_whatsapp: enviar uma mensagem de texto pelo WhatsApp para o cliente de uma OS.
- adicionar_custos_compra: acrescentar peças ou outros custos a uma compra existente, preservando os valores anteriores.
- alterar_status_cobranca: mudar a situação de uma cobrança programada de uma OS para pendente, atrasada, paga ou desativada.

Status técnicos válidos (use exatamente um destes em "novoStatus"):
${listaStatus}

Quando (e SOMENTE quando) identificar um pedido claro de ação, responda com:
1. Uma frase curta em português confirmando o que você entendeu que precisa ser feito (isso será mostrado ao usuário antes de qualquer confirmação).
2. Em seguida, em uma linha separada, um bloco de código com a etiqueta "acao_os" contendo APENAS um JSON válido, sem comentários, no formato exato de uma das opções abaixo:

Para criar OS (use apenas os campos que o usuário informou; nome do cliente e defeito relatado são o mínimo necessário — se faltar alguma informação essencial, NÃO gere o bloco, apenas pergunte ao usuário o que falta):
\`\`\`acao_os
{"tipo":"criar_os","cliente":{"nome":"...","telefone":"...","cpf":"..."},"aparelho":{"marca":"...","modelo":"...","defeitoRelatado":"..."},"observacoes":"..."}
\`\`\`

Para alterar status (numero é o número exato da OS, ex. "OS-0123"; novoStatus deve ser EXATAMENTE um da lista acima):
\`\`\`acao_os
{"tipo":"alterar_status_os","numero":"OS-0000","novoStatus":"..."}
\`\`\`

Para excluir (numero é o número exato da OS):
\`\`\`acao_os
{"tipo":"excluir_os","numero":"OS-0000"}
\`\`\`

Para enviar mensagem de WhatsApp (numero é o número exato da OS cujo cliente vai receber; mensagem é o texto sugerido, que o usuário poderá editar antes de confirmar o envio):
\`\`\`acao_os
{"tipo":"enviar_mensagem_whatsapp","numero":"OS-0000","mensagem":"..."}
\`\`\`

Para acrescentar custos a uma compra existente (numero é o CP exato encontrado nos DADOS ATUAIS; cada item precisa de nome e valor positivo; preserve custos que já existem):
\`\`\`acao_os
{"tipo":"adicionar_custos_compra","numero":"CP-0000","itens":[{"nome":"Flex power","valor":15},{"nome":"Tampa traseira","valor":45}]}
\`\`\`

Para mudar a situação de uma cobrança programada (numero é a OS exata; data identifica a cobrança; novoStatus aceita somente pendente, atrasada, paga ou desativada):
\`\`\`acao_os
{"tipo":"alterar_status_cobranca","numero":"OS-0000","data":"2026-08-29","novoStatus":"paga"}
\`\`\`

REGRAS IMPORTANTES SOBRE AÇÕES:
- Só gere o bloco "acao_os" quando o pedido do usuário for inequivocamente uma intenção de criar, editar, excluir ou enviar algo — nunca para perguntas informativas.
- Ao alterar status, excluir ou enviar mensagem, o número da OS deve ser identificável com certeza (informado diretamente pelo usuário, ou localizável de forma inequívoca nos DADOS ATUAIS pelo nome do cliente). Se houver mais de uma OS possível para o mesmo cliente, ou nenhuma correspondência clara, NÃO gere o bloco — em vez disso, pergunte ao usuário qual número de OS ele quer dizer.
- Ao adicionar custos, a compra também deve ser identificada com certeza pelo número CP ou por uma única correspondência de aparelho. Se houver mais de uma compra possível, pergunte qual delas; nunca crie outra compra para representar custos de uma compra que já existe.
- Gere no máximo UM bloco "acao_os" por resposta.
- Nunca diga que a ação já foi feita — ela ainda depende de confirmação (e, em caso de exclusão, de senha) do próprio usuário depois da sua resposta. Para mensagem de WhatsApp, deixe claro que é uma SUGESTÃO de texto que o usuário pode editar antes de decidir enviar. Fale sempre no futuro/condicional (ex.: "Vou preparar a exclusão da OS-0123 para sua confirmação.", "Preparei uma sugestão de mensagem para você revisar antes de enviar.").
- Fora do bloco JSON, nunca inclua a palavra "acao_os" nem explique o formato técnico ao usuário.`;
}

// Extrai um bloco ```acao_os {...}``` da resposta em texto livre da IA, se
// houver. Retorna { textoLimpo, acao } — textoLimpo é o texto sem o bloco
// (o que efetivamente é mostrado como a "fala" da IA), e acao é o objeto já
// validado ou null se não houver ação, se o JSON for inválido, ou se o tipo/
// campos não baterem com o esperado (nesse caso a ação é descartada em
// silêncio e só o texto é mostrado — nunca deixamos passar uma ação
// malformada adiante).
function _extrairAcaoProposta(textoResposta) {
  const regex = /```acao_os\s*([\s\S]*?)```/i;
  const m = textoResposta.match(regex);
  if (!m) return { textoLimpo: textoResposta.trim(), acao: null };

  const textoLimpo = textoResposta.replace(regex, '').trim();
  let json;
  try {
    json = JSON.parse(m[1].trim());
  } catch (e) {
    console.warn('[IA-Chat] Bloco acao_os com JSON inválido, ignorando ação:', e.message);
    return { textoLimpo, acao: null };
  }

  const tipo = String(json?.tipo || '');
  if (tipo === 'criar_os') {
    const nomeCliente = String(json?.cliente?.nome || '').trim();
    const defeito = String(json?.aparelho?.defeitoRelatado || '').trim();
    if (!nomeCliente || !defeito) {
      console.warn('[IA-Chat] acao_os criar_os sem nome do cliente ou defeito, ignorando.');
      return { textoLimpo, acao: null };
    }
    return {
      textoLimpo,
      acao: {
        tipo: 'criar_os',
        dados: {
          cliente: {
            nome: nomeCliente,
            telefone: String(json?.cliente?.telefone || '').trim(),
            cpf: String(json?.cliente?.cpf || '').trim()
          },
          aparelho: {
            marca: String(json?.aparelho?.marca || '').trim(),
            modelo: String(json?.aparelho?.modelo || '').trim(),
            defeitoRelatado: defeito
          },
          observacoes: String(json?.observacoes || '').trim()
        }
      }
    };
  }

  if (tipo === 'alterar_status_os') {
    const numero = String(json?.numero || '').trim();
    const novoStatus = String(json?.novoStatus || '').trim();
    if (!numero || !STATUS_OS_VALIDOS.includes(novoStatus)) {
      console.warn('[IA-Chat] acao_os alterar_status_os com numero/status inválido, ignorando.');
      return { textoLimpo, acao: null };
    }
    return { textoLimpo, acao: { tipo: 'alterar_status_os', dados: { numero, novoStatus } } };
  }

  if (tipo === 'excluir_os') {
    const numero = String(json?.numero || '').trim();
    if (!numero) {
      console.warn('[IA-Chat] acao_os excluir_os sem numero, ignorando.');
      return { textoLimpo, acao: null };
    }
    return { textoLimpo, acao: { tipo: 'excluir_os', dados: { numero } } };
  }

  if (tipo === 'enviar_mensagem_whatsapp') {
    const numero = String(json?.numero || '').trim();
    const mensagem = String(json?.mensagem || '').trim();
    if (!numero || !mensagem) {
      console.warn('[IA-Chat] acao_os enviar_mensagem_whatsapp sem numero/mensagem, ignorando.');
      return { textoLimpo, acao: null };
    }
    return { textoLimpo, acao: { tipo: 'enviar_mensagem_whatsapp', dados: { numero, mensagem } } };
  }

  if (tipo === 'adicionar_custos_compra') {
    const numero = String(json?.numero || '').trim().toUpperCase();
    const itens = (Array.isArray(json?.itens) ? json.itens : []).slice(0, 20).map(item => ({
      nome: String(item?.nome || '').trim().slice(0, 100),
      valor: Number(item?.valor)
    })).filter(item => item.nome && Number.isFinite(item.valor) && item.valor > 0);
    if (!/^CP-\d+$/i.test(numero) || !itens.length) {
      console.warn('[IA-Chat] acao_os adicionar_custos_compra sem compra/itens válidos, ignorando.');
      return { textoLimpo, acao: null };
    }
    return { textoLimpo, acao: { tipo: 'adicionar_custos_compra', dados: { numero, itens } } };
  }

  if (tipo === 'alterar_status_cobranca') {
    const numero = _normalizarNumeroOS(json?.numero);
    const data = String(json?.data || '').slice(0, 10);
    const novoStatus = _normalizarBuscaLocal(json?.novoStatus || '');
    if (!numero || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !STATUS_COBRANCA_VALIDOS.includes(novoStatus)) {
      console.warn('[IA-Chat] acao_os alterar_status_cobranca inválida, ignorando.');
      return { textoLimpo, acao: null };
    }
    return { textoLimpo, acao: { tipo: 'alterar_status_cobranca', dados: { numero, data, novoStatus } } };
  }

  console.warn('[IA-Chat] acao_os com tipo desconhecido, ignorando:', tipo);
  return { textoLimpo, acao: null };
}

// ─── v42.1 — Roteador: decide o que carregar antes de montar o prompt ────
// PROBLEMA QUE ISSO RESOLVE: antes, toda pergunta — mesmo "oi" — disparava
// uma única chamada à Groq com o manual inteiro + amostra de TODAS as
// categorias de dado (OS, clientes, estoque, peças, compras, WhatsApp)
// sempre juntas, ~13,5k tokens fixos, estourando o limite de 8k tokens/min
// da conta Groq (erro 413) mesmo pra perguntas triviais.
//
// SOLUÇÃO: uma chamada extra, curta e barata (só a pergunta do usuário,
// sem manual, sem dados, reasoning 'low', igual às classificações que já
// existem em ia-groq.js), pedindo pra IA classificar quais categorias de
// dado — e se o manual — são realmente necessários. A chamada 2 (a que já
// existia) então monta só esse contexto reduzido.
//
// NUNCA lança exceção: se essa chamada falhar ou devolver algo inesperado,
// cai no fallback "tudo" (categorias=null, manual=true) — ou seja, no pior
// caso volta ao comportamento anterior a esta correção, nunca fica pior ou
// trava a pergunta por causa do roteador.
async function _classificarCategoriasNecessarias(pergunta, apiKey) {
  const listaCategorias = CATEGORIAS_CONTEXTO.map(c => `- ${c}`).join('\n');
  const sistema = `Você decide quais fontes de informação são necessárias para responder a pergunta de um usuário sobre um sistema de gestão de assistência técnica, ANTES da resposta de verdade ser gerada. Você não responde a pergunta agora — só classifica o que ela precisa.

CATEGORIAS DE DADOS DISPONÍVEIS (marque só as que a pergunta claramente precisa):
${listaCategorias}

Além disso, diga se a pergunta precisa do MANUAL do sistema (explicações de "como fazer X" / "onde fica Y" / "o que significa Z" na tela).

REGRAS:
- Se a pergunta for uma saudação, conversa fiada, ou algo que não pede nem dado nem instrução do sistema (ex.: "oi", "tudo bem?", "obrigado"), responda com listas vazias.
- Se a pergunta pedir para CRIAR, ALTERAR STATUS ou EXCLUIR uma OS, inclua "os" mesmo que os dados específicos não estejam explícitos (é preciso localizar a OS).
- Marque só o que for claramente necessário — não marque tudo "por garantia".
- Responda APENAS com um JSON no formato exato: {"categorias": ["..."], "manual": true|false}`;

  const usuario = `Pergunta do usuário: "${String(pergunta || '').slice(0, 1000)}"\n\nResponda apenas o JSON.`;

  const resposta = await chamarGroqAPI(apiKey, [
    { role: 'system', content: sistema },
    { role: 'user', content: usuario }
  ], {
    maxTokens: 150,
    temperature: 0,
    reasoningEffort: 'low',
    jsonMode: true,
    timeoutMs: 8000 // chamada curta — mesmo timeout padrão das outras classificações
  });

  const texto = resposta?.choices?.[0]?.message?.content;
  if (!texto) throw new Error('Resposta vazia do roteador.');

  const json = JSON.parse(texto);
  const categorias = Array.isArray(json?.categorias)
    ? json.categorias.filter(c => CATEGORIAS_CONTEXTO.includes(c))
    : [];
  const manual = json?.manual === true;

  return { categorias, manual };
}

// Roteamento local cobre perguntas claras sem gastar uma primeira chamada à
// Groq. Só perguntas realmente ambíguas usam o classificador remoto. Isso
// amplia as áreas consultáveis e, ao mesmo tempo, reduz requisições e tokens.
function _classificarCategoriasLocalmente(pergunta) {
  const t = String(pergunta || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!t) return { categorias: [], manual: false };
  if (/^(oi|ola|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|tudo bem)[!?. ]*$/.test(t)) {
    return { categorias: [], manual: false };
  }

  const mapa = [
    ['os', /\b(os|ordem|ordens|servico|status|prazo|atrasad[ao]s?)\b/],
    ['clientes', /\b(cliente|clientes|cpf|telefone|contato)\b/],
    ['estoque', /\b(estoque|aparelho|aparelhos|venda|vendas|revenda|imei)\b/],
    ['pecas', /\b(peca|pecas|componente|componentes|quantidade|zerad[ao]s?)\b/],
    ['compras', /\b(compra|compras|comprado|fornecedor|vendedor)\b/],
    ['entregas', /\b(entrega|entregas|retirada|retirou)\b/],
    ['garantias', /\b(garantia|garantias|vencimento da garantia)\b/],
    ['financeiro', /\b(financeiro|pagamento|pagamentos|cobranca|cobrancas|faturamento|receita|despesa|lucro|pix|cartao|boleto)\b/],
    ['whatsapp', /\b(whatsapp|mensagem|mensagens|conversa|conversas|atendimento)\b/]
  ];
  const categorias = mapa.filter(([, re]) => re.test(t)).map(([nome]) => nome);
  if (/\b(resumo|dashboard|visao geral|como esta|estatistica|estatisticas)\b/.test(t)) categorias.unshift('resumo');
  const manual = /\b(como|onde|qual tela|passo a passo|configurar|usar|funciona|fazer)\b/.test(t);

  if (categorias.length || manual || _perguntaEhHoraBrasil(t)) {
    return { categorias: [...new Set(categorias)], manual };
  }
  return null;
}

// ─── Função pública principal ─────────────────────────────────────────────
// Nunca lança exceção. `historico` (opcional) é um array [{role,content}]
// com os turnos anteriores da mesma conversa (role: 'user' | 'assistant'),
// pro assistente manter contexto entre perguntas.
async function responderPergunta(pergunta, historico, usuario, chamarIARemota = null) {
  if (!usuario) return { sucesso: false, erro: 'Entre novamente para usar o assistente.' };
  const inicio = Date.now();
  const configFull = db.loadDB().config || {};
  // v46: chave SEPARADA da classificação de pagamento (groqApiKey, usada em
  // ia-groq.js). Antes o chatbot usava a mesma chave e o mesmo toggle
  // (groqClassificacaoAtiva) da classificação do WhatsApp — desligar "Ativar
  // classificação automática por IA" (pensando só no zap) derrubava o
  // assistente de chat junto, sem relação nenhuma entre as duas coisas.
  // Agora o chatbot tem sua própria chave e não depende mais desse toggle;
  // ele só fica indisponível se a própria chave dele estiver vazia.
  // A chave dedicada continua tendo prioridade. Instalações que já tinham
  // somente a chave Groq principal configurada também podem usar o chat.
  const provedor = normalizarProvedor(configFull.iaChatProvider);
  const chaveConfig = PROVEDORES[provedor]?.key;
  const apiKey = configFull[chaveConfig] || (provedor === 'groq' ? configFull.groqApiKey : '') || '';

  if (!String(pergunta || '').trim()) {
    return { sucesso: false, erro: 'Digite uma pergunta.' };
  }
  const acaoLocal = podeModulo(usuario, 'estoque', 'editar') ? _interpretarAcaoLocal(pergunta) : null;
  const acaoCobrancaLocal = podeModulo(usuario, 'financeiro', 'editar') ? _interpretarAcaoCobrancaLocal(pergunta) : null;
  if (acaoCobrancaLocal || acaoLocal) {
    return Object.assign(acaoCobrancaLocal || acaoLocal, {
      tempoRespostaMs: Date.now() - inicio
    });
  }
  const consultaCompraLocal = podeModulo(usuario, 'estoque') ? _responderConsultaCompraLocal(pergunta) : null;
  if (consultaCompraLocal) {
    return Object.assign(consultaCompraLocal, {
      tempoRespostaMs: Date.now() - inicio
    });
  }
  const respostaLocal = _respostaLocal(pergunta);
  if (respostaLocal) {
    return {
      sucesso: true,
      resposta: respostaLocal,
      acaoProposta: null,
      tempoRespostaMs: Date.now() - inicio,
      origem: 'local'
    };
  }
  if (!apiKey && typeof chamarIARemota !== 'function') {
    return { sucesso: false, erro: `Assistente IA ainda não configurado. Escolha um provedor e salve a chave em Configurações → Integração IA.` };
  }

  try {
    // v42.1: roteador decide o que carregar (ver _classificarCategoriasNecessarias
    // acima) — é isto que resolve o erro 413 de "oi" custar 13,5k tokens.
    // Se o roteador falhar por qualquer motivo, cai no comportamento antigo
    // (tudo: categorias=null → _montarContextoDados monta tudo, manual=true)
    // — nunca deixa a pergunta sem contexto nenhum por causa disso.
    let categorias = ['resumo'];
    let precisaManual = false;
    const usarPesquisaWeb = _perguntaPedePesquisaWeb(pergunta);
    const roteamentoLocal = _classificarCategoriasLocalmente(pergunta);
    if (roteamentoLocal) {
      categorias = roteamentoLocal.categorias;
      precisaManual = roteamentoLocal.manual;
    } else {
      try {
        const roteamento = provedor === 'groq' && apiKey
          ? await _classificarCategoriasNecessarias(pergunta, apiKey)
          : { categorias: ['resumo'], manual: false };
        categorias = roteamento.categorias;
        precisaManual = roteamento.manual;
      } catch (e) {
        console.warn('[IA-Chat] Roteador de contexto falhou; usando apenas o resumo compacto:', e.message);
      }
    }

    const manualTexto = precisaManual ? _obterManualTexto() : null;
    categorias = (categorias || CATEGORIAS_CONTEXTO).filter(categoria => podeCategoriaIA(usuario, categoria));
    const contextoJson = JSON.stringify(_montarContextoDados(categorias, usuario));
    const sistema = _montarPromptSistema(contextoJson, manualTexto, categorias, usarPesquisaWeb);

    const mensagens = [{ role: 'system', content: sistema }];
    if (Array.isArray(historico)) {
      // v42.2: histórico reduzido de 8→4 turnos e agora também corta cada
      // turno em 500 chars (antes eram 2000, sem necessidade real pra um
      // chat de suporte — perguntas de acompanhamento tipo "e essa OS, qual
      // o status?" não dependem de reler parágrafos inteiros de mensagens
      // antigas, só do assunto recente).
      historico.slice(-LIMITE_HISTORICO_TURNOS).forEach(m => {
        if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
          mensagens.push({ role: m.role, content: m.content.slice(0, LIMITE_HISTORICO_CHARS) });
        }
      });
    }
    mensagens.push({ role: 'user', content: String(pergunta).slice(0, LIMITE_PERGUNTA_CHARS) });

    // v42.2: maxTokens e reasoningEffort agora escalam com a complexidade real
    // da pergunta em vez de valores fixos sempre "no máximo". Uma pergunta sem
    // nenhuma categoria de dado e sem manual (ex.: "oi", "obrigado") não tem
    // nada pra cruzar nem explicar, então nem precisa de raciocínio 'medium'
    // nem de espaço pra 900 tokens de resposta. Quando há categorias e/ou
    // manual envolvidos, mantém exatamente os valores que já existiam antes
    // desta versão (900 / 'medium') — nenhuma pergunta com contexto real fica
    // com menos espaço de resposta do que já tinha.
    const perguntaSimples = (!categorias || categorias.length === 0) && !precisaManual && !usarPesquisaWeb;
    const maxTokens = perguntaSimples ? 250 : 900;
    const reasoningEffort = perguntaSimples ? 'low' : 'medium';

    const opcoesIA = {
      provedor,
      apiKey,
      model: usarPesquisaWeb ? MODELO_CHAT_COM_WEB : undefined,
      maxTokens,
      temperature: 0.3,
      reasoningEffort,
      jsonMode: false, // aqui queremos texto livre pro usuário, não JSON estruturado
      // BUGFIX (causa raiz de toda pergunta falhar, até "olá"): o timeout
      // default de src/ia-groq.js (8s) foi calibrado para as chamadas curtas
      // de classificação (prompt pequeno, reasoning 'low'). Aqui o prompt de
      // sistema inclui o manual inteiro + amostra de OS/clientes/estoque/
      // compras/mensagens (várias vezes maior) e usa reasoning 'medium' —
      // ambos aumentam bastante o tempo até a resposta começar a chegar
      // (contexto grande e reasoning mais alto elevam o "time to first
      // token", segundo a própria doc da Groq). 8s estourava quase sempre,
      // independente do que o usuário perguntasse. 30s dá margem real para
      // esse contexto sem deixar o widget travado indefinidamente se a Groq
      // realmente cair. Perguntas simples (contexto vazio, reasoning 'low')
      // respondem bem mais rápido, mas o timeout continua o mesmo — 30s é
      // uma margem de segurança, não uma meta de tempo.
      timeoutMs: 30000
    };
    let respostaGroq;
    if (typeof chamarIARemota === 'function') {
      try {
        // A configuração central por empresa tem prioridade, inclusive
        // quando foi definida pelo suporte sem revelar a chave ao PC.
        respostaGroq = await chamarIARemota(mensagens, opcoesIA);
      } catch (erroRemoto) {
        if (!apiKey) throw erroRemoto;
        // Instalações antigas continuam funcionando com o cofre local caso a
        // integração por empresa ainda não tenha sido configurada.
        respostaGroq = await chamarIA(configFull, mensagens, opcoesIA);
      }
    } else {
      respostaGroq = await chamarIA(configFull, mensagens, opcoesIA);
    }

    const texto = respostaGroq?.choices?.[0]?.message?.content;
    if (!texto || !texto.trim()) throw new Error('Resposta vazia da IA.');

    // v42: extrai eventual proposta de ação (criar/alterar status/excluir OS)
    // do texto. `acaoProposta` nunca é executada aqui — é só devolvida ao
    // renderer, que exige confirmação explícita do usuário (e senha de
    // exclusão, se for o caso) antes de chamar ia:executarAcao.
    const { textoLimpo, acao } = _extrairAcaoProposta(texto.trim());

    return {
      sucesso: true,
      resposta: textoLimpo || texto.trim(),
      acaoProposta: acao,
      tempoRespostaMs: Date.now() - inicio
    };
  } catch (e) {
    console.warn('[IA-Chat] Falha ao responder pergunta:', e.message);
    // BUGFIX: a mensagem genérica de antes ("sem internet, chave inválida ou
    // Groq fora do ar") escondia a causa real, inclusive o timeout — o caso
    // mais comum antes desta correção. Agora identifica timeout explicitamente
    // (mensagem diferente e acionável: "está demorando", não "está errado")
    // e, para qualquer outro erro, expõe o detalhe técnico real (`detalheErro`
    // já existia no retorno, mas o widget nunca chegava a exibi-lo) direto na
    // mensagem — ajuda a diferenciar, por exemplo, status 401 (chave
    // inválida) de status 429 (limite de uso da conta Groq atingido).
    const erroExibido = _traduzirFalhaGroq(e);
    return {
      sucesso: false,
      erro: erroExibido,
      detalheErro: e.message
    };
  }
}

// ─── v42 — Execução da ação, após confirmação do usuário ──────────────────
// Chamada SÓ por main.js (canal ia:executarAcao), e SÓ depois que o renderer
// já mostrou a proposta e o usuário clicou em "Confirmar" (e, para exclusão,
// já validou a senha de exclusão via config:verificarSenhaExclusao — a
// verificação da senha em si não é feita aqui, é responsabilidade do
// chamador em main.js, mesmo padrão usado por sistema:zerar).
//
// Esta função não duplica regra de negócio nenhuma: só chama db.criarOS /
// db.atualizarOS / db.excluirOS (para ações de OS) ou whatsapp.enviarMensagem
// (para enviar_mensagem_whatsapp), exatamente como os formulários/telas
// manuais do sistema já fazem. Nunca lança exceção — sempre resolve com
// { sucesso, ... } ou { sucesso:false, erro }.
async function executarAcao(acao, usuario) {
  if (!acao || typeof acao !== 'object') {
    return { sucesso: false, erro: 'Ação inválida.' };
  }
  if (!podeAcaoIA(usuario, acao.tipo)) {
    return { sucesso: false, erro: 'Seu usuário não possui permissão para esta ação.' };
  }

  try {
    if (acao.tipo === 'enviar_mensagem_whatsapp') {
      const { numero, mensagem } = acao.dados || {};
      const osAtual = db.obterOSPorNumero(numero);
      if (!osAtual) return { sucesso: false, erro: `OS ${numero} não encontrada.` };
      const telefone = osAtual.cliente?.telefone;
      if (!telefone) return { sucesso: false, erro: `A OS ${numero} não tem telefone de cliente cadastrado.` };
      const resultado = await enviarMensagem(telefone, mensagem);
      return { sucesso: resultado.sucesso, tipo: 'enviar_mensagem_whatsapp', erro: resultado.erro };
    }

    if (acao.tipo === 'criar_os') {
      const os = db.criarOS(acao.dados);
      return { sucesso: true, tipo: 'criar_os', os };
    }

    if (acao.tipo === 'alterar_status_os') {
      const { numero, novoStatus } = acao.dados || {};
      const osAtual = db.obterOSPorNumero(numero);
      if (!osAtual) return { sucesso: false, erro: `OS ${numero} não encontrada.` };
      const os = db.atualizarOS(numero, { status: novoStatus });
      return { sucesso: true, tipo: 'alterar_status_os', os };
    }

    if (acao.tipo === 'excluir_os') {
      const { numero } = acao.dados || {};
      const osAtual = db.obterOSPorNumero(numero);
      if (!osAtual) return { sucesso: false, erro: `OS ${numero} não encontrada.` };
      const resultado = db.excluirOS(numero, usuario.id);
      return { sucesso: resultado.sucesso, tipo: 'excluir_os', erro: resultado.erro, removida: resultado.removida };
    }

    if (acao.tipo === 'adicionar_custos_compra') {
      return _executarAdicionarCustosCompra(acao.dados || {}, db);
    }

    if (acao.tipo === 'alterar_status_cobranca') {
      return _executarAlterarStatusCobranca(acao.dados || {}, db);
    }

    return { sucesso: false, erro: `Tipo de ação desconhecido: "${acao.tipo}".` };
  } catch (e) {
    console.warn('[IA-Chat] Falha ao executar ação confirmada:', e.message);
    return { sucesso: false, erro: e.message };
  }
}

function _executarAlterarStatusCobranca(dadosAcao, banco = db) {
  const { numero, lembreteId, data, novoStatus } = dadosAcao || {};
  if (!STATUS_COBRANCA_VALIDOS.includes(novoStatus)) return { sucesso: false, erro: 'Situação de cobrança inválida.' };
  const osAtual = banco.obterOSPorNumero(numero);
  if (!osAtual) return { sucesso: false, erro: `OS ${numero} não encontrada.` };
  const lembretes = Array.isArray(osAtual.lembretesCobranca) ? osAtual.lembretesCobranca : [];
  const correspondencias = lembretes.map((item, indice) => ({ item, indice })).filter(({ item }) => {
    if (lembreteId && String(item.id || item.data) === String(lembreteId)) return true;
    return data && String(item.data || '').slice(0, 10) === String(data).slice(0, 10);
  });
  if (correspondencias.length !== 1) {
    return { sucesso: false, erro: correspondencias.length ? 'Há mais de uma cobrança nessa data.' : 'Cobrança não encontrada nessa OS.' };
  }
  const indice = correspondencias[0].indice;
  const atualizados = lembretes.map(item => ({ ...item }));
  atualizados[indice] = _prepararStatusCobranca(atualizados[indice], novoStatus);
  const os = banco.atualizarOS(numero, { lembretesCobranca: atualizados });
  return { sucesso: true, tipo: 'alterar_status_cobranca', os, cobranca: atualizados[indice] };
}

function _executarAdicionarCustosCompra(dadosAcao, banco = db) {
  const numero = String(dadosAcao?.numero || '').trim().toUpperCase();
  const compraAtual = banco.obterCompraPorNumero(numero);
  if (!compraAtual) return { sucesso: false, erro: `Compra ${numero} não encontrada.` };

  const novosItens = (Array.isArray(dadosAcao?.itens) ? dadosAcao.itens : []).map(item => ({
    nome: String(item?.nome || '').replace(/\s+/g, ' ').trim(),
    valor: Number(item?.valor)
  })).filter(item => item.nome && Number.isFinite(item.valor) && item.valor > 0);
  if (!novosItens.length) return { sucesso: false, erro: 'Informe ao menos um custo válido.' };

  const dadosAtuais = compraAtual.dadosCompra || {};
  const itensAnteriores = Array.isArray(dadosAtuais.pecasTrocar)
    ? dadosAtuais.pecasTrocar.map(item => ({
        nome: String(item?.nome || '').trim(),
        valor: Number(item?.valor) || 0
      }))
    : [];
  const pecasTrocar = itensAnteriores.concat(novosItens);
  const custoPecas = pecasTrocar.reduce((total, item) => total + (Number(item.valor) || 0), 0);
  const valorAparelho = Number(dadosAtuais.valor || 0);
  const valorTotal = valorAparelho + custoPecas;

  banco.atualizarCompra(numero, {
    dadosCompra: Object.assign({}, dadosAtuais, {
      pecasTrocar,
      custoPecas,
      custoTotal: valorTotal
    })
  });

  // Só confirma o sucesso depois de reler o banco e conferir item por item.
  // Assim uma escrita parcial ou descartada nunca produz mensagem enganosa.
  const compraConfirmada = banco.obterCompraPorNumero(numero);
  const dadosConfirmados = compraConfirmada?.dadosCompra || {};
  const itensConfirmados = Array.isArray(dadosConfirmados.pecasTrocar)
    ? dadosConfirmados.pecasTrocar
    : [];
  const itensConferem = itensConfirmados.length === pecasTrocar.length
    && pecasTrocar.every((esperado, indice) => {
      const recebido = itensConfirmados[indice] || {};
      return String(recebido.nome || '').trim() === esperado.nome
        && Math.abs((Number(recebido.valor) || 0) - esperado.valor) < 0.001;
    });
  const totaisConferem = Math.abs((Number(dadosConfirmados.custoPecas) || 0) - custoPecas) < 0.001
    && Math.abs((Number(dadosConfirmados.custoTotal) || 0) - valorTotal) < 0.001;

  if (!compraConfirmada || !itensConferem || !totaisConferem) {
    return {
      sucesso: false,
      erro: `A alteração da ${numero} não foi confirmada pelo banco. Abra a compra e tente novamente.`
    };
  }

  return {
    sucesso: true,
    tipo: 'adicionar_custos_compra',
    compra: compraConfirmada,
    itensAdicionados: novosItens,
    custoAdicionado: novosItens.reduce((total, item) => total + item.valor, 0),
    custoTotal: custoPecas,
    valorTotal
  };
}

module.exports = {
  responderPergunta,
  executarAcao,
  _montarContextoDados,
  _interpretarAcaoLocal,
  _interpretarAcaoCobrancaLocal,
  _statusCobranca,
  _prepararStatusCobranca,
  _executarAlterarStatusCobranca,
  _responderConsultaCompraLocal,
  _executarAdicionarCustosCompra
};
