(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('desbloqueioForm');
  if (!form || !window.api) return;

  const campos = {
    numero: $('desbloqueioNumero'), nome: $('desbloqueioClienteNome'), cpf: $('desbloqueioClienteCpf'),
    telefone: $('desbloqueioClienteTelefone'), marca: $('desbloqueioMarca'), modelo: $('desbloqueioModelo'),
    cor: $('desbloqueioCor'), imei: $('desbloqueioImei'), tipo: $('desbloqueioTipo'),
    valor: $('desbloqueioValor'), procedimento: $('desbloqueioProcedimento'), observacoes: $('desbloqueioObservacoes'),
    titularidade: $('desbloqueioTitularidade')
  };
  let registros = [];
  let ocupado = false;

  function mensagem(texto, erro) {
    const el = $('desbloqueioMensagem');
    el.textContent = texto || '';
    el.className = 'desbloqueio-mensagem ' + (texto ? (erro ? 'erro' : 'ok') : '');
  }
  function formatarData(valor) {
    const d = new Date(valor || '');
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
  }
  function statusDo(item) {
    if (item.assinaturaClienteBase64) return { classe: 'assinado', texto: 'Assinado' };
    if (item.assinaturaPendente) return { classe: 'pendente', texto: 'Aguardando assinatura' };
    return { classe: 'nao-assinado', texto: 'Não assinado' };
  }
  function botao(texto, classe, acao) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'botao ' + classe; b.textContent = texto;
    b.addEventListener('click', acao); return b;
  }
  function limpar() {
    form.reset(); campos.numero.value = ''; mensagem(''); campos.nome.focus();
  }
  function dadosForm() {
    return {
      numero: campos.numero.value,
      cliente: { nome: campos.nome.value.trim(), cpf: campos.cpf.value.trim(), telefone: campos.telefone.value.trim() },
      aparelho: { marca: campos.marca.value.trim(), modelo: campos.modelo.value.trim(), cor: campos.cor.value.trim(), imei: campos.imei.value.trim() },
      tipoBloqueio: campos.tipo.value,
      valor: Number(campos.valor.value) || 0,
      procedimentoPrevisto: campos.procedimento.value.trim(),
      observacoes: campos.observacoes.value.trim(),
      declaracaoTitularidade: campos.titularidade.checked
    };
  }
  function validar() {
    const obrigatorios = [campos.nome, campos.marca, campos.modelo, campos.tipo];
    const vazio = obrigatorios.find(el => !el.value.trim());
    form.querySelectorAll('[aria-invalid=true]').forEach(el => el.removeAttribute('aria-invalid'));
    if (vazio) { vazio.setAttribute('aria-invalid', 'true'); vazio.focus(); mensagem('Preencha o campo obrigatório destacado.', true); return false; }
    if (!campos.titularidade.checked) { campos.titularidade.focus(); mensagem('Confirme a declaração de titularidade e ciência dos riscos.', true); return false; }
    return true;
  }
  async function salvar(modo) {
    if (ocupado || !validar()) return;
    ocupado = true;
    const botoes = [$('desbloqueioNaoAssinado'), $('desbloqueioEnviar')];
    botoes.forEach(b => { b.disabled = true; });
    mensagem(modo === 'enviar' ? 'Enviando com segurança para o celular…' : 'Gerando o PDF…');
    try {
      const resultado = await window.api.desbloqueiosalvar(dadosForm(), modo, null);
      if (!resultado?.sucesso) throw new Error(resultado?.erro || 'Não foi possível salvar a autorização.');
      const numero = resultado.documento?.numero || '';
      limpar();
      mensagem(modo === 'enviar' ? `${numero} enviada para a aba Documentos do celular.` : `${numero} gerada como não assinada.`);
      await carregar();
    } catch (erro) {
      mensagem(erro?.message || String(erro), true);
    } finally {
      ocupado = false; botoes.forEach(b => { b.disabled = false; });
    }
  }
  function editar(item) {
    campos.numero.value = item.numero || '';
    campos.nome.value = item.cliente?.nome || ''; campos.cpf.value = item.cliente?.cpf || ''; campos.telefone.value = item.cliente?.telefone || '';
    campos.marca.value = item.aparelho?.marca || ''; campos.modelo.value = item.aparelho?.modelo || ''; campos.cor.value = item.aparelho?.cor || ''; campos.imei.value = item.aparelho?.imei || '';
    campos.tipo.value = item.tipoBloqueio || ''; campos.valor.value = item.valor || '';
    campos.procedimento.value = item.procedimentoPrevisto || ''; campos.observacoes.value = item.observacoes || '';
    campos.titularidade.checked = item.declaracaoTitularidade === true;
    mensagem(`Editando ${item.numero}. Ao salvar, uma assinatura anterior será invalidada para proteger o cliente.`);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function abrirPdf(item) {
    try {
      let caminho = item.pdfPath;
      if (!caminho) caminho = await window.api.desbloqueiogerarpdf(item.numero);
      const r = await window.api.desbloqueioabrirpdf(caminho);
      if (r && r.sucesso === false) throw new Error(r.erro);
    } catch (erro) { mensagem(erro?.message || String(erro), true); }
  }
  async function imprimirTermico(item) {
    try {
      const escolha = typeof window.escolherOpcaoModal === 'function'
        ? await window.escolherOpcaoModal({
          titulo: 'Imprimir autorização',
          mensagem: 'Escolha a largura da bobina configurada na impressora.',
          alternativas: [
            { valor: '80mm', titulo: 'Bobina 80 mm', descricao: 'Mais espaço e melhor leitura.' },
            { valor: '58mm', titulo: 'Bobina 58 mm', descricao: 'Versão compacta.' }
          ]
        })
        : '80mm';
      if (!escolha) return;
      await window.api.desbloqueioimprimirtermico(item.numero, escolha, '');
      mensagem(`${item.numero} enviada para impressão em ${escolha}.`);
    } catch (erro) { mensagem(erro?.message || String(erro), true); }
  }
  async function excluir(item) {
    try {
      const r = await window.api.desbloqueioexcluir(item.numero, null);
      if (r?.cancelado) return;
      if (!r?.sucesso) throw new Error(r?.erro || 'Não foi possível excluir.');
      mensagem(`${item.numero} excluída do computador e da fila de assinatura.`);
      await carregar();
    } catch (erro) { mensagem(erro?.message || String(erro), true); }
  }
  function renderizar() {
    const termo = $('desbloqueioBusca').value.trim().toLocaleLowerCase('pt-BR');
    const lista = registros.filter(item => !termo || [item.numero,item.cliente?.nome,item.cliente?.cpf,item.aparelho?.marca,item.aparelho?.modelo,item.aparelho?.imei].some(v => String(v||'').toLocaleLowerCase('pt-BR').includes(termo)));
    $('desbloqueioContagem').textContent = `${lista.length} ${lista.length === 1 ? 'autorização' : 'autorizações'}`;
    const destino = $('desbloqueioLista'); destino.replaceChildren();
    if (!lista.length) { const p=document.createElement('p'); p.className='vazio'; p.textContent=termo?'Nenhum resultado para esta busca.':'Nenhuma autorização emitida.'; destino.appendChild(p); return; }
    lista.forEach(item => {
      const estado=statusDo(item), card=document.createElement('article'); card.className='desbloqueio-item';
      const topo=document.createElement('div'); topo.className='desbloqueio-item-topo';
      const titulo=document.createElement('div'); const strong=document.createElement('strong'); strong.textContent=item.numero; const small=document.createElement('small'); small.textContent=`${item.cliente?.nome||'Cliente'} · ${formatarData(item.criadoEm)}`; titulo.append(strong,small);
      const selo=document.createElement('span'); selo.className=`desbloqueio-selo ${estado.classe}`; selo.textContent=estado.texto; topo.append(titulo,selo);
      const dados=document.createElement('div'); dados.className='desbloqueio-item-dados';
      [['Aparelho',[item.aparelho?.marca,item.aparelho?.modelo].filter(Boolean).join(' ')||'—'],['Tipo',item.tipoBloqueio||'—']].forEach(([r,v])=>{const s=document.createElement('span');s.textContent=r;const b=document.createElement('b');b.textContent=v;s.appendChild(b);dados.appendChild(s);});
      const acoes=document.createElement('div'); acoes.className='desbloqueio-item-acoes';
      acoes.append(botao('Abrir PDF','botao-fantasma',()=>abrirPdf(item)),botao('Térmico','botao-fantasma',()=>imprimirTermico(item)),botao('Editar','botao-fantasma',()=>editar(item)),botao('Excluir','botao-perigo',()=>excluir(item)));
      card.append(topo,dados,acoes); destino.appendChild(card);
    });
  }
  async function carregar() {
    try { registros = await window.api.desbloqueiolistar() || []; renderizar(); }
    catch (erro) { mensagem('Não foi possível carregar as autorizações: '+(erro?.message||erro), true); }
  }
  $('desbloqueioNaoAssinado').addEventListener('click', () => salvar('nao_assinado'));
  $('desbloqueioEnviar').addEventListener('click', () => salvar('enviar'));
  $('desbloqueioNovo').addEventListener('click', limpar);
  $('desbloqueioBusca').addEventListener('input', renderizar);
  document.querySelector('[data-aba="desbloqueios"]')?.addEventListener('click', carregar);
  window.api.desbloqueiotermos().then(texto => { $('desbloqueioTermos').textContent = texto || ''; }).catch(()=>{});
})();
