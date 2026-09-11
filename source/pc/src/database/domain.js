// src/db.js — v4 com Estoque, Status OS e configurações expandidas
//
// ═══════════════════════════════════════════════════════════════
// CAMADA DE ACESSO A DADOS (REPOSITORY) — ETAPA 10
// ═══════════════════════════════════════════════════════════════
// Este arquivo é o ÚNICO ponto de leitura/escrita do database.json.
// Nada em main.js, renderer.js, src/backup.js, src/pdf.js ou
// src/uploadService.js lê/escreve esse arquivo diretamente — todos
// passam por funções daqui. Isso é o que permite, no futuro, trocar
// o armazenamento (JSON local → SQLite → PostgreSQL, etc.) reescrevendo
// só este arquivo, sem tocar no resto do sistema, desde que as funções
// exportadas mantenham os mesmos nomes e formatos de retorno.
//
// Toda leitura passa por loadDB() e toda escrita por saveDB(db) — são
// os dois únicos pontos que tocam o arquivo físico (fs.readFileSync /
// fs.writeFileSync em getDbPath()). Qualquer nova função de dados deve
// usar loadDB()/saveDB() e nunca acessar fs diretamente.
//
// ───────────────────────────────────────────────────────────────
// SCHEMA DO database.json (formato atual, versão 4)
// ───────────────────────────────────────────────────────────────
// {
//   versao: number,                 // versão do schema do banco (atual: 4)
//   proximoNumero: number,          // contador sequencial para gerar "OS-0001", "OS-0002"...
//   proximoEstoqueId: number,       // contador sequencial de itens de estoque
//   config: {                       // configurações da empresa/sistema — ver DEFAULT_CONFIG
//     nomeEmpresa, nomeFantasia, razaoSocial, cnpj, inscricaoEstadual,
//     endereco, telefone, email, logoPath, logoBase64,
//     versaoConfig, ...             // demais campos em DEFAULT_CONFIG / migrarConfig()
//   },
//   ordens: [                       // Ordens de Serviço (OS)
//     {
//       numero: string,             // ex: "OS-0001" (chave usada nas buscas, único)
//       data: string (ISO),
//       status: string,             // um de STATUS_OS_VALIDOS
//       historicoStatus: [{ status, data }],
//       prioridade: string,         // um de PRIORIDADES_OS_VALIDAS
//       cliente: { nome, telefone, cpf, ... },
//       aparelho: { marca, modelo, defeitoRelatado, imei, ... },
//       observacoes: string,
//       termos: string,
//       checklist: [{ id, label, ok }],
//       pdfPath: string,            // caminho do PDF gerado (PDFs/)
//       fotos: [                    // ETAPA 8.7.2 — galeria de fotos da OS
//         { id, categoria, path, base64, nome, data }
//         // nota: aqui o base64 AINDA é persistido (fora do escopo da
//         // correção da Etapa 9, que tratou só fotos de ESTOQUE)
//       ]
//     }
//   ],
//   estoque: [                      // Itens de estoque (aparelhos para revenda)
//     {
//       id: string,
//       marca, modelo, tipoEquipamento, cor, imei,
//       status: string,             // um de STATUS_ESTOQUE_VALIDOS
//       dataCadastro: string (ISO),
//       valorPago, valorGastoPecas, gastosExtras, valorVenda, percentualLucro: number,
//       checklist: [{ id, label, ok }],
//       pdfVendaPath: string,
//       fotos: [
//         { path, nome }            // ETAPA 9: SEM base64 — carregado via file:// no path
//                                    // (registros antigos podem ter { path, base64, nome })
//       ]
//     }
//   ],
//   historicoExclusoes: [           // log de exclusões de OS/estoque (auditoria simples)
//     { tipo, identificador, usuario, data }
//   ]
// }
// ───────────────────────────────────────────────────────────────


const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PREFIXO_SEGREDO_SEGURO = 'sistemaos-safe-storage-v1:';
const CAMPOS_CONFIG_SECRETOS = Object.freeze([
  'mercadoPagoToken',
  'wappflyApiKey',
  'groqApiKey',
  'groqChatApiKey',
  'openaiApiKey',
  'anthropicApiKey',
  'deepseekApiKey'
]);
let armazenamentoSeguro = null;

function configurarArmazenamentoSeguro(provedor) {
  armazenamentoSeguro = provedor || null;
  return armazenamentoSeguroDisponivel();
}

function armazenamentoSeguroDisponivel() {
  try {
    return !!(armazenamentoSeguro
      && armazenamentoSeguro.isEncryptionAvailable()
      && typeof armazenamentoSeguro.encryptString === 'function'
      && typeof armazenamentoSeguro.decryptString === 'function');
  } catch (_) {
    return false;
  }
}

function criptografarSegredo(valor) {
  const segredo = String(valor || '');
  if (!segredo || segredo.startsWith(PREFIXO_SEGREDO_SEGURO)) return segredo;
  if (!armazenamentoSeguroDisponivel()) {
    throw new Error('O cofre seguro do Windows nao esta disponivel. A chave nao foi gravada em texto aberto.');
  }
  const cifrado = armazenamentoSeguro.encryptString(segredo).toString('base64');
  return PREFIXO_SEGREDO_SEGURO + cifrado;
}

function descriptografarSegredo(valor) {
  const segredo = String(valor || '');
  if (!segredo.startsWith(PREFIXO_SEGREDO_SEGURO)) return segredo;
  if (!armazenamentoSeguroDisponivel()) return '';
  try {
    return armazenamentoSeguro.decryptString(Buffer.from(segredo.slice(PREFIXO_SEGREDO_SEGURO.length), 'base64'));
  } catch (_) {
    console.error('[Seguranca] Uma credencial local nao pode ser aberta neste usuario do Windows.');
    return '';
  }
}

function prepararConfigParaDisco(config) {
  const segura = Object.assign({}, config || {});
  for (const campo of CAMPOS_CONFIG_SECRETOS) segura[campo] = criptografarSegredo(segura[campo]);
  return segura;
}

function abrirConfigDoDisco(config) {
  const aberta = Object.assign({}, config || {});
  for (const campo of CAMPOS_CONFIG_SECRETOS) aberta[campo] = descriptografarSegredo(aberta[campo]);
  return aberta;
}
const MAX_FOTOS_POR_DOCUMENTO = 10;
const { app } = require('electron');
const uploadService = require('../uploadService');
const { createClientesRepository } = require('../repositories/clientes-repository');
const SUPABASE_PUBLIC_CONFIG = require('../supabase/public-config');
const financeiroLedger = require('../finance/ledger');
const { normalizarLembretes, normalizarExclusoes, recalcularFinanceiro } = require('../supabase/cobrancas-sync');
const {
  TIPOS_ITEM_ESTOQUE,
  normalizarTipoItem,
  calcularMovimentacaoEstoque
} = require('../inventory/stock-item');

// ── Hash da senha de exclusão (scrypt nativo do Node, sem dependência nova) ──
function gerarHashSenha(senhaPlana) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senhaPlana), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verificarHashSenha(senhaPlana, senhaHashSalt) {
  if (!senhaHashSalt || !senhaHashSalt.includes(':')) return false;
  const [salt, hashArmazenado] = senhaHashSalt.split(':');
  const hashTentativa = crypto.scryptSync(String(senhaPlana || ''), salt, 64).toString('hex');
  const bufArmazenado = Buffer.from(hashArmazenado, 'hex');
  const bufTentativa = Buffer.from(hashTentativa, 'hex');
  if (bufArmazenado.length !== bufTentativa.length) return false;
  return crypto.timingSafeEqual(bufArmazenado, bufTentativa);
}

// ── Sanitização genérica de dados de entrada (Etapa 12) ──
// Remove bytes nulos e caracteres de controle de toda string recebida
// do renderer antes de persistir, e corta strings absurdamente longas
// (proteção contra payloads gigantes em campos de texto livre).
// Não sanitiza HTML aqui — isso é feito no momento de gerar o PDF
// (escapeHtml nos templates), pois aqui ainda é só dado, não saída.
const LIMITE_STRING_LIVRE = 20000; // ~20k chars é mais que suficiente p/ qualquer campo de texto livre
function sanitizarValor(valor) {
  if (typeof valor === 'string') {
    let v = valor.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // remove ctrl chars (mantém \n e \t)
    if (v.length > LIMITE_STRING_LIVRE) v = v.slice(0, LIMITE_STRING_LIVRE);
    return v;
  }
  if (Array.isArray(valor)) return valor.map(sanitizarValor);
  if (valor && typeof valor === 'object') {
    const out = {};
    for (const k of Object.keys(valor)) out[k] = sanitizarValor(valor[k]);
    return out;
  }
  return valor;
}

// Sanitiza um objeto normalmente, mas preserva SEM CORTE os campos
// listados em `campos` (ex.: assinaturas em base64) — mesmo problema que
// já existia com fotos (ver comentário em criarOS): sanitizarValor trunca
// qualquer string em LIMITE_STRING_LIVRE (20k chars), e um PNG de
// assinatura em base64 passa disso com facilidade, corrompendo a imagem
// no meio (ela chega "cortada" no PDF). Usado em qualquer função que grava
// assinaturaClienteBase64/assinaturaCompradorBase64/etc. junto com o resto
// dos dados de um formulário.
function sanitizarPreservandoCampos(obj, campos) {
  if (!obj || typeof obj !== 'object') return sanitizarValor(obj);
  const preservados = {};
  const semCampos = Object.assign({}, obj);
  for (const c of campos) {
    preservados[c] = obj[c];
    semCampos[c] = undefined;
  }
  return Object.assign(sanitizarValor(semCampos), preservados);
}


// Normaliza a lista de peças trocadas informadas manualmente no diagnóstico
// técnico da OS (mesmo padrão de {nome, valor} já usado em pecasTrocar do
// Contrato de Compra). Usada tanto na criação quanto na atualização da OS.
function normalizarPecasTrocarOS(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map(p => ({ nome: sanitizarValor(String(p?.nome || '').trim()), valor: parseFloat(p?.valor) || 0 }))
    .filter(p => p.nome || p.valor);
}

// Peças aplicadas em aparelhos preparados para revenda. O detalhamento fica
// separado do total financeiro para permitir ajustes manuais (frete, desconto
// ou um custo antigo sem composição), sem perder o nome e o valor de cada peça.
function normalizarPecasUsadasAparelho(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .slice(0, 100)
    .map(peca => ({
      nome: sanitizarValor(String(peca?.nome || peca?.descricao || '').trim()).slice(0, 160),
      valor: Math.max(0, Number.parseFloat(peca?.valor) || 0)
    }))
    .filter(peca => peca.nome || peca.valor > 0);
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: VALIDAÇÕES
// ═══════════════════════════════════════════════════════════════
// ─── Validação de CPF (dígito verificador) ───
function validarCPF(cpf) {
  const nums = (cpf || '').replace(/\D/g, '');
  if (nums.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(nums)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(nums[i]) * (10 - i);
  let r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(nums[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(nums[i]) * (11 - i);
  r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
  return r === parseInt(nums[10]);
}

// ─── Validação de IMEI (15 dígitos numéricos — padrão GSM/GSMA) ───
// IMEI é sempre 15 dígitos: TAC (8) + Serial (6) + Check Digit (1).
// 14 dígitos era um formato antigo pré-2003 que não deve ser aceito em
// aparelhos modernos. Manter só 15 evita cadastrar seriais truncados.
function validarIMEI(imei) {
  const nums = (imei || '').replace(/\D/g, '');
  return nums.length === 15;
}

// ─── Validação de OS ───
function validarDadosOS(dadosOS) {
  const erros = {};
  const nome = (dadosOS.cliente?.nome || '').trim();
  const telefone = (dadosOS.cliente?.telefone || '').trim();
  const marca = (dadosOS.aparelho?.marca || '').trim();
  const modelo = (dadosOS.aparelho?.modelo || '').trim();
  const defeito = (dadosOS.aparelho?.defeitoRelatado || '').trim();
  const cpf = (dadosOS.cliente?.cpf || '').trim();
  const imei = (dadosOS.aparelho?.imei || dadosOS.imei || '').trim();

  if (!nome) erros.nome = 'Nome do cliente é obrigatório.';
  if (!marca) erros.marca = 'Marca é obrigatória.';
  if (!modelo) erros.modelo = 'Modelo é obrigatório.';
  if (!defeito) erros.defeitoRelatado = 'Defeito relatado é obrigatório.';
  if (cpf && !validarCPF(cpf)) erros.cpf = 'CPF inválido.';
  if (imei && !validarIMEI(imei)) erros.imei = 'IMEI inválido (deve ter 15 dígitos).';

  return Object.keys(erros).length === 0 ? null : erros;
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: DIRETÓRIOS E CAMINHOS (raiz, PDFs, backups, uploads)
// ═══════════════════════════════════════════════════════════════
let empresaAtivaId = '';

function normalizarEmpresaId(valor) {
  const id = String(valor || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{3,80}$/.test(id)) throw new Error('Identificador de empresa inválido para o banco local.');
  return id;
}

function getRootGlobalDir() {
  const root = path.join(app.getPath('documents'), 'Sistema OS');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}
function getRootDir() {
  const global = getRootGlobalDir();
  const root = empresaAtivaId ? path.join(global, 'empresas', empresaAtivaId) : global;
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function ativarEscopoEmpresa(empresaId, opcoes = {}) {
  const id = normalizarEmpresaId(empresaId);
  const global = getRootGlobalDir();
  const destino = path.join(global, 'empresas', id);
  const bancoDestino = path.join(destino, 'database.json');
  const bancoLegado = path.join(global, 'database.json');
  const novo = !fs.existsSync(bancoDestino);
  fs.mkdirSync(destino, { recursive: true });
  let migradoLegado = false;
  if (novo && opcoes.migrarLegado === true && fs.existsSync(bancoLegado)) {
    fs.copyFileSync(bancoLegado, bancoDestino);
    migradoLegado = true;
  }
  empresaAtivaId = id;
  uploadService.ativarEscopoEmpresa?.(id);
  if (!fs.existsSync(bancoDestino)) saveDB(JSON.parse(JSON.stringify(DEFAULT_DB)));
  return { empresaId: id, rootDir: destino, novo, migradoLegado };
}

function desativarEscopoEmpresa() {
  empresaAtivaId = '';
  uploadService.desativarEscopoEmpresa?.();
}

function obterEscopoEmpresaAtivo() {
  return empresaAtivaId;
}
function getDbPath()      { return path.join(getRootDir(), 'database.json'); }

// ─── ETAPA 9-B — Controle de tamanho do database.json ──────────
// Não muda arquitetura nenhuma: só dá visibilidade pro usuário antes
// que o arquivo cresça demais (OS antigas + fotos de estoque são as
// causas mais comuns).
const LIMITE_TAMANHO_DB_BYTES = 15 * 1024 * 1024; // 15MB

function verificarTamanhoDB() {
  const caminho = getDbPath();
  let tamanhoBytes = 0;
  try {
    tamanhoBytes = fs.existsSync(caminho) ? fs.statSync(caminho).size : 0;
  } catch (e) {
    console.error('Falha ao verificar tamanho do database.json:', e);
  }
  const tamanhoMB = tamanhoBytes / (1024 * 1024);
  return {
    tamanhoBytes,
    tamanhoMB: Number(tamanhoMB.toFixed(2)),
    limiteMB: LIMITE_TAMANHO_DB_BYTES / (1024 * 1024),
    alerta: tamanhoBytes > LIMITE_TAMANHO_DB_BYTES,
  };
}
function getPdfDir()      { const d = path.join(getRootDir(), 'PDFs');    if (!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); return d; }
function getPdfVendaDir() { const d = path.join(getRootDir(), 'PDFs-Venda'); if (!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); return d; }
function getBackupDir()   { const d = path.join(getRootDir(), 'BACKUP - OS'); if (!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); return d; }
function getBackupAutoDir() { const d = path.join(getRootDir(), 'BACKUP - OS', 'auto'); if (!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); return d; }
// ─── ETAPA 9 — uploads centralizados em /uploads/<categoria> ───
// Mantidos os mesmos nomes de função (compatibilidade com o resto do
// código), mas agora apontando para a estrutura oficial de uploads.
// Caminhos de arquivos já salvos em versões anteriores (Logo,
// Fotos-Estoque, Fotos-OS) continuam funcionando normalmente, pois o
// path é gravado por extenso em cada registro — só os NOVOS uploads
// passam a ir para a nova estrutura.
function getLogoDir()     { return uploadService.getUploadDir('logos'); }
function getFotosDir()    { return uploadService.getUploadDir('fotos'); }
function getFotosOSDir()  { return uploadService.getUploadDir('os'); }
function getVendasUploadDir() { return uploadService.getUploadDir('vendas'); }
function getAnexosUploadDir() { return uploadService.getUploadDir('anexos'); }

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: CONFIG (defaults e migração de config)
// ═══════════════════════════════════════════════════════════════
const DEFAULT_CONFIG = {
  // ── Identificação ──────────────────────────────────────────
  nomeEmpresa: 'A&T Assistência Técnica', // mantido por compatibilidade (nome usado no topo do sistema)
  nomeFantasia: '',
  razaoSocial: '',
  cnpj: '',
  inscricaoEstadual: '',
  possuiCnpj: false,
  exibirCnpjDocumentos: true,

  // ── Contato ─────────────────────────────────────────────────
  telefoneEmpresa: '',   // mantido por compatibilidade (= telefone principal)
  telefonePrincipal: '',
  telefoneFixo: '',
  whatsapp: '',
  email: '',
  site: '',

  // ── Endereço ────────────────────────────────────────────────
  enderecoEmpresa: '',   // mantido por compatibilidade (endereço completo em texto livre)
  endereco: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  estado: '',
  cep: '',

  // ── Visual / Logo ───────────────────────────────────────────
  logoPath: '',
  logoBase64: '',
  temaModo: 'dark',

  // ── Tema Visual do Sistema ────────────────────────────────────
  // Identidade monocromática. Cores são reservadas a estados.
  tema: {
    corPrincipal: '#FFFFFF',
    corSecundaria: '#000000',
    corDestaque: '#FFFFFF',
    corBotoes: '#FFFFFF',
    corCabecalhos: '#000000',
    corBarraLateral: '#000000',
    corCards: '#111111',
    corLinks: '#FFFFFF'
  },

  // ── Tema Visual dos PDFs (Etapa 5) ────────────────────────────
  // Quando usarTemaSistemaPdf=true, as cores de `tema` (acima) são usadas
  // automaticamente nos PDFs. Quando false, usa-se este conjunto próprio.
  temaPdf: {
    usarTemaSistemaPdf: true,
    corCabecalhos: '#111111',
    corTitulos: '#111111',
    corLinhasDestaque: '#111111',
    corTabelas: '#111111',
    corRodapes: '#111111',
    corBordas: '#111111',
    corElementosGraficos: '#111111'
  },

  // ── Operação ────────────────────────────────────────────────
  termosOS: '',
  termosVenda: '',
  termosCompra: '',
  termosGarantia: '',
  usarTermosPredefinidosOS: false,
  usarTermosPredefinidosVenda: false,
  usarTermosPredefinidosCompra: false,
  usarTermosPredefinidosGarantia: false,
  garantiaPadrao: '90 dias',
  textoRodapePdf: '',
  percentualLucroPadrao: 30,
  // Tamanho da logo nos PDFs (altura máx. em px). Padrão: 80px
  tamanhoLogoPdf: 80,
  // Converte somente a renderizacao do logo no PDF para preto. Util para
  // logos brancas destinadas a telas escuras, mantendo o PNG original.
  logoPdfMonocromatica: false,
  // Tamanho da fonte dos termos nos PDFs (pt). 0/ausente = usa o tamanho
  // de fábrica de cada template (resolvido em fonte-termos-pdf.js).
  tamanhoFonteTermosPdf: 0,

  // ── Segurança ───────────────────────────────────────────────
  senhaExclusao: '',

  // ── Integrações (v20) ──────────────────────────────────────────
  mercadoPagoToken: '',
  // Desligado por padrão: controla somente o uso automático/padrão do
  // Mercado Pago nos envios manuais do WhatsApp. Cada envio compatível ainda
  // pode ativar ou desativar a opção apenas para aquela vez.
  mercadoPagoWhatsAppAtivo: false,
  pixChave: '',
  pixTipoChave: 'telefone', // 'telefone' | 'cpf' | 'cnpj' | 'email' | 'aleatoria'

  // ── Integração IA — Groq (v40.2) ─────────────────────────────
  // Classificação automática da forma de pagamento manual digitada em
  // texto livre pelo cliente no WhatsApp (ver src/ia-groq.js). Chave
  // sensível — segue o mesmo tratamento de mercadoPagoToken/wappflyApiKey:
  // nunca é devolvida ao renderer (ver obterConfig() abaixo), só uma flag
  // booleana indicando se já foi configurada.
  groqApiKey: '',
  groqClassificacaoAtiva: true, // liga/desliga a classificação por IA sem apagar a chave salva
  groqChatApiKey: '', // v46: chave separada para o assistente de chat flutuante (src/ia-chat.js)
  iaChatProvider: 'groq',
  iaChatModel: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  deepseekApiKey: '',

  // ── WhatsApp (v25.3) ───────────────────────────────────────────
  // Código do país (DDI) usado no envio de mensagens WhatsApp.
  // Apenas dígitos. Brasil = '55'. Pode ser sobrescrito por envio na hora.
  codigoPaisWhatsapp: '55',

  // ── Supabase (migração gradual, Etapa 7 Electron) ───────────
  // O desktop usa somente a anon key e autenticação do usuário. service_role
  // é rejeitada no processo principal.
  supabaseConfig: {
    // Já vem preenchido na distribuição. A ativação permanece gradual até a
    // migração remota e a criação dos usuários serem confirmadas.
    url: SUPABASE_PUBLIC_CONFIG.url,
    anonKey: SUPABASE_PUBLIC_CONFIG.anonKey,
    loginAliases: SUPABASE_PUBLIC_CONFIG.loginAliases
  },
  supabaseAtivo: true,

  // ── Rede / Arquitetura Futura (Etapa 11.4) ───────────────────
  // Estrutura preparada para uma futura migração para servidor/SaaS,
  // sem exigir refatoração. Hoje só o modo "local" é suportado —
  // os demais campos ficam prontos, mas inertes, até a etapa que
  // implementar de fato a camada de rede.
  rede: {
    modoOperacao:          'local', // 'local' (ativo) | 'servidor' (placeholder, não implementado ainda)
    apiUrl:                '',
    apiToken:              '',
    chaveEmpresa:          '',
    identificadorEmpresa:  '',
  },

  // ── Controle de migração ────────────────────────────────────
  configVersao: 7
};

const CONFIG_VERSAO_ATUAL = 7;

// Limpeza de migração: apaga credenciais e flags de provedores removidos
// que possam existir em bancos locais criados por versões antigas. Nenhum
// desses campos volta a ser exposto, aceito ou salvo pelo aplicativo atual.
const CHAVES_CONFIG_OBSOLETAS = Object.freeze([
  'firebaseConfig',
  'cloudinaryConfig',
  'firebaseSyncAtivo'
]);

function limparChavesConfigObsoletas(config) {
  if (!config || typeof config !== 'object') return 0;
  let removidas = 0;
  for (const chave of CHAVES_CONFIG_OBSOLETAS) {
    if (Object.prototype.hasOwnProperty.call(config, chave)) {
      delete config[chave];
      removidas += 1;
    }
  }
  return removidas;
}

// Migra configurações antigas (sem os novos campos empresariais) para o
// novo formato, preservando todos os dados já existentes — nenhuma
// informação previamente cadastrada é perdida.
function migrarConfig(configAntiga) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, configAntiga || {});

  // telefoneEmpresa (antigo) ⇄ telefonePrincipal (novo)
  if (!cfg.telefonePrincipal && cfg.telefoneEmpresa) cfg.telefonePrincipal = cfg.telefoneEmpresa;
  if (!cfg.telefoneEmpresa && cfg.telefonePrincipal) cfg.telefoneEmpresa = cfg.telefonePrincipal;

  // enderecoEmpresa (antigo, texto livre) ⇄ endereco (novo, campo separado)
  if (!cfg.endereco && cfg.enderecoEmpresa) cfg.endereco = cfg.enderecoEmpresa;
  if (!cfg.enderecoEmpresa) {
    const partes = [
      cfg.endereco,
      cfg.numero ? `nº ${cfg.numero}` : '',
      cfg.complemento,
      cfg.bairro,
      [cfg.cidade, cfg.estado].filter(Boolean).join(' - '),
      cfg.cep ? `CEP ${cfg.cep}` : ''
    ].filter(Boolean);
    if (partes.length) cfg.enderecoEmpresa = partes.join(', ');
  }

  // tema/temaPdf: merge raso garante que cores novas adicionadas em uma
  // atualização futura apareçam com o valor padrão, sem apagar as cores
  // já personalizadas pelo usuário.
  cfg.tema = Object.assign({}, DEFAULT_CONFIG.tema, configAntiga?.tema || {});
  cfg.temaPdf = Object.assign({}, DEFAULT_CONFIG.temaPdf, configAntiga?.temaPdf || {});
  cfg.rede = Object.assign({}, DEFAULT_CONFIG.rede, configAntiga?.rede || {});
  cfg.supabaseConfig = Object.assign({}, DEFAULT_CONFIG.supabaseConfig, configAntiga?.supabaseConfig || {});
  // URL/chave públicas vêm com o instalador. Instalações antigas que
  // possuíam os campos vazios não precisam ser configuradas manualmente.
  if (!cfg.supabaseConfig.url) cfg.supabaseConfig.url = DEFAULT_CONFIG.supabaseConfig.url;
  if (!cfg.supabaseConfig.anonKey) cfg.supabaseConfig.anonKey = DEFAULT_CONFIG.supabaseConfig.anonKey;
  cfg.supabaseConfig.loginAliases = Object.assign(
    {},
    DEFAULT_CONFIG.supabaseConfig.loginAliases,
    configAntiga?.supabaseConfig?.loginAliases || {}
  );
  limparChavesConfigObsoletas(cfg);
  cfg.supabaseAtivo = true;
  // URL/chave pública são distribuídas com o aplicativo. Não permanecem no
  // banco local e não podem ser sobrescritas por uma instalação.
  delete cfg.supabaseConfig;
  delete cfg.supabaseAtivo;

  // Migração v5: o padrão de tamanho da logo nos PDFs subiu de 60px para
  // 80px. Instalações que nunca mexeram nessa opção (config antiga com
  // configVersao < 5 e ainda no valor antigo de 60) são atualizadas para
  // o novo padrão. Quem já escolheu um valor manualmente (40, 80 ou 100)
  // não é alterado — a escolha do usuário é preservada.
  if ((configAntiga?.configVersao || 0) < 5 && configAntiga?.tamanhoLogoPdf === 60) {
    cfg.tamanhoLogoPdf = 80;
  }

  // Migração de segurança: se existir uma senha de exclusão antiga
  // salva em texto puro (sem o formato salt:hash), gera o hash agora.
  if (cfg.senhaExclusao && !String(cfg.senhaExclusao).includes(':')) {
    cfg.senhaExclusao = gerarHashSenha(cfg.senhaExclusao);
  }

  cfg.configVersao = CONFIG_VERSAO_ATUAL;
  return cfg;
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: NÚCLEO DO REPOSITORY (único ponto que toca o arquivo físico)
// ═══════════════════════════════════════════════════════════════
const DEFAULT_DB = {
  versao: 5,
  proximoNumero: 1,
  // Identificador público do cliente. É somente numérico, nunca é reciclado
  // e começa em 10000 para não ser confundido com número de OS/estoque.
  proximoClienteId: 10000,
  proximoEstoqueId: 1,
  proximoPecaId: 1,
  proximoUsuarioId: 1,
  proximoCargoId: 1,
  proximoCompraId: 1,
  proximoOrcId: 1,
  proximoDesbloqueioId: 1,
  config: { ...DEFAULT_CONFIG },
  ordens: [],
  estoque: [],
  pecas: [],
  modelosCadastrados: [],
  compras: [],
  orcamentos: [],
  usuarios: [],
  cargos: [],
  historicoExclusoes: [],
  logEstoque: [],
  logPecas: [],
  logMensagensWapp: [],  // histórico de mensagens WhatsApp enviadas
  logIA: [],              // v40.2 — histórico de classificações feitas pela IA (Groq)
  // App Celular — aba Entregas (garantia): comprovantes de retirada
  // importados do celular, um por numeroOS (ver criarOuSubstituirEntrega).
  entregas: [],
  // Bloco 3 — Nova Entrega criada no PC (ver seção ENTREGAS PENDENTES):
  // fila de entregas criadas no PC e mandadas para assinatura remota no
  // celular, ainda sem assinatura de volta. Sai desta lista e vira um
  // item de `entregas` (via criarOuSubstituirEntrega) quando a assinatura
  // retorna — nunca fica misturada com `entregas`, que é sempre um
  // comprovante já assinado.
  entregasPendentes: [],
  // Aba Garantia (criada manualmente no PC): comprovante de garantia por
  // OS (ver criarOuAtualizarGarantia).
  garantias: [],
  // Autorizações de desbloqueio: documento separado da OS, com declaração
  // de titularidade e ciência técnica assinável no aplicativo móvel.
  desbloqueios: []
};

function obterHashConteudoFoto(foto) {
  if (!foto || typeof foto !== 'object') return '';
  if (foto.conteudoHash) return String(foto.conteudoHash);
  try {
    let bytes = null;
    if (foto.base64 && typeof foto.base64 === 'string') {
      bytes = Buffer.from(foto.base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    } else if (foto.path && fs.existsSync(foto.path)) {
      bytes = fs.readFileSync(foto.path);
    }
    if (!bytes || !bytes.length) return '';
    return crypto.createHash('sha256').update(bytes).digest('hex');
  } catch (_) {
    return '';
  }
}

// Migra registros antigos e remove imagens repetidas pelo conteúdo real.
// Isso corrige também bancos que já receberam a mesma foto pelo lote JSON
// e, depois, novamente pelo Storage do Supabase.
function normalizarListaFotos(fotos, categoriaPadrao) {
  const vistas = new Set();
  const resultado = [];
  for (const original of (Array.isArray(fotos) ? fotos : [])) {
    if (!original || typeof original !== 'object') continue;
    const foto = Object.assign({}, original);
    const categoria = String(foto.categoria || categoriaPadrao || 'geral');
    const hash = obterHashConteudoFoto(foto);
    if (hash) foto.conteudoHash = hash;
    const chave = hash ? `${categoria}:${hash}` : `${categoria}:id:${foto.id || foto.path || resultado.length}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    resultado.push(foto);
  }
  return resultado;
}

function normalizarEstadoAssinatura(registro, campoAssinatura) {
  const item = Object.assign({}, registro || {});
  if (item[campoAssinatura]) {
    item.assinaturaPendente = false;
    item.naoAssinado = false;
  } else if (item.assinaturaPendente === true) {
    item.naoAssinado = false;
  } else {
    item.assinaturaPendente = false;
    item.naoAssinado = true;
  }
  return item;
}

function _chaveNaturalCliente(nome, cpf) {
  const cpfNormalizado = String(cpf || '').replace(/\D/g, '');
  if (cpfNormalizado) return `cpf:${cpfNormalizado}`;
  const nomeNormalizado = String(nome || '').trim().toLocaleLowerCase('pt-BR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  return nomeNormalizado ? `nome:${nomeNormalizado}` : '';
}

function _idClienteValido(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 10000 ? numero : 0;
}

// Migração aditiva: atribui o mesmo ID às ocorrências do mesmo cliente em OS,
// vendas e compras. IDs existentes vencem; o contador nunca retrocede.
function normalizarIdsClientes(database) {
  const porChave = new Map();
  const usados = new Set();
  let alterado = false;
  let proximo = Math.max(10000, Number(database.proximoClienteId) || 10000);

  const ocorrencias = [];
  (database.ordens || []).forEach(os => ocorrencias.push({
    alvo: os.cliente || (os.cliente = {}), campo: 'clienteId',
    nome: os.cliente?.nome, cpf: os.cliente?.cpf
  }));
  (database.estoque || []).forEach(item => {
    if (!item.compradorNome && !item.compradorCpf) return;
    ocorrencias.push({ alvo: item, campo: 'compradorClienteId', nome: item.compradorNome, cpf: item.compradorCpf });
  });
  (database.compras || []).forEach(compra => ocorrencias.push({
    alvo: compra.vendedor || (compra.vendedor = {}), campo: 'clienteId',
    nome: compra.vendedor?.nome, cpf: compra.vendedor?.cpf
  }));
  (database.desbloqueios || []).forEach(item => ocorrencias.push({
    alvo: item.cliente || (item.cliente = {}), campo: 'clienteId',
    nome: item.cliente?.nome, cpf: item.cliente?.cpf
  }));

  // Primeiro registra IDs válidos para que um documento antigo sem ID adote
  // o número que já pertence ao mesmo cliente em outro documento.
  ocorrencias.forEach(item => {
    const chave = _chaveNaturalCliente(item.nome, item.cpf);
    const existente = _idClienteValido(item.alvo[item.campo]);
    if (!chave || !existente) return;
    if (!porChave.has(chave)) porChave.set(chave, existente);
    usados.add(existente);
    proximo = Math.max(proximo, existente + 1);
  });

  const gerar = () => {
    while (usados.has(proximo)) proximo += 1;
    const id = proximo;
    usados.add(id);
    proximo += 1;
    return id;
  };
  ocorrencias.forEach(item => {
    const chave = _chaveNaturalCliente(item.nome, item.cpf);
    if (!chave) return;
    let id = porChave.get(chave) || _idClienteValido(item.alvo[item.campo]);
    if (!id) { id = gerar(); porChave.set(chave, id); }
    if (item.alvo[item.campo] !== id) { item.alvo[item.campo] = id; alterado = true; }
  });
  if (database.proximoClienteId !== proximo) {
    database.proximoClienteId = proximo;
    alterado = true;
  }
  return { database, alterado };
}

function obterOuCriarIdCliente(database, nome, cpf, preferido) {
  const idPreferido = _idClienteValido(preferido);
  if (idPreferido) return idPreferido;
  const chave = _chaveNaturalCliente(nome, cpf);
  if (!chave) return 0;
  const candidatos = [];
  (database.ordens || []).forEach(os => candidatos.push([os.cliente?.nome, os.cliente?.cpf, os.cliente?.clienteId]));
  (database.estoque || []).forEach(item => candidatos.push([item.compradorNome, item.compradorCpf, item.compradorClienteId]));
  (database.compras || []).forEach(compra => candidatos.push([compra.vendedor?.nome, compra.vendedor?.cpf, compra.vendedor?.clienteId]));
  (database.desbloqueios || []).forEach(item => candidatos.push([item.cliente?.nome, item.cliente?.cpf, item.cliente?.clienteId]));
  const encontrado = candidatos.find(item => _chaveNaturalCliente(item[0], item[1]) === chave && _idClienteValido(item[2]));
  if (encontrado) return Number(encontrado[2]);
  let proximo = Math.max(10000, Number(database.proximoClienteId) || 10000);
  const usados = new Set(candidatos.map(item => _idClienteValido(item[2])).filter(Boolean));
  while (usados.has(proximo)) proximo += 1;
  database.proximoClienteId = proximo + 1;
  return proximo;
}

// Recupera a assinatura padrão da própria assistência a partir de um
// documento antigo válido. Isso corrige bancos em que a configuração perdeu
// a imagem, sem fabricar assinatura e sem substituir uma assinatura existente.
function recuperarAssinaturaAssistencia(database) {
  const colecoes = [database.ordens, database.compras, database.estoque];
  const fallback = database.config?.assinaturaAssistenciaBase64 || colecoes
    .flatMap(lista => Array.isArray(lista) ? lista : [])
    .map(item => item?.assinaturaAssistenciaBase64)
    .find(valor => typeof valor === 'string' && valor.startsWith('data:image/')) || '';
  if (!fallback) return { database, alterado: false };
  let alterado = false;
  if (!database.config.assinaturaAssistenciaBase64) {
    database.config.assinaturaAssistenciaBase64 = fallback;
    alterado = true;
  }
  colecoes.forEach(lista => (lista || []).forEach(item => {
    if (!item.assinaturaAssistenciaBase64) {
      item.assinaturaAssistenciaBase64 = fallback;
      alterado = true;
    }
  }));
  return { database, alterado };
}

function loadDB() {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) { saveDB(DEFAULT_DB); return JSON.parse(JSON.stringify(DEFAULT_DB)); }
  try {
    const raw = fs.readFileSync(dbPath, 'utf-8');
    const data = JSON.parse(raw);
    // ── ETAPA 8.7.3 — migra status antigos das OS para os novos status avançados ──
    // v31 — em seguida, separa statusPagamento (campo novo) de status (só técnico)
    let statusOSAlterado = false;
    const ordensMigradas = (data.ordens || []).map(os => {
      const osComStatusMigrado = Object.assign({}, os, {
        status: migrarStatusOS(os.status),
        historicoStatus: (os.historicoStatus || []).map(h => Object.assign({}, h, { status: migrarStatusOS(h.status) }))
      });
      const osComPagamentoMigrado = migrarStatusPagamentoOS(osComStatusMigrado);
      if (osComPagamentoMigrado.statusPagamento !== os.statusPagamento
          || osComPagamentoMigrado.statusAprovacao !== os.statusAprovacao
          || osComPagamentoMigrado.percentualPagamentoConfirmado !== os.percentualPagamentoConfirmado) {
        statusOSAlterado = true;
      }
      // v36.3 — garante que OS criadas antes da automação de aprovação via
      // WhatsApp também tenham os novos campos, sem sobrescrever valores já existentes.
      return normalizarEstadoAssinatura(Object.assign({}, osComPagamentoMigrado, {
        aceitouTermos: osComPagamentoMigrado.aceitouTermos !== undefined ? osComPagamentoMigrado.aceitouTermos : null,
        motivoRecusaTermos: osComPagamentoMigrado.motivoRecusaTermos || '',
        respostaPreferenciaPagamento: osComPagamentoMigrado.respostaPreferenciaPagamento || '',
        dataRespostaTermos: osComPagamentoMigrado.dataRespostaTermos || '',
        estadoConversaAprovacao: osComPagamentoMigrado.estadoConversaAprovacao || ESTADO_CONVERSA_INICIAL,
        classificacaoResposta: osComPagamentoMigrado.classificacaoResposta || '',
        teveRespostaNaoEntendida: osComPagamentoMigrado.teveRespostaNaoEntendida === true,
        fotos: normalizarListaFotos(osComPagamentoMigrado.fotos, 'entrada')
      }), 'assinaturaClienteBase64');
    });
    const databaseNormalizado = Object.assign({}, DEFAULT_DB, data, {
      config: abrirConfigDoDisco(migrarConfig(data.config)),
      ordens: ordensMigradas,
      estoque: (data.estoque || []).map(item => normalizarEstadoAssinatura(Object.assign({}, item, {
        fotos: normalizarListaFotos(item.fotos, 'venda'),
        pecasUsadas: normalizarPecasUsadasAparelho(item.pecasUsadas)
      }), 'assinaturaCompradorBase64')),
      proximoEstoqueId: data.proximoEstoqueId || 1,
      pecas: data.pecas || [],
      proximoPecaId: data.proximoPecaId || 1,
      modelosCadastrados: data.modelosCadastrados || [],
      logPecas: data.logPecas || [],
      usuarios: data.usuarios || [],
      proximoUsuarioId: data.proximoUsuarioId || 1,
      cargos: data.cargos || [],
      proximoCargoId: data.proximoCargoId || 1,
      compras: (data.compras || []).map(item => normalizarEstadoAssinatura(Object.assign({}, item, {
        fotos: normalizarListaFotos(item.fotos, 'compra')
      }), 'assinaturaVendedorBase64')),
      proximoCompraId: data.proximoCompraId || 1,
      orcamentos: data.orcamentos || [],
      proximoOrcId: data.proximoOrcId || 1,
      proximoDesbloqueioId: data.proximoDesbloqueioId || 1,
      historicoExclusoes: data.historicoExclusoes || [],
      logEstoque: data.logEstoque || [],
      logMensagensWapp: data.logMensagensWapp || [],
      logIA: data.logIA || [],
      // App Celular — aba Entregas: aditivo, bancos salvos antes desta
      // função existir simplesmente não têm o array ainda.
      entregas: (data.entregas || []).map(item => normalizarEstadoAssinatura(item, 'assinaturaRetirouBase64')),
      // Bloco 3 — fila de Nova Entrega pendente de assinatura: mesmo
      // tratamento aditivo.
      entregasPendentes: data.entregasPendentes || [],
      // Aba Garantia: mesmo tratamento aditivo.
      garantias: data.garantias || [],
      desbloqueios: (data.desbloqueios || []).map(item =>
        normalizarEstadoAssinatura(item, 'assinaturaClienteBase64'))
    });
    const idsClientes = normalizarIdsClientes(databaseNormalizado);
    const assinaturas = recuperarAssinaturaAssistencia(idsClientes.database);
    const reconciliacao = reconciliarPagamentosOSLegadas(assinaturas.database);
    if (statusOSAlterado || idsClientes.alterado || assinaturas.alterado || reconciliacao.alterado) saveDB(reconciliacao.database);
    return reconciliacao.database;
  } catch (err) {
    // CRIT-5: Distinguir erro de parse (banco corrompido) de erro de I/O
    // (disco cheio, permissão negada, arquivo bloqueado por antivirus).
    // Em erro de I/O, NÃO resetamos o banco — lançamos exceção para o
    // chamador decidir o que fazer (o arquivo pode estar acessível depois).
    const isParseError = err instanceof SyntaxError || (err.message && err.message.includes('JSON'));
    const isIOError = err.code === 'EBUSY' || err.code === 'EACCES' || err.code === 'ENOSPC' || err.code === 'EPERM';

    if (isIOError) {
      // Erro de I/O: não resetar, não sobrescrever — o arquivo pode estar
      // temporariamente inacessível (antivirus, disco cheio temporário).
      console.error('[db.js] Erro de I/O ao ler banco:', err.code, err.message);
      throw new Error('Não foi possível acessar o banco de dados: ' + err.message + '. Verifique permissões e espaço em disco.');
    }

    // Erro de parse: banco corrompido — backup + reset é a melhor opção
    try {
      const bak = dbPath + '.corrompido-' + Date.now() + '.bak';
      if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, bak);
      console.error('Banco corrompido, backup salvo em:', bak, err);
    } catch (backupErr) {
      console.error('[db.js] Falha ao criar backup do banco corrompido:', backupErr.message);
    }
    saveDB(DEFAULT_DB);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

// ── Validação de integridade antes de save (proteção contra sobrescrita) ──
// Gera um hash rápido do estado atual do banco para detectar se outra
// operação modificou o arquivo entre loadDB() e saveDB(). Se o hash
// mudou, significa que outra operação salvou entrementes — neste caso,
// o save NÃO deve sobrescrever (perderia as mudanças da outra operação).
// Esta é uma forma de "optimistic locking" que funciona sem locks de
// arquivo ou filas assíncronas.
let _lastSaveHash = '';
let _lastSaveTime = 0;

function _gerarHashRapido(db) {
  // Hash do tamanho + primeiro e último OS (ou primeiro item de estoque/compra)
  // — rápido o bastante para ser síncrono, preciso o bastante para detectar mudanças reais.
  const ordens = db.ordens || [];
  const estoque = db.estoque || [];
  const compras = db.compras || [];
  const primeiro = ordens[0]?.numero || estoque[0]?.id || compras[0]?.numero || '';
  const ultimo = ordens[ordens.length - 1]?.numero || '';
  return `${ordens.length}:${estoque.length}:${compras.length}:${primeiro}:${ultimo}:${db.proximoNumero || 0}`;
}

function saveDB(db) {
  const dbPath = getDbPath();
  // Detecta alteração externa pelo horário real do arquivo. A verificação
  // antiga comparava o conteúdo novo com o último conteúdo salvo e marcava
  // toda alteração legítima feita em menos de um segundo como race condition.
  const hashAtual = _gerarHashRapido(db);
  const agora = Date.now();
  let alteradoExternamente = false;
  if (_lastSaveTime && fs.existsSync(dbPath)) {
    try { alteradoExternamente = fs.statSync(dbPath).mtimeMs > _lastSaveTime + 5; } catch (_) { /* best-effort */ }
  }
  if (alteradoExternamente) {
    console.warn('[db.js] AVISO: o banco foi modificado por outro processo desde a última gravação local.');
  }
  const tmp = dbPath + '.tmp';
  const persistivel = Object.assign({}, db, { config: prepararConfigParaDisco(db.config) });
  fs.writeFileSync(tmp, JSON.stringify(persistivel, null, 2), 'utf-8');
  fs.renameSync(tmp, dbPath);
  _lastSaveHash = hashAtual;
  try { _lastSaveTime = fs.statSync(dbPath).mtimeMs; } catch (_) { _lastSaveTime = agora; }
}

// O domínio de Clientes recebe as operações de persistência sem conhecer
// arquivo, caminho ou Electron.
const clientesRepository = createClientesRepository({ loadDB, saveDB });

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: HELPERS GERAIS (numeração de OS)
// ═══════════════════════════════════════════════════════════════
function extrairNumeroInteiro(n) { const m = String(n).match(/(\d+)/); return m ? parseInt(m[1],10) : 0; }
function formatarNumeroOS(n) { return 'OS-' + String(n).padStart(4,'0'); }
function gerarProximoNumero(db) { const n = formatarNumeroOS(db.proximoNumero); db.proximoNumero += 1; return n; }

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: OS (Ordens de Serviço)
// ═══════════════════════════════════════════════════════════════
// ── ETAPA 8.7.3 — Status visual avançado (Fluxo de Atendimento) ──
// "status" contém SOMENTE o andamento técnico. Aprovação do orçamento e
// pagamento são dimensões independentes: statusAprovacao informa a decisão
// do cliente, enquanto statusPagamento informa apenas o que foi recebido.
const STATUS_OS_VALIDOS = ['Aguardando análise','Em diagnóstico','Aguardando aprovação','Aguardando peça','Em reparo','Em testes','Pronto para retirada','Entregue','Cancelado'];
// Valores válidos do status de pagamento (campo separado, v31)
// v36.3 — adicionado 'Pagamento Manual' para suportar a automação de
// aprovação via WhatsApp (cliente escolhe pagar por fora/manualmente).
// Fase 6 — BUGFIX: 'Aguardando Pagamento na Retirada' já era gravado por
// src/whatsapp.js (bloco 'aguardando_forma_pagamento_retirada', Fase 5)
// mas nunca tinha sido incluído aqui. Como atualizarOS() valida statusPagamento
// contra esta lista antes de gravar, qualquer tentativa de setar esse status
// lançava "Status de pagamento inválido" e quebrava o fluxo — tanto o da
// Fase 5 (cliente informa a forma de pagamento pelo WhatsApp) quanto o botão
// manual desta fase. Adicionado para refletir o valor que já era usado.
const STATUS_PAGAMENTO_MISTO = 'Pagamento 50/50';
const STATUS_PAGAMENTO_VALIDOS = [
  '', 'Aguardando Pagamento', 'Aguardando Pagamento Presencial',
  'Aguardando Pagamento na Retirada', STATUS_PAGAMENTO_MISTO,
  'Pagamento 50/50 remoto', 'Pagamento 50/50 presencial',
  'Pago 50%', 'Pago', 'Pagamento Manual'
];
const STATUS_APROVACAO_VALIDOS = ['Pendente', 'Aprovado', 'Desaprovado'];

function normalizarStatusPagamento(valor) {
  const bruto = String(valor || '').trim();
  if (['Autorizado', 'Autorizada', 'Pago', 'pago', 'Quitado', 'Quitada'].includes(bruto)) return 'Pago';
  if (['Pago 50%', '50% pago', 'Pago parcialmente'].includes(bruto)) return 'Pago 50%';
  return bruto;
}

function inferirStatusAprovacao(os) {
  if (STATUS_APROVACAO_VALIDOS.includes(os?.statusAprovacao)) return os.statusAprovacao;
  if (os?.aceitouTermos === false) return 'Desaprovado';
  if (os?.aceitouTermos === true
      || ['Pago', 'Pago 50%'].includes(normalizarStatusPagamento(os?.statusPagamento))
      || Number(os?.percentualPagamentoConfirmado) > 0) return 'Aprovado';
  return 'Pendente';
}
// Status técnicos que encerram a OS (não contam como "em aberto" nem geram atraso)
const STATUS_OS_FECHADOS = ['Entregue', 'Cancelado'];
// ── ETAPA 8.7.1 — Prioridades válidas ──
const PRIORIDADES_OS_VALIDAS = ['Baixa','Normal','Alta','Urgente'];

// ── v36.3 — Automação de Aprovação via WhatsApp ──
// Controla em que ponto da conversa automatizada a OS se encontra.
const ESTADO_CONVERSA_INICIAL = 'nao_iniciada';
// BUGFIX: esta lista estava desatualizada em relação aos nomes de estado
// realmente usados em src/whatsapp.js / src/db.js desde a reforma "v45"
// (ex.: 'aguardando_termos' virou 'aguardando_sim_nao'; 'concluida' virou
// 'concluido', sem o "a"; 'aguardando_pagamento' foi substituído por
// 'aguardando_forma_pagamento_retirada', pois a forma de pagamento só é
// perguntada na etapa de retirada, não mais logo após o aceite dos termos).
// Não é usada em nenhuma validação hoje (só declarada/exportada/citada em
// comentário — confirmado por busca em todo o projeto), então esta correção
// não muda nenhum comportamento em runtime; só evita que a lista continue
// sendo uma isca de confusão para manutenção futura.
// Nota: 'nao_entendida' é gravado por registrarRespostaNaoEntendida() e
// permanece na lista por ser um valor real e possível do campo — mesmo não
// estando em ESTADOS_AUTOMACAO_ATIVOS (whatsapp.js), que é uma lista
// separada e propositalmente mais restrita (só os estados em que o bot
// continua escutando ativamente a próxima mensagem do cliente).
// Nota 2: 'aguardando_pagamento' (usado no fluxo antigo, pré-v45) ainda
// aparece escrito em registrarRespostaAprovacao() (db.js), mas nunca fica
// de fato persistido — a própria função comenta que esse valor é sempre
// sobrescrito para 'concluido' pela chamada seguinte, síncrona, feita pelo
// chamador em whatsapp.js. Por isso foi deixado fora desta lista.
const ESTADOS_CONVERSA_APROVACAO_VALIDOS = [
  'nao_iniciada',                        // ainda não foi enviada nenhuma mensagem de aprovação
  'aguardando_sim_nao',                  // mensagem de termos enviada, aguardando SIM/NÃO do cliente
  'aguardando_motivo_recusa',            // cliente respondeu NÃO, aguardando o motivo da recusa
  'aguardando_forma_pagamento_retirada', // aparelho pronto p/ retirada, aguardando forma de pagamento
  'concluido',                           // fluxo de aprovação finalizado (aceitou ou recusou)
  'nao_entendida',                       // última resposta não foi reconhecida (não é um estado "ativo" — ver nota acima)
  'aguardando_humano'                    // v40.4 — encaminhada para atendente humano (bot só escuta o "#" de cancelamento)
];
// Classificação da última resposta do cliente na conversa de aprovação.
const CLASSIFICACAO_RESPOSTA_VALIDAS = [
  '',                // ainda não classificada
  'aceite_termos',
  'recusa_termos',
  'forma_pagamento',
  'nao_entendida',
  'atendimento_humano' // conversa encaminhada para uma pessoa (cliente pediu ou tentativas esgotadas)
];

// Mapeia status antigos (pré-8.7.3) para os novos status avançados, sem
// perder nenhum dado já cadastrado nas OS existentes.
const MIGRACAO_STATUS_OS = {
  'Em orçamento': 'Em diagnóstico',
  'Aguardando aprovação do cliente': 'Aguardando aprovação',
  'Finalizado': 'Pronto para retirada'
};
function migrarStatusOS(status) { return MIGRACAO_STATUS_OS[status] || status; }

// v31 — migra OS antigas onde "status" guardava o status de pagamento
// ('Aguardando Pagamento' / 'Autorizado' / variações antigas) para o novo
// modelo com "statusPagamento" separado. Não perde nenhuma informação:
// o status técnico anterior é recuperado do histórico (historicoStatus),
// olhando a última entrada técnica registrada antes da entrada de pagamento.
const _VALORES_ANTIGOS_DE_PAGAMENTO = {
  'aguardando pagamento': 'Aguardando Pagamento',
  'Aguardando pagamento': 'Aguardando Pagamento',
  'Aguardando Pagamento': 'Aguardando Pagamento',
  'pago': 'Pago',
  'Pago': 'Pago',
  'Autorizada': 'Pago',
  'Autorizado': 'Pago'
};
function migrarStatusPagamentoOS(os) {
  // Bancos das versões anteriores usavam "Autorizado" como pagamento
  // integral. Normaliza sempre, inclusive quando statusPagamento já existe.
  if (os.statusPagamento !== undefined) {
    const statusPagamento = normalizarStatusPagamento(os.statusPagamento);
    return Object.assign({}, os, {
      statusPagamento,
      statusAprovacao: inferirStatusAprovacao(Object.assign({}, os, { statusPagamento })),
      entrada50Paga: statusPagamento === 'Pago'
        ? false
        : (statusPagamento === 'Pago 50%' ? true : os.entrada50Paga),
      percentualPagamentoConfirmado: statusPagamento === 'Pago'
        ? 100
        : (statusPagamento === 'Pago 50%' ? 50 : (Number(os.percentualPagamentoConfirmado) || 0))
    });
  }

  const statusBruto = os.status;
  const statusPagDetectado = _VALORES_ANTIGOS_DE_PAGAMENTO[statusBruto];

  if (!statusPagDetectado) {
    // status já era puramente técnico — só garante o campo statusPagamento existir.
    return Object.assign({}, os, {
      statusPagamento: '',
      statusAprovacao: inferirStatusAprovacao(os)
    });
  }

  // status antigo era um valor de pagamento: precisamos achar o status
  // técnico correto. Procura no histórico a última entrada técnica válida
  // (anterior à entrada de pagamento), senão usa um padrão razoável.
  const historico = os.historicoStatus || [];
  const statusTecnicoValidos = ['Aguardando análise','Em diagnóstico','Aguardando aprovação','Aguardando peça','Em reparo','Em testes','Pronto para retirada','Entregue','Cancelado'];
  let statusTecnicoRecuperado = null;
  for (let i = historico.length - 1; i >= 0; i--) {
    const h = migrarStatusOS(historico[i].status);
    if (statusTecnicoValidos.includes(h)) { statusTecnicoRecuperado = h; break; }
  }
  // Padrão: se já estava pago, assume "Em reparo" (fluxo normal
  // pós-pagamento); se só estava Aguardando Pagamento, assume "Aguardando aprovação".
  if (!statusTecnicoRecuperado) {
    statusTecnicoRecuperado = statusPagDetectado === 'Pago' ? 'Em reparo' : 'Aguardando aprovação';
  }

  return Object.assign({}, os, {
    status: statusTecnicoRecuperado,
    statusPagamento: statusPagDetectado,
    statusAprovacao: inferirStatusAprovacao(Object.assign({}, os, { statusPagamento: statusPagDetectado }))
  });
}

function _valorTotalFinanceiroOS(os) {
  return Number(os?.valorTotalServico || 0)
    || Number(os?.diagnosticoTecnico?.valorEstimado || 0)
    || Number(os?.valorInvestido || 0)
    || Number(os?.valor || 0)
    || 0;
}

function _dataPagamentoInferidaOS(os) {
  const historico = Array.isArray(os?.historicoStatus) ? os.historicoStatus : [];
  const eventoFinanceiro = [...historico].reverse().find((item) => {
    const status = String(item?.status || '');
    return item?.tipoPagamento === true
      || /autorizad|pagamento|pago|quitad/i.test(status);
  });
  const candidatos = [eventoFinanceiro?.data, os?.dataAtualizacao, os?.atualizadoEm, os?.data];
  return candidatos.find((valor) => valor && !Number.isNaN(new Date(valor).getTime()))
    || new Date().toISOString();
}

// Versões anteriores permitiam marcar a OS como paga sem criar o lançamento
// correspondente em `pagamentos`. O relatório usa o caixa real, portanto essas
// OS apareciam como R$ 0,00. A reconciliação abaixo cria apenas a diferença que
// estiver faltando e usa um ID estável, podendo rodar várias vezes sem duplicar.
function reconciliarPagamentosOSLegadas(database) {
  const db = database || {};
  db.pagamentos = Array.isArray(db.pagamentos) ? db.pagamentos : [];
  db.ordens = Array.isArray(db.ordens) ? db.ordens : [];
  let alterado = false;

  for (const os of db.ordens) {
    const total = _valorTotalFinanceiroOS(os);
    if (!(total > 0)) continue;

    let percentualAlvo = Math.max(0, Math.min(100, Number(os.percentualPagamentoConfirmado) || 0));
    let valorAlvo = Math.max(0, Math.min(total, Number(os.valorRecebidoConfirmado) || 0));
    if (normalizarStatusPagamento(os.statusPagamento) === 'Pago' || percentualAlvo >= 100) {
      percentualAlvo = 100;
      valorAlvo = total;
    } else if (!percentualAlvo && os.entrada50Paga === true) {
      percentualAlvo = 50;
    }
    if (!(valorAlvo > 0) && percentualAlvo > 0) valorAlvo = Number((total * percentualAlvo / 100).toFixed(2));
    if (!(valorAlvo > 0)) continue;

    const pagamentosOS = db.pagamentos.filter((pagamento) => pagamento.osNumero === os.numero);
    const totalRegistrado = pagamentosOS.reduce((soma, pagamento) => soma + (Number(pagamento.valor) || 0), 0);
    const valorFaltante = Number((valorAlvo - totalRegistrado).toFixed(2));
    if (valorFaltante <= 0.01) continue;

    const sufixo = percentualAlvo >= 100 ? 'QUITACAO' : `PARCIAL-${Math.round(valorAlvo * 100)}`;
    const numeroSeguro = String(os.numero || 'SEM-OS').replace(/[^a-z0-9-]/gi, '').toUpperCase();
    const id = `PAG-RECON-${numeroSeguro}-${sufixo}`;
    if (db.pagamentos.some((pagamento) => pagamento.id === id)) continue;

    const dataPagamento = _dataPagamentoInferidaOS(os);
    const valorAcumulado = Number((totalRegistrado + valorFaltante).toFixed(2));
    const pagamento = {
      id,
      osNumero: os.numero,
      clienteNome: os.cliente?.nome || '',
      clienteCpf: os.cliente?.cpf || '',
      clienteTel: os.cliente?.telefone || '',
      aparelho: [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' '),
      valor: valorFaltante,
      metodo: os.formaPagamento || 'Pagamento confirmado anteriormente',
      origem: 'reconciliado',
      observacao: 'Lançamento recuperado automaticamente a partir do status financeiro da OS.',
      caminhoComprovante: null,
      dataPagamento,
      criadoEm: dataPagamento,
      reconciliado: true,
      percentualQuitado: percentualAlvo,
      tipoComprovante: percentualAlvo >= 100 ? 'quitacao_100' : 'pagamento_parcial',
      valorTotalServico: total,
      valorAcumulado,
      valorRestanteAposPagamento: Math.max(0, Number((total - valorAcumulado).toFixed(2)))
    };
    db.pagamentos.push(pagamento);
    os.pagamentoId = id;
    os.valorTotalServico = total;
    os.valorRecebidoConfirmado = valorAlvo;
    os.valorRestanteServico = pagamento.valorRestanteAposPagamento;
    alterado = true;
  }

  return { database: db, alterado };
}

// ── ETAPA 8.7.3 — Previsão de Entrega: cálculo de atraso ──
// Atrasada = tem data prevista, já passou do prazo (data+hora) e a OS
// ainda não foi encerrada (não está Entregue nem Cancelada).
function calcularAtraso(os) {
  if (!os || !os.dataPrevista) return false;
  if (STATUS_OS_FECHADOS.includes(os.status)) return false;
  const hora = os.horaPrevista || '23:59';
  const limite = new Date(`${os.dataPrevista}T${hora}:00`);
  if (isNaN(limite.getTime())) return false;
  return limite.getTime() < Date.now();
}
function comAtraso(os) {
  return os ? Object.assign({}, os, {
    atrasada: calcularAtraso(os),
    lembretesCobranca: normalizarLembretes(os.lembretesCobranca),
    lembretesCobrancaExcluidos: normalizarExclusoes(os.lembretesCobrancaExcluidos)
  }) : os;
}

// ── ETAPA 8.7.1 — Código interno sequencial da OS (independente do número da OS) ──
function gerarProximoCodigoInterno(db) {
  if (typeof db.proximoCodigoInterno !== 'number') db.proximoCodigoInterno = 1;
  const codigo = 'INT-' + String(db.proximoCodigoInterno).padStart(5, '0');
  db.proximoCodigoInterno += 1;
  return codigo;
}

function criarOS(dadosOSEntrada) {
  // 'fotos' (base64 das fotos de "como chegou", vindas do lote do celular)
  // fica de fora do sanitizarValor abaixo: sanitizarValor trunca qualquer
  // string em LIMITE_STRING_LIVRE (20k chars), o que corromperia o base64
  // de uma foto JPEG (facilmente 100-300k chars). Fotos são validadas e
  // gravadas em disco separadamente, depois de criar a OS (ver fim da
  // função) — nunca passam pelo sanitizador de texto livre.
  // assinaturaClienteBase64/assinaturaAssistenciaBase64 também ficam de
  // fora do sanitizarValor pelo mesmo motivo das fotos acima: são base64
  // de imagem (PNG da assinatura), facilmente maiores que os 20k chars de
  // LIMITE_STRING_LIVRE — truncar corrompe a imagem (assinatura "cortada"
  // no PDF final).
  const fotosEntrada = Array.isArray(dadosOSEntrada?.fotos) ? dadosOSEntrada.fotos : [];
  const dadosOS = sanitizarPreservandoCampos(
    Object.assign({}, dadosOSEntrada, { fotos: undefined }),
    ['assinaturaClienteBase64', 'assinaturaAssistenciaBase64']
  );
  const erros = validarDadosOS(dadosOS);
  if (erros) throw new Error('Dados inválidos: ' + Object.values(erros).join(' | '));
  const db = loadDB();
  const numero = gerarProximoNumero(db);
  // Salva os termos da config como snapshot imutável
  const termosSnapshot = dadosOS.termos !== undefined ? dadosOS.termos : (db.config.termosOS || '');
  // ── ETAPA 8.7.1 — Código interno gerado automaticamente (a menos que informado manualmente) ──
  const codigoInterno = (dadosOS.controleInterno?.codigoInterno || '').trim() || gerarProximoCodigoInterno(db);
  const os = {
    numero,
    data: dadosOS.dataManual || new Date().toISOString(),
    dataAutomatic: dadosOS.dataAutomatic !== false,
    status: dadosOS.status || 'Aguardando análise',
    statusAprovacao: STATUS_APROVACAO_VALIDOS.includes(dadosOS.statusAprovacao)
      ? dadosOS.statusAprovacao
      : inferirStatusAprovacao(dadosOS),
    statusPagamento: STATUS_PAGAMENTO_VALIDOS.includes(normalizarStatusPagamento(dadosOS.statusPagamento))
      ? normalizarStatusPagamento(dadosOS.statusPagamento)
      : '',
    historicoStatus: [{ status: dadosOS.status || 'Aguardando análise', data: new Date().toISOString() }],
    // ── ETAPA 8.7.3 — Previsão de Entrega ──
    semPrazo: dadosOS.semPrazo === true,
    dataPrevista: dadosOS.semPrazo === true ? '' : (dadosOS.dataPrevista || ''),
    horaPrevista: dadosOS.semPrazo === true ? '' : (dadosOS.horaPrevista || ''),
    // ── ETAPA 8.7.1 — Prioridade da OS ──
    prioridade: PRIORIDADES_OS_VALIDAS.includes(dadosOS.prioridade) ? dadosOS.prioridade : 'Normal',
    // ── ETAPA 8.7.1 — Controle Operacional e Organização da Bancada ──
    controleInterno: {
      codigoInterno,
      etiquetaInterna: dadosOS.controleInterno?.etiquetaInterna || '',
      tagBancada: dadosOS.controleInterno?.tagBancada || '',
      numeroPatrimonio: dadosOS.controleInterno?.numeroPatrimonio || ''
    },
    // ── ETAPA 8.7.1 — Responsável Técnico ──
    tecnicoResponsavel: dadosOS.tecnicoResponsavel || '',
    tecnicoAuxiliar: dadosOS.tecnicoAuxiliar || '',
    cliente: {
      clienteId: obterOuCriarIdCliente(db, dadosOS.cliente?.nome, dadosOS.cliente?.cpf, dadosOS.cliente?.clienteId),
      nome: dadosOS.cliente?.nome || '',
      cpf: dadosOS.cliente?.cpf || '',
      email: dadosOS.cliente?.email || '',
      telefone: dadosOS.cliente?.telefone || ''
    },
    aparelho: {
      tipo: dadosOS.aparelho?.tipo || '',
      tipoEquipamento: dadosOS.aparelho?.tipoEquipamento || 'Smartphone',
      marca: dadosOS.aparelho?.marca || '',
      modelo: dadosOS.aparelho?.modelo || '',
      cor: dadosOS.aparelho?.cor || '',
      imei: dadosOS.aparelho?.imei || '',
      defeitoRelatado: dadosOS.aparelho?.defeitoRelatado || '',
      observacoes: dadosOS.aparelho?.observacoes || '',
      acessorios: dadosOS.aparelho?.acessorios || '',
      senhaAparelho: dadosOS.aparelho?.senhaAparelho || '',
      dadosEquipamento: dadosOS.aparelho?.dadosEquipamento || {},
      // ── ETAPA 8.6.1 — Checklist Técnico de Recebimento ──
      checklistDefeitos: Array.isArray(dadosOS.aparelho?.checklistDefeitos) ? dadosOS.aparelho.checklistDefeitos : [],
      acessoriosChecklist: Array.isArray(dadosOS.aparelho?.acessoriosChecklist) ? dadosOS.aparelho.acessoriosChecklist : [],
      testesEntrada: Array.isArray(dadosOS.aparelho?.testesEntrada) ? dadosOS.aparelho.testesEntrada : []
    },
    imei: dadosOS.imei || dadosOS.aparelho?.imei || '',
    observacoes: dadosOS.observacoes || '',
    termos: termosSnapshot,
    // ── App Celular (assinatura em campo) — v43 ──
    // Assinatura do cliente coletada no app web do celular (base64 de
    // imagem, gerado por canvas.toDataURL()). Quando presente, o PDF
    // injeta essa imagem no espaço de assinatura do cliente (ver pdf.js).
    // 'origem' marca de onde a OS veio, para exibir na listagem/detalhe.
    assinaturaClienteBase64: dadosOS.assinaturaClienteBase64 || '',
    assinaturaPendente: !!(!dadosOS.assinaturaClienteBase64 && dadosOS.assinaturaPendente === true),
    naoAssinado: !!(!dadosOS.assinaturaClienteBase64 && dadosOS.assinaturaPendente !== true && dadosOS.naoAssinado === true),
    // Assinatura da assistência técnica, exportada pelo celular como uma
    // "fotografia" do que valia no momento da exportação daquele documento
    // (assinada na hora, padrão salva em Configurações, ou vazio — a
    // prioridade entre essas opções é resolvida inteiramente no celular).
    // Campo raiz de dadosOS (fora de 'aparelho'), por isso precisa estar
    // explícito aqui na whitelist, senão é descartado silenciosamente.
    assinaturaAssistenciaBase64: dadosOS.assinaturaAssistenciaBase64 || db.config.assinaturaAssistenciaBase64 || '',
    // ── Exportar para assinatura remota no celular ──
    // null até a primeira exportação (gerarPacoteParaAssinar grava aqui).
    idEnvioAssinatura: dadosOS.idEnvioAssinatura || null,
    origem: dadosOS.origem === 'celular' ? 'celular' : 'pc',
    // App Celular — lote v2: chave de deduplicação do item de origem no
    // celular (null para OS criada no PC ou importação avulsa antiga).
    origemIdExportacao: dadosOS.origemIdExportacao || null,
    valorInvestido: parseFloat(dadosOS.valorInvestido) || 0,
    percentualLucro: dadosOS.percentualLucro !== undefined && dadosOS.percentualLucro !== ''
      ? parseFloat(dadosOS.percentualLucro) : (db.config.percentualLucroPadrao ?? 30),
    // ── ETAPA 8.6.1 — Diagnóstico Técnico ──
    diagnosticoTecnico: {
      diagnostico: dadosOS.diagnosticoTecnico?.diagnostico || '',
      solucao: dadosOS.diagnosticoTecnico?.solucao || '',
      pecas: dadosOS.diagnosticoTecnico?.pecas || '',
      // Peças trocadas informadas manualmente (nome + valor), independente
      // da baixa de estoque já existente — soma ao custo total da OS.
      pecasTrocar: normalizarPecasTrocarOS(dadosOS.diagnosticoTecnico?.pecasTrocar),
      valorEstimado: parseFloat(dadosOS.diagnosticoTecnico?.valorEstimado) || 0,
      prazoEstimado: dadosOS.diagnosticoTecnico?.prazoEstimado || ''
    },
    // ── ETAPA 8.7.1 — Checklist de Entrada e Saída ──
    checklistEntrada: Array.isArray(dadosOS.checklistEntrada) ? dadosOS.checklistEntrada : [],
    observacoesEntrada: dadosOS.observacoesEntrada || '',
    checklistSaida: Array.isArray(dadosOS.checklistSaida) ? dadosOS.checklistSaida : [],
    observacoesSaida: dadosOS.observacoesSaida || '',
    // ── ETAPA 8.7.2 — Galeria de Fotos e Documentação Visual ──
    // Preenchido logo abaixo (após push/saveDB) com as fotos de "como
    // chegou" vindas do lote do celular, se houver — nunca mais fixo em [].
    fotos: [],
    pdfPath: '',
    // App Celular — v11 garantia-parcial: dado de controle interno vindo
    // do celular (dias, inteiro >= 0). Por decisão explícita do usuário
    // (ver PROMPT-PC-garantia-dias.md), este campo NÃO aparece no PDF da
    // OS — é só transportado e gravado, para uso futuro (tela de detalhe,
    // relatório de garantias a vencer etc.), igual já acontece com o
    // mesmo campo em Entrega (criarOuSubstituirEntrega).
    garantiaDias: Number(dadosOS.garantiaDias) || 0,
    // Parte 2.1 — resposta de termos e preferência de pagamento do cliente
    aceitouTermos: dadosOS.aceitouTermos !== undefined ? dadosOS.aceitouTermos : null,
    motivoRecusaTermos: dadosOS.motivoRecusaTermos || '',
    respostaPreferenciaPagamento: dadosOS.respostaPreferenciaPagamento || '',
    dataRespostaTermos: dadosOS.dataRespostaTermos || '',
    // v36.3 — automação de aprovação via WhatsApp
    estadoConversaAprovacao: dadosOS.estadoConversaAprovacao || ESTADO_CONVERSA_INICIAL,
    // Preferência deste envio específico. A configuração global somente
    // define o estado inicial do check manual na tela de envio.
    usarMercadoPagoAprovacao: dadosOS.usarMercadoPagoAprovacao === true,
    exigirEntrada50Aprovacao: dadosOS.exigirEntrada50Aprovacao === true,
    valorTotalServico: Number(dadosOS.valorTotalServico) || 0,
    valorEntradaAprovacao: Number(dadosOS.valorEntradaAprovacao) || 0,
    entrada50Paga: dadosOS.entrada50Paga === true,
    percentualPagamentoAguardado: Number(dadosOS.percentualPagamentoAguardado) || 0,
    percentualPagamentoConfirmado: Number(dadosOS.percentualPagamentoConfirmado) || 0,
    valorRecebidoConfirmado: Number(dadosOS.valorRecebidoConfirmado) || 0,
    valorRecebidoBaseCobrancas: Number(dadosOS.valorRecebidoBaseCobrancas) || 0,
    modalidadePagamentoAprovacao: dadosOS.modalidadePagamentoAprovacao || '',
    modalidadeParcela1: dadosOS.modalidadeParcela1 || '',
    modalidadeParcela2: dadosOS.modalidadeParcela2 || '',
    linksPagamentoAprovacao: dadosOS.linksPagamentoAprovacao && typeof dadosOS.linksPagamentoAprovacao === 'object'
      ? dadosOS.linksPagamentoAprovacao : {},
    contextoFormaPagamento: dadosOS.contextoFormaPagamento || '',
    lembretesCobranca: normalizarLembretes(dadosOS.lembretesCobranca),
    lembretesCobrancaExcluidos: normalizarExclusoes(dadosOS.lembretesCobrancaExcluidos),
    classificacaoResposta: dadosOS.classificacaoResposta || '',
    teveRespostaNaoEntendida: dadosOS.teveRespostaNaoEntendida === true
  };
  db.ordens.push(os);
  saveDB(db);
  // Fotos de "como chegou" vindas do lote do celular (dados.fotos, até 10,
  // { base64 }). Ver salvarFotosLoteOS: valida limite/base64 e grava em
  // disco pelo mesmo caminho de sempre (uploadService), categoria
  // 'entrada'. Roda depois do saveDB acima porque precisa da OS já criada
  // (numero definitivo) para saber em qual pasta gravar.
  if (fotosEntrada.length) {
    salvarFotosLoteOS(os.numero, fotosEntrada, 'entrada');
  }
  return os;
}

// App Celular — lote v2 (fotos): grava até 10 fotos vindas de um item de
// lote (OS ou Entrega) na galeria de fotos da OS indicada, usando o mesmo
// salvarFotoOS já existente (path em disco, sem base64 no banco — decisão
// de arquitetura: reaproveitar o padrão existente em vez de inchar o banco
// com base64). Fotos além da 10ª são ignoradas (defesa em profundidade — o
// celular já limita a 10, mas o PC não confia cegamente no payload). Uma
// foto com base64 vazio/inválido é pulada silenciosamente (loga e segue),
// sem derrubar o import inteiro por causa de uma foto ruim.
function salvarFotosLoteOS(numeroOS, fotosBase64, categoria) {
  const lista = Array.isArray(fotosBase64) ? fotosBase64.slice(0, MAX_FOTOS_POR_DOCUMENTO) : [];
  let salvas = 0;
  for (const item of lista) {
    const base64 = item && typeof item.base64 === 'string' ? item.base64 : '';
    if (!base64 || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(base64)) {
      console.warn(`[lote celular] Foto ignorada (base64 vazio/inválido) na OS ${numeroOS}, categoria ${categoria}.`);
      continue;
    }
    try {
      const resultado = salvarFotoOS(numeroOS, categoria, base64, 'foto.jpg');
      if (!resultado.duplicada) salvas += 1;
    } catch (err) {
      console.warn(`[lote celular] Falha ao salvar foto na OS ${numeroOS}, categoria ${categoria}: ${err.message}`);
    }
  }
  return salvas;
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: IMPORTAÇÃO DE OS DO APP CELULAR — v43
// ═══════════════════════════════════════════════════════════════
// O app web do celular (fase 1, só formulário + assinatura) exporta um
// .json com os MESMOS campos aceitos por criarOS, mais a assinatura do
// cliente em base64. Esse .json NUNCA contém número de OS (o celular
// não numera nada — ver decisão de arquitetura do projeto). A
// importação aqui simplesmente chama criarOS normalmente, então toda
// OS importada passa pela MESMA validação (validarDadosOS) e pega o
// número oficial sequencial do PC, igual a uma OS criada manualmente.
//
// Formato esperado do .json exportado pelo celular:
// {
//   tipoArquivo: 'sistema-os-celular',   // assinatura do formato, ver checagem abaixo
//   versaoFormato: 1,
//   geradoEm: string (ISO),
//   dadosOS: {
//     cliente: { nome, cpf, email, telefone },
//     aparelho: { tipo, tipoEquipamento, marca, modelo, cor, imei,
//                 defeitoRelatado, observacoes, acessorios, senhaAparelho },
//     observacoes, prioridade, dataPrevista, horaPrevista
//   },
//   assinaturaClienteBase64: string (data:image/png;base64,....)
// }
function validarArquivoImportacaoCelular(conteudo) {
  const erros = [];
  if (!conteudo || typeof conteudo !== 'object') {
    erros.push('Arquivo inválido ou corrompido.');
    return erros;
  }
  if (conteudo.tipoArquivo !== 'sistema-os-celular') {
    erros.push('Este arquivo não é uma exportação do app celular de OS (tipoArquivo ausente ou incorreto).');
  }
  if (!conteudo.dadosOS || typeof conteudo.dadosOS !== 'object') {
    erros.push('Arquivo não contém dados de OS (dadosOS ausente).');
  }
  // Recusa explicitamente se, por qualquer motivo, vier um número de OS —
  // reforça a regra de que só o PC numera (ver decisão de arquitetura).
  if (conteudo.dadosOS && conteudo.dadosOS.numero) {
    erros.push('Arquivo contém um número de OS, o que não é permitido em importações do celular.');
  }
  return erros;
}

function importarOSDoCelular(conteudoArquivo) {
  const erros = validarArquivoImportacaoCelular(conteudoArquivo);
  if (erros.length) {
    return { sucesso: false, erro: erros.join(' ') };
  }
  const dadosOS = Object.assign({}, conteudoArquivo.dadosOS, {
    // Nunca confia em número vindo do arquivo (defesa em profundidade,
    // além da checagem em validarArquivoImportacaoCelular).
    numero: undefined,
    assinaturaClienteBase64: conteudoArquivo.assinaturaClienteBase64 || '',
    assinaturaAssistenciaBase64: conteudoArquivo.assinaturaAssistenciaBase64 || '',
    origem: 'celular',
    // App Celular — lote v2: chave de deduplicação, presente quando este
    // item único veio de dentro de um lote (importarLoteDoCelular).
    origemIdExportacao: conteudoArquivo.origemIdExportacao || null
  });
  try {
    const os = criarOS(dadosOS);
    return { sucesso: true, os };
  } catch (err) {
    return { sucesso: false, erro: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: IMPORTAÇÃO DE LOTE DO APP CELULAR (OS + Compra + Venda) — lote v2
// ═══════════════════════════════════════════════════════════════
// Formato novo: um único .json com vários itens mistos (OS, Compra,
// Venda). Continua aceitando o formato antigo de item único
// (tipoArquivo: 'sistema-os-celular') como lote de 1 item 'os',
// reaproveitando importarOSDoCelular sem duplicar validação.
//
// Decisões de arquitetura (não mudar sem reabrir a decisão):
// - Venda do celular SEMPRE cria um item de estoque novo, mesmo sem
//   histórico de compra no PC. Um item assim nasce com valorPago e
//   valorGastoPecas em 0, então o lucro reportado no financeiro para
//   esse item é o valor de venda inteiro — isso é ESPERADO, não é bug.
// - Nem Compra nem Venda geram registro em db.pagamentos: o financeiro
//   já lê a receita de Venda direto de db.estoque e o custo de Compra
//   direto de db.compras, então um pagamento duplicaria a entrada/saída
//   no DRE. Só itens tipoDocumento:'os' seguem o fluxo de hoje (nem OS
//   cria pagamento automaticamente — isso é feito manualmente no PC).
// - Deduplicação por idExportacao (nunca por PDF, que muda a cada
//   geração). Cada entidade criada a partir de um item do lote grava
//   origemIdExportacao; um idExportacao já visto em ordens/compras/
//   estoque é pulado (não é erro), e contado no relatório final.
// - O lote nunca traz numero/id — a numeração é sempre do PC.
// - Um item malformado não derruba os outros itens do lote.
// - Assinatura da assistência técnica (assinaturaAssistenciaBase64): o
//   celular resolve sozinho qual assinatura vale no momento da exportação
//   (assinada na hora > padrão salva em Configurações > nenhuma) e manda
//   o resultado pronto. O PC nunca reaplica essa lógica — só usa o valor
//   como veio, e ele sempre sobrescreve o que já estava salvo localmente
//   (é uma fotografia do momento da exportação daquele documento).
// - Padrão de termos redefinível pelo usuário (termosPadraoUsuario* no
//   celular): é uma config LOCAL de cada aparelho, que nunca viaja pronta
//   como "isto é um padrão" — o PC não tem, e não ganha, esse conceito.
//   O que viaja é o TEXTO JÁ RESOLVIDO (campo 'termos'/'termosCompra'/
//   'termosVenda' dentro de dados), gravado como snapshot do documento
//   importado — o mesmo mecanismo que já existe há tempo em os.termos
//   (prioridade máxima em resolverTermosOS/Venda/Compra, acima da config
//   geral do PC). Importar um documento com padrão próprio no celular
//   NUNCA altera termosCompra/termosVenda/termosOS/usarTermosPredefinidos*
//   da config geral do PC — só o PDF daquele registro específico usa o
//   texto vindo do celular.

function _origemIdExportacaoJaImportado(db, idExportacao) {
  if (!idExportacao) return false;
  if ((db.ordens || []).some(o => o.origemIdExportacao === idExportacao)) return true;
  if ((db.compras || []).some(c => c.origemIdExportacao === idExportacao)) return true;
  if ((db.estoque || []).some(e => e.origemIdExportacao === idExportacao)) return true;
  return false;
}

// Bloco 4 (editar no celular depois de salvo, reenviando pro PC): localiza
// o registro já existente com o MESMO origemIdExportacao, em qualquer uma
// das 3 coleções (os/compra/venda). Usado por importarLoteDoCelular para
// decidir entre CRIAR (idExportacao nunca visto) e ATUALIZAR (idExportacao
// já visto — o celular persiste o idExportacao original no histórico local
// e reenvia sempre com o mesmo valor, mesmo depois de editar campos que
// entrariam no hash se fosse recalculado — ver js/historico.js do celular,
// campo idExportacaoOriginal). Retorna { tipoDocumento, registro } ou null.
function _localizarPorOrigemIdExportacao(db, idExportacao) {
  if (!idExportacao) return null;
  const os = (db.ordens || []).find(o => o.origemIdExportacao === idExportacao);
  if (os) return { tipoDocumento: 'os', registro: os };
  const compra = (db.compras || []).find(c => c.origemIdExportacao === idExportacao);
  if (compra) return { tipoDocumento: 'compra', registro: compra };
  const venda = (db.estoque || []).find(e => e.origemIdExportacao === idExportacao);
  if (venda) return { tipoDocumento: 'venda', registro: venda };
  return null;
}

function _normalizarItensDoLote(conteudoArquivo) {
  // Formato antigo (item único de OS) — trata como lote de 1 item.
  if (conteudoArquivo && conteudoArquivo.tipoArquivo === 'sistema-os-celular') {
    return [{
      idExportacao: conteudoArquivo.idExportacao || null,
      tipoDocumento: 'os',
      dados: Object.assign({}, conteudoArquivo.dadosOS, {
        assinaturaClienteBase64: conteudoArquivo.assinaturaClienteBase64 || '',
        assinaturaAssistenciaBase64: conteudoArquivo.assinaturaAssistenciaBase64 || ''
      })
    }];
  }
  // Formato novo (lote v2)
  if (conteudoArquivo && conteudoArquivo.tipoArquivo === 'sistema-os-celular-lote'
      && Array.isArray(conteudoArquivo.itens)) {
    return conteudoArquivo.itens;
  }
  return null;
}

function importarLoteDoCelular(conteudoArquivo) {
  const itensOriginais = _normalizarItensDoLote(conteudoArquivo);
  if (!itensOriginais) {
    return { sucesso: false, erro: 'Arquivo inválido: não é uma exportação reconhecida do app celular (item único ou lote).' };
  }

  // BUG CORRIGIDO AQUI: o app do celular monta o lote a partir do
  // histórico local ordenado por "mais recente primeiro" (salvoEm
  // decrescente) — não por tipo de documento. Como uma Entrega é sempre
  // salva DEPOIS da OS correspondente (fluxo natural: recebe -> conserta
  // -> entrega), ela tem salvoEm mais recente e por isso aparecia ANTES
  // da OS no array de itens sempre que as duas estivessem pendentes de
  // exportação ao mesmo tempo. Como o loop abaixo processa na ordem do
  // array, e uma Entrega só é aceita se _numeroOSExisteExato() já achar a
  // OS gravada no banco, o item de Entrega era rejeitado com "OS não
  // encontrada" mesmo a OS estando no mesmo arquivo — só que mais adiante
  // no array. A correção processa todos os itens tipoDocumento:'os' do
  // lote primeiro, e só depois os demais (entrega/compra/venda), sem
  // depender da ordem em que o celular os colocou no arquivo. Usa
  // Array.prototype.sort, que é estável (spec ECMA-262 desde ES2019) —
  // ou seja, a ordem relativa ENTRE itens do mesmo grupo (duas OS entre
  // si, duas Entregas entre si) é preservada exatamente como veio.
  const itens = itensOriginais
    .map((item, indiceOriginal) => ({ item, indiceOriginal }))
    .sort((a, b) => {
      const pesoA = a.item?.tipoDocumento === 'os' ? 0 : 1;
      const pesoB = b.item?.tipoDocumento === 'os' ? 0 : 1;
      if (pesoA !== pesoB) return pesoA - pesoB;
      return a.indiceOriginal - b.indiceOriginal;
    })
    .map(par => par.item);

  const importados = { os: 0, compra: 0, venda: 0, entrega: 0 };
  const atualizados = { os: 0, compra: 0, venda: 0 };
  let pulados = 0;
  // Entregas não entram em "pulados" quando SUBSTITUEM um comprovante
  // existente (isso é o comportamento normal esperado, não uma duplicata) —
  // contadas à parte para o resumo final poder distinguir os três casos:
  // importado novo, substituiu um anterior, rejeitado (OS não encontrada).
  let entregasSubstituidas = 0;
  const rejeitados = [];
  const erros = [];

  for (const item of itens) {
    const idExportacao = item?.idExportacao || null;
    const tipoDocumento = item?.tipoDocumento;
    try {
      // Checa a cada iteração (não só no início) para refletir o que já
      // foi gravado pelos itens anteriores do próprio lote. Entrega tem
      // sua própria checagem (por numeroOS, dentro do bloco abaixo) em vez
      // desta, porque "mesmo idExportacao" não é a regra de negócio ali —
      // "mesmo numeroOS" é (ver criarOuSubstituirEntrega).
      //
      // Bloco 4 (editar no celular, reenviar pro PC): um idExportacao já
      // visto em os/compra/venda NÃO é mais só "pulado" — é uma ATUALIZAÇÃO
      // do mesmo registro (o celular persiste idExportacaoOriginal no
      // histórico local e reenvia com o mesmo valor mesmo depois de editar
      // campos que entrariam no hash). Só entra nesse caminho se o
      // tipoDocumento do item bater com o tipo do registro já encontrado —
      // um cruzamento de tipo (não deveria acontecer, hash inclui o tipo)
      // é tratado como pulado por segurança, não como erro nem update.
      const db = loadDB();
      if (tipoDocumento !== 'entrega' && idExportacao) {
        const existente = _localizarPorOrigemIdExportacao(db, idExportacao);
        if (existente && existente.tipoDocumento === tipoDocumento) {
          const d = item.dados || {};
          try {
            if (tipoDocumento === 'os') {
              // Uma OS pode ser enviada primeiro sem assinatura e ser assinada
              // depois no celular. O mesmo idExportacao identifica a atualização;
              // quando os campos vierem no reenvio, eles precisam substituir o
              // estado anterior do mesmo registro, nunca criar outra OS.
              atualizarOS(existente.registro.numero, {
                cliente: d.cliente,
                aparelho: d.aparelho,
                observacoes: d.observacoes,
                prioridade: d.prioridade,
                dataPrevista: d.dataPrevista,
                horaPrevista: d.horaPrevista,
                assinaturaClienteBase64: d.assinaturaClienteBase64 || undefined,
                assinaturaAssistenciaBase64: d.assinaturaAssistenciaBase64 || undefined,
                assinaturaPendente: d.assinaturaPendente === true,
                naoAssinado: d.naoAssinado === true
              });
              if (Array.isArray(d.fotos) && d.fotos.length) {
                salvarFotosLoteOS(existente.registro.numero, d.fotos, 'entrada');
              }
            } else if (tipoDocumento === 'compra') {
              atualizarCompra(existente.registro.numero, {
                vendedor: d.vendedor,
                aparelho: d.aparelho,
                avaliacao: d.avaliacao,
                dadosCompra: d.dadosCompra,
                fotos: Array.isArray(d.fotos) ? d.fotos : [],
                assinaturaVendedorBase64: d.assinaturaVendedorBase64 !== undefined ? d.assinaturaVendedorBase64 : undefined,
                assinaturaAssistenciaBase64: d.assinaturaAssistenciaBase64 !== undefined ? d.assinaturaAssistenciaBase64 : undefined,
                assinaturaPendente: d.assinaturaPendente === true,
                naoAssinado: d.naoAssinado === true
              });
            } else if (tipoDocumento === 'venda') {
              atualizarItemEstoque(existente.registro.id, {
                marca: d.marca,
                modelo: d.modelo,
                tipoEquipamento: d.tipoEquipamento,
                cor: d.cor,
                imei: d.imei,
                observacoes: d.observacoes,
                garantia: d.garantia,
                compradorNome: d.compradorNome,
                compradorCpf: d.compradorCpf,
                compradorEmail: d.compradorEmail,
                compradorTelefone: d.compradorTelefone,
                compradorSemNumero: d.compradorSemNumero === true,
                valorVenda: d.valorVenda,
                formaPagamento: d.formaPagamento,
                dataVenda: d.dataVenda || existente.registro.dataVenda,
                status: d.assinaturaPendente === true && d.naoAssinado !== true ? 'Reservado' : 'Vendido',
                assinaturaCompradorBase64: d.assinaturaCompradorBase64 !== undefined ? d.assinaturaCompradorBase64 : undefined,
                assinaturaAssistenciaBase64: d.assinaturaAssistenciaBase64 !== undefined ? d.assinaturaAssistenciaBase64 : undefined,
                assinaturaPendente: d.assinaturaPendente === true,
                naoAssinado: d.naoAssinado === true
              });
            }
            atualizados[tipoDocumento] += 1;
          } catch (err) {
            erros.push({ idExportacao, tipoDocumento, erro: err.message });
          }
          continue;
        }
        if (existente) {
          // Cruzamento de tipo inesperado — não atualiza nem cria, só pula.
          pulados += 1;
          continue;
        }
      }

      if (tipoDocumento === 'os') {
        const dadosOS = item.dados || {};
        const resultado = importarOSDoCelular({
          tipoArquivo: 'sistema-os-celular',
          versaoFormato: 1,
          dadosOS: Object.assign({}, dadosOS, { assinaturaClienteBase64: undefined, assinaturaAssistenciaBase64: undefined }),
          assinaturaClienteBase64: dadosOS.assinaturaClienteBase64 || '',
          assinaturaAssistenciaBase64: dadosOS.assinaturaAssistenciaBase64 || '',
          origemIdExportacao: idExportacao
        });
        if (!resultado.sucesso) {
          erros.push({ idExportacao, tipoDocumento, erro: resultado.erro || 'Falha ao importar OS.' });
          continue;
        }
        importados.os += 1;

      } else if (tipoDocumento === 'compra') {
        const d = item.dados || {};
        const compra = criarCompra({
          vendedor: d.vendedor,
          aparelho: d.aparelho,
          avaliacao: d.avaliacao,
          dadosCompra: d.dadosCompra,
          fotos: Array.isArray(d.fotos) ? d.fotos : [],
          assinaturaVendedorBase64: d.assinaturaVendedorBase64 || '',
          assinaturaAssistenciaBase64: d.assinaturaAssistenciaBase64 || '',
          assinaturaPendente: d.assinaturaPendente === true,
          naoAssinado: d.naoAssinado === true,
          // Padrão de termos redefinível pelo usuário (celular) — o celular
          // já resolve, no momento da exportação, qual texto vale (padrão
          // próprio do aparelho ou de fábrica) e manda o resultado FINAL
          // pronto no campo 'termosCompra' de dados. O PC não tem (e não
          // ganha) nenhum conceito de "padrão do usuário" — só grava esse
          // texto já resolvido como snapshot deste documento específico,
          // exatamente como já faz hoje para OS (dadosOS.termos). Isso
          // nunca altera a config geral termosCompra/usarTermosPredefinidosCompra
          // do PC — só o PDF deste registro importado usa esse texto.
          termosCompra: d.termosCompra || '',
          origem: 'celular',
          origemIdExportacao: idExportacao
        });
        importados.compra += 1;
        void compra;

      } else if (tipoDocumento === 'venda') {
        const d = item.dados || {};
        const statusVenda = d.assinaturaPendente === true && d.naoAssinado !== true ? 'Reservado' : 'Vendido';
        // Estoque e venda podem chegar do Supabase em ordens diferentes.
        // estoqueLocalId e a identidade do EST selecionado no Android, nao
        // uma simples dica: nunca gere outro sequencial quando ele existir.
        const estoqueLocalId = String(d.estoqueLocalId || '').trim();
        const aparelhoExistente = estoqueLocalId ? obterItemEstoquePorId(estoqueLocalId) : null;
        if (aparelhoExistente) {
          atualizarItemEstoque(aparelhoExistente.id, {
            marca: d.marca,
            modelo: d.modelo,
            tipoEquipamento: d.tipoEquipamento,
            cor: d.cor,
            imei: d.imei,
            observacoes: d.observacoes,
            garantia: d.garantia,
            status: statusVenda,
            compradorNome: d.compradorNome,
            compradorCpf: d.compradorCpf,
            compradorEmail: d.compradorEmail,
            compradorTelefone: d.compradorTelefone,
            compradorSemNumero: d.compradorSemNumero === true,
            valorVenda: d.valorVenda,
            formaPagamento: d.formaPagamento,
            dataVenda: d.dataVenda || new Date().toISOString(),
            assinaturaCompradorBase64: d.assinaturaCompradorBase64 || '',
            assinaturaAssistenciaBase64: d.assinaturaAssistenciaBase64 || '',
            assinaturaPendente: d.assinaturaPendente === true,
            naoAssinado: d.naoAssinado === true,
            termosVenda: d.termosVenda || '',
            origem: 'celular',
            origemIdExportacao: idExportacao
          });
          importados.venda += 1;
          continue;
        }
        const criarVendaNoEstoque = estoqueLocalId
          ? dadosVenda => aplicarItemEstoqueSupabase('aparelho', Object.assign({ id: estoqueLocalId }, dadosVenda))
          : criarItemEstoque;
        const itemEstoque = criarVendaNoEstoque({
          tipoEquipamento: d.tipoEquipamento,
          marca: d.marca,
          modelo: d.modelo,
          cor: d.cor,
          imei: d.imei,
          observacoes: d.observacoes,
          garantia: d.garantia,
          status: statusVenda,
          compradorNome: d.compradorNome,
          compradorCpf: d.compradorCpf,
          compradorEmail: d.compradorEmail,
          compradorTelefone: d.compradorTelefone,
          compradorSemNumero: d.compradorSemNumero === true,
          valorVenda: d.valorVenda,
          formaPagamento: d.formaPagamento,
          dataVenda: d.dataVenda || new Date().toISOString(),
          assinaturaCompradorBase64: d.assinaturaCompradorBase64 || '',
          assinaturaAssistenciaBase64: d.assinaturaAssistenciaBase64 || '',
          assinaturaPendente: d.assinaturaPendente === true,
          naoAssinado: d.naoAssinado === true,
          // Mesma mecânica de snapshot de termos descrita acima em Compra.
          termosVenda: d.termosVenda || '',
          origem: 'celular',
          origemIdExportacao: idExportacao
        });
        importados.venda += 1;
        void itemEstoque;

      } else if (tipoDocumento === 'entrega') {
        const d = item.dados || {};
        const osReferencia = _encontrarOSPorNumero(db, d.numeroOS);
        const numeroOS = osReferencia ? osReferencia.numero : d.numeroOS;

        // Dedupe específico de entrega: mesmo idExportacao já visto antes
        // em ALGUMA entrega (não necessariamente a do mesmo numeroOS, mas
        // na prática sempre será, já que o hash inclui numeroOS) — evita
        // reprocessar o EXATO mesmo item se o usuário importar o mesmo
        // arquivo duas vezes. Isso é complementar à regra de substituição
        // por numeroOS abaixo, não um substituto dela (ver decisão de
        // arquitetura no prompt): mudar só garantiaDias já gera um
        // idExportacao novo do lado do celular, então continua substituindo
        // normalmente quando só a garantia muda.
        // O mesmo id pode voltar quando a assinatura ou uma foto termina de
        // subir depois dos dados. A substituicao pela OS atualiza o registro
        // canonico sem criar uma entrega duplicada.

        // Validação real acontece aqui — numeroOS precisa existir no banco
        // do PC (comparação exata após trim, sem normalizar). Comprovante
        // órfão nunca é criado.
        if (!_numeroOSExisteExato(db, numeroOS)) {
          rejeitados.push({ idExportacao, tipoDocumento, numeroOS, erro: `OS nº ${numeroOS} não encontrada — comprovante não importado.` });
          continue;
        }

        const { substituiu } = criarOuSubstituirEntrega({
          numeroOS,
          documentoEntregaId: d.documentoEntregaId,
          cicloEntregaId: d.cicloEntregaId,
          tipoEntrega: d.tipoEntrega,
          retornoGarantiaId: d.retornoGarantiaId,
          garantiaId: d.garantiaId,
          supabaseId: d.supabaseId,
          supabaseRevision: d.supabaseRevision,
          idEnvioAssinatura: d.idEnvioAssinatura,
          nomeRetirou: d.nomeRetirou,
          cpfRetirou: d.cpfRetirou,
          telefoneRetirou: d.telefoneRetirou,
          marca: d.marca,
          modelo: d.modelo,
          reparoRealizado: d.reparoRealizado,
          valorReparo: d.valorReparo,
          formaPagamento: d.formaPagamento,
          declaracao: d.declaracao,
          dataHoraAssinatura: d.dataHoraAssinatura,
          garantiaDataInicio: d.garantiaDataInicio,
          termosGarantia: d.termosGarantia,
          garantiaDias: d.garantiaDias,
          dataLimiteGarantia: d.dataLimiteGarantia,
          assinaturaRetirouBase64: d.assinaturaRetirouBase64,
          // Fotos de "como saiu" (até 10, { base64 }) — ver salvarFotosLoteOS
          // dentro de criarOuSubstituirEntrega.
          fotos: Array.isArray(d.fotos) ? d.fotos : [],
          origemIdExportacao: idExportacao
        });
        importados.entrega += 1;
        if (substituiu) entregasSubstituidas += 1;

      } else {
        erros.push({ idExportacao, tipoDocumento, erro: `Tipo de documento desconhecido: "${tipoDocumento}".` });
      }
    } catch (err) {
      erros.push({ idExportacao, tipoDocumento, erro: err.message });
    }
  }

  const total = itens.length;
  return {
    sucesso: true, total, importados, pulados, erros,
    // Bloco 4: contagem de os/compra/venda que ATUALIZARAM um registro já
    // existente (mesmo origemIdExportacao) em vez de criar um novo.
    atualizados,
    // Só usados por itens de entrega — arrays vazios quando o lote não
    // contém nenhum item desse tipo, sem afetar os campos já existentes
    // consumidos por OS/Compra/Venda.
    rejeitados,
    entregasSubstituidas
  };
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: EXPORTAR DOCUMENTO (OS/Compra/Venda) PARA ASSINATURA REMOTA
// NO CELULAR — envio individual, e import da resposta assinada
// ═══════════════════════════════════════════════════════════════
// Fluxo DIFERENTE do lote acima: aqui o documento JÁ EXISTE no PC, sem
// assinatura da outra parte, e é mandado para o celular só para coletar
// essa assinatura fisicamente com o cliente/vendedor/comprador. O celular
// devolve a assinatura, que é gravada de volta no MESMO registro — nunca
// cria um documento novo. Os dois fluxos (lote e este) coexistem.
//
// Campo de assinatura por tipo (onde a resposta do celular é gravada):
//   os     -> assinaturaClienteBase64
//   venda  -> assinaturaCompradorBase64
//   compra -> assinaturaVendedorBase64
const CAMPO_ASSINATURA_POR_TIPO_DOCUMENTO = {
  os: 'assinaturaClienteBase64',
  venda: 'assinaturaCompradorBase64',
  compra: 'assinaturaVendedorBase64',
  desbloqueio: 'assinaturaClienteBase64'
};

// Monta o pacote de envio (PC -> celular) no formato que
// documentos-recebidos.js já espera receber e validar.
// tipoDocumento: 'os' | 'compra' | 'venda'
// registro: o registro completo já existente no PC (o mesmo objeto que
//           hoje alimenta a geração local do PDF — ver pdf.js), incluindo
//           idEnvioAssinatura já persistido no passo anterior desta mesma
//           chamada (ver handler em main.js, que grava antes de exportar).
// Lê cada foto do disco (registro.fotos[i].path, caminho local do PC) e
// injeta o conteúdo em base64 numa CÓPIA do registro, nunca no original —
// nada disso é salvo no banco. Necessário porque um `path` de arquivo do
// disco do PC não significa nada para o celular (filesystem diferente);
// sem isso, as fotos simplesmente não aparecem do lado de lá.
// Reimplementado aqui (em vez de importar pdf.js:injetarBase64NasFotos)
// para não criar dependência circular (pdf.js já faz require('./db')) e
// para não obrigar db.js a carregar electron.BrowserWindow.
function _resolverFotosParaBase64(registro) {
  if (!registro || !Array.isArray(registro.fotos) || registro.fotos.length === 0) {
    return registro;
  }
  const fotosComBase64 = registro.fotos.map(f => {
    if (!f || !f.path) return f;
    try {
      const buf = fs.readFileSync(f.path);
      const ext = path.extname(f.nome || f.path).slice(1).toLowerCase() || 'jpeg';
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return { ...f, base64: `data:${mime};base64,${buf.toString('base64')}` };
    } catch {
      // Arquivo não encontrado no disco (ex.: banco restaurado em outra
      // máquina sem as fotos) — mantém o item sem base64, sem quebrar o
      // pacote inteiro por causa de uma foto.
      return f;
    }
  });
  return { ...registro, fotos: fotosComBase64 };
}

function gerarPacoteParaAssinar(tipoDocumento, registro) {
  if (!CAMPO_ASSINATURA_POR_TIPO_DOCUMENTO[tipoDocumento]) {
    throw new Error(`Tipo de documento inválido para exportar: "${tipoDocumento}".`);
  }
  if (!registro || !registro.idEnvioAssinatura) {
    throw new Error('Registro sem idEnvioAssinatura — grave o id antes de gerar o pacote.');
  }
  const registroComFotos = _resolverFotosParaBase64(registro);
  const identificador = tipoDocumento === 'os'
    ? { numero: registro.numero, nomeOutraParte: registro.cliente?.nome || '', aparelho: [registro.aparelho?.marca, registro.aparelho?.modelo].filter(Boolean).join(' ') }
    : tipoDocumento === 'venda'
    ? { numero: registro.id, nomeOutraParte: registro.compradorNome || '', aparelho: [registro.marca, registro.modelo].filter(Boolean).join(' ') }
    : tipoDocumento === 'desbloqueio'
    ? { numero: registro.numero, nomeOutraParte: registro.cliente?.nome || '', aparelho: [registro.aparelho?.marca, registro.aparelho?.modelo].filter(Boolean).join(' ') }
    : { numero: registro.numero, nomeOutraParte: registro.vendedor?.nome || '', aparelho: [registro.aparelho?.marca, registro.aparelho?.modelo].filter(Boolean).join(' ') };
  return {
    tipoArquivo: 'sistema-os-pc-para-assinar',
    idEnvioAssinatura: registro.idEnvioAssinatura,
    tipoDocumento,
    identificador,
    // Manda o registro como já existe internamente no PC — mesmo objeto
    // que os templates (os/compra/venda-template.js) já recebem hoje para
    // gerar o PDF local, para o celular renderizar a prévia de forma
    // idêntica. Não reduz nem reinventa campos.
    dados: registroComFotos
  };
}

// Gera um idEnvioAssinatura estável por documento: <tipo>-<id-do-registro>.
// Estável entre reexportações do mesmo documento (não usa timestamp), para
// que reexportar antes do cliente assinar atualize o pendente no celular
// em vez de duplicar (idempotência já implementada do lado dele).
function gerarIdEnvioAssinatura(tipoDocumento, idDoRegistro) {
  return `${tipoDocumento}-${idDoRegistro}`;
}

function validarRespostaAssinatura(conteudo) {
  const erros = [];
  if (!conteudo || typeof conteudo !== 'object') {
    erros.push('Arquivo inválido ou corrompido.');
    return erros;
  }
  if (conteudo.tipoArquivo !== 'sistema-os-pc-para-assinar-resposta') {
    erros.push('Este arquivo não é uma resposta de assinatura do app celular (tipoArquivo ausente ou incorreto).');
  }
  if (!conteudo.tipoDocumento || !CAMPO_ASSINATURA_POR_TIPO_DOCUMENTO[conteudo.tipoDocumento]) {
    erros.push('Arquivo não contém um tipoDocumento reconhecido ("os", "compra", "venda", "entrega" ou "desbloqueio").');
  }
  if (!conteudo.idEnvioAssinatura) {
    erros.push('Arquivo não contém idEnvioAssinatura.');
  }
  return erros;
}

// Importa a resposta assinada (celular -> PC). Localiza o registro pelo
// idEnvioAssinatura (gravado no momento da exportação) e grava só o campo
// de assinatura correspondente ao tipo — nunca cria um registro novo.
function importarRespostaAssinatura(conteudoArquivo) {
  const erros = validarRespostaAssinatura(conteudoArquivo);
  if (erros.length) {
    return { sucesso: false, erro: erros.join(' ') };
  }
  const { tipoDocumento, idEnvioAssinatura } = conteudoArquivo;
  const campoAssinatura = CAMPO_ASSINATURA_POR_TIPO_DOCUMENTO[tipoDocumento];
  const valorAssinatura = conteudoArquivo[campoAssinatura] || '';
  // A resposta do celular pode conter as duas assinaturas. O campo da
  // assistência precisa seguir até a atualização do registro; antes era
  // baixado do Storage, mas descartado nesta função.
  const dadosAssinaturas = {
    [campoAssinatura]: valorAssinatura,
    assinaturaPendente: valorAssinatura ? false : conteudoArquivo.assinaturaPendente === true,
    naoAssinado: valorAssinatura ? false : conteudoArquivo.assinaturaPendente !== true
  };
  if (conteudoArquivo.assinaturaAssistenciaBase64) {
    dadosAssinaturas.assinaturaAssistenciaBase64 = conteudoArquivo.assinaturaAssistenciaBase64;
  }

  const db = loadDB();
  try {
    if (tipoDocumento === 'os') {
      const os = (db.ordens || []).find(o => o.idEnvioAssinatura === idEnvioAssinatura);
      if (!os) return { sucesso: false, erro: `Nenhuma OS encontrada para este envio (idEnvioAssinatura "${idEnvioAssinatura}"). A OS pode ter sido excluída ou o arquivo não corresponde a um envio feito por este PC.` };
      const atualizada = atualizarOS(os.numero, dadosAssinaturas);
      return { sucesso: true, tipoDocumento, registro: atualizada };
    }
    if (tipoDocumento === 'compra') {
      const cp = (db.compras || []).find(c => c.idEnvioAssinatura === idEnvioAssinatura);
      if (!cp) return { sucesso: false, erro: `Nenhuma Compra encontrada para este envio (idEnvioAssinatura "${idEnvioAssinatura}"). O contrato pode ter sido excluído ou o arquivo não corresponde a um envio feito por este PC.` };
      const atualizada = atualizarCompra(cp.numero, dadosAssinaturas);
      return { sucesso: true, tipoDocumento, registro: atualizada };
    }
    if (tipoDocumento === 'venda') {
      const item = (db.estoque || []).find(e => e.idEnvioAssinatura === idEnvioAssinatura);
      if (!item) return { sucesso: false, erro: `Nenhuma Venda encontrada para este envio (idEnvioAssinatura "${idEnvioAssinatura}"). O item pode ter sido excluído ou o arquivo não corresponde a um envio feito por este PC.` };
      // atualizarItemEstoque (diferente de atualizarOS/atualizarCompra) valida
      // marca/modelo no PRÓPRIO payload de entrada, não no registro já salvo —
      // então precisa do item inteiro mesclado, não só o campo de assinatura.
      const atualizado = atualizarItemEstoque(item.id, Object.assign({}, item, dadosAssinaturas));
      return { sucesso: true, tipoDocumento, registro: atualizado };
    }
    if (tipoDocumento === 'desbloqueio') {
      const desbloqueio = (db.desbloqueios || []).find(item => item.idEnvioAssinatura === idEnvioAssinatura);
      if (!desbloqueio) return { sucesso: false, erro: 'Autorização de desbloqueio não encontrada para esta assinatura.' };
      const atualizado = atualizarDesbloqueio(desbloqueio.numero, dadosAssinaturas, { preservarAssinatura: true });
      return { sucesso: true, tipoDocumento, registro: atualizado };
    }
  } catch (err) {
    return { sucesso: false, erro: err.message };
  }
  return { sucesso: false, erro: `Tipo de documento desconhecido: "${tipoDocumento}".` };
}

function atualizarOS(numero, dadosOSEntrada) {
  // Preserva assinaturaClienteBase64/assinaturaAssistenciaBase64 sem
  // truncar — ver comentário em sanitizarPreservandoCampos. Este é o
  // caminho usado por importarRespostaAssinatura (assinatura remota vinda
  // do celular): sem essa proteção, o base64 podia ser cortado no meio
  // pelo sanitizarValor, corrompendo a imagem no PDF.
  const dadosOS = sanitizarPreservandoCampos(dadosOSEntrada, ['assinaturaClienteBase64', 'assinaturaAssistenciaBase64']);
  const db = loadDB();
  const idx = db.ordens.findIndex(o => o.numero === numero);
  if (idx === -1) return null;
  const atual = db.ordens[idx];
  const assinaturaClienteFinal = dadosOS.assinaturaClienteBase64 !== undefined
    ? dadosOS.assinaturaClienteBase64
    : (atual.assinaturaClienteBase64 || '');
  // Valida o resultado mesclado (dados atuais da OS + o que está sendo
  // atualizado), e não apenas o payload recebido. Isso preserva a validação
  // para quem envia a OS inteira (ex.: formulário da UI) sem quebrar
  // atualizações parciais de campos que não mexem em cliente/aparelho
  // (ex.: automação de aprovação via WhatsApp, que só grava termos/pagamento).
  const paraValidar = {
    cliente: Object.assign({}, atual.cliente, dadosOS.cliente || {}, {
      clienteId: obterOuCriarIdCliente(
        db,
        dadosOS.cliente?.nome ?? atual.cliente?.nome,
        dadosOS.cliente?.cpf ?? atual.cliente?.cpf,
        dadosOS.cliente?.clienteId ?? atual.cliente?.clienteId
      )
    }),
    aparelho: Object.assign({}, atual.aparelho, dadosOS.aparelho || {})
  };
  const erros = validarDadosOS(paraValidar);
  if (erros) throw new Error('Dados inválidos: ' + Object.values(erros).join(' | '));
  
  // Histórico de status — v31: status técnico e statusPagamento são
  // independentes; cada um gera sua própria entrada no histórico quando muda,
  // e mudar um NUNCA sobrescreve ou bloqueia o outro.
  let historicoStatus = atual.historicoStatus || [];
  if (dadosOS.status && dadosOS.status !== atual.status) {
    if (!STATUS_OS_VALIDOS.includes(dadosOS.status)) throw new Error(`Status inválido: "${dadosOS.status}".`);
    historicoStatus = [...historicoStatus, { status: dadosOS.status, data: new Date().toISOString() }];
  }
  if (dadosOS.statusPagamento !== undefined && dadosOS.statusPagamento !== atual.statusPagamento) {
    const statusPagamentoNormalizado = normalizarStatusPagamento(dadosOS.statusPagamento);
    if (!STATUS_PAGAMENTO_VALIDOS.includes(statusPagamentoNormalizado)) throw new Error(`Status de pagamento inválido: "${dadosOS.statusPagamento}".`);
    const rotuloPagamento = statusPagamentoNormalizado || 'Pagamento removido';
    historicoStatus = [...historicoStatus, { status: rotuloPagamento, data: new Date().toISOString(), tipoPagamento: true }];
  }
  if (dadosOS.statusAprovacao !== undefined && dadosOS.statusAprovacao !== atual.statusAprovacao) {
    if (!STATUS_APROVACAO_VALIDOS.includes(dadosOS.statusAprovacao)) throw new Error(`Status de aprovação inválido: "${dadosOS.statusAprovacao}".`);
    historicoStatus = [...historicoStatus, {
      status: dadosOS.statusAprovacao,
      data: new Date().toISOString(),
      tipoAprovacao: true
    }];
  }

  // ETAPA 8.6.1 — checklist técnico/aparelho: arrays só substituem se enviados,
  // caso contrário preserva os valores já salvos na OS.
  const aparelhoMesclado = Object.assign({}, atual.aparelho, dadosOS.aparelho || {});
  if (dadosOS.aparelho?.checklistDefeitos === undefined) aparelhoMesclado.checklistDefeitos = atual.aparelho?.checklistDefeitos || [];
  if (dadosOS.aparelho?.acessoriosChecklist === undefined) aparelhoMesclado.acessoriosChecklist = atual.aparelho?.acessoriosChecklist || [];
  if (dadosOS.aparelho?.testesEntrada === undefined) aparelhoMesclado.testesEntrada = atual.aparelho?.testesEntrada || [];

  db.ordens[idx] = Object.assign({}, atual, {
    data: dadosOS.dataManual || dadosOS.data || atual.data,
    status: dadosOS.status !== undefined ? dadosOS.status : atual.status,
    statusAprovacao: dadosOS.statusAprovacao !== undefined
      ? dadosOS.statusAprovacao
      : inferirStatusAprovacao(atual),
    // Pagamentos confirmados só podem ser revertidos pela exclusão/estorno do
    // lançamento, nunca por salvar acidentalmente um select vazio.
    statusPagamento: (dadosOS.statusPagamento === '' && ['Pago', 'Pago 50%'].includes(normalizarStatusPagamento(atual.statusPagamento)))
      ? normalizarStatusPagamento(atual.statusPagamento)
      : (dadosOS.statusPagamento !== undefined
          ? normalizarStatusPagamento(dadosOS.statusPagamento)
          : normalizarStatusPagamento(atual.statusPagamento)),

    historicoStatus,
    // ── ETAPA 8.7.3 — Previsão de Entrega ──
    semPrazo: dadosOS.semPrazo !== undefined ? dadosOS.semPrazo === true : atual.semPrazo === true,
    dataPrevista: dadosOS.semPrazo === true ? '' : (dadosOS.dataPrevista !== undefined ? dadosOS.dataPrevista : (atual.dataPrevista || '')),
    horaPrevista: dadosOS.semPrazo === true ? '' : (dadosOS.horaPrevista !== undefined ? dadosOS.horaPrevista : (atual.horaPrevista || '')),
    // ── ETAPA 8.7.1 — Prioridade da OS ──
    prioridade: PRIORIDADES_OS_VALIDAS.includes(dadosOS.prioridade) ? dadosOS.prioridade : (atual.prioridade || 'Normal'),
    // ── ETAPA 8.7.1 — Controle Operacional e Organização da Bancada ──
    controleInterno: Object.assign({}, atual.controleInterno || {}, dadosOS.controleInterno || {}),
    // ── ETAPA 8.7.1 — Responsável Técnico ──
    tecnicoResponsavel: dadosOS.tecnicoResponsavel !== undefined ? dadosOS.tecnicoResponsavel : (atual.tecnicoResponsavel || ''),
    tecnicoAuxiliar: dadosOS.tecnicoAuxiliar !== undefined ? dadosOS.tecnicoAuxiliar : (atual.tecnicoAuxiliar || ''),
    cliente: Object.assign({}, atual.cliente, dadosOS.cliente || {}),
    aparelho: aparelhoMesclado,
    imei: dadosOS.imei || dadosOS.aparelho?.imei || atual.imei,
    observacoes: dadosOS.observacoes !== undefined ? dadosOS.observacoes : atual.observacoes,
    valorInvestido: dadosOS.valorInvestido !== undefined ? (parseFloat(dadosOS.valorInvestido)||0) : atual.valorInvestido,
    percentualLucro: dadosOS.percentualLucro !== undefined && dadosOS.percentualLucro !== '' ? parseFloat(dadosOS.percentualLucro) : atual.percentualLucro,
    termos: dadosOS.termos !== undefined ? dadosOS.termos : atual.termos,  // preserva snapshot
    // ── App Celular (assinatura em campo) — v43 ──
    assinaturaClienteBase64: dadosOS.assinaturaClienteBase64 !== undefined ? dadosOS.assinaturaClienteBase64 : (atual.assinaturaClienteBase64 || ''),
    assinaturaPendente: assinaturaClienteFinal
      ? false
      : (dadosOS.assinaturaPendente !== undefined ? dadosOS.assinaturaPendente === true : atual.assinaturaPendente === true),
    naoAssinado: assinaturaClienteFinal
      ? false
      : (dadosOS.naoAssinado !== undefined ? dadosOS.naoAssinado === true : atual.naoAssinado === true),
    // Uma resposta do celular sem assinatura da assistência não pode apagar
    // a assinatura que já estava no PC. Só uma imagem não vazia substitui.
    assinaturaAssistenciaBase64: dadosOS.assinaturaAssistenciaBase64
      || atual.assinaturaAssistenciaBase64
      || db.config.assinaturaAssistenciaBase64
      || '',
    // ── Exportar para assinatura remota no celular ──
    // idEnvioAssinatura: gravado no momento da exportação (gerarPacoteParaAssinar),
    // usado para localizar este registro de volta quando a resposta assinada
    // é importada (importarRespostaAssinatura). Persiste entre reexportações
    // do mesmo documento (não muda a cada clique) — ver geração do id abaixo.
    idEnvioAssinatura: dadosOS.idEnvioAssinatura !== undefined ? dadosOS.idEnvioAssinatura : (atual.idEnvioAssinatura || null),
    origem: atual.origem || 'pc', // origem nunca muda depois de criada
    // ── ETAPA 8.6.1 — Diagnóstico Técnico ──
    diagnosticoTecnico: dadosOS.diagnosticoTecnico !== undefined
      ? {
          diagnostico: dadosOS.diagnosticoTecnico.diagnostico || '',
          solucao: dadosOS.diagnosticoTecnico.solucao || '',
          pecas: dadosOS.diagnosticoTecnico.pecas || '',
          pecasTrocar: normalizarPecasTrocarOS(dadosOS.diagnosticoTecnico.pecasTrocar),
          valorEstimado: parseFloat(dadosOS.diagnosticoTecnico.valorEstimado) || 0,
          prazoEstimado: dadosOS.diagnosticoTecnico.prazoEstimado || ''
        }
      : (atual.diagnosticoTecnico || { diagnostico:'', solucao:'', pecas:'', pecasTrocar:[], valorEstimado:0, prazoEstimado:'' }),
    // ── ETAPA 8.7.1 — Checklist de Entrada e Saída ──
    checklistEntrada: dadosOS.checklistEntrada !== undefined ? dadosOS.checklistEntrada : (atual.checklistEntrada || []),
    observacoesEntrada: dadosOS.observacoesEntrada !== undefined ? dadosOS.observacoesEntrada : (atual.observacoesEntrada || ''),
    checklistSaida: dadosOS.checklistSaida !== undefined ? dadosOS.checklistSaida : (atual.checklistSaida || []),
    observacoesSaida: dadosOS.observacoesSaida !== undefined ? dadosOS.observacoesSaida : (atual.observacoesSaida || ''),
    // Parte 2.1: resposta de termos e preferência de pagamento do cliente
    aceitouTermos: dadosOS.aceitouTermos !== undefined
      ? dadosOS.aceitouTermos
      : (dadosOS.statusAprovacao === 'Aprovado'
          ? true
          : (dadosOS.statusAprovacao === 'Desaprovado' ? false : atual.aceitouTermos)),
    motivoRecusaTermos: dadosOS.motivoRecusaTermos !== undefined ? dadosOS.motivoRecusaTermos : (atual.motivoRecusaTermos || ''),
    respostaPreferenciaPagamento: dadosOS.respostaPreferenciaPagamento !== undefined ? dadosOS.respostaPreferenciaPagamento : (atual.respostaPreferenciaPagamento || ''),
    // v40.1: forma de pagamento normalizada, exibida na listagem sem abrir a OS
    formaPagamento: dadosOS.formaPagamento !== undefined ? dadosOS.formaPagamento : (atual.formaPagamento || null),
    dataRespostaTermos: dadosOS.dataRespostaTermos !== undefined ? dadosOS.dataRespostaTermos : (atual.dataRespostaTermos || ''),
    // v36.3 — automação de aprovação via WhatsApp
    estadoConversaAprovacao: dadosOS.estadoConversaAprovacao !== undefined ? dadosOS.estadoConversaAprovacao : (atual.estadoConversaAprovacao || ESTADO_CONVERSA_INICIAL),
    // Estes campos eram enviados pela tela/WhatsApp, mas ficavam fora da
    // whitelist e eram descartados. Sem eles, o aceite nunca criava o link MP.
    usarMercadoPagoAprovacao: dadosOS.usarMercadoPagoAprovacao !== undefined
      ? dadosOS.usarMercadoPagoAprovacao === true
      : atual.usarMercadoPagoAprovacao === true,
    exigirEntrada50Aprovacao: dadosOS.exigirEntrada50Aprovacao !== undefined
      ? dadosOS.exigirEntrada50Aprovacao === true
      : atual.exigirEntrada50Aprovacao === true,
    valorTotalServico: dadosOS.valorTotalServico !== undefined
      ? Number(dadosOS.valorTotalServico) || 0
      : Number(atual.valorTotalServico) || 0,
    valorEntradaAprovacao: dadosOS.valorEntradaAprovacao !== undefined
      ? Number(dadosOS.valorEntradaAprovacao) || 0
      : Number(atual.valorEntradaAprovacao) || 0,
    entrada50Paga: dadosOS.entrada50Paga !== undefined
      ? dadosOS.entrada50Paga === true
      : atual.entrada50Paga === true,
    percentualPagamentoAguardado: dadosOS.percentualPagamentoAguardado !== undefined
      ? Number(dadosOS.percentualPagamentoAguardado) || 0
      : Number(atual.percentualPagamentoAguardado) || 0,
    percentualPagamentoConfirmado: dadosOS.percentualPagamentoConfirmado !== undefined
      ? Number(dadosOS.percentualPagamentoConfirmado) || 0
      : Number(atual.percentualPagamentoConfirmado) || 0,
    valorRecebidoConfirmado: dadosOS.valorRecebidoConfirmado !== undefined
      ? Number(dadosOS.valorRecebidoConfirmado) || 0
      : Number(atual.valorRecebidoConfirmado) || 0,
    valorRecebidoBaseCobrancas: dadosOS.valorRecebidoBaseCobrancas !== undefined
      ? Number(dadosOS.valorRecebidoBaseCobrancas) || 0
      : Number(atual.valorRecebidoBaseCobrancas) || 0,
    modalidadePagamentoAprovacao: dadosOS.modalidadePagamentoAprovacao !== undefined
      ? String(dadosOS.modalidadePagamentoAprovacao || '')
      : String(atual.modalidadePagamentoAprovacao || ''),
    modalidadeParcela1: dadosOS.modalidadeParcela1 !== undefined
      ? String(dadosOS.modalidadeParcela1 || '')
      : String(atual.modalidadeParcela1 || ''),
    modalidadeParcela2: dadosOS.modalidadeParcela2 !== undefined
      ? String(dadosOS.modalidadeParcela2 || '')
      : String(atual.modalidadeParcela2 || ''),
    linksPagamentoAprovacao: dadosOS.linksPagamentoAprovacao !== undefined
      ? (dadosOS.linksPagamentoAprovacao && typeof dadosOS.linksPagamentoAprovacao === 'object' ? dadosOS.linksPagamentoAprovacao : {})
      : (atual.linksPagamentoAprovacao || {}),
    contextoFormaPagamento: dadosOS.contextoFormaPagamento !== undefined
      ? dadosOS.contextoFormaPagamento
      : (atual.contextoFormaPagamento || ''),
    lembretesCobranca: dadosOS.lembretesCobranca !== undefined
      ? normalizarLembretes(dadosOS.lembretesCobranca)
      : normalizarLembretes(atual.lembretesCobranca),
    lembretesCobrancaExcluidos: dadosOS.lembretesCobrancaExcluidos !== undefined
      ? normalizarExclusoes(dadosOS.lembretesCobrancaExcluidos)
      : normalizarExclusoes(atual.lembretesCobrancaExcluidos),
    classificacaoResposta: dadosOS.classificacaoResposta !== undefined ? dadosOS.classificacaoResposta : (atual.classificacaoResposta || ''),
    teveRespostaNaoEntendida: dadosOS.teveRespostaNaoEntendida !== undefined ? !!dadosOS.teveRespostaNaoEntendida : (atual.teveRespostaNaoEntendida === true),
    // v40.3 — contador de tentativas sim/não não entendidas (bugfix v40.4:
    // este campo era gravado por registrarRespostaNaoEntendida/atualizarOS
    // mas nunca fazia parte da whitelist abaixo, então era descartado toda
    // vez que atualizarOS rodava — o limite de tentativas nunca disparava).
    tentativasSimNao: dadosOS.tentativasSimNao !== undefined ? Number(dadosOS.tentativasSimNao) || 0 : (Number(atual.tentativasSimNao) || 0),
    // v40.3 — motivo do encaminhamento para atendimento humano (mesmo bug acima)
    motivoEscalacaoHumana: dadosOS.motivoEscalacaoHumana !== undefined ? dadosOS.motivoEscalacaoHumana : (atual.motivoEscalacaoHumana || ''),
    // BUGFIX (correcoesbugs.txt #2): estado de onde partiu a escalação para
    // atendimento humano ('aguardando_sim_nao' ou 'aguardando_forma_pagamento_retirada').
    // Sem isso, cancelarAtendimentoHumano() não tinha como saber para qual
    // pergunta devolver a conversa e sempre voltava para aguardando_sim_nao,
    // reenviando a pergunta de aceite de termos mesmo quando a escalação
    // tinha partido da etapa de retirada (pergunta errada, já respondida há tempos).
    estadoOrigemEscalacaoHumana: dadosOS.estadoOrigemEscalacaoHumana !== undefined ? dadosOS.estadoOrigemEscalacaoHumana : (atual.estadoOrigemEscalacaoHumana || ''),
    // v40.4 — snapshot dos dados da última mensagem de aprovação enviada
    // (marca/modelo/valor/prazo), usado para reenviar a pergunta de termos
    // quando o cliente cancela um atendimento humano com "#"
    ultimaAprovacaoEnviada: dadosOS.ultimaAprovacaoEnviada !== undefined ? dadosOS.ultimaAprovacaoEnviada : (atual.ultimaAprovacaoEnviada || null)
  });
  if (dadosOS.lembretesCobranca !== undefined) {
    const pagosAnteriores = normalizarLembretes(atual.lembretesCobranca).reduce((soma, item) => {
      const pago = item.status === 'paga' || item.confirmadoEm || item.pagoEm;
      return soma + (pago ? Math.max(0, Number(item.valorRecebido ?? item.valor) || 0) : 0);
    }, 0);
    const baseInformada = Number(atual.valorRecebidoBaseCobrancas);
    const base = Number.isFinite(baseInformada) && baseInformada > 0
      ? baseInformada
      : Math.max(0, Number(atual.valorRecebidoConfirmado || 0) - pagosAnteriores);
    const financeiro = recalcularFinanceiro({
      lembretes_cobranca: db.ordens[idx].lembretesCobranca,
      valor_recebido_base_cobrancas: base,
      status_pagamento_local: db.ordens[idx].statusPagamento
    }, db.ordens[idx].valorTotalServico || db.ordens[idx].diagnosticoTecnico?.valorEstimado || 0);
    db.ordens[idx].valorRecebidoBaseCobrancas = financeiro.valor_recebido_base_cobrancas;
    db.ordens[idx].valorRecebidoConfirmado = financeiro.valor_recebido_confirmado;
    db.ordens[idx].valorRestanteServico = financeiro.valor_restante_servico;
    db.ordens[idx].percentualPagamentoConfirmado = financeiro.percentual_pagamento_confirmado;
    db.ordens[idx].entrada50Paga = financeiro.percentual_pagamento_confirmado === 50;
    db.ordens[idx].statusPagamento = financeiro.status_pagamento_local || db.ordens[idx].statusPagamento;
  }
  saveDB(db);
  return db.ordens[idx];
}

function listarOrdens() { const db = loadDB(); return [...db.ordens].sort((a,b) => new Date(b.data)-new Date(a.data)).map(comAtraso); }
function buscarOrdens(query) {
  const t = (query||'').trim().toLowerCase();
  if (!t) return listarOrdens();
  const db = loadDB();
  return db.ordens.filter(os => {
    const alvo = [os.numero,os.cliente?.nome,os.cliente?.cpf,os.cliente?.telefone,os.cliente?.email,os.imei,os.aparelho?.imei,os.aparelho?.tipoEquipamento,os.aparelho?.dadosEquipamento?.numeroSerie,os.status,os.statusAprovacao,os.statusPagamento,os.prioridade,os.tecnicoResponsavel,os.tecnicoAuxiliar,os.controleInterno?.codigoInterno,os.controleInterno?.etiquetaInterna,os.controleInterno?.tagBancada,os.controleInterno?.numeroPatrimonio,os.observacoesEntrada,os.observacoesSaida].join(' ').toLowerCase();
    return alvo.includes(t);
  }).sort((a,b)=>new Date(b.data)-new Date(a.data)).map(comAtraso);
}
// Busca por número: primeiro tenta igualdade exata (caminho normal, usado
// internamente pelo próprio sistema com o valor já formatado "OS-0001").
// Se não achar, tenta de novo comparando só a parte numérica (extraída via
// extrairNumeroInteiro) — cobre o técnico digitando "1", "01" ou "OS-1" na
// busca do celular/PC, que sem isso nunca batia com "OS-0001" salvo no banco
// e sempre retornava "não encontrado" mesmo a OS existindo.
function obterOSPorNumero(numero) {
  const db = loadDB();
  const direta = db.ordens.find(o => o.numero === numero);
  if (direta) return comAtraso(direta);
  const alvo = extrairNumeroInteiro(numero);
  if (!alvo && alvo !== 0) return null;
  const porNumeroExtraido = db.ordens.find(o => extrairNumeroInteiro(o.numero) === alvo) || null;
  return comAtraso(porNumeroExtraido);
}
function atualizarCaminhoPdf(numero, pdfPath) {
  const db = loadDB();
  const os = db.ordens.find(o => o.numero === numero);
  if (!os) return null;
  os.pdfPath = pdfPath;
  saveDB(db);
  return os;
}

// Recebe um arquivo privado do Supabase e o materializa no cache do desktop.
// O banco guarda somente o caminho local; a identificação remota permite que
// sincronizações seguintes sejam idempotentes e não dupliquem fotos.
function aplicarArquivoSupabaseOS(numero, arquivo, buffer) {
  if (!numero || !arquivo?.id || !Buffer.isBuffer(buffer)) return { aplicado: false };
  const database = loadDB();
  const os = database.ordens.find((item) => item.numero === numero || item.supabaseId === arquivo.entidade_id);
  if (!os) return { aplicado: false, erro: 'OS local não encontrada.' };
  const categoriaRemota = String(arquivo.categoria || '');
  const mime = String(arquivo.mime_type || 'application/octet-stream');
  const nomeBase = String(arquivo.nome_arquivo || arquivo.id).replace(/[^a-zA-Z0-9._-]/g, '_');

  if (categoriaRemota === 'comprovante_termico_assinado') {
    os.comprovantesTermicosAssinados = Array.isArray(os.comprovantesTermicosAssinados)
      ? os.comprovantesTermicosAssinados : [];
    if (os.comprovantesTermicosAssinados.some((item) => item.supabaseArquivoId === arquivo.id)) {
      return { aplicado: false };
    }
    const conteudoHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (os.comprovantesTermicosAssinados.some((item) => {
      if (item.conteudoHash) return item.conteudoHash === conteudoHash;
      try {
        return item.path && fs.existsSync(item.path) &&
          crypto.createHash('sha256').update(fs.readFileSync(item.path)).digest('hex') === conteudoHash;
      } catch (_) {
        return false;
      }
    })) {
      return { aplicado: false, duplicada: true };
    }
    const extensao = path.extname(nomeBase) || (mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg');
    const dir = path.join(getAnexosUploadDir(), 'comprovantes-termicos', String(numero));
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, `supabase-${arquivo.id}${extensao}`);
    fs.writeFileSync(destino, buffer);
    os.comprovantesTermicosAssinados.push({
      id: `supabase-${arquivo.id}`,
      path: destino,
      nome: nomeBase,
      mimeType: mime,
      data: arquivo.updated_at || new Date().toISOString(),
      supabaseArquivoId: arquivo.id,
      conteudoHash
    });
  } else if (categoriaRemota === 'assinatura_cliente' || categoriaRemota === 'assinatura_assistencia') {
    const campo = categoriaRemota === 'assinatura_cliente' ? 'assinaturaClienteBase64' : 'assinaturaAssistenciaBase64';
    const base64 = `data:${mime};base64,${buffer.toString('base64')}`;
    if (os[campo] === base64) return { aplicado: false };
    os[campo] = base64;
    if (categoriaRemota === 'assinatura_cliente') {
      os.assinaturaPendente = false;
      os.naoAssinado = false;
      os.assinaturaClienteAtualizadaEm = arquivo.updated_at || new Date().toISOString();
    }
  } else if (mime === 'application/pdf' || categoriaRemota === 'pdf') {
    const destino = path.join(getPdfDir(), `${String(numero).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, buffer);
    os.pdfPath = destino;
  } else if (/^image\//.test(mime) || /^foto/.test(categoriaRemota)) {
    os.fotos = Array.isArray(os.fotos) ? os.fotos : [];
    if (os.fotos.some((foto) => foto.supabaseArquivoId === arquivo.id)) return { aplicado: false };
    const categoria = CATEGORIAS_FOTO_OS.includes(categoriaRemota.replace(/^foto_/, ''))
      ? categoriaRemota.replace(/^foto_/, '') : 'entrada';
    const conteudoHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const existente = os.fotos.find((foto) =>
      String(foto.categoria || 'entrada') === categoria && obterHashConteudoFoto(foto) === conteudoHash
    );
    if (existente) {
      existente.conteudoHash = conteudoHash;
      existente.supabaseArquivoId = arquivo.id;
      saveDB(database);
      return { aplicado: false, duplicada: true, os: comAtraso(os) };
    }
    // A sincronização pode juntar fotos já cadastradas no PC e no celular.
    // Preserve todas as imagens aceitas anteriormente, mesmo acima do limite
    // de novas inclusões. Rejeitar aqui travava o ciclo inteiro e a confirmação
    // de recebimento. salvarFotoOS continua limitando novas inclusões a 10.
    const extensao = path.extname(nomeBase) || (mime === 'image/png' ? '.png' : '.jpg');
    const dir = path.join(getFotosOSDir(), String(numero));
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, `supabase-${arquivo.id}${extensao}`);
    fs.writeFileSync(destino, buffer);
    os.fotos.push({
      id: `supabase-${arquivo.id}`,
      categoria,
      path: destino,
      nome: nomeBase,
      data: arquivo.updated_at || new Date().toISOString(),
      supabaseArquivoId: arquivo.id,
      conteudoHash
    });
  } else {
    return { aplicado: false };
  }
  saveDB(database);
  return { aplicado: true, os: comAtraso(os) };
}

// Foto ou PDF do comprovante térmico assinado anexado diretamente no PC.
// O conteúdo fica no registro da OS e o serviço Supabase o publica com a
// mesma categoria usada pelo Android, permitindo consulta nos dois lados.
function salvarComprovanteTermicoOS(numero, base64Data, nomeOriginal, mimeInformado) {
  const database = loadDB();
  const alvo = extrairNumeroInteiro(numero);
  const os = (database.ordens || []).find((item) =>
    item.numero === numero || (Number.isFinite(alvo) && extrairNumeroInteiro(item.numero) === alvo)
  );
  if (!os) throw new Error(`OS ${numero} não encontrada.`);

  const dataUrl = String(base64Data || '');
  const correspondencia = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  const mimeType = String((correspondencia && correspondencia[1]) || mimeInformado || '').toLowerCase();
  if (!/^image\/(png|jpe?g|webp)$/.test(mimeType) && mimeType !== 'application/pdf') {
    throw new Error('Selecione uma foto PNG, JPG, WEBP ou um arquivo PDF.');
  }
  const buffer = Buffer.from(correspondencia ? correspondencia[2] : dataUrl, 'base64');
  if (!buffer.length) throw new Error('O arquivo selecionado está vazio ou inválido.');
  if (buffer.length > 12 * 1024 * 1024) throw new Error('O comprovante deve ter no máximo 12 MB.');

  const conteudoHash = crypto.createHash('sha256').update(buffer).digest('hex');
  os.comprovantesTermicosAssinados = Array.isArray(os.comprovantesTermicosAssinados)
    ? os.comprovantesTermicosAssinados : [];
  const duplicado = os.comprovantesTermicosAssinados.find((item) => {
    if (item.conteudoHash) return item.conteudoHash === conteudoHash;
    try {
      return item.path && fs.existsSync(item.path) &&
        crypto.createHash('sha256').update(fs.readFileSync(item.path)).digest('hex') === conteudoHash;
    } catch (_) {
      return false;
    }
  });
  if (duplicado) return Object.assign({}, duplicado, { duplicada: true });
  if (os.comprovantesTermicosAssinados.length >= MAX_FOTOS_POR_DOCUMENTO) {
    throw new Error(`Limite de ${MAX_FOTOS_POR_DOCUMENTO} comprovantes térmicos atingido nesta OS.`);
  }

  const extensaoMime = mimeType === 'application/pdf' ? '.pdf'
    : mimeType === 'image/png' ? '.png'
      : mimeType === 'image/webp' ? '.webp' : '.jpg';
  const extensaoOriginal = path.extname(String(nomeOriginal || '')).toLowerCase();
  const extensao = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(extensaoOriginal)
    ? extensaoOriginal : extensaoMime;
  const id = `termico-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(getAnexosUploadDir(), 'comprovantes-termicos', String(os.numero));
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, `${id}${extensao}`);
  fs.writeFileSync(destino, buffer);
  const anexo = {
    id,
    path: destino,
    nome: path.basename(String(nomeOriginal || `${id}${extensao}`)),
    mimeType,
    data: new Date().toISOString(),
    conteudoHash
  };
  os.comprovantesTermicosAssinados.push(anexo);
  os.updatedAt = new Date().toISOString();
  saveDB(database);
  return anexo;
}

// Mantém o nome de quem recebeu/retirou no registro principal da OS e no
// comprovante de entrega, quando este já existir. Assim a impressão térmica
// gerada em "Pronto para retirada" e a reimpressão após "Entregue" usam o
// mesmo dado e a sincronização não cria um documento paralelo.
function atualizarRecebedorEntrega(numero, nomeRecebedor, cicloEntregaId) {
  const nome = String(nomeRecebedor || '').trim();
  if (!nome) throw new Error('Informe o nome de quem recebeu ou retirou o aparelho.');

  const database = loadDB();
  const alvo = extrairNumeroInteiro(numero);
  const os = (database.ordens || []).find((item) =>
    item.numero === numero || (Number.isFinite(alvo) && extrairNumeroInteiro(item.numero) === alvo)
  );
  if (!os) throw new Error(`OS ${numero} não encontrada.`);

  os.nomeRetirou = nome;
  os.recebidoPor = nome;
  os.updatedAt = new Date().toISOString();

  const entrega = _encontrarEntregaNoBanco(database, os.numero, cicloEntregaId);
  if (entrega) {
    entrega.nomeRetirou = nome;
    entrega.recebidoPor = nome;
    entrega.atualizadoEm = new Date().toISOString();
  }

  saveDB(database);
  return { sucesso: true, os: comAtraso(os), entrega: entrega || null };
}

// Etapa 7 Supabase: aplica no cache local uma OS recebida do backend sem
// passar por criarOS(). O número oficial já foi alocado pelo servidor e não
// pode ser trocado pelo contador local. Campos binários/paths que só existem
// neste PC são preservados pelo mapper antes de chegar aqui.
function aplicarOSSupabase(osRecebida) {
  if (!osRecebida || !osRecebida.numero || !osRecebida.supabaseId) {
    throw new Error('OS remota inválida para o cache local.');
  }
  const database = loadDB();
  const idx = database.ordens.findIndex((item) =>
    item.supabaseId === osRecebida.supabaseId || item.numero === osRecebida.numero
  );
  const base = idx >= 0 ? database.ordens[idx] : {
    numero: osRecebida.numero,
    data: osRecebida.data || new Date().toISOString(),
    historicoStatus: [],
    cliente: {}, aparelho: {}, diagnosticoTecnico: {},
    fotos: [], pdfPath: '', origem: 'pc'
  };
  const mesclada = Object.assign({}, base, osRecebida, {
    cliente: Object.assign({}, base.cliente || {}, osRecebida.cliente || {}),
    aparelho: Object.assign({}, base.aparelho || {}, osRecebida.aparelho || {}),
    diagnosticoTecnico: Object.assign({}, base.diagnosticoTecnico || {}, osRecebida.diagnosticoTecnico || {}),
    controleInterno: Object.assign({}, base.controleInterno || {}, osRecebida.controleInterno || {})
  });
  if (idx >= 0) database.ordens[idx] = mesclada;
  else database.ordens.push(mesclada);

  const sequencial = extrairNumeroInteiro(osRecebida.numero);
  if (Number.isFinite(sequencial)) database.proximoNumero = Math.max(database.proximoNumero || 1, sequencial + 1);
  saveDB(database);
  return comAtraso(mesclada);
}

function registrarMetadadosSupabase(numero, linha) {
  if (!numero || !linha?.id) return null;
  const database = loadDB();
  const osLocal = database.ordens.find((item) => item.numero === numero || item.supabaseId === linha.id);
  if (!osLocal) return null;
  osLocal.supabaseId = linha.id;
  osLocal.supabaseRevision = Number(linha.revision) || 1;
  osLocal.supabaseUpdatedAt = linha.updated_at || '';
  osLocal.supabaseSincronizadoEm = new Date().toISOString();
  if (linha.id_exportacao && !osLocal.origemIdExportacao) osLocal.origemIdExportacao = linha.id_exportacao;
  saveDB(database);
  return comAtraso(osLocal);
}

function removerOSSupabase(numero, linha) {
  const existente = obterOSPorNumero(numero);
  if (!existente) return { sucesso: true, removida: false };
  const resultado = excluirOS(existente.numero, 'Sincronização Supabase');
  if (resultado?.sucesso) {
    const database = loadDB();
    const log = database.historicoExclusoes?.[database.historicoExclusoes.length - 1];
    if (log) {
      log.origem = 'supabase';
      log.supabaseId = linha?.id || existente.supabaseId || '';
      saveDB(database);
    }
  }
  return resultado;
}

function excluirOS(numero, usuario) {
  const db = loadDB();
  const alvoNumerico = extrairNumeroInteiro(numero);
  const mesmaOS = (valor) => {
    const atual = extrairNumeroInteiro(valor);
    if (Number.isFinite(alvoNumerico) && Number.isFinite(atual)) return atual === alvoNumerico;
    return String(valor || '').trim().toUpperCase() === String(numero || '').trim().toUpperCase();
  };
  const idx = db.ordens.findIndex(o => mesmaOS(o.numero));
  if (idx === -1) return { sucesso: false, erro: 'OS não encontrada.' };
  const [removida] = db.ordens.splice(idx, 1);
  const numeroCanonico = removida.numero;
  const entregasRelacionadas = (db.entregas || []).filter(e => mesmaOS(e.numeroOS));
  const garantiasRelacionadas = (db.garantias || []).filter(g => mesmaOS(g.numeroOS));
  const caminhosParaRemover = new Set([
    removida.pdfPath,
    removida.comprovantePath,
    ...((removida.fotos || []).map(f => f?.path)),
    ...(entregasRelacionadas.map(e => e?.pdfPath)),
    ...(garantiasRelacionadas.map(g => g?.pdfPath))
  ].filter(Boolean));
  db.historicoExclusoes = db.historicoExclusoes || [];
  db.historicoExclusoes.push({
    tipo: 'OS',
    referencia: numeroCanonico,
    cliente: removida.cliente?.nome || '',
    usuario: usuario || 'Não identificado',
    dataExclusao: new Date().toISOString()
  });

  // Exclusão integral: nenhuma cobrança da OS pode permanecer no financeiro.
  db.cobrancas = db.cobrancas || [];
  const cobrancasRemovidas = db.cobrancas.filter(c => mesmaOS(c.osNumero));
  db.cobrancas = db.cobrancas.filter(c => !mesmaOS(c.osNumero));

  // Remove pagamentos vinculados a essa OS (CRIT-2): pagamentos órfãos
  // contaminam o relatório financeiro se não forem limpos.
  db.pagamentos = db.pagamentos || [];
  const pagamentosRemovidos = db.pagamentos.filter(p => mesmaOS(p.osNumero));
  db.pagamentos = db.pagamentos.filter(p => !mesmaOS(p.osNumero));

  // Remove reembolsos vinculados aos pagamentos removidos (CRIT-2):
  // reembolsos órfãos descontam indevidamente no saldo estimado.
  db.reembolsos = db.reembolsos || [];
  const idsPagRemovidos = new Set(pagamentosRemovidos.map(p => p.id));
  db.reembolsos = db.reembolsos.filter(r => !idsPagRemovidos.has(r.pagamentoId));

  // Remove entregas vinculadas a essa OS
  db.entregas = db.entregas || [];
  db.entregas = db.entregas.filter(e => !mesmaOS(e.numeroOS));

  // Remove entregas pendentes vinculadas a essa OS
  db.entregasPendentes = db.entregasPendentes || [];
  db.entregasPendentes = db.entregasPendentes.filter(e => !mesmaOS(e.numeroOS));

  // Remove garantias vinculadas a essa OS
  db.garantias = db.garantias || [];
  db.garantias = db.garantias.filter(g => !mesmaOS(g.numeroOS));

  // Remove log de mensagens WhatsApp vinculado a essa OS
  db.logMensagensWapp = db.logMensagensWapp || [];
  db.logMensagensWapp = db.logMensagensWapp.filter(m => !mesmaOS(m.osNumero));

  // Remove logs de IA vinculados a essa OS
  db.logIA = db.logIA || [];
  db.logIA = db.logIA.filter(l => !mesmaOS(l.osNumero));

  saveDB(db);
  for (const caminho of caminhosParaRemover) {
    try {
      const absoluto = path.resolve(String(caminho));
      const raiz = path.resolve(getRootDir());
      if (absoluto.startsWith(raiz + path.sep) && fs.existsSync(absoluto)) fs.rmSync(absoluto, { force: true });
    } catch (_) { /* limpeza física em melhor esforço; banco já foi salvo */ }
  }
  return {
    sucesso: true,
    removida,
    cobrancasRemovidas: cobrancasRemovidas.length,
    pagamentosRemovidos: pagamentosRemovidos.length,
    entregasRemovidas: entregasRelacionadas.length,
    garantiasRemovidas: garantiasRelacionadas.length
  };
}

// Mascara um segredo mostrando só os primeiros/últimos caracteres, ex.:
// "gsk_abc123xyz789" -> "gsk_ab••••••z789". Nunca expõe o valor completo
// pro renderer — é só o suficiente para o usuário reconhecer "essa é a
// chave que eu colei" sem dar pra reconstituir o segredo a partir disso.
// Segredos curtos (<= 8 caracteres) são mascarados por completo, sem
// mostrar nenhum trecho, para não vazar praticamente o valor todo.
function mascararSegredo(valor, prefixo = 4, sufixo = 4) {
  if (!valor || typeof valor !== 'string') return '';
  if (valor.length <= 8) return '•'.repeat(Math.max(valor.length, 6));
  return valor.slice(0, prefixo) + '••••••' + valor.slice(-sufixo);
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: CONFIG (leitura/escrita e logo)
// ═══════════════════════════════════════════════════════════════
function obterConfig() {
  const config = loadDB().config;
  // Nunca expor a senha (nem em hash) nem os tokens/chaves de API para o renderer.
  const { senhaExclusao, mercadoPagoToken, wappflyApiKey, groqApiKey, groqChatApiKey,
    openaiApiKey, anthropicApiKey, deepseekApiKey, supabaseConfig, ...configSemSenha } = config;
  configSemSenha.possuiSenhaExclusao = !!senhaExclusao;
  configSemSenha.possuiTokenMP = !!mercadoPagoToken;
  configSemSenha.possuiWappflyKey = !!wappflyApiKey;
  configSemSenha.possuiGroqKey = !!groqApiKey;
  // v46: chave separada do assistente de chat (ver src/ia-chat.js) — mesma
  // proteção da chave de classificação acima, nunca vai em texto puro pro renderer.
  configSemSenha.possuiGroqChatKey = !!groqChatApiKey;
  configSemSenha.possuiOpenAIKey = !!openaiApiKey;
  configSemSenha.possuiAnthropicKey = !!anthropicApiKey;
  configSemSenha.possuiDeepSeekKey = !!deepseekApiKey;
  configSemSenha.possuiSupabaseConfig = !!(supabaseConfig && supabaseConfig.url && supabaseConfig.anonKey);
  configSemSenha.supabaseUrl = supabaseConfig?.url || '';
  // Versões mascaradas dos segredos — só para a UI mostrar "essa é a chave
  // salva" (ex.: "gsk_ab••••••z789") sem nunca devolver o valor completo.
  // O campo continua funcionando 100% como antes (vazio = "não mexi",
  // preenchido = "trocar a chave"); isso é só uma dica visual a mais.
  // Não devolva metadados técnicos ao renderer comercial.
  delete configSemSenha.possuiSupabaseConfig;
  delete configSemSenha.supabaseUrl;
  return configSemSenha;
}

function migrarSegredosParaArmazenamentoSeguro() {
  if (!armazenamentoSeguroDisponivel()) return { sucesso: false, indisponivel: true };
  const database = loadDB();
  saveDB(database);
  return { sucesso: true };
}

function salvarConfig(novaConfig) {
  const db = loadDB();
  const entrada = Object.assign({}, novaConfig);

  // Tratamento da senha de exclusão: nunca persistir em texto puro.
  if (Object.prototype.hasOwnProperty.call(entrada, 'senhaExclusao')) {
    const senhaRecebida = entrada.senhaExclusao;
    if (senhaRecebida === undefined || senhaRecebida === '__SEM_ALTERACAO__') {
      // Mantém o hash atual (campo não foi alterado no formulário).
      delete entrada.senhaExclusao;
    } else if (senhaRecebida === '') {
      // Usuário removeu a senha de exclusão.
      entrada.senhaExclusao = '';
    } else {
      // Nova senha definida: gera hash+salt, nunca grava texto puro.
      entrada.senhaExclusao = gerarHashSenha(senhaRecebida);
    }
  }

  // Campos de provedores removidos nunca sobrevivem a uma gravação atual.
  limparChavesConfigObsoletas(entrada);
  delete entrada.supabaseConfig;
  delete entrada.supabaseAtivo;

  if (entrada.supabaseConfig && typeof entrada.supabaseConfig === 'object') {
    entrada.supabaseConfig = Object.assign({}, db.config.supabaseConfig, entrada.supabaseConfig);
  }

  db.config = migrarConfig(Object.assign({}, db.config, entrada));
  saveDB(db);
  return obterConfig();
}

function removerConfiguracaoObsoleta() {
  const db = loadDB();
  const camposRemovidos = limparChavesConfigObsoletas(db.config);
  db.config = migrarConfig(db.config);
  saveDB(db);
  return { sucesso: true, camposRemovidos };
}

// Verifica a senha de exclusão. Só pode ser chamada a partir do
// processo principal (main.js), nunca a partir do renderer direto.
function verificarSenhaExclusao(senhaDigitada) {
  const config = loadDB().config;
  const senhaArmazenada = config.senhaExclusao || '';
  if (!senhaArmazenada) return true; // sem senha configurada = sem trava
  return verificarHashSenha(senhaDigitada, senhaArmazenada);
}

// ── Rede / Modo de Operação (Etapa 11.4 — Arquitetura Futura) ─────
// Modos suportados hoje: só "local". "servidor" existe apenas como
// estrutura preparada (placeholder) pra uma futura versão SaaS —
// tentar ativá-lo agora retorna erro de forma explícita, em vez de
// deixar o sistema num estado inconsistente.
const MODOS_OPERACAO_VALIDOS = ['local', 'servidor'];
const MODOS_OPERACAO_IMPLEMENTADOS = ['local'];

function obterConfigRede() {
  return loadDB().config.rede;
}

function salvarConfigRede(dados) {
  const db = loadDB();
  const redeAtual = db.config.rede || {};
  const modoOperacao = dados.modoOperacao || redeAtual.modoOperacao || 'local';

  if (!MODOS_OPERACAO_VALIDOS.includes(modoOperacao)) {
    throw new Error('Modo de operação inválido.');
  }
  if (!MODOS_OPERACAO_IMPLEMENTADOS.includes(modoOperacao)) {
    throw new Error('Modo servidor ainda não está disponível nesta versão do sistema. A estrutura já está pronta, mas a sincronização será habilitada numa etapa futura.');
  }

  db.config.rede = {
    ...redeAtual,
    modoOperacao,
    apiUrl:               dados.apiUrl ?? redeAtual.apiUrl ?? '',
    apiToken:             dados.apiToken ?? redeAtual.apiToken ?? '',
    chaveEmpresa:         dados.chaveEmpresa ?? redeAtual.chaveEmpresa ?? '',
    identificadorEmpresa: dados.identificadorEmpresa ?? redeAtual.identificadorEmpresa ?? '',
  };
  saveDB(db);
  return db.config.rede;
}

function salvarLogo(base64Data, extensao) {
  const nomeOriginal = extensao ? `logo.${extensao}` : 'logo.png';
  const { path: logoPath } = uploadService.salvarArquivo({
    categoria: 'logos',
    base64Data,
    nomeOriginal,
    grupo: 'imagem',
  });
  const db = loadDB();
  db.config.logoPath = logoPath;
  db.config.logoBase64 = base64Data;
  saveDB(db);
  return { logoPath, logoBase64: base64Data };
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: ESTOQUE
// ═══════════════════════════════════════════════════════════════
const STATUS_ESTOQUE_VALIDOS = ['Aguardando chegada','Em análise','Aguardando peça','Em reparo','Pronto para venda','Reservado','Vendido','Cancelado'];

const CHECKLIST_PADRAO = [
  { id:'tela',      label:'Tela funcionando',            ok: false },
  { id:'touch',     label:'Touch funcionando',           ok: false },
  { id:'cameras',   label:'Câmeras funcionando',         ok: false },
  { id:'alto',      label:'Alto-falante funcionando',    ok: false },
  { id:'mic',       label:'Microfone funcionando',       ok: false },
  { id:'botoes',    label:'Botões funcionando',          ok: false },
  { id:'carga',     label:'Carregando normalmente',      ok: false },
  { id:'wifi',      label:'Wi-Fi funcionando',           ok: false },
  { id:'bluetooth', label:'Bluetooth funcionando',       ok: false },
  { id:'rede',      label:'Rede móvel funcionando',      ok: false },
  { id:'bio',       label:'Biometria funcionando',       ok: false },
  { id:'faceid',    label:'Face ID funcionando',         ok: false },
  { id:'conta',     label:'Sem conta bloqueada',         ok: false },
  { id:'reset',     label:'Restaurado para padrão de fábrica', ok: false },
  { id:'limpo',     label:'Limpo e higienizado',         ok: false }
];

function registrarLogEstoque(db, tipo, item, extra) {
  db.logEstoque = db.logEstoque || [];
  db.logEstoque.push({
    data: new Date().toISOString(),
    tipo,                                    // 'entrada' | 'saida' | 'atualizacao' | 'exclusao'
    id: item.id || '',
    descricao: [item.marca, item.modelo].filter(Boolean).join(' ') || item.id || '',
    status: item.status || '',
    valorPago: item.valorPago || 0,
    valorVenda: item.valorVenda || 0,
    usuario: extra?.usuario || '',
    obs: extra?.obs || ''
  });
}

function normalizarNumeroCompraVinculada(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  return digitos ? `CP-${digitos.slice(-4).padStart(4, '0')}` : '';
}

function patchEstoqueDaCompra(compra) {
  const aparelho = compra?.aparelho || {};
  const dadosCompra = compra?.dadosCompra || {};
  const tipos = { Celular: 'Smartphone', Computador: 'Computador Desktop' };
  return {
    numeroCompra: compra?.numero || '',
    marca: aparelho.marca || '',
    modelo: aparelho.modelo || '',
    tipoEquipamento: tipos[aparelho.tipo] || aparelho.tipo || 'Smartphone',
    cor: aparelho.cor || '',
    imei: aparelho.imei1 || '',
    valorPago: parseFloat(dadosCompra.valor) || 0,
    valorGastoPecas: parseFloat(dadosCompra.custoPecas) || 0,
    pecasUsadas: normalizarPecasUsadasAparelho(dadosCompra.pecasTrocar)
  };
}

function aplicarVinculoCompraNosDados(db, dados, idIgnorar) {
  if (dados.numeroCompra === undefined) return dados;
  const numeroCompra = normalizarNumeroCompraVinculada(dados.numeroCompra);
  if (!numeroCompra) {
    dados.numeroCompra = '';
    return dados;
  }
  const compra = (db.compras || []).find(item => item.numero === numeroCompra);
  if (!compra) throw new Error(`Compra ${numeroCompra} não encontrada.`);
  const duplicado = (db.estoque || []).find(item => item.numeroCompra === numeroCompra && item.id !== idIgnorar);
  if (duplicado) throw new Error(`Compra ${numeroCompra} já está vinculada ao aparelho ${duplicado.id}.`);
  Object.assign(dados, patchEstoqueDaCompra(compra));
  return dados;
}

function criarItemEstoque(dadosEntrada) {
  // Preserva assinaturaCompradorBase64/assinaturaAssistenciaBase64 sem
  // truncar — mesmo problema e mesma correção de atualizarOS/criarOS (ver
  // sanitizarPreservandoCampos).
  const dados = sanitizarPreservandoCampos(dadosEntrada, ['assinaturaCompradorBase64', 'assinaturaAssistenciaBase64']);
  const db = loadDB();
  aplicarVinculoCompraNosDados(db, dados, null);
  // Validação backend
  if (!dados.marca?.trim()) throw new Error('Marca é obrigatória.');
  if (!dados.modelo?.trim()) throw new Error('Modelo é obrigatório.');
  const imei = (dados.imei || '').trim();
  if (imei && !validarIMEI(imei)) throw new Error('IMEI inválido (deve ter 15 dígitos).');
  const cpfComprador = (dados.compradorCpf || '').trim();
  if (cpfComprador && !validarCPF(cpfComprador)) throw new Error('CPF do comprador inválido.');
  if (dados.status && !STATUS_ESTOQUE_VALIDOS.includes(dados.status)) throw new Error('Status de estoque inválido.');
  const id = 'EST-' + String(db.proximoEstoqueId).padStart(4,'0');
  db.proximoEstoqueId += 1;
  const item = {
    id,
    dataCadastro: new Date().toISOString(),
    numeroCompra: dados.numeroCompra || '',
    marca: dados.marca || '',
    modelo: dados.modelo || '',
    tipoEquipamento: dados.tipoEquipamento || 'Smartphone',
    dadosEquipamento: dados.dadosEquipamento || {},
    imei: dados.imei || '',
    cor: dados.cor || '',
    observacoes: dados.observacoes || '',
    dataEntrada: dados.dataEntrada || new Date().toISOString(),
    valorPago: parseFloat(dados.valorPago) || 0,
    valorGastoPecas: parseFloat(dados.valorGastoPecas) || 0,
    pecasUsadas: normalizarPecasUsadasAparelho(dados.pecasUsadas),
    gastosExtras: parseFloat(dados.gastosExtras) || 0,
    valorVenda: parseFloat(dados.valorVenda) || 0,
    percentualLucro: dados.percentualLucro !== undefined && dados.percentualLucro !== null ? parseFloat(dados.percentualLucro) : null,
    dataVenda: dados.dataVenda || null,
    compradorNome: dados.compradorNome || '',
    compradorClienteId: obterOuCriarIdCliente(db, dados.compradorNome, dados.compradorCpf, dados.compradorClienteId),
    compradorCpf: dados.compradorCpf || '',
    compradorEmail: dados.compradorEmail || '',
    compradorTelefone: dados.compradorTelefone || '',
    compradorSemNumero: dados.compradorSemNumero === true,
    garantia: dados.garantia || '',
    // App Celular — lote v2: forma de pagamento da venda, informada no
    // celular (mesmo campo que já existe em OS/dadosCompra) — estava
    // sendo repassada pelo import de lote (importarLoteDoCelular) mas
    // descartada aqui silenciosamente por não estar na whitelist.
    formaPagamento: dados.formaPagamento || '',
    status: dados.status || 'Em análise',
    historicoStatus: [{ status: dados.status || 'Em análise', data: new Date().toISOString() }],
    fotos: dados.fotos || [],
    checklist: dados.checklist || JSON.parse(JSON.stringify(CHECKLIST_PADRAO)),
    checklistData: dados.checklistData || null,
    checklistResponsavel: dados.checklistResponsavel || '',
    pdfVendaPath: '',
    // Snapshot de termos por documento — mesma mecânica já usada em OS
    // (ver termosSnapshot em criarOS). Se vazio, o template usa a config
    // geral do PC. Usado na importação do celular (ver decisão na seção
    // 'padrão de termos do usuário' em importarLoteDoCelular).
    termosVenda: dados.termosVenda !== undefined ? dados.termosVenda : '',
    // App Celular — lote v2: assinatura do comprador coletada no celular
    // (schema aditivo — itens antigos continuam sem esse campo, sem quebrar).
    assinaturaCompradorBase64: dados.assinaturaCompradorBase64 || '',
    // Assinatura da assistência técnica vinda do celular (mesma regra de
    // 'fotografia do momento da exportação' descrita em criarOS acima).
    assinaturaAssistenciaBase64: dados.assinaturaAssistenciaBase64 || db.config.assinaturaAssistenciaBase64 || '',
    assinaturaPendente: dados.assinaturaPendente === true,
    naoAssinado: dados.naoAssinado === true,
    origem: dados.origem || 'pc',
    origemIdExportacao: dados.origemIdExportacao || null,
    // ── Exportar para assinatura remota no celular ──
    // null até a primeira exportação (gerarPacoteParaAssinar grava aqui).
    idEnvioAssinatura: dados.idEnvioAssinatura || null
  };
  db.estoque.push(item);
  registrarLogEstoque(db, 'entrada', item, { obs: 'Cadastro inicial' });
  saveDB(db);
  return item;
}

function atualizarItemEstoque(id, dadosEntrada) {
  // Preserva assinaturaCompradorBase64/assinaturaAssistenciaBase64 sem
  // truncar — mesmo problema e mesma correção de atualizarOS/criarOS (ver
  // sanitizarPreservandoCampos). Caminho usado por importarRespostaAssinatura
  // (tipoDocumento 'venda').
  const dados = sanitizarPreservandoCampos(dadosEntrada, ['assinaturaCompradorBase64', 'assinaturaAssistenciaBase64']);
  const db = loadDB();
  const idx = db.estoque.findIndex(e => e.id === id);
  if (idx === -1) return null;
  const atual = db.estoque[idx];
  if (dados.numeroCompra === undefined && atual.numeroCompra) dados.numeroCompra = atual.numeroCompra;
  aplicarVinculoCompraNosDados(db, dados, id);
  // Validação backend
  if (!dados.marca?.trim()) throw new Error('Marca é obrigatória.');
  if (!dados.modelo?.trim()) throw new Error('Modelo é obrigatório.');
  const imei = (dados.imei || '').trim();
  if (imei && !validarIMEI(imei)) throw new Error('IMEI inválido (deve ter 15 dígitos).');
  const cpfComprador = (dados.compradorCpf || '').trim();
  if (cpfComprador && !validarCPF(cpfComprador)) throw new Error('CPF do comprador inválido.');
  if (dados.status && !STATUS_ESTOQUE_VALIDOS.includes(dados.status)) throw new Error('Status de estoque inválido.');
  let historicoStatus = atual.historicoStatus || [];
  if (dados.status && dados.status !== atual.status) {
    historicoStatus = [...historicoStatus, { status: dados.status, data: new Date().toISOString() }];
  }
  db.estoque[idx] = Object.assign({}, atual, dados, {
    compradorClienteId: obterOuCriarIdCliente(
      db,
      dados.compradorNome ?? atual.compradorNome,
      dados.compradorCpf ?? atual.compradorCpf,
      dados.compradorClienteId ?? atual.compradorClienteId
    ),
    // BUGFIX (achado pelo teste do Bloco 4 — reenvio de venda editada):
    // Object.assign({}, atual, dados, {...}) sobrescreve com `undefined`
    // qualquer campo que `dados` tenha como chave presente mas vazia —
    // isso incluía assinaturaCompradorBase64/assinaturaAssistenciaBase64
    // sempre que um patch parcial (ex.: só editando compradorNome) passava
    // por essas chaves sem definir valor. Resultado: editar QUALQUER campo
    // de uma venda e salvar apagava silenciosamente a assinatura já
    // capturada. Mesma classe de bug já corrigida em atualizarCompra (ver
    // comentário lá) — mesma correção aqui: só sobrescreve quando o campo
    // foi explicitamente enviado (!== undefined), senão preserva o atual.
    assinaturaCompradorBase64: dados.assinaturaCompradorBase64 !== undefined ? dados.assinaturaCompradorBase64 : (atual.assinaturaCompradorBase64 || ''),
    assinaturaAssistenciaBase64: dados.assinaturaAssistenciaBase64
      || atual.assinaturaAssistenciaBase64
      || db.config.assinaturaAssistenciaBase64
      || '',
    assinaturaPendente: dados.assinaturaPendente !== undefined ? dados.assinaturaPendente === true : atual.assinaturaPendente === true,
    naoAssinado: dados.naoAssinado !== undefined ? dados.naoAssinado === true : atual.naoAssinado === true,
    valorPago: parseFloat(dados.valorPago ?? atual.valorPago) || 0,
    valorGastoPecas: parseFloat(dados.valorGastoPecas ?? atual.valorGastoPecas) || 0,
    pecasUsadas: dados.pecasUsadas !== undefined
      ? normalizarPecasUsadasAparelho(dados.pecasUsadas)
      : normalizarPecasUsadasAparelho(atual.pecasUsadas),
    gastosExtras: parseFloat(dados.gastosExtras ?? atual.gastosExtras) || 0,
    valorVenda: parseFloat(dados.valorVenda ?? atual.valorVenda) || 0,
    historicoStatus,
    // Snapshot de termos do documento (ver criarItemEstoque/importação do
    // celular) — preserva explicitamente se o form de edição não enviar
    // o campo, para não zerar sem querer (Object.assign copia até chaves
    // com valor undefined).
    termosVenda: dados.termosVenda !== undefined ? dados.termosVenda : atual.termosVenda,
    // Persiste somente os campos seguros de cada foto (sem base64).
    // Defesa extra no servidor: mesmo que o renderer envie base64 por engano,
    // ele é descartado aqui e nunca chega ao banco.
    fotos: dados.fotos !== undefined
      ? dados.fotos.map(f => ({ id: f.id, path: f.path || '', nome: f.nome || '', data: f.data || '' }))
      : atual.fotos,
    checklist: dados.checklist !== undefined ? dados.checklist : atual.checklist
  });
  // Log de saida quando status muda para Vendido
  const itemAtualizado = db.estoque[idx];
  if (dados.status && dados.status !== atual.status) {
    const tipoLog = dados.status === 'Vendido' ? 'saida' : 'atualizacao';
    registrarLogEstoque(db, tipoLog, itemAtualizado, { obs: `Status: ${atual.status} -> ${dados.status}` });
  }
  saveDB(db);
  return db.estoque[idx];
}

function listarEstoque() { const db = loadDB(); return [...db.estoque].sort((a,b) => new Date(b.dataCadastro)-new Date(a.dataCadastro)); }
function obterItemEstoquePorId(id) { const db = loadDB(); return db.estoque.find(e => e.id === id) || null; }
function atualizarCaminhoPdfVenda(id, pdfPath) {
  const db = loadDB();
  const item = db.estoque.find(e => e.id === id);
  if (!item) return null;
  item.pdfVendaPath = pdfPath;
  saveDB(db);
  return item;
}

function excluirItemEstoque(id, usuario) {
  const db = loadDB();
  const idx = db.estoque.findIndex(e => e.id === id);
  if (idx === -1) return { sucesso: false, erro: 'Aparelho/Venda não encontrado.' };
  const [removido] = db.estoque.splice(idx, 1);
  db.historicoExclusoes = db.historicoExclusoes || [];
  db.historicoExclusoes.push({
    tipo: 'Venda/Estoque',
    referencia: id,
    cliente: removido.compradorNome || '',
    descricao: [removido.marca, removido.modelo].filter(Boolean).join(' '),
    usuario: usuario || 'Não identificado',
    dataExclusao: new Date().toISOString(),
    dadosOriginais: removido
  });
  registrarLogEstoque(db, 'exclusao', removido, { usuario, obs: 'Excluido do sistema' });
  saveDB(db);
  return { sucesso: true, removido };
}

function buscarEstoque(filtros) {
  const db = loadDB();
  let lista = [...db.estoque];
  const f = filtros || {};
  const termo = (f.termo || '').trim().toLowerCase();
  if (termo) {
    lista = lista.filter(it => {
      const alvo = [it.id, it.marca, it.modelo, it.imei, it.compradorNome, it.status].join(' ').toLowerCase();
      return alvo.includes(termo);
    });
  }
  if (f.marca) lista = lista.filter(it => (it.marca||'').toLowerCase().includes(String(f.marca).toLowerCase()));
  if (f.modelo) lista = lista.filter(it => (it.modelo||'').toLowerCase().includes(String(f.modelo).toLowerCase()));
  if (f.imei) lista = lista.filter(it => (it.imei||'').includes(f.imei));
  if (f.status) lista = lista.filter(it => it.status === f.status);
  if (f.dataInicio) lista = lista.filter(it => new Date(it.dataEntrada||it.dataCadastro) >= new Date(f.dataInicio));
  if (f.dataFim) lista = lista.filter(it => new Date(it.dataEntrada||it.dataCadastro) <= new Date(f.dataFim));
  return lista.sort((a,b) => new Date(b.dataCadastro)-new Date(a.dataCadastro));
}

function salvarFotoEstoque(id, base64Data, nomeOriginal) {
  const db = loadDB();
  const item = db.estoque.find(e => e.id === id);
  if (item) {
    item.fotos = normalizarListaFotos(item.fotos, 'venda');
    if (item.fotos.length >= MAX_FOTOS_POR_DOCUMENTO) {
      throw new Error(`Limite de ${MAX_FOTOS_POR_DOCUMENTO} fotos atingido.`);
    }
  }
  if (!item) return { erro: 'Item de estoque não encontrado: ' + id };

  const bytesFoto = Buffer.from(String(base64Data || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
  const conteudoHash = crypto.createHash('sha256').update(bytesFoto).digest('hex');
  const duplicada = item.fotos.find(foto => obterHashConteudoFoto(foto) === conteudoHash);
  if (duplicada) return Object.assign({}, duplicada, { base64: base64Data, duplicada: true });

  const { path: fotoPath, nome: nomeArq } = uploadService.salvarArquivo({
    categoria: 'fotos',
    subpasta: id,
    base64Data,
    nomeOriginal,
    grupo: 'imagem',
  });
  // Gera id e data consistentes com o formato de fotos de OS,
  // garantindo que o strip em atualizarItemEstoque não produza
  // { id: undefined, data: '' } ao salvar o aparelho depois.
  const fotoId = 'foto-est-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const fotoData = new Date().toISOString();
  // NO BANCO só id + path + nome + data (sem base64).
  item.fotos = [...(item.fotos || []), { id: fotoId, path: fotoPath, nome: nomeArq, data: fotoData, conteudoHash }];
  saveDB(db);
  // O base64 ainda volta na resposta do IPC (uso único, só para o
  // preview imediato na tela) — mas não é persistido no banco.
  return { id: fotoId, path: fotoPath, base64: base64Data, nome: nomeArq, data: fotoData };
}

// ─── ETAPA 8.7.2 — Galeria de Fotos da OS ──────────────────────
const CATEGORIAS_FOTO_OS = ['defeito', 'entrada', 'reparo', 'entrega'];

function gerarIdFoto() {
  return 'foto-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function salvarFotoOS(numero, categoria, base64Data, nomeOriginal) {
  // Verifica se a OS existe ANTES de gravar arquivo no disco
  const db = loadDB();
  const os = db.ordens.find(o => o.numero === numero);
  if (!os) throw new Error(`OS ${numero} não encontrada.`);

  const cat = CATEGORIAS_FOTO_OS.includes(categoria) ? categoria : 'entrada';
  os.fotos = normalizarListaFotos(os.fotos, 'entrada');
  const buf = Buffer.from(String(base64Data || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buf.length) throw new Error('A imagem recebida esta vazia ou invalida.');
  const conteudoHash = crypto.createHash('sha256').update(buf).digest('hex');
  const duplicada = os.fotos.find((foto) =>
    String(foto.categoria || 'entrada') === cat && obterHashConteudoFoto(foto) === conteudoHash
  );
  if (duplicada) {
    return Object.assign({}, duplicada, { base64: base64Data, duplicada: true });
  }
  if (os.fotos.filter((foto) => String(foto.categoria || 'entrada') === cat).length >= MAX_FOTOS_POR_DOCUMENTO) {
    throw new Error(`Limite de ${MAX_FOTOS_POR_DOCUMENTO} fotos atingido na categoria ${cat}.`);
  }
  const dir = path.join(getFotosOSDir(), String(numero));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ext = (nomeOriginal || 'jpg').split('.').pop() || 'jpg';
  const id = gerarIdFoto();
  const nomeArq = `${id}.${ext}`;
  const fotoPath = path.join(dir, nomeArq);
  fs.writeFileSync(fotoPath, buf);
  // Persiste no banco APENAS path + nome (sem base64), igual ao comportamento
  // já adotado para fotos de estoque na Etapa 9. O base64 volta na resposta
  // do IPC somente para o preview imediato no renderer — não fica no disco.
  const fotoDb = { id, categoria: cat, path: fotoPath, nome: nomeArq, data: new Date().toISOString(), conteudoHash };
  os.fotos = [...(os.fotos || []), fotoDb];
  saveDB(db);
  // Devolve com base64 para uso imediato no renderer (preview), mas sem gravar no banco.
  return { ...fotoDb, base64: base64Data };
}

function excluirFotoOS(numero, fotoId) {
  const db = loadDB();
  const os = db.ordens.find(o => o.numero === numero);
  if (!os) return { sucesso: false, erro: `OS ${numero} não encontrada.` };
  const foto = (os.fotos || []).find(f => f.id === fotoId);
  if (!foto) return { sucesso: false, erro: 'Foto não encontrada.' };
  try { if (foto.path && fs.existsSync(foto.path)) fs.unlinkSync(foto.path); } catch (e) { /* arquivo já pode ter sido removido */ }
  os.fotos = (os.fotos || []).filter(f => f.id !== fotoId);
  saveDB(db);
  return { sucesso: true };
}

function substituirFotoOS(numero, fotoId, base64Data, nomeOriginal) {
  const db = loadDB();
  const os = db.ordens.find(o => o.numero === numero);
  if (!os) throw new Error(`OS ${numero} não encontrada.`);
  const idx = (os.fotos || []).findIndex(f => f.id === fotoId);
  if (idx === -1) throw new Error('Foto não encontrada.');
  const antiga = os.fotos[idx];
  try { if (antiga.path && fs.existsSync(antiga.path)) fs.unlinkSync(antiga.path); } catch (e) { /* ignora */ }
  const dir = path.join(getFotosOSDir(), String(numero));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ext = (nomeOriginal || 'jpg').split('.').pop() || 'jpg';
  const novoId = gerarIdFoto();
  const nomeArq = `${novoId}.${ext}`;
  const fotoPath = path.join(dir, nomeArq);
  const buf = Buffer.from(base64Data.replace(/^data:[^;]+;base64,/, ''), 'base64');
  fs.writeFileSync(fotoPath, buf);
  // Igual a salvarFotoOS: persiste só path + nome no banco; base64 só na resposta do IPC.
  const conteudoHash = crypto.createHash('sha256').update(buf).digest('hex');
  const novaFotoDb = { id: novoId, categoria: antiga.categoria, path: fotoPath, nome: nomeArq, data: new Date().toISOString(), conteudoHash };
  os.fotos[idx] = novaFotoDb;
  saveDB(db);
  return { ...novaFotoDb, base64: base64Data };
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: ESTATÍSTICAS — ESTOQUE
// ═══════════════════════════════════════════════════════════════
function obterEstatisticasEstoque() {
  const db = loadDB();
  const estoque = db.estoque;
  const comprasRegistradas = Array.isArray(db.compras) ? db.compras : [];
  const quantidadeComprasRegistradas = comprasRegistradas.length;
  const valorPagoEmCompras = comprasRegistradas.reduce((total, compra) => total + (parseFloat(compra.dadosCompra?.valor) || 0), 0);
  const valorPecasEmCompras = comprasRegistradas.reduce((total, compra) => total + (parseFloat(compra.dadosCompra?.custoPecas) || 0), 0);
  const gastoTotalCompras = valorPagoEmCompras + valorPecasEmCompras;
  const ticketMedioCompras = quantidadeComprasRegistradas ? gastoTotalCompras / quantidadeComprasRegistradas : 0;
  const totalAparelhos = estoque.length;
  const disponiveis = estoque.filter(e => e.status === 'Pronto para venda').length;
  const emReparo = estoque.filter(e => e.status === 'Em reparo').length;
  const aguardando = estoque.filter(e => e.status === 'Aguardando chegada').length;
  const aguardandoPeca = estoque.filter(e => e.status === 'Aguardando peça').length;
  const reservados = estoque.filter(e => e.status === 'Reservado').length;
  const vendidos = estoque.filter(e => e.status === 'Vendido');
  const totalVendidos = vendidos.length;
  const valorTotalInvestido = estoque.reduce((s,e) => s + (e.valorPago||0) + (e.valorGastoPecas||0) + (e.gastosExtras||0), 0);
  const valorTotalVendido = vendidos.reduce((s,e) => s + (e.valorVenda||0), 0);
  const lucroTotal = vendidos.reduce((s,e) => {
    const investido = (e.valorPago||0)+(e.valorGastoPecas||0)+(e.gastosExtras||0);
    return s + ((e.valorVenda||0) - investido);
  },0);

  // Gráficos: compras e vendas por mês (últimos 6 meses)
  const meses = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth()-i);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    meses[k] = { compras: 0, vendas: 0, lucro: 0 };
  }
  estoque.forEach(e => {
    const kc = (e.dataEntrada || e.dataCadastro || '').slice(0,7);
    if (meses[kc]) meses[kc].compras++;
    if (e.status === 'Vendido' && e.dataVenda) {
      const kv = e.dataVenda.slice(0,7);
      if (meses[kv]) {
        meses[kv].vendas++;
        const inv = (e.valorPago||0)+(e.valorGastoPecas||0)+(e.gastosExtras||0);
        meses[kv].lucro += (e.valorVenda||0) - inv;
      }
    }
  });

  // Breakdown por tipo de equipamento
  const TIPOS_EQ = ['Smartphone','Tablet','Notebook','Computador Desktop','All In One','Monitor','Impressora','Videogame','Outro'];
  const porTipoEquipamento = {};
  TIPOS_EQ.forEach(t => { porTipoEquipamento[t] = { total:0, disponiveis:0, vendidos:0 }; });
  estoque.forEach(e => {
    const tipo = e.tipoEquipamento || 'Smartphone';
    const k = TIPOS_EQ.includes(tipo) ? tipo : 'Outro';
    porTipoEquipamento[k].total++;
    if (e.status === 'Pronto para venda') porTipoEquipamento[k].disponiveis++;
    if (e.status === 'Vendido') porTipoEquipamento[k].vendidos++;
  });

  return {
    totalAparelhos, disponiveis, emReparo, aguardando, aguardandoPeca, reservados, totalVendidos,
    valorTotalInvestido, valorTotalVendido, lucroTotal, grafico: meses, porTipoEquipamento,
    quantidadeComprasRegistradas, valorPagoEmCompras, valorPecasEmCompras,
    gastoTotalCompras, ticketMedioCompras
  };
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: PEÇAS E COMPONENTES (módulo separado de aparelhos)
// ═══════════════════════════════════════════════════════════════

const CATEGORIAS_PECA = [
  'Tela / Display','Bateria','Conector de Carga','Flex / Cabo',
  'Alto-falante','Microfone','Câmera Traseira','Câmera Frontal',
  'Tampa Traseira','Carcaça','Película','Capa Protetora',
  'Carregador','Cabo USB / Dados','Fonte / Adaptador','Fone de Ouvido',
  'Adesivos / Colas','Material de Limpeza','Parafusos / Fixadores',
  'Componentes Eletrônicos','Ferramentas','Memória','Placa-mãe',
  'Botão','Sensor','Outro'
];

function _registrarLogPecas(db, tipo, peca, extra) {
  db.logPecas = db.logPecas || [];
  db.logPecas.push({
    data: new Date().toISOString(),
    tipo,
    id: peca.id || '',
    nome: peca.nome || '',
    categoria: peca.categoria || '',
    compatibilidade: peca.compatibilidade || '',
    // Bug fix: para 'saida', peca.quantidade é o SALDO remanescente após a
    // baixa (já decrementado por baixarEstoquePeca), não a quantidade
    // efetivamente movimentada nesta operação. Gravar o saldo aqui inflava
    // o custo no relatório financeiro (obterRelatorioFinanceiro multiplica
    // custo unitário × l.quantidade), tanto mais quanto maior o estoque
    // restante. Permite passar extra.quantidadeMovimentada explicitamente;
    // se não vier, mantém o comportamento antigo (entrada/atualização/
    // exclusão continuam usando peca.quantidade normalmente).
    quantidade: extra?.quantidadeMovimentada !== undefined ? extra.quantidadeMovimentada : (peca.quantidade || 0),
    custo: peca.custo || 0,
    osRef: extra?.osRef || '',
    usuario: extra?.usuario || '',
    obs: extra?.obs || ''
  });
}

function _registrarModelo(db, modelo) {
  if (!modelo || modelo.length < 2) return;
  const m = modelo.trim();
  if (!db.modelosCadastrados) db.modelosCadastrados = [];
  if (!db.modelosCadastrados.includes(m)) {
    db.modelosCadastrados.push(m);
    if (db.modelosCadastrados.length > 500) db.modelosCadastrados.shift();
  }
}

function criarPeca(dadosEntrada) {
  const dados = sanitizarValor(dadosEntrada);
  if (!dados.nome?.trim()) throw new Error('Nome da peça é obrigatório.');
  if (!dados.categoria?.trim()) throw new Error('Categoria é obrigatória.');
  const db = loadDB();
  const id = 'PCA-' + String(db.proximoPecaId).padStart(4,'0');
  db.proximoPecaId += 1;
  const peca = {
    id,
    dataCadastro: new Date().toISOString(),
    tipoItem: normalizarTipoItem(dados.tipoItem),
    nome: dados.nome.trim(),
    categoria: dados.categoria.trim(),
    compatibilidade: dados.compatibilidade || '',
    fornecedor: dados.fornecedor || '',
    custo: parseFloat(dados.custo) || 0,
    quantidade: Math.max(0, parseInt(dados.quantidade) || 0),
    estoqueMinimo: Math.max(0, parseInt(dados.estoqueMinimo) || 0),
    localizacao: dados.localizacao || '',
    dataEntrada: dados.dataEntrada || new Date().toISOString(),
    observacoes: dados.observacoes || ''
  };
  // Registrar modelos compatíveis para autocomplete
  (dados.compatibilidade || '').split(/[,;]/).forEach(m => _registrarModelo(db, m.trim()));
  db.pecas.push(peca);
  _registrarLogPecas(db, 'entrada', peca, { obs: 'Cadastro inicial' });
  saveDB(db);
  return peca;
}

function atualizarPeca(id, dadosEntrada) {
  const dados = sanitizarValor(dadosEntrada);
  if (!dados.nome?.trim()) throw new Error('Nome da peça é obrigatório.');
  if (!dados.categoria?.trim()) throw new Error('Categoria é obrigatória.');
  const db = loadDB();
  const idx = db.pecas.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const atual = db.pecas[idx];
  db.pecas[idx] = Object.assign({}, atual, dados, {
    tipoItem: normalizarTipoItem(dados.tipoItem ?? atual.tipoItem),
    custo: parseFloat(dados.custo ?? atual.custo) || 0,
    quantidade: Math.max(0, parseInt(dados.quantidade ?? atual.quantidade) || 0),
    estoqueMinimo: Math.max(0, parseInt(dados.estoqueMinimo ?? atual.estoqueMinimo) || 0),
  });
  _registrarLogPecas(db, 'atualizacao', db.pecas[idx], { obs: 'Atualização manual' });
  saveDB(db);
  return db.pecas[idx];
}

function listarPecas() {
  const db = loadDB();
  return [...db.pecas].sort((a,b) => new Date(b.dataCadastro)-new Date(a.dataCadastro));
}

function obterPecaPorId(id) {
  const db = loadDB();
  return db.pecas.find(p => p.id === id) || null;
}

function excluirPeca(id, usuario) {
  const db = loadDB();
  const idx = db.pecas.findIndex(p => p.id === id);
  if (idx === -1) return { sucesso: false, erro: 'Peça não encontrada.' };
  const [removida] = db.pecas.splice(idx, 1);
  db.historicoExclusoes = db.historicoExclusoes || [];
  db.historicoExclusoes.push({
    tipo: 'Peça',
    referencia: id,
    descricao: `${removida.categoria} - ${removida.nome}`,
    usuario: usuario || 'Não identificado',
    dataExclusao: new Date().toISOString(),
    dadosOriginais: removida
  });
  _registrarLogPecas(db, 'exclusao', removida, { usuario, obs: 'Excluída do sistema' });
  saveDB(db);
  return { sucesso: true, removida };
}

// Aplicação silenciosa das alterações recebidas do Supabase. Estas funções
// não geram um novo evento de sincronização: o InventoryService registra o
// hash remoto depois de aplicá-las, evitando o efeito de eco PC -> nuvem -> PC.
function aplicarItemEstoqueSupabase(tipo, itemEntrada) {
  const item = sanitizarPreservandoCampos(itemEntrada || {}, [
    'assinaturaCompradorBase64', 'assinaturaAssistenciaBase64'
  ]);
  if (!item.id) throw new Error('Item remoto de estoque sem identificador local.');
  if (tipo === 'peca') item.tipoItem = normalizarTipoItem(item.tipoItem);
  const db = loadDB();
  const colecao = tipo === 'peca' ? db.pecas : db.estoque;
  const indice = colecao.findIndex((registro) => registro.id === item.id);
  if (indice >= 0) colecao[indice] = Object.assign({}, colecao[indice], item);
  else colecao.push(item);

  const numero = Number(String(item.id).replace(/\D/g, '')) || 0;
  if (tipo === 'peca') db.proximoPecaId = Math.max(Number(db.proximoPecaId) || 1, numero + 1);
  else db.proximoEstoqueId = Math.max(Number(db.proximoEstoqueId) || 1, numero + 1);
  saveDB(db);
  return colecao.find((registro) => registro.id === item.id) || null;
}

function removerItemEstoqueSupabase(tipo, localId) {
  const db = loadDB();
  const chave = tipo === 'peca' ? 'pecas' : 'estoque';
  const tamanhoAntes = db[chave].length;
  db[chave] = db[chave].filter((registro) => registro.id !== localId);
  if (db[chave].length !== tamanhoAntes) saveDB(db);
  return { sucesso: true, removido: db[chave].length !== tamanhoAntes };
}

function buscarPecas(filtros) {
  const db = loadDB();
  let lista = [...db.pecas];
  const f = filtros || {};
  const termo = (f.termo || '').trim().toLowerCase();
  if (termo) {
    lista = lista.filter(p =>
      [p.nome, p.categoria, p.compatibilidade, p.fornecedor, p.localizacao, p.id]
        .join(' ').toLowerCase().includes(termo)
    );
  }
  if (f.categoria) lista = lista.filter(p => p.categoria === f.categoria);
  if (f.tipoItem) lista = lista.filter(p => normalizarTipoItem(p.tipoItem) === f.tipoItem);
  if (f.estoqueCritico) lista = lista.filter(p => p.quantidade <= p.estoqueMinimo);
  if (f.estoqueZerado) lista = lista.filter(p => p.quantidade === 0);
  return lista;
}

function movimentarEstoquePeca(pecaId, tipo, quantidade, detalhesEntrada = {}) {
  const detalhes = sanitizarValor(detalhesEntrada || {});
  const db = loadDB();
  const idx = db.pecas.findIndex(p => p.id === pecaId);
  if (idx === -1) return { sucesso: false, erro: 'Peça não encontrada.' };
  const peca = db.pecas[idx];
  let movimento;
  try {
    movimento = calcularMovimentacaoEstoque(peca.quantidade, tipo, quantidade);
  } catch (erro) {
    return { sucesso: false, erro: erro.message };
  }
  db.pecas[idx].quantidade = movimento.saldoAtual;
  const referencia = detalhes.referencia || detalhes.osRef || '';
  const motivoPadrao = tipo === 'entrada' ? 'Entrada manual no estoque' : 'Saída manual do estoque';
  _registrarLogPecas(db, tipo, db.pecas[idx], {
    osRef: referencia,
    usuario: detalhes.usuario || '',
    quantidadeMovimentada: movimento.quantidade,
    obs: detalhes.motivo || motivoPadrao
  });
  saveDB(db);
  return { sucesso: true, peca: db.pecas[idx], movimento };
}

// Baixa estoque de peça quando usada em OS.
function baixarEstoquePeca(pecaId, quantidade, osRef, usuario) {
  return movimentarEstoquePeca(pecaId, 'saida', quantidade, {
    referencia: osRef,
    usuario,
    motivo: `Usado em ${osRef} — Qtd: ${quantidade}`
  });
}

function listarModelosCadastrados() {
  const db = loadDB();
  return db.modelosCadastrados || [];
}

function registrarModeloManual(modelo) {
  const db = loadDB();
  _registrarModelo(db, modelo);
  saveDB(db);
  return { sucesso: true };
}

function obterEstatisticasPecas() {
  const db = loadDB();
  const pecas = db.pecas || [];
  const total = pecas.length;
  const totalItens = pecas.reduce((s,p) => s + (p.quantidade||0), 0);
  const valorTotal = pecas.reduce((s,p) => s + (p.custo||0)*(p.quantidade||0), 0);
  const criticos = pecas.filter(p => p.quantidade > 0 && p.quantidade <= p.estoqueMinimo).length;
  const zerados = pecas.filter(p => p.quantidade === 0).length;
  // Top 5 mais usadas por log
  const usos = {};
  (db.logPecas || []).filter(l => l.tipo === 'saida').forEach(l => {
    usos[l.id] = (usos[l.id] || 0) + 1;
  });
  const maisUsadas = Object.entries(usos)
    .sort((a,b) => b[1]-a[1]).slice(0,5)
    .map(([id, vezes]) => {
      const p = pecas.find(x => x.id === id);
      return { id, nome: p ? p.nome : id, categoria: p?.categoria || '', vezes };
    });
  // Ultimas movimentacoes
  const ultimasMovimentacoes = [...(db.logPecas||[])].reverse().slice(0,10);
  return { total, totalItens, valorTotal, criticos, zerados, maisUsadas, ultimasMovimentacoes };
}

function obterEstatisticasDashboard() {
  const dbData = loadDB();
  const estoque = dbData.estoque || [];
  const pecas = dbData.pecas || [];
  const aparelhosDisponiveis = estoque.filter(e => e.tipoEquipamento !== 'Peça / Componente' && e.status === 'Pronto para venda');
  const valorAparelhos = estoque.filter(e => e.tipoEquipamento !== 'Peça / Componente')
    .reduce((s,e) => s + (e.valorPago||0) + (e.valorGastoPecas||0) + (e.gastosExtras||0), 0);
  const valorPecas = pecas.reduce((s,p) => s + (p.custo||0)*(p.quantidade||0), 0);
  const lucroPotencial = aparelhosDisponiveis.reduce((s,e) => {
    const inv = (e.valorPago||0)+(e.valorGastoPecas||0)+(e.gastosExtras||0);
    return s + ((e.valorVenda||0) - inv);
  }, 0);
  const estatsES = obterEstatisticasEstoque();
  const estatsPecas = obterEstatisticasPecas();
  return {
    valorTotalEstoque: valorAparelhos + valorPecas,
    valorAparelhos,
    valorPecas,
    qtdAparelhos: estoque.filter(e => e.tipoEquipamento !== 'Peça / Componente').length,
    qtdPecas: pecas.length,
    qtdItensEmPecas: pecas.reduce((s,p) => s + (p.quantidade||0), 0),
    pecasCriticas: estatsPecas.criticos,
    pecasZeradas: estatsPecas.zerados,
    maisUsadas: estatsPecas.maisUsadas,
    ultimasMovimentacoes: estatsPecas.ultimasMovimentacoes,
    lucroPotencial,
    ...estatsES
  };
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: ESTATÍSTICAS — OS (Relatórios)
// ═══════════════════════════════════════════════════════════════
// filtro opcional: { dataInicio, dataFim } (strings 'YYYY-MM-DD' ou ISO).
// Sem filtro, comportamento idêntico ao anterior (retrocompatível).
// Quando fornecido, o array de ordens é restrito por os.data (data de
// abertura da OS) ao intervalo antes de calcular os agregados. Isso
// afeta tanto os contadores "por status" (passam a refletir o status
// atual das OS abertas naquele período, não o total histórico) quanto
// os agregados "por evento no tempo" (top marcas, top defeitos, receita).
function obterEstatisticasOS(filtro) {
  const db = loadDB();
  const TIPOS = ['Smartphone','Tablet','Notebook','Computador Desktop','All In One','Monitor','Impressora','Videogame','Outro'];
  const STATUS_FECHADOS = STATUS_OS_FECHADOS; // ['Entregue','Cancelado']

  const dataInicio = filtro?.dataInicio ? new Date(filtro.dataInicio) : null;
  const dataFim = filtro?.dataFim ? new Date(filtro.dataFim) : null;
  // dataFim é inclusiva até o fim do dia (senão "hoje" filtrado por dataFim=hoje 00:00 excluiria o próprio dia)
  if (dataFim) dataFim.setHours(23, 59, 59, 999);

  const todasOrdens = db.ordens || [];
  const ordens = (dataInicio || dataFim)
    ? todasOrdens.filter(os => {
        const d = new Date(os.data);
        if (isNaN(d.getTime())) return false;
        if (dataInicio && d < dataInicio) return false;
        if (dataFim && d > dataFim) return false;
        return true;
      })
    : todasOrdens;

  const totalOS = ordens.length;
  const abertas = ordens.filter(os => !STATUS_FECHADOS.includes(os.status)).length;
  const finalizadas = ordens.filter(os => os.status === 'Pronto para retirada' || os.status === 'Entregue').length;
  const canceladas = ordens.filter(os => os.status === 'Cancelado').length;

  // ── ETAPA 8.7.3 — Painel Operacional ──
  const emAberto = abertas;
  const emReparo = ordens.filter(os => os.status === 'Em reparo').length;
  const aguardandoPeca = ordens.filter(os => os.status === 'Aguardando peça').length;
  const prontas = ordens.filter(os => os.status === 'Pronto para retirada').length;
  const entregues = ordens.filter(os => os.status === 'Entregue').length;
  const atrasadas = ordens.filter(os => calcularAtraso(os)).length;

  // Por status
  const porStatus = {};
  STATUS_OS_VALIDOS.forEach(s => { porStatus[s] = 0; });
  ordens.forEach(os => { if (porStatus[os.status] !== undefined) porStatus[os.status]++; });

  // Por tipo de equipamento
  const porTipo = {};
  TIPOS.forEach(t => { porTipo[t] = 0; });
  ordens.forEach(os => {
    const tipo = os.aparelho?.tipoEquipamento || os.aparelho?.tipo || 'Smartphone';
    const k = TIPOS.includes(tipo) ? tipo : 'Outro';
    porTipo[k]++;
  });

  // Por mês (últimos 6 meses a partir de hoje, OU os meses cobertos pelo
  // filtro quando um período personalizado for informado) — recebidas e finalizadas
  const meses = {};
  if (dataInicio && dataFim) {
    // Gera um "bucket" por mês entre dataInicio e dataFim (inclusive),
    // limitado a 24 meses para não gerar milhares de chaves em filtros
    // com anos de intervalo por engano.
    const cursor = new Date(dataInicio.getFullYear(), dataInicio.getMonth(), 1);
    const limite = new Date(dataFim.getFullYear(), dataFim.getMonth(), 1);
    let guarda = 0;
    while (cursor <= limite && guarda < 24) {
      const k = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`;
      meses[k] = { recebidas: 0, finalizadas: 0 };
      cursor.setMonth(cursor.getMonth() + 1);
      guarda++;
    }
  } else {
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      meses[k] = { recebidas: 0, finalizadas: 0 };
    }
  }
  ordens.forEach(os => {
    const kc = (os.data || '').slice(0,7);
    if (meses[kc]) meses[kc].recebidas++;
    if (os.status === 'Pronto para retirada' || os.status === 'Entregue') {
      const historico = os.historicoStatus || [];
      const ultFin = [...historico].reverse().find(h => h.status === 'Pronto para retirada' || h.status === 'Entregue');
      const dataFin = (ultFin ? ultFin.data : os.data) || '';
      const kf = dataFin.slice(0,7);
      if (meses[kf]) meses[kf].finalizadas++;
    }
  });

  // Top marcas (máx. 8)
  const marcasMap = {};
  ordens.forEach(os => {
    const marca = (os.aparelho?.marca || '').trim();
    if (marca) marcasMap[marca] = (marcasMap[marca] || 0) + 1;
  });
  const topMarcas = Object.entries(marcasMap)
    .sort((a,b) => b[1]-a[1]).slice(0,8)
    .map(([nome,total]) => ({ nome, total }));

  // Top defeitos do checklist (máx. 5)
  const defeitosMap = {};
  ordens.forEach(os => {
    const lista = os.aparelho?.checklistDefeitos || [];
    lista.forEach(d => {
      const chave = d.startsWith('Outro: ') ? 'Outro' : d;
      defeitosMap[chave] = (defeitosMap[chave] || 0) + 1;
    });
  });
  const topDefeitos = Object.entries(defeitosMap)
    .sort((a,b) => b[1]-a[1]).slice(0,5)
    .map(([nome,total]) => ({ nome, total }));

  // Pagamentos no período — quando filtro de data é informado, restringe
  // também os pagamentos pela mesma janela (por dataPagamento), não só as OS.
  const todosPagamentos = db.pagamentos || [];
  const pagamentosDB = (dataInicio || dataFim)
    ? todosPagamentos.filter(p => {
        const d = new Date(p.dataPagamento);
        if (isNaN(d.getTime())) return false;
        if (dataInicio && d < dataInicio) return false;
        if (dataFim && d > dataFim) return false;
        return true;
      })
    : todosPagamentos;
  const receitaMeses = {};
  const totalPago = pagamentosDB.reduce((s, p) => s + (p.valor || 0), 0);
  const aguardandoPagamento = ordens.filter(os => [
    'Aguardando Pagamento', 'Aguardando Pagamento Presencial',
    'Aguardando Pagamento na Retirada', 'Pago 50%'
  ].includes(normalizarStatusPagamento(os.statusPagamento))).length;
  const ossPagas = ordens.filter(os => normalizarStatusPagamento(os.statusPagamento) === 'Pago').length;
  Object.keys(meses).forEach(k => { receitaMeses[k] = 0; });
  pagamentosDB.forEach(p => {
    const km = (p.dataPagamento || '').slice(0,7);
    if (receitaMeses[km] !== undefined) receitaMeses[km] += (p.valor || 0);
  });

  return { totalOS, abertas, finalizadas, canceladas, porStatus, porTipo, meses, topMarcas, topDefeitos,
    emAberto, emReparo, aguardandoPeca, prontas, entregues, atrasadas,
    aguardandoPagamento, ossPagas, totalPago, receitaMeses,
    periodoAplicado: !!(dataInicio || dataFim) };
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: BACKUP (export/import completo)
// ═══════════════════════════════════════════════════════════════
function exportarBackupCompleto(caminhoDestino) {
  const database = loadDB();
  // v8: inclui também autorizações de desbloqueio.
  const db6 = _initPagamentos(_initCobrancas(database));
  const configBackup = Object.assign({}, db6.config);
  for (const campo of [...CAMPOS_CONFIG_SECRETOS, 'senhaExclusao']) delete configBackup[campo];
  const pacote = {
    tipo: 'backup-sistema-os',
    versaoBackup: 8,
    geradoEm: new Date().toISOString(),
    proximoNumero: db6.proximoNumero,
    proximoEstoqueId: db6.proximoEstoqueId,
    proximoPecaId: db6.proximoPecaId || 1,
    proximoCodigoInterno: db6.proximoCodigoInterno || 1,
    proximoUsuarioId: db6.proximoUsuarioId || 1,
    proximoCargoId: db6.proximoCargoId || 1,
    proximoCompraId: db6.proximoCompraId || 1,
    proximoOrcId: db6.proximoOrcId || 1,
    proximoDesbloqueioId: db6.proximoDesbloqueioId || 1,
    config: configBackup,
    ordens: db6.ordens,
    estoque: db6.estoque,
    pecas: db6.pecas || [],
    compras: db6.compras || [],
    orcamentos: db6.orcamentos || [],
    pagamentos: db6.pagamentos || [],
    cobrancas: db6.cobrancas || [],
    modelosCadastrados: db6.modelosCadastrados || [],
    logPecas: db6.logPecas || [],
    logEstoque: db6.logEstoque || [],
    usuarios: db6.usuarios || [],
    cargos: db6.cargos || [],
    historicoExclusoes: db6.historicoExclusoes || [],
    logMensagensWapp: db6.logMensagensWapp || [],
    // Coleções que estavam faltando (CRIT-1):
    reembolsos: db6.reembolsos || [],
    logIA: db6.logIA || [],
    entregas: db6.entregas || [],
    entregasPendentes: db6.entregasPendentes || [],
    garantias: db6.garantias || [],
    desbloqueios: db6.desbloqueios || []
  };
  fs.writeFileSync(caminhoDestino, JSON.stringify(pacote, null, 2), 'utf-8');
  return {
    caminho: caminhoDestino,
    totalOrdens: db6.ordens.length,
    totalEstoque: db6.estoque.length,
    totalPecas: (db6.pecas||[]).length,
    totalCompras: (db6.compras||[]).length,
    totalOrcamentos: (db6.orcamentos||[]).length,
    totalPagamentos: (db6.pagamentos||[]).length
  };
}

function importarBackup(caminhoOrigem) {
  const raw = fs.readFileSync(caminhoOrigem, 'utf-8');
  if (raw.length > 50 * 1024 * 1024) throw new Error('Arquivo de backup muito grande (>50MB). Abortando por segurança.');
  let pacote;
  try { pacote = JSON.parse(raw); } catch { throw new Error('Arquivo inválido ou corrompido.'); }
  if (!pacote || typeof pacote !== 'object') throw new Error('Estrutura de backup inválida.');

  // CRIT-6: Sanitiza registros importados para evitar injeção de dados
  let ordensImportadas = Array.isArray(pacote.ordens) ? pacote.ordens.map(os => sanitizarValor(os)) : [];
  let estoqueImportado = Array.isArray(pacote.estoque) ? pacote.estoque.map(e => sanitizarValor(e)) : [];

  const database = loadDB();
  const numerosExistentes = new Set(database.ordens.map(o => o.numero));
  const idsEstoqueExistentes = new Set(database.estoque.map(e => e.id));

  let importadas = 0, duplicadasIgnoradas = 0;
  let maiorNumero = database.proximoNumero - 1;

  for (const os of ordensImportadas) {
    if (!os.numero) continue;
    const n = extrairNumeroInteiro(os.numero);
    if (n > maiorNumero) maiorNumero = n;
    if (numerosExistentes.has(os.numero)) { duplicadasIgnoradas++; continue; }
    database.ordens.push({
      numero: os.numero,
      data: os.data || new Date().toISOString(),
      dataAutomatic: os.dataAutomatic !== false,
      status: os.status || 'Aguardando análise',
      historicoStatus: os.historicoStatus || [],
      dataPrevista: os.dataPrevista || '',
      horaPrevista: os.horaPrevista || '',
      prioridade: os.prioridade || 'Normal',
      controleInterno: os.controleInterno || {},
      tecnicoResponsavel: os.tecnicoResponsavel || '',
      tecnicoAuxiliar: os.tecnicoAuxiliar || '',
      cliente: os.cliente || {},
      aparelho: os.aparelho || {},
      imei: os.imei || '',
      observacoes: os.observacoes || '',
      termos: os.termos || '',
      valorInvestido: parseFloat(os.valorInvestido) || 0,
      percentualLucro: os.percentualLucro !== undefined ? os.percentualLucro : null,
      diagnosticoTecnico: os.diagnosticoTecnico || { diagnostico: '', solucao: '', pecas: '', valorEstimado: 0, prazoEstimado: '' },
      checklistEntrada: os.checklistEntrada || [],
      observacoesEntrada: os.observacoesEntrada || '',
      checklistSaida: os.checklistSaida || [],
      observacoesSaida: os.observacoesSaida || '',
      fotos: Array.isArray(os.fotos)
        ? os.fotos.map(f => ({ id: f.id, categoria: f.categoria, path: f.path || '', nome: f.nome || '', data: f.data || '' }))
        : [],
      pdfPath: ''
    });
    numerosExistentes.add(os.numero);
    importadas++;
  }
  database.proximoNumero = Math.max(database.proximoNumero, maiorNumero + 1);

  let importadasEstoque = 0;
  for (const item of estoqueImportado) {
    if (!item.id || idsEstoqueExistentes.has(item.id)) continue;
    database.estoque.push(item);
    idsEstoqueExistentes.add(item.id);
    importadasEstoque++;
  }

  if (pacote.proximoEstoqueId) {
    database.proximoEstoqueId = Math.max(database.proximoEstoqueId || 1, pacote.proximoEstoqueId);
  }
  // Restaurar peças do backup
  if (Array.isArray(pacote.pecas) && pacote.pecas.length) {
    const idsPecasExistentes = new Set((database.pecas || []).map(p => p.id));
    let importadasPecas = 0;
    for (const peca of pacote.pecas) {
      if (!peca.id || idsPecasExistentes.has(peca.id)) continue;
      database.pecas = [...(database.pecas || []), peca];
      idsPecasExistentes.add(peca.id);
      importadasPecas++;
    }
  }
  // Fora do bloco acima de propósito: o contador precisa avançar mesmo se
  // o array de peças do backup vier vazio (ex.: instalação que cadastrou e
  // depois excluiu todas as peças — o array fica [] mas o contador avançou).
  if (pacote.proximoPecaId) {
    database.proximoPecaId = Math.max(database.proximoPecaId || 1, pacote.proximoPecaId);
  }
  if (Array.isArray(pacote.modelosCadastrados)) {
    const existentes = new Set(database.modelosCadastrados || []);
    pacote.modelosCadastrados.forEach(m => existentes.add(m));
    database.modelosCadastrados = [...existentes];
  }
  if (pacote.proximoCodigoInterno) {
    database.proximoCodigoInterno = Math.max(database.proximoCodigoInterno || 1, pacote.proximoCodigoInterno);
  }
  // Restaura usuários e cargos do backup (eram ignorados antes).
  // Estratégia de merge: preserva registros existentes na instalação atual e
  // importa os que vieram no backup sem conflito de ID.
  if (Array.isArray(pacote.cargos) && pacote.cargos.length) {
    const idsCargoExistentes = new Set((database.cargos || []).map(c => c.id));
    for (const cargo of pacote.cargos) {
      if (cargo.id && !idsCargoExistentes.has(cargo.id)) {
        database.cargos = [...(database.cargos || []), cargo];
        idsCargoExistentes.add(cargo.id);
      }
    }
  }
  if (pacote.proximoCargoId) {
    database.proximoCargoId = Math.max(database.proximoCargoId || 1, pacote.proximoCargoId);
  }
  if (Array.isArray(pacote.usuarios) && pacote.usuarios.length) {
    const idsUsuarioExistentes = new Set((database.usuarios || []).map(u => u.id));
    const loginsExistentes = new Set((database.usuarios || []).map(u => u.usuario));
    for (const usuario of pacote.usuarios) {
      if (usuario.id && !idsUsuarioExistentes.has(usuario.id) && !loginsExistentes.has(usuario.usuario)) {
        database.usuarios = [...(database.usuarios || []), usuario];
        idsUsuarioExistentes.add(usuario.id);
        loginsExistentes.add(usuario.usuario);
      }
    }
  }
  if (pacote.proximoUsuarioId) {
    database.proximoUsuarioId = Math.max(database.proximoUsuarioId || 1, pacote.proximoUsuarioId);
  }
  // Restaura a config do backup. Antes, isso só acontecia se a config atual
  // estivesse com nomeEmpresa vazio — condição que na prática nunca era
  // verdadeira (DEFAULT_CONFIG já vem com nomeEmpresa preenchido), então a
  // config do backup (incluindo logoBase64) nunca era restaurada de fato.
  // Importar um backup completo deve restaurar a config também.
  if (pacote.config) {
    database.config = migrarConfig(pacote.config);
  }

  // Restaura log de mensagens WhatsApp do backup (merge sem duplicatas por id)
  if (Array.isArray(pacote.logMensagensWapp) && pacote.logMensagensWapp.length) {
    const idsExistentes = new Set((database.logMensagensWapp || []).map(m => m.id));
    for (const msg of pacote.logMensagensWapp) {
      if (msg.id && !idsExistentes.has(msg.id)) {
        database.logMensagensWapp = [...(database.logMensagensWapp || []), msg];
        idsExistentes.add(msg.id);
      }
    }
  }

  // v6: Restaura compras do backup (merge sem duplicatas por numero)
  if (Array.isArray(pacote.compras) && pacote.compras.length) {
    const numerosComprasExistentes = new Set((database.compras || []).map(c => c.numero));
    let importadasCompras = 0;
    for (const compra of pacote.compras) {
      if (!compra.numero || numerosComprasExistentes.has(compra.numero)) continue;
      database.compras = [...(database.compras || []), compra];
      numerosComprasExistentes.add(compra.numero);
      importadasCompras++;
    }
  }
  if (pacote.proximoCompraId) {
    database.proximoCompraId = Math.max(database.proximoCompraId || 1, pacote.proximoCompraId);
  }

  // Restaura orçamentos do backup (merge sem duplicatas por numero).
  // Faltava por completo antes — orçamentos nunca foram exportados nem
  // restaurados, então backups perdiam esse módulo inteiro em silêncio.
  if (Array.isArray(pacote.orcamentos) && pacote.orcamentos.length) {
    const numerosOrcExistentes = new Set((database.orcamentos || []).map(o => o.numero));
    for (const orc of pacote.orcamentos) {
      if (!orc.numero || numerosOrcExistentes.has(orc.numero)) continue;
      database.orcamentos = [...(database.orcamentos || []), orc];
      numerosOrcExistentes.add(orc.numero);
    }
  }
  if (pacote.proximoOrcId) {
    database.proximoOrcId = Math.max(database.proximoOrcId || 1, pacote.proximoOrcId);
  }

  // v6: Restaura pagamentos do backup (merge sem duplicatas por id)
  if (Array.isArray(pacote.pagamentos) && pacote.pagamentos.length) {
    const db6 = _initPagamentos(database);
    const idsPagExistentes = new Set(db6.pagamentos.map(p => p.id));
    for (const pag of pacote.pagamentos) {
      if (!pag.id || idsPagExistentes.has(pag.id)) continue;
      db6.pagamentos = [...db6.pagamentos, pag];
      idsPagExistentes.add(pag.id);
    }
    database.pagamentos = db6.pagamentos;
  }

  // v6: Restaura cobranças do backup (merge sem duplicatas por id)
  if (Array.isArray(pacote.cobrancas) && pacote.cobrancas.length) {
    const db6c = _initCobrancas(database);
    const idsCobExistentes = new Set(db6c.cobrancas.map(c => c.id));
    for (const cob of pacote.cobrancas) {
      if (!cob.id || idsCobExistentes.has(cob.id)) continue;
      db6c.cobrancas = [...db6c.cobrancas, cob];
      idsCobExistentes.add(cob.id);
    }
    database.cobrancas = db6c.cobrancas;
  }

  // v7: Restaura coleções que estavam faltando (CRIT-1):
  // reembolsos, logIA, entregas, entregasPendentes, garantias
  if (Array.isArray(pacote.reembolsos) && pacote.reembolsos.length) {
    const idsExistentes = new Set((database.reembolsos || []).map(r => r.id));
    for (const r of pacote.reembolsos) {
      if (r.id && !idsExistentes.has(r.id)) {
        database.reembolsos = [...(database.reembolsos || []), r];
        idsExistentes.add(r.id);
      }
    }
  }
  if (Array.isArray(pacote.logIA) && pacote.logIA.length) {
    const idsExistentes = new Set((database.logIA || []).map(l => l.id));
    for (const l of pacote.logIA) {
      if (l.id && !idsExistentes.has(l.id)) {
        database.logIA = [...(database.logIA || []), l];
        idsExistentes.add(l.id);
      }
    }
  }
  if (Array.isArray(pacote.entregas) && pacote.entregas.length) {
    const chavesExistentes = new Set((database.entregas || []).map(e => `${String(e.numeroOS || '').trim()}::${_cicloDaEntrega(e)}`));
    for (const e of pacote.entregas) {
      const chave = `${String(e.numeroOS || '').trim()}::${_cicloDaEntrega(e)}`;
      if (e.numeroOS && !chavesExistentes.has(chave)) {
        database.entregas = [...(database.entregas || []), e];
        chavesExistentes.add(chave);
      }
    }
  }
  if (Array.isArray(pacote.entregasPendentes) && pacote.entregasPendentes.length) {
    const chavesExistentes = new Set((database.entregasPendentes || []).map(e => `${String(e.numeroOS || '').trim()}::${_cicloDaEntrega(e)}`));
    for (const e of pacote.entregasPendentes) {
      const chave = `${String(e.numeroOS || '').trim()}::${_cicloDaEntrega(e)}`;
      if (e.numeroOS && !chavesExistentes.has(chave)) {
        database.entregasPendentes = [...(database.entregasPendentes || []), e];
        chavesExistentes.add(chave);
      }
    }
  }
  if (Array.isArray(pacote.garantias) && pacote.garantias.length) {
    const numerosExistentes = new Set((database.garantias || []).map(g => g.numeroOS));
    for (const g of pacote.garantias) {
      if (g.numeroOS && !numerosExistentes.has(g.numeroOS)) {
        database.garantias = [...(database.garantias || []), g];
        numerosExistentes.add(g.numeroOS);
      }
    }
  }
  if (Array.isArray(pacote.desbloqueios) && pacote.desbloqueios.length) {
    const numerosExistentes = new Set((database.desbloqueios || []).map(item => item.numero));
    for (const item of pacote.desbloqueios) {
      if (item.numero && !numerosExistentes.has(item.numero)) {
        database.desbloqueios = [...(database.desbloqueios || []), item];
        numerosExistentes.add(item.numero);
      }
    }
  }
  if (pacote.proximoDesbloqueioId) {
    database.proximoDesbloqueioId = Math.max(database.proximoDesbloqueioId || 1, pacote.proximoDesbloqueioId);
  }

  saveDB(database);
  return { totalOrdens: ordensImportadas.length, importadas, duplicadasIgnoradas, importadasEstoque };
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: USUÁRIOS (Etapa 11.2)
// ═══════════════════════════════════════════════════════════════
// Schema de cada usuário no database.json:
// {
//   id: string,                  // "USR-0001"
//   usuario: string,             // login (lowercase, único)
//   nome: string,                // nome de exibição
//   perfil: 'admin'|'operador',  // legado (compatibilidade) — quem manda agora é cargoId
//   cargoId: string,             // referência a um cargo (Etapa 11.3)
//   senhaHash: string,           // PBKDF2 hex
//   senhaSalt: string,           // salt hex
//   status: 'ativo'|'bloqueado'|'inativo',
//   dataCriacao: string (ISO),
//   ultimoLogin: string|null (ISO),
//   geradoAutomaticamente: boolean
// }

function gerarIdUsuario(db) {
  const id = 'USR-' + String(db.proximoUsuarioId).padStart(4, '0');
  db.proximoUsuarioId += 1;
  return id;
}

function listarUsuarios() {
  const database = loadDB();
  return database.usuarios || [];
}

function obterUsuarioPorLogin(login) {
  const database = loadDB();
  return (database.usuarios || []).find(u => u.usuario === login.trim().toLowerCase()) || null;
}

function obterUsuarioPorId(id) {
  const database = loadDB();
  return (database.usuarios || []).find(u => u.id === id) || null;
}

function criarUsuario(dados) {
  const database = loadDB();
  // ALT-3: Verifica se o login já existe
  const loginNormalizado = (dados.usuario || '').trim().toLowerCase();
  if (!loginNormalizado) throw new Error('Login do usuário é obrigatório.');
  const existente = (database.usuarios || []).find(u => u.usuario === loginNormalizado);
  if (existente) throw new Error('Já existe um usuário com este login.');
  const id = gerarIdUsuario(database);
  const novoUsuario = {
    id,
    usuario:              (dados.usuario || '').trim().toLowerCase(),
    nome:                 (dados.nome || '').trim(),
    perfil:               dados.perfil || 'operador',
    cargoId:              dados.cargoId || null,
    senhaHash:            dados.senhaHash || '',
    senhaSalt:            dados.senhaSalt || '',
    senhaIteracoes:       Number(dados.senhaIteracoes) || 100000,
    status:               dados.status || 'ativo',
    dataCriacao:          new Date().toISOString(),
    ultimoLogin:          null,
    geradoAutomaticamente: !!dados.geradoAutomaticamente,
    trocaSenhaObrigatoria: dados.trocaSenhaObrigatoria === true,
  };
  database.usuarios = [...(database.usuarios || []), novoUsuario];
  saveDB(database);
  return novoUsuario;
}

// Campos que podem ser atualizados por via externa (renderer). Whitelist
// previne escalonamento de privilégios via injeção de campos como admin:true.
const USUARIO_CAMPOS_EDITAVEIS = ['nome', 'senhaHash', 'senhaSalt', 'senhaIteracoes', 'status', 'cargoId', 'geradoAutomaticamente', 'trocaSenhaObrigatoria'];

function atualizarUsuario(id, dados) {
  const database = loadDB();
  const idx = (database.usuarios || []).findIndex(u => u.id === id);
  if (idx === -1) return null;
  // Filtra apenas campos permitidos (CRIT-3): previne injeção de admin:true
  const dadosFiltrados = {};
  for (const campo of USUARIO_CAMPOS_EDITAVEIS) {
    if (campo in dados) dadosFiltrados[campo] = dados[campo];
  }
  const atualizado = Object.assign({}, database.usuarios[idx], dadosFiltrados, { id });
  database.usuarios[idx] = atualizado;
  saveDB(database);
  return atualizado;
}

function excluirUsuario(id) {
  const database = loadDB();
  const antes = (database.usuarios || []).length;
  database.usuarios = (database.usuarios || []).filter(u => u.id !== id);
  if (database.usuarios.length === antes) return false;
  saveDB(database);
  return true;
}

function registrarLogin(id) {
  const database = loadDB();
  const idx = (database.usuarios || []).findIndex(u => u.id === id);
  if (idx !== -1) {
    database.usuarios[idx].ultimoLogin = new Date().toISOString();
    saveDB(database);
  }
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: CARGOS E PERMISSÕES (Etapa 11.3)
// ═══════════════════════════════════════════════════════════════
// Schema de cada cargo no database.json:
// {
//   id: string,                // "CARGO-0001" ou um dos IDs fixos do sistema
//   nome: string,
//   admin: boolean,            // true = ignora todas as restrições (somente Administrador)
//   sistema: boolean,          // true = cargo padrão de fábrica (não pode ser excluído)
//   permissoes: {              // true/false por módulo
//     os, clientes, estoque, financeiro, relatorios, configuracoes, usuarios
//   }
// }

function gerarIdCargo(db) {
  const id = 'CARGO-' + String(db.proximoCargoId).padStart(4, '0');
  db.proximoCargoId += 1;
  return id;
}

function listarCargos() {
  const database = loadDB();
  return database.cargos || [];
}

function obterCargoPorId(id) {
  const database = loadDB();
  return (database.cargos || []).find(c => c.id === id) || null;
}

function criarCargo(dados) {
  const database = loadDB();
  const id = dados.id || gerarIdCargo(database);
  const novoCargo = {
    id,
    nome:       (dados.nome || '').trim(),
    admin:      !!dados.admin,
    sistema:    !!dados.sistema,
    permissoes: dados.permissoes || {},
  };
  database.cargos = [...(database.cargos || []), novoCargo];
  saveDB(database);
  return novoCargo;
}

// Campos que podem ser atualizados em um cargo. Whitelist previne
// escalonamento de privilégios via injeção de admin:true em cargos normais.
const CARGO_CAMPOS_EDITAVEIS = ['nome', 'admin', 'permissoes'];

function atualizarCargo(id, dados) {
  const database = loadDB();
  const idx = (database.cargos || []).findIndex(c => c.id === id);
  if (idx === -1) return null;
  // Filtra apenas campos permitidos (CRIT-4)
  const dadosFiltrados = {};
  for (const campo of CARGO_CAMPOS_EDITAVEIS) {
    if (campo in dados) dadosFiltrados[campo] = dados[campo];
  }
  const atualizado = Object.assign({}, database.cargos[idx], dadosFiltrados, { id });
  database.cargos[idx] = atualizado;
  saveDB(database);
  return atualizado;
}

function excluirCargo(id) {
  const database = loadDB();
  // ALT-7: Verifica se há usuários usando este cargo
  const usuariosComCargo = (database.usuarios || []).filter(u => u.cargoId === id).length;
  if (usuariosComCargo > 0) throw new Error(`Não é possível excluir: ${usuariosComCargo} usuário(s) ainda usa(m) este cargo.`);
  // Impede exclusão de cargos do sistema
  const cargo = (database.cargos || []).find(c => c.id === id);
  if (cargo && cargo.sistema) throw new Error('Não é possível excluir cargos do sistema.');
  database.cargos = (database.cargos || []).filter(c => c.id !== id);
  saveDB(database);
  return true;
}

function contarUsuariosComCargo(cargoId) {
  const database = loadDB();
  return (database.usuarios || []).filter(u => u.cargoId === cargoId).length;
}

// ─── Log de Estoque ───────────────────────────────────────────────────────────
function obterLogEstoque({ dataInicio, dataFim, tipo } = {}) {
  const db = loadDB();
  let logs = db.logEstoque || [];
  if (dataInicio) logs = logs.filter(l => l.data >= dataInicio);
  if (dataFim)    logs = logs.filter(l => l.data <= dataFim + 'T23:59:59.999Z');
  if (tipo)       logs = logs.filter(l => l.tipo === tipo);
  return logs.sort((a, b) => new Date(b.data) - new Date(a.data));
}

function exportarLogEstoqueCsv({ dataInicio, dataFim, tipo } = {}) {
  const logs = obterLogEstoque({ dataInicio, dataFim, tipo });
  const cabecalho = 'Data;Tipo;ID;Descricao;Status;Valor Pago;Valor Venda;Usuario;Obs';
  const linhas = logs.map(l => [
    l.data ? new Date(l.data).toLocaleString('pt-BR') : '',
    l.tipo || '',
    l.id || '',
    (l.descricao || '').replace(/;/g, ','),
    l.status || '',
    String(l.valorPago || 0).replace('.', ','),
    String(l.valorVenda || 0).replace('.', ','),
    l.usuario || '',
    (l.obs || '').replace(/;/g, ',')
  ].join(';'));
  return [cabecalho, ...linhas].join('\r\n');
}

module.exports = {
  getRootGlobalDir, getRootDir, getDbPath, ativarEscopoEmpresa, desativarEscopoEmpresa, obterEscopoEmpresaAtivo,
  getPdfDir, getPdfVendaDir, getBackupDir, getBackupAutoDir, getLogoDir, getFotosDir, getFotosOSDir,
  getVendasUploadDir, getAnexosUploadDir, verificarTamanhoDB,
  salvarFotoOS, excluirFotoOS, substituirFotoOS,
  loadDB, saveDB,
  criarOS, atualizarOS, listarOrdens, buscarOrdens, obterOSPorNumero, atualizarCaminhoPdf, excluirOS,
  aplicarOSSupabase, aplicarArquivoSupabaseOS, salvarComprovanteTermicoOS, atualizarRecebedorEntrega,
  registrarMetadadosSupabase, removerOSSupabase,
  importarOSDoCelular, importarLoteDoCelular,
  // Exportar documento para assinatura remota no celular (envio individual)
  gerarPacoteParaAssinar, gerarIdEnvioAssinatura, importarRespostaAssinatura,
  obterConfig, salvarConfig, removerConfiguracaoObsoleta, salvarLogo, verificarSenhaExclusao,
  configurarArmazenamentoSeguro, armazenamentoSeguroDisponivel, migrarSegredosParaArmazenamentoSeguro,
  obterConfigRede, salvarConfigRede, MODOS_OPERACAO_VALIDOS, MODOS_OPERACAO_IMPLEMENTADOS,
  criarItemEstoque, atualizarItemEstoque, listarEstoque, obterItemEstoquePorId,
  atualizarCaminhoPdfVenda, salvarFotoEstoque, obterEstatisticasEstoque, obterEstatisticasOS, excluirItemEstoque, buscarEstoque,
  aplicarItemEstoqueSupabase, removerItemEstoqueSupabase,
  // Peças e Componentes
  criarPeca, atualizarPeca, listarPecas, obterPecaPorId, excluirPeca, buscarPecas,
  movimentarEstoquePeca, baixarEstoquePeca, obterEstatisticasPecas, obterEstatisticasDashboard,
  listarModelosCadastrados, registrarModeloManual, CATEGORIAS_PECA, TIPOS_ITEM_ESTOQUE,
  exportarBackupCompleto, importarBackup,
  extrairNumeroInteiro, formatarNumeroOS,
  CHECKLIST_PADRAO, STATUS_OS_VALIDOS, STATUS_OS_FECHADOS, STATUS_ESTOQUE_VALIDOS, PRIORIDADES_OS_VALIDAS,
  STATUS_PAGAMENTO_VALIDOS, STATUS_PAGAMENTO_MISTO, STATUS_APROVACAO_VALIDOS,
  ESTADOS_CONVERSA_APROVACAO_VALIDOS, CLASSIFICACAO_RESPOSTA_VALIDAS, ESTADO_CONVERSA_INICIAL,
  calcularAtraso,
  DEFAULT_CONFIG, migrarConfig, CONFIG_VERSAO_ATUAL,
  // Etapa 11.2 — Usuários
  listarUsuarios, criarUsuario, obterUsuarioPorLogin, obterUsuarioPorId, atualizarUsuario, excluirUsuario, registrarLogin,
  // Etapa 11.3 — Cargos e Permissões
  listarCargos, obterCargoPorId, criarCargo, atualizarCargo, excluirCargo, contarUsuariosComCargo,
  // Compra de Aparelhos
  criarCompra, atualizarCompra, listarCompras, obterCompraPorNumero, buscarCompras, excluirCompra,
  atualizarCaminhoPdfCompra, getPdfCompraDir,
  // Log de Estoque
  obterLogEstoque, exportarLogEstoqueCsv,
};

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: COMPRA DE APARELHOS (Módulo CP)
// ═══════════════════════════════════════════════════════════════
// Schema de cada contrato em database.json (array `compras`):
// {
//   numero: string,           // "CP-0001"
//   data: string (ISO),
//   vendedor: { nome, cpf, rg, dataNascimento, telefone, whatsapp, email, endereco, numero, bairro, cidade, estado, cep }
//   aparelho: { tipo, marca, modelo, cor, capacidade, imei1, imei2, numeroSerie,
//               estadoConservacao, acessorios:[], situacao:[], senha,
//               contaVinculada, emailConta, contaRemovida }
//   avaliacao: { descricaoGeral, defeitosInformados, defeitosEncontrados, observacoes }
//   dadosCompra: { valor, formaPagamento, chavePix, observacoes }
//   pdfPath: string
// }

function formatarNumeroCompra(n) { return 'CP-' + String(n).padStart(4, '0'); }

function salvarFotosCompra(numeroCompra, fotosRecebidas) {
  const database = loadDB();
  const compra = (database.compras || []).find(c => c.numero === numeroCompra);
  if (!compra) throw new Error(`Compra ${numeroCompra} não encontrada para salvar as fotos.`);

  compra.fotos = normalizarListaFotos(compra.fotos, 'compra');
  const idsExistentes = new Set(compra.fotos.map(f => String(f.supabaseArquivoId || '')).filter(Boolean));
  const hashesExistentes = new Set(compra.fotos.map(f => String(f.conteudoHash || '')).filter(Boolean));

  const vagas = Math.max(0, MAX_FOTOS_POR_DOCUMENTO - compra.fotos.length);
  for (const item of (Array.isArray(fotosRecebidas) ? fotosRecebidas.slice(0, vagas) : [])) {
    const base64 = typeof item === 'string' ? item : String(item?.base64 || '');
    if (!base64) continue;
    const supabaseArquivoId = typeof item === 'object' ? String(item.supabaseArquivoId || '') : '';
    const conteudo = base64.replace(/^data:[^;]+;base64,/, '');
    const conteudoHash = crypto.createHash('sha256').update(Buffer.from(conteudo, 'base64')).digest('hex');
    if ((supabaseArquivoId && idsExistentes.has(supabaseArquivoId)) || hashesExistentes.has(conteudoHash)) continue;

    try {
      const mime = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(base64)?.[1] || 'jpeg';
      const extensao = mime === 'jpeg' ? 'jpg' : mime.replace(/[^a-z0-9]/gi, '') || 'jpg';
      const salvo = uploadService.salvarArquivo({
        categoria: 'fotos',
        subpasta: `compra-${numeroCompra}`,
        base64Data: base64,
        nomeOriginal: `foto-compra.${extensao}`,
        grupo: 'imagem'
      });
      compra.fotos.push({
        id: gerarIdFoto(),
        path: salvo.path,
        nome: salvo.nome,
        data: new Date().toISOString(),
        supabaseArquivoId: supabaseArquivoId || null,
        conteudoHash
      });
      if (supabaseArquivoId) idsExistentes.add(supabaseArquivoId);
      hashesExistentes.add(conteudoHash);
    } catch (err) {
      console.warn(`[compra celular] Falha ao salvar foto da compra ${numeroCompra}: ${err.message}`);
    }
  }

  saveDB(database);
  return compra;
}

function criarCompra(dados) {
  // ALT-1: Validação de dados obrigatórios
  const nomeVendedor = (dados.vendedor?.nome || '').trim();
  if (!nomeVendedor) throw new Error('Nome do vendedor é obrigatório.');
  const marca = (dados.aparelho?.marca || '').trim();
  if (!marca) throw new Error('Marca do aparelho é obrigatória.');
  const modelo = (dados.aparelho?.modelo || '').trim();
  if (!modelo) throw new Error('Modelo do aparelho é obrigatório.');
  const valor = parseFloat(dados.dadosCompra?.valor);
  if (!valor || valor <= 0) throw new Error('Valor da compra deve ser maior que zero.');

  const database = loadDB();
  if (!database.proximoCompraId) database.proximoCompraId = 1;
  if (!database.compras) database.compras = [];
  const numero = formatarNumeroCompra(database.proximoCompraId);
  database.proximoCompraId += 1;
  const compra = {
    numero,
    data: new Date().toISOString(),
    vendedor: Object.assign({}, dados.vendedor || {}, {
      clienteId: obterOuCriarIdCliente(database, dados.vendedor?.nome, dados.vendedor?.cpf, dados.vendedor?.clienteId)
    }),
    aparelho: dados.aparelho || {},
    avaliacao: dados.avaliacao || {},
    dadosCompra: dados.dadosCompra || {},
    fotos: [],
    pdfPath: '',
    // Snapshot de termos por documento — mesma mecânica já usada em OS
    // (ver termosSnapshot em criarOS): se vazio, o template usa a config
    // geral do PC (termosCompra/usarTermosPredefinidosCompra), igual
    // sempre funcionou. Quando preenchido, tem prioridade máxima em
    // resolverTermosCompra — usado para importação do celular (ver
    // decisão abaixo, seção 'padrão de termos do usuário').
    termosCompra: dados.termosCompra !== undefined ? dados.termosCompra : '',
    // App Celular — lote v2: assinatura do vendedor coletada no celular
    // (schema aditivo — compras antigas continuam sem esse campo, sem quebrar).
    assinaturaVendedorBase64: dados.assinaturaVendedorBase64 || '',
    // Assinatura da assistência técnica vinda do celular (mesma regra de
    // 'fotografia do momento da exportação' descrita em criarOS acima).
    assinaturaAssistenciaBase64: dados.assinaturaAssistenciaBase64 || database.config.assinaturaAssistenciaBase64 || '',
    assinaturaPendente: dados.assinaturaPendente === true,
    naoAssinado: dados.naoAssinado === true,
    // ── Exportar para assinatura remota no celular ──
    // null até a primeira exportação (gerarPacoteParaAssinar grava aqui).
    idEnvioAssinatura: dados.idEnvioAssinatura || null,
    origem: dados.origem || 'pc',
    origemIdExportacao: dados.origemIdExportacao || null
  };
  database.compras = [compra, ...database.compras];
  saveDB(database);
  return Array.isArray(dados.fotos) && dados.fotos.length
    ? salvarFotosCompra(numero, dados.fotos)
    : compra;
}

function atualizarCompra(numero, dados) {
  const database = loadDB();
  if (!database.compras) database.compras = [];
  const idx = database.compras.findIndex(c => c.numero === numero);
  if (idx === -1) throw new Error(`Compra ${numero} não encontrada.`);
  const atual = database.compras[idx];
  database.compras[idx] = Object.assign({}, atual, {
    vendedor: Object.assign({}, dados.vendedor || atual.vendedor, {
      clienteId: obterOuCriarIdCliente(
        database,
        dados.vendedor?.nome ?? atual.vendedor?.nome,
        dados.vendedor?.cpf ?? atual.vendedor?.cpf,
        dados.vendedor?.clienteId ?? atual.vendedor?.clienteId
      )
    }),
    aparelho: dados.aparelho || atual.aparelho,
    avaliacao: dados.avaliacao || atual.avaliacao,
    dadosCompra: dados.dadosCompra || atual.dadosCompra,
    // BUGFIX (exportar para assinatura no celular): esta função fazia
    // whitelist estrita de 4 campos — qualquer outro campo do patch,
    // incluindo assinaturaVendedorBase64, era descartado silenciosamente
    // ao gravar. Isso quebrava a importação da resposta assinada vinda
    // do celular (a assinatura nunca chegava a ser salva). Mesma regra
    // de 'quando o campo é enviado, mesmo vazio, sobrescreve' já usada
    // em atualizarOS para assinaturaAssistenciaBase64.
    assinaturaVendedorBase64: dados.assinaturaVendedorBase64 !== undefined ? dados.assinaturaVendedorBase64 : (atual.assinaturaVendedorBase64 || ''),
    assinaturaAssistenciaBase64: dados.assinaturaAssistenciaBase64
      || atual.assinaturaAssistenciaBase64
      || database.config.assinaturaAssistenciaBase64
      || '',
    assinaturaPendente: dados.assinaturaPendente !== undefined ? dados.assinaturaPendente === true : atual.assinaturaPendente === true,
    naoAssinado: dados.naoAssinado !== undefined ? dados.naoAssinado === true : atual.naoAssinado === true,
    termosCompra: dados.termosCompra !== undefined ? dados.termosCompra : atual.termosCompra,
    // ── Exportar para assinatura remota no celular ──
    idEnvioAssinatura: dados.idEnvioAssinatura !== undefined ? dados.idEnvioAssinatura : (atual.idEnvioAssinatura || null)
  });
  const compraAtualizada = database.compras[idx];
  (database.estoque || []).forEach((item, indiceEstoque) => {
    if (normalizarNumeroCompraVinculada(item.numeroCompra) !== numero) return;
    database.estoque[indiceEstoque] = Object.assign({}, item, patchEstoqueDaCompra(compraAtualizada));
    registrarLogEstoque(database, 'atualizacao', database.estoque[indiceEstoque], {
      obs: `Sincronizado com ${numero}`
    });
  });
  saveDB(database);
  return Array.isArray(dados.fotos) && dados.fotos.length
    ? salvarFotosCompra(numero, dados.fotos)
    : database.compras[idx];
}

function listarCompras() {
  const database = loadDB();
  return (database.compras || []).slice().sort((a, b) => new Date(b.data) - new Date(a.data));
}

function obterCompraPorNumero(numero) {
  const database = loadDB();
  return (database.compras || []).find(c => c.numero === numero) || null;
}

function buscarCompras(filtros) {
  const database = loadDB();
  const lista = database.compras || [];
  if (!filtros || !filtros.termo) return lista.slice().sort((a, b) => new Date(b.data) - new Date(a.data));
  const t = filtros.termo.toLowerCase();
  return lista.filter(c => {
    const v = c.vendedor || {};
    const ap = c.aparelho || {};
    const campos = [
      c.numero,
      v.nome, v.cpf, v.rg, v.telefone, v.whatsapp,
      ap.tipo, ap.marca, ap.modelo, ap.cor, ap.imei1, ap.imei2, ap.serie
    ].filter(Boolean).join(' ').toLowerCase();
    return campos.includes(t);
  }).sort((a, b) => new Date(b.data) - new Date(a.data));
}

function excluirCompra(numero, usuario) {
  const database = loadDB();
  const idx = (database.compras || []).findIndex(c => c.numero === numero);
  if (idx === -1) throw new Error(`Compra ${numero} não encontrada.`);
  const removida = database.compras[idx];
  database.compras = database.compras.filter(c => c.numero !== numero);
  database.historicoExclusoes = [...(database.historicoExclusoes || []), {
    tipo: 'compra', identificador: numero,
    usuario: usuario || 'desconhecido', data: new Date().toISOString()
  }];
  saveDB(database);
  return removida;
}

function atualizarCaminhoPdfCompra(numero, pdfPath) {
  const database = loadDB();
  if (!database.compras) return;
  const idx = database.compras.findIndex(c => c.numero === numero);
  if (idx !== -1) { database.compras[idx].pdfPath = pdfPath; saveDB(database); }
}

function getPdfCompraDir() {
  const d = require('path').join(getRootDir(), 'PDFs-Compra');
  if (!require('fs').existsSync(d)) require('fs').mkdirSync(d, { recursive: true });
  return d;
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: ENTREGAS (App Celular — comprovante de retirada + garantia)
// ═══════════════════════════════════════════════════════════════
// Ver PROMPT-PC-aba-entregas.md. Schema de cada item em database.json
// (array `entregas`):
// {
//   numeroOS: string,          // chave de vínculo — SEM numeração própria
//                               // (ver decisão de arquitetura 1 do prompt)
//   nomeRetirou: string,
//   marca: string,             // opcional, pode vir vazio
//   modelo: string,            // opcional, pode vir vazio
//   reparoRealizado: string,   // opcional, pode vir vazio
//   declaracao: string,        // texto fixo vindo do celular
//   dataHoraAssinatura: string (ISO 8601),
//   garantiaDias: number,      // inteiro >= 0, sempre presente (pode ser 0)
//   dataLimiteGarantia: string (ISO 8601) | '',  // só relevante se garantiaDias>0,
//                               // JÁ vem calculada do celular — nunca recalculada aqui
//   assinaturaRetirouBase64: string,
//   pdfPath: string,
//   origemIdExportacao: string | null,  // dedupe do item específico (lote v2)
//   importadoEm: string (ISO 8601)
// }
//
// Decisões de arquitetura (não mudar sem reabrir a decisão — ver prompt):
// 1. Sem numeração própria — identificado/buscado só por numeroOS, exatamente
//    como veio do celular. Comparação EXATA após trim, SEM normalizar
//    maiúsculas/zeros à esquerda ("123" e "0123" são OS diferentes).
// 2. Um vale por OS — reimportar com o mesmo numeroOS SOBRESCREVE o
//    anterior (garantia incluída). Nunca duplicar.
// 3. Validação real acontece aqui: numeroOS precisa existir em db.ordens
//    (comparação exata, mesmo critério acima) para o comprovante ser
//    criado. OS inexistente = comprovante não criado (sem órfãos).
// 4. dataLimiteGarantia nunca é recalculada aqui — vem pronta do celular.

function _encontrarOSPorNumero(db, numeroOS) {
  const alvo = String(numeroOS || '').trim();
  const digitos = alvo.replace(/\D/g, '').replace(/^0+/, '') || '0';
  return (db.ordens || []).find((o) => {
    const numero = String(o.numero || '').trim();
    if (numero.toUpperCase() === alvo.toUpperCase()) return true;
    const numeroDigitos = numero.replace(/\D/g, '').replace(/^0+/, '') || '0';
    return !!alvo && numeroDigitos === digitos;
  }) || null;
}

function _numeroOSExisteExato(db, numeroOS) {
  return !!_encontrarOSPorNumero(db, numeroOS);
}

const STATUS_RETORNO_GARANTIA_VALIDOS = Object.freeze(['Em análise', 'Em reparo', 'Pronto para retirada', 'Entregue']);
const STATUS_OS_POR_RETORNO_GARANTIA = Object.freeze({
  'Em análise': 'Aguardando análise',
  'Em reparo': 'Em reparo',
  'Pronto para retirada': 'Pronto para retirada',
  'Entregue': 'Entregue'
});

function _criarOuAtualizarGarantiaNoBanco(database, dados) {
  if (!database.garantias) database.garantias = [];
  const numeroOSAlvo = String(dados.numeroOS || '').trim();
  if (!numeroOSAlvo) throw new Error('Número da OS é obrigatório.');

  const numeroInteiroAlvo = extrairNumeroInteiro(numeroOSAlvo);
  const idxExistente = database.garantias.findIndex((item) => {
    const numeroAtual = String(item.numeroOS || '').trim();
    return numeroAtual === numeroOSAlvo || (
      Number.isFinite(numeroInteiroAlvo) && extrairNumeroInteiro(numeroAtual) === numeroInteiroAlvo
    );
  });
  const anterior = idxExistente !== -1 ? database.garantias[idxExistente] : {};
  const agora = new Date().toISOString();
  const dataInicio = dados.dataInicio || anterior.dataInicio || agora;
  const garantiaDias = Number(dados.garantiaDias ?? anterior.garantiaDias ?? 0);
  if (!Number.isInteger(garantiaDias) || garantiaDias < 0 || garantiaDias > 36500) throw new Error('Informe a garantia em dias, entre 0 e 36500.');
  if (!Number.isFinite(Date.parse(dataInicio))) throw new Error('Informe uma data inicial válida para a garantia.');
  const ordem = _encontrarOSPorNumero(database, numeroOSAlvo);

  const garantia = {
    ...anterior,
    numeroOS: ordem?.numero || numeroOSAlvo,
    clienteId: dados.clienteId ?? anterior.clienteId ?? ordem?.cliente?.clienteId ?? null,
    clienteNumero: dados.clienteNumero ?? anterior.clienteNumero ?? ordem?.cliente?.clienteId ?? '00000',
    supabaseId: dados.supabaseId || anterior.supabaseId || '',
    supabaseRevision: dados.supabaseRevision || anterior.supabaseRevision || 0,
    clienteNome: dados.clienteNome ?? anterior.clienteNome ?? ordem?.cliente?.nome ?? '',
    clienteTelefone: dados.clienteTelefone ?? anterior.clienteTelefone ?? ordem?.cliente?.telefone ?? '',
    clienteCpf: dados.clienteCpf ?? anterior.clienteCpf ?? ordem?.cliente?.cpf ?? '',
    marca: dados.marca ?? anterior.marca ?? ordem?.aparelho?.marca ?? '',
    modelo: dados.modelo ?? anterior.modelo ?? ordem?.aparelho?.modelo ?? '',
    imei: dados.imei ?? anterior.imei ?? ordem?.aparelho?.imei ?? '',
    servicoRealizado: dados.servicoRealizado ?? anterior.servicoRealizado ?? '',
    garantiaDias,
    dataInicio,
    dataLimite: garantiaDias > 0 ? _addDiasGarantia(dataInicio, garantiaDias) : '',
    termos: dados.termos ?? anterior.termos ?? (database.config?.usarTermosPredefinidosGarantia !== false ? require('../termos-predefinidos').TERMOS_GARANTIA : database.config?.termosGarantia || ''),
    pdfPath: '',
    criadoEm: anterior.criadoEm || agora,
    atualizadoEm: agora,
    origem: dados.origem || anterior.origem || 'manual',
    retornosGarantia: Array.isArray(dados.retornosGarantia)
      ? dados.retornosGarantia
      : (Array.isArray(anterior.retornosGarantia) ? anterior.retornosGarantia : []),
    retornoAtualId: dados.retornoAtualId ?? anterior.retornoAtualId ?? null,
    statusRetorno: dados.statusRetorno ?? anterior.statusRetorno ?? ''
  };

  if (idxExistente !== -1) database.garantias[idxExistente] = garantia;
  else database.garantias = [garantia, ...database.garantias];
  return garantia;
}

const CICLO_ENTREGA_ORIGINAL = 'original';

function _mesmaOSEntrega(numeroA, numeroB) {
  const a = String(numeroA || '').trim();
  const b = String(numeroB || '').trim();
  if (a === b) return true;
  const inteiroA = extrairNumeroInteiro(a);
  const inteiroB = extrairNumeroInteiro(b);
  return Number.isFinite(inteiroA) && Number.isFinite(inteiroB) && inteiroA === inteiroB;
}

function _normalizarCicloEntrega(valor, retornoGarantiaId) {
  return String(valor || retornoGarantiaId || CICLO_ENTREGA_ORIGINAL).trim() || CICLO_ENTREGA_ORIGINAL;
}

function _cicloDaEntrega(registro) {
  return _normalizarCicloEntrega(registro?.cicloEntregaId, registro?.retornoGarantiaId);
}

// Completa comprovantes antigos com o prazo canônico já registrado na OS.
// Em um retorno, o início e o vencimento continuam sendo os da garantia
// original; preparar outra retirada nunca reinicia o prazo.
function _entregaComGarantiaDaOS(database, registro) {
  if (!registro) return null;
  const prazoProprio = Number(registro.garantiaDias) || 0;
  if (prazoProprio > 0) return { ...registro };

  const garantia = _garantiaMutavel(database, registro.numeroOS);
  const ordem = _encontrarOSPorNumero(database, registro.numeroOS);
  const dias = Number(garantia?.garantiaDias) || Number(ordem?.garantiaDias) || 0;
  if (dias <= 0) return { ...registro };

  const dataInicio = garantia?.dataInicio
    || registro.garantiaDataInicio
    || registro.dataHoraAssinatura
    || new Date().toISOString();
  return {
    ...registro,
    garantiaDias: dias,
    garantiaDataInicio: dataInicio,
    dataLimiteGarantia: garantia?.dataLimite || _addDiasGarantia(dataInicio, dias),
    garantiaHerdadaDaOS: true
  };
}

function _compararEntregasRecentes(a, b) {
  return Date.parse(b?.atualizadoEm || b?.dataHoraAssinatura || b?.criadoEm || 0)
    - Date.parse(a?.atualizadoEm || a?.dataHoraAssinatura || a?.criadoEm || 0);
}

function _encontrarEntregaNoBanco(database, numeroOS, cicloEntregaId) {
  const candidatas = (database.entregas || [])
    .filter(item => _mesmaOSEntrega(item.numeroOS, numeroOS))
    .sort(_compararEntregasRecentes);
  if (cicloEntregaId !== undefined && cicloEntregaId !== null && String(cicloEntregaId).trim()) {
    const ciclo = _normalizarCicloEntrega(cicloEntregaId);
    return candidatas.find(item => _cicloDaEntrega(item) === ciclo) || null;
  }
  return candidatas[0] || null;
}

function _finalizarRetornoGarantiaPelaEntrega(database, entrega) {
  const conclusaoComprovada = Boolean(entrega?.assinaturaRetirouBase64) || entrega?.naoAssinado === true;
  if (!entrega?.retornoGarantiaId || entrega.assinaturaPendente === true || entrega.validaParaConclusao === false || !conclusaoComprovada) return null;
  const garantia = _garantiaMutavel(database, entrega.numeroOS);
  const retorno = garantia?.retornosGarantia?.find(item => item.id === entrega.retornoGarantiaId);
  if (!garantia || !retorno) return null;
  const agora = new Date().toISOString();
  if (retorno.status !== 'Entregue') {
    retorno.historico = [...(retorno.historico || []), {
      status: 'Entregue',
      em: agora,
      observacao: entrega.naoAssinado === true
        ? 'Nova entrega do retorno registrada sem assinatura.'
        : 'Nova entrega do retorno assinada e concluída.',
      usuario: { id: 'sistema', nome: 'Sistema OS' }
    }];
  }
  retorno.status = 'Entregue';
  retorno.atualizadoEm = agora;
  retorno.encerradoEm = retorno.encerradoEm || agora;
  retorno.entregaDocumentoId = entrega.documentoEntregaId;
  retorno.cicloEntregaId = entrega.cicloEntregaId;
  garantia.retornoAtualId = retorno.id;
  garantia.statusRetorno = 'Entregue';
  garantia.atualizadoEm = agora;
  return _atualizarOsPeloRetornoGarantia(
    database,
    garantia,
    retorno,
    { id: 'sistema', nome: 'Sistema OS' },
    'Retorno concluído com um novo comprovante de entrega.'
  );
}

// Cada OS possui uma entrega original e pode possuir uma nova entrega para
// cada retorno em garantia. A chave de negócio é numeroOS + cicloEntregaId;
// regravar um ciclo corrige somente aquele documento e nunca destrói os PDFs
// e assinaturas dos ciclos anteriores.
function criarOuSubstituirEntrega(dados) {
  const database = loadDB();
  if (!database.entregas) database.entregas = [];
  const numeroOSAlvo = String(dados.numeroOS || '').trim();
  if (!numeroOSAlvo) throw new Error('Número da OS é obrigatório.');
  const ordem = _encontrarOSPorNumero(database, numeroOSAlvo);
  const cicloEntregaId = _normalizarCicloEntrega(dados.cicloEntregaId, dados.retornoGarantiaId);
  const retornoGarantiaId = cicloEntregaId === CICLO_ENTREGA_ORIGINAL
    ? null
    : String(dados.retornoGarantiaId || cicloEntregaId).trim();
  const idxExistente = database.entregas.findIndex(en =>
    _mesmaOSEntrega(en.numeroOS, numeroOSAlvo) && _cicloDaEntrega(en) === cicloEntregaId
  );
  const substituiu = idxExistente !== -1;
  const anterior = substituiu ? database.entregas[idxExistente] : {};
  const garantiaAnteriorOS = ordem && _garantiaMutavel(database, ordem.numero);
  const prazoFoiInformado = dados.garantiaDias !== undefined
    && dados.garantiaDias !== null
    && String(dados.garantiaDias).trim() !== '';
  const prazoPadraoConfig = Math.max(0, parseInt(String(database.config?.garantiaPadrao || '90'), 10) || 90);
  const prazoHerdado = Number(anterior.garantiaDias) > 0
    ? Number(anterior.garantiaDias)
    : (Number(garantiaAnteriorOS?.garantiaDias) || Number(ordem?.garantiaDias) || prazoPadraoConfig);
  const garantiaDiasValidos = Number(prazoFoiInformado ? dados.garantiaDias : prazoHerdado);
  if (!Number.isInteger(garantiaDiasValidos) || garantiaDiasValidos < 0 || garantiaDiasValidos > 36500) throw new Error('Informe a garantia em dias, entre 0 e 36500.');
  const dataEntrega = dados.dataHoraAssinatura || anterior.dataHoraAssinatura || new Date().toISOString();
  const garantiaDataInicio = dados.garantiaDataInicio
    || (garantiaAnteriorOS?.garantiaDias > 0 ? garantiaAnteriorOS.dataInicio : '')
    || anterior.garantiaDataInicio
    || dataEntrega;
  if (!Number.isFinite(Date.parse(dataEntrega)) || !Number.isFinite(Date.parse(garantiaDataInicio))) throw new Error('Informe uma data válida para a entrega e a garantia.');
  const assinaturaFoiInformada = Object.prototype.hasOwnProperty.call(dados || {}, 'assinaturaRetirouBase64');
  const assinaturaRetirouBase64 = assinaturaFoiInformada
    ? (dados.assinaturaRetirouBase64 || '')
    : (anterior.assinaturaRetirouBase64 || '');
  const assinaturaPendente = assinaturaRetirouBase64
    ? false
    : (dados.assinaturaPendente !== undefined
      ? dados.assinaturaPendente === true
      : anterior.assinaturaPendente === true);
  const naoAssinado = assinaturaRetirouBase64
    ? false
    : (dados.naoAssinado !== undefined
      ? dados.naoAssinado === true
      : !assinaturaPendente);

  const entrega = {
    ...anterior,
    documentoEntregaId: dados.documentoEntregaId || anterior.documentoEntregaId
      || (cicloEntregaId === CICLO_ENTREGA_ORIGINAL ? `ENTREGA-${ordem?.numero || numeroOSAlvo}-ORIGINAL` : `ENTREGA-${ordem?.numero || numeroOSAlvo}-${cicloEntregaId}`),
    cicloEntregaId,
    tipoEntrega: retornoGarantiaId ? 'retorno_garantia' : 'original',
    retornoGarantiaId,
    garantiaId: dados.garantiaId || anterior.garantiaId || null,
    supabaseId: dados.supabaseId || anterior.supabaseId || null,
    supabaseRevision: Number(dados.supabaseRevision || anterior.supabaseRevision || 0),
    idEnvioAssinatura: dados.idEnvioAssinatura || anterior.idEnvioAssinatura || null,
    numeroOS: ordem?.numero || numeroOSAlvo,
    clienteId: dados.clienteId ?? anterior.clienteId ?? ordem?.cliente?.clienteId ?? null,
    clienteNumero: dados.clienteNumero ?? anterior.clienteNumero ?? ordem?.cliente?.clienteId ?? '00000',
    nomeRetirou: dados.nomeRetirou ?? anterior.nomeRetirou ?? '',
    cpfRetirou: dados.cpfRetirou ?? anterior.cpfRetirou ?? '',
    telefoneRetirou: dados.telefoneRetirou ?? anterior.telefoneRetirou ?? '',
    marca: dados.marca ?? anterior.marca ?? '',
    modelo: dados.modelo ?? anterior.modelo ?? '',
    reparoRealizado: dados.reparoRealizado ?? anterior.reparoRealizado ?? '',
    valorReparo: Number(dados.valorReparo ?? anterior.valorReparo) || 0,
    formaPagamento: dados.formaPagamento ?? anterior.formaPagamento ?? '',
    declaracao: dados.declaracao ?? anterior.declaracao ?? '',
    dataHoraAssinatura: dataEntrega,
    garantiaDataInicio,
    termosGarantia: dados.termosGarantia ?? anterior.termosGarantia,
    // Sempre presente, pode ser 0 (== "sem garantia definida", não é erro).
    garantiaDias: garantiaDiasValidos,
    // Só relevante quando garantiaDias > 0; comprovante antigo (antes deste
    // campo existir) ou garantiaDias:0 → tratado como '' (sem data limite).
    dataLimiteGarantia: garantiaDiasValidos > 0
      ? (garantiaAnteriorOS?.garantiaDias > 0
        && Number(garantiaAnteriorOS.garantiaDias) === garantiaDiasValidos
        && garantiaAnteriorOS.dataLimite
          ? garantiaAnteriorOS.dataLimite
          : _addDiasGarantia(garantiaDataInicio, garantiaDiasValidos))
      : '',
    // Vazio também é um valor intencional: ao substituir um comprovante
    // assinado por outro marcado como "Não assinado", a assinatura antiga
    // não pode reaparecer. Os dois estados ficam persistidos para a lista do
    // PC explicar claramente por que o campo está vazio.
    assinaturaRetirouBase64,
    assinaturaPendente,
    naoAssinado,
    validaParaConclusao: assinaturaPendente !== true && (Boolean(assinaturaRetirouBase64) || naoAssinado === true),
    reabertoEm: '',
    pdfPath: '',
    origemIdExportacao: dados.origemIdExportacao || anterior.origemIdExportacao || null,
    importadoEm: anterior.importadoEm || new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };

  if (substituiu) {
    database.entregas[idxExistente] = entrega;
  } else {
    database.entregas = [entrega, ...database.entregas];
  }

  // Uma solicitação que ainda aguarda assinatura não é uma entrega física
  // concluída. O status muda somente quando há assinatura ou quando o usuário
  // confirma explicitamente "Não assinado".
  if (ordem && entrega.validaParaConclusao === true && ordem.status !== 'Entregue' && ordem.status !== 'Cancelado') {
    const agora = new Date().toISOString();
    ordem.status = 'Entregue';
    ordem.dataConclusao = ordem.dataConclusao || entrega.dataHoraAssinatura || agora;
    ordem.historicoStatus = [...(ordem.historicoStatus || []), { status: 'Entregue', data: agora }];
    ordem.updatedAt = agora;
  }
  const ordemRetorno = _finalizarRetornoGarantiaPelaEntrega(database, entrega);
  const garantiaAnterior = garantiaAnteriorOS;
  const mudouPrazo = substituiu && (Number(anterior.garantiaDias) !== entrega.garantiaDias || String(anterior.garantiaDataInicio || anterior.dataHoraAssinatura).slice(0, 10) !== String(entrega.garantiaDataInicio).slice(0, 10));
  const preservarGarantiaManual = garantiaAnterior?.origem === 'manual' && !mudouPrazo;
  const garantia = retornoGarantiaId ? garantiaAnterior : preservarGarantiaManual ? garantiaAnterior : ordem && entrega.garantiaDias > 0
    ? _criarOuAtualizarGarantiaNoBanco(database, {
      numeroOS: ordem.numero,
      clienteNome: ordem.cliente?.nome || entrega.nomeRetirou,
      clienteTelefone: ordem.cliente?.telefone || entrega.telefoneRetirou,
      clienteCpf: ordem.cliente?.cpf || entrega.cpfRetirou,
      marca: entrega.marca || ordem.aparelho?.marca,
      modelo: entrega.modelo || ordem.aparelho?.modelo,
      imei: ordem.imei || ordem.aparelho?.imei || '',
      servicoRealizado: entrega.reparoRealizado,
      garantiaDias: entrega.garantiaDias,
      dataInicio: entrega.garantiaDataInicio,
      termos: entrega.termosGarantia,
      origem: 'entrega'
    })
    : null;
  if (ordem && !retornoGarantiaId && entrega.garantiaDias === 0) {
    const existente = (database.garantias || []).find(g => g.numeroOS === ordem.numero && (g.origem === 'entrega' || mudouPrazo));
    if (existente) Object.assign(existente, { garantiaDias: 0, dataLimite: '', pdfPath: '', atualizadoEm: new Date().toISOString() });
  }
  saveDB(database);

  // Fotos de "como saiu" (dados.fotos, até 10, { base64 }), vindas do lote
  // do celular — reaproveita a MESMA galeria de fotos de OS (salvarFotoOS),
  // vinculando pelo numeroOS, categoria 'entrega' (já existe em
  // CATEGORIAS_FOTO_OS). Não fica no registro de entrega em si: quem quiser
  // ver as fotos de entrega de uma OS consulta os.fotos filtrando por
  // categoria, igual já se faz para 'defeito'/'entrada'/'reparo'. Roda
  // depois do saveDB acima, fora do objeto `entrega` (que não tem campo de
  // foto — decisão: reaproveitar a galeria existente em vez de duplicar
  // armazenamento de foto em dois lugares).
  if (Array.isArray(dados.fotos) && dados.fotos.length) {
    salvarFotosLoteOS(numeroOSAlvo, dados.fotos, 'entrega');
  }

  return { entrega, garantia, substituiu, ordem: ordemRetorno || ordem };
}

function editarEntrega(numeroOS, alteracoes, cicloEntregaId) {
  const ciclo = cicloEntregaId || alteracoes?.cicloEntregaId;
  const anterior = obterEntregaPorNumeroOS(numeroOS, ciclo);
  if (!anterior) throw new Error('Entrega não encontrada.');
  const campos = ['nomeRetirou', 'cpfRetirou', 'telefoneRetirou', 'marca', 'modelo', 'reparoRealizado', 'valorReparo', 'formaPagamento', 'declaracao', 'dataHoraAssinatura', 'garantiaDias', 'garantiaDataInicio', 'termosGarantia'];
  const patch = Object.fromEntries(campos.filter(c => Object.hasOwn(alteracoes || {}, c)).map(c => [c, alteracoes[c]]));
  if (!String(patch.nomeRetirou ?? anterior.nomeRetirou ?? '').trim()) throw new Error('Informe o nome de quem retirou.');
  const valor = Number(patch.valorReparo ?? anterior.valorReparo ?? 0);
  if (!Number.isFinite(valor) || valor < 0) throw new Error('Informe um valor do reparo válido.');
  const alterado = campos.some(c => Object.hasOwn(patch, c) && String(patch[c] ?? '') !== String(anterior[c] ?? ''));
  const estado = alteracoes?.estadoAssinatura;
  if (anterior.assinaturaRetirouBase64 && (alterado || estado === 'nao_assinado' || estado === 'pendente') && !alteracoes?.confirmarNovaAssinatura) {
    throw new Error('Ao editar um documento assinado, confirme a necessidade de uma nova assinatura.');
  }
  const assinatura = (alterado || estado === 'nao_assinado' || estado === 'pendente') ? '' : anterior.assinaturaRetirouBase64 || '';
  const pendente = !assinatura && estado !== 'nao_assinado' && (estado === 'pendente' || anterior.assinaturaPendente === true || Boolean(anterior.assinaturaRetirouBase64 && alterado));
  return criarOuSubstituirEntrega({ ...anterior, ...patch, numeroOS: anterior.numeroOS,
    assinaturaRetirouBase64: assinatura,
    assinaturaPendente: pendente,
    naoAssinado: !assinatura && !pendente
  });
}

function listarEntregas() {
  const database = loadDB();
  return (database.entregas || []).slice()
    .map(item => _entregaComGarantiaDaOS(database, {
      ...item,
      cicloEntregaId: _cicloDaEntrega(item),
      tipoEntrega: item.tipoEntrega || (_cicloDaEntrega(item) === CICLO_ENTREGA_ORIGINAL ? 'original' : 'retorno_garantia')
    }))
    .sort(_compararEntregasRecentes);
}

function listarEntregasPorNumeroOS(numeroOS) {
  return listarEntregas().filter(item => _mesmaOSEntrega(item.numeroOS, numeroOS));
}

// Comparação EXATA após trim, sem normalização — mesma regra usada na
// validação de importação (ver decisão de arquitetura 1).
function obterEntregaPorNumeroOS(numeroOS, cicloEntregaId) {
  const database = loadDB();
  const encontrada = _encontrarEntregaNoBanco(database, numeroOS, cicloEntregaId);
  return encontrada
    ? _entregaComGarantiaDaOS(database, { ...encontrada, cicloEntregaId: _cicloDaEntrega(encontrada) })
    : null;
}

function atualizarCaminhoPdfEntrega(numeroOS, pdfPath, cicloEntregaId) {
  const database = loadDB();
  if (!database.entregas) return;
  const alvo = _encontrarEntregaNoBanco(database, numeroOS, cicloEntregaId);
  const idx = alvo ? database.entregas.indexOf(alvo) : -1;
  if (idx !== -1) { database.entregas[idx].pdfPath = pdfPath; saveDB(database); }
}

function getPdfEntregaDir() {
  const d = require('path').join(getRootDir(), 'PDFs-Entrega');
  if (!require('fs').existsSync(d)) require('fs').mkdirSync(d, { recursive: true });
  return d;
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: ENTREGAS PENDENTES (Bloco 3 — Nova Entrega criada no PC)
// ═══════════════════════════════════════════════════════════════
// Diferente de `entregas` (só chega pronta/assinada via lote do celular)
// e de `garantias` (documento próprio sem assinatura remota), este bloco
// cria uma Entrega DIRETO no PC a partir de uma OS existente, manda para
// assinatura remota no celular (mesmo padrão de OS/Compra/Venda — ver
// CAMPO_ASSINATURA_POR_TIPO_DOCUMENTO acima), e só vira um registro real
// em `entregas` quando a assinatura volta.
//
// Pipeline PARALELO ao de OS/Compra/Venda, não misturado nele:
// gerarPacoteParaAssinar/importarRespostaAssinatura (acima) gravam a
// assinatura de volta no MESMO registro em db.ordens/db.compras/db.estoque,
// localizado por idEnvioAssinatura — não fazem sentido para 'entrega', que
// não é um registro nessas coleções e não tem esse campo. As funções
// abaixo espelham o MESMO padrão de pacote/resposta (mesmo tipoArquivo,
// mesmo formato de identificador) para reaproveitar o app celular sem
// alteração nenhuma (documentos-recebidos.js já trata tipoDocumento
// 'entrega' de ponta a ponta — template, campo de assinatura,
// exportação de resposta — ver ROTULO_TIPO/campoAssinaturaPorTipo lá).
//
// Schema de cada item em database.json (array `entregasPendentes`):
// {
//   idEnvioAssinatura: string,   // 'entrega-<numeroOS>', igual ao padrão
//                                  // dos outros tipos (gerarIdEnvioAssinatura)
//   numeroOS, nomeRetirou, marca, modelo, reparoRealizado, declaracao,
//   garantiaDias, dataLimiteGarantia, fotos: [{id,categoria,path,nome,base64?}],
//   criadoEm: string (ISO)
// }
// Uma pendente por OS — criar de novo para o mesmo número SOBRESCREVE a
// anterior (mesmo padrão de `entregas`/`garantias`).

function obterEntregaPendentePorNumeroOS(numeroOS, cicloEntregaId) {
  const database = loadDB();
  const candidatas = (database.entregasPendentes || [])
    .filter(item => _mesmaOSEntrega(item.numeroOS, numeroOS))
    .sort(_compararEntregasRecentes);
  if (cicloEntregaId !== undefined && cicloEntregaId !== null && String(cicloEntregaId).trim()) {
    const ciclo = _normalizarCicloEntrega(cicloEntregaId);
    return candidatas.find(item => _cicloDaEntrega(item) === ciclo) || null;
  }
  return candidatas[0] || null;
}

function obterEntregaPendentePorIdEnvio(idEnvioAssinatura) {
  const database = loadDB();
  return (database.entregasPendentes || []).find(e => e.idEnvioAssinatura === idEnvioAssinatura) || null;
}

function removerEntregaPendente(numeroOS, cicloEntregaId) {
  const database = loadDB();
  if (!database.entregasPendentes) return;
  const ciclo = cicloEntregaId ? _normalizarCicloEntrega(cicloEntregaId) : _cicloDaEntrega(obterEntregaPendentePorNumeroOS(numeroOS));
  database.entregasPendentes = database.entregasPendentes.filter(e =>
    !(_mesmaOSEntrega(e.numeroOS, numeroOS) && _cicloDaEntrega(e) === ciclo)
  );
  saveDB(database);
}

// Cria (ou substitui, se já existir uma pendente para a mesma OS) o
// registro de Nova Entrega a partir de uma OS já existente. Puxa
// cliente/aparelho da própria OS (nomeRetirou default = nome do cliente,
// editável pelo usuário antes de enviar) e as fotos já anexadas na OS na
// categoria 'entrega' (ver CATEGORIAS_FOTO_OS). Quando a OS já possui
// garantia, o prazo é herdado automaticamente; o usuário ainda pode ajustar
// o campo antes de enviar.
function criarEntregaPendente(numeroOS, dadosEntrada) {
  const database = loadDB();
  const os = (database.ordens || []).find(o => String(o.numero || '').trim() === String(numeroOS || '').trim());
  if (!os) throw new Error(`OS ${numeroOS} não encontrada.`);

  const dados = dadosEntrada || {};
  const garantiaExistente = _garantiaMutavel(database, os.numero);
  const prazoFoiInformado = dados.garantiaDias !== undefined
    && dados.garantiaDias !== null
    && String(dados.garantiaDias).trim() !== '';
  const prazoPadraoConfig = Math.max(0, parseInt(String(database.config?.garantiaPadrao || '90'), 10) || 90);
  const garantiaDias = Number(prazoFoiInformado
    ? dados.garantiaDias
    : (garantiaExistente?.garantiaDias || os.garantiaDias || prazoPadraoConfig)) || 0;
  if (!Number.isInteger(garantiaDias) || garantiaDias < 0 || garantiaDias > 36500) throw new Error('Informe a garantia em dias, entre 0 e 36500.');
  const agora = new Date().toISOString();
  const retornoGarantiaId = String(
    dados.retornoGarantiaId ||
    (os.retornoGarantiaAtivo !== false ? os.retornoGarantiaId : '') ||
    ''
  ).trim() || null;
  const cicloEntregaId = _normalizarCicloEntrega(dados.cicloEntregaId, retornoGarantiaId);

  if (!database.entregasPendentes) database.entregasPendentes = [];
  const idxExistente = database.entregasPendentes.findIndex(e =>
    _mesmaOSEntrega(e.numeroOS, numeroOS) && _cicloDaEntrega(e) === cicloEntregaId
  );

  const fotosEntrega = (os.fotos || []).filter(f => f.categoria === 'entrega');

  const entradaPendente = {
    documentoEntregaId: dados.documentoEntregaId || (idxExistente !== -1 ? database.entregasPendentes[idxExistente].documentoEntregaId : null)
      || (cicloEntregaId === CICLO_ENTREGA_ORIGINAL ? `ENTREGA-${os.numero}-ORIGINAL` : `ENTREGA-${os.numero}-${cicloEntregaId}`),
    cicloEntregaId,
    tipoEntrega: retornoGarantiaId ? 'retorno_garantia' : 'original',
    retornoGarantiaId,
    garantiaId: dados.garantiaId || null,
    idEnvioAssinatura: idxExistente !== -1
      ? database.entregasPendentes[idxExistente].idEnvioAssinatura
      : gerarIdEnvioAssinatura('entrega', `${os.numero}-${cicloEntregaId}`),
    numeroOS: os.numero,
    nomeRetirou: dados.nomeRetirou !== undefined ? dados.nomeRetirou : (os.cliente?.nome || ''),
    cpfRetirou: dados.cpfRetirou !== undefined ? dados.cpfRetirou : (os.cliente?.cpf || ''),
    telefoneRetirou: dados.telefoneRetirou !== undefined ? dados.telefoneRetirou : (os.cliente?.telefone || ''),
    marca: dados.marca !== undefined ? dados.marca : (os.aparelho?.marca || ''),
    modelo: dados.modelo !== undefined ? dados.modelo : (os.aparelho?.modelo || ''),
    reparoRealizado: dados.reparoRealizado !== undefined
      ? dados.reparoRealizado
      : (os.diagnosticoTecnico?.solucao || os.servicoRealizado || os.observacoesSaida || ''),
    valorReparo: dados.valorReparo !== undefined
      ? (Number(dados.valorReparo) || 0)
      : (Number(os.valorTotalServico || os.diagnosticoTecnico?.valorEstimado) || 0),
    formaPagamento: dados.formaPagamento !== undefined
      ? dados.formaPagamento
      : (os.formaPagamento || os.pagamentoForma || ''),
    declaracao: require('../termos-predefinidos').DECLARACAO_ENTREGA,
    garantiaDias,
    dataHoraAssinatura: dados.dataHoraAssinatura || agora,
    garantiaDataInicio: dados.garantiaDataInicio
      || (garantiaExistente?.garantiaDias > 0 ? garantiaExistente.dataInicio : '')
      || dados.dataHoraAssinatura
      || agora,
    termosGarantia: dados.termosGarantia ?? garantiaExistente?.termos,
    dataLimiteGarantia: garantiaDias > 0
      ? (garantiaExistente?.garantiaDias > 0
        && Number(garantiaExistente.garantiaDias) === garantiaDias
        && garantiaExistente.dataLimite
          ? garantiaExistente.dataLimite
          : _addDiasGarantia(dados.garantiaDataInicio || dados.dataHoraAssinatura || agora, garantiaDias))
      : '',
    fotos: fotosEntrega,
    criadoEm: idxExistente !== -1 ? database.entregasPendentes[idxExistente].criadoEm : agora
  };

  if (idxExistente !== -1) {
    database.entregasPendentes[idxExistente] = entradaPendente;
  } else {
    database.entregasPendentes = [entradaPendente, ...database.entregasPendentes];
  }
  saveDB(database);
  return entradaPendente;
}

// Cria o comprovante definitivo diretamente no PC, sem passar pela fila de
// assinatura remota. A montagem dos dados continua centralizada no mesmo
// fluxo da entrega pendente para os dois modos nunca divergirem.
function criarEntregaNaoAssinada(numeroOS, dadosEntrada) {
  const pendente = criarEntregaPendente(numeroOS, dadosEntrada);
  const resultado = criarOuSubstituirEntrega({
    numeroOS: pendente.numeroOS,
    documentoEntregaId: pendente.documentoEntregaId,
    cicloEntregaId: pendente.cicloEntregaId,
    tipoEntrega: pendente.tipoEntrega,
    retornoGarantiaId: pendente.retornoGarantiaId,
    garantiaId: pendente.garantiaId,
    idEnvioAssinatura: pendente.idEnvioAssinatura,
    nomeRetirou: pendente.nomeRetirou,
    cpfRetirou: pendente.cpfRetirou,
    telefoneRetirou: pendente.telefoneRetirou,
    marca: pendente.marca,
    modelo: pendente.modelo,
    reparoRealizado: pendente.reparoRealizado,
    valorReparo: pendente.valorReparo,
    formaPagamento: pendente.formaPagamento,
    declaracao: pendente.declaracao,
    dataHoraAssinatura: pendente.dataHoraAssinatura,
    garantiaDataInicio: pendente.garantiaDataInicio,
    termosGarantia: pendente.termosGarantia,
    garantiaDias: pendente.garantiaDias,
    dataLimiteGarantia: pendente.dataLimiteGarantia,
    assinaturaRetirouBase64: '',
    assinaturaPendente: false,
    naoAssinado: true,
    fotos: []
  });
  removerEntregaPendente(pendente.numeroOS, pendente.cicloEntregaId);
  return resultado;
}

function listarEntregasPendentes() {
  const database = loadDB();
  return (database.entregasPendentes || []).slice()
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
}

function excluirEntregaPendente(numeroOS, cicloEntregaId) {
  const database = loadDB();
  if (!database.entregasPendentes) return false;
  const alvo = obterEntregaPendentePorNumeroOS(numeroOS, cicloEntregaId);
  if (!alvo) return false;
  const antes = database.entregasPendentes.length;
  database.entregasPendentes = database.entregasPendentes.filter(e =>
    !(_mesmaOSEntrega(e.numeroOS, alvo.numeroOS) && _cicloDaEntrega(e) === _cicloDaEntrega(alvo))
  );
  saveDB(database);
  return database.entregasPendentes.length < antes;
}

// Exclui uma entrega já confirmada (importada do celular) por numeroOS.
function excluirEntrega(numeroOS, cicloEntregaId) {
  const database = loadDB();
  if (!database.entregas) return { sucesso: false, erro: 'Nenhuma entrega encontrada.' };
  const alvo = _encontrarEntregaNoBanco(database, numeroOS, cicloEntregaId);
  if (!alvo) return { sucesso: false, erro: 'Nenhuma entrega encontrada para esta OS.' };
  const antes = database.entregas.length;
  database.entregas = database.entregas.filter(e =>
    !(_mesmaOSEntrega(e.numeroOS, alvo.numeroOS) && _cicloDaEntrega(e) === _cicloDaEntrega(alvo))
  );
  if (database.entregas.length === antes) {
    return { sucesso: false, erro: 'Nenhuma entrega encontrada para esta OS.' };
  }
  saveDB(database);
  return { sucesso: true, excluidas: antes - database.entregas.length };
}

// Monta o pacote de envio (PC -> celular) para uma entrega pendente, no
// MESMO formato ({ tipoArquivo, idEnvioAssinatura, tipoDocumento, identificador,
// dados }) que gerarPacoteParaAssinar já produz para os/compra/venda —
// documentos-recebidos.js (celular) não distingue a origem, só o
// tipoDocumento dentro do pacote. Lê fotos do disco e injeta base64, mesmo
// princípio de _resolverFotosParaBase64 acima (reaproveitado aqui).
function gerarPacoteEntregaParaAssinar(numeroOS, cicloEntregaId) {
  const pendente = obterEntregaPendentePorNumeroOS(numeroOS, cicloEntregaId);
  if (!pendente) throw new Error(`Nenhuma entrega pendente encontrada para a OS ${numeroOS}.`);
  const pendenteComFotos = _resolverFotosParaBase64(pendente);
  return {
    tipoArquivo: 'sistema-os-pc-para-assinar',
    idEnvioAssinatura: pendente.idEnvioAssinatura,
    tipoDocumento: 'entrega',
    identificador: { numero: pendente.numeroOS, nomeOutraParte: pendente.nomeRetirou || '', aparelho: [pendente.marca, pendente.modelo].filter(Boolean).join(' ') },
    dados: pendenteComFotos
  };
}

// Importa a resposta assinada (celular -> PC) de uma entrega. Localiza a
// pendente pelo idEnvioAssinatura, cria o comprovante definitivo em
// `entregas` (reaproveitando criarOuSubstituirEntrega, mesma função usada
// pelo lote) e remove da fila de pendentes. Espelha
// importarRespostaAssinatura, mas nunca grava em db.ordens/compras/estoque.
function importarRespostaAssinaturaEntrega(conteudoArquivo) {
  if (!conteudoArquivo || typeof conteudoArquivo !== 'object') {
    return { sucesso: false, erro: 'Arquivo inválido ou corrompido.' };
  }
  if (conteudoArquivo.tipoArquivo !== 'sistema-os-pc-para-assinar-resposta') {
    return { sucesso: false, erro: 'Este arquivo não é uma resposta de assinatura do app celular (tipoArquivo ausente ou incorreto).' };
  }
  if (conteudoArquivo.tipoDocumento !== 'entrega') {
    return { sucesso: false, erro: `Tipo de documento inesperado: "${conteudoArquivo.tipoDocumento}" (esperado "entrega").` };
  }
  if (!conteudoArquivo.idEnvioAssinatura) {
    return { sucesso: false, erro: 'Arquivo não contém idEnvioAssinatura.' };
  }

  const pendente = obterEntregaPendentePorIdEnvio(conteudoArquivo.idEnvioAssinatura);
  if (!pendente) {
    return { sucesso: false, erro: `Nenhuma entrega pendente encontrada para este envio (idEnvioAssinatura "${conteudoArquivo.idEnvioAssinatura}"). Pode já ter sido processada ou o arquivo não corresponde a um envio feito por este PC.` };
  }

  const database = loadDB();
  if (!_numeroOSExisteExato(database, pendente.numeroOS)) {
    return { sucesso: false, erro: `OS nº ${pendente.numeroOS} não encontrada — a OS pode ter sido excluída depois do envio.` };
  }

  try {
    const { entrega } = criarOuSubstituirEntrega({
      numeroOS: pendente.numeroOS,
      documentoEntregaId: pendente.documentoEntregaId,
      cicloEntregaId: pendente.cicloEntregaId,
      tipoEntrega: pendente.tipoEntrega,
      retornoGarantiaId: pendente.retornoGarantiaId,
      garantiaId: pendente.garantiaId,
      idEnvioAssinatura: pendente.idEnvioAssinatura,
      nomeRetirou: pendente.nomeRetirou,
      cpfRetirou: pendente.cpfRetirou,
      telefoneRetirou: pendente.telefoneRetirou,
      marca: pendente.marca,
      modelo: pendente.modelo,
      reparoRealizado: pendente.reparoRealizado,
      valorReparo: pendente.valorReparo,
      formaPagamento: pendente.formaPagamento,
      declaracao: pendente.declaracao,
      dataHoraAssinatura: pendente.dataHoraAssinatura || pendente.criadoEm || new Date().toISOString(),
      garantiaDataInicio: pendente.garantiaDataInicio,
      termosGarantia: pendente.termosGarantia,
      garantiaDias: pendente.garantiaDias,
      dataLimiteGarantia: pendente.dataLimiteGarantia,
      assinaturaRetirouBase64: conteudoArquivo.assinaturaRetirouBase64 || '',
      naoAssinado: conteudoArquivo.naoAssinado === true,
      assinaturaPendente: false,
      // As fotos já foram salvas na OS quando a pendente foi criada
      // (criarEntregaPendente lê os.fotos, não recria) — não reenviar
      // aqui de novo (evitaria duplicar arquivos no disco).
      fotos: [],
      origemIdExportacao: null
    });
    removerEntregaPendente(pendente.numeroOS, pendente.cicloEntregaId);
    return { sucesso: true, tipoDocumento: 'entrega', registro: entrega };
  } catch (err) {
    return { sucesso: false, erro: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: GARANTIA (aba nova, criada manualmente no PC)
// ═══════════════════════════════════════════════════════════════
// Diferente de `entregas` (que só chega via importação do celular),
// `garantias` é criada e editada direto no PC: o usuário digita o número
// da OS, o sistema puxa os dados dela (cliente/aparelho), e o usuário
// define prazo (dias) e o texto de termos. Gera comprovante em via ÚNICA
// (retrato), sem assinatura — documento informativo pra entregar/mostrar
// ao cliente, não um contrato assinado na hora.
//
// Schema de cada item em database.json (array `garantias`):
// {
//   numeroOS, clienteNome, clienteTelefone, clienteCpf,
//   marca, modelo, imei, servicoRealizado: string,
//   garantiaDias: number,
//   dataInicio: string (ISO),  // emissão do comprovante
//   dataLimite: string (ISO),  // dataInicio + garantiaDias
//   termos: string,
//   pdfPath: string,
//   criadoEm, atualizadoEm: string (ISO)
// }
// Uma garantia por OS — gerar de novo para o mesmo número SOBRESCREVE
// a anterior (mesmo padrão de `entregas`).

function _addDiasGarantia(dataIso, dias) {
  const valor = String(dataIso || '');
  const d = valor ? new Date(valor.length === 10 ? valor + 'T12:00:00' : valor) : new Date();
  d.setDate(d.getDate() + Number(dias || 0));
  return d.toISOString();
}

function criarOuAtualizarGarantia(dados) {
  const database = loadDB();
  const garantia = _criarOuAtualizarGarantiaNoBanco(database, { ...dados, origem: 'manual' });
  saveDB(database);
  return garantia;
}

function receberGarantiaRemota(dados) {
  const database = loadDB();
  const garantia = _criarOuAtualizarGarantiaNoBanco(database, dados);
  const retornos = Array.isArray(garantia.retornosGarantia) ? garantia.retornosGarantia : [];
  const retornoAtual = retornos.find((item) => item.id === garantia.retornoAtualId)
    || retornos.find((item) => item.status !== 'Entregue')
    || retornos[0];
  if (retornoAtual && STATUS_RETORNO_GARANTIA_VALIDOS.includes(retornoAtual.status)) {
    _atualizarOsPeloRetornoGarantia(database, garantia, retornoAtual, 'Sincronização do celular', 'Etapa recebida da nuvem.');
  }
  saveDB(database);
  return garantia;
}

function listarGarantias() {
  const database = loadDB();
  const ordens = new Map((database.ordens || []).map(os => [os.numero, os]));
  return (database.garantias || []).map(g => _garantiaComIdentidade(g, ordens.get(g.numeroOS)))
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
}

function _garantiaComIdentidade(garantia, ordem) {
  if (!garantia) return null;
  const id = garantia.clienteId || ordem?.cliente?.clienteId || null;
  return { ...garantia, clienteId: id, clienteNumero: garantia.clienteNumero && garantia.clienteNumero !== '00000' ? garantia.clienteNumero : id || '00000' };
}

function obterGarantiaPorNumeroOS(numeroOS) {
  const database = loadDB();
  const alvo = String(numeroOS || '').trim();
  const direta = (database.garantias || []).find(g => String(g.numeroOS || '').trim() === alvo);
  if (direta) return _garantiaComIdentidade(direta, _encontrarOSPorNumero(database, direta.numeroOS));
  // Fallback tolerante: compara só a parte numérica (ver obterOSPorNumero),
  // pra "3"/"03" também encontrar "OS-0003" na busca do celular.
  const alvoNum = extrairNumeroInteiro(alvo);
  if (!alvoNum && alvoNum !== 0) return null;
  const encontrada = (database.garantias || []).find(g => extrairNumeroInteiro(g.numeroOS) === alvoNum);
  return _garantiaComIdentidade(encontrada, encontrada && _encontrarOSPorNumero(database, encontrada.numeroOS));
}

function _identidadeUsuarioGarantia(usuario) {
  if (usuario && typeof usuario === 'object') {
    return {
      id: String(usuario.id || usuario.login || '').slice(0, 120),
      nome: String(usuario.nome || usuario.login || 'Usuário').slice(0, 160)
    };
  }
  const texto = String(usuario || 'Sistema').slice(0, 160);
  return { id: texto, nome: texto };
}

function _garantiaMutavel(database, numeroOS) {
  const alvo = String(numeroOS || '').trim();
  const numeroInteiro = extrairNumeroInteiro(alvo);
  return (database.garantias || []).find((item) => {
    const numero = String(item.numeroOS || '').trim();
    return numero === alvo || (Number.isFinite(numeroInteiro) && extrairNumeroInteiro(numero) === numeroInteiro);
  }) || null;
}

function _atualizarOsPeloRetornoGarantia(database, garantia, retorno, usuario, observacao) {
  const ordem = _encontrarOSPorNumero(database, garantia.numeroOS);
  if (!ordem) return null;
  const statusOS = STATUS_OS_POR_RETORNO_GARANTIA[retorno.status];
  const agora = new Date().toISOString();
  ordem.status = statusOS;
  ordem.retornoGarantiaAtivo = retorno.status !== 'Entregue';
  ordem.retornoGarantiaId = retorno.id;
  ordem.statusRetornoGarantia = retorno.status;
  ordem.historicoStatus = [...(ordem.historicoStatus || []), {
    status: statusOS,
    data: agora,
    origem: 'retorno_garantia',
    retornoGarantiaId: retorno.id,
    observacao: String(observacao || retorno.motivo || '').slice(0, 1000),
    usuario: _identidadeUsuarioGarantia(usuario)
  }];
  ordem.updatedAt = agora;
  return ordem;
}

function registrarRetornoGarantia(numeroOS, dados = {}, usuario) {
  const database = loadDB();
  const garantia = _garantiaMutavel(database, numeroOS);
  if (!garantia) throw new Error(`A OS ${numeroOS} ainda não possui uma garantia emitida.`);
  const motivo = String(dados.motivo || '').trim().slice(0, 600);
  if (motivo.length < 3) throw new Error('Informe o motivo do retorno em garantia.');
  const agora = new Date().toISOString();
  const responsavel = _identidadeUsuarioGarantia(usuario);
  garantia.retornosGarantia = Array.isArray(garantia.retornosGarantia) ? garantia.retornosGarantia : [];
  const existenteAberto = garantia.retornosGarantia.find((item) =>
    item.status !== 'Entregue' && String(item.motivo || '').trim().toLowerCase() === motivo.toLowerCase()
  );
  if (existenteAberto) return { garantia: _garantiaComIdentidade(garantia, _encontrarOSPorNumero(database, garantia.numeroOS)), retorno: existenteAberto, duplicado: true };

  const retorno = {
    id: `RET-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    status: 'Em análise',
    motivo,
    observacaoInicial: String(dados.observacao || '').trim().slice(0, 2000),
    abertoEm: agora,
    atualizadoEm: agora,
    encerradoEm: '',
    responsavel,
    historico: [{
      status: 'Em análise',
      em: agora,
      observacao: String(dados.observacao || motivo).trim().slice(0, 2000),
      usuario: responsavel
    }]
  };
  garantia.retornosGarantia.unshift(retorno);
  garantia.retornoAtualId = retorno.id;
  garantia.statusRetorno = retorno.status;
  garantia.atualizadoEm = agora;
  garantia.pdfPath = garantia.pdfPath || '';
  const ordem = _atualizarOsPeloRetornoGarantia(database, garantia, retorno, usuario, motivo);
  saveDB(database);
  return { garantia: _garantiaComIdentidade(garantia, ordem), retorno, ordem, duplicado: false };
}

function atualizarStatusRetornoGarantia(numeroOS, retornoId, dados = {}, usuario) {
  const database = loadDB();
  const garantia = _garantiaMutavel(database, numeroOS);
  if (!garantia) throw new Error(`Garantia da OS ${numeroOS} não encontrada.`);
  const retorno = (garantia.retornosGarantia || []).find((item) => item.id === retornoId);
  if (!retorno) throw new Error('Retorno em garantia não encontrado.');
  const status = String(dados.status || '').trim();
  if (!STATUS_RETORNO_GARANTIA_VALIDOS.includes(status)) throw new Error('Status de retorno em garantia inválido.');
  const entregaDoRetorno = _encontrarEntregaNoBanco(database, numeroOS, retornoId);
  const entregaConcluida = entregaDoRetorno
    && entregaDoRetorno.assinaturaPendente !== true
    && entregaDoRetorno.validaParaConclusao !== false
    && (Boolean(entregaDoRetorno.assinaturaRetirouBase64) || entregaDoRetorno.naoAssinado === true);
  if (status === 'Entregue' && !entregaConcluida) {
    throw new Error('Conclua a nova entrega deste retorno com assinatura ou marque “Não assinado”. O documento original continuará salvo.');
  }
  const observacao = String(dados.observacao || '').trim().slice(0, 2000);
  const motivoInformado = Object.prototype.hasOwnProperty.call(dados, 'motivo');
  const motivoAtualizado = motivoInformado ? String(dados.motivo || '').trim().slice(0, 600) : retorno.motivo;
  if (motivoInformado && motivoAtualizado.length < 3) throw new Error('Informe o motivo do retorno em garantia.');
  const agora = new Date().toISOString();
  const responsavel = _identidadeUsuarioGarantia(usuario);
  const mudou = retorno.status !== status;
  const mudouMotivo = motivoInformado && motivoAtualizado !== retorno.motivo;
  if (mudou || observacao || mudouMotivo) {
    retorno.historico = [...(retorno.historico || []), {
      status,
      em: agora,
      observacao: observacao || (mudouMotivo ? 'Motivo/descrição do retorno atualizado.' : ''),
      motivo: motivoAtualizado,
      usuario: responsavel
    }];
  }
  retorno.motivo = motivoAtualizado;
  retorno.status = status;
  retorno.atualizadoEm = agora;
  retorno.encerradoEm = status === 'Entregue' ? agora : '';
  if (mudou && status !== 'Entregue' && entregaDoRetorno) {
    entregaDoRetorno.validaParaConclusao = false;
    entregaDoRetorno.reabertoEm = agora;
    entregaDoRetorno.atualizadoEm = agora;
  }
  garantia.retornoAtualId = retorno.id;
  garantia.statusRetorno = status;
  garantia.atualizadoEm = agora;
  const ordem = _atualizarOsPeloRetornoGarantia(database, garantia, retorno, usuario, observacao);
  saveDB(database);

  let entregaPendente = null;
  let entrega = entregaDoRetorno;
  const jaTemFila = (database.entregasPendentes || []).some(item =>
    _mesmaOSEntrega(item.numeroOS, numeroOS) && _cicloDaEntrega(item) === retorno.id
  );
  if (status === 'Pronto para retirada' && !jaTemFila) {
    entregaPendente = criarEntregaPendente(numeroOS, {
      cicloEntregaId: retorno.id,
      retornoGarantiaId: retorno.id,
      garantiaId: garantia.supabaseId || null,
      garantiaDias: Number(garantia.garantiaDias) || 0,
      garantiaDataInicio: garantia.dataInicio || undefined,
      termosGarantia: garantia.termos || undefined,
      reparoRealizado: observacao
        ? `Retorno em garantia — ${observacao}`
        : `Retorno em garantia — ${retorno.motivo}`
    });
  }

  const garantiaAtualizada = obterGarantiaPorNumeroOS(numeroOS);
  const ordemAtualizada = _encontrarOSPorNumero(loadDB(), numeroOS);
  return {
    garantia: garantiaAtualizada || _garantiaComIdentidade(garantia, ordemAtualizada || ordem),
    retorno: garantiaAtualizada?.retornosGarantia?.find(item => item.id === retorno.id) || retorno,
    ordem: ordemAtualizada || ordem,
    entregaPendente,
    entrega
  };
}

function atualizarCaminhoPdfGarantia(numeroOS, pdfPath) {
  const database = loadDB();
  if (!database.garantias) return;
  const alvo = String(numeroOS || '').trim();
  const idx = database.garantias.findIndex(g => String(g.numeroOS || '').trim() === alvo);
  if (idx !== -1) { database.garantias[idx].pdfPath = pdfPath; saveDB(database); }
}

function excluirGarantia(numeroOS) {
  const database = loadDB();
  if (!database.garantias) return false;
  const alvo = String(numeroOS || '').trim();
  const antes = database.garantias.length;
  database.garantias = database.garantias.filter(g => String(g.numeroOS || '').trim() !== alvo);
  saveDB(database);
  return database.garantias.length < antes;
}

function getPdfGarantiaDir() {
  const d = require('path').join(getRootDir(), 'PDFs-Garantia');
  if (!require('fs').existsSync(d)) require('fs').mkdirSync(d, { recursive: true });
  return d;
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: ORÇAMENTOS (Módulo ORC)
// ═══════════════════════════════════════════════════════════════
// Schema: database.json → array `orcamentos`
// {
//   numero: "ORC-0001",
//   data: ISO,
//   status: "Pendente" | "Aprovado" | "Reprovado" | "Expirado" | "Convertido",
//   cliente: { nome, cpf, telefone, email },
//   aparelho: { tipo, marca, modelo, cor, imei, defeitoRelatado },
//   servicos: string,        // descrição dos serviços
//   valorTotal: number,
//   validadeAte: string,     // data ISO ou ''
//   observacoes: string,
//   osGerada: string,        // numero da OS criada (se convertido)
//   pdfPath: string
// }

function formatarNumeroOrc(n) { return 'ORC-' + String(n).padStart(4, '0'); }

function criarOrcamento(dados) {
  const database = loadDB();
  if (!database.proximoOrcId) database.proximoOrcId = 1;
  if (!database.orcamentos) database.orcamentos = [];
  const numero = formatarNumeroOrc(database.proximoOrcId);
  database.proximoOrcId += 1;
  const orc = {
    numero,
    data: new Date().toISOString(),
    status: 'Pendente',
    cliente: dados.cliente || {},
    aparelho: dados.aparelho || {},
    servicos: dados.servicos || '',
    valorTotal: parseFloat(dados.valorTotal) || 0,
    validadeAte: dados.validadeAte || '',
    observacoes: dados.observacoes || '',
    osGerada: '',
    pdfPath: ''
  };
  database.orcamentos = [orc, ...database.orcamentos];
  saveDB(database);
  return orc;
}

function atualizarOrcamento(numero, dados) {
  const database = loadDB();
  if (!database.orcamentos) database.orcamentos = [];
  const idx = database.orcamentos.findIndex(o => o.numero === numero);
  if (idx === -1) throw new Error(`Orçamento ${numero} não encontrado.`);
  const atual = database.orcamentos[idx];
  database.orcamentos[idx] = Object.assign({}, atual, {
    status: dados.status !== undefined ? dados.status : atual.status,
    cliente: dados.cliente || atual.cliente,
    aparelho: dados.aparelho || atual.aparelho,
    servicos: dados.servicos !== undefined ? dados.servicos : atual.servicos,
    valorTotal: dados.valorTotal !== undefined ? (parseFloat(dados.valorTotal) || 0) : atual.valorTotal,
    validadeAte: dados.validadeAte !== undefined ? dados.validadeAte : atual.validadeAte,
    observacoes: dados.observacoes !== undefined ? dados.observacoes : atual.observacoes,
    osGerada: dados.osGerada !== undefined ? dados.osGerada : atual.osGerada
  });
  saveDB(database);
  return database.orcamentos[idx];
}

function listarOrcamentos() {
  const database = loadDB();
  return (database.orcamentos || []).slice().sort((a, b) => new Date(b.data) - new Date(a.data));
}

function obterOrcamentoPorNumero(numero) {
  const database = loadDB();
  return (database.orcamentos || []).find(o => o.numero === numero) || null;
}

function buscarOrcamentos(termo) {
  const database = loadDB();
  const lista = database.orcamentos || [];
  if (!termo) return lista.slice().sort((a, b) => new Date(b.data) - new Date(a.data));
  const t = termo.toLowerCase();
  return lista.filter(o => {
    const cl = o.cliente || {};
    const ap = o.aparelho || {};
    return [o.numero, cl.nome, cl.cpf, cl.telefone, ap.marca, ap.modelo, ap.imei, o.servicos]
      .filter(Boolean).join(' ').toLowerCase().includes(t);
  }).sort((a, b) => new Date(b.data) - new Date(a.data));
}

function excluirOrcamento(numero, usuario) {
  const database = loadDB();
  const idx = (database.orcamentos || []).findIndex(o => o.numero === numero);
  if (idx === -1) throw new Error(`Orçamento ${numero} não encontrado.`);
  const removido = database.orcamentos[idx];
  database.orcamentos = database.orcamentos.filter(o => o.numero !== numero);
  database.historicoExclusoes = [...(database.historicoExclusoes || []), {
    tipo: 'orcamento', identificador: numero,
    usuario: usuario || 'desconhecido', data: new Date().toISOString()
  }];
  saveDB(database);
  return removido;
}

// Converte orçamento aprovado em OS, aproveitando todos os dados
function converterOrcamentoEmOS(numero, extras) {
  const database = loadDB();
  const idx = (database.orcamentos || []).findIndex(o => o.numero === numero);
  if (idx === -1) throw new Error(`Orçamento ${numero} não encontrado.`);
  const orc = database.orcamentos[idx];
  // Monta dados da OS a partir do orçamento
  const dadosOS = {
    cliente: orc.cliente,
    aparelho: {
      tipoEquipamento: orc.aparelho.tipo || 'Smartphone',
      marca: orc.aparelho.marca,
      modelo: orc.aparelho.modelo,
      cor: orc.aparelho.cor,
      imei: orc.aparelho.imei,
      defeitoRelatado: orc.aparelho.defeitoRelatado
    },
    observacoes: `Gerado do orçamento ${numero}. ${extras?.observacoes || ''}`.trim(),
    status: 'Aguardando aprovação',
    valorInvestido: 0,
    ...(extras || {})
  };
  const os = criarOS(dadosOS);
  // Bug fix: criarOS() já fez seu próprio loadDB()+saveDB() internamente e
  // gravou a nova OS em disco. A variável 'database' acima é um snapshot
  // ANTERIOR a essa gravação. Salvar 'database' agora sobrescreveria o
  // arquivo inteiro com o estado antigo, apagando a OS recém-criada do
  // banco (o orçamento ficaria marcado como "Convertido" apontando para
  // uma OS inexistente, e o contador proximoNumero regrediria, causando
  // colisão de número na próxima OS criada). Recarrega o banco já
  // atualizado antes de gravar a mudança no orçamento.
  const databaseAtualizado = loadDB();
  const idxAtualizado = (databaseAtualizado.orcamentos || []).findIndex(o => o.numero === numero);
  if (idxAtualizado !== -1) {
    databaseAtualizado.orcamentos[idxAtualizado] = Object.assign({}, databaseAtualizado.orcamentos[idxAtualizado], {
      status: 'Convertido',
      osGerada: os.numero
    });
  }
  saveDB(databaseAtualizado);
  return os;
}

// Busca histórico de OS de um cliente por CPF ou nome
module.exports.criarOrcamento = criarOrcamento;
module.exports.atualizarOrcamento = atualizarOrcamento;
module.exports.listarOrcamentos = listarOrcamentos;
module.exports.obterOrcamentoPorNumero = obterOrcamentoPorNumero;
module.exports.buscarOrcamentos = buscarOrcamentos;
module.exports.excluirOrcamento = excluirOrcamento;
module.exports.converterOrcamentoEmOS = converterOrcamentoEmOS;
module.exports.buscarHistoricoCliente = clientesRepository.buscarHistoricoCliente;

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: CLIENTES (AGREGAÇÃO) — Aba "Clientes"
// ═══════════════════════════════════════════════════════════════
// Não existe uma coleção própria "clientes" no database.json — o
// cadastro do cliente é implícito em três lugares diferentes:
//   1) ordens[].cliente            → quem trouxe um aparelho pra OS
//   2) estoque[] (status Vendido)  → compradorNome/compradorCpf/compradorTelefone
//   3) compras[].vendedor          → quem VENDEU um aparelho usado PARA a loja
// Esta seção agrupa os três por CPF (preferencial) ou nome normalizado
// e devolve um "perfil" único por cliente com o histórico consolidado.
// É tudo calculado on-the-fly a partir das coleções existentes — não
// grava nada novo no banco, então backup/zerar continuam funcionando
// sem qualquer alteração.


module.exports.listarClientes = clientesRepository.listarClientes;
module.exports.buscarClientes = clientesRepository.buscarClientes;
module.exports.obterPerfilCliente = clientesRepository.obterPerfilCliente;
module.exports.atualizarDadosCliente = clientesRepository.atualizarDadosCliente;
module.exports.excluirCliente = clientesRepository.excluirCliente;

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: RELATÓRIO FINANCEIRO REAL (v20)
// Cruza OS (serviços), Estoque (vendas de aparelhos) e Compras
// para produzir um DRE simplificado por período.
// ═══════════════════════════════════════════════════════════════
function obterRelatorioFinanceiro({ mes, ano } = {}) {
  const db = loadDB();
  const agora = new Date();
  const mesAlvo = mes !== undefined ? parseInt(mes) : agora.getMonth() + 1;
  const anoAlvo = ano !== undefined ? parseInt(ano) : agora.getFullYear();
  const prefixo = `${anoAlvo}-${String(mesAlvo).padStart(2, '0')}`;
  const ordens = db.ordens || [];
  const pagamentos = db.pagamentos || [];
  const valorTotalDaOS = os => Number(os?.valorTotalServico || 0)
    || Number(os?.diagnosticoTecnico?.valorEstimado || 0)
    || Number(os?.valorInvestido || 0)
    || 0;
  const valorPagoDaOS = numero => pagamentos
    .filter(p => p.osNumero === numero && p.status !== 'reembolsado')
    .reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const custoManualDaOS = os => (os?.diagnosticoTecnico?.pecasTrocar || [])
    .reduce((s, p) => s + (Number(p.valor) || 0), 0);

  // Receitas usam o caixa confirmado no período. Estimativas e pendências
  // aparecem separadas e nunca são misturadas com dinheiro recebido.
  const pagamentosDoMes = pagamentos.filter(p =>
    p.status !== 'reembolsado' && String(p.dataPagamento || '').startsWith(prefixo)
  );
  const receitaServicos = pagamentosDoMes.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const numerosOSPagasNoMes = [...new Set(pagamentosDoMes.map(p => p.osNumero).filter(Boolean))];
  const osPagasNoMes = numerosOSPagasNoMes.map(numero => ordens.find(os => os.numero === numero)).filter(Boolean);

  const aparelhosVendidos = (db.estoque || []).filter(e =>
    e.status === 'Vendido' && String(e.dataVenda || '').startsWith(prefixo)
  );
  const receitaVendas = aparelhosVendidos.reduce((s, e) => s + (Number(e.valorVenda) || 0), 0);
  const totalEntradas = receitaServicos + receitaVendas;

  // Custos de serviço: peças baixadas do estoque ligadas às OS que tiveram
  // recebimento no mês + peças manuais registradas nessas mesmas OS.
  const conjuntoOSPagas = new Set(numerosOSPagasNoMes);
  const custoPecas = (db.logPecas || [])
    .filter(l => l.tipo === 'saida' && conjuntoOSPagas.has(l.osRef))
    .reduce((s, l) => {
      const peca = (db.pecas || []).find(p => p.id === l.id);
      const custoUnitario = Number(l.custo) || Number(peca?.custo) || 0;
      return s + custoUnitario * (Number(l.quantidade) || 1);
    }, 0);
  const custoPecasManualOS = osPagasNoMes.reduce((s, os) => s + custoManualDaOS(os), 0);
  const custoServicos = custoPecas + custoPecasManualOS;

  // Na venda de aparelhos, o custo reconhecido contém aquisição, reparo e
  // extras do próprio item. O contrato de compra é exibido como investimento
  // do mês, mas não é somado outra vez ao lucro.
  const custoAparelhos = aparelhosVendidos.reduce((s, e) =>
    s + (Number(e.valorPago) || 0) + (Number(e.valorGastoPecas) || 0) + (Number(e.gastosExtras) || 0), 0
  );
  const comprasMes = (db.compras || []).filter(c => String(c.data || '').startsWith(prefixo));
  const custoCompras = comprasMes.reduce((s, c) => s + (Number(c.dadosCompra?.valor) || 0), 0);
  const custoPecasCompra = comprasMes.reduce((s, c) => s + (Number(c.dadosCompra?.custoPecas) || 0), 0);

  const totalSaidas = custoServicos + custoAparelhos;
  const lucroServicos = receitaServicos - custoServicos;
  const lucroVendas = receitaVendas - custoAparelhos;
  const lucroLiquido = lucroServicos + lucroVendas;
  const margemLucro = totalEntradas > 0 ? (lucroLiquido / totalEntradas) * 100 : 0;

  // O detalhe une OS abertas no mês e OS que receberam pagamento no mês.
  // Assim a OS aparece com o valor estimado antes mesmo de ser paga.
  const mapaDetalhe = new Map();
  ordens.filter(os => String(os.data || '').startsWith(prefixo)).forEach(os => mapaDetalhe.set(os.numero, os));
  osPagasNoMes.forEach(os => mapaDetalhe.set(os.numero, os));
  const detalheOS = Array.from(mapaDetalhe.values()).map(os => {
    const estimado = valorTotalDaOS(os);
    const recebido = valorPagoDaOS(os.numero);
    return {
      numero: os.numero,
      cliente: os.cliente?.nome || '',
      clienteId: os.cliente?.clienteId || '',
      aparelho: [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' '),
      valor: estimado,
      valorEstimado: estimado,
      valorRecebido: recebido,
      valorPendente: Math.max(0, estimado - recebido),
      statusPagamento: os.statusPagamento || '',
      data: os.data
    };
  }).sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

  const detalheVendas = aparelhosVendidos.map(e => ({
    id: e.id,
    descricao: [e.marca, e.modelo].filter(Boolean).join(' '),
    comprador: e.compradorNome || '',
    valorVenda: parseFloat(e.valorVenda) || 0,
    custo: (parseFloat(e.valorPago) || 0) + (parseFloat(e.valorGastoPecas) || 0) + (parseFloat(e.gastosExtras) || 0),
    lucro: (parseFloat(e.valorVenda) || 0) - ((parseFloat(e.valorPago) || 0) + (parseFloat(e.valorGastoPecas) || 0) + (parseFloat(e.gastosExtras) || 0)),
    dataVenda: e.dataVenda
  }));

  const historico = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(anoAlvo, mesAlvo - 1 - i, 1);
    const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const pagamentosM = pagamentos.filter(pg => pg.status !== 'reembolsado' && String(pg.dataPagamento || '').startsWith(p));
    const vendasM = (db.estoque || []).filter(e => e.status === 'Vendido' && (e.dataVenda || '').startsWith(p));
    const idsOSM = new Set(pagamentosM.map(pg => pg.osNumero).filter(Boolean));
    const custoPecasM = (db.logPecas || []).filter(l => l.tipo === 'saida' && idsOSM.has(l.osRef))
      .reduce((s, l) => s + (Number(l.custo) || 0) * (Number(l.quantidade) || 1), 0);
    const custoManualM = ordens.filter(os => idsOSM.has(os.numero)).reduce((s, os) => s + custoManualDaOS(os), 0);
    const entM = pagamentosM.reduce((s, pg) => s + (Number(pg.valor) || 0), 0)
                + vendasM.reduce((s, e) => s + (Number(e.valorVenda) || 0), 0);
    const saiM = custoPecasM + custoManualM + vendasM.reduce((s, e) =>
      s + (Number(e.valorPago) || 0) + (Number(e.valorGastoPecas) || 0) + (Number(e.gastosExtras) || 0), 0
    );
    historico.push({ mes: p, entradas: entM, saidas: saiM, lucro: entM - saiM });
  }

  const detalheAReceber = ordens.filter(os => {
    if (os.status === 'Cancelado') return false;
    const total = valorTotalDaOS(os);
    return total > 0 && valorPagoDaOS(os.numero) + 0.005 < total;
  }).map(os => {
    const total = valorTotalDaOS(os);
    const recebido = valorPagoDaOS(os.numero);
    return {
      numero: os.numero,
      cliente: os.cliente?.nome || '',
      clienteId: os.cliente?.clienteId || '',
      aparelho: [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' '),
      formaPagamento: os.formaPagamento || '',
      valor: Math.max(0, total - recebido),
      valorTotal: total,
      valorRecebido: recebido
    };
  });
  const totalAReceber = detalheAReceber.reduce((s, o) => s + o.valor, 0);

  return {
    periodo: { mes: mesAlvo, ano: anoAlvo, prefixo },
    entradas: { servicos: receitaServicos, vendas: receitaVendas, total: totalEntradas },
    saidas: { compras: custoCompras, pecas: custoPecas, custoAparelhos, custoPecasCompra, custoPecasManualOS, custoServicos, total: totalSaidas },
    resultado: { lucroServicos, lucroVendas, lucroTotal: lucroLiquido, margemLucro },
    lucroLiquido,
    qtdOsEntregues: numerosOSPagasNoMes.length,
    qtdAparelhoVendidos: aparelhosVendidos.length,
    qtdCompras: comprasMes.length,
    detalheOS,
    detalheVendas,
    historico,
    aReceber: { qtd: detalheAReceber.length, total: totalAReceber, detalhe: detalheAReceber }
  };
}

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: CRUZAMENTO ESTOQUE × OS (v20)
// Verifica se peças do estoque/compras foram usadas em OS e vice-versa.
// ═══════════════════════════════════════════════════════════════
function cruzarEstoqueOS() {
  const db = loadDB();
  // Peças com estoque crítico/zerado
  const pecasCriticas = (db.pecas || [])
    .filter(p => p.quantidade <= p.estoqueMinimo || p.quantidade === 0)
    .map(p => ({ id: p.id, nome: p.nome, categoria: p.categoria, quantidade: p.quantidade, minimo: p.estoqueMinimo }));

  // OS aguardando peça × peças disponíveis
  const osAguardandoPeca = (db.ordens || [])
    .filter(os => os.status === 'Aguardando peça')
    .map(os => ({
      numero: os.numero,
      cliente: os.cliente?.nome || '',
      aparelho: [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' '),
      pecaDescrita: os.diagnosticoTecnico?.pecas || os.observacoes || ''
    }));

  // Aparelhos prontos para venda no estoque
  const prontos = (db.estoque || [])
    .filter(e => e.status === 'Pronto para venda')
    .map(e => ({
      id: e.id,
      descricao: [e.marca, e.modelo].filter(Boolean).join(' '),
      valorVenda: e.valorVenda || 0,
      lucroPotencial: (e.valorVenda || 0) - ((e.valorPago || 0) + (e.valorGastoPecas || 0) + (e.gastosExtras || 0))
    }));

  // Aparelhos em reparo no estoque (potenciais clientes de peças)
  const emReparoEstoque = (db.estoque || [])
    .filter(e => e.status === 'Em reparo')
    .map(e => ({ id: e.id, descricao: [e.marca, e.modelo].filter(Boolean).join(' ') }));

  return { pecasCriticas, osAguardandoPeca, prontos, emReparoEstoque };
}

function obterRelatorioFinanceiroExtrato(filtros = {}) {
  const database = loadDB();
  const relatorio = financeiroLedger.montarRelatorio(database, filtros);
  const { extrato, resumo, periodo } = relatorio;
  const ordens = database.ordens || [];
  const pagamentos = (database.pagamentos || []).filter((item) => item?.status !== 'reembolsado');
  const inicio = periodo.inicio || '';
  const fim = periodo.fim || '9999-12-31';
  const estaNoPeriodo = (valor) => {
    const dia = financeiroLedger.diaIso(valor);
    return !!dia && (!inicio || dia >= inicio) && (!fim || dia <= fim);
  };
  const documentosExtrato = new Set(extrato.map((item) => item.documento).filter(Boolean));
  const recebimentosExtrato = extrato.filter((item) => item.tipo === 'recebimento_os');
  const vendasExtrato = extrato.filter((item) => item.tipo === 'venda_aparelho');
  const comprasExtrato = extrato.filter((item) => item.tipo === 'compra_estoque');
  const valorPagoTotalDaOS = (numeroOS) => pagamentos
    .filter((item) => item.osNumero === numeroOS)
    .reduce((soma, item) => soma + (Number(item.valor) || 0), 0);
  const valorPagoPeriodoDaOS = (numeroOS) => recebimentosExtrato
    .filter((item) => item.documento === numeroOS)
    .reduce((soma, item) => soma + item.valor, 0);

  const detalheOS = ordens
    .filter((os) => estaNoPeriodo(os.data) || documentosExtrato.has(os.numero))
    .map((os) => {
      const valorEstimado = financeiroLedger.valorTotalOS(os);
      const valorRecebidoTotal = valorPagoTotalDaOS(os.numero);
      return {
        numero: os.numero,
        cliente: os.cliente?.nome || '',
        clienteId: os.cliente?.clienteId || '',
        aparelho: [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' '),
        valor: valorEstimado,
        valorEstimado,
        valorRecebido: valorPagoPeriodoDaOS(os.numero),
        valorRecebidoTotal,
        valorPendente: Math.max(0, valorEstimado - valorRecebidoTotal),
        statusPagamento: os.statusPagamento || '',
        data: os.data
      };
    })
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

  const detalheVendas = vendasExtrato.map((lancamento) => {
    const item = (database.estoque || []).find((estoque) => estoque?.id === lancamento.documento) || {};
    const custo = (Number(item.valorPago) || 0) + (Number(item.valorGastoPecas) || 0) + (Number(item.gastosExtras) || 0);
    return {
      id: lancamento.documento,
      descricao: [item.marca, item.modelo].filter(Boolean).join(' ') || lancamento.descricao.replace(/^Venda de\s+/i, ''),
      comprador: item.compradorNome || lancamento.contraparte || '',
      valorVenda: lancamento.valor,
      custo,
      lucro: lancamento.valor - custo,
      dataVenda: lancamento.dataHora || lancamento.data
    };
  });

  const detalheAReceber = ordens.filter((os) => {
    if (os.status === 'Cancelado') return false;
    const total = financeiroLedger.valorTotalOS(os);
    return total > 0 && valorPagoTotalDaOS(os.numero) + 0.005 < total;
  }).map((os) => {
    const total = financeiroLedger.valorTotalOS(os);
    const recebido = valorPagoTotalDaOS(os.numero);
    return {
      numero: os.numero,
      cliente: os.cliente?.nome || '',
      clienteId: os.cliente?.clienteId || '',
      aparelho: [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' '),
      formaPagamento: os.formaPagamento || '',
      valor: Math.max(0, total - recebido),
      valorTotal: total,
      valorRecebido: recebido
    };
  });
  const totalAReceber = detalheAReceber.reduce((soma, item) => soma + item.valor, 0);

  const dataAncora = periodo.fim ? new Date(`${periodo.fim}T12:00:00`) : new Date();
  const historico = [];
  for (let indice = 5; indice >= 0; indice -= 1) {
    const data = new Date(dataAncora.getFullYear(), dataAncora.getMonth() - indice, 1);
    const ano = data.getFullYear();
    const mes = data.getMonth() + 1;
    const mensal = financeiroLedger.montarRelatorio(database, { mes, ano }).resumo;
    historico.push({
      mes: `${ano}-${String(mes).padStart(2, '0')}`,
      entradas: mensal.composicao.receitaOS + mensal.composicao.receitaVendas,
      saidas: mensal.composicao.custoOS + mensal.composicao.custoVendas,
      lucro: mensal.resultado.lucroTotal,
      caixa: mensal.caixa.saldo
    });
  }

  const custoPecas = extrato
    .filter((item) => item.tipo === 'custo_os')
    .reduce((soma, item) => soma + (Number(item.detalhes?.custoPecasEstoque) || 0), 0);
  const custoPecasManualOS = extrato
    .filter((item) => item.tipo === 'custo_os')
    .reduce((soma, item) => soma + (Number(item.detalhes?.custoPecasManuais) || 0), 0);
  const lucroServicos = resumo.resultado.lucroOS;
  const lucroVendas = resumo.resultado.lucroVendas;
  const lucroTotal = resumo.resultado.lucroTotal;

  return {
    periodo,
    entradas: {
      servicos: resumo.composicao.receitaOS,
      vendas: resumo.composicao.receitaVendas,
      total: resumo.composicao.receitaOS + resumo.composicao.receitaVendas
    },
    saidas: {
      compras: resumo.composicao.investimentos,
      pecas: custoPecas,
      custoAparelhos: resumo.composicao.custoVendas,
      custoPecasCompra: 0,
      custoPecasManualOS,
      custoServicos: resumo.composicao.custoOS,
      total: resumo.composicao.custoOS + resumo.composicao.custoVendas,
      reembolsos: resumo.composicao.reembolsos
    },
    resultado: {
      lucroServicos,
      lucroVendas,
      lucroTotal,
      margemLucro: resumo.resultado.margem
    },
    lucroLiquido: lucroTotal,
    qtdOsEntregues: new Set(recebimentosExtrato.map((item) => item.documento)).size,
    qtdAparelhoVendidos: vendasExtrato.length,
    qtdCompras: comprasExtrato.length,
    detalheOS,
    detalheVendas,
    historico,
    aReceber: { qtd: detalheAReceber.length, total: totalAReceber, detalhe: detalheAReceber },
    extrato,
    resumoExtrato: resumo,
    filtrosDisponiveis: {
      metodos: relatorio.metodosDisponiveis,
      tipos: relatorio.tiposDisponiveis
    },
    totalLancamentos: relatorio.totalLancamentos
  };
}

module.exports.obterRelatorioFinanceiro = obterRelatorioFinanceiroExtrato;
module.exports.cruzarEstoqueOS = cruzarEstoqueOS;

// ════════════════════════════════════════════════════════════════
// SEÇÃO: PAGAMENTOS (v20)
// Registro de pagamentos vinculados a OS, com comprovante e busca.
// ════════════════════════════════════════════════════════════════

function _initPagamentos(db) {
  if (!db.pagamentos) db.pagamentos = [];
  return db;
}

/**
 * Registra ou atualiza pagamento de uma OS.
 * v31: o estado financeiro fica em "statusPagamento", separado do status
 * técnico. A exceção é o fluxo que exige entrada: confirmar 50% ou 100%
 * libera a OS de "Aguardando aprovação" para "Em reparo".
 */
function registrarPagamento({ osNumero, valor, metodo, origem, observacao, caminhoComprovante, mercadoPagoId, cobrancaId }) {
  const db = _initPagamentos(loadDB());
  const { idMercadoPago } = require('../mercado-pago-validacao');
  const idMp = String(mercadoPagoId || '').trim();
  if (idMp && (origem !== 'mercadopago' || !/^\d+$/.test(idMp))) throw new Error('Identificador Mercado Pago inválido.');
  if (idMp) {
    const anterior = db.pagamentos.find(p => p.origem === 'mercadopago' && idMercadoPago(p) === idMp);
    if (anterior) {
      if (anterior.osNumero !== osNumero || Number(anterior.valor) !== Number(valor)
          || (anterior.cobrancaId && anterior.cobrancaId !== cobrancaId)) {
        throw new Error('Esta transação do Mercado Pago já está vinculada a outra cobrança.');
      }
      return anterior;
    }
  }
  const os = db.ordens.find(o => o.numero === osNumero);
  if (!os) throw new Error('OS não encontrada: ' + osNumero);

  // Não permite registrar pagamento em OS já cancelada ou integralmente paga.
  if (os.status === 'Cancelado' || normalizarStatusPagamento(os.statusPagamento) === 'Pago') {
    const msgStatus = normalizarStatusPagamento(os.statusPagamento) === 'Pago'
      ? 'OS já possui pagamento registrado.'
      : `Não é possível registrar pagamento: OS está com status "${os.status}".`;
    throw new Error(msgStatus);
  }

  const valorNum = parseFloat(valor);
  if (!Number.isFinite(valorNum) || valorNum <= 0) throw new Error('Valor do pagamento deve ser maior que zero.');
  const metodoPagamento = metodo || 'Não informado';
  const origemPagamento = origem || 'manual';

  // Deduplicação: se já existe um pagamento pendente para esta OS com
  // a mesma origem, método e valor (criado nos últimos 5 minutos), rejeita
  // — evita duplicata por clique rápido ou dupla notificação do Mercado
  // Pago sem confundir a entrada online com o saldo presencial, que podem
  // legitimamente ter o mesmo método e o mesmo valor.
  const agora = Date.now();
  const CINCO_MINUTOS = 5 * 60 * 1000;
  const pagamentoDuplicado = (db.pagamentos || []).find(p => {
    // Dois IDs distintos são duas transações reais, inclusive parcelas iguais.
    if (idMp) return false;
    if (p.osNumero !== osNumero) return false;
    if ((p.origem || 'manual') !== origemPagamento) return false;
    if (p.metodo !== metodoPagamento) return false;
    if (Math.abs(p.valor - valorNum) > 0.01) return false;
    const tempoPagamento = new Date(p.dataPagamento).getTime();
    return (agora - tempoPagamento) < CINCO_MINUTOS;
  });
  if (pagamentoDuplicado) {
    throw new Error('Pagamento duplicado detectado — já existe um pagamento registrado para esta OS com a mesma origem, método e valor nos últimos 5 minutos.');
  }

  const id = 'PAG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const dataPagamento = new Date().toISOString();

  const pagamento = {
    id,
    osNumero,
    clienteNome: os.cliente?.nome || '',
    clienteCpf:  os.cliente?.cpf  || '',
    clienteTel:  os.cliente?.telefone || '',
    aparelho: [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' '),
    valor: valorNum,
    metodo: metodoPagamento,
    origem: origemPagamento,   // 'mercadopago' | 'manual' | 'pix' | 'presencial'
    ...(idMp ? { mercadoPagoId: idMp, cobrancaId: String(cobrancaId || '') } : {}),
    observacao: observacao || '',
    caminhoComprovante: caminhoComprovante || null,
    dataPagamento: dataPagamento,
    criadoEm: dataPagamento
  };

  db.pagamentos.push(pagamento);

  // v40.1: grava a forma de pagamento diretamente na OS (não só no registro
  // isolado de pagamentos), para permitir exibir na listagem sem precisar
  // consultar/cruzar com db.pagamentos[] a cada linha renderizada.
  const idx = db.ordens.findIndex(o => o.numero === osNumero);
  if (idx !== -1) {
    const atual = db.ordens[idx];
    const historicoStatus = [...(atual.historicoStatus || [])];
    // Fase 5: se o cliente pagar pelo link (Mercado Pago) antes de responder
    // qual a forma de pagamento — ou depois de já ter dito algo como "vou na
    // retirada" —, o pagamento confirmado aqui precisa encerrar a automação
    // de texto (estadoConversaAprovacao: 'concluido'). Sem isso, uma resposta
    // manual de forma de pagamento que chegue depois (ex.: o cliente digitou
    // "dinheiro" antes de ver que o link já tinha sido pago) ainda seria
    // processada pelo listener (src/whatsapp.js), sobrescrevendo formaPagamento
    // e conflitando com o pagamento já confirmado.
    const valorEntradaConfigurada = Number(atual.valorEntradaAprovacao || 0);
    const pagamentoEhEntrada50 = atual.exigirEntrada50Aprovacao === true
      && atual.entrada50Paga !== true
      && (
        (valorEntradaConfigurada > 0 && valorNum <= valorEntradaConfigurada + 0.01)
        || (valorEntradaConfigurada <= 0 && Number(atual.percentualPagamentoAguardado) === 50)
      );
    const valorTotalSalvo = Number(atual.valorTotalServico || 0)
      || Number(atual.diagnosticoTecnico?.valorEstimado || 0)
      || Number(atual.valorInvestido || 0);
    // Alguns pagamentos chegam antes de uma sincronização trazer os campos
    // financeiros da OS. O valor confirmado é então a fonte confiável: uma
    // entrada de 50% implica total = parcela × 2; uma quitação implica total
    // = valor pago. Persistir esse total evita o cartão de Autorizadas voltar
    // a exibir R$ 0,00 depois da confirmação.
    const valorTotalServico = valorTotalSalvo > 0
      ? valorTotalSalvo
      : (pagamentoEhEntrada50 ? valorNum * 2 : valorNum);
    const totalPagoAcumulado = (db.pagamentos || [])
      .filter(p => p.osNumero === osNumero)
      .reduce((soma, p) => soma + (Number(p.valor) || 0), 0);
    const percentualQuitado = pagamentoEhEntrada50 ? 50 : 100;
    const valorAcumuladoLimitado = valorTotalServico > 0
      ? Math.min(valorTotalServico, totalPagoAcumulado)
      : totalPagoAcumulado;
    // O comprovante representa o estado financeiro alcançado por esta
    // transação: entrada de 50% ou quitação acumulada de 100%.
    pagamento.percentualQuitado = percentualQuitado;
    pagamento.tipoComprovante = pagamentoEhEntrada50 ? 'entrada_50' : 'quitacao_100';
    pagamento.valorTotalServico = valorTotalServico;
    pagamento.valorAcumulado = valorAcumuladoLimitado;
    pagamento.valorRestanteAposPagamento = pagamentoEhEntrada50
      ? Math.max(0, valorTotalServico - valorAcumuladoLimitado)
      : 0;
    const statusPagamentoConfirmado = pagamentoEhEntrada50 ? 'Pago 50%' : 'Pago';
    historicoStatus.push({
      status: statusPagamentoConfirmado,
      data: dataPagamento,
      observacao: `Pagamento ${id} — ${metodoPagamento} — R$ ${pagamento.valor.toFixed(2)}`,
      tipoPagamento: true
    });
    if (inferirStatusAprovacao(atual) !== 'Aprovado') {
      historicoStatus.push({
        status: 'Aprovado',
        data: dataPagamento,
        observacao: 'Aprovação confirmada pelo pagamento.',
        tipoAprovacao: true
      });
    }
    db.ordens[idx] = Object.assign({}, atual, {
      // Pagamento confirmado pelo link autoriza o reparo tanto na entrada de
      // 50% quanto na quitação de 100%.
      status: /aguardando aprova/i.test(String(atual.status || ''))
        ? 'Em reparo'
        : atual.status,
      statusAprovacao: 'Aprovado',
      statusPagamento: statusPagamentoConfirmado,
      historicoStatus,
      pagamentoId: id,
      formaPagamento: metodoPagamento,
      estadoConversaAprovacao: 'concluido',
      // Este campo representa o estado parcial visível. Ao quitar o saldo,
      // percentualPagamentoConfirmado passa a 100 e a OS não pode continuar
      // sendo exibida como "50% pago · saldo na retirada".
      entrada50Paga: pagamentoEhEntrada50,
      percentualPagamentoConfirmado: pagamentoEhEntrada50 ? 50 : 100,
      percentualPagamentoAguardado: pagamentoEhEntrada50 ? 50 : 0,
      valorRecebidoConfirmado: valorAcumuladoLimitado,
      modalidadePagamentoAprovacao: origemPagamento === 'presencial' ? 'presencial' : 'online',
      valorTotalServico,
      valorRestanteServico: pagamentoEhEntrada50
        ? Math.max(0, valorTotalServico - valorNum)
        : 0
    });
  }

  saveDB(db);
  return pagamento;
}

// ── Fase 6 — Confirmação manual de pagamento presencial ────────────────────
//
// Usada pelo botão "Confirmar Pagamento Presencial" (tela de edição da OS),
// que só aparece quando statusPagamento === 'Aguardando Pagamento na Retirada'
// (Fase 5: cliente já respondeu pelo WhatsApp qual seria a forma de pagamento
// na retirada, mas o pagamento em si ainda não foi confirmado por nenhum meio
// automático). Esta função registra que o dinheiro foi de fato recebido
// presencialmente, sem passar por link do Mercado Pago nem qualquer outra
// validação automática — por isso o botão que a chama exige confirmação
// explícita do operador antes de executar.
//
// Reaproveita registrarPagamento() (mesma trilha de auditoria de qualquer
// outro pagamento: entra em db.pagamentos, aparece no histórico de
// pagamentos, gera historicoStatus, atualiza o estado financeiro (saldo na
// retirada ou 'Autorizado'), grava pagamentoId/formaPagamento na OS e encerra
// a automação de texto via estadoConversaAprovacao:'concluido') em vez de
// duplicar essa lógica.
//
// Diferença em relação a um registro manual "genérico" (pag:registrar):
// exige que a OS esteja exatamente em 'Aguardando Pagamento na Retirada' —
// evita confirmar como "presencial" uma OS que não passou pelo fluxo de
// retirada com cobrança da Fase 5 (ex.: uma OS ainda em orçamento, sem
// cobrança nenhuma enviada). Para esses outros casos, o registro manual
// genérico (botão "Registrar Pagamento") continua sendo o caminho certo.
function confirmarPagamentoPresencial(osNumero, dados = {}) {
  const dbRaw = loadDB();
  const os = dbRaw.ordens.find(o => o.numero === osNumero);
  if (!os) throw new Error('OS não encontrada: ' + osNumero);

  if (!['Aguardando Pagamento na Retirada', 'Aguardando Pagamento Presencial', 'Pago 50%'].includes(normalizarStatusPagamento(os.statusPagamento))) {
    throw new Error(
      `Não é possível confirmar pagamento presencial: a OS ${osNumero} está com ` +
      `status de pagamento "${os.statusPagamento || 'sem pagamento'}", e não ` +
      `"Aguardando Pagamento Presencial", "Aguardando Pagamento na Retirada" ou "Pago 50%".`
    );
  }

  // Valor: usa o informado explicitamente por quem chamou. Sem valor, uma OS
  // que já recebeu a entrada usa o saldo persistido/calculado; no primeiro
  // pagamento usa os 50% escolhidos ou o total do serviço. Assim a segunda
  // parcela nunca repete acidentalmente o valor integral.
  const valorInformado = parseFloat(dados.valor);
  const valorTotal = parseFloat(os.valorTotalServico)
    || parseFloat(os.diagnosticoTecnico?.valorEstimado)
    || parseFloat(os.valorInvestido) || 0;
  const percentualAguardado = Number(os.percentualPagamentoAguardado) || 0;
  const pagamentoParcialConfirmado = os.entrada50Paga === true
    || Number(os.percentualPagamentoConfirmado) === 50;
  const totalPagoRegistrado = (dbRaw.pagamentos || [])
    .filter(p => p.osNumero === osNumero)
    .reduce((soma, p) => soma + (parseFloat(p.valor) || 0), 0);
  const saldoPersistido = parseFloat(os.valorRestanteServico) || 0;
  const saldoCalculado = valorTotal > 0
    ? Math.max(0, valorTotal - totalPagoRegistrado)
    : 0;
  const saldoRestante = saldoPersistido > 0 ? saldoPersistido : saldoCalculado;
  const valorFallback = pagamentoParcialConfirmado
    ? saldoRestante
    : (percentualAguardado === 50
        ? (parseFloat(os.valorEntradaAprovacao) || valorTotal / 2)
        : valorTotal);
  const valor = valorInformado > 0 ? valorInformado : valorFallback;

  // Depois da entrada, esta ação confirma a quitação do saldo, não
  // um terceiro pagamento parcial. Rejeitar valor diferente evita marcar a
  // OS como 100% paga com saldo em aberto ou registrar valor acima do total.
  if (pagamentoParcialConfirmado && saldoRestante > 0
      && Math.abs(valor - saldoRestante) > 0.01) {
    throw new Error(
      `O valor para quitar a OS deve ser o saldo restante de R$ ${saldoRestante.toFixed(2)}.`
    );
  }

  const metodo = (dados.metodo || os.formaPagamento || 'Não informado');

  const pagamento = registrarPagamento({
    osNumero,
    valor,
    metodo,
    origem: 'presencial',
    observacao: dados.observacao || 'Pagamento presencial confirmado manualmente na retirada.',
  });

  return pagamento;
}

function listarPagamentos() {
  const db = _initPagamentos(loadDB());
  return [...db.pagamentos].sort((a, b) => new Date(b.dataPagamento) - new Date(a.dataPagamento));
}

function buscarPagamentos(query) {
  const t = (query || '').trim().toLowerCase();
  if (!t) return listarPagamentos();
  const db = _initPagamentos(loadDB());
  return db.pagamentos.filter(p =>
    p.osNumero?.toLowerCase().includes(t) ||
    p.clienteNome?.toLowerCase().includes(t) ||
    p.clienteCpf?.replace(/\D/g,'').includes(t.replace(/\D/g,'')) ||
    p.clienteTel?.replace(/\D/g,'').includes(t.replace(/\D/g,'')) ||
    p.id?.toLowerCase().includes(t)
  ).sort((a, b) => new Date(b.dataPagamento) - new Date(a.dataPagamento));
}

function anexarComprovante(pagamentoId, caminho) {
  const db = _initPagamentos(loadDB());
  const idx = db.pagamentos.findIndex(p => p.id === pagamentoId);
  if (idx === -1) throw new Error('Pagamento não encontrado: ' + pagamentoId);
  db.pagamentos[idx].caminhoComprovante = caminho;
  saveDB(db);
  return db.pagamentos[idx];
}

function obterPagamento(id) {
  const db = _initPagamentos(loadDB());
  return db.pagamentos.find(p => p.id === id) || null;
}

// Exclui um pagamento e reverte os campos da OS que foram gravados por
// registrarPagamento, para não deixar a OS com statusPagamento:'Autorizado'
// / pagamentoId apontando para um registro que não existe mais.
// Retorna o caminho do comprovante (se existir) para quem chamou decidir
// se apaga o arquivo físico do disco — este módulo não mexe em arquivos.
function excluirPagamento(pagamentoId) {
  const db = _initPagamentos(loadDB());
  const idx = db.pagamentos.findIndex(p => p.id === pagamentoId);
  if (idx === -1) throw new Error('Pagamento não encontrado: ' + pagamentoId);

  const pagamento = db.pagamentos[idx];
  const caminhoComprovante = pagamento.caminhoComprovante || null;

  db.pagamentos.splice(idx, 1);

  const idxOS = db.ordens.findIndex(o => o.numero === pagamento.osNumero);
  if (idxOS !== -1) {
    const atual = db.ordens[idxOS];
    if (atual.pagamentoId === pagamentoId) {
      const agora = new Date().toISOString();
      const historicoStatus = [...(atual.historicoStatus || []),
        { status: 'Pagamento excluído', data: agora, observacao: `Pagamento ${pagamentoId} excluído — R$ ${pagamento.valor.toFixed(2)}`, tipoPagamento: true }
      ];
      db.ordens[idxOS] = Object.assign({}, atual, {
        statusPagamento: '', // valor real de "sem pagamento" em STATUS_PAGAMENTO_VALIDOS
        pagamentoId: null,
        formaPagamento: null, // não deixar a listagem mostrar forma de pagamento fantasma
        // ALT-11: Reverte estadoConversaAprovacao para permitir nova automação WhatsApp
        estadoConversaAprovacao: 'nenhum',
        historicoStatus
      });
    }
  }

  // ALT-12: Remove reembolsos vinculados a este pagamento
  db.reembolsos = db.reembolsos || [];
  db.reembolsos = db.reembolsos.filter(r => r.pagamentoId !== pagamentoId);

  saveDB(db);
  return { sucesso: true, caminhoComprovante };
}

// Retorna o pagamento vinculado a uma OS (pelo pagamentoId gravado na OS)
function obterPagamentoPorOS(osNumero) {
  const db = _initPagamentos(loadDB());
  const os = db.ordens.find(o => o.numero === osNumero);
  if (!os || !os.pagamentoId) return null;
  return db.pagamentos.find(p => p.id === os.pagamentoId) || null;
}

module.exports.registrarPagamento    = registrarPagamento;
module.exports.excluirPagamento      = excluirPagamento;
module.exports.listarPagamentos      = listarPagamentos;
module.exports.buscarPagamentos      = buscarPagamentos;
module.exports.anexarComprovante     = anexarComprovante;
module.exports.obterPagamento        = obterPagamento;
module.exports.obterPagamentoPorOS   = obterPagamentoPorOS;
module.exports.confirmarPagamentoPresencial = confirmarPagamentoPresencial; // Fase 6

// ══════════════════════════════════════════════════════════════
// REEMBOLSOS — v36, criado para o Painel Financeiro (Prompt 3B)
//
// Registro manual: o sistema não tem (e a API pública do Mercado Pago
// não oferece mais, desde 2022) um jeito de saber sozinho quando um
// pagamento foi estornado. Por isso o usuário registra o reembolso
// vinculado a um pagamento já existente — isso é o que permite o
// "Saldo Estimado" do painel financeiro descontar estornos de verdade,
// em vez de sempre mostrar o total bruto recebido como se fosse líquido.
// ══════════════════════════════════════════════════════════════

function _initReembolsos(db) {
  if (!db.reembolsos) db.reembolsos = [];
  return db;
}

/**
 * Registra um reembolso vinculado a um pagamento já existente.
 * Não estorna nada de verdade no Mercado Pago — é só o registro local
 * de que aquele valor não deve mais contar como recebido líquido.
 */
function registrarReembolso({ pagamentoId, osNumero, valor, motivo }) {
  const db = _initReembolsos(_initPagamentos(loadDB()));

  const pagamento = db.pagamentos.find(p => p.id === pagamentoId);
  if (!pagamento) throw new Error('Pagamento não encontrado: ' + pagamentoId);

  const valorNum = parseFloat(valor);
  if (!valorNum || valorNum <= 0) throw new Error('Valor do reembolso deve ser maior que zero.');

  // Não deixa reembolsar mais do que o próprio pagamento (nem a soma de
  // reembolsos anteriores do mesmo pagamento) — evita saldo negativo por erro de digitação.
  const jaReembolsado = db.reembolsos
    .filter(r => r.pagamentoId === pagamentoId)
    .reduce((soma, r) => soma + r.valor, 0);
  if (jaReembolsado + valorNum > pagamento.valor + 0.01) {
    throw new Error(
      `Valor de reembolso (R$ ${valorNum.toFixed(2)}) excede o saldo reembolsável deste ` +
      `pagamento (R$ ${(pagamento.valor - jaReembolsado).toFixed(2)} restante de R$ ${pagamento.valor.toFixed(2)}).`
    );
  }

  const id = 'REEMB-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const agora = new Date().toISOString();

  const reembolso = {
    id,
    pagamentoId,
    osNumero: osNumero || pagamento.osNumero,
    valor: valorNum,
    motivo: motivo || '',
    dataReembolso: agora,
    criadoEm: agora
  };

  db.reembolsos.push(reembolso);
  saveDB(db);
  return reembolso;
}

function listarReembolsos() {
  const db = _initReembolsos(loadDB());
  return [...db.reembolsos].sort((a, b) => new Date(b.dataReembolso) - new Date(a.dataReembolso));
}

function listarReembolsosPorPagamento(pagamentoId) {
  const db = _initReembolsos(loadDB());
  return db.reembolsos.filter(r => r.pagamentoId === pagamentoId);
}

/**
 * Saldo Estimado do Painel Financeiro — NÃO é o saldo oficial da conta
 * Mercado Pago (a API pública não entrega mais esse número desde 2022,
 * ver RESULTADO-PROMPT-3A.md). É um cálculo interno:
 *
 *   soma(pagamentos com origem=mercadopago) - soma(reembolsos desses pagamentos)
 *
 * Pagamento manual ou Pix direto (fora do fluxo Mercado Pago) não entra,
 * porque esse dinheiro nunca passou pela conta MP.
 */
function obterSaldoEstimado() {
  const dbPag = _initPagamentos(loadDB());
  const dbReemb = _initReembolsos(loadDB());

  const pagamentosMP = dbPag.pagamentos.filter(p => p.origem === 'mercadopago');
  const idsPagamentosMP = new Set(pagamentosMP.map(p => p.id));

  const totalRecebido = pagamentosMP.reduce((soma, p) => soma + p.valor, 0);
  const reembolsosDoMP = dbReemb.reembolsos.filter(r => idsPagamentosMP.has(r.pagamentoId));
  const totalReembolsado = reembolsosDoMP.reduce((soma, r) => soma + r.valor, 0);

  return {
    saldoEstimado: totalRecebido - totalReembolsado,
    totalRecebidoMP: totalRecebido,
    totalReembolsadoMP: totalReembolsado,
    qtdPagamentosMP: pagamentosMP.length,
    qtdReembolsosMP: reembolsosDoMP.length
  };
}

module.exports.registrarReembolso           = registrarReembolso;
module.exports.listarReembolsos             = listarReembolsos;
module.exports.listarReembolsosPorPagamento = listarReembolsosPorPagamento;
module.exports.obterSaldoEstimado           = obterSaldoEstimado;

// ══════════════════════════════════════════════════════════════
// COBRANÇAS — registros pendentes antes do pagamento ser confirmado
// status: 'aguardando' | 'pago' | 'cancelado'
// ══════════════════════════════════════════════════════════════

function _initCobrancas(db) {
  if (!db.cobrancas) db.cobrancas = [];
  return db;
}

/**
 * Registra uma cobrança pendente (antes de confirmação de pagamento).
 * Não altera status da OS.
 */
function registrarCobranca({ osNumero, valor, linkML, pixCodigo, telefone, tipo }) {
  const db = _initCobrancas(loadDB());
  const os = db.ordens.find(o => o.numero === osNumero);
  if (!os) throw new Error('OS não encontrada: ' + osNumero);

  // ALT-2: Validação de valor
  const valorNum = parseFloat(valor);
  if (!valorNum || valorNum <= 0) throw new Error('Valor da cobrança deve ser maior que zero.');

  const id = 'COB-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const agora = new Date().toISOString();

  const cobranca = {
    id,
    osNumero,
    clienteNome: os.cliente?.nome || '',
    clienteCpf:  os.cliente?.cpf  || '',
    clienteTel:  telefone || os.cliente?.telefone || '',
    aparelho: [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' '),
    valor: parseFloat(valor) || 0,
    tipo: tipo || '',
    linkML:    linkML    || null,
    pixCodigo: pixCodigo || null,
    status: 'aguardando',  // 'aguardando' | 'pago' | 'cancelado'
    pagamentoId: null,     // preenchido quando confirmado
    criadoEm: agora,
    atualizadoEm: agora
  };

  db.cobrancas.push(cobranca);
  saveDB(db);
  return cobranca;
}

function listarCobrancas() {
  const db = _initCobrancas(loadDB());
  return [...db.cobrancas].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
}

function buscarCobrancas(query) {
  const t = (query || '').toLowerCase().trim();
  if (!t) return listarCobrancas();
  const db = _initCobrancas(loadDB());
  return db.cobrancas.filter(c =>
    c.osNumero?.toLowerCase().includes(t) ||
    c.clienteNome?.toLowerCase().includes(t) ||
    c.clienteCpf?.includes(t) ||
    c.clienteTel?.includes(t)
  ).sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
}

/**
 * Atualiza o status de uma cobrança.
 * Se status = 'pago', registra o pagamento e atualiza a OS.
 */
function atualizarStatusCobranca(id, { status, pagamentoId }) {
  const db = _initCobrancas(loadDB());
  const idx = db.cobrancas.findIndex(c => c.id === id);
  if (idx === -1) throw new Error('Cobrança não encontrada: ' + id);
  db.cobrancas[idx] = Object.assign({}, db.cobrancas[idx], {
    status,
    pagamentoId: pagamentoId || db.cobrancas[idx].pagamentoId,
    atualizadoEm: new Date().toISOString()
  });
  saveDB(db);
  return db.cobrancas[idx];
}

module.exports.registrarCobranca        = registrarCobranca;
module.exports.listarCobrancas          = listarCobrancas;
module.exports.buscarCobrancas          = buscarCobrancas;
module.exports.atualizarStatusCobranca  = atualizarStatusCobranca;

// ══════════════════════════════════════════════════════════════
// LOG DE MENSAGENS WHATSAPP
// Registra cada tentativa de envio automático ou manual.
// Schema de cada registro:
// {
//   id        : string,        // ID único (timestamp + random)
//   data      : string (ISO),  // quando foi a tentativa de envio
//   tipo      : string,        // 'cobranca' | 'pagamento_confirmado' | 'entregue' | 'manual'
//   osNumero  : string,        // ex: "OS-0001" (pode ser '' para envios manuais)
//   clienteNome: string,
//   telefone  : string,        // número formatado
//   mensagem  : string,        // texto completo da mensagem enviada
//   sucesso   : boolean,
//   erro      : string|null    // mensagem de erro se !sucesso
// }
// ══════════════════════════════════════════════════════════════

function _initLogMensagens(db) {
  if (!Array.isArray(db.logMensagensWapp)) db.logMensagensWapp = [];
  return db;
}

// O mesmo telefone pode chegar de telas diferentes como "(27) 99604-4952",
// "27996044952" ou "5527996044952". Guardar/agrupar pelo formato canônico
// evita criar duas conversas para o mesmo contato.
function _normalizarTelefoneMensagem(telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) return '';
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

function _formatarTelefoneMensagem(telefone) {
  const normalizado = _normalizarTelefoneMensagem(telefone);
  const nacional = normalizado.startsWith('55') && (normalizado.length === 12 || normalizado.length === 13)
    ? normalizado.slice(2)
    : normalizado;
  if (nacional.length === 11) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  }
  if (nacional.length === 10) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  }
  return normalizado || String(telefone || '');
}

function registrarLogMensagem({ tipo, osNumero, clienteNome, telefone, mensagem, sucesso, erro, statusEnvio, idMensagem }) {
  const db = _initLogMensagens(loadDB());
  const id = 'MSG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const registro = {
    id,
    data      : new Date().toISOString(),
    tipo      : tipo       || 'manual',
    osNumero  : osNumero   || '',
    clienteNome: clienteNome || '',
    telefone  : _normalizarTelefoneMensagem(telefone),
    mensagem  : mensagem   || '',
    sucesso   : !!sucesso,
    // "sucesso" significa que o servidor do WhatsApp aceitou a mensagem.
    // Não afirmamos entrega ao cliente sem um recibo específico do WhatsApp.
    statusEnvio: statusEnvio || (sucesso ? 'aceito-servidor' : 'erro'),
    idMensagem : idMensagem || '',
    erro      : erro       || null
  };
  db.logMensagensWapp.push(registro);
  // Mantém no máximo 5000 registros para não inflar o banco
  if (db.logMensagensWapp.length > 5000) {
    db.logMensagensWapp = db.logMensagensWapp.slice(-5000);
  }
  saveDB(db);
  return registro;
}

function listarLogMensagens({ limite = 500 } = {}) {
  const db = _initLogMensagens(loadDB());
  return [...db.logMensagensWapp]
    .sort((a, b) => new Date(b.data) - new Date(a.data))
    .slice(0, limite);
}

function atualizarConfirmacaoMensagem(idMensagem, statusEnvio) {
  if (!idMensagem || !['erro', 'aceito-servidor', 'entregue'].includes(statusEnvio)) return false;
  const database = _initLogMensagens(loadDB());
  const ordem = { erro: 0, pendente: 1, 'aceito-servidor': 2, entregue: 3 };
  let mudou = false;
  for (const registro of database.logMensagensWapp) {
    if (registro.idMensagem !== idMensagem) continue;
    if ((ordem[registro.statusEnvio] ?? -1) > ordem[statusEnvio]) continue;
    if (registro.statusEnvio === statusEnvio) continue;
    registro.statusEnvio = statusEnvio;
    registro.sucesso = statusEnvio !== 'erro';
    registro.erro = registro.sucesso ? null : 'O WhatsApp recusou o envio.';
    mudou = true;
  }
  if (mudou) saveDB(database);
  return mudou;
}
module.exports.atualizarConfirmacaoMensagem = atualizarConfirmacaoMensagem;

function buscarLogMensagens(query) {
  const t = (query || '').toLowerCase().trim();
  const telefoneBusca = _normalizarTelefoneMensagem(query);
  const db = _initLogMensagens(loadDB());
  const lista = [...db.logMensagensWapp].sort((a, b) => new Date(b.data) - new Date(a.data));
  if (!t) return lista.slice(0, 500);
  return lista.filter(m =>
    m.clienteNome?.toLowerCase().includes(t) ||
    m.telefone?.includes(t) ||
    (!!telefoneBusca && _normalizarTelefoneMensagem(m.telefone).includes(telefoneBusca)) ||
    m.osNumero?.toLowerCase().includes(t) ||
    m.tipo?.toLowerCase().includes(t)
  ).slice(0, 500);
}

// Retorna mensagens agrupadas por cliente (telefone)
function listarLogMensagensPorCliente(query) {
  const t = (query || '').toLowerCase().trim();
  const telefoneBusca = _normalizarTelefoneMensagem(query);
  const db = _initLogMensagens(loadDB());
  const todas = [...db.logMensagensWapp].sort((a, b) => new Date(b.data) - new Date(a.data));

  const grupos = {};
  todas.forEach(m => {
    const telefoneNormalizado = _normalizarTelefoneMensagem(m.telefone);
    const chave = telefoneNormalizado || 'sem-telefone';
    if (!grupos[chave]) {
      grupos[chave] = {
        telefone   : _formatarTelefoneMensagem(telefoneNormalizado),
        clienteNome: m.clienteNome,
        mensagens  : [],
        totalEnviado: 0,
        totalErro  : 0,
        ultimaData : m.data
      };
    }
    // Atualiza o nome do cliente para o mais recente
    if (m.clienteNome) grupos[chave].clienteNome = m.clienteNome;
    grupos[chave].mensagens.push(m);
    if (m.sucesso) grupos[chave].totalEnviado++;
    else grupos[chave].totalErro++;
    if (new Date(m.data) > new Date(grupos[chave].ultimaData)) {
      grupos[chave].ultimaData = m.data;
    }
  });

  let resultado = Object.values(grupos).sort((a, b) => new Date(b.ultimaData) - new Date(a.ultimaData));

  if (t) {
    resultado = resultado.filter(g =>
      g.clienteNome?.toLowerCase().includes(t) ||
      g.telefone?.includes(t) ||
      (!!telefoneBusca && _normalizarTelefoneMensagem(g.telefone).includes(telefoneBusca))
    );
  }

  return resultado;
}

// Atualiza o nome do cliente por TELEFONE em todos os lugares onde ele é
// guardado: no log de mensagens (logMensagensWapp — usado pela aba Mensagens)
// e em todas as OS daquele telefone (usado pela aba Conversas e pelo resto
// do sistema). Assim o nome fica consistente independente de qual tela foi
// usada para editar, já que as duas abas exibem o mesmo cliente por número.
function atualizarNomeClientePorTelefone(telefone, novoNome) {
  const digitos = _normalizarTelefoneMensagem(telefone);
  const nome = (novoNome || '').trim();
  if (!digitos) throw new Error('Telefone inválido.');
  if (!nome) throw new Error('Nome não pode ficar vazio.');

  const db = _initLogMensagens(loadDB());
  let alterados = 0;

  db.logMensagensWapp.forEach(m => {
    if (_normalizarTelefoneMensagem(m.telefone) === digitos) {
      m.clienteNome = nome;
      alterados++;
    }
  });

  (db.ordens || []).forEach(os => {
    const telOS = _normalizarTelefoneMensagem(os.cliente?.telefone);
    if (telOS === digitos) {
      os.cliente = Object.assign({}, os.cliente, { nome });
      alterados++;
    }
  });

  saveDB(db);
  return { telefone: digitos, nome, alterados };
}

// Exclui uma única mensagem do log (por id), usada pelo botão "Excluir"
// dentro de uma conversa na aba Mensagens/Conversas. Não afeta a OS nem
// nenhum outro registro — é só o histórico de mensagens do WhatsApp.
function excluirLogMensagem(id) {
  if (!id) return { sucesso: false, erro: 'Id da mensagem não informado.' };
  const db = _initLogMensagens(loadDB());
  const tamanhoAntes = db.logMensagensWapp.length;
  db.logMensagensWapp = db.logMensagensWapp.filter(m => m.id !== id);
  if (db.logMensagensWapp.length === tamanhoAntes) {
    return { sucesso: false, erro: 'Mensagem não encontrada (já pode ter sido excluída).' };
  }
  saveDB(db);
  return { sucesso: true, id };
}

// Exclui todas as mensagens de um contato específico (por telefone).
// Usado pelo botão "Excluir" na lista lateral da aba Mensagens WhatsApp.
function excluirMensagensPorTelefone(telefone) {
  if (!telefone) return { sucesso: false, erro: 'Telefone não informado.' };
  const db = _initLogMensagens(loadDB());
  const tamanhoAntes = db.logMensagensWapp.length;
  const telNormalizado = _normalizarTelefoneMensagem(telefone);
  db.logMensagensWapp = db.logMensagensWapp.filter(m => {
    const telMsg = _normalizarTelefoneMensagem(m.telefone);
    return telMsg !== telNormalizado;
  });
  const excluidas = tamanhoAntes - db.logMensagensWapp.length;
  if (excluidas === 0) {
    return { sucesso: false, erro: 'Nenhuma mensagem encontrada para este telefone.' };
  }
  saveDB(db);
  return { sucesso: true, excluidas };
}

module.exports.registrarLogMensagem       = registrarLogMensagem;
module.exports.listarLogMensagens         = listarLogMensagens;
module.exports.buscarLogMensagens         = buscarLogMensagens;
module.exports.listarLogMensagensPorCliente = listarLogMensagensPorCliente;
module.exports.atualizarNomeClientePorTelefone = atualizarNomeClientePorTelefone;
module.exports.excluirLogMensagem         = excluirLogMensagem;
module.exports.excluirMensagensPorTelefone = excluirMensagensPorTelefone;

// ══════════════════════════════════════════════════════════════
// v40.2 — LOG DE CLASSIFICAÇÃO POR IA (Groq)
// Registra cada tentativa de classificar a forma de pagamento manual
// digitada em texto livre pelo cliente no WhatsApp (ver src/ia-groq.js
// e o estado 'aguardando_forma_pagamento_retirada' em src/whatsapp.js).
// Schema de cada registro:
// {
//   id           : string,        // ID único (timestamp + random)
//   data         : string (ISO),  // quando a classificação foi feita
//   osNumero     : string,        // ex: "OS-0001"
//   clienteNome  : string,
//   telefone     : string,
//   textoOriginal: string,        // texto exato que o cliente digitou
//   rotulo       : string,        // classificação final usada (o que vai pro badge)
//   origem       : string,        // 'ia' | 'fallback_regras' | 'fallback_erro'
//   motivoFallback: string|null,  // preenchido só quando origem !== 'ia'
//   tempoRespostaMs: number|null, // latência da chamada à API da Groq
//   sucesso      : boolean,       // false quando a IA falhou e caiu no fallback
//   erro         : string|null
// }
// ══════════════════════════════════════════════════════════════

function _initLogIA(db) {
  if (!Array.isArray(db.logIA)) db.logIA = [];
  return db;
}

function registrarLogIA({ osNumero, clienteNome, telefone, textoOriginal, rotulo, origem, motivoFallback, tempoRespostaMs, sucesso, erro }) {
  const db = _initLogIA(loadDB());
  const id = 'IA-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const registro = {
    id,
    data           : new Date().toISOString(),
    osNumero       : osNumero        || '',
    clienteNome    : clienteNome     || '',
    telefone       : telefone        || '',
    textoOriginal  : textoOriginal   || '',
    rotulo         : rotulo          || '',
    origem         : origem          || 'ia', // 'ia' | 'fallback_regras' | 'fallback_erro'
    motivoFallback : motivoFallback  || null,
    tempoRespostaMs: (typeof tempoRespostaMs === 'number') ? tempoRespostaMs : null,
    sucesso        : sucesso !== false,
    erro           : erro || null
  };
  db.logIA.push(registro);
  // Mantém no máximo 5000 registros para não inflar o banco
  if (db.logIA.length > 5000) {
    db.logIA = db.logIA.slice(-5000);
  }
  saveDB(db);
  return registro;
}

function listarLogIA({ limite = 500 } = {}) {
  const db = _initLogIA(loadDB());
  return [...db.logIA]
    .sort((a, b) => new Date(b.data) - new Date(a.data))
    .slice(0, limite);
}

function buscarLogIA(query) {
  const t = (query || '').toLowerCase().trim();
  const db = _initLogIA(loadDB());
  const lista = [...db.logIA].sort((a, b) => new Date(b.data) - new Date(a.data));
  if (!t) return lista.slice(0, 500);
  return lista.filter(l =>
    l.clienteNome?.toLowerCase().includes(t) ||
    l.telefone?.includes(t) ||
    l.osNumero?.toLowerCase().includes(t) ||
    l.rotulo?.toLowerCase().includes(t) ||
    l.textoOriginal?.toLowerCase().includes(t) ||
    l.origem?.toLowerCase().includes(t)
  ).slice(0, 500);
}

// Contadores rápidos para o cabeçalho da aba (total, quantos vieram da IA de
// fato vs quantos caíram em fallback, para o usuário perceber se a chave da
// Groq está com problema sem precisar ler linha por linha).
function contadoresLogIA() {
  const db = _initLogIA(loadDB());
  const total = db.logIA.length;
  let porIA = 0, porFallbackRegras = 0, porFallbackErro = 0;
  for (const l of db.logIA) {
    if (l.origem === 'fallback_regras') porFallbackRegras++;
    else if (l.origem === 'fallback_erro') porFallbackErro++;
    else porIA++;
  }
  return { total, porIA, porFallbackRegras, porFallbackErro };
}

module.exports.registrarLogIA   = registrarLogIA;
module.exports.listarLogIA      = listarLogIA;
module.exports.buscarLogIA      = buscarLogIA;
module.exports.contadoresLogIA  = contadoresLogIA;

// ══════════════════════════════════════════════════════════════
// v36.3 — AUTOMAÇÃO DE APROVAÇÃO VIA WHATSAPP
// Toda a informação de conversa/aprovação vive dentro da própria OS
// (não é uma coleção separada), nos campos:
//   aceitouTermos             : true | false | null
//   motivoRecusaTermos        : string
//   respostaPreferenciaPagamento : string
//   dataRespostaTermos        : string (ISO) | ''
//   estadoConversaAprovacao   : ver ESTADOS_CONVERSA_APROVACAO_VALIDOS
//   classificacaoResposta     : ver CLASSIFICACAO_RESPOSTA_VALIDAS
//   teveRespostaNaoEntendida  : boolean
// As funções abaixo são a camada de acesso a esses dados para a
// automação (ex.: whatsapp.js), sem duplicar a lógica já usada por
// criarOS/atualizarOS.
// ══════════════════════════════════════════════════════════════

/**
 * Localiza a OS mais relevante para um telefone recebido do WhatsApp.
 * Normaliza ambos os lados (apenas dígitos) antes de comparar, pois o
 * número que chega da automação pode vir com "+55", espaços, traços, etc.
 * Quando há mais de uma OS para o mesmo telefone, retorna a mais recente
 * dentre as que ainda estão em aberto (status técnico não fechado); se
 * todas estiverem fechadas, retorna a mais recente entre todas.
 */
function obterOSPorTelefone(telefone) {
  const alvo = String(telefone || '').replace(/\D/g, '');
  if (!alvo) return null;
  // Compara pelos últimos 8 dígitos para tolerar diferenças de DDI/DDD
  // (ex.: "+55 11 91234-5678" vs "11912345678" vs "912345678").
  const sufixoAlvo = alvo.slice(-8);
  if (!sufixoAlvo) return null;

  const db = loadDB();
  const candidatas = db.ordens.filter(os => {
    const telOS = String(os.cliente?.telefone || '').replace(/\D/g, '');
    return telOS && telOS.slice(-8) === sufixoAlvo;
  });
  if (candidatas.length === 0) return null;

  const abertas = candidatas.filter(os => !STATUS_OS_FECHADOS.includes(os.status));
  const pool = abertas.length > 0 ? abertas : candidatas;
  const maisRecente = [...pool].sort((a, b) => new Date(b.data) - new Date(a.data))[0];
  return comAtraso(maisRecente);
}

/**
 * Registra a resposta do cliente ao pedido de aprovação de termos,
 * atualizando os campos de termos e o estado da conversa em uma única
 * chamada. Reaproveita atualizarOS para manter o histórico e as demais
 * regras de mesclagem já existentes.
 *
 * @param {string} numero - número da OS (ex.: "OS-0001")
 * @param {object} dados
 * @param {boolean} dados.aceitou - true = aceitou os termos, false = recusou
 * @param {string} [dados.motivoRecusa] - motivo informado pelo cliente, se recusou
 * @param {string} [dados.classificacao] - classificação da resposta (ver CLASSIFICACAO_RESPOSTA_VALIDAS)
 */
function registrarRespostaAprovacao(numero, { aceitou, motivoRecusa, classificacao } = {}) {
  const db = loadDB();
  const os = db.ordens.find(o => o.numero === numero);
  if (!os) throw new Error('OS não encontrada: ' + numero);

  const classificacaoFinal = classificacao !== undefined
    ? classificacao
    : (aceitou === true ? 'aceite_termos' : aceitou === false ? 'recusa_termos' : '');
  if (classificacaoFinal && !CLASSIFICACAO_RESPOSTA_VALIDAS.includes(classificacaoFinal)) {
    throw new Error(`Classificação de resposta inválida: "${classificacaoFinal}".`);
  }

  const atualizacao = {
    aceitouTermos: aceitou === true ? true : (aceitou === false ? false : os.aceitouTermos),
    statusAprovacao: aceitou === true
      ? 'Aprovado'
      : (aceitou === false ? 'Desaprovado' : inferirStatusAprovacao(os)),
    motivoRecusaTermos: aceitou === false ? (motivoRecusa || '') : '',
    dataRespostaTermos: new Date().toISOString(),
    classificacaoResposta: classificacaoFinal,
    teveRespostaNaoEntendida: false,
    // Aceitou -> segue para escolha da forma de pagamento; recusou -> fluxo encerrado.
    // (Nota: este valor é sobrescrito logo em seguida pelo chamador em
    // src/whatsapp.js, que já seta 'concluido' explicitamente após chamar
    // esta função — mantido aqui só por completude/consistência de grafia.)
    estadoConversaAprovacao: aceitou === true ? 'aguardando_pagamento' : 'concluido'
  };

  return atualizarOS(numero, atualizacao);
}

/**
 * Registra a forma de pagamento escolhida pelo cliente (resposta em texto
 * livre vinda do WhatsApp) e encerra o fluxo de conversa de aprovação.
 *
 * @param {string} numero - número da OS
 * @param {string} respostaPagamento - texto da resposta do cliente
 */
function registrarFormaPagamento(numero, respostaPagamento) {
  const db = loadDB();
  const os = db.ordens.find(o => o.numero === numero);
  if (!os) throw new Error('OS não encontrada: ' + numero);

  return atualizarOS(numero, {
    respostaPreferenciaPagamento: respostaPagamento || '',
    classificacaoResposta: 'forma_pagamento',
    teveRespostaNaoEntendida: false,
    estadoConversaAprovacao: 'concluido'
  });
}

/**
 * Marca a última resposta do cliente como "não entendida" pela automação
 * (ex.: texto fora do padrão esperado, ou IA classificou como ambíguo),
 * sem alterar aceite/recusa/forma de pagamento já registrados. Incrementa
 * `tentativasSimNao`, contador que o chamador (whatsapp.js) usa para
 * decidir se reenvia a pergunta de novo ou escala para atendimento humano.
 *
 * @param {string} numero - número da OS
 * @returns {Object} a OS atualizada, incluindo o novo valor de tentativasSimNao
 */
function registrarRespostaNaoEntendida(numero) {
  const db = loadDB();
  const os = db.ordens.find(o => o.numero === numero);
  if (!os) throw new Error('OS não encontrada: ' + numero);

  const tentativasAnteriores = Number(os.tentativasSimNao) || 0;

  return atualizarOS(numero, {
    classificacaoResposta: 'nao_entendida',
    teveRespostaNaoEntendida: true,
    estadoConversaAprovacao: 'nao_entendida',
    tentativasSimNao: tentativasAnteriores + 1
  });
}

/**
 * Encaminha a conversa de aprovação para atendimento humano. A OS entra no
 * estado 'aguardando_humano' — que FICA em ESTADOS_AUTOMACAO_ATIVOS (ver
 * src/whatsapp.js), diferente do antigo comportamento (v40.3) que usava
 * 'nao_entendida' e derrubava a automação por completo. Isso é proposital:
 * o bot continua escutando essa conversa só para reconhecer o "#" de
 * cancelamento (ver cancelarAtendimentoHumano) — qualquer outro texto do
 * cliente nesse estado é ignorado pelo bot, pois quem responde a partir daqui
 * é o atendente humano.
 * Usada em dois casos:
 *   - o cliente pediu explicitamente (digitou "1");
 *   - a automação esgotou as tentativas de entender a resposta.
 * A OS fica visível na aba "Conversas → Aguardando Humano" (separada de
 * "Não Entendidas" desde a v40.4).
 *
 * @param {string} numero - número da OS
 * @param {'solicitado_pelo_cliente'|'limite_tentativas'} motivo
 * @param {'aguardando_sim_nao'|'aguardando_forma_pagamento_retirada'} [estadoOrigem]
 *   Estado em que a conversa estava antes de escalar — BUGFIX (correcoesbugs.txt
 *   #2): precisa ser gravado para que cancelarAtendimentoHumano() saiba para
 *   qual pergunta devolver a conversa depois. Se omitido, assume
 *   'aguardando_sim_nao' (mantém o comportamento antigo como fallback seguro).
 */
function registrarEscaladoAtendimentoHumano(numero, motivo, estadoOrigem) {
  const db = loadDB();
  const os = db.ordens.find(o => o.numero === numero);
  if (!os) throw new Error('OS não encontrada: ' + numero);

  return atualizarOS(numero, {
    classificacaoResposta: 'atendimento_humano',
    teveRespostaNaoEntendida: true,
    estadoConversaAprovacao: 'aguardando_humano',
    motivoEscalacaoHumana: motivo || 'nao_especificado',
    estadoOrigemEscalacaoHumana: estadoOrigem || 'aguardando_sim_nao'
  });
}

/**
 * Cancela o atendimento humano em andamento (cliente digitou "#" enquanto
 * a OS estava em 'aguardando_humano') e devolve a conversa para o estado de
 * onde a escalação partiu — o chamador (src/whatsapp.js) é responsável por
 * reenviar a pergunta correspondente logo em seguida (termos, se veio de
 * 'aguardando_sim_nao', ou forma de pagamento, se veio de
 * 'aguardando_forma_pagamento_retirada').
 *
 * BUGFIX (correcoesbugs.txt #2): antes, esta função sempre devolvia para
 * 'aguardando_sim_nao' incondicionalmente, e src/whatsapp.js sempre reenviava
 * a pergunta de aceite de termos — errado quando a escalação tinha partido da
 * etapa de retirada (o cliente já havia aceito o orçamento há tempos e
 * recebia de volta uma pergunta sobre uma etapa já concluída). Agora usa
 * estadoOrigemEscalacaoHumana (gravado em registrarEscaladoAtendimentoHumano)
 * para decidir. Se o campo estiver vazio (OS de versão anterior a esta
 * correção, sem o campo gravado), assume 'aguardando_sim_nao' — mesmo
 * comportamento de antes, como fallback seguro.
 *
 * Zera tentativasSimNao para dar ao cliente um novo ciclo completo de
 * tentativas, já que isso é, na prática, um novo começo de conversa.
 *
 * @param {string} numero - número da OS
 */
function cancelarAtendimentoHumano(numero) {
  const db = loadDB();
  const os = db.ordens.find(o => o.numero === numero);
  if (!os) throw new Error('OS não encontrada: ' + numero);

  const estadoDestino = os.estadoOrigemEscalacaoHumana === 'aguardando_forma_pagamento_retirada'
    ? 'aguardando_forma_pagamento_retirada'
    : 'aguardando_sim_nao';

  return atualizarOS(numero, {
    classificacaoResposta: '',
    estadoConversaAprovacao: estadoDestino,
    motivoEscalacaoHumana: '',
    estadoOrigemEscalacaoHumana: '',
    tentativasSimNao: 0
  });
}

/**
 * Lista as OS cuja última resposta de conversa foi classificada com o
 * valor informado (ver CLASSIFICACAO_RESPOSTA_VALIDAS).
 */
function listarConversasPorClassificacao(classificacao) {
  const db = loadDB();
  return db.ordens
    .filter(os => os.classificacaoResposta === classificacao)
    .sort((a, b) => new Date(b.dataRespostaTermos || b.data) - new Date(a.dataRespostaTermos || a.data))
    .map(comAtraso);
}

/**
 * Lista as OS que tiveram ao menos uma resposta não compreendida pela
 * automação, EXCLUINDO as que já foram encaminhadas para atendimento humano
 * (essas aparecem só em listarConversasAguardandoHumano, para não duplicar
 * o mesmo item nas duas abas da tela de Conversas).
 */
function listarConversasNaoEntendidas() {
  const db = loadDB();
  return db.ordens
    .filter(os => os.teveRespostaNaoEntendida === true && os.estadoConversaAprovacao !== 'aguardando_humano')
    .sort((a, b) => new Date(b.dataRespostaTermos || b.data) - new Date(a.dataRespostaTermos || a.data))
    .map(comAtraso);
}

/**
 * Lista as OS atualmente aguardando atendimento humano (cliente pediu "1"
 * ou a automação esgotou as tentativas). Aba separada de "Não Entendidas"
 * desde a v40.4.
 */
function listarConversasAguardandoHumano() {
  const db = loadDB();
  return db.ordens
    .filter(os => os.estadoConversaAprovacao === 'aguardando_humano')
    .sort((a, b) => new Date(b.dataRespostaTermos || b.data) - new Date(a.dataRespostaTermos || a.data))
    .map(comAtraso);
}

/**
 * Lista as OS com pagamento pendente de confirmação na retirada — cliente
 * já respondeu pelo WhatsApp qual seria a forma de pagamento
 * (statusPagamento === 'Aguardando Pagamento na Retirada'), mas o
 * pagamento em si ainda não foi confirmado por nenhum meio (nem Mercado
 * Pago, nem presencial via confirmarPagamentoPresencial). Aba nova em
 * Conversas, separada de "Aguardando Humano": aqui a automação de texto já
 * terminou (o cliente já respondeu tudo que precisava); o que falta é só
 * a confirmação do pagamento em si, geralmente pelo operador na loja.
 */
function listarConversasPagamentoNaRetirada() {
  const db = loadDB();
  return db.ordens
    .filter(os => os.statusPagamento === 'Aguardando Pagamento na Retirada')
    .sort((a, b) => new Date(b.dataRespostaTermos || b.data) - new Date(a.dataRespostaTermos || a.data))
    .map(comAtraso);
}

/**
 * Retorna a contagem de OS agrupadas por classificação de resposta,
 * incluindo todas as classificações conhecidas (mesmo com contagem 0)
 * mais um total geral — útil para dashboards da automação.
 */
function contarConversasPorClassificacao() {
  const db = loadDB();
  const contagem = {};
  CLASSIFICACAO_RESPOSTA_VALIDAS.forEach(c => { if (c) contagem[c] = 0; });

  db.ordens.forEach(os => {
    const c = os.classificacaoResposta;
    if (c) contagem[c] = (contagem[c] || 0) + 1;
  });

  return {
    total: db.ordens.length,
    porClassificacao: contagem,
    naoEntendidas: db.ordens.filter(os => os.teveRespostaNaoEntendida === true && os.estadoConversaAprovacao !== 'aguardando_humano').length,
    aguardandoHumano: db.ordens.filter(os => os.estadoConversaAprovacao === 'aguardando_humano').length,
    pagamentoNaRetirada: db.ordens.filter(os => os.statusPagamento === 'Aguardando Pagamento na Retirada').length
  };
}

module.exports.obterOSPorTelefone            = obterOSPorTelefone;
module.exports.registrarRespostaAprovacao    = registrarRespostaAprovacao;
module.exports.registrarFormaPagamento       = registrarFormaPagamento;
module.exports.registrarRespostaNaoEntendida = registrarRespostaNaoEntendida;
module.exports.registrarEscaladoAtendimentoHumano = registrarEscaladoAtendimentoHumano;
module.exports.cancelarAtendimentoHumano         = cancelarAtendimentoHumano;
module.exports.listarConversasPorClassificacao   = listarConversasPorClassificacao;
module.exports.listarConversasNaoEntendidas      = listarConversasNaoEntendidas;
module.exports.listarConversasAguardandoHumano   = listarConversasAguardandoHumano;
module.exports.listarConversasPagamentoNaRetirada = listarConversasPagamentoNaRetirada;
module.exports.contarConversasPorClassificacao   = contarConversasPorClassificacao;

// ═══════════════════════════════════════════════════════════════
// AUTORIZAÇÕES DE DESBLOQUEIO
// ═══════════════════════════════════════════════════════════════
// Este módulo registra somente a autorização e a ciência do cliente. Ele
// deliberadamente não guarda credenciais, códigos, padrões ou instruções de
// bypass. Alterar o conteúdo invalida uma assinatura anterior, impedindo que
// uma assinatura seja reaproveitada em um documento diferente.
function formatarNumeroDesbloqueio(numero) {
  return `DES-${String(Number(numero) || 0).padStart(4, '0')}`;
}

function getPdfDesbloqueioDir() {
  const diretorio = path.join(getRootDir(), 'PDFs-Desbloqueios');
  if (!fs.existsSync(diretorio)) fs.mkdirSync(diretorio, { recursive: true });
  return diretorio;
}

function _validarDadosDesbloqueio(dados) {
  const cliente = dados?.cliente || {};
  const aparelho = dados?.aparelho || {};
  if (!String(cliente.nome || '').trim()) throw new Error('Informe o nome completo do cliente.');
  if (!String(aparelho.marca || '').trim()) throw new Error('Informe a marca do aparelho.');
  if (!String(aparelho.modelo || '').trim()) throw new Error('Informe o modelo do aparelho.');
  if (!String(dados?.tipoBloqueio || '').trim()) throw new Error('Selecione o tipo de bloqueio.');
  if (dados?.declaracaoTitularidade !== true) {
    throw new Error('Confirme a declaração de titularidade antes de gerar o documento.');
  }
}

function _normalizarDesbloqueio(dados, anterior, database) {
  _validarDadosDesbloqueio(dados);
  const cliente = sanitizarValor(dados.cliente || {});
  const aparelho = sanitizarValor(dados.aparelho || {});
  const assinaturaRecebida = String(dados.assinaturaClienteBase64 || '');
  const preservarAssinatura = dados.__preservarAssinatura === true;
  const assinatura = preservarAssinatura ? assinaturaRecebida : '';
  return {
    ...(anterior || {}),
    cliente: {
      ...cliente,
      clienteId: obterOuCriarIdCliente(database, cliente.nome, cliente.cpf, cliente.clienteId)
    },
    aparelho,
    tipoBloqueio: sanitizarValor(String(dados.tipoBloqueio || '').trim()),
    procedimentoPrevisto: sanitizarValor(String(dados.procedimentoPrevisto || '').trim()),
    observacoes: sanitizarValor(String(dados.observacoes || '').trim()),
    valor: Math.max(0, Number(dados.valor) || 0),
    declaracaoTitularidade: true,
    assinaturaClienteBase64: assinatura,
    assinaturaPendente: assinatura ? false : dados.assinaturaPendente === true,
    naoAssinado: assinatura ? false : dados.assinaturaPendente !== true,
    idEnvioAssinatura: anterior?.idEnvioAssinatura || dados.idEnvioAssinatura || '',
    supabaseId: dados.supabaseId || anterior?.supabaseId || '',
    supabaseRevision: Number(dados.supabaseRevision || anterior?.supabaseRevision) || 0,
    supabaseClienteId: dados.supabaseClienteId || anterior?.supabaseClienteId || '',
    origemIdExportacao: dados.origemIdExportacao || anterior?.origemIdExportacao || '',
    supabaseSyncFingerprint: anterior?.supabaseSyncFingerprint || '',
    pdfPath: anterior?.pdfPath || '',
    atualizadoEm: new Date().toISOString()
  };
}

function salvarDesbloqueio(dados) {
  const database = loadDB();
  if (!database.desbloqueios) database.desbloqueios = [];
  if (!database.proximoDesbloqueioId) database.proximoDesbloqueioId = 1;
  const numeroInformado = String(dados?.numero || '').trim();
  const indice = numeroInformado
    ? database.desbloqueios.findIndex(item => item.numero === numeroInformado)
    : -1;
  const anterior = indice >= 0 ? database.desbloqueios[indice] : null;
  const numeroRemotoValido = dados?.supabaseId && /^DES-\d+$/i.test(numeroInformado)
    ? numeroInformado.toUpperCase() : '';
  const numero = anterior?.numero || numeroRemotoValido || formatarNumeroDesbloqueio(database.proximoDesbloqueioId++);
  if (numeroRemotoValido) {
    const sequencialRemoto = Number(numeroRemotoValido.replace(/\D/g, '')) || 0;
    database.proximoDesbloqueioId = Math.max(database.proximoDesbloqueioId, sequencialRemoto + 1);
  }
  const novo = _normalizarDesbloqueio(dados, anterior, database);
  novo.numero = numero;
  novo.criadoEm = anterior?.criadoEm || new Date().toISOString();
  novo.idEnvioAssinatura = anterior?.idEnvioAssinatura || gerarIdEnvioAssinatura('desbloqueio', numero);
  if (indice >= 0) database.desbloqueios[indice] = novo;
  else database.desbloqueios.unshift(novo);
  saveDB(database);
  return novo;
}

function atualizarDesbloqueio(numero, dados, opcoes = {}) {
  const atual = obterDesbloqueio(numero);
  if (!atual) throw new Error(`Autorização ${numero} não encontrada.`);
  return salvarDesbloqueio({
    ...atual,
    ...dados,
    numero,
    __preservarAssinatura: opcoes.preservarAssinatura === true
  });
}

// Importação confirmada pelo servidor: preserva datas/revisão/assinatura e
// adota o número oficial sem gerar uma nova alteração local a cada leitura.
function aplicarDesbloqueioSupabase(dados, numeroAnterior = '') {
  const database = loadDB();
  const lista = database.desbloqueios || (database.desbloqueios = []);
  let indice = lista.findIndex(item => item.supabaseId === dados.supabaseId);
  if (indice < 0 && numeroAnterior) indice = lista.findIndex(item => item.numero === numeroAnterior);
  const anterior = indice >= 0 ? lista[indice] : null;
  const colisao = lista.find(item => item.numero === dados.numero && item !== anterior);
  if (colisao) throw new Error('Número de autorização em uso. Sincronize os documentos locais primeiro.');
  const novo = _normalizarDesbloqueio({ ...dados, __preservarAssinatura: true }, anterior, database);
  Object.assign(novo, {
    numero: dados.numero, criadoEm: dados.criadoEm, atualizadoEm: dados.atualizadoEm,
    idEnvioAssinatura: dados.idEnvioAssinatura || anterior?.idEnvioAssinatura || '',
    supabaseSyncFingerprint: dados.supabaseSyncFingerprint || '',
    pdfPath: anterior?.pdfPath || ''
  });
  if (indice >= 0) lista[indice] = novo; else lista.unshift(novo);
  database.proximoDesbloqueioId = Math.max(database.proximoDesbloqueioId || 1, Number(dados.numero.replace(/\D/g, '')) + 1);
  saveDB(database);
  return novo;
}

function listarDesbloqueios() {
  return (loadDB().desbloqueios || []).slice().sort((a, b) =>
    String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
}

function obterDesbloqueio(numero) {
  return (loadDB().desbloqueios || []).find(item => item.numero === String(numero || '').trim()) || null;
}

function excluirDesbloqueio(numero) {
  const database = loadDB();
  const alvo = (database.desbloqueios || []).find(item => item.numero === numero);
  if (!alvo) return { sucesso: false, erro: 'Autorização não encontrada.' };
  database.desbloqueios = database.desbloqueios.filter(item => item.numero !== numero);
  saveDB(database);
  try { if (alvo.pdfPath && fs.existsSync(alvo.pdfPath)) fs.unlinkSync(alvo.pdfPath); } catch (_) {}
  return { sucesso: true, removido: alvo };
}

function atualizarCaminhoPdfDesbloqueio(numero, pdfPath) {
  const database = loadDB();
  const item = (database.desbloqueios || []).find(registro => registro.numero === numero);
  if (!item) return false;
  item.pdfPath = pdfPath;
  saveDB(database);
  return true;
}

module.exports.salvarDesbloqueio = salvarDesbloqueio;
module.exports.atualizarDesbloqueio = atualizarDesbloqueio;
module.exports.aplicarDesbloqueioSupabase = aplicarDesbloqueioSupabase;
module.exports.listarDesbloqueios = listarDesbloqueios;
module.exports.obterDesbloqueio = obterDesbloqueio;
module.exports.excluirDesbloqueio = excluirDesbloqueio;
module.exports.atualizarCaminhoPdfDesbloqueio = atualizarCaminhoPdfDesbloqueio;
module.exports.getPdfDesbloqueioDir = getPdfDesbloqueioDir;

// ═══════════════════════════════════════════════════════════════
// SEÇÃO: ZERAR SISTEMA (reset completo de dados transacionais)
// ═══════════════════════════════════════════════════════════════
// Apaga TODOS os dados operacionais (OS, orçamentos, estoque, peças,
// compras, pagamentos, reembolsos, cobranças, logs e contadores),
// preservando config, usuários e cargos. É irreversível pelo próprio
// sistema — por isso o chamador (main.js) exige backup automático
// prévio e confirmação por senha de exclusão antes de invocar isto.
function zerarSistema() {
  const db = loadDB();

  const zerado = Object.assign({}, db, {
    // Contadores voltam ao início
    proximoNumero: 1,
    proximoEstoqueId: 1,
    proximoPecaId: 1,
    proximoCompraId: 1,
    proximoOrcId: 1,
    proximoDesbloqueioId: 1,

    // Dados transacionais — todos apagados
    ordens: [],
    orcamentos: [],
    estoque: [],
    pecas: [],
    modelosCadastrados: [],
    compras: [],
    pagamentos: [],
    reembolsos: [],
    cobrancas: [],
    historicoExclusoes: [],
    logEstoque: [],
    logPecas: [],
    logMensagensWapp: [],
    // App Celular — aba Entregas: mesmo tratamento de dado transacional
    // que ordens/compras/estoque acima.
    entregas: [],
    entregasPendentes: [],
    // Aba Garantia: mesmo tratamento de dado transacional.
    garantias: [],
    desbloqueios: [],
    // Log de classificação por IA
    logIA: []

    // Preservados intencionalmente: versao, config, usuarios, cargos,
    // proximoUsuarioId, proximoCargoId
  });

  saveDB(zerado);
  return {
    sucesso: true,
    data: new Date().toISOString()
  };
}
module.exports.zerarSistema = zerarSistema;

// App Celular — aba Entregas (garantia)
module.exports.criarOuSubstituirEntrega = criarOuSubstituirEntrega;
module.exports.editarEntrega = editarEntrega;
module.exports.listarEntregas = listarEntregas;
module.exports.listarEntregasPorNumeroOS = listarEntregasPorNumeroOS;
module.exports.obterEntregaPorNumeroOS = obterEntregaPorNumeroOS;
module.exports.atualizarCaminhoPdfEntrega = atualizarCaminhoPdfEntrega;
module.exports.excluirEntrega = excluirEntrega;
module.exports.getPdfEntregaDir = getPdfEntregaDir;

// Bloco 3 — Nova Entrega criada no PC (fila de pendentes de assinatura)
module.exports.criarEntregaPendente = criarEntregaPendente;
module.exports.criarEntregaNaoAssinada = criarEntregaNaoAssinada;
module.exports.listarEntregasPendentes = listarEntregasPendentes;
module.exports.obterEntregaPendentePorNumeroOS = obterEntregaPendentePorNumeroOS;
module.exports.obterEntregaPendentePorIdEnvio = obterEntregaPendentePorIdEnvio;
module.exports.excluirEntregaPendente = excluirEntregaPendente;
module.exports.gerarPacoteEntregaParaAssinar = gerarPacoteEntregaParaAssinar;
module.exports.importarRespostaAssinaturaEntrega = importarRespostaAssinaturaEntrega;

// Aba Garantia (criada manualmente no PC)
module.exports.criarOuAtualizarGarantia = criarOuAtualizarGarantia;
module.exports.receberGarantiaRemota = receberGarantiaRemota;
module.exports.listarGarantias = listarGarantias;
module.exports.obterGarantiaPorNumeroOS = obterGarantiaPorNumeroOS;
module.exports.atualizarCaminhoPdfGarantia = atualizarCaminhoPdfGarantia;
module.exports.excluirGarantia = excluirGarantia;
module.exports.getPdfGarantiaDir = getPdfGarantiaDir;
module.exports.registrarRetornoGarantia = registrarRetornoGarantia;
module.exports.atualizarStatusRetornoGarantia = atualizarStatusRetornoGarantia;
module.exports.STATUS_RETORNO_GARANTIA_VALIDOS = STATUS_RETORNO_GARANTIA_VALIDOS;
