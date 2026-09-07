(function (root) {
  'use strict';
  var itens = [];
  var carregando = false;
  var pararTempoReal = null;
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
    return !root.SistemaOSPermissoes || root.SistemaOSPermissoes.pode('estoque', acao);
  }
  function toast(mensagem, erro) {
    root.SistemaOSToast?.mostrar?.(mensagem, { ehErro: !!erro });
  }

  function renderizar() {
    var alvo = $('precos-mobile-lista');
    if (!alvo) return;
    var termo = normalizar($('precos-mobile-busca')?.value);
    var lista = itens.filter(function (item) {
      return !termo || normalizar([item.modelo, item.peca, item.fornecedor, item.observacoes].join(' ')).indexOf(termo) >= 0;
    });
    $('precos-mobile-status').textContent = lista.length + ' preço(s) · sincronizado com o PC';
    if (!lista.length) {
      alvo.innerHTML = '<p class="precos-mobile-vazio">' +
        (termo ? 'Nenhum preço corresponde à busca.' : 'Nenhum preço cadastrado.') + '</p>';
      return;
    }
    alvo.innerHTML = lista.map(function (item) {
      return '<article class="precos-mobile-card"><div class="precos-mobile-card-topo">' +
        '<div><h3>' + esc(item.modelo) + '</h3><p>' + esc(item.peca) + '</p></div>' +
        '<strong class="precos-mobile-valor">' + dinheiro(item.valor) + '</strong></div>' +
        (item.fornecedor ? '<p class="precos-mobile-fornecedor"><strong>Fornecedor:</strong> ' + esc(item.fornecedor) + '</p>' : '') +
        (item.observacoes ? '<small>' + esc(item.observacoes) + '</small>' : '') +
        '<div class="precos-mobile-acoes">' +
        (pode('editar') ? '<button type="button" class="btn-secundario preco-mobile-editar" data-id="' + esc(item.id) + '">Editar</button>' : '') +
        (pode('excluir') ? '<button type="button" class="btn-perigo preco-mobile-excluir" data-id="' + esc(item.id) + '">Excluir</button>' : '') +
        '</div></article>';
    }).join('');
  }

  async function carregar(silencioso) {
    if (carregando) return;
    carregando = true;
    var cache = root.SistemaOSTabelaPrecos.listarCache();
    if (cache.length) { itens = cache; renderizar(); }
    if (!silencioso) $('precos-mobile-status').textContent = 'Sincronizando com o PC…';
    try {
      itens = await root.SistemaOSTabelaPrecos.listar();
      renderizar();
    } catch (erro) {
      if (cache.length) {
        $('precos-mobile-status').textContent = 'Sem conexão · mostrando a última tabela salva neste aparelho.';
      } else {
        $('precos-mobile-status').textContent = 'Não foi possível carregar a tabela.';
      }
      if (!silencioso) toast(erro.message || String(erro), true);
    } finally { carregando = false; }
  }

  function abrir(item) {
    item = item || {};
    $('preco-mobile-titulo-modal').textContent = item.id ? 'Editar preço' : 'Novo preço';
    $('preco-mobile-id').value = item.id || '';
    $('preco-mobile-revision').value = item.revision || '';
    $('preco-mobile-modelo').value = item.modelo || '';
    $('preco-mobile-peca').value = item.peca || '';
    $('preco-mobile-valor').value = item.id ? Number(item.valor || 0).toFixed(2) : '';
    $('preco-mobile-fornecedor').value = item.fornecedor || '';
    $('preco-mobile-observacoes').value = item.observacoes || '';
    $('modal-preco-mobile').hidden = false;
    setTimeout(function () { $('preco-mobile-modelo').focus(); }, 30);
  }

  async function salvar(evento) {
    evento.preventDefault();
    var botao = $('btn-salvar-preco-mobile');
    botao.disabled = true;
    botao.textContent = 'Salvando…';
    try {
      await root.SistemaOSTabelaPrecos.salvar({
        id: $('preco-mobile-id').value || null,
        revision: Number($('preco-mobile-revision').value) || null,
        modelo: $('preco-mobile-modelo').value,
        peca: $('preco-mobile-peca').value,
        valor: $('preco-mobile-valor').value,
        fornecedor: $('preco-mobile-fornecedor').value,
        observacoes: $('preco-mobile-observacoes').value
      });
      $('modal-preco-mobile').hidden = true;
      toast('Preço salvo no celular e no PC.');
      await carregar(true);
    } catch (erro) {
      toast(erro.message || String(erro), true);
    } finally {
      botao.disabled = false;
      botao.textContent = 'Salvar preço';
    }
  }

  async function acaoLista(evento) {
    var editar = evento.target.closest('.preco-mobile-editar');
    var excluir = evento.target.closest('.preco-mobile-excluir');
    var id = editar?.dataset.id || excluir?.dataset.id;
    var item = itens.find(function (registro) { return registro.id === id; });
    if (!item) return;
    if (editar) return abrir(item);
    var autorizado = root.SistemaOSExclusao
      ? await root.SistemaOSExclusao.autorizar('excluir o preço de ' + item.peca + ' para ' + item.modelo)
      : root.confirm('Excluir este preço?');
    if (!autorizado) return;
    excluir.disabled = true;
    try {
      await root.SistemaOSTabelaPrecos.excluir(item);
      toast('Preço excluído no celular e no PC.');
      await carregar(true);
    } catch (erro) { toast(erro.message || String(erro), true); }
    finally { excluir.disabled = false; }
  }

  function abrirTela() {
    carregar(false);
    if (!pararTempoReal) pararTempoReal = root.SistemaOSTabelaPrecos.assinar(function () { carregar(true); });
  }
  function fecharTela() {
    if (pararTempoReal) pararTempoReal();
    pararTempoReal = null;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var catalogo = root.SistemaOSCatalogoAparelhos?.catalogo || {};
    var modelos = Object.keys(catalogo).reduce(function (lista, marca) {
      var modelosDaMarca = catalogo[marca] || [];
      return lista.concat(modelosDaMarca, modelosDaMarca.map(function (modelo) { return marca + ' ' + modelo; }));
    }, []).sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }); });
    var listaModelos = document.createElement('datalist');
    listaModelos.id = 'catalogo-modelos-precos-mobile';
    listaModelos.replaceChildren.apply(listaModelos, Array.from(new Set(modelos)).map(function (modelo) {
      var opcao = document.createElement('option'); opcao.value = modelo; return opcao;
    }));
    document.body.appendChild(listaModelos);
    $('preco-mobile-modelo')?.setAttribute('list', listaModelos.id);
    var listaFornecedores = document.createElement('datalist');
    listaFornecedores.id = 'catalogo-fornecedores-precos-mobile';
    document.body.appendChild(listaFornecedores);
    $('preco-mobile-fornecedor')?.setAttribute('list', listaFornecedores.id);
    function atualizarFornecedores() {
      var nomes = Array.from(new Set(itens.map(function (item) { return String(item.fornecedor || '').trim(); }).filter(Boolean)))
        .sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }); });
      listaFornecedores.replaceChildren.apply(listaFornecedores, nomes.map(function (nome) {
        var opcao = document.createElement('option'); opcao.value = nome; return opcao;
      }));
    }
    var renderizarOriginal = renderizar;
    renderizar = function () { atualizarFornecedores(); renderizarOriginal(); };
    $('btn-novo-preco-mobile')?.addEventListener('click', function () { abrir(); });
    $('btn-atualizar-precos-mobile')?.addEventListener('click', function () { carregar(false); });
    $('precos-mobile-busca')?.addEventListener('input', renderizar);
    $('precos-mobile-lista')?.addEventListener('click', acaoLista);
    $('form-preco-mobile')?.addEventListener('submit', salvar);
    $('btn-fechar-preco-mobile')?.addEventListener('click', function () { $('modal-preco-mobile').hidden = true; });
    document.querySelector('[data-fechar-modal-preco]')?.addEventListener('click', function () { $('modal-preco-mobile').hidden = true; });
  });
  document.addEventListener('sistema-os:tela-precos-aberta', abrirTela);
  document.addEventListener('sistema-os:tela-precos-fechada', fecharTela);
})(typeof globalThis !== 'undefined' ? globalThis : this);
