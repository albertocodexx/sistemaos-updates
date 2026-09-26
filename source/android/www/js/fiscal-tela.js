(function (root) {
  'use strict';
  var geracao = 0;
  var timer = null;
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
  function itemNota(nota) {
    var item = document.createElement('article');
    item.className = 'fiscal-mobile-item';
    var titulo = document.createElement('strong');
    titulo.textContent = 'NFS-e ' + (nota.numero || nota.origem_id || 'sem número');
    var detalhe = document.createElement('span');
    detalhe.textContent = [nota.descricao || '', dinheiro(Math.round(Number(nota.valor || 0) * 100))].filter(Boolean).join(' · ');
    var situacao = document.createElement('small');
    situacao.textContent = ({ autorizada: 'Autorizada', na_fila: 'Aguardando autorização', processando: 'Processando', rejeitada: 'Rejeitada', cancelada: 'Cancelada', aguardando_configuracao: 'Aguardando ativação' })[nota.status] || nota.status || 'Pendente';
    item.append(titulo, detalhe, situacao);
    if (nota.status === 'autorizada' && (nota.danfse_storage_path || nota.danfse_url || nota.pdf_url)) {
      var botao = document.createElement('button');
      botao.type = 'button'; botao.className = 'btn-secundario'; botao.textContent = 'Compartilhar DANFSe';
      botao.addEventListener('click', async function () {
        if (botao.disabled) return;
        botao.disabled = true;
        try {
          var dados = await chamar('obter_danfse', { id: nota.id });
          var url = String(dados.danfse?.url || '');
          if (!/^https:\/\//i.test(url)) throw new Error('O PDF oficial ainda não está disponível.');
          await root.SistemaOSCompartilhar.compartilharPdfPorUrl(url, 'DANFSe-' + (nota.numero || nota.id) + '.pdf',
            'Compartilhar DANFSe', 'Segue o DANFSe da NFS-e ' + (nota.numero || nota.origem_id || '') + '.');
        } catch (erro) { aviso(erro.message || 'Falha ao compartilhar o DANFSe.'); }
        finally { botao.disabled = false; }
      });
      item.append(botao);
    } else if (nota.status === 'autorizada') {
      var espera = document.createElement('small'); espera.textContent = 'PDF oficial ainda não recebido do provedor.'; item.append(espera);
    }
    return item;
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
      var lista = $('fiscal-mobile-lista');
      lista.replaceChildren();
      (dados.notas || []).forEach(function (nota) { lista.append(itemNota(nota)); });
      if (!lista.children.length) { var vazio = document.createElement('p'); vazio.textContent = 'Nenhuma nota fiscal registrada.'; lista.append(vazio); }
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
  $('btn-recarga-fiscal-mobile')?.addEventListener('click', recarregarSaldo);
  document.querySelectorAll('[data-fiscal-recarga]').forEach(function (botao) {
    botao.addEventListener('click', function () {
      $('fiscal-mobile-valor').value = (Number(botao.dataset.fiscalRecarga) / 100).toFixed(2).replace('.', ',');
    });
  });
  document.addEventListener('sistema-os:tela-fiscal-aberta', carregar);
})(window);
