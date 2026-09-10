// ══════════════════════════════════════════════════════════════════════════════
// src/ia-groq.js — Classificação por IA (Groq) da forma de pagamento manual
// v40.2
//
// CONTEXTO:
// Quando o cliente responde no WhatsApp qual a forma de pagamento manual que
// vai usar (ex.: "vou pagar na maquininha da stone", "deixa em dinheiro
// mesmo", "pago com o cartão do meu pai"), o sistema precisa classificar
// esse texto livre numa categoria curta para exibir como badge na listagem
// de OS (aba Histórico / aba Autorizadas).
//
// Até a v40.1 isso era feito só por um classificador de palavras-chave
// (src/whatsapp.js → _classificarFormaPagamentoManual). Esse classificador
// continua existindo por inteiro e nunca foi removido — ele agora é o
// FALLBACK deste módulo, usado sempre que a IA não está configurada, falha,
// demora demais, ou devolve algo fora do esperado.
//
// GARANTIA MAIS IMPORTANTE DESTE ARQUIVO: classificarComIA() NUNCA lança
// exceção e NUNCA retorna vazio. Na pior hipótese (sem internet, chave
// errada, Groq fora do ar), ela devolve o mesmo resultado que o sistema já
// dava antes de existir IA nenhuma — o cliente sempre recebe a confirmação
// automática, e a OS sempre fica com algum rótulo de forma de pagamento.
//
// COMO USAR NO whatsapp.js:
//   const iaGroq = require('./ia-groq');
//   const resultado = await iaGroq.classificarFormaPagamento(texto, {
//     osNumero, clienteNome, telefone,
//     rotulosValidos: rotulosValidosFormaPagamento(),         // de whatsapp.js
//     classificarPorRegras: classificarFormaPagamentoManualPorRegras, // de whatsapp.js
//   });
//   // resultado = { rotulo, origem, motivoFallback, tempoRespostaMs, sucesso, erro }
//
// NOTA DE DESIGN: este módulo recebe `rotulosValidos` e `classificarPorRegras`
// como parâmetros em vez de importar src/whatsapp.js diretamente — isso evita
// uma dependência circular (whatsapp.js → ia-groq.js → whatsapp.js) e mantém
// este arquivo testável de forma isolada, sem precisar simular o WhatsApp
// inteiro para testar a lógica de classificação.
// ══════════════════════════════════════════════════════════════════════════════

'use strict';

const https = require('https');
const db = require('./db');
const { consumirLimiteIA } = require('./ia-rate-limit');

const GROQ_HOST = 'api.groq.com';
const GROQ_PATH = '/openai/v1/chat/completions';
// openai/gpt-oss-20b — modelo atual recomendado pela Groq para tarefas de
// classificação/extração de texto curto (rápido, barato, com JSON mode e
// reasoning_effort ajustável). Ver https://console.groq.com/docs/models
const GROQ_MODEL = 'openai/gpt-oss-20b';

// v46: referência à janela principal, para notificar o usuário no sininho
// quando uma classificação cair no fallback por ERRO real (rede, timeout,
// chave inválida) — nunca quando a IA está desligada/sem chave de propósito
// (isso é comportamento esperado, não um problema a avisar). Mesmo padrão
// simples já usado em src/whatsapp.js (init(win)); chamado uma vez a partir
// de main.js. Fica null em qualquer contexto que não chame initNotificacoes
// (ex.: testes isolados) — nesse caso a notificação é simplesmente pulada,
// sem quebrar a classificação em si.
let mainWindow = null;
function initNotificacoes(win) {
  mainWindow = win;
}
// Timeout DEFAULT — calibrado para as chamadas curtas e originais deste
// arquivo (classificação de forma de pagamento e de aceite de termos):
// prompt pequeno, maxTokens baixo, reasoning_effort 'low'. Não pode travar
// a resposta automática ao cliente no WhatsApp, por isso é agressivo.
//
// v41 BUGFIX: quando este módulo passou a ser reaproveitado pelo chat
// (src/ia-chat.js), esse mesmo valor de 8s ficou sendo usado também para
// chamadas com um contexto MUITO maior (manual inteiro + amostra de dados
// do sistema, várias vezes maior que uma classificação curta) e com
// reasoning_effort 'medium' — a documentação da própria Groq indica que
// tanto contextos grandes quanto reasoning_effort mais alto aumentam o
// tempo até o primeiro token, então 8s passou a estourar quase sempre,
// mesmo para perguntas triviais como "olá" (o gargalo é o tamanho do
// prompt de sistema fixo, não o texto digitado pelo usuário). Por isso
// TIMEOUT_MS agora é a base default, mas pode ser sobrescrito por chamada
// via `opts.timeoutMs` — ver `_chamarGroqAPI` logo abaixo.
const TIMEOUT_MS = 8000;

// ─── Monta o prompt de classificação ──────────────────────────────────────────
// A lista de categorias válidas vem de whatsapp.js (rotulosValidosFormaPagamento),
// para nunca ficar dessincronizada da lista usada pelo classificador por regras
// — a IA só pode escolher entre rótulos que o resto do sistema já conhece.
function _montarPrompt(texto, rotulosValidos) {
  const listaRotulos = rotulosValidos.map(r => `- ${r}`).join('\n');

  const sistema = `Você é um classificador de texto para um sistema de assistência técnica brasileiro. Sua única tarefa é ler o que um cliente respondeu no WhatsApp, quando perguntado "como você vai pagar?", e classificar a resposta em UMA das categorias abaixo.

CATEGORIAS VÁLIDAS (escolha exatamente uma, copiando o texto exatamente como está):
${listaRotulos}
- Não informado (use isso se o texto não mencionar nenhuma forma de pagamento reconhecível)

REGRAS IMPORTANTES:
1. Responda APENAS com um JSON no formato: {"rotulo": "<categoria escolhida>"}
2. O valor de "rotulo" deve ser EXATAMENTE igual a uma das categorias listadas acima, sem inventar categorias novas.
3. Se o cliente estiver NEGANDO uma forma de pagamento (ex.: "não tenho dinheiro agora", "ainda não vai dar pra pagar", "não vai ser no cartão"), NÃO classifique como a forma negada — responda {"rotulo": "Não informado"}.
4. Se o texto mencionar mais de uma forma (ex.: bandeira + maquininha, tipo "cartão visa na maquininha da stone"), prefira a combinação mais específica que exista na lista (ex.: "Maquininha (Stone)").
5. Se não houver nenhuma correspondência clara, use "Não informado" — não tente adivinhar.
6. Gírias, erros de digitação e abreviações comuns em português do Brasil devem ser interpretados normalmente (ex.: "dnheiro" = Dinheiro, "cartao d credito" = Cartão de Crédito, "maquininha" = Maquininha).`;

  const usuario = `Texto do cliente: "${String(texto || '').slice(0, 500)}"\n\nResponda apenas o JSON.`;

  return { sistema, usuario };
}

// ─── Chamada HTTP à API da Groq (https nativo, sem dependência nova) ─────────
// Genérica desde a v41: recebe o array `mensagens` (formato padrão da API,
// [{role,content}, ...]) em vez de só um par sistema/usuário, e aceita `opts`
// para ajustar temperatura/tokens/raciocínio/json-mode por chamador. Isso
// permite reaproveitar toda a lógica de rede (timeout, headers, parsing de
// erro) tanto para classificação curta (pagamento/termos) quanto para o
// assistente de chat (src/ia-chat.js), sem duplicar nada. Os valores default
// abaixo preservam exatamente o comportamento anterior desta função.
function _chamarGroqAPI(apiKey, mensagens, opts = {}) {
  const {
    model = GROQ_MODEL,
    maxTokens = 200,
    temperature = 0.1,        // tarefa de classificação: queremos determinismo, não criatividade
    reasoningEffort = 'low',  // classificação simples não precisa de raciocínio profundo — mais rápido e mais barato
    jsonMode = true,
    timeoutMs = TIMEOUT_MS,   // v41 BUGFIX: sobrescrevível por chamador — ver nota acima de TIMEOUT_MS
    citationOptions = null,
    _tentativaRede = 0
  } = opts;
  if (_tentativaRede === 0) {
    let config = {};
    try { config = db.loadDB().config || {}; } catch (_) {}
    consumirLimiteIA({
      provedor: 'groq',
      chave: apiKey,
      limiteMinuto: config.limiteIAMinuto,
      limiteMes: config.limiteIAMes
    });
  }
  return new Promise((resolve, reject) => {
    const corpoRequisicao = {
      model,
      messages: mensagens,
      temperature,
      max_completion_tokens: maxTokens
    };
    if (!String(model).startsWith('groq/compound')) corpoRequisicao.reasoning_effort = reasoningEffort;
    if (jsonMode) corpoRequisicao.response_format = { type: 'json_object' };
    if (citationOptions && String(model).startsWith('groq/compound')) corpoRequisicao.citation_options = citationOptions;
    const body = JSON.stringify(corpoRequisicao);

    const req = https.request({
      hostname: GROQ_HOST,
      path: GROQ_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: timeoutMs
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Groq retornou status ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Resposta da Groq não é um JSON válido: ' + e.message));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Tempo limite (${timeoutMs}ms) excedido ao chamar a API da Groq.`));
    });
    req.on('error', erro => {
      // Falhas momentaneas do resolvedor DNS do Windows acontecem antes de
      // qualquer requisicao chegar a Groq. Uma unica repeticao curta resolve
      // o caso transitorio sem duplicar chamadas aceitas pelo servidor.
      if (_tentativaRede < 1 && ['ENOTFOUND', 'EAI_AGAIN'].includes(erro && erro.code)) {
        setTimeout(() => {
          _chamarGroqAPI(apiKey, mensagens, { ...opts, _tentativaRede: _tentativaRede + 1 })
            .then(resolve, reject);
        }, 700);
        return;
      }
      reject(erro);
    });
    req.write(body);
    req.end();
  });
}

// ─── Extrai e valida o rótulo devolvido pela IA ───────────────────────────────
// Nunca confia cegamente no texto que a IA gerou: só aceita se bater
// exatamente com um dos rótulos que o resto do sistema conhece. Qualquer
// coisa fora disso é tratada como falha de validação (cai no fallback).
function _extrairRotuloValidado(respostaGroq, rotulosValidos) {
  const conteudo = respostaGroq?.choices?.[0]?.message?.content;
  if (!conteudo) throw new Error('Resposta da Groq não contém message.content.');

  let json;
  try {
    json = JSON.parse(conteudo);
  } catch (e) {
    throw new Error('Conteúdo retornado pela IA não é um JSON válido: ' + e.message);
  }

  const rotulo = String(json?.rotulo || '').trim();
  const rotulosPermitidos = [...rotulosValidos, 'Não informado'];
  if (!rotulosPermitidos.includes(rotulo)) {
    throw new Error(`IA retornou rótulo fora do esperado: "${rotulo}"`);
  }
  return rotulo;
}

// ─── Função pública principal ─────────────────────────────────────────────────
// Sempre resolve (nunca rejeita). Sempre devolve um rótulo utilizável.
//
// `rotulosValidos` (array de string) e `classificarPorRegras` (function) vêm
// de src/whatsapp.js — ver nota de design no topo do arquivo sobre por que
// são passados como parâmetro em vez de importados diretamente.
async function classificarFormaPagamento(texto, { osNumero, clienteNome, telefone, rotulosValidos, classificarPorRegras } = {}) {
  const inicio = Date.now();
  const configFull = db.loadDB().config || {};
  const apiKey = configFull.groqApiKey || '';
  const iaAtiva = configFull.groqClassificacaoAtiva !== false;

  const _rotulosValidos = Array.isArray(rotulosValidos) ? rotulosValidos : [];
  const rotuloFallback = () => (typeof classificarPorRegras === 'function')
    ? classificarPorRegras(texto)
    : (String(texto || '').trim().slice(0, 40) || 'Não informado'); // rede de segurança extrema, não deve ser alcançada em uso normal

  // Sem chave configurada, ou classificação por IA desligada nas configurações:
  // usa direto o classificador por regras, sem sequer tentar a rede. Isso não
  // é uma "falha" — é o comportamento esperado quando o usuário não configurou
  // a IA (ver <configurações> → Integrações — IA (Groq)).
  if (!apiKey || !iaAtiva) {
    const rotulo = rotuloFallback();
    const resultado = {
      rotulo,
      origem: 'fallback_regras',
      motivoFallback: !apiKey ? 'Chave da API Groq não configurada.' : 'Classificação por IA está desativada nas configurações.',
      tempoRespostaMs: Date.now() - inicio,
      sucesso: true,
      erro: null
    };
    _registrarLog(resultado, texto, osNumero, clienteNome, telefone);
    return resultado;
  }

  try {
    const { sistema, usuario } = _montarPrompt(texto, _rotulosValidos);
    const respostaGroq = await _chamarGroqAPI(apiKey, [
      { role: 'system', content: sistema },
      { role: 'user', content: usuario }
    ]);
    const rotulo = _extrairRotuloValidado(respostaGroq, _rotulosValidos);

    const resultado = {
      rotulo,
      origem: 'ia',
      motivoFallback: null,
      tempoRespostaMs: Date.now() - inicio,
      sucesso: true,
      erro: null
    };
    _registrarLog(resultado, texto, osNumero, clienteNome, telefone);
    return resultado;
  } catch (e) {
    // Qualquer falha (rede, timeout, chave inválida, JSON malformado, rótulo
    // fora do esperado) cai automaticamente no classificador por regras — o
    // cliente nunca fica sem resposta por causa de um problema na IA.
    console.warn('[IA-Groq] Falha ao classificar via IA, usando fallback por regras:', e.message);
    const rotulo = rotuloFallback();
    const resultado = {
      rotulo,
      origem: 'fallback_erro',
      motivoFallback: e.message,
      tempoRespostaMs: Date.now() - inicio,
      sucesso: false,
      erro: e.message
    };
    _registrarLog(resultado, texto, osNumero, clienteNome, telefone);
    return resultado;
  }
}

// Log nunca deve derrubar a classificação em si — mesmo padrão defensivo
// usado em _logAutomacao (src/whatsapp.js).
function _registrarLog(resultado, textoOriginal, osNumero, clienteNome, telefone) {
  try {
    db.registrarLogIA({
      osNumero, clienteNome, telefone,
      textoOriginal,
      rotulo: resultado.rotulo,
      origem: resultado.origem,
      motivoFallback: resultado.motivoFallback,
      tempoRespostaMs: resultado.tempoRespostaMs,
      sucesso: resultado.sucesso,
      erro: resultado.erro
    });
  } catch (eLog) {
    console.warn('[IA-Groq] Erro ao salvar log de classificação:', eLog.message);
  }

  // v46: notifica no sininho SÓ quando o fallback foi por erro real
  // (origem 'fallback_erro' — rede, timeout, chave inválida, resposta fora
  // do esperado). Fallback por IA desligada ou sem chave ('fallback_regras')
  // é o comportamento esperado quando o usuário optou por isso, e não deve
  // gerar aviso nenhum — comportamento confirmado explicitamente com o
  // usuário antes de implementar.
  if (resultado.origem === 'fallback_erro') {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ia:classificacaoFallback', {
          osNumero,
          clienteNome,
          motivoFallback: resultado.motivoFallback,
          data: new Date().toISOString()
        });
      }
    } catch (eNotif) {
      console.warn('[IA-Groq] Erro ao notificar fallback:', eNotif.message);
    }
  }
}

// ─── Intenção da escolha de pagamento antecipado ────────────────────────────
// Só é chamada pelo WhatsApp quando as regras rápidas não chegam a uma
// conclusão. O fallback recebido do chamador é determinístico e garante que
// indisponibilidade da IA nunca lance erro nem invente uma escolha.
const INTENCOES_PAGAMENTO_ENTRADA = [
  'quitar_100_online',
  'entrada_50_online',
  'presencial_50',
  'presencial_100',
  'nao_entendido',
];

function _montarPromptPagamentoEntrada(texto) {
  const sistema = `Você classifica a resposta de um cliente de assistência técnica que já recebeu um link para pagar 50% de entrada e foi informado de que também pode quitar 100% online ou pagar 50%/100% presencialmente.

Responda APENAS com JSON no formato {"intencao":"<valor>"}, usando exatamente uma destas intenções:
- quitar_100_online: quer pagar/quitar o valor total agora por link;
- entrada_50_online: quer pagar somente a entrada de 50% agora por link;
- presencial_50: quer pagar presencialmente e não declarou 100% (50% é o padrão);
- presencial_100: declarou pagamento integral presencial;
- nao_entendido: não é possível concluir com segurança.

Regras:
1. "pagar tudo", "quitar", "valor completo" e equivalentes, sem indicação presencial, significam quitar_100_online.
2. Se mencionar loja, balcão, assistência, dinheiro em mãos ou pagamento ao chegar, use presencial_50, salvo se disser explicitamente 100%/integral, quando deve usar presencial_100.
3. Se informar uma forma presencial sem percentual, use presencial_50.
4. Dúvidas, recusas, negações e assuntos diferentes devem ser nao_entendido.
5. Considere português informal, abreviações e erros de digitação, mas não adivinhe quando houver dúvida.`;
  const usuario = `Texto do cliente: "${String(texto || '').slice(0, 500)}"\n\nResponda apenas o JSON.`;
  return { sistema, usuario };
}

function _extrairIntencaoPagamentoEntrada(respostaGroq) {
  const conteudo = respostaGroq?.choices?.[0]?.message?.content;
  if (!conteudo) throw new Error('Resposta da Groq não contém message.content.');
  const json = JSON.parse(conteudo);
  const intencao = String(json?.intencao || '').trim();
  if (!INTENCOES_PAGAMENTO_ENTRADA.includes(intencao)) {
    throw new Error(`IA retornou intenção de pagamento fora do esperado: "${intencao}"`);
  }
  return intencao;
}

async function classificarEscolhaPagamentoEntrada(texto, {
  osNumero, clienteNome, telefone, classificarPorRegras
} = {}) {
  const inicio = Date.now();
  const fallback = () => {
    try {
      const intencao = typeof classificarPorRegras === 'function'
        ? String(classificarPorRegras(texto) || '')
        : '';
      return INTENCOES_PAGAMENTO_ENTRADA.includes(intencao) ? intencao : 'nao_entendido';
    } catch {
      return 'nao_entendido';
    }
  };

  try {
    const configFull = db.loadDB().config || {};
    const apiKey = configFull.groqApiKey || '';
    const iaAtiva = configFull.groqClassificacaoAtiva !== false;
    if (!apiKey || !iaAtiva) {
      const resultado = {
        intencao: fallback(),
        origem: 'fallback_regras',
        motivoFallback: !apiKey ? 'Chave da API Groq não configurada.' : 'Classificação por IA está desativada nas configurações.',
        tempoRespostaMs: Date.now() - inicio,
        sucesso: true,
        erro: null,
      };
      _registrarLog({ ...resultado, rotulo: `pagamento_entrada:${resultado.intencao}` }, texto, osNumero, clienteNome, telefone);
      return resultado;
    }

    try {
      const { sistema, usuario } = _montarPromptPagamentoEntrada(texto);
      const respostaGroq = await _chamarGroqAPI(apiKey, [
        { role: 'system', content: sistema },
        { role: 'user', content: usuario },
      ]);
      const resultado = {
        intencao: _extrairIntencaoPagamentoEntrada(respostaGroq),
        origem: 'ia',
        motivoFallback: null,
        tempoRespostaMs: Date.now() - inicio,
        sucesso: true,
        erro: null,
      };
      _registrarLog({ ...resultado, rotulo: `pagamento_entrada:${resultado.intencao}` }, texto, osNumero, clienteNome, telefone);
      return resultado;
    } catch (erroIA) {
      console.warn('[IA-Groq] Falha ao classificar escolha de pagamento, usando fallback por regras:', erroIA.message);
      const resultado = {
        intencao: fallback(),
        origem: 'fallback_erro',
        motivoFallback: erroIA.message,
        tempoRespostaMs: Date.now() - inicio,
        sucesso: false,
        erro: erroIA.message,
      };
      _registrarLog({ ...resultado, rotulo: `pagamento_entrada:${resultado.intencao}` }, texto, osNumero, clienteNome, telefone);
      return resultado;
    }
  } catch (erro) {
    // Até falhas locais de leitura de configuração caem na decisão segura.
    return {
      intencao: fallback(),
      origem: 'fallback_erro',
      motivoFallback: erro.message,
      tempoRespostaMs: Date.now() - inicio,
      sucesso: false,
      erro: erro.message,
    };
  }
}

// ─── Prompt de classificação de aceite/recusa dos termos ─────────────────────
// Diferente da forma de pagamento, aqui o erro tem peso maior: interpretar uma
// recusa como aceite deixaria a OS seguir pra reparo/pagamento sem consentimento
// real do cliente. Por isso a IA tem 3 saídas possíveis (sim / nao / ambiguo) em
// vez de ser forçada a escolher entre só duas — "ambiguo" é sempre uma resposta
// válida e é tratado pelo chamador exatamente como "não entendida" (reenvia a
// pergunta ou escala pra humano), nunca como um "sim" arriscado.
function _montarPromptAceiteTermos(texto) {
  const sistema = `Você é um classificador de texto para um sistema de assistência técnica brasileiro. Sua única tarefa é ler o que um cliente respondeu no WhatsApp, quando perguntado se aceita os termos/orçamento de um reparo, e classificar a resposta.

RESPONDA APENAS com um JSON no formato: {"decisao": "sim"} ou {"decisao": "nao"} ou {"decisao": "ambiguo"}

REGRAS IMPORTANTES:
1. "sim" = o cliente está claramente aceitando/concordando/autorizando o reparo ou orçamento (ex.: "sim pode fazer", "pode sim", "claro, aceito", "tá bom", "beleza", "confirmo", "isso mesmo").
2. "nao" = o cliente está claramente recusando/negando (ex.: "não quero", "prefiro não", "melhor não", "não vai dar", "cancela").
3. "ambiguo" = QUALQUER outro caso: texto que não fala sobre aceitar ou recusar (dúvidas, perguntas sobre prazo/preço/outro assunto), texto confuso, incompleto, ou que você não tenha certeza razoável do que o cliente quis dizer.
4. Na dúvida, SEMPRE prefira "ambiguo" a arriscar "sim" ou "nao" — é mais seguro escalar para um atendente humano do que assumir errado, principalmente para não confundir recusa com aceite.
5. Gírias, erros de digitação e abreviações comuns em português do Brasil devem ser interpretadas normalmente.`;

  const usuario = `Texto do cliente: "${String(texto || '').slice(0, 500)}"\n\nResponda apenas o JSON.`;
  return { sistema, usuario };
}

function _extrairDecisaoValidada(respostaGroq) {
  const conteudo = respostaGroq?.choices?.[0]?.message?.content;
  if (!conteudo) throw new Error('Resposta da Groq não contém message.content.');

  let json;
  try {
    json = JSON.parse(conteudo);
  } catch (e) {
    throw new Error('Conteúdo retornado pela IA não é um JSON válido: ' + e.message);
  }

  const decisao = String(json?.decisao || '').trim().toLowerCase();
  if (!['sim', 'nao', 'ambiguo'].includes(decisao)) {
    throw new Error(`IA retornou decisão fora do esperado: "${decisao}"`);
  }
  return decisao;
}

// ─── Função pública: classificação de aceite/recusa dos termos ───────────────
// Mesmo contrato de segurança de classificarFormaPagamento: NUNCA lança
// exceção. Sempre resolve com uma `decisao` ('sim' | 'nao' | 'ambiguo').
// Quando a IA não está configurada, desligada, ou falha por qualquer motivo,
// devolve 'ambiguo' — o chamador (whatsapp.js) trata isso exatamente como uma
// resposta não reconhecida: reenvia a pergunta ou escala pra atendimento
// humano, dependendo de quantas tentativas já aconteceram. Isso preserva a
// garantia de que a automação NUNCA assume um aceite sem uma classificação
// (por regra ou por IA) que tenha vindo com confiança razoável.
async function classificarAceiteTermos(texto, { osNumero, clienteNome, telefone } = {}) {
  const inicio = Date.now();
  const configFull = db.loadDB().config || {};
  const apiKey = configFull.groqApiKey || '';
  const iaAtiva = configFull.groqClassificacaoAtiva !== false;

  if (!apiKey || !iaAtiva) {
    const resultado = {
      decisao: 'ambiguo',
      origem: 'sem_ia',
      motivoFallback: !apiKey ? 'Chave da API Groq não configurada.' : 'Classificação por IA está desativada nas configurações.',
      tempoRespostaMs: Date.now() - inicio,
      sucesso: true,
      erro: null
    };
    _registrarLogAceite(resultado, texto, osNumero, clienteNome, telefone);
    return resultado;
  }

  try {
    const { sistema, usuario } = _montarPromptAceiteTermos(texto);
    const respostaGroq = await _chamarGroqAPI(apiKey, [
      { role: 'system', content: sistema },
      { role: 'user', content: usuario }
    ]);
    const decisao = _extrairDecisaoValidada(respostaGroq);

    const resultado = {
      decisao,
      origem: 'ia',
      motivoFallback: null,
      tempoRespostaMs: Date.now() - inicio,
      sucesso: true,
      erro: null
    };
    _registrarLogAceite(resultado, texto, osNumero, clienteNome, telefone);
    return resultado;
  } catch (e) {
    // Qualquer falha (rede, timeout, chave inválida, JSON malformado, decisão
    // fora do esperado) vira 'ambiguo' — nunca um sim/não arriscado.
    console.warn('[IA-Groq] Falha ao classificar aceite de termos, tratando como ambíguo:', e.message);
    const resultado = {
      decisao: 'ambiguo',
      origem: 'fallback_erro',
      motivoFallback: e.message,
      tempoRespostaMs: Date.now() - inicio,
      sucesso: false,
      erro: e.message
    };
    _registrarLogAceite(resultado, texto, osNumero, clienteNome, telefone);
    return resultado;
  }
}

function _registrarLogAceite(resultado, textoOriginal, osNumero, clienteNome, telefone) {
  try {
    db.registrarLogIA({
      osNumero, clienteNome, telefone,
      textoOriginal,
      rotulo: 'aceite_termos:' + resultado.decisao,
      origem: resultado.origem,
      motivoFallback: resultado.motivoFallback,
      tempoRespostaMs: resultado.tempoRespostaMs,
      sucesso: resultado.sucesso,
      erro: resultado.erro
    });
  } catch (eLog) {
    console.warn('[IA-Groq] Erro ao salvar log de classificação de aceite:', eLog.message);
  }

  // Bugfix: esta função é irmã de _registrarLog (usada por
  // classificarFormaPagamento) mas era uma função DIFERENTE — a notificação
  // de fallback por erro adicionada anteriormente só tinha sido colocada em
  // _registrarLog, deixando o fluxo de aceite/recusa de termos (SIM/NÃO ao
  // orçamento) sem notificar o sininho quando a IA falhasse de verdade.
  // Mesma regra: só notifica quando origem === 'fallback_erro' (falha real
  // de rede/API) — nunca quando a IA está desligada/sem chave de propósito
  // (aqui chamado de 'sem_ia', equivalente ao 'fallback_regras' da outra função).
  if (resultado.origem === 'fallback_erro') {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ia:classificacaoFallback', {
          osNumero,
          clienteNome,
          motivoFallback: resultado.motivoFallback,
          data: new Date().toISOString()
        });
      }
    } catch (eNotif) {
      console.warn('[IA-Groq] Erro ao notificar fallback (aceite de termos):', eNotif.message);
    }
  }
}

// ─── Teste de conexão (usado pela tela de Configurações) ─────────────────────
// Faz uma chamada mínima só para validar que a chave funciona, sem depender
// de nenhum texto de cliente real. Usado pelo botão "Testar Conexão" nas
// configurações, para o usuário saber na hora se a chave que colou é válida.
//
// @param {string} [apiKeyForcada] - chave digitada no campo (ainda não salva).
//   Se o campo estiver vazio, o chamador manda undefined e a função cai no
//   fallback da chave já salva (abaixo).
// @param {'classificacao'|'chat'} [tipo='classificacao'] - qual chave salva
//   usar como fallback quando apiKeyForcada não for informada. BUGFIX
//   (correcoesbugs.txt #3): antes, o fallback só olhava configFull.groqApiKey
//   (a chave de classificação de pagamento/termos), nunca
//   configFull.groqChatApiKey — então o botão "Testar Conexão" do bloco
//   Assistente de Chat, quando clicado com o campo em branco (comportamento
//   normal, pois testa a chave já salva), sempre reportava "Nenhuma chave
//   configurada" mesmo com a chave do chat salva e válida, porque o código
//   nunca chegava a olhar para ela.
async function testarConexao(apiKeyForcada, tipo) {
  const configFull = db.loadDB().config || {};
  const chaveSalva = tipo === 'chat' ? configFull.groqChatApiKey : configFull.groqApiKey;
  const apiKey = apiKeyForcada || chaveSalva || '';
  if (!apiKey) return { sucesso: false, erro: 'Nenhuma chave da API Groq configurada.' };

  try {
    const inicio = Date.now();
    const resposta = await _chamarGroqAPI(apiKey, [
      { role: 'system', content: 'Responda apenas com um JSON no formato {"ok": true}.' },
      { role: 'user', content: 'Responda apenas o JSON.' }
    ]);
    const conteudo = resposta?.choices?.[0]?.message?.content;
    if (!conteudo) throw new Error('Resposta vazia da API.');
    JSON.parse(conteudo); // só valida que é JSON de fato
    return { sucesso: true, tempoRespostaMs: Date.now() - inicio };
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

// chamarGroqAPI é exportada a partir da v41 para ser reaproveitada pelo
// assistente de chat (src/ia-chat.js) — mesma infraestrutura de rede desta
// v40.2, sem duplicar código.
module.exports = {
  classificarFormaPagamento,
  classificarEscolhaPagamentoEntrada,
  classificarAceiteTermos,
  testarConexao,
  chamarGroqAPI: _chamarGroqAPI,
  initNotificacoes,
};
