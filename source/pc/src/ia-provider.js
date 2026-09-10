const https = require('https');
const { chamarGroqAPI } = require('./ia-groq');
const { consumirLimiteIA } = require('./ia-rate-limit');

const PROVEDORES = Object.freeze({
  groq: { host: 'api.groq.com', path: '/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', key: 'groqChatApiKey' },
  openai: { host: 'api.openai.com', path: '/v1/chat/completions', model: 'gpt-4.1-mini', key: 'openaiApiKey' },
  deepseek: { host: 'api.deepseek.com', path: '/chat/completions', model: 'deepseek-v4-flash', key: 'deepseekApiKey' },
  anthropic: { host: 'api.anthropic.com', path: '/v1/messages', model: 'claude-sonnet-4-6', key: 'anthropicApiKey' }
});

function normalizarProvedor(valor) {
  const nome = String(valor || 'groq').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROVEDORES, nome) ? nome : 'groq';
}

function requisitarJson({ host, path, headers, corpo, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(corpo);
    const req = https.request({
      protocol: 'https:', host, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers },
      timeout: Math.max(5000, Math.min(60000, Number(timeoutMs) || 30000))
    }, res => {
      let resposta = '';
      res.setEncoding('utf8');
      res.on('data', parte => { if (resposta.length < 2_000_000) resposta += parte; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(resposta || '{}'); } catch (_) { return reject(new Error('O provedor retornou uma resposta inválida.')); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(json?.error?.message || `O provedor retornou status ${res.statusCode}.`));
        }
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tempo limite excedido ao consultar a IA.')));
    req.on('error', reject);
    req.end(payload);
  });
}

async function chamarIA(config, mensagens, opcoes = {}) {
  const provedor = normalizarProvedor(opcoes.provedor || config?.iaChatProvider);
  const definicao = PROVEDORES[provedor];
  const apiKey = String(opcoes.apiKey || config?.[definicao.key] || '').trim();
  if (!apiKey) throw new Error(`A chave do provedor ${provedor} ainda não foi configurada.`);
  if (provedor === 'groq') return chamarGroqAPI(apiKey, mensagens, opcoes);

  consumirLimiteIA({
    provedor,
    chave: apiKey,
    limiteMinuto: config?.limiteIAMinuto,
    limiteMes: config?.limiteIAMes
  });

  const model = String(opcoes.model || config?.iaChatModel || definicao.model).trim();
  if (provedor === 'anthropic') {
    const sistema = mensagens.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const conversa = mensagens.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '')
    }));
    const resposta = await requisitarJson({
      host: definicao.host, path: definicao.path, timeoutMs: opcoes.timeoutMs,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      corpo: { model, system: sistema, messages: conversa, max_tokens: Number(opcoes.maxTokens) || 900, temperature: opcoes.temperature ?? 0.3 }
    });
    return { choices: [{ message: { content: (resposta.content || []).map(item => item?.text || '').join('\n') } }], usage: resposta.usage };
  }

  return requisitarJson({
    host: definicao.host, path: definicao.path, timeoutMs: opcoes.timeoutMs,
    headers: { authorization: `Bearer ${apiKey}` },
    corpo: {
      model, messages,
      max_tokens: Number(opcoes.maxTokens) || 900,
      temperature: opcoes.temperature ?? 0.3,
      stream: false
    }
  });
}

async function testarConexao(config, { provedor, apiKey, model } = {}) {
  try {
    const resposta = await chamarIA(config, [{ role: 'user', content: 'Responda apenas OK.' }], {
      provedor, apiKey, model, maxTokens: 8, temperature: 0, timeoutMs: 15000
    });
    return { sucesso: Boolean(resposta?.choices?.[0]?.message?.content), provedor: normalizarProvedor(provedor || config?.iaChatProvider) };
  } catch (erro) {
    return { sucesso: false, erro: erro?.message || 'Não foi possível conectar ao provedor.' };
  }
}

module.exports = { PROVEDORES, normalizarProvedor, chamarIA, testarConexao };
