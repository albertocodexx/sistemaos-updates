/** Carrega perfil/empresa/licença sem receber empresa_id do JavaScript. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSEmpresaService = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  async function carregarContexto() {
    var cliente = root.SupabaseClientApp.obterCliente();
    var resposta = await cliente.rpc('obter_contexto_comercial');
    if (resposta.error) throw resposta.error;
    var dados = Array.isArray(resposta.data) ? resposta.data[0] : resposta.data;
    return dados || null;
  }

  function obterIdentificadorInstalacao() {
    var chave = 'sistemaos_dispositivo_v1';
    try {
      var existente = root.localStorage.getItem(chave);
      if (existente && existente.length >= 12) return existente;
      var bytes = new Uint8Array(16);
      if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
        root.crypto.getRandomValues(bytes);
      } else {
        for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
      }
      var novo = Array.prototype.map.call(bytes, function (valor) {
        return valor.toString(16).padStart(2, '0');
      }).join('');
      root.localStorage.setItem(chave, novo);
      return novo;
    } catch (_) {
      return 'web-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }
  }

  async function registrarAcesso() {
    var cliente = root.SupabaseClientApp.obterCliente();
    var resposta = await cliente.rpc('registrar_acesso_comercial', {
      p_identificador: obterIdentificadorInstalacao(),
      p_plataforma: 'android',
      p_nome: 'Sistema OS para Android'
    });
    if (resposta.error) throw resposta.error;
    return resposta.data;
  }

  async function configurarTrocaRapida(ativa) {
    var cliente = root.SupabaseClientApp.obterCliente();
    var resposta = await cliente.rpc('configurar_troca_rapida_contas', { p_ativa: ativa === true });
    if (resposta.error) throw resposta.error;
    return resposta.data;
  }

  function ehAdministrador(contexto) {
    var cargo = String((contexto || {}).cargo || '').toLowerCase();
    if (typeof cargo.normalize === 'function') {
      cargo = cargo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return ['administrador', 'admin', 'proprietario'].indexOf(cargo) !== -1 || cargo.indexOf('propriet') === 0;
  }

  // A configuracao local e util offline, mas a copia compartilhada precisa
  // sobreviver a uma atualizacao/reinstalacao do APK. Guardamos apenas um
  // marcador pequeno: os dados continuam em ConfigApp e sao reenviados assim
  // que houver sessao e rede, sem duplicar logo ou assinatura no localStorage.
  function chaveConfigPendente(contexto) {
    return 'sistema-os-config-mobile-pendente-v1:' + String((contexto || {}).empresa_id || '');
  }

  function chaveConfigSincronizada(contexto) {
    return 'sistema-os-config-mobile-sincronizada-v1:' + String((contexto || {}).empresa_id || '');
  }

  function chaveConfigReconciliada(contexto) {
    return 'sistema-os-config-mobile-reconciliada-v2:' + String((contexto || {}).empresa_id || '');
  }

  function marcarConfigPendente(contexto) {
    if (!contexto || !contexto.empresa_id || !root.localStorage) return;
    try { root.localStorage.setItem(chaveConfigPendente(contexto), new Date().toISOString()); } catch (_) {}
  }

  function limparConfigPendente(contexto) {
    if (!contexto || !contexto.empresa_id || !root.localStorage) return;
    try { root.localStorage.removeItem(chaveConfigPendente(contexto)); } catch (_) {}
  }

  function haConfigPendente(contexto) {
    if (!contexto || !contexto.empresa_id || !root.localStorage) return false;
    try { return !!root.localStorage.getItem(chaveConfigPendente(contexto)); } catch (_) { return false; }
  }

  function haConfigSincronizada(contexto) {
    if (!contexto || !contexto.empresa_id || !root.localStorage) return false;
    try { return !!root.localStorage.getItem(chaveConfigSincronizada(contexto)); } catch (_) { return false; }
  }

  function marcarConfigSincronizada(contexto, versao) {
    if (!contexto || !contexto.empresa_id || !root.localStorage) return;
    try {
      root.localStorage.setItem(chaveConfigSincronizada(contexto), String(versao || new Date().toISOString()));
    } catch (_) {}
  }

  function haConfigReconciliada(contexto) {
    if (!contexto || !contexto.empresa_id || !root.localStorage) return false;
    try { return !!root.localStorage.getItem(chaveConfigReconciliada(contexto)); } catch (_) { return false; }
  }

  function marcarConfigReconciliada(contexto) {
    if (!contexto || !contexto.empresa_id || !root.localStorage) return;
    try { root.localStorage.setItem(chaveConfigReconciliada(contexto), new Date().toISOString()); } catch (_) {}
  }

  function instante(valor) {
    var resultado = Date.parse(String(valor || ''));
    return Number.isFinite(resultado) ? resultado : 0;
  }

  function configuracaoLocalSignificativa(configuracao) {
    var config = configuracao || {};
    return [
      'nomeFantasia', 'razaoSocial', 'cnpj', 'telefone', 'whatsapp', 'email',
      'endereco', 'cidade', 'cep', 'logoBase64', 'assinaturaAssistenciaBase64',
      'termosCustomOS', 'termosCustomVenda', 'termosCustomCompra'
    ].some(function (chave) { return String(config[chave] || '').trim().length > 0; });
  }

  function bytesDeDataUrl(dataUrl) {
    var partes = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ''));
    if (!partes) throw new Error('A logo precisa ser uma imagem vÃ¡lida.');
    var binario = root.atob(partes[2]);
    var bytes = new Uint8Array(binario.length);
    for (var i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
    return { mime: partes[1].toLowerCase(), bytes: bytes };
  }

  async function sha256Hex(bytes) {
    var digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.prototype.map.call(new Uint8Array(digest), function (valor) {
      return valor.toString(16).padStart(2, '0');
    }).join('');
  }

  function blobParaDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var leitor = new root.FileReader();
      leitor.onload = function () { resolve(String(leitor.result || '')); };
      leitor.onerror = function () { reject(leitor.error || new Error('Falha ao ler a logo.')); };
      leitor.readAsDataURL(blob);
    });
  }

  async function carregarIdentidade(contexto) {
    var cliente = root.SupabaseClientApp.obterCliente();
    var resposta = await cliente.from('configuracoes_empresa')
      .select('configuracoes,updated_at')
      .eq('empresa_id', contexto.empresa_id)
      .maybeSingle();
    if (resposta.error) throw resposta.error;
    return resposta.data && resposta.data.configuracoes
      ? resposta.data.configuracoes.identidadeEmpresa || null
      : null;
  }

  async function sincronizarLogoEmpresa(contexto) {
    if (!contexto || contexto.administrador_global === true || !root.ConfigApp) return { possuiLogo: false };
    var identidade = await carregarIdentidade(contexto);
    var caminho = String(identidade && identidade.logoStoragePath || '');
    if (!caminho) {
      root.ConfigApp.salvarConfig({ logoBase64: '' });
      if (root.document) root.document.dispatchEvent(new root.CustomEvent('sistema-os:config-salva'));
      return { possuiLogo: false };
    }
    var cliente = root.SupabaseClientApp.obterCliente();
    var download = await cliente.storage.from('identidade-empresa').download(caminho);
    if (download.error) throw download.error;
    var base64 = await blobParaDataUrl(download.data);
    root.ConfigApp.salvarConfig({ logoBase64: base64 });
    if (root.document) root.document.dispatchEvent(new root.CustomEvent('sistema-os:config-salva'));
    return { possuiLogo: true, logoBase64: base64 };
  }

  function configuracaoMobileSegura(configuracao) {
    var copia = Object.assign({}, configuracao || {});
    delete copia.logoBase64;
    delete copia.assinaturaAssistenciaBase64;
    [
      'supabaseUrl', 'supabasePublishableKey', 'supabaseRedirectUrl'
    ].forEach(function (chave) { delete copia[chave]; });
    return copia;
  }

  async function baixarImagemIdentidade(cliente, caminho) {
    if (!caminho) return '';
    var download = await cliente.storage.from('identidade-empresa').download(caminho);
    if (download.error) throw download.error;
    return blobParaDataUrl(download.data);
  }

  async function sincronizarConfiguracoesEmpresa(contexto) {
    if (!contexto || contexto.administrador_global === true || !root.ConfigApp) return null;
    // A identidade da empresa tem uma unica fonte de verdade: o Sistema OS
    // no PC. O Android nunca reenviara uma copia local antiga, nem mesmo para
    // administradores. Isso evita que reinstalacao, cache ou uso simultaneo
    // restaurem telefone, endereco, termos ou logo desatualizados.
    limparConfigPendente(contexto);
    var cliente = root.SupabaseClientApp.obterCliente();
    var identidade = await carregarIdentidade(contexto);
    if (!identidade) return null;
    var possuiConfigMobile = !!(identidade.configMobile &&
      typeof identidade.configMobile === 'object' &&
      !Array.isArray(identidade.configMobile) &&
      Object.keys(identidade.configMobile).length > 0);
    var patch = Object.assign({}, possuiConfigMobile ? identidade.configMobile : {});

    // Empresas migradas podem possuir somente os metadados antigos da logo.
    // Nesse estado, ausência de assinatura/configMobile NÃO significa que o
    // administrador removeu a configuração: limpar os campos aqui apagava a
    // assinatura local antes do primeiro salvamento pelo APK novo.
    if (identidade.logoStoragePath) {
      patch.logoBase64 = await baixarImagemIdentidade(cliente, identidade.logoStoragePath);
    } else if (possuiConfigMobile) {
      patch.logoBase64 = '';
    }
    if (identidade.assinaturaStoragePath) {
      patch.assinaturaAssistenciaBase64 = await baixarImagemIdentidade(cliente, identidade.assinaturaStoragePath);
    } else if (possuiConfigMobile) {
      patch.assinaturaAssistenciaBase64 = '';
    }
    if (!Object.keys(patch).length) return null;
    patch.configAtualizadaEm = identidade.configMobileAtualizadaEm || patch.configAtualizadaEm || '';
    root.ConfigApp.salvarConfig(patch);
    marcarConfigSincronizada(contexto, identidade.configMobileAtualizadaEm);
    marcarConfigReconciliada(contexto);
    if (root.document) root.document.dispatchEvent(new root.CustomEvent('sistema-os:config-salva'));
    return patch;
  }

  async function persistirConfigMobile(cliente, configuracao, identidade) {
    var salvar = await cliente.rpc('salvar_configuracao_mobile', {
      p_config_mobile: configuracaoMobileSegura(configuracao),
      p_assinatura_storage_path: identidade.assinaturaStoragePath || '',
      p_assinatura_sha256: identidade.assinaturaSha256 || ''
    });
    if (salvar.error) throw salvar.error;
    return salvar.data;
  }

  async function salvarConfiguracoesEmpresa(contexto, configuracao) {
    void contexto;
    void configuracao;
    throw new Error('Os dados da empresa são alterados somente no Sistema OS do PC.');
  }

  async function atualizarLogoEmpresa(contexto, dataUrl) {
    void contexto;
    void dataUrl;
    throw new Error('A logo da empresa é alterada somente no Sistema OS do PC.');
  }

  function validarContexto(contexto, usuarioId, agora) {
    if (!contexto || !contexto.usuario_id || contexto.usuario_id !== usuarioId) {
      return { estado: 'usuario_bloqueado', mensagem: 'Seu usuário não possui um perfil válido.' };
    }
    if (contexto.usuario_ativo !== true) {
      return { estado: 'usuario_bloqueado', mensagem: 'Este usuário está bloqueado.' };
    }
    if (contexto.empresa_ativa !== true) {
      return { estado: 'empresa_bloqueada', mensagem: 'Esta empresa está bloqueada.' };
    }
    var status = String(contexto.licenca_status || '').toLowerCase();
    var instanteAtual = agora == null ? Date.now() : Number(agora);
    var fimTrial = contexto.fim_trial ? new Date(contexto.fim_trial).getTime() : NaN;
    // O cache offline nunca pode prolongar o Trial alem dos 45 dias definidos
    // no servidor. Ao chegar no vencimento, somente assinatura e suporte ficam
    // acessiveis, mesmo antes do proximo job de licenciamento.
    if ((status === 'teste' && Number.isFinite(fimTrial) && fimTrial <= instanteAtual)
        || (status === 'periodo_graca' && String(contexto.plano_nome || '').toLowerCase() === 'trial')) {
      return { estado: 'cobranca', mensagem: 'Seu período de teste de 45 dias chegou ao fim.' };
    }
    var permitidos = ['ativa', 'teste', 'vencendo', 'periodo_graca'];
    if (status === 'vencida') {
      return { estado: 'cobranca', mensagem: 'Sua assinatura venceu. Escolha um plano para continuar.' };
    }
    if (permitidos.indexOf(status) === -1) {
      return { estado: 'licenca_vencida', mensagem: 'A licença da empresa está vencida ou bloqueada.' };
    }
    return { estado: 'autenticado', mensagem: '', contexto: contexto };
  }

  async function testarConexao(configuracao) {
    try {
      var validada = root.SupabaseClientApp.validarConfiguracao({
        supabaseAtivo: true,
        supabaseUrl: configuracao.url || configuracao.supabaseUrl,
        supabasePublishableKey: configuracao.publishableKey || configuracao.supabasePublishableKey
      });
      if (!validada.ok) throw new Error(validada.mensagem);
      // Endpoint oficial de saúde do Supabase Auth. Diferente de consultar
      // uma tabela, não depende de GRANT para o papel anon nem relaxa RLS.
      var controle = typeof AbortController === 'function' ? new AbortController() : null;
      var temporizador = controle ? root.setTimeout(function () { controle.abort(); }, 10000) : null;
      var resposta;
      try {
        resposta = await root.fetch(validada.url + '/auth/v1/health', {
        method: 'GET',
        headers: { apikey: validada.publishableKey },
        cache: 'no-store',
        signal: controle ? controle.signal : undefined
        });
      } finally {
        if (temporizador) root.clearTimeout(temporizador);
      }
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
      return { ok: true, mensagem: 'Conexão segura com o Supabase confirmada.' };
    } catch (erro) {
      return {
        ok: false,
        mensagem: 'Não foi possível conectar ao Supabase: ' +
          (erro && erro.message ? erro.message : String(erro))
      };
    }
  }

  return {
    carregarContexto: carregarContexto,
    configurarTrocaRapida: configurarTrocaRapida,
    registrarAcesso: registrarAcesso,
    validarContexto: validarContexto,
    testarConexao: testarConexao,
    ehAdministrador: ehAdministrador,
    sincronizarConfiguracoesEmpresa: sincronizarConfiguracoesEmpresa,
    salvarConfiguracoesEmpresa: salvarConfiguracoesEmpresa,
    sincronizarLogoEmpresa: sincronizarLogoEmpresa,
    atualizarLogoEmpresa: atualizarLogoEmpresa,
    _haConfigPendente: haConfigPendente,
    _marcarConfigPendente: marcarConfigPendente,
    _haConfigSincronizada: haConfigSincronizada,
    _haConfigReconciliada: haConfigReconciliada
  };
});
