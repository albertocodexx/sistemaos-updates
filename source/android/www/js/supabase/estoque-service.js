(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SistemaOSEstoque = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // v2 invalida a fotografia antiga que podia reaparecer depois da venda
  // enquanto o primeiro pull ainda estava em andamento.
  var VERSAO_CACHE = 2;
  var PREFIXO_CACHE = 'sistema-os-estoque-cache-v2:';
  var TIPOS_ITEM_ESTOQUE = ['Peça / Componente', 'Consumível', 'Acessório'];
  var STATUS_APARELHO = ['Aguardando chegada', 'Em análise', 'Aguardando peça', 'Em reparo', 'Pronto para venda', 'Reservado', 'Vendido', 'Cancelado'];

  function normalizarTipoItem(valor) {
    var texto = String(valor || '').trim();
    return TIPOS_ITEM_ESTOQUE.indexOf(texto) >= 0 ? texto : 'Peça / Componente';
  }

  function normalizarPecasUsadas(lista) {
    if (!Array.isArray(lista)) return [];
    return lista.slice(0, 100).map(function (peca) {
      return {
        nome: String(peca && (peca.nome || peca.descricao) || '').trim().slice(0, 160),
        valor: Math.max(0, Number(peca && peca.valor) || 0)
      };
    }).filter(function (peca) { return peca.nome || peca.valor > 0; });
  }

  function empresaIdAtual() {
    var contexto = root.SistemaOSPermissoes && root.SistemaOSPermissoes.obterContexto
      ? root.SistemaOSPermissoes.obterContexto() : {};
    return String((contexto || {}).empresa_id || (contexto || {}).empresaId || 'sem-sessao');
  }

  function chaveCache() { return PREFIXO_CACHE + empresaIdAtual(); }

  function estadoCache() {
    var padrao = { versao: VERSAO_CACHE, atualizadoEm: '', aparelhos: [], pecas: [], fila: [] };
    try {
      var salvo = JSON.parse(root.localStorage && root.localStorage.getItem(chaveCache()) || 'null');
      if (!salvo || salvo.versao !== VERSAO_CACHE) return padrao;
      return Object.assign(padrao, salvo, {
        aparelhos: Array.isArray(salvo.aparelhos) ? salvo.aparelhos.slice(0, 1000) : [],
        pecas: Array.isArray(salvo.pecas) ? salvo.pecas.slice(0, 1000) : [],
        fila: Array.isArray(salvo.fila) ? salvo.fila.slice(-100) : []
      });
    } catch (_) { return padrao; }
  }

  function salvarEstadoCache(estado) {
    try {
      estado.atualizadoEm = new Date().toISOString();
      root.localStorage && root.localStorage.setItem(chaveCache(), JSON.stringify(estado));
    } catch (_) { /* cache e uma otimizacao: nunca bloqueia o estoque */ }
  }

  function chaveLista(tipo) { return tipo === 'peca' ? 'pecas' : 'aparelhos'; }

  function listarCache(tipo) { return estadoCache()[chaveLista(tipo)].slice(); }

  function atualizarCache(tipo, lista) {
    var estado = estadoCache();
    estado[chaveLista(tipo)] = (lista || []).slice(0, 1000);
    salvarEstadoCache(estado);
  }

  function atualizarItemCache(tipo, item) {
    var estado = estadoCache();
    var chave = chaveLista(tipo);
    var lista = estado[chave] || [];
    var indice = lista.findIndex(function (atual) { return atual && atual.id === item.id; });
    if (indice >= 0) lista[indice] = item;
    else lista.unshift(item);
    estado[chave] = lista.slice(0, 1000);
    salvarEstadoCache(estado);
  }

  function enfileirarEdicaoAparelho(dados) {
    var estado = estadoCache();
    var id = String(dados && dados.id || '');
    if (!id) return;
    // Uma unica entrada por aparelho: varias alteracoes offline substituem a
    // anterior. Isso mantem a fila pequena e evita uploads repetidos.
    estado.fila = (estado.fila || []).filter(function (item) {
      return !(item.acao === 'salvar_aparelho' && item.id === id);
    });
    estado.fila.push({ acao: 'salvar_aparelho', id: id, dados: semMetadados(dados), criadoEm: new Date().toISOString() });
    estado.fila = estado.fila.slice(-100);
    salvarEstadoCache(estado);
  }

  function removerEdicaoPendenteAparelho(id) {
    var estado = estadoCache();
    var antes = (estado.fila || []).length;
    estado.fila = (estado.fila || []).filter(function (item) {
      return !(item.acao === 'salvar_aparelho' && item.id === String(id || ''));
    });
    if (estado.fila.length !== antes) salvarEstadoCache(estado);
  }

  function erroDeRede(erro) {
    var texto = String(erro && (erro.message || erro) || '').toLowerCase();
    return !erro || erro.status === 0 || erro.name === 'TypeError' ||
      /network|fetch|internet|offline|timeout|failed to fetch|connection/.test(texto);
  }

  function estaOnline() { return !root.navigator || root.navigator.onLine !== false; }

  function cliente() {
    if (!root.SupabaseClientApp) throw new Error('Conexão com o Supabase indisponível.');
    return root.SupabaseClientApp.obterCliente();
  }

  async function dispositivoId() {
    if (!root.SistemaOSSupabaseSync) throw new Error('Dispositivo Android ainda não foi registrado.');
    return root.SistemaOSSupabaseSync.obterDispositivoId();
  }

  function linha(data) { return Array.isArray(data) ? data[0] : data; }

  function mapearItem(item) {
    if (!item) return null;
    var dados = Object.assign({}, item.dados || {});
    if (item.tipo === 'peca') dados.tipoItem = normalizarTipoItem(dados.tipoItem);
    return Object.assign({}, dados, {
      _idRemoto: item.id,
      _revision: Number(item.revision) || 1,
      _atualizadoEm: item.updated_at,
      id: item.local_id
    });
  }

  function semMetadados(item) {
    var copia = Object.assign({}, item || {});
    Object.keys(copia).forEach(function (chave) {
      if (chave.charAt(0) === '_') delete copia[chave];
    });
    return copia;
  }

  async function listar(tipo) {
    var resposta = await cliente().from('estoque_itens')
      .select('id,tipo,local_id,dados,revision,updated_at')
      .eq('tipo', tipo).is('deleted_at', null)
      .order('updated_at', { ascending: false }).limit(1000);
    if (resposta.error) throw resposta.error;
    var itens = (resposta.data || []).map(mapearItem);
    atualizarCache(tipo, itens);
    return itens;
  }

  async function obterAparelho(localId) {
    var resposta = await cliente().from('estoque_itens')
      .select('id,tipo,local_id,dados,revision,updated_at')
      .eq('tipo', 'aparelho').eq('local_id', localId).is('deleted_at', null).maybeSingle();
    if (resposta.error) throw resposta.error;
    return mapearItem(resposta.data);
  }

  async function salvarAparelho(alteracoes, atual) {
    atual = atual || await obterAparelho(alteracoes && alteracoes.id);
    if (!atual || !atual.id) throw new Error('Aparelho não encontrado no estoque sincronizado. Atualize a lista e tente novamente.');
    var dados = Object.assign({}, semMetadados(atual), alteracoes || {}, { id: atual.id });
    dados.marca = String(dados.marca || '').trim();
    dados.modelo = String(dados.modelo || '').trim();
    dados.tipoEquipamento = String(dados.tipoEquipamento || 'Smartphone').trim();
    dados.status = String(dados.status || 'Em análise').trim();
    dados.valorVenda = Math.max(0, Number(dados.valorVenda) || 0);
    dados.pecasUsadas = normalizarPecasUsadas(dados.pecasUsadas);
    dados.valorGastoPecas = Math.max(0, Number(dados.valorGastoPecas) || 0);
    if (!dados.marca || !dados.modelo) throw new Error('Informe a marca e o modelo do aparelho.');
    if (STATUS_APARELHO.indexOf(dados.status) < 0) {
      throw new Error('Status de estoque inválido.');
    }

    async function enviar(base) {
      var resposta = await cliente().rpc('salvar_item_estoque', {
        p_tipo: 'aparelho', p_local_id: base.id, p_dados: dados,
        p_revision: base._revision || null,
        p_dispositivo_id: await dispositivoId()
      });
      if (resposta.error) throw resposta.error;
      return mapearItem(linha(resposta.data));
    }

    try {
      var salvo = await enviar(atual);
      atualizarItemCache('aparelho', salvo);
      removerEdicaoPendenteAparelho(salvo.id);
      return salvo;
    } catch (erro) {
      if (erroDeRede(erro) || !estaOnline()) {
        var pendente = Object.assign({}, dados, {
          _idRemoto: atual._idRemoto || '', _revision: atual._revision || null,
          _pendenteNuvem: true, _atualizadoEm: new Date().toISOString()
        });
        atualizarItemCache('aparelho', pendente);
        enfileirarEdicaoAparelho(pendente);
        return pendente;
      }
      if (!/conflito_revision_estoque|revision/i.test(String(erro && (erro.message || erro)))) throw erro;
      var recente = await obterAparelho(atual.id);
      if (!recente) throw erro;
      dados = Object.assign({}, semMetadados(recente), alteracoes || {}, { id: recente.id });
      var conciliado = await enviar(recente);
      atualizarItemCache('aparelho', conciliado);
      removerEdicaoPendenteAparelho(conciliado.id);
      return conciliado;
    }
  }

  async function processarFila() {
    if (!estaOnline()) return { enviados: 0, pendentes: estadoCache().fila.length, offline: true };
    var estado = estadoCache();
    var pendentes = estado.fila || [];
    if (!pendentes.length) return { enviados: 0, pendentes: 0 };
    var restantes = [];
    var enviados = 0;
    for (var i = 0; i < pendentes.length; i += 1) {
      var item = pendentes[i];
      try {
        if (item.acao !== 'salvar_aparelho') continue;
        // Rele a revision no servidor antes de aplicar o patch pendente. O
        // PC pode ter sido ligado e atualizado o mesmo item nesse intervalo.
        var remoto = await obterAparelho(item.id);
        if (!remoto) throw new Error('Aparelho removido do estoque antes da sincronizacao.');
        var salvo = await salvarAparelho(item.dados, remoto);
        if (salvo._pendenteNuvem) throw new Error('Conexao ainda indisponivel.');
        enviados += 1;
      } catch (_) {
        restantes.push(item);
      }
    }
    estado = estadoCache();
    estado.fila = restantes;
    salvarEstadoCache(estado);
    return { enviados: enviados, pendentes: restantes.length };
  }

  async function registrarVenda(venda) {
    if (!venda || !venda.estoqueLocalId) throw new Error('Venda sem vínculo com o aparelho do estoque.');
    if (!(Number(venda.valorVenda) > 0)) throw new Error('Informe um valor de venda maior que zero.');
    var pendente = venda.assinaturaPendente === true && venda.naoAssinado !== true && !venda.assinaturaCompradorBase64;
    return salvarAparelho({
      tipoEquipamento: venda.tipoEquipamento,
      marca: venda.marca,
      modelo: venda.modelo,
      cor: venda.cor,
      imei: venda.imei,
      observacoes: venda.observacoes,
      garantia: venda.garantia,
      compradorNome: venda.compradorNome,
      compradorCpf: venda.compradorCpf,
      compradorTelefone: venda.compradorTelefone,
      compradorSemNumero: venda.compradorSemNumero === true,
      compradorEmail: venda.compradorEmail,
      valorVenda: Number(venda.valorVenda),
      formaPagamento: venda.formaPagamento,
      termosVenda: venda.termosVenda || '',
      dataVenda: venda.dataVenda || new Date().toISOString(),
      assinaturaPendente: pendente,
      naoAssinado: venda.naoAssinado === true,
      status: pendente ? 'Reservado' : 'Vendido'
    }, await obterAparelho(venda.estoqueLocalId));
  }

  async function salvarPeca(dados, atual) {
    var localId = atual && atual.id
      ? atual.id
      : 'PCA-MOB-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
    var peca = {
      id: localId,
      dataCadastro: (atual && atual.dataCadastro) || new Date().toISOString(),
      tipoItem: normalizarTipoItem(dados.tipoItem || (atual && atual.tipoItem)),
      nome: String(dados.nome || '').trim(),
      categoria: String(dados.categoria || '').trim(),
      compatibilidade: String(dados.compatibilidade || '').trim(),
      fornecedor: String(dados.fornecedor || '').trim(),
      custo: Math.max(0, Number(dados.custo) || 0),
      // Na edição, o saldo só muda pelo fluxo de Entrada/Saída. Isso evita
      // sobrescrever uma movimentação feita no PC com o formulário aberto.
      quantidade: atual
        ? Math.max(0, parseInt(atual.quantidade, 10) || 0)
        : Math.max(0, parseInt(dados.quantidade, 10) || 0),
      estoqueMinimo: Math.max(0, parseInt(dados.estoqueMinimo, 10) || 0),
      localizacao: String(dados.localizacao || '').trim(),
      dataEntrada: (atual && atual.dataEntrada) || new Date().toISOString(),
      observacoes: String(dados.observacoes || '').trim()
    };
    if (!peca.nome || !peca.categoria) throw new Error('Informe o nome e a categoria do item.');
    var resposta = await cliente().rpc('salvar_item_estoque', {
      p_tipo: 'peca', p_local_id: localId, p_dados: peca,
      p_revision: atual && atual._revision ? atual._revision : null,
      p_dispositivo_id: await dispositivoId()
    });
    if (resposta.error) throw resposta.error;
    return linha(resposta.data);
  }

  async function movimentar(peca, delta) {
    delta = parseInt(delta, 10);
    if (!Number.isInteger(delta) || delta === 0) throw new Error('Informe uma quantidade diferente de zero.');
    var saldoAtual = Math.max(0, parseInt(peca && peca.quantidade, 10) || 0);
    if (delta < 0 && saldoAtual + delta < 0) throw new Error('Estoque insuficiente para registrar esta saída.');
    var resposta = await cliente().rpc('movimentar_quantidade_peca', {
      p_id: peca._idRemoto, p_delta: delta,
      p_revision: peca._revision || null,
      p_dispositivo_id: await dispositivoId()
    });
    if (resposta.error) throw resposta.error;
    return linha(resposta.data);
  }

  async function excluir(item) {
    var resposta = await cliente().rpc('excluir_item_estoque', {
      p_id: item._idRemoto, p_revision: item._revision || null,
      p_dispositivo_id: await dispositivoId()
    });
    if (resposta.error) throw resposta.error;
    return linha(resposta.data);
  }

  function assinar(onChange) {
    if (typeof cliente().channel !== 'function') return function () {};
    var canal = cliente().channel('estoque-mobile-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estoque_itens' }, function () {
        if (typeof onChange === 'function') onChange();
      }).subscribe();
    return function () { cliente().removeChannel(canal); };
  }

  if (root.addEventListener) {
    root.addEventListener('online', function () { processarFila().catch(function () {}); });
  }

  return {
    TIPOS_ITEM_ESTOQUE: TIPOS_ITEM_ESTOQUE,
    STATUS_APARELHO: STATUS_APARELHO,
    normalizarTipoItem: normalizarTipoItem,
    normalizarPecasUsadas: normalizarPecasUsadas,
    listar: listar,
    listarCache: listarCache,
    obterAparelho: obterAparelho,
    salvarAparelho: salvarAparelho,
    registrarVenda: registrarVenda,
    salvarPeca: salvarPeca,
    movimentar: movimentar,
    excluir: excluir,
    assinar: assinar,
    processarFila: processarFila
  };
});
