(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let resumo = null;
  let planoEscolhido = null;
  let quantidadeMeses = 1;
  let sessaoEhSuporteGlobal = false;
  let monitorPagamento = null;
  let usuarioBloqueadoTrial = null;
  const CHAVE_LEMBRETES_LOCAIS = 'sistemaos_lembretes_assinatura_v1';

  function moeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function escaparHtml(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, (caractere) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[caractere]);
  }

  function dataBr(valor) {
    if (!valor) return 'sem vencimento definido';
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? 'sem vencimento definido' : data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  function diasRestantes(valor) {
    if (!valor) return null;
    return Math.ceil((new Date(valor).getTime() - Date.now()) / 86400000);
  }

  function garantirEstrutura() {
    if ($('modalAssinaturaSaaS')) return;
    const estilo = document.createElement('style');
    estilo.textContent = `
      .assinatura-aviso{margin:12px 28px 0;padding:13px 16px;border:1px solid #f59e0b;border-radius:12px;background:color-mix(in srgb,#f59e0b 14%,var(--bg-card));display:flex;align-items:center;justify-content:space-between;gap:14px;color:var(--texto)}
      .assinatura-aviso[hidden]{display:none}.assinatura-aviso strong{display:block}.assinatura-aviso span{font-size:13px;color:var(--texto-sec)}
      .assinatura-planos{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:14px}.assinatura-plano{border:1.5px solid var(--borda);border-radius:12px;background:var(--bg-card);padding:15px;text-align:left;color:var(--texto);cursor:pointer}.assinatura-plano:hover,.assinatura-plano.selecionado{border-color:var(--cor-principal);box-shadow:0 0 0 2px color-mix(in srgb,var(--cor-principal) 22%,transparent)}
      .assinatura-plano h3{margin:0 0 6px}.assinatura-plano .preco{font-size:21px;font-weight:800;color:var(--cor-principal)}.assinatura-plano ul{padding-left:18px;margin:10px 0 0;color:var(--texto-sec);font-size:12px}.assinatura-plano .tipo{font-size:11px;font-weight:700;text-transform:uppercase;color:var(--texto-sec)}
      .assinatura-resumo{padding:13px;border:1px solid var(--borda);border-radius:10px;background:var(--bg);display:grid;gap:4px}.assinatura-pagamento-status{min-height:22px;font-size:13px;color:var(--texto-sec)}
      .trial-encerrado-fundo{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--texto)}
      .trial-encerrado-fundo[hidden]{display:none}.trial-encerrado-card{width:min(560px,100%);border:1px solid var(--borda);border-radius:16px;background:var(--bg-card);padding:34px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
      .trial-encerrado-marca{width:54px;height:54px;border-radius:14px;display:grid;place-items:center;background:var(--texto);color:var(--bg);font-weight:900;letter-spacing:-2px;font-size:21px}
      .trial-encerrado-card h1{margin:22px 0 8px;font-size:30px;letter-spacing:-.035em}.trial-encerrado-card>p{margin:0;color:var(--texto-sec);line-height:1.6}
      .trial-encerrado-identidade{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:22px 0}.trial-encerrado-identidade div{padding:13px;border:1px solid var(--borda);border-radius:10px;background:var(--bg)}
      .trial-encerrado-identidade span,.trial-encerrado-identidade strong{display:block}.trial-encerrado-identidade span{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--texto-sec);margin-bottom:4px}
      .trial-encerrado-acoes{display:flex;gap:10px}.trial-encerrado-acoes .botao{flex:1}.trial-encerrado-seguranca{display:block;margin-top:16px;color:var(--texto-sec);line-height:1.45}
      @media(max-width:600px){.trial-encerrado-card{padding:24px}.trial-encerrado-identidade{grid-template-columns:1fr}.trial-encerrado-acoes{flex-direction:column}}
    `;
    document.head.appendChild(estilo);

    const aviso = document.createElement('div');
    aviso.id = 'avisoAssinaturaSaaS';
    aviso.className = 'assinatura-aviso';
    aviso.hidden = true;
    aviso.innerHTML = '<div><strong id="avisoAssinaturaTitulo">Sua assinatura vence em breve</strong><span id="avisoAssinaturaTexto"></span></div><button type="button" id="btnAvisoAssinatura" class="botao botao-primario botao-pequeno">Renovar agora</button>';
    document.querySelector('main.conteudo')?.before(aviso);

    const modal = document.createElement('div');
    modal.id = 'modalAssinaturaSaaS';
    modal.className = 'modal-fundo escondido';
    modal.innerHTML = `<div class="modal-caixa modal-grande" style="max-width:980px">
      <div class="modal-cabecalho"><div><h2>Minha assinatura</h2><p class="campo-desc">Renove, mude de plano ou fale com o suporte.</p></div><button type="button" class="botao-fechar" data-fechar-assinatura>×</button></div>
      <div style="padding:18px 22px;max-height:70vh;overflow:auto">
        <div id="resumoAssinaturaAtual" class="assinatura-resumo"></div>
        <div style="margin-top:18px"><strong>Continuar com o mesmo plano ou escolher outro?</strong><p class="campo-desc">A renovação soma os novos dias ao período que você ainda tem.</p></div>
        <div id="listaPlanosAssinatura" class="assinatura-planos"></div>
        <div class="campo" id="campoMesesAssinatura" style="margin-top:16px;max-width:280px" hidden><label for="quantidadeMesesAssinatura">Período que deseja pagar</label><select id="quantidadeMesesAssinatura"><option value="1">1 mês</option><option value="2">2 meses</option><option value="3">3 meses</option><option value="6">6 meses</option><option value="12">12 meses</option></select><p class="campo-desc">Os meses são somados ao prazo restante após a confirmação.</p></div>
        <div id="statusPagamentoAssinatura" class="assinatura-pagamento-status" role="status" aria-live="polite"></div>
      </div>
      <div class="modal-rodape"><button type="button" id="btnSuporteAssinatura" class="botao botao-fantasma">Dúvidas / suporte</button><button type="button" class="botao botao-fantasma" data-fechar-assinatura>Agora não</button><button type="button" id="btnPagarAssinatura" class="botao botao-primario" disabled>Pagar agora</button></div>
    </div>`;
    document.body.appendChild(modal);

    const bloqueioTrial = document.createElement('div');
    bloqueioTrial.id = 'bloqueioTrialEncerrado';
    bloqueioTrial.className = 'trial-encerrado-fundo';
    bloqueioTrial.hidden = true;
    bloqueioTrial.innerHTML = `<section class="trial-encerrado-card" role="dialog" aria-modal="true" aria-labelledby="trialEncerradoTitulo">
      <div class="trial-encerrado-marca" aria-hidden="true">OS</div>
      <h1 id="trialEncerradoTitulo">Seu período de teste chegou ao fim</h1>
      <p>O acesso às funções do Sistema OS foi bloqueado ao completar 45 dias. Para obter uma assinatura e continuar usando o sistema, entre em contato com um administrador.</p>
      <div class="trial-encerrado-identidade">
        <div><span>Empresa</span><strong id="trialEncerradoEmpresa">—</strong></div>
        <div><span>Usuário</span><strong id="trialEncerradoUsuario">—</strong></div>
      </div>
      <div class="trial-encerrado-acoes">
        <button type="button" id="btnSuporteTrialEncerrado" class="botao botao-primario">Falar com o suporte</button>
        <button type="button" id="btnTrocarContaTrialEncerrado" class="botao botao-fantasma">Trocar usuário</button>
      </div>
      <small class="trial-encerrado-seguranca">O chamado fica salvo na nuvem e vinculado ao seu usuário autenticado para você acompanhar a resposta.</small>
    </section>`;
    document.body.appendChild(bloqueioTrial);

    aviso.querySelector('#btnAvisoAssinatura').addEventListener('click', abrir);
    modal.querySelectorAll('[data-fechar-assinatura]').forEach((botao) => botao.addEventListener('click', fechar));
    modal.addEventListener('click', (evento) => { if (evento.target === modal) fechar(); });
    $('btnPagarAssinatura').addEventListener('click', pagar);
    $('quantidadeMesesAssinatura').addEventListener('change', (evento) => {
      quantidadeMeses = Math.max(1, Math.min(12, Number(evento.target.value) || 1));
      desenhar();
    });
    $('btnSuporteAssinatura').addEventListener('click', () => {
      fechar();
      const botao = $('btnAbrirChamadoConfig');
      if (botao) botao.click();
      else window.toast?.('Abra Configurações e escolha “Abrir chamado”.', 'info');
    });
    $('btnSuporteTrialEncerrado').addEventListener('click', async () => {
      const usuario = usuarioBloqueadoTrial || {};
      await window.SistemaOSChamados?.abrirNovo?.({
        origem: 'config_pc',
        empresa: '',
        usuario: usuario.usuario || '',
        nome: usuario.nome || usuario.usuario || '',
        motivo: 'trial_assinatura',
        assunto: 'Contratar assinatura após o período de teste',
        mensagem: 'Meu período de teste de 45 dias terminou e desejo contratar uma assinatura do Sistema OS.'
      });
    });
    $('btnTrocarContaTrialEncerrado').addEventListener('click', () => {
      $('bloqueioTrialEncerrado').hidden = true;
      usuarioBloqueadoTrial = null;
      $('btnSair')?.click();
    });

    const configRef = $('integracaoMercadoPagoEmpresa');
    if (configRef && !$('atalhoMinhaAssinatura')) {
      const secao = document.createElement('div');
      secao.id = 'atalhoMinhaAssinatura';
      secao.className = 'config-secao';
      secao.innerHTML = '<div class="config-secao-titulo">Assinatura do Sistema OS</div><p class="campo-desc">Veja o vencimento, compare os planos e renove sem perder os dias restantes.</p><button type="button" id="btnMinhaAssinaturaConfig" class="botao botao-primario">Ver minha assinatura</button>';
      configRef.before(secao);
      $('btnMinhaAssinaturaConfig').addEventListener('click', abrir);
    }
  }

  function planoAtual() {
    const id = resumo?.empresa?.plano_id;
    return (resumo?.planos || []).find((plano) => plano.id === id) || null;
  }

  function recursosPlano(plano) {
    return (plano.plano_recursos || []).filter((item) => item.habilitado !== false)
      .map((item) => Array.isArray(item.recurso) ? item.recurso[0] : item.recurso)
      .filter(Boolean).slice(0, 6);
  }

  function desenhar() {
    const empresa = resumo?.empresa;
    if (!empresa) return;
    const atual = planoAtual();
    const dias = diasRestantes(empresa.data_vencimento);
    $('resumoAssinaturaAtual').innerHTML = `<strong>Plano atual: ${escaparHtml(atual?.nome || empresa.plano?.nome || 'Não definido')}</strong><span>Vencimento: ${escaparHtml(dataBr(empresa.data_vencimento))}</span><span>Situação: ${dias == null ? 'consulte o suporte' : dias < 0 ? 'vencida' : dias === 0 ? 'vence hoje' : `${dias} dia(s) restante(s)`}</span>${planoEscolhido ? `<span>Total selecionado: <strong>${escaparHtml(moeda(Number(planoEscolhido.preco_referencia) * quantidadeMeses))}</strong> por ${quantidadeMeses} mês(es)</span>` : ''}`;
    $('campoMesesAssinatura').hidden = !planoEscolhido;
    const lista = $('listaPlanosAssinatura');
    lista.innerHTML = '';
    (resumo.planos || []).filter((plano) => Number(plano.preco_referencia) > 0).forEach((plano) => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'assinatura-plano' + (planoEscolhido?.id === plano.id ? ' selecionado' : '');
      const diferenca = Number(plano.preco_referencia) - Number(atual?.preco_referencia || 0);
      const tipo = plano.id === atual?.id ? 'Continuar neste plano' : diferenca > 0 ? 'Melhorar plano' : 'Plano mais econômico';
      botao.innerHTML = `<span class="tipo">${escaparHtml(tipo)}</span><h3>${escaparHtml(plano.nome)}</h3><div class="preco">${escaparHtml(moeda(plano.preco_referencia))}</div><small>${escaparHtml(plano.duracao_dias)} dias</small><p>${escaparHtml(plano.descricao || '')}</p><ul>${recursosPlano(plano).map((recurso) => `<li>${escaparHtml(recurso.nome || recurso.chave || '')}</li>`).join('')}</ul>`;
      botao.addEventListener('click', () => { planoEscolhido = plano; desenhar(); $('btnPagarAssinatura').disabled = false; });
      lista.appendChild(botao);
    });
  }

  function atualizarAviso() {
    const aviso = $('avisoAssinaturaSaaS');
    const empresa = resumo?.empresa;
    if (!aviso || !empresa) return;
    const dias = diasRestantes(empresa.data_vencimento);
    aviso.hidden = dias == null || dias > 7;
    if (aviso.hidden) return;
    $('avisoAssinaturaTitulo').textContent = dias < 0 ? 'Sua assinatura venceu' : dias === 0 ? 'Sua assinatura vence hoje' : `Sua assinatura vence em ${dias} dia(s)`;
    $('avisoAssinaturaTexto').textContent = ` Vencimento: ${dataBr(empresa.data_vencimento)}. Renove o plano atual ou escolha outro.`;
  }

  function registrarNotificacaoUnica(chave, titulo, descricao) {
    if (typeof window.adicionarNotificacao !== 'function') return;
    let registradas = [];
    try { registradas = JSON.parse(localStorage.getItem(CHAVE_LEMBRETES_LOCAIS) || '[]'); } catch { registradas = []; }
    if (registradas.includes(chave)) return;
    window.adicionarNotificacao({ tipo: 'cobranca', titulo, descricao, acao: 'abrir_assinatura' });
    registradas.unshift(chave);
    try { localStorage.setItem(CHAVE_LEMBRETES_LOCAIS, JSON.stringify(registradas.slice(0, 100))); } catch {}
  }

  function sincronizarNotificacoesAssinatura() {
    const empresa = resumo?.empresa;
    if (!empresa) return;
    (resumo.alertas || []).filter((alerta) => !alerta.lido_em).forEach((alerta) => {
      registrarNotificacaoUnica(
        `nuvem:${alerta.id}`,
        alerta.titulo || 'Assinatura do Sistema OS',
        alerta.mensagem || 'Há uma atualização importante sobre sua assinatura.'
      );
    });
    const dias = diasRestantes(empresa.data_vencimento);
    if (dias == null || dias > 7) return;
    const faixa = dias < 0 ? 'vencida' : dias === 0 ? 'hoje' : dias <= 1 ? '1-dia' : dias <= 3 ? '3-dias' : '7-dias';
    const titulo = dias < 0 ? 'Sua assinatura venceu' : dias === 0 ? 'Sua assinatura vence hoje' : `Sua assinatura vence em ${dias} dia(s)`;
    registrarNotificacaoUnica(
      `local:${empresa.id}:${empresa.data_vencimento}:${faixa}`,
      titulo,
      `Vencimento em ${dataBr(empresa.data_vencimento)}. Abra Minha assinatura para renovar ou alterar o plano.`
    );
  }

  async function carregar() {
    garantirEstrutura();
    const resposta = await window.api.supabaseassinaturassaas?.('resumo', {});
    if (resposta?.sucesso && resposta.empresa) {
      resumo = resposta;
      atualizarAviso();
      sincronizarNotificacoesAssinatura();
      return resposta;
    }
    // A sessão autenticada já traz plano, vencimento e situação. Usa
    // esses dados como contingência quando a Edge Function oscilar, sem
    // inventar valores e sem apagar o último catálogo carregado.
    if (!resumo?.empresa) {
      const status = await window.api.supabasestatus?.();
      if (status?.autenticado && status?.empresaId) {
        resumo = {
          empresa: {
            id: status.empresaId,
            nome_fantasia: status.empresaNome || '',
            plano_id: null,
            plano: { nome: status.planoNome || 'Plano atual' },
            licenca_status: status.licencaStatus || '',
            data_vencimento: status.dataVencimento || null
          },
          planos: [], cobrancas: [], alertas: [], contingencia: true
        };
      }
    }
    if (!resumo?.empresa) return null;
    atualizarAviso();
    sincronizarNotificacoesAssinatura();
    return resumo;
  }

  async function abrir() {
    garantirEstrutura();
    quantidadeMeses = 1;
    if ($('quantidadeMesesAssinatura')) $('quantidadeMesesAssinatura').value = '1';
    $('statusPagamentoAssinatura').textContent = 'Carregando sua assinatura…';
    $('modalAssinaturaSaaS').classList.remove('escondido');
    const resposta = await carregar();
    if (!resposta) {
      $('statusPagamentoAssinatura').textContent = 'Não foi possível consultar agora. Tente novamente.';
      return;
    }
    planoEscolhido = planoAtual();
    $('btnPagarAssinatura').disabled = !planoEscolhido || Number(planoEscolhido.preco_referencia) <= 0;
    $('statusPagamentoAssinatura').textContent = '';
    desenhar();
  }

  function fechar() {
    $('modalAssinaturaSaaS')?.classList.add('escondido');
    if (monitorPagamento) clearInterval(monitorPagamento);
    monitorPagamento = null;
  }

  function abrirBloqueioTrial(usuario) {
    garantirEstrutura();
    usuarioBloqueadoTrial = Object.assign({}, usuario || {});
    $('trialEncerradoEmpresa').textContent = usuarioBloqueadoTrial.empresaNome || 'Empresa vinculada';
    $('trialEncerradoUsuario').textContent = usuarioBloqueadoTrial.usuario || usuarioBloqueadoTrial.nome || 'Usuário autenticado';
    $('bloqueioTrialEncerrado').hidden = false;
  }

  async function pagar() {
    if (!planoEscolhido) return;
    const botao = $('btnPagarAssinatura');
    botao.disabled = true;
    $('statusPagamentoAssinatura').textContent = 'Preparando seu pagamento…';
    const atual = planoAtual();
    const tipoAlteracao = planoEscolhido.id === atual?.id ? 'renovacao'
      : Number(planoEscolhido.preco_referencia) < Number(atual?.preco_referencia || 0) ? 'downgrade' : 'upgrade';
    const resposta = await window.api.supabaseassinaturassaas('criar_checkout', { planoId: planoEscolhido.id, tipoAlteracao, quantidadeMeses });
    if (!resposta?.sucesso || !resposta.link) {
      $('statusPagamentoAssinatura').textContent = resposta?.erro || 'Não foi possível preparar o pagamento.';
      botao.disabled = false;
      return;
    }
    const abertura = await window.api.sistemaabrirlinkseguro(resposta.link);
    if (!abertura?.sucesso) {
      $('statusPagamentoAssinatura').textContent = abertura?.erro || 'Não foi possível abrir o pagamento.';
      botao.disabled = false;
      return;
    }
    $('statusPagamentoAssinatura').textContent = 'Pagamento aberto no navegador. A liberação será automática após a confirmação.';
    let tentativas = 0;
    if (monitorPagamento) clearInterval(monitorPagamento);
    monitorPagamento = setInterval(async () => {
      tentativas += 1;
      try {
        const atualizado = await carregar();
        const cobranca = atualizado?.cobrancas?.find((item) => item.id === resposta.cobranca?.id);
        if (cobranca?.aplicado_em) {
          clearInterval(monitorPagamento); monitorPagamento = null;
          $('statusPagamentoAssinatura').textContent = 'Pagamento confirmado. Seu plano já está ativo!';
          desenhar(); atualizarAviso();
          return;
        }
      } catch (_) {
        // Uma oscilação de rede não deve interromper a confirmação automática.
      }
      if (tentativas >= 20) {
        clearInterval(monitorPagamento); monitorPagamento = null;
        $('statusPagamentoAssinatura').textContent = 'Quando o pagamento for confirmado, os dias serão liberados automaticamente.';
        botao.disabled = false;
      }
    }, 15000);
  }

  async function abrirPorAssistente() { await abrir(); }
  function obterResumoParaAssistente() {
    const empresa = resumo?.empresa;
    const atual = planoAtual();
    if (!empresa) return null;
    return {
      plano: atual?.nome || empresa.plano?.nome || 'Não definido',
      vencimento: dataBr(empresa.data_vencimento),
      diasRestantes: diasRestantes(empresa.data_vencimento),
      status: empresa.licenca_status,
      planos: (resumo.planos || []).filter((p) => Number(p.preco_referencia) > 0).map((p) => ({ id: p.id, nome: p.nome, preco: moeda(p.preco_referencia), dias: p.duracao_dias }))
    };
  }

  window.SistemaOSAssinaturasUI = { abrir: abrirPorAssistente, abrirBloqueioTrial, carregar, obterResumoParaAssistente };
  document.addEventListener('sistemaos:sessao-pronta', (evento) => {
    sessaoEhSuporteGlobal = evento.detail?.administradorGlobal === true;
    if (evento.detail?.acessoSomenteCobranca !== true && $('bloqueioTrialEncerrado')) {
      $('bloqueioTrialEncerrado').hidden = true;
      usuarioBloqueadoTrial = null;
    }
    if (sessaoEhSuporteGlobal) return;
    setTimeout(() => carregar().catch(() => {}), 1500);
  });
  setTimeout(() => {
    if ($('telaLogin')?.classList.contains('escondido') && !sessaoEhSuporteGlobal) carregar().catch(() => {});
  }, 2500);
})();
