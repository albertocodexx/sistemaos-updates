/**
 * config.js
 *
 * Gerencia a configuração da assistência técnica (empresa) no celular,
 * persistida em localStorage. Espelha os campos que o sistema PC já usa
 * em DEFAULT_CONFIG/obterConfig/salvarConfig, para que os documentos
 * gerados no celular tenham as mesmas informações de empresa que os
 * gerados no PC (nome, logo, CNPJ opcional, contato, termos, tema).
 *
 * Também guarda a "assinatura padrão da assistência" (assinaturaAssistenciaBase64),
 * usada automaticamente em todo documento, podendo ser sobrescrita
 * "na hora" para um documento específico sem alterar a padrão salva.
 *
 * E guarda o tamanho de fonte dos termos no PDF (tamanhoFonteTermosPdf),
 * ajustável pelo usuário em Configurações — ver comentário do campo abaixo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.ConfigApp = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var CHAVE_STORAGE_LEGADA = 'osapp_config_empresa_v1';
  var empresaAtivaId = '';

  function normalizarEmpresaId(valor) {
    return String(valor || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 80);
  }

  try {
    empresaAtivaId = normalizarEmpresaId(root.localStorage && root.localStorage.getItem('sistema-os-empresa-ativa-v1'));
  } catch (_) { empresaAtivaId = ''; }

  function definirEmpresa(empresaId) {
    empresaAtivaId = normalizarEmpresaId(empresaId);
    return obterChaveStorage();
  }

  function obterChaveStorage() {
    try {
      if (empresaAtivaId && root.localStorage &&
          root.localStorage.getItem('sistema-os-dados-legados-empresa-v1') === empresaAtivaId) {
        return CHAVE_STORAGE_LEGADA;
      }
    } catch (_) {}
    return empresaAtivaId
      ? 'osapp_config_empresa_v2:' + empresaAtivaId
      : CHAVE_STORAGE_LEGADA;
  }

  // Espelha os campos de empresa usados no PC (nome fantasia, razão social,
  // CNPJ opcional, contato, endereço, termos por documento, tema, e a nova
  // assinatura padrão da assistência).
  var CONFIG_PADRAO = {
    // Identificação
    configAtualizadaEm: '',
    nomeFantasia: '',
    razaoSocial: '',
    possuiCnpj: false,
    cnpj: '',
    inscricaoEstadual: '',

    // Logo
    logoBase64: '',

    // Contato
    telefone: '',
    whatsapp: '',
    email: '',

    // Endereço
    endereco: '',
    cidade: '',
    estado: '',
    cep: '',

    // Termos por documento — quando usarTermosPredefinidos = true, o
    // sistema usa o "padrão" daquele documento (ver termosPadraoUsuario*
    // abaixo: se o usuário já definiu um, usa o dele; senão, cai para o
    // texto de fábrica em src/termos-predefinidos.js). O texto customizado
    // (termosCustom*) só é usado quando o usuário desliga esse toggle.
    usarTermosPredefinidosOS: true,
    termosCustomOS: '',
    usarTermosPredefinidosVenda: true,
    termosCustomVenda: '',
    usarTermosPredefinidosCompra: true,
    termosCustomCompra: '',
    usarTermosPredefinidosGarantia: true,
    termosCustomGarantia: '',

    // "Padrão" de cada documento DEFINIDO PELO USUÁRIO (botão "Definir
    // como novo padrão" em Configurações). Vazio ('') significa "não
    // sobrescreveu, continua usando o texto de fábrica" — o botão
    // "Restaurar padrão" e o toggle "Usar termos predefinidos" sempre
    // preferem este valor quando ele não está vazio (ver resolverTermos*
    // nos templates e TERMOS_POR_DOCUMENTO em config-tela.js). Isto NÃO
    // altera o arquivo de código src/termos-predefinidos.js — o padrão de
    // fábrica original continua intacto e pode ser recuperado apagando
    // este valor (ver btnRestaurarPadraoDeFabrica).
    termosPadraoUsuarioOS: '',
    termosPadraoUsuarioVenda: '',
    termosPadraoUsuarioCompra: '',

    // Tamanho da fonte dos termos no PDF gerado (pt), ajustável pelo
    // usuário em Configurações via slider. É o tamanho INICIAL usado nos
    // 3 templates (OS/Venda/Compra) — o autofit de cada template ainda
    // pode reduzir a partir daqui se o texto não couber na via impressa,
    // até o piso técnico de legibilidade (ver FONTE_TERMOS_MIN_PT).
    // Vazio/0/ausente = usa o tamanho de fábrica de cada template (7.8pt
    // em OS/Compra, 8.5pt em Venda), preservando o visual atual para quem
    // nunca mexeu neste controle.
    tamanhoFonteTermosPdf: 0,

    // Aparência
    temaModo: 'escuro', // 'claro' | 'escuro'

    // Assinatura padrão da assistência técnica: usada automaticamente em
    // todo documento gerado, a menos que o usuário assine na hora só para
    // aquele documento (o que não altera este valor salvo).
    assinaturaAssistenciaBase64: '',

    // Se true (padrão), todo documento deve levar a assinatura da
    // assistência técnica além da assinatura da outra parte (cliente/
    // comprador/vendedor) — numeradas "1/2" e "2/2" no papel. Se false, o
    // usuário desativou essa exigência: só a assinatura da outra parte é
    // usada, sem numeração nenhuma no papel (ver assinatura-injetor.js).
    exigirAssinaturaAssistencia: true,

    // Prazo de garantia padrão (em dias), sugerido automaticamente ao
    // abrir o form de Entregas e o form de Nova OS (o técnico ainda pode
    // alterar o valor por documento, sem afetar este padrão salvo). Usado
    // por montarObjetoEntrega/montarObjetoOS em js/app.js como valor
    // inicial do campo, e por entrega-template.js para calcular a data
    // limite exibida no PDF de Entregas (dataHoraAssinatura + dias).
    garantiaDiasPadrao: 90,

  };

  // Mantém no armazenamento somente campos funcionais reconhecidos pelo app.
  // Assim, configurações gravadas por versões anteriores são higienizadas sem
  // perpetuar no runtime nomes de chaves técnicas descontinuadas.
  function filtrarCamposConhecidos(origem) {
    var resultado = {};
    Object.keys(CONFIG_PADRAO).forEach(function (chave) {
      if (origem && Object.prototype.hasOwnProperty.call(origem, chave)) {
        resultado[chave] = origem[chave];
      }
    });
    return resultado;
  }

  function carregarConfig() {
    try {
      var chaveStorage = obterChaveStorage();
      var bruto = localStorage.getItem(chaveStorage);
      if (!bruto) return Object.assign({}, CONFIG_PADRAO);
      var salvo = JSON.parse(bruto);
      // merge raso: garante que campos novos adicionados no futuro (ex: em
      // uma próxima versão) sempre tenham um valor padrão, mesmo que o
      // usuário tenha uma config antiga salva sem esses campos.
      var camposSalvos = filtrarCamposConhecidos(salvo);
      var configuracao = Object.assign({}, CONFIG_PADRAO, camposSalvos);
      if (Object.keys(camposSalvos).length !== Object.keys(salvo).length) {
        try { localStorage.setItem(chaveStorage, JSON.stringify(configuracao)); } catch (_) {}
      }
      return configuracao;
    } catch (erro) {
      console.error('config.js: erro ao carregar config, usando padrão.', erro);
      return Object.assign({}, CONFIG_PADRAO);
    }
  }

  function salvarConfig(patch) {
    var atual = carregarConfig();
    var nova = Object.assign({}, CONFIG_PADRAO,
      filtrarCamposConhecidos(Object.assign({}, atual, patch || {})));
    // Alteracoes feitas no aparelho recebem uma versao local. Quando o patch
    // vem da nuvem ele ja carrega configAtualizadaEm e preserva exatamente a
    // versao do servidor, permitindo decidir com seguranca qual copia e nova.
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'configAtualizadaEm')) {
      nova.configAtualizadaEm = new Date().toISOString();
    }
    try {
      localStorage.setItem(obterChaveStorage(), JSON.stringify(nova));
    } catch (erro) {
      console.error('config.js: erro ao salvar config.', erro);
      throw erro;
    }
    return nova;
  }

  function resetarConfig() {
    try {
      localStorage.removeItem(obterChaveStorage());
    } catch (erro) {
      console.error('config.js: erro ao resetar config.', erro);
    }
    return Object.assign({}, CONFIG_PADRAO);
  }

  /**
   * Monta o objeto `config` no formato exato que os templates do PC
   * esperam receber como segundo argumento (gerarHtmlOS(os, config),
   * gerarHtmlCompra(cp, config), gerarHtmlVenda(vd, config)).
   *
   * ATENÇÃO — isto NÃO é o objeto "empresa" (a saída de
   * src/templates/empresa-compositor.js:montarDadosEmpresa). É o objeto
   * de ENTRADA que essa função do PC espera receber, com os nomes de
   * campo que ELA lê (telefonePrincipal, enderecoEmpresa,
   * exibirCnpjDocumentos, textoRodapePdf, etc.) — nomes DIFERENTES dos
   * campos salvos em CONFIG_PADRAO aqui no celular (telefone, endereco...).
   * Os templates então chamam esse compositor internamente e usam a saída
   * dele (empresa.nome, empresa.endereco, ...).
   *
   * Além dos campos de identificação/contato, os templates também leem
   * DIRETO deste mesmo objeto `config` (sem passar pelo compositor):
   * termosOS/termosVenda/termosCompra, usarTermosPredefinidosOS/Venda/Compra,
   * tamanhoFonteTermosPdf e tamanhoLogoPdf — ver resolverTermos*,
   * resolverTamanhoFonteTermos e a variável --logo-h em
   * os-template.js/venda-template.js/compra-template.js. Por isso este
   * método monta um objeto único que serve aos dois usos.
   */
  function montarDadosEmpresa() {
    var cfg = carregarConfig();
    return {
      // Lidos por empresa-compositor.js (nomes de ENTRADA do compositor).
      nomeFantasia: cfg.nomeFantasia || '',
      razaoSocial: cfg.razaoSocial || '',
      possuiCnpj: !!cfg.possuiCnpj,
      cnpj: cfg.cnpj || '',
      inscricaoEstadual: cfg.inscricaoEstadual || '',
      exibirCnpjDocumentos: true, // sem toggle próprio no celular ainda — sempre exibe quando há CNPJ
      logoBase64: cfg.logoBase64 || '',
      telefonePrincipal: cfg.telefone || '',
      telefoneFixo: '', // sem campo próprio no celular ainda — só "Telefone" e "WhatsApp"
      whatsapp: cfg.whatsapp || '',
      email: cfg.email || '',
      site: '', // sem campo próprio no celular ainda
      enderecoEmpresa: [cfg.endereco, cfg.cidade, cfg.estado, cfg.cep].filter(Boolean).join(', '),
      textoRodapePdf: '', // sem campo próprio no celular ainda

      // Lidos DIRETO do `config` pelos templates (não passam pelo compositor).
      usarTermosPredefinidosOS: cfg.usarTermosPredefinidosOS,
      termosOS: cfg.termosCustomOS || '',
      usarTermosPredefinidosVenda: cfg.usarTermosPredefinidosVenda,
      termosVenda: cfg.termosCustomVenda || '',
      usarTermosPredefinidosCompra: cfg.usarTermosPredefinidosCompra,
      termosCompra: cfg.termosCustomCompra || '',
      usarTermosPredefinidosGarantia: cfg.usarTermosPredefinidosGarantia !== false,
      termosGarantia: cfg.termosCustomGarantia || '',
      // Padrão definido pelo usuário (vazio = usa o de fábrica embutido
      // no template) — ver resolverTermos* em os-template.js/
      // venda-template.js/compra-template.js.
      termosPadraoUsuarioOS: cfg.termosPadraoUsuarioOS || '',
      termosPadraoUsuarioVenda: cfg.termosPadraoUsuarioVenda || '',
      termosPadraoUsuarioCompra: cfg.termosPadraoUsuarioCompra || '',
      // Tamanho de fonte dos termos escolhido pelo usuário (pt). 0 = usa o
      // tamanho de fábrica de cada template (ver resolverTamanhoFonteTermos
      // em os-template.js/venda-template.js/compra-template.js).
      tamanhoFonteTermosPdf: Number(cfg.tamanhoFonteTermosPdf) || 0,
      tamanhoLogoPdf: 80
    };
  }

  return {
    CONFIG_PADRAO: CONFIG_PADRAO,
    definirEmpresa: definirEmpresa,
    obterChaveStorage: obterChaveStorage,
    carregarConfig: carregarConfig,
    salvarConfig: salvarConfig,
    resetarConfig: resetarConfig,
    montarDadosEmpresa: montarDadosEmpresa
  };
});
