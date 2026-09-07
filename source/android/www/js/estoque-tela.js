(function (root) {
  'use strict';
  var pecas = [];
  var aparelhos = [];
  var aba = 'aparelhos';
  var cancelarTempoReal = null;
  var carregando = false;
  var aparelhoEmEdicao = null;
  var pecasUsadasAparelho = [];
  var pecaEmEdicao = null;
  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function dinheiro(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function pode(acao) { return !root.SistemaOSPermissoes || root.SistemaOSPermissoes.pode('estoque', acao); }
  function toast(msg, erro) { if (root.SistemaOSToast) root.SistemaOSToast.mostrar(msg, { ehErro: !!erro }); }

  function renderAparelhos() {
    var alvo = $('estoque-lista-aparelhos');
    var termo = ($('estoque-busca-aparelhos').value || '').trim().toLowerCase();
    var lista = aparelhos.filter(function (item) {
      var nomesPecas = Array.isArray(item.pecasUsadas) ? item.pecasUsadas.map(function (peca) { return peca && (peca.nome || peca.descricao) || ''; }) : [];
      return !termo || [item.id, item.marca, item.modelo, item.cor, item.imei, item.status].concat(nomesPecas).join(' ').toLowerCase().indexOf(termo) >= 0;
    });
    if (!lista.length) { alvo.innerHTML = '<p class="estoque-mobile-vazio">Nenhum aparelho cadastrado no estoque.</p>'; return; }
    alvo.innerHTML = lista.map(function (item) {
      var status = item.status || 'Aguardando';
      return '<article class="estoque-mobile-card"><div class="estoque-mobile-card-topo"><div><small>' + esc(item.id) + '</small><h3>' + esc([item.marca, item.modelo].filter(Boolean).join(' ')) + '</h3></div><span class="estoque-mobile-badge ' + (status === 'Pronto para venda' ? 'disponivel' : '') + '">' + esc(status) + '</span></div>' +
        '<div class="estoque-mobile-detalhes"><span>Tipo: <strong>' + esc(item.tipoEquipamento || 'Smartphone') + '</strong></span><span>Cor: <strong>' + esc(item.cor || 'Não informada') + '</strong></span><span>Valor: <strong>' + dinheiro(item.valorVenda) + '</strong></span><span>Peças: <strong>' + dinheiro(item.valorGastoPecas) + '</strong></span></div>' +
        '<div class="estoque-mobile-card-acoes">' +
        (pode('editar') ? '<button type="button" class="btn-secundario estoque-editar" data-id="' + esc(item.id) + '">Editar dados e status</button>' : '') +
        (pode('editar') ? '<button type="button" class="btn-primario estoque-vender" data-id="' + esc(item.id) + '">' + (item.assinaturaPendente ? 'Assinar venda pendente' : 'Vender / assinar') + '</button>' : '') +
        (pode('excluir') ? '<button type="button" class="btn-perigo estoque-excluir" data-tipo="aparelho" data-id="' + esc(item.id) + '">Excluir</button>' : '') +
        '</div></article>';
    }).join('');
  }

  function renderPecas() {
    var alvo = $('estoque-lista-pecas');
    var termo = ($('estoque-busca-pecas').value || '').trim().toLowerCase();
    var lista = pecas.filter(function (item) {
      return !termo || [item.id, item.tipoItem, item.nome, item.categoria, item.compatibilidade, item.fornecedor, item.localizacao].join(' ').toLowerCase().indexOf(termo) >= 0;
    });
    if (!lista.length) { alvo.innerHTML = '<p class="estoque-mobile-vazio">Nenhuma peça, consumível ou acessório cadastrado.</p>'; return; }
    alvo.innerHTML = lista.map(function (item) {
      var critica = Number(item.quantidade || 0) <= Number(item.estoqueMinimo || 0);
      var tipoItem = item.tipoItem || 'Peça / Componente';
      return '<article class="estoque-mobile-card"><div class="estoque-mobile-card-topo"><div><small>' + esc(item.id) + ' · ' + esc(tipoItem) + ' · ' + esc(item.categoria) + '</small><h3>' + esc(item.nome) + '</h3></div><span class="estoque-mobile-badge ' + (critica ? 'critico' : '') + '">' + Number(item.quantidade || 0) + ' un.</span></div>' +
        '<p class="estoque-mobile-compat">' + esc(item.compatibilidade || 'Compatibilidade não informada') + '</p>' +
        '<div class="estoque-mobile-detalhes"><span>Mínimo: <strong>' + Number(item.estoqueMinimo || 0) + '</strong></span><span>Local: <strong>' + esc(item.localizacao || '—') + '</strong></span><span>Custo: <strong>' + dinheiro(item.custo) + '</strong></span></div>' +
        '<div class="estoque-mobile-card-acoes">' +
        (pode('editar') ? '<button type="button" class="btn-secundario estoque-editar-peca" data-id="' + esc(item.id) + '">Editar</button>' : '') +
        (pode('editar') ? '<button type="button" class="btn-secundario estoque-movimentar" data-id="' + esc(item.id) + '" data-operacao="entrada">Entrada</button><button type="button" class="btn-secundario estoque-movimentar" data-id="' + esc(item.id) + '" data-operacao="saida">Saída</button>' : '') +
        (pode('excluir') ? '<button type="button" class="btn-perigo estoque-excluir" data-tipo="peca" data-id="' + esc(item.id) + '">Excluir</button>' : '') +
        '</div></article>';
    }).join('');
  }

  function render() {
    $('estoque-sub-aparelhos').hidden = aba !== 'aparelhos';
    $('estoque-sub-pecas').hidden = aba !== 'pecas';
    document.querySelectorAll('#estoque-abas button').forEach(function (botao) {
      botao.classList.toggle('ativo', botao.dataset.aba === aba);
    });
    renderAparelhos(); renderPecas();
  }

  async function carregar(silencioso) {
    if (carregando) return;
    carregando = true;
    var cacheAparelhos = root.SistemaOSEstoque.listarCache ? root.SistemaOSEstoque.listarCache('aparelho') : [];
    var cachePecas = root.SistemaOSEstoque.listarCache ? root.SistemaOSEstoque.listarCache('peca') : [];
    if (cacheAparelhos.length || cachePecas.length) {
      aparelhos = cacheAparelhos; pecas = cachePecas; render();
    }
    if (!silencioso) $('estoque-mobile-status').textContent = 'Sincronizando com o PC…';
    try {
      var fila = root.SistemaOSEstoque.processarFila
        ? await root.SistemaOSEstoque.processarFila() : { enviados: 0, pendentes: 0 };
      var resposta = await Promise.all([
        root.SistemaOSEstoque.listar('aparelho'),
        root.SistemaOSEstoque.listar('peca')
      ]);
      aparelhos = resposta[0]; pecas = resposta[1]; render();
      $('estoque-mobile-status').textContent = fila.pendentes
        ? 'Atualizado agora. ' + fila.pendentes + ' alteração(ões) aguardam conexão.'
        : 'Atualizado agora pela nuvem · ' + aparelhos.length + ' aparelho(s) e ' + pecas.length + ' item(ns). Funciona mesmo com o PC desligado.';
    } catch (erro) {
      if (cacheAparelhos.length || cachePecas.length) {
        $('estoque-mobile-status').textContent = 'Sem conexao: mostrando o ultimo estoque salvo neste celular.';
        return;
      }
      $('estoque-mobile-status').textContent = 'Não foi possível atualizar: ' + (erro.message || erro);
      if (!silencioso) toast('Falha ao sincronizar o estoque.', true);
    } finally { carregando = false; }
  }

  function abrirFormulario(item) {
    pecaEmEdicao = item || null;
    $('modal-nova-peca-mobile').hidden = false;
    $('form-nova-peca-mobile').reset();
    $('titulo-peca-mobile').textContent = item ? 'Editar item' : 'Novo item';
    $('peca-mobile-id').hidden = !item;
    $('peca-mobile-id').textContent = item ? item.id + ' · alterações serão sincronizadas com o PC' : '';
    $('peca-mobile-tipo').value = item?.tipoItem || 'Peça / Componente';
    $('peca-mobile-nome').value = item?.nome || '';
    $('peca-mobile-categoria').value = item?.categoria || 'Outro';
    $('peca-mobile-compat').value = item?.compatibilidade || '';
    $('peca-mobile-fornecedor').value = item?.fornecedor || '';
    $('peca-mobile-quantidade').value = item ? Number(item.quantidade || 0) : '0';
    $('peca-mobile-quantidade').readOnly = !!item;
    $('peca-mobile-quantidade-ajuda').textContent = item
      ? 'Use Entrada e Saída no cartão para alterar o saldo.'
      : 'Informe o saldo inicial do item.';
    $('peca-mobile-minimo').value = item ? Number(item.estoqueMinimo || 0) : '0';
    $('peca-mobile-custo').value = Number(item?.custo || 0) > 0 ? item.custo : '';
    $('peca-mobile-local').value = item?.localizacao || '';
    $('peca-mobile-obs').value = item?.observacoes || '';
    $('btn-salvar-peca-mobile').textContent = item ? 'Salvar alterações' : 'Adicionar item';
    setTimeout(function () { $('peca-mobile-nome').focus(); }, 50);
  }

  function preencherFormularioAparelho(item) {
    aparelhoEmEdicao = item;
    $('aparelho-mobile-id').textContent = item.id + ' · alterações serão enviadas ao PC';
    $('aparelho-mobile-tipo').value = item.tipoEquipamento || 'Smartphone';
    $('aparelho-mobile-status').value = item.status || 'Em análise';
    $('aparelho-mobile-marca').value = item.marca || '';
    $('aparelho-mobile-modelo').value = item.modelo || '';
    $('aparelho-mobile-cor').value = item.cor || '';
    $('aparelho-mobile-valor').value = Number(item.valorVenda || 0) > 0 ? item.valorVenda : '';
    $('aparelho-mobile-imei').value = item.imei || '';
    pecasUsadasAparelho = normalizarPecasUsadas(item.pecasUsadas);
    $('aparelho-mobile-total-pecas').value = Number(item.valorGastoPecas || 0) > 0 ? item.valorGastoPecas : '';
    renderizarPecasUsadasAparelho();
    $('aparelho-mobile-obs').value = item.observacoes || '';
  }

  function normalizarPecasUsadas(lista) {
    if (root.SistemaOSEstoque && root.SistemaOSEstoque.normalizarPecasUsadas) {
      return root.SistemaOSEstoque.normalizarPecasUsadas(lista);
    }
    return Array.isArray(lista) ? lista.map(function (peca) {
      return { nome: String(peca && (peca.nome || peca.descricao) || '').trim(), valor: Math.max(0, Number(peca && peca.valor) || 0) };
    }).filter(function (peca) { return peca.nome || peca.valor > 0; }) : [];
  }

  function totalPecasUsadas() {
    return pecasUsadasAparelho.reduce(function (total, peca) { return total + (Math.max(0, Number(peca.valor)) || 0); }, 0);
  }

  function atualizarResumoPecasUsadas() {
    var resumo = $('aparelho-mobile-pecas-resumo');
    if (!resumo) return;
    if (!pecasUsadasAparelho.length) {
      resumo.textContent = 'Nenhuma peça detalhada. O total pode ser preenchido manualmente.';
      return;
    }
    var detalhado = totalPecasUsadas();
    var financeiro = Math.max(0, Number($('aparelho-mobile-total-pecas').value) || 0);
    resumo.textContent = pecasUsadasAparelho.length + ' peça' + (pecasUsadasAparelho.length === 1 ? '' : 's') +
      ' · soma: ' + dinheiro(detalhado) + (Math.abs(detalhado - financeiro) > 0.009 ? ' · total ajustado: ' + dinheiro(financeiro) : '');
  }

  function sincronizarTotalPecasUsadas() {
    $('aparelho-mobile-total-pecas').value = totalPecasUsadas().toFixed(2);
    atualizarResumoPecasUsadas();
  }

  function renderizarPecasUsadasAparelho() {
    var lista = $('aparelho-mobile-pecas-lista');
    if (!lista) return;
    lista.innerHTML = pecasUsadasAparelho.map(function (peca, indice) {
      return '<div class="aparelho-mobile-peca-linha" data-indice="' + indice + '">' +
        '<label>Peça<input data-campo="nome" maxlength="160" value="' + esc(peca.nome) + '" placeholder="Ex.: Tela"></label>' +
        '<label>Valor<input data-campo="valor" type="number" min="0" step="0.01" inputmode="decimal" value="' + (Number(peca.valor) || '') + '" placeholder="0,00"></label>' +
        '<button type="button" class="btn-secundario" data-remover-peca="' + indice + '" aria-label="Remover peça">Remover</button></div>';
    }).join('');
    lista.querySelectorAll('input[data-campo]').forEach(function (campo) {
      campo.addEventListener('input', function (evento) {
        var linha = evento.target.closest('[data-indice]');
        var indice = Number(linha && linha.dataset.indice);
        if (!Number.isInteger(indice) || !pecasUsadasAparelho[indice]) return;
        if (evento.target.dataset.campo === 'valor') {
          pecasUsadasAparelho[indice].valor = Math.max(0, Number(evento.target.value) || 0);
          sincronizarTotalPecasUsadas();
        } else {
          pecasUsadasAparelho[indice].nome = evento.target.value;
          atualizarResumoPecasUsadas();
        }
      });
    });
    lista.querySelectorAll('[data-remover-peca]').forEach(function (botao) {
      botao.addEventListener('click', function () {
        pecasUsadasAparelho.splice(Number(botao.dataset.removerPeca), 1);
        renderizarPecasUsadasAparelho();
        sincronizarTotalPecasUsadas();
      });
    });
    atualizarResumoPecasUsadas();
  }

  function abrirEdicaoAparelho(item) {
    preencherFormularioAparelho(item);
    $('modal-editar-aparelho-mobile').hidden = false;
    setTimeout(function () { $('aparelho-mobile-modelo').focus(); }, 50);
  }

  function alteracoesAparelhoDoFormulario() {
    return {
      tipoEquipamento: $('aparelho-mobile-tipo').value,
      status: $('aparelho-mobile-status').value,
      marca: $('aparelho-mobile-marca').value,
      modelo: $('aparelho-mobile-modelo').value,
      cor: $('aparelho-mobile-cor').value,
      valorVenda: $('aparelho-mobile-valor').value,
      imei: $('aparelho-mobile-imei').value,
      pecasUsadas: normalizarPecasUsadas(pecasUsadasAparelho),
      valorGastoPecas: $('aparelho-mobile-total-pecas').value,
      observacoes: $('aparelho-mobile-obs').value
    };
  }

  async function persistirAparelho() {
    if (!aparelhoEmEdicao) throw new Error('Selecione um aparelho para editar.');
    if (!$('form-editar-aparelho-mobile').reportValidity()) throw new Error('Preencha os campos obrigatórios do aparelho.');
    var salvo = await root.SistemaOSEstoque.salvarAparelho(alteracoesAparelhoDoFormulario(), aparelhoEmEdicao);
    aparelhoEmEdicao = salvo;
    return salvo;
  }

  async function salvarAparelho(evento) {
    evento.preventDefault();
    var botao = $('btn-salvar-aparelho-mobile');
    botao.disabled = true; botao.textContent = 'Salvando…';
    try {
      var salvo = await persistirAparelho();
      $('modal-editar-aparelho-mobile').hidden = true;
      toast(salvo._pendenteNuvem
        ? 'Alteracao salva neste celular e colocada na fila de sincronizacao.'
        : 'Aparelho atualizado na nuvem. O PC recebera ao conectar.');
      await carregar(true);
    } catch (erro) { toast(erro.message || String(erro), true); }
    finally { botao.disabled = false; botao.textContent = 'Salvar alterações'; }
  }

  async function iniciarVendaDoModal() {
    var botao = $('btn-vender-aparelho-mobile');
    botao.disabled = true; botao.textContent = 'Preparando…';
    try {
      var salvo = await persistirAparelho();
      $('modal-editar-aparelho-mobile').hidden = true;
      if (!root.SistemaOSVendaEstoque || !root.SistemaOSVendaEstoque.iniciar) throw new Error('Fluxo de venda indisponível. Reinicie o aplicativo.');
      root.SistemaOSVendaEstoque.iniciar(salvo);
    } catch (erro) { toast(erro.message || String(erro), true); }
    finally { botao.disabled = false; botao.textContent = 'Preencher venda e assinar'; }
  }

  async function salvarPeca(evento) {
    evento.preventDefault();
    var botao = $('btn-salvar-peca-mobile'); botao.disabled = true; botao.textContent = 'Salvando…';
    try {
      await root.SistemaOSEstoque.salvarPeca({
        tipoItem: $('peca-mobile-tipo').value,
        nome: $('peca-mobile-nome').value,
        categoria: $('peca-mobile-categoria').value,
        compatibilidade: $('peca-mobile-compat').value,
        fornecedor: $('peca-mobile-fornecedor').value,
        quantidade: $('peca-mobile-quantidade').value,
        estoqueMinimo: $('peca-mobile-minimo').value,
        custo: $('peca-mobile-custo').value,
        localizacao: $('peca-mobile-local').value,
        observacoes: $('peca-mobile-obs').value
      }, pecaEmEdicao);
      $('modal-nova-peca-mobile').hidden = true;
      toast(pecaEmEdicao ? 'Item atualizado e enviado ao PC.' : 'Item adicionado e enviado ao PC.');
      pecaEmEdicao = null;
      await carregar(true);
    } catch (erro) { toast(erro.message || String(erro), true); }
    finally { botao.disabled = false; if (!$('modal-nova-peca-mobile').hidden) botao.textContent = pecaEmEdicao ? 'Salvar alterações' : 'Adicionar item'; }
  }

  async function acaoLista(evento) {
    var mover = evento.target.closest('.estoque-movimentar');
    var excluir = evento.target.closest('.estoque-excluir');
    var editar = evento.target.closest('.estoque-editar');
    var vender = evento.target.closest('.estoque-vender');
    var editarPeca = evento.target.closest('.estoque-editar-peca');
    try {
      if (editar) {
        var aparelhoEditar = aparelhos.find(function (item) { return item.id === editar.dataset.id; });
        if (aparelhoEditar) abrirEdicaoAparelho(aparelhoEditar);
      } else if (vender) {
        var aparelhoVender = aparelhos.find(function (item) { return item.id === vender.dataset.id; });
        if (aparelhoVender && root.SistemaOSVendaEstoque?.iniciar) root.SistemaOSVendaEstoque.iniciar(aparelhoVender);
      } else if (editarPeca) {
        var itemEditar = pecas.find(function (item) { return item.id === editarPeca.dataset.id; });
        if (itemEditar) abrirFormulario(itemEditar);
      } else if (mover) {
        var peca = pecas.find(function (item) { return item.id === mover.dataset.id; });
        if (!peca) return;
        var operacao = mover.dataset.operacao === 'saida' ? 'saida' : 'entrada';
        var quantidade = parseInt(root.prompt('Quantidade para ' + (operacao === 'saida' ? 'saída' : 'entrada') + ' de "' + peca.nome + '":', '1'), 10);
        if (!Number.isInteger(quantidade) || quantidade <= 0) return;
        if (operacao === 'saida' && quantidade > Number(peca.quantidade || 0)) {
          throw new Error('Estoque insuficiente. Saldo atual: ' + Number(peca.quantidade || 0) + '.');
        }
        mover.disabled = true;
        await root.SistemaOSEstoque.movimentar(peca, operacao === 'saida' ? -quantidade : quantidade);
        toast((operacao === 'saida' ? 'Saída' : 'Entrada') + ' registrada e sincronizada com o PC.');
        await carregar(true);
      } else if (excluir) {
        var lista = excluir.dataset.tipo === 'peca' ? pecas : aparelhos;
        var item = lista.find(function (registro) { return registro.id === excluir.dataset.id; });
        if (!item) return;
        if (root.SistemaOSExclusao && !await root.SistemaOSExclusao.autorizar('excluir ' + (item.nome || [item.marca, item.modelo].join(' ')))) return;
        await root.SistemaOSEstoque.excluir(item);
        toast('Item excluído no celular e no PC.');
        await carregar(true);
      }
    } catch (erro) { toast(erro.message || String(erro), true); }
  }

  function abrir() {
    if (root.SistemaOSEstoque.processarFila) root.SistemaOSEstoque.processarFila().catch(function () {});
    carregar(false);
    if (!cancelarTempoReal) cancelarTempoReal = root.SistemaOSEstoque.assinar(function () { carregar(true); });
  }
  function fechar() {
    if (cancelarTempoReal) cancelarTempoReal();
    cancelarTempoReal = null;
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('estoque-abas')?.addEventListener('click', function (evento) {
      var botao = evento.target.closest('[data-aba]');
      if (!botao) return;
      aba = botao.dataset.aba; render();
    });
    $('estoque-busca-aparelhos')?.addEventListener('input', renderAparelhos);
    $('estoque-busca-pecas')?.addEventListener('input', renderPecas);
    $('estoque-lista-aparelhos')?.addEventListener('click', acaoLista);
    $('estoque-lista-pecas')?.addEventListener('click', acaoLista);
    $('btn-nova-peca-mobile')?.addEventListener('click', function () { abrirFormulario(null); });
    $('btn-fechar-peca-mobile')?.addEventListener('click', function () { pecaEmEdicao = null; $('modal-nova-peca-mobile').hidden = true; });
    document.querySelector('[data-fechar-peca-mobile]')?.addEventListener('click', function () { pecaEmEdicao = null; $('modal-nova-peca-mobile').hidden = true; });
    $('form-nova-peca-mobile')?.addEventListener('submit', salvarPeca);
    $('btn-fechar-aparelho-mobile')?.addEventListener('click', function () { $('modal-editar-aparelho-mobile').hidden = true; });
    $('form-editar-aparelho-mobile')?.addEventListener('submit', salvarAparelho);
    $('btn-vender-aparelho-mobile')?.addEventListener('click', iniciarVendaDoModal);
    $('btn-adicionar-peca-usada-mobile')?.addEventListener('click', function () {
      if (pecasUsadasAparelho.length >= 100) { toast('Limite de 100 peças por aparelho.', true); return; }
      pecasUsadasAparelho.push({ nome: '', valor: 0 });
      renderizarPecasUsadasAparelho();
      var linhas = $('aparelho-mobile-pecas-lista').querySelectorAll('input[data-campo="nome"]');
      if (linhas.length) linhas[linhas.length - 1].focus();
    });
    $('aparelho-mobile-total-pecas')?.addEventListener('input', atualizarResumoPecasUsadas);
    $('btn-atualizar-estoque-mobile')?.addEventListener('click', function () { carregar(false); });
  });
  document.addEventListener('sistema-os:estoque-alterado', function () { carregar(true); });
  document.addEventListener('sistema-os:tela-estoque-aberta', abrir);
  document.addEventListener('sistema-os:tela-estoque-fechada', fechar);
})(typeof globalThis !== 'undefined' ? globalThis : this);
