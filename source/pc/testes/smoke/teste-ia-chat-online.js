// Regressao do chat: hora do Brasil, busca web opcional e Markdown seguro.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = arquivo => fs.readFileSync(path.join(raiz, arquivo), 'utf8');

const chat = ler('src/ia-chat.js');
const groq = ler('src/ia-groq.js');
const renderer = ler('renderer/core/legacy-runtime.js');
const pagina = ler('renderer/index.html');
const estilo = ler('renderer/style.css');
const dominio = ler('src/database/domain.js');

assert.ok(chat.includes("timeZone: 'America/Sao_Paulo'"), 'chat deve fornecer a hora do Brasil ao modelo');
assert.ok(chat.includes('const respostaLocal = _respostaLocal(pergunta)'), 'hora e data devem funcionar sem depender da Groq');
assert.ok(chat.includes("origem: 'local'"), 'resposta local deve ser identificada sem consumir tokens');
assert.ok(chat.includes('Não foi possível localizar o serviço da IA na internet'), 'erro DNS deve ser traduzido para linguagem clara');
assert.ok(groq.includes("['ENOTFOUND', 'EAI_AGAIN']"), 'cliente Groq deve repetir uma falha DNS transitória uma vez');
assert.ok(chat.includes("MODELO_CHAT_COM_WEB = 'groq/compound-mini'"), 'chat deve usar o modelo com busca integrada quando a pergunta pede dado atual');
assert.ok(chat.includes('_perguntaPedePesquisaWeb(pergunta)'), 'chat deve limitar a busca online a perguntas externas atuais');
assert.ok(chat.includes('model: usarPesquisaWeb ? MODELO_CHAT_COM_WEB : undefined'), 'chat deve selecionar Compound somente quando necessario');
assert.ok(groq.includes('model = GROQ_MODEL'), 'cliente Groq deve aceitar modelo por chamada');
assert.ok(groq.includes("String(model).startsWith('groq/compound')"), 'cliente Groq deve tratar modelos Compound sem reasoning comum');
assert.ok(renderer.includes('function _renderMarkdownSeguro(msg)'), 'renderer deve ter formatador Markdown seguro');
assert.ok(renderer.includes("'<strong>$1</strong>'"), 'renderer deve converter **texto** em negrito');
assert.ok(renderer.includes('bolha.innerHTML = _renderMarkdownSeguro(texto);'), 'chat deve usar o formatador Markdown seguro');
assert.ok(chat.includes("'entregas', 'garantias', 'financeiro'"), 'chat deve consultar novas areas operacionais');
assert.ok(chat.includes('function _classificarCategoriasLocalmente(pergunta)'), 'perguntas claras devem evitar chamada extra de roteamento');
assert.ok(chat.includes('db.listarPagamentos().slice(0, 30)'), 'contexto financeiro deve ser limitado e compacto');
assert.ok(
  chat.includes("tipo === 'adicionar_custos_compra'") &&
  chat.includes('_executarAdicionarCustosCompra(acao.dados || {}, db)') &&
  chat.includes('banco.atualizarCompra(numero') &&
  chat.includes('banco.obterCompraPorNumero(numero)'),
  'IA deve propor, executar e confirmar por releitura os custos em compra existente somente apos confirmacao'
);
assert.ok(chat.includes('function _interpretarAcaoLocal(pergunta, banco = db)'),
  'pedido de custos em compra deve ser reconhecido localmente sem depender da Groq');
assert.ok(chat.includes("podeModulo(usuario, 'estoque', 'editar') ? _interpretarAcaoLocal(pergunta) : null"),
  'acao local so pode consultar compras depois da autorizacao');
assert.ok(
  chat.includes('const valorTotal = valorAparelho + custoPecas') &&
  chat.includes('custoTotal: valorTotal'),
  'custos adicionados pela IA devem atualizar os totais financeiros da compra'
);
assert.ok(renderer.includes("acao.tipo === 'adicionar_custos_compra'"),
  'renderer deve mostrar resumo revisavel antes de adicionar custos');
assert.ok(renderer.includes("titulo: `${ICONE_LAPIS} Adicionar custos"),
  'cartao de custos deve usar um icone existente e renderizar sem excecao');
assert.ok((renderer.match(/normalizarReferenciasOS\(String\(msg\)\)/g) || []).length >= 2,
  'textos e Markdown devem remover repeticoes como OS OS-0019');
assert.ok(pagina.includes('Assistente Sistema OS'), 'widget deve usar identidade profissional própria');
assert.ok(pagina.includes('class="iaChatPulso"'), 'marca flutuante deve ter animação de presença');
assert.ok(estilo.includes('#iaChatCabecalho .iaChatLogo svg') && estilo.includes('#iaChatBotao > svg'),
  'logo da IA deve permanecer visivel na paleta escura');
assert.ok(estilo.includes('background-color: #11161e !important'),
  'cards operacionais devem manter superficie escura de alto contraste');
assert.ok(estilo.includes('@media (prefers-reduced-motion: reduce)'), 'animações devem respeitar acessibilidade');
assert.ok(dominio.includes('assinaturaClienteBase64: d.assinaturaClienteBase64'), 'reenvio da mesma OS deve atualizar a assinatura no PC');

console.log('OK: chat tem visual profissional, contexto amplo/seletivo, hora, web e Markdown seguro.');
