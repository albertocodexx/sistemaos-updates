(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const grupos = { os: 'OS', estoque: 'Aparelhos', compra: 'Compras', peca: 'Peças', tabelaPrecos: 'Tabela de preços', config: 'Configurações', entrega: 'Entregas', garantia: 'Garantias', ia: 'Assistente IA', pag: 'Pagamentos', cobranca: 'Cobranças', auth: 'Usuários', cargos: 'Cargos', whatsapp: 'WhatsApp' };
  const acoes = { criar: 'criação', atualizar: 'edição', editar: 'edição', excluir: 'exclusão', salvar: 'alteração', salvarFoto: 'foto adicionada', substituirFoto: 'foto substituída', excluirFoto: 'foto removida', executarAcao: 'ação confirmada', confirmarPagamentoPresencial: 'pagamento confirmado' };
  const campos = { valor: 'Preço', valorVenda: 'Preço de venda', valorPago: 'Valor da compra', valorGastoPecas: 'Custo das peças', valorEstimado: 'Valor estimado', valorTotalServico: 'Valor do serviço', fotos: 'Fotos', status: 'Status', statusPagamento: 'Pagamento', quantidade: 'Quantidade', observacoes: 'Observações', nome: 'Nome', modelo: 'Modelo', peca: 'Peça' };
  let permitido = false, dialogo, versao = 0;
  function elemento(tag, texto, classe) {
    const el = document.createElement(tag);
    if (texto !== undefined) el.textContent = texto;
    if (classe) el.className = classe;
    return el;
  }
  function valor(v, campo = '') {
    if (v === null || v === undefined || v === '') return 'Não informado';
    if (typeof v === 'number' && /^(valor|preco|custo)/i.test(campo)) return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function fechar() { versao++; dialogo?.close(); $('auditoriaLista')?.replaceChildren(); }
  function criarDialogo() {
    if (dialogo) return;
    dialogo = elemento('dialog', undefined, 'auditoria-dialog');
    dialogo.setAttribute('aria-labelledby', 'auditoriaTitulo');
    dialogo.innerHTML = `<header class="auditoria-cabecalho"><div><h2 id="auditoriaTitulo">Histórico de atividades</h2><p>Quem mudou, o que mudou e quando. Somente administradores.</p></div><button id="auditoriaFechar" type="button" class="botao botao-fantasma" aria-label="Fechar histórico">Fechar</button></header>
      <div class="auditoria-conteudo"><form id="auditoriaFiltros" class="auditoria-filtros">
      <label>Buscar<input id="auditoriaBusca" type="search" placeholder="Pessoa, OS, preço ou campo…" maxlength="200"></label>
      <label>De<input id="auditoriaInicio" type="date"></label><label>Até<input id="auditoriaFim" type="date"></label>
      <label>Área<select id="auditoriaArea"><option value="">Todas</option></select></label>
      <button class="botao botao-primario" id="auditoriaConsultar" type="submit">Consultar</button></form>
      <p id="auditoriaStatus" class="auditoria-status" role="status" aria-live="polite"></p><div id="auditoriaLista" class="auditoria-lista"></div></div>`;
    document.body.appendChild(dialogo);
    for (const [chave, titulo] of Object.entries(grupos)) {
      const option = elemento('option', titulo); option.value = chave + ':'; $('auditoriaArea').appendChild(option);
    }
    $('auditoriaFechar').addEventListener('click', fechar);
    dialogo.addEventListener('cancel', () => { versao++; $('auditoriaLista').replaceChildren(); });
    $('auditoriaFiltros').addEventListener('submit', evento => { evento.preventDefault(); consultar(); });
  }
  function desenhar(itens) {
    const lista = $('auditoriaLista'); lista.replaceChildren();
    if (!itens.length) { lista.appendChild(elemento('p', 'Nenhuma atividade neste filtro. Novas alterações aparecerão aqui.', 'auditoria-vazio')); return; }
    for (const item of itens) {
      const card = elemento('details', undefined, 'auditoria-item');
      const cabecalho = elemento('summary');
      const data = new Date(item.data);
      const tempo = elemento('time', Number.isFinite(data.getTime()) ? data.toLocaleString('pt-BR') : 'Data não informada');
      const [grupo, acao] = String(item.acao || '').split(':');
      const titulo = (grupos[grupo] || grupo) + ' · ' + (acoes[acao] || String(acao || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
      cabecalho.append(tempo, elemento('strong', item.usuario?.nome || 'Sistema'), elemento('span', titulo + (item.registro ? ' · ' + item.registro : '')), elemento('small', ({ concluido: 'Concluído', recusado: 'Recusado', cancelado: 'Cancelado', erro: 'Falhou' })[item.status] || 'Registrado'));
      card.appendChild(cabecalho);
      const detalhes = elemento('div', undefined, 'auditoria-detalhes');
      if (!item.alteracoes?.length) detalhes.appendChild(elemento('p', 'Ação registrada sem diferenças de campos disponíveis.'));
      for (const mudanca of item.alteracoes || []) {
        const linha = elemento('div', undefined, 'auditoria-mudanca');
        const chave = String(mudanca.campo || '').split('.').pop();
        linha.append(elemento('strong', campos[chave] || mudanca.campo), elemento('span', valor(mudanca.antes, chave), 'auditoria-antes'), elemento('span', '→'), elemento('span', valor(mudanca.depois, chave)));
        detalhes.appendChild(linha);
      }
      card.appendChild(detalhes); lista.appendChild(card);
    }
  }
  async function consultar() {
    if (!permitido) return;
    const pedido = ++versao;
    $('auditoriaStatus').textContent = 'Consultando atividades…'; $('auditoriaConsultar').disabled = true;
    try {
      const resposta = await window.api.auditorialistar({ busca: $('auditoriaBusca').value, inicio: $('auditoriaInicio').value, fim: $('auditoriaFim').value, acao: $('auditoriaArea').value, limite: 200 });
      if (pedido !== versao || !permitido) return;
      desenhar(resposta.itens || []);
      $('auditoriaStatus').textContent = `${resposta.itens?.length || 0} atividades recentes deste computador. Senhas e chaves não são exibidas.` + (resposta.limitado ? ' A consulta foi limitada aos registros mais recentes.' : '');
    } catch (_) { if (pedido === versao) { $('auditoriaLista').replaceChildren(); $('auditoriaStatus').textContent = 'Não foi possível consultar. Confirme seu acesso de administrador e tente novamente.'; } }
    finally { if (pedido === versao) $('auditoriaConsultar').disabled = false; }
  }
  $('btnHistoricoAtividades')?.addEventListener('click', () => { if (!permitido) return; criarDialogo(); dialogo.showModal(); consultar(); });
  document.addEventListener('sistemaos:sessao-pronta', evento => {
    const u = evento.detail;
    permitido = !!u && !u.acessoSomenteCobranca && (u.admin === true || u.administradorGlobal === true);
    $('configHistoricoAtividades')?.classList.toggle('escondido', !permitido);
    fechar();
  });
})();
