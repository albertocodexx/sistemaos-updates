(function () {
  'use strict';

  var resumoAtual = null;
  var bloqueioAtivo = false;
  var contextoBloqueio = null;
  var verificacao = null;

  function escapar(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function moeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function data(valor) {
    if (!valor) return 'não informada';
    var instante = new Date(valor);
    return Number.isNaN(instante.getTime()) ? 'não informada' : instante.toLocaleDateString('pt-BR');
  }

  function toast(mensagem, erro) {
    if (window.SistemaOSToast && window.SistemaOSToast.mostrar) {
      window.SistemaOSToast.mostrar(mensagem, { ehErro: !!erro, duracaoMs: erro ? 6000 : 4000 });
    }
  }

  async function chamar(acao, dados) {
    var cliente = window.SupabaseClientApp.obterCliente();
    var resposta = await cliente.functions.invoke('assinaturas-saas', { body: { acao: acao, dados: dados || {} } });
    if (resposta.error && window.SistemaOSEdgeError) {
      await window.SistemaOSEdgeError.lancar(resposta.error, 'Não foi possível consultar a assinatura.');
    }
    if (resposta.error) throw resposta.error;
    if (resposta.data && resposta.data.erro) throw new Error(resposta.data.erro);
    return resposta.data || {};
  }

  function recursos(plano) {
    var itens = Array.isArray(plano.plano_recursos) ? plano.plano_recursos : [];
    return itens.filter(function (item) { return item && item.habilitado !== false && item.recurso; })
      .slice(0, 7).map(function (item) {
        var limite = item.limite == null ? '' : ' — até ' + item.limite;
        return '<li>✓ ' + escapar(item.recurso.nome || item.recurso.chave) + escapar(limite) + '</li>';
      }).join('');
  }

  function planoAtualId() {
    return resumoAtual && resumoAtual.empresa ? resumoAtual.empresa.plano_id : '';
  }

  function renderizar() {
    var conteudo = document.getElementById('assinatura-mobile-conteudo');
    if (!conteudo || !resumoAtual) return;
    var empresa = resumoAtual.empresa || {};
    var atualId = planoAtualId();
    var planos = Array.isArray(resumoAtual.planos) ? resumoAtual.planos : [];
    var planosPagos = planos.filter(function (plano) { return Number(plano.preco_referencia) > 0; });
    var planoAtual = planos.find(function (plano) { return plano.id === atualId; });
    var trialEncerrado = String((planoAtual && planoAtual.nome) || (empresa.plano && empresa.plano.nome) || (contextoBloqueio && contextoBloqueio.plano_nome) || '').toLowerCase() === 'trial';
    if (bloqueioAtivo && trialEncerrado) {
      conteudo.innerHTML = '<div class="assinatura-mobile-resumo"><span>Plano</span><strong>Trial completo — 45 dias</strong><small>Encerrado em ' + escapar(data(empresa.fim_trial || empresa.data_vencimento || (contextoBloqueio && contextoBloqueio.fim_trial))) + '</small></div>' +
        '<div class="assinatura-mobile-aviso">Para obter uma assinatura e continuar usando todas as funções, envie um chamado ao administrador pelo botão abaixo.</div>';
      return;
    }
    var cobranca = (resumoAtual.cobrancas || []).find(function (item) {
      return ['pendente', 'em_processamento'].indexOf(String(item.status)) !== -1;
    });
    conteudo.innerHTML =
      '<div class="assinatura-mobile-resumo">' +
        '<span>Plano atual</span><strong>' + escapar((planoAtual && planoAtual.nome) || (empresa.plano && empresa.plano.nome) || 'Sem plano') + '</strong>' +
        '<small>Vencimento: ' + escapar(data(empresa.data_vencimento || empresa.fim_trial)) + '</small>' +
      '</div>' +
      (cobranca ? '<div class="assinatura-mobile-aviso">Pagamento aguardando confirmação. Se você já pagou, esta tela será liberada automaticamente.</div>' : '') +
      '<div class="assinatura-mobile-planos">' + planosPagos.map(function (plano) {
        var atual = plano.id === atualId;
        var periodo = Number(plano.duracao_dias || 30) + ' dias';
        return '<article class="assinatura-mobile-plano' + (plano.destaque ? ' destaque' : '') + '">' +
          '<div><h3>' + escapar(plano.nome) + (atual ? ' <span>Atual</span>' : '') + '</h3>' +
          '<p>' + escapar(plano.descricao || '') + '</p></div>' +
          '<strong class="assinatura-mobile-preco">' + moeda(plano.preco_referencia) + '<small> / ' + escapar(periodo) + '</small></strong>' +
          '<ul>' + recursos(plano) + '</ul>' +
          '<button type="button" class="btn-primario" data-assinar-plano="' + escapar(plano.id) + '">' +
            (atual ? 'Renovar este plano' : 'Escolher este plano') + '</button>' +
        '</article>';
      }).join('') + '</div>';

    conteudo.querySelectorAll('[data-assinar-plano]').forEach(function (botao) {
      botao.addEventListener('click', function () { iniciarPagamento(botao.dataset.assinarPlano, botao); });
    });
  }

  async function carregar(silencioso) {
    try {
      resumoAtual = await chamar('resumo');
      renderizar();
      return resumoAtual;
    } catch (erro) {
      if (!silencioso) toast(erro.message || 'Não foi possível consultar a assinatura.', true);
      throw erro;
    }
  }

  async function abrirLinkSeguro(url) {
    if (!/^https:\/\/(?:[a-z0-9-]+\.)*(?:mercadopago\.com(?:\.br)?|mercadolivre\.com(?:\.br)?|mercadolibre\.com(?:\.br)?)(?:\/|$)/i.test(String(url || ''))) {
      throw new Error('O link de pagamento não é válido.');
    }
    var navegador = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (navegador && navegador.open) return navegador.open({ url: url });
    var janela = window.open(url, '_blank', 'noopener,noreferrer');
    if (!janela) throw new Error('Permita a abertura do navegador para continuar.');
  }

  async function iniciarPagamento(planoId, botao) {
    var plano = (resumoAtual.planos || []).find(function (item) { return item.id === planoId; });
    if (!plano) return;
    if (!window.confirm('Continuar com o plano ' + plano.nome + ' por ' + moeda(plano.preco_referencia) + '?')) return;
    var textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = 'Preparando pagamento…';
    try {
      var atualId = planoAtualId();
      var precoAtual = Number(((resumoAtual.planos || []).find(function (p) { return p.id === atualId; }) || {}).preco_referencia || 0);
      var tipo = planoId === atualId ? 'renovacao'
        : atualId && Number(plano.preco_referencia) < precoAtual ? 'downgrade' : 'upgrade';
      var resultado = await chamar('criar_checkout', { planoId: planoId, tipoAlteracao: tipo });
      await abrirLinkSeguro(resultado.link);
      toast('Pagamento aberto no navegador. A confirmação será automática.');
      acompanharPagamento(resultado.cobranca && resultado.cobranca.id);
    } catch (erro) {
      toast(erro.message || 'Não foi possível abrir o pagamento.', true);
    } finally {
      botao.disabled = false;
      botao.textContent = textoOriginal;
    }
  }

  function acompanharPagamento(cobrancaId) {
    clearInterval(verificacao);
    var tentativas = 0;
    verificacao = setInterval(async function () {
      tentativas += 1;
      try {
        await carregar(true);
        var cobrancas = resumoAtual.cobrancas || [];
        var cobranca = cobrancaId
          ? cobrancas.find(function (item) { return item.id === cobrancaId; })
          : cobrancas.find(function (item) { return ['pendente', 'em_processamento', 'aprovada'].indexOf(String(item.status)) !== -1; });
        if (cobranca && cobranca.status === 'aprovada' && cobranca.aplicado_em) {
          clearInterval(verificacao);
          toast('Pagamento confirmado. Assinatura liberada!');
          await window.SistemaOSSessao.revalidar();
        }
      } catch (_) {}
      if (tentativas >= 30) clearInterval(verificacao);
    }, 12000);
  }

  function abrir(forcar, estado) {
    var modal = document.getElementById('assinatura-mobile-modal');
    if (!modal) return;
    bloqueioAtivo = !!forcar;
    contextoBloqueio = estado && estado.contexto ? estado.contexto : contextoBloqueio;
    var trialEncerrado = bloqueioAtivo && String(contextoBloqueio && contextoBloqueio.plano_nome || '').toLowerCase() === 'trial';
    modal.hidden = false;
    modal.classList.toggle('bloqueada', bloqueioAtivo);
    document.body.classList.add('assinatura-mobile-aberta');
    document.getElementById('btn-fechar-assinatura-mobile').hidden = bloqueioAtivo;
    document.getElementById('assinatura-mobile-titulo').textContent = trialEncerrado ? 'Seu período de teste chegou ao fim' : 'Minha assinatura';
    document.getElementById('assinatura-mobile-bloqueio').textContent = trialEncerrado
      ? 'O acesso foi bloqueado ao completar 45 dias. Fale com o suporte para contratar uma assinatura.'
      : 'Sua assinatura venceu. Faça a renovação para liberar o sistema.';
    document.getElementById('assinatura-mobile-bloqueio').hidden = !bloqueioAtivo;
    carregar(false).catch(function () {});
  }

  function fechar() {
    if (bloqueioAtivo) return;
    var modal = document.getElementById('assinatura-mobile-modal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('assinatura-mobile-aberta');
  }

  function montar() {
    if (document.getElementById('assinatura-mobile-modal')) return;
    var estilo = document.createElement('style');
    estilo.textContent = '.assinatura-mobile-aberta{overflow:hidden}.assinatura-mobile-modal{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.86);padding:12px;display:flex;align-items:flex-end}.assinatura-mobile-modal[hidden]{display:none}.assinatura-mobile-caixa{width:100%;max-height:94vh;overflow:auto;border:1px solid var(--cor-borda-forte);border-radius:9px;background:var(--cor-card);color:var(--cor-texto);padding:18px}.assinatura-mobile-topo{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.assinatura-mobile-topo h2{margin:0}.assinatura-mobile-topo p{margin:5px 0 0;color:var(--cor-texto-fraco)}.assinatura-mobile-fechar{border:0;background:transparent;color:inherit;font-size:28px}.assinatura-mobile-resumo,.assinatura-mobile-aviso{margin:16px 0;padding:14px;border:1px solid var(--cor-borda);border-radius:6px;background:var(--cor-card-alto);display:grid;gap:4px}.assinatura-mobile-resumo strong{font-size:22px}.assinatura-mobile-resumo small{color:var(--cor-texto-fraco)}.assinatura-mobile-aviso{border-color:var(--acento-aviso);background:var(--acento-aviso-fundo)}.assinatura-mobile-planos{display:grid;gap:10px}.assinatura-mobile-plano{padding:16px;border:1px solid var(--cor-borda);border-radius:7px;background:var(--cor-fundo)}.assinatura-mobile-plano.destaque{border-color:var(--cor-texto);box-shadow:0 0 0 1px var(--cor-texto)}.assinatura-mobile-plano h3{margin:0 0 5px}.assinatura-mobile-plano h3 span{font-size:11px;border-radius:999px;padding:3px 8px;background:var(--cor-texto);color:var(--cor-fundo)}.assinatura-mobile-plano p{margin:0;color:var(--cor-texto-fraco)}.assinatura-mobile-preco{display:block;margin:14px 0;font-size:30px;line-height:1;color:var(--cor-texto);font-variant-numeric:tabular-nums}.assinatura-mobile-preco small{font-size:12px;color:var(--cor-texto-fraco)}.assinatura-mobile-plano ul{list-style:none;padding:0;margin:0 0 14px;display:grid;gap:6px;font-size:13px}.assinatura-mobile-acoes{display:flex;gap:8px;margin-top:16px}.assinatura-mobile-acoes button{flex:1;min-height:48px}.assinatura-mobile-bloqueio{padding:10px;border:1px solid var(--acento-erro);border-radius:6px;background:var(--acento-erro-fundo);color:var(--acento-erro);margin-top:12px}';
    document.head.appendChild(estilo);

    var modal = document.createElement('div');
    modal.id = 'assinatura-mobile-modal';
    modal.className = 'assinatura-mobile-modal';
    modal.hidden = true;
    modal.innerHTML = '<section class="assinatura-mobile-caixa" role="dialog" aria-modal="true" aria-labelledby="assinatura-mobile-titulo">' +
      '<header class="assinatura-mobile-topo"><div><h2 id="assinatura-mobile-titulo">Minha assinatura</h2><p>Escolha, renove ou altere seu plano.</p></div><button type="button" id="btn-fechar-assinatura-mobile" class="assinatura-mobile-fechar" aria-label="Fechar">×</button></header>' +
      '<p id="assinatura-mobile-bloqueio" class="assinatura-mobile-bloqueio" hidden>Sua assinatura venceu. Faça a renovação para liberar o sistema.</p>' +
      '<div id="assinatura-mobile-conteudo"><p>Carregando planos…</p></div>' +
      '<footer class="assinatura-mobile-acoes"><button type="button" id="btn-suporte-assinatura-mobile" class="btn-secundario">Dúvidas? Falar com suporte</button><button type="button" id="btn-sair-assinatura-mobile" class="btn-secundario">Sair da conta</button></footer>' +
      '</section>';
    document.body.appendChild(modal);
    document.getElementById('btn-fechar-assinatura-mobile').addEventListener('click', fechar);
    document.getElementById('btn-suporte-assinatura-mobile').addEventListener('click', function () {
      var estado = window.SistemaOSSessao && window.SistemaOSSessao.obterEstado ? window.SistemaOSSessao.obterEstado() : {};
      var contexto = estado.contexto || {};
      var usuario = estado.usuario || {};
      var usuarioPublico = (usuario.user_metadata && usuario.user_metadata.usuario) || contexto.usuario || '';
      if (window.SistemaOSChamados && window.SistemaOSChamados.abrirNovo) window.SistemaOSChamados.abrirNovo({
        origem: 'config_celular', usuario: usuarioPublico, nome: contexto.perfil_nome || usuarioPublico,
        motivo: 'trial_assinatura', assunto: 'Contratar assinatura após o período de teste',
        mensagem: 'Meu período de teste de 45 dias terminou e desejo contratar uma assinatura do Sistema OS.'
      });
      else toast('Abra um chamado pela tela de entrada.', true);
    });
    document.getElementById('btn-sair-assinatura-mobile').addEventListener('click', function () { window.SistemaOSSessao.sair(); });

    var config = document.getElementById('form-config');
    if (config) {
      var bloco = document.createElement('fieldset');
      bloco.className = 'secao-config';
      bloco.innerHTML = '<legend>Minha assinatura</legend><p class="aviso">Consulte o vencimento, compare os planos e pague com segurança.</p><button type="button" id="btn-minha-assinatura-mobile" class="btn-primario">Ver assinatura e planos</button>';
      config.insertBefore(bloco, config.firstElementChild ? config.firstElementChild.nextSibling : null);
      document.getElementById('btn-minha-assinatura-mobile').addEventListener('click', function () { abrir(false); });
    }
  }

  document.addEventListener('sistema-os:sessao-alterada', function (evento) {
    var estado = evento.detail || {};
    if (estado.tipo === 'cobranca') abrir(true, estado);
    else if (bloqueioAtivo && (estado.tipo === 'autenticado' || estado.tipo === 'offline_com_sessao')) {
      bloqueioAtivo = false;
      fechar();
    }
  });

  montar();
  var inicial = window.SistemaOSSessao && window.SistemaOSSessao.obterEstado();
  if (inicial && inicial.tipo === 'cobranca') abrir(true, inicial);
  window.SistemaOSAssinaturas = { abrir: abrir, carregar: carregar };
})();
