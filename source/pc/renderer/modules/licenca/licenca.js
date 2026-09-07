// Fluxo da licença: leitura, ativação, remoção e listeners da tela.
(function iniciarModuloLicenca() {
  'use strict';

  if (window.RendererLicenca) return;

  const { porId: $ } = window.RendererDom;
  const { CHECK: ICONE_CHECK, X: ICONE_X, RELOGIO: ICONE_RELOGIO } = window.RendererIcons;
  let iniciado = false;

  const LABELS_TIPO_LICENCA = {
    trial: 'Trial (Avaliação)',
    basico: 'Básico',
    profissional: 'Profissional',
    vitalicio: 'Vitalício'
  };

  const LABELS_STATUS_LICENCA = {
    ativa:       { texto: 'Licença Ativa',       icone: ICONE_CHECK, cor: '#27ae60' },
    expirada:    { texto: 'Licença Expirada',    icone: ICONE_X, cor: '#e74c3c' },
    nao_ativada: { texto: 'Não Ativada (Trial)', icone: ICONE_RELOGIO, cor: '#f39c12' },
    bloqueada:   { texto: 'Licença Bloqueada',   icone: ICONE_X, cor: '#e74c3c' }
  };

  function formatarDataLicenca(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('pt-BR');
    } catch {
      return iso;
    }
  }

  async function abrirModalLicenca() {
    const modal = $('modalLicenca');
    if (!modal) return;
    modal.classList.remove('escondido');

    const erroEl = $('licenca-erro');
    if (erroEl) {
      erroEl.classList.add('escondido');
      erroEl.textContent = '';
    }

    try {
      const licenca = await window.api.licencaobter();
      renderizarDadosLicenca(licenca);
    } catch (erro) {
      console.error('Erro ao carregar licença:', erro);
    }
  }

  function renderizarDadosLicenca(licenca) {
    const status = licenca.status || 'nao_ativada';
    const info = LABELS_STATUS_LICENCA[status] || LABELS_STATUS_LICENCA.nao_ativada;

    const iconeEl = $('licenca-status-icone');
    const textoEl = $('licenca-status-texto');
    const detalheEl = $('licenca-status-detalhe');
    if (iconeEl) iconeEl.innerHTML = info.icone;
    if (textoEl) {
      textoEl.textContent = info.texto;
      textoEl.style.color = info.cor;
    }
    if (detalheEl) {
      detalheEl.textContent = licenca.titular
        ? `Titular: ${licenca.titular}`
        : status === 'nao_ativada' ? 'Insira sua chave de ativação abaixo.' : '';
    }

    const infoBloco = $('licenca-info-bloco');
    if (infoBloco) {
      if (status === 'ativa' || status === 'expirada') {
        infoBloco.classList.remove('escondido');
        const preencher = (id, valor) => {
          const elemento = $(id);
          if (elemento) elemento.textContent = valor || '—';
        };
        preencher('lic-titular', licenca.titular);
        preencher('lic-tipo', LABELS_TIPO_LICENCA[licenca.tipo] || licenca.tipo);
        preencher('lic-chave', licenca.chave);
        preencher('lic-data-ativacao', formatarDataLicenca(licenca.dataAtivacao));
        preencher('lic-data-expiracao', licenca.dataExpiracao ? formatarDataLicenca(licenca.dataExpiracao) : 'Sem expiração');
        preencher('lic-instalacao-id', licenca.instalacaoId);
      } else {
        infoBloco.classList.add('escondido');
        const instalacao = $('lic-instalacao-id');
        if (instalacao) instalacao.textContent = licenca.instalacaoId || '—';
      }
    }

    const formBloco = $('licenca-form-bloco');
    const btnResetar = $('btnResetarLicenca');
    const btnAtivar = $('btnAtivarLicenca');
    if (status === 'ativa') {
      if (formBloco) formBloco.style.display = 'none';
      if (btnAtivar) btnAtivar.style.display = 'none';
      if (btnResetar) btnResetar.classList.remove('escondido');
    } else {
      if (formBloco) formBloco.style.display = '';
      if (btnAtivar) btnAtivar.style.display = '';
      if (btnResetar) btnResetar.classList.add('escondido');
    }
  }

  async function ativarLicenca() {
    const chave = $('lic-input-chave')?.value?.trim();
    const tipo = $('lic-input-tipo')?.value;
    const titular = $('lic-input-titular')?.value?.trim();
    const cnpjCpf = $('lic-input-cnpj')?.value?.trim();
    const expiracao = $('lic-input-expiracao')?.value;
    const erroEl = $('licenca-erro');
    if (erroEl) {
      erroEl.classList.add('escondido');
      erroEl.textContent = '';
    }

    if (!chave) {
      if (erroEl) {
        erroEl.textContent = 'Informe a chave de ativação.';
        erroEl.classList.remove('escondido');
      }
      return;
    }

    const btnAtivar = $('btnAtivarLicenca');
    if (btnAtivar) {
      btnAtivar.disabled = true;
      btnAtivar.innerHTML = `${ICONE_RELOGIO} Ativando...`;
    }

    try {
      const resultado = await window.api.licencaativar({
        chave,
        tipo,
        titular: titular || null,
        cnpjCpf: cnpjCpf || null,
        dataExpiracao: expiracao ? new Date(expiracao).toISOString() : null
      });
      if (resultado.sucesso) {
        renderizarDadosLicenca(resultado.licenca);
        if (typeof window.toast === 'function') window.toast('Licença ativada com sucesso!', 'sucesso');
      } else if (erroEl) {
        erroEl.textContent = resultado.erro || 'Erro ao ativar licença.';
        erroEl.classList.remove('escondido');
      }
    } catch (erro) {
      if (erroEl) {
        erroEl.textContent = 'Erro inesperado: ' + erro.message;
        erroEl.classList.remove('escondido');
      }
    } finally {
      if (btnAtivar) {
        btnAtivar.disabled = false;
        btnAtivar.textContent = ' Ativar Licença';
      }
    }
  }

  async function resetarLicenca() {
    const confirmado = confirm('Remover ativação da licença?\n\nOs dados do sistema NÃO serão apagados.');
    if (!confirmado) return;
    try {
      const licenca = await window.api.licencaresetar();
      renderizarDadosLicenca(licenca);
      if (typeof window.toast === 'function') window.toast('Ativação removida.', 'info');
    } catch (erro) {
      alert('Erro ao remover ativação: ' + erro.message);
    }
  }

  function formatarChaveEnquantoDigita(evento) {
    let valor = evento.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const partes = [];
    for (let indice = 0; indice < valor.length && indice < 16; indice += 4) {
      partes.push(valor.slice(indice, indice + 4));
    }
    evento.target.value = partes.join('-');
  }

  function escutar(id, evento, funcao) {
    const elemento = $(id);
    if (elemento) elemento.addEventListener(evento, funcao);
  }

  function init() {
    if (iniciado) return;
    iniciado = true;
    escutar('btnLicenca', 'click', abrirModalLicenca);
    escutar('btnAtivarLicenca', 'click', ativarLicenca);
    escutar('btnResetarLicenca', 'click', resetarLicenca);
    escutar('lic-input-chave', 'input', formatarChaveEnquantoDigita);
  }

  window.RendererLicenca = Object.freeze({ init, abrirModalLicenca });
  window.abrirModalLicenca = abrirModalLicenca;
  init();
})();
