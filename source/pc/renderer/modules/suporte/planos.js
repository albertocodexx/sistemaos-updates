(function (root) {
  'use strict';
  let catalogo = { planos: [], recursos: [] };
  let aoSalvar = null;
  let empresaAtual = null;
  const $ = (id) => document.getElementById(id);

  function criarEstrutura() {
    if ($('modalPlanoSaaS')) return;
    const plano = document.createElement('div');
    plano.id = 'modalPlanoSaaS'; plano.className = 'modal-fundo escondido';
    plano.innerHTML = `<div class="modal-caixa suporte-plano-modal">
      <div class="modal-cabecalho"><div><h2 id="tituloPlanoSaaS">Plano</h2><p class="campo-desc">Defina preço, capacidade e as funções incluídas.</p></div><button type="button" class="botao-fechar" data-fechar-plano>×</button></div>
      <form id="formPlanoSaaS" class="suporte-plano-form">
        <input type="hidden" id="planoSaaSId">
        <div class="grade-campos"><div class="campo"><label>Nome</label><input id="planoSaaSNome" required maxlength="80"></div><div class="campo"><label>Preço</label><input id="planoSaaSPreco" type="number" min="0" step="0.01" required></div><div class="campo campo-largo"><label>Descrição</label><textarea id="planoSaaSDescricao" rows="2" maxlength="500"></textarea></div><div class="campo"><label>Período</label><select id="planoSaaSPeriodo"><option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option><option value="vitalicio">Vitalício</option></select></div><div class="campo"><label>Duração liberada (dias)</label><input id="planoSaaSDuracao" type="number" min="1" max="36500" required></div><div class="campo"><label>Ordem de exibição</label><input id="planoSaaSOrdem" type="number" min="0" max="10000"></div><div class="campo"><label class="check-inline"><input id="planoSaaSAtivo" type="checkbox"> Plano ativo</label></div><div class="campo"><label class="check-inline"><input id="planoSaaSDestaque" type="checkbox"> Destacar este plano</label></div></div>
        <div class="suporte-limites-grade"><div class="campo"><label>Usuários ativos</label><input id="planoLimiteUsuarios" type="number" min="1" max="10000" required></div><div class="campo"><label>Dispositivos</label><input id="planoLimiteDispositivos" type="number" min="1" max="10000" required></div><div class="campo"><label>Armazenamento (GB)</label><input id="planoLimiteStorage" type="number" min="1" max="10000" required></div></div>
        <fieldset class="suporte-recursos-fieldset"><legend>Funções incluídas no plano</legend><p class="campo-desc">Marque exatamente o que esta assinatura libera para a empresa.</p><div id="checklistRecursosPlano" class="suporte-recursos-grid"></div></fieldset>
        <p id="statusPlanoSaaS" class="campo-desc"></p><div class="modal-rodape"><button type="button" id="btnExcluirPlanoSaaS" class="botao botao-perigo" hidden>Excluir plano</button><button type="button" class="botao botao-fantasma" data-fechar-plano>Cancelar</button><button type="submit" class="botao botao-primario">Salvar plano</button></div>
      </form></div>`;
    document.body.appendChild(plano);

    const empresa = document.createElement('div');
    empresa.id = 'modalPlanoEmpresaSaaS'; empresa.className = 'modal-fundo escondido';
    empresa.innerHTML = `<div class="modal-caixa suporte-plano-empresa-modal"><div class="modal-cabecalho"><div><h2 id="tituloPlanoEmpresaSaaS">Plano da empresa</h2><p class="campo-desc">Plano, vencimento e limites efetivos deste cliente.</p></div><button type="button" class="botao-fechar" data-fechar-plano-empresa>×</button></div>
      <form id="formPlanoEmpresaSaaS" class="suporte-plano-form"><div class="grade-campos"><div class="campo campo-largo"><label>Plano contratado</label><select id="empresaPlanoSaaS" required></select></div><div class="campo"><label>Situação</label><select id="empresaStatusSaaS"><option value="">Calcular automaticamente</option><option value="teste">Trial</option><option value="ativa">Ativa</option><option value="suspensa">Suspensa</option><option value="bloqueada">Bloqueada</option><option value="cancelada">Cancelada</option></select></div><div class="campo"><label>Fim do trial</label><input id="empresaFimTrialSaaS" type="date"></div><div class="campo"><label>Vencimento</label><input id="empresaVencimentoSaaS" type="date"></div><div class="campo"><label>Dias de tolerância</label><input id="empresaGracaSaaS" type="number" min="0" max="365" value="3"></div></div>
      <div class="suporte-limites-grade"><div class="campo"><label>Usuários ativos</label><input id="empresaLimiteUsuariosSaaS" type="number" min="1" required></div><div class="campo"><label>Dispositivos</label><input id="empresaLimiteDispositivosSaaS" type="number" min="1" required></div><div class="campo"><label>Armazenamento (GB)</label><input id="empresaLimiteStorageSaaS" type="number" min="1" required></div></div>
      <div id="resumoRecursosEmpresaSaaS" class="suporte-recursos-resumo"></div><div class="campo"><label>Motivo para auditoria</label><input id="empresaMotivoSaaS" maxlength="300" value="Plano atualizado pelo suporte"></div><p id="statusPlanoEmpresaSaaS" class="campo-desc"></p><div class="modal-rodape"><button type="button" class="botao botao-fantasma" data-fechar-plano-empresa>Cancelar</button><button type="submit" class="botao botao-primario">Aplicar plano</button></div></form></div>`;
    document.body.appendChild(empresa);
    document.querySelectorAll('[data-fechar-plano]').forEach((botao) => botao.addEventListener('click', () => plano.classList.add('escondido')));
    document.querySelectorAll('[data-fechar-plano-empresa]').forEach((botao) => botao.addEventListener('click', () => empresa.classList.add('escondido')));
    $('formPlanoSaaS').addEventListener('submit', salvarPlano);
    $('btnExcluirPlanoSaaS').addEventListener('click', excluirPlano);
    $('planoSaaSPeriodo').addEventListener('change', () => {
      $('planoSaaSDuracao').value = ({ mensal: 30, trimestral: 90, semestral: 180, anual: 365, vitalicio: 36500 }[$('planoSaaSPeriodo').value] || 30);
    });
    $('formPlanoEmpresaSaaS').addEventListener('submit', salvarEmpresa);
    $('empresaPlanoSaaS').addEventListener('change', preencherLimitesEmpresaPeloPlano);
  }

  async function invocar(acao, dados) {
    const resposta = await root.api?.supabaseadministracaoglobal?.(acao, dados || {});
    if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível concluir a operação.');
    return resposta;
  }

  async function carregarCatalogo() {
    const resposta = await invocar('listar_planos', {});
    catalogo = { planos: resposta.planos || [], recursos: resposta.recursos || [] };
    return catalogo;
  }

  function desenharRecursos(selecionados) {
    const alvo = $('checklistRecursosPlano'); alvo.replaceChildren();
    const ativos = new Set(selecionados || []);
    catalogo.recursos.forEach((recurso) => {
      const label = document.createElement('label'); label.className = 'suporte-recurso-check';
      const check = document.createElement('input'); check.type = 'checkbox'; check.value = recurso.chave; check.checked = ativos.has(recurso.chave);
      const textos = document.createElement('span'); const nome = document.createElement('strong'); nome.textContent = recurso.nome;
      const descricao = document.createElement('small'); descricao.textContent = recurso.descricao || recurso.chave;
      textos.append(nome, descricao); label.append(check, textos); alvo.appendChild(label);
    });
  }

  async function abrirPlano(planoAtual, callback) {
    criarEstrutura(); await carregarCatalogo(); aoSalvar = callback || null;
    $('tituloPlanoSaaS').textContent = planoAtual ? 'Editar plano · ' + planoAtual.nome : 'Novo plano';
    $('planoSaaSId').value = planoAtual?.id || '';
    $('planoSaaSNome').value = planoAtual?.nome || '';
    $('planoSaaSDescricao').value = planoAtual?.descricao || '';
    $('planoSaaSPreco').value = Number(planoAtual?.preco_referencia || 0).toFixed(2);
    $('planoSaaSPeriodo').value = planoAtual?.periodo || 'mensal';
    $('planoSaaSDuracao').value = planoAtual?.duracao_dias || ({ mensal: 30, trimestral: 90, semestral: 180, anual: 365, vitalicio: 36500 }[$('planoSaaSPeriodo').value] || 30);
    $('planoSaaSOrdem').value = planoAtual?.ordem ?? 100;
    $('planoSaaSAtivo').checked = planoAtual?.ativo !== false;
    $('planoSaaSDestaque').checked = planoAtual?.destaque === true;
    $('btnExcluirPlanoSaaS').hidden = !planoAtual?.id || String(planoAtual?.nome || '').toLowerCase() === 'trial';
    const limites = planoAtual?.limites || {};
    $('planoLimiteUsuarios').value = limites.usuarios || 3;
    $('planoLimiteDispositivos').value = limites.dispositivos || 3;
    $('planoLimiteStorage').value = Math.max(1, Math.round(Number(limites.storage_bytes || 1073741824) / 1073741824));
    desenharRecursos((planoAtual?.recursos || []).filter((item) => item.habilitado !== false).map((item) => item.chave));
    $('statusPlanoSaaS').textContent = '';
    $('modalPlanoSaaS').classList.remove('escondido');
    $('planoSaaSNome').focus();
  }

  async function salvarPlano(evento) {
    evento.preventDefault();
    const botao = evento.currentTarget.querySelector('button[type="submit"]'); botao.disabled = true;
    $('statusPlanoSaaS').textContent = 'Salvando plano e recursos…';
    try {
      const recursos = Array.from($('checklistRecursosPlano').querySelectorAll('input:checked')).map((item) => item.value);
      const resposta = await invocar('salvar_plano', {
        id: $('planoSaaSId').value, nome: $('planoSaaSNome').value.trim(), descricao: $('planoSaaSDescricao').value.trim(),
        precoReferencia: Number($('planoSaaSPreco').value), periodo: $('planoSaaSPeriodo').value,
        duracaoDias: Number($('planoSaaSDuracao').value), ordem: Number($('planoSaaSOrdem').value || 100),
        ativo: $('planoSaaSAtivo').checked, destaque: $('planoSaaSDestaque').checked,
        limites: { usuarios: Number($('planoLimiteUsuarios').value), dispositivos: Number($('planoLimiteDispositivos').value), storage_bytes: Number($('planoLimiteStorage').value) * 1073741824 },
        recursos
      });
      $('modalPlanoSaaS').classList.add('escondido');
      document.dispatchEvent(new CustomEvent('sistemaos:planos-alterados', { detail: resposta.plano }));
      if (aoSalvar) await aoSalvar(resposta.plano);
    } catch (erro) { $('statusPlanoSaaS').textContent = erro.message || String(erro); }
    finally { botao.disabled = false; }
  }

  async function excluirPlano() {
    const id = $('planoSaaSId').value;
    const nome = $('planoSaaSNome').value.trim();
    if (!id || !window.confirm(`Excluir o plano “${nome}”? Empresas que já usam esse plano serão preservadas.`)) return;
    const botao = $('btnExcluirPlanoSaaS'); botao.disabled = true;
    $('statusPlanoSaaS').textContent = 'Excluindo plano…';
    try {
      const resposta = await invocar('excluir_plano', { id });
      $('modalPlanoSaaS').classList.add('escondido');
      document.dispatchEvent(new CustomEvent('sistemaos:planos-alterados'));
      root.toast?.(resposta.mensagem || 'Plano excluído.', 'sucesso');
      if (aoSalvar) await aoSalvar();
    } catch (erro) { $('statusPlanoSaaS').textContent = erro.message || String(erro); }
    finally { botao.disabled = false; }
  }

  function isoData(valor) { if (!valor) return ''; const data = new Date(valor); return Number.isNaN(data.getTime()) ? '' : data.toISOString().slice(0, 10); }
  function planoSelecionado() { return catalogo.planos.find((item) => item.id === $('empresaPlanoSaaS').value); }
  function preencherLimitesEmpresaPeloPlano() {
    const plano = planoSelecionado(); if (!plano) return;
    const limites = plano.limites || {};
    $('empresaLimiteUsuariosSaaS').value = limites.usuarios || 1;
    $('empresaLimiteDispositivosSaaS').value = limites.dispositivos || 1;
    $('empresaLimiteStorageSaaS').value = Math.max(1, Math.round(Number(limites.storage_bytes || 1073741824) / 1073741824));
    const alvo = $('resumoRecursosEmpresaSaaS'); alvo.replaceChildren();
    (plano.recursos || []).filter((item) => item.habilitado !== false).forEach((recurso) => { const tag = document.createElement('span'); tag.textContent = recurso.nome; alvo.appendChild(tag); });
  }

  async function abrirEmpresa(empresa, callback) {
    criarEstrutura(); await carregarCatalogo(); empresaAtual = empresa; aoSalvar = callback || null;
    $('tituloPlanoEmpresaSaaS').textContent = 'Plano e acesso · ' + (empresa.nome_fantasia || empresa.codigo);
    const select = $('empresaPlanoSaaS'); select.replaceChildren();
    catalogo.planos.filter((plano) => plano.ativo || plano.id === empresa.plano_id).forEach((plano) => { const opcao = document.createElement('option'); opcao.value = plano.id; opcao.textContent = plano.nome + ' · ' + Number(plano.preco_referencia || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); select.appendChild(opcao); });
    select.value = empresa.plano_id || catalogo.planos.find((plano) => plano.nome.toLowerCase() === 'trial')?.id || '';
    $('empresaStatusSaaS').value = empresa.licenca_status || '';
    $('empresaFimTrialSaaS').value = isoData(empresa.fim_trial);
    $('empresaVencimentoSaaS').value = isoData(empresa.data_vencimento);
    preencherLimitesEmpresaPeloPlano();
    if (empresa.limite_usuarios) $('empresaLimiteUsuariosSaaS').value = empresa.limite_usuarios;
    if (empresa.limite_dispositivos) $('empresaLimiteDispositivosSaaS').value = empresa.limite_dispositivos;
    if (empresa.limite_storage) $('empresaLimiteStorageSaaS').value = Math.max(1, Math.round(empresa.limite_storage / 1073741824));
    $('statusPlanoEmpresaSaaS').textContent = '';
    $('modalPlanoEmpresaSaaS').classList.remove('escondido');
  }

  async function salvarEmpresa(evento) {
    evento.preventDefault(); if (!empresaAtual) return;
    const botao = evento.currentTarget.querySelector('button[type="submit"]'); botao.disabled = true;
    $('statusPlanoEmpresaSaaS').textContent = 'Aplicando plano e registrando auditoria…';
    try {
      const vencimento = $('empresaVencimentoSaaS').value ? new Date($('empresaVencimentoSaaS').value + 'T23:59:59.999Z').toISOString() : '';
      const fimTrial = $('empresaFimTrialSaaS').value ? new Date($('empresaFimTrialSaaS').value + 'T23:59:59.999Z').toISOString() : '';
      const diasGraca = Number($('empresaGracaSaaS').value || 0);
      const baseGraca = vencimento || fimTrial;
      const gracaAte = baseGraca && diasGraca ? new Date(new Date(baseGraca).getTime() + diasGraca * 86400000).toISOString() : '';
      await invocar('atualizar_licenca', {
        empresaId: empresaAtual.id, planoId: $('empresaPlanoSaaS').value, status: $('empresaStatusSaaS').value,
        fimTrial, vencimento, gracaAte, limiteUsuarios: Number($('empresaLimiteUsuariosSaaS').value),
        limiteDispositivos: Number($('empresaLimiteDispositivosSaaS').value), limiteStorage: Number($('empresaLimiteStorageSaaS').value) * 1073741824,
        motivo: $('empresaMotivoSaaS').value.trim() || 'Plano atualizado pelo suporte'
      });
      $('modalPlanoEmpresaSaaS').classList.add('escondido');
      document.dispatchEvent(new CustomEvent('sistemaos:empresa-plano-alterado', { detail: { empresaId: empresaAtual.id } }));
      if (aoSalvar) await aoSalvar();
    } catch (erro) { $('statusPlanoEmpresaSaaS').textContent = erro.message || String(erro); }
    finally { botao.disabled = false; }
  }

  document.addEventListener('DOMContentLoaded', criarEstrutura);
  root.SistemaOSPlanosUI = Object.freeze({ abrirPlano, abrirEmpresa, carregarCatalogo });
})(window);
