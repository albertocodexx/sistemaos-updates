// Move os controles existentes: IDs, listeners, validação e dados permanecem intactos.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  function campo(id) { return $(id)?.closest('.campo, .campo-checkbox'); }
  function detalhe(titulo, elementos) {
    const nodes = [...new Set(elementos.filter(Boolean))];
    if (!nodes.length) return null;
    const d = document.createElement('details');
    d.className = 'form-detalhes';
    const s = document.createElement('summary');
    s.textContent = titulo;
    const conteudo = document.createElement('div');
    conteudo.className = 'form-detalhes-conteudo';
    d.append(s, conteudo);
    nodes[0].before(d);
    nodes.forEach(n => conteudo.append(n));
    return d;
  }
  function opcionais(titulo, ids) { return detalhe(titulo, ids.map(campo)); }
  // Aposentados no formulário, inclusive em "Expandir tudo". Mantidos somente
  // para os leitores/salvadores legados preservarem os registros antigos.
  function retirar(ids) { ids.map(campo).filter(Boolean).forEach(n => { n.hidden = true; n.classList.add('form-retirado'); }); }
  function rotulo(id, texto) {
    const label = campo(id)?.querySelector('label');
    if (label) label.textContent = texto;
  }
  function criarCard(titulo) {
    const c = document.createElement('div');
    c.className = 'card';
    const t = document.createElement('div');
    t.className = 'card-titulo'; t.textContent = titulo;
    c.append(t); return c;
  }
  function organizarOS(edicao) {
    const raiz = document.querySelector(edicao ? '#modalEditarOS .formulario-layout' : '#aba-nova-os .formulario-layout');
    if (!raiz || raiz.dataset.layoutEnxuto) return;
    raiz.dataset.layoutEnxuto = 'true';
    const id = (novo, edit) => edicao ? edit : novo;
    const cliente = $(id('nome', 'editNome')).closest('.card');
    const aparelho = $(id('marca', 'editMarca')).closest('.card');
    retirar([id('email','editEmail'), id('codigoInterno','editCodigoInterno'), id('etiquetaInterna','editEtiquetaInterna'),
      id('tagBancada','editTagBancada'), id('numeroPatrimonio','editNumeroPatrimonio'), id('tecnicoAuxiliar','editTecnicoAuxiliar'),
      id('diagPecas','editDiagPecas'), id('diagPrazoEstimado','editDiagPrazoEstimado'), id('diagDiagnostico','editDiagDiagnostico'),
      id('obsEntrada','editObsEntrada'), id('obsSaida','editObsSaida')]);
    rotulo(id('observacoes','editObs'), 'Condição do aparelho / observação');
    rotulo(id('diagSolucao','editDiagSolucao'), 'Serviço previsto ou realizado');
    const servico = campo(id('diagSolucao','editDiagSolucao'));
    if (servico) aparelho.append(servico);
    const recebimento = $(id('checklistAcessoriosNovo','checklistAcessoriosEdit'));
    // A lista de acessórios e o texto adicional pertencem à mesma conferência.
    rotulo(id('acessorios','editAcessorios'), 'Outros acessórios recebidos');
    const acessorios = campo(id('acessorios','editAcessorios'));
    if (recebimento) recebimento.closest('.campo').append(acessorios);
    else opcionais('Outros acessórios recebidos', [id('acessorios','editAcessorios')]);

    const atendimento = criarCard('Valor, prazo e status');
    atendimento.dataset.formEssencial = 'true';
    atendimento.classList.add('form-atendimento');
    raiz.append(atendimento);
    const grade = document.createElement('div'); grade.className = 'grade-2';
    atendimento.append(grade);
    [id('diagValorEstimado','editDiagValorEstimado'), id('statusOS','editStatusOS'),
      ...(edicao ? ['editStatusAprovacao', 'editStatusPagamento'] : []),
      id('dataPrevista','editDataPrevista'), id('horaPrevista','editHoraPrevista'),
      id('semPrazoOS','editSemPrazoOS'), id('prioridadeOS','editPrioridadeOS')]
      .map(campo).filter(Boolean).forEach(n => grade.append(n));
    rotulo(id('diagValorEstimado','editDiagValorEstimado'), 'Valor do orçamento (R$)');
    $(id('diagValorEstimado','editDiagValorEstimado')).placeholder = 'A definir';
    const nota = document.createElement('p'); nota.className = 'dica-campo';
    nota.textContent = 'Valor previsto para cobrar do cliente. Informar o orçamento não registra um pagamento.';
    grade.firstElementChild.append(nota);
    // Parcelas são parte do financeiro essencial da OS. A simplificação anterior
    // deixava este editor no card antigo de Status, que acabava dentro dos extras.
    if (edicao) {
      const cobrancas = raiz.querySelector('.lembretes-cobranca-editor');
      if (cobrancas) {
        const tituloCobranca = cobrancas.querySelector('strong');
        const ajudaCobranca = cobrancas.querySelector('span');
        if (tituloCobranca) tituloCobranca.textContent = 'Parcelas e lembretes de cobrança';
        if (ajudaCobranca) ajudaCobranca.textContent = 'Informe a data e o valor de cada cobrança. A agenda e a situação aparecem também no celular.';
        cobrancas.dataset.formEssencial = 'true';
        atendimento.append(cobrancas);
      }
    }
    // Uma única previsão e um checklist de recebimento, sem solicitar os mesmos testes duas vezes.
    [id('checklistEntradaNovo','checklistEntradaEdit'), id('checklistSaidaNovo','checklistSaidaEdit')].forEach(cid => {
      const c = $(cid)?.closest('.card'); if (c) { c.hidden = true; c.classList.add('form-retirado'); }
    });

    const cards = [...raiz.querySelectorAll('.card')].filter(c => c !== atendimento);
    const principal = document.createElement('div'); principal.className = 'coluna-form form-cadastro';
    const lateral = document.createElement('div'); lateral.className = 'coluna-form form-atendimento-coluna';
    const extras = document.createElement('details'); extras.className = 'form-detalhes form-complementos';
    const summary = document.createElement('summary'); summary.textContent = 'Peças, checklist e fotos';
    const extraConteudo = document.createElement('div'); extraConteudo.className = 'form-complementos-grade';
    extras.append(summary, extraConteudo);
    [cliente, aparelho].forEach(c => { c.dataset.formEssencial = 'true'; principal.append(c); });
    lateral.append(atendimento);
    cards.filter(c => c !== cliente && c !== aparelho).forEach(c => {
      const titulo = c.querySelector('.card-titulo')?.textContent.trim() || '';
      if (titulo === 'Controle Operacional e Bancada') { c.hidden = true; c.classList.add('form-retirado'); }
      if (titulo === 'Diagnóstico Técnico') c.querySelector('.card-titulo').textContent = 'Peças e custo do reparo';
      if (c.querySelector('#btnSalvarOS')) { c.dataset.formEssencial = 'true'; lateral.append(c); }
      else if (c.querySelector('#termos, #editTermos')) {
        // Termos vêm preenchidos. A edição continua a um clique, sem ocupar meia tela.
        lateral.append(c); c.dataset.formTermos = 'true';
      } else if (c.querySelector('input,select,textarea,button,.lista-checklist,.galeria-fotos') || c.id) extraConteudo.append(c);
      else c.remove(); // Apenas cards explicativos vazios, nunca controles.
      if (titulo === 'Status da OS' || titulo === 'Previsão de Entrega') {
        if (!c.querySelector('input,select,textarea,button')) c.remove();
      }
    });
    [...raiz.children].forEach(n => n.remove());
    raiz.append(principal, lateral, extras);
  }
  function organizarOutros() {
    retirar(['cpVRg','cpVNascimento','cpVWhatsapp','cpVEmail','cpVEndereco','cpVNumero','cpVBairro','cpVCidade','cpVEstado','cpVCep',
      'cpAImei2','cpANumeroSerie','cpAEmailSenha','cpAvDescricao','cpAvObs','cpDObs','cpDChavePix']);
    rotulo('cpAImei1', 'IMEI / série (opcional)');
    rotulo('cpAvDefeitosInfo', 'Defeito informado pelo vendedor');
    rotulo('cpAvDefeitosEnc', 'Condição verificada pela assistência');
    const compra = document.querySelector('#modalFormCompra .modal-compra-conteudo');
    if (compra) {
      // O valor vem antes das avaliações e do contrato, não depois de várias telas.
      const dispositivo = $('cpAMarca')?.closest('.card');
      const pagamento = $('cpDValor')?.closest('.card');
      if (dispositivo && pagamento) dispositivo.after(pagamento);
      ['cpVNome','cpAMarca','cpDValor'].forEach(id => $(id)?.closest('.card').setAttribute('data-form-essencial','true'));
      const conta = $('cpAContaVinculada')?.closest('.grade-2')?.parentElement;
      detalhe('Contas vinculadas — conferir ao comprar', [conta]);
      const grupos = [...(dispositivo?.children || [])].filter(n => n.querySelector('.cp-acessorio,.cp-situacao'));
      detalhe('Conferência de acessórios e funcionamento', grupos);
    }
    const dados = $('sub-dados');
    if (dados) {
      const precos = criarCard('Valores do aparelho');
      const grade = document.createElement('div'); grade.className = 'grade-2'; precos.append(grade);
      ['estValorPago','estValorPecas','estGastosExtras','estValorVenda'].map(campo).filter(Boolean).forEach(n => grade.append(n));
      dados.append(precos);
      const resumo = $('resumoFinanceiro'); if (resumo) precos.append(resumo);
      const aviso = document.createElement('p'); aviso.className = 'dica-campo';
      aviso.textContent = 'Na aba Financeiro, detalhe as peças utilizadas e calcule a sugestão de preço.'; precos.append(aviso);
    }
    ['estTermosVenda','garTermos'].forEach(id => detalhe('Conferir ou editar os termos do PDF', [$(id)?.closest('.termos-editor')]));
    retirar(['pecaLocalizacao']);
  }
  function revelar(el) {
    for (let n = el?.parentElement; n; n = n.parentElement) {
      if (n.tagName === 'DETAILS') n.open = true;
      if (n.classList.contains('card-recolhivel')) {
        n.dataset.recolhido = 'false'; n.querySelector('.card-titulo')?.setAttribute('aria-expanded','true');
      }
    }
  }
  function iniciar() {
    organizarOS(false); organizarOS(true); organizarOutros();
    document.addEventListener('invalid', e => revelar(e.target), true);
    document.addEventListener('focusin', e => revelar(e.target));
    // Validações legadas sinalizam os campos por classe, não por validity.
    const observer = new MutationObserver(ms => ms.forEach(m => {
      const n = m.target;
      if (n.matches?.('.campo-invalido,.invalido,[aria-invalid="true"]')) revelar(n);
    }));
    document.querySelectorAll('input,select,textarea,.campo').forEach(n => observer.observe(n, { attributes:true, attributeFilter:['class','aria-invalid'] }));
  }
  window.SistemaOSFormLayout = { revelar };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, {once:true}); else iniciar();
})();
