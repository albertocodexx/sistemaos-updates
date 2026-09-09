// Organização visual sem clonar campos nem mudar o contrato dos documentos.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  function bloco(id) {
    const input = $(id);
    if (!input) return null;
    if (input.closest('.form-campo')) return input.closest('.form-campo');
    const labelPai = input.closest('label');
    if (labelPai) return labelPai;
    const control = input.closest('.campo-senha-pin') || input;
    const label = document.querySelector('label[for="' + id + '"]');
    if (!label || label.parentElement !== control.parentElement) return null;
    const wrapper = document.createElement('div'); wrapper.className = 'form-campo';
    label.before(wrapper);
    wrapper.append(label, control);
    // Mensagens e dicas devem acompanhar o controle na revelação da validação.
    while (wrapper.nextElementSibling?.matches('p.erro-campo,p.dica-campo,p.aviso-tecnico')) wrapper.append(wrapper.nextElementSibling);
    return wrapper;
  }
  function detalhe(titulo, nodes) {
    nodes = [...new Set(nodes.filter(Boolean))];
    if (!nodes.length) return;
    const d = document.createElement('details'); d.className = 'form-detalhes';
    const s = document.createElement('summary'); s.textContent = titulo;
    const body = document.createElement('div'); body.className = 'form-detalhes-conteudo';
    d.append(s, body); nodes[0].before(d); nodes.forEach(n => body.append(n)); return d;
  }
  function opcionais(titulo, ids) { return detalhe(titulo, ids.map(bloco)); }
  function retirar(ids) { ids.map(bloco).filter(Boolean).forEach(n => { n.hidden = true; n.classList.add('form-retirado'); }); }
  function fotos(tipo) {
    const input = $('input-foto-' + tipo); const grade = $('grade-foto-' + tipo);
    const cab = $('btn-add-foto-' + tipo)?.closest('.fotos-anexo-cabecalho');
    if (cab && grade) detalhe('Fotos do aparelho', [cab.previousElementSibling, cab, input, grade]);
  }
  function rotulo(id, texto) {
    const el = document.querySelector('label[for="' + id + '"]'); if (el) el.textContent = texto;
  }
  function iniciar() {
    retirar(['cliente-email','os-observacoes','compra-vendedor-rg','compra-vendedor-endereco',
      'compra-aparelho-imei2','compra-conta-email-senha','compra-avaliacao-descricao',
      'compra-avaliacao-observacoes','compra-chave-pix','compra-observacoes','venda-comprador-email','peca-mobile-local']);
    rotulo('aparelho-observacoes', 'Condição física do aparelho');
    const grupos = [...document.querySelectorAll('#form-os .checklist-recebimento-mobile')];
    const conteudo = grupos.flatMap(g => [g.previousElementSibling, g]);
    const adicionais = bloco('aparelho-acessorios');
    const conferencia = detalhe('Conferência de entrada e acessórios', conteudo);
    if (conferencia && adicionais) conferencia.lastElementChild.append(adicionais);
    rotulo('aparelho-acessorios', 'Outros acessórios (não listados acima)');
    fotos('os');
    fotos('compra'); fotos('entrega');
    // Pagamento precede avaliação/fotos: nunca fica depois de blocos opcionais.
    const compra = $('form-compra');
    const aparelho = $('compra-aparelho-modelo')?.closest('fieldset');
    const pagamento = $('compra-valor')?.closest('fieldset');
    if (aparelho && pagamento) aparelho.after(pagamento);
    const defeitos = bloco('compra-avaliacao-defeitos');
    if (aparelho && defeitos) aparelho.append(defeitos);
    rotulo('compra-avaliacao-defeitos', 'Condição e defeitos do aparelho');
    if (compra) [...compra.querySelectorAll(':scope > fieldset')].forEach(f => {
      const titulo = f.querySelector('legend')?.textContent || '';
      if (/Avaliação/.test(titulo)) { f.hidden = true; f.classList.add('form-retirado'); }
      if (/Fotos/.test(titulo)) detalhe(titulo, [f]);
    });
    opcionais('Editar os termos da garantia', ['entrega-termos-garantia']);
    const entregaValor = bloco('entrega-valor-reparo');
    const entregaPagamento = bloco('entrega-forma-pagamento');
    const retirada = $('entrega-numero-os')?.closest('fieldset');
    if (retirada && entregaValor && entregaPagamento) {
      const f = document.createElement('fieldset'); const l = document.createElement('legend');
      l.textContent = 'Valor e pagamento'; f.append(l, entregaValor, entregaPagamento); retirada.after(f);
    }
    // Pequenos cadastros já têm valor, situação e quantidade à vista; apenas notas são opcionais.
    document.querySelectorAll('form').forEach(f => {
      if (f.matches('#form-config,#form-login,#form-nova-senha')) return;
      f.querySelectorAll('input,select,textarea').forEach(el => {
        if (el.type !== 'hidden' && el.type !== 'file') el.classList.add('form-controle');
      });
    });
    document.addEventListener('invalid', e => revelar(e.target), true);
    document.addEventListener('focusin', e => revelar(e.target));
    const observador = new MutationObserver(ms => ms.forEach(m => {
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (el?.matches('[aria-invalid="true"],.campo-invalido,.invalido') || el?.closest('.erro-campo')?.textContent.trim()) revelar(el);
    }));
    document.querySelectorAll('.erro-campo,input,select,textarea').forEach(el => observador.observe(el, {
      attributes:true,attributeFilter:['class','aria-invalid'],childList:true,characterData:true,subtree:true
    }));
  }
  function revelar(el) { for (let n = el?.parentElement; n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true; }
  window.SistemaOSFormLayout = { revelar };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, {once:true}); else iniciar();
})();
