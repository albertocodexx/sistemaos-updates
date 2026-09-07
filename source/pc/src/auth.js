// src/auth.js — Etapa 11.2 (Login) + Etapa 11.3 (Cargos e Permissões)
// ═══════════════════════════════════════════════════════════════
// Módulo de autenticação e controle de acesso totalmente offline.
// Hashing com PBKDF2 (Node crypto nativo — sem dependências externas).
// Todas as operações de persistência passam por db.js.
// ═══════════════════════════════════════════════════════════════

const crypto = require('crypto');
const db     = require('./db');

// ── Constantes ───────────────────────────────────────────────
const STATUS_USUARIO_VALIDOS = ['ativo', 'bloqueado', 'inativo'];
const ITERACOES_SENHA_ATUAIS = 210_000;
const MAX_TENTATIVAS_LOGIN = 5;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
const tentativasLogin = new Map();

// Módulos controláveis por permissão (Etapa 11.3)
const MODULOS = ['os', 'clientes', 'estoque', 'financeiro', 'relatorios', 'configuracoes', 'usuarios'];

const MODULOS_LABEL = {
  os:             'Ordens de Serviço',
  clientes:       'Clientes',
  estoque:        'Estoque',
  financeiro:     'Financeiro',
  relatorios:     'Relatórios',
  configuracoes:  'Configurações',
  usuarios:       'Usuários',
};

// IDs fixos dos cargos de fábrica — usados pra bootstrap e migração
const CARGO_ADMIN_ID     = 'CARGO-ADMIN';
const CARGO_GERENTE_ID   = 'CARGO-GERENTE';
const CARGO_TECNICO_ID   = 'CARGO-TECNICO';
const CARGO_ATENDENTE_ID = 'CARGO-ATENDENTE';

function _permissoesVazias(valor) {
  return MODULOS.reduce((acc, m) => { acc[m] = valor; return acc; }, {});
}

const CARGOS_PADRAO = [
  {
    id: CARGO_ADMIN_ID,
    nome: 'Administrador',
    admin: true,                       // ignora restrições — regra da Etapa 11.3
    sistema: true,
    permissoes: _permissoesVazias(true),
  },
  {
    id: CARGO_GERENTE_ID,
    nome: 'Gerente',
    admin: false,
    sistema: true,
    permissoes: _permissoesVazias(true), // por padrão acesso total, mas editável (exceto Admin)
  },
  {
    id: CARGO_TECNICO_ID,
    nome: 'Técnico',
    admin: false,
    sistema: true,
    permissoes: { os: true, clientes: true, estoque: true, financeiro: false, relatorios: true, configuracoes: false, usuarios: false },
  },
  {
    id: CARGO_ATENDENTE_ID,
    nome: 'Atendente',
    admin: false,
    sistema: true,
    permissoes: { os: true, clientes: true, estoque: false, financeiro: false, relatorios: false, configuracoes: false, usuarios: false },
  },
];

// ─────────────────────────────────────────────────────────────
// SEÇÃO: HASHING DE SENHA  (PBKDF2 + salt aleatório)
// ─────────────────────────────────────────────────────────────
function gerarSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashSenha(senha, salt, iteracoes = ITERACOES_SENHA_ATUAIS) {
  return crypto.pbkdf2Sync(senha, salt, iteracoes, 64, 'sha512').toString('hex');
}

function verificarSenha(senha, hashSalvo, salt, iteracoes = 100_000) {
  const hashNovo = hashSenha(senha, salt, iteracoes);
  // timingSafeEqual evita timing attacks
  const a = Buffer.from(hashSalvo, 'hex');
  const b = Buffer.from(hashNovo,  'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function chaveTentativaLogin(usuario) {
  return crypto.createHash('sha256').update(String(usuario || '').trim().toLowerCase()).digest('hex');
}

function obterTentativaAtiva(chave) {
  const estado = tentativasLogin.get(chave);
  if (!estado) return null;
  if (Date.now() - estado.inicio >= JANELA_TENTATIVAS_MS) {
    tentativasLogin.delete(chave);
    return null;
  }
  return estado;
}

function registrarFalhaLogin(chave) {
  const atual = obterTentativaAtiva(chave) || { inicio: Date.now(), falhas: 0 };
  atual.falhas += 1;
  tentativasLogin.set(chave, atual);
  return atual;
}

function validarSenhaNova(senha) {
  const valor = String(senha || '');
  if (valor.length < 10 || valor.length > 128) {
    throw new Error('A senha deve ter entre 10 e 128 caracteres.');
  }
  if (!/[a-z]/.test(valor) || !/[A-Z]/.test(valor) || !/\d/.test(valor)) {
    throw new Error('Use ao menos uma letra maiuscula, uma minuscula e um numero.');
  }
}

// ─────────────────────────────────────────────────────────────
// SEÇÃO: BOOTSTRAP  (garante cargos padrão + ao menos 1 admin)
// ─────────────────────────────────────────────────────────────

/**
 * Chamado uma vez no startup (main.js).
 * Cria os 4 cargos de fábrica caso ainda não existam.
 */
function garantirCargosPadrao() {
  const existentes = db.listarCargos();
  for (const cargo of CARGOS_PADRAO) {
    if (!existentes.find(c => c.id === cargo.id)) {
      db.criarCargo(cargo);
    }
  }
}

/**
 * Chamado uma vez no startup (main.js), depois de garantirCargosPadrao().
 * Instalações comerciais não recebem credenciais locais padrão. Usuários
 * antigos são mantidos apenas para migração segura dos dados já existentes.
 */
function garantirAdminPadrao() {
  garantirCargosPadrao();

  const lista = db.listarUsuarios();
  if (lista.length > 0) {
    // Migração: usuários da Etapa 11.2 que ainda não têm cargoId
    for (const u of lista) {
      if (!u.cargoId) {
        const cargoId = u.perfil === 'admin' ? CARGO_ADMIN_ID : CARGO_ATENDENTE_ID;
        db.atualizarUsuario(u.id, { ...u, cargoId });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SEÇÃO: PERMISSÕES
// ─────────────────────────────────────────────────────────────

/** Resolve o cargo de um usuário (objeto completo). */
function _cargoDoUsuario(u) {
  if (!u) return null;
  return db.obterCargoPorId(u.cargoId) || null;
}

/** Retorna { admin, cargoNome, permissoes } prontos pra mandar pro renderer. */
function resolverPermissoes(u) {
  const cargo = _cargoDoUsuario(u);
  if (!cargo) {
    // Sem cargo resolvido (estado inconsistente) — acesso mínimo por segurança
    return { admin: false, cargoId: null, cargoNome: 'Sem cargo', permissoes: _permissoesVazias(false) };
  }
  return {
    admin:     !!cargo.admin,
    cargoId:   cargo.id,
    cargoNome: cargo.nome,
    permissoes: cargo.admin ? _permissoesVazias(true) : Object.assign(_permissoesVazias(false), cargo.permissoes),
  };
}

/** Checa se um usuário (objeto do banco) tem permissão num módulo. Admin sempre true. */
function temPermissao(usuarioDb, modulo) {
  const r = resolverPermissoes(usuarioDb);
  if (r.admin) return true;
  return !!r.permissoes[modulo];
}

// ─────────────────────────────────────────────────────────────
// SEÇÃO: AUTENTICAÇÃO
// ─────────────────────────────────────────────────────────────
/**
 * Verifica usuário e senha.
 * Retorna { sucesso, usuario? } ou { sucesso: false, erro }.
 */
function autenticar(usuario, senha) {
  if (!usuario || !senha) return { sucesso: false, erro: 'Informe usuário e senha.' };

  const login = usuario.trim().toLowerCase();
  const chave = chaveTentativaLogin(login);
  const limite = obterTentativaAtiva(chave);
  if (limite?.falhas >= MAX_TENTATIVAS_LOGIN) {
    return { sucesso: false, erro: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' };
  }

  const u = db.obterUsuarioPorLogin(login);
  const iteracoes = Number(u?.senhaIteracoes || 100_000);
  const credenciaisValidas = !!(u && u.status === 'ativo'
    && verificarSenha(senha, u.senhaHash, u.senhaSalt, iteracoes));
  if (!credenciaisValidas) {
    registrarFalhaLogin(chave);
    return { sucesso: false, erro: 'Credenciais inválidas.' };
  }

  tentativasLogin.delete(chave);
  if (iteracoes < ITERACOES_SENHA_ATUAIS) {
    const novoSalt = gerarSalt();
    db.atualizarUsuario(u.id, {
      ...u,
      senhaHash: hashSenha(senha, novoSalt),
      senhaSalt: novoSalt,
      senhaIteracoes: ITERACOES_SENHA_ATUAIS
    });
  }

  db.registrarLogin(u.id);

  const perm = resolverPermissoes(u);

  return {
    sucesso: true,
    usuario: {
      id:      u.id,
      usuario: u.usuario,
      nome:    u.nome,
      perfil:  u.perfil, // mantido por compatibilidade visual
      ...perm,
    },
  };
}

/**
 * Revalida uma sessão persistida (Etapa 11.2/11.3 — bugfix).
 * Chamado ao restaurar a sessão do localStorage, pra garantir que
 * bloqueio/desativação/mudança de cargo feitos por um admin enquanto
 * o usuário estava logado tenham efeito imediato no próximo carregamento,
 * em vez de só no próximo login manual.
 * Retorna os dados atualizados do usuário, ou null se a sessão não é mais válida.
 */
function revalidarSessao(id) {
  if (!id) return null;
  const u = db.obterUsuarioPorId(id);
  if (!u) return null;
  if (u.status !== 'ativo') return null;

  const perm = resolverPermissoes(u);
  return {
    id:      u.id,
    usuario: u.usuario,
    nome:    u.nome,
    perfil:  u.perfil,
    ...perm,
  };
}

// ─────────────────────────────────────────────────────────────
// SEÇÃO: CRUD DE USUÁRIOS
// ─────────────────────────────────────────────────────────────

/** Cria usuário manualmente (admin define os dados). */
function criarUsuario(dados) {
  const { usuario, nome, cargoId, senha } = dados;

  if (!usuario?.trim())  throw new Error('Nome de usuário é obrigatório.');
  if (!nome?.trim())     throw new Error('Nome completo é obrigatório.');

  const cargoFinal = cargoId || CARGO_ATENDENTE_ID;
  if (!db.obterCargoPorId(cargoFinal)) throw new Error('Cargo inválido.');

  const loginNorm = usuario.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(loginNorm)) {
    throw new Error('Login deve ter 3–30 caracteres (letras, números, . _ -).');
  }

  if (db.obterUsuarioPorLogin(loginNorm)) throw new Error('Nome de usuário já existe.');

  // Se não vier senha, gera uma temporária
  const senhaFinal = senha?.trim() || (crypto.randomBytes(9).toString('base64url') + 'Aa1');
  validarSenhaNova(senhaFinal);
  const salt       = gerarSalt();
  const cargo      = db.obterCargoPorId(cargoFinal);

  const criado = db.criarUsuario({
    usuario:              loginNorm,
    nome:                 nome.trim(),
    perfil:               cargo.admin ? 'admin' : 'operador',
    cargoId:              cargoFinal,
    senhaHash:            hashSenha(senhaFinal, salt),
    senhaSalt:            salt,
    senhaIteracoes:       ITERACOES_SENHA_ATUAIS,
    status:               'ativo',
    geradoAutomaticamente: !senha?.trim(),
    trocaSenhaObrigatoria: !senha?.trim(),
  });

  return {
    ..._semCamposSensiveis(criado),
    senhaTemporaria: !senha?.trim() ? senhaFinal : undefined,
  };
}

/** Gera usuário automaticamente (login e senha aleatórios). */
function gerarUsuarioAutomatico(cargoId) {
  const cargoFinal = cargoId || CARGO_ATENDENTE_ID;
  const cargo = db.obterCargoPorId(cargoFinal);
  if (!cargo) throw new Error('Cargo inválido.');

  const base      = 'user' + Date.now().toString(36);
  const senhaTmp  = crypto.randomBytes(9).toString('base64url') + 'Aa1';
  const salt      = gerarSalt();

  const criado = db.criarUsuario({
    usuario:              base,
    nome:                 'Usuário ' + base.toUpperCase(),
    perfil:               cargo.admin ? 'admin' : 'operador',
    cargoId:              cargoFinal,
    senhaHash:            hashSenha(senhaTmp, salt),
    senhaSalt:            salt,
    senhaIteracoes:       ITERACOES_SENHA_ATUAIS,
    status:               'ativo',
    geradoAutomaticamente: true,
    trocaSenhaObrigatoria: true,
  });

  return { ..._semCamposSensiveis(criado), senhaTemporaria: senhaTmp };
}

/** Exclui permanentemente um usuário.
 *  Não pode excluir a si mesmo nem o último admin ativo. */
function excluirUsuario(id, solicitanteId) {
  if (!id) throw new Error('ID inválido.');
  if (id === solicitanteId) throw new Error('Você não pode excluir sua própria conta.');

  const u = db.obterUsuarioPorId(id);
  if (!u) throw new Error('Usuário não encontrado.');

  const cargo = db.obterCargoPorId(u.cargoId);
  if (cargo?.admin) {
    const outrosAdmins = db.listarUsuarios().filter(x => {
      const c = db.obterCargoPorId(x.cargoId);
      return c?.admin && x.status === 'ativo' && x.id !== id;
    });
    if (!outrosAdmins.length) throw new Error('Não é possível excluir o único administrador ativo.');
  }

  if (!db.excluirUsuario(id)) throw new Error('Não foi possível excluir o usuário.');
  return true;
}

/** Edita nome, cargo e/ou senha de um usuário. */
function editarUsuario(id, dados) {
  const u = db.obterUsuarioPorId(id);
  if (!u) throw new Error('Usuário não encontrado.');

  const atualizado = { ...u };

  if (dados.nome?.trim())  atualizado.nome = dados.nome.trim();

  if (dados.novoLogin?.trim()) {
    const novoLogin = dados.novoLogin.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(novoLogin)) throw new Error('Login inválido: use 3–30 caracteres (letras, números, . _ -).');
    // Verifica unicidade — não pode conflitar com outro usuário
    const existente = db.obterUsuarioPorLogin(novoLogin);
    if (existente && existente.id !== id) throw new Error(`O login "${novoLogin}" já está em uso.`);
    atualizado.usuario = novoLogin;
  }

  if (dados.cargoId) {
    const novoCargo = db.obterCargoPorId(dados.cargoId);
    if (!novoCargo) throw new Error('Cargo inválido.');

    // Não pode rebaixar o último admin ativo
    const cargoAtual = db.obterCargoPorId(u.cargoId);
    if (cargoAtual?.admin && !novoCargo.admin) {
      const outrosAdmins = db.listarUsuarios().filter(x => {
        const c = db.obterCargoPorId(x.cargoId);
        return c?.admin && x.status === 'ativo' && x.id !== id;
      });
      if (!outrosAdmins.length) throw new Error('Não é possível rebaixar o único administrador ativo.');
    }

    atualizado.cargoId = dados.cargoId;
    atualizado.perfil  = novoCargo.admin ? 'admin' : 'operador';
  }

  if (dados.novaSenha?.trim()) {
    validarSenhaNova(dados.novaSenha.trim());
    const salt       = gerarSalt();
    atualizado.senhaHash = hashSenha(dados.novaSenha.trim(), salt);
    atualizado.senhaSalt = salt;
    atualizado.senhaIteracoes = ITERACOES_SENHA_ATUAIS;
    atualizado.trocaSenhaObrigatoria = false;
  }

  return _semCamposSensiveis(db.atualizarUsuario(id, atualizado));
}

/** Altera status de um usuário (ativo / bloqueado / inativo). */
function alterarStatus(id, status) {
  if (!STATUS_USUARIO_VALIDOS.includes(status)) throw new Error('Status inválido.');

  const u = db.obterUsuarioPorId(id);
  if (!u) throw new Error('Usuário não encontrado.');

  // Protege o último admin ativo
  const cargo = db.obterCargoPorId(u.cargoId);
  if ((status === 'bloqueado' || status === 'inativo') && cargo?.admin) {
    const outrosAdmins = db.listarUsuarios().filter(x => {
      const c = db.obterCargoPorId(x.cargoId);
      return c?.admin && x.status === 'ativo' && x.id !== id;
    });
    if (!outrosAdmins.length) throw new Error('Não é possível remover o único administrador ativo.');
  }

  return _semCamposSensiveis(db.atualizarUsuario(id, { ...u, status }));
}

/** Retorna lista de usuários sem dados sensíveis (sem hash/salt), com cargo resolvido. */
function listarUsuarios() {
  return db.listarUsuarios().map(u => {
    const cargo = db.obterCargoPorId(u.cargoId);
    return {
      ..._semCamposSensiveis(u),
      cargoNome: cargo ? cargo.nome : '—',
    };
  });
}

// ─────────────────────────────────────────────────────────────
// SEÇÃO: CRUD DE CARGOS (Etapa 11.3)
// ─────────────────────────────────────────────────────────────

function listarCargos() {
  return db.listarCargos().map(c => ({
    ...c,
    qtdUsuarios: db.contarUsuariosComCargo(c.id),
  }));
}

function _validarPermissoes(permissoes) {
  const limpo = {};
  for (const m of MODULOS) limpo[m] = !!(permissoes && permissoes[m]);
  return limpo;
}

/** Cria um cargo personalizado. */
function criarCargo(dados) {
  const nome = (dados.nome || '').trim();
  if (!nome) throw new Error('Nome do cargo é obrigatório.');
  if (nome.length > 40) throw new Error('Nome do cargo muito longo.');

  const existente = db.listarCargos().find(c => c.nome.toLowerCase() === nome.toLowerCase());
  if (existente) throw new Error('Já existe um cargo com esse nome.');

  return db.criarCargo({
    nome,
    admin: false,             // só o Administrador de fábrica pode ter bypass total
    sistema: false,           // cargo personalizado pode ser editado/excluído
    permissoes: _validarPermissoes(dados.permissoes),
  });
}

/** Edita nome e/ou permissões de um cargo. O cargo Administrador é fixo (não editável). */
function editarCargo(id, dados) {
  const cargo = db.obterCargoPorId(id);
  if (!cargo) throw new Error('Cargo não encontrado.');
  if (cargo.admin) throw new Error('O cargo Administrador não pode ser alterado — ele sempre tem acesso total.');

  const atualizado = { ...cargo };
  if (dados.nome?.trim()) {
    const nome = dados.nome.trim();
    const conflito = db.listarCargos().find(c => c.id !== id && c.nome.toLowerCase() === nome.toLowerCase());
    if (conflito) throw new Error('Já existe um cargo com esse nome.');
    atualizado.nome = nome;
  }
  if (dados.permissoes) {
    atualizado.permissoes = _validarPermissoes(dados.permissoes);
  }

  return db.atualizarCargo(id, atualizado);
}

/** Exclui um cargo personalizado (cargos de sistema e cargos em uso não podem ser excluídos). */
function excluirCargo(id) {
  const cargo = db.obterCargoPorId(id);
  if (!cargo) throw new Error('Cargo não encontrado.');
  if (cargo.sistema) throw new Error('Cargos padrão do sistema não podem ser excluídos.');

  const emUso = db.contarUsuariosComCargo(id);
  if (emUso > 0) throw new Error(`Este cargo está em uso por ${emUso} usuário(s). Mude o cargo deles antes de excluir.`);

  db.excluirCargo(id);
  return true;
}

// ─────────────────────────────────────────────────────────────
// SEÇÃO: HELPERS PRIVADOS
// ─────────────────────────────────────────────────────────────
function _semCamposSensiveis(u) {
  if (!u) return null;
  const { senhaHash, senhaSalt, senhaIteracoes, ...publico } = u;
  return publico;
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────
module.exports = {
  garantirAdminPadrao,
  garantirCargosPadrao,
  autenticar,
  revalidarSessao,
  criarUsuario,
  gerarUsuarioAutomatico,
  editarUsuario,
  alterarStatus,
  listarUsuarios,
  temPermissao,
  resolverPermissoes,
  // Cargos (Etapa 11.3)
  listarCargos,
  criarCargo,
  editarCargo,
  excluirCargo,
  excluirUsuario,
  MODULOS,
  MODULOS_LABEL,
  CARGO_ADMIN_ID,
  STATUS_USUARIO_VALIDOS,
};
