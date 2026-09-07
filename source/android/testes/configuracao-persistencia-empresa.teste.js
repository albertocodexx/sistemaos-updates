'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const raiz = path.join(__dirname, '..');
const caminhoConfig = path.join(raiz, 'www/js/config.js');
const caminhoConfigTela = path.join(raiz, 'www/js/config-tela.js');
const caminhoEmpresaService = path.join(raiz, 'www/js/supabase/empresa-service.js');
const CHAVE_CONFIG = 'osapp_config_empresa_v1';

const LOGO_ANTIGA = 'data:image/png;base64,TE9HT19BTlRJR0E=';
const LOGO_NOVA = 'data:image/png;base64,TE9HT19OT1ZB';
const ASSINATURA_ANTIGA = 'data:image/png;base64,QVNTSU5BVFVSQV9BTlRJR0E=';
const ASSINATURA_NOVA = 'data:image/png;base64,QVNTSU5BVFVSQV9OT1ZB';

async function aguardar(condicao, mensagem) {
  for (let tentativa = 0; tentativa < 30; tentativa += 1) {
    if (condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(mensagem);
}

async function testarTelaReal() {
  const html = fs.readFileSync(path.join(raiz, 'www/index.html'), 'utf8');
  const codigoConfig = fs.readFileSync(caminhoConfig, 'utf8');
  const codigoConfigTela = fs.readFileSync(caminhoConfigTela, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://app.local/' });
  const win = dom.window;
  const chamadasNuvem = [];

  try {
    win.localStorage.setItem(CHAVE_CONFIG, JSON.stringify({
      nomeFantasia: 'Assistencia Legada',
      telefone: '1111-1111',
      logoBase64: LOGO_ANTIGA,
      assinaturaAssistenciaBase64: ASSINATURA_ANTIGA
    }));

    win.HTMLElement.prototype.scrollIntoView = function () {};
    win.HTMLCanvasElement.prototype.getContext = function () {
      return { fillStyle: '', fillRect() {}, drawImage() {} };
    };
    win.HTMLCanvasElement.prototype.toDataURL = function () { return LOGO_NOVA; };

    win.FileReader = class FileReaderFalso {
      readAsDataURL() {
        this.result = 'data:image/png;base64,SU1BR0VNX09SSUdJTkFM';
        if (this.onload) this.onload();
      }
    };
    win.Image = class ImageFalsa {
      constructor() {
        this.width = 120;
        this.height = 60;
      }
      set src(valor) {
        this._src = valor;
        if (this.onload) this.onload();
      }
      get src() { return this._src; }
    };

    const contexto = {
      empresa_id: '11111111-1111-4111-8111-111111111111',
      cargo: 'Administrador'
    };
    win.SistemaOSPermissoes = { obterContexto() { return contexto; } };
    win.SistemaOSEmpresaService = {
      ehAdministrador() { return true; },
      async atualizarLogoEmpresa(ctx, logo) {
        chamadasNuvem.push({ tipo: 'logo', contexto: ctx, logo });
      },
      async salvarConfiguracoesEmpresa(ctx, configuracao) {
        chamadasNuvem.push({
          tipo: 'configuracao',
          contexto: ctx,
          configuracao: Object.assign({}, configuracao)
        });
      }
    };
    win.SistemaOSAssinatura = { abrir(callback) { callback(ASSINATURA_NOVA); } };
    win.SistemaOSToast = { mostrar() {} };
    win.TemaApp = { aplicar() {} };
    win.SistemaOSAtualizacao = {
      async verificar() { return { fase: 'atual', mensagem: 'Aplicativo atualizado.' }; }
    };

    assert.doesNotThrow(
      () => win.eval(codigoConfig),
      'config.js deve inicializar usando o armazenamento real do navegador'
    );
    assert.doesNotThrow(
      () => win.eval(codigoConfigTela),
      'config-tela.js deve executar por completo antes de preencher e registrar o submit'
    );

    const nome = win.document.getElementById('cfg-nome-fantasia');
    const telefone = win.document.getElementById('cfg-telefone');
    const logoPreview = win.document.getElementById('logo-preview-box');
    const assinaturaPreview = win.document.getElementById('assinatura-assistencia-preview-box');

    assert.equal(nome.value, 'Assistencia Legada');
    assert.equal(telefone.value, '1111-1111');
    assert.equal(logoPreview.querySelector('img').getAttribute('src'), LOGO_ANTIGA);
    assert.equal(assinaturaPreview.querySelector('img').getAttribute('src'), ASSINATURA_ANTIGA);

    nome.value = 'Assistencia Atualizada';
    telefone.value = '2222-2222';
    win.document.getElementById('btn-desenhar-assinatura-assistencia').click();

    const inputLogo = win.document.getElementById('cfg-logo-arquivo');
    Object.defineProperty(inputLogo, 'files', {
      configurable: true,
      value: [new win.File(['logo'], 'logo.png', { type: 'image/png' })]
    });
    inputLogo.dispatchEvent(new win.Event('change', { bubbles: true }));

    assert.equal(logoPreview.querySelector('img').getAttribute('src'), LOGO_NOVA);
    assert.equal(assinaturaPreview.querySelector('img').getAttribute('src'), ASSINATURA_NOVA);

    const formulario = win.document.getElementById('form-config');
    const eventoSubmit = new win.Event('submit', { bubbles: true, cancelable: true });
    formulario.dispatchEvent(eventoSubmit);
    assert.equal(eventoSubmit.defaultPrevented, true, 'o submit deve ser tratado pelo JavaScript, sem recarregar a tela');

    const botaoSalvar = win.document.getElementById('btn-salvar-config');
    await aguardar(
      () => botaoSalvar.disabled === false && chamadasNuvem.some((item) => item.tipo === 'configuracao'),
      'o salvamento assincrono da configuracao nao terminou'
    );

    const persistida = JSON.parse(win.localStorage.getItem(CHAVE_CONFIG));
    assert.equal(persistida.nomeFantasia, 'Assistencia Atualizada');
    assert.equal(persistida.telefone, '2222-2222');
    assert.equal(persistida.logoBase64, LOGO_NOVA);
    assert.equal(persistida.assinaturaAssistenciaBase64, ASSINATURA_NOVA);

    const enviada = chamadasNuvem.find((item) => item.tipo === 'configuracao');
    assert.equal(enviada.contexto.empresa_id, contexto.empresa_id);
    assert.equal(enviada.configuracao.nomeFantasia, 'Assistencia Atualizada');
    assert.equal(enviada.configuracao.logoBase64, LOGO_NOVA);
    assert.equal(enviada.configuracao.assinaturaAssistenciaBase64, ASSINATURA_NOVA);

    // Simula sair da aba e reabri-la: valores visuais adulterados precisam
    // ser descartados em favor do que foi realmente persistido.
    nome.value = '';
    telefone.value = '';
    logoPreview.innerHTML = '';
    assinaturaPreview.innerHTML = '';
    win.document.dispatchEvent(new win.CustomEvent('sistema-os:tela-config-aberta'));

    assert.equal(nome.value, 'Assistencia Atualizada');
    assert.equal(telefone.value, '2222-2222');
    assert.equal(logoPreview.querySelector('img').getAttribute('src'), LOGO_NOVA);
    assert.equal(assinaturaPreview.querySelector('img').getAttribute('src'), ASSINATURA_NOVA);
  } finally {
    dom.window.close();
  }
}

async function testarConfigMobileVazioPreservaLegado() {
  const configuracaoLocal = {
    nomeFantasia: 'Assistencia Legada',
    logoBase64: LOGO_ANTIGA,
    assinaturaAssistenciaBase64: ASSINATURA_ANTIGA
  };
  let salvamentosLocais = 0;
  let empresaConsultada = null;

  global.ConfigApp = {
    carregarConfig() { return Object.assign({}, configuracaoLocal); },
    salvarConfig(patch) {
      salvamentosLocais += 1;
      Object.assign(configuracaoLocal, patch || {});
      return Object.assign({}, configuracaoLocal);
    }
  };
  global.SupabaseClientApp = {
    obterCliente() {
      return {
        from(tabela) {
          assert.equal(tabela, 'configuracoes_empresa');
          const consulta = {
            select() { return consulta; },
            eq(campo, valor) {
              assert.equal(campo, 'empresa_id');
              empresaConsultada = valor;
              return consulta;
            },
            async maybeSingle() {
              return {
                error: null,
                data: { configuracoes: { identidadeEmpresa: { configMobile: {} } } }
              };
            }
          };
          return consulta;
        },
        storage: {
          from() {
            return {
              async upload() { return { error: null }; },
              async remove() { return { error: null }; },
              async download() {
                assert.fail('configMobile vazio nao deve tentar baixar nem apagar imagens locais');
              }
            };
          }
        },
        async rpc(nome) {
          assert.equal(nome, 'salvar_configuracao_mobile');
          return { error: null, data: {} };
        }
      };
    }
  };

  try {
    delete require.cache[require.resolve(caminhoEmpresaService)];
    const servico = require(caminhoEmpresaService);
    const empresaId = '11111111-1111-4111-8111-111111111111';
    const resultado = await servico.sincronizarConfiguracoesEmpresa({
      empresa_id: empresaId,
      cargo: 'Administrador'
    });

    assert.equal(empresaConsultada, empresaId);
    assert.equal(resultado, null);
    assert.equal(salvamentosLocais, 0, 'configMobile vazio nao pode gerar um patch destrutivo');
    assert.deepEqual(configuracaoLocal, {
      nomeFantasia: 'Assistencia Legada',
      logoBase64: LOGO_ANTIGA,
      assinaturaAssistenciaBase64: ASSINATURA_ANTIGA
    });
  } finally {
    delete global.ConfigApp;
    delete global.SupabaseClientApp;
    delete global.SistemaOSEmpresaService;
    delete require.cache[require.resolve(caminhoEmpresaService)];
  }
}

async function testarMembroNaoAlteraIdentidadeDaEmpresa() {
  const html = fs.readFileSync(path.join(raiz, 'www/index.html'), 'utf8');
  const codigoConfig = fs.readFileSync(caminhoConfig, 'utf8');
  const codigoConfigTela = fs.readFileSync(caminhoConfigTela, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://app.local/' });
  const win = dom.window;
  try {
    win.HTMLElement.prototype.scrollIntoView = function () {};
    win.SistemaOSPermissoes = {
      obterContexto() { return { empresa_id: 'empresa-teste', cargo: 'Operador' }; }
    };
    win.SistemaOSEmpresaService = {
      ehAdministrador() { return false; },
      async salvarConfiguracoesEmpresa() { assert.fail('membro comum nao pode publicar configuracao'); }
    };
    win.SistemaOSToast = { mostrar() {} };
    win.TemaApp = { aplicar() {} };
    win.SistemaOSAtualizacao = { async verificar() { return {}; } };
    win.eval(codigoConfig);
    win.ConfigApp.salvarConfig({ nomeFantasia: 'Nome oficial' });
    win.eval(codigoConfigTela);

    const nome = win.document.getElementById('cfg-nome-fantasia');
    const logo = win.document.getElementById('cfg-logo-arquivo');
    const salvar = win.document.getElementById('btn-salvar-config');
    assert.equal(nome.disabled, true);
    assert.equal(logo.disabled, true);
    assert.equal(salvar.disabled, true);

    nome.disabled = false;
    nome.value = 'Alteracao indevida';
    win.document.getElementById('form-config').dispatchEvent(
      new win.Event('submit', { bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(win.ConfigApp.carregarConfig().nomeFantasia, 'Nome oficial');
    assert.match(win.document.getElementById('erro-geral-config').textContent, /definidos pelo administrador/i);
  } finally {
    dom.window.close();
  }
}

async function testarAtualizacaoNaoRestauraConfigAntiga() {
  const empresaId = '22222222-2222-4222-8222-222222222222';
  const armazenamento = new Map();
  let configuracaoLocal = {
    nomeFantasia: 'Nome atualizado no celular',
    telefone: '27999999999',
    logoBase64: '',
    assinaturaAssistenciaBase64: '',
    configAtualizadaEm: ''
  };
  let identidadeRemota = {
    configMobile: { nomeFantasia: 'Nome antigo da nuvem', telefone: '1111' },
    configMobileAtualizadaEm: '2026-01-01T00:00:00.000Z'
  };
  let envios = 0;

  global.localStorage = {
    getItem(chave) { return armazenamento.has(chave) ? armazenamento.get(chave) : null; },
    setItem(chave, valor) { armazenamento.set(chave, String(valor)); },
    removeItem(chave) { armazenamento.delete(chave); }
  };
  global.ConfigApp = {
    carregarConfig() { return Object.assign({}, configuracaoLocal); },
    salvarConfig(patch) {
      configuracaoLocal = Object.assign({}, configuracaoLocal, patch || {});
      return Object.assign({}, configuracaoLocal);
    }
  };
  global.SupabaseClientApp = {
    obterCliente() {
      return {
        from() {
          const consulta = {
            select() { return consulta; },
            eq() { return consulta; },
            async maybeSingle() {
              return { error: null, data: { configuracoes: { identidadeEmpresa: Object.assign({}, identidadeRemota) } } };
            }
          };
          return consulta;
        },
        async rpc(nome, dados) {
          assert.equal(nome, 'salvar_configuracao_mobile');
          envios += 1;
          identidadeRemota = {
            configMobile: Object.assign({}, dados.p_config_mobile),
            configMobileAtualizadaEm: '2026-07-24T12:00:00.000Z'
          };
          return { error: null, data: Object.assign({}, identidadeRemota) };
        },
        storage: { from() { return { async remove() { return { error: null }; } }; } }
      };
    }
  };

  try {
    delete require.cache[require.resolve(caminhoEmpresaService)];
    const servico = require(caminhoEmpresaService);
    await servico.sincronizarConfiguracoesEmpresa({ empresa_id: empresaId, cargo: 'Administrador' });
    assert.equal(envios, 1, 'a atualizacao deve reenviar uma unica vez a configuracao local preservada');
    assert.equal(configuracaoLocal.nomeFantasia, 'Nome atualizado no celular');
    assert.equal(identidadeRemota.configMobile.nomeFantasia, 'Nome atualizado no celular');
    assert.equal(configuracaoLocal.configAtualizadaEm, identidadeRemota.configMobileAtualizadaEm);
    assert.ok(armazenamento.has('sistema-os-config-mobile-reconciliada-v2:' + empresaId));
  } finally {
    delete global.localStorage;
    delete global.ConfigApp;
    delete global.SupabaseClientApp;
    delete global.SistemaOSEmpresaService;
    delete require.cache[require.resolve(caminhoEmpresaService)];
  }
}

async function executar() {
  let total = 0;
  async function teste(nome, funcao) {
    await funcao();
    total += 1;
    console.log('\u2713 ' + nome);
  }

  await teste('membro comum recebe a identidade, mas nao consegue altera-la', testarMembroNaoAlteraIdentidadeDaEmpresa);
  await teste('configMobile vazio preserva a configuracao legada local da empresa', testarConfigMobileVazioPreservaLegado);
  const html = fs.readFileSync(path.join(raiz, 'www/index.html'), 'utf8');
  assert.match(html, /config-empresa-somente-leitura/);
  assert.match(html, /config-empresa-edicao" hidden aria-hidden="true/);
  assert.match(html, /id="btn-salvar-config"[^>]*hidden/);
  total += 1;
  console.log('\u2713 administrador tambem ve identidade somente para consulta no Android');
  console.log('\n' + total + ' testes de persistencia da configuracao passaram.');
}

executar().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
