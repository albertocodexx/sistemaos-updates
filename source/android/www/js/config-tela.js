// js/config-tela.js
//
// Lógica da tela de Configurações (painel-config, form-config em
// index.html). Isolado de app.js porque é autocontido: não interfere no
// fluxo de OS/Compra/Venda, só lê/escreve em ConfigApp (js/config.js) e
// aplica o tema (js/tema-app.js). app.js só toca esta tela indiretamente,
// via obterConfigEmpresaAtual() -> ConfigApp.montarDadosEmpresa() (lido de
// novo a cada prévia) e via obterAssinaturaAssistenciaAtual() (idem).
//
// Responsabilidades desta parte:
// - Carregar os campos salvos ao abrir a aba (preencher o form-config)
// - Salvar via ConfigApp.salvarConfig() ao submeter
// - Upload de logo -> base64 -> preview (e "Remover logo")
// - Abrir a tela de assinatura (compartilhada com OS/Compra/Venda) em modo
//   "assinatura padrão da assistência" e salvar o resultado em
//   assinaturaAssistenciaBase64 (e "Remover assinatura")
// - Toggle mostrar/esconder os campos de CNPJ e de termos customizados
// - Toggle de modo escuro, aplicado imediatamente (sem esperar "Salvar")

(function () {
  'use strict';

  var form = document.getElementById('form-config');
  if (!form) return; // painel-config não existe nesta versão do HTML

  var erroGeralConfig = document.getElementById('erro-geral-config');
  var feedbackConfig = document.getElementById('feedback-config');
  var btnSalvarConfig = document.getElementById('btn-salvar-config');
  var podeAlterarConfiguracoesEmpresa = false;

  // Identificação
  var campoNomeFantasia = document.getElementById('cfg-nome-fantasia');
  var campoRazaoSocial = document.getElementById('cfg-razao-social');
  var checkPossuiCnpj = document.getElementById('cfg-possui-cnpj');
  var blocoCnpj = document.getElementById('bloco-cnpj');
  var campoCnpj = document.getElementById('cfg-cnpj');
  var campoIe = document.getElementById('cfg-ie');

  // Logo
  var logoPreviewBox = document.getElementById('logo-preview-box');
  var inputLogoArquivo = document.getElementById('cfg-logo-arquivo');
  var btnRemoverLogo = document.getElementById('btn-remover-logo');

  // Assinatura padrão da assistência
  var assinaturaPreviewBox = document.getElementById('assinatura-assistencia-preview-box');
  var btnDesenharAssinaturaAssistencia = document.getElementById('btn-desenhar-assinatura-assistencia');
  var btnRemoverAssinaturaAssistencia = document.getElementById('btn-remover-assinatura-assistencia');
  var checkExigirAssinaturaAssistencia = document.getElementById('cfg-exigir-assinatura-assistencia');
  // Botão "Desenhar assinatura" + preview + "Remover": ficam SEMPRE
  // visíveis agora, independente do toggle. Antes eles somiam quando o
  // toggle estava desativado, porque o toggle costumava decidir SE a
  // assinatura era usada; hoje ele só decide a NUMERAÇÃO impressa
  // (1/2-2/2) — a assinatura salva aqui continua em uso em todo
  // documento de qualquer forma, então esconder os controles de
  // gerenciá-la ficaria contraditório e confuso.
  var linhaBotoesAssinaturaAssistencia = btnDesenharAssinaturaAssistencia
    ? btnDesenharAssinaturaAssistencia.closest('.linha-botoes-config')
    : null;

  // Contato
  var campoTelefone = document.getElementById('cfg-telefone');
  var campoWhatsapp = document.getElementById('cfg-whatsapp');
  var campoEmail = document.getElementById('cfg-email');

  // Endereço
  var campoEndereco = document.getElementById('cfg-endereco');
  var campoCidade = document.getElementById('cfg-cidade');
  var campoEstado = document.getElementById('cfg-estado');
  var campoCep = document.getElementById('cfg-cep');

  // Termos por documento (mesmo padrão nos 3: checkbox "usar predefinidos"
  // + bloco de textarea que só aparece quando o checkbox está desmarcado
  // + botão "Restaurar padrão" que preenche o textarea com o texto oficial
  // daquele tipo de documento, como ponto de partida para editar — sem
  // isso, a única forma de customizar era apagar tudo e digitar do zero).
  var TERMOS_POR_DOCUMENTO = [
    {
      chaveUsar: 'usarTermosPredefinidosOS',
      chaveCustom: 'termosCustomOS',
      chavePredefinido: 'TERMOS_OS',
      chavePadraoUsuario: 'termosPadraoUsuarioOS',
      checkbox: document.getElementById('cfg-termos-predefinidos-os'),
      bloco: document.getElementById('bloco-termos-custom-os'),
      textarea: document.getElementById('cfg-termos-custom-os'),
      btnRestaurar: document.getElementById('btn-restaurar-termos-os'),
      btnDefinirPadrao: document.getElementById('btn-definir-padrao-os'),
      btnLimparPadrao: document.getElementById('btn-limpar-padrao-os'),
      avisoPadraoProprio: document.getElementById('aviso-padrao-proprio-os')
    },
    {
      chaveUsar: 'usarTermosPredefinidosVenda',
      chaveCustom: 'termosCustomVenda',
      chavePredefinido: 'TERMOS_VENDA',
      chavePadraoUsuario: 'termosPadraoUsuarioVenda',
      checkbox: document.getElementById('cfg-termos-predefinidos-venda'),
      bloco: document.getElementById('bloco-termos-custom-venda'),
      textarea: document.getElementById('cfg-termos-custom-venda'),
      btnRestaurar: document.getElementById('btn-restaurar-termos-venda'),
      btnDefinirPadrao: document.getElementById('btn-definir-padrao-venda'),
      btnLimparPadrao: document.getElementById('btn-limpar-padrao-venda'),
      avisoPadraoProprio: document.getElementById('aviso-padrao-proprio-venda')
    },
    {
      chaveUsar: 'usarTermosPredefinidosCompra',
      chaveCustom: 'termosCustomCompra',
      chavePredefinido: 'TERMOS_COMPRA',
      chavePadraoUsuario: 'termosPadraoUsuarioCompra',
      checkbox: document.getElementById('cfg-termos-predefinidos-compra'),
      bloco: document.getElementById('bloco-termos-custom-compra'),
      textarea: document.getElementById('cfg-termos-custom-compra'),
      btnRestaurar: document.getElementById('btn-restaurar-termos-compra'),
      btnDefinirPadrao: document.getElementById('btn-definir-padrao-compra'),
      btnLimparPadrao: document.getElementById('btn-limpar-padrao-compra'),
      avisoPadraoProprio: document.getElementById('aviso-padrao-proprio-compra')
    }
  ];

  // Valor do padrão-do-usuário carregado do storage (pendente de salvar,
  // igual logoBase64Pendente/assinaturaAssistenciaBase64Pendente — só é
  // persistido de fato no submit do formulário). Mapeado por chavePadraoUsuario.
  var padraoUsuarioPendente = {};

  // Aparência
  var checkTemaEscuro = document.getElementById('cfg-tema-escuro');

  // Tamanho de fonte dos termos no PDF (slider único, aplicado aos 3 tipos
  // de documento — OS/Venda/Compra). 0 = "Padrão do sistema" (usa o
  // tamanho de fábrica de cada template, sem sobrescrever nada).
  var sliderFonteTermos = document.getElementById('cfg-tamanho-fonte-termos');
  var labelValorFonteTermos = document.getElementById('valor-tamanho-fonte-termos');

  // Prazo de garantia padrão (dias), sugerido em Entregas e Nova OS.
  // Input numérico simples — cada documento pode alterar o valor sem
  // afetar este padrão salvo (mesmo princípio de "padrão sugerido,
  // sobrescrevível por documento" da assinatura da assistência).
  var campoGarantiaDiasPadrao = document.getElementById('cfg-garantia-dias-padrao');

  var btnSincronizarAgora = document.getElementById('btn-sincronizar-agora');
  var resultadoSincronizarAgora = document.getElementById('resultado-sincronizar-agora');
  var btnTrocarUsuarioConfig = document.getElementById('btn-trocar-usuario-config');
  var btnAbrirChamadoConfig = document.getElementById('btn-abrir-chamado-config');

  // BUGFIX: o slider aceita valores de 0.5 a 5 (min="0", step="0.5"), mas
  // os templates (os-template.js/venda-template.js/compra-template.js)
  // aplicam Math.max(FONTE_TERMOS_MIN_PT, valor) com FONTE_TERMOS_MIN_PT
  // = 5.5 — ou seja, qualquer valor nessa faixa é elevado para 5.5pt na
  // hora de gerar o PDF. Antes desta correção, o label mostrava o valor
  // bruto do slider (ex.: "2 pt") sem avisar que o PDF real sairia com
  // 5.5pt, uma divergência silenciosa entre o que a tela promete e o que
  // o documento entrega. FONTE_TERMOS_MIN_PT_UI replica o mesmo piso
  // técnico dos templates só para exibição — não há import entre
  // js/config-tela.js e src/templates/*.js, então o valor é duplicado
  // aqui de propósito (mesma constante, dois lugares).
  var FONTE_TERMOS_MIN_PT_UI = 5.5;
  function atualizarLabelFonteTermos() {
    if (!sliderFonteTermos || !labelValorFonteTermos) return;
    var v = parseFloat(sliderFonteTermos.value);
    if (v <= 0) {
      labelValorFonteTermos.textContent = 'Padrão do sistema';
    } else if (v < FONTE_TERMOS_MIN_PT_UI) {
      labelValorFonteTermos.textContent = v + ' pt (mínimo aplicado: ' + FONTE_TERMOS_MIN_PT_UI + ' pt)';
    } else {
      labelValorFonteTermos.textContent = v + ' pt';
    }
  }
  if (sliderFonteTermos) {
    sliderFonteTermos.addEventListener('input', atualizarLabelFonteTermos);
  }

  // ── Toggles condicionais (CNPJ e termos customizados) ──────────────
  // Mesmo mecanismo nos 4 casos: um checkbox controla se um bloco de
  // campos aparece ou não. Centralizado aqui para não repetir a lógica.
  function ligarToggle(checkbox, bloco, mostrarQuandoMarcado) {
    if (!checkbox || !bloco) return;
    function aplicar() {
      var mostrar = mostrarQuandoMarcado ? checkbox.checked : !checkbox.checked;
      bloco.hidden = !mostrar;
    }
    checkbox.addEventListener('change', aplicar);
    aplicar(); // estado inicial, sem esperar o primeiro "change"
  }

  ligarToggle(checkPossuiCnpj, blocoCnpj, true); // mostra bloco de CNPJ quando MARCADO

  TERMOS_POR_DOCUMENTO.forEach(function (t) {
    // mostra o textarea de termos customizados quando o checkbox de
    // "usar predefinidos" está DESMARCADO.
    ligarToggle(t.checkbox, t.bloco, false);
  });

  // Retorna o texto de fábrica (original, embutido no código) para um
  // item de TERMOS_POR_DOCUMENTO, lendo de src/termos-predefinidos.js —
  // carregado de forma assíncrona via XHR por app.js
  // (window.__modulosOSPromise), não por <script> direto.
  function textoDeFabrica(t) {
    var modulo = window.__modules && window.__modules['termos-predefinidos'];
    return modulo && modulo.exports && modulo.exports[t.chavePredefinido];
  }

  // "Restaurar padrão" preenche o textarea com o "padrão" atual daquele
  // tipo de documento: o padrão DO USUÁRIO, se ele já tiver definido um
  // (botão "Definir como novo padrão"); senão, o texto de fábrica original
  // — um ponto de partida para editar, em vez de a única alternativa ser
  // apagar tudo e escrever do zero. Os botões ficam desabilitados até a
  // promise de módulos resolver, para nunca correr o risco de um clique
  // acontecer antes de window.__modules['termos-predefinidos'] existir.
  TERMOS_POR_DOCUMENTO.forEach(function (t) {
    if (!t.btnRestaurar) return;
    t.btnRestaurar.disabled = true;

    t.btnRestaurar.addEventListener('click', function () {
      var textoFabrica = textoDeFabrica(t);
      if (typeof textoFabrica !== 'string' || !textoFabrica) {
        window.SistemaOSToast.mostrar(
          'Não foi possível carregar o texto padrão. Tente novamente.',
          { ehErro: true }
        );
        return;
      }
      var padraoProprio = padraoUsuarioPendente[t.chavePadraoUsuario];
      var textoAlvo = (padraoProprio && padraoProprio.trim()) ? padraoProprio : textoFabrica;

      var jaTemTextoDiferente = t.textarea.value.trim() &&
        t.textarea.value.trim() !== textoAlvo.trim();
      if (jaTemTextoDiferente) {
        var confirmou = window.confirm(
          'Isso vai substituir o texto atual pelo termo padrão' +
          (padraoProprio ? ' (o seu padrão definido).' : ' do sistema.') +
          ' O que você escreveu será perdido. Deseja continuar?'
        );
        if (!confirmou) return;
      }

      t.textarea.value = textoAlvo;
      window.SistemaOSToast.mostrar('Texto padrão restaurado — lembre-se de salvar.');
    });
  });

  // ── "Definir como novo padrão" / "Voltar ao padrão original do sistema" ──
  // O checkbox "Usar os termos padrão do sistema" e o botão "Restaurar
  // padrão" não tinham, até aqui, nenhuma ligação com o texto que o
  // usuário escrevia no textarea — o "padrão" era sempre e só o texto de
  // fábrica embutido no código (src/termos-predefinidos.js). Isto cobre o
  // pedido de um botão que realmente muda qual texto conta como "padrão"
  // para este dispositivo, sem editar código:
  //  - "Definir como novo padrão" grava o texto atual do textarea como o
  //    padrão deste tipo de documento (termosPadraoUsuario* em
  //    js/config.js) — só é persistido de fato no "Salvar configurações",
  //    igual a qualquer outro campo do formulário.
  //  - "Voltar ao padrão original do sistema" apaga esse padrão próprio
  //    (volta a usar o texto de fábrica) — não afeta o texto digitado
  //    agora no textarea, só o que "Usar termos predefinidos"/"Restaurar
  //    padrão" vão considerar dali em diante.
  // NÃO altera src/termos-predefinidos.js — o texto de fábrica original
  // continua existindo e é sempre recuperável.
  TERMOS_POR_DOCUMENTO.forEach(function (t) {
    if (t.btnDefinirPadrao) {
      t.btnDefinirPadrao.addEventListener('click', function () {
        var texto = t.textarea.value.trim();
        if (!texto) {
          window.SistemaOSToast.mostrar(
            'Escreva o texto no campo acima antes de definir como padrão.',
            { ehErro: true }
          );
          return;
        }
        var confirmou = window.confirm(
          'Isso vai tornar o texto atual o novo padrão para este tipo de ' +
          'documento, neste aparelho. Sempre que "Usar os termos padrão do ' +
          'sistema" estiver marcado, este texto será usado em vez do original. ' +
          'Deseja continuar?'
        );
        if (!confirmou) return;

        padraoUsuarioPendente[t.chavePadraoUsuario] = texto;
        atualizarAvisoPadraoProprio(t);
        window.SistemaOSToast.mostrar('Definido como novo padrão — lembre-se de salvar.');
      });
    }

    if (t.btnLimparPadrao) {
      t.btnLimparPadrao.addEventListener('click', function () {
        if (!padraoUsuarioPendente[t.chavePadraoUsuario]) {
          window.SistemaOSToast.mostrar('Já está usando o padrão original do sistema.');
          return;
        }
        padraoUsuarioPendente[t.chavePadraoUsuario] = '';
        atualizarAvisoPadraoProprio(t);
        window.SistemaOSToast.mostrar('Padrão original do sistema restaurado — lembre-se de salvar.');
      });
    }
  });

  function atualizarAvisoPadraoProprio(t) {
    if (!t.avisoPadraoProprio) return;
    t.avisoPadraoProprio.hidden = !padraoUsuarioPendente[t.chavePadraoUsuario];
  }

  (window.__modulosOSPromise || Promise.resolve()).then(function () {
    TERMOS_POR_DOCUMENTO.forEach(function (t) {
      if (t.btnRestaurar) t.btnRestaurar.disabled = false;
    });
  });

  // ANTES: esta função escondia o preview + botões de desenho da
  // assinatura da assistência quando "Exigir assinatura da assistência"
  // estava desmarcado. Fazia sentido na época porque o toggle decidia SE
  // a assinatura padrão era usada em algum documento — desmarcado, ela
  // não ia pra lugar nenhum, então escondê-la parecia razoável.
  //
  // Hoje o toggle só decide a NUMERAÇÃO "1/2-2/2" impressa no papel (ver
  // app.js:obterAssinaturaAssistenciaAtual); a assinatura salva aqui
  // continua sendo usada em todo documento independente do estado do
  // check. Por isso a função foi esvaziada — preview e botões ficam
  // sempre visíveis agora, chame ou não aplicarVisibilidadeAssinaturaAssistencia
  // (mantida como no-op, e as duas linhas de listener/chamada inicial
  // comentadas abaixo, em vez de removidas, para não perder o rastro de
  // por que isto existia e evitar reintroduzir o mesmo bug sem querer).
  function aplicarVisibilidadeAssinaturaAssistencia() {}
  // if (checkExigirAssinaturaAssistencia) {
  //   checkExigirAssinaturaAssistencia.addEventListener('change', aplicarVisibilidadeAssinaturaAssistencia);
  //   aplicarVisibilidadeAssinaturaAssistencia();
  // }

  // ── Preview de imagem (logo e assinatura compartilham a mesma lógica) ─

  function atualizarPreview(caixa, base64, textoVazio) {
    caixa.innerHTML = '';
    if (base64) {
      var img = document.createElement('img');
      img.src = base64;
      img.alt = 'Preview';
      caixa.appendChild(img);
    } else {
      caixa.textContent = textoVazio;
    }
  }

  // ── Upload de logo (arquivo -> canvas -> base64) ─────────────────────
  // Guardado numa variável local em vez de já persistir no localStorage:
  // só é gravado de fato quando o usuário aperta "Salvar configurações",
  // igual a qualquer outro campo do formulário. Isso evita salvar uma
  // logo (potencialmente grande) sem o usuário ter confirmado o resto.
  //
  // BUG QUE ISTO CORRIGE: antes, o arquivo era salvo cru (FileReader ->
  // dataURL direto, sem passar por canvas). Uma logo em PNG com fundo
  // transparente ia parar, sem alteração, em todo lugar que usa
  // cfg.logoBase64 — inclusive o HTML dos PDFs (os-template.js e
  // similares). O <body>/.cabecalho desses templates são brancos, então
  // em teoria a transparência deveria só "deixar ver" o branco por trás;
  // na prática, o motor que gera o PDF final a partir desse HTML (fora
  // deste projeto — impressão/exportação do próprio Android/navegador)
  // nem sempre preserva o canal alfa do PNG corretamente, e a
  // transparência acaba sendo pintada de preto no arquivo exportado.
  //
  // A correção remove a ambiguidade na origem: toda logo enviada é
  // composta, uma única vez aqui no upload, sobre um fundo branco SÓLIDO
  // (sem canal alfa nenhum no resultado) — então não existe mais
  // transparência para nenhum motor de PDF interpretar errado, seja qual
  // for. De brinde, LOGO_LADO_QUADRO/LOGO_MARGEM_PROPORCAO padronizam o
  // enquadramento (a logo cabe inteira dentro do quadrado, com uma
  // margem pequena) — resolve o "logo pequena/perdida no quadrado" do
  // ícone do app e da caixinha de preview, que antes dependia só do
  // tamanho/proporção do arquivo original de cada usuário.
  var LOGO_LADO_QUADRO = 512; // px — grande o bastante pra ficar nítida em qualquer uso (ícone, PDF, preview)
  var LOGO_MARGEM_PROPORCAO = 0.06; // 6% de margem em cada lado — a logo nunca encosta na borda

  function compormLogoSobreFundoBranco(arquivo, callback) {
    var leitor = new FileReader();
    leitor.onload = function () {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = LOGO_LADO_QUADRO;
        canvas.height = LOGO_LADO_QUADRO;
        var ctx = canvas.getContext('2d');

        // Fundo branco sólido primeiro — é isto que elimina a
        // transparência do PNG original antes de qualquer PDF ler o
        // resultado.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, LOGO_LADO_QUADRO, LOGO_LADO_QUADRO);

        // Enquadramento tipo "contain": a logo inteira cabe dentro da
        // área útil (quadro menos a margem), sem cortar nada, centralizada.
        var areaUtil = LOGO_LADO_QUADRO * (1 - LOGO_MARGEM_PROPORCAO * 2);
        var escala = Math.min(areaUtil / img.width, areaUtil / img.height);
        var larguraFinal = img.width * escala;
        var alturaFinal = img.height * escala;
        var x = (LOGO_LADO_QUADRO - larguraFinal) / 2;
        var y = (LOGO_LADO_QUADRO - alturaFinal) / 2;

        ctx.drawImage(img, x, y, larguraFinal, alturaFinal);
        callback(canvas.toDataURL('image/png'));
      };
      img.onerror = function () { callback(null); };
      img.src = String(leitor.result || '');
    };
    leitor.onerror = function () { callback(null); };
    leitor.readAsDataURL(arquivo);
  }

  var logoBase64Pendente = '';
  var assinaturaAssistenciaBase64Pendente = '';

  if (inputLogoArquivo) {
    inputLogoArquivo.addEventListener('change', function () {
      var arquivo = inputLogoArquivo.files && inputLogoArquivo.files[0];
      if (!arquivo) return;
      compormLogoSobreFundoBranco(arquivo, function (base64) {
        if (!base64) {
          erroGeralConfig.hidden = false;
          erroGeralConfig.textContent = 'Não foi possível ler o arquivo de logo selecionado.';
          return;
        }
        logoBase64Pendente = base64;
        atualizarPreview(logoPreviewBox, logoBase64Pendente, 'Sem logo');
      });
    });
  }

  if (btnRemoverLogo) {
    btnRemoverLogo.addEventListener('click', function () {
      logoBase64Pendente = '';
      if (inputLogoArquivo) inputLogoArquivo.value = '';
      atualizarPreview(logoPreviewBox, '', 'Sem logo');
    });
  }


  // ── Assinatura padrão da assistência ────────────────────────────────
  // Reaproveita a MESMA tela cheia de canvas usada para assinar OS/Compra/
  // Venda (js/assinatura.js, SistemaOSAssinatura.abrir) — só muda o texto
  // do topo, para deixar claro que esta é a assinatura padrão salva, não a
  // de um documento específico.
  var topoAssinaturaTexto = document.getElementById('assinatura-topo-texto');
  var TEXTO_TOPO_PADRAO = 'Assine com o dedo no espaço abaixo';
  var TEXTO_TOPO_ASSISTENCIA = 'Desenhe a assinatura padrão da assistência técnica';

  if (btnDesenharAssinaturaAssistencia) {
    btnDesenharAssinaturaAssistencia.addEventListener('click', function () {
      if (topoAssinaturaTexto) topoAssinaturaTexto.textContent = TEXTO_TOPO_ASSISTENCIA;
      window.SistemaOSAssinatura.abrir(function (dataUrl) {
        if (topoAssinaturaTexto) topoAssinaturaTexto.textContent = TEXTO_TOPO_PADRAO;
        assinaturaAssistenciaBase64Pendente = dataUrl;
        atualizarPreview(assinaturaPreviewBox, assinaturaAssistenciaBase64Pendente, 'Sem assinatura salva');
      });
    });
  }

  if (btnRemoverAssinaturaAssistencia) {
    btnRemoverAssinaturaAssistencia.addEventListener('click', function () {
      assinaturaAssistenciaBase64Pendente = '';
      atualizarPreview(assinaturaPreviewBox, '', 'Sem assinatura salva');
    });
  }

  // ── Modo escuro ──────────────────────────────────────────────────────
  // Aplicado IMEDIATAMENTE ao alternar (não espera "Salvar configurações")
  // para dar feedback visual instantâneo, igual o resto do app já faz ao
  // abrir (TemaApp.inicializarDeConfig). A persistência em si acontece
  // junto com o resto do formulário, no submit — se o usuário sair da tela
  // sem salvar, o tema volta ao valor salvo na próxima vez que o app abrir.
  if (checkTemaEscuro) {
    checkTemaEscuro.addEventListener('change', function () {
      window.TemaApp.aplicar(checkTemaEscuro.checked ? 'escuro' : 'claro');
    });
  }

  // ── Backup completo (exportar / restaurar / apagar tudo) ────────────
  // Delega toda a lógica de dados para js/backup.js — esta tela só liga
  // os 3 botões, confirma antes das ações destrutivas/substitutivas
  // (restaurar sobrescreve a config atual; apagar tudo é irreversível) e
  // mostra o resultado via toast, no mesmo padrão do resto do app.
  var btnExportarBackup = document.getElementById('btn-exportar-backup');
  var btnImportarBackup = document.getElementById('btn-importar-backup');
  var inputImportarBackup = document.getElementById('input-importar-backup');
  var btnApagarTudo = document.getElementById('btn-apagar-tudo');

  if (btnExportarBackup) {
    btnExportarBackup.addEventListener('click', function () {
      btnExportarBackup.disabled = true;
      window.SistemaOSBackup.exportarBackupCompleto()
        .then(function () {
          window.SistemaOSToast.mostrar('Backup gerado com sucesso.');
        })
        .catch(function (erro) {
          window.SistemaOSToast.mostrar(
            'Falha ao gerar backup: ' + (erro && erro.message ? erro.message : String(erro)),
            { ehErro: true }
          );
        })
        .then(function () { btnExportarBackup.disabled = false; });
    });
  }

  if (btnImportarBackup && inputImportarBackup) {
    btnImportarBackup.addEventListener('click', function () {
      var confirmado = window.confirm(
        'Restaurar um backup vai substituir as configurações atuais pelas do arquivo ' +
        'e trazer de volta o histórico salvo nele (sem apagar o que já existe aqui). Continuar?'
      );
      if (!confirmado) return;
      inputImportarBackup.click();
    });

    inputImportarBackup.addEventListener('change', function () {
      var arquivo = inputImportarBackup.files && inputImportarBackup.files[0];
      inputImportarBackup.value = '';
      if (!arquivo) return;

      var leitor = new FileReader();
      leitor.onload = function () {
        var objeto;
        try {
          objeto = JSON.parse(String(leitor.result || ''));
        } catch (erro) {
          window.SistemaOSToast.mostrar('Arquivo inválido: não é um .json legível.', { ehErro: true });
          return;
        }
        window.SistemaOSBackup.restaurarBackupCompleto(objeto)
          .then(function (resultado) {
            var totalNovos = resultado.historico.inseridos + resultado.documentosPendentes.inseridos;
            window.SistemaOSToast.mostrar(
              'Backup restaurado: ' + totalNovos + ' item(ns) novo(s) adicionado(s). Reabra a tela para ver tudo atualizado.'
            );
            preencherFormulario();
            // preencherFormulario só marca o checkbox de tema — não reaplica
            // o tema na tela (TemaApp.aplicar). Sem isto, restaurar um
            // backup com tema diferente do atual deixaria o checkbox e a
            // aparência da tela dessincronizados até a próxima interação.
            var cfgRestaurada = window.ConfigApp.carregarConfig();
            window.TemaApp.aplicar(cfgRestaurada.temaModo === 'escuro' ? 'escuro' : 'claro');
          })
          .catch(function (erro) {
            window.SistemaOSToast.mostrar(
              'Falha ao restaurar backup: ' + (erro && erro.message ? erro.message : String(erro)),
              { ehErro: true }
            );
          });
      };
      leitor.onerror = function () {
        window.SistemaOSToast.mostrar('Falha ao ler o arquivo selecionado.', { ehErro: true });
      };
      leitor.readAsText(arquivo);
    });
  }

  if (btnApagarTudo) {
    btnApagarTudo.addEventListener('click', function () {
      var primeiraConfirmacao = window.confirm(
        'Isso vai apagar TUDO que está salvo neste aparelho: configurações e todo o histórico local. ' +
        'Não pode ser desfeito. Tem certeza que quer continuar?'
      );
      if (!primeiraConfirmacao) return;

      var segundaConfirmacao = window.confirm(
        'Última confirmação: você já fez o backup antes de apagar? Esta é a última chance de cancelar.'
      );
      if (!segundaConfirmacao) return;

      btnApagarTudo.disabled = true;
      window.SistemaOSBackup.apagarTudo()
        .then(function () {
          window.SistemaOSToast.mostrar('Tudo foi apagado. Reabra o app para começar do zero.');
          preencherFormulario();
          var cfgPadrao = window.ConfigApp.carregarConfig();
          window.TemaApp.aplicar(cfgPadrao.temaModo === 'escuro' ? 'escuro' : 'claro');
        })
        .catch(function (erro) {
          window.SistemaOSToast.mostrar(
            'Falha ao apagar dados: ' + (erro && erro.message ? erro.message : String(erro)),
            { ehErro: true }
          );
        })
        .then(function () { btnApagarTudo.disabled = false; });
    });
  }

  if (btnSincronizarAgora && resultadoSincronizarAgora) {
    btnSincronizarAgora.addEventListener('click', function () {
      if (!window.SistemaOSSincronizacaoManual) return;
      btnSincronizarAgora.disabled = true;
      resultadoSincronizarAgora.hidden = false;
      resultadoSincronizarAgora.innerHTML = '<p class="historico-carregando">Sincronizando com o PC...</p>';

      window.SistemaOSSincronizacaoManual.sincronizarAgora().then(function (resultado) {
        if (resultado && resultado.sucesso) {
          var enviados = resultado.reenvio && resultado.reenvio.enviados ? resultado.reenvio.enviados : 0;
          resultadoSincronizarAgora.innerHTML = '<p class="historico-sucesso">Atualizado com o PC' +
            (enviados ? ' - ' + enviados + ' documento(s) pendente(s) enviado(s).' : '.') + '</p>';
          return;
        }
        var motivo = (resultado && resultado.motivo) || 'erro desconhecido';
        var texto = motivo === 'sem-config'
          ? 'A sincronização ainda não está disponível. Tente novamente quando o serviço estiver conectado.'
          : motivo === 'timeout'
            ? 'O PC nao respondeu. Deixe o Sistema OS aberto e conectado e tente novamente.'
            : 'Nao foi possivel sincronizar agora: ' + motivo;
        resultadoSincronizarAgora.innerHTML = '<p class="historico-erro">' + texto + '</p>';
      }).catch(function (erro) {
        resultadoSincronizarAgora.innerHTML = '<p class="historico-erro">Falha ao sincronizar: ' +
          ((erro && erro.message) || String(erro)) + '</p>';
      }).then(function () {
        btnSincronizarAgora.disabled = false;
      });
    });
  }

  if (btnTrocarUsuarioConfig) {
    btnTrocarUsuarioConfig.addEventListener('click', function () {
      if (!window.SistemaOSSessao || typeof window.SistemaOSSessao.sair !== 'function') return;
      if (!window.confirm('Sair desta conta para entrar com outro usuário?')) return;
      btnTrocarUsuarioConfig.disabled = true;
      window.SistemaOSSessao.sair().catch(function (erro) {
        if (!erroGeralConfig) return;
        erroGeralConfig.hidden = false;
        erroGeralConfig.textContent = 'Não foi possível encerrar a sessão: ' + ((erro && erro.message) || String(erro));
      }).then(function () {
        btnTrocarUsuarioConfig.disabled = false;
      });
    });
  }

  // ── Carregar: preenche o formulário com o que está salvo ────────────
  // Chamado tanto na abertura do app quanto toda vez que a aba de
  // Configurações é aberta (ver ligarNavegacaoConfig mais abaixo) — assim,
  // se o usuário salvar, sair e voltar, o formulário sempre reflete o
  // estado realmente persistido, mesmo que tenha havido uma tentativa de
  // edição cancelada (não salva) na visita anterior.
  function preencherFormulario() {
    var cfg = window.ConfigApp.carregarConfig();
    var contextoEmpresa = window.SistemaOSPermissoes && window.SistemaOSPermissoes.obterContexto
      ? window.SistemaOSPermissoes.obterContexto()
      : null;
    var podeAlterarLogo = !!(window.SistemaOSEmpresaService &&
      window.SistemaOSEmpresaService.ehAdministrador(contextoEmpresa));
    podeAlterarConfiguracoesEmpresa = podeAlterarLogo;

    campoNomeFantasia.value = cfg.nomeFantasia || '';
    campoRazaoSocial.value = cfg.razaoSocial || '';
    checkPossuiCnpj.checked = !!cfg.possuiCnpj;
    campoCnpj.value = cfg.cnpj || '';
    campoIe.value = cfg.inscricaoEstadual || '';

    logoBase64Pendente = cfg.logoBase64 || '';
    atualizarPreview(logoPreviewBox, logoBase64Pendente, 'Sem logo');
    if (inputLogoArquivo) {
      inputLogoArquivo.value = '';
      inputLogoArquivo.disabled = !podeAlterarLogo;
      inputLogoArquivo.title = podeAlterarLogo ? '' : 'A logo e definida pelo administrador da empresa.';
    }
    if (btnRemoverLogo) {
      btnRemoverLogo.disabled = !podeAlterarLogo;
      btnRemoverLogo.title = podeAlterarLogo ? '' : 'A logo e definida pelo administrador da empresa.';
    }

    var camposCompartilhados = [
      campoNomeFantasia, campoRazaoSocial, checkPossuiCnpj, campoCnpj, campoIe,
      campoTelefone, campoWhatsapp, campoEmail, campoEndereco, campoCidade, campoEstado, campoCep,
      checkExigirAssinaturaAssistencia, sliderFonteTermos, campoGarantiaDiasPadrao,
      inputLogoArquivo, btnRemoverLogo, btnDesenharAssinaturaAssistencia, btnRemoverAssinaturaAssistencia
    ];
    TERMOS_POR_DOCUMENTO.forEach(function (termo) {
      camposCompartilhados.push(termo.checkbox, termo.textarea, termo.btnRestaurar,
        termo.btnDefinirPadrao, termo.btnLimparPadrao);
    });
    camposCompartilhados.forEach(function (campo) {
      if (!campo) return;
      campo.disabled = !podeAlterarConfiguracoesEmpresa;
      campo.title = podeAlterarConfiguracoesEmpresa
        ? ''
        : 'Este dado é definido pelo administrador da empresa e sincronizado automaticamente.';
    });
    if (btnSalvarConfig) {
      btnSalvarConfig.disabled = !podeAlterarConfiguracoesEmpresa;
      btnSalvarConfig.title = podeAlterarConfiguracoesEmpresa
        ? ''
        : 'Somente o administrador pode alterar os dados e a identidade da empresa.';
    }

    assinaturaAssistenciaBase64Pendente = cfg.assinaturaAssistenciaBase64 || '';
    atualizarPreview(assinaturaPreviewBox, assinaturaAssistenciaBase64Pendente, 'Sem assinatura salva');

    if (checkExigirAssinaturaAssistencia) {
      checkExigirAssinaturaAssistencia.checked = cfg.exigirAssinaturaAssistencia !== false;
      aplicarVisibilidadeAssinaturaAssistencia(); // no-op — mantido só por segurança/rastreabilidade, ver definição da função
    }

    campoTelefone.value = cfg.telefone || '';
    campoWhatsapp.value = cfg.whatsapp || '';
    campoEmail.value = cfg.email || '';

    campoEndereco.value = cfg.endereco || '';
    campoCidade.value = cfg.cidade || '';
    campoEstado.value = cfg.estado || '';
    campoCep.value = cfg.cep || '';

    TERMOS_POR_DOCUMENTO.forEach(function (t) {
      t.checkbox.checked = cfg[t.chaveUsar] !== false;
      t.textarea.value = cfg[t.chaveCustom] || '';
      t.bloco.hidden = t.checkbox.checked; // reaplica o toggle pro estado carregado

      padraoUsuarioPendente[t.chavePadraoUsuario] = cfg[t.chavePadraoUsuario] || '';
      atualizarAvisoPadraoProprio(t);
    });

    checkTemaEscuro.checked = cfg.temaModo === 'escuro';

    if (sliderFonteTermos) {
      sliderFonteTermos.value = Number(cfg.tamanhoFonteTermosPdf) || 0;
      atualizarLabelFonteTermos();
    }

    if (campoGarantiaDiasPadrao) {
      var garantiaConfigurada = Number(cfg.garantiaDiasPadrao);
      campoGarantiaDiasPadrao.value = Number.isFinite(garantiaConfigurada) ? Math.max(0, garantiaConfigurada) : 90;
    }

    // Toggle de CNPJ reaplicado pro estado recém-carregado (idem termos).
    blocoCnpj.hidden = !checkPossuiCnpj.checked;

    erroGeralConfig.hidden = true;
    erroGeralConfig.textContent = '';
    feedbackConfig.hidden = true;
    feedbackConfig.textContent = '';
  }

  // ── Salvar: valida o obrigatório e persiste tudo via ConfigApp ──────
  function texto(el) { return el ? el.value.trim() : ''; }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();

    erroGeralConfig.hidden = true;
    erroGeralConfig.textContent = '';

    if (!podeAlterarConfiguracoesEmpresa) {
      erroGeralConfig.hidden = false;
      erroGeralConfig.textContent = 'Os dados e a logo da empresa são definidos pelo administrador e chegam automaticamente a este aparelho.';
      return;
    }

    var nomeFantasia = texto(campoNomeFantasia);
    if (!nomeFantasia) {
      erroGeralConfig.hidden = false;
      erroGeralConfig.textContent = 'Nome fantasia é obrigatório.';
      campoNomeFantasia.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    var patch = {
      nomeFantasia: nomeFantasia,
      razaoSocial: texto(campoRazaoSocial),
      possuiCnpj: checkPossuiCnpj.checked,
      cnpj: texto(campoCnpj),
      inscricaoEstadual: texto(campoIe),

      logoBase64: logoBase64Pendente,
      assinaturaAssistenciaBase64: assinaturaAssistenciaBase64Pendente,
      exigirAssinaturaAssistencia: checkExigirAssinaturaAssistencia
        ? checkExigirAssinaturaAssistencia.checked
        : true,

      telefone: texto(campoTelefone),
      whatsapp: texto(campoWhatsapp),
      email: texto(campoEmail),

      endereco: texto(campoEndereco),
      cidade: texto(campoCidade),
      estado: texto(campoEstado),
      cep: texto(campoCep),

      temaModo: checkTemaEscuro.checked ? 'escuro' : 'claro',
      tamanhoFonteTermosPdf: sliderFonteTermos ? (Number(sliderFonteTermos.value) || 0) : 0,
      // Math.max(0, ...) evita salvar negativo se o usuário digitar algo
      // inválido; 0 é permitido (equivale a "sem garantia").
      garantiaDiasPadrao: campoGarantiaDiasPadrao ? Math.max(0, Number(campoGarantiaDiasPadrao.value) || 0) : 90,

    };

    TERMOS_POR_DOCUMENTO.forEach(function (t) {
      patch[t.chaveUsar] = t.checkbox.checked;
      patch[t.chaveCustom] = texto(t.textarea);
      patch[t.chavePadraoUsuario] = padraoUsuarioPendente[t.chavePadraoUsuario] || '';
    });

    try {
      if (btnSalvarConfig) btnSalvarConfig.disabled = true;
      var configAnterior = window.ConfigApp.carregarConfig();
      var logoMudou = String(configAnterior.logoBase64 || '') !== String(patch.logoBase64 || '');

      // Persiste primeiro no aparelho. Antes, o upload da logo acontecia
      // antes deste ponto: uma falha de internet impedia também a assinatura
      // e os demais campos de serem salvos, embora a tela parecesse concluir.
      patch = window.ConfigApp.salvarConfig(patch);
      var configVerificada = window.ConfigApp.carregarConfig();
      ['nomeFantasia', 'razaoSocial', 'telefone', 'whatsapp', 'email', 'endereco',
        'cidade', 'estado', 'cep', 'logoBase64', 'assinaturaAssistenciaBase64'
      ].forEach(function (chave) {
        if (String(configVerificada[chave] || '') !== String(patch[chave] || '')) {
          throw new Error('O aparelho não confirmou o salvamento do campo ' + chave + '.');
        }
      });
      window.TemaApp.aplicar(patch.temaModo);
      document.dispatchEvent(new CustomEvent('sistema-os:config-salva'));

      var avisoNuvem = '';
      if (logoMudou && window.SistemaOSEmpresaService && window.SistemaOSEmpresaService.atualizarLogoEmpresa) {
        try {
          var contextoAtual = window.SistemaOSPermissoes && window.SistemaOSPermissoes.obterContexto
            ? window.SistemaOSPermissoes.obterContexto()
            : null;
          await window.SistemaOSEmpresaService.atualizarLogoEmpresa(contextoAtual, patch.logoBase64 || '');
        } catch (erroLogo) {
          // A logo continua válida e visível neste aparelho. A falha de rede
          // fica clara, sem apagar a assinatura ou fingir que nada foi salvo.
          avisoNuvem = ' A logo ficou salva neste aparelho, mas a nuvem não respondeu; tente sincronizar novamente.';
        }
      }
      if (window.SistemaOSEmpresaService && window.SistemaOSEmpresaService.salvarConfiguracoesEmpresa) {
        try {
          var contextoConfig = window.SistemaOSPermissoes && window.SistemaOSPermissoes.obterContexto
            ? window.SistemaOSPermissoes.obterContexto()
            : null;
          await window.SistemaOSEmpresaService.salvarConfiguracoesEmpresa(contextoConfig, patch);
        } catch (erroConfigNuvem) {
          avisoNuvem = ' As alterações ficaram salvas neste aparelho, mas não foi possível atualizar a configuração compartilhada: '
            + ((erroConfigNuvem && erroConfigNuvem.message) || String(erroConfigNuvem));
        }
      }
      preencherFormulario();
      window.SistemaOSToast.mostrar('Configurações salvas.' + avisoNuvem, avisoNuvem ? 'aviso' : undefined);
    } catch (err) {
      erroGeralConfig.hidden = false;
      erroGeralConfig.textContent =
        'Não foi possível salvar: ' + (err && err.message ? err.message : String(err));
    } finally {
      if (btnSalvarConfig) btnSalvarConfig.disabled = !podeAlterarConfiguracoesEmpresa;
    }
  });

  // ── Recarrega o formulário toda vez que a aba de Configurações é
  // aberta pela navegação principal (btn-ir-config, em app.js). app.js não
  // sabe nada sobre os campos internos desta tela — só dispara este evento
  // customizado em mostrarTela('config'), e quem escuta é este módulo.
  document.addEventListener('sistema-os:tela-config-aberta', preencherFormulario);

  if (btnAbrirChamadoConfig) {
    btnAbrirChamadoConfig.addEventListener('click', async function () {
      if (window.SistemaOSChamados && window.SistemaOSChamados.abrirNovo) {
        try {
          await window.SistemaOSChamados.abrirNovo({ origem: 'config_celular' });
        } catch (erroChamado) {
          window.SistemaOSToast.mostrar(
            'Não foi possível abrir a central: ' + (erroChamado && erroChamado.message ? erroChamado.message : String(erroChamado)),
            'erro'
          );
        }
        return;
      }
      var mensagem = String(window.prompt('Descreva o que precisa (mínimo 10 caracteres):') || '').trim();
      if (mensagem.length < 10) { window.SistemaOSToast.mostrar('Descreva o problema com pelo menos 10 caracteres.', 'erro'); return; }
      var contato = String(window.prompt('Telefone ou e-mail para retorno (opcional):') || '').trim();
      btnAbrirChamadoConfig.disabled = true;
      try {
        var cliente = window.SupabaseClientApp.obterCliente();
        var resposta = await cliente.functions.invoke('chamados-suporte', { body: { acao: 'criar_autenticado', dados: {
          origem: 'config_celular', contato: contato, mensagem: mensagem
        } } });
        if (resposta.error && window.SistemaOSEdgeError) await window.SistemaOSEdgeError.lancar(resposta.error, 'Não foi possível abrir o chamado.');
        if (resposta.error) throw resposta.error;
        if (resposta.data && resposta.data.erro) throw new Error(resposta.data.erro);
        if (window.SistemaOSChamados) window.SistemaOSChamados.registrar(resposta.data || {});
        window.SistemaOSToast.mostrar('Chamado ' + ((resposta.data && resposta.data.protocolo) || '') + ' enviado ao suporte.');
        if (window.SistemaOSChamados) window.SistemaOSChamados.abrir().catch(function () {});
      } catch (erro) {
        window.SistemaOSToast.mostrar('Não foi possível abrir o chamado: ' + (erro && erro.message ? erro.message : String(erro)), 'erro');
      } finally { btnAbrirChamadoConfig.disabled = false; }
    });
  }

  // ── Atualização oficial pelo GitHub Releases ───────────────────────
  var btnVerificarAtualizacao = document.getElementById('btn-verificar-atualizacao-app');
  var btnInstalarAtualizacao = document.getElementById('btn-instalar-atualizacao-app');
  var statusAtualizacao = document.getElementById('status-atualizacao-app');

  function exibirStatusAtualizacao(resultado) {
    if (!statusAtualizacao || !resultado) return;
    statusAtualizacao.hidden = false;
    statusAtualizacao.textContent = resultado.mensagem || '';
    if (btnInstalarAtualizacao) btnInstalarAtualizacao.hidden = resultado.fase !== 'disponivel';
  }

  async function verificarAtualizacao(forcar) {
    if (!window.SistemaOSAtualizacao || typeof window.SistemaOSAtualizacao.verificar !== 'function') {
      exibirStatusAtualizacao({ fase: 'erro', mensagem: 'O recurso de atualização não foi carregado. Feche e abra o aplicativo novamente.' });
      return;
    }
    if (btnVerificarAtualizacao) btnVerificarAtualizacao.disabled = true;
    try {
      exibirStatusAtualizacao(await window.SistemaOSAtualizacao.verificar(!!forcar));
    } catch (erro) {
      exibirStatusAtualizacao({ fase: 'erro', mensagem: (erro && erro.message) || 'Não foi possível verificar atualizações.' });
    } finally {
      if (btnVerificarAtualizacao) btnVerificarAtualizacao.disabled = false;
    }
  }

  if (btnVerificarAtualizacao && !btnVerificarAtualizacao.dataset.atualizacaoVinculada) {
    btnVerificarAtualizacao.addEventListener('click', function () { verificarAtualizacao(true); });
  }
  if (btnInstalarAtualizacao && !btnInstalarAtualizacao.dataset.atualizacaoVinculada) {
    btnInstalarAtualizacao.addEventListener('click', async function () {
      btnInstalarAtualizacao.disabled = true;
      try {
        if (!window.SistemaOSAtualizacao || typeof window.SistemaOSAtualizacao.baixarEInstalar !== 'function') {
          throw new Error('O recurso de instalação não está disponível neste APK.');
        }
        var resultado = await window.SistemaOSAtualizacao.baixarEInstalar();
        exibirStatusAtualizacao({ fase: resultado.sucesso ? 'baixando' : 'erro', mensagem: resultado.mensagem || resultado.erro });
      } catch (erro) {
        exibirStatusAtualizacao({ fase: 'erro', mensagem: (erro && erro.message) || 'Não foi possível iniciar o download do APK.' });
      } finally {
        btnInstalarAtualizacao.disabled = false;
      }
    });
  }
  if (!window.SistemaOSAtualizacaoTela) {
    document.addEventListener('sistema-os:tela-config-aberta', function () { verificarAtualizacao(false); });
  }

  // Primeira carga: se o app abrir direto nesta aba (não deveria acontecer
  // hoje, já que a tela inicial é 'form', mas não custa garantir).
  preencherFormulario();
})();
