// src/licenca.js — Etapa 11.1 — Estrutura de Licenciamento
//
// IMPORTANTE: Esta etapa NÃO implementa validação online.
// A licença é salva localmente junto com os dados da instalação.
// Validação online será implementada em etapa futura.
//
// A chave de licença ficará em:
//   Documents/Sistema OS/licenca.json

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// Versão real do app, lida do package.json (mesma fonte de verdade usada
// por src/atualizador-github.js e main.js) — evita manter uma string de versão
// hardcoded aqui que diverge silenciosamente a cada release.
function versaoSistemaAtual() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

// ─── Tipos de licença disponíveis ────────────────────────────
const TIPOS_LICENCA = {
  TRIAL:      'trial',       // Avaliação (30 dias, funcionalidades completas)
  BASICO:     'basico',      // Licença básica — 1 instalação
  PROFISSIONAL: 'profissional', // Licença profissional — funcionalidades extras futuras
  VITALICIO:  'vitalicio'    // Licença permanente
};

const STATUS_LICENCA = {
  ATIVA:      'ativa',
  EXPIRADA:   'expirada',
  NAO_ATIVADA: 'nao_ativada',
  BLOQUEADA:  'bloqueada'
};

// ─── Caminhos ────────────────────────────────────────────────
function getRootDir() {
  const root = path.join(app.getPath('documents'), 'Sistema OS');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function getLicencaPath() {
  return path.join(getRootDir(), 'licenca.json');
}

// ─── Licença padrão (não ativada / trial) ────────────────────
function getLicencaPadrao() {
  return {
    status:         STATUS_LICENCA.NAO_ATIVADA,
    tipo:           TIPOS_LICENCA.TRIAL,
    chave:          null,
    dataAtivacao:   null,
    dataExpiracao:  null,
    titular:        null,        // nome da empresa/pessoa licenciada
    cnpjCpf:        null,        // CNPJ ou CPF do titular
    instalacaoId:   gerarIdInstalacao(),
    versaoSistema:  versaoSistemaAtual(),
    observacoes:    null
  };
}

// ─── ID único por instalação ─────────────────────────────────
// Gerado uma vez e persistido na licenca.json.
// Permite identificar a instalação sem conexão com servidor.
function gerarIdInstalacao() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segmentos = [4, 4, 4, 4];
  return segmentos
    .map(n => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join(''))
    .join('-');
}

// ─── Leitura da licença ──────────────────────────────────────
function carregarLicenca() {
  const caminho = getLicencaPath();
  if (!fs.existsSync(caminho)) {
    const nova = getLicencaPadrao();
    salvarLicenca(nova);
    return nova;
  }
  try {
    const dados = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    // Garantir que todos os campos existam (migração futura).
    // getLicencaPadrao() gera um instalacaoId aleatório — o spread de
    // dados sobrescreve com o ID real salvo no arquivo, preservando-o.
    return { ...getLicencaPadrao(), ...dados };
  } catch {
    // Arquivo corrompido: gera uma nova licença padrão E SALVA imediatamente,
    // assim o instalacaoId fica estável em vez de se regenerar a cada leitura.
    console.error('[Licença] licenca.json corrompido — redefinindo para padrão.');
    const nova = getLicencaPadrao();
    salvarLicenca(nova);
    return nova;
  }
}

// ─── Gravação da licença ─────────────────────────────────────
function salvarLicenca(licenca) {
  fs.writeFileSync(getLicencaPath(), JSON.stringify(licenca, null, 2), 'utf8');
  return licenca;
}

// ─── Ativar licença ──────────────────────────────────────────
// Por enquanto salva localmente sem validar no servidor.
// A chave de ativação tem formato: XXXX-XXXX-XXXX-XXXX
function ativarLicenca({ chave, tipo, titular, cnpjCpf, dataExpiracao }) {
  if (!chave || chave.trim().length < 10) {
    return { sucesso: false, erro: 'Chave de ativação inválida.' };
  }

  const chaveLimpa = chave.trim().toUpperCase();
  const licencaAtual = carregarLicenca();

  const licencaAtivada = {
    ...licencaAtual,
    status:        STATUS_LICENCA.ATIVA,
    tipo:          tipo || TIPOS_LICENCA.BASICO,
    chave:         chaveLimpa,
    dataAtivacao:  new Date().toISOString(),
    dataExpiracao: dataExpiracao || null,  // null = sem expiração
    titular:       titular || null,
    cnpjCpf:       cnpjCpf || null,
    versaoSistema: versaoSistemaAtual()
  };

  salvarLicenca(licencaAtivada);
  return { sucesso: true, licenca: licencaAtivada };
}

// ─── Verificar status da licença ─────────────────────────────
function verificarLicenca() {
  const licenca = carregarLicenca();

  // Se ativa mas tem data de expiração, checar
  if (licenca.status === STATUS_LICENCA.ATIVA && licenca.dataExpiracao) {
    const expira = new Date(licenca.dataExpiracao);
    if (expira < new Date()) {
      licenca.status = STATUS_LICENCA.EXPIRADA;
      salvarLicenca(licenca);
    }
  }

  // Trial: verificar 30 dias desde criação do instalacaoId
  // (lógica simplificada — sem data de criação do trial por ora)
  // Implementar controle de dias de trial em etapa futura.

  return {
    status:       licenca.status,
    tipo:         licenca.tipo,
    titular:      licenca.titular,
    dataAtivacao: licenca.dataAtivacao,
    expirada:     licenca.status === STATUS_LICENCA.EXPIRADA,
    ativa:        licenca.status === STATUS_LICENCA.ATIVA,
    instalacaoId: licenca.instalacaoId
  };
}

// ─── Obter dados completos da licença (para tela de ativação) ─
function obterLicenca() {
  return carregarLicenca();
}

// ─── Desativar / resetar licença ─────────────────────────────
function resetarLicenca() {
  const atual = carregarLicenca();
  const reset = {
    ...getLicencaPadrao(),
    instalacaoId: atual.instalacaoId  // manter o mesmo ID de instalação
  };
  salvarLicenca(reset);
  return reset;
}

module.exports = {
  TIPOS_LICENCA,
  STATUS_LICENCA,
  carregarLicenca,
  salvarLicenca,
  ativarLicenca,
  verificarLicenca,
  obterLicenca,
  resetarLicenca,
  getLicencaPath
};
