(function (root) {
  'use strict';

  var itens = [];
  var carregando = false;
  var intervalo = null;
  function $(id) { return document.getElementById(id); }
  function esc(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function normalizar(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function dinheiro(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function pode(acao) {
    return typeof root.temPermissaoAcao !== 'function' || root.temPermissaoAcao('estoque', acao);
  }
  function avisar(mensagem, erro) {
    if (typeof root.toast === 'function') root.toast(mensagem, erro ? 'erro' : 'sucesso');
  }

  function renderizar() {
    var alvo = $('tabelaPrecosLista');
    if (!alvo) return;
    var termo = normalizar($('tabelaPrecosBusca')?.value);
    var lista = itens.filter(function (item) {
      return !termo || normalizar([item.modelo, item.peca, item.fornecedor, item.observacoes].join(' ')).indexOf(termo) >= 0;
    });
    $('tabelaPrecosStatus').textContent = lista.length + ' preço(s) encontrado(s) · sincronizado com o celular';
    if (!lista.length) {
      alvo.innerHTML = '<div class="precos-vazio">' + (termo
        ? 'Nenhum preço corresponde à busca.'
        : 'Nenhum preço cadastrado. Clique em “Novo preço” para começar.') + '</div>';
      return;
    }
    alvo.innerHTML = lista.map(function (item) {
      return '<article class="preco-card">' +
        '<div class="preco-card-topo"><div><h3>' + esc(item.modelo) + '</h3><p class="preco-card-peca">' + esc(item.peca) +
        '</p></div><strong class="preco-card-valor">' + dinheiro(item.valor) + '</strong></div>' +
        (item.fornecedor ? '<p class="preco-card-fornecedor"><strong>Fornecedor:</strong> ' + esc(item.fornecedor) + '</p>' : '') +
        (item.observacoes ? '<p class="preco-card-observacao">' + esc(item.observacoes) + '</p>' : '') +
        '<div class="preco-card-acoes">' +
        (pode('editar') ? '<button class="botao botao-secundario preco-editar" data-id="' + esc(item.id) + '">Editar</button>' : '') +
        (pode('excluir') ? '<button class="botao botao-perigo preco-excluir" data-id="' + esc(item.id) + '">Excluir</button>' : '') +
        '</div></article>';
    }).join('');
  }

  async function carregar(silencioso) {
    if (carregando || !$('aba-precos') || $('aba-precos').classList.contains('escondido')) return;
    carregando = true;
    if (!silencioso) $('tabelaPrecosStatus').textContent = 'Sincronizando tabela de preços…';
    try {
      itens = await root.api.tabelaprecoslistar();
      renderizar();
    } catch (erro) {
      $('tabelaPrecosStatus').textContent = 'Não foi possível carregar: ' + (erro.message || erro);
      if (!silencioso) avisar('Não foi possível atualizar a tabela de preços.', true);
    } finally {
      carregando = false;
    }
  }

  function abrir(item) {
    item = item || {};
    $('tituloModalTabelaPreco').textContent = item.id ? 'Editar preço' : 'Novo preço';
    $('tabelaPrecoId').value = item.id || '';
    $('tabelaPrecoRevision').value = item.revision || '';
    $('tabelaPrecoModelo').value = item.modelo || '';
    $('tabelaPrecoPeca').value = item.peca || '';
    $('tabelaPrecoValor').value = item.id ? Number(item.valor || 0).toFixed(2) : '';
    $('tabelaPrecoFornecedor').value = item.fornecedor || '';
    $('tabelaPrecoObservacoes').value = item.observacoes || '';
    $('tabelaPrecoMensagem').textContent = '';
    $('modalTabelaPreco').classList.remove('escondido');
    setTimeout(function () { $('tabelaPrecoModelo').focus(); }, 30);
  }

  async function salvar() {
    var botao = $('btnSalvarTabelaPreco');
    var dados = {
      id: $('tabelaPrecoId').value || null,
      revision: Number($('tabelaPrecoRevision').value) || null,
      modelo: $('tabelaPrecoModelo').value,
      peca: $('tabelaPrecoPeca').value,
      valor: $('tabelaPrecoValor').value,
      fornecedor: $('tabelaPrecoFornecedor').value,
      observacoes: $('tabelaPrecoObservacoes').value
    };
    if (!dados.modelo.trim() || !dados.peca.trim() || dados.valor === '' || Number(dados.valor) < 0) {
      $('tabelaPrecoMensagem').textContent = 'Preencha modelo, peça ou serviço e valor.';
      return;
    }
    botao.disabled = true;
    botao.textContent = 'Salvando…';
    try {
      await root.api.tabelaprecossalvar(dados);
      $('modalTabelaPreco').classList.add('escondido');
      avisar('Preço salvo no PC e no celular.');
      await carregar(true);
    } catch (erro) {
      $('tabelaPrecoMensagem').textContent = erro.message || String(erro);
    } finally {
      botao.disabled = false;
      botao.textContent = 'Salvar preço';
    }
  }

  async function acaoLista(evento) {
    var editar = evento.target.closest('.preco-editar');
    var excluir = evento.target.closest('.preco-excluir');
    var id = editar?.dataset.id || excluir?.dataset.id;
    var item = itens.find(function (registro) { return registro.id === id; });
    if (!item) return;
    if (editar) return abrir(item);
    if (!root.confirm('Excluir o preço de ' + item.peca + ' para ' + item.modelo + '?\\n\\nA exclusão será sincronizada com o celular.')) return;
    excluir.disabled = true;
    try {
      await root.api.tabelaprecosexcluir(item.id, item.revision);
      avisar('Preço excluído no PC e no celular.');
      await carregar(true);
    } catch (erro) {
      avisar(erro.message || String(erro), true);
    } finally {
      excluir.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var listaFornecedores = document.createElement('datalist');
    listaFornecedores.id = 'listaFornecedoresTabelaPrecos';
    document.body.appendChild(listaFornecedores);
    $('tabelaPrecoFornecedor')?.setAttribute('list', listaFornecedores.id);
    function atualizarFornecedores() {
      var nomes = Array.from(new Set(itens.map(function (item) { return String(item.fornecedor || '').trim(); }).filter(Boolean)))
        .sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }); });
      listaFornecedores.replaceChildren.apply(listaFornecedores, nomes.map(function (nome) {
        var opcao = document.createElement('option'); opcao.value = nome; return opcao;
      }));
    }
    var renderizarOriginal = renderizar;
    renderizar = function () { atualizarFornecedores(); renderizarOriginal(); };
    $('btnNovoTabelaPreco')?.addEventListener('click', function () { abrir(); });
    $('btnSalvarTabelaPreco')?.addEventListener('click', salvar);
    $('btnBuscarTabelaPrecos')?.addEventListener('click', renderizar);
    $('btnAtualizarTabelaPrecos')?.addEventListener('click', function () { carregar(false); });
    $('tabelaPrecosBusca')?.addEventListener('input', renderizar);
    $('tabelaPrecosBusca')?.addEventListener('keydown', function (evento) {
      if (evento.key === 'Enter') renderizar();
    });
    $('tabelaPrecosLista')?.addEventListener('click', acaoLista);
    intervalo = root.setInterval(function () {
      if (document.hidden || root.__SISTEMA_OS_MODO_SEGUNDO_PLANO__ === true) return;
      carregar(true);
    }, 8000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) carregar(true);
    });
  });

  root.carregarTabelaPrecos = function () { carregar(false); };
  root.addEventListener('beforeunload', function () { if (intervalo) root.clearInterval(intervalo); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
