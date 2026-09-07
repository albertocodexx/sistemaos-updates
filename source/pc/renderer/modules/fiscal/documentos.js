(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let resumo = null;
  let fiscalHabilitado = false;
  let atualizacaoFiscalTimer = null;
  let etapaFiscal = 1;

  function escaparHtml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (caractere) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[caractere]);
  }

  function textoCampo(id) {
    return String($(id)?.value || '').trim();
  }

  function definirValor(id, valor) {
    const campo = $(id);
    if (campo) campo.value = valor ?? '';
  }

  function definirMarcado(id, valor) {
    const campo = $(id);
    if (campo) campo.checked = valor === true;
  }

  function somenteDigitos(valor, limite) {
    return String(valor || '').replace(/\D/g, '').slice(0, limite);
  }

  function normalizarCnpj(valor) {
    return String(valor || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  }

  function cpfValido(valor) {
    const cpf = String(valor || '').replace(/\D/g, '');
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    const calcular = (tamanho) => {
      let soma = 0;
      for (let i = 0; i < tamanho; i += 1) soma += Number(cpf[i]) * (tamanho + 1 - i);
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    };
    return calcular(9) === Number(cpf[9]) && calcular(10) === Number(cpf[10]);
  }

  function cnpjValido(valor) {
    return /^[0-9A-Z]{12}\d{2}$/.test(normalizarCnpj(valor));
  }

  function aplicarDisponibilidade(ativa) {
    fiscalHabilitado = ativa === true;
    const secao = $('configFiscalEmpresa');
    if (secao && !fiscalHabilitado) secao.hidden = true;
  }

  window.fiscalSistemaOSHabilitado = () => fiscalHabilitado;

  function garantirSecao() {
    if ($('configFiscalEmpresa')) return;
    const referencia = $('integracaoWhatsAppApiEmpresa') || $('integracaoMercadoPagoEmpresa');
    if (!referencia) return;

    const secao = document.createElement('div');
    secao.id = 'configFiscalEmpresa';
    secao.className = 'config-secao';
    secao.hidden = true;
    secao.innerHTML = `
      <style>
        #configFiscalEmpresa .fiscal-cabecalho{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
        #configFiscalEmpresa .fiscal-selo{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border:1px solid rgba(96,165,250,.35);border-radius:999px;background:rgba(37,99,235,.1);font-size:12px;font-weight:700}
        #configFiscalEmpresa .fiscal-passos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:18px 0 16px}
        #configFiscalEmpresa .fiscal-passo{min-height:58px;padding:9px 10px;border:1px solid rgba(148,163,184,.25);border-radius:12px;background:rgba(148,163,184,.05);color:inherit;text-align:left;cursor:pointer}
        #configFiscalEmpresa .fiscal-passo span{display:block;font-size:11px;opacity:.72;margin-bottom:3px}
        #configFiscalEmpresa .fiscal-passo strong{font-size:13px;line-height:1.2}
        #configFiscalEmpresa .fiscal-passo[aria-current="step"]{border-color:#3b82f6;background:rgba(37,99,235,.14);box-shadow:inset 0 0 0 1px rgba(59,130,246,.2)}
        #configFiscalEmpresa .fiscal-painel{padding:17px;border:1px solid rgba(148,163,184,.2);border-radius:14px;background:rgba(15,23,42,.09)}
        #configFiscalEmpresa .fiscal-painel[hidden]{display:none!important}
        #configFiscalEmpresa .fiscal-etapa-titulo{margin:0 0 4px;font-size:16px}
        #configFiscalEmpresa .fiscal-ajuda{margin:0 0 15px;font-size:12px;opacity:.78;line-height:1.45}
        #configFiscalEmpresa .fiscal-obrigatorio{color:#60a5fa;font-weight:800}
        #configFiscalEmpresa .fiscal-aviso{padding:11px 12px;border:1px solid rgba(245,158,11,.3);border-radius:11px;background:rgba(245,158,11,.08);font-size:12px;line-height:1.45}
        #configFiscalEmpresa .fiscal-seguranca{padding:12px;border:1px solid rgba(34,197,94,.3);border-radius:11px;background:rgba(34,197,94,.08);font-size:12px;line-height:1.45}
        #configFiscalEmpresa .fiscal-navegacao{display:flex;justify-content:space-between;gap:10px;margin-top:13px}
        #configFiscalEmpresa .fiscal-acoes{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
        #configFiscalEmpresa .fiscal-revisao{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:12px 0}
        #configFiscalEmpresa .fiscal-revisao-item{padding:10px 11px;border-radius:10px;background:rgba(148,163,184,.08);font-size:12px;line-height:1.45}
        #configFiscalEmpresa .fiscal-revisao-item strong{display:block;margin-bottom:2px}
        #configFiscalEmpresa details.fiscal-avancado{margin-top:12px;padding:10px 12px;border:1px solid rgba(148,163,184,.18);border-radius:11px}
        #configFiscalEmpresa details.fiscal-avancado summary{cursor:pointer;font-weight:700;font-size:12px}
        #configFiscalEmpresa details.fiscal-avancado .grade-2{margin-top:12px}
        #configFiscalEmpresa .fiscal-lista-titulo{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 0 9px}
        @media(max-width:760px){#configFiscalEmpresa .fiscal-passos{grid-template-columns:repeat(2,minmax(0,1fr))}#configFiscalEmpresa .fiscal-revisao{grid-template-columns:1fr}}
      </style>
      <div class="fiscal-cabecalho">
        <div>
          <div class="config-secao-titulo">NFS-e e DANFSe</div>
          <p class="campo-desc">Configure a emissão de serviço em quatro etapas. O DANFSe oficial só fica disponível depois que a NFS-e é autorizada.</p>
        </div>
        <span class="fiscal-selo">Documento fiscal de serviço</span>
      </div>
      <div id="statusFiscalEmpresa" class="fiscal-aviso" style="margin-top:12px">Consultando a situação fiscal…</div>

      <div class="fiscal-passos" role="tablist" aria-label="Etapas da configuração fiscal">
        <button type="button" class="fiscal-passo" data-fiscal-etapa="1" aria-current="step"><span>Etapa 1</span><strong>Prestador</strong></button>
        <button type="button" class="fiscal-passo" data-fiscal-etapa="2"><span>Etapa 2</span><strong>Município e regime</strong></button>
        <button type="button" class="fiscal-passo" data-fiscal-etapa="3"><span>Etapa 3</span><strong>Serviço padrão</strong></button>
        <button type="button" class="fiscal-passo" data-fiscal-etapa="4"><span>Etapa 4</span><strong>Conexão e revisão</strong></button>
      </div>

      <div class="fiscal-assistente">
        <section class="fiscal-painel" data-fiscal-painel="1">
          <h3 class="fiscal-etapa-titulo">Quem prestará o serviço?</h3>
          <p class="fiscal-ajuda">O documento abaixo será o emitente da NFS-e. MEI emite pelo CNPJ; o CPF do titular é usado somente no acesso ao portal nacional.</p>
          <div class="grade-2">
            <div class="campo"><label for="fiscalTipoPrestador">Perfil fiscal <span class="fiscal-obrigatorio">*</span></label><select id="fiscalTipoPrestador"><option value="mei">MEI (CNPJ)</option><option value="juridica">Empresa (CNPJ)</option><option value="fisica">Pessoa física/autônomo (CPF)</option></select></div>
            <div class="campo"><label for="fiscalDocumentoPrestador" id="fiscalDocumentoPrestadorLabel">CNPJ do prestador <span class="fiscal-obrigatorio">*</span></label><input id="fiscalDocumentoPrestador" inputmode="text" maxlength="18" autocomplete="off" spellcheck="false"><small id="fiscalDocumentoAjuda" class="campo-desc">Aceita o CNPJ atual e o formato alfanumérico.</small></div>
            <div class="campo"><label for="fiscalNomePrestador">Nome ou razão social</label><input id="fiscalNomePrestador" maxlength="160" autocomplete="organization"></div>
            <div class="campo"><label for="fiscalNomeFantasia">Nome fantasia</label><input id="fiscalNomeFantasia" maxlength="160"></div>
            <div class="campo"><label for="fiscalEmailPrestador">E-mail fiscal</label><input id="fiscalEmailPrestador" type="email" maxlength="180" autocomplete="email"></div>
            <div class="campo"><label for="fiscalTelefonePrestador">Telefone</label><input id="fiscalTelefonePrestador" maxlength="30" autocomplete="tel"></div>
          </div>
          <p id="fiscalAvisoPessoaFisica" class="fiscal-aviso" hidden>A emissão por CPF só funciona quando a pessoa física está cadastrada e autorizada como prestadora pelo município. Informar um CPF válido, sozinho, não libera a emissão.</p>
          <p id="fiscalAvisoMei" class="fiscal-aviso">Para emissão automática por API, o MEI também precisa concluir a ativação técnica do seu CNPJ. Não informe senha GOV.BR neste sistema.</p>
          <details class="fiscal-avancado">
            <summary>Adicionar endereço do prestador</summary>
            <div class="grade-2">
              <div class="campo"><label for="fiscalCepPrestador">CEP</label><input id="fiscalCepPrestador" inputmode="numeric" maxlength="9"></div>
              <div class="campo"><label for="fiscalLogradouroPrestador">Logradouro</label><input id="fiscalLogradouroPrestador" maxlength="180"></div>
              <div class="campo"><label for="fiscalNumeroPrestador">Número</label><input id="fiscalNumeroPrestador" maxlength="30"></div>
              <div class="campo"><label for="fiscalComplementoPrestador">Complemento</label><input id="fiscalComplementoPrestador" maxlength="80"></div>
              <div class="campo"><label for="fiscalBairroPrestador">Bairro</label><input id="fiscalBairroPrestador" maxlength="100"></div>
            </div>
          </details>
        </section>

        <section class="fiscal-painel" data-fiscal-painel="2" hidden>
          <h3 class="fiscal-etapa-titulo">Município e enquadramento</h3>
          <p class="fiscal-ajuda">A prefeitura continua responsável pelo cadastro e pelas regras do ISS. Confirme estes dados com a prefeitura ou com o contador.</p>
          <div class="grade-2">
            <div class="campo"><label for="fiscalCodigoMunicipio">Código IBGE do município <span class="fiscal-obrigatorio">*</span></label><input id="fiscalCodigoMunicipio" inputmode="numeric" maxlength="7" placeholder="7 dígitos"></div>
            <div class="campo"><label for="fiscalMunicipioNome">Município</label><input id="fiscalMunicipioNome" maxlength="120"></div>
            <div class="campo"><label for="fiscalUfPrestador">UF</label><input id="fiscalUfPrestador" maxlength="2" style="text-transform:uppercase" placeholder="UF"></div>
            <div class="campo"><label for="fiscalInscricaoMunicipal">Inscrição municipal</label><input id="fiscalInscricaoMunicipal" maxlength="30"></div>
            <div class="campo"><label for="fiscalRegimeTributario">Regime tributário <span class="fiscal-obrigatorio">*</span></label><select id="fiscalRegimeTributario"><option value="mei">MEI</option><option value="simples_nacional">Simples Nacional</option><option value="lucro_presumido">Lucro Presumido</option><option value="lucro_real">Lucro Real</option><option value="autonomo">Pessoa física/autônomo</option><option value="outro">Outro</option></select></div>
            <div class="campo"><label for="fiscalRegimeApuracao">Apuração informada pelo contador</label><select id="fiscalRegimeApuracao"><option value="padrao">Padrão do cadastro fiscal</option><option value="simples_nacional">Pelo Simples Nacional</option><option value="nfse">Pela NFS-e</option></select></div>
          </div>
          <div class="grade-2" style="margin-top:10px">
            <label class="campo-checkbox"><input id="fiscalInscricaoDispensada" type="checkbox"><span>Município dispensa inscrição municipal</span></label>
            <label class="campo-checkbox"><input id="fiscalCadastroMunicipalConfirmado" type="checkbox"><span>Cadastro municipal está ativo e autorizado</span></label>
          </div>
          <details class="fiscal-avancado">
            <summary>Situações tributárias especiais</summary>
            <div class="grade-2">
              <div class="campo"><label for="fiscalRegimeEspecial">Regime especial</label><input id="fiscalRegimeEspecial" maxlength="100" placeholder="Somente se houver"></div>
              <div class="campo"><label for="fiscalBeneficioMunicipal">Benefício municipal</label><input id="fiscalBeneficioMunicipal" maxlength="100" placeholder="Somente se houver"></div>
            </div>
          </details>
        </section>

        <section class="fiscal-painel" data-fiscal-painel="3" hidden>
          <h3 class="fiscal-etapa-titulo">Qual é o serviço padrão?</h3>
          <p class="fiscal-ajuda">Cadastre o serviço mais usado. O código nacional, o código municipal e a alíquota não devem ser adivinhados: valide-os com o contador ou a prefeitura.</p>
          <div class="grade-2">
            <div class="campo"><label for="fiscalCodigoServico">Código de Tributação Nacional <span class="fiscal-obrigatorio">*</span></label><input id="fiscalCodigoServico" maxlength="30" placeholder="Item da lista de serviços"></div>
            <div class="campo"><label for="fiscalCodigoServicoMunicipal">Código complementar municipal</label><input id="fiscalCodigoServicoMunicipal" maxlength="30"></div>
            <div class="campo"><label for="fiscalNbs">NBS</label><input id="fiscalNbs" maxlength="30" placeholder="Quando aplicável"></div>
            <div class="campo"><label for="fiscalAliquotaIss">Alíquota de ISS (%)</label><input id="fiscalAliquotaIss" inputmode="decimal" maxlength="8" placeholder="Ex.: 5,00"></div>
            <div class="campo"><label for="fiscalIssRetidoPadrao">Retenção de ISS padrão</label><select id="fiscalIssRetidoPadrao"><option value="nao">Não retido</option><option value="tomador">Retido pelo tomador</option><option value="intermediario">Retido pelo intermediário</option></select></div>
            <div class="campo"><label for="fiscalCodigoMunicipioPrestacao">Município padrão da prestação</label><input id="fiscalCodigoMunicipioPrestacao" inputmode="numeric" maxlength="7" placeholder="Vazio = município do prestador"></div>
          </div>
          <div class="campo" style="margin-top:10px"><label for="fiscalDescricaoServico">Descrição padrão do serviço</label><textarea id="fiscalDescricaoServico" maxlength="500" rows="3" placeholder="Descreva claramente o serviço prestado"></textarea></div>
          <div class="grade-2" style="margin-top:10px">
            <label class="campo-checkbox"><input id="fiscalAutoOs" type="checkbox"><span>Preparar NFS-e ao concluir uma OS</span></label>
            <label class="campo-checkbox"><input id="fiscalAutoVenda" type="checkbox"><span>Preparar NFS-e em venda somente quando houver serviço</span></label>
          </div>
          <details class="fiscal-avancado">
            <summary>Totais aproximados de tributos</summary>
            <div class="grade-2">
              <div class="campo"><label for="fiscalTributosModo">Como informar</label><select id="fiscalTributosModo"><option value="nao_informar">Não informar</option><option value="percentuais">Percentuais fornecidos pelo contador</option></select></div>
              <div class="campo"><label for="fiscalTributosFederais">Federal (%)</label><input id="fiscalTributosFederais" inputmode="decimal" maxlength="8"></div>
              <div class="campo"><label for="fiscalTributosEstaduais">Estadual (%)</label><input id="fiscalTributosEstaduais" inputmode="decimal" maxlength="8"></div>
              <div class="campo"><label for="fiscalTributosMunicipais">Municipal (%)</label><input id="fiscalTributosMunicipais" inputmode="decimal" maxlength="8"></div>
            </div>
          </details>
        </section>

        <section class="fiscal-painel" data-fiscal-painel="4" hidden>
          <h3 class="fiscal-etapa-titulo">Conexão e revisão</h3>
          <p class="fiscal-ajuda">Escolha a rota usada pelo prestador. A disponibilidade real depende do município, do regime e da habilitação do emitente.</p>
          <div class="grade-2">
            <div class="campo"><label for="fiscalRotaEmissao">Rota de emissão</label><select id="fiscalRotaEmissao"><option value="nfse_nacional">Emissor Nacional / SEFIN Nacional</option><option value="municipal">Prefeitura ou provedor municipal</option><option value="provedor">Gateway fiscal contratado</option></select></div>
            <div class="campo"><label for="fiscalAmbiente">Ambiente</label><select id="fiscalAmbiente"><option value="homologacao">Homologação (teste)</option><option value="producao">Produção (NFS-e real)</option></select></div>
            <div class="campo" id="fiscalProvedorCampo" hidden><label for="fiscalProvedorNome">Nome da prefeitura/provedor</label><input id="fiscalProvedorNome" maxlength="120"></div>
          </div>
          <div id="fiscalRevisao" class="fiscal-revisao"></div>
          <div class="fiscal-seguranca"><strong>Credenciais não são enviadas por este formulário.</strong><br>Não digite senha GOV.BR, senha do certificado, token ou arquivo A1 no chamado. Após a solicitação, o suporte orientará um canal seguro e o teste de homologação.</div>
          <div class="fiscal-acoes">
            <button type="button" id="btnSalvarFiscal" class="botao botao-primario">Salvar configuração fiscal</button>
            <button type="button" id="btnSolicitarAtivacaoFiscal" class="botao botao-secundario">Solicitar ativação fiscal</button>
            <button type="button" id="btnAtualizarFiscal" class="botao botao-secundario">Atualizar situação</button>
          </div>
          <div id="statusAtivacaoFiscal" class="campo-desc" style="margin-top:9px"></div>
        </section>
      </div>

      <div class="fiscal-navegacao">
        <button type="button" id="btnFiscalAnterior" class="botao botao-secundario" hidden>Voltar</button>
        <button type="button" id="btnFiscalProxima" class="botao botao-primario" style="margin-left:auto">Continuar</button>
      </div>
      <div class="fiscal-lista-titulo"><strong>NFS-e recentes</strong><small class="campo-desc">O DANFSe aparece somente após autorização.</small></div>
      <div id="listaNotasFiscais"></div>`;

    referencia.after(secao);
    $('btnSalvarFiscal').addEventListener('click', () => salvar());
    $('btnSolicitarAtivacaoFiscal').addEventListener('click', solicitarAtivacaoFiscal);
    $('btnAtualizarFiscal').addEventListener('click', carregar);
    $('btnFiscalAnterior').addEventListener('click', () => mostrarEtapa(etapaFiscal - 1));
    $('btnFiscalProxima').addEventListener('click', () => {
      if (validarEtapa(etapaFiscal)) mostrarEtapa(etapaFiscal + 1);
    });
    secao.querySelectorAll('[data-fiscal-etapa]').forEach((botao) => botao.addEventListener('click', () => mostrarEtapa(Number(botao.dataset.fiscalEtapa))));
    $('fiscalTipoPrestador').addEventListener('change', () => {
      if ($('fiscalRegimeTributario')) $('fiscalRegimeTributario').dataset.automatico = 'sim';
      atualizarTipoPrestador();
    });
    $('fiscalRegimeTributario').addEventListener('change', () => {
      $('fiscalRegimeTributario').dataset.automatico = 'nao';
      atualizarRevisao();
    });
    $('fiscalInscricaoDispensada').addEventListener('change', atualizarInscricaoMunicipal);
    $('fiscalRotaEmissao').addEventListener('change', atualizarRotaEmissao);
    secao.querySelectorAll('input,select,textarea').forEach((campo) => campo.addEventListener('input', atualizarRevisao));
    $('listaNotasFiscais').addEventListener('click', (evento) => {
      const botao = evento.target.closest('[data-abrir-danfse]');
      if (botao) abrirDanfse(botao.dataset.abrirDanfse, botao);
    });
    mostrarEtapa(1);
  }

  function atualizarTipoPrestador() {
    const tipo = textoCampo('fiscalTipoPrestador') || 'mei';
    const pessoaFisica = tipo === 'fisica';
    if ($('fiscalDocumentoPrestadorLabel')) $('fiscalDocumentoPrestadorLabel').innerHTML = `${pessoaFisica ? 'CPF' : 'CNPJ'} do prestador <span class="fiscal-obrigatorio">*</span>`;
    if ($('fiscalDocumentoPrestador')) {
      $('fiscalDocumentoPrestador').maxLength = pessoaFisica ? 14 : 18;
      $('fiscalDocumentoPrestador').inputMode = pessoaFisica ? 'numeric' : 'text';
    }
    if ($('fiscalDocumentoAjuda')) $('fiscalDocumentoAjuda').textContent = pessoaFisica ? 'CPF com 11 dígitos e validação dos dígitos verificadores.' : 'Aceita o CNPJ atual e o formato alfanumérico.';
    if ($('fiscalAvisoPessoaFisica')) $('fiscalAvisoPessoaFisica').hidden = !pessoaFisica;
    if ($('fiscalAvisoMei')) $('fiscalAvisoMei').hidden = tipo !== 'mei';

    const regime = $('fiscalRegimeTributario');
    if (regime && (regime.dataset.automatico !== 'nao' || !regime.value)) {
      regime.value = tipo === 'mei' ? 'mei' : (pessoaFisica ? 'autonomo' : 'simples_nacional');
      regime.dataset.automatico = 'sim';
    }
    atualizarRevisao();
  }

  function atualizarInscricaoMunicipal() {
    const dispensada = $('fiscalInscricaoDispensada')?.checked === true;
    const campo = $('fiscalInscricaoMunicipal');
    if (campo) {
      campo.disabled = dispensada;
      campo.placeholder = dispensada ? 'Dispensada pelo município' : '';
    }
    atualizarRevisao();
  }

  function atualizarRotaEmissao() {
    const rota = textoCampo('fiscalRotaEmissao');
    if ($('fiscalProvedorCampo')) $('fiscalProvedorCampo').hidden = rota === 'nfse_nacional';
    atualizarRevisao();
  }

  function rotuloTipoPrestador(tipo) {
    return ({ mei: 'MEI (CNPJ)', juridica: 'Empresa (CNPJ)', fisica: 'Pessoa física/autônomo (CPF)' })[tipo] || 'Não informado';
  }

  function rotuloRegime(regime) {
    return ({ mei: 'MEI', simples_nacional: 'Simples Nacional', lucro_presumido: 'Lucro Presumido', lucro_real: 'Lucro Real', autonomo: 'Pessoa física/autônomo', outro: 'Outro' })[regime] || 'Não informado';
  }

  function rotuloRota(rota) {
    return ({ nfse_nacional: 'Emissor Nacional', municipal: 'Prefeitura/provedor municipal', provedor: 'Gateway fiscal' })[rota] || 'Não informada';
  }

  function atualizarRevisao() {
    const revisao = $('fiscalRevisao');
    if (!revisao) return;
    const tipo = textoCampo('fiscalTipoPrestador');
    const documento = textoCampo('fiscalDocumentoPrestador');
    const im = $('fiscalInscricaoDispensada')?.checked ? 'Dispensada' : (textoCampo('fiscalInscricaoMunicipal') || 'Não informada');
    revisao.innerHTML = `
      <div class="fiscal-revisao-item"><strong>Prestador</strong>${escaparHtml(rotuloTipoPrestador(tipo))}<br>${escaparHtml(documento || 'Documento pendente')}</div>
      <div class="fiscal-revisao-item"><strong>Município e regime</strong>${escaparHtml(textoCampo('fiscalMunicipioNome') || textoCampo('fiscalCodigoMunicipio') || 'Município pendente')} · ${escaparHtml(rotuloRegime(textoCampo('fiscalRegimeTributario')))}<br>IM: ${escaparHtml(im)}</div>
      <div class="fiscal-revisao-item"><strong>Serviço padrão</strong>${escaparHtml(textoCampo('fiscalCodigoServico') || 'Código pendente')}<br>${escaparHtml(textoCampo('fiscalDescricaoServico') || 'Descrição ainda não informada')}</div>
      <div class="fiscal-revisao-item"><strong>Conexão</strong>${escaparHtml(rotuloRota(textoCampo('fiscalRotaEmissao')))} · ${escaparHtml(textoCampo('fiscalAmbiente') === 'producao' ? 'Produção' : 'Homologação')}<br>Ativação técnica: ${resumo?.configuracao?.status === 'configurada' ? 'concluída' : 'pendente'}</div>`;
  }

  function mostrarEtapa(numero) {
    etapaFiscal = Math.max(1, Math.min(4, Number(numero) || 1));
    document.querySelectorAll('#configFiscalEmpresa [data-fiscal-painel]').forEach((painel) => {
      painel.hidden = Number(painel.dataset.fiscalPainel) !== etapaFiscal;
    });
    document.querySelectorAll('#configFiscalEmpresa [data-fiscal-etapa]').forEach((botao) => {
      if (Number(botao.dataset.fiscalEtapa) === etapaFiscal) botao.setAttribute('aria-current', 'step');
      else botao.removeAttribute('aria-current');
    });
    if ($('btnFiscalAnterior')) $('btnFiscalAnterior').hidden = etapaFiscal === 1;
    if ($('btnFiscalProxima')) $('btnFiscalProxima').hidden = etapaFiscal === 4;
    atualizarRevisao();
  }

  function invalidar(campo, mensagem) {
    window.toast?.(mensagem, 'aviso');
    campo?.focus();
    return false;
  }

  function validarEtapa(etapa) {
    if (etapa === 1) {
      const tipo = textoCampo('fiscalTipoPrestador');
      const documento = textoCampo('fiscalDocumentoPrestador');
      if (!documento) return invalidar($('fiscalDocumentoPrestador'), 'Informe o CPF ou CNPJ do prestador.');
      if (tipo === 'fisica' && !cpfValido(documento)) return invalidar($('fiscalDocumentoPrestador'), 'Informe um CPF válido.');
      if (tipo !== 'fisica' && !cnpjValido(documento)) return invalidar($('fiscalDocumentoPrestador'), 'Informe um CNPJ com 14 caracteres; os dois últimos devem ser numéricos.');
    }
    if (etapa === 2) {
      const codigo = textoCampo('fiscalCodigoMunicipio').replace(/\D/g, '');
      if (codigo.length !== 7) return invalidar($('fiscalCodigoMunicipio'), 'Informe o código IBGE do município com 7 dígitos.');
      if (!$('fiscalInscricaoDispensada')?.checked && !textoCampo('fiscalInscricaoMunicipal')) {
        return invalidar($('fiscalInscricaoMunicipal'), 'Informe a inscrição municipal ou marque que o município a dispensa.');
      }
    }
    if (etapa === 3 && !textoCampo('fiscalCodigoServico')) {
      return invalidar($('fiscalCodigoServico'), 'Informe o Código de Tributação Nacional do serviço.');
    }
    return true;
  }

  function preencher() {
    if (!resumo) return;
    const config = resumo.configuracao || {};
    const metadados = config.metadados || {};
    const tipoPrestador = ['mei', 'juridica', 'fisica'].includes(metadados.tipo_prestador)
      ? metadados.tipo_prestador
      : (metadados.tipo_pessoa === 'fisica' || (metadados.cpf && !metadados.cnpj) ? 'fisica' : (metadados.regime_tributario === 'mei' ? 'mei' : 'juridica'));

    definirValor('fiscalTipoPrestador', tipoPrestador);
    definirValor('fiscalDocumentoPrestador', tipoPrestador === 'fisica' ? (metadados.cpf || metadados.documento_prestador || '') : (metadados.cnpj || metadados.documento_prestador || ''));
    definirValor('fiscalNomePrestador', metadados.nome_prestador);
    definirValor('fiscalNomeFantasia', metadados.nome_fantasia);
    definirValor('fiscalEmailPrestador', metadados.email_prestador);
    definirValor('fiscalTelefonePrestador', metadados.telefone_prestador);
    definirValor('fiscalCepPrestador', metadados.cep_prestador);
    definirValor('fiscalLogradouroPrestador', metadados.logradouro_prestador);
    definirValor('fiscalNumeroPrestador', metadados.numero_prestador);
    definirValor('fiscalComplementoPrestador', metadados.complemento_prestador);
    definirValor('fiscalBairroPrestador', metadados.bairro_prestador);
    definirValor('fiscalInscricaoMunicipal', metadados.inscricao_municipal);
    definirMarcado('fiscalInscricaoDispensada', metadados.inscricao_municipal_dispensada);
    definirMarcado('fiscalCadastroMunicipalConfirmado', metadados.cadastro_municipal_confirmado);
    definirValor('fiscalCodigoMunicipio', metadados.codigo_municipio);
    definirValor('fiscalMunicipioNome', metadados.municipio_nome);
    definirValor('fiscalUfPrestador', metadados.uf);
    definirValor('fiscalRegimeTributario', metadados.regime_tributario || (tipoPrestador === 'mei' ? 'mei' : (tipoPrestador === 'fisica' ? 'autonomo' : 'simples_nacional')));
    if ($('fiscalRegimeTributario')) $('fiscalRegimeTributario').dataset.automatico = 'nao';
    definirValor('fiscalRegimeApuracao', metadados.regime_apuracao || 'padrao');
    definirValor('fiscalRegimeEspecial', metadados.regime_especial);
    definirValor('fiscalBeneficioMunicipal', metadados.beneficio_municipal);
    definirValor('fiscalCodigoServico', metadados.codigo_servico);
    definirValor('fiscalCodigoServicoMunicipal', metadados.codigo_servico_municipal);
    definirValor('fiscalNbs', metadados.nbs);
    definirValor('fiscalAliquotaIss', metadados.aliquota_iss == null ? '' : String(metadados.aliquota_iss).replace('.', ','));
    definirValor('fiscalIssRetidoPadrao', metadados.iss_retido_padrao || 'nao');
    definirValor('fiscalCodigoMunicipioPrestacao', metadados.codigo_municipio_prestacao);
    definirValor('fiscalDescricaoServico', metadados.descricao_servico_padrao);
    definirValor('fiscalTributosModo', metadados.tributos_aproximados_modo || 'nao_informar');
    definirValor('fiscalTributosFederais', metadados.percentual_tributos_federais ?? '');
    definirValor('fiscalTributosEstaduais', metadados.percentual_tributos_estaduais ?? '');
    definirValor('fiscalTributosMunicipais', metadados.percentual_tributos_municipais ?? '');
    definirValor('fiscalRotaEmissao', metadados.rota_emissao || 'nfse_nacional');
    definirValor('fiscalProvedorNome', metadados.provedor_fiscal);
    definirValor('fiscalAmbiente', config.ambiente || 'homologacao');
    definirMarcado('fiscalAutoOs', config.emissao_automatica_os);
    definirMarcado('fiscalAutoVenda', config.emissao_automatica_venda);

    atualizarTipoPrestador();
    atualizarInscricaoMunicipal();
    atualizarRotaEmissao();
    $('statusFiscalEmpresa').textContent = config.status === 'configurada'
      ? `Emissão de NFS-e configurada em ${config.ambiente === 'producao' ? 'produção' : 'homologação'}.`
      : (config.ultimo_erro || 'Complete as quatro etapas e solicite a ativação fiscal.');

    const notas = Array.isArray(resumo.notas) ? resumo.notas : [];
    $('listaNotasFiscais').innerHTML = notas.length ? `<div class="fiscal-lista-documentos">${notas.slice(0, 8).map((nota) => {
      const danfseDisponivel = nota.status === 'autorizada' && Boolean(nota.danfse_storage_path || nota.danfse_url || nota.pdf_url);
      const acaoDanfse = danfseDisponivel
        ? `<button type="button" class="botao botao-secundario botao-pequeno" data-abrir-danfse="${escaparHtml(nota.id)}">Abrir DANFSe</button>`
        : (nota.status === 'autorizada' ? '<small class="campo-desc">DANFSe sendo preparado</small>' : '');
      const origem = String(nota.origem_tipo || '').toUpperCase();
      return `<div class="fiscal-documento-item">
        <span><strong>${escaparHtml(origem)} ${escaparHtml(nota.origem_id || '')}</strong><br><small>${Number(nota.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</small></span>
        <span class="fiscal-documento-status">${escaparHtml(rotuloStatus(nota.status))}${acaoDanfse}</span>
      </div>`;
    }).join('')}</div>` : '<p class="campo-desc">Nenhuma NFS-e solicitada.</p>';

    if (atualizacaoFiscalTimer) clearTimeout(atualizacaoFiscalTimer);
    if (notas.some((nota) => ['na_fila', 'processando'].includes(nota.status))) {
      atualizacaoFiscalTimer = setTimeout(() => carregar().catch(() => {}), 12000);
    }
    atualizarRevisao();
  }

  async function abrirDanfse(id, botao) {
    if (!id || botao?.disabled) return;
    const textoAnterior = botao?.textContent || 'Abrir DANFSe';
    if (botao) { botao.disabled = true; botao.textContent = 'Abrindo PDF…'; }
    try {
      const resposta = await window.api.fiscalabrirdanfse?.(id);
      if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível abrir o DANFSe.');
      window.toast?.('DANFSe aberto no leitor de PDF.', 'sucesso');
    } catch (erro) {
      window.toast?.(erro.message || String(erro), 'erro');
    } finally {
      if (botao) { botao.disabled = false; botao.textContent = textoAnterior; }
    }
  }

  function rotuloStatus(status) {
    return ({ rascunho: 'Rascunho', aguardando_configuracao: 'Aguardando ativação', na_fila: 'Na fila', processando: 'Processando', autorizada: 'Autorizada', rejeitada: 'Rejeitada', cancelada: 'Cancelada' })[status] || status || '—';
  }

  async function carregar() {
    garantirSecao();
    const secao = $('configFiscalEmpresa');
    if (!secao) return;
    const status = await window.api.supabasestatus?.();
    aplicarDisponibilidade(status?.fiscalHabilitado === true);
    secao.hidden = !status?.autenticado || !status?.empresaId || !fiscalHabilitado;
    if (secao.hidden) return;
    const resposta = await window.api.supabasefiscaldocumentos?.('resumo', {});
    if (!resposta?.sucesso) {
      $('statusFiscalEmpresa').textContent = resposta?.erro || 'Não foi possível consultar a situação da NFS-e.';
      return;
    }
    resumo = resposta;
    preencher();
  }

  function coletarConfiguracao() {
    const tipoPrestador = textoCampo('fiscalTipoPrestador');
    return {
      tipoPessoa: tipoPrestador === 'fisica' ? 'fisica' : 'juridica',
      tipoPrestador,
      documentoPrestador: textoCampo('fiscalDocumentoPrestador'),
      nomePrestador: textoCampo('fiscalNomePrestador'),
      nomeFantasia: textoCampo('fiscalNomeFantasia'),
      emailPrestador: textoCampo('fiscalEmailPrestador'),
      telefonePrestador: textoCampo('fiscalTelefonePrestador'),
      cepPrestador: textoCampo('fiscalCepPrestador'),
      logradouroPrestador: textoCampo('fiscalLogradouroPrestador'),
      numeroPrestador: textoCampo('fiscalNumeroPrestador'),
      complementoPrestador: textoCampo('fiscalComplementoPrestador'),
      bairroPrestador: textoCampo('fiscalBairroPrestador'),
      inscricaoMunicipal: textoCampo('fiscalInscricaoMunicipal'),
      inscricaoMunicipalDispensada: $('fiscalInscricaoDispensada')?.checked === true,
      cadastroMunicipalConfirmado: $('fiscalCadastroMunicipalConfirmado')?.checked === true,
      codigoMunicipio: textoCampo('fiscalCodigoMunicipio'),
      municipioNome: textoCampo('fiscalMunicipioNome'),
      uf: textoCampo('fiscalUfPrestador'),
      regimeTributario: textoCampo('fiscalRegimeTributario'),
      regimeApuracao: textoCampo('fiscalRegimeApuracao'),
      regimeEspecial: textoCampo('fiscalRegimeEspecial'),
      beneficioMunicipal: textoCampo('fiscalBeneficioMunicipal'),
      codigoServico: textoCampo('fiscalCodigoServico'),
      codigoServicoMunicipal: textoCampo('fiscalCodigoServicoMunicipal'),
      nbs: textoCampo('fiscalNbs'),
      aliquotaIss: textoCampo('fiscalAliquotaIss'),
      issRetidoPadrao: textoCampo('fiscalIssRetidoPadrao'),
      codigoMunicipioPrestacao: textoCampo('fiscalCodigoMunicipioPrestacao'),
      descricaoServicoPadrao: textoCampo('fiscalDescricaoServico'),
      tributosAproximadosModo: textoCampo('fiscalTributosModo'),
      percentualTributosFederais: textoCampo('fiscalTributosFederais'),
      percentualTributosEstaduais: textoCampo('fiscalTributosEstaduais'),
      percentualTributosMunicipais: textoCampo('fiscalTributosMunicipais'),
      rotaEmissao: textoCampo('fiscalRotaEmissao'),
      provedorFiscal: textoCampo('fiscalProvedorNome'),
      ambiente: textoCampo('fiscalAmbiente'),
      emissaoAutomaticaOs: $('fiscalAutoOs')?.checked === true,
      emissaoAutomaticaVenda: $('fiscalAutoVenda')?.checked === true
    };
  }

  async function salvar(opcoes = {}) {
    const botao = $('btnSalvarFiscal');
    if (botao) botao.disabled = true;
    try {
      const resposta = await window.api.supabasefiscaldocumentos('salvar_configuracao', coletarConfiguracao());
      if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível salvar a configuração fiscal.');
      if (!opcoes.silencioso) window.toast?.(resposta.mensagem || 'Configuração de NFS-e salva.', 'sucesso');
      if (resposta.configuracao) resumo = Object.assign({}, resumo || {}, { configuracao: resposta.configuracao });
      await carregar();
      return resposta;
    } catch (erro) {
      if (!opcoes.silencioso) window.toast?.(erro.message || String(erro), 'erro');
      return { sucesso: false, erro: erro.message || String(erro) };
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  async function solicitarAtivacaoFiscal() {
    const botao = $('btnSolicitarAtivacaoFiscal');
    if (!botao || botao.disabled) return;
    botao.disabled = true;
    const textoAnterior = botao.textContent;
    botao.textContent = 'Solicitando…';
    if ($('statusAtivacaoFiscal')) $('statusAtivacaoFiscal').textContent = 'Salvando os dados antes de abrir o chamado…';
    try {
      for (let etapa = 1; etapa <= 3; etapa += 1) {
        if (!validarEtapa(etapa)) {
          mostrarEtapa(etapa);
          throw new Error('Revise os campos obrigatórios antes de solicitar a ativação.');
        }
      }
      const salvo = await salvar({ silencioso: true });
      if (!salvo?.sucesso) throw new Error(salvo?.erro || 'Não foi possível salvar a configuração fiscal.');

      const dados = coletarConfiguracao();
      const mensagem = [
        'Solicito a ativação da emissão de NFS-e desta empresa.',
        `Perfil do prestador: ${rotuloTipoPrestador(dados.tipoPrestador)}.`,
        `Município IBGE: ${somenteDigitos(dados.codigoMunicipio, 7)}.`,
        `Regime: ${rotuloRegime(dados.regimeTributario)}.`,
        `Rota desejada: ${rotuloRota(dados.rotaEmissao)}.`,
        `Ambiente inicial: ${dados.ambiente === 'producao' ? 'produção' : 'homologação'}.`,
        'Os dados cadastrais foram salvos no módulo fiscal. Por segurança, este chamado não contém certificado, token nem senha. Favor orientar o canal seguro e o teste de homologação.'
      ].join('\n');
      const resposta = await window.api.supabasecriarchamadosuporte?.({
        origem: 'config_pc',
        assunto: 'Ativação fiscal — NFS-e e DANFSe',
        prioridade: 'normal',
        mensagem
      });
      if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível solicitar a ativação fiscal.');
      const protocolo = resposta.protocolo ? ` Protocolo ${resposta.protocolo}.` : '';
      if ($('statusAtivacaoFiscal')) $('statusAtivacaoFiscal').textContent = `Solicitação enviada ao suporte.${protocolo}`;
      window.SistemaOSChamados?.registrar?.(resposta);
      window.toast?.(`Ativação fiscal solicitada.${protocolo}`, 'sucesso');
    } catch (erro) {
      if ($('statusAtivacaoFiscal')) $('statusAtivacaoFiscal').textContent = erro.message || String(erro);
      window.toast?.(erro.message || String(erro), 'erro');
    } finally {
      botao.disabled = false;
      botao.textContent = textoAnterior;
    }
  }

  function valorDocumento(tipo, documento) {
    // NFS-e documenta servico. O valor do aparelho/produto vendido precisa de
    // NF-e/NFC-e e nunca deve ser enviado como se fosse mao de obra.
    if (tipo === 'venda') return Number(documento?.valorServico || documento?.valorMaoDeObra || 0);
    return Number(documento?.valorTotalServico || documento?.diagnosticoTecnico?.valorEstimado || documento?.valor || 0);
  }

  window.emitirNotaFiscalSistemaOS = async function (tipo, documento) {
    try {
      if (!fiscalHabilitado) throw new Error('A emissão de NFS-e ainda não está liberada para esta empresa.');
      if (tipo === 'os' && typeof documento === 'string') documento = await window.api.osobter(documento);
      if (!documento) throw new Error('Documento de origem não encontrado.');
      const origemId = String(tipo === 'venda' ? documento.id : documento.numero || documento.numeroOS || '').trim();
      let valor = valorDocumento(tipo, documento);
      if (!(valor > 0)) {
        const pergunta = tipo === 'venda'
          ? 'Informe somente o valor do serviço prestado nesta venda (não inclua o aparelho ou produto):'
          : 'Informe o valor da NFS-e:';
        const informado = await window.promptModal?.(pergunta, '', { titulo: 'Emitir NFS-e' });
        if (informado == null) return;
        valor = Number(String(informado).replace(',', '.'));
      }
      if (!(valor > 0)) throw new Error('Informe um valor válido para a NFS-e.');
      const cliente = documento.cliente || documento.comprador || {};
      const descricao = tipo === 'venda'
        ? `Serviço relacionado à venda ${[documento.marca, documento.modelo].filter(Boolean).join(' ')}`.trim()
        : `Serviço realizado na OS ${origemId}`;
      const resposta = await window.api.supabasefiscaldocumentos('solicitar_emissao', {
        origemTipo: tipo,
        origemId,
        valor,
        descricao,
        tomador: {
          nome: cliente.nome || cliente.razaoSocial || '',
          cpfCnpj: cliente.cpf || cliente.cnpj || cliente.cpfCnpj || '',
          email: cliente.email || '',
          telefone: cliente.telefone || '',
          cep: cliente.cep || '',
          logradouro: cliente.endereco || cliente.logradouro || '',
          numero: cliente.numero || '',
          complemento: cliente.complemento || '',
          bairro: cliente.bairro || '',
          municipio: cliente.cidade || cliente.municipio || '',
          uf: cliente.uf || ''
        }
      });
      if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível solicitar a NFS-e.');
      window.toast?.(resposta.mensagem || 'NFS-e preparada.', resposta.nota?.status === 'na_fila' ? 'sucesso' : 'aviso');
      setTimeout(() => carregar().catch(() => {}), 500);
      if (resposta.nota?.status === 'aguardando_configuracao') {
        $('btnConfig')?.click();
        setTimeout(() => {
          carregar().then(() => {
            mostrarEtapa(4);
            $('configFiscalEmpresa')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }, 250);
      }
    } catch (erro) {
      window.toast?.(erro.message || String(erro), 'erro');
    }
  };

  document.addEventListener('sistemaos:sessao-pronta', (evento) => {
    aplicarDisponibilidade(evento.detail?.fiscalHabilitado === true);
    if (evento.detail?.administradorGlobal) return;
    setTimeout(() => carregar().catch(() => {}), 2200);
  });
  $('btnConfig')?.addEventListener('click', () => setTimeout(() => carregar().catch(() => {}), 250));
})();
