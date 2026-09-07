const os = require('os');
const { DesktopStateStore } = require('./desktop-state-store');
const { SecureSessionStore } = require('./secure-session-store');
const { SupabaseFileService } = require('./file-service');
const { CompanyCloudService } = require('./company-cloud-service');
const { InventoryService } = require('./inventory-service');
const { PriceTableService } = require('./price-table-service');
const { AftercareService } = require('./aftercare-service');
const { DesbloqueioCloudService } = require('./desbloqueio-cloud-service');
const { localParaSupabase, remotoParaLocal } = require('./os-mapper');
const { mesclarExtrasCobranca } = require('./cobrancas-sync');
const SUPABASE_PUBLIC_CONFIG = require('./public-config');
const APP_VERSION = require('../../package.json').version;
const CHAVE_TROCA_CONTA_PENDENTE = '__sistema_os_troca_conta_pendente_v1__';
const CHAVE_TROCA_CONTA_ERRO = '__sistema_os_troca_conta_erro_v1__';
const TAMANHO_PAGINA_OS = 500;
const SOBREPOSICAO_CURSOR_OS_MS = 10000;
const INTERVALO_RECONCILIACAO_OS_COMPLETA_MS = 6 * 60 * 60 * 1000;

const CAMPOS_PULL_OS = [
  'id', 'numero', 'numero_sequencial', 'id_exportacao',
  'cliente_nome_snapshot', 'cliente_telefone_snapshot', 'cliente_cpf_snapshot',
  'aparelho', 'marca', 'modelo', 'cor', 'imei', 'senha_aparelho', 'acessorios',
  'estado_aparelho', 'defeito_relatado', 'diagnostico', 'servico_realizado',
  'observacoes', 'termos', 'status', 'prioridade', 'valor', 'forma_pagamento',
  'status_pagamento', 'garantia_dias', 'data_abertura', 'data_prevista',
  'hora_prevista', 'data_conclusao', 'origem', 'revision', 'dados_extras',
  'created_at', 'updated_at', 'deleted_at'
].join(',');

const CAMPOS_PULL_COMPRA = [
  'id', 'numero', 'id_exportacao', 'revision', 'dados_extras',
  'created_at', 'updated_at', 'deleted_at'
].join(',');
const CAMPOS_PULL_VENDA = CAMPOS_PULL_COMPRA;
const CAMPOS_PULL_ENTREGA = [
  'id', 'numero_os_snapshot', 'id_exportacao', 'revision', 'valor_reparo',
  'forma_pagamento', 'ciclo_entrega_id', 'tipo_entrega', 'retorno_garantia_id',
  'garantia_id', 'dados_extras', 'created_at', 'updated_at', 'deleted_at'
].join(',');

function primeiraLinha(data) {
  return Array.isArray(data) ? data[0] : data;
}

function mensagemErro(erro) {
  if (typeof erro === 'string' && erro.trim()) return erro.trim();
  if (erro && typeof erro === 'object') {
    for (const chave of ['erro', 'mensagem', 'message', 'error_description', 'details', 'hint']) {
      const valor = erro[chave];
      if (typeof valor === 'string' && valor.trim()) return valor.trim();
    }
    try {
      const serializado = JSON.stringify(erro);
      if (serializado && serializado !== '{}') return serializado;
    } catch (_) { /* usa a mensagem segura abaixo */ }
  }
  const texto = String(erro || '').trim();
  return texto && texto !== '[object Object]' && texto !== '{}'
    ? texto
    : 'Não foi possível concluir a operação. Tente novamente.';
}

function comTempoLimite(promessa, limiteMs = 20000, codigo = 'TEMPO_LIMITE_SERVIDOR') {
  let temporizador;
  return Promise.race([
    Promise.resolve(promessa),
    new Promise((_, rejeitar) => {
      temporizador = setTimeout(() => rejeitar(new Error(codigo)), limiteMs);
    })
  ]).finally(() => clearTimeout(temporizador));
}

function traduzirErroLogin(mensagem) {
  const texto = String(mensagem || '').trim();
  const normalizado = texto.toLowerCase();
  if (/servi[cç]o (?:de dados|de autentica[cç][aã]o) temporariamente indispon[ií]vel|servico_(?:dados|auth)_indisponivel|pgrst00[02]|schema cache|service unavailable|http 50[23]/.test(normalizado)) {
    return 'O servidor está temporariamente sobrecarregado. Aguarde alguns instantes e tente novamente.';
  }
  if (/credenciais inv[aá]lidas|invalid login credentials|invalid credentials/.test(normalizado)) {
    return 'Empresa, usuário ou senha incorretos.';
  }
  if (/usu[aá]rio (?:inativo|bloqueado)|user.*(?:inactive|blocked)/.test(normalizado)) {
    return 'Este usuário está bloqueado. Fale com o administrador da empresa.';
  }
  if (/empresa (?:inativa|bloqueada)|company.*(?:inactive|blocked)/.test(normalizado)) {
    return 'O acesso desta empresa está bloqueado. Fale com o suporte.';
  }
  if (/licen[cç]a.*(?:bloqueada|vencida|expirada)|license.*(?:blocked|expired)/.test(normalizado)) {
    return 'A licença da empresa está vencida ou bloqueada. Fale com o suporte.';
  }
  if (/rate limit|too many|muitas tentativas/.test(normalizado)) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }
  if (/tempo_limite_servidor/.test(normalizado)) {
    return 'O servidor demorou para responder. Tente novamente em alguns instantes.';
  }
  if (/failed to fetch|fetch failed|network|internet|offline|econn|timeout/.test(normalizado)) {
    return 'Sem conexão com a internet. Verifique a rede e tente novamente.';
  }
  if (/n[aã]o foi poss[ií]vel entrar agora/.test(normalizado)) return 'Não foi possível entrar agora. Tente novamente.';
  return 'Não foi possível entrar. Confira os dados e tente novamente.';
}

async function erroDaEdgeFunction(erro) {
  try {
    const resposta = erro?.context;
    if (resposta && typeof resposta.clone === 'function') {
      const copia = resposta.clone();
      const dados = await copia.json();
      if (dados?.erro) return String(dados.erro);
      if (dados?.mensagem) return String(dados.mensagem);
    }
  } catch (_) { /* resposta sem JSON; usa tradução segura abaixo */ }
  const mensagem = mensagemErro(erro);
  if (/non-2xx|edge function/i.test(mensagem)) {
    return 'O serviço seguro não respondeu. Aguarde alguns instantes e tente novamente.';
  }
  return mensagem;
}

function validarChavePublica(anonKey) {
  const chave = String(anonKey || '').trim();
  if (!chave) throw new Error('Anon key do Supabase não informada.');
  if (/^sb_secret_/i.test(chave) || /service_role/i.test(chave)) {
    throw new Error('A service_role/secret key é proibida no Electron. Use somente a anon/publishable key pública.');
  }
  const partes = chave.split('.');
  if (partes.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') {
        throw new Error('A service_role key é proibida no Electron. Use somente a anon key pública.');
      }
    } catch (erro) {
      if (/service_role/.test(erro.message)) throw erro;
    }
  }
  return chave;
}

function resolverNomeLoginPublico(email, aliases) {
  if (typeof aliases === 'string' && aliases.trim()) return aliases.trim();
  const alvo = String(email || '').trim().toLowerCase();
  for (const [usuario, emailTecnico] of Object.entries(aliases || {})) {
    if (String(emailTecnico || '').trim().toLowerCase() === alvo) return usuario;
  }
  return 'usuário';
}

function usuarioPublico(user, contexto, aliases) {
  const cargo = String(contexto.cargo || 'operador');
  const permissoesOriginais = contexto.permissoes && typeof contexto.permissoes === 'object' ? contexto.permissoes : {};
  const permissoes = {};
  for (const [modulo, valor] of Object.entries(permissoesOriginais)) {
    permissoes[modulo] = valor === true || !!(valor && Object.values(valor).some(item => item === true));
  }
  const somenteCobranca = contexto.acesso_somente_cobranca === true;
  const admin = !somenteCobranca && (contexto.administrador_global === true || ['administrador', 'admin', 'proprietário', 'proprietario'].includes(cargo.toLowerCase().trim()));
  if (somenteCobranca) {
    Object.keys(permissoes).forEach((chave) => { permissoes[chave] = false; });
    permissoes.configuracoes = true;
  }
  return {
    id: user.id,
    usuario: resolverNomeLoginPublico(user.email, aliases),
    // Nunca repasse o e-mail técnico do Auth ao renderer. Ele não é um dado
    // de perfil nem um campo que o usuário precise conhecer.
    email: '',
    nome: contexto.perfil_nome || resolverNomeLoginPublico(user.email, aliases) || 'Usuário',
    perfil: admin ? 'admin' : 'operador',
    cargoNome: cargo,
    admin,
    permissoes,
    permissoesDetalhadas: somenteCobranca ? {} : JSON.parse(JSON.stringify(permissoesOriginais)),
    empresaId: contexto.empresa_id,
    empresaNome: contexto.empresa_nome || '',
    administradorGlobal: contexto.administrador_global === true,
    acessoSomenteCobranca: somenteCobranca,
    papelSuporte: contexto.papel_suporte || '',
    planoNome: contexto.plano_nome || '',
    licencaStatus: contexto.licenca_status || '',
    dataVencimento: contexto.data_vencimento || contexto.fim_trial || '',
    inicioTrial: contexto.inicio_trial || '',
    fimTrial: contexto.fim_trial || '',
    fiscalHabilitado: contexto.administrador_global !== true && contexto.recursos_habilitados?.fiscal_habilitado === true,
    trocaRapidaContas: contexto.administrador_global === true || contexto.recursos_habilitados?.troca_rapida_contas === true,
    origemAuth: 'supabase'
  };
}

class DesktopSupabaseRuntime {
  constructor() {
    this.db = null;
    this.createClient = null;
    this.fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
    this.client = null;
    this.contexto = null;
    this.usuario = null;
    this.stateStore = null;
    this.sessionStore = null;
    this.fileService = null;
    this.companyCloudService = null;
    this.inventoryService = null;
    this.priceTableService = null;
    this.desbloqueioCloudService = null;
    this.nativeImage = null;
    this.janela = null;
    this.timerHeartbeat = null;
    this.timerSync = null;
    this.timerSyncSolicitado = null;
    this.processadorOSRemota = null;
    this.processadorDocumentoComercialRemoto = null;
    this.syncEmAndamento = null;
    this.syncFalhasConsecutivas = 0;
    this.syncSuspensoAte = 0;
    this.inicializado = false;
    // A restauração da sessão pode envolver rede, backup e sincronização da
    // empresa. Guardar a promessa evita duas restaurações concorrentes quando
    // a janela abre antes do serviço em segundo plano terminar de preparar a
    // nuvem.
    this.inicializacaoEmAndamento = null;
    // Durante uma troca rápida o novo processo só pode restaurar exatamente
    // a conta escolhida. Sem este vínculo, uma falha ao renovar o token podia
    // deixar o SDK reutilizar a sessão anterior do suporte.
    this.contaTrocaEsperadaId = '';
    this.ultimoStatus = { ativo: false, autenticado: false, conectado: false };
  }

  inicializar(opcoes) {
    if (this.inicializacaoEmAndamento) return this.inicializacaoEmAndamento;
    this.inicializacaoEmAndamento = this._inicializar(opcoes);
    return this.inicializacaoEmAndamento;
  }

  async _inicializar({ db, safeStorage, nativeImage, getJanela, createClient }) {
    this.db = db;
    this.nativeImage = nativeImage;
    this.janela = getJanela;
    const rootGlobal = db.getRootGlobalDir?.() || db.getRootDir();
    this.stateStore = new DesktopStateStore(rootGlobal);
    this.sessionStore = new SecureSessionStore({ rootDir: rootGlobal, safeStorage });
    this.createClient = createClient || require('@supabase/supabase-js').createClient;
    this.inicializado = true;
    await this.reconfigurar({ restaurar: true });
    return this.status();
  }

  async aguardarInicializacao() {
    if (this.inicializacaoEmAndamento) {
      await this.inicializacaoEmAndamento.catch(() => {});
    }
    return this.status();
  }

  _configRaw() {
    return {
      // Infraestrutura é central e distribuída com o aplicativo. Não aceite
      // sobrescrita do banco local nem de campos de Configurações.
      ativo: true,
      url: String(SUPABASE_PUBLIC_CONFIG.url || '').trim().replace(/\/$/, ''),
      anonKey: String(SUPABASE_PUBLIC_CONFIG.anonKey || '').trim()
    };
  }

  _configValida() {
    const cfg = this._configRaw();
    if (!cfg.ativo) return null;
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(cfg.url)) throw new Error('URL HTTPS do Supabase inválida.');
    validarChavePublica(cfg.anonKey);
    return cfg;
  }

  _criarCliente(cfg) {
    // Uma resposta tardia do cliente antigo não pode substituir a conta
    // escolhida enquanto o aplicativo aguarda o reinício.
    const escrita = { permitida: true, anterior: new Map() };
    this.escritaSessao = escrita;
    const client = this.createClient(cfg.url, cfg.anonKey, {
      auth: {
        storage: {
          getItem: (chave) => {
            if (!escrita.permitida) return escrita.anterior.get(chave) || null;
            const valor = this.sessionStore.getItem(chave);
            escrita.anterior.set(chave, valor);
            return valor;
          },
          setItem: (chave, valor) => {
            if (escrita.permitida) {
              this.sessionStore.setItem(chave, valor);
              escrita.anterior.set(chave, valor);
            }
          },
          removeItem: (chave) => {
            if (escrita.permitida) {
              this.sessionStore.removeItem(chave);
              escrita.anterior.delete(chave);
            }
          }
        },
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      },
      global: { headers: { 'x-client-info': 'sistema-os-electron-stage7' } }
    });
    this.assinaturaAuth = client.auth.onAuthStateChange?.((evento, sessao) => {
      // Callback síncrono: chamar Auth/RPC aqui disputa o lock do próprio SDK.
      if (!escrita.permitida || !['TOKEN_REFRESHED', 'SIGNED_IN', 'INITIAL_SESSION'].includes(evento)) return;
      if (!sessao?.user?.id || !sessao.access_token || !sessao.refresh_token) return;
      try {
        const conta = this.sessionStore.obterContaRapida?.(sessao.user.id);
        if (!conta) return;
        this.sessionStore.salvarContaRapida({
          ...conta, accessToken: sessao.access_token, refreshToken: sessao.refresh_token,
          expiresAt: sessao.expires_at, requerSenha: false
        });
      } catch (_) {
        console.error('[Supabase] Não foi possível atualizar a conta no cofre seguro.');
      }
    })?.data?.subscription;
    return client;
  }

  _recriarServicoArquivosDoEscopo() {
    this.fileService = new SupabaseFileService({
      rootDir: this.db.getRootDir(),
      stateStore: this.stateStore,
      getClient: () => this.client,
      getContext: () => this.contexto,
      nativeImage: this.nativeImage,
      db: this.db
    });
  }

  _ativarEscopoLocal(contexto, { migrarLegado = false } = {}) {
    if (!contexto?.empresa_id || typeof this.db.ativarEscopoEmpresa !== 'function') return null;
    const escopo = this.db.ativarEscopoEmpresa(contexto.empresa_id, { migrarLegado });
    this.stateStore.trocarEmpresa(contexto.empresa_id);
    this._recriarServicoArquivosDoEscopo();
    this.db.migrarSegredosParaArmazenamentoSeguro?.();
    return escopo;
  }

  async reconfigurar({ restaurar = true } = {}) {
    this.parar();
    if (this.escritaSessao) this.escritaSessao.permitida = false;
    this.assinaturaAuth?.unsubscribe?.();
    try { Promise.resolve(this.client?.auth?.stopAutoRefresh?.()).catch(() => {}); } catch (_) {}
    this.client = null;
    this.contexto = null;
    this.usuario = null;
    try {
      const cfg = this._configValida();
      if (!cfg) {
        this.ultimoStatus = { ativo: false, autenticado: false, conectado: false, modo: 'legado' };
        return this.status();
      }
      // A troca rápida é preparada antes de criar o cliente. Assim o SDK já
      // nasce lendo a sessão da empresa escolhida, sem disputar locks ou o
      // auto-refresh da conta que existia no processo anterior.
      if (restaurar) await this._prepararTrocaContaPendente(cfg);
      this.client = this._criarCliente(cfg);
      this.fileService = new SupabaseFileService({
        rootDir: this.db.getRootDir(),
        stateStore: this.stateStore,
        getClient: () => this.client,
        getContext: () => this.contexto,
        nativeImage: this.nativeImage,
        db: this.db
      });
      this.companyCloudService = new CompanyCloudService({
        getClient: () => this.client,
        getContext: () => this.contexto,
        db: this.db,
        stateStore: this.stateStore,
        appVersion: APP_VERSION
      });
      this.inventoryService = new InventoryService({
        getClient: () => this.client,
        stateStore: this.stateStore,
        db: this.db
      });
      this.priceTableService = new PriceTableService({
        getClient: () => this.client,
        getContext: () => this.contexto
      });
      this.aftercareService = new AftercareService({ getClient: () => this.client, getContext: () => this.contexto, db: this.db, stateStore: this.stateStore });
      this.desbloqueioCloudService = new DesbloqueioCloudService({ getClient: () => this.client, getContext: () => this.contexto, db: this.db });
      this.ultimoStatus = { ativo: true, autenticado: false, conectado: false, modo: 'supabase' };
      if (restaurar) await this.restaurarSessao();
      return this.status();
    } catch (erro) {
      this.ultimoStatus = { ativo: true, autenticado: false, conectado: false, erro: mensagemErro(erro), modo: 'supabase' };
      console.error('[Supabase] Falha na configuração do desktop:', mensagemErro(erro));
      return this.status();
    }
  }

  async _carregarContexto(user, usuarioInformado) {
    const { data, error } = await this.client.rpc('obter_contexto_comercial');
    if (error) throw error;
    const contexto = primeiraLinha(data);
    if (!contexto) throw new Error('Usuário sem perfil ou empresa vinculada.');
    if (!contexto.usuario_ativo) throw new Error('Usuário inativo.');
    const suporteGlobal = contexto.administrador_global === true;
    if (!suporteGlobal && !contexto.empresa_ativa) throw new Error('Empresa inativa.');
    if (!suporteGlobal && !['ativa', 'teste', 'vencendo', 'periodo_graca', 'vencida'].includes(contexto.licenca_status)) {
      throw new Error('Licença bloqueada ou vencida.');
    }
    const fimLicenca = contexto.data_vencimento || contexto.fim_trial;
    const vencimentoMs = fimLicenca ? new Date(fimLicenca).getTime() : NaN;
    const venceuPelaData = Number.isFinite(vencimentoMs) && vencimentoMs <= Date.now();
    // A tela de renovação deve assumir o controle assim que a data vence,
    // mesmo se a coluna de status ainda estiver aguardando o job periódico.
    // Contas globais de suporte nunca entram no fluxo comercial de cobrança.
    contexto.acesso_somente_cobranca = !suporteGlobal &&
      (contexto.licenca_status === 'vencida' || venceuPelaData);
    if (contexto.acesso_somente_cobranca) contexto.licenca_status = 'vencida';
    if (suporteGlobal) {
      const papel = await this.client.rpc('obter_papel_suporte');
      if (!papel.error) contexto.papel_suporte = String(papel.data || 'suporte');
    }
    const empresaAnterior = this.stateStore.obter()?.empresaId || '';
    // Cada empresa possui database.json, PDFs, backups e uploads em uma pasta
    // própria. O banco legado só é migrado quando já sabemos, pelo estado
    // assinado da sessão anterior, a qual empresa ele realmente pertence.
    const escopo = this._ativarEscopoLocal(contexto, {
      migrarLegado: !suporteGlobal && empresaAnterior === contexto.empresa_id
    });
    this.contexto = contexto;
    this.usuario = usuarioPublico(user, contexto, usuarioInformado || user?.user_metadata?.usuario || 'usuario');
    if (contexto.acesso_somente_cobranca) {
      // A empresa vencida entra apenas para consultar/renovar a assinatura.
      // Nenhum dado operacional e sincronizado ou carregado nesse modo.
      return this.usuario;
    }
    if (!suporteGlobal) {
      // O backup pertence a empresa autenticada, nunca ao computador. Em uma
      // instalacao nova ele e baixado e restaurado somente depois do login,
      // o que impede misturar dados de empresas diferentes.
      const restauracao = await this.companyCloudService?.restaurarEmInstalacaoNova().catch((erro) => {
        console.error('[Supabase] Nao foi possivel preparar o backup da empresa:', mensagemErro(erro));
        return { restaurado: false };
      });
      this.db.migrarSegredosParaArmazenamentoSeguro?.();
      if (escopo?.novo && !escopo.migradoLegado && !restauracao?.restaurado) {
        this.db.salvarConfig({
          nomeEmpresa: contexto.empresa_nome || 'Sistema OS',
          nomeFantasia: contexto.empresa_nome || 'Sistema OS',
          razaoSocial: '', cnpj: '', logoPath: '', logoBase64: ''
        });
      }
      await this.companyCloudService?.publicarConfiguracaoMobileSeAusente(this.db?.obterConfig?.() || {}).catch((erro) => {
        console.error('[Supabase] Nao foi possivel preparar a configuracao do celular:', mensagemErro(erro));
      });
      await this.companyCloudService?.sincronizarConfiguracaoCompartilhada().catch((erro) => {
        console.error('[Supabase] Nao foi possivel atualizar os dados compartilhados da empresa:', mensagemErro(erro));
      });
      await this.companyCloudService?.sincronizarLogo().catch((erro) => {
        console.error('[Supabase] Nao foi possivel sincronizar a logo da empresa:', mensagemErro(erro));
      });
      await this.registrarAcessoComercial().catch(() => {});
      await this.enviarHeartbeat();
      this.iniciar();
    } else if (escopo?.novo) {
      this.db.salvarConfig({
        nomeEmpresa: 'Sistema OS — Suporte', nomeFantasia: 'Sistema OS — Suporte',
        razaoSocial: '', cnpj: '', logoPath: '', logoBase64: ''
      });
    }
    return this.usuario;
  }

  _trocaRapidaPermitida(contexto = this.contexto) {
    if (!contexto) return false;
    if (contexto.administrador_global === true) return true;
    return contexto.recursos_habilitados?.troca_rapida_contas === true;
  }

  async _salvarContaRapida(sessao, empresaInformada, usuarioInformado) {
    if (!sessao?.user?.id || !this._trocaRapidaPermitida()) return false;
    if (!this.sessionStore?.persistenciaCriptografadaDisponivel?.()) return false;
    // A preparação da empresa pode durar mais que a validade de um token.
    // Não substitua uma renovação recente pela sessão capturada no início.
    try {
      const atual = JSON.parse(this.sessionStore.getItem(this.client?.auth?.storageKey) || 'null');
      if (atual?.user?.id === sessao.user.id && atual.access_token && atual.refresh_token) sessao = atual;
    } catch (_) {}
    this.sessionStore.salvarContaRapida({
      id: sessao.user.id,
      accessToken: sessao.access_token,
      refreshToken: sessao.refresh_token,
      expiresAt: sessao.expires_at || null,
      requerSenha: false,
      empresaId: this.contexto?.empresa_id || '',
      empresaCodigo: this.contexto?.empresa_codigo || String(empresaInformada || '').trim().toLowerCase(),
      empresaNome: this.contexto?.empresa_nome || '',
      usuario: String(usuarioInformado || sessao.user.user_metadata?.usuario || this.usuario?.usuario || 'usuario'),
      nome: this.contexto?.perfil_nome || this.usuario?.nome || '',
      administradorGlobal: this.contexto?.administrador_global === true,
      papelSuporte: this.contexto?.papel_suporte || ''
    });
    return true;
  }

  async _renovarSessaoContaSalva(conta, cfg = SUPABASE_PUBLIC_CONFIG) {
    if (!this.fetchImpl) throw new Error('Não foi possível validar a conta salva neste computador.');
    const controle = new AbortController();
    try {
      const { resposta, corpo } = await comTempoLimite((async () => {
        const resposta = await this.fetchImpl(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: {
            apikey: cfg.anonKey,
            authorization: `Bearer ${cfg.anonKey}`,
            'content-type': 'application/json',
            'x-client-info': 'sistema-os-electron-account-switch'
          },
          body: JSON.stringify({ refresh_token: String(conta?.refreshToken || '') }),
          signal: controle.signal
        });
        const corpo = await resposta.json().catch(() => ({}));
        return { resposta, corpo };
      })(), 8000, 'TEMPO_LIMITE_CONTA_SALVA');
      if (!resposta.ok) {
        const requerSenha = [400, 401].includes(resposta.status) &&
          ['refresh_token_already_used', 'refresh_token_not_found', 'session_not_found', 'session_expired', 'invalid_grant'].includes(corpo?.error_code || corpo?.code || corpo?.error);
        throw Object.assign(new Error(requerSenha
          ? 'Sua sessão salva expirou. Digite a senha para entrar novamente.'
          : 'Não foi possível validar a conta agora. Confira a conexão e tente novamente.'), { requerSenha });
      }
      if (!corpo?.access_token || !corpo?.refresh_token || !corpo?.user?.id) {
        throw new Error('O servidor não concluiu a validação da conta. Tente novamente.');
      }
      if (String(corpo.user.id) !== String(conta?.id || '')) {
        throw new Error('A sessão validada não corresponde à conta escolhida.');
      }
      const expiraEmSegundos = Math.max(60, Number(corpo.expires_in) || 3600);
      return {
        access_token: String(corpo.access_token),
        refresh_token: String(corpo.refresh_token || conta.refreshToken),
        token_type: String(corpo.token_type || 'bearer'),
        expires_in: expiraEmSegundos,
        expires_at: Math.floor(Date.now() / 1000) + expiraEmSegundos,
        user: corpo.user
      };
    } catch (erro) {
      if (erro?.name === 'AbortError' || erro?.message === 'TEMPO_LIMITE_CONTA_SALVA') {
        throw new Error('O servidor demorou para validar a conta salva. Tente novamente.');
      }
      if (erro instanceof TypeError) throw new Error('Não foi possível conectar. Confira a internet e tente novamente.');
      throw erro;
    } finally {
      controle.abort();
    }
  }

  async _prepararTrocaContaPendente(cfg) {
    let pendente = null;
    try {
      pendente = JSON.parse(this.sessionStore?.getItem?.(CHAVE_TROCA_CONTA_PENDENTE) || 'null');
    } catch (_) { pendente = null; }
    if (!pendente?.contaId || !pendente?.storageKey) return false;
    this.contaTrocaEsperadaId = String(pendente.contaId);
    try {
      const conta = this.sessionStore?.obterContaRapida?.(pendente.contaId);
      if (!conta) throw new Error('A conta salva não foi encontrada.');
      let sessao = null;
      try {
        const preparada = JSON.parse(this.sessionStore?.getItem?.(String(pendente.storageKey)) || 'null');
        if (String(preparada?.user?.id || '') === this.contaTrocaEsperadaId &&
            preparada?.access_token && preparada?.refresh_token && Number(preparada.expires_at) > Date.now() / 1000 + 30) {
          sessao = preparada;
        }
      } catch (_) { sessao = null; }
      // Compatibilidade com uma intenção gravada por versões anteriores, que
      // ainda deixavam a renovação para o próximo processo.
      if (!sessao) {
        sessao = await this._renovarSessaoContaSalva(conta, cfg);
        this.sessionStore.setItem(String(pendente.storageKey), JSON.stringify(sessao));
      }
      // O refresh token gira a cada validação. Atualize também o cartão da
      // conta, ou uma segunda troca tentaria reutilizar o token antigo.
      this.sessionStore.salvarContaRapida({
        ...conta,
        id: sessao.user.id,
        accessToken: sessao.access_token,
        refreshToken: sessao.refresh_token,
        expiresAt: sessao.expires_at
      });
      this.sessionStore.removeItem(CHAVE_TROCA_CONTA_ERRO);
      return true;
    } catch (erro) {
      this.erroTrocaContaPendente = mensagemErro(erro);
      // Nunca permita que o boot caia silenciosamente na sessão antiga do
      // suporte quando a conta escolhida não pôde ser validada.
      this.sessionStore?.removeItem?.(String(pendente.storageKey || ''));
      this.sessionStore?.setItem?.(CHAVE_TROCA_CONTA_ERRO, JSON.stringify({
        mensagem: this.erroTrocaContaPendente,
        contaId: String(pendente?.contaId || '')
      }));
      console.error('[Supabase] Não foi possível concluir a troca de conta:', this.erroTrocaContaPendente);
      return false;
    } finally {
      this.sessionStore?.removeItem?.(CHAVE_TROCA_CONTA_PENDENTE);
    }
  }

  async registrarAcessoComercial() {
    if (!this.client || !this.stateStore) return null;
    const identificador = this.stateStore.obter()?.deviceKey;
    if (!identificador) return null;
    const { data, error } = await this.client.rpc('registrar_acesso_comercial', {
      p_identificador: identificador,
      p_plataforma: 'windows',
      p_nome: 'Sistema OS para Windows'
    });
    if (error) throw error;
    return data;
  }

  async login(empresa, usuario, senha) {
    if (!this.client) return { sucesso: false, erro: 'Supabase não está ativo ou configurado.', codigo: 'supabase_inativo' };
    const sessaoAnterior = await this.client.auth.getSession().then((r) => r.data?.session || null).catch(() => null);
    const contextoAnterior = this.contexto;
    const usuarioAnterior = this.usuario;
    try {
      if (contextoAnterior && contextoAnterior.administrador_global !== true) {
        await this.sincronizarAgora().catch(() => {});
      }
      this.parar();
      const resposta = await comTempoLimite(this.client.functions.invoke('auth-login', {
        body: {
          empresa: String(empresa || '').trim(),
          usuario: String(usuario || '').trim(),
          senha: String(senha || '')
        }
      }), 20000);
      if (resposta.error) throw new Error(await erroDaEdgeFunction(resposta.error));
      const credenciais = resposta.data || {};
      if (!credenciais.access_token || !credenciais.refresh_token) {
        throw new Error('Não foi possível validar as credenciais.');
      }
      const { data, error } = await this.client.auth.setSession({
        access_token: credenciais.access_token,
        refresh_token: credenciais.refresh_token
      });
      if (error || !data?.user) throw error || new Error('Não foi possível iniciar a sessão.');
      const usuarioPublicoAtual = await comTempoLimite(this._carregarContexto(data.user, usuario), 20000);
      await this._salvarContaRapida(data.session, empresa, usuario);
      this.ultimoStatus = { ativo: true, autenticado: true, conectado: true, modo: 'supabase' };
      // Libera o login sem prender a tela ao primeiro ciclo completo. A
      // sincronização é agrupada e executada logo depois; falha de rede não
      // invalida uma autenticação que já foi concluída.
      if (!this.contexto?.acesso_somente_cobranca) this.solicitarSincronizacao(250);
      return { sucesso: true, usuario: usuarioPublicoAtual, contexto: this.contexto };
    } catch (erro) {
      if (sessaoAnterior?.access_token && sessaoAnterior?.refresh_token) {
        await this.client.auth.setSession({
          access_token: sessaoAnterior.access_token,
          refresh_token: sessaoAnterior.refresh_token
        }).catch(() => {});
        this.contexto = contextoAnterior;
        this.usuario = usuarioAnterior;
        if (contextoAnterior?.empresa_id) this._ativarEscopoLocal(contextoAnterior);
        if (contextoAnterior && contextoAnterior.administrador_global !== true && !contextoAnterior.acesso_somente_cobranca) this.iniciar();
      } else {
        await this.client.auth.signOut({ scope: 'local' }).catch(() => {});
        this.contexto = null;
        this.usuario = null;
      }
      const mensagemPublica = traduzirErroLogin(mensagemErro(erro));
      this.ultimoStatus = { ativo: true, autenticado: false, conectado: false, erro: mensagemPublica, modo: 'supabase' };
      return { sucesso: false, erro: mensagemPublica };
    }
  }

  async restaurarSessao() {
    if (this.restauracaoEmAndamento) return this.restauracaoEmAndamento;
    this.restauracaoEmAndamento = this._restaurarSessaoInterna();
    try { return await this.restauracaoEmAndamento; }
    finally { this.restauracaoEmAndamento = null; }
  }

  async _restaurarSessaoInterna() {
    if (!this.client) return { sucesso: false, codigo: 'supabase_inativo' };
    // O processo principal restaura a sessão antes de criar a janela. O
    // renderer consulta a mesma sessão logo depois; repetir getSession + RPC
    // nesse intervalo podia disputar a renovação do token e devolver a tela
    // de login mesmo com a empresa já autenticada.
    if (this.usuario && this.contexto) {
      return { sucesso: true, usuario: this.usuario, contexto: this.contexto };
    }
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) {
        if (['refresh_token_already_used', 'refresh_token_not_found', 'session_not_found', 'session_expired'].includes(error.code)) {
          throw new Error('Sua sessão salva expirou. Digite a senha para entrar novamente.');
        }
        throw new Error('Não foi possível recuperar seu acesso. Confira a conexão ou entre novamente com a senha.');
      }
      if (!data?.session?.user) {
        if (this.contaTrocaEsperadaId) throw new Error('Sua sessão salva expirou. Digite a senha para entrar novamente.');
        return { sucesso: false, codigo: 'sem_sessao' };
      }
      if (this.contaTrocaEsperadaId && String(data.session.user.id || '') !== this.contaTrocaEsperadaId) {
        await this.client.auth.signOut({ scope: 'local' }).catch(() => {});
        throw new Error('A conta escolhida não pôde ser aberta. Entre novamente com a senha.');
      }
      const usuario = await this._carregarContexto(data.session.user);
      await this._salvarContaRapida(data.session, this.contexto?.empresa_codigo, this.usuario?.usuario);
      this.contaTrocaEsperadaId = '';
      this.ultimoStatus = { ativo: true, autenticado: true, conectado: true, modo: 'supabase' };
      return { sucesso: true, usuario, contexto: this.contexto };
    } catch (erro) {
      if (this.contaTrocaEsperadaId) {
        this.sessionStore?.setItem?.(CHAVE_TROCA_CONTA_ERRO, JSON.stringify({
          mensagem: mensagemErro(erro), contaId: this.contaTrocaEsperadaId
        }));
        this.contaTrocaEsperadaId = '';
      }
      this.contexto = null;
      this.usuario = null;
      this.ultimoStatus = { ativo: true, autenticado: false, conectado: false, erro: mensagemErro(erro), modo: 'supabase' };
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async logout() {
    this.parar();
    try { if (this.client) await this.client.auth.signOut({ scope: 'local' }); } catch (_) { /* limpa local abaixo */ }
    this.contexto = null;
    this.usuario = null;
    this.ultimoStatus = { ativo: !!this.client, autenticado: false, conectado: false, modo: this.client ? 'supabase' : 'legado' };
    return { sucesso: true };
  }

  listarContasRapidas() {
    if (!this.sessionStore?.persistenciaCriptografadaDisponivel?.()) {
      return { sucesso: false, erro: 'O cofre seguro do Windows não está disponível.', contas: [] };
    }
    const erroTrocaRaw = String(this.sessionStore.getItem(CHAVE_TROCA_CONTA_ERRO) || '').trim();
    let erroTroca = '';
    let erroTrocaContaId = '';
    if (erroTrocaRaw) {
      try {
        const falha = JSON.parse(erroTrocaRaw);
        erroTroca = String(falha?.mensagem || '').trim();
        erroTrocaContaId = String(falha?.contaId || '').trim();
      } catch (_) { erroTroca = erroTrocaRaw; }
      this.sessionStore.removeItem(CHAVE_TROCA_CONTA_ERRO);
    }
    const contas = this.sessionStore.listarContasRapidas().map((conta) => ({
      id: conta.id,
      empresaId: conta.empresaId,
      empresaCodigo: conta.empresaCodigo,
      empresaNome: conta.empresaNome,
      usuario: conta.usuario,
      nome: conta.nome,
      administradorGlobal: conta.administradorGlobal === true,
      papelSuporte: conta.papelSuporte || '',
      requerSenha: conta.requerSenha === true,
      atualizadoEm: conta.atualizadoEm || ''
    }));
    return { sucesso: true, contas, permitida: this._trocaRapidaPermitida(), erroTroca, erroTrocaContaId };
  }

  async trocarContaRapida(contaId) {
    if (!this.client) return { sucesso: false, erro: 'Serviço de autenticação indisponível.' };
    if (this.trocaContaEmAndamento) return { sucesso: false, erro: 'Aguarde a troca de conta em andamento.' };
    const conta = this.sessionStore?.obterContaRapida?.(contaId);
    if (!conta) return { sucesso: false, erro: 'A conta salva não foi encontrada.' };
    if (String(this.usuario?.id || '') === String(contaId) && this.contexto) {
      return { sucesso: true, usuario: this.usuario, contexto: this.contexto };
    }
    if (conta.requerSenha) return { sucesso: false, requerSenha: true, erro: 'Sua sessão salva expirou. Digite a senha para entrar novamente.' };
    this.trocaContaEmAndamento = true;
    let pausado = false;
    let storageKey = '';
    let sessaoAnterior = null;
    try {
      storageKey = String(this.client?.auth?.storageKey || '').trim();
      if (!storageKey || !this.sessionStore?.setItem) {
        throw new Error('O cofre seguro da sessão não está disponível.');
      }
      // Valide ANTES de reiniciar. Um refresh recusado não é recuperado
      // reabrindo o app e jamais deve substituir a sessão que ainda funciona.
      const sessao = await this._renovarSessaoContaSalva(conta, this._configValida());
      this.sessionStore.salvarContaRapida({
        ...conta,
        id: sessao.user.id,
        accessToken: sessao.access_token,
        refreshToken: sessao.refresh_token,
        expiresAt: sessao.expires_at,
        requerSenha: false
      });
      sessaoAnterior = this.sessionStore.getItem(storageKey);
      this.parar();
      pausado = true;
      if (this.escritaSessao) this.escritaSessao.permitida = false;
      try { Promise.resolve(this.client.auth.stopAutoRefresh?.()).catch(() => {}); } catch (_) {}
      this.sessionStore.setItem(storageKey, JSON.stringify(sessao));
      this.sessionStore.setItem(CHAVE_TROCA_CONTA_PENDENTE, JSON.stringify({
        contaId: String(conta.id), storageKey, preparada: true, solicitadoEm: new Date().toISOString()
      }));
      this.sessionStore.removeItem(CHAVE_TROCA_CONTA_ERRO);
      return {
        sucesso: true,
        reiniciarAplicacao: true,
        conta: {
          id: conta.id,
          usuario: conta.usuario || 'usuario',
          empresaNome: conta.empresaNome || conta.empresaCodigo || 'empresa'
        }
      };
    } catch (erro) {
      if (erro.requerSenha) this.sessionStore.salvarContaRapida({ ...conta, requerSenha: true });
      if (pausado) {
        if (sessaoAnterior) this.sessionStore.setItem(storageKey, sessaoAnterior);
        else this.sessionStore.removeItem(storageKey);
        this.sessionStore.removeItem(CHAVE_TROCA_CONTA_PENDENTE);
        if (this.escritaSessao) this.escritaSessao.permitida = true;
        try { Promise.resolve(this.client?.auth?.startAutoRefresh?.()).catch(() => {}); } catch (_) {}
        if (this.contexto && !this.contexto.administrador_global && !this.contexto.acesso_somente_cobranca) this.iniciar();
      }
      return { sucesso: false, requerSenha: erro.requerSenha === true, erro: mensagemErro(erro) };
    } finally {
      this.trocaContaEmAndamento = false;
    }
  }

  removerContaRapida(contaId) {
    this.sessionStore?.removerContaRapida?.(contaId);
    return { sucesso: true };
  }

  async configurarTrocaRapida(ativa) {
    if (!this.client || !this.contexto || this.contexto.administrador_global) {
      return { sucesso: false, erro: 'Entre como administrador de uma empresa para alterar esta opção.' };
    }
    try {
      const { data, error } = await this.client.rpc('configurar_troca_rapida_contas', { p_ativa: ativa === true });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      this.contexto.recursos_habilitados = data || {};
      if (ativa !== true) {
        this.sessionStore?.removerContasRapidasDaEmpresa?.(this.contexto.empresa_id);
      } else {
        const sessao = await this.client.auth.getSession();
        if (!sessao.error) await this._salvarContaRapida(sessao.data?.session, this.contexto.empresa_codigo, this.usuario?.usuario);
      }
      return { sucesso: true, ativa: ativa === true };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async obterPoliticaExclusao() {
    if (!this.client || !this.usuario || this.contexto?.administrador_global) {
      return null;
    }
    try {
      const { data, error } = await this.client.rpc('obter_politica_exclusao');
      if (error) throw error;
      return data || null;
    } catch (erro) {
      console.warn('[Supabase] Nao foi possivel carregar a politica de exclusao:', mensagemErro(erro));
      return null;
    }
  }

  async definirMinhaSenhaExclusao(senha) {
    if (!this.client || !this.usuario || this.contexto?.administrador_global) {
      return { sucesso: false, erro: 'Entre em uma conta da empresa para definir sua senha.' };
    }
    try {
      const { data, error } = await this.client.rpc('definir_minha_senha_exclusao', {
        p_senha: String(senha || '')
      });
      if (error) throw error;
      return { sucesso: true, politica: data || null };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async configurarPoliticaExclusao(semSenhaTodos, usuariosSemSenha) {
    if (!this.client || !this.usuario || this.contexto?.administrador_global) {
      return { sucesso: false, erro: 'Entre como administrador da empresa para alterar esta opcao.' };
    }
    try {
      const { data, error } = await this.client.rpc('configurar_politica_exclusao', {
        p_sem_senha_todos: semSenhaTodos === true,
        p_usuarios_sem_senha: Array.isArray(usuariosSemSenha) ? usuariosSemSenha : []
      });
      if (error) throw error;
      return { sucesso: true, politica: data || null };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async validarMinhaSenhaExclusao(senha) {
    if (!this.client || !this.usuario || this.contexto?.administrador_global) return null;
    try {
      const politica = await this.obterPoliticaExclusao();
      if (politica?.sem_senha === true) return true;
      const { data, error } = await this.client.rpc('validar_minha_senha_exclusao', {
        p_senha: String(senha || '')
      });
      if (error) throw error;
      return data === true;
    } catch (erro) {
      const falha = new Error(mensagemErro(erro));
      falha.causa = erro;
      throw falha;
    }
  }

  async recuperarSenha(identificador) {
    if (!this.client) return { sucesso: false, erro: 'Supabase não está ativo.' };
    return { sucesso: false, erro: 'Peça ao administrador da empresa para redefinir sua senha.' };
  }

  async processarRecuperacaoSenha(urlRecebida) {
    if (!this.client) return { sucesso: false, erro: 'Supabase não está ativo.' };
    try {
      const url = new URL(String(urlRecebida || ''));
      if (url.protocol !== 'sistemaos:' || url.hostname !== 'auth' || url.pathname !== '/callback') {
        throw new Error('Link de recuperação inválido.');
      }
      const query = url.searchParams;
      const hash = new URLSearchParams(String(url.hash || '').replace(/^#/, ''));
      const erro = query.get('error_description') || hash.get('error_description');
      if (erro) throw new Error(erro);
      let resposta;
      const codigo = query.get('code');
      if (codigo) {
        resposta = await this.client.auth.exchangeCodeForSession(codigo);
      } else {
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');
        if (!accessToken || !refreshToken) throw new Error('Link de recuperação sem sessão válida.');
        resposta = await this.client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      }
      if (resposta.error) throw resposta.error;
      const usuario = resposta.data?.session?.user || resposta.data?.user;
      if (!usuario) throw new Error('Não foi possível validar a sessão de recuperação.');
      return {
        sucesso: true,
        usuario: usuario.user_metadata?.usuario || 'usuário'
      };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async atualizarSenha(senha) {
    if (!this.client) return { sucesso: false, erro: 'Supabase não está ativo.' };
    const novaSenha = String(senha || '');
    if (novaSenha.length < 8) return { sucesso: false, erro: 'A nova senha precisa ter pelo menos 8 caracteres.' };
    try {
      const { data, error } = await this.client.auth.updateUser({ password: novaSenha });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      const usuario = await this._carregarContexto(data.user);
      this.ultimoStatus = { ativo: true, autenticado: true, conectado: true, modo: 'supabase' };
      return { sucesso: true, usuario, contexto: this.contexto };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async testarConexao(credenciais = {}) {
    try {
      const atual = this._configRaw();
      const url = String(credenciais.url || atual.url || '').trim().replace(/\/$/, '');
      const anonKey = validarChavePublica(credenciais.anonKey || atual.anonKey);
      if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) throw new Error('URL HTTPS do Supabase inválida.');
      const resposta = await fetch(`${url}/auth/v1/settings`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        signal: AbortSignal.timeout(10000)
      });
      if (!resposta.ok) throw new Error(`Supabase respondeu HTTP ${resposta.status}. Verifique URL e anon key.`);
      return { sucesso: true };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  iniciar() {
    this.parar();
    // O Realtime entrega as mudancas urgentes. Estes ciclos sao apenas uma
    // rede de seguranca e nao devem manter o PostgREST/CPU ocupado quando o
    // Electron fica minimizado na bandeja.
    this.timerHeartbeat = setInterval(() => this.enviarHeartbeat().catch(() => {}), 60000);
    this.timerSync = setInterval(() => this.solicitarSincronizacao(0), 180000);
    this.timerHeartbeat.unref?.();
    this.timerSync.unref?.();
  }

  parar() {
    if (this.timerHeartbeat) clearInterval(this.timerHeartbeat);
    if (this.timerSync) clearInterval(this.timerSync);
    if (this.timerSyncSolicitado) clearTimeout(this.timerSyncSolicitado);
    this.timerHeartbeat = null;
    this.timerSync = null;
    this.timerSyncSolicitado = null;
  }

  solicitarSincronizacao(atrasoMs = 1200) {
    if (!this.client || !this.contexto || this.contexto.administrador_global === true) return;
    if (this.timerSyncSolicitado) clearTimeout(this.timerSyncSolicitado);
    const esperaCircuito = Math.max(0, Number(this.syncSuspensoAte || 0) - Date.now());
    const espera = Math.max(0, Number(atrasoMs) || 0, esperaCircuito);
    this.timerSyncSolicitado = setTimeout(() => {
      this.timerSyncSolicitado = null;
      this.sincronizarAgora().catch(() => {});
    }, espera);
    this.timerSyncSolicitado.unref?.();
  }

  async enviarHeartbeat() {
    if (!this.client || !this.contexto) return null;
    const estado = this.stateStore.obter();
    const { data, error } = await this.client.rpc('registrar_heartbeat', {
      p_device_id: estado.deviceKey,
      p_tipo: 'desktop',
      p_nome: os.hostname() || 'Desktop Sistema OS'
    });
    if (error) throw error;
    const dispositivo = primeiraLinha(data);
    this.stateStore.alterar((s) => {
      s.dispositivoId = dispositivo?.id || s.dispositivoId;
      s.ultimoHeartbeatEm = new Date().toISOString();
    });
    return dispositivo;
  }

  definirProcessadorOSRemota(processador) {
    this.processadorOSRemota = typeof processador === 'function' ? processador : null;
  }

  definirProcessadorRespostaAssinatura(processador) {
    this.processadorRespostaAssinatura = typeof processador === 'function' ? processador : null;
  }

  definirProcessadorDocumentoComercialRemoto(processador) {
    this.processadorDocumentoComercialRemoto = typeof processador === 'function' ? processador : null;
  }

  registrarAlteracaoOS(operacao, osLocal) {
    const cfg = this._configRaw();
    if (!cfg.ativo || !this.stateStore) return null;
    const estado = this.stateStore.obter();
    const numero = osLocal?.numero;
    const mapeado = estado.mapeamentosOS[numero] || null;
    const payload = operacao === 'delete' ? {} : localParaSupabase(osLocal, estado.deviceKey);
    // Delete também precisa levar o vínculo remoto. Antes esses campos só
    // eram anexados quando havia `payload.dados`, então uma fila sem o
    // mapeamento em memória descartava a exclusão e a OS reaparecia no pull.
    payload.remoteId = mapeado?.id || osLocal?.supabaseId || '';
    payload.revision = mapeado?.revision || osLocal?.supabaseRevision || 0;
    const item = this.stateStore.enfileirarOS(operacao, numero, payload);
    if (this.contexto) this.solicitarSincronizacao();
    return item;
  }

  async garantirOSPublicada(osLocal) {
    if (!osLocal?.numero) return { sucesso: false, erro: 'OS inválida para publicação.' };
    if (!this.client || !this.contexto) {
      return { sucesso: false, erro: 'Faça login no Supabase para publicar a OS.' };
    }
    if (!this.stateStore.obter().dispositivoId) await this.enviarHeartbeat();

    // Uma exclusão remota antiga não pode deixar uma OS válida do PC invisível
    // para sempre. Somente este fluxo explícito de publicação pode remover o
    // tombstone; atualizações comuns continuam respeitando exclusões.
    const { data: remota, error: erroBusca } = await this.client.from('ordens_servico')
      .select('id,revision,id_exportacao,updated_at,deleted_at')
      .eq('numero', osLocal.numero)
      .maybeSingle();
    if (erroBusca) return { sucesso: false, erro: mensagemErro(erroBusca) };
    if (remota?.deleted_at) {
      const { data: restaurada, error: erroRestauracao } = await this.client.rpc('restaurar_ordem_servico_desktop', {
        p_id: remota.id,
        p_origem_dispositivo_id: this.stateStore.obter().dispositivoId
      });
      if (erroRestauracao) return { sucesso: false, erro: mensagemErro(erroRestauracao) };
      const linhaRestaurada = primeiraLinha(restaurada);
      if (!linhaRestaurada?.id) return { sucesso: false, erro: 'O servidor não confirmou a restauração da OS.' };
      this.stateStore.registrarMapeamentoOS(osLocal.numero, linhaRestaurada);
      this.db.registrarMetadadosSupabase?.(osLocal.numero, linhaRestaurada);
    } else if (remota?.id) {
      this.stateStore.registrarMapeamentoOS(osLocal.numero, remota);
      this.db.registrarMetadadosSupabase?.(osLocal.numero, remota);
    }

    this.registrarAlteracaoOS('update', osLocal);
    const resultado = await this.sincronizarAgora();
    const estado = this.stateStore?.obter?.() || {};
    const mapeamento = estado.mapeamentosOS?.[osLocal.numero];
    const pendente = (estado.fila || []).find((item) => item.numero === osLocal.numero);
    const conflito = (estado.conflitos || []).find((item) => item.numero === osLocal.numero);
    if (!resultado?.sucesso || pendente || conflito || !mapeamento?.id) {
      return {
        sucesso: false,
        erro: conflito?.erro || pendente?.ultimoErro || resultado?.erro || 'A OS ainda não foi confirmada pelo servidor.'
      };
    }
    const { data: confirmada, error: erroConfirmacao } = await this.client.from('ordens_servico')
      .select('id,revision,updated_at')
      .eq('id', mapeamento.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!erroConfirmacao && confirmada?.id) {
      this.stateStore.registrarMapeamentoOS(osLocal.numero, confirmada);
      this.db.registrarMetadadosSupabase?.(osLocal.numero, confirmada);
      return { sucesso: true, id: confirmada.id, revision: confirmada.revision };
    }
    return {
      sucesso: false,
      erro: erroConfirmacao
        ? mensagemErro(erroConfirmacao)
        : 'A OS ainda não está disponível para consulta no celular.'
    };
  }

  sincronizarEstoqueAgora() {
    if (!this.contexto || this.contexto.administrador_global === true) return;
    this.solicitarSincronizacao();
  }

  async _enviarItem(item) {
    const estado = this.stateStore.obter();
    const map = estado.mapeamentosOS[item.numero] || {};
    let linha;
    if (item.operacao === 'insert' || (!item.dados.remoteId && !map.id && item.operacao === 'update')) {
      const { data, error } = await this.client.rpc('criar_ordem_servico_desktop', {
        p_numero: item.numero,
        p_id_exportacao: item.dados.idExportacao,
        p_dados: item.dados.dados,
        p_origem_dispositivo_id: estado.dispositivoId
      });
      if (error) throw error;
      linha = primeiraLinha(data);
    } else if (item.operacao === 'update') {
      const remoteId = item.dados.remoteId || map.id;
      let remoteRevision = Number(item.dados.revision || map.revision || 0);
      let dadosAtualizacao = item.dados.dados;
      let reconciliouConflito = false;
      let resposta = await this.client.rpc('atualizar_ordem_servico', {
        p_id: remoteId,
        p_revision: remoteRevision,
        p_patch: dadosAtualizacao
      });
      if (resposta.error && /conflito_revision|conflito de revis/i.test(mensagemErro(resposta.error))) {
        const { data: atual, error: erroBusca } = await this.client.from('ordens_servico')
          .select(CAMPOS_PULL_OS)
          .eq('id', remoteId)
          .maybeSingle();
        if (erroBusca) throw erroBusca;
        if (atual?.deleted_at) return atual;
        if (atual?.id && Number(atual.revision) !== remoteRevision) {
          remoteRevision = Number(atual.revision) || 0;
          // Nunca repete cegamente o JSON antigo. Parcelas têm merge por ID
          // e tombstone, preservando o que o celular acabou de criar/editar.
          if (dadosAtualizacao?.dados_extras || atual.dados_extras) {
            const valorTotal = Number(
              dadosAtualizacao?.dados_extras?.valor_total_servico ??
              atual.dados_extras?.valor_total_servico ??
              dadosAtualizacao?.valor ?? atual.valor ?? 0
            ) || 0;
            const extras = mesclarExtrasCobranca(
              dadosAtualizacao?.dados_extras,
              atual.dados_extras,
              valorTotal
            );
            dadosAtualizacao = { ...dadosAtualizacao, dados_extras: extras };
            if (extras.status_pagamento_local === 'Pago') dadosAtualizacao.status_pagamento = 'Autorizado';
          }
          reconciliouConflito = true;
          resposta = await this.client.rpc('atualizar_ordem_servico', {
            p_id: remoteId,
            p_revision: remoteRevision,
            p_patch: dadosAtualizacao
          });
        }
      }
      if (resposta.error) throw resposta.error;
      linha = primeiraLinha(resposta.data);
      // O merge pode ter incorporado parcelas que não existiam no arquivo
      // local. Reaplica a linha confirmada no banco do PC imediatamente.
      if (reconciliouConflito) {
        if (!linha?.dados_extras) {
          const confirmacao = await this.client.from('ordens_servico')
            .select(CAMPOS_PULL_OS).eq('id', remoteId).maybeSingle();
          if (confirmacao.error) throw confirmacao.error;
          linha = confirmacao.data || linha;
        }
        if (linha?.dados_extras) {
          this.db.aplicarOSSupabase?.(remotoParaLocal(linha, this.db.obterOSPorNumero(item.numero)));
        }
      }
    } else if (item.operacao === 'delete') {
      let remoteId = item.dados.remoteId || map.id || '';
      let remoteRevision = Number(item.dados.revision || map.revision || 0);
      let busca = this.client.from('ordens_servico').select('id,revision,deleted_at');
      busca = remoteId ? busca.eq('id', remoteId) : busca.eq('numero', item.numero);
      const { data: encontrada, error: buscaErro } = await busca.maybeSingle();
      if (buscaErro) throw buscaErro;
      if (encontrada?.deleted_at) return encontrada;
      remoteId = encontrada?.id || remoteId;
      remoteRevision = Number(encontrada?.revision || remoteRevision || 0);
      if (!remoteId) return null;
      // A exclusao so e confirmada depois que PDF, fotos, assinaturas e
      // miniaturas forem removidos fisicamente do Storage.
      await this.fileService.removerArquivosOSRemotos(remoteId);
      const { data, error } = await this.client.rpc('excluir_ordem_servico', {
        p_id: remoteId,
        p_revision: remoteRevision
      });
      if (error) throw error;
      linha = primeiraLinha(data);
    }
    if (linha?.id) {
      this.stateStore.registrarMapeamentoOS(item.numero, linha);
      this.db.registrarMetadadosSupabase?.(item.numero, linha);
      if (item.operacao !== 'delete') {
        const osAtual = this.db.obterOSPorNumero(item.numero);
        if (osAtual) await this.fileService.catalogarOS(osAtual, linha);
      }
    }
    return linha;
  }

  async _processarFila() {
    const agora = Date.now();
    const itens = this.stateStore.obter().fila.filter((item) => item.status === 'pendente' && (!item.proximaTentativaEm || new Date(item.proximaTentativaEm).getTime() <= agora));
    let enviados = 0;
    // Limita cada rajada depois de um período offline. O restante continua
    // em lotes curtos para não monopolizar o PostgREST nem a CPU do projeto.
    for (const item of itens.slice(0, 10)) {
      try {
        await this._enviarItem(item);
        this.stateStore.alterar((estado) => { estado.fila = estado.fila.filter((x) => x.id !== item.id); });
        enviados += 1;
      } catch (erro) {
        const msg = mensagemErro(erro);
        this.stateStore.alterar((estado) => {
          const atual = estado.fila.find((x) => x.id === item.id);
          if (!atual) return;
          atual.tentativas = (atual.tentativas || 0) + 1;
          atual.ultimoErro = msg;
          if (/conflito_revision|conflito de revis/i.test(msg)) {
            atual.status = 'conflito';
            const jaRegistrado = estado.conflitos.some((conflito) => conflito.numero === atual.numero);
            if (!jaRegistrado) {
              estado.conflitos.push({ id: atual.id, numero: atual.numero, dadosLocais: atual.dados, erro: msg, criadoEm: new Date().toISOString() });
            }
          } else {
            const atraso = Math.min(300000, 2000 * Math.pow(2, Math.min(atual.tentativas, 7)));
            atual.proximaTentativaEm = new Date(Date.now() + atraso).toISOString();
          }
        });
      }
    }
    return enviados;
  }

  _osRemotaJaAplicada(linha, estado) {
    if (!linha?.numero || linha.deleted_at) return false;
    const local = this.db.obterOSPorNumero?.(linha.numero);
    const mapeamento = estado?.mapeamentosOS?.[linha.numero];
    if (!local || !mapeamento || mapeamento.id !== linha.id || mapeamento.deletedAt) return false;
    const revisaoLocal = Number(mapeamento.revision) || 0;
    const revisaoRemota = Number(linha.revision) || 0;
    const dataLocal = String(mapeamento.updatedAt || '');
    const dataRemota = String(linha.updated_at || '');
    return revisaoLocal >= revisaoRemota && (!dataRemota || dataLocal >= dataRemota);
  }

  async _aplicarLinhaRemotaOS(linha, idsEmConflito, estadoReferencia) {
    if (!linha?.numero || idsEmConflito.has(linha.id)) return 0;
    if (this._osRemotaJaAplicada(linha, estadoReferencia)) return 0;
    if (linha.deleted_at) {
      this.stateStore.confirmarExclusaoOSRemota(linha.numero, linha);
      this.db.removerOSSupabase?.(linha.numero, linha);
    } else {
      this.db.aplicarOSSupabase?.(remotoParaLocal(linha, this.db.obterOSPorNumero(linha.numero)));
      await this.fileService.baixarArquivosOS(linha.id, linha.numero);
      const osLocal = await this.processadorOSRemota?.(linha.numero);
      if (osLocal) await this.fileService.catalogarOS(osLocal, linha);
    }
    if (estadoReferencia?.mapeamentosOS) {
      estadoReferencia.mapeamentosOS[linha.numero] = {
        id: linha.id,
        revision: Number(linha.revision) || 1,
        idExportacao: linha.id_exportacao || '',
        updatedAt: linha.updated_at || linha.deleted_at || new Date().toISOString(),
        ...(linha.deleted_at ? { deletedAt: linha.deleted_at } : {})
      };
    }
    return 1;
  }

  _persistirMapeamentosOSLote(linhas, idsEmConflito, estadoReferencia) {
    if (!linhas.length) return;
    this.stateStore.alterar((estado) => {
      estado.mapeamentosOS = estado.mapeamentosOS || {};
      for (const linha of linhas) {
        if (!linha?.numero || idsEmConflito.has(linha.id)) continue;
        const mapeamento = estadoReferencia?.mapeamentosOS?.[linha.numero];
        if (mapeamento) estado.mapeamentosOS[linha.numero] = mapeamento;
      }
    });
  }

  async _baixarMudancas() {
    const estado = this.stateStore.obter();
    const ultimo = estado.ultimoPullEm || '1970-01-01T00:00:00.000Z';
    const instante = Date.parse(ultimo);
    // Rele uma pequena janela e usa >= para nunca perder linhas que tenham o
    // mesmo updated_at exatamente no limite entre duas paginas/dispositivos.
    const desde = Number.isFinite(instante)
      ? new Date(Math.max(0, instante - SOBREPOSICAO_CURSOR_OS_MS)).toISOString()
      : '1970-01-01T00:00:00.000Z';
    let aplicadas = 0;
    let maiorData = ultimo;
    const idsEmConflito = new Set(estado.conflitos.map((c) => estado.mapeamentosOS[c.numero]?.id).filter(Boolean));
    let inicio = 0;
    let recebeuDados = false;
    while (true) {
      const { data, error } = await this.client.from('ordens_servico')
        .select(CAMPOS_PULL_OS)
        .gte('updated_at', desde)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA_OS - 1);
      if (error) throw error;
      const linhas = data || [];
      if (linhas.length) recebeuDados = true;
      const mapeamentosAplicados = [];
      for (const linha of linhas) {
        const aplicada = await this._aplicarLinhaRemotaOS(linha, idsEmConflito, estado);
        aplicadas += aplicada;
        if (aplicada) mapeamentosAplicados.push(linha);
        if (linha.updated_at && (!maiorData || linha.updated_at > maiorData)) maiorData = linha.updated_at;
      }
      this._persistirMapeamentosOSLote(mapeamentosAplicados, idsEmConflito, estado);
      if (linhas.length < TAMANHO_PAGINA_OS) break;
      inicio += TAMANHO_PAGINA_OS;
    }
    if (recebeuDados) {
      this.stateStore.alterar((s) => { s.ultimoPullEm = maiorData; });
    }
    return aplicadas;
  }

  async _reconciliarCatalogoOSCompleto({ forcar = false } = {}) {
    const estado = this.stateStore.obter();
    const ultima = Date.parse(estado.ultimaReconciliacaoOSCompletaEm || '');
    if (!forcar && Number.isFinite(ultima) && Date.now() - ultima < INTERVALO_RECONCILIACAO_OS_COMPLETA_MS) return 0;

    const idsEmConflito = new Set(estado.conflitos.map((c) => estado.mapeamentosOS[c.numero]?.id).filter(Boolean));
    let aplicadas = 0;
    let inicio = 0;
    while (true) {
      const { data, error } = await this.client.from('ordens_servico')
        .select(CAMPOS_PULL_OS)
        .order('id', { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA_OS - 1);
      if (error) throw error;
      const linhas = data || [];
      const mapeamentosAplicados = [];
      for (const linha of linhas) {
        const aplicada = await this._aplicarLinhaRemotaOS(linha, idsEmConflito, estado);
        aplicadas += aplicada;
        if (aplicada) mapeamentosAplicados.push(linha);
      }
      this._persistirMapeamentosOSLote(mapeamentosAplicados, idsEmConflito, estado);
      if (linhas.length < TAMANHO_PAGINA_OS) break;
      inicio += TAMANHO_PAGINA_OS;
    }
    this.stateStore.alterar((s) => { s.ultimaReconciliacaoOSCompletaEm = new Date().toISOString(); });
    return aplicadas;
  }

  async _baixarExclusoesOS() {
    const dispositivoId = this.stateStore.obter().dispositivoId;
    let aplicadas = 0;

    // A exclusao definitiva remove a linha de ordens_servico. Portanto ela
    // nao pode mais ser descoberta consultando deleted_at nessa tabela. A
    // outbox conserva somente id/numero/data e entrega o evento uma vez para
    // cada desktop, inclusive quando o PC estava desligado no momento.
    if (dispositivoId && typeof this.client.rpc === 'function') {
      const pendentes = await this.client.rpc('listar_exclusoes_os_pendentes', {
        p_dispositivo_id: dispositivoId
      });
      if (pendentes.error && !/listar_exclusoes_os_pendentes|PGRST202/i.test(mensagemErro(pendentes.error))) {
        throw pendentes.error;
      }
      for (const evento of (pendentes.data || [])) {
        if (!evento?.numero || !evento?.evento_id) continue;
        const linha = {
          id: evento.id,
          numero: evento.numero,
          id_exportacao: evento.id_exportacao,
          revision: evento.revision,
          updated_at: evento.deleted_at,
          deleted_at: evento.deleted_at
        };
        this.stateStore.confirmarExclusaoOSRemota(evento.numero, linha);
        const resultado = this.db.removerOSSupabase?.(evento.numero, linha);
        if (resultado?.removida || resultado?.sucesso) aplicadas += 1;
        const confirmacao = await this.client.rpc('confirmar_exclusao_os_desktop', {
          p_evento_id: evento.evento_id,
          p_dispositivo_id: dispositivoId
        });
        if (confirmacao.error) throw confirmacao.error;
      }
    }

    // Recuperacao para exclusoes feitas por versoes antigas, quando ainda
    // nao existia a outbox acima. Somente OS que possuem supabaseId entram
    // aqui; uma OS puramente local jamais e apagada por esta reconciliacao.
    if (typeof this.db.listarOrdens === 'function') {
      const candidatas = (this.db.listarOrdens() || []).filter((osLocal) => osLocal?.supabaseId);
      for (let inicio = 0; inicio < candidatas.length; inicio += 100) {
        const lote = candidatas.slice(inicio, inicio + 100);
        const ids = lote.map((osLocal) => osLocal.supabaseId);
        const consulta = this.client.from('ordens_servico').select('id,numero').in('id', ids);
        const { data: existentes, error: erroExistentes } = await consulta;
        if (erroExistentes) throw erroExistentes;
        const idsExistentes = new Set((existentes || []).map((linha) => linha.id));
        for (const osLocal of lote) {
          if (idsExistentes.has(osLocal.supabaseId)) continue;
          const linha = {
            id: osLocal.supabaseId,
            numero: osLocal.numero,
            revision: osLocal.supabaseRevision || 1,
            deleted_at: new Date().toISOString()
          };
          this.stateStore.confirmarExclusaoOSRemota(osLocal.numero, linha);
          const resultado = this.db.removerOSSupabase?.(osLocal.numero, linha);
          if (resultado?.removida || resultado?.sucesso) aplicadas += 1;
        }
      }
    }

    const estado = this.stateStore.obter();
    const ultimo = estado.ultimoPullExclusoesEm || '1970-01-01T00:00:00.000Z';
    // Rele uma pequena janela para nao perder duas exclusoes com o mesmo
    // timestamp nem tombstones criados exatamente no limite do checkpoint.
    const instante = Date.parse(ultimo);
    const desde = Number.isFinite(instante)
      ? new Date(Math.max(0, instante - 5000)).toISOString()
      : '1970-01-01T00:00:00.000Z';
    const { data, error } = await this.client.from('ordens_servico')
      .select('id,numero,id_exportacao,revision,updated_at,deleted_at')
      .not('deleted_at', 'is', null)
      .gte('deleted_at', desde)
      .order('deleted_at', { ascending: true })
      .limit(500);
    if (error) throw error;

    let maiorData = ultimo;
    for (const linha of (data || [])) {
      if (!linha?.numero || !linha?.deleted_at) continue;
      this.stateStore.confirmarExclusaoOSRemota(linha.numero, linha);
      const resultado = this.db.removerOSSupabase?.(linha.numero, linha);
      if (resultado?.removida || resultado?.sucesso) aplicadas += 1;
      if (!maiorData || linha.deleted_at > maiorData) maiorData = linha.deleted_at;
    }
    if (data?.length) {
      this.stateStore.alterar((s) => { s.ultimoPullExclusoesEm = maiorData; });
    }
    return aplicadas;
  }

  async _baixarArquivosDocumentoComercial(tipo, entidadeId) {
    const { data, error } = await this.client.from('arquivos')
      .select('id,entidade_id,categoria,nome_arquivo,mime_type,storage_bucket,miniatura_path,arquivo_nuvem_path,origem_dispositivo_id,updated_at')
      .eq('entidade_tipo', tipo)
      .eq('entidade_id', entidadeId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: true });
    if (error) throw error;
    const resultado = { assinaturas: {}, fotos: [], paraConsumo: [] };
    for (const arquivo of (data || [])) {
      const categoria = String(arquivo.categoria || '');
      const ehAssinatura = /^assinatura_/.test(categoria);
      const ehFoto = categoria === 'foto' || categoria === 'fotos' || /^foto_/.test(categoria);
      if (!arquivo.storage_bucket || !arquivo.arquivo_nuvem_path || (!ehAssinatura && !ehFoto)) continue;
      const download = await this.client.storage.from(arquivo.storage_bucket).download(arquivo.arquivo_nuvem_path);
      if (download.error) throw download.error;
      const bytes = Buffer.from(await download.data.arrayBuffer());
      const base64 = `data:${arquivo.mime_type || 'image/png'};base64,${bytes.toString('base64')}`;
      if (ehAssinatura) resultado.assinaturas[categoria] = base64;
      if (ehFoto) resultado.fotos.push({ base64, supabaseArquivoId: arquivo.id || null });
      if (arquivo.origem_dispositivo_id) resultado.paraConsumo.push({ arquivo, bytes });
    }
    return resultado;
  }

  async _baixarDocumentosComerciais() {
    if (!this.processadorDocumentoComercialRemoto) return 0;
    // Versoes antigas do APK enviavam Compra/Venda antes de anexar a
    // assinatura da assistencia e sem congelar os termos do documento. O
    // arquivo continua sendo a fonte preferencial, mas a identidade mobile
    // da mesma empresa e um fallback seguro para nao gerar PDF em branco.
    let identidadeMobilePromessa = null;
    const obterIdentidadeMobile = () => {
      if (!identidadeMobilePromessa) {
        identidadeMobilePromessa = (async () => {
          const resposta = await this.client.from('configuracoes_empresa')
            .select('configuracoes')
            .eq('empresa_id', this.contexto?.empresa_id)
            .maybeSingle();
          if (resposta.error) throw resposta.error;
          const identidade = resposta.data?.configuracoes?.identidadeEmpresa || {};
          const config = identidade.configMobile && typeof identidade.configMobile === 'object'
            ? identidade.configMobile : {};
          let assinatura = '';
          if (identidade.assinaturaStoragePath) {
            const download = await this.client.storage.from('identidade-empresa')
              .download(identidade.assinaturaStoragePath);
            if (download.error) throw download.error;
            const bytes = Buffer.from(await download.data.arrayBuffer());
            assinatura = `data:${download.data.type || 'image/png'};base64,${bytes.toString('base64')}`;
          }
          return { config, assinatura };
        })();
      }
      return identidadeMobilePromessa;
    };
    const termosDaIdentidade = (config, tipo) => {
      const sufixo = tipo === 'compra' ? 'Compra' : 'Venda';
      const custom = String(config?.[`termosCustom${sufixo}`] || '').trim();
      if (custom) return custom;
      if (config?.[`usarTermosPredefinidos${sufixo}`] === true) {
        return String(config?.[`termosPadraoUsuario${sufixo}`] || '').trim();
      }
      return '';
    };
    const estadoInicial = this.stateStore.obter();
    const ultimo = estadoInicial.ultimoPullComercialEm || '1970-01-01T00:00:00.000Z';
    const instante = Date.parse(ultimo);
    const desde = Number.isFinite(instante)
      ? new Date(Math.max(0, instante - 10000)).toISOString()
      : '1970-01-01T00:00:00.000Z';
    const [compras, vendas, entregas] = await Promise.all([
      this.client.from('compras').select(CAMPOS_PULL_COMPRA).gte('updated_at', desde).order('updated_at', { ascending: true }).limit(500),
      this.client.from('vendas').select(CAMPOS_PULL_VENDA).gte('updated_at', desde).order('updated_at', { ascending: true }).limit(500),
      // Entregas sao reconciliadas por versao, sem depender exclusivamente
      // do cursor. Isso recupera comprovantes antigos que ficaram na nuvem
      // enquanto o PC estava desligado ou quando um checkpoint foi adiantado.
      this.client.from('entregas').select(CAMPOS_PULL_ENTREGA).is('deleted_at', null).order('updated_at', { ascending: false }).limit(500)
    ]);
    if (compras.error) throw compras.error;
    if (vendas.error) throw vendas.error;
    if (entregas.error) throw entregas.error;
    const alteracoes = [
      ...(compras.data || []).map((linha) => ({ tipo: 'compra', linha })),
      ...(vendas.data || []).map((linha) => ({ tipo: 'venda', linha })),
      ...(entregas.data || []).map((linha) => ({ tipo: 'entrega', linha }))
    ].sort((a, b) => String(a.linha.updated_at).localeCompare(String(b.linha.updated_at)));
    let aplicadas = 0;
    let maiorData = ultimo;
    for (const item of alteracoes) {
      const linha = item.linha;
      const chaveProcessada = `${item.tipo}:${linha?.id || ''}`;
      const processadoEm = this.stateStore.obter().documentosComerciais?.[chaveProcessada] || '';
      if (processadoEm && processadoEm === linha?.updated_at) {
        if (linha.updated_at && linha.updated_at > maiorData) maiorData = linha.updated_at;
        continue;
      }
      let extras = linha?.dados_extras;
      if (typeof extras === 'string') {
        try { extras = JSON.parse(extras); } catch (_) { extras = null; }
      }
      const mobile = extras?.documento_mobile || (extras?.numeroOS ? extras : null);
      if (!linha.deleted_at && mobile && typeof mobile === 'object') {
        const dados = Object.assign({}, mobile);
        if (item.tipo === 'entrega' && !dados.numeroOS) dados.numeroOS = linha.numero_os_snapshot;
        const arquivos = await this._baixarArquivosDocumentoComercial(item.tipo, linha.id);
        const assinaturas = arquivos.assinaturas;
        if (item.tipo === 'compra') {
          dados.assinaturaVendedorBase64 = assinaturas.assinatura_vendedor || '';
          dados.assinaturaAssistenciaBase64 = assinaturas.assinatura_assistencia || '';
          if (!dados.assinaturaAssistenciaBase64 || !String(dados.termosCompra || '').trim()) {
            const identidade = await obterIdentidadeMobile();
            if (!dados.assinaturaAssistenciaBase64) dados.assinaturaAssistenciaBase64 = identidade.assinatura || '';
            if (!String(dados.termosCompra || '').trim()) dados.termosCompra = termosDaIdentidade(identidade.config, 'compra');
          }
          dados.fotos = arquivos.fotos;
        } else if (item.tipo === 'venda') {
          dados.assinaturaCompradorBase64 = assinaturas.assinatura_comprador || '';
          dados.assinaturaAssistenciaBase64 = assinaturas.assinatura_assistencia || '';
          if (!dados.assinaturaAssistenciaBase64 || !String(dados.termosVenda || '').trim()) {
            const identidade = await obterIdentidadeMobile();
            if (!dados.assinaturaAssistenciaBase64) dados.assinaturaAssistenciaBase64 = identidade.assinatura || '';
            if (!String(dados.termosVenda || '').trim()) dados.termosVenda = termosDaIdentidade(identidade.config, 'venda');
          }
        } else {
          const assinaturaEntrega = assinaturas.assinatura_retirou || assinaturas.assinatura_cliente || '';
          if (assinaturaEntrega && dados.naoAssinado !== true && dados.assinaturaPendente !== true) dados.assinaturaRetirouBase64 = assinaturaEntrega;
          else if (dados.naoAssinado === true || dados.assinaturaPendente === true) dados.assinaturaRetirouBase64 = '';
          dados.fotos = arquivos.fotos;
          dados.valorReparo = Number(dados.valorReparo || linha.valor_reparo || 0) || 0;
          dados.formaPagamento = dados.formaPagamento || linha.forma_pagamento || '';
          dados.supabaseId = linha.id;
          dados.supabaseRevision = linha.revision;
          dados.cicloEntregaId = linha.ciclo_entrega_id || dados.cicloEntregaId || linha.retorno_garantia_id || 'original';
          dados.tipoEntrega = linha.tipo_entrega || dados.tipoEntrega || (dados.cicloEntregaId === 'original' ? 'original' : 'retorno_garantia');
          dados.retornoGarantiaId = linha.retorno_garantia_id || dados.retornoGarantiaId || null;
          dados.garantiaId = linha.garantia_id || dados.garantiaId || null;
        }
        const resultado = await this.processadorDocumentoComercialRemoto({
          tipoArquivo: 'sistema-os-celular-lote',
          versaoFormato: 2,
          geradoEm: linha.updated_at,
          itens: [{ idExportacao: linha.id_exportacao, tipoDocumento: item.tipo, dados }]
        });
        if (!resultado?.sucesso) throw new Error(resultado?.erro || `Não foi possível importar ${item.tipo} do celular.`);
        if (item.tipo === 'entrega') this.aftercareService?.recebeuEntrega(dados.numeroOS, linha);
        for (const pendente of arquivos.paraConsumo) {
          await this.fileService.confirmarConsumoMobile(pendente.arquivo, pendente.bytes);
        }
        this.stateStore.alterar((s) => {
          s.documentosComerciais = s.documentosComerciais || {};
          s.documentosComerciais[chaveProcessada] = linha.updated_at || new Date().toISOString();
        });
        aplicadas += 1;
      }
      if (linha.updated_at && linha.updated_at > maiorData) maiorData = linha.updated_at;
    }
    if (alteracoes.length) this.stateStore.alterar((s) => { s.ultimoPullComercialEm = maiorData; });
    return aplicadas;
  }

  async _baixarRespostasAssinatura() {
    if (!this.processadorRespostaAssinatura) return 0;
    const { data, error } = await this.client.functions.invoke('assinaturas-remotas', {
      body: { acao: 'buscar_respostas', dados: {} }
    });
    if (error) throw new Error(await erroDaEdgeFunction(error));
    if (data?.erro) throw new Error(data.erro);
    let aplicadas = 0;
    for (const solicitacao of (data?.solicitacoes || [])) {
      const resposta = solicitacao?.resposta;
      if (!resposta || !solicitacao?.id) continue;
      const resultado = await this.processadorRespostaAssinatura(resposta);
      if (!resultado?.sucesso) continue;
      const confirmacao = await this.client.functions.invoke('assinaturas-remotas', {
        body: { acao: 'confirmar_resposta', dados: { solicitacaoId: solicitacao.id } }
      });
      if (confirmacao.error) throw new Error(await erroDaEdgeFunction(confirmacao.error));
      if (confirmacao.data?.erro) throw new Error(confirmacao.data.erro);
      aplicadas += 1;
    }
    return aplicadas;
  }

  async sincronizarAgora() {
    if (this.syncEmAndamento) return this.syncEmAndamento;
    if (this.contexto?.administrador_global === true) {
      return { sucesso: true, enviados: 0, recebidos: 0, arquivos: 0, modo: 'suporte_global' };
    }
    if (!this.client || !this.contexto) return { sucesso: false, erro: 'Faça login no Supabase para sincronizar.' };
    if (Date.now() < Number(this.syncSuspensoAte || 0)) {
      return {
        sucesso: false,
        adiada: true,
        erro: 'Sincronização temporariamente pausada para proteger o servidor.',
        proximaTentativaEm: new Date(this.syncSuspensoAte).toISOString()
      };
    }
    this.syncEmAndamento = (async () => {
      try {
        if (!this.stateStore.obter().dispositivoId) await this.enviarHeartbeat();
        const avisos = [];
        // O estoque tem ciclo proprio e precisa sincronizar mesmo quando uma
        // garantia, entrega ou outro documento estiver em conflito. Antes ele
        // era executado depois desses modulos; um unico conflito impedia o
        // S20 FE vendido e aparelhos novos de chegarem ao Android.
        let estoque = { enviados: 0, recebidos: 0 };
        try {
          estoque = await this.inventoryService.sincronizar();
        } catch (erroEstoque) {
          avisos.push(`Estoque: ${mensagemErro(erroEstoque)}`);
        }
        let enviados = await this._processarFila();
        // Tombstones usam checkpoint proprio. Assim, mesmo que o cursor de
        // atualizacoes normais avance, uma exclusao do celular sempre chega ao PC.
        const exclusoes = await this._baixarExclusoesOS();
        // O pull incremental e rapido; a reconciliacao periodica completa
        // repara automaticamente uma instalacao nova, backup antigo ou cursor
        // legado que tenha deixado alguma OS para tras em outro computador.
        const recebidos = (await this._baixarMudancas())
          + (await this._reconciliarCatalogoOSCompleto())
          + exclusoes;
        const entregasPublicadas = await (this.aftercareService?.sincronizar('entrega') || Promise.resolve({ enviados: 0, recebidos: 0 })).catch((erro) => {
          avisos.push(`Entregas: ${mensagemErro(erro)}`);
          return { enviados: 0, recebidos: 0 };
        });
        const comerciais = await this._baixarDocumentosComerciais();
        const garantiasSincronizadas = await (this.aftercareService?.sincronizar('garantia') || Promise.resolve({ enviados: 0, recebidos: 0 })).catch((erro) => {
          avisos.push(`Garantias: ${mensagemErro(erro)}`);
          return { enviados: 0, recebidos: 0 };
        });
        const desbloqueiosSincronizados = await (this.desbloqueioCloudService?.sincronizar() || Promise.resolve({ enviados: 0, recebidos: 0 })).catch((erro) => {
          avisos.push(`Desbloqueios: ${mensagemErro(erro)}`);
          return { enviados: 0, recebidos: 0 };
        });
        enviados += (entregasPublicadas?.enviados || 0) + (garantiasSincronizadas?.enviados || 0) + (desbloqueiosSincronizados?.enviados || 0);
        const assinaturas = await this._baixarRespostasAssinatura();
        // A importação da assinatura regenera o PDF e enfileira a nova versão
        // durante este ciclo. Publica agora para o celular não abrir a anterior.
        if (assinaturas > 0) enviados += await this._processarFila();
        const arquivosRemotos = await this.fileService.sincronizarArquivosRemotos();
        for (const numero of arquivosRemotos.numeros) {
          const linha = this.stateStore.obter().mapeamentosOS[numero];
          const osLocal = await this.processadorOSRemota?.(numero);
          if (osLocal && linha?.id) await this.fileService.catalogarOS(osLocal, linha);
        }
        const arquivos = await this.fileService.responderSolicitacoesPendentes();
        const estadoAntes = this.stateStore.obter();
        const ultimaLogo = Date.parse(estadoAntes.logoEmpresa?.verificadaEm || '') || 0;
        if (Date.now() - ultimaLogo >= 60000) {
          await this.companyCloudService?.sincronizarConfiguracaoCompartilhada().catch((erro) => {
            console.error('[Supabase] Falha temporaria ao atualizar os dados da empresa:', mensagemErro(erro));
          });
          await this.companyCloudService?.sincronizarLogo().catch((erro) => {
            console.error('[Supabase] Falha temporaria ao atualizar a logo:', mensagemErro(erro));
          });
          this.stateStore.alterar((s) => {
            s.logoEmpresa = Object.assign({}, s.logoEmpresa || {}, { verificadaEm: new Date().toISOString() });
          });
        }
        await this.fileService.limparTemporariosExpirados();
        await this.fileService.limparObjetosStoragePendentes();
        const agora = new Date().toISOString();
        this.stateStore.alterar((s) => {
          s.ultimaSincronizacaoEm = agora;
          s.ultimoErro = avisos.join(' | ');
        });
        this.ultimoStatus = { ativo: true, autenticado: true, conectado: true, modo: 'supabase' };
        this.syncFalhasConsecutivas = 0;
        this.syncSuspensoAte = 0;
        enviados += estoque.enviados;
        const recebidosTotais = recebidos + comerciais + estoque.recebidos + (garantiasSincronizadas?.recebidos || 0) + (desbloqueiosSincronizados?.recebidos || 0);
        this.janela?.()?.webContents?.send?.('supabase:sincronizado', {
          enviados, recebidos: recebidosTotais,
          estoqueEnviados: estoque.enviados, estoqueRecebidos: estoque.recebidos,
          arquivos: arquivos.respondidas + arquivosRemotos.aplicados,
          avisos,
          em: agora
        });
        return {
          sucesso: true, enviados, recebidos: recebidosTotais, comerciais, assinaturas,
          estoqueEnviados: estoque.enviados, estoqueRecebidos: estoque.recebidos,
          arquivos: arquivos.respondidas + arquivosRemotos.aplicados,
          avisos,
          em: agora
        };
      } catch (erro) {
        const msg = mensagemErro(erro);
        if (/pgrst00[02]|service unavailable|http 429|http 5\d\d|timeout|tempo_limite|statement timeout|lock timeout|failed to fetch|network/i.test(msg)) {
          this.syncFalhasConsecutivas += 1;
          if (this.syncFalhasConsecutivas >= 2) {
            const base = Math.min(300000, 15000 * Math.pow(2, Math.min(this.syncFalhasConsecutivas - 2, 4)));
            const jitter = Math.floor(Math.random() * 5000);
            this.syncSuspensoAte = Date.now() + base + jitter;
            this.solicitarSincronizacao(base + jitter);
          }
        } else {
          this.syncFalhasConsecutivas = 0;
        }
        this.stateStore.alterar((s) => { s.ultimoErro = msg; });
        this.ultimoStatus = { ativo: true, autenticado: true, conectado: false, erro: msg, modo: 'supabase' };
        return { sucesso: false, erro: msg };
      } finally {
        this.syncEmAndamento = null;
        // Se o lote foi limitado ou uma alteração chegou durante o ciclo,
        // agenda exatamente uma continuação depois que o lock foi liberado.
        // Isso evita o timer disparar contra a própria sincronização ativa.
        const aindaPendente = this.stateStore.obter().fila.some((item) =>
          item.status === 'pendente' &&
          (!item.proximaTentativaEm || new Date(item.proximaTentativaEm).getTime() <= Date.now())
        );
        if (aindaPendente) this.solicitarSincronizacao(15000);
      }
    })();
    return this.syncEmAndamento;
  }

  async obterIntegracaoMercadoPago() {
    if (!this.client || !this.contexto) return { sucesso: false, erro: 'Entre para consultar as integrações.' };
    try {
      const { data, error } = await this.client.from('integracoes_empresa')
        .select('id,status,conta_mascarada,conectado_em,ultima_verificacao_em,ultimo_erro')
        .eq('empresa_id', this.contexto.empresa_id)
        .eq('tipo', 'mercado_pago')
        .maybeSingle();
      if (error) throw error;
      return { sucesso: true, integracao: data || null };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async gerenciarIntegracaoMercadoPago(acao, accessToken) {
    if (!this.client || !this.contexto) return { sucesso: false, erro: 'Entre para administrar as integrações.' };
    try {
      const { data, error } = await this.client.functions.invoke('integracoes-empresa', {
        body: {
          tipo: 'mercado_pago',
          acao: String(acao || ''),
          accessToken: String(accessToken || '')
        }
      });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      if (data?.erro) throw new Error(data.erro);
      return {
        sucesso: true,
        integracao: data?.integracao || null,
        mensagem: String(data?.mensagem || ''),
        status_verificado: data?.status_verificado === true,
        codigo: String(data?.codigo || '')
      };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async verificarIntegracaoMercadoPago() {
    return this.gerenciarIntegracaoMercadoPago('verificar', '');
  }

  async criarPreferenciaMercadoPago(dados) {
    if (!this.client || !this.contexto || this.contexto.administrador_global) {
      return { sucesso: false, erro: 'Entre em uma empresa para gerar o link do Mercado Pago.' };
    }
    try {
      const { data, error } = await this.client.functions.invoke('integracoes-empresa', {
        body: {
          tipo: 'mercado_pago',
          acao: 'criar_preferencia',
          dados: dados && typeof dados === 'object' ? dados : {}
        }
      });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      if (data?.erro) throw new Error(data.erro);
      const link = String(data?.link || '').trim();
      if (!link) throw new Error('O Mercado Pago não devolveu o link de pagamento.');
      return {
        sucesso: true,
        link,
        preferenciaId: String(data?.preferencia_id || ''),
        mensagem: String(data?.mensagem || 'Link do Mercado Pago gerado com sucesso.')
      };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async consultarPagamentosMercadoPago(numero) {
    if (!this.client || !this.contexto || this.contexto.administrador_global) {
      return { sucesso: false, erro: 'Entre em uma empresa para consultar os pagamentos do Mercado Pago.' };
    }
    try {
      const { data, error } = await this.client.functions.invoke('integracoes-empresa', {
        body: {
          tipo: 'mercado_pago',
          acao: 'consultar_pagamentos',
          dados: { numero: String(numero || '').trim() }
        }
      });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      if (data?.erro) throw new Error(data.erro);
      return {
        sucesso: true,
        pagamentos: Array.isArray(data?.pagamentos) ? data.pagamentos : []
      };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async assinaturasSaas(acao, dados = {}) {
    if (!this.client || !this.contexto) {
      return { sucesso: false, erro: 'Entre novamente para consultar sua assinatura.' };
    }
    try {
      const { data, error } = await this.client.functions.invoke('assinaturas-saas', {
        body: { acao: String(acao || ''), dados: dados && typeof dados === 'object' ? dados : {} }
      });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      if (data?.erro) throw new Error(data.erro);
      return Object.assign({ sucesso: true }, data || {});
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async fiscalDocumentos(acao, dados = {}) {
    if (!this.client || !this.contexto || this.contexto.administrador_global) {
      return { sucesso: false, erro: 'Entre em uma empresa para usar a nota fiscal.' };
    }
    try {
      const { data, error } = await this.client.functions.invoke('fiscal-documentos', {
        body: { acao: String(acao || ''), dados: dados && typeof dados === 'object' ? dados : {} }
      });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      if (data?.erro) throw new Error(data.erro);
      return Object.assign({ sucesso: true }, data || {});
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async integracaoWhatsAppApi(acao, dados = {}) {
    if (!this.client || !this.contexto || this.contexto.administrador_global) {
      return { sucesso: false, erro: 'Entre em uma empresa para configurar o WhatsApp.' };
    }
    try {
      const corpo = { tipo: 'whatsapp', acao: String(acao || ''), dados: dados && typeof dados === 'object' ? dados : {} };
      if (dados?.accessToken) corpo.accessToken = String(dados.accessToken);
      const { data, error } = await this.client.functions.invoke('integracoes-empresa', { body: corpo });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      if (data?.erro) throw new Error(data.erro);
      return Object.assign({ sucesso: true }, data || {});
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async integracaoIA(acao, dados = {}) {
    if (!this.client || !this.contexto || this.contexto.administrador_global) {
      return { sucesso: false, erro: 'Entre em uma empresa para configurar o assistente de IA.' };
    }
    try {
      const { data, error } = await this.client.functions.invoke('integracoes-empresa', {
        body: { tipo: 'ia', acao: String(acao || ''), dados: dados && typeof dados === 'object' ? dados : {} }
      });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      if (data?.erro) throw new Error(data.erro);
      return Object.assign({ sucesso: true }, data || {});
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async chamarIAEmpresa(mensagens, opcoes = {}) {
    const resultado = await this.integracaoIA('chat', { mensagens, opcoes });
    if (!resultado?.sucesso || !resultado?.resposta) {
      throw new Error(resultado?.erro || 'O assistente de IA da empresa não respondeu.');
    }
    return resultado.resposta;
  }

  async rotearWhatsAppOficial({ telefone, mensagem, baileysConectado }) {
    if (!this.client || !this.contexto || this.contexto.administrador_global) return { usarApi: false };
    const status = await this.integracaoWhatsAppApi('status', {});
    const modo = String(status?.integracao?.metadados?.modo || 'baileys');
    const usarApi = modo === 'api' || (modo === 'hibrido' && !baileysConectado);
    if (!usarApi) return { usarApi: false };
    if (!status?.sucesso || status?.integracao?.status !== 'conectada') {
      return { usarApi: true, resultado: { sucesso: false, canal: 'api', erro: 'WhatsApp automático não está conectado.' } };
    }
    const envio = await this.integracaoWhatsAppApi('enviar', { telefone, mensagem });
    return {
      usarApi: true,
      resultado: envio?.sucesso
        ? { sucesso: true, canal: 'api', idMensagem: String(envio.mensagem_id || ''), statusEnvio: 'enviado' }
        : { sucesso: false, canal: 'api', erro: envio?.erro || 'Não foi possível enviar pelo WhatsApp automático.' }
    };
  }

  async solicitarAssinaturaRemota(pacote) {
    if (!this.client || !this.contexto || this.contexto.administrador_global) {
      return { sucesso: false, erro: 'Entre em uma empresa para enviar a assinatura ao celular.' };
    }
    try {
      // O tipo desbloqueio foi introduzido depois da Edge Function original.
      // A RPC autenticada mantém o mesmo isolamento por empresa e permite que
      // instalações atualizadas funcionem antes de uma nova publicação da Edge.
      if (pacote?.tipoDocumento === 'desbloqueio') {
        const { data, error } = await this.client.rpc('enviar_solicitacao_assinatura_remota', { p_pacote: pacote });
        if (error) throw error;
        if (data?.erro) throw new Error(data.erro);
        return { sucesso: true, solicitacao: data?.solicitacao || data || null, mensagem: 'Documento enviado ao celular.' };
      }
      const { data, error } = await this.client.functions.invoke('assinaturas-remotas', {
        body: { acao: 'enviar', dados: { pacote } }
      });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      if (data?.erro) throw new Error(data.erro);
      return { sucesso: true, solicitacao: data?.solicitacao || null, mensagem: String(data?.mensagem || '') };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async cancelarAssinaturaRemota(idEnvioAssinatura) {
    if (!this.client || !this.contexto || this.contexto.administrador_global) {
      return { sucesso: false, erro: 'Entre em uma empresa para remover o documento da nuvem.' };
    }
    try {
      const { data, error } = await this.client.rpc('cancelar_solicitacao_assinatura_remota', {
        p_id_envio_assinatura: String(idEnvioAssinatura || '')
      });
      if (error) throw error;
      return data?.cancelada === true
        ? { sucesso: true }
        : { sucesso: false, erro: 'O documento não foi encontrado na nuvem.' };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async publicarUltimoBackup(caminhoArquivo) {
    try {
      if (!this.companyCloudService || !this.contexto || this.contexto.administrador_global) {
        return { sucesso: false, erro: 'Entre em uma empresa para enviar o backup.' };
      }
      return await this.companyCloudService.publicarBackup(caminhoArquivo);
    } catch (erro) {
      console.error('[Backup Nuvem] Falha ao publicar:', mensagemErro(erro));
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async excluirDesbloqueioNuvem(item) {
    if (!this.desbloqueioCloudService || !this.contexto || this.contexto.administrador_global) {
      return { sucesso: true, ignorado: true };
    }
    try {
      return await this.desbloqueioCloudService.excluir(item);
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async atualizarLogoEmpresa(dataUrl) {
    if (!this.companyCloudService || !this.contexto || this.contexto.administrador_global) {
      throw new Error('Entre como administrador de uma empresa para alterar a logo.');
    }
    return this.companyCloudService.atualizarLogo(String(dataUrl || ''));
  }

  async publicarConfiguracaoMobile(configuracao) {
    if (!this.companyCloudService || !this.contexto || this.contexto.administrador_global) {
      return { sucesso: true, ignorado: true };
    }
    return this.companyCloudService.publicarConfiguracaoMobile(configuracao || this.db.obterConfig());
  }

  podeAlterarConfiguracoesEmpresa() {
    if (!this.contexto || this.contexto.administrador_global === true) return true;
    return this.companyCloudService?._ehAdministrador?.() === true;
  }

  async listarTabelaPrecos() {
    if (!this.priceTableService) throw new Error('Tabela de preços indisponível.');
    return this.priceTableService.listar();
  }

  async salvarTabelaPreco(dados) {
    if (!this.priceTableService) throw new Error('Tabela de preços indisponível.');
    return this.priceTableService.salvar(dados);
  }

  async excluirTabelaPreco(id, revision) {
    if (!this.priceTableService) throw new Error('Tabela de preços indisponível.');
    return this.priceTableService.excluir(id, revision);
  }

  async administrarGlobal(acao, dados = {}) {
    if (!this.client || !this.contexto) {
      return { sucesso: false, erro: 'Entre novamente para realizar esta ação.' };
    }
    try {
      const { data, error } = await this.client.functions.invoke('admin-global', {
        body: { acao: String(acao || ''), dados }
      });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      if (data?.erro) throw new Error(data.erro);
      return Object.assign({ sucesso: true }, data || {});
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async registrarErroUsuario(dados = {}) {
    if (!this.client || !this.contexto?.empresa_id || this.contexto.administrador_global) {
      return { sucesso: false, ignorado: true };
    }
    try {
      const mensagem = String(dados.mensagem || '').replace(/(gsk_|APP_USR-|Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[protegido]').slice(0, 4000);
      if (!mensagem) return { sucesso: false, ignorado: true };
      const { data, error } = await this.client.from('relatorios_erros').insert({
        empresa_id: this.contexto.empresa_id,
        usuario_id: this.usuario?.id || this.contexto?.usuario_id || null,
        origem: 'pc',
        tela: String(dados.tela || '').slice(0, 160) || null,
        funcao: String(dados.funcao || '').slice(0, 160) || null,
        mensagem,
        stack_trace: String(dados.stack || '').slice(0, 12000) || null,
        versao: APP_VERSION,
        dispositivo: os.hostname() || 'Windows',
        detalhes: dados.detalhes && typeof dados.detalhes === 'object' ? dados.detalhes : {},
        prioridade: ['baixa', 'normal', 'alta', 'critica'].includes(dados.prioridade) ? dados.prioridade : 'normal'
      }).select('id').single();
      if (error) throw error;
      return { sucesso: true, id: data?.id || '' };
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async criarChamadoSuporte(dados = {}) {
    if (!this.client) return { sucesso: false, erro: 'Conexão com o suporte indisponível.' };
    const autenticado = !!(this.usuario && this.contexto?.empresa_id && !this.contexto?.administrador_global);
    const corpo = Object.assign({}, dados, { origem: String(dados.origem || '') });
    return this.chamadosSuporte(autenticado ? 'criar_autenticado' : 'criar_publico', corpo);
  }

  async chamadosSuporte(acao, dados = {}) {
    if (!this.client) return { sucesso: false, erro: 'Conexão com o suporte indisponível.' };
    try {
      const { data, error } = await this.client.functions.invoke('chamados-suporte', {
        body: { acao: String(acao || ''), dados }
      });
      if (error) throw new Error(await erroDaEdgeFunction(error));
      if (data?.erro) throw new Error(data.erro);
      return Object.assign({ sucesso: true }, data || {});
    } catch (erro) {
      return { sucesso: false, erro: mensagemErro(erro) };
    }
  }

  async administrarChamadosSuporte(acao, dados = {}) {
    if (!this.client || !this.contexto?.administrador_global) {
      return { sucesso: false, erro: 'Ação restrita ao suporte do Sistema OS.' };
    }
    return this.chamadosSuporte(acao, dados);
  }

  status() {
    const cfg = this.db ? this._configRaw() : { ativo: false, url: '' };
    const estado = this.stateStore?.obter?.() || {};
    return Object.assign({}, this.ultimoStatus, {
      inicializado: this.inicializado,
      ativo: cfg.ativo === true,
      configurado: !!(cfg.url && cfg.anonKey),
      operacional: !!this.client,
      autenticado: !!this.usuario,
      empresaId: this.contexto?.empresa_id || '',
      empresaNome: this.contexto?.empresa_nome || '',
      planoNome: this.contexto?.plano_nome || '',
      licencaStatus: this.contexto?.licenca_status || '',
      dataVencimento: this.contexto?.data_vencimento || this.contexto?.fim_trial || '',
      fiscalHabilitado: this.contexto?.administrador_global !== true && this.contexto?.recursos_habilitados?.fiscal_habilitado === true,
      modoArmazenamento: this.contexto?.modo_armazenamento || '',
      filaPendente: (estado.fila || []).filter((i) => i.status === 'pendente').length,
      conflitos: (estado.conflitos || []).length,
      ultimaSincronizacaoEm: estado.ultimaSincronizacaoEm || '',
      persistenciaCriptografada: !!this.sessionStore?.persistenciaCriptografadaDisponivel?.()
    });
  }
}

module.exports = {
  DesktopSupabaseRuntime,
  CAMPOS_PULL_OS,
  validarChavePublica,
  resolverNomeLoginPublico,
  usuarioPublico
};
