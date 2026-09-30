(function (root) {
  'use strict';
  var geracao = 0;
  var timer = null;
  var notasCarregadas = [];
  function $(id) { return document.getElementById(id); }
  function contexto() { return root.SistemaOSPermissoes?.obterContexto?.() || {}; }
  function empresaAtual() { return String(contexto().empresa_id || ''); }
  function dinheiro(centavos) { return (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function status(mensagem) { $('fiscal-mobile-status').textContent = mensagem; }
  function aviso(mensagem) { if (root.SistemaOSToast?.mostrar) root.SistemaOSToast.mostrar(mensagem, 'erro'); else status(mensagem); }
  async function chamar(acao, dados) {
    var cliente = root.SupabaseClientApp?.obterCliente?.();
    if (!cliente) throw new Error('Entre na conta para consultar as notas fiscais.');
    var resposta = await cliente.functions.invoke('fiscal-documentos', { body: { acao: acao, dados: dados || {} } });
    if (resposta.error && root.SistemaOSEdgeError) await root.SistemaOSEdgeError.lancar(resposta.error, 'Não foi possível consultar as notas fiscais.');
    if (resposta.error) throw resposta.error;
    if (resposta.data?.erro) throw new Error(resposta.data.erro);
    return resposta.data || {};
  }
  function texto(elemento, valor) { if (elemento) elemento.textContent = String(valor ?? '—'); }
  function normalizarBusca(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function rotuloOrigem(nota) {
    return ({ os: 'OS', venda: 'Venda', compra: 'Compra', assinatura: 'Assinatura', avulsa: 'Avulsa' })[nota.origem_tipo] || 'Operação';
  }
  async function obterPdf(nota) {
    var dados = await chamar('obter_danfse', { id: nota.id });
    var url = String(dados.danfse?.url || '');
    if (!/^https:\/\//i.test(url)) throw new Error('O PDF oficial ainda não está disponível.');
    return url;
  }
  function itemNota(nota) {
    var item = document.createElement('article');
    item.className = 'fiscal-mobile-item';
    var titulo = document.createElement('strong');
    titulo.textContent = 'NFS-e ' + (nota.numero ? 'nº ' + nota.numero : 'em preparação');
    var origem = document.createElement('span');
    origem.className = 'fiscal-mobile-origem';
    origem.textContent = rotuloOrigem(nota) + (nota.origem_id ? ' ' + nota.origem_id : '') +
      (nota.cliente_nome ? ' · ' + nota.cliente_nome : '');
    var detalhe = document.createElement('span');
    detalhe.textContent = [nota.descricao || '', dinheiro(Math.round(Number(nota.valor || 0) * 100))].filter(Boolean).join(' · ');
    var situacao = document.createElement('small');
    situacao.className = 'fiscal-mobile-status-nota';
    situacao.textContent = 'Status: ' + (({ autorizada: 'Autorizada', na_fila: 'Aguardando autorização', processando: 'Processando', rejeitada: 'Rejeitada', cancelada: 'Cancelada', aguardando_configuracao: 'Aguardando ativação', rascunho: 'Rascunho' })[nota.status] || nota.status || 'Pendente');
    item.append(titulo, origem, detalhe, situacao);
    if (nota.ultimo_erro && nota.status === 'rejeitada') {
      var erro = document.createElement('small'); erro.textContent = 'Motivo: ' + nota.ultimo_erro; item.append(erro);
    }
    if (nota.status === 'autorizada') {
      var chave = document.createElement('small');
      chave.className = 'fiscal-mobile-chave';
      chave.textContent = nota.chave_acesso ? 'Chave de acesso: ' + nota.chave_acesso
        : nota.codigo_verificacao ? 'Código de verificação: ' + nota.codigo_verificacao
        : 'Chave ou código de verificação pendente de confirmação.';
      item.append(chave);
    }
    if (nota.status === 'autorizada' && (nota.danfse_storage_path || nota.danfse_url || nota.pdf_url)) {
      var acoes = document.createElement('div'); acoes.className = 'fiscal-mobile-acoes';
      var abrir = document.createElement('button');
      abrir.type = 'button'; abrir.className = 'btn-secundario'; abrir.textContent = 'Abrir DANFSe';
      abrir.addEventListener('click', async function () {
        if (abrir.disabled) return;
        abrir.disabled = true;
        try {
          var url = await obterPdf(nota);
          var navegador = root.Capacitor?.Plugins?.Browser;
          if (navegador?.open) await navegador.open({ url: url });
          else if (!root.open(url, '_blank', 'noopener,noreferrer')) throw new Error('Permita abrir o navegador para visualizar o documento.');
        } catch (erro) { aviso(erro.message || 'Falha ao abrir o DANFSe.'); }
        finally { abrir.disabled = false; }
      });
      var compartilhar = document.createElement('button');
      compartilhar.type = 'button'; compartilhar.className = 'btn-secundario'; compartilhar.textContent = 'Compartilhar';
      compartilhar.addEventListener('click', async function () {
        if (compartilhar.disabled) return;
        compartilhar.disabled = true;
        try {
          var url = await obterPdf(nota);
          await root.SistemaOSCompartilhar.compartilharPdfPorUrl(url, 'DANFSe-' + (nota.numero || nota.id) + '.pdf',
            'Compartilhar DANFSe', 'Segue o DANFSe da NFS-e ' + (nota.numero || nota.origem_id || '') +
            (nota.cliente_nome ? ' de ' + nota.cliente_nome : '') + '.');
        } catch (erro) { aviso(erro.message || 'Falha ao compartilhar o DANFSe.'); }
        finally { compartilhar.disabled = false; }
      });
      acoes.append(abrir, compartilhar); item.append(acoes);
    } else if (nota.status === 'autorizada') {
      var espera = document.createElement('small'); espera.textContent = 'PDF oficial ainda não recebido do provedor.'; item.append(espera);
    }
    return item;
  }
  function renderizarNotas() {
    var lista = $('fiscal-mobile-lista');
    if (!lista) return;
    var busca = normalizarBusca($('fiscal-mobile-pesquisa')?.value).trim();
    var encontradas = notasCarregadas.filter(function (nota) {
      if (!busca) return true;
      return normalizarBusca([nota.cliente_nome, nota.origem_tipo, nota.origem_id, nota.numero,
        nota.chave_acesso, nota.codigo_verificacao, nota.descricao].join(' ')).includes(busca);
    });
    lista.replaceChildren();
    encontradas.forEach(function (nota) { lista.append(itemNota(nota)); });
    if (!encontradas.length) {
      var vazio = document.createElement('p');
      vazio.textContent = busca ? 'Nenhuma nota corresponde à busca.' : 'Nenhuma nota fiscal registrada.';
      lista.append(vazio);
    }
  }
  async function carregar() {
    if ($('painel-fiscal')?.hidden) return;
    var token = ++geracao;
    var empresa = empresaAtual();
    status('Consultando notas fiscais…');
    try {
      var dados = await chamar('resumo', {});
      if (token !== geracao || empresa !== empresaAtual() || $('painel-fiscal').hidden) return;
      var cota = dados.cota || {};
      texto($('fiscal-mobile-limite'), cota.limite_gratuito_mensal);
      texto($('fiscal-mobile-usadas'), cota.utilizadas);
      texto($('fiscal-mobile-restantes'), cota.restantes_gratuitas);
      texto($('fiscal-mobile-preco'), dinheiro(cota.preco_excedente_centavos));
      texto($('fiscal-mobile-saldo'), Number(cota.debito_pendente_centavos || 0) > 0
        ? dinheiro(cota.saldo_centavos) + ' · débito ' + dinheiro(cota.debito_pendente_centavos)
        : dinheiro(cota.saldo_centavos));
      var habilitado = dados.emissor_operacional === true && dados.configuracao?.status === 'configurada' && dados.configuracao?.ambiente === 'producao';
      $('btn-recarga-fiscal-mobile').disabled = !habilitado;
      $('fiscal-mobile-recarga-ajuda').textContent = habilitado
        ? 'Crédito disponível somente após o Mercado Pago confirmar o pagamento.'
        : 'Recargas só ficam disponíveis após homologação da emissão fiscal em produção.';
      notasCarregadas = Array.isArray(dados.notas) ? dados.notas : [];
      renderizarNotas();
      status('Notas e saldo atualizados.');
    } catch (erro) {
      if (token === geracao) status(erro.message || 'Não foi possível consultar as notas fiscais.');
    } finally {
      if (timer) clearTimeout(timer);
      if (!$('painel-fiscal')?.hidden) timer = setTimeout(carregar, 30000);
    }
  }
  async function recarregarSaldo() {
    var botao = $('btn-recarga-fiscal-mobile');
    if (botao.disabled) return;
    var valor = String($('fiscal-mobile-valor').value || '').trim();
    if (!/^\d+(?:[,.]\d{1,2})?$/.test(valor)) { aviso('Informe um valor em reais com até duas casas decimais.'); return; }
    var centavos = Math.round(Number(valor.replace(',', '.')) * 100);
    if (centavos < 100 || centavos > 10000000) { aviso('A recarga deve ficar entre R$ 1,00 e R$ 100.000,00.'); return; }
    botao.disabled = true;
    try {
      var dados = await chamar('criar_recarga', { valorCentavos: centavos });
      if (!/^https:\/\//i.test(String(dados.link || ''))) throw new Error('Checkout indisponível.');
      var janela = root.open(dados.link, '_blank', 'noopener,noreferrer');
      if (!janela) throw new Error('Não foi possível abrir o Mercado Pago.');
      status('Pagamento aberto. O saldo será atualizado após a confirmação do Mercado Pago.');
    } catch (erro) { aviso(erro.message || 'Não foi possível iniciar a recarga.'); }
    finally { botao.disabled = false; }
  }
  $('btn-atualizar-fiscal-mobile')?.addEventListener('click', carregar);
  $('fiscal-mobile-pesquisa')?.addEventListener('input', renderizarNotas);
  $('btn-recarga-fiscal-mobile')?.addEventListener('click', recarregarSaldo);
  document.querySelectorAll('[data-fiscal-recarga]').forEach(function (botao) {
    botao.addEventListener('click', function () {
      $('fiscal-mobile-valor').value = (Number(botao.dataset.fiscalRecarga) / 100).toFixed(2).replace('.', ',');
    });
  });
  document.addEventListener('sistema-os:tela-fiscal-aberta', carregar);
})(window);
