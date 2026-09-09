// renderer.js — v4

// ── Sincroniza versão exibida na tela de login com a versão real ──
// O HTML estático (index.html) traz um número de versão fixo no <title>
// e nos badges da tela de login, que fica desatualizado a cada release
// (o Alberto via "v26.6.1" mesmo já tendo atualizado para uma versão mais
// nova). Aqui usamos a mesma fonte de verdade que o módulo de atualização
// já usa (window.api.updateVersaoAtual() → package.json) para corrigir
// esses textos assim que a página carrega, antes mesmo do login.

const { porId: $ } = window.RendererDom;
const { data: fmtData, dataHora: fmtDataHora, moeda: fmtMoeda } = window.RendererFormatters;

window.api.onModoSegundoPlano?.((estado) => {
  const ativo = estado?.ativo === true;
  window.__SISTEMA_OS_MODO_SEGUNDO_PLANO__ = ativo;
  document.documentElement.classList.toggle('modo-segundo-plano', ativo);
  if (ativo) {
    document.querySelectorAll('video, audio').forEach((midia) => midia.pause?.());
  }
  window.dispatchEvent(new CustomEvent('sistemaos:modo-segundo-plano', { detail: estado || {} }));
});
const {
  CHECK: ICONE_CHECK,
  X: ICONE_X,
  ESTRELA: ICONE_ESTRELA,
  LAPIS: ICONE_LAPIS,
  DOCUMENTO: ICONE_DOCUMENTO,
  LISTA: ICONE_LISTA,
  PASTA: ICONE_PASTA,
  CELULAR: ICONE_CELULAR,
  CELULAR_OFF: ICONE_CELULAR_OFF,
  LIXEIRA: ICONE_LIXEIRA,
  SYNC: ICONE_SYNC,
  ESCUDO: ICONE_ESCUDO,
  OLHO: ICONE_OLHO,
  FERRAMENTA: ICONE_FERRAMENTA,
  BUSCAR: ICONE_BUSCAR,
  CAIXA: ICONE_CAIXA,
  CARRINHO: ICONE_CARRINHO,
  CIFRAO: ICONE_CIFRAO,
  CARTAO: ICONE_CARTAO,
  ETIQUETA: ICONE_ETIQUETA,
  EXPORTAR: ICONE_EXPORTAR,
  IMPORTAR: ICONE_IMPORTAR,
  PLUGUE: ICONE_PLUGUE,
  CANETA: ICONE_CANETA,
  BALAO: ICONE_BALAO,
  ENVELOPE: ICONE_ENVELOPE,
  IMPRESSORA: ICONE_IMPRESSORA,
  BOLA_VERDE: ICONE_BOLA_VERDE,
  BOLA_AMARELA: ICONE_BOLA_AMARELA,
  BOLA_VERMELHA: ICONE_BOLA_VERMELHA,
  BOLA_CINZA: ICONE_BOLA_CINZA,
  SOL: ICONE_SOL,
  LUA: ICONE_LUA,
  PESSOA: ICONE_PESSOA,
  CONFIG: ICONE_CONFIG,
  SINO: ICONE_SINO,
  RAIO: ICONE_RAIO,
  PIN: ICONE_PIN,
  CLIPE: ICONE_CLIPE,
  CAMERA: ICONE_CAMERA,
  RELOGIO: ICONE_RELOGIO,
  ACENO: ICONE_ACENO,
  ALERTA: ICONE_ALERTA,
  INFO: ICONE_INFO,
  WHATSAPP: ICONE_WHATSAPP
} = window.RendererIcons;

function textoModal(valor) {
  return String(valor || '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/^\s+|\s+$/g, '');
}

function _numeroMoedaSistema(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const texto = String(valor == null ? '' : valor).trim().replace(/^R\$\s*/i, '');
  if (!texto) return 0;
  return Number(texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto) || 0;
}

function _valorServicoOS(os) {
  return _numeroMoedaSistema(os?.valorTotalServico)
    || _numeroMoedaSistema(os?.diagnosticoTecnico?.valorEstimado)
    || _numeroMoedaSistema(os?.valorInvestido)
    || _numeroMoedaSistema(os?.valor)
    || 0;
}

function _statusPagamentoVisivel(os) {
  if (os?.entrada50Paga === true || Number(os?.percentualPagamentoConfirmado) === 50) {
    const primeira = os?.modalidadeParcela1 || os?.modalidadePagamentoAprovacao || '';
    const segunda = os?.modalidadeParcela2 || (primeira === 'online' ? 'presencial' : 'online');
    if (primeira || segunda) return `50% ${primeira === 'online' ? 'remoto' : 'presencial'} pago · 50% ${segunda === 'online' ? 'remoto' : 'presencial'} pendente`;
    return '50% pago · 50% pendente';
  }
  if (['Pago', 'Autorizado'].includes(os?.statusPagamento) || Number(os?.percentualPagamentoConfirmado) === 100) {
    return '100% pago';
  }
  if (os?.statusPagamento === 'Aguardando Pagamento Presencial') {
    const percentual = Number(os?.percentualPagamentoAguardado) || 100;
    return `Aguardando ${percentual}% presencial`;
  }
  if (os?.statusPagamento === 'Pagamento 50/50') return '50% presencial + 50% remoto';
  if (os?.statusPagamento === 'Pagamento 50/50 remoto') return '50% remoto + 50% remoto';
  if (os?.statusPagamento === 'Pagamento 50/50 presencial') return '50% presencial + 50% presencial';
  return os?.statusPagamento || '';
}

function _valorCobradoOS(os) {
  const total = _valorServicoOS(os);
  if (!(total > 0)) return 0;
  const confirmado = _numeroMoedaSistema(os?.valorRecebidoConfirmado);
  if (confirmado > 0) return Math.min(total, confirmado);
  if (['Pago', 'Autorizado'].includes(os?.statusPagamento) || Number(os?.percentualPagamentoConfirmado) >= 100) return total;
  if (os?.entrada50Paga === true || Number(os?.percentualPagamentoConfirmado) === 50) return Number((total / 2).toFixed(2));
  return 0;
}

function _aparelhoSemRepeticao(marca, modelo) {
  const m = String(marca || '').trim();
  const d = String(modelo || '').trim();
  const normalizar = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const mn = normalizar(m); const dn = normalizar(d);
  if (mn && dn && mn === dn) return m;
  if (mn && dn && dn.startsWith(mn + ' ')) return d;
  return [m, d].filter(Boolean).join(' ');
}

// Fonte unica para exibir numeros de OS. Registros antigos podem conter o
// prefixo repetido ("OS OS-0017"); a interface nunca deve acrescenta-lo de
// novo sem antes normalizar o valor recebido.
function normalizarNumeroOSVisual(valor) {
  let texto = String(valor == null ? '' : valor).trim();
  let anterior = null;
  while (texto && texto !== anterior) {
    anterior = texto;
    texto = texto.replace(
      /^(?:(?:ordem\s+de\s+servi[cç]o)|os)\s*(?:n(?:[º°o.]|ro\.?)?\s*)?[#:\-–—]*\s*/i,
      ''
    ).trim();
  }
  texto = texto.replace(/^[#:\-–—\s]+/, '').trim();
  if (!texto) return 'OS';
  if (/^\d+$/.test(texto)) texto = texto.padStart(4, '0');
  return `OS-${texto}`;
}

function normalizarReferenciasOS(texto) {
  return String(texto == null ? '' : texto)
    .replace(/\bOS\s*(?:#\s*)?OS\s*[-:#]?\s*(\d+)\b/gi, (_, n) => normalizarNumeroOSVisual(n))
    .replace(/\bOS\s*#\s*(\d+)\b/gi, (_, n) => normalizarNumeroOSVisual(n));
}

function promptModal(mensagem, valorPadrao = '', opcoes = {}) {
  return new Promise((resolve) => {
    const existente = $('modalPromptCustom');
    if (existente) existente.remove();

    const overlay = document.createElement('div');
    overlay.id = 'modalPromptCustom';
    overlay.className = 'modal-fundo';
    // A tela de login ocupa a camada 9999. Confirmações abertas a partir dela
    // (como "Instalar agora") precisam ficar acima, ou o clique parece não
    // fazer nada porque o diálogo fica invisível atrás do login.
    overlay.style.zIndex = '11000';

    const caixa = document.createElement('div');
    caixa.className = 'modal-caixa';
    caixa.style.maxWidth = '420px';

    const cabecalho = document.createElement('div');
    cabecalho.className = 'modal-cabecalho';
    const h2 = document.createElement('h2');
    h2.textContent = textoModal(opcoes.titulo) || 'Confirmação necessária';
    cabecalho.appendChild(h2);

    const corpo = document.createElement('div');
    corpo.style.padding = '18px 22px';
    const p = document.createElement('p');
    p.style.cssText = 'margin-bottom:10px;white-space:pre-wrap;font-size:13px;';
    p.textContent = textoModal(mensagem);
    const input = document.createElement('input');
    input.type = opcoes.senha ? 'password' : 'text';
    input.id = 'promptCustomInput';
    input.style.cssText = 'width:100%;padding:9px 12px;border-radius:6px;border:1px solid var(--borda,#ccc);box-sizing:border-box;font-size:14px;';
    input.value = valorPadrao || '';
    corpo.appendChild(p);
    if (opcoes.senha) {
      const grupoSenha = document.createElement('div');
      grupoSenha.className = 'prompt-senha-grupo';
      const alternarSenha = document.createElement('button');
      alternarSenha.type = 'button';
      alternarSenha.className = 'prompt-senha-toggle';
      alternarSenha.innerHTML = `${ICONE_OLHO}<span>Mostrar</span>`;
      alternarSenha.setAttribute('aria-label', 'Mostrar senha');
      alternarSenha.addEventListener('click', () => {
        const mostrar = input.type === 'password';
        input.type = mostrar ? 'text' : 'password';
        alternarSenha.innerHTML = `${ICONE_OLHO}<span>${mostrar ? 'Ocultar' : 'Mostrar'}</span>`;
        alternarSenha.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      grupoSenha.appendChild(input);
      grupoSenha.appendChild(alternarSenha);
      corpo.appendChild(grupoSenha);
    } else {
      corpo.appendChild(input);
    }

    const rodape = document.createElement('div');
    rodape.className = 'modal-rodape';
    const btnCancelar = document.createElement('button');
    btnCancelar.className = 'botao botao-fantasma';
    btnCancelar.textContent = 'Cancelar';
    const btnOk = document.createElement('button');
    btnOk.className = 'botao botao-primario';
    btnOk.textContent = 'OK';
    rodape.appendChild(btnCancelar);
    rodape.appendChild(btnOk);

    caixa.appendChild(cabecalho);
    caixa.appendChild(corpo);
    caixa.appendChild(rodape);
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    input.focus();
    input.select();

    let resolvido = false;
    function finalizar(valor) {
      if (resolvido) return;
      resolvido = true;
      overlay.remove();
      resolve(valor);
    }

    btnOk.addEventListener('click', () => finalizar(input.value));
    btnCancelar.addEventListener('click', () => finalizar(null));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finalizar(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); finalizar(null); }
    });
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) finalizar(null); });
  });
}

// Substituto do window.confirm() — o Electron pode bloquear confirm()
// nativo silenciosamente em algumas versoes (mesmo problema que
// window.prompt, ver comentario linha 120-121). Este modal customizado
// garante que a caixa de dialogo sempre apareca eCapture o resultado
// do usuario de forma confiavel.
function confirmModal(mensagem, opcoes = {}) {
  return new Promise((resolve) => {
    const existente = $('modalConfirmCustom');
    if (existente) existente.remove();

    const overlay = document.createElement('div');
    overlay.id = 'modalConfirmCustom';
    overlay.className = 'modal-fundo';
    // A tela de login usa a camada 9999; confirmações abertas nela precisam
    // ficar acima para não parecer que o botão de instalação falhou.
    overlay.style.zIndex = '11000';

    const caixa = document.createElement('div');
    caixa.className = 'modal-caixa';
    caixa.style.maxWidth = '460px';

    const cabecalho = document.createElement('div');
    cabecalho.className = 'modal-cabecalho';
    const h2 = document.createElement('h2');
    h2.textContent = textoModal(opcoes.titulo) || 'Confirmação necessária';
    cabecalho.appendChild(h2);

    const corpo = document.createElement('div');
    corpo.style.cssText = 'padding:18px 22px;';
    const p = document.createElement('p');
    p.style.cssText = 'margin:0;white-space:pre-wrap;font-size:13px;';
    p.textContent = textoModal(mensagem);
    corpo.appendChild(p);

    const rodape = document.createElement('div');
    rodape.className = 'modal-rodape';
    const btnCancelar = document.createElement('button');
    btnCancelar.className = 'botao botao-fantasma';
    btnCancelar.textContent = opcoes.textoCancelar || 'Cancelar';
    const btnOk = document.createElement('button');
    btnOk.className = opcoes.perigo ? 'botao botao-perigo' : 'botao botao-primario';
    btnOk.textContent = opcoes.textoOk || 'OK';
    rodape.appendChild(btnCancelar);
    rodape.appendChild(btnOk);

    caixa.appendChild(cabecalho);
    caixa.appendChild(corpo);
    caixa.appendChild(rodape);
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    btnOk.focus();

    let resolvido = false;
    function finalizar(valor) {
      if (resolvido) return;
      resolvido = true;
      overlay.remove();
      resolve(valor);
    }

    btnOk.addEventListener('click', () => finalizar(true));
    btnCancelar.addEventListener('click', () => finalizar(false));
    document.addEventListener('keydown', function onKey(e) {
      if (resolvido) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Enter') { e.preventDefault(); document.removeEventListener('keydown', onKey); finalizar(true); }
      if (e.key === 'Escape') { e.preventDefault(); document.removeEventListener('keydown', onKey); finalizar(false); }
    });
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) finalizar(false); });
  });
}

// Seletor visual para acoes com poucas alternativas. Evita pedir que o
// usuario memorize e digite numeros (1, 2, 3...) para escolher um formato.
function escolherOpcaoModal(opcoes = {}) {
  return new Promise((resolve) => {
    $('modalOpcoesCustom')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modalOpcoesCustom';
    overlay.className = 'modal-fundo';
    overlay.style.zIndex = '11000';

    const caixa = document.createElement('div');
    caixa.className = 'modal-caixa';
    caixa.style.maxWidth = opcoes.largura || '620px';
    const cabecalho = document.createElement('div');
    cabecalho.className = 'modal-cabecalho';
    const titulo = document.createElement('h2');
    titulo.textContent = textoModal(opcoes.titulo) || 'Escolha uma opção';
    cabecalho.appendChild(titulo);

    const corpo = document.createElement('div');
    corpo.style.cssText = 'padding:20px 22px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;';
    const alternativas = Array.isArray(opcoes.alternativas) ? opcoes.alternativas : [];
    alternativas.forEach((alternativa) => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'botao botao-secundario';
      botao.style.cssText = 'min-height:88px;padding:15px;text-align:left;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:6px;white-space:normal;';
      const nome = document.createElement('strong');
      nome.style.fontSize = '14px';
      nome.textContent = alternativa.titulo || alternativa.valor;
      const descricao = document.createElement('span');
      descricao.style.cssText = 'font-size:12px;opacity:.78;line-height:1.35;';
      descricao.textContent = alternativa.descricao || '';
      botao.appendChild(nome);
      if (descricao.textContent) botao.appendChild(descricao);
      botao.addEventListener('click', () => finalizar(alternativa.valor));
      corpo.appendChild(botao);
    });

    const rodape = document.createElement('div');
    rodape.className = 'modal-rodape';
    const cancelar = document.createElement('button');
    cancelar.type = 'button';
    cancelar.className = 'botao botao-fantasma';
    cancelar.textContent = 'Cancelar';
    cancelar.addEventListener('click', () => finalizar(null));
    rodape.appendChild(cancelar);

    caixa.appendChild(cabecalho);
    caixa.appendChild(corpo);
    caixa.appendChild(rodape);
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    let resolvido = false;
    function finalizar(valor) {
      if (resolvido) return;
      resolvido = true;
      document.removeEventListener('keydown', aoTeclar);
      overlay.remove();
      resolve(valor);
    }
    function aoTeclar(evento) {
      if (evento.key === 'Escape') { evento.preventDefault(); finalizar(null); }
    }
    document.addEventListener('keydown', aoTeclar);
    overlay.addEventListener('mousedown', (evento) => { if (evento.target === overlay) finalizar(null); });
    corpo.querySelector('button')?.focus();
  });
}

// ══════════════════════════════════════════
// ETAPA 8.6 — CAMPOS DINÂMICOS POR TIPO DE EQUIPAMENTO
// ══════════════════════════════════════════
const TIPOS_SEM_IMEI = ['Notebook','Computador Desktop','All In One','Monitor','Impressora','Videogame','Peça / Componente','Outro'];

const ICONE_TIPO_EQUIPAMENTO = {
  'Smartphone': '', 'Tablet': '', 'Notebook': '', 'Computador Desktop': '️',
  'All In One': '️', 'Monitor': '️', 'Impressora': '️', 'Videogame': '', 'Peça / Componente': '', 'Outro': ''
};
window.ICONE_TIPO_EQUIPAMENTO = ICONE_TIPO_EQUIPAMENTO;

const EQUIPAMENTO_CAMPOS = {
  'Notebook': [
    ['numeroSerie','Número de Série'], ['marcaEq','Marca'], ['modeloEq','Modelo'],
    ['processador','Processador'], ['memoriaRam','Memória RAM'],
    ['ssd','SSD'], ['hd','HD'], ['sistemaOperacional','Sistema Operacional']
  ],
  'Computador Desktop': [
    ['numeroSerie','Número de Série'], ['processador','Processador'], ['placaMae','Placa-mãe'],
    ['memoriaRam','Memória RAM'], ['ssd','SSD'], ['hd','HD'],
    ['fonte','Fonte'], ['placaVideo','Placa de Vídeo'], ['sistemaOperacional','Sistema Operacional']
  ],
  'All In One': [
    ['numeroSerie','Número de Série'], ['processador','Processador'], ['memoriaRam','Memória RAM'],
    ['ssd','SSD'], ['hd','HD'], ['sistemaOperacional','Sistema Operacional']
  ],
  'Monitor': [
    ['numeroSerie','Número de Série'], ['tamanho','Tamanho']
  ],
  'Impressora': [
    ['numeroSerie','Número de Série'], ['tipoImpressora','Tipo']
  ],
  'Videogame': [
    ['numeroSerie','Número de Série']
  ],
  'Outro': [
    ['numeroSerie','Número de Série']
  ],
  'Smartphone': [],
  'Tablet': []
};

// Escape HTML genérico — usado em catch blocks que injetam err.message
// em innerHTML, para evitar que tags HTML/JS sejam renderizadas na tela.
function _escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Argumentos de handlers inline precisam continuar seguros depois que o
// navegador decodifica entidades HTML. URI encoding impede que dados
// importados com aspas ou quebras de linha sejam interpretados como código.
function _argJsUri(valor) {
  return encodeURIComponent(String(valor ?? '')).replace(/'/g, '%27');
}
// Campo "Marca"/"Modelo" do Notebook reaproveita marca/modelo padrão; removendo duplicidade:
EQUIPAMENTO_CAMPOS['Notebook'] = EQUIPAMENTO_CAMPOS['Notebook'].filter(([id]) => id !== 'marcaEq' && id !== 'modeloEq');

function renderCamposDinamicos(tipo, containerId, prefix, valores) {
  valores = valores || {};
  const cont = $(containerId);
  if (!cont) return;
  const campos = EQUIPAMENTO_CAMPOS[tipo] || [];
  cont.innerHTML = campos.map(([id, label]) => {
    const val = (valores[id] || '').toString().replace(/"/g, '&quot;');
    return `<div class="campo"><label for="${prefix}_${id}">${label}</label><input id="${prefix}_${id}" type="text" value="${val}" /></div>`;
  }).join('');
}

function coletarDadosEquipamento(prefix, tipo) {
  const campos = EQUIPAMENTO_CAMPOS[tipo] || [];
  const out = {};
  campos.forEach(([id]) => {
    const el = $(prefix + '_' + id);
    if (el) out[id] = el.value.trim();
  });
  return out;
}

function toggleCampoImei(campoImeiId, tipo) {
  const el = $(campoImeiId);
  if (!el) return;
  el.style.display = TIPOS_SEM_IMEI.includes(tipo) ? 'none' : '';
}

function toggleCamposPeca(tipo) {
  const el = $('camposPeca');
  if (!el) return;
  el.style.display = tipo === 'Peça / Componente' ? '' : 'none';
  // Ajusta label do campo "Marca" e "Modelo" para peças
  const lblMarca = document.querySelector('label[for="estMarca"]') ||
    document.querySelector('#estMarca')?.closest('.campo')?.querySelector('label');
  const lblModelo = document.querySelector('label[for="estModelo"]') ||
    document.querySelector('#estModelo')?.closest('.campo')?.querySelector('label');
  if (tipo === 'Peça / Componente') {
    if (lblMarca) lblMarca.textContent = 'Fabricante / Marca';
    if (lblModelo) lblModelo.textContent = 'Referência / Código';
  } else {
    if (lblMarca) lblMarca.textContent = 'Marca *';
    if (lblModelo) lblModelo.textContent = 'Modelo *';
  }
}

// ══════════════════════════════════════════
// ETAPA 8.6.1 — CHECKLIST TÉCNICO, DEFEITOS E DIAGNÓSTICO
// ══════════════════════════════════════════
const CHECKLIST_DEFEITOS_NOTEBOOK = [
  'Não liga','Liga e desliga','Tela quebrada','Tela sem imagem','Tela piscando',
  'Teclado com defeito','Touchpad com defeito','Bateria viciada','Não carrega',
  'Conector DC quebrado','Cooler com ruído','Superaquecimento','Lentidão','Travamentos',
  'HD defeituoso','SSD defeituoso','Memória RAM defeituosa','Sistema corrompido','Vírus',
  'Oxidação','Curto na placa','Sem Wi-Fi','Sem Bluetooth','Sem áudio','Sem webcam','Outro'
];
const CHECKLIST_DEFEITOS_COMPUTADOR = [
  'Não liga','Reinicia sozinho','Travamentos','Tela azul','Sem vídeo','Superaquecimento',
  'Fonte defeituosa','HD defeituoso','SSD defeituoso','Memória RAM defeituosa',
  'Placa-mãe defeituosa','Placa de vídeo defeituosa','Sem áudio','Sem rede','Vírus',
  'Sistema corrompido','Outro'
];
const CHECKLIST_ACESSORIOS_RECEBIDOS = [
  'Carregador','Fonte','Cabo USB','Capa','Película','Fone de ouvido','Caixa do aparelho',
  'Chip / SIM','Cartão de memória','Chave / bandeja do SIM','Mouse','Teclado','Mochila',
  'Bolsa','Cabo HDMI','Cabo VGA','Cabo DisplayPort','Adaptador','Outro'
];
const CHECKLIST_TESTES_ENTRADA = [
  'Liga normalmente','Tela / imagem funcionando','Touch funcionando',
  'Câmera frontal funcionando','Câmera traseira funcionando','Flash funcionando',
  'Alto-falante funcionando','Áudio auricular funcionando','Microfone funcionando',
  'Face ID / biometria funcionando','Wi-Fi funcionando','Bluetooth funcionando',
  'Sinal / chip funcionando','Leitura do cartão de memória funcionando',
  'Carregamento funcionando','Bateria funcionando','Vibração funcionando',
  'Botões físicos funcionando','Sensor de proximidade funcionando','GPS funcionando',
  'NFC funcionando','USB funcionando','Rede funcionando','Webcam funcionando',
  'Touchpad funcionando','Teclado funcionando','Não foi possível testar'
];

// ══════════════════════════════════════════
// ETAPA 8.7.1 — CHECKLIST DE ENTRADA E SAÍDA
// ══════════════════════════════════════════
const CHECKLIST_ENTRADA = [
  'Tela intacta','Carcaça intacta','Teclado íntegro','Touchpad íntegro',
  'Sem riscos aparentes','Sem peças faltando'
];
const CHECKLIST_SAIDA = [
  'Equipamento testado','Equipamento funcionando','Limpeza realizada',
  'Cliente conferiu','Equipamento entregue'
];

// Retorna a lista de defeitos aplicável ao tipo de equipamento, ou null
// quando o tipo não possui checklist de defeitos específico (ex: Smartphone).
function listaDefeitosPorTipo(tipo) {
  if (tipo === 'Notebook') return CHECKLIST_DEFEITOS_NOTEBOOK;
  if (tipo === 'Computador Desktop' || tipo === 'All In One') return CHECKLIST_DEFEITOS_COMPUTADOR;
  return null;
}

// Renderiza um checklist de checkboxes genérico dentro de containerId.
// `estado` é um array (mutado in-place) com os labels atualmente marcados.
// Itens com label "Outro" ganham um campo de texto ao serem marcados,
// que é armazenado no estado como "Outro: <texto>" ao salvar.
function renderizarChecklistBox(containerId, lista, estado) {
  const cont = $(containerId);
  if (!cont) return;
  if (!lista) {
    cont.innerHTML = '<p class="checklist-indisponivel">Checklist de defeitos disponível apenas para Notebook e Computador (Desktop / All In One).</p>';
    return;
  }

  // Extrai o texto extra de "Outro: xxx" que já esteja no estado
  function getOutroTexto() {
    const entry = estado.find(e => e === 'Outro' || e.startsWith('Outro: '));
    if (!entry) return '';
    return entry.startsWith('Outro: ') ? entry.slice(7) : '';
  }

  function updateOutroNoEstado(checked, texto) {
    // Remove qualquer entrada "Outro" ou "Outro: ..." existente
    const idx = estado.findIndex(e => e === 'Outro' || e.startsWith('Outro: '));
    if (idx !== -1) estado.splice(idx, 1);
    if (!checked) return;
    const val = texto.trim();
    estado.push(val ? `Outro: ${val}` : 'Outro');
  }

  cont.innerHTML = lista.map((label, idx) => {
    const isOutro = label === 'Outro';
    const marcado = isOutro
      ? estado.some(e => e === 'Outro' || e.startsWith('Outro: '))
      : estado.includes(label);
    const textoOutro = isOutro ? getOutroTexto() : '';
    return `
    <div class="checklist-item ${marcado?'ok':''}" data-idx="${idx}">
      <input type="checkbox" ${marcado?'checked':''} />
      <label>${label}</label>
      ${isOutro ? `<input type="text" class="outro-texto" placeholder="Especificar..." value="${textoOutro.replace(/"/g,'&quot;')}" style="display:${marcado?'inline-block':'none'};margin-left:8px;padding:2px 6px;border:1px solid var(--borda);border-radius:4px;font-size:12px;width:160px;background:var(--fundo);color:var(--texto);" />` : ''}
    </div>`;
  }).join('');

  Array.from(cont.children).forEach((el, idx) => {
    const label = lista[idx];
    const isOutro = label === 'Outro';
    const checkbox = el.querySelector('input[type="checkbox"]');
    const textoInput = isOutro ? el.querySelector('.outro-texto') : null;

    if (isOutro && textoInput) {
      // Atualiza estado ao digitar no campo de texto
      textoInput.addEventListener('input', (e) => {
        e.stopPropagation();
        updateOutroNoEstado(true, textoInput.value);
      });
      textoInput.addEventListener('click', (e) => e.stopPropagation());
    }

    el.addEventListener('click', (e) => {
      if (isOutro && textoInput && e.target === textoInput) return;
      if (isOutro) {
        const marcado = estado.some(ev => ev === 'Outro' || ev.startsWith('Outro: '));
        const novoEstado = !marcado;
        updateOutroNoEstado(novoEstado, textoInput ? textoInput.value : '');
        el.classList.toggle('ok', novoEstado);
        checkbox.checked = novoEstado;
        if (textoInput) {
          textoInput.style.display = novoEstado ? 'inline-block' : 'none';
          if (novoEstado) textoInput.focus();
        }
      } else {
        const pos = estado.indexOf(label);
        if (pos === -1) estado.push(label); else estado.splice(pos, 1);
        el.classList.toggle('ok', estado.includes(label));
        checkbox.checked = estado.includes(label);
      }
    });
  });
}

// ─── Validação de CPF (dígito verificador) ───
function validarCPF(cpf) {
  const nums = (cpf || '').replace(/\D/g, '');
  if (nums.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(nums)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(nums[i]) * (10 - i);
  let r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(nums[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(nums[i]) * (11 - i);
  r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
  return r === parseInt(nums[10]);
}

// ─── Validação de IMEI (15 dígitos numéricos — padrão GSM/GSMA) ───
function validarIMEI(imei) {
  const nums = (imei || '').replace(/\D/g, '');
  return nums.length === 15;
}

// ─── Helpers de erro por campo ───
function marcarErro(id, msg) {
  const el = $(id);
  if (!el || !el.parentElement) return;
  el.classList.add('campo-invalido');
  let err = el.parentElement.querySelector('.erro-campo');
  if (!err) { err = document.createElement('span'); err.className = 'erro-campo'; el.parentElement.appendChild(err); }
  err.textContent = msg;
}
function limparErro(id) {
  const el = $(id);
  if (!el || !el.parentElement) return;
  el.classList.remove('campo-invalido');
  const err = el.parentElement.querySelector('.erro-campo');
  if (err) err.remove();
}
function limparErros(...ids) { ids.forEach(limparErro); }

function mostrarPrimeiroCampoInvalido(ids, mensagemGeral) {
  const primeiro = ids.map(id => $(id)).find(el => el?.classList.contains('campo-invalido'));
  if (!primeiro) return;
  const aba = primeiro.closest('.sub-secao, .subaba-conteudo, [data-conteudo-sub]');
  const nomeAba = aba?.dataset?.conteudoSub || aba?.dataset?.sub || String(aba?.id || '').replace(/^sub-/, '');
  if (nomeAba) document.querySelector(`.aba-interna[data-sub="${nomeAba}"]`)?.click();
  requestAnimationFrame(() => {
    primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' });
    primeiro.focus({ preventScroll: true });
    if (mensagemGeral) primeiro.setAttribute('aria-label', mensagemGeral);
  });
}

// Escapa texto arbitrário e permite apenas os ícones internos (strings
// que começam com "<svg", geradas por _svg()/_bolinha() acima, nunca
// vindas de input do usuário) passarem como HTML. Isso corrige o bug de
// SVGs de ícone aparecendo como texto cru (ex.: toasts e chat da IA
// mostrando "<svg viewBox=..." na tela em vez do ícone renderizado).
function _renderComIcones(msg) {
  const partes = normalizarReferenciasOS(String(msg)).split(/(<svg[\s\S]*?<\/svg>)/g);
  return partes.map(p => {
    if (p.startsWith('<svg')) return p; // ícone de confiança, gerado internamente
    const div = document.createElement('div');
    div.textContent = p; // escapa qualquer HTML/texto dinâmico
    return div.innerHTML;
  }).join('');
}

// O chat recebe texto gerado pela IA. Primeiro escapamos tudo (inclusive
// qualquer HTML que a IA pudesse devolver) e só então aplicamos a pequena
// parte de Markdown suportada pela interface: **negrito**.
function _renderMarkdownSeguro(msg) {
  const partes = normalizarReferenciasOS(String(msg)).split(/(<svg[\s\S]*?<\/svg>)/g);
  return partes.map(p => {
    if (p.startsWith('<svg')) return p;
    const div = document.createElement('div');
    div.textContent = p;
    return div.innerHTML.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  }).join('');
}

function toast(msg, tipo='') {
  const t = $('toast');
  t.innerHTML = _renderComIcones(normalizarReferenciasOS(msg));
  t.className = 'toast' + (tipo ? ' '+tipo : '');
  t.classList.remove('escondido');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('escondido'), 3500);
}

function statusClass(status) {
  const map = {
    'Aguardando análise':'aguardando','Em diagnóstico':'orcamento',
    'Aguardando aprovação':'aprovacao','Aguardando peça':'peca','Em reparo':'reparo',
    'Em testes':'testes','Pronto para retirada':'prontoretirada','Entregue':'entregue','Cancelado':'cancelado',
    'Aguardando Pagamento':'aguardando-pag','Aguardando Pagamento Presencial':'aguardando-pag',
    'Aguardando Pagamento na Retirada':'aguardando-pag','Pago 50%':'aguardando-pag','Pago':'autorizado','Autorizado':'autorizado',
    'Pendente':'aguardando','Aprovado':'autorizado','Desaprovado':'cancelado',
    'Aguardando chegada':'aguardando','Em análise':'orcamento',
    'Pronto para venda':'pronto','Reservado':'reservado','Vendido':'vendido'
  };

  return 'status-badge status-' + (map[status] || 'aguardando');
}

// ── ETAPA 8.7.1 — Prioridade da OS (cores na listagem) ──
function prioridadeClass(prioridade) {
  const map = { 'Baixa':'baixa', 'Normal':'normal', 'Alta':'alta', 'Urgente':'urgente' };
  return 'prioridade-badge prioridade-' + (map[prioridade] || 'normal');
}


// ══════════════════════════════════════════
// ABAS PRINCIPAIS
// ══════════════════════════════════════════
document.querySelectorAll('.aba').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!temPermissaoElemento(btn)) return;
    document.querySelectorAll('.aba').forEach(b => b.classList.remove('ativa'));
    document.querySelectorAll('.secao-aba').forEach(s => s.classList.add('escondido'));
    btn.classList.add('ativa');
    const aba = btn.dataset.aba;
    $('aba-'+aba).classList.remove('escondido');
    if (aba === 'historico') carregarHistorico();
    if (aba === 'entregas') { carregarEntregas(); window.carregarEntregasPendentes?.(); }
    if (aba === 'garantia') carregarGarantias();
    if (aba === 'clientes') carregarClientes();
    if (aba === 'estoque') carregarEstoque();
    if (aba === 'precos') window.carregarTabelaPrecos?.();
    if (aba === 'relatorios') {
      trocarSubabaRelatorios(temPermissaoModulo('relatorios') ? 'geral' : 'financeiro');
    }
    if (aba === 'pagamentos') carregarPagamentos();
    if (aba === 'mensagens-wapp') carregarMensagensWapp();
    if (aba === 'log-ia') carregarLogIA();
  });
});

function trocarSubabaRelatorios(destino) {
  const financeiro = destino === 'financeiro';
  const permissao = financeiro ? 'financeiro' : 'relatorios';
  if (!temPermissaoModulo(permissao)) return;
  const geralEl = $('aba-relatorios');
  const financeiroEl = $('aba-financeiro');
  geralEl?.classList.toggle('escondido', financeiro);
  financeiroEl?.classList.toggle('escondido', !financeiro);
  document.querySelectorAll('[data-relatorios-subaba]').forEach(function (botao) {
    botao.classList.toggle('ativa', botao.dataset.relatoriosSubaba === destino);
  });
  if (financeiro) carregarFinanceiro();
  else carregarRelatorios();
}
window.trocarSubabaRelatorios = trocarSubabaRelatorios;
document.querySelectorAll('[data-relatorios-subaba]').forEach(function (botao) {
  botao.addEventListener('click', function () {
    if (!temPermissaoElemento(botao)) return;
    trocarSubabaRelatorios(botao.dataset.relatoriosSubaba);
  });
});

// Fechar modais genérico
document.querySelectorAll('[data-fechar]').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.fechar;
    $(id).classList.add('escondido');
  });
});

// Após salvar um formulário em modal, o modal permanece aberto (o usuário
// fecha manualmente clicando em "Fechar"/✕) — em vez de fechar sozinho.
// Troca o texto do(s) botão(ões) "Cancelar"/data-fechar daquele modal para
// "Fechar", deixando claro que o dado já foi salvo. `resetarBotaoFecharModal`
// deve ser chamado ao reabrir o modal (Novo/Editar), para o texto voltar a
// "Cancelar" no próximo uso.
function marcarModalComoSalvo(modalId, textoBotao) {
  textoBotao = textoBotao || `${ICONE_CHECK} Fechar`;
  document.querySelectorAll('[data-fechar="' + modalId + '"]').forEach(function(btn) {
    if (btn.classList.contains('botao-fechar')) return; // não mexe no "✕" do cabeçalho
    btn.dataset.textoOriginal = btn.dataset.textoOriginal || btn.innerHTML;
    btn.innerHTML = _renderComIcones(textoBotao);
  });
}
function resetarBotaoFecharModal(modalId) {
  document.querySelectorAll('[data-fechar="' + modalId + '"]').forEach(function(btn) {
    if (btn.dataset.textoOriginal) btn.innerHTML = btn.dataset.textoOriginal;
  });
}

// ══════════════════════════════════════════
// TEMA
// ══════════════════════════════════════════
let temaModo = 'dark';
function aplicarTema(modo) {
  temaModo = modo;
  document.body.classList.toggle('tema-escuro', modo === 'dark');
  $('btnToggleTema').innerHTML = modo === 'dark' ? `${ICONE_SOL}` : `${ICONE_LUA}`;
}

$('btnToggleTema').addEventListener('click', async () => {
  const novo = temaModo === 'dark' ? 'light' : 'dark';
  aplicarTema(novo);
  await window.api.configsalvar({ temaModo: novo });
});

// ── Identidade visual monocromática ────────────────────────────
// A marca usa somente preto, branco e cinzas. Cores ficam reservadas
// aos estados semânticos (sucesso, aviso e erro).
const TEMA_PADRAO_SISTEMA = {
  corPrincipal: '#FFFFFF',
  corSecundaria: '#000000',
  corDestaque: '#FFFFFF',
  corBotoes: '#FFFFFF',
  corCabecalhos: '#000000',
  corBarraLateral: '#000000',
  corCards: '#111111',
  corLinks: '#FFFFFF'
};

const TEMA_PROFISSIONAL = Object.assign({}, TEMA_PADRAO_SISTEMA);

const TEMA_PADRAO_PDF = {
  usarTemaSistemaPdf: true,
  corCabecalhos: '#111111',
  corTitulos: '#111111',
  corLinhasDestaque: '#111111',
  corTabelas: '#111111',
  corRodapes: '#111111',
  corBordas: '#111111',
  corElementosGraficos: '#111111'
};

const MAPA_VAR_CSS = {
  corPrincipal: '--cor-principal',
  corSecundaria: '--cor-secundaria',
  corDestaque: '--cor-destaque',
  corBotoes: '--cor-botoes',
  corCabecalhos: '--cor-cabecalhos',
  corBarraLateral: '--cor-barra-lateral',
  corCards: '--cor-cards',
  corLinks: '--cor-links'
};

// Aplica as cores em tempo real (CSS custom properties no <html>)
function aplicarTemaCores(tema) {
  const t = Object.assign({}, TEMA_PADRAO_SISTEMA);
  Object.keys(MAPA_VAR_CSS).forEach(campo => {
    document.documentElement.style.setProperty(MAPA_VAR_CSS[campo], t[campo]);
  });
}

// Salva o tema automaticamente (debounce leve para não disparar 1 IPC por
// pixel arrastado no seletor de cor nativo do navegador).
let _temaSalvarTimer = null;
function agendarSalvarTema() {
  clearTimeout(_temaSalvarTimer);
  _temaSalvarTimer = setTimeout(async () => {
    const tema = {};
    document.querySelectorAll('[data-tema-campo]').forEach(input => {
      tema[input.dataset.temaCampo] = input.value;
    });
    configAtual.tema = Object.assign({}, configAtual.tema, tema);
    await window.api.configsalvar({ tema: configAtual.tema });
  }, 250);
}

// Mostra/esconde o chip verde "chave já salva" acima de um campo de
// segredo (token/API key), com o valor mascarado vindo de obterConfig()
// (ex.: "gsk_ab••••••z789"). Resolve a confusão de "digitei a chave, saí
// e voltei, e o campo tá vazio de novo, cadê minha chave?" — o campo
// continua vazio por design (nunca reenviamos o segredo completo pro
// renderer), mas agora fica visualmente óbvio que ele está configurado.
function exibirChipChaveSalva(idChip, idValor, mascara) {
  const chip = document.getElementById(idChip);
  const valorEl = document.getElementById(idValor);
  if (!chip || !valorEl) return;
  if (mascara) {
    valorEl.textContent = mascara;
    chip.style.display = '';
  } else {
    chip.style.display = 'none';
  }
}

const PROVEDORES_IA_CONFIG = Object.freeze({
  groq: {
    nome: 'Groq', campoLocal: 'groqChatApiKey', flagLocal: 'possuiGroqChatKey', placeholder: 'gsk_...',
    modelos: [
      ['openai/gpt-oss-120b', 'GPT-OSS 120B — recomendado'],
      ['openai/gpt-oss-20b', 'GPT-OSS 20B — mais rápido'],
      ['qwen/qwen3.6-27b', 'Qwen 3.6 27B']
    ]
  },
  openai: {
    nome: 'OpenAI', campoLocal: 'openaiApiKey', flagLocal: 'possuiOpenAIKey', placeholder: 'sk-...',
    modelos: [['gpt-4.1-mini', 'GPT-4.1 mini — recomendado'], ['gpt-4.1', 'GPT-4.1'], ['gpt-4o-mini', 'GPT-4o mini']]
  },
  anthropic: {
    nome: 'Anthropic', campoLocal: 'anthropicApiKey', flagLocal: 'possuiAnthropicKey', placeholder: 'sk-ant-...',
    modelos: [['claude-sonnet-4-6', 'Claude Sonnet 4.6 — recomendado'], ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'], ['claude-sonnet-5', 'Claude Sonnet 5']]
  },
  deepseek: {
    nome: 'DeepSeek', campoLocal: 'deepseekApiKey', flagLocal: 'possuiDeepSeekKey', placeholder: 'sk-...',
    modelos: [['deepseek-v4-flash', 'DeepSeek V4 Flash — recomendado'], ['deepseek-v4-pro', 'DeepSeek V4 Pro']]
  }
});
let integracaoIAEmpresaCache = null;

function preencherModelosIA(select, provedor, modeloAtual = '') {
  if (!select) return;
  const definicao = PROVEDORES_IA_CONFIG[provedor] || PROVEDORES_IA_CONFIG.groq;
  const opcoes = definicao.modelos.slice();
  if (modeloAtual && !opcoes.some(([valor]) => valor === modeloAtual)) opcoes.push([modeloAtual, `${modeloAtual} — personalizado`]);
  select.replaceChildren(...opcoes.map(([valor, rotulo]) => {
    const option = document.createElement('option');
    option.value = valor;
    option.textContent = rotulo;
    return option;
  }));
  select.value = modeloAtual && opcoes.some(([valor]) => valor === modeloAtual) ? modeloAtual : opcoes[0][0];
}

function atualizarFluxoIAConfig(config = configAtual || {}, integracao = integracaoIAEmpresaCache) {
  const provedorEl = $('iaChatProviderConfig');
  const modeloEl = $('iaChatModelConfig');
  const chaveEl = $('iaChatApiKeyConfig');
  if (!provedorEl || !modeloEl || !chaveEl) return;
  const provedor = provedorEl.value in PROVEDORES_IA_CONFIG ? provedorEl.value : 'groq';
  const definicao = PROVEDORES_IA_CONFIG[provedor];
  const remotoMesmoProvedor = integracao?.status === 'conectada' && integracao?.metadados?.provedor === provedor;
  const possuiLocal = config?.[definicao.flagLocal] === true;
  $('labelChaveIAConfig').textContent = `3. Chave da API ${definicao.nome}`;
  chaveEl.value = '';
  chaveEl.placeholder = remotoMesmoProvedor || possuiLocal ? 'Chave já configurada — deixe vazio para manter' : definicao.placeholder;
  const origem = remotoMesmoProvedor ? 'Configurada com segurança na nuvem para esta empresa' : (possuiLocal ? 'Configurada no cofre deste computador' : '');
  exibirChipChaveSalva('chipIAConfig', 'chipIAConfigValor', origem);
  $('ajudaChaveIAConfig').textContent = remotoMesmoProvedor
    ? 'O suporte ou o administrador já configurou esta integração. Digite uma nova chave somente para substituí-la.'
    : 'A chave informada será validada e protegida; ela não volta a aparecer em texto aberto.';
}

async function carregarIntegracaoIAEmpresa(config = configAtual || {}) {
  if (!window.api?.supabaseintegracaoia || usuarioAtual?.administradorGlobal) return null;
  const resposta = await window.api.supabaseintegracaoia('status', {});
  if (!resposta?.sucesso) return null;
  integracaoIAEmpresaCache = resposta.integracao || null;
  const provedorRemoto = integracaoIAEmpresaCache?.metadados?.provedor;
  const modeloRemoto = integracaoIAEmpresaCache?.metadados?.modelo;
  if (provedorRemoto && PROVEDORES_IA_CONFIG[provedorRemoto]) $('iaChatProviderConfig').value = provedorRemoto;
  preencherModelosIA($('iaChatModelConfig'), $('iaChatProviderConfig').value, modeloRemoto || config.iaChatModel || '');
  atualizarFluxoIAConfig(config, integracaoIAEmpresaCache);
  return resposta;
}

$('iaChatProviderConfig')?.addEventListener('change', () => {
  preencherModelosIA($('iaChatModelConfig'), $('iaChatProviderConfig').value, '');
  atualizarFluxoIAConfig(configAtual, integracaoIAEmpresaCache);
});

async function atualizarStatusSyncSupabaseNaTela() {
  const el = document.getElementById('statusSyncSupabase');
  if (!el || !window.api?.supabasestatus) return;
  try {
    const s = await window.api.supabasestatus();
    if (!s.ativo) {
      el.textContent = 'Supabase desativado — o sistema continua no modo legado.';
      return;
    }
    const partes = [s.autenticado ? 'Autenticado' : 'Aguardando login'];
    if (s.empresaNome) partes.push(s.empresaNome);
    if (s.modoArmazenamento) partes.push(`arquivos: ${s.modoArmazenamento}`);
    if (s.filaPendente) partes.push(`${s.filaPendente} pendente(s)`);
    if (s.conflitos) partes.push(`${s.conflitos} conflito(s)`);
    if (s.ultimaSincronizacaoEm) partes.push(`última sync: ${new Date(s.ultimaSincronizacaoEm).toLocaleString('pt-BR')}`);
    el.textContent = partes.join(' · ');
    el.style.color = s.conectado ? '#15803d' : 'var(--texto-sec)';
  } catch (_) {
    el.textContent = 'Não foi possível ler o status do Supabase.';
    el.style.color = '#b91c1c';
  }
}

function preencherCamposTemaSistema(tema) {
  const t = Object.assign({}, TEMA_PADRAO_SISTEMA, tema || {});
  document.querySelectorAll('[data-tema-campo]').forEach(input => {
    input.value = t[input.dataset.temaCampo] || '#000000';
  });
}

document.querySelectorAll('[data-tema-campo]').forEach(input => {
  input.addEventListener('input', () => {
    const tema = {};
    document.querySelectorAll('[data-tema-campo]').forEach(i => { tema[i.dataset.temaCampo] = i.value; });
    aplicarTemaCores(tema); // tempo real
    agendarSalvarTema();    // salva automaticamente
  });
});

$('btnRestaurarTemaSistema').addEventListener('click', async () => {
  preencherCamposTemaSistema(TEMA_PADRAO_SISTEMA);
  aplicarTemaCores(TEMA_PADRAO_SISTEMA);
  configAtual.tema = Object.assign({}, TEMA_PADRAO_SISTEMA);
  await window.api.configsalvar({ tema: configAtual.tema });
  toast('Tema padrão do sistema restaurado!', 'sucesso');
});

// ── Predefinições de Tema ─────────────────────────────────────
const TEMAS_PREDEFINICAO = {
  padrao: TEMA_PADRAO_SISTEMA,
  profissional: TEMA_PROFISSIONAL,
  azul: TEMA_PADRAO_SISTEMA
};

document.querySelectorAll('.tema-predef').forEach(btn => {
  btn.addEventListener('click', async () => {
    const chave = btn.dataset.temaPredef;
    const tema = TEMAS_PREDEFINICAO[chave];
    if (!tema) return;
    preencherCamposTemaSistema(tema);
    aplicarTemaCores(tema);
    configAtual.tema = Object.assign({}, tema);
    await window.api.configsalvar({ tema: configAtual.tema });
    toast('Tema "' + btn.textContent.trim() + '" aplicado!', 'sucesso');
  });
});

// ── Tema dos PDFs ───────────────────────────────────────────────
function atualizarVisibilidadeBlocoPdf() {
  const usarSistema = $('usarTemaSistemaPdf').checked;
  $('blocoCoresPdfExclusivas').classList.toggle('escondido', usarSistema);
}

function preencherCamposTemaPdf(temaPdf) {
  const t = Object.assign({}, TEMA_PADRAO_PDF, temaPdf || {});
  $('usarTemaSistemaPdf').checked = t.usarTemaSistemaPdf !== false;
  document.querySelectorAll('[data-tema-pdf-campo]').forEach(input => {
    input.value = t[input.dataset.temaPdfCampo] || '#000000';
  });
  atualizarVisibilidadeBlocoPdf();
}

async function salvarTemaPdf() {
  const temaPdf = { usarTemaSistemaPdf: $('usarTemaSistemaPdf').checked };
  document.querySelectorAll('[data-tema-pdf-campo]').forEach(input => {
    temaPdf[input.dataset.temaPdfCampo] = input.value;
  });
  configAtual.temaPdf = Object.assign({}, configAtual.temaPdf, temaPdf);
  await window.api.configsalvar({ temaPdf: configAtual.temaPdf });
}

$('usarTemaSistemaPdf').addEventListener('change', () => {
  atualizarVisibilidadeBlocoPdf();
  salvarTemaPdf();
});

document.querySelectorAll('[data-tema-pdf-campo]').forEach(input => {
  input.addEventListener('input', () => { salvarTemaPdf(); });
});

$('btnRestaurarTemaPdf').addEventListener('click', async () => {
  preencherCamposTemaPdf(TEMA_PADRAO_PDF);
  configAtual.temaPdf = Object.assign({}, TEMA_PADRAO_PDF);
  await window.api.configsalvar({ temaPdf: configAtual.temaPdf });
  toast('Tema padrão dos PDFs restaurado!', 'sucesso');
});

// ══════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════
let configAtual = {};
let termosResolvidosAtuais = { os: '', venda: '', compra: '', garantia: '' };

const origemTermosPorCampo = {
  termos: 'origemTermosOS',
  editTermos: 'origemEditTermosOS',
  estTermosVenda: 'origemTermosVenda',
  cpTermosCompra: 'origemTermosCompra',
  garTermos: 'origemTermosGarantia'
};

async function atualizarTermosResolvidos() {
  const fallback = {
    os: String(configAtual.termosOS || '').trim(),
    venda: String(configAtual.termosVenda || '').trim(),
    compra: String(configAtual.termosCompra || '').trim(),
    garantia: String(configAtual.termosGarantia || '').trim()
  };
  try {
    const resolvidos = typeof window.api.configtermosresolvidos === 'function'
      ? await window.api.configtermosresolvidos()
      : null;
    termosResolvidosAtuais = Object.assign(fallback, resolvidos || {});
  } catch (_) {
    termosResolvidosAtuais = fallback;
  }
  return termosResolvidosAtuais;
}

function atualizarIndicadorTermos(campoId, personalizado) {
  const indicador = $(origemTermosPorCampo[campoId]);
  if (!indicador) return;
  indicador.classList.toggle('personalizado', personalizado === true);
  indicador.textContent = personalizado
    ? 'Personalizado somente neste documento'
    : 'Carregado das configurações';
}

function aplicarTermosPadraoNoCampo(tipo, campoId, forcar = false) {
  const campo = $(campoId);
  if (!campo) return '';
  const textoPadrao = String(termosResolvidosAtuais[tipo] || '').trim();
  if (forcar || !String(campo.value || '').trim()) campo.value = textoPadrao;
  atualizarIndicadorTermos(campoId, false);
  return campo.value;
}

document.querySelectorAll('[data-restaurar-termos]').forEach(botao => {
  botao.addEventListener('click', () => {
    const tipo = botao.dataset.restaurarTermos;
    const campoId = botao.dataset.campoTermos;
    aplicarTermosPadraoNoCampo(tipo, campoId, true);
    $(campoId)?.focus();
    toast('Termos restaurados a partir das configurações.', 'sucesso');
  });
});

Object.keys(origemTermosPorCampo).forEach(campoId => {
  $(campoId)?.addEventListener('input', () => atualizarIndicadorTermos(campoId, true));
});

async function carregarConfig() {
  configAtual = await window.api.configobter();
  await atualizarTermosResolvidos();
  aplicarTema(configAtual.temaModo || 'dark');
  aplicarTemaCores(configAtual.tema || TEMA_PADRAO_SISTEMA);
  $('nomeSistema').textContent = configAtual.nomeEmpresa || 'A&T Assistência Técnica';
  if (configAtual.logoBase64) {
    $('logoTopo').innerHTML = `<img src="${configAtual.logoBase64}" alt="Logo">`;
  } else {
    $('logoTopo').innerHTML = '<img src="assets/logo-os-white.png" alt="Sistema OS">';
  }
  // Pre-fill termos no form
  const termosEl = $('termos');
  if (termosEl && !termosEl.value) {
    aplicarTermosPadraoNoCampo('os', 'termos');
  }
}

let _usuariosPoliticaExclusao = [];

async function autorizarExclusaoProtegida(descricao = 'este item', opcoes = {}) {
  try {
    const config = await window.api.configobter();
    configAtual = config || configAtual || {};
    if (!configAtual.possuiSenhaExclusao) {
      return opcoes.retornarCredencial ? { tipo: 'sem_senha' } : true;
    }
    const politica = configAtual.politicaExclusao;
    if (politica?.autenticado && politica.senha_configurada !== true) {
      const usuarioAdmin = await promptModal(
        `Seu usuário não tem permissão própria para excluir ${descricao}.\nInforme o login de um administrador:`,
        '', { titulo: 'Autorização do administrador' }
      );
      if (usuarioAdmin === null) return false;
      const senhaAdmin = await promptModal('Digite a senha de login do administrador:', '', {
        titulo: 'Autorização do administrador', senha: true
      });
      if (senhaAdmin === null) return false;
      const credencial = { tipo: 'administrador', usuario: String(usuarioAdmin).trim(), senha: String(senhaAdmin) };
      const resposta = await window.api.supabaseadministracaoglobal?.('validar_credencial_admin_exclusao', credencial);
      if (!resposta?.sucesso) {
        toast(resposta?.erro || 'Usuário ou senha de administrador incorretos.', 'erro');
        return false;
      }
      return opcoes.retornarCredencial ? credencial : true;
    }

    const senha = await promptModal(`Digite sua senha individual para excluir ${descricao}:`, '', {
      titulo: 'Confirmação protegida', senha: true
    });
    if (senha === null) return false;
    const ok = await window.api.configverificarsenhaexclusao(senha);
    if (!ok) {
      toast('Senha de exclusão incorreta.', 'erro');
      return false;
    }
    return opcoes.retornarCredencial ? { tipo: 'individual', senha: String(senha) } : true;
  } catch (erro) {
    toast(erro?.message || 'Não foi possível validar a autorização.', 'erro');
    return false;
  }
}

async function carregarPoliticaExclusaoConfig(config) {
  const politica = config?.politicaExclusao || await window.api.configpoliticaexclusao?.();
  const status = $('statusMinhaSenhaExclusao');
  const adminBloco = $('adminPoliticaExclusao');
  const botaoSenha = $('btnSalvarMinhaSenhaExclusao');
  const campoSenha = $('senhaExclusaoConfig');
  const ehAdmin = politica?.administrador === true || usuarioAtual?.admin === true;

  if (!politica) {
    if (status) status.textContent = 'A regra da nuvem ficará disponível quando a sessão for sincronizada.';
    if (adminBloco) adminBloco.style.display = 'none';
    return;
  }

  if (status) {
    status.textContent = ehAdmin
      ? 'Sua conta é administradora: exclusões não pedem senha.'
      : politica.sem_senha
        ? 'Seu usuário foi liberado pelo administrador: exclusões não pedem senha.'
        : politica.senha_configurada
          ? 'Sua senha está configurada. Digite uma nova somente se quiser trocá-la.'
          : 'Defina sua senha antes de realizar exclusões.';
  }
  if (campoSenha) campoSenha.disabled = ehAdmin;
  if (botaoSenha) botaoSenha.disabled = ehAdmin;
  if (adminBloco) adminBloco.style.display = ehAdmin ? 'block' : 'none';
  if (!ehAdmin) return;

  const semSenhaTodos = $('semSenhaTodosConfig');
  if (semSenhaTodos) semSenhaTodos.checked = politica.sem_senha_todos === true;
  const lista = $('usuariosSemSenhaExclusao');
  if (!lista) return;
  lista.innerHTML = '<span class="campo-desc">Carregando usuários…</span>';
  const resposta = await window.api.supabaseadministracaoglobal?.('listar_usuarios_empresa', {
    empresaId: usuarioAtual?.empresaId
  });
  if (!resposta?.sucesso) {
    lista.innerHTML = `<span class="campo-desc" style="color:var(--perigo);">${_escHtml(resposta?.erro || 'Não foi possível listar os usuários.')}</span>`;
    return;
  }
  _usuariosPoliticaExclusao = (resposta.usuarios || []).filter(u =>
    u.ativo !== false && !/administrador|propriet[aá]rio/i.test(String(u.cargo || ''))
  );
  const liberados = new Set((politica.usuarios_sem_senha || []).map(String));
  lista.innerHTML = _usuariosPoliticaExclusao.length
    ? _usuariosPoliticaExclusao.map(u => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--borda);border-radius:9px;">
          <label class="checkbox-linha" style="margin:0;flex:1;">
            <input type="checkbox" class="usuario-sem-senha-exclusao" value="${_escHtml(u.id)}" ${liberados.has(String(u.id)) ? 'checked' : ''}>
            <span>${_escHtml(u.nome || u.usuario || 'Usuário')} <small>(${_escHtml(u.cargo || 'Sem cargo')})</small><br><small>Marque para excluir sem senha</small></span>
          </label>
          <button type="button" class="botao botao-secundario botao-pequeno btn-senha-individual-exclusao" data-usuario-id="${_escHtml(u.id)}" data-usuario-nome="${_escHtml(u.nome || u.usuario || 'Usuário')}">Senha individual</button>
        </div>`).join('')
    : '<span class="campo-desc">Nenhum usuário comum ativo nesta empresa.</span>';
  lista.querySelectorAll('.btn-senha-individual-exclusao').forEach((botao) => {
    botao.addEventListener('click', () => definirSenhaIndividualExclusao(botao.dataset.usuarioId, botao.dataset.usuarioNome));
  });
}

async function definirSenhaIndividualExclusao(usuarioId, nome) {
  const senha = await promptModal(`Defina a senha de exclusão individual de ${nome}:`, '', {
    titulo: 'Senha individual de exclusão', senha: true
  });
  if (senha === null) return;
  if (String(senha).length < 6) { toast('A senha precisa ter pelo menos 6 caracteres.', 'erro'); return; }
  const repetir = await promptModal('Repita a senha individual:', '', { titulo: 'Confirmar senha individual', senha: true });
  if (repetir === null) return;
  if (senha !== repetir) { toast('As senhas não coincidem.', 'erro'); return; }
  const resposta = await window.api.supabaseadministracaoglobal?.('definir_senha_exclusao_usuario', {
    usuarioId, senha: String(senha)
  });
  if (!resposta?.sucesso) { toast(resposta?.erro || 'Não foi possível definir a senha individual.', 'erro'); return; }
  toast('Senha individual de exclusão definida para ' + nome + '.', 'sucesso');
}

$('btnConfig').addEventListener('click', async () => {
  const c = await window.api.configobter();
  let preferenciasLocais = { abrirComWindows: true, modoEconomicoSegundoPlano: true };
  try {
    preferenciasLocais = await window.api.configpreferenciaslocais();
  } catch (_) {
    // A configuracao principal continua acessivel mesmo se o Windows recusar
    // temporariamente a leitura das preferencias exclusivas deste PC.
  }
  if ($('abrirComWindowsConfig')) $('abrirComWindowsConfig').checked = preferenciasLocais.abrirComWindows !== false;
  if ($('modoEconomicoSegundoPlanoConfig')) $('modoEconomicoSegundoPlanoConfig').checked = preferenciasLocais.modoEconomicoSegundoPlano !== false;
  if ($('statusPreferenciasLocais')) {
    $('statusPreferenciasLocais').textContent = preferenciasLocais.abrirComWindows === false
      ? 'Inicialização automática desativada neste computador.'
      : 'Inicialização automática ativa e oculta neste computador.';
  }
  $('nomeEmpresa').value = c.nomeEmpresa || '';
  $('nomeFantasia').value = c.nomeFantasia || '';
  $('razaoSocial').value = c.razaoSocial || '';
  $('telefonePrincipal').value = c.telefonePrincipal || c.telefoneEmpresa || '';
  $('telefoneFixo').value = c.telefoneFixo || '';
  $('whatsapp').value = c.whatsapp || '';
  $('emailEmpresa').value = c.email || '';
  $('site').value = c.site || '';
  $('endereco').value = c.endereco || '';
  $('numero').value = c.numero || '';
  $('complemento').value = c.complemento || '';
  $('bairro').value = c.bairro || '';
  $('cidade').value = c.cidade || '';
  $('estado').value = c.estado || '';
  $('cep').value = c.cep || '';
  $('possuiCnpj').checked = !!c.possuiCnpj;
  $('cnpjEmpresa').value = c.cnpj || '';
  $('inscricaoEstadual').value = c.inscricaoEstadual || '';
  $('campoCnpj').classList.toggle('escondido', !c.possuiCnpj);
  $('exibirCnpjDocumentos').checked = c.exibirCnpjDocumentos !== false;
  $('percentualLucroPadrao').value = c.percentualLucroPadrao ?? 30;
  $('garantiaPadrao').value = c.garantiaPadrao || '90 dias';
  $('termosOSConfig').value = c.termosOS || '';
  $('termosVendaConfig').value = c.termosVenda || '';
  $('termosCompraConfig').value = c.termosCompra || '';
  if ($('termosGarantiaConfig')) $('termosGarantiaConfig').value = c.termosGarantia || '';
  if ($('usarTermosPredefinidosOS'))     $('usarTermosPredefinidosOS').checked     = !!c.usarTermosPredefinidosOS;
  if ($('usarTermosPredefinidosVenda'))  $('usarTermosPredefinidosVenda').checked  = !!c.usarTermosPredefinidosVenda;
  if ($('usarTermosPredefinidosCompra')) $('usarTermosPredefinidosCompra').checked = !!c.usarTermosPredefinidosCompra;
  if ($('usarTermosPredefinidosGarantia')) $('usarTermosPredefinidosGarantia').checked = !!c.usarTermosPredefinidosGarantia;
  $('textoRodapePdf').value = c.textoRodapePdf || '';
  if ($('tamanhoLogoPdf')) $('tamanhoLogoPdf').value = String(c.tamanhoLogoPdf || 80);
  if ($('tamanhoFonteTermosPdf') && $('tamanhoFonteTermosPdfRange')) {
    var _fonteTermosAtual = c.tamanhoFonteTermosPdf || 0;
    $('tamanhoFonteTermosPdf').value = _fonteTermosAtual > 0 ? String(_fonteTermosAtual) : '';
    $('tamanhoFonteTermosPdfRange').value = String(_fonteTermosAtual > 0 ? _fonteTermosAtual : 7.8);
  }
  $('modoEscuroConfig').checked = c.temaModo === 'dark';
  preencherCamposTemaSistema(c.tema);
  preencherCamposTemaPdf(c.temaPdf);
  $('senhaExclusaoConfig').value = '';
  $('senhaExclusaoConfig').placeholder = c.senhaExclusaoConfigurada ? 'Senha já definida (digite para trocar)' : 'Mínimo de 6 caracteres';
  carregarPoliticaExclusaoConfig(c).catch(e => {
    const status = $('statusMinhaSenhaExclusao');
    if (status) status.textContent = 'Não foi possível carregar a regra: ' + e.message;
  });
  // v20: Integrações
  const mpEl = document.getElementById('mpTokenConfig');
  // Correção: obterConfig() nunca devolve mercadoPagoToken (é removido por
  // segurança) — o campo correto que indica "já configurado" é possuiTokenMP.
  if (mpEl) mpEl.placeholder = c.possuiTokenMP ? 'Token configurado (•••••)' : 'APP_USR-...';
  const mpWhatsAppAtivoEl = document.getElementById('mercadoPagoWhatsAppAtivoConfig');
  if (mpWhatsAppAtivoEl) mpWhatsAppAtivoEl.checked = c.mercadoPagoWhatsAppAtivo === true;
  exibirChipChaveSalva('chipMpToken', 'chipMpTokenValor', c.possuiTokenMP ? 'Credencial protegida no Windows' : '');
  const statusTesteMPEl = document.getElementById('statusTesteMP');
  if (statusTesteMPEl) statusTesteMPEl.textContent = ''; // limpa resultado de teste de uma visita anterior à aba
  const pixEl = document.getElementById('pixChaveConfig');
  if (pixEl) pixEl.value = c.pixChave || '';
  const pixTipoEl = document.getElementById('pixTipoChaveConfig');
  if (pixTipoEl) pixTipoEl.value = c.pixTipoChave || 'telefone';
  // v24: Wappfly + Google Maps
  const wappUrlEl = document.getElementById('wappflyUrlConfig');
  if (wappUrlEl) wappUrlEl.value = c.wappflyApiUrl || '';
  const wappKeyEl = document.getElementById('wappflyKeyConfig');
  if (wappKeyEl) wappKeyEl.placeholder = c.possuiWappflyKey ? 'Chave configurada (•••••)' : 'Chave da API (x-api-key)';
  // v40.2: IA (Groq) — classificação da forma de pagamento manual
  const groqKeyEl = document.getElementById('groqApiKeyConfig');
  if (groqKeyEl) groqKeyEl.placeholder = c.possuiGroqKey ? 'Chave configurada (•••••)' : 'gsk_...';
  exibirChipChaveSalva('chipGroqKey', 'chipGroqKeyValor', c.possuiGroqKey ? 'Credencial protegida no Windows' : '');
  const groqAtivaEl = document.getElementById('groqClassificacaoAtivaConfig');
  if (groqAtivaEl) groqAtivaEl.checked = c.groqClassificacaoAtiva !== false;
  const statusTesteGroqEl = document.getElementById('statusTesteGroq');
  if (statusTesteGroqEl) statusTesteGroqEl.textContent = ''; // limpa qualquer resultado de teste de uma visita anterior à aba
  // Assistente IA: mostra somente a chave do provedor escolhido.
  const statusTesteGroqChatEl = document.getElementById('statusTesteGroqChat');
  if (statusTesteGroqChatEl) statusTesteGroqChatEl.textContent = '';
  if ($('iaChatProviderConfig')) $('iaChatProviderConfig').value = c.iaChatProvider || 'groq';
  preencherModelosIA($('iaChatModelConfig'), $('iaChatProviderConfig')?.value || 'groq', c.iaChatModel || '');
  atualizarFluxoIAConfig(c, null);
  carregarIntegracaoIAEmpresa(c).catch(() => {});
  const gmapsEl = document.getElementById('googleMapsLinkConfig');
  if (gmapsEl) gmapsEl.value = c.googleMapsReviewLink || '';
  // v25.3: Link de avaliação do Google (mensagem de entrega)
  const linkGoogleEl = document.getElementById('linkGoogleAvaliacaoConfig');
  if (linkGoogleEl) linkGoogleEl.value = c.linkGoogleAvaliacao || '';
  const supabaseAtivoEl = document.getElementById('supabaseAtivoConfig');
  if (supabaseAtivoEl) supabaseAtivoEl.checked = c.supabaseAtivo === true;
  const supabaseUrlEl = document.getElementById('supabaseUrlConfig');
  if (supabaseUrlEl) supabaseUrlEl.value = c.supabaseUrl || '';
  const supabaseKeyEl = document.getElementById('supabaseAnonKeyConfig');
  if (supabaseKeyEl) supabaseKeyEl.placeholder = c.possuiSupabaseConfig ? 'Configurada (deixe vazio para manter)' : 'eyJ...';
  exibirChipChaveSalva('chipSupabaseKey', 'chipSupabaseKeyValor', c.mascaraSupabaseAnonKey);
  const statusTesteSupabaseEl = document.getElementById('statusTesteSupabase');
  if (statusTesteSupabaseEl) statusTesteSupabaseEl.textContent = '';
  atualizarStatusSyncSupabaseNaTela();
  // v25.3: Código do país padrão para WhatsApp
  const ddiEl = document.getElementById('codigoPaisWhatsappConfig');
  if (ddiEl) ddiEl.value = c.codigoPaisWhatsapp || '55';
  // Preenche também o campo DDI do modal de cobrança com o valor atual
  const cobrancaDdiEl = document.getElementById('codigoPaisCobranca');
  if (cobrancaDdiEl) cobrancaDdiEl.value = c.codigoPaisWhatsapp || '55';
  // Parte 2.1: preenchimento automático de datas e horários
  const preencherDatasEl = document.getElementById('preencherDatasAutoConfig');
  if (preencherDatasEl) preencherDatasEl.checked = !!c.preencherDatasAuto;
  // Etapa 22: horário de funcionamento (exibido na mensagem "Pronto para Retirada")
  const horarioFuncEl = document.getElementById('horarioFuncionamentoConfig');
  if (horarioFuncEl) horarioFuncEl.value = c.horarioFuncionamento || '';
  // Carregar lista de backups automáticos
  carregarListaBackupsAuto();
  carregarStatusBackupAuto();
  if (c.logoBase64) {
    $('previewLogoAtual').innerHTML = `<img src="${c.logoBase64}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain;">`;
    $('btnRemoverLogo').style.display = '';
  } else {
    $('previewLogoAtual').innerHTML = '<span class="logo-preview-vazio">Nenhuma logo</span>';
    $('btnRemoverLogo').style.display = 'none';
  }
  $('modalConfig').classList.remove('escondido');
});

$('btnSalvarMinhaSenhaExclusao')?.addEventListener('click', async () => {
  const senha = String($('senhaExclusaoConfig')?.value || '');
  if (senha.length < 6) {
    toast('A senha de exclusão precisa ter pelo menos 6 caracteres.', 'erro');
    return;
  }
  const resposta = await window.api.configdefinirminhasenhaexclusao(senha);
  if (!resposta?.sucesso) {
    toast(resposta?.erro || 'Não foi possível definir a senha.', 'erro');
    return;
  }
  $('senhaExclusaoConfig').value = '';
  toast('Sua senha de exclusão foi salva para o PC e o celular.', 'sucesso');
  const config = await window.api.configobter();
  configAtual = config;
  await carregarPoliticaExclusaoConfig(config);
});

$('btnSalvarPoliticaExclusao')?.addEventListener('click', async () => {
  const todos = $('semSenhaTodosConfig')?.checked === true;
  const usuarios = Array.from(document.querySelectorAll('.usuario-sem-senha-exclusao:checked'))
    .map(el => el.value)
    .filter(Boolean);
  const resposta = await window.api.configconfigurarpoliticaexclusao(todos, usuarios);
  if (!resposta?.sucesso) {
    toast(resposta?.erro || 'Não foi possível salvar as permissões.', 'erro');
    return;
  }
  toast('Permissões de exclusão atualizadas no PC e no celular.', 'sucesso');
  const config = await window.api.configobter();
  configAtual = config;
  await carregarPoliticaExclusaoConfig(config);
});

$('btnNovoUsuarioPoliticaExclusao')?.addEventListener('click', async () => {
  await abrirModalUsuarios();
  await abrirFormNovoUsuario();
});

$('possuiCnpj').addEventListener('change', e => {
  $('campoCnpj').classList.toggle('escondido', !e.target.checked);
});

// Máscara CNPJ
$('cnpjEmpresa').addEventListener('input', e => {
  const el = e.target;
  const pos = el.selectionStart;
  const prevLen = el.value.length;
  let v = el.value.replace(/\D/g,'').slice(0,14);
  if (v.length > 12) v = v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/,'$1.$2.$3/$4-$5');
  else if (v.length > 8) v = v.replace(/(\d{2})(\d{3})(\d{3})(\d{0,4})/,'$1.$2.$3/$4');
  else if (v.length > 5) v = v.replace(/(\d{2})(\d{3})(\d{0,3})/,'$1.$2.$3');
  else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,3})/,'$1.$2');
  el.value = v;
  const diff = el.value.length - prevLen;
  el.setSelectionRange(pos + diff, pos + diff);
});

// Máscara CEP
$('cep').addEventListener('input', e => {
  const el = e.target;
  const pos = el.selectionStart;
  const prevLen = el.value.length;
  let v = el.value.replace(/\D/g,'').slice(0,8);
  if (v.length > 5) v = v.replace(/(\d{5})(\d{0,3})/,'$1-$2');
  el.value = v;
  const diff = el.value.length - prevLen;
  el.setSelectionRange(pos + diff, pos + diff);
});

async function normalizarLogoParaDocumentos(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const origem = document.createElement('canvas');
      origem.width = img.naturalWidth || img.width;
      origem.height = img.naturalHeight || img.height;
      const ctxOrigem = origem.getContext('2d', { willReadFrequently: true });
      ctxOrigem.drawImage(img, 0, 0);
      const pixels = ctxOrigem.getImageData(0, 0, origem.width, origem.height).data;
      let temTransparencia = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] < 250) { temTransparencia = true; break; }
      }

      let esquerda = origem.width;
      let topo = origem.height;
      let direita = -1;
      let base = -1;
      for (let y = 0; y < origem.height; y++) {
        for (let x = 0; x < origem.width; x++) {
          const i = (y * origem.width + x) * 4;
          const visivel = temTransparencia
            ? pixels[i + 3] > 8
            : pixels[i + 3] > 8 && (pixels[i] < 248 || pixels[i + 1] < 248 || pixels[i + 2] < 248);
          if (!visivel) continue;
          if (x < esquerda) esquerda = x;
          if (x > direita) direita = x;
          if (y < topo) topo = y;
          if (y > base) base = y;
        }
      }
      if (direita < esquerda || base < topo) {
        reject(new Error('A imagem da logo está vazia.'));
        return;
      }

      const larguraConteudo = direita - esquerda + 1;
      const alturaConteudo = base - topo + 1;
      const margem = Math.max(8, Math.round(Math.max(larguraConteudo, alturaConteudo) * 0.025));
      esquerda = Math.max(0, esquerda - margem);
      topo = Math.max(0, topo - margem);
      direita = Math.min(origem.width - 1, direita + margem);
      base = Math.min(origem.height - 1, base + margem);
      const larguraRecorte = direita - esquerda + 1;
      const alturaRecorte = base - topo + 1;
      const escala = Math.min(1, 1400 / Math.max(larguraRecorte, alturaRecorte));
      const destino = document.createElement('canvas');
      destino.width = Math.max(1, Math.round(larguraRecorte * escala));
      destino.height = Math.max(1, Math.round(alturaRecorte * escala));
      destino.getContext('2d').drawImage(
        origem,
        esquerda, topo, larguraRecorte, alturaRecorte,
        0, 0, destino.width, destino.height
      );
      resolve(destino.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Falha ao ler imagem'));
    img.src = dataUrl;
  });
}

$('inputLogo').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    // Remove margens vazias e preserva a transparência. Assim a marca usa
    // a área disponível no papel e permanece alinhada com os dados da empresa.
    let b64 = ev.target.result;
    try {
      b64 = await normalizarLogoParaDocumentos(b64);
    } catch { /* mantém base64 original se canvas falhar */ }
    const ext = f.name.split('.').pop();
    try {
      await window.api.configsalvarlogo(b64, ext);
    } catch (erro) {
      toast(erro?.message || 'Somente o administrador pode alterar a logo da empresa.', 'erro');
      e.target.value = '';
      return;
    }
    $('previewLogoAtual').innerHTML = `<img src="${b64}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain;">`;
    $('btnRemoverLogo').style.display = '';
    $('logoTopo').innerHTML = `<img src="${b64}" alt="Logo">`;
    configAtual.logoBase64 = b64;
    toast('Logo salva!', 'sucesso');
  };
  reader.readAsDataURL(f);
});

$('btnRemoverLogo').addEventListener('click', async () => {
  try {
    await window.api.configsalvar({ logoPath: '', logoBase64: '' });
  } catch (erro) {
    toast(erro?.message || 'Somente o administrador pode remover a logo da empresa.', 'erro');
    return;
  }
  $('previewLogoAtual').innerHTML = '<span class="logo-preview-vazio">Nenhuma logo</span>';
  $('btnRemoverLogo').style.display = 'none';
  $('logoTopo').innerHTML = '<img src="assets/logo-os-white.png" alt="Sistema OS">';
  configAtual.logoBase64 = '';
  toast('Logo removida', 'sucesso');
});

$('btnSalvarConfig').addEventListener('click', async () => {
  const enderecoCompleto = [
    $('endereco').value.trim(),
    $('numero').value.trim() ? `nº ${$('numero').value.trim()}` : '',
    $('complemento').value.trim(),
    $('bairro').value.trim(),
    [$('cidade').value.trim(), $('estado').value.trim()].filter(Boolean).join(' - '),
    $('cep').value.trim() ? `CEP ${$('cep').value.trim()}` : ''
  ].filter(Boolean).join(', ');

  const nova = {
    nomeEmpresa: $('nomeEmpresa').value.trim() || 'A&T Assistência Técnica',
    nomeFantasia: $('nomeFantasia').value.trim(),
    razaoSocial: $('razaoSocial').value.trim(),
    telefonePrincipal: $('telefonePrincipal').value.trim(),
    telefoneEmpresa: $('telefonePrincipal').value.trim(),
    telefoneFixo: $('telefoneFixo').value.trim(),
    whatsapp: $('whatsapp').value.trim(),
    email: $('emailEmpresa').value.trim(),
    site: $('site').value.trim(),
    endereco: $('endereco').value.trim(),
    numero: $('numero').value.trim(),
    complemento: $('complemento').value.trim(),
    bairro: $('bairro').value.trim(),
    cidade: $('cidade').value.trim(),
    estado: $('estado').value.trim(),
    cep: $('cep').value.trim(),
    enderecoEmpresa: enderecoCompleto,
    possuiCnpj: $('possuiCnpj').checked,
    cnpj: $('cnpjEmpresa').value.trim(),
    inscricaoEstadual: $('inscricaoEstadual').value.trim(),
    exibirCnpjDocumentos: $('exibirCnpjDocumentos').checked,
    percentualLucroPadrao: parseFloat($('percentualLucroPadrao').value) || 0,
    garantiaPadrao: $('garantiaPadrao').value.trim() || '90 dias',
    termosOS: $('termosOSConfig').value,
    termosVenda: $('termosVendaConfig').value,
    termosCompra: $('termosCompraConfig').value,
    termosGarantia: $('termosGarantiaConfig') ? $('termosGarantiaConfig').value : '',
    usarTermosPredefinidosOS:     !!($('usarTermosPredefinidosOS')     && $('usarTermosPredefinidosOS').checked),
    usarTermosPredefinidosVenda:  !!($('usarTermosPredefinidosVenda')  && $('usarTermosPredefinidosVenda').checked),
    usarTermosPredefinidosCompra: !!($('usarTermosPredefinidosCompra') && $('usarTermosPredefinidosCompra').checked),
    usarTermosPredefinidosGarantia: !!($('usarTermosPredefinidosGarantia') && $('usarTermosPredefinidosGarantia').checked),
    textoRodapePdf: $('textoRodapePdf').value.trim(),
    tamanhoLogoPdf: parseInt($('tamanhoLogoPdf')?.value || '80') || 80,
    tamanhoFonteTermosPdf: parseFloat($('tamanhoFonteTermosPdf')?.value || '0') || 0,
    temaModo: $('modoEscuroConfig').checked ? 'dark' : 'light'
  };
  // v20: Integrações
  const mpTokenEl = document.getElementById('mpTokenConfig');
  if (mpTokenEl && mpTokenEl.value.trim()) nova.mercadoPagoToken = mpTokenEl.value.trim();
  const mpWhatsAppAtivoSave = document.getElementById('mercadoPagoWhatsAppAtivoConfig');
  if (mpWhatsAppAtivoSave) nova.mercadoPagoWhatsAppAtivo = mpWhatsAppAtivoSave.checked;
  const pixChaveEl = document.getElementById('pixChaveConfig');
  if (pixChaveEl) nova.pixChave = pixChaveEl.value.trim();
  const pixTipoEl2 = document.getElementById('pixTipoChaveConfig');
  if (pixTipoEl2) nova.pixTipoChave = pixTipoEl2.value;
  // v24: Wappfly + Google Maps
  const wappUrlSave = document.getElementById('wappflyUrlConfig');
  if (wappUrlSave) nova.wappflyApiUrl = wappUrlSave.value.trim();
  const wappKeySave = document.getElementById('wappflyKeyConfig');
  if (wappKeySave && wappKeySave.value.trim()) nova.wappflyApiKey = wappKeySave.value.trim();
  const gmapsSave = document.getElementById('googleMapsLinkConfig');
  if (gmapsSave) nova.googleMapsReviewLink = gmapsSave.value.trim();
  // v40.2: IA (Groq) — classificação da forma de pagamento manual
  const groqKeySave = document.getElementById('groqApiKeyConfig');
  if (groqKeySave && groqKeySave.value.trim()) nova.groqApiKey = groqKeySave.value.trim();
  const groqAtivaSave = document.getElementById('groqClassificacaoAtivaConfig');
  if (groqAtivaSave) nova.groqClassificacaoAtiva = groqAtivaSave.checked;
  // IA: um único campo, vinculado ao provedor selecionado.
  const chaveIASave = document.getElementById('iaChatApiKeyConfig');
  nova.iaChatProvider = $('iaChatProviderConfig')?.value || 'groq';
  nova.iaChatModel = $('iaChatModelConfig')?.value || PROVEDORES_IA_CONFIG[nova.iaChatProvider].modelos[0][0];
  const chaveIANova = chaveIASave?.value?.trim() || '';
  const definicaoIASave = PROVEDORES_IA_CONFIG[nova.iaChatProvider];
  if (chaveIANova) nova[definicaoIASave.campoLocal] = chaveIANova;
  // v25.3: Link de avaliação do Google (mensagem de entrega)
  const linkGoogleSave = document.getElementById('linkGoogleAvaliacaoConfig');
  if (linkGoogleSave) nova.linkGoogleAvaliacao = linkGoogleSave.value.trim();
  // v25.3: Código do país padrão para WhatsApp
  const ddiSave = document.getElementById('codigoPaisWhatsappConfig');
  if (ddiSave) nova.codigoPaisWhatsapp = ddiSave.value.replace(/\D/g, '') || '55';
  // Parte 2.1: preenchimento automático de datas e horários
  const preencherDatasSave = document.getElementById('preencherDatasAutoConfig');
  if (preencherDatasSave) nova.preencherDatasAuto = preencherDatasSave.checked;
  // Etapa 22: horário de funcionamento
  const horarioFuncSave = document.getElementById('horarioFuncionamentoConfig');
  if (horarioFuncSave) nova.horarioFuncionamento = horarioFuncSave.value.trim();
  const temaSistema = {};
  document.querySelectorAll('[data-tema-campo]').forEach(i => { temaSistema[i.dataset.temaCampo] = i.value; });
  nova.tema = temaSistema;
  const temaPdf = { usarTemaSistemaPdf: $('usarTemaSistemaPdf').checked };
  document.querySelectorAll('[data-tema-pdf-campo]').forEach(i => { temaPdf[i.dataset.temaPdfCampo] = i.value; });
  nova.temaPdf = temaPdf;
  const supabaseCampos = {};
  const supabaseUrlSave = document.getElementById('supabaseUrlConfig');
  const supabaseKeySave = document.getElementById('supabaseAnonKeyConfig');
  if (supabaseUrlSave?.value.trim()) supabaseCampos.url = supabaseUrlSave.value.trim();
  if (supabaseKeySave?.value.trim()) supabaseCampos.anonKey = supabaseKeySave.value.trim();
  if (Object.keys(supabaseCampos).length) nova.supabaseConfig = supabaseCampos;
  const supabaseAtivoSave = document.getElementById('supabaseAtivoConfig');
  if (supabaseAtivoSave) nova.supabaseAtivo = supabaseAtivoSave.checked;
  if (chaveIANova || integracaoIAEmpresaCache?.status === 'conectada') {
    const nuvemIA = await window.api.supabaseintegracaoia?.('configurar', {
      provedor: nova.iaChatProvider, modelo: nova.iaChatModel, apiKey: chaveIANova
    });
    if (!nuvemIA?.sucesso) {
      toast(nuvemIA?.erro || 'Não foi possível validar a integração de IA.', 'erro');
      return;
    }
    integracaoIAEmpresaCache = nuvemIA.integracao || integracaoIAEmpresaCache;
  }
  const configSalva = await window.api.configsalvar(nova);
  try {
    await window.api.configsalvarpreferenciaslocais({
      abrirComWindows: $('abrirComWindowsConfig')?.checked === true,
      modoEconomicoSegundoPlano: $('modoEconomicoSegundoPlanoConfig')?.checked !== false
    });
  } catch (erro) {
    toast(erro?.message || 'As configurações da empresa foram salvas, mas o Windows não aceitou a preferência de inicialização.', 'erro');
    return;
  }
  configAtual = Object.assign(configAtual, nova, configSalva, { senhaExclusao: undefined });
  delete configAtual.senhaExclusao;
  await atualizarTermosResolvidos();
  atualizarStatusSyncSupabaseNaTela();
  aplicarTema(nova.temaModo);
  aplicarTemaCores(nova.tema);
  $('nomeSistema').textContent = nova.nomeEmpresa;
  $('modalConfig').classList.add('escondido');
  toast('Configurações salvas!', 'sucesso');
});

// ══════════════════════════════════════════
// NOVA OS
// ══════════════════════════════════════════
$('dataAutomatica').addEventListener('change', e => {
  $('campoDataManual').classList.toggle('escondido', e.target.checked);
});

// Máscara CPF
$('cpf').addEventListener('input', e => {
  const el = e.target;
  const pos = el.selectionStart;
  const prevLen = el.value.length;
  let v = el.value.replace(/\D/g,'').slice(0,11);
  if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/,'$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{0,3})/,'$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{0,3})/,'$1.$2');
  el.value = v;
  const diff = el.value.length - prevLen;
  el.setSelectionRange(pos + diff, pos + diff);
});
$('telefone').addEventListener('input', e => {
  const el = e.target;
  const pos = el.selectionStart;
  const prevLen = el.value.length;
  let v = el.value.replace(/\D/g,'').slice(0,11);
  if (v.length > 6) v = v.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3');
  else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,5})/,'($1) $2');
  el.value = v;
  const diff = el.value.length - prevLen;
  el.setSelectionRange(pos + diff, pos + diff);
});

// ETAPA 8.6.1 — estado dos checklists técnicos (Nova OS)
let novoChecklistDefeitos = [];
let novoChecklistAcessorios = [];
let novoChecklistTestes = [];
let novoChecklistEntrada = [];
let novoChecklistSaida = [];
let novosLembretesCobranca = [];

function _dataParcelaMes(dataIso, meses) {
  const partes = String(dataIso || '').split('-').map(Number);
  if (partes.length !== 3 || partes.some(n => !Number.isFinite(n))) return '';
  const ano = partes[0];
  const mesBase = partes[1] - 1 + meses;
  const anoDestino = ano + Math.floor(mesBase / 12);
  const mesDestino = ((mesBase % 12) + 12) % 12;
  const ultimoDia = new Date(anoDestino, mesDestino + 1, 0).getDate();
  const diaDestino = Math.min(partes[2], ultimoDia);
  return `${anoDestino}-${String(mesDestino + 1).padStart(2, '0')}-${String(diaDestino).padStart(2, '0')}`;
}

function _valoresParcelasEmCentavos(total, quantidade) {
  const totalCentavos = Math.round(Number(total || 0) * 100);
  const base = Math.floor(totalCentavos / quantidade);
  const resto = totalCentavos % quantidade;
  return Array.from({ length: quantidade }, (_, indice) => (base + (indice < resto ? 1 : 0)) / 100);
}

function renderizarParcelasNovaOS() {
  const lista = $('novaListaParcelasOS');
  const resumo = $('novaParcelasResumo');
  if (!lista || !resumo) return;
  if (!novosLembretesCobranca.length) {
    lista.innerHTML = '';
    resumo.textContent = 'Informe o valor da OS, escolha a quantidade e a primeira data.';
    return;
  }
  const total = novosLembretesCobranca.reduce((soma, item) => soma + Number(item.valor || 0), 0);
  resumo.textContent = `${novosLembretesCobranca.length} parcelas · total ${fmtMoeda(total)}. Você pode ajustar cada vencimento.`;
  lista.innerHTML = novosLembretesCobranca.map((item, indice) => `
    <div class="lembrete-cobranca-item parcela-os-item">
      <div><small>Parcela ${indice + 1} de ${novosLembretesCobranca.length}</small><strong>${fmtMoeda(item.valor)}</strong></div>
      <div class="campo"><label for="novaParcelaData-${indice}">Vencimento</label><input id="novaParcelaData-${indice}" type="date" value="${item.data || ''}" data-parcela-data="${indice}" /></div>
    </div>`).join('');
  lista.querySelectorAll('[data-parcela-data]').forEach(input => {
    input.addEventListener('change', () => {
      const indice = Number(input.dataset.parcelaData);
      if (novosLembretesCobranca[indice]) novosLembretesCobranca[indice].data = input.value;
    });
  });
}

function gerarParcelasNovaOS() {
  const valorOS = Number($('diagValorEstimado')?.value || 0);
  const quantidade = Number($('novaQuantidadeParcelas')?.value || 0);
  const primeiraData = $('novaPrimeiraParcelaData')?.value || '';
  if (valorOS <= 0) {
    toast('Informe primeiro o valor do orçamento da OS.', 'erro');
    $('diagValorEstimado')?.focus();
    return;
  }
  if (!Number.isInteger(quantidade) || quantidade < 2 || quantidade > 12) {
    toast('Escolha uma quantidade válida de parcelas.', 'erro');
    $('novaQuantidadeParcelas')?.focus();
    return;
  }
  if (!primeiraData) {
    toast('Escolha a data do primeiro vencimento.', 'erro');
    $('novaPrimeiraParcelaData')?.focus();
    return;
  }
  const agora = new Date().toISOString();
  const valores = _valoresParcelasEmCentavos(valorOS, quantidade);
  novosLembretesCobranca = valores.map((valor, indice) => ({
    id: `cob-${Date.now()}-${indice}-${Math.random().toString(36).slice(2, 6)}`,
    data: _dataParcelaMes(primeiraData, indice), valor, criadoEm: agora,
    status: 'pendente', avisarAntesDias: 0, confirmadoEm: '', valorRecebido: 0
  }));
  renderizarParcelasNovaOS();
}

$('btnGerarParcelasNovaOS')?.addEventListener('click', gerarParcelasNovaOS);
$('diagValorEstimado')?.addEventListener('input', () => {
  if (!novosLembretesCobranca.length) return;
  const valorOS = Number($('diagValorEstimado')?.value || 0);
  if (valorOS <= 0) return;
  const valores = _valoresParcelasEmCentavos(valorOS, novosLembretesCobranca.length);
  novosLembretesCobranca = novosLembretesCobranca.map((item, indice) => ({ ...item, valor: valores[indice] }));
  renderizarParcelasNovaOS();
});

function calcularPrecoSugeridoOS() {
  const investido = parseFloat($('valorInvestido').value) || 0;
  const pct = parseFloat($('percentualLucro').value);
  const pctUsar = isNaN(pct) ? (configAtual.percentualLucroPadrao ?? 30) : pct;
  const sugerido = investido * (1 + pctUsar / 100);
  $('precoSugerido').value = fmtMoeda(sugerido);
}
$('valorInvestido').addEventListener('input', calcularPrecoSugeridoOS);
$('percentualLucro').addEventListener('input', calcularPrecoSugeridoOS);

// Checkbox "sem número" — Nova OS
if ($('semNumero')) {
  $('semNumero').addEventListener('change', () => {
    const marcado = $('semNumero').checked;
    const telEl   = $('telefone');
    const ast     = $('telefoneAsteristico');
    if (telEl) { telEl.disabled = marcado; telEl.value = marcado ? '' : telEl.value; telEl.style.opacity = marcado ? '0.4' : ''; telEl.placeholder = marcado ? 'Sem número' : '(00) 00000-0000'; }
    if (ast) ast.style.display = marcado ? 'none' : '';
  });
}

$('btnSalvarOS').addEventListener('click', async () => {
  const nome = $('nome').value.trim();
  const telefone = $('telefone').value.trim();
  const semNumero = $('semNumero')?.checked;
  const marca = $('marca').value.trim();
  const modelo = $('modelo').value.trim();
  const defeito = $('defeitoRelatado').value.trim();
  const cpf = $('cpf').value.trim();
  const imei = $('imei').value.trim();

  // Limpar erros anteriores
  limparErros('nome','telefone','marca','modelo','defeitoRelatado','cpf','imei');

  let valido = true;
  if (!nome) { marcarErro('nome', 'Nome do cliente é obrigatório.'); valido = false; }
  if (!telefone && !semNumero) { marcarErro('telefone', 'Informe o telefone ou marque "Cliente não tem número".'); valido = false; }
  if (!marca) { marcarErro('marca', 'Marca é obrigatória.'); valido = false; }
  if (!modelo) { marcarErro('modelo', 'Modelo é obrigatório.'); valido = false; }
  if (!defeito) { marcarErro('defeitoRelatado', 'Defeito relatado é obrigatório.'); valido = false; }
  // Validação de formato: CPF (apenas se preenchido)
  if (cpf && !validarCPF(cpf)) { marcarErro('cpf', 'CPF inválido.'); valido = false; }
  // Validação de formato: IMEI (apenas se preenchido)
  if (imei && !validarIMEI(imei)) { marcarErro('imei', 'IMEI inválido (deve ter 15 dígitos).'); valido = false; }
  if (novosLembretesCobranca.some(item => !item.data)) {
    mostrarMsg('mensagemFormulario', 'Informe a data de vencimento de todas as parcelas.', 'erro');
    [...($('novaListaParcelasOS')?.querySelectorAll('input[type="date"]') || [])].find(input => !input.value)?.focus();
    return;
  }
  if (!valido) { mostrarMsg('mensagemFormulario', 'Corrija os campos destacados em vermelho.', 'erro'); return; }

  $('btnSalvarOS').disabled = true;
  $('btnSalvarOS').innerHTML = `${ICONE_RELOGIO} Salvando...`;
  try {
    const tipoEquipamento = $('tipoEquipamento') ? $('tipoEquipamento').value : 'Smartphone';
    const dadosOS = {
      status: $('statusOS').value,
      prioridade: $('prioridadeOS').value,
      controleInterno: {
        codigoInterno: $('codigoInterno').value.trim(),
        etiquetaInterna: $('etiquetaInterna').value.trim(),
        tagBancada: $('tagBancada').value.trim(),
        numeroPatrimonio: $('numeroPatrimonio').value.trim()
      },
      tecnicoResponsavel: $('tecnicoResponsavel').value.trim(),
      tecnicoAuxiliar: $('tecnicoAuxiliar').value.trim(),
      cliente: { nome, cpf, email: $('email').value, telefone: semNumero ? '' : telefone },
      aparelho: {
        tipo: tipoEquipamento, tipoEquipamento, marca, modelo,
        cor: $('cor').value, imei, defeitoRelatado: defeito,
        observacoes: $('observacoes').value, acessorios: $('acessorios').value,
        senhaAparelho: $('senhaAparelho').value,
        dadosEquipamento: coletarDadosEquipamento('nv', tipoEquipamento),
        checklistDefeitos: [...novoChecklistDefeitos],
        acessoriosChecklist: [...novoChecklistAcessorios],
        testesEntrada: [...novoChecklistTestes]
      },
      imei,
      observacoes: $('observacoes').value,
      termos: $('termos').value,
      valorInvestido: $('valorInvestido').value,
      percentualLucro: $('percentualLucro').value,
      dataManual: !$('dataAutomatica').checked ? $('dataManual').value : null,
      dataAutomatic: $('dataAutomatica').checked,
      semPrazo: $('semPrazoOS')?.checked === true,
      dataPrevista: $('semPrazoOS')?.checked ? '' : $('dataPrevista').value,
      horaPrevista: $('semPrazoOS')?.checked ? '' : $('horaPrevista').value,
      diagnosticoTecnico: {
        diagnostico: $('diagDiagnostico').value.trim(),
        solucao: $('diagSolucao').value.trim(),
        pecas: $('diagPecas').value.trim(),
        pecasTrocar: diagColetarPecasTrocar('nv'),
        valorEstimado: $('diagValorEstimado').value,
        prazoEstimado: $('diagPrazoEstimado').value.trim()
      },
      checklistEntrada: [...novoChecklistEntrada],
      observacoesEntrada: $('obsEntrada').value.trim(),
      checklistSaida: [...novoChecklistSaida],
      observacoesSaida: $('obsSaida').value.trim(),
      lembretesCobranca: novosLembretesCobranca.map(item => ({ ...item }))
    };
    const os = await window.api.oscriar(dadosOS, usuarioAtual?.id);
    mostrarMsg('mensagemFormulario', `OS ${os.numero} criada! PDF gerado.`, '');
    toast(`OS ${os.numero} criada com sucesso!`, 'sucesso');
    limparFormOS();
  } catch (err) {
    mostrarMsg('mensagemFormulario', 'Erro ao criar OS: ' + err.message, 'erro');
  } finally {
    $('btnSalvarOS').disabled = false;
    $('btnSalvarOS').textContent = 'Salvar OS e Gerar PDF';
  }
});

$('btnLimparForm').addEventListener('click', limparFormOS);

function aplicarEstadoSemPrazo(checkId, dataId, horaId) {
  const marcado = $(checkId)?.checked === true;
  const data = $(dataId);
  const hora = $(horaId);
  if (data) {
    data.disabled = marcado;
    if (marcado) data.value = '';
  }
  if (hora) {
    hora.disabled = marcado;
    if (marcado) hora.value = '';
  }
}

$('semPrazoOS')?.addEventListener('change', () => aplicarEstadoSemPrazo('semPrazoOS', 'dataPrevista', 'horaPrevista'));
$('editSemPrazoOS')?.addEventListener('change', () => aplicarEstadoSemPrazo('editSemPrazoOS', 'editDataPrevista', 'editHoraPrevista'));

function limparFormOS() {
  ['nome','cpf','email','telefone','marca','modelo','cor','imei','senhaAparelho','acessorios','valorInvestido','percentualLucro','codigoInterno','etiquetaInterna','tagBancada','numeroPatrimonio','tecnicoResponsavel','tecnicoAuxiliar'].forEach(id => { const el=$(id); if(el) el.value=''; });
  diagLimparPecasTrocar('nv');
  // Resetar checkbox "sem número"
  const chkSN = $('semNumero');
  if (chkSN) { chkSN.checked = false; }
  const telEl = $('telefone');
  if (telEl) { telEl.disabled = false; telEl.style.opacity = ''; telEl.placeholder = '(00) 00000-0000'; }
  const astSN = $('telefoneAsteristico');
  if (astSN) astSN.style.display = '';
  if ($('prioridadeOS')) $('prioridadeOS').value = 'Normal';
  if ($('tipoEquipamento')) {
    $('tipoEquipamento').value = 'Smartphone';
    renderCamposDinamicos('Smartphone', 'camposDinamicosAparelho', 'nv', {});
    toggleCampoImei('campoImei', 'Smartphone');
  }
  $('precoSugerido').value = '';
  ['defeitoRelatado','observacoes'].forEach(id => { const el=$(id); if(el) el.value=''; });
  $('statusOS').value = 'Aguardando análise';
  $('dataAutomatica').checked = true;
  $('campoDataManual').classList.add('escondido');
  if ($('dataPrevista')) $('dataPrevista').value = '';
  if ($('horaPrevista')) $('horaPrevista').value = '';
  if ($('semPrazoOS')) $('semPrazoOS').checked = false;
  novosLembretesCobranca = [];
  if ($('novaQuantidadeParcelas')) $('novaQuantidadeParcelas').value = '2';
  if ($('novaPrimeiraParcelaData')) $('novaPrimeiraParcelaData').value = '';
  renderizarParcelasNovaOS();
  aplicarEstadoSemPrazo('semPrazoOS', 'dataPrevista', 'horaPrevista');
  aplicarTermosPadraoNoCampo('os', 'termos', true);
  // ETAPA 8.6.1 — reseta checklists técnicos e diagnóstico
  novoChecklistDefeitos = [];
  novoChecklistAcessorios = [];
  novoChecklistTestes = [];
  const tipoAtualForm = $('tipoEquipamento') ? $('tipoEquipamento').value : 'Smartphone';
  renderizarChecklistBox('checklistDefeitosNovo', listaDefeitosPorTipo(tipoAtualForm), novoChecklistDefeitos);
  renderizarChecklistBox('checklistAcessoriosNovo', CHECKLIST_ACESSORIOS_RECEBIDOS, novoChecklistAcessorios);
  renderizarChecklistBox('checklistTestesNovo', CHECKLIST_TESTES_ENTRADA, novoChecklistTestes);
  novoChecklistEntrada = [];
  novoChecklistSaida = [];
  renderizarChecklistBox('checklistEntradaNovo', CHECKLIST_ENTRADA, novoChecklistEntrada);
  renderizarChecklistBox('checklistSaidaNovo', CHECKLIST_SAIDA, novoChecklistSaida);
  if ($('obsEntrada')) $('obsEntrada').value = '';
  if ($('obsSaida')) $('obsSaida').value = '';
  ['diagDiagnostico','diagSolucao','diagPecas','diagValorEstimado','diagPrazoEstimado'].forEach(id => { const el=$(id); if(el) el.value=''; });
  // Parte 2.1: preencher data/hora prevista automaticamente se configuração ativa
  if (configAtual.preencherDatasAuto && !$('semPrazoOS')?.checked) {
    const agora = new Date();
    const yyyy = agora.getFullYear();
    const mm = String(agora.getMonth()+1).padStart(2,'0');
    const dd = String(agora.getDate()).padStart(2,'0');
    const hh = String(agora.getHours()).padStart(2,'0');
    const mi = String(agora.getMinutes()).padStart(2,'0');
    if ($('dataPrevista')) $('dataPrevista').value = `${yyyy}-${mm}-${dd}`;
    if ($('horaPrevista')) $('horaPrevista').value = `${hh}:${mi}`;
  }
  mostrarMsg('mensagemFormulario','','');
}

function mostrarMsg(id, msg, tipo) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'mensagem' + (tipo ? ' '+tipo : '');
}

// ══════════════════════════════════════════
// HISTÓRICO
// ══════════════════════════════════════════
let _clientesCache = [];
let _clienteDebounce = null;

async function carregarClientes(termo) {
  const lista = $('listaClientes');
  if (!lista) return;
  lista.innerHTML = '<p class="vazio" style="text-align:center;padding:40px;">Carregando...</p>';
  const infoEl = $('clienteInfoBusca');
  try {
    const clientes = termo ? await window.api.clientesbuscar(termo) : await window.api.clienteslistar();
    _clientesCache = clientes || [];

    if (infoEl) {
      if (termo) {
        infoEl.style.display = 'block';
        infoEl.innerHTML = _clientesCache.length > 0
          ? `<b>${_clientesCache.length}</b> resultado${_clientesCache.length !== 1 ? 's' : ''} para "<b>${_escHtml(termo)}</b>"`
          : `Nenhum resultado para "<b>${_escHtml(termo)}</b>"`;
      } else {
        infoEl.style.display = _clientesCache.length > 0 ? 'block' : 'none';
        if (_clientesCache.length > 0) infoEl.innerHTML = `<b>${_clientesCache.length}</b> cliente${_clientesCache.length !== 1 ? 's' : ''} encontrado${_clientesCache.length !== 1 ? 's' : ''}`;
      }
    }

    if (_clientesCache.length === 0) {
      lista.innerHTML = termo
        ? `<div style="padding:32px;text-align:center;color:#888;">Nenhum resultado encontrado para "<b>${_escHtml(termo)}</b>".<br><small>Tente buscar pelo ID do cliente, nome, CPF, telefone ou e-mail.</small></div>`
        : '<div style="padding:32px;text-align:center;color:#888;">Nenhum cliente encontrado ainda.<br><small>Clientes aparecem aqui automaticamente ao criar uma OS, vender ou comprar um aparelho ou emitir uma autorização.</small></div>';
      return;
    }

    lista.innerHTML = _clientesCache.map(c => {
      const nomeExibicao = _escHtml(c.nome || 'Sem nome');
      const contato = _escHtml(c.telefone || c.cpf || c.email || '—');
      const chaveSegura = _argJsUri(c.chave);
      return `<div class="card-estoque cliente-card" onclick="abrirPerfilCliente(decodeURIComponent('${chaveSegura}'))">
        <div class="card-est-header">
          <div>
            <div class="card-est-marca">${ICONE_PESSOA} ${nomeExibicao}</div>
            <div class="card-est-modelo">Cliente #${_escHtml(c.clienteId || '00000')} · ${contato}</div>
          </div>
          <span class="status-badge status-pronto">${c.qtdInteracoes} registro${c.qtdInteracoes !== 1 ? 's' : ''}</span>
        </div>
        <div style="font-size:12px;color:var(--texto-sec);">Última interação: ${c.ultimaData ? fmtData(c.ultimaData) : '—'}</div>
        <div class="card-est-valores cliente-card-resumo" aria-label="Resumo dos registros do cliente">
          <span>${ICONE_FERRAMENTA}<span><b>${c.totalOS}</b> OS · ${fmtMoeda(c.totalValorOS)}</span></span>
          <span>${ICONE_ETIQUETA}<span><b>${c.vendas.length}</b> venda${c.vendas.length !== 1 ? 's' : ''}</span></span>
          <span>${ICONE_CARRINHO}<span><b>${c.compras.length}</b> compra${c.compras.length !== 1 ? 's' : ''}</span></span>
          <span>${ICONE_DOCUMENTO}<span><b>${c.entregas.length}</b> entrega${c.entregas.length !== 1 ? 's' : ''}</span></span>
          <span>${ICONE_ESCUDO}<span><b>${c.garantias.length}</b> garantia${c.garantias.length !== 1 ? 's' : ''}</span></span>
          <span>${ICONE_DOCUMENTO}<span><b>${(c.desbloqueios || []).length}</b> desbloqueio${(c.desbloqueios || []).length !== 1 ? 's' : ''}</span></span>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    lista.innerHTML = `<div style="padding:20px;color:red;">Erro: ${_escHtml(err.message)}</div>`;
  }
}

if ($('clienteFiltroTexto')) {
  $('clienteFiltroTexto').addEventListener('input', e => {
    clearTimeout(_clienteDebounce);
    const valor = e.target.value.trim();
    _clienteDebounce = setTimeout(() => carregarClientes(valor), 300);
  });
}
if ($('btnLimparBuscaCliente')) {
  $('btnLimparBuscaCliente').addEventListener('click', () => {
    $('clienteFiltroTexto').value = '';
    carregarClientes();
  });
}

// ─── PERFIL DO CLIENTE (modal com histórico consolidado) ────────
// ─── Perfil do Cliente: seção "Contato" em modo visualização vs. edição ───
// Só nome/telefone/CPF são editáveis (é o que atualizarDadosCliente aceita
// no backend — e-mail não vem de um campo único e confiável entre OS/Venda/
// Compra, então fica só como exibição por enquanto).
function _htmlContatoClienteVisualizacao(c) {
  return `
    <div class="detalhe-titulo">Contato</div>
    <div class="detalhe-grade">
      <div class="detalhe-campo"><span class="rot">ID do cliente</span><span class="val">#${_escHtml(c.clienteId || '00000')}</span></div>
      <div class="detalhe-campo"><span class="rot">Nome</span><span class="val">${_escHtml(c.nome || '—')}</span></div>
      <div class="detalhe-campo"><span class="rot">Telefone</span><span class="val">${_escHtml(c.telefone || '—')}</span></div>
      <div class="detalhe-campo"><span class="rot">CPF</span><span class="val">${_escHtml(c.cpf || '—')}</span></div>
      <div class="detalhe-campo"><span class="rot">E-mail</span><span class="val">${_escHtml(c.email || '—')}</span></div>
      <div class="detalhe-campo"><span class="rot">Última interação</span><span class="val">${c.ultimaData ? fmtData(c.ultimaData) : '—'}</span></div>
    </div>`;
}

function _htmlContatoClienteEdicao(c) {
  return `
    <div class="detalhe-titulo">Editar Contato</div>
    <div class="detalhe-grade">
      <div class="campo"><label>Nome</label><input type="text" id="editPerfilClienteNome" value="${_escHtml(c.nome || '')}"></div>
      <div class="campo"><label>Telefone</label><input type="text" id="editPerfilClienteTelefone" value="${_escHtml(c.telefone || '')}"></div>
      <div class="campo"><label>CPF</label><input type="text" id="editPerfilClienteCpf" value="${_escHtml(c.cpf || '')}"></div>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;">
      <button class="botao botao-primario" style="padding:6px 14px;font-size:12px;" onclick="salvarEdicaoPerfilCliente()">${ICONE_CHECK} Salvar</button>
      <button class="botao botao-secundario" style="padding:6px 14px;font-size:12px;" onclick="cancelarEdicaoPerfilCliente()">Cancelar</button>
    </div>
    <div style="font-size:11px;color:var(--texto-sec);margin-top:8px;">
      A alteração é aplicada em todas as OS, vendas, compras e autorizações já registradas para este cliente.
    </div>`;
}

window.editarPerfilCliente = function() {
  const c = window._clientePerfilAtual;
  if (!c) return;
  const secao = $('perfilClienteSecaoContato');
  if (secao) secao.innerHTML = _htmlContatoClienteEdicao(c);
};

window.cancelarEdicaoPerfilCliente = function() {
  const c = window._clientePerfilAtual;
  if (!c) return;
  const secao = $('perfilClienteSecaoContato');
  if (secao) secao.innerHTML = _htmlContatoClienteVisualizacao(c);
};

window.salvarEdicaoPerfilCliente = async function() {
  const c = window._clientePerfilAtual;
  if (!c) return;
  const nome = $('editPerfilClienteNome').value.trim();
  const telefone = $('editPerfilClienteTelefone').value.trim();
  const cpf = $('editPerfilClienteCpf').value.trim();
  if (!nome) { toast('O nome não pode ficar vazio.', 'erro'); return; }

  try {
    const r = await window.api.clientesatualizardados(c.chave, { nome, telefone, cpf }, usuarioAtual?.id);
    if (!r.sucesso) { toast('Erro ao salvar: ' + r.erro, 'erro'); return; }
    toast(`Cliente atualizado (${r.registrosAtualizados} registro${r.registrosAtualizados !== 1 ? 's' : ''}).`, 'sucesso');
    // Atualiza o cache local e reabre o perfil já com a chave nova (pode
    // ter mudado, se o CPF foi adicionado/alterado).
    await carregarClientes();
    const novoC = r.cliente || _clientesCache.find(x => x.chave === c.chave);
    if (novoC) window.abrirPerfilCliente(novoC.chave);
  } catch (e) {
    toast('Erro ao salvar cliente: ' + e.message, 'erro');
  }
};

window.excluirPerfilCliente = async function() {
  const c = window._clientePerfilAtual;
  if (!c) return;
  const confirmou = await confirmModal(
    `Excluir o cliente "${c.nome || 'Sem nome'}"?\n\nOs dados pessoais serão removidos. OS, vendas, compras e autorizações permanecem apenas para histórico e financeiro.`,
    { titulo: 'Excluir cliente' }
  );
  if (!confirmou) return;

  if (!(await autorizarExclusaoProtegida(`o cliente "${c.nome || 'Sem nome'}"`))) return;

  const resultado = await window.api.clientesexcluir(c.chave, usuarioAtual?.id);
  if (!resultado?.sucesso) {
    toast(resultado?.erro || 'Não foi possível excluir o cliente.', 'erro');
    return;
  }
  $('modalPerfilCliente').classList.add('escondido');
  window._clientePerfilAtual = null;
  await carregarClientes();
  toast(`Cliente excluído e ${resultado.registrosAtualizados} registro(s) anonimizado(s).`, 'sucesso');
};

window.abrirPerfilCliente = function(chave) {
  const c = _clientesCache.find(x => x.chave === chave);
  if (!c) return;
  window._clientePerfilAtual = c;
  $('perfilClienteNome').textContent = c.nome || 'Cliente sem nome';

  const blocoOS = c.os.length ? c.os.map(o => `
    <div style="background:var(--bg);border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div>
        <strong>${_escHtml(o.numero)}</strong> · ${o.data ? fmtData(o.data) : '—'}
        <span style="margin-left:6px;" class="${statusClass(o.status)}">${_escHtml(o.status || '')}</span>
        <div style="color:var(--texto-sec);margin-top:2px;">${_escHtml(o.aparelho || '')} · Valor estimado: ${fmtMoeda(o.valorEstimado || 0)}</div>
      </div>
      <button class="botao botao-secundario" style="padding:4px 10px;font-size:11px;" onclick="event.stopPropagation();verDetalheOS(decodeURIComponent('${_argJsUri(o.numero)}'))">${ICONE_OLHO} Ver</button>
    </div>`).join('') : '<p class="vazio" style="padding:10px 0;">Nenhuma OS registrada.</p>';

  const blocoVendas = c.vendas.length ? c.vendas.map(v => `
    <div style="background:var(--bg);border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div>
        <strong>${_escHtml(v.id)}</strong> · ${v.data ? fmtData(v.data) : '—'}
        <div style="color:var(--texto-sec);margin-top:2px;">${_escHtml(v.aparelho || '')} · ${fmtMoeda(v.valor)}</div>
      </div>
      <button class="botao botao-secundario" style="padding:4px 10px;font-size:11px;" onclick="event.stopPropagation();abrirModalEstoque(decodeURIComponent('${_argJsUri(v.id)}'))">${ICONE_OLHO} Ver</button>
    </div>`).join('') : '<p class="vazio" style="padding:10px 0;">Nenhuma venda registrada.</p>';

  const blocoCompras = c.compras.length ? c.compras.map(cp => `
    <div style="background:var(--bg);border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div>
        <strong>${_escHtml(cp.numero)}</strong> · ${cp.data ? fmtData(cp.data) : '—'}
        <div style="color:var(--texto-sec);margin-top:2px;">${_escHtml(cp.aparelho || '')} · ${fmtMoeda(cp.valor)}</div>
      </div>
      <button class="botao botao-secundario" style="padding:4px 10px;font-size:11px;" onclick="event.stopPropagation();verDetalheCompra(decodeURIComponent('${_argJsUri(cp.numero)}'))">${ICONE_OLHO} Ver</button>
    </div>`).join('') : '<p class="vazio" style="padding:10px 0;">Nenhuma compra registrada.</p>';

  const blocoEntregas = c.entregas.length ? c.entregas.map(en => `
    <div class="cliente-historico-item">
      <div><strong>${_escHtml(en.documentoEntregaId || en.numeroOS)}</strong> · ${en.data ? fmtData(en.data) : '—'}
        <div class="cliente-historico-meta">${_escHtml(en.numeroOS)} · ${en.tipo === 'retorno_garantia' ? 'Retorno em garantia' : 'Entrega original'} · ${en.garantiaDias} dias de garantia</div>
      </div>
      <button class="botao botao-secundario botao-xs" onclick="event.stopPropagation();abrirPdfEntregaUI(decodeURIComponent('${_argJsUri(en.numeroOS)}'),decodeURIComponent('${_argJsUri(en.cicloEntregaId || 'original')}'))">${ICONE_OLHO} Ver</button>
    </div>`).join('') : '<p class="vazio" style="padding:10px 0;">Nenhuma entrega registrada.</p>';

  const blocoGarantias = c.garantias.length ? c.garantias.map(g => `
    <div class="cliente-historico-item">
      <div><strong>Garantia ${_escHtml(g.numeroOS)}</strong> · ${g.data ? fmtData(g.data) : '—'}
        <div class="cliente-historico-meta">${g.garantiaDias} dias${g.dataLimite ? ` · válida até ${fmtData(g.dataLimite)}` : ''} · ${g.retornos} retorno${g.retornos !== 1 ? 's' : ''}</div>
      </div>
      <button class="botao botao-secundario botao-xs" onclick="event.stopPropagation();abrirPdfGarantiaUI(decodeURIComponent('${_argJsUri(g.numeroOS)}'))">${ICONE_OLHO} Ver</button>
    </div>`).join('') : '<p class="vazio" style="padding:10px 0;">Nenhuma garantia registrada.</p>';

  const desbloqueios = c.desbloqueios || [];
  const blocoDesbloqueios = desbloqueios.length ? desbloqueios.map(d => `
    <div class="cliente-historico-item">
      <div><strong>${_escHtml(d.numero)}</strong> · ${d.data ? fmtData(d.data) : '—'}
        <div class="cliente-historico-meta">${_escHtml(d.aparelho || 'Aparelho não informado')} · ${_escHtml(d.tipoBloqueio || 'Tipo não informado')} · ${d.assinaturaPendente ? 'Aguardando assinatura' : d.naoAssinado ? 'Não assinado' : 'Assinado'}</div>
      </div>
      <button class="botao botao-secundario botao-xs" onclick="event.stopPropagation();abrirPdfDesbloqueioPerfil(decodeURIComponent('${_argJsUri(d.numero)}'))">${ICONE_OLHO} Ver</button>
    </div>`).join('') : '<p class="vazio" style="padding:10px 0;">Nenhuma autorização de desbloqueio registrada.</p>';

  $('perfilClienteConteudo').innerHTML = `
    <div style="padding:18px 22px;">
      <div class="detalhe-secao" id="perfilClienteSecaoContato">
        ${_htmlContatoClienteVisualizacao(c)}
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Resumo</div>
        <div class="card-est-valores" style="font-size:13px;">
          <span>${ICONE_FERRAMENTA} ${c.totalOS} OS — ${fmtMoeda(c.totalValorOS)}</span>
          <span>${ICONE_ETIQUETA} ${c.vendas.length} venda${c.vendas.length !== 1 ? 's' : ''} — ${fmtMoeda(c.totalVendas)}</span>
          <span>${ICONE_CARRINHO} ${c.compras.length} compra${c.compras.length !== 1 ? 's' : ''} — ${fmtMoeda(c.totalCompras)}</span>
          <span>${ICONE_DOCUMENTO} ${c.entregas.length} entrega${c.entregas.length !== 1 ? 's' : ''}</span>
          <span>${ICONE_ESCUDO} ${c.garantias.length} garantia${c.garantias.length !== 1 ? 's' : ''}</span>
          <span>${ICONE_DOCUMENTO} ${desbloqueios.length} desbloqueio${desbloqueios.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo">${ICONE_FERRAMENTA} Ordens de Serviço (${c.os.length})</div>
        ${blocoOS}
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo">${ICONE_ETIQUETA} Vendas (${c.vendas.length})</div>
        ${blocoVendas}
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo">${ICONE_CARRINHO} Compras (${c.compras.length})</div>
        ${blocoCompras}
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo">${ICONE_DOCUMENTO} Entregas (${c.entregas.length})</div>
        ${blocoEntregas}
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo">${ICONE_ESCUDO} Garantias e retornos (${c.garantias.length})</div>
        ${blocoGarantias}
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo">${ICONE_DOCUMENTO} Autorizações de desbloqueio (${desbloqueios.length})</div>
        ${blocoDesbloqueios}
      </div>
    </div>
  `;
  $('modalPerfilCliente').classList.remove('escondido');
};

window.abrirPdfDesbloqueioPerfil = async function(numero) {
  try {
    const documento = await window.api.desbloqueioobter(numero);
    if (!documento) throw new Error('Autorização não encontrada.');
    const caminho = documento.pdfPath || await window.api.desbloqueiogerarpdf(numero);
    const resposta = await window.api.desbloqueioabrirpdf(caminho);
    if (resposta?.sucesso === false) throw new Error(resposta.erro || 'Não foi possível abrir o PDF.');
  } catch (erro) {
    toast(erro?.message || String(erro), 'erro');
  }
};

// ─── "NOVA OS" PRÉ-PREENCHIDA A PARTIR DO PERFIL DO CLIENTE ────
window.novaOSParaCliente = function() {
  const c = window._clientePerfilAtual;
  if (!c) return;
  $('modalPerfilCliente').classList.add('escondido');
  const abaNovaOS = document.querySelector('[data-aba="nova-os"]');
  if (abaNovaOS) abaNovaOS.click();
  limparFormOS();
  if ($('nome')) $('nome').value = c.nome || '';
  if ($('cpf')) $('cpf').value = c.cpf || '';
  if ($('telefone')) $('telefone').value = c.telefone || '';
  if ($('email')) $('email').value = c.email || '';
  buscarHistoricoCliente();
  toast(`Nova OS pré-preenchida para ${c.nome || 'o cliente'}.`, 'sucesso');
};

// ─── DETALHE OS ─────────────────────────────────────────────
function _renderizarAcoesDetalheOS(os, { incluirAcoesDestrutivas = false } = {}) {
  if (!os) return;

  const numero = os.numero;
  const temTelefone = !!(os.cliente?.telefone || '').trim();
  const pronto = os.status === 'Pronto para retirada';
  const entregue = os.status === 'Entregue';
  const pagamentoQuitado = ['Pago', 'Autorizado'].includes(os.statusPagamento)
    || Number(os.percentualPagamentoConfirmado) >= 100;

  const botaoPdf = os.pdfPath
    ? `<button class="botao botao-sucesso" onclick="abrirPdf('${os.pdfPath.replace(/\\/g, '/')}')">${ICONE_DOCUMENTO} Abrir PDF</button>`
    : `<button class="botao botao-secundario" onclick="regenarPdf('${numero}')">${ICONE_DOCUMENTO} Gerar PDF</button>`;

  // "Cobrar via WhatsApp" só aparece quando o pagamento ainda não foi quitado.
  const botaoWhatsApp = (temTelefone && pronto && !pagamentoQuitado)
    ? `<button class="botao" style="background:#0f6b35;color:#fff;" onclick="document.getElementById('modalDetalheOS').classList.add('escondido');setTimeout(()=>{const b=document.getElementById('btnWhatsAppOS');if(b){b.dataset.osNumero='${numero}';b.click();}},120);">${ICONE_CELULAR} Cobrar via WhatsApp</button>`
    : (temTelefone && entregue)
      ? `<button class="botao" style="background:#0f6b35;color:#fff;" onclick="document.getElementById('modalDetalheOS').classList.add('escondido');reenviarWappEntregue('${numero}')">${ICONE_CELULAR} WhatsApp Avaliação</button>`
      : '';

  const botaoFiscal = window.fiscalSistemaOSHabilitado?.() === true
    ? `<button class="botao botao-secundario" onclick="emitirNotaFiscalSistemaOS('os','${numero}')">${ICONE_DOCUMENTO} Emitir NFS-e</button>`
    : '';

  const acoesDestrutivas = incluirAcoesDestrutivas
    ? `
      <button class="botao botao-perigo" onclick="$('modalDetalheOS').classList.add('escondido');cancelarOSdaAutorizada('${numero}')">${ICONE_X} Cancelar OS</button>
      <button class="botao botao-perigo" onclick="$('modalDetalheOS').classList.add('escondido');excluirOS('${numero}')">${ICONE_LIXEIRA} Excluir OS</button>`
    : '';

  const detalheAcoes = $('detalheAcoes');
  detalheAcoes.innerHTML = `
    ${botaoPdf}
    <details class="menu-acoes-os">
      <summary class="botao botao-secundario menu-acoes-os-resumo">${ICONE_LISTA} Mais ações</summary>
      <div class="menu-acoes-os-lista">
        <button class="botao botao-secundario" onclick="emitirComprovanteOS('${numero}')">${ICONE_DOCUMENTO} ${(pronto || entregue) ? 'Comprovante térmico' : 'Emitir comprovante'}</button>
        <button class="botao botao-secundario" onclick="abrirEtiqueta('${numero}')">${ICONE_ETIQUETA} Imprimir etiqueta QR</button>
        ${botaoFiscal}
        ${botaoWhatsApp}
        <button class="botao botao-secundario" onclick="exportarParaAssinaturaCelular('os','${numero}')">${ICONE_CELULAR} Enviar para assinatura no celular</button>
        ${acoesDestrutivas}
      </div>
    </details>
    <button class="botao botao-fantasma" data-fechar="modalDetalheOS">Fechar</button>
    <button class="botao botao-primario" onclick="abrirEditarOS('${numero}');$('modalDetalheOS').classList.add('escondido');">${ICONE_LAPIS} Editar OS</button>`;

  detalheAcoes.querySelectorAll('[data-fechar]').forEach(botao => {
    botao.addEventListener('click', () => $(botao.dataset.fechar).classList.add('escondido'));
  });
}

function _htmlRetornosGarantiaNaOS(garantia) {
  const retornos = Array.isArray(garantia?.retornosGarantia) ? [...garantia.retornosGarantia] : [];
  if (!retornos.length) return '';
  retornos.sort((a, b) => Date.parse(a.abertoEm || 0) - Date.parse(b.abertoEm || 0));
  const total = retornos.length;
  const itens = retornos.map((retorno, indice) => {
    const etapas = Array.isArray(retorno.historico) ? retorno.historico : [];
    const ultimaEtapa = [...etapas].reverse().find(item => String(item.observacao || '').trim());
    return `<article class="os-retorno-garantia-item">
      <div class="os-retorno-garantia-cabecalho">
        <div><strong>Retorno ${indice + 1}</strong><small>${retorno.abertoEm ? fmtDataHora(retorno.abertoEm) : 'Data não informada'}</small></div>
        <span class="status-badge">${_escHtml(retorno.status || 'Em análise')}</span>
      </div>
      <div class="os-retorno-garantia-info"><span>Motivo</span><strong>${_escHtml(retorno.motivo || 'Não informado')}</strong></div>
      ${ultimaEtapa ? `<div class="os-retorno-garantia-info"><span>Último registro</span><strong>${_escHtml(ultimaEtapa.observacao)}</strong></div>` : ''}
      <button type="button" class="botao botao-xs botao-secundario" onclick="$('modalDetalheOS').classList.add('escondido');abrirStatusRetornoGarantiaUI('${_escHtml(garantia.numeroOS)}','${_escHtml(retorno.id)}')">Ver e editar retorno</button>
    </article>`;
  }).join('');
  return `<section class="detalhe-secao os-retorno-garantia">
    <div class="os-retorno-garantia-topo">
      <div><div class="detalhe-titulo">Retorno em garantia</div><p>Esta OS voltou ${total === 1 ? '1 vez' : `${total} vezes`} para garantia.</p></div>
      <span class="os-retorno-garantia-contagem">${total}</span>
    </div>
    <div class="os-retorno-garantia-lista">${itens}</div>
  </section>`;
}

function _htmlFinanceiroCobrancaNaOS(os) {
  const total = _valorServicoOS(os);
  const recebido = Math.min(total || Number.MAX_SAFE_INTEGER, _valorCobradoOS(os));
  const restante = Math.max(0, total - recebido);
  const lembretes = Array.isArray(os?.lembretesCobranca) ? os.lembretesCobranca : [];
  if (!(total > 0) && !lembretes.length) return '';
  const situacao = restante <= 0 && total > 0 ? 'Quitado' : (recebido > 0 ? 'Pagamento parcial' : 'Aguardando pagamento');
  const parcelas = lembretes.length ? `<div class="os-financeiro-parcelas">${lembretes.map(item => {
    const estado = _estadoLembreteCobranca(item);
    const classe = estado === 'Paga' ? 'paga' : (/atrasad/i.test(estado) ? 'atrasada' : (estado === 'Desativada' ? 'desativada' : 'pendente'));
    return `<div class="os-financeiro-parcela" data-estado="${classe}">
      <span><strong>${fmtData(item.data)}</strong>${item.observacao ? `<small>${_escHtml(item.observacao)}</small>` : ''}</span>
      <span><strong>${fmtMoeda(Number(item.valor || 0))}</strong><small>${estado}</small></span>
    </div>`;
  }).join('')}</div>` : '<p class="os-financeiro-sem-parcelas">Nenhuma data de cobrança programada.</p>';
  return `<section class="detalhe-secao os-financeiro-detalhe">
    <div class="os-financeiro-topo"><div><div class="detalhe-titulo">Financeiro e cobranças</div><p>${situacao}</p></div><span>${lembretes.length} parcela(s)</span></div>
    <div class="os-financeiro-resumo">
      <div><span>Total</span><strong>${fmtMoeda(total)}</strong></div>
      <div><span>Recebido</span><strong>${fmtMoeda(recebido)}</strong></div>
      <div><span>Restante</span><strong>${fmtMoeda(restante)}</strong></div>
    </div>
    ${parcelas}
  </section>`;
}

window.verDetalheOS = async numero => {
  const os = await window.api.osobter(numero);
  if (!os) return;
  const garantiaDaOS = await window.api.garantiaobterporos(numero).catch(() => null);
  $('detalheNumero').textContent = os.numero;
  const c = os.cliente || {}; const a = os.aparelho || {};
  const diag = os.diagnosticoTecnico || {};
  $('detalheConteudo').innerHTML = `
    <div class="detalhe-os-corpo">
      <div class="detalhe-secao">
        <div class="detalhe-titulo"> Status</div>
        ${(function() {
          const _st = os.status || '';
          const _sp = _statusPagamentoVisivel(os);
          const _sa = os.statusAprovacao || (os.aceitouTermos === true ? 'Aprovado' : (os.aceitouTermos === false ? 'Desaprovado' : 'Pendente'));
          // v31: campos independentes
          if (_sp) {
            return '<div class="os-status-conjunto"><span class="' + statusClass(_st) + '">Téc: ' + _st + '</span>' +
                   '<span class="' + statusClass(_sa) + '">OS: ' + _sa + '</span>' +
                   '<span class="' + statusClass(_sp) + '">Pag: ' + _sp + '</span></div>';
          }
          return '<div class="os-status-conjunto"><span class="' + statusClass(_st) + '">Téc: ' + (_st||'—') + '</span>' +
                 '<span class="' + statusClass(_sa) + '">OS: ' + _sa + '</span></div>';
        })()}
        ${_valorCobradoOS(os) > 0 ? `<div class="detalhe-status-linha"><strong>Valor cobrado: ${fmtMoeda(_valorCobradoOS(os))}</strong><span>Total do serviço: ${fmtMoeda(_valorServicoOS(os))}</span></div>` : ''}
        <div class="detalhe-status-linha">
          <span class="${prioridadeClass(os.prioridade||'Normal')}">Prioridade: ${os.prioridade||'Normal'}</span>
          ${os.atrasada ? `<span class="badge-atraso">Atrasada</span>` : ''}
        </div>
        ${os.dataPrevista ? `<div style="margin-top:8px;font-size:13px;color:var(--texto-sec);"> Previsão de entrega: <strong>${fmtData(os.dataPrevista+'T00:00')}${os.horaPrevista?' às '+os.horaPrevista:''}</strong></div>` : ''}
        ${(os.historicoStatus||[]).length > 1 ? `
          <div class="hist-status" style="margin-top:10px;">
            ${os.historicoStatus.map(h=>`<div class="hist-item"><div class="dot"></div><span><strong>${h.status}</strong> — ${fmtDataHora(h.data)}</span></div>`).join('')}
          </div>` : ''}
      </div>
      ${_htmlFinanceiroCobrancaNaOS(os)}
      ${_htmlRetornosGarantiaNaOS(garantiaDaOS)}
      <div class="detalhe-secao">
        <div class="detalhe-titulo"> Controle Operacional e Bancada</div>
        <div class="detalhe-grade">
          <div class="detalhe-campo"><span class="rot">Código interno</span><span class="val">${(os.controleInterno&&os.controleInterno.codigoInterno)||'—'}</span></div>
          <div class="detalhe-campo"><span class="rot">Etiqueta interna</span><span class="val">${(os.controleInterno&&os.controleInterno.etiquetaInterna)||'—'}</span></div>
          <div class="detalhe-campo"><span class="rot">TAG de bancada</span><span class="val">${(os.controleInterno&&os.controleInterno.tagBancada)||'—'}</span></div>
          <div class="detalhe-campo"><span class="rot">Número de patrimônio</span><span class="val">${(os.controleInterno&&os.controleInterno.numeroPatrimonio)||'—'}</span></div>
        </div>
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo"> Responsável Técnico</div>
        <div class="detalhe-grade">
          <div class="detalhe-campo"><span class="rot">Técnico responsável</span><span class="val">${_escHtml(os.tecnicoResponsavel||'—')}</span></div>
          <div class="detalhe-campo"><span class="rot">Técnico auxiliar</span><span class="val">${_escHtml(os.tecnicoAuxiliar||'—')}</span></div>
        </div>
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo"> Cliente</div>
        <div class="detalhe-grade">
          <div class="detalhe-campo"><span class="rot">Nome</span><span class="val">${_escHtml(c.nome||'—')}</span></div>
          <div class="detalhe-campo"><span class="rot">ID do cliente</span><span class="val">#${_escHtml(c.clienteId || '00000')}</span></div>
          <div class="detalhe-campo"><span class="rot">CPF</span><span class="val">${_escHtml(c.cpf||'—')}</span></div>
          <div class="detalhe-campo"><span class="rot">Telefone</span><span class="val">${_escHtml(c.telefone||'—')}</span></div>
          <div class="detalhe-campo"><span class="rot">E-mail</span><span class="val">${_escHtml(c.email||'—')}</span></div>
        </div>
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Aparelho</div>
        <div class="detalhe-grade">
          <div class="detalhe-campo"><span class="rot">Marca/Modelo</span><span class="val">${_escHtml([a.marca,a.modelo].filter(Boolean).join(' ')||'—')}</span></div>
          <div class="detalhe-campo"><span class="rot">Cor/Tipo</span><span class="val">${_escHtml([a.cor,a.tipoEquipamento||a.tipo].filter(Boolean).join(' / ')||'—')}</span></div>
          <div class="detalhe-campo"><span class="rot">IMEI</span><span class="val">${_escHtml(os.imei||a.imei||'—')}</span></div>
          <div class="detalhe-campo"><span class="rot">Acessórios</span><span class="val">${_escHtml(a.acessorios||'—')}</span></div>
        </div>
        ${a.dadosEquipamento && Object.values(a.dadosEquipamento).some(Boolean) ? `
        <div class="detalhe-grade" style="margin-top:8px;">
          ${(EQUIPAMENTO_CAMPOS[a.tipoEquipamento||a.tipo]||[]).filter(([id])=>a.dadosEquipamento[id]).map(([id,label])=>
            `<div class="detalhe-campo"><span class="rot">${_escHtml(label)}</span><span class="val">${_escHtml(a.dadosEquipamento[id])}</span></div>`).join('')}
        </div>` : ''}
        ${a.defeitoRelatado?`<div class="detalhe-campo" style="margin-top:8px;"><span class="rot">Defeito</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${_escHtml(a.defeitoRelatado)}</span></div>`:''}
      </div>
      ${(a.checklistDefeitos && a.checklistDefeitos.length) ? `
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Defeitos Identificados no Checklist</div>
        <div style="font-size:13px;line-height:1.6;">${_escHtml(a.checklistDefeitos.join(', '))}</div>
      </div>` : ''}
      ${(a.acessoriosChecklist && a.acessoriosChecklist.length) ? `
      <div class="detalhe-secao">
        <div class="detalhe-titulo"> Acessórios Recebidos</div>
        <div style="font-size:13px;line-height:1.6;">${_escHtml(a.acessoriosChecklist.join(', '))}</div>
      </div>` : ''}
      ${(a.testesEntrada && a.testesEntrada.length) ? `
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Testes de Entrada Aprovados</div>
        <div style="font-size:13px;line-height:1.6;">${_escHtml(a.testesEntrada.join(', '))}</div>
      </div>` : ''}
      ${(diag.diagnostico || diag.solucao || diag.pecas || diag.valorEstimado || diag.prazoEstimado) ? `
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Diagnóstico Técnico</div>
        <div class="detalhe-grade">
          ${diag.diagnostico?`<div class="detalhe-campo" style="grid-column:1/-1;"><span class="rot">Diagnóstico</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${_escHtml(diag.diagnostico)}</span></div>`:''}
          ${diag.solucao?`<div class="detalhe-campo" style="grid-column:1/-1;"><span class="rot">Solução recomendada</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${_escHtml(diag.solucao)}</span></div>`:''}
          ${diag.pecas?`<div class="detalhe-campo" style="grid-column:1/-1;"><span class="rot">Peças necessárias</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${_escHtml(diag.pecas)}</span></div>`:''}
          ${diag.valorEstimado?`<div class="detalhe-campo"><span class="rot">Valor estimado</span><span class="val">${fmtMoeda(diag.valorEstimado)}</span></div>`:''}
          ${diag.prazoEstimado?`<div class="detalhe-campo"><span class="rot">Prazo estimado</span><span class="val">${_escHtml(diag.prazoEstimado)}</span></div>`:''}
        </div>
      </div>` : ''}
      ${(os.checklistEntrada && os.checklistEntrada.length || os.observacoesEntrada) ? `
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Checklist de Entrada</div>
        ${(os.checklistEntrada && os.checklistEntrada.length) ? `<div style="font-size:13px;line-height:1.6;">${_escHtml(os.checklistEntrada.join(', '))}</div>` : ''}
        ${os.observacoesEntrada ? `<div class="detalhe-campo" style="grid-column:1/-1;margin-top:6px;"><span class="rot">Observações de entrada</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${_escHtml(os.observacoesEntrada)}</span></div>` : ''}
      </div>` : ''}
      ${(os.checklistSaida && os.checklistSaida.length || os.observacoesSaida) ? `
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Checklist de Saída</div>
        ${(os.checklistSaida && os.checklistSaida.length) ? `<div style="font-size:13px;line-height:1.6;">${_escHtml(os.checklistSaida.join(', '))}</div>` : ''}
        ${os.observacoesSaida ? `<div class="detalhe-campo" style="grid-column:1/-1;margin-top:6px;"><span class="rot">Observações de saída</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${_escHtml(os.observacoesSaida)}</span></div>` : ''}
      </div>` : ''}
      ${(os.fotos && os.fotos.length) ? `
      <div class="detalhe-secao">
        <div class="detalhe-titulo"> Galeria de Fotos</div>
        ${CATEGORIAS_FOTO_OS.map(cat => {
          const fotos = (os.fotos || []).filter(f => f.categoria === cat.id);
          if (!fotos.length) return '';
          return `<div style="margin-top:6px;">
            <div style="font-size:11.5px;font-weight:700;color:var(--texto-sec);margin-bottom:4px;">${cat.label}</div>
            <div class="galeria-fotos">
              ${fotos.map(f => {
              const fSrc = f.path ? caminhoParaFileUrl(f.path) : (f.base64 || '');
              return `<div class="foto-thumb" data-foto-src="${fSrc.replace(/"/g,'&quot;')}" onclick="abrirLightboxFoto(this.dataset.fotoSrc)"><img src="${fSrc}" alt="Foto" onerror="this.src=''" /></div>`;
            }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}
      ${(['Pronto para retirada', 'Entregue'].includes(os.status)) ? `
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Comprovante térmico assinado</div>
        <p style="font-size:12px;color:var(--texto-sec);margin:0 0 8px;">Anexe uma foto ou PDF. O arquivo ficará nesta mesma OS e será sincronizado com o celular.</p>
        <button type="button" class="botao botao-secundario" onclick="anexarComprovanteTermicoPC('${_escHtml(os.numero)}')">Anexar foto ou PDF assinado</button>
      </div>` : ''}
      ${(Array.isArray(os.comprovantesTermicosAssinados) && os.comprovantesTermicosAssinados.length) ? `
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Comprovantes térmicos assinados</div>
        <div class="galeria-fotos">
          ${os.comprovantesTermicosAssinados.map(anexo => {
            const caminho = anexo.path || '';
            const ehPdf = anexo.mimeType === 'application/pdf' || /\.pdf$/i.test(caminho);
            if (ehPdf) return `<button type="button" class="botao botao-fantasma" onclick="window.api.osabrirpdf(decodeURIComponent('${encodeURIComponent(caminho)}'))">Abrir PDF assinado</button>`;
            const src = caminho ? caminhoParaFileUrl(caminho) : '';
            return `<div class="foto-thumb" data-foto-src="${src.replace(/"/g,'&quot;')}" onclick="abrirLightboxFoto(this.dataset.fotoSrc)"><img src="${src}" alt="Comprovante térmico assinado" onerror="this.src=''" /></div>`;
          }).join('')}
        </div>
      </div>` : ''}
      <div class="detalhe-secao">
        <div class="detalhe-titulo"> Data</div>
        <span style="font-size:13.5px;">${fmtDataHora(os.data)}</span>
      </div>
      ${(os.aceitouTermos !== undefined || os.respostaPreferenciaPagamento) ? `
      <div class="detalhe-secao" style="border-left:3px solid ${os.aceitouTermos === true ? 'var(--sucesso,#16a34a)' : os.aceitouTermos === false ? 'var(--perigo,#dc2626)' : 'var(--borda)'};padding-left:12px;">
        <div class="detalhe-titulo">${ICONE_BALAO} Resposta do Cliente</div>
        <div class="detalhe-grade">
          <div class="detalhe-campo">
            <span class="rot">Aceitou os termos</span>
            <span class="val">
              ${os.aceitouTermos === true
                ? `<span style="color:var(--sucesso,#16a34a);font-weight:700;">${ICONE_CHECK} Sim</span>`
                : os.aceitouTermos === false
                ? `<span style="color:var(--perigo,#dc2626);font-weight:700;">${ICONE_X} Não</span>`
                : '<span style="color:var(--texto-sec);">—</span>'}
            </span>
          </div>
          ${os.dataRespostaTermos ? `<div class="detalhe-campo"><span class="rot">Data da resposta</span><span class="val">${fmtDataHora(os.dataRespostaTermos)}</span></div>` : ''}
          ${(os.aceitouTermos === false && os.motivoRecusaTermos) ? `<div class="detalhe-campo" style="grid-column:1/-1;"><span class="rot">Motivo da recusa</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${os.motivoRecusaTermos}</span></div>` : ''}
          ${os.respostaPreferenciaPagamento ? `<div class="detalhe-campo" style="grid-column:1/-1;"><span class="rot">Preferência de pagamento (resposta do cliente)</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${os.respostaPreferenciaPagamento}</span></div>` : ''}
        </div>
        <button class="botao botao-fantasma" style="margin-top:10px;font-size:12px;padding:4px 10px;" onclick="abrirModalRegistrarTermos('${os.numero}')">${ICONE_LAPIS} Editar resposta</button>
      </div>` : `
      <div class="detalhe-secao">
        <div class="detalhe-titulo">${ICONE_BALAO} Resposta do Cliente</div>
        <p style="font-size:13px;color:var(--texto-sec);margin:0 0 8px;">Nenhuma resposta registrada ainda.</p>
        <button class="botao botao-fantasma" style="font-size:12px;padding:4px 10px;" onclick="abrirModalRegistrarTermos('${os.numero}')">${ICONE_LAPIS} Registrar resposta</button>
      </div>`}
      <div id="detalheComprovanteSecao" style="margin:0;">
        <!-- comprovante de pagamento carregado assincronamente -->
      </div>
      <div id="detalheEntregaSecao" style="margin:0;">
        <!-- App Celular — comprovante de retirada + garantia (aba Entregas),
             carregado assincronamente. Ver _carregarEntregaNoDetalhe. -->
      </div>
    </div>`;
  _renderizarAcoesDetalheOS(os);
  $('modalDetalheOS').classList.remove('escondido');
  // Carrega o comprovante de pagamento de forma assíncrona (evita bloquear a abertura do modal)
  _carregarComprovanteNoDetalhe(os.numero);
  // App Celular — Entregas: mesma lógica assíncrona, indicador independente.
  _carregarEntregaNoDetalhe(os.numero);
};

// ─── mostrarDetalheOS — alias público usado por verDetalheOSrapido (aba Autorizadas) ──────────
// Recebe o objeto OS já carregado e exibe o modal com opções de Excluir e Cancelar OS.
window.mostrarDetalheOS = function(os) {
  if (!os) return;
  $('detalheNumero').textContent = os.numero;
  const c = os.cliente || {}; const a = os.aparelho || {};
  const diag = os.diagnosticoTecnico || {};
  $('detalheConteudo').innerHTML = `
    <div class="detalhe-os-corpo">
      <div class="detalhe-secao">
        <div class="detalhe-titulo"> Status</div>
        ${(function() {
          const _st = os.status || '';
          const _sp = _statusPagamentoVisivel(os);
          const _sa = os.statusAprovacao || (os.aceitouTermos === true ? 'Aprovado' : (os.aceitouTermos === false ? 'Desaprovado' : 'Pendente'));
          if (_sp) {
            return '<div class="os-status-conjunto"><span class="' + statusClass(_st) + '">Téc: ' + _st + '</span>' +
                   '<span class="' + statusClass(_sa) + '">OS: ' + _sa + '</span>' +
                   '<span class="' + statusClass(_sp) + '">Pag: ' + _sp + '</span></div>';
          }
          return '<div class="os-status-conjunto"><span class="' + statusClass(_st) + '">Téc: ' + (_st||'—') + '</span>' +
                 '<span class="' + statusClass(_sa) + '">OS: ' + _sa + '</span></div>';
        })()}
        ${_valorCobradoOS(os) > 0 ? `<div class="detalhe-status-linha"><strong>Valor cobrado: ${fmtMoeda(_valorCobradoOS(os))}</strong><span>Total do serviço: ${fmtMoeda(_valorServicoOS(os))}</span></div>` : ''}
        <div class="detalhe-status-linha">
          <span class="${prioridadeClass(os.prioridade||'Normal')}">Prioridade: ${os.prioridade||'Normal'}</span>
          ${os.atrasada ? `<span class="badge-atraso">Atrasada</span>` : ''}
        </div>
        ${os.dataPrevista ? `<div style="margin-top:8px;font-size:13px;color:var(--texto-sec);"> Previsão de entrega: <strong>${fmtData(os.dataPrevista+'T00:00')}${os.horaPrevista?' às '+os.horaPrevista:''}</strong></div>` : ''}
      </div>
      ${_htmlFinanceiroCobrancaNaOS(os)}
      <div class="detalhe-secao">
        <div class="detalhe-titulo"> Cliente</div>
        <div class="detalhe-grade">
          <div class="detalhe-campo"><span class="rot">Nome</span><span class="val">${c.nome||'—'}</span></div>
          <div class="detalhe-campo"><span class="rot">ID do cliente</span><span class="val">#${c.clienteId || '00000'}</span></div>
          <div class="detalhe-campo"><span class="rot">CPF</span><span class="val">${c.cpf||'—'}</span></div>
          <div class="detalhe-campo"><span class="rot">Telefone</span><span class="val">${c.telefone||'—'}</span></div>
          <div class="detalhe-campo"><span class="rot">E-mail</span><span class="val">${c.email||'—'}</span></div>
        </div>
      </div>
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Aparelho</div>
        <div class="detalhe-grade">
          <div class="detalhe-campo"><span class="rot">Marca/Modelo</span><span class="val">${[a.marca,a.modelo].filter(Boolean).join(' ')||'—'}</span></div>
          <div class="detalhe-campo"><span class="rot">Cor/Tipo</span><span class="val">${[a.cor,a.tipoEquipamento||a.tipo].filter(Boolean).join(' / ')||'—'}</span></div>
          <div class="detalhe-campo"><span class="rot">IMEI</span><span class="val">${os.imei||a.imei||'—'}</span></div>
          <div class="detalhe-campo"><span class="rot">Acessórios</span><span class="val">${a.acessorios||'—'}</span></div>
        </div>
        ${a.defeitoRelatado?`<div class="detalhe-campo" style="margin-top:8px;"><span class="rot">Defeito</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${a.defeitoRelatado}</span></div>`:''}
      </div>
      ${(diag.diagnostico || diag.solucao || diag.valorEstimado) ? `
      <div class="detalhe-secao">
        <div class="detalhe-titulo">Diagnóstico Técnico</div>
        <div class="detalhe-grade">
          ${diag.diagnostico?`<div class="detalhe-campo" style="grid-column:1/-1;"><span class="rot">Diagnóstico</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${diag.diagnostico}</span></div>`:''}
          ${diag.solucao?`<div class="detalhe-campo" style="grid-column:1/-1;"><span class="rot">Solução</span><span class="val" style="font-weight:400;white-space:pre-wrap;">${diag.solucao}</span></div>`:''}
          ${diag.valorEstimado?`<div class="detalhe-campo"><span class="rot">Valor estimado</span><span class="val">${fmtMoeda(diag.valorEstimado)}</span></div>`:''}
        </div>
      </div>` : ''}
    </div>`;

  _renderizarAcoesDetalheOS(os, { incluirAcoesDestrutivas: true });
  $('modalDetalheOS').classList.remove('escondido');
  _carregarComprovanteNoDetalhe(os.numero);
  // App Celular — Entregas: a div #detalheEntregaSecao não existe neste HTML
  // (mostrarDetalheOS/aba Autorizadas usa um layout mais enxuto), então a
  // função simplesmente não faz nada aqui — mesmo comportamento já usado
  // por _carregarComprovanteNoDetalhe na linha acima.
  _carregarEntregaNoDetalhe(os.numero);
};

// ─── Cancelar OS a partir da tela de Autorizadas ─────────────────────────────
window.cancelarOSdaAutorizada = async function(numero) {
  // Usa confirm nativo para simplificar — promptModal com campo vazio funciona como diálogo
  const resp = await promptModal(
    `Confirmar cancelamento da OS ${numero}?

Digite "CANCELAR" para confirmar:`,
    '',
    { titulo: `${ICONE_X} Cancelar OS` }
  );
  if (resp === null) return; // usuário fechou/cancelou
  if ((resp || '').trim().toUpperCase() !== 'CANCELAR') {
    toast('Cancelamento não confirmado. Digite "CANCELAR" para prosseguir.', 'aviso');
    return;
  }
  try {
    const os = await window.api.osobter(numero);
    if (!os) { toast('OS não encontrada.', 'erro'); return; }
    const resultado = await window.api.osatualizar(numero, { status: 'Cancelado' }, null);
    if (!resultado || resultado.status !== 'Cancelado') {
      throw new Error(resultado?.erro || 'O sistema não confirmou a gravação do cancelamento.');
    }
    const confirmado = await window.api.osobter(numero);
    if (!confirmado || confirmado.status !== 'Cancelado') {
      throw new Error('A OS não permaneceu cancelada no banco. Tente sincronizar e repita.');
    }
    toast(`OS ${numero} cancelada com sucesso.`, 'sucesso');
    if (typeof window.carregarAutorizadas === 'function') window.carregarAutorizadas();
    if (typeof carregarHistorico === 'function') carregarHistorico();
  } catch(e) {
    toast('Erro ao cancelar OS: ' + e.message, 'erro');
  }
};

// ─── Comprovante de pagamento inline no detalhe da OS ────────────────────────

async function _carregarComprovanteNoDetalhe(osNumero) {
  const secao = document.getElementById('detalheComprovanteSecao');
  if (!secao) return;

  // Esqueleto de carregamento
  secao.innerHTML = `
    <div class="detalhe-secao" style="opacity:.6;">
      <div class="detalhe-titulo">${ICONE_DOCUMENTO} Comprovante de Pagamento</div>
      <span style="font-size:12px;color:var(--texto-sec);">Carregando…</span>
    </div>`;

  try {
    const r = await window.api.pagobtercomprovantedaos(osNumero);

    if (!r.sucesso) {
      // Sem pagamento registrado — não exibe a seção
      secao.innerHTML = '';
      return;
    }

    const pag = r.pagamento;
    const fmtMoedaLocal = v => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
    const percentualQuitado = Number(pag.percentualQuitado) || 100;
    const quitado = percentualQuitado >= 100;
    const rotuloComprovante = quitado ? 'Quitação integral' : `Entrada de ${percentualQuitado}%`;
    const metaHtml = `
      <div class="detalhe-grade" style="margin-bottom:10px;">
        <div class="detalhe-campo"><span class="rot">Comprovante</span><span class="val" style="color:#15803d;font-weight:700;">${rotuloComprovante}</span></div>
        <div class="detalhe-campo"><span class="rot">${quitado ? 'Total quitado' : 'Valor desta entrada'}</span><span class="val" style="color:#15803d;font-weight:700;">${fmtMoedaLocal(quitado ? pag.valorAcumulado : pag.valor)}</span></div>
        <div class="detalhe-campo"><span class="rot">Valor total do serviço</span><span class="val">${fmtMoedaLocal(pag.valorTotalServico)}</span></div>
        ${!quitado ? `<div class="detalhe-campo"><span class="rot">Saldo restante</span><span class="val">${fmtMoedaLocal(pag.valorRestanteAposPagamento)}</span></div>` : ''}
        ${quitado && Number(pag.valor) !== Number(pag.valorAcumulado) ? `<div class="detalhe-campo"><span class="rot">Última parcela</span><span class="val">${fmtMoedaLocal(pag.valor)}</span></div>` : ''}
        <div class="detalhe-campo"><span class="rot">Método</span><span class="val">${pag.metodo || '—'}</span></div>
        <div class="detalhe-campo"><span class="rot">Data do pagamento</span><span class="val">${fmtDataHora(pag.dataPagamento)}</span></div>
        <div class="detalhe-campo"><span class="rot">ID do pagamento</span><span class="val" style="font-size:11px;word-break:break-all;">${pag.id}</span></div>
      </div>`;

    // ── Sem comprovante físico ──────────────────────────────────────────────
    if (!pag.caminhoComprovante) {
      secao.innerHTML = `
        <div class="detalhe-secao" style="border-left:3px solid var(--primario);padding-left:12px;">
          <div class="detalhe-titulo">${ICONE_DOCUMENTO} Comprovante de Pagamento</div>
          ${metaHtml}
          <p style="font-size:12px;color:var(--texto-sec);margin:0;">Nenhum arquivo de comprovante anexado.</p>
          <button class="botao botao-fantasma" style="margin-top:8px;font-size:12px;padding:4px 10px;"
            onclick="anexarComprovanteExt('${pag.id}').then(()=>_carregarComprovanteNoDetalhe('${osNumero}'))">
            ${ICONE_PASTA} Anexar comprovante
          </button>
        </div>`;
      return;
    }

    // ── Arquivo não encontrado em disco ────────────────────────────────────
    if (r.avisoArquivo) {
      secao.innerHTML = `
        <div class="detalhe-secao" style="border-left:3px solid var(--aviso,#d97706);padding-left:12px;">
          <div class="detalhe-titulo">${ICONE_DOCUMENTO} Comprovante de Pagamento</div>
          ${metaHtml}
          <p style="font-size:12px;color:var(--aviso,#d97706);margin:0;">${ICONE_ALERTA} ${r.avisoArquivo}</p>
          <button class="botao botao-fantasma" style="margin-top:8px;font-size:12px;padding:4px 10px;"
            onclick="anexarComprovanteExt('${pag.id}').then(()=>_carregarComprovanteNoDetalhe('${osNumero}'))">
            ${ICONE_PASTA} Substituir arquivo
          </button>
        </div>`;
      return;
    }

    // ── Comprovante disponível ─────────────────────────────────────────────
    const dataUrl = `data:${r.mimeType};base64,${r.base64}`;
    const isPdf   = r.mimeType === 'application/pdf';
    const camEsc  = (pag.caminhoComprovante || '').replace(/\\/g, '/').replace(/'/g, "\\'");

    // Bug fix: armazena o dataUrl no window para evitar embutir base64 enorme
    // diretamente em atributos onclick (causava lentidão / freeze em imagens grandes)
    window._comprovanteDataUrlAtual = dataUrl;

    const visualizadorHtml = isPdf
      ? `<div style="margin-top:10px;">
           <p style="font-size:12px;color:var(--texto-sec);margin:0 0 8px;">${ICONE_DOCUMENTO} Arquivo PDF — clique para abrir no visualizador:</p>
           <button class="botao botao-sucesso" style="font-size:12px;padding:6px 14px;"
             onclick="abrirComprovanteExt('${camEsc}')">
             ${ICONE_BUSCAR} Abrir comprovante PDF
           </button>
         </div>`
      : `<div style="margin-top:10px;text-align:center;">
           <img
             src="${dataUrl}"
             alt="Comprovante de pagamento"
             style="max-width:100%;max-height:360px;object-fit:contain;border:1px solid var(--borda);border-radius:6px;cursor:zoom-in;"
             onclick="abrirLightboxFoto(window._comprovanteDataUrlAtual)"
             title="Clique para ampliar"
           />
           <div style="font-size:11px;color:var(--texto-sec);margin-top:4px;">Clique na imagem para ampliar</div>
         </div>`;

    secao.innerHTML = `
      <div class="detalhe-secao" style="border-left:3px solid #15803d;padding-left:12px;">
        <div class="detalhe-titulo">${ICONE_DOCUMENTO} Comprovante de Pagamento <span style="font-size:11px;font-weight:400;color:#15803d;margin-left:6px;">${ICONE_CHECK} ${quitado ? '100% quitado' : `${percentualQuitado}% pago`}</span></div>
        ${metaHtml}
        ${visualizadorHtml}
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <button class="botao botao-fantasma" style="font-size:12px;padding:4px 10px;"
            onclick="abrirComprovanteExt('${camEsc}')">
            ${ICONE_EXPORTAR} Abrir externamente
          </button>
          <button class="botao botao-fantasma" style="font-size:12px;padding:4px 10px;"
            onclick="gerarComprovantePDF('${pag.id}')">
            ${ICONE_IMPRESSORA} Gerar PDF
          </button>
          <button class="botao botao-fantasma" style="font-size:12px;padding:4px 10px;"
            onclick="anexarComprovanteExt('${pag.id}').then(()=>_carregarComprovanteNoDetalhe('${osNumero}'))">
            ${ICONE_SYNC} Substituir arquivo
          </button>
        </div>
      </div>`;

  } catch (err) {
    secao.innerHTML = `
      <div class="detalhe-secao">
        <div class="detalhe-titulo">${ICONE_DOCUMENTO} Comprovante de Pagamento</div>
        <p style="font-size:12px;color:var(--perigo,#dc2626);margin:0;">Erro ao carregar comprovante: ${err.message}</p>
      </div>`;
  }
}

// ─── Parte 2.1 — Modal: Registrar Resposta de Termos do Cliente ──────────────

window.abrirModalRegistrarTermos = async (numero) => {
  const os = await window.api.osobter(numero);
  if (!os) return;
  $('termosOsNumero').value = numero;
  // Pré-preencher com valores já salvos
  const radSim = $('termosAceitouSim');
  const radNao = $('termosAceitouNao');
  if (radSim) radSim.checked = os.aceitouTermos === true;
  if (radNao) radNao.checked = os.aceitouTermos === false;
  // Exibir/ocultar campo de motivo
  const campoMotivo = $('campoMotivoRecusa');
  if (campoMotivo) campoMotivo.style.display = os.aceitouTermos === false ? '' : 'none';
  if ($('termosMotivo')) $('termosMotivo').value = os.motivoRecusaTermos || '';
  if ($('termosRespostaPagamento')) $('termosRespostaPagamento').value = os.respostaPreferenciaPagamento || '';
  $('modalRegistrarTermos').classList.remove('escondido');
};

// Toggle campo de motivo ao mudar o radio
['termosAceitouSim', 'termosAceitouNao'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    const campoMotivo = $('campoMotivoRecusa');
    if (campoMotivo) campoMotivo.style.display = $('termosAceitouNao').checked ? '' : 'none';
  });
});

$('btnSalvarTermosResposta').addEventListener('click', async () => {
  const numero = $('termosOsNumero').value;
  if (!numero) return;
  const radSim = $('termosAceitouSim');
  const radNao = $('termosAceitouNao');
  if (!radSim.checked && !radNao.checked) {
    toast('Selecione se o cliente aceitou ou recusou os termos.', 'erro');
    return;
  }
  const aceitou = radSim.checked;

  // Bug fix: ao trocar de "Não" para "Sim", pergunta antes de apagar o motivo de recusa salvo
  if (aceitou) {
    const osAtual = await window.api.osobter(numero).catch(() => null);
    if (osAtual && osAtual.aceitouTermos === false && osAtual.motivoRecusaTermos) {
      const confirmar = confirm(
        `Atenção: existe um motivo de recusa registrado para esta OS:\n\n"${osAtual.motivoRecusaTermos}"\n\nAo salvar como "Sim", esse motivo será apagado. Deseja continuar?`
      );
      if (!confirmar) return;
    }
  }

  const motivoRecusa = (!aceitou && $('termosMotivo')) ? $('termosMotivo').value.trim() : '';
  const respostaPagamento = $('termosRespostaPagamento') ? $('termosRespostaPagamento').value.trim() : '';

  const r = await window.api.osregistrartermosresposta(numero, {
    aceitouTermos: aceitou,
    motivoRecusaTermos: motivoRecusa,
    respostaPreferenciaPagamento: respostaPagamento,
  });

  if (r?.sucesso) {
    toast(`Resposta do cliente registrada na OS ${numero}.`, 'sucesso');
    $('modalRegistrarTermos').classList.add('escondido');
    // Reabrir o detalhe da OS para refletir os dados novos
    verDetalheOS(numero);
    carregarHistorico();
  } else {
    toast('Erro ao salvar: ' + (r?.erro || 'desconhecido'), 'erro');
  }
});

window.regenarPdf = async numero => {
  try { await window.api.osgerarPdf(numero); toast('PDF gerado!','sucesso'); carregarHistorico(); } 
  catch(e){ toast('Erro: '+e.message,'erro'); }
};

async function solicitarNomeRecebedorComprovante(numero, osAtual) {
  const entrega = await window.api.entregaobterporos(numero).catch(() => null);
  const nomePadrao = entrega?.nomeRetirou || entrega?.recebidoPor ||
    osAtual?.nomeRetirou || osAtual?.recebidoPor || osAtual?.cliente?.nome || '';
  const nome = await promptModal(
    'Informe o nome de quem recebeu ou retirou o aparelho:',
    nomePadrao,
    { titulo: 'Quem recebeu o aparelho' }
  );
  if (nome === null) return null;
  const nomeLimpo = String(nome || '').trim();
  if (!nomeLimpo) {
    toast('Informe o nome de quem recebeu o aparelho.', 'aviso');
    return null;
  }
  await window.api.entregaatualizarrecebedor(numero, nomeLimpo, usuarioAtual?.id);
  return { nomeRetirou: nomeLimpo, recebidoPor: nomeLimpo };
}

window.anexarComprovanteTermicoPC = function(numero) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,application/pdf';
  input.addEventListener('change', async () => {
    const arquivo = input.files?.[0];
    if (!arquivo) return;
    if (arquivo.size > 12 * 1024 * 1024) {
      toast('O comprovante deve ter no máximo 12 MB.', 'aviso');
      return;
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(leitor.result);
        leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
        leitor.readAsDataURL(arquivo);
      });
      const resultado = await window.api.ossalvarcomprovantetermico(numero, dataUrl, arquivo.name, arquivo.type);
      toast(resultado?.anexo?.duplicada
        ? 'Este comprovante já estava anexado à OS.'
        : 'Comprovante anexado e enviado para sincronização.', 'sucesso');
      await verDetalheOS(numero);
    } catch (erro) {
      toast('Não foi possível anexar o comprovante: ' + (erro?.message || erro), 'erro');
    }
  });
  input.click();
};

window.emitirComprovanteOS = async function(numero) {
  const osDoComprovante = await window.api.osobter(numero).catch(() => null);
  const comprovanteDeRetirada = ['Pronto para retirada', 'Entregue'].includes(osDoComprovante?.status);
  const dadosEntrega = comprovanteDeRetirada
    ? await solicitarNomeRecebedorComprovante(numero, osDoComprovante)
    : undefined;
  if (comprovanteDeRetirada && !dadosEntrega) return;
  const escolha = await escolherOpcaoModal({
    titulo: `Emitir comprovante da OS ${numero}`,
    alternativas: [
      { valor: '1', titulo: 'Visualizar térmico 80 mm', descricao: 'Abre a prévia para conferir antes de imprimir.' },
      { valor: '2', titulo: 'Imprimir térmico 80 mm', descricao: comprovanteDeRetirada ? 'Envia duas vias para a impressora.' : 'Envia uma via para a impressora.' },
      { valor: '3', titulo: 'Imprimir térmico 58 mm', descricao: comprovanteDeRetirada ? 'Envia duas vias na bobina compacta.' : 'Envia uma via na bobina compacta.' },
      { valor: '4', titulo: 'Visualizar PDF A4', descricao: 'Abre a versão completa em página A4.' }
    ]
  });
  if (escolha === null) return;
  const opcao = String(escolha || '').trim();
  try {
    if (opcao === '1') {
      await window.api.osabrircomprovante(numero, '80mm', dadosEntrega);
      return;
    }
    if (opcao === '2') {
      await window.api.osimprimircomprovante(numero, '80mm', undefined, comprovanteDeRetirada ? 2 : 1, dadosEntrega);
      toast(comprovanteDeRetirada ? 'Duas vias enviadas para a impressão.' : 'Comprovante enviado para a impressão.', 'sucesso');
      return;
    }
    if (opcao === '3') {
      await window.api.osimprimircomprovante(numero, '58mm', undefined, comprovanteDeRetirada ? 2 : 1, dadosEntrega);
      toast(comprovanteDeRetirada ? 'Duas vias enviadas para a impressão.' : 'Comprovante enviado para a impressão.', 'sucesso');
      return;
    }
    if (opcao === '4') {
      await window.api.osabrircomprovante(numero, 'a4', dadosEntrega);
      return;
    }
    toast('Opção inválida. Digite 1, 2, 3 ou 4.', 'aviso');
  } catch (erro) {
    toast('Não foi possível emitir o comprovante: ' + (erro?.message || erro), 'erro');
  }
};

window.abrirFluxoComprovanteEntrega = async function(numeroOS) {
  const abaEntregas = document.querySelector('[data-aba="entregas"]');
  if (abaEntregas) abaEntregas.click();
  window.trocarTabEntregas?.('nova');
  await window.buscarOSParaNovaEntrega?.(numeroOS);
  $('novaEntregaNomeRetirou')?.focus();
  $('subaba-entregas-nova')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.excluirOS = async numero => {
  if (!(await autorizarExclusaoProtegida(`a OS ${numero}`))) return;
  const responsavel = (await promptModal(`Informe seu nome (responsável pela exclusão da OS ${numero}):`, '', { titulo: ' Responsável pela exclusão' })) || 'não identificado';
  try {
    const r = await window.api.osexcluir(numero, responsavel);
    if (r.cancelado) return;
    if (r.sucesso) {
      toast(`OS ${numero} excluída com sucesso.`, 'sucesso');
      // Fechar modal de detalhe se estiver aberto
      $('modalDetalheOS').classList.add('escondido');
      // Atualizar lista de OS
      carregarHistorico();
      if (typeof window.carregarAutorizadas === 'function') window.carregarAutorizadas();
    } else {
      toast('Erro ao excluir: ' + (r.erro || 'Erro desconhecido'), 'erro');
    }
  } catch(e) { toast('Erro ao excluir OS: ' + e.message, 'erro'); }
};

// ─── EDITAR OS ───────────────────────────────────────────────
let osEmEdicao = null;
// ETAPA 8.6.1 — estado dos checklists técnicos (Editar OS)
let editChecklistDefeitos = [];
let editChecklistAcessorios = [];
let editChecklistTestes = [];
let editChecklistEntrada = [];
let editChecklistSaida = [];
let editFotosOS = [];
let editLembretesCobranca = [];
let editLembretesCobrancaExcluidos = [];

function _estadoLembreteCobranca(item) {
  const salvo = String(item?.status || '').toLowerCase();
  if ((item.confirmadoEm || item.pagoEm) && salvo !== 'desativada') return 'Paga';
  if (salvo === 'paga') return 'Paga';
  if (salvo === 'desativada') return 'Desativada';
  if (salvo === 'atrasada') return 'Atrasada';
  const fimDoDia = new Date(`${item.data}T23:59:59`);
  if (Number.isFinite(fimDoDia.getTime()) && fimDoDia.getTime() < Date.now()) return 'Atrasado';
  return 'Agendado';
}

function renderizarLembretesCobrancaEdicao() {
  const lista = $('editListaLembretesCobranca');
  if (!lista) return;
  lista.innerHTML = editLembretesCobranca.length ? editLembretesCobranca.map((item, indice) => {
    const estado = _estadoLembreteCobranca(item);
    const valor = Number(item.valor || 0);
    return `<div class="lembrete-cobranca-item" data-estado="${estado.toLowerCase()}">
      <div><strong>${fmtData(item.data)}</strong><span>${valor > 0 ? fmtMoeda(valor) : 'Usar saldo da OS'} · ${estado}</span></div>
      <div class="lembrete-cobranca-acoes">
        <label class="sr-only" for="editStatusCobranca-${indice}">Situação da cobrança de ${fmtData(item.data)}</label>
        <select id="editStatusCobranca-${indice}" class="lembrete-cobranca-status" onchange="alterarStatusLembreteCobrancaEdicao(${indice}, this.value)">
          <option value="pendente" ${estado === 'Agendado' ? 'selected' : ''}>Pendente</option>
          <option value="atrasada" ${estado === 'Atrasada' || estado === 'Atrasado' ? 'selected' : ''}>Atrasada</option>
          <option value="paga" ${estado === 'Paga' ? 'selected' : ''}>Paga</option>
          <option value="desativada" ${estado === 'Desativada' ? 'selected' : ''}>Desativada</option>
        </select>
        <button type="button" class="botao botao-fantasma botao-xs" onclick="removerLembreteCobrancaEdicao(${indice})">Excluir</button>
      </div>
    </div>`;
  }).join('') : '<p class="campo-desc">Nenhum lembrete programado.</p>';
}

window.alterarStatusLembreteCobrancaEdicao = function(indice, status) {
  const posicao = Number(indice);
  const permitido = ['pendente', 'atrasada', 'paga', 'desativada'];
  if (!Number.isInteger(posicao) || !editLembretesCobranca[posicao] || !permitido.includes(status)) return;
  const agora = new Date().toISOString();
  const atual = { ...editLembretesCobranca[posicao], status, atualizadoEm: agora };
  if (status === 'paga') {
    atual.confirmadoEm = atual.confirmadoEm || agora;
    atual.pagoEm = atual.pagoEm || atual.confirmadoEm;
    atual.valorRecebido = Number(atual.valor || 0);
    atual.impactaRecebimento = atual.impactaRecebimento !== false;
    delete atual.desativadoEm;
  } else {
    delete atual.confirmadoEm;
    delete atual.pagoEm;
    delete atual.valorRecebido;
    delete atual.impactaRecebimento;
    if (status === 'desativada') atual.desativadoEm = agora;
    else delete atual.desativadoEm;
  }
  if (status === 'atrasada') atual.atrasadoEm = agora;
  else delete atual.atrasadoEm;
  editLembretesCobranca[posicao] = atual;
  renderizarLembretesCobrancaEdicao();
};

window.removerLembreteCobrancaEdicao = function(indice) {
  const [removido] = editLembretesCobranca.splice(Number(indice), 1);
  if (removido?.id) {
    editLembretesCobrancaExcluidos = editLembretesCobrancaExcluidos
      .filter(item => item.id !== removido.id)
      .concat({ id: removido.id, excluidoEm: new Date().toISOString() });
  }
  renderizarLembretesCobrancaEdicao();
};

$('btnAdicionarLembreteCobranca')?.addEventListener('click', () => {
  const data = $('editLembreteCobrancaData')?.value || '';
  const valor = Number($('editLembreteCobrancaValor')?.value || 0);
  if (!data) {
    toast('Escolha a data do lembrete de cobrança.', 'erro');
    $('editLembreteCobrancaData')?.focus();
    return;
  }
  editLembretesCobranca.push({
    id: `cob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    data,
    valor: valor > 0 ? valor : 0,
    criadoEm: new Date().toISOString(),
    status: 'pendente',
    avisarAntesDias: 0,
    confirmadoEm: '',
    valorRecebido: 0
  });
  editLembretesCobranca.sort((a, b) => String(a.data).localeCompare(String(b.data)));
  if ($('editLembreteCobrancaData')) $('editLembreteCobrancaData').value = '';
  if ($('editLembreteCobrancaValor')) $('editLembreteCobrancaValor').value = '';
  renderizarLembretesCobrancaEdicao();
});

// Mostra no modal de Editar OS quais documentos (Garantia/Entrega) já
// estão atrelados a esta OS. Direto e sem enrolação: busca as duas
// (garantia:obterPorOS e entrega:obterPorOS, ambas já existentes),
// mostra badge "atrelada" com a data, ou "—" se não houver nenhuma.
function _fmtDataDocAtrelado(iso) {
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso || ''; }
}
async function _carregarDocsAtrelados(numeroOS) {
  const el = $('docsAtreladosConteudo');
  if (!el) return;
  el.textContent = 'Carregando...';
  try {
    const [garantia, entrega] = await Promise.all([
      window.api.garantiaobterporos(numeroOS).catch(() => null),
      window.api.entregaobterporos(numeroOS).catch(() => null),
    ]);
    const linhas = [];
    linhas.push(garantia
      ? `<div style="margin-bottom:6px;">${ICONE_ESCUDO} <strong style="color:var(--sucesso,#15803d);">Garantia atrelada</strong> — emitida em ${_fmtDataDocAtrelado(garantia.criadoEm)}${garantia.dataLimite ? `, válida até ${_fmtDataDocAtrelado(garantia.dataLimite)}` : ''}</div>`
      : `<div style="margin-bottom:6px;color:var(--texto-sec);">${ICONE_ESCUDO} Sem garantia atrelada</div>`);
    linhas.push(entrega
      ? `<div>${ICONE_CANETA} <strong style="color:var(--sucesso,#15803d);">Entrega atrelada</strong> — assinada em ${_fmtDataDocAtrelado(entrega.dataHoraAssinatura)}</div>`
      : `<div style="color:var(--texto-sec);">${ICONE_CANETA} Sem entrega atrelada</div>`);
    el.innerHTML = linhas.join('');
  } catch (e) {
    el.textContent = 'Não foi possível carregar.';
  }
}

window.abrirEditarOS = async numero => {
  const os = await window.api.osobter(numero);
  if (!os) return;
  osEmEdicao = os;
  $('modalEditarNumero').textContent = os.numero;
  _carregarDocsAtrelados(os.numero);
  const c = os.cliente||{}; const a = os.aparelho||{};
  $('editNome').value = c.nome||'';
  $('editCpf').value = c.cpf||'';
  $('editTelefone').value = c.telefone||'';
  $('editEmail').value = c.email||'';
  // Restaurar checkbox "sem número" no modal editar
  const editSemNum = !c.telefone;
  const editChk = $('editSemNumero');
  if (editChk) editChk.checked = editSemNum;
  const editTelEl = $('editTelefone');
  if (editTelEl) { editTelEl.disabled = editSemNum; editTelEl.style.opacity = editSemNum ? '0.4' : ''; editTelEl.placeholder = editSemNum ? 'Sem número' : '(00) 00000-0000'; }
  const editAst = $('editTelefoneAsteristico');
  if (editAst) editAst.style.display = editSemNum ? 'none' : '';
  $('editMarca').value = a.marca||'';
  $('editModelo').value = a.modelo||'';
  $('editCor').value = a.cor||'';
  const tipoEq = a.tipoEquipamento || a.tipo || 'Smartphone';
  $('editTipoEquipamento').value = tipoEq;
  renderCamposDinamicos(tipoEq, 'camposDinamicosEditAparelho', 'ed', a.dadosEquipamento || {});
  toggleCampoImei('campoEditImei', tipoEq);
  $('editImei').value = os.imei||a.imei||'';
  $('editSenha').value = a.senhaAparelho||'';
  $('editAcessorios').value = a.acessorios||'';
  $('editDefeito').value = a.defeitoRelatado||'';
  $('editObs').value = a.observacoes||'';
  // v31: status técnico (os.status) e pagamento (os.statusPagamento) são campos independentes
  $('editStatusOS').value = os.status || 'Aguardando análise';
  const _saEl = $('editStatusAprovacao');
  if (_saEl) _saEl.value = os.statusAprovacao || (os.aceitouTermos === true ? 'Aprovado' : (os.aceitouTermos === false ? 'Desaprovado' : 'Pendente'));
  const _spEl = $('editStatusPagamento');
  if (_spEl) _spEl.value = os.statusPagamento === 'Autorizado' ? 'Pago' : (os.statusPagamento || '');
  editLembretesCobranca = Array.isArray(os.lembretesCobranca)
    ? os.lembretesCobranca.map(item => ({ ...item }))
    : [];
  editLembretesCobrancaExcluidos = Array.isArray(os.lembretesCobrancaExcluidos)
    ? os.lembretesCobrancaExcluidos.map(item => ({ ...item }))
    : [];
  renderizarLembretesCobrancaEdicao();
  $('editTermos').value = os.termos || '';
  if ($('editTermos').value.trim()) atualizarIndicadorTermos('editTermos', true);
  else aplicarTermosPadraoNoCampo('os', 'editTermos', true);
  // ETAPA 8.7.3 — previsão de entrega e alerta de atraso
  const semPrazoEdicao = os.semPrazo === true || (!os.dataPrevista && !os.horaPrevista);
  if ($('editSemPrazoOS')) $('editSemPrazoOS').checked = semPrazoEdicao;
  if ($('editDataPrevista')) {
    let dataPrev = os.dataPrevista || '';
    // Parte 2.1: preencher automaticamente se vazio e configuração ativa
    if (!dataPrev && configAtual.preencherDatasAuto && !semPrazoEdicao) {
      const agora = new Date();
      dataPrev = `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,'0')}-${String(agora.getDate()).padStart(2,'0')}`;
    }
    $('editDataPrevista').value = dataPrev;
  }
  if ($('editHoraPrevista')) {
    let horaPrev = os.horaPrevista || '';
    // Parte 2.1: preencher automaticamente se vazio e configuração ativa
    if (!horaPrev && configAtual.preencherDatasAuto && !semPrazoEdicao) {
      const agora = new Date();
      horaPrev = `${String(agora.getHours()).padStart(2,'0')}:${String(agora.getMinutes()).padStart(2,'0')}`;
    }
    $('editHoraPrevista').value = horaPrev;
  }
  aplicarEstadoSemPrazo('editSemPrazoOS', 'editDataPrevista', 'editHoraPrevista');
  if ($('editAvisoAtraso')) $('editAvisoAtraso').classList.toggle('escondido', !os.atrasada);
  // ETAPA 8.7.1 — prioridade, controle interno e responsável técnico
  $('editPrioridadeOS').value = os.prioridade || 'Normal';
  const ci = os.controleInterno || {};
  $('editCodigoInterno').value = ci.codigoInterno || '';
  $('editEtiquetaInterna').value = ci.etiquetaInterna || '';
  $('editTagBancada').value = ci.tagBancada || '';
  $('editNumeroPatrimonio').value = ci.numeroPatrimonio || '';
  $('editTecnicoResponsavel').value = os.tecnicoResponsavel || '';
  $('editTecnicoAuxiliar').value = os.tecnicoAuxiliar || '';
  // ETAPA 8.6.1 — checklist técnico e diagnóstico
  editChecklistDefeitos = a.checklistDefeitos ? [...a.checklistDefeitos] : [];
  editChecklistAcessorios = a.acessoriosChecklist ? [...a.acessoriosChecklist] : [];
  editChecklistTestes = a.testesEntrada ? [...a.testesEntrada] : [];
  renderizarChecklistBox('checklistDefeitosEdit', listaDefeitosPorTipo(tipoEq), editChecklistDefeitos);
  renderizarChecklistBox('checklistAcessoriosEdit', CHECKLIST_ACESSORIOS_RECEBIDOS, editChecklistAcessorios);
  renderizarChecklistBox('checklistTestesEdit', CHECKLIST_TESTES_ENTRADA, editChecklistTestes);
  // ETAPA 8.7.1 — checklist de entrada e saída
  editChecklistEntrada = os.checklistEntrada ? [...os.checklistEntrada] : [];
  editChecklistSaida = os.checklistSaida ? [...os.checklistSaida] : [];
  renderizarChecklistBox('checklistEntradaEdit', CHECKLIST_ENTRADA, editChecklistEntrada);
  renderizarChecklistBox('checklistSaidaEdit', CHECKLIST_SAIDA, editChecklistSaida);
  if ($('editObsEntrada')) $('editObsEntrada').value = os.observacoesEntrada || '';
  if ($('editObsSaida')) $('editObsSaida').value = os.observacoesSaida || '';
  // ETAPA 8.7.2 — galeria de fotos da OS
  editFotosOS = os.fotos ? [...os.fotos] : [];
  renderizarGaleriaFotosOS();
  const diag = os.diagnosticoTecnico || {};
  $('editDiagDiagnostico').value = diag.diagnostico || '';
  $('editDiagSolucao').value = diag.solucao || '';
  $('editDiagPecas').value = diag.pecas || '';
  diagLimparPecasTrocar('ed');
  (diag.pecasTrocar || []).forEach(p => diagAdicionarLinhaPecaTrocar('ed', p.nome, p.valor));
  $('editDiagValorEstimado').value = diag.valorEstimado || '';
  $('editDiagPrazoEstimado').value = diag.prazoEstimado || '';
  mostrarMsg('mensagemEditar','','');
  // v31: mostra botão WhatsApp em "Aguardando aprovação" e "Aguardando Pagamento" (statusPagamento)
  // v46 — FIX: removido o caso "Pronto para retirada" deste botão genérico. Antes ele
  // reaparecia junto com btnProntoRetirada e oferecia um segundo caminho de cobrança
  // (link MP direto via montarCobranca, sem pedir forma de pagamento na retirada e sem
  // ativar o estado 'aguardando_forma_pagamento_retirada'), deixando a OS fora do fluxo
  // novo da Fase 5 se o técnico clicasse nele por engano. Agora, quando a OS está
  // "Pronto para retirada", SOMENTE btnProntoRetirada (wappenviarretiradacomcobranca)
  // dispara cobrança — um único caminho, sem ambiguidade.
  const btnWA = $('btnWhatsAppOS');
  if (btnWA) {
    const _stTec = os.status || '';
    const _stPag = os.statusPagamento || '';
    // Aparece em: técnico = Aguardando aprovação, ou pagamento = Aguardando Pagamento
    // (reenvio do link MP gerado antes do aparelho ficar pronto — não conflita com a
    // cobrança de retirada, que é feita exclusivamente por btnProntoRetirada).
    const statusParaWapp = _stTec === 'Aguardando aprovação'
                        || (_stPag === 'Aguardando Pagamento' && _stTec !== 'Pronto para retirada');
    const temTelefone = !!(os.cliente?.telefone || '').trim();
    btnWA.classList.toggle('escondido', !(statusParaWapp && temTelefone));
    btnWA.dataset.osNumero = os.numero;
    // Tipo: sempre orçamento agora que "retirada" foi removido deste botão.
    const tipoWA = 'aprovacao';
    btnWA.dataset.tipoCobranca = tipoWA;
    btnWA.innerHTML = `${ICONE_DOCUMENTO} Enviar Orçamento`;
  }
  // Botão "Pronto para Retirada" — aparece quando OS tem status técnico "Pronto para retirada" e tem telefone
  const btnPR = $('btnProntoRetirada');
  if (btnPR) {
    const prontoRetirada = os.status === 'Pronto para retirada';
    const temTelefone = !!(os.cliente?.telefone || '').trim();
    btnPR.classList.toggle('escondido', !(prontoRetirada && temTelefone));
    btnPR.dataset.osNumero = os.numero;
  }
  const btnAval = $('btnWappAvaliacao');  if (btnAval) {
    const entregue   = os.status === 'Entregue';
    const temTelefone = !!(os.cliente?.telefone || '').trim();
    btnAval.classList.toggle('escondido', !(entregue && temTelefone));
    btnAval.dataset.osNumero = os.numero;
  }
  // Botão WhatsApp Confirmar Pagamento — aparece quando OS está Autorizada e tem telefone
  const btnWPC = $('btnWappPagConf');
  if (btnWPC) {
    const autorizada  = ['Pago', 'Autorizado'].includes(os.statusPagamento)
      || Number(os.percentualPagamentoConfirmado) >= 100;
    const temTelefone = !!(os.cliente?.telefone || '').trim();
    btnWPC.classList.toggle('escondido', !(autorizada && temTelefone));
    btnWPC.dataset.osNumero = os.numero;
  }
  const btnVP = $('btnVerificarPagamento');
  if (btnVP) {
    // v31: mostra se OS está Pronto para retirada OU já está Autorizada (statusPagamento)
    const mostrarVP = os.status === 'Pronto para retirada' || ['Pago', 'Autorizado'].includes(os.statusPagamento);
    btnVP.classList.toggle('escondido', !mostrarVP);
    btnVP.dataset.osNumero = os.numero;
  }
  const btnRM = $('btnRegistrarPagManual');
  if (btnRM) {
    // v31: mostra para qualquer OS que ainda não tem statusPagamento = Autorizado
    btnRM.classList.toggle('escondido', ['Pago', 'Autorizado'].includes(os.statusPagamento));
    btnRM.dataset.osNumero = os.numero;
    btnRM.dataset.osValor  = os.valorInvestido || 0;
  }
  const btnDPR = $('btnDefinirPagamentoRetirada');
  if (btnDPR) {
    const aguardandoAprovacao = os.status === 'Aguardando aprovação' &&
      !['Pago', 'Autorizado', 'Aguardando Pagamento na Retirada'].includes(os.statusPagamento);
    btnDPR.classList.toggle('escondido', !aguardandoAprovacao);
    btnDPR.dataset.osNumero = os.numero;
  }
  // Fase 6 — Botão "Confirmar Pagamento Presencial": aparece só quando o
  // cliente já respondeu pelo WhatsApp qual seria a forma de pagamento na
  // retirada (Fase 5), mas ninguém confirmou ainda que o dinheiro foi
  // efetivamente recebido.
  const btnCPP = $('btnConfirmarPagamentoPresencial');
  if (btnCPP) {
    const aguardandoPresencial = ['Pago 50%', 'Aguardando Pagamento na Retirada', 'Aguardando Pagamento Presencial']
      .includes(os.statusPagamento);
    btnCPP.classList.toggle('escondido', !aguardandoPresencial);
    btnCPP.dataset.osNumero = os.numero;
    const percentualAguardado = Number(os.percentualPagamentoAguardado) || 100;
    const valorTotalPagamento = _valorServicoOS(os);
    btnCPP.dataset.osValor = percentualAguardado === 50
      ? (_numeroMoedaSistema(os.valorEntradaAprovacao) || valorTotalPagamento / 2)
      : valorTotalPagamento;
    btnCPP.dataset.osPercentual = String(percentualAguardado);
    btnCPP.dataset.osFormaPagamento = os.formaPagamento || '';
  }
  resetarBotaoFecharModal('modalEditarOS');
  $('modalEditarOS').classList.remove('escondido');
  $('modalDetalheOS').classList.add('escondido');
};

// Checkbox "sem número" — Modal Editar OS
if ($('editSemNumero')) {
  $('editSemNumero').addEventListener('change', () => {
    const marcado = $('editSemNumero').checked;
    const telEl   = $('editTelefone');
    const ast     = $('editTelefoneAsteristico');
    if (telEl) { telEl.disabled = marcado; telEl.value = marcado ? '' : telEl.value; telEl.style.opacity = marcado ? '0.4' : ''; telEl.placeholder = marcado ? 'Sem número' : '(00) 00000-0000'; }
    if (ast) ast.style.display = marcado ? 'none' : '';
  });
}

$('btnSalvarEditar').addEventListener('click', async () => {
  if (!osEmEdicao) return;

  const nome = $('editNome').value.trim();
  const telefone = $('editTelefone').value.trim();
  const semNumero = $('editSemNumero')?.checked;
  const marca = $('editMarca').value.trim();
  const modelo = $('editModelo').value.trim();
  const defeito = $('editDefeito').value.trim();
  const cpf = $('editCpf').value.trim();
  const imei = $('editImei').value.trim();

  limparErros('editNome','editTelefone','editMarca','editModelo','editDefeito','editCpf','editImei');

  let valido = true;
  if (!nome) { marcarErro('editNome', 'Nome do cliente é obrigatório.'); valido = false; }
  if (!telefone && !semNumero) { marcarErro('editTelefone', 'Informe o telefone ou marque "Cliente não tem número".'); valido = false; }
  if (!marca) { marcarErro('editMarca', 'Marca é obrigatória.'); valido = false; }
  if (!modelo) { marcarErro('editModelo', 'Modelo é obrigatório.'); valido = false; }
  if (!defeito) { marcarErro('editDefeito', 'Defeito é obrigatório.'); valido = false; }
  if (cpf && !validarCPF(cpf)) { marcarErro('editCpf', 'CPF inválido.'); valido = false; }
  if (imei && !validarIMEI(imei)) { marcarErro('editImei', 'IMEI inválido (deve ter 15 dígitos).'); valido = false; }
  if (!valido) { mostrarMsg('mensagemEditar', 'Corrija os campos destacados em vermelho.', 'erro'); return; }

  $('btnSalvarEditar').disabled = true;
  $('btnSalvarEditar').innerHTML = `${ICONE_RELOGIO} Salvando...`;
  try {
    // v31: status técnico e pagamento são campos independentes
    const statusTecnico  = $('editStatusOS').value;
    const statusAprovacao = $('editStatusAprovacao')?.value || 'Pendente';
    const statusPagSpEl  = $('editStatusPagamento');
    const statusPagForm  = statusPagSpEl ? statusPagSpEl.value : '';
    // Auto-transição: ao colocar técnico = "Aguardando aprovação", define pagamento = "Aguardando Pagamento"
    // O status técnico permanece "Aguardando aprovação" — apenas o campo de pagamento é atualizado
    const statusPagFinal = statusPagForm || (statusTecnico === 'Aguardando aprovação' ? 'Aguardando Pagamento' : '');
    const statusPagamentoDividido = ['Pagamento 50/50', 'Pagamento 50/50 remoto', 'Pagamento 50/50 presencial'];
    const ativouPagamentoMisto = statusPagamentoDividido.includes(statusPagFinal)
      && osEmEdicao.statusPagamento !== statusPagFinal;
    const virouEntregue = osEmEdicao.status !== 'Entregue' && statusTecnico === 'Entregue';
    const dados = {
      status: statusTecnico,            // campo técnico — nunca mistura pagamento
      statusAprovacao,
      statusPagamento: statusPagFinal,
      prioridade: $('editPrioridadeOS').value,
      controleInterno: {
        codigoInterno: $('editCodigoInterno').value.trim(),
        etiquetaInterna: $('editEtiquetaInterna').value.trim(),
        tagBancada: $('editTagBancada').value.trim(),
        numeroPatrimonio: $('editNumeroPatrimonio').value.trim()
      },
      tecnicoResponsavel: $('editTecnicoResponsavel').value.trim(),
      tecnicoAuxiliar: $('editTecnicoAuxiliar').value.trim(),
      cliente: { nome, cpf, email: $('editEmail').value, telefone: semNumero ? '' : telefone },
      aparelho: {
        marca, modelo, cor: $('editCor').value, tipo: $('editTipoEquipamento').value,
        tipoEquipamento: $('editTipoEquipamento').value, imei, senhaAparelho: $('editSenha').value,
        acessorios: $('editAcessorios').value, defeitoRelatado: defeito, observacoes: $('editObs').value,
        dadosEquipamento: coletarDadosEquipamento('ed', $('editTipoEquipamento').value),
        checklistDefeitos: [...editChecklistDefeitos],
        acessoriosChecklist: [...editChecklistAcessorios],
        testesEntrada: [...editChecklistTestes]
      },
      imei,
      termos: $('editTermos').value,
      valorTotalServico: _numeroMoedaSistema($('editDiagValorEstimado').value),
      semPrazo: $('editSemPrazoOS')?.checked === true,
      dataPrevista: $('editSemPrazoOS')?.checked ? '' : $('editDataPrevista').value,
      horaPrevista: $('editSemPrazoOS')?.checked ? '' : $('editHoraPrevista').value,
      diagnosticoTecnico: {
        diagnostico: $('editDiagDiagnostico').value.trim(),
        solucao: $('editDiagSolucao').value.trim(),
        pecas: $('editDiagPecas').value.trim(),
        pecasTrocar: diagColetarPecasTrocar('ed'),
        valorEstimado: $('editDiagValorEstimado').value,
        prazoEstimado: $('editDiagPrazoEstimado').value.trim()
      },
      checklistEntrada: [...editChecklistEntrada],
      observacoesEntrada: $('editObsEntrada').value.trim(),
      checklistSaida: [...editChecklistSaida],
      observacoesSaida: $('editObsSaida').value.trim(),
      lembretesCobranca: editLembretesCobranca.map(item => ({ ...item })),
      lembretesCobrancaExcluidos: editLembretesCobrancaExcluidos.map(item => ({ ...item }))
    };
    if (statusPagamentoDividido.includes(statusPagFinal)) {
      const valorTotalMisto = Number(dados.valorTotalServico) || 0;
      if (valorTotalMisto < 1) {
        throw new Error('Informe o valor do serviço para dividir o pagamento em duas parcelas de 50%.');
      }
      const modalidades = statusPagFinal === 'Pagamento 50/50 remoto'
        ? ['online', 'online']
        : statusPagFinal === 'Pagamento 50/50 presencial'
          ? ['presencial', 'presencial']
          : ['presencial', 'online'];
      dados.exigirEntrada50Aprovacao = true;
      dados.valorEntradaAprovacao = Number((valorTotalMisto / 2).toFixed(2));
      dados.percentualPagamentoAguardado = 50;
      dados.percentualPagamentoConfirmado = 0;
      dados.entrada50Paga = false;
      dados.modalidadePagamentoAprovacao = modalidades[0];
      dados.modalidadeParcela1 = modalidades[0];
      dados.modalidadeParcela2 = modalidades[1];
      dados.contextoFormaPagamento = `50_${modalidades[0]}_50_${modalidades[1]}`;
    }
    const numeroAtualizado = osEmEdicao.numero;
    await window.api.osatualizar(numeroAtualizado, dados, usuarioAtual?.id);
    toast('OS atualizada!', 'sucesso');
    // Rebusca a OS e repopula o próprio modal aberto. Assim valores calculados,
    // status e dados normalizados aparecem imediatamente, sem fechar e abrir.
    await window.abrirEditarOS(numeroAtualizado);
    marcarModalComoSalvo('modalEditarOS');
    await carregarHistorico();
    if (typeof window.carregarAutorizadas === 'function') {
      const filtroAutorizadas = $('orcFiltroTexto')?.value?.trim() || '';
      await window.carregarAutorizadas(filtroAutorizadas);
    }
    if (ativouPagamentoMisto) {
      toast('Pagamento dividido em duas parcelas de 50%.', 'info');
      if (dados.modalidadeParcela1 === 'online' || dados.modalidadeParcela2 === 'online') {
        await abrirModalEnvioWhatsAppManual('aprovacao', numeroAtualizado, { pagamentoMisto: true });
      }
    }
    if (virouEntregue) {
      const emitirAgora = await confirmModal(
        `A OS ${numeroAtualizado} foi marcada como entregue.\n\nDeseja emitir agora o comprovante de entrega com assinatura de recebimento?`,
        {
          titulo: 'Emitir comprovante de entrega',
          textoOk: 'Sim, preencher e emitir',
          textoCancelar: 'Agora não'
        }
      );
      if (emitirAgora) {
        $('modalEditarOS')?.classList.add('escondido');
        await window.abrirFluxoComprovanteEntrega(numeroAtualizado);
      } else {
        toast('O comprovante pode ser emitido depois pelo botão da OS ou pela aba Entregas.', 'info');
      }
    }
  } catch(err) {
    mostrarMsg('mensagemEditar','Erro: '+err.message,'erro');
  } finally {
    $('btnSalvarEditar').disabled = false;
    $('btnSalvarEditar').textContent = 'Salvar e Gerar PDF';
  }
});

// ══════════════════════════════════════════
// BACKUP
// ══════════════════════════════════════════
$('btnExportarBackup').addEventListener('click', async () => {
  const r = await window.api.backupexportar();
  if (r.cancelado) return;
  if (r.sucesso) toast(`${ICONE_CHECK} Backup exportado! ${r.totalOrdens} OS + ${r.totalEstoque||0} aparelhos + configurações da empresa.`, 'sucesso');
  else toast('Erro no backup: ' + (r.erro || 'falha desconhecida'), 'erro');
});

$('btnImportarBackup').addEventListener('click', async () => {
  const ok = confirm(
    'Restaurar backup?\n\n' +
    'Isso vai importar todas as OS, estoque e configurações da empresa (nome, logo, tema, termos, etc.) do arquivo selecionado.\n\n' +
    'Os dados existentes não serão apagados — os do backup serão mesclados.'
  );
  if (!ok) return;
  const r = await window.api.backupimportar();
  if (r.cancelado) return;
  if (r.sucesso) {
    toast(`${ICONE_CHECK} Backup restaurado! ${r.importadas} OS + ${r.importadasEstoque||0} aparelhos importados. Configurações da empresa restauradas.`, 'sucesso');
    carregarHistorico();
    carregarEstoque();
    // Recarrega as configurações na tela para refletir o que veio do backup
    if (typeof carregarConfig === 'function') await carregarConfig();
    // Recarrega Painel e Dashboard de Estoque para refletir os dados restaurados
    // (cards, gráficos e KPIs são derivados e não atualizavam sozinhos até trocar de aba)
    if (typeof carregarPainel === 'function') await carregarPainel();
    if (typeof carregarDashboardEstoque === 'function') await carregarDashboardEstoque();
  } else toast('Erro ao importar: ' + r.erro, 'erro');
});

// ══════════════════════════════════════════
// APP CELULAR — lote v2
// Importar lote misto (OS + Compra + Venda), ou OS avulsa (formato antigo)
// ══════════════════════════════════════════
$('btnImportarLoteCelular').addEventListener('click', async () => {
  const r = await window.api.loteimportardocelular(usuarioAtual?.id);
  if (r.cancelado) return;
  if (!r.sucesso) {
    toast('Erro ao importar lote do celular: ' + r.erro, 'erro');
    return;
  }

  const { importados, pulados, erros, total, rejeitados, entregasSubstituidas, pdfsEntregaComFalha } = r;
  const partes = [];
  if (importados.os > 0) partes.push(`${importados.os} OS`);
  if (importados.compra > 0) partes.push(`${importados.compra} Compra${importados.compra > 1 ? 's' : ''}`);
  if (importados.venda > 0) partes.push(`${importados.venda} Venda${importados.venda > 1 ? 's' : ''}`);
  if (importados.entrega > 0) partes.push(`${importados.entrega} Entrega${importados.entrega > 1 ? 's' : ''}`);
  const resumoImportados = partes.length ? partes.join(', ') : 'nenhum item';

  let msg = `${ICONE_CHECK} Lote processado (${total} item${total !== 1 ? 's' : ''}): ${resumoImportados} importado(s).`;
  if (entregasSubstituidas > 0) msg += ` ${entregasSubstituidas} comprovante(s) de entrega substituíra(m) uma versão anterior da mesma OS.`;
  if (pulados > 0) msg += ` ${pulados} já tinha(m) sido importado(s) antes (pulado(s)).`;
  if (rejeitados && rejeitados.length > 0) msg += ` ${ICONE_ALERTA} ${rejeitados.length} comprovante(s) de entrega rejeitado(s) por OS não encontrada.`;
  if (erros.length > 0) msg += ` ${ICONE_ALERTA} ${erros.length} item(ns) com erro.`;
  if (pdfsEntregaComFalha && pdfsEntregaComFalha.length > 0) {
    msg += ` ${ICONE_ALERTA} PDF de ${pdfsEntregaComFalha.length} comprovante(s) de entrega não pôde ser gerado agora (OS ${pdfsEntregaComFalha.join(', ')}) — dado foi importado, use "Gerar/Ver PDF" na aba Entregas para tentar novamente.`;
  }

  toast(msg, (erros.length > 0 || (rejeitados && rejeitados.length > 0) || (pdfsEntregaComFalha && pdfsEntregaComFalha.length > 0)) ? 'erro' : 'sucesso');

  if (rejeitados && rejeitados.length > 0) {
    const detalheRejeitados = rejeitados
      .map(rj => `• OS ${rj.numeroOS || '(sem número)'}: ${rj.erro}`)
      .join('\n');
    alert(`Comprovantes de entrega não importados:\n\n${detalheRejeitados}\n\nVerifique o número da OS digitado no celular.`);
  }

  if (erros.length > 0) {
    const detalheErros = erros
      .map(e => `• ${e.tipoDocumento || '(tipo desconhecido)'} [${e.idExportacao || 'sem id'}]: ${e.erro}`)
      .join('\n');
    // Além do toast (que resume), mostra o detalhe completo dos erros —
    // o usuário precisa saber exatamente qual item falhou e por quê,
    // não só um "ok" genérico.
    alert(`Itens do lote com erro:\n\n${detalheErros}`);
  }

  carregarHistorico();
  if (typeof carregarPainel === 'function') await carregarPainel();
  if (typeof carregarEstoque === 'function') await carregarEstoque();
  if (typeof carregarDashboardEstoque === 'function') await carregarDashboardEstoque();
  // Recarrega a aba Entregas só se ela já foi aberta pelo menos uma vez
  // nesta sessão (a tabela existe no DOM) — evita erro silencioso se o
  // usuário importar um lote sem nunca ter clicado na aba.
  if (importados.entrega > 0 && document.getElementById('corpoTabelaEntregas') && typeof carregarEntregas === 'function') {
    await carregarEntregas();
  }
});

// ══════════════════════════════════════════
// EXPORTAR DOCUMENTO (OS/Compra/Venda) PARA ASSINATURA REMOTA NO CELULAR
// Fluxo diferente do lote acima: envio INDIVIDUAL de um documento que já
// existe no PC, para o celular coletar a assinatura da outra parte e
// devolver. Usado pelos botões nas telas de detalhe de OS/Compra/Venda.
// ══════════════════════════════════════════
window.exportarParaAssinaturaCelular = async function(tipoDocumento, identificador) {
  const r = await window.api.assinaturaexportar(tipoDocumento, identificador, usuarioAtual?.id);
  if (r.cancelado) return;
  if (!r.sucesso) {
    toast('Erro ao enviar para assinatura: ' + r.erro, 'erro');
    return;
  }
  toast(`${ICONE_CELULAR} Enviado ao celular. Assim que for assinado, o documento volta automaticamente para este PC.`, 'sucesso');
};

// Importar a resposta assinada (celular -> PC) — grava a assinatura de
// volta no mesmo documento que foi exportado, nunca cria um novo.
$('btnImportarRespostaAssinaturaCelular')?.addEventListener('click', async () => {
  const r = await window.api.assinaturaimportarresposta(usuarioAtual?.id);
  if (r.cancelado) return;
  if (!r.sucesso) {
    toast('Erro ao importar assinatura: ' + r.erro, 'erro');
    return;
  }
  const rotulo = { os: 'OS', compra: 'Compra', venda: 'Venda', entrega: 'Entrega' }[r.tipoDocumento] || r.tipoDocumento;
  const numeroDoc = r.tipoDocumento === 'venda' ? r.registro.id : (r.registro.numero || r.registro.numeroOS);
  toast(`${ICONE_CHECK} Assinatura recebida! ${rotulo} ${numeroDoc} atualizada.`, 'sucesso');
  carregarHistorico();
  if (typeof carregarPainel === 'function') await carregarPainel();
  if (typeof carregarEstoque === 'function') await carregarEstoque();
  if (typeof carregarDashboardEstoque === 'function') await carregarDashboardEstoque();
  if (r.tipoDocumento === 'entrega') {
    if (typeof carregarEntregas === 'function') await carregarEntregas();
    if (typeof window.carregarEntregasPendentes === 'function') await window.carregarEntregasPendentes();
  }
});


// Backup automático
$('btnBackupAgora').addEventListener('click', async () => {
  $('btnBackupAgora').disabled = true;
  $('btnBackupAgora').innerHTML = `${ICONE_RELOGIO} Fazendo backup...`;
  const r = await window.api.backupfazeragora();
  $('btnBackupAgora').disabled = false;
  $('btnBackupAgora').textContent = 'Fazer Backup Agora';
  if (r.sucesso) { toast('Backup automático criado com sucesso!', 'sucesso'); carregarListaBackupsAuto(); carregarStatusBackupAuto(); }
  else toast('Erro no backup: ' + r.erro, 'erro');
});

$('btnAbrirPastaAuto').addEventListener('click', async () => {
  await window.api.backupabrirpastauto();
});

// ══════════════════════════════════════════
// ZERAR SISTEMA (reset completo — irreversível)
// ══════════════════════════════════════════
// Fluxo: 1) aviso claro do que será apagado/mantido → 2) backup automático
// de segurança + validação de senha de exclusão (tudo feito no processo
// principal, main.js, nunca confiando só no que roda aqui) → 3) recarrega
// todas as telas derivadas para refletir o sistema zerado.
$('btnZerarSistema')?.addEventListener('click', async () => {
  const confirmacao1 = await confirmModal(
    `${ICONE_ALERTA} ZERAR SISTEMA — ação irreversível\n\n` +
    'Isso vai apagar PERMANENTEMENTE:\n' +
    '• Todas as Ordens de Serviço e Orçamentos\n' +
    '• Todo o Estoque (aparelhos e peças) e Compras\n' +
    '• Pagamentos, Reembolsos e Cobranças\n' +
    '• Logs de movimentações e mensagens\n' +
    'Os contadores (OS-0001, etc.) voltam ao início.\n\n' +
    'Configurações da empresa, usuários e cargos NÃO serão apagados.\n' +
    'Um backup automático de segurança será feito antes de zerar.\n\n' +
    'Deseja continuar?',
    { titulo: `${ICONE_ALERTA} Zerar Sistema`, textoOk: 'Continuar', textoCancelar: 'Cancelar', perigo: true }
  );
  if (!confirmacao1) return;

  const senha = await promptModal(
    'Digite a senha de exclusão para confirmar o Zerar Sistema:',
    '', { titulo: `${ICONE_ALERTA} Confirmar Zerar Sistema`, senha: true }
  );
  if (senha === null) return;

  const responsavel = (await promptModal(
    'Informe seu nome (responsável por zerar o sistema):',
    '', { titulo: 'Responsável pela ação' }
  )) || 'não identificado';

  const confirmacaoFinal = await confirmModal(
    'Última confirmação: tem certeza que deseja zerar o sistema agora? Essa ação não pode ser desfeita pelo próprio sistema.',
    { titulo: `${ICONE_ALERTA} Confirmação Final`, textoOk: 'Zerar agora', textoCancelar: 'Cancelar', perigo: true }
  );
  if (!confirmacaoFinal) return;

  const btn = $('btnZerarSistema');
  btn.disabled = true;
  const textoOriginal = btn.innerHTML;
  btn.innerHTML = `${ICONE_RELOGIO} Zerando sistema...`;

  try {
    const r = await window.api.sistemazerar(senha, responsavel);
    if (r.sucesso) {
      toast(`${ICONE_CHECK} Sistema zerado com sucesso. Backup de segurança salvo antes da limpeza.`, 'sucesso');
      // Limpa notificações locais (não fazem parte do database.json)
      try { localStorage.removeItem('sistemaos_notificacoes_v1'); } catch {}
      // Recarrega todas as telas derivadas para refletir o reset
      if (typeof carregarHistorico === 'function') await carregarHistorico();
      if (typeof carregarEstoque === 'function') await carregarEstoque();
      if (typeof carregarAutorizadas === 'function') await carregarAutorizadas();
      if (typeof carregarPagamentos === 'function') await carregarPagamentos();
      if (typeof carregarFinanceiro === 'function') await carregarFinanceiro();
      if (typeof carregarPainel === 'function') await carregarPainel();
      if (typeof carregarDashboardEstoque === 'function') await carregarDashboardEstoque();
      if (typeof carregarListaBackupsAuto === 'function') await carregarListaBackupsAuto();
      if (typeof carregarStatusBackupAuto === 'function') await carregarStatusBackupAuto();
    } else {
      toast('Zerar Sistema cancelado: ' + (r.erro || 'falha desconhecida'), 'erro');
    }
  } catch (e) {
    toast('Erro ao zerar sistema: ' + e.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }
});

// Formata bytes de forma legível (KB/MB)
function _formatarBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kbArredondado = Math.round((bytes / 1024) * 10) / 10; // arredonda para 1 casa antes de decidir a unidade
  if (kbArredondado < 1024) return `${kbArredondado.toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Formata "há quanto tempo" de forma amigável a partir de uma data ISO
function _formatarTempoRelativo(dataISO) {
  const agora = new Date();
  const data = new Date(dataISO);
  const diffMs = agora - data;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHoras = Math.floor(diffMin / 60);
  if (diffHoras < 24) return `há ${diffHoras}h`;
  const diffDias = Math.floor(diffHoras / 24);
  if (diffDias === 1) return 'ontem';
  return `há ${diffDias} dias`;
}

async function carregarStatusBackupAuto() {
  const el = $('statusBackupAuto');
  if (!el) return;
  try {
    const status = await window.api.backupstatusautomatico();
    const corAtivo = status.ativo ? 'var(--sucesso)' : 'var(--texto-sec)';
    const textoUltimo = status.ultimoBackup
      ? _formatarTempoRelativo(status.ultimoBackup.data)
      : 'nenhum ainda';
    el.innerHTML = `
      <div class="card" style="padding:10px 12px;">
        <div style="font-size:11px;color:var(--texto-sec);text-transform:uppercase;letter-spacing:.03em;">Status</div>
        <div style="font-size:14px;font-weight:700;color:${corAtivo};margin-top:2px;">${status.ativo ? `${ICONE_BOLA_VERDE} Ativo` : `${ICONE_BOLA_CINZA} Inativo`}</div>
      </div>
      <div class="card" style="padding:10px 12px;">
        <div style="font-size:11px;color:var(--texto-sec);text-transform:uppercase;letter-spacing:.03em;">Último Backup</div>
        <div style="font-size:14px;font-weight:700;margin-top:2px;">${textoUltimo}</div>
      </div>
      <div class="card" style="padding:10px 12px;">
        <div style="font-size:11px;color:var(--texto-sec);text-transform:uppercase;letter-spacing:.03em;">Backups Guardados</div>
        <div style="font-size:14px;font-weight:700;margin-top:2px;">${status.totalBackups} / ${status.limiteBackups}</div>
      </div>
      <div class="card" style="padding:10px 12px;">
        <div style="font-size:11px;color:var(--texto-sec);text-transform:uppercase;letter-spacing:.03em;">Espaço em Disco</div>
        <div style="font-size:14px;font-weight:700;margin-top:2px;">${_formatarBytes(status.espacoTotalBytes)}</div>
      </div>`;
  } catch (e) {
    console.error('Erro ao carregar status do backup automático:', e);
    el.innerHTML = '<p style="color:var(--texto-sec);font-size:12px;grid-column:1/-1;">Não foi possível carregar o status do backup automático.</p>';
  }
}

async function carregarListaBackupsAuto() {
  const lista = $('listaBackupsAuto');
  if (!lista) return;
  lista.innerHTML = '<p style="color:var(--texto-sec);font-size:12px;">Carregando...</p>';
  try {
    const backups = await window.api.backuplistarauto();
    if (!backups || backups.length === 0) {
      lista.innerHTML = '<p style="color:var(--texto-sec);font-size:12px;">Nenhum backup automático encontrado ainda.</p>';
      return;
    }
    lista.innerHTML = `
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--borda);">
          <th style="text-align:left;padding:4px 6px;">Data</th>
          <th style="text-align:right;padding:4px 6px;">Tamanho</th>
          <th style="text-align:right;padding:4px 6px;"></th>
        </tr></thead>
        <tbody>${backups.map(b => {
          const data = new Date(b.data).toLocaleString('pt-BR');
          const kb = (b.tamanho / 1024).toFixed(1);
          return `<tr style="border-bottom:1px solid var(--borda);">
            <td style="padding:4px 6px;">${data}</td>
            <td style="text-align:right;padding:4px 6px;">${kb} KB</td>
            <td style="text-align:right;padding:4px 6px;">
              <button class="botao botao-fantasma" style="font-size:11px;padding:2px 7px;"
                onclick="baixarBackupAuto('${b.caminho.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')">${ICONE_IMPORTAR} Baixar</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  } catch(e) {
    lista.innerHTML = '<p style="color:var(--erro);font-size:12px;">Erro ao carregar backups.</p>';
  }
}

window.baixarBackupAuto = async (caminho) => {
  const r = await window.api.backupbaixarauto(caminho);
  if (r.cancelado) return;
  if (r.sucesso) toast('Backup salvo com sucesso!', 'sucesso');
  else toast('Erro ao salvar: ' + r.erro, 'erro');
};

// ══════════════════════════════════════════
// ESTOQUE
// ══════════════════════════════════════════
let estoqueAtual = [];
let filtroEstatus = '';
let filtroTipoEst = '';
let itemEmEdicao = null;
let checklistAtual = [];
let pecasUsadasEstoque = [];
const MAX_FOTOS_POR_DOCUMENTO = 10;
let fotosAtuais = [];

// ETAPA 9 — converte um caminho local em URL file:// válida em qualquer
// SO (cuida do caso Windows, que exige file:///C:/... com 3 barras).
function caminhoParaFileUrl(caminho) {
  if (!caminho) return '';
  let p = caminho.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p; // garante barra inicial (Windows: /C:/...)
  return 'file://' + encodeURI(p);
}

async function carregarEstoque() {
  estoqueAtual = await window.api.estoquelistar();
  renderizarEstoque();
}

function renderizarEstoque() {
  const lista = $('listaEstoque');
  const termoBusca = ($('estoqueFiltroTexto') || {}).value?.trim().toLowerCase() || '';
  let filtrado = filtroEstatus ? estoqueAtual.filter(e => e.status === filtroEstatus) : estoqueAtual;
  if (filtroTipoEst) filtrado = filtrado.filter(e => e.tipoEquipamento === filtroTipoEst);
  if (termoBusca) {
    filtrado = filtrado.filter(e => {
      const campos = [e.id, e.marca, e.modelo, e.cor, e.imei, e.serie,
        e.tipoEquipamento, e.status, e.descricao, e.numeroCompra,
        e.tipoPeca, e.compatibilidade, e.condicaoPeca,
        ...(Array.isArray(e.pecasUsadas) ? e.pecasUsadas.map(peca => peca?.nome || peca?.descricao || '') : [])
      ].filter(Boolean).join(' ').toLowerCase();
      return campos.includes(termoBusca);
    });
  }
  // Feedback de busca
  const infoEl = $('estoqueInfoBusca');
  if (infoEl) {
    if (termoBusca) {
      infoEl.style.display = 'block';
      infoEl.innerHTML = filtrado.length > 0
        ? `<b>${filtrado.length}</b> aparelho${filtrado.length !== 1 ? 's' : ''} para "<b>${termoBusca}</b>"`
        : `Nenhum resultado para "<b>${termoBusca}</b>"`;
    } else {
      infoEl.style.display = estoqueAtual.length > 0 ? 'block' : 'none';
      if (estoqueAtual.length > 0)
        infoEl.innerHTML = `<b>${filtrado.length}</b> de <b>${estoqueAtual.length}</b> aparelho${estoqueAtual.length !== 1 ? 's' : ''}`;
    }
  }
  if (!filtrado.length) {
    lista.innerHTML = '<p class="vazio" style="text-align:center;padding:40px;grid-column:1/-1;">Nenhum aparelho encontrado.</p>';
    return;
  }
  lista.innerHTML = filtrado.map(item => {
    const investido = (item.valorPago||0)+(item.valorGastoPecas||0)+(item.gastosExtras||0);
    const lucro = (item.valorVenda||0) - investido;
    const lucroClass = lucro >= 0 ? 'card-est-lucro' : 'card-est-lucro negativo';
    const isPeca = item.tipoEquipamento === 'Peça / Componente';
    const subInfo = isPeca
      ? [item.tipoPeca, item.compatibilidade ? `Compat: ${item.compatibilidade}` : '', item.condicaoPeca].filter(Boolean).join(' · ')
      : [item.cor, item.imei ? 'IMEI: '+item.imei : ''].filter(Boolean).join(' · ');
    const qtdBadge = isPeca && item.quantidade > 1
      ? `<span style="font-size:11px;background:var(--primario);color:var(--ds-texto-invert);border-radius:10px;padding:1px 7px;margin-left:6px;">x${item.quantidade}</span>`
      : '';
    const pecasRegistradas = Array.isArray(item.pecasUsadas) ? item.pecasUsadas.filter(peca => peca?.nome) : [];
    const resumoPecas = pecasRegistradas.length
      ? `<div class="card-est-pecas" title="${_escHtml(pecasRegistradas.map(peca => peca.nome).join(', '))}">Peças: ${_escHtml(pecasRegistradas.slice(0, 2).map(peca => peca.nome).join(' + '))}${pecasRegistradas.length > 2 ? ` +${pecasRegistradas.length - 2}` : ''}</div>`
      : '';
    return `<div class="card-estoque" onclick="abrirModalEstoque('${item.id}')">
      <div class="card-est-header">
        <div>
          <div class="card-est-marca">${ICONE_TIPO_EQUIPAMENTO[item.tipoEquipamento]||''} ${item.marca||'—'} ${item.modelo||''}${qtdBadge}</div>
          <div class="card-est-modelo">${subInfo}</div>
        </div>
        <span class="${statusClass(item.status)}">${item.status}</span>
      </div>
      <div style="font-size:12px;color:var(--texto-sec);">${item.id} · ${fmtData(item.dataEntrada||item.dataCadastro)}</div>
      <div class="card-est-valores">
        <span>Investido: ${fmtMoeda(investido)}</span>
        ${item.status === 'Vendido' ? `<span class="${lucroClass}">Lucro: ${fmtMoeda(lucro)}</span>` : `<span>Venda: ${fmtMoeda(item.valorVenda)}</span>`}
      </div>
      ${resumoPecas}
    </div>`;
  }).join('');
}

// Filtros de status e tipo
document.querySelectorAll('.filtro-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('ativo'));
    btn.classList.add('ativo');
    if (btn.dataset.tipo !== undefined) {
      // Filtro por tipo (ex: Peças)
      filtroTipoEst = btn.dataset.tipo;
      filtroEstatus = '';
    } else {
      filtroEstatus = btn.dataset.status;
      filtroTipoEst = '';
    }
    renderizarEstoque();
  });
});

$('btnNovoItemEstoque').addEventListener('click', () => abrirModalEstoque(null));
// Botão "Nova Peça" agora na aba separada
if ($('btnNovaPecaEstoque')) $('btnNovaPecaEstoque').addEventListener('click', () => abrirModalEstoque(null, 'Peça / Componente'));

// Log de estoque
$('btnLogEstoque').addEventListener('click', () => {
  $('modalLogEstoque').classList.remove('escondido');
  carregarLogEstoque();
});

$('btnFiltrarLog').addEventListener('click', () => carregarLogEstoque());

$('btnExportarLogCsv').addEventListener('click', async () => {
  const filtros = {
    dataInicio: $('logEstoqueDataInicio').value || undefined,
    dataFim: $('logEstoqueDataFim').value || undefined,
    tipo: $('logEstoqueTipo').value || undefined
  };
  const r = await window.api.estoqueexportarlogcsv(filtros);
  if (r.sucesso) toast('Arquivo CSV exportado!', 'sucesso');
});

async function carregarLogEstoque() {
  const tbody = $('tabelaLogEstoque');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#888;">Carregando...</td></tr>';
  try {
    const filtros = {
      dataInicio: $('logEstoqueDataInicio').value || undefined,
      dataFim: $('logEstoqueDataFim').value || undefined,
      tipo: $('logEstoqueTipo').value || undefined
    };
    const logs = await window.api.estoqueobterlog(filtros);
    if (!logs || !logs.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#888;">Nenhum registro encontrado.</td></tr>';
      if ($('logEstoqueInfo')) $('logEstoqueInfo').textContent = '';
      return;
    }
    const fmt = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const corTipo = { entrada: '#16a34a', saida: '#dc2626', atualizacao: '#2563eb', exclusao: '#9333ea' };
    tbody.innerHTML = logs.map(l => `<tr style="border-bottom:1px solid var(--borda);">
      <td style="padding:7px 10px;font-size:12px;white-space:nowrap;">${l.data ? new Date(l.data).toLocaleString('pt-BR') : '—'}</td>
      <td style="padding:7px 10px;"><span style="background:${corTipo[l.tipo]||'#888'};color:#fff;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;text-transform:uppercase;">${l.tipo||'—'}</span></td>
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;">${l.id||'—'}</td>
      <td style="padding:7px 10px;">${l.descricao||'—'}</td>
      <td style="padding:7px 10px;font-size:12px;">${l.status||'—'}</td>
      <td style="padding:7px 10px;text-align:right;font-size:12px;">${fmt(l.valorPago)}</td>
      <td style="padding:7px 10px;text-align:right;font-size:12px;">${fmt(l.valorVenda)}</td>
      <td style="padding:7px 10px;font-size:11px;color:#888;">${l.obs||''}</td>
    </tr>`).join('');
    if ($('logEstoqueInfo')) $('logEstoqueInfo').textContent = `${logs.length} registro${logs.length !== 1 ? 's' : ''} encontrado${logs.length !== 1 ? 's' : ''}.`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:#c0392b;">Erro: ${_escHtml(err.message)}</td></tr>`;
  }
}

// Busca por texto no estoque
if ($('estoqueFiltroTexto')) {
  let _estBuscaTimer = null;
  $('estoqueFiltroTexto').addEventListener('input', () => {
    clearTimeout(_estBuscaTimer);
    _estBuscaTimer = setTimeout(() => renderizarEstoque(), 300);
  });
  $('estoqueFiltroTexto').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.target.value = ''; renderizarEstoque(); }
  });
}
if ($('btnLimparBuscaEstoque')) {
  $('btnLimparBuscaEstoque').addEventListener('click', () => {
    const campo = $('estoqueFiltroTexto');
    if (campo) { campo.value = ''; campo.focus(); }
    renderizarEstoque();
  });
}

function normalizarNumeroCompraEstoque(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return '';
  return `CP-${digitos.slice(-4).padStart(4, '0')}`;
}

function exibirEstadoVinculoCompra(tipo, mensagem) {
  const bloco = document.querySelector('.estoque-compra-vinculo');
  const msg = $('estNumeroCompraMsg');
  if (bloco) {
    bloco.classList.toggle('vinculado', tipo === 'vinculado');
    bloco.classList.toggle('erro', tipo === 'erro');
  }
  if (msg) msg.textContent = mensagem || 'Digite 1, 2, 3 ou 0001; o prefixo CP e os zeros são adicionados automaticamente.';
}

function tipoEstoqueDaCompra(tipoCompra) {
  const mapa = {
    'Celular': 'Smartphone',
    'Computador': 'Computador Desktop'
  };
  return mapa[tipoCompra] || tipoCompra || 'Smartphone';
}

async function vincularCompraAoEstoque() {
  const campo = $('estNumeroCompra');
  const numero = normalizarNumeroCompraEstoque(campo?.value);
  if (!numero) {
    exibirEstadoVinculoCompra('erro', 'Informe o número da compra. Exemplo: 1 para CP-0001.');
    return { sucesso: false, numero: '' };
  }

  campo.value = numero.replace(/^CP-/, '');
  const duplicado = estoqueAtual.find(item => item.numeroCompra === numero && item.id !== itemEmEdicao?.id);
  if (duplicado) {
    exibirEstadoVinculoCompra('erro', `${numero} já está vinculada ao aparelho ${duplicado.id}.`);
    return { sucesso: false, numero };
  }

  let compra;
  try {
    compra = await window.api.compraobterpornumero(numero);
  } catch (erro) {
    exibirEstadoVinculoCompra('erro', `Não foi possível consultar ${numero}: ${erro.message}`);
    return { sucesso: false, numero };
  }
  if (!compra) {
    exibirEstadoVinculoCompra('erro', `${numero} não foi encontrada em Compras.`);
    return { sucesso: false, numero };
  }

  const aparelho = compra.aparelho || {};
  const dadosCompra = compra.dadosCompra || {};
  const tipoEquipamento = tipoEstoqueDaCompra(aparelho.tipo);
  $('estMarca').value = aparelho.marca || $('estMarca').value;
  $('estModelo').value = aparelho.modelo || $('estModelo').value;
  $('estCor').value = aparelho.cor || $('estCor').value;
  $('estImei').value = aparelho.imei1 || $('estImei').value;
  $('estTipoEquipamento').value = tipoEquipamento;
  renderCamposDinamicos(tipoEquipamento, 'camposDinamicosEstoque', 'es', {
    capacidade: aparelho.capacidade || ''
  });
  toggleCampoImei('campoEstImei', tipoEquipamento);
  toggleCamposPeca(tipoEquipamento);
  $('estValorPago').value = Number(dadosCompra.valor || 0) || '';
  $('estValorPecas').value = Number(dadosCompra.custoPecas || 0) || '';
  pecasUsadasEstoque = normalizarPecasUsadasFormulario(dadosCompra.pecasTrocar);
  renderizarPecasUsadasEstoque();
  if (compra.data) $('estDataEntrada').value = new Date(compra.data).toISOString().slice(0, 10);
  atualizarResumoFinanceiro();
  exibirEstadoVinculoCompra('vinculado', `${numero} vinculada: ${aparelho.marca || ''} ${aparelho.modelo || ''}. Valores sincronizados com Compras.`);
  return { sucesso: true, numero, compra };
}

function normalizarGarantiaVenda(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  return /^0(?:[.,]0+)?(?:\s*(?:dia(?:s)?|m[e\u00ea]s(?:es)?|ano(?:s)?))?$/i.test(texto)
    ? 'Sem garantia'
    : texto;
}

window.abrirModalEstoque = async (id, tipoPreset) => {
  itemEmEdicao = id ? await window.api.estoqueobter(id) : null;
  const item = itemEmEdicao;

  // O modal é reutilizado entre cadastros. Remova qualquer marca de uma
  // tentativa anterior antes de preencher o item atual; sem isso, um CPF
  // opcional já apagado continuava com a borda vermelha ao reabrir a Venda.
  limparErros(
    'estMarca', 'estModelo', 'estImei', 'estCompradorNome',
    'estCompradorTel', 'estCompradorCpf', 'estDataVenda',
    'estGarantia', 'estValorFinalVenda'
  );

  // Título
  const tipoParaTitulo = item?.tipoEquipamento || tipoPreset || 'Smartphone';
  const labelTipo = tipoParaTitulo === 'Peça / Componente' ? 'Peça / Componente' : 'Aparelho';
  $('tituloModalEstoque').textContent = item ? `Editar — ${item.id}` : `Novo ${labelTipo}`;

  // Dados
  $('estMarca').value = item?.marca || '';
  $('estModelo').value = item?.modelo || '';
  $('estCor').value = item?.cor || '';
  const tipoEqEst = item?.tipoEquipamento || tipoPreset || 'Smartphone';
  $('estTipoEquipamento').value = tipoEqEst;
  renderCamposDinamicos(tipoEqEst, 'camposDinamicosEstoque', 'es', item?.dadosEquipamento || {});
  toggleCampoImei('campoEstImei', tipoEqEst);
  toggleCamposPeca(tipoEqEst);
  // Se veio de preset (Nova Peça), força exibição dos campos
  if (!id && tipoPreset === 'Peça / Componente') {
    if ($('estTipoPeca')) $('estTipoPeca').value = '';
    if ($('estCompatibilidade')) $('estCompatibilidade').value = '';
    if ($('estQuantidade')) $('estQuantidade').value = 1;
    if ($('estCondicaoPeca')) $('estCondicaoPeca').value = 'Nova';
  }
  // Carregar campos de peça
  if ($('estTipoPeca')) $('estTipoPeca').value = item?.tipoPeca || '';
  if ($('estCompatibilidade')) $('estCompatibilidade').value = item?.compatibilidade || '';
  if ($('estQuantidade')) $('estQuantidade').value = item?.quantidade ?? 1;
  if ($('estCondicaoPeca')) $('estCondicaoPeca').value = item?.condicaoPeca || 'Nova';
  $('estImei').value = item?.imei || '';
  $('estObs').value = item?.observacoes || '';
  $('estStatus').value = item?.status || 'Em análise';
  $('estDataEntrada').value = (item?.dataEntrada || new Date().toISOString()).slice(0,10);
  $('estNumeroCompra').value = String(item?.numeroCompra || '').replace(/^CP-/, '');
  if (item?.numeroCompra) {
    exibirEstadoVinculoCompra('vinculado', `${item.numeroCompra} vinculada a este aparelho. Ao salvar, os dados da compra serão sincronizados novamente.`);
  } else {
    exibirEstadoVinculoCompra('', 'Digite 1, 2, 3 ou 0001; o prefixo CP e os zeros são adicionados automaticamente.');
  }

  // Financeiro
  $('estValorPago').value = item?.valorPago || '';
  $('estValorPecas').value = item?.valorGastoPecas || '';
  $('estGastosExtras').value = item?.gastosExtras || '';
  $('estValorVenda').value = item?.valorVenda || '';
  $('estPercentualLucro').value = item?.percentualLucro ?? '';
  pecasUsadasEstoque = normalizarPecasUsadasFormulario(item?.pecasUsadas);
  renderizarPecasUsadasEstoque();
  atualizarResumoFinanceiro();

  // Checklist
  const checklistPadrao = await window.api.estoquechecklistpadrao();
  checklistAtual = item?.checklist ? JSON.parse(JSON.stringify(item.checklist)) : JSON.parse(JSON.stringify(checklistPadrao));
  $('checklistData').value = item?.checklistData?.slice(0,10) || '';
  $('checklistResp').value = item?.checklistResponsavel || '';
  renderizarChecklist();

  // Fotos
  fotosAtuais = item?.fotos ? [...item.fotos] : [];
  renderizarGaleria();

  // Venda
  $('estCompradorNome').value = item?.compradorNome || '';
  $('estCompradorCpf').value = item?.compradorCpf || '';
  $('estCompradorTel').value = item?.compradorTelefone || '';
  // Restaurar checkbox "sem número" do comprador
  const estSemNum = item?.status === 'Vendido' && !item?.compradorTelefone;
  const estChk = $('estCompradorSemNumero');
  if (estChk) estChk.checked = estSemNum;
  const estTelEl = $('estCompradorTel');
  if (estTelEl) { estTelEl.disabled = estSemNum; estTelEl.style.opacity = estSemNum ? '0.4' : ''; estTelEl.placeholder = estSemNum ? 'Sem número' : '(00) 00000-0000'; }
  const estAst = $('estCompradorTelAsteristico');
  if (estAst) estAst.style.display = estSemNum ? 'none' : '';
  $('estDataVenda').value = item?.dataVenda?.slice(0,10) || '';
  const garantiaAtual = item?.garantia;
  $('estGarantia').value = garantiaAtual !== undefined && garantiaAtual !== null && String(garantiaAtual).trim() !== ''
    ? normalizarGarantiaVenda(garantiaAtual)
    : (configAtual.garantiaPadrao || '90 dias');
  $('estValorFinalVenda').value = item?.valorVenda || '';
  $('estTermosVenda').value = item?.termosVenda || '';
  if ($('estTermosVenda').value.trim()) atualizarIndicadorTermos('estTermosVenda', true);
  else aplicarTermosPadraoNoCampo('venda', 'estTermosVenda', true);

  // Botão PDF venda
  const acoesVenda = $('acoesVenda');
  acoesVenda.innerHTML = '';
  if (item?.pdfVendaPath) {
    const btn = document.createElement('button');
    btn.className = 'botao botao-sucesso';
    btn.textContent = 'Abrir PDF de Venda';
    btn.onclick = () => window.api.estoqueabrirpdfvenda(item.pdfVendaPath);
    acoesVenda.appendChild(btn);
  }
  if (item && item.status === 'Vendido') {
    const btn2 = document.createElement('button');
    btn2.className = 'botao botao-secundario';
    btn2.textContent = 'Gerar PDF de Venda novamente';
    btn2.onclick = async () => {
      const r = await window.api.estoquegerarpdfvenda(item.id);
      if (r.sucesso) { toast('PDF de venda gerado!','sucesso'); window.api.estoqueabrirpdfvenda(r.caminho); }
      else toast('Erro: '+r.erro,'erro');
    };
    acoesVenda.appendChild(btn2);

    const btnAssinatura = document.createElement('button');
    btnAssinatura.className = 'botao botao-secundario';
    btnAssinatura.innerHTML = `${ICONE_CELULAR} Enviar para assinatura no celular`;
    btnAssinatura.onclick = () => exportarParaAssinaturaCelular('venda', item.id);
    acoesVenda.appendChild(btnAssinatura);
    const valorServicoVenda = Number(item.valorServico || item.valorMaoDeObra || 0);
    if (window.fiscalSistemaOSHabilitado?.() === true && valorServicoVenda > 0) {
      const btnNotaFiscal = document.createElement('button');
      btnNotaFiscal.type = 'button';
      btnNotaFiscal.className = 'botao botao-secundario';
      btnNotaFiscal.textContent = 'Emitir NFS-e do serviço';
      btnNotaFiscal.onclick = () => window.emitirNotaFiscalSistemaOS?.('venda', item);
      acoesVenda.appendChild(btnNotaFiscal);
    }
  }

  // Sub-tab inicial
  ativarSubTab('dados');
  mostrarMsg('msgEstoque','','');
  $('btnExcluirEstoque').style.display = item ? '' : 'none';
  resetarBotaoFecharModal('modalEstoque');
  $('modalEstoque').classList.remove('escondido');
};

$('btnExcluirEstoque').addEventListener('click', async () => {
  if (!itemEmEdicao) return;
  if (!(await autorizarExclusaoProtegida(`a venda/registro ${itemEmEdicao.id}`))) return;
  const desc = [itemEmEdicao.marca, itemEmEdicao.modelo].filter(Boolean).join(' ') || `ID ${itemEmEdicao.id}`;
  const responsavel = (await promptModal(`Informe seu nome (responsável pela exclusão de "${desc}"):`, '', { titulo: ' Responsável pela exclusão' })) || 'não identificado';
  try {
    const r = await window.api.estoqueexcluir(itemEmEdicao.id, responsavel);
    if (r.cancelado) return;
    if (r.sucesso) {
      toast(`"${desc}" excluído com sucesso.`, 'sucesso');
      $('modalEstoque').classList.add('escondido');
      itemEmEdicao = null;
      carregarEstoque();
      carregarPainel();
    } else {
      toast('Erro ao excluir: ' + (r.erro || 'Erro desconhecido'), 'erro');
    }
  } catch(e) { toast('Erro ao excluir registro: ' + e.message, 'erro'); }
});

// Sub-tabs do modal estoque
document.querySelectorAll('.aba-interna').forEach(btn => {
  btn.addEventListener('click', () => ativarSubTab(btn.dataset.sub));
});

function ativarSubTab(nome) {
  document.querySelectorAll('.aba-interna').forEach(b => b.classList.toggle('ativa', b.dataset.sub === nome));
  document.querySelectorAll('.sub-secao').forEach(s => s.classList.add('escondido'));
  $('sub-'+nome).classList.remove('escondido');
}

// Resumo financeiro
['estValorPago','estValorPecas','estGastosExtras','estValorVenda'].forEach(id => {
  $(id).addEventListener('input', atualizarResumoFinanceiro);
});

function normalizarPecasUsadasFormulario(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, 100).map(peca => ({
    nome: String(peca?.nome || peca?.descricao || '').trim(),
    valor: Math.max(0, Number(peca?.valor) || 0)
  })).filter(peca => peca.nome || peca.valor > 0);
}

function totalPecasUsadasEstoque() {
  return pecasUsadasEstoque.reduce((total, peca) => total + (Math.max(0, Number(peca.valor)) || 0), 0);
}

function atualizarResumoPecasUsadasEstoque() {
  const resumo = $('estPecasUsadasResumo');
  if (!resumo) return;
  if (!pecasUsadasEstoque.length) {
    resumo.textContent = 'Nenhuma peça detalhada. O total financeiro ainda pode ser preenchido manualmente.';
    return;
  }
  const detalhado = totalPecasUsadasEstoque();
  const financeiro = Math.max(0, Number($('estValorPecas')?.value) || 0);
  const ajuste = Math.abs(detalhado - financeiro) > 0.009
    ? ` · total financeiro ajustado: ${fmtMoeda(financeiro)}`
    : '';
  resumo.textContent = `${pecasUsadasEstoque.length} peça${pecasUsadasEstoque.length === 1 ? '' : 's'} · soma detalhada: ${fmtMoeda(detalhado)}${ajuste}`;
}

function sincronizarTotalPecasUsadasEstoque() {
  const campoTotal = $('estValorPecas');
  if (campoTotal) campoTotal.value = totalPecasUsadasEstoque().toFixed(2);
  atualizarResumoFinanceiro();
}

function renderizarPecasUsadasEstoque() {
  const lista = $('estPecasUsadasLista');
  if (!lista) return;
  if (!pecasUsadasEstoque.length) {
    lista.innerHTML = '';
    atualizarResumoPecasUsadasEstoque();
    return;
  }
  lista.innerHTML = pecasUsadasEstoque.map((peca, indice) => `
    <div class="estoque-peca-usada-linha" data-indice="${indice}">
      <div class="campo">
        <label for="estPecaUsadaNome${indice}">Peça</label>
        <input id="estPecaUsadaNome${indice}" data-campo="nome" maxlength="160" value="${_escHtml(peca.nome)}" placeholder="Ex.: Tela" />
      </div>
      <div class="campo">
        <label for="estPecaUsadaValor${indice}">Valor</label>
        <input id="estPecaUsadaValor${indice}" data-campo="valor" type="number" min="0" step="0.01" value="${Number(peca.valor) || ''}" placeholder="0,00" />
      </div>
      <button type="button" class="botao botao-fantasma" data-remover-peca-usada="${indice}" aria-label="Remover ${_escHtml(peca.nome || 'peça')}">Remover</button>
    </div>`).join('');

  lista.querySelectorAll('input[data-campo]').forEach(campo => {
    campo.addEventListener('input', evento => {
      const linha = evento.target.closest('[data-indice]');
      const indice = Number(linha?.dataset.indice);
      if (!Number.isInteger(indice) || !pecasUsadasEstoque[indice]) return;
      if (evento.target.dataset.campo === 'valor') {
        pecasUsadasEstoque[indice].valor = Math.max(0, Number(evento.target.value) || 0);
        sincronizarTotalPecasUsadasEstoque();
      } else {
        pecasUsadasEstoque[indice].nome = evento.target.value;
        atualizarResumoPecasUsadasEstoque();
      }
    });
  });
  lista.querySelectorAll('[data-remover-peca-usada]').forEach(botao => {
    botao.addEventListener('click', () => {
      pecasUsadasEstoque.splice(Number(botao.dataset.removerPecaUsada), 1);
      renderizarPecasUsadasEstoque();
      sincronizarTotalPecasUsadasEstoque();
    });
  });
  atualizarResumoPecasUsadasEstoque();
}

if ($('btnAdicionarPecaUsadaEstoque')) {
  $('btnAdicionarPecaUsadaEstoque').addEventListener('click', () => {
    if (pecasUsadasEstoque.length >= 100) {
      toast('Limite de 100 peças por aparelho.', 'erro');
      return;
    }
    pecasUsadasEstoque.push({ nome: '', valor: 0 });
    renderizarPecasUsadasEstoque();
    $('estPecaUsadaNome' + (pecasUsadasEstoque.length - 1))?.focus();
  });
}

function atualizarResumoFinanceiro() {
  const pago = parseFloat($('estValorPago').value)||0;
  const pecas = parseFloat($('estValorPecas').value)||0;
  const extras = parseFloat($('estGastosExtras').value)||0;
  const venda = parseFloat($('estValorVenda').value)||0;
  const total = pago + pecas + extras;
  const lucro = venda - total;
  const lucroClass = lucro >= 0 ? 'resumo-linha lucro-pos' : 'resumo-linha lucro-neg';
  $('resumoFinanceiro').innerHTML = `
    <div class="resumo-linha"><span>Valor pago</span><span>${fmtMoeda(pago)}</span></div>
    <div class="resumo-linha"><span>Gastos com peças</span><span>${fmtMoeda(pecas)}</span></div>
    <div class="resumo-linha"><span>Gastos extras</span><span>${fmtMoeda(extras)}</span></div>
    <div class="resumo-linha"><span><strong>Total investido</strong></span><span><strong>${fmtMoeda(total)}</strong></span></div>
    <div class="resumo-linha"><span>Valor de venda</span><span>${fmtMoeda(venda)}</span></div>
    <div class="${lucroClass}"><span>Lucro estimado</span><span>${fmtMoeda(lucro)}</span></div>`;
  atualizarResumoPecasUsadasEstoque();
}

// Checklist
function renderizarChecklist() {
  $('listaChecklist').innerHTML = checklistAtual.map((item, idx) => `
    <div class="checklist-item ${item.ok?'ok':''}" onclick="toggleChecklist(${idx})">
      <input type="checkbox" ${item.ok?'checked':''} onclick="event.stopPropagation();toggleChecklist(${idx})" />
      <label>${item.label}</label>
    </div>`).join('');
}

window.toggleChecklist = idx => {
  checklistAtual[idx].ok = !checklistAtual[idx].ok;
  renderizarChecklist();
};

// Fotos
$('inputFotosEstoque').addEventListener('change', async e => {
  if (!itemEmEdicao) {
    toast('Salve o aparelho primeiro para adicionar fotos.', 'erro');
    return;
  }
  const vagas = Math.max(0, MAX_FOTOS_POR_DOCUMENTO - fotosAtuais.length);
  const selecionadas = Array.from(e.target.files);
  const files = selecionadas.slice(0, vagas);
  if (selecionadas.length > vagas) toast(`Limite de ${MAX_FOTOS_POR_DOCUMENTO} fotos. ${selecionadas.length - vagas} arquivo(s) não foram adicionado(s).`, 'aviso');
  for (const f of files) {
    try {
      const b64 = await new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(f); });
      const foto = await window.api.estoquesalvarfoto(itemEmEdicao.id, b64, f.name);
      if (foto?.erro) throw new Error(foto.erro);
      if (!foto?.duplicada) fotosAtuais.push(foto);
    } catch (err) {
      toast('Erro ao salvar foto: ' + err.message, 'erro');
    }
  }
  renderizarGaleria();
  e.target.value = '';
});

function renderizarGaleria() {
  $('galeriaFotos').innerHTML = fotosAtuais.map((f,i) => {
    // ETAPA 9: prioriza carregar do disco via file://; só cai para
    // o base64 antigo salvo no banco em registros legados que ainda
    // não tinham path (compatibilidade com cadastros anteriores).
    const src = f.path ? caminhoParaFileUrl(f.path) : (f.base64 || '');
    return `
    <div class="foto-thumb">
      <img src="${src}" alt="Foto ${i+1}" onerror="this.src=''" />
    </div>`;
  }).join('') || '<p style="color:var(--texto-sec);font-size:13px;">Nenhuma foto.</p>';
}

// ══════════════════════════════════════════
// ETAPA 8.7.2 — GALERIA DE FOTOS DA OS
// ══════════════════════════════════════════
const CATEGORIAS_FOTO_OS = [
  { id: 'defeito', label: 'Fotos do Defeito' },
  { id: 'entrada', label: 'Fotos da Entrada' },
  { id: 'reparo',  label: ' Fotos do Reparo' },
  { id: 'entrega', label: 'Fotos da Entrega' }
];

function renderizarGaleriaFotosOS() {
  const cont = $('galeriaFotosOS');
  if (!cont) return;
  // Usa path-first (file://) para fotos persistidas no disco; base64 só para
  // fotos recém-adicionadas nesta sessão (antes de recarregar a OS do banco).
  cont.innerHTML = CATEGORIAS_FOTO_OS.map(cat => {
    const fotos = editFotosOS.filter(f => f.categoria === cat.id);
    return `
      <div class="galeria-os-secao">
        <div class="galeria-os-secao-titulo">${cat.label} <span style="font-weight:400;color:var(--texto-sec);font-size:11px;">(${fotos.length})</span></div>
        <div class="galeria-fotos">
          ${fotos.map(f => {
            const src = f.path ? caminhoParaFileUrl(f.path) : (f.base64 || '');
            return `
            <div class="foto-thumb" data-foto-src="${src.replace(/"/g,'&quot;')}" onclick="abrirLightboxFoto(this.dataset.fotoSrc)">
              <img src="${src}" alt="Foto" onerror="this.src=''" />
              <div class="foto-thumb-cat">${cat.id}</div>
              <button class="foto-thumb-replace" title="Substituir" onclick="event.stopPropagation();substituirFotoOSClick('${f.id}')"></button>
              <button class="foto-thumb-remove" title="Excluir" onclick="event.stopPropagation();excluirFotoOSClick('${f.id}')"></button>
            </div>`;
          }).join('') || '<p style="color:var(--texto-sec);font-size:12.5px;">Nenhuma foto nesta categoria.</p>'}
        </div>
      </div>`;
  }).join('');
}

async function arquivoParaBase64(file) {
  return new Promise(res => { const r = new FileReader(); r.onload = ev => res(ev.target.result); r.readAsDataURL(file); });
}

[
  ['inputFotoDefeito','defeito'], ['inputFotoEntrada','entrada'],
  ['inputFotoReparo','reparo'], ['inputFotoEntrega','entrega']
].forEach(([inputId, categoria]) => {
  const el = $(inputId);
  if (!el) return;
  el.addEventListener('change', async e => {
    if (!osEmEdicao) { toast('Salve a OS primeiro para adicionar fotos.', 'erro'); return; }
    const atuaisDaCategoria = editFotosOS.filter(f => f.categoria === categoria).length;
    const vagas = Math.max(0, MAX_FOTOS_POR_DOCUMENTO - atuaisDaCategoria);
    const selecionadas = Array.from(e.target.files);
    const files = selecionadas.slice(0, vagas);
    if (selecionadas.length > vagas) toast(`Limite de ${MAX_FOTOS_POR_DOCUMENTO} fotos por categoria. ${selecionadas.length - vagas} arquivo(s) não foram adicionado(s).`, 'aviso');
    for (const f of files) {
      const b64 = await arquivoParaBase64(f);
      try {
        const foto = await window.api.ossalvarfoto(osEmEdicao.numero, categoria, b64, f.name);
        if (!foto.duplicada) editFotosOS.push(foto);
        else toast('Esta foto já estava salva e não foi duplicada.', 'aviso');
      } catch (err) { toast('Erro ao salvar foto: ' + err.message, 'erro'); }
    }
    renderizarGaleriaFotosOS();
    e.target.value = '';
  });
});

window.excluirFotoOSClick = async (fotoId) => {
  if (!osEmEdicao) return;
  if (!confirm('Excluir esta foto?')) return;
  try {
    const r = await window.api.osexcluirfoto(osEmEdicao.numero, fotoId);
    if (r && r.sucesso) {
      editFotosOS = editFotosOS.filter(f => f.id !== fotoId);
      renderizarGaleriaFotosOS();
      toast('Foto excluída.', 'sucesso');
    } else {
      toast('Erro ao excluir foto: ' + (r && r.erro || 'erro desconhecido'), 'erro');
    }
  } catch (err) { toast('Erro ao excluir foto: ' + err.message, 'erro'); }
};

window.substituirFotoOSClick = (fotoId) => {
  if (!osEmEdicao) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    const b64 = await arquivoParaBase64(f);
    try {
      const novaFoto = await window.api.ossubstituirfoto(osEmEdicao.numero, fotoId, b64, f.name);
      const idx = editFotosOS.findIndex(x => x.id === fotoId);
      if (idx !== -1) editFotosOS[idx] = novaFoto; else editFotosOS.push(novaFoto);
      renderizarGaleriaFotosOS();
      toast('Foto substituída.', 'sucesso');
    } catch (err) { toast('Erro ao substituir foto: ' + err.message, 'erro'); }
  };
  input.click();
};

window.abrirLightboxFoto = (src) => {
  if (!src) return;
  $('lightboxImg').src = src;
  $('lightboxFoto').classList.remove('escondido');
};
function fecharLightboxFoto() { $('lightboxFoto').classList.add('escondido'); $('lightboxImg').src = ''; }
if ($('btnFecharLightbox')) $('btnFecharLightbox').addEventListener('click', fecharLightboxFoto);
if ($('lightboxFoto')) $('lightboxFoto').addEventListener('click', e => { if (e.target.id === 'lightboxFoto') fecharLightboxFoto(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharLightboxFoto(); });
window.abrirLightboxFoto = window.abrirLightboxFoto; // exposto para uso em verDetalheOS
window._carregarComprovanteNoDetalhe = _carregarComprovanteNoDetalhe; // usado em botões de substituição inline

// ─── App Celular — Entregas: indicador na tela de detalhe da OS ──────────
// Ver PROMPT-PC-aba-entregas.md, item 3. Mesmo espírito de
// _carregarComprovanteNoDetalhe logo acima: carrega assíncrono para não
// bloquear a abertura do modal, e a seção fica vazia (sem "nenhum
// comprovante") quando a OS não tem entrega vinculada — só aparece quando
// há algo para mostrar.
async function _carregarEntregaNoDetalhe(osNumero) {
  const secao = document.getElementById('detalheEntregaSecao');
  // A div só existe no HTML de verDetalheOS (fluxo principal) — em
  // mostrarDetalheOS (aba Autorizadas) ela não existe, e é esperado sair
  // aqui silenciosamente, igual ao comprovante de pagamento.
  if (!secao) return;

  try {
    const en = await window.api.entregaobterporos(osNumero);

    // Sem comprovante vinculado a esta OS — sem mensagem de estado vazio,
    // o indicador simplesmente não aparece (mesmo critério do prompt).
    if (!en) { secao.innerHTML = ''; return; }

    const esc = window._escapeHtmlEntregas;
    const nomeRetirouEsc = esc(en.nomeRetirou) || '—';
    const dataAssinaturaFmt = fmtDataHora(en.dataHoraAssinatura);
    // Mesmo critério de omissão condicional já usado na aba Entregas e no
    // PDF: só mostra garantia se garantiaDias > 0. Comprovante antigo (sem
    // o campo) ou garantiaDias:0 não mostra nada — não "Garantia: 0 dias".
    const dias = Number(en.garantiaDias) || 0;
    const linhaGarantia = dias > 0
      ? `<div class="detalhe-campo" style="margin-top:8px;">
           <span class="rot">Garantia</span>
           <span class="val">${ICONE_ESCUDO} ${dias} dias — válida até ${en.dataLimiteGarantia ? window._fmtDataSimplesEntregas(en.dataLimiteGarantia) : '—'}</span>
         </div>`
      : '';

    secao.innerHTML = `
      <div class="detalhe-secao" style="border-left:3px solid var(--primario);padding-left:12px;">
        <div class="detalhe-titulo">${ICONE_CANETA} Comprovante de Entrega</div>
        <div class="detalhe-grade">
          <div class="detalhe-campo"><span class="rot">Retirado por</span><span class="val">${nomeRetirouEsc}</span></div>
          <div class="detalhe-campo"><span class="rot">Data/hora da assinatura</span><span class="val">${dataAssinaturaFmt}</span></div>
        </div>
        ${linhaGarantia}
        <button class="botao botao-fantasma" style="margin-top:10px;font-size:12px;padding:4px 10px;" onclick="abrirPdfEntregaUI('${esc(en.numeroOS)}')">${ICONE_DOCUMENTO} ${en.pdfPath ? 'Ver comprovante de entrega' : 'Gerar/ver comprovante de entrega'}</button>
      </div>`;
  } catch (err) {
    // Falha ao buscar não deve travar o resto do modal — só some a seção,
    // mesmo espírito do "sem comprovante" acima (não é informação crítica
    // o suficiente para interromper a visualização da OS).
    console.error('Erro ao carregar comprovante de entrega no detalhe da OS:', err);
    secao.innerHTML = '';
  }
}
window._carregarEntregaNoDetalhe = _carregarEntregaNoDetalhe;



$('btnCalcularSugestao').addEventListener('click', () => {
  const investido = (parseFloat($('estValorPago').value)||0) + (parseFloat($('estValorPecas').value)||0) + (parseFloat($('estGastosExtras').value)||0);
  const pct = parseFloat($('estPercentualLucro').value);
  const pctUsar = isNaN(pct) ? (configAtual.percentualLucroPadrao ?? 30) : pct;
  const sugerido = investido * (1 + pctUsar / 100);
  $('estValorVenda').value = sugerido.toFixed(2);
  atualizarResumoFinanceiro();
  toast(`Preço sugerido: ${fmtMoeda(sugerido)}`, 'sucesso');
});

// Salvar estoque
// Checkbox "sem número" — Estoque → Venda
if ($('estCompradorSemNumero')) {
  $('estCompradorSemNumero').addEventListener('change', () => {
    const marcado = $('estCompradorSemNumero').checked;
    const telEl   = $('estCompradorTel');
    const ast     = $('estCompradorTelAsteristico');
    if (telEl) { telEl.disabled = marcado; telEl.value = marcado ? '' : telEl.value; telEl.style.opacity = marcado ? '0.4' : ''; telEl.placeholder = marcado ? 'Sem número' : '(00) 00000-0000'; }
    if (ast) ast.style.display = marcado ? 'none' : '';
  });
}

if ($('estNumeroCompra')) {
  $('estNumeroCompra').addEventListener('input', evento => {
    evento.target.value = evento.target.value.replace(/\D/g, '').slice(0, 4);
    exibirEstadoVinculoCompra('', 'Clique em “Vincular compra” para localizar e preencher os dados.');
  });
  $('estNumeroCompra').addEventListener('blur', evento => {
    const numero = normalizarNumeroCompraEstoque(evento.target.value);
    evento.target.value = numero ? numero.replace(/^CP-/, '') : '';
  });
  $('estNumeroCompra').addEventListener('keydown', evento => {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      vincularCompraAoEstoque();
    }
  });
}

// Assim que o usuário volta a digitar, o destaque antigo deixa de competir
// com o valor que está sendo corrigido. A validação completa continua no
// Salvar e CPF vazio permanece válido por ser opcional.
[
  'estMarca', 'estModelo', 'estImei', 'estCompradorNome',
  'estCompradorTel', 'estCompradorCpf', 'estDataVenda',
  'estGarantia', 'estValorFinalVenda'
].forEach(id => {
  const campo = $(id);
  if (campo) campo.addEventListener('input', () => limparErro(id));
});

if ($('btnVincularCompraEstoque')) {
  $('btnVincularCompraEstoque').addEventListener('click', vincularCompraAoEstoque);
}

$('btnSalvarEstoque').addEventListener('click', async () => {
  let numeroCompra = '';
  if ($('estNumeroCompra')?.value.trim()) {
    const vinculo = await vincularCompraAoEstoque();
    if (!vinculo.sucesso) {
      mostrarMsg('msgEstoque', 'Corrija o vínculo com a compra antes de salvar.', 'erro');
      document.querySelector('.aba-interna[data-sub="dados"]')?.click();
      return;
    }
    numeroCompra = vinculo.numero;
  }
  const marca = $('estMarca').value.trim();
  const modelo = $('estModelo').value.trim();
  const imei = $('estImei').value.trim();
  const compradorCpf = $('estCompradorCpf').value.trim();

  limparErros('estMarca','estModelo','estImei','estCompradorNome','estCompradorTel','estCompradorCpf','estDataVenda','estGarantia','estValorFinalVenda');

  let valido = true;
  if (!marca) { marcarErro('estMarca', 'Marca é obrigatória.'); valido = false; }
  if (!modelo) { marcarErro('estModelo', 'Modelo é obrigatório.'); valido = false; }
  if (imei && !validarIMEI(imei)) { marcarErro('estImei', 'IMEI inválido (deve ter 15 dígitos).'); valido = false; }
  if (compradorCpf && !validarCPF(compradorCpf)) { marcarErro('estCompradorCpf', 'CPF inválido.'); valido = false; }
  if (!valido) {
    mostrarMsg('msgEstoque', 'Revise o primeiro campo indicado abaixo.', 'erro');
    mostrarPrimeiroCampoInvalido(['estMarca','estModelo','estImei','estCompradorCpf'], 'Campo que precisa ser corrigido');
    return;
  }

  const novoStatus = $('estStatus').value;
  const statusAtual = itemEmEdicao?.status;

  // Validação dos campos obrigatórios da Venda de Aparelhos
  if (novoStatus === 'Vendido') {
    const compradorNome = $('estCompradorNome').value.trim();
    const compradorTel = $('estCompradorTel').value.trim();
    const estSemNumero = $('estCompradorSemNumero')?.checked;
    const dataVendaVal = $('estDataVenda').value;
    const garantiaVal = normalizarGarantiaVenda($('estGarantia').value);
    $('estGarantia').value = garantiaVal;
    const valorFinalVal = parseFloat($('estValorFinalVenda').value) || parseFloat($('estValorVenda').value) || 0;
    let vendaValida = true;
    if (!compradorNome) { marcarErro('estCompradorNome', 'Nome do comprador é obrigatório.'); vendaValida = false; }
    if (!compradorTel && !estSemNumero) { marcarErro('estCompradorTel', 'Informe o telefone ou marque "Comprador não tem número".'); vendaValida = false; }
    if (!valorFinalVal) { marcarErro('estValorFinalVenda', 'Valor de venda é obrigatório.'); vendaValida = false; }
    if (!dataVendaVal) { marcarErro('estDataVenda', 'Data da venda é obrigatória.'); vendaValida = false; }
    if (!garantiaVal) { marcarErro('estGarantia', 'Garantia é obrigatória.'); vendaValida = false; }
    if (!vendaValida) {
      mostrarMsg('msgEstoque', 'Revise o primeiro campo obrigatório indicado na aba Venda.', 'erro');
      document.querySelector('.aba-interna[data-sub="venda"]')?.click();
      mostrarPrimeiroCampoInvalido(
        ['estCompradorNome','estCompradorTel','estValorFinalVenda','estDataVenda','estGarantia'],
        'Campo obrigatório da venda'
      );
      return;
    }
  }

  // Se mudou para "Pronto para venda", perguntar valor de venda
  if (novoStatus === 'Pronto para venda' && statusAtual !== 'Pronto para venda') {
    const valorInput = await promptModal('Qual será o valor de venda deste aparelho? (Ex: 850.00)', '', { titulo: 'Valor de venda' });
    if (valorInput !== null && valorInput.trim() !== '') {
      $('estValorVenda').value = parseFloat(valorInput.replace(',','.')) || 0;
      atualizarResumoFinanceiro();
    }
  }

  const dados = {
    marca, modelo,
    numeroCompra,
    tipoEquipamento: $('estTipoEquipamento').value,
    dadosEquipamento: coletarDadosEquipamento('es', $('estTipoEquipamento').value),
    cor: $('estCor').value.trim(),
    imei: $('estImei').value.trim(),
    observacoes: $('estObs').value.trim(),
    status: novoStatus,
    dataEntrada: $('estDataEntrada').value || new Date().toISOString().slice(0,10),
    valorPago: parseFloat($('estValorPago').value)||0,
    valorGastoPecas: parseFloat($('estValorPecas').value)||0,
    pecasUsadas: normalizarPecasUsadasFormulario(pecasUsadasEstoque),
    gastosExtras: parseFloat($('estGastosExtras').value)||0,
    valorVenda: parseFloat($('estValorVenda').value)||0,
    percentualLucro: $('estPercentualLucro').value !== '' ? parseFloat($('estPercentualLucro').value) : null,
    checklist: checklistAtual,
    checklistData: $('checklistData').value || null,
    checklistResponsavel: $('checklistResp').value.trim(),
    compradorNome: $('estCompradorNome').value.trim(),
    compradorCpf: $('estCompradorCpf').value.trim(),
    compradorTelefone: $('estCompradorSemNumero')?.checked ? '' : $('estCompradorTel').value.trim(),
    dataVenda: $('estDataVenda').value || null,
    garantia: normalizarGarantiaVenda($('estGarantia').value),
    termosVenda: $('estTermosVenda').value.trim(),
    // Envia apenas os campos persistíveis (sem base64) para o servidor.
    // base64 fica só em memória para preview; o banco guarda só path+nome.
    fotos: fotosAtuais.map(({ id, path, nome, data }) => ({ id, path, nome, data })),
    // Campos de Peça / Componente
    tipoPeca: $('estTipoPeca') ? $('estTipoPeca').value : '',
    compatibilidade: $('estCompatibilidade') ? $('estCompatibilidade').value.trim() : '',
    quantidade: $('estQuantidade') ? parseInt($('estQuantidade').value) || 1 : 1,
    condicaoPeca: $('estCondicaoPeca') ? $('estCondicaoPeca').value : 'Nova',
  };

  // Se o status for Vendido, usa valor final de venda
  if (novoStatus === 'Vendido') {
    const vf = parseFloat($('estValorFinalVenda').value);
    if (vf) dados.valorVenda = vf;
    if (!dados.dataVenda) dados.dataVenda = new Date().toISOString().slice(0,10);
  }

  $('btnSalvarEstoque').disabled = true;
  try {
    let itemSalvo;
    if (itemEmEdicao) {
      itemSalvo = await window.api.estoqueatualizar(itemEmEdicao.id, dados);
    } else {
      itemSalvo = await window.api.estoquecriar(dados);
    }

    // Gerar PDF de venda se status mudou para Vendido
    if (novoStatus === 'Vendido' && statusAtual !== 'Vendido') {
      try {
        const r = await window.api.estoquegerarpdfvenda(itemSalvo.id);
        if (r.sucesso) {
          toast('Aparelho vendido! PDF gerado.', 'sucesso');
          window.api.estoqueabrirpdfvenda(r.caminho);
        }
      } catch(e) { console.error('PDF venda:', e); }
    }

    toast('Aparelho salvo!', 'sucesso');
    marcarModalComoSalvo('modalEstoque');
    carregarEstoque();
    carregarPainel(); // atualiza os cards financeiros dentro do Dashboard de Estoque, se estiver renderizado
  } catch(err) {
    mostrarMsg('msgEstoque','Erro: '+err.message,'erro');
  } finally {
    $('btnSalvarEstoque').disabled = false;
  }
});

// ══════════════════════════════════════════
// PAINEL
// ══════════════════════════════════════════
// ══════════════════════════════════════════
// ABA RELATÓRIOS — ETAPA 8.6
// ══════════════════════════════════════════
const ICONE_REL = {
  'Smartphone':'','Tablet':'','Notebook':'','Computador Desktop':'️',
  'All In One':'️','Monitor':'️','Impressora':'️','Videogame':'','Outro':''
};
const STATUS_COR = {
  'Aguardando análise':'#6b7280','Em diagnóstico':'#b45309',
  'Aguardando aprovação':'#7c3aed','Aguardando peça':'#be185d','Em reparo':'#1d4ed8',
  'Em testes':'#0369a1','Pronto para retirada':'#15803d',
  'Aguardando Pagamento':'#d97706','Pago 50%':'#d97706','Pago':'#059669','Autorizado':'#059669',
  'Pendente':'#6b7280','Aprovado':'#059669','Desaprovado':'#b91c1c',
  'Entregue':'#15803d','Cancelado':'#b91c1c'
};
const STATUS_ICONE = {
  'Aguardando análise':`${ICONE_RELOGIO}`,'Em diagnóstico':`${ICONE_FERRAMENTA}`,'Aguardando aprovação':`${ICONE_DOCUMENTO}`,
  'Aguardando peça':`${ICONE_CAIXA}`,'Em reparo':`${ICONE_CONFIG}`,'Em testes':`${ICONE_BUSCAR}`,'Pronto para retirada':`${ICONE_CHECK}`,
  'Aguardando Pagamento':`${ICONE_CARTAO}`,'Pago 50%':`${ICONE_CARTAO}`,'Pago':`${ICONE_CHECK}`,'Autorizado':`${ICONE_CHECK}`,
  'Pendente':`${ICONE_RELOGIO}`,'Aprovado':`${ICONE_CHECK}`,'Desaprovado':`${ICONE_X}`,'Entregue':`${ICONE_CELULAR}`,'Cancelado':`${ICONE_X}`
};

function renderBarraHoriz(label, count, maxVal, cor, icone) {
  const pct = maxVal > 0 ? Math.round((count/maxVal)*100) : 0;
  return `<div style="margin-bottom:10px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
      <span style="font-size:12px;color:var(--texto);">${icone ? icone+' ' : ''}${label}</span>
      <span style="font-size:12px;font-weight:700;color:${cor||'var(--primario)'};">${count}</span>
    </div>
    <div style="background:var(--borda);border-radius:4px;height:8px;">
      <div style="width:${pct}%;background:${cor||'var(--primario)'};height:8px;border-radius:4px;transition:width .4s;min-width:${count>0?2:0}px;"></div>
    </div>
  </div>`;
}

// ── ETAPA 9-B — Verificação de tamanho do database.json ───────
async function verificarTamanhoBanco() {
  const el = $('alertaTamanhoBanco');
  if (!el || !window.api.dbverificartamanho) return;
  try {
    const info = await window.api.dbverificartamanho();
    if (info && info.alerta) {
      el.innerHTML = `<strong>O arquivo de dados está grande (${info.tamanhoMB} MB, limite recomendado: ${info.limiteMB} MB).</strong>
        Isso pode deixar o sistema mais lento ao abrir. Considere arquivar OS antigas (exportar e remover as mais antigas do sistema) para reduzir o tamanho.`;
      el.classList.remove('escondido');
    } else {
      el.classList.add('escondido');
    }
  } catch (e) {
    console.error('Erro ao verificar tamanho do banco:', e);
  }
}

// ══════════════════════════════════════════
// ABA RELATÓRIOS — filtro de período
// ══════════════════════════════════════════
let _relFiltroPeriodoAtivo = '6meses'; // padrão: comportamento antigo (últimos 6 meses)
let _relPersonalizadoInicio = null;
let _relPersonalizadoFim = null;

// Converte a opção de chip selecionada em { dataInicio, dataFim } (strings 'YYYY-MM-DD')
// ou null quando a opção é "últimos 6 meses" (sem filtro — mantém comportamento original).
function _relCalcularIntervaloPeriodo(opcao) {
  const hoje = new Date();
  const fmtISO = (d) => {
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  };
  if (opcao === 'hoje') {
    const s = fmtISO(hoje);
    return { dataInicio: s, dataFim: s, label: 'Hoje' };
  }
  if (opcao === 'ontem') {
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    const s = fmtISO(ontem);
    return { dataInicio: s, dataFim: s, label: 'Ontem' };
  }
  if (opcao === 'semana') {
    // Semana corrente: domingo até hoje
    const domingo = new Date(hoje); domingo.setDate(hoje.getDate() - hoje.getDay());
    return { dataInicio: fmtISO(domingo), dataFim: fmtISO(hoje), label: 'Esta Semana' };
  }
  if (opcao === 'mes') {
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return { dataInicio: fmtISO(primeiroDia), dataFim: fmtISO(hoje), label: 'Este Mês' };
  }
  if (opcao === 'personalizado') {
    if (!_relPersonalizadoInicio || !_relPersonalizadoFim) return null; // ainda não aplicado
    return { dataInicio: _relPersonalizadoInicio, dataFim: _relPersonalizadoFim, label: 'Personalizado' };
  }
  return null; // '6meses' — sem filtro, mesmo comportamento de antes
}

function _relFormatarDataBR(iso) {
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

async function carregarRelatorios() {
  let statsOS, statsEst, statsFinMes;
  const intervalo = _relCalcularIntervaloPeriodo(_relFiltroPeriodoAtivo);
  try {
    const agoraFinanceiro = new Date();
    [statsOS, statsEst, statsFinMes] = await Promise.all([
      window.api.osstatistics(intervalo ? { dataInicio: intervalo.dataInicio, dataFim: intervalo.dataFim } : undefined),
      window.api.estoquestats(),
      typeof window.api?.financeirorelatorio === 'function'
        ? window.api.financeirorelatorio(intervalo
          ? { dataInicio: intervalo.dataInicio, dataFim: intervalo.dataFim }
          : { mes: agoraFinanceiro.getMonth() + 1, ano: agoraFinanceiro.getFullYear() }).catch(() => null)
        : Promise.resolve(null)
    ]);
  } catch (e) {
    console.error('Erro ao carregar relatórios:', e);
    return;
  }

  // Resumo textual do período aplicado (ou vazio quando é o padrão de 6 meses)
  const elResumo = $('relPeriodoResumo');
  if (elResumo) {
    if (intervalo) {
      const mesmaData = intervalo.dataInicio === intervalo.dataFim;
      elResumo.textContent = mesmaData
        ? `Exibindo dados de ${_relFormatarDataBR(intervalo.dataInicio)} · ${statsOS.totalOS} OS no período`
        : `Exibindo dados de ${_relFormatarDataBR(intervalo.dataInicio)} até ${_relFormatarDataBR(intervalo.dataFim)} · ${statsOS.totalOS} OS no período`;
    } else {
      elResumo.textContent = '';
    }
  }
  // Ajusta título dos gráficos que dependem de "mês" pra deixar claro quando é período curto
  const tituloMeses = $('relTituloGraficoMeses');
  const tituloReceita = $('relTituloGraficoReceita');
  if (tituloMeses) tituloMeses.textContent = intervalo ? `OS no Período — Recebidas vs Finalizadas` : 'OS por Mês — Recebidas vs Finalizadas';
  if (tituloReceita) tituloReceita.innerHTML = intervalo ? `${ICONE_CIFRAO} Receita no Período — Pagamentos Confirmados (OS)` : `${ICONE_CIFRAO} Receita Mensal — Pagamentos Confirmados (OS)`;

  // ── ETAPA 9-B — Alerta de tamanho do database.json ─────────
  verificarTamanhoBanco();

  // ── ETAPA 8.7.3 — Painel Operacional ──────────────────────
  const painelOp = [
    { label: 'OS em Aberto',       valor: statsOS.emAberto,       classe: '' },
    { label: 'OS em Reparo',       valor: statsOS.emReparo,       classe: '' },
    { label: 'Aguardando Peça',    valor: statsOS.aguardandoPeca, classe: 'laranja' },
    { label: 'OS Prontas',         valor: statsOS.prontas,        classe: 'verde' },
    { label: 'OS Entregues',       valor: statsOS.entregues,      classe: 'verde' },
    { label: 'OS Atrasadas',       valor: statsOS.atrasadas,      classe: 'vermelho' }
  ];
  $('relPainelOperacional').innerHTML = painelOp.map(c => `
    <div class="painel-card ${c.classe}">
      <div class="valor">${c.valor}</div>
      <div class="label">${c.label}</div>
    </div>`).join('');

  // ── Cards resumo ──────────────────────────────────────────
  const cards = [
    { label: 'Recebido em OS', valor: fmtMoeda(statsFinMes?.entradas?.servicos || 0), classe: 'verde', ajuda: 'Dinheiro confirmado, após reembolsos' },
    { label: 'Custos das OS', valor: fmtMoeda(statsFinMes?.saidas?.custoServicos || 0), classe: '', ajuda: 'Peças e custos diretos reconhecidos' },
    { label: 'Lucro em reparos', valor: fmtMoeda(statsFinMes?.resultado?.lucroServicos || 0), classe: (statsFinMes?.resultado?.lucroServicos || 0) >= 0 ? 'verde' : 'vermelho', ajuda: 'Recebido em OS menos custos das OS' },
    { label: 'Lucro em aparelhos', valor: fmtMoeda(statsFinMes?.resultado?.lucroVendas ?? statsEst.lucroTotal), classe: (statsFinMes?.resultado?.lucroVendas ?? statsEst.lucroTotal) >= 0 ? 'verde' : 'vermelho', ajuda: 'Venda menos aquisição, peças e extras' },
    { label: 'Lucro total', valor: fmtMoeda(statsFinMes?.resultado?.lucroTotal || 0), classe: (statsFinMes?.resultado?.lucroTotal || 0) >= 0 ? 'verde' : 'vermelho', ajuda: 'Lucro em reparos + lucro em aparelhos' },
    { label: 'A receber', valor: fmtMoeda(statsFinMes?.aReceber?.total || 0), classe: 'laranja', ajuda: `${statsFinMes?.aReceber?.qtd || 0} OS com saldo pendente` }
  ];
  $('relCards').innerHTML = cards.map(c => `
    <div class="painel-card ${c.classe}">
      <div class="valor">${c.valor}</div>
      <div class="label">${c.label}</div>
      <div style="margin-top:5px;font-size:11px;color:var(--texto-sec);line-height:1.35;">${c.ajuda || ''}</div>
    </div>`).join('');

  // ── OS por Tipo de Equipamento ────────────────────────────
  const TIPOS_ORDER = ['Smartphone','Tablet','Notebook','Computador Desktop','All In One','Monitor','Impressora','Videogame','Outro'];
  const tiposComOS = TIPOS_ORDER.filter(t => (statsOS.porTipo[t]||0) > 0);
  const maxTipo = Math.max(...TIPOS_ORDER.map(t => statsOS.porTipo[t]||0), 1);
  $('relGraficoTipo').innerHTML = tiposComOS.length
    ? tiposComOS.map(t => renderBarraHoriz(t, statsOS.porTipo[t]||0, maxTipo, 'var(--primario)', ICONE_REL[t])).join('')
    : '<p style="color:var(--texto-sec);font-size:13px;padding:8px 0;">Nenhuma OS registrada.</p>';

  // ── OS por Status ─────────────────────────────────────────
  const statusEntries = Object.entries(statsOS.porStatus).filter(([,c]) => c > 0).sort((a,b) => b[1]-a[1]);
  const maxStatus = Math.max(...statusEntries.map(([,c]) => c), 1);
  $('relGraficoStatus').innerHTML = statusEntries.length
    ? statusEntries.map(([st,count]) => renderBarraHoriz(st, count, maxStatus, STATUS_COR[st]||'var(--primario)', STATUS_ICONE[st]||'•')).join('')
    : '<p style="color:var(--texto-sec);font-size:13px;padding:8px 0;">Nenhuma OS registrada.</p>';

  // ── Gráfico Mensal OS ─────────────────────────────────────
  const meses = statsOS.meses || {};
  const mesesKeys = Object.keys(meses);
  const maxMes = Math.max(...mesesKeys.map(m => Math.max(meses[m].recebidas||0, meses[m].finalizadas||0)), 1);
  $('relGraficoMeses').innerHTML = `
    <div style="display:flex;gap:4px;align-items:flex-end;height:130px;padding-top:10px;overflow-x:auto;">
      ${mesesKeys.map(m => {
        const rec = meses[m].recebidas||0;
        const fin = meses[m].finalizadas||0;
        const hR = Math.max(Math.round((rec/maxMes)*100), rec>0?3:0);
        const hF = Math.max(Math.round((fin/maxMes)*100), fin>0?3:0);
        const [ano, mesN] = m.split('-');
        const nomeMes = new Date(ano, parseInt(mesN)-1).toLocaleDateString('pt-BR',{month:'short'});
        return `<div class="barra-grupo">
          <div class="barra-wrap">
            <div class="barra compra" style="height:${hR}px;" title="Recebidas: ${rec}"></div>
            <div class="barra" style="height:${hF}px;background:var(--sucesso);" title="Finalizadas: ${fin}"></div>
          </div>
          <div class="barra-mes">${nomeMes}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;">
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:var(--primario);display:inline-block;border-radius:2px;"></span>Recebidas</span>
      <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:var(--sucesso);display:inline-block;border-radius:2px;"></span>Finalizadas</span>
    </div>`;

  // ── Top Marcas ────────────────────────────────────────────
  const marcas = statsOS.topMarcas || [];
  const medalhas = ['1.','2.','3.'];
  const maxMarca = marcas[0]?.total || 1;
  $('relTopMarcas').innerHTML = marcas.length
    ? marcas.map((m, i) => `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
            <span style="font-size:13px;color:var(--texto);font-weight:${i<3?700:400};">${medalhas[i]||'  '} ${m.nome}</span>
            <span style="font-size:12px;font-weight:700;color:var(--primario);">${m.total}</span>
          </div>
          <div style="background:var(--borda);border-radius:4px;height:8px;">
            <div style="width:${Math.round((m.total/maxMarca)*100)}%;background:var(--primario);height:8px;border-radius:4px;"></div>
          </div>
        </div>`).join('')
    : '<p style="color:var(--texto-sec);font-size:13px;padding:8px 0;">Nenhuma marca registrada.</p>';

  // ── Gráfico de Receita Mensal (Pagamentos OS) ──────────────
  if ($('relGraficoReceita')) {
    const receitaMeses = statsOS.receitaMeses || {};
    const mesesRecKeys = Object.keys(receitaMeses);
    const maxReceita = Math.max(...mesesRecKeys.map(m => receitaMeses[m] || 0), 1);
    const fmtMes = m => { const [a,mn] = m.split('-'); return new Date(a, parseInt(mn)-1).toLocaleDateString('pt-BR',{month:'short'}); };
    const receitaHtml = mesesRecKeys.map(m => {
      const val = receitaMeses[m] || 0;
      const h = Math.max(Math.round((val/maxReceita)*100), val>0?4:0);
      const valFmt = val.toLocaleString('pt-BR',{minimumFractionDigits:2});
      return '<div class="barra-grupo" style="min-width:44px;">' +
        '<div class="barra-wrap" style="justify-content:center;">' +
          '<div class="barra" style="height:'+h+'px;background:var(--sucesso);min-width:24px;border-radius:4px 4px 0 0;" title="R$ '+valFmt+'"></div>' +
        '</div>' +
        '<div class="barra-mes" style="font-size:10px;">'+fmtMes(m)+'</div>' +
      '</div>';
    }).join('');
    $('relGraficoReceita').innerHTML = mesesRecKeys.length
      ? '<div style="display:flex;gap:4px;align-items:flex-end;height:130px;padding-top:10px;overflow-x:auto;">' + receitaHtml + '</div>' +
        '<div style="display:flex;gap:16px;margin-top:10px;font-size:12px;">' +
          '<span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:var(--sucesso);display:inline-block;border-radius:2px;"></span>Receita</span>' +
          '<span style="color:var(--texto-sec);">Total: <strong>' + fmtMoeda(statsOS.totalPago || 0) + '</strong></span>' +
        '</div>'
      : '<p style="color:var(--texto-sec);font-size:13px;padding:8px 0;">Nenhum pagamento registrado.</p>';
  }

  // ── Top Defeitos ──────────────────────────────────────────
  const defeitos = statsOS.topDefeitos || [];
  const ICONES_DEFEITO = { 'Tela quebrada':'️', 'Não liga':`${ICONE_RAIO}`, 'Lentidão':'', 'Vírus':'', 'Superaquecimento':'️', 'HD defeituoso':'', 'SSD defeituoso':'', 'Bateria viciada':'', 'Não carrega':'', 'Sistema corrompido':'️', 'Travamentos':'', 'Tela azul':'', 'Sem Wi-Fi':'', 'Sem áudio':'', 'Outro':'' };
  const maxDefeito = defeitos[0]?.total || 1;
  $('relTopDefeitos').innerHTML = defeitos.length
    ? defeitos.map((d, i) => `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
            <span style="font-size:13px;color:var(--texto);font-weight:${i===0?700:400};">${ICONES_DEFEITO[d.nome]||''} ${d.nome}</span>
            <span style="font-size:12px;font-weight:700;color:#e53e3e;">${d.total}</span>
          </div>
          <div style="background:var(--borda);border-radius:4px;height:8px;">
            <div style="width:${Math.round((d.total/maxDefeito)*100)}%;background:#e53e3e;height:8px;border-radius:4px;transition:width .4s;"></div>
          </div>
        </div>`).join('')
    : '<p style="color:var(--texto-sec);font-size:13px;padding:8px 0;">Nenhum defeito registrado via checklist.</p>';

  // ── Estoque por Tipo ──────────────────────────────────────
  const porTipoEst = statsEst.porTipoEquipamento || {};
  const tiposEstoque = TIPOS_ORDER.filter(t => (porTipoEst[t]?.total||0) > 0);
  const maxEst = Math.max(...TIPOS_ORDER.map(t => porTipoEst[t]?.total||0), 1);
  if (tiposEstoque.length) {
    $('relEstoquePorTipo').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">
        ${tiposEstoque.map(t => {
          const d = porTipoEst[t] || { total:0, disponiveis:0, vendidos:0 };
          const icone = ICONE_REL[t] || '';
          return `<div style="background:var(--bg);border:1px solid var(--borda);border-radius:var(--raio-sm);padding:12px;">
            <div style="font-size:13px;font-weight:700;color:var(--texto);margin-bottom:8px;">${icone} ${t}</div>
            <div style="display:flex;gap:8px;">
              <span style="font-size:11px;background:var(--borda);border-radius:4px;padding:2px 6px;color:var(--texto-sec);">${d.total} total</span>
              <span style="font-size:11px;background:#d1fae5;border-radius:4px;padding:2px 6px;color:#15803d;">${d.disponiveis} disp.</span>
              <span style="font-size:11px;background:#ede9fe;border-radius:4px;padding:2px 6px;color:#7c3aed;">${d.vendidos} vend.</span>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } else {
    $('relEstoquePorTipo').innerHTML = '<p style="color:var(--texto-sec);font-size:13px;padding:8px 0;">Nenhum item no estoque.</p>';
  }
}

// ══════════════════════════════════════════
// ABA PAINEL
// ══════════════════════════════════════════
// INIT — controlado pelo sistema de login (Etapa 11.2)
// A inicialização real ocorre em mostrarSistema(), chamado após
// autenticação bem-sucedida em inicializarAuth() no final do arquivo.
// ══════════════════════════════════════════


// ── ETAPA 8.6: hooks dos campos dinâmicos por tipo de equipamento ──
if ($('tipoEquipamento')) {
  $('tipoEquipamento').addEventListener('change', () => {
    const tipo = $('tipoEquipamento').value;
    renderCamposDinamicos(tipo, 'camposDinamicosAparelho', 'nv', {});
    toggleCampoImei('campoImei', tipo);
    // ETAPA 8.6.1 — checklist de defeitos depende do tipo de equipamento
    novoChecklistDefeitos = [];
    renderizarChecklistBox('checklistDefeitosNovo', listaDefeitosPorTipo(tipo), novoChecklistDefeitos);
  });
  renderCamposDinamicos($('tipoEquipamento').value, 'camposDinamicosAparelho', 'nv', {});
  toggleCampoImei('campoImei', $('tipoEquipamento').value);
}
if ($('editTipoEquipamento')) {
  $('editTipoEquipamento').addEventListener('change', () => {
    const tipo = $('editTipoEquipamento').value;
    renderCamposDinamicos(tipo, 'camposDinamicosEditAparelho', 'ed', {});
    toggleCampoImei('campoEditImei', tipo);
    // ETAPA 8.6.1 — checklist de defeitos depende do tipo de equipamento
    editChecklistDefeitos = [];
    renderizarChecklistBox('checklistDefeitosEdit', listaDefeitosPorTipo(tipo), editChecklistDefeitos);
  });
}
if ($('estTipoEquipamento')) {
  $('estTipoEquipamento').addEventListener('change', () => {
    const tipo = $('estTipoEquipamento').value;
    renderCamposDinamicos(tipo, 'camposDinamicosEstoque', 'es', {});
    toggleCampoImei('campoEstImei', tipo);
    toggleCamposPeca(tipo);
  });
  renderCamposDinamicos($('estTipoEquipamento').value, 'camposDinamicosEstoque', 'es', {});
  toggleCampoImei('campoEstImei', $('estTipoEquipamento').value);
  toggleCamposPeca($('estTipoEquipamento').value);
}

// ── ETAPA 8.6.1 — render inicial dos checklists técnicos da Nova OS ──
if ($('checklistDefeitosNovo')) {
  renderizarChecklistBox('checklistDefeitosNovo', listaDefeitosPorTipo($('tipoEquipamento').value), novoChecklistDefeitos);
  renderizarChecklistBox('checklistAcessoriosNovo', CHECKLIST_ACESSORIOS_RECEBIDOS, novoChecklistAcessorios);
  renderizarChecklistBox('checklistTestesNovo', CHECKLIST_TESTES_ENTRADA, novoChecklistTestes);
  renderizarChecklistBox('checklistEntradaNovo', CHECKLIST_ENTRADA, novoChecklistEntrada);
  renderizarChecklistBox('checklistSaidaNovo', CHECKLIST_SAIDA, novoChecklistSaida);
}

// ── Filtro de período — chips (aba Relatórios) ──
if ($('relFiltroPeriodoChips')) {
  $('relFiltroPeriodoChips').querySelectorAll('.chip-periodo').forEach(chip => {
    chip.addEventListener('click', () => {
      const opcao = chip.dataset.periodo;
      $('relFiltroPeriodoChips').querySelectorAll('.chip-periodo').forEach(c => c.classList.remove('ativo'));
      chip.classList.add('ativo');
      _relFiltroPeriodoAtivo = opcao;
      const painelPersonalizado = $('relPeriodoPersonalizado');
      if (opcao === 'personalizado') {
        if (painelPersonalizado) painelPersonalizado.classList.remove('escondido');
        // Não recarrega ainda — espera o usuário escolher as datas e clicar em "Aplicar"
      } else {
        if (painelPersonalizado) painelPersonalizado.classList.add('escondido');
        carregarRelatorios();
      }
    });
  });
}
if ($('btnAplicarPeriodoPersonalizado')) {
  $('btnAplicarPeriodoPersonalizado').addEventListener('click', () => {
    const ini = $('relDataInicio')?.value;
    const fim = $('relDataFim')?.value;
    if (!ini || !fim) {
      toast('Selecione as duas datas do período.', 'aviso');
      return;
    }
    if (ini > fim) {
      toast('A data inicial não pode ser depois da data final.', 'aviso');
      return;
    }
    _relPersonalizadoInicio = ini;
    _relPersonalizadoFim = fim;
    carregarRelatorios();
  });
}

// ── Botão Atualizar Relatórios ──
if ($('btnAtualizarRelatorios')) {
  $('btnAtualizarRelatorios').addEventListener('click', () => carregarRelatorios());
}

// ── Botão Exportar Painel (PDF) — backup visual dos gráficos/cards ──
if ($('btnExportarPainelPDF')) {
  $('btnExportarPainelPDF').addEventListener('click', async () => {
    const btn = $('btnExportarPainelPDF');
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${ICONE_RELOGIO} Gerando PDF...`;
    try {
      const r = await window.api.backupexportarpainelpdf();
      if (r.cancelado) return;
      if (r.sucesso) toast(`${ICONE_CHECK} Painel exportado em PDF com sucesso!`, 'sucesso');
      else toast('Erro ao exportar painel: ' + (r.erro || 'falha desconhecida'), 'erro');
    } finally {
      btn.disabled = false;
      btn.innerHTML = textoOriginal;
    }
  });
}

// ══════════════════════════════════════════════════════════════
// ETAPA 11.1 — LICENCIAMENTO
// ══════════════════════════════════════════════════════════════

const SESSAO_KEY = 'sistema-os-sessao-v1';

function carregarSessao() {
  try { return JSON.parse(localStorage.getItem(SESSAO_KEY)); }
  catch { return null; }
}

function salvarSessao(usuario) {
  localStorage.setItem(SESSAO_KEY, JSON.stringify({ ...usuario, loginEm: Date.now() }));
}

function limparSessao() {
  localStorage.removeItem(SESSAO_KEY);
}

// ── Usuário ativo (em memória durante a sessão) ─────────────
let usuarioAtual = null;
let preparacaoSupabaseEmAndamento = false;

function mostrarPreparacaoSupabase() {
  const loginEl = $('loginUsuario');
  if (loginEl) loginEl.placeholder = 'preparando acesso...';
  const hint = document.querySelector('.login-hint');
  if (hint) hint.textContent = 'Preparando sua conexão segura...';
  mostrarTelaLogin();
}

// ── Inicialização da autenticação ───────────────────────────
async function inicializarAuth() {
  const sessao = carregarSessao();
  // Etapa 7: quando o Supabase está ativo, a sessão real vive criptografada
  // no processo principal. O localStorage guarda apenas dados públicos para
  // renderização e nunca é aceito como prova de autenticação.
  try {
    const statusSupabase = await window.api.supabasestatus?.();
    // A janela é exibida antes de terminar a restauração da nuvem. Assim o
    // Windows não parece travado em máquinas lentas, mas uma sessão antiga
    // também não é usada como prova de login enquanto o cofre seguro ainda
    // está sendo conferido pelo processo principal.
    if (statusSupabase?.ativo && !statusSupabase?.operacional) {
      mostrarPreparacaoSupabase();
      if (!preparacaoSupabaseEmAndamento && typeof window.api.supabaseaguardarinicializacao === 'function') {
        preparacaoSupabaseEmAndamento = true;
        window.api.supabaseaguardarinicializacao()
          .catch(() => {})
          .finally(() => {
            preparacaoSupabaseEmAndamento = false;
            inicializarAuth().catch((erro) => console.warn('Falha ao preparar autenticação:', erro?.message));
          });
      }
      return;
    }
    if (statusSupabase?.ativo && statusSupabase?.operacional) {
      const restaurada = await window.api.supabaserestaurarsessao();
      if (restaurada?.sucesso && restaurada.usuario) {
        usuarioAtual = restaurada.usuario;
        salvarSessao(restaurada.usuario);
        mostrarSistema();
        return;
      }
      limparSessao();
      const loginEl = $('loginUsuario');
      if (loginEl) loginEl.placeholder = 'seu usuário';
      const hint = document.querySelector('.login-hint');
      if (hint) hint.textContent = 'Entre com seu usuário e senha.';
      mostrarTelaLogin();
      if (restaurada?.erro) _mostrarErroLogin(restaurada.erro);
      return;
    }
  } catch (erro) {
    console.warn('Supabase indisponível no boot; usando autenticação local:', erro.message);
  }
  if (sessao && sessao.id) {
    // Bugfix Etapa 11.3: revalida contra o banco — se o usuário foi
    // bloqueado/desativado ou teve o cargo/permissões alterados por um
    // admin enquanto a sessão estava persistida, isso precisa valer
    // imediatamente, não só no próximo login manual.
    try {
      const atualizado = await window.api.authrevalidar(sessao.id);
      if (!atualizado) {
        limparSessao();
        mostrarTelaLogin();
        return;
      }
      usuarioAtual = atualizado;
      salvarSessao(atualizado);
    } catch (err) {
      console.error('Falha ao revalidar sessão:', err);
      usuarioAtual = sessao; // offline/erro pontual: mantém sessão antiga como fallback
    }
    mostrarSistema();
  } else {
    // Sem sessão — exibe tela de login
    mostrarTelaLogin();
  }
}

function mostrarTelaLogin() {
  const tela = $('telaLogin');
  if (tela) tela.classList.remove('escondido');
  carregarContasRapidasUI().catch(() => {});
}

function ocultarTelaLogin() {
  const tela = $('telaLogin');
  if (tela) tela.classList.add('escondido');
}

function mostrarSistema(exibirBoasVindas = false) {
  ocultarTelaLogin();
  atualizarInfoUsuarioTopo();
  aplicarPermissoesUI();
  document.dispatchEvent(new CustomEvent('sistemaos:sessao-pronta', { detail: usuarioAtual }));

  if (usuarioAtual?.administradorGlobal) {
    (async () => {
      try { await atualizarPainelGlobalSistema(); } catch (e) { console.error(e); }
      $('btnConfig')?.click();
    })();
    return;
  }

  if (usuarioAtual?.acessoSomenteCobranca) {
    setTimeout(() => {
      if (String(usuarioAtual?.planoNome || '').trim().toLowerCase() === 'trial') {
        window.SistemaOSAssinaturasUI?.abrirBloqueioTrial?.(usuarioAtual);
      } else {
        $('btnConfig')?.click();
        window.SistemaOSAssinaturasUI?.abrir?.();
      }
    }, 300);
    return;
  }

  // Carrega o conteúdo inicial de forma ESCALONADA para não saturar o IPC
  // e travar a UI logo após o login. Config vem primeiro (precisa estar pronta
  // antes dos outros módulos usarem configurações visuais); o restante vem em
  // microtarefas separadas para liberar o event loop entre cada chamada.
  (async () => {
    try { await carregarConfig(); }         catch (e) { console.error(e); }
    try { await atualizarIntegracaoMercadoPagoEmpresa(); } catch (e) { console.error(e); }
    try { await atualizarPainelGlobalSistema(); } catch (e) { console.error(e); }
    await new Promise(r => setTimeout(r, 0));
    try { carregarHistorico(); }            catch (e) { console.error(e); }
    await new Promise(r => setTimeout(r, 0));
    try { carregarEstoque(); }              catch (e) { console.error(e); }
    await new Promise(r => setTimeout(r, 0));
    try { carregarPainel(); }               catch (e) { console.error(e); }
    await new Promise(r => setTimeout(r, 0));
    try { carregarRelatorios(); }           catch (e) { console.error(e); }
    try { verificarTamanhoBanco(); }        catch (e) { console.error(e); }
  })();

  // Toast de boas-vindas
  if (usuarioAtual) {
    const nome = usuarioAtual.nome || usuarioAtual.usuario;
    if (exibirBoasVindas) {
      // Primeiro acesso: onboarding acabou de definir o nome — mostra saudação completa
      setTimeout(() => toast(`Olá, ${nome}! Seja bem-vindo ao sistema.`, 'sucesso'), 300);
    } else {
      const jaFezOnboarding = localStorage.getItem('onboarding-' + usuarioAtual.id);
      if (jaFezOnboarding) {
        setTimeout(() => toast(`Bem-vindo de volta, ${nome}!`, 'sucesso'), 400);
      }
    }
  }
}

// Mantém a aba de estoque aberta atualizada quando uma alteração chega do
// Android. O listener é único e não força troca de tela.
window.api?.onSupabaseSincronizado?.((resultado) => {
  if (!resultado || Number(resultado.estoqueRecebidos || 0) < 1) return;
  carregarEstoque().catch?.(() => {});
  carregarPecas().catch?.(() => {});
});

// ── Permissões por módulo (Etapa 11.3) ──────────────────────
function temPermissaoModulo(modulo) {
  if (!usuarioAtual) return false;
  if (usuarioAtual.administradorGlobal) return modulo === 'configuracoes';
  if (usuarioAtual.admin) return true;
  return !!(usuarioAtual.permissoes && usuarioAtual.permissoes[modulo]);
}

function temPermissaoElemento(elemento) {
  if (!elemento?.dataset?.permissao) return true;
  return temPermissaoModulo(elemento.dataset.permissao) ||
    (!!elemento.dataset.permissaoAlternativa && temPermissaoModulo(elemento.dataset.permissaoAlternativa));
}

function aplicarPermissoesUI() {
  const suporteGlobal = !!usuarioAtual?.administradorGlobal;
  document.body.classList.toggle('modo-suporte-global', suporteGlobal);
  const tituloConfig = document.querySelector('#modalConfig .modal-cabecalho h2');
  if (tituloConfig) tituloConfig.textContent = suporteGlobal ? 'Central de suporte Sistema OS' : 'Configurações da Assistência';
  const botaoConfig = $('btnConfig');
  if (botaoConfig) botaoConfig.lastChild.textContent = suporteGlobal ? ' Central de suporte' : ' Config';
  const nomeSistema = $('nomeSistema');
  if (nomeSistema && suporteGlobal) nomeSistema.textContent = 'Sistema OS — Suporte geral';
  const podeAlterarLogo = !!usuarioAtual?.admin && !suporteGlobal;
  const inputLogoEmpresa = $('inputLogo');
  const removerLogoEmpresa = $('btnRemoverLogo');
  if (inputLogoEmpresa) {
    inputLogoEmpresa.disabled = !podeAlterarLogo;
    const rotuloLogo = inputLogoEmpresa.closest('label');
    if (rotuloLogo) {
      rotuloLogo.classList.toggle('desabilitado', !podeAlterarLogo);
      rotuloLogo.title = podeAlterarLogo ? '' : 'A logo e definida pelo administrador da empresa.';
    }
  }
  if (removerLogoEmpresa) {
    removerLogoEmpresa.disabled = !podeAlterarLogo;
    removerLogoEmpresa.title = podeAlterarLogo ? '' : 'A logo e definida pelo administrador da empresa.';
  }
  const camposEmpresaCompartilhados = [
    'nomeEmpresa', 'nomeFantasia', 'razaoSocial', 'garantiaPadrao', 'telefonePrincipal',
    'telefoneFixo', 'whatsapp', 'emailEmpresa', 'site', 'endereco', 'numero', 'complemento',
    'bairro', 'cidade', 'estado', 'cep', 'possuiCnpj', 'cnpjEmpresa', 'inscricaoEstadual',
    'exibirCnpjDocumentos', 'usarTermosPredefinidosOS', 'termosOSConfig',
    'usarTermosPredefinidosVenda', 'termosVendaConfig', 'usarTermosPredefinidosCompra',
    'termosCompraConfig', 'usarTermosPredefinidosGarantia', 'termosGarantiaConfig',
    'textoRodapePdf', 'tamanhoLogoPdf', 'tamanhoFonteTermosPdf', 'tamanhoFonteTermosPdfRange'
  ];
  camposEmpresaCompartilhados.forEach((id) => {
    const campo = $(id);
    if (!campo) return;
    campo.disabled = !podeAlterarLogo;
    campo.title = podeAlterarLogo ? '' : 'Este dado é definido pelo administrador da empresa e sincronizado automaticamente.';
  });
  const linhaTrocaRapida = $('linhaAtivarTrocaRapida');
  const checkTrocaRapida = $('cfgTrocaRapidaContas');
  if (linhaTrocaRapida) linhaTrocaRapida.hidden = suporteGlobal || !usuarioAtual?.admin;
  if (checkTrocaRapida) checkTrocaRapida.checked = !!usuarioAtual?.trocaRapidaContas;
  const blocoContasRapidas = $('contasRapidasConfig');
  if (blocoContasRapidas) blocoContasRapidas.hidden = !(suporteGlobal || usuarioAtual?.trocaRapidaContas);
  const senhaExclusao = $('btnDefinirSenhaExclusaoGlobal');
  if (senhaExclusao) senhaExclusao.hidden = !suporteGlobal || usuarioAtual?.papelSuporte !== 'administrador_geral';
  const botaoCriarEmpresa = $('btnCriarEmpresaGlobal');
  if (botaoCriarEmpresa) botaoCriarEmpresa.hidden = suporteGlobal && !suportePodeGerenciar();
  const botaoNovoPlano = $('btnNovoPlanoGlobal');
  if (botaoNovoPlano) botaoNovoPlano.hidden = suporteGlobal && !suporteEhAdministradorGeral();
  carregarContasRapidasUI().catch((erro) => console.warn('Contas rápidas:', erro.message));
  document.querySelectorAll('[data-permissao]').forEach(el => {
    if (temPermissaoElemento(el)) {
      el.classList.remove('escondido');
      el.disabled = false;
    } else {
      el.classList.add('escondido');
      el.disabled = true;
    }
  });

  // Se a aba ativa não é mais permitida, pula pra primeira aba liberada
  const abaAtiva = document.querySelector('.aba.ativa');
  if (abaAtiva && abaAtiva.classList.contains('escondido')) {
    const primeiraPermitida = document.querySelector('.aba:not(.escondido)');
    if (primeiraPermitida) primeiraPermitida.click();
  }
}

function atualizarInfoUsuarioTopo() {
  const infoEl    = $('infoUsuarioLogado');
  const nomeEl    = $('nomeUsuarioLogado');
  const perfilEl  = $('perfilUsuarioLogado');
  const btnLogout = $('btnLogout');

  if (!usuarioAtual) return;

  if (nomeEl)   nomeEl.textContent   = usuarioAtual.nome || usuarioAtual.usuario;
  if (perfilEl) perfilEl.textContent = usuarioAtual.administradorGlobal
    ? ({ administrador_geral: 'Administrador geral', gerente_suporte: 'Gerente de suporte', suporte: 'Suporte' }[usuarioAtual.papelSuporte] || 'Suporte')
    : (usuarioAtual.cargoNome || (usuarioAtual.perfil === 'admin' ? 'Admin' : 'Operador'));
  if (infoEl)   infoEl.classList.remove('escondido');
  if (btnLogout) btnLogout.classList.remove('escondido');
}

// ── Login ────────────────────────────────────────────────────
let _loginEmAndamento = false;

function aguardarLoginComLimite(promessa, limiteMs = 22000) {
  let temporizador;
  return Promise.race([
    Promise.resolve(promessa),
    new Promise((_, rejeitar) => {
      temporizador = setTimeout(() => rejeitar(new Error('TEMPO_LIMITE_LOGIN')), limiteMs);
    })
  ]).finally(() => clearTimeout(temporizador));
}

async function fazerLogin() {
  if (_loginEmAndamento) return; // evita duplo-clique
  const empresaEl = $('loginEmpresa');
  const loginEl = $('loginUsuario');
  const senhaEl = $('loginSenha');
  const erroEl  = $('loginErro');
  const btnEl   = $('btnLogin');
  const loadEl  = $('loginLoading');

  const empresa = (empresaEl?.value || '').trim();
  const usuario = (loginEl?.value || '').trim();
  const senha   = (senhaEl?.value || '');

  if (erroEl) erroEl.classList.add('escondido');

  if (!empresa) {
    _mostrarErroLogin('Informe o código da empresa.');
    empresaEl?.focus();
    return;
  }
  if (!usuario) {
    _mostrarErroLogin('Informe seu usuário.');
    loginEl?.focus();
    return;
  }
  if (!senha) {
    _mostrarErroLogin('Informe sua senha.');
    senhaEl?.focus();
    return;
  }

  _loginEmAndamento = true;
  if (btnEl)  { btnEl.disabled = true; const _lt=$('loginBtnTexto'); if(_lt)_lt.textContent='Entrando…'; }
  if (loadEl) loadEl.classList.remove('escondido');

  // setTimeout(0) solta o event loop antes do IPC — evita congelamento de UI
  await new Promise(r => setTimeout(r, 0));

  try {
    const res = await aguardarLoginComLimite(window.api.supabaselogin(empresa, usuario, senha));
    if (res.sucesso) {
      usuarioAtual = res.usuario;
      salvarSessao(res.usuario);
      if (senhaEl) senhaEl.value = '';
      // Animação de saída suave antes de mostrar o sistema
      const tela = $('telaLogin');
      if (tela) { tela.style.opacity = '0'; tela.style.transition = 'opacity .25s'; }
      await new Promise(r => setTimeout(r, 220));
      const primeiroAcesso = await verificarPrimeiroAcesso(res.usuario);
      mostrarSistema(primeiroAcesso);
    } else {
      _mostrarErroLogin(res.erro || 'Falha no login.');
    }
  } catch (err) {
    _mostrarErroLogin(err?.message === 'TEMPO_LIMITE_LOGIN'
      ? 'O servidor demorou para responder. Tente novamente em alguns instantes.'
      : 'Erro ao conectar ao sistema. Verifique a internet e tente novamente.');
    console.error('Erro no login:', err);
  } finally {
    _loginEmAndamento = false;
    if (btnEl)  { btnEl.disabled = false; const _lt=$('loginBtnTexto'); if(_lt)_lt.textContent='Entrar'; }
    if (loadEl) loadEl.classList.add('escondido');
    const tela = $('telaLogin');
    if (tela) tela.style.opacity = '';
  }
}

async function abrirChamadoSuporte(origem) {
  const peloLogin = origem === 'login_pc';
  const empresa = peloLogin
    ? String($('loginEmpresa')?.value || '').trim().toLowerCase()
    : '';
  if (window.SistemaOSChamados?.abrirNovo) {
    await window.SistemaOSChamados.abrirNovo({
      origem,
      empresa,
      usuario: peloLogin ? String($('loginUsuario')?.value || '').trim() : String(usuarioAtual?.usuario || '').trim(),
      nome: peloLogin ? String($('loginUsuario')?.value || '').trim() : String(usuarioAtual?.nome || usuarioAtual?.usuario || '').trim()
    });
    return;
  }
  const empresaInformada = empresa || (peloLogin
    ? await promptModal('Código da empresa:', '', { titulo: 'Abrir chamado' })
    : '');
  if (empresaInformada === null) return;
  if (peloLogin && !/^[a-z0-9-]{3,40}$/i.test(String(empresaInformada).trim())) {
    throw new Error('Informe o código da empresa antes de abrir o chamado.');
  }
  const nomePadrao = peloLogin ? String($('loginUsuario')?.value || '').trim() : String(usuarioAtual?.nome || usuarioAtual?.usuario || '').trim();
  const nome = peloLogin ? await promptModal('Seu nome (opcional):', nomePadrao, { titulo: 'Abrir chamado' }) : nomePadrao;
  if (nome === null) return;
  const contato = await promptModal('Telefone ou e-mail para retorno (opcional):', '', { titulo: 'Abrir chamado' });
  if (contato === null) return;
  const mensagem = await promptModal('Descreva o que precisa. Mínimo de 10 caracteres:', '', { titulo: 'Abrir chamado' });
  if (mensagem === null) return;
  if (String(mensagem).trim().length < 10) throw new Error('Descreva o problema com pelo menos 10 caracteres.');
  const resposta = await window.api.supabasecriarchamadosuporte?.({
    origem, empresa: String(empresaInformada || '').trim().toLowerCase(), nome: String(nome || '').trim(),
    usuario: peloLogin ? String($('loginUsuario')?.value || '').trim() : String(usuarioAtual?.usuario || '').trim(),
    contato: String(contato || '').trim(), mensagem: String(mensagem).trim()
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível abrir o chamado.');
  window.SistemaOSChamados?.registrar?.(resposta);
  toast('Chamado ' + (resposta.protocolo || '') + ' enviado ao suporte.', 'sucesso');
  window.SistemaOSChamados?.abrir?.().catch(() => {});
}

function _mostrarErroLogin(msg) {
  const erroEl = $('loginErro');
  if (!erroEl) return;
  erroEl.textContent = msg;
  erroEl.classList.remove('escondido');
  // Shake animation
  erroEl.style.animation = 'none';
  requestAnimationFrame(() => { erroEl.style.animation = 'loginShake .35s ease'; });
}

function escreverStatusIntegracaoMercadoPago(integracao, erro, acao) {
  const status = $('integracaoMercadoPagoStatus');
  const conectar = $('btnConectarMercadoPagoEmpresa');
  const desconectar = $('btnDesconectarMercadoPagoEmpresa');
  if (!status) return;
  if (erro) {
    const rotulo = ({ conectar: 'conectar', desconectar: 'desconectar', verificar: 'atualizar o status' })[acao] || 'concluir a operação';
    status.textContent = 'Não foi possível ' + rotulo + ': ' + erro;
    if (conectar) conectar.hidden = false;
    if (desconectar) desconectar.hidden = true;
    return;
  }
  if (integracao?.status === 'conectada') {
    const data = integracao.ultima_verificacao_em || integracao.conectado_em;
    status.textContent = ['Conta conectada', integracao.conta_mascarada, data ? 'verificada em ' + new Date(data).toLocaleString('pt-BR') : '']
      .filter(Boolean).join(' · ');
    if (conectar) conectar.hidden = true;
    if (desconectar) desconectar.hidden = false;
    return;
  }
  if (integracao?.status === 'erro') {
    status.textContent = 'Conta com problema: ' + (integracao.ultimo_erro || 'conecte novamente para validar.');
    if (conectar) conectar.hidden = false;
    if (desconectar) desconectar.hidden = false;
    return;
  }
  status.textContent = 'Nenhuma conta conectada para esta empresa.';
  if (conectar) conectar.hidden = false;
  if (desconectar) desconectar.hidden = true;
}

async function atualizarIntegracaoMercadoPagoEmpresa() {
  const secao = $('integracaoMercadoPagoEmpresa');
  if (!secao) return;
  const podeAdministrar = !!usuarioAtual?.admin;
  secao.hidden = !podeAdministrar;
  if (!podeAdministrar) return;
  const resposta = await window.api.supabaseobterintegracaomercadopago?.();
  escreverStatusIntegracaoMercadoPago(resposta?.integracao, resposta?.sucesso ? '' : (resposta?.erro || 'Não foi possível consultar a integração.'), 'verificar');
}

function definirBotoesIntegracaoMercadoPago(ocupado) {
  ['btnConectarMercadoPagoEmpresa', 'btnDesconectarMercadoPagoEmpresa', 'btnAtualizarMercadoPagoEmpresa']
    .map($).filter(Boolean).forEach((botao) => { botao.disabled = !!ocupado; });
}

async function chamarIntegracaoMercadoPago(acao, token) {
  const chamada = acao === 'verificar'
    ? window.api.supabaseverificarintegracaomercadopago
    : window.api.supabaseintegracaomercadopago;
  if (typeof chamada !== 'function') {
    return { sucesso: false, erro: 'Este aplicativo está desatualizado. Instale a atualização para usar Mercado Pago.' };
  }
  return acao === 'verificar' ? chamada() : chamada(acao, token || '');
}

async function conectarMercadoPagoEmpresa() {
  const token = await promptModal('Cole o Access Token de produção. Ele será enviado diretamente ao cofre seguro da empresa e não será salvo neste computador.', '', {
    titulo: 'Conectar Mercado Pago', senha: true
  });
  if (token === null) return;
  if (!String(token).trim()) {
    escreverStatusIntegracaoMercadoPago(null, 'Informe um Access Token para conectar.', 'conectar');
    return;
  }
  definirBotoesIntegracaoMercadoPago(true);
  try {
    const resposta = await chamarIntegracaoMercadoPago('conectar', token);
    escreverStatusIntegracaoMercadoPago(resposta?.integracao, resposta?.sucesso ? '' : (resposta?.erro || 'Não foi possível conectar a conta.'), 'conectar');
    toast(resposta?.sucesso ? (resposta.mensagem || 'Conta Mercado Pago conectada com segurança.') : (resposta?.erro || 'Não foi possível conectar a conta.'), resposta?.sucesso ? 'sucesso' : 'erro');
  } finally { definirBotoesIntegracaoMercadoPago(false); }
}

async function desconectarMercadoPagoEmpresa() {
  const confirmar = await confirmModal('Desconectar a conta Mercado Pago desta empresa?\n\nA cobrança automática deixará de criar novos links até uma nova conexão.', { titulo: 'Desconectar Mercado Pago' });
  if (!confirmar) return;
  definirBotoesIntegracaoMercadoPago(true);
  try {
    const resposta = await chamarIntegracaoMercadoPago('desconectar');
    escreverStatusIntegracaoMercadoPago(resposta?.integracao, resposta?.sucesso ? '' : (resposta?.erro || 'Não foi possível desconectar a conta.'), 'desconectar');
    toast(resposta?.sucesso ? 'Conta Mercado Pago desconectada.' : (resposta?.erro || 'Não foi possível desconectar a conta.'), resposta?.sucesso ? 'sucesso' : 'erro');
  } finally { definirBotoesIntegracaoMercadoPago(false); }
}

async function verificarIntegracaoMercadoPagoEmpresa() {
  const status = $('integracaoMercadoPagoStatus');
  if (status) status.textContent = 'Validando a conta Mercado Pago…';
  definirBotoesIntegracaoMercadoPago(true);
  try {
    const resposta = await chamarIntegracaoMercadoPago('verificar');
    escreverStatusIntegracaoMercadoPago(resposta?.integracao, resposta?.sucesso ? '' : (resposta?.erro || 'Não foi possível validar a conta.'), 'verificar');
    toast(resposta?.sucesso
      ? (resposta.mensagem || (resposta.status_verificado ? 'Conta Mercado Pago ativa.' : 'Nenhuma conta conectada.'))
      : (resposta?.erro || 'Não foi possível validar a conta.'), resposta?.sucesso && resposta.status_verificado ? 'sucesso' : (resposta?.sucesso ? 'aviso' : 'erro'));
  } finally { definirBotoesIntegracaoMercadoPago(false); }
}

let empresasGlobaisCache = [];
let planosGlobaisCache = [];
let chamadosGlobaisCache = [];
let solicitacoesExclusaoCache = [];
let equipeSuporteCache = [];
let errosUsuariosCache = [];
let painelPlanosGlobalAberto = false;
let empresaUsuariosGlobal = null;
let usuariosEmpresaGlobalCache = [];
let empresaUsuariosGlobalEhSuporte = false;

const CARGOS_EMPRESA_CLIENTE = [
  { valor: 'Administrador', rotulo: 'Administrador' },
  { valor: 'Gerente', rotulo: 'Gerente' },
  { valor: 'Técnico', rotulo: 'Técnico' },
  { valor: 'Atendente', rotulo: 'Atendente' }
];

const CARGOS_EQUIPE_SUPORTE = [
  { valor: 'administrador_geral', rotulo: 'Administrador Geral', descricao: 'Controle completo da plataforma, equipe, empresas, planos e exclusões.' },
  { valor: 'gerente_suporte', rotulo: 'Gerente de Suporte', descricao: 'Gerencia empresas, usuários e atendimentos, sem alterar poderes do Administrador Geral.' },
  { valor: 'suporte', rotulo: 'Analista de Suporte', descricao: 'Atende chamados e consulta dados, sem administrar empresas ou usuários.' }
];

function normalizarPapelSuporteRenderer(valor) {
  const texto = String(valor || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['administrador_geral', 'administrador_do_sistema', 'administrador'].includes(texto)) return 'administrador_geral';
  if (['gerente_suporte', 'gerente_de_suporte', 'gerente'].includes(texto)) return 'gerente_suporte';
  return 'suporte';
}

function preencherCargosUsuarioEmpresaGlobal(usuario = null) {
  const select = $('usuarioEmpresaGlobalCargo');
  if (!select) return;
  const cargos = empresaUsuariosGlobalEhSuporte ? CARGOS_EQUIPE_SUPORTE : CARGOS_EMPRESA_CLIENTE;
  select.replaceChildren(...cargos.map((cargo) => {
    const opcao = document.createElement('option');
    opcao.value = cargo.valor;
    opcao.textContent = cargo.rotulo;
    if (cargo.descricao) opcao.title = cargo.descricao;
    return opcao;
  }));
  select.value = empresaUsuariosGlobalEhSuporte
    ? normalizarPapelSuporteRenderer(usuario?.papelSuporte || usuario?.cargo)
    : (usuario?.cargo || 'Atendente');
}

function formatarStatusLicenca(status) {
  const nomes = {
    ativa: 'Ativa', teste: 'Trial', vencendo: 'Vencendo', vencida: 'Vencida',
    periodo_graca: 'Período de graça', suspensa: 'Suspensa', cancelada: 'Cancelada', bloqueada: 'Bloqueada'
  };
  return nomes[String(status || '').toLowerCase()] || 'Sem status';
}

function dataVencimentoEmpresa(empresa) {
  const valor = empresa?.data_vencimento || empresa?.fim_trial;
  const data = valor ? new Date(valor) : null;
  return data && !Number.isNaN(data.getTime()) ? data : null;
}

function calcularMetricasSuporteGlobal(empresas, chamados) {
  const hoje = new Date();
  const emSeteDias = new Date(hoje.getTime() + 7 * 86400000);
  const bloqueados = (empresas || []).filter((empresa) => ['bloqueada', 'suspensa', 'cancelada'].includes(String(empresa.licenca_status || '').toLowerCase())).length;
  const vencendo = (empresas || []).filter((empresa) => {
    const data = dataVencimentoEmpresa(empresa);
    return data && data >= hoje && data <= emSeteDias;
  }).length;
  const trials = (empresas || []).filter((empresa) => String(empresa.licenca_status || '').toLowerCase() === 'teste').length;
  const chamadosAbertos = (chamados || []).filter((chamado) => ['aberto', 'em_atendimento'].includes(String(chamado.status || 'aberto'))).length;
  return [
    { valor: (empresas || []).length, rotulo: 'Empresas' },
    { valor: trials, rotulo: 'Em trial' },
    { valor: vencendo, rotulo: 'Vencem em 7 dias', classe: vencendo ? 'alerta' : '' },
    { valor: bloqueados, rotulo: 'Bloqueadas', classe: bloqueados ? 'perigo' : '' },
    { valor: chamadosAbertos, rotulo: 'Chamados abertos', classe: chamadosAbertos ? 'alerta' : '' }
  ];
}

function renderizarMetricasSuporteGlobal(empresas, chamados) {
  const alvo = $('metricasSuporteGlobal');
  if (!alvo) return;
  alvo.replaceChildren(...calcularMetricasSuporteGlobal(empresas, chamados).map((metrica) => {
    const card = document.createElement('div');
    card.className = 'suporte-metrica' + (metrica.classe ? ' ' + metrica.classe : '');
    const valor = document.createElement('strong');
    valor.textContent = String(metrica.valor);
    const rotulo = document.createElement('span');
    rotulo.textContent = metrica.rotulo;
    card.append(valor, rotulo);
    return card;
  }));
}

function renderizarResumoCobrancasGlobais(empresas) {
  const resumo = $('resumoCobrancasGlobal');
  if (!resumo) return;
  const agora = new Date();
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const limite = new Date(inicioHoje.getTime() + 7 * 86400000);
  const ativas = (empresas || []).filter((empresa) => empresa?.ativo !== false &&
    !['bloqueada', 'suspensa', 'cancelada'].includes(String(empresa.licenca_status || '').toLowerCase()));
  const vencidas = ativas.filter((empresa) => {
    const data = dataVencimentoEmpresa(empresa);
    return data && data < inicioHoje;
  });
  const proximas = ativas.filter((empresa) => {
    const data = dataVencimentoEmpresa(empresa);
    return data && data >= inicioHoje && data <= limite;
  });
  resumo.textContent = vencidas.length || proximas.length
    ? 'Cobranças: ' + vencidas.length + ' vencida(s) e ' + proximas.length + ' com vencimento nos próximos 7 dias. Use “Pagamento” ou “Adicionar dias” em cada empresa.'
    : 'Cobranças: nenhuma empresa com vencimento nos próximos 7 dias.';
}

function criarBotaoSuporte(texto, classe, acao) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'botao ' + classe + ' botao-pequeno';
  botao.textContent = texto;
  botao.addEventListener('click', () => Promise.resolve().then(acao).catch((erro) => {
    const mensagem = erro?.erro || erro?.mensagem || erro?.message || erro?.details || erro?.hint;
    toast(typeof mensagem === 'string' && mensagem.trim()
      ? mensagem.trim()
      : 'Não foi possível concluir a operação. Tente novamente.', 'erro');
  }));
  return botao;
}

async function abrirIntegracaoIAEmpresaGlobal(empresa) {
  $('modalIntegracaoIAEmpresaGlobal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'modalIntegracaoIAEmpresaGlobal';
  overlay.className = 'modal-fundo';
  overlay.style.zIndex = '11000';
  const caixa = document.createElement('form');
  caixa.className = 'modal-caixa';
  caixa.style.maxWidth = '680px';
  caixa.innerHTML = `
    <div class="modal-cabecalho"><div><h2>Assistente IA — ${_escHtml(empresa.nome_fantasia || empresa.codigo)}</h2><p class="campo-desc">Configure uma credencial exclusiva para esta empresa. A chave fica no cofre da nuvem.</p></div><button type="button" class="botao-fechar" data-fechar-ia>×</button></div>
    <div style="padding:20px 24px;display:grid;gap:16px">
      <div class="grade-2">
        <div class="campo"><label for="suporteIAProvedor">1. Provedor</label><select id="suporteIAProvedor">${Object.entries(PROVEDORES_IA_CONFIG).map(([valor, item]) => `<option value="${valor}">${_escHtml(item.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label for="suporteIAModelo">2. Modelo</label><select id="suporteIAModelo"></select></div>
      </div>
      <div class="campo"><label for="suporteIAChave" id="suporteIAChaveLabel">3. Chave da API</label><input id="suporteIAChave" type="password" autocomplete="new-password" /><p id="suporteIAAjuda" class="campo-desc">Carregando a configuração atual…</p></div>
      <p id="suporteIAStatus" class="campo-desc" role="status" aria-live="polite"></p>
    </div>
    <div class="modal-rodape"><button type="button" id="suporteIADesconectar" class="botao botao-perigo">Desconectar</button><button type="button" class="botao botao-fantasma" data-fechar-ia>Cancelar</button><button type="submit" id="suporteIASalvar" class="botao botao-primario">Validar e salvar</button></div>`;
  overlay.appendChild(caixa);
  document.body.appendChild(overlay);
  const provedorEl = caixa.querySelector('#suporteIAProvedor');
  const modeloEl = caixa.querySelector('#suporteIAModelo');
  const chaveEl = caixa.querySelector('#suporteIAChave');
  const ajudaEl = caixa.querySelector('#suporteIAAjuda');
  const statusEl = caixa.querySelector('#suporteIAStatus');
  let integracaoAtual = null;
  let possuiChave = false;
  const fechar = () => overlay.remove();
  caixa.querySelectorAll('[data-fechar-ia]').forEach((botao) => botao.addEventListener('click', fechar));
  overlay.addEventListener('mousedown', (evento) => { if (evento.target === overlay) fechar(); });
  const atualizar = (modeloAtual = '') => {
    const provedor = provedorEl.value;
    const definicao = PROVEDORES_IA_CONFIG[provedor];
    preencherModelosIA(modeloEl, provedor, modeloAtual);
    caixa.querySelector('#suporteIAChaveLabel').textContent = `3. Chave da API ${definicao.nome}`;
    const podeManter = possuiChave && integracaoAtual?.metadados?.provedor === provedor;
    chaveEl.placeholder = podeManter ? 'Chave configurada — deixe vazio para manter' : definicao.placeholder;
    ajudaEl.textContent = podeManter
      ? 'A chave atual está protegida. Digite outra somente para substituí-la.'
      : 'Informe a chave correspondente ao provedor selecionado.';
  };
  provedorEl.addEventListener('change', () => atualizar(''));
  atualizar('');
  const consulta = await window.api.supabaseadministracaoglobal?.('obter_integracao_ia_empresa', { empresaId: empresa.id });
  if (!consulta?.sucesso) {
    statusEl.textContent = consulta?.erro || 'Não foi possível consultar a integração.';
    statusEl.style.color = 'var(--perigo)';
  } else {
    integracaoAtual = consulta.integracao || null;
    possuiChave = consulta.possui_chave === true;
    const provedorAtual = integracaoAtual?.metadados?.provedor;
    if (provedorAtual && PROVEDORES_IA_CONFIG[provedorAtual]) provedorEl.value = provedorAtual;
    atualizar(integracaoAtual?.metadados?.modelo || '');
    statusEl.textContent = integracaoAtual?.status === 'conectada'
      ? `Ativa: ${integracaoAtual.conta_mascarada || 'configuração protegida'}.`
      : 'Nenhuma integração de IA ativa para esta empresa.';
  }
  caixa.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const mudouProvedor = integracaoAtual?.metadados?.provedor && integracaoAtual.metadados.provedor !== provedorEl.value;
    if ((!possuiChave || mudouProvedor) && !chaveEl.value.trim()) {
      statusEl.textContent = 'Informe a chave da API do provedor selecionado.';
      statusEl.style.color = 'var(--perigo)';
      chaveEl.focus();
      return;
    }
    const salvar = caixa.querySelector('#suporteIASalvar');
    salvar.disabled = true;
    statusEl.style.color = '';
    statusEl.textContent = 'Validando a chave com o provedor…';
    const resposta = await window.api.supabaseadministracaoglobal?.('configurar_integracao_ia_empresa', {
      empresaId: empresa.id, provedor: provedorEl.value, modelo: modeloEl.value, apiKey: chaveEl.value.trim()
    });
    salvar.disabled = false;
    if (!resposta?.sucesso) {
      statusEl.textContent = resposta?.erro || 'Não foi possível salvar a integração.';
      statusEl.style.color = 'var(--perigo)';
      return;
    }
    toast('Assistente IA configurado para ' + (empresa.nome_fantasia || empresa.codigo) + '.', 'sucesso');
    fechar();
  });
  caixa.querySelector('#suporteIADesconectar').addEventListener('click', async () => {
    if (!integracaoAtual || integracaoAtual.status !== 'conectada') return;
    if (!await confirmModal('Desconectar o assistente de IA desta empresa?', { titulo: 'Desconectar IA' })) return;
    const resposta = await window.api.supabaseadministracaoglobal?.('desconectar_integracao_ia_empresa', { empresaId: empresa.id });
    if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível desconectar a integração.');
    toast('Assistente IA desconectado da empresa.', 'sucesso');
    fechar();
  });
}

function papelSuporteAtual() {
  return String(usuarioAtual?.papelSuporte || 'suporte');
}

function suportePodeGerenciar() {
  return ['gerente_suporte', 'administrador_geral'].includes(papelSuporteAtual());
}

function suporteEhAdministradorGeral() {
  return papelSuporteAtual() === 'administrador_geral';
}

function renderizarEmpresasGlobais(empresas) {
  const lista = $('listaEmpresasGlobal');
  if (!lista) return;
  lista.replaceChildren();
  const termo = String($('buscaEmpresaGlobal')?.value || '').trim().toLowerCase();
  const filtradas = (empresas || []).filter((empresa) => !termo || [
    empresa.nome_fantasia, empresa.codigo, empresa.telefone_principal, empresa.contato_cobranca_whatsapp
  ]
    .some((valor) => String(valor || '').toLowerCase().includes(termo)));
  renderizarResumoCobrancasGlobais(empresas || []);
  if (!filtradas.length) {
    const vazio = document.createElement('p');
    vazio.className = 'historico-vazio';
    vazio.textContent = termo ? 'Nenhuma empresa corresponde à busca.' : 'Nenhuma empresa cadastrada.';
    lista.appendChild(vazio);
    return;
  }
  filtradas.forEach((empresa) => {
    const item = document.createElement('article');
    // A empresa interna não pode depender do código textual "suporte":
    // o Administrador Geral pode alterar esse código sem transformar a
    // central em uma empresa cliente comum.
    const empresaInternaSuporte = String(empresa.id || '') === String(usuarioAtual?.empresaId || '')
      || String(empresa.codigo || '').toLowerCase() === 'suporte';
    item.className = 'suporte-empresa-card' + (empresaInternaSuporte ? ' suporte-empresa-interna' : '');
    const topo = document.createElement('div');
    topo.className = 'suporte-empresa-topo';
    const identificacao = document.createElement('div');
    const titulo = document.createElement('strong');
    titulo.textContent = empresa.nome_fantasia || empresa.codigo || 'Empresa sem nome';
    const codigo = document.createElement('div');
    codigo.className = 'suporte-empresa-codigo';
    codigo.textContent = 'Código: ' + (empresa.codigo || '—');
    identificacao.append(titulo, codigo);
    const vencimento = empresa.data_vencimento || empresa.fim_trial;
    const vencimentoMs = vencimento ? new Date(vencimento).getTime() : NaN;
    // O painel precisa refletir a data real mesmo antes do próximo job do
    // Supabase atualizar a coluna licenca_status. Isso evita exibir "ativa"
    // para uma empresa que já deve entrar somente na tela de renovação.
    const statusPersistido = String(empresa.licenca_status || '').toLowerCase();
    const statusAtual = empresaInternaSuporte
      ? statusPersistido
      : (empresa.ativo !== false && Number.isFinite(vencimentoMs) && vencimentoMs <= Date.now()
          && !['bloqueada', 'suspensa', 'cancelada'].includes(statusPersistido)
        ? 'vencida'
        : statusPersistido);
    const badge = document.createElement('span');
    badge.className = 'suporte-badge-status ' + (statusAtual || 'sem-status');
    badge.textContent = formatarStatusLicenca(statusAtual);
    topo.append(identificacao, badge);
    const detalhe = document.createElement('div');
    detalhe.className = 'suporte-empresa-detalhes';
    const plano = Array.isArray(empresa.plano) ? empresa.plano[0]?.nome : empresa.plano?.nome;
    const linhasDetalhe = empresaInternaSuporte ? [
      'Empresa interna e separada dos clientes',
      'Cargos exclusivos: Suporte, Gerente de suporte e Administrador geral',
      'Usuários da equipe: ' + Number(empresa.usuarios_ativos || 0)
    ] : [
      'Plano: ' + (plano || 'Não definido'),
      vencimento ? 'Vencimento: ' + new Date(vencimento).toLocaleDateString('pt-BR') : 'Vencimento não definido',
      empresa.ultimo_pagamento_em ? 'Último pagamento: ' + new Date(empresa.ultimo_pagamento_em).toLocaleDateString('pt-BR') : 'Nenhum pagamento registrado',
      'Usuários ativos: ' + Number(empresa.usuarios_ativos || 0) + '/' + (empresa.limite_usuarios || '—') +
        ' · Dispositivos permitidos: ' + (empresa.limite_dispositivos || '—')
    ];
    linhasDetalhe.push(
      empresa.empresa_sem_telefone === true || !telefoneSomenteDigitos(empresa.telefone_principal)
        ? 'Telefone da empresa: não possui'
        : 'Telefone da empresa: ' + formatarTelefoneEmpresa(empresa.telefone_principal),
      telefoneSomenteDigitos(empresa.contato_cobranca_whatsapp)
        ? 'WhatsApp de cobrança: ' + formatarTelefoneEmpresa(empresa.contato_cobranca_whatsapp)
        : 'WhatsApp de cobrança: não informado'
    );
    linhasDetalhe.forEach((texto) => { const linha = document.createElement('span'); linha.textContent = texto; detalhe.appendChild(linha); });
    const acoes = document.createElement('div');
    acoes.className = 'linha-acoes';
    const acessoBloqueado = ['bloqueada', 'suspensa', 'cancelada'].includes(statusAtual);
    acoes.append(criarBotaoSuporte('Usuários', 'botao-primario', () => gerenciarAcessosEmpresaGlobal(empresa)));
    acoes.append(
      criarBotaoSuporte('Alterar nome', 'botao-secundario', () => alterarNomeEmpresaGlobal(empresa)),
      criarBotaoSuporte('Alterar código', 'botao-secundario', () => alterarCodigoEmpresaGlobal(empresa))
    );
    if (suportePodeGerenciar()) {
      acoes.append(criarBotaoSuporte('Telefones', 'botao-secundario', () => editarTelefonesEmpresaGlobal(empresa)));
    }
    if (suportePodeGerenciar() && !empresaInternaSuporte) {
      const trocaRapidaAtiva = empresa.recursos_habilitados?.troca_rapida_contas === true;
      const fiscalAtivo = empresa.recursos_habilitados?.fiscal_habilitado === true;
      acoes.append(
        criarBotaoSuporte('Assistente IA', 'botao-secundario', () => abrirIntegracaoIAEmpresaGlobal(empresa)),
        criarBotaoSuporte('Plano e acesso', 'botao-secundario', () => editarLicencaGlobal(empresa)),
        criarBotaoSuporte('Pagamento', 'botao-secundario', () => confirmarPagamentoGlobal(empresa)),
        criarBotaoSuporte('Adicionar dias', 'botao-secundario', () => adicionarDiasLicencaGlobal(empresa)),
        criarBotaoSuporte('Remover dias', 'botao-secundario', () => removerDiasLicencaGlobal(empresa)),
        criarBotaoSuporte(trocaRapidaAtiva ? 'Desativar troca rápida' : 'Ativar troca rápida', 'botao-secundario', () => configurarTrocaRapidaEmpresaGlobal(empresa, !trocaRapidaAtiva)),
        criarBotaoSuporte(acessoBloqueado ? 'Reativar' : 'Bloquear', acessoBloqueado ? 'botao-secundario' : 'botao-perigo', () => alterarAcessoEmpresaGlobal(empresa, acessoBloqueado ? 'ativa' : 'bloqueada')),
        criarBotaoSuporte('Arquivar', 'botao-perigo', () => arquivarEmpresaGlobal(empresa))
      );
      if (suporteEhAdministradorGeral()) {
        acoes.appendChild(criarBotaoSuporte(
          fiscalAtivo ? 'Ocultar fiscal' : 'Liberar fiscal',
          fiscalAtivo ? 'botao-perigo' : 'botao-secundario',
          () => configurarFiscalEmpresaGlobal(empresa, !fiscalAtivo)
        ));
      }
    }
    if (!empresaInternaSuporte) {
      acoes.append(criarBotaoSuporte(suporteEhAdministradorGeral() ? 'Solicitar exclusão' : 'Enviar para exclusão', 'botao-perigo', () => solicitarExclusaoEmpresaGlobal(empresa)));
    }
    item.append(topo, detalhe, acoes);
    lista.appendChild(item);
  });
}

async function alterarNomeEmpresaGlobal(empresa) {
  const novoNome = await promptModal(
    'Novo nome da empresa:',
    empresa.nome_fantasia || '', { titulo: 'Alterar nome — ' + (empresa.nome_fantasia || empresa.codigo) }
  );
  if (novoNome === null) return;
  const nome = String(novoNome).trim().replace(/\s+/g, ' ');
  if (nome.length < 2 || nome.length > 120) {
    throw new Error('Informe um nome de empresa entre 2 e 120 caracteres.');
  }
  if (nome === String(empresa.nome_fantasia || '').trim()) return;
  const confirmado = await confirmModal(
    'O nome exibido para a empresa passará a ser “' + nome + '”. Deseja continuar?',
    { titulo: 'Confirmar alteração do nome' }
  );
  if (!confirmado) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('alterar_nome_empresa', {
    empresaId: empresa.id, novoNome: nome
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível alterar o nome da empresa.');
  toast('Nome da empresa alterado para “' + nome + '”.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function alterarCodigoEmpresaGlobal(empresa) {
  const novoCodigo = await promptModal(
    'Novo código da empresa (letras, números e hífen):',
    empresa.codigo || '', { titulo: 'Alterar código — ' + (empresa.nome_fantasia || empresa.codigo) }
  );
  if (novoCodigo === null) return;
  const normalizado = String(novoCodigo).trim().toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(normalizado)) {
    throw new Error('Use de 3 a 40 caracteres: letras, números e hífen.');
  }
  if (normalizado === String(empresa.codigo || '').toLowerCase()) return;
  const confirmado = await confirmModal(
    'O login de todos os usuários passará a usar o código “' + normalizado + '”. Deseja continuar?',
    { titulo: 'Confirmar alteração do código' }
  );
  if (!confirmado) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('alterar_codigo_empresa', {
    empresaId: empresa.id, novoCodigo: normalizado
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível alterar o código da empresa.');
  toast('Código alterado. Os usuários já podem entrar usando “' + normalizado + '”.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

function formatarStatusSolicitacaoExclusao(status) {
  return ({
    pendente: 'Pendente', aprovada: 'Aprovada', negada: 'Negada',
    executada: 'Executada', falhou: 'Falhou'
  })[status] || status || 'Pendente';
}

function renderizarSolicitacoesExclusao(solicitacoes) {
  const secao = $('secaoSolicitacoesExclusao');
  const lista = $('listaSolicitacoesExclusao');
  if (!secao || !lista) return;
  secao.hidden = !usuarioAtual?.administradorGlobal;
  if (secao.hidden) return;
  lista.replaceChildren();
  if (!solicitacoes?.length) {
    const vazio = document.createElement('p');
    vazio.className = 'historico-vazio';
    vazio.textContent = 'Nenhuma solicitação de exclusão registrada.';
    lista.appendChild(vazio);
    return;
  }
  solicitacoes.forEach((solicitacao) => {
    const item = document.createElement('article');
    item.className = 'suporte-solicitacao-card status-' + solicitacao.status;
    const cabecalho = document.createElement('div');
    cabecalho.className = 'suporte-empresa-topo';
    const titulo = document.createElement('strong');
    titulo.textContent = (solicitacao.tipo === 'empresa' ? 'Empresa: ' : 'Usuário: ') + solicitacao.alvo_rotulo;
    const badge = document.createElement('span');
    badge.className = 'suporte-badge-status ' + (solicitacao.status === 'executada' ? 'ativa' : solicitacao.status === 'falhou' || solicitacao.status === 'negada' ? 'bloqueada' : 'teste');
    badge.textContent = formatarStatusSolicitacaoExclusao(solicitacao.status);
    cabecalho.append(titulo, badge);
    const detalhe = document.createElement('p');
    detalhe.textContent = 'Empresa ' + solicitacao.empresa_codigo + ' · ' + solicitacao.motivo + ' · ' + new Date(solicitacao.criada_em).toLocaleString('pt-BR');
    item.append(cabecalho, detalhe);
    if (solicitacao.erro_execucao) {
      const erro = document.createElement('p');
      erro.className = 'mensagem-erro';
      erro.textContent = solicitacao.erro_execucao;
      item.appendChild(erro);
    }
    if (solicitacao.status === 'pendente' && suporteEhAdministradorGeral()) {
      const acoes = document.createElement('div');
      acoes.className = 'linha-acoes';
      acoes.append(
        criarBotaoSuporte('Aprovar e executar', 'botao-perigo', () => decidirSolicitacaoExclusaoGlobal(solicitacao, true)),
        criarBotaoSuporte('Negar', 'botao-secundario', () => decidirSolicitacaoExclusaoGlobal(solicitacao, false))
      );
      item.appendChild(acoes);
    }
    lista.appendChild(item);
  });
}

function nomePapelSuporte(papel) {
  return ({ suporte: 'Analista de Suporte', gerente_suporte: 'Gerente de Suporte', administrador_geral: 'Administrador Geral' })[papel] || papel;
}

function iniciaisMembroSuporte(membro) {
  const partes = String(membro?.nome || membro?.usuario || 'U')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((partes[0]?.[0] || 'U') + (partes.length > 1 ? partes.at(-1)[0] : '')).toUpperCase();
}

function renderizarEquipeSuporte(equipe) {
  const lista = $('listaEquipeSuporte');
  if (!lista) return;
  lista.replaceChildren();
  const contador = $('contadorEquipeSuporte');
  const total = Array.isArray(equipe) ? equipe.length : 0;
  if (contador) contador.textContent = `${total} ${total === 1 ? 'integrante' : 'integrantes'}`;
  if (!equipe?.length) {
    const vazio = document.createElement('p');
    vazio.className = 'historico-vazio';
    vazio.textContent = 'Nenhum usuário cadastrado na equipe central.';
    lista.appendChild(vazio);
    return;
  }
  equipe.forEach((membro) => {
    const item = document.createElement('article');
    item.className = `suporte-equipe-membro${membro.atual ? ' atual' : ''}`;
    const identificacao = document.createElement('div');
    identificacao.className = 'suporte-equipe-identidade';
    const avatar = document.createElement('span');
    avatar.className = 'suporte-equipe-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = iniciaisMembroSuporte(membro);
    const dados = document.createElement('div');
    dados.className = 'suporte-equipe-dados';
    const nomeLinha = document.createElement('div');
    nomeLinha.className = 'suporte-equipe-nome-linha';
    const titulo = document.createElement('strong');
    titulo.className = 'suporte-equipe-nome';
    titulo.textContent = membro.nome || membro.usuario || 'Usuário';
    nomeLinha.appendChild(titulo);
    if (membro.atual) {
      const voce = document.createElement('span');
      voce.className = 'suporte-equipe-voce';
      voce.textContent = 'Você';
      nomeLinha.appendChild(voce);
    }
    const detalhe = document.createElement('span');
    detalhe.className = 'suporte-equipe-usuario';
    detalhe.textContent = '@' + (membro.usuario || '—');
    dados.append(nomeLinha, detalhe);
    identificacao.append(avatar, dados);
    const controles = document.createElement('div');
    controles.className = 'suporte-equipe-controles';
    const badge = document.createElement('span');
    badge.className = `suporte-equipe-cargo papel-${membro.papel || 'suporte'}`;
    badge.textContent = nomePapelSuporte(membro.papel);
    controles.appendChild(badge);
    if (suporteEhAdministradorGeral()) {
      const botao = criarBotaoSuporte('Alterar cargo', 'botao-secundario', () => alterarPapelEquipeSuporte(membro));
      botao.classList.add('botao-pequeno', 'suporte-equipe-alterar');
      botao.setAttribute('aria-label', `Alterar cargo de ${membro.nome || membro.usuario || 'usuário'}`);
      controles.appendChild(botao);
    }
    item.append(identificacao, controles);
    lista.appendChild(item);
  });
}

async function alterarPapelEquipeSuporte(membro) {
  const papel = await escolherOpcaoModal({
    titulo: `Alterar cargo de ${membro.nome || membro.usuario || 'usuário'}`,
    largura: '760px',
    alternativas: [
      {
        valor: 'administrador_geral',
        titulo: 'Administrador Geral',
        descricao: 'Acesso completo, incluindo aprovações, configurações e exclusões.'
      },
      {
        valor: 'gerente_suporte',
        titulo: 'Gerente de Suporte',
        descricao: 'Administra empresas e usuários, sem acesso às decisões exclusivas do administrador.'
      },
      {
        valor: 'suporte',
        titulo: 'Analista de Suporte',
        descricao: 'Consulta dados, atende chamados e envia pedidos de exclusão.'
      }
    ]
  });
  if (papel === null || papel === membro.papel) return;
  if (!['suporte', 'gerente_suporte', 'administrador_geral'].includes(papel)) {
    throw new Error('Cargo inválido.');
  }
  const resposta = await window.api.supabaseadministracaoglobal?.('definir_papel_suporte', {
    usuarioId: membro.usuario_id, papel
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível alterar o cargo.');
  toast('Cargo da equipe atualizado.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function definirSenhaExclusaoGlobal() {
  const senha = await promptModal('Defina uma senha administrativa com no mínimo 8 caracteres:', '', { titulo: 'Senha de exclusão', senha: true });
  if (senha === null) return;
  if (String(senha).length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  const repetir = await promptModal('Repita a senha administrativa:', '', { titulo: 'Confirmar senha', senha: true });
  if (repetir === null) return;
  if (senha !== repetir) throw new Error('As senhas não coincidem.');
  const resposta = await window.api.supabaseadministracaoglobal?.('definir_senha_exclusao', { senha: String(senha) });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível definir a senha.');
  toast('Senha administrativa de exclusão atualizada.', 'sucesso');
}

async function decidirSolicitacaoExclusaoGlobal(solicitacao, aprovar) {
  const observacao = await promptModal(
    aprovar ? 'Observação da aprovação (opcional):' : 'Explique por que a solicitação será negada:',
    '', { titulo: aprovar ? 'Aprovar exclusão definitiva' : 'Negar solicitação' }
  );
  if (observacao === null) return;
  if (!aprovar && String(observacao).trim().length < 3) throw new Error('Informe o motivo da negativa.');
  const senha = await promptModal('Digite sua senha administrativa de exclusão:', '', { titulo: 'Confirmação protegida', senha: true });
  if (senha === null) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('decidir_exclusao', {
    solicitacaoId: solicitacao.id, aprovar, senha: String(senha), observacao: String(observacao).trim()
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível decidir a solicitação.');
  toast(aprovar ? 'Exclusão aprovada e executada.' : 'Solicitação negada.', 'sucesso');
  await atualizarPainelGlobalSistema();
  if (empresaUsuariosGlobal && solicitacao.tipo === 'usuario' && solicitacao.empresa_id === empresaUsuariosGlobal.id) {
    await carregarUsuariosEmpresaGlobal();
  }
}

function formatarPrecoPlano(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function renderizarPlanosGlobais(planos, mostrar) {
  const lista = $('listaPlanosGlobal');
  const secao = $('secaoPlanosGlobal');
  if (!lista || !secao) return;
  secao.hidden = !mostrar;
  if (!mostrar) return;
  lista.replaceChildren();
  if (!planos?.length) {
    const vazio = document.createElement('p');
    vazio.className = 'historico-vazio';
    vazio.textContent = 'Nenhum plano cadastrado. Use “Novo plano” para criar o primeiro.';
    lista.appendChild(vazio);
    return;
  }
  planos.forEach((plano) => {
    const item = document.createElement('div');
    item.className = 'item-lista-historico';
    const titulo = document.createElement('strong');
    titulo.textContent = plano.nome;
    const detalhe = document.createElement('div');
    detalhe.className = 'campo-desc';
    detalhe.textContent = [
      plano.ativo ? 'Ativo' : 'Inativo',
      formatarPrecoPlano(plano.preco_referencia),
      (plano.duracao_dias || '—') + ' dias',
      (plano.limites?.usuarios || '—') + ' usuário(s)',
      (plano.recursos || []).filter((item) => item.habilitado !== false).length + ' função(ões)'
    ].join(' · ');
    const editar = document.createElement('button');
    editar.type = 'button';
    editar.className = 'botao botao-secundario botao-pequeno';
    editar.style.marginTop = '10px';
    editar.textContent = 'Editar plano';
    editar.addEventListener('click', () => salvarPlanoGlobal(plano).catch((erro) => toast(erro.message || String(erro), 'erro')));
    item.append(titulo, detalhe, editar);
    lista.appendChild(item);
  });
}

function textoOrigemChamado(origem) {
  return ({ login_pc: 'Login do PC', login_celular: 'Login do celular', config_pc: 'Configurações do PC', config_celular: 'Configurações do celular' })[String(origem || '')] || 'Origem não informada';
}

function textoStatusChamado(status) {
  return ({ aberto: 'Aberto', em_atendimento: 'Em atendimento', resolvido: 'Resolvido', fechado: 'Fechado' })[String(status || '')] || 'Aberto';
}

function textoMotivoChamado(motivo, outro) {
  if (motivo === 'outro' && outro) return outro;
  return ({
    trial_assinatura: 'Trial / assinatura', cobranca_pagamento: 'Cobrança / pagamento',
    acesso_login: 'Acesso / login', sincronizacao_backup: 'Sincronização / backup',
    documento_assinatura: 'Documento / assinatura', erro_sistema: 'Erro no sistema',
    configuracao_integracao: 'Configuração / integração', duvida_funcionalidade: 'Dúvida',
    sugestao: 'Sugestão', outro: 'Outro motivo'
  })[String(motivo || '')] || 'Motivo não informado';
}

function renderizarChamadosSuporte(chamados) {
  const lista = $('listaChamadosSuporte');
  if (!lista) return;
  lista.replaceChildren();
  if (!chamados?.length) {
    const vazio = document.createElement('p');
    vazio.className = 'historico-vazio';
    vazio.textContent = 'Nenhum chamado recebido.';
    lista.appendChild(vazio);
    return;
  }
  chamados.forEach((chamado) => {
    const item = document.createElement('article');
    item.className = 'item-lista-historico';
    const titulo = document.createElement('strong');
    titulo.textContent = 'CH-' + String(chamado.id || '').slice(0, 8).toUpperCase() + ' — ' + (chamado.empresa?.nome_fantasia || chamado.empresa?.codigo || 'Empresa removida');
    const detalhes = document.createElement('div');
    detalhes.className = 'campo-desc';
    detalhes.textContent = [textoStatusChamado(chamado.status), textoOrigemChamado(chamado.origem), textoMotivoChamado(chamado.motivo, chamado.motivo_outro), chamado.contato_nome || 'Nome não informado', chamado.contato_usuario ? `usuário ${chamado.contato_usuario}` : '', chamado.criado_em ? new Date(chamado.criado_em).toLocaleString('pt-BR') : ''].filter(Boolean).join(' · ');
    const contato = document.createElement('div');
    contato.className = 'campo-desc';
    contato.style.marginTop = '5px';
    contato.textContent = [chamado.telefone_contato ? `Tel. ${chamado.telefone_contato}` : '', chamado.email_contato || '', chamado.preferencia_contato ? `retorno por ${chamado.preferencia_contato}` : '', chamado.cargo_outro || chamado.cargo_empresa || ''].filter(Boolean).join(' · ');
    const texto = document.createElement('p');
    texto.style.cssText = 'white-space:pre-wrap;margin:8px 0 0;';
    texto.textContent = chamado.mensagem || '';
    item.append(titulo, detalhes, contato, texto);
    if (chamado.resolucao) {
      const resolucao = document.createElement('p');
      resolucao.className = 'campo-desc';
      resolucao.style.marginTop = '8px';
      resolucao.textContent = 'Resposta: ' + chamado.resolucao;
      item.appendChild(resolucao);
    }
    const acoes = document.createElement('div');
    acoes.className = 'linha-acoes';
    acoes.style.marginTop = '10px';
    if (chamado.status === 'aberto') {
      const assumir = document.createElement('button');
      assumir.type = 'button'; assumir.className = 'botao botao-secundario botao-pequeno'; assumir.textContent = 'Assumir';
      assumir.addEventListener('click', () => atualizarChamadoSuporte(chamado, 'em_atendimento').catch((erro) => toast(erro.message || String(erro), 'erro')));
      acoes.appendChild(assumir);
    }
    if (!['resolvido', 'fechado'].includes(String(chamado.status))) {
      const resolver = document.createElement('button');
      resolver.type = 'button'; resolver.className = 'botao botao-primario botao-pequeno'; resolver.textContent = 'Finalizar';
      resolver.addEventListener('click', () => atualizarChamadoSuporte(chamado, 'resolvido').catch((erro) => toast(erro.message || String(erro), 'erro')));
      acoes.appendChild(resolver);
    } else {
      const reabrir = document.createElement('button');
      reabrir.type = 'button'; reabrir.className = 'botao botao-secundario botao-pequeno'; reabrir.textContent = 'Reabrir';
      reabrir.addEventListener('click', () => atualizarChamadoSuporte(chamado, 'aberto').catch((erro) => toast(erro.message || String(erro), 'erro')));
      acoes.appendChild(reabrir);
    }
    const conversa = document.createElement('button');
    conversa.type = 'button'; conversa.className = 'botao botao-secundario botao-pequeno';
    conversa.textContent = (chamado.nao_lidas_suporte ? '(' + chamado.nao_lidas_suporte + ') ' : '') + 'Abrir conversa';
    conversa.addEventListener('click', () => window.SistemaOSChamados?.abrirSuporte?.(chamado)
      .catch((erro) => toast(erro.message || String(erro), 'erro')));
    const copiar = document.createElement('button');
    copiar.type = 'button'; copiar.className = 'botao botao-fantasma botao-pequeno'; copiar.textContent = 'Copiar protocolo';
    copiar.addEventListener('click', () => copiarProtocoloChamado(chamado).catch((erro) => toast(erro.message || String(erro), 'erro')));
    const excluir = document.createElement('button');
    excluir.type = 'button'; excluir.className = 'botao botao-perigo botao-pequeno'; excluir.textContent = 'Excluir';
    excluir.addEventListener('click', () => excluirChamadoSuporte(chamado).catch((erro) => toast(erro.message || String(erro), 'erro')));
    acoes.append(conversa, copiar, excluir);
    item.appendChild(acoes);
    lista.appendChild(item);
  });
}

async function copiarProtocoloChamado(chamado) {
  const protocolo = chamado.protocolo || ('CH-' + String(chamado.id || '').slice(0, 8).toUpperCase());
  await navigator.clipboard.writeText(protocolo);
  toast('Protocolo ' + protocolo + ' copiado.', 'sucesso');
}

async function excluirChamadoSuporte(chamado) {
  const protocolo = chamado.protocolo || ('CH-' + String(chamado.id || '').slice(0, 8).toUpperCase());
  const confirmado = await confirmModal(
    'Excluir permanentemente o chamado ' + protocolo + '?\n\nA conversa e todas as mensagens deste chamado também serão apagadas. Esta ação não pode ser desfeita.',
    { titulo: 'Excluir chamado' }
  );
  if (!confirmado) return;
  const digitado = await promptModal('Digite ' + protocolo + ' para confirmar:', '', { titulo: 'Confirmação final' });
  if (digitado === null) return;
  if (String(digitado).trim().toUpperCase() !== protocolo.toUpperCase()) throw new Error('Protocolo de confirmação incorreto.');
  const resultado = await window.api.supabaseadministrarchamadosuporte?.('excluir', { chamadoId: chamado.id });
  if (!resultado?.sucesso) throw new Error(resultado?.erro || 'Não foi possível excluir o chamado.');
  toast('Chamado ' + protocolo + ' excluído.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function atualizarChamadoSuporte(chamado, status) {
  let resolucao = '';
  if (status === 'resolvido' || status === 'fechado') {
    const resposta = await promptModal(status === 'resolvido' ? 'Resumo da solução (opcional):' : 'Motivo do fechamento (opcional):', '', { titulo: 'Chamado de suporte' });
    if (resposta === null) return;
    resolucao = String(resposta).trim();
  }
  const resultado = await window.api.supabaseadministrarchamadosuporte?.('atualizar', { chamadoId: chamado.id, status, resolucao });
  if (!resultado?.sucesso) throw new Error(resultado?.erro || 'Não foi possível atualizar o chamado.');
  toast('Chamado atualizado.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

function renderizarErrosUsuarios(erros) {
  const lista = $('listaErrosUsuarios');
  if (!lista) return;
  lista.replaceChildren();
  if (!erros?.length) {
    const vazio = document.createElement('p');
    vazio.className = 'historico-vazio';
    vazio.textContent = 'Nenhum erro técnico recebido.';
    lista.appendChild(vazio);
    return;
  }
  erros.forEach((registro) => {
    const item = document.createElement('article');
    item.className = 'item-lista-historico';
    const empresa = Array.isArray(registro.empresa) ? registro.empresa[0] : registro.empresa;
    const titulo = document.createElement('strong');
    titulo.textContent = (empresa?.nome_fantasia || empresa?.codigo || 'Empresa removida') + ' — ' + String(registro.origem || '').toUpperCase();
    const meta = document.createElement('div');
    meta.className = 'campo-desc';
    meta.textContent = [registro.status, registro.prioridade, registro.tela, registro.versao ? 'v' + registro.versao : '', registro.dispositivo, registro.criado_em ? new Date(registro.criado_em).toLocaleString('pt-BR') : ''].filter(Boolean).join(' · ');
    const mensagem = document.createElement('p');
    mensagem.style.cssText = 'white-space:pre-wrap;margin:8px 0;word-break:break-word;';
    mensagem.textContent = registro.mensagem || 'Erro sem mensagem.';
    const acoes = document.createElement('div');
    acoes.className = 'linha-acoes';
    ['analisando', 'resolvido', 'ignorado'].forEach((statusNovo) => {
      if (statusNovo === registro.status) return;
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = statusNovo === 'resolvido' ? 'botao botao-primario botao-pequeno' : 'botao botao-secundario botao-pequeno';
      botao.textContent = statusNovo === 'analisando' ? 'Analisar' : statusNovo === 'resolvido' ? 'Resolver' : 'Ignorar';
      botao.addEventListener('click', async () => {
        botao.disabled = true;
        try {
          const resposta = await window.api.supabaseadministracaoglobal?.('atualizar_erro_usuario', { erroId: registro.id, status: statusNovo });
          if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível atualizar o relatório.');
          toast('Relatório de erro atualizado.', 'sucesso');
          await atualizarPainelGlobalSistema();
        } catch (erro) {
          toast(erro.message || String(erro), 'erro');
          botao.disabled = false;
        }
      });
      acoes.appendChild(botao);
    });
    item.append(titulo, meta, mensagem, acoes);
    lista.appendChild(item);
  });
}

async function atualizarPainelGlobalSistema() {
  const painel = $('painelGlobalSistema');
  if (!painel) return;
  const permitido = !!usuarioAtual?.administradorGlobal;
  painel.hidden = !permitido;
  if (!permitido) return;
  const botao = $('btnAtualizarEmpresasGlobal');
  const status = $('statusPainelGlobal');
  const textoOriginal = botao?.textContent || 'Atualizar lista';
  if (botao) { botao.disabled = true; botao.textContent = 'Atualizando…'; }
  if (status) status.textContent = 'Buscando os dados mais recentes…';
  try {
    const [empresasResposta, planosResposta, chamadosResposta, exclusoesResposta, equipeResposta, errosResposta] = await Promise.all([
      window.api.supabaseadministracaoglobal?.('listar_empresas', {}),
      window.api.supabaseadministracaoglobal?.('listar_planos', {}),
      window.api.supabaseadministrarchamadosuporte?.('listar', {}),
      window.api.supabaseadministracaoglobal?.('listar_solicitacoes_exclusao', {}),
      window.api.supabaseadministracaoglobal?.('listar_equipe_suporte', {}),
      window.api.supabaseadministracaoglobal?.('listar_erros_usuarios', {})
    ]);
    if (!empresasResposta?.sucesso) throw new Error(empresasResposta?.erro || 'Não foi possível listar as empresas.');
    empresasGlobaisCache = empresasResposta.empresas || [];
    planosGlobaisCache = planosResposta?.sucesso ? planosResposta.planos || [] : [];
    chamadosGlobaisCache = chamadosResposta?.sucesso ? chamadosResposta.chamados || [] : [];
    solicitacoesExclusaoCache = exclusoesResposta?.sucesso ? exclusoesResposta.solicitacoes || [] : [];
    equipeSuporteCache = equipeResposta?.sucesso ? equipeResposta.equipe || [] : [];
    errosUsuariosCache = errosResposta?.sucesso ? errosResposta.erros || [] : [];
    renderizarEmpresasGlobais(empresasGlobaisCache);
    renderizarPlanosGlobais(planosGlobaisCache, painelPlanosGlobalAberto);
    renderizarChamadosSuporte(chamadosGlobaisCache);
    renderizarSolicitacoesExclusao(solicitacoesExclusaoCache);
    renderizarEquipeSuporte(equipeSuporteCache);
    renderizarErrosUsuarios(errosUsuariosCache);
    renderizarMetricasSuporteGlobal(empresasGlobaisCache, chamadosGlobaisCache);
    if (status) status.textContent = 'Atualizado em ' + new Date().toLocaleString('pt-BR') + '.';
    return { empresas: empresasGlobaisCache, planos: planosGlobaisCache, chamados: chamadosGlobaisCache, solicitacoes: solicitacoesExclusaoCache };
  } catch (erro) {
    if (status) status.textContent = 'Falha ao atualizar: ' + (erro.message || String(erro));
    throw erro;
  } finally {
    if (botao) { botao.disabled = false; botao.textContent = textoOriginal; }
  }
}

function telefoneSomenteDigitos(valor) {
  return String(valor || '').replace(/\D/g, '').slice(0, 15);
}

function telefoneValidoFormulario(valor) {
  const telefone = telefoneSomenteDigitos(valor);
  return telefone.length >= 10 && telefone.length <= 15;
}

function formatarTelefoneEmpresa(valor) {
  const telefone = telefoneSomenteDigitos(valor);
  if (!telefone) return '';
  const nacional = telefone.startsWith('55') && telefone.length >= 12 ? telefone.slice(2) : telefone;
  if (nacional.length === 11) return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  if (nacional.length === 10) return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  return '+' + telefone;
}

function abrirFormularioNovaEmpresaGlobal() {
  return new Promise((resolve) => {
    $('modalNovaEmpresaGlobal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modalNovaEmpresaGlobal';
    overlay.className = 'modal-fundo';
    overlay.style.zIndex = '11000';
    const caixa = document.createElement('form');
    caixa.className = 'modal-caixa suporte-nova-empresa-modal';
    caixa.noValidate = true;
    caixa.innerHTML = `
      <div class="modal-cabecalho suporte-nova-empresa-cabecalho">
        <div><h2>Nova empresa</h2><p>Cadastre a empresa, os contatos e o primeiro acesso em uma única tela.</p></div>
        <button type="button" class="botao botao-fantasma suporte-fechar-modal" aria-label="Fechar">${ICONE_X}</button>
      </div>
      <div class="suporte-nova-empresa-conteudo">
        <section class="suporte-form-bloco">
          <div class="suporte-form-bloco-titulo"><span>1</span><div><strong>Empresa</strong><small>Identificação usada no acesso ao Sistema OS.</small></div></div>
          <div class="grade-2">
            <div class="campo"><label for="novaEmpresaNome">Nome da empresa <span class="obrigatorio">*</span></label><input id="novaEmpresaNome" type="text" maxlength="120" autocomplete="organization" placeholder="Ex.: TechReparos" /></div>
            <div class="campo"><label for="novaEmpresaCodigo">Código de login <span class="obrigatorio">*</span></label><input id="novaEmpresaCodigo" type="text" maxlength="40" autocapitalize="none" autocomplete="off" placeholder="ex.: techreparos" /><small class="dica-campo">Letras, números e hífen. Os usuários informarão este código no login.</small></div>
          </div>
        </section>
        <section class="suporte-form-bloco">
          <div class="suporte-form-bloco-titulo"><span>2</span><div><strong>Telefones</strong><small>O telefone da empresa e o WhatsApp de cobrança ficam separados.</small></div></div>
          <div class="grade-2">
            <div class="campo"><label for="novaEmpresaTelefone">Telefone principal <span class="obrigatorio">*</span></label><input id="novaEmpresaTelefone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" placeholder="(31) 99999-9999" /><label class="suporte-check-linha"><input id="novaEmpresaSemTelefone" type="checkbox" /> <span>Empresa sem telefone</span></label></div>
            <div class="campo"><label for="novaEmpresaTelefoneCobranca">WhatsApp para cobrança <span class="campo-opcional">opcional</span></label><input id="novaEmpresaTelefoneCobranca" type="tel" inputmode="tel" maxlength="20" autocomplete="off" placeholder="Número que receberá avisos da assinatura" /><label class="suporte-check-linha"><input id="novaEmpresaUsarTelefoneCobranca" type="checkbox" checked /> <span>Usar o telefone principal</span></label></div>
          </div>
          <p class="suporte-form-aviso">O WhatsApp de cobrança é o número do dono da assistência que receberá vencimentos e links de renovação. Ele pode ser alterado ou removido depois.</p>
        </section>
        <section class="suporte-form-bloco">
          <div class="suporte-form-bloco-titulo"><span>3</span><div><strong>Administrador inicial</strong><small>Primeiro usuário com acesso completo à empresa.</small></div></div>
          <div class="grade-2">
            <div class="campo"><label for="novaEmpresaAdminNome">Nome do administrador <span class="obrigatorio">*</span></label><input id="novaEmpresaAdminNome" type="text" maxlength="80" value="Administrador" autocomplete="name" /></div>
            <div class="campo"><label for="novaEmpresaAdminUsuario">Usuário <span class="obrigatorio">*</span></label><input id="novaEmpresaAdminUsuario" type="text" maxlength="30" value="admin" autocapitalize="none" autocomplete="username" /></div>
            <div class="campo"><label for="novaEmpresaAdminSenha">Senha inicial <span class="obrigatorio">*</span></label><input id="novaEmpresaAdminSenha" type="password" minlength="8" autocomplete="new-password" placeholder="Mínimo de 8 caracteres" /></div>
            <div class="campo"><label for="novaEmpresaDiasTrial">Período de teste</label><div class="suporte-campo-sufixo"><input id="novaEmpresaDiasTrial" type="number" value="45" readonly aria-readonly="true" /><span>dias</span></div><p class="campo-desc">Plano Trial completo com prazo fixo.</p></div>
          </div>
        </section>
        <p id="novaEmpresaErro" class="mensagem-erro suporte-form-erro" hidden></p>
      </div>
      <div class="modal-rodape suporte-nova-empresa-rodape">
        <button type="button" class="botao botao-fantasma suporte-cancelar-modal">Cancelar</button>
        <button type="submit" class="botao botao-primario">Criar empresa</button>
      </div>`;
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    const campo = (id) => caixa.querySelector('#' + id);
    const telefone = campo('novaEmpresaTelefone');
    const semTelefone = campo('novaEmpresaSemTelefone');
    const telefoneCobranca = campo('novaEmpresaTelefoneCobranca');
    const usarPrincipal = campo('novaEmpresaUsarTelefoneCobranca');
    const erro = campo('novaEmpresaErro');
    let resolvido = false;
    const finalizar = (valor) => {
      if (resolvido) return;
      resolvido = true;
      document.removeEventListener('keydown', aoTeclar);
      overlay.remove();
      resolve(valor);
    };
    const sincronizarContatos = () => {
      telefone.disabled = semTelefone.checked;
      usarPrincipal.disabled = semTelefone.checked;
      if (semTelefone.checked && usarPrincipal.checked) usarPrincipal.checked = false;
      telefoneCobranca.disabled = usarPrincipal.checked;
      if (usarPrincipal.checked) telefoneCobranca.value = telefone.value;
    };
    const mostrarErro = (mensagem, alvo) => {
      erro.textContent = mensagem;
      erro.hidden = false;
      alvo?.focus();
    };
    semTelefone.addEventListener('change', sincronizarContatos);
    usarPrincipal.addEventListener('change', sincronizarContatos);
    telefone.addEventListener('input', sincronizarContatos);
    caixa.addEventListener('submit', (evento) => {
      evento.preventDefault();
      erro.hidden = true;
      const dados = {
        nome: campo('novaEmpresaNome').value.trim().replace(/\s+/g, ' '),
        codigo: campo('novaEmpresaCodigo').value.trim().toLowerCase(),
        telefonePrincipal: telefoneSomenteDigitos(telefone.value),
        semTelefone: semTelefone.checked,
        telefoneCobranca: telefoneSomenteDigitos(usarPrincipal.checked ? telefone.value : telefoneCobranca.value),
        nomeAdministrador: campo('novaEmpresaAdminNome').value.trim().replace(/\s+/g, ' '),
        usuario: campo('novaEmpresaAdminUsuario').value.trim().toLowerCase(),
        senha: campo('novaEmpresaAdminSenha').value,
        diasTrial: Number(campo('novaEmpresaDiasTrial').value)
      };
      if (dados.nome.length < 2) return mostrarErro('Informe o nome da empresa.', campo('novaEmpresaNome'));
      if (!/^[a-z0-9-]{3,40}$/.test(dados.codigo)) return mostrarErro('Use de 3 a 40 caracteres no código: letras, números e hífen.', campo('novaEmpresaCodigo'));
      if (!dados.semTelefone && !telefoneValidoFormulario(dados.telefonePrincipal)) return mostrarErro('Informe o telefone principal com DDD ou marque “Empresa sem telefone”.', telefone);
      if (dados.telefoneCobranca && !telefoneValidoFormulario(dados.telefoneCobranca)) return mostrarErro('Confira o WhatsApp de cobrança. Ele deve ter DDD e de 10 a 15 dígitos.', telefoneCobranca);
      if (!dados.nomeAdministrador) return mostrarErro('Informe o nome do administrador.', campo('novaEmpresaAdminNome'));
      if (!/^[a-z0-9._-]{3,30}$/.test(dados.usuario)) return mostrarErro('O usuário deve ter de 3 a 30 caracteres: letras, números, ponto, hífen ou sublinhado.', campo('novaEmpresaAdminUsuario'));
      if (dados.senha.length < 8) return mostrarErro('A senha inicial deve ter pelo menos 8 caracteres.', campo('novaEmpresaAdminSenha'));
      if (dados.diasTrial !== 45) return mostrarErro('O período Trial deve ter 45 dias.', campo('novaEmpresaDiasTrial'));
      finalizar(dados);
    });
    const aoTeclar = (evento) => { if (evento.key === 'Escape') { evento.preventDefault(); finalizar(null); } };
    document.addEventListener('keydown', aoTeclar);
    caixa.querySelector('.suporte-fechar-modal').addEventListener('click', () => finalizar(null));
    caixa.querySelector('.suporte-cancelar-modal').addEventListener('click', () => finalizar(null));
    overlay.addEventListener('mousedown', (evento) => { if (evento.target === overlay) finalizar(null); });
    sincronizarContatos();
    campo('novaEmpresaNome').focus();
  });
}

function abrirFormularioTelefonesEmpresaGlobal(empresa) {
  return new Promise((resolve) => {
    $('modalTelefonesEmpresaGlobal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'modalTelefonesEmpresaGlobal';
    overlay.className = 'modal-fundo';
    overlay.style.zIndex = '11000';
    const caixa = document.createElement('form');
    caixa.className = 'modal-caixa suporte-telefones-empresa-modal';
    caixa.noValidate = true;
    caixa.innerHTML = `
      <div class="modal-cabecalho suporte-nova-empresa-cabecalho"><div><h2>Telefones da empresa</h2><p>Contato geral e cobrança são informações independentes.</p></div><button type="button" class="botao botao-fantasma suporte-fechar-modal" aria-label="Fechar">${ICONE_X}</button></div>
      <div class="suporte-nova-empresa-conteudo">
        <section class="suporte-form-bloco"><div class="suporte-form-bloco-titulo"><span>1</span><div><strong>Telefone principal</strong><small>Contato público/geral da empresa.</small></div></div><div class="campo"><label for="editarEmpresaTelefone">Telefone com DDD</label><input id="editarEmpresaTelefone" type="tel" inputmode="tel" maxlength="20" placeholder="(31) 99999-9999" /><label class="suporte-check-linha"><input id="editarEmpresaSemTelefone" type="checkbox" /> <span>Empresa sem telefone</span></label></div></section>
        <section class="suporte-form-bloco"><div class="suporte-form-bloco-titulo"><span>2</span><div><strong>WhatsApp de cobrança</strong><small>Recebe avisos de vencimento e links de renovação.</small></div></div><div class="campo"><label for="editarEmpresaTelefoneCobranca">Número com DDD <span class="campo-opcional">opcional</span></label><input id="editarEmpresaTelefoneCobranca" type="tel" inputmode="tel" maxlength="20" placeholder="Deixe vazio para não enviar cobrança por WhatsApp" /><label class="suporte-check-linha"><input id="editarEmpresaUsarTelefoneCobranca" type="checkbox" /> <span>Usar o telefone principal</span></label></div><p class="suporte-form-aviso">Para remover o WhatsApp de cobrança, desmarque “Usar o telefone principal” e deixe o campo vazio. Os lembretes dentro do Sistema OS continuam aparecendo.</p></section>
        <p id="editarEmpresaTelefoneErro" class="mensagem-erro suporte-form-erro" hidden></p>
      </div>
      <div class="modal-rodape suporte-nova-empresa-rodape"><button type="button" class="botao botao-fantasma suporte-cancelar-modal">Cancelar</button><button type="submit" class="botao botao-primario">Salvar telefones</button></div>`;
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);
    const campo = (id) => caixa.querySelector('#' + id);
    const telefone = campo('editarEmpresaTelefone');
    const semTelefone = campo('editarEmpresaSemTelefone');
    const cobranca = campo('editarEmpresaTelefoneCobranca');
    const usarPrincipal = campo('editarEmpresaUsarTelefoneCobranca');
    const erro = campo('editarEmpresaTelefoneErro');
    telefone.value = empresa.telefone_principal || '';
    semTelefone.checked = empresa.empresa_sem_telefone === true || !telefoneSomenteDigitos(empresa.telefone_principal);
    cobranca.value = empresa.contato_cobranca_whatsapp || '';
    usarPrincipal.checked = !!telefoneSomenteDigitos(empresa.telefone_principal) && telefoneSomenteDigitos(empresa.telefone_principal) === telefoneSomenteDigitos(empresa.contato_cobranca_whatsapp);
    let resolvido = false;
    const finalizar = (valor) => {
      if (resolvido) return;
      resolvido = true;
      document.removeEventListener('keydown', aoTeclar);
      overlay.remove();
      resolve(valor);
    };
    const sincronizar = () => {
      telefone.disabled = semTelefone.checked;
      usarPrincipal.disabled = semTelefone.checked;
      if (semTelefone.checked && usarPrincipal.checked) usarPrincipal.checked = false;
      cobranca.disabled = usarPrincipal.checked;
      if (usarPrincipal.checked) cobranca.value = telefone.value;
    };
    semTelefone.addEventListener('change', sincronizar);
    usarPrincipal.addEventListener('change', sincronizar);
    telefone.addEventListener('input', sincronizar);
    caixa.addEventListener('submit', (evento) => {
      evento.preventDefault();
      erro.hidden = true;
      const dados = {
        semTelefone: semTelefone.checked,
        telefonePrincipal: telefoneSomenteDigitos(telefone.value),
        telefoneCobranca: telefoneSomenteDigitos(usarPrincipal.checked ? telefone.value : cobranca.value)
      };
      if (!dados.semTelefone && !telefoneValidoFormulario(dados.telefonePrincipal)) {
        erro.textContent = 'Informe o telefone principal com DDD ou marque “Empresa sem telefone”.'; erro.hidden = false; telefone.focus(); return;
      }
      if (dados.telefoneCobranca && !telefoneValidoFormulario(dados.telefoneCobranca)) {
        erro.textContent = 'Confira o WhatsApp de cobrança. Ele deve ter DDD e de 10 a 15 dígitos.'; erro.hidden = false; cobranca.focus(); return;
      }
      finalizar(dados);
    });
    const aoTeclar = (evento) => { if (evento.key === 'Escape') { evento.preventDefault(); finalizar(null); } };
    document.addEventListener('keydown', aoTeclar);
    caixa.querySelector('.suporte-fechar-modal').addEventListener('click', () => finalizar(null));
    caixa.querySelector('.suporte-cancelar-modal').addEventListener('click', () => finalizar(null));
    overlay.addEventListener('mousedown', (evento) => { if (evento.target === overlay) finalizar(null); });
    sincronizar();
    (semTelefone.checked ? cobranca : telefone).focus();
  });
}

async function criarEmpresaGlobal() {
  const dados = await abrirFormularioNovaEmpresaGlobal();
  if (!dados) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('criar_empresa', dados);
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível criar a empresa.');
  toast('Empresa criada com contatos, trial e administrador inicial.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function editarTelefonesEmpresaGlobal(empresa) {
  const dados = await abrirFormularioTelefonesEmpresaGlobal(empresa);
  if (!dados) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('alterar_telefones_empresa', {
    empresaId: empresa.id,
    ...dados
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível salvar os telefones da empresa.');
  toast(dados.telefoneCobranca
    ? 'Telefones salvos. Este WhatsApp receberá os avisos de cobrança.'
    : 'Telefones salvos. A cobrança por WhatsApp ficou desativada.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function salvarPlanoGlobal(planoAtual) {
  if (window.SistemaOSPlanosUI?.abrirPlano) {
    await window.SistemaOSPlanosUI.abrirPlano(planoAtual, async () => {
      painelPlanosGlobalAberto = true;
      await atualizarPainelGlobalSistema();
      renderizarPlanosGlobais(planosGlobaisCache, true);
    });
    return;
  }
  const titulo = planoAtual ? 'Editar plano' : 'Novo plano';
  const nome = await promptModal('Nome do plano:', planoAtual?.nome || '', { titulo });
  if (nome === null) return;
  if (!String(nome).trim()) throw new Error('Informe o nome do plano.');
  const descricao = await promptModal('Descrição (opcional):', planoAtual?.descricao || '', { titulo });
  if (descricao === null) return;
  const preco = await promptModal('Preço de referência (ex.: 149.90):', String(planoAtual?.preco_referencia ?? 0), { titulo });
  if (preco === null) return;
  const precoNumero = Number(String(preco).replace(',', '.'));
  if (!Number.isFinite(precoNumero) || precoNumero < 0) throw new Error('Informe um preço válido.');
  const periodo = await promptModal('Período: mensal, trimestral, semestral, anual ou vitalicio.', planoAtual?.periodo || 'mensal', { titulo });
  if (periodo === null) return;
  const periodoNormalizado = String(periodo).trim().toLowerCase();
  if (!['mensal', 'trimestral', 'semestral', 'anual', 'vitalicio'].includes(periodoNormalizado)) {
    throw new Error('Período inválido.');
  }
  const resposta = await window.api.supabaseadministracaoglobal?.('salvar_plano', {
    id: planoAtual?.id || '', nome: String(nome).trim(), descricao: String(descricao || '').trim(),
    precoReferencia: precoNumero, periodo: periodoNormalizado, ativo: planoAtual?.ativo !== false
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível salvar o plano.');
  toast(planoAtual ? 'Plano atualizado.' : 'Plano criado.', 'sucesso');
  await atualizarPainelGlobalSistema();
  painelPlanosGlobalAberto = true;
  renderizarPlanosGlobais(planosGlobaisCache, true);
  if ($('btnGerenciarPlanosGlobal')) $('btnGerenciarPlanosGlobal').textContent = 'Ocultar planos';
}

async function gerenciarPlanosGlobais() {
  painelPlanosGlobalAberto = !painelPlanosGlobalAberto;
  if (painelPlanosGlobalAberto && !planosGlobaisCache.length) {
    const resposta = await window.api.supabaseadministracaoglobal?.('listar_planos', {});
    if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível listar os planos.');
    planosGlobaisCache = resposta.planos || [];
  }
  renderizarPlanosGlobais(planosGlobaisCache, painelPlanosGlobalAberto);
  const botao = $('btnGerenciarPlanosGlobal');
  if (botao) botao.textContent = painelPlanosGlobalAberto ? 'Ocultar planos' : 'Planos';
}

function dataLicencaParaIso(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) throw new Error('Use a data no formato AAAA-MM-DD.');
  const data = new Date(texto + 'T23:59:59.999Z');
  if (Number.isNaN(data.getTime())) throw new Error('Informe uma data válida.');
  return data.toISOString();
}

async function editarLicencaGlobal(empresa) {
  if (window.SistemaOSPlanosUI?.abrirEmpresa) {
    await window.SistemaOSPlanosUI.abrirEmpresa(empresa, atualizarPainelGlobalSistema);
    return;
  }
  const escolha = await promptModal(
    'Escolha o novo estado:\n1 — Calcular automaticamente\n2 — Trial\n3 — Ativa\n4 — Suspensa\n5 — Bloqueada\n6 — Cancelada',
    '1', { titulo: 'Licença — ' + (empresa.nome_fantasia || empresa.codigo) }
  );
  if (escolha === null) return;
  const opcoes = { '1': '', '2': 'teste', '3': 'ativa', '4': 'suspensa', '5': 'bloqueada', '6': 'cancelada' };
  const statusNormalizado = opcoes[String(escolha).trim()];
  if (statusNormalizado === undefined) throw new Error('Escolha uma opção entre 1 e 6.');
  const atual = empresa.data_vencimento || empresa.fim_trial || '';
  const dataAtual = atual ? new Date(atual).toISOString().slice(0, 10) : '';
  const vencimento = await promptModal('Vencimento (AAAA-MM-DD). Deixe em branco para manter:', dataAtual, { titulo: 'Licença — vencimento' });
  if (vencimento === null) return;
  const diasGraca = await promptModal('Tolerância após o vencimento, em dias (0 para manter sem prazo):', '3', { titulo: 'Licença — tolerância' });
  if (diasGraca === null) return;
  const motivo = await promptModal('Motivo/observação para a auditoria:', '', { titulo: 'Licença — auditoria' });
  if (motivo === null) return;
  const vencimentoIso = dataLicencaParaIso(vencimento);
  const dias = Math.max(0, Number(diasGraca) || 0);
  const gracaAte = vencimentoIso && dias > 0
    ? new Date(new Date(vencimentoIso).getTime() + dias * 86400000).toISOString()
    : '';
  const resposta = await window.api.supabaseadministracaoglobal?.('atualizar_licenca', {
    empresaId: empresa.id, status: statusNormalizado,
    vencimento: vencimentoIso, gracaAte, motivo: String(motivo || '').trim()
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível atualizar a licença.');
  toast('Licença atualizada e registrada na auditoria.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function confirmarPagamentoGlobal(empresa) {
  const valor = await promptModal('Valor confirmado (ex.: 149.90):', '0', { titulo: 'Confirmar pagamento — ' + (empresa.nome_fantasia || empresa.codigo) });
  if (valor === null) return;
  const valorNumero = Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(valorNumero) || valorNumero < 0) throw new Error('Informe um valor válido.');
  const dias = await promptModal('Dias de assinatura após este pagamento:', '30', { titulo: 'Confirmar pagamento' });
  if (dias === null) return;
  const diasNumero = Number(dias);
  if (!Number.isInteger(diasNumero) || diasNumero < 1 || diasNumero > 3650) throw new Error('Informe de 1 a 3650 dias.');
  const forma = await promptModal('Forma de pagamento:', 'Pix', { titulo: 'Confirmar pagamento' });
  if (forma === null || !String(forma).trim()) throw new Error('Informe a forma de pagamento.');
  const referencia = await promptModal('Referência/recibo (opcional):', '', { titulo: 'Confirmar pagamento' });
  if (referencia === null) return;
  const base = dataVencimentoEmpresa(empresa);
  const inicio = base && base > new Date() ? base : new Date();
  const proximoVencimento = new Date(inicio.getTime() + diasNumero * 86400000).toISOString();
  const resposta = await window.api.supabaseadministracaoglobal?.('confirmar_pagamento', {
    empresaId: empresa.id, planoId: empresa.plano_id || '', valor: valorNumero,
    vencimento: proximoVencimento, forma: String(forma).trim(),
    referencia: String(referencia || '').trim()
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível confirmar o pagamento.');
  toast('Pagamento confirmado; licença renovada por ' + diasNumero + ' dia(s).', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function adicionarDiasLicencaGlobal(empresa) {
  const dias = await promptModal('Quantos dias deseja adicionar à licença?', '30', { titulo: 'Adicionar dias — ' + (empresa.nome_fantasia || empresa.codigo) });
  if (dias === null) return;
  const diasNumero = Number(dias);
  if (!Number.isInteger(diasNumero) || diasNumero < 1 || diasNumero > 3650) throw new Error('Informe de 1 a 3650 dias.');
  const base = dataVencimentoEmpresa(empresa);
  const inicio = base && base > new Date() ? base : new Date();
  const vencimento = new Date(inicio.getTime() + diasNumero * 86400000).toISOString();
  const resposta = await window.api.supabaseadministracaoglobal?.('atualizar_licenca', {
    empresaId: empresa.id, status: 'ativa', vencimento,
    motivo: 'Prorrogação manual de ' + diasNumero + ' dia(s).'
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível adicionar os dias.');
  toast('Licença prorrogada por ' + diasNumero + ' dia(s).', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function removerDiasLicencaGlobal(empresa) {
  const atual = dataVencimentoEmpresa(empresa);
  if (!atual) throw new Error('Esta empresa ainda não possui uma data de vencimento definida.');
  const dias = await promptModal('Quantos dias deseja remover do vencimento?', '1', { titulo: 'Remover dias — ' + (empresa.nome_fantasia || empresa.codigo) });
  if (dias === null) return;
  const diasNumero = Number(dias);
  if (!Number.isInteger(diasNumero) || diasNumero < 1 || diasNumero > 3650) throw new Error('Informe de 1 a 3650 dias.');
  const vencimento = new Date(atual.getTime() - diasNumero * 86400000);
  const confirmado = await confirmModal(
    'O novo vencimento será ' + vencimento.toLocaleDateString('pt-BR') + '. Deseja confirmar?',
    { titulo: 'Confirmar redução do prazo' }
  );
  if (!confirmado) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('atualizar_licenca', {
    empresaId: empresa.id,
    status: vencimento < new Date() ? 'vencida' : (empresa.licenca_status || 'ativa'),
    vencimento: vencimento.toISOString(),
    motivo: 'Redução manual de ' + diasNumero + ' dia(s).'
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível remover os dias.');
  toast(diasNumero + ' dia(s) removido(s) do vencimento.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function configurarTrocaRapidaEmpresaGlobal(empresa, ativa) {
  const confirmado = await confirmModal(
    (ativa ? 'Ativar' : 'Desativar') + ' a troca rápida de contas para ' + (empresa.nome_fantasia || empresa.codigo) + '?',
    { titulo: 'Troca rápida de contas' }
  );
  if (!confirmado) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('configurar_troca_rapida_empresa', {
    empresaId: empresa.id, ativa
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível alterar a troca rápida.');
  toast('Troca rápida ' + (ativa ? 'ativada' : 'desativada') + ' para a empresa.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function configurarFiscalEmpresaGlobal(empresa, ativa) {
  if (!suporteEhAdministradorGeral()) throw new Error('Somente o Administrador Geral pode alterar o recurso fiscal.');
  const confirmado = await confirmModal(
    (ativa ? 'Liberar' : 'Ocultar') + ' a função fiscal para ' + (empresa.nome_fantasia || empresa.codigo) + '?',
    { titulo: ativa ? 'Liberar função fiscal' : 'Ocultar função fiscal' }
  );
  if (!confirmado) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('configurar_fiscal_empresa', {
    empresaId: empresa.id, ativa
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível alterar a função fiscal.');
  toast('Função fiscal ' + (ativa ? 'liberada' : 'ocultada') + ' para a empresa.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function solicitarExclusaoEmpresaGlobal(empresa) {
  const codigo = await promptModal('Digite o código da empresa para confirmar: ' + empresa.codigo, '', { titulo: 'Solicitar exclusão definitiva' });
  if (codigo === null) return;
  if (String(codigo).trim().toLowerCase() !== String(empresa.codigo || '').toLowerCase()) {
    throw new Error('Código de confirmação incorreto. Nenhuma solicitação foi criada.');
  }
  const motivo = await promptModal('Explique o motivo da exclusão (obrigatório):', '', { titulo: 'Motivo para auditoria' });
  if (motivo === null) return;
  if (String(motivo).trim().length < 5) throw new Error('Informe um motivo com pelo menos 5 caracteres.');
  const resposta = await window.api.supabaseadministracaoglobal?.('solicitar_exclusao', {
    tipo: 'empresa', empresaId: empresa.id, alvoId: empresa.id,
    alvoRotulo: empresa.nome_fantasia || empresa.codigo, motivo: String(motivo).trim()
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível criar a solicitação.');
  toast('Solicitação registrada. A empresa só será apagada após aprovação com senha.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function alterarAcessoEmpresaGlobal(empresa, status) {
  const reativando = status === 'ativa';
  const titulo = reativando ? 'Reativar empresa' : 'Bloquear empresa';
  const confirmado = await confirmModal(
    reativando
      ? 'Deseja reativar o acesso de ' + (empresa.nome_fantasia || empresa.codigo) + '?'
      : 'Deseja bloquear o acesso de ' + (empresa.nome_fantasia || empresa.codigo) + '? Usuários não conseguirão entrar até a reativação.',
    { titulo }
  );
  if (!confirmado) return;
  const motivo = await promptModal('Motivo para auditoria:', reativando ? 'Acesso reativado pelo suporte' : 'Bloqueio administrativo', { titulo });
  if (motivo === null) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('atualizar_licenca', {
    empresaId: empresa.id, status, motivo: String(motivo).trim()
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível alterar o acesso.');
  toast(reativando ? 'Empresa reativada.' : 'Empresa bloqueada.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function arquivarEmpresaGlobal(empresa) {
  const confirmado = await confirmModal(
    'Arquivar ' + (empresa.nome_fantasia || empresa.codigo) + '? O acesso será cancelado, mas dados e auditoria serão preservados para recuperação segura.',
    { titulo: 'Arquivar empresa' }
  );
  if (!confirmado) return;
  const codigo = await promptModal('Digite o código da empresa para confirmar: ' + empresa.codigo, '', { titulo: 'Confirmação de arquivamento' });
  if (codigo === null) return;
  if (String(codigo).trim().toLowerCase() !== String(empresa.codigo || '').toLowerCase()) {
    throw new Error('Código de confirmação incorreto.');
  }
  const resposta = await window.api.supabaseadministracaoglobal?.('atualizar_licenca', {
    empresaId: empresa.id, status: 'cancelada', motivo: 'Empresa arquivada pelo suporte; dados preservados.'
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível arquivar a empresa.');
  toast('Empresa arquivada. Use “Restaurar acesso” caso precise reativá-la.', 'sucesso');
  await atualizarPainelGlobalSistema();
}

async function gerenciarAcessosEmpresaGlobal(empresa) {
  empresaUsuariosGlobal = empresa;
  empresaUsuariosGlobalEhSuporte = false;
  $('tituloUsuariosEmpresaGlobal').textContent = 'Usuários — ' + (empresa.nome_fantasia || empresa.codigo);
  $('subtituloUsuariosEmpresaGlobal').textContent = 'Empresa ' + (empresa.codigo || '—') + ' · carregando tipo de acesso…';
  $('modalUsuariosEmpresaGlobal').classList.remove('escondido');
  cancelarFormularioUsuarioEmpresaGlobal();
  await carregarUsuariosEmpresaGlobal();
}

function definirStatusUsuariosEmpresaGlobal(texto, erro = false) {
  const status = $('statusUsuariosEmpresaGlobal');
  if (!status) return;
  status.textContent = texto || '';
  status.style.color = erro ? 'var(--perigo)' : '';
}

async function carregarUsuariosEmpresaGlobal() {
  const tbody = $('tbodyUsuariosEmpresaGlobal');
  if (!empresaUsuariosGlobal || !tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="vazio">Carregando usuários…</td></tr>';
  definirStatusUsuariosEmpresaGlobal('Atualizando…');
  const resposta = await window.api.supabaseadministracaoglobal?.('listar_usuarios_empresa', { empresaId: empresaUsuariosGlobal.id });
  if (!resposta?.sucesso) {
    definirStatusUsuariosEmpresaGlobal(resposta?.erro || 'Não foi possível listar os usuários.', true);
    throw new Error(resposta?.erro || 'Não foi possível listar os usuários.');
  }
  empresaUsuariosGlobalEhSuporte = resposta.empresaSuporte === true;
  $('subtituloUsuariosEmpresaGlobal').textContent = empresaUsuariosGlobalEhSuporte
    ? 'Equipe central · cargos e permissões exclusivos do suporte Sistema OS'
    : 'Empresa ' + (empresaUsuariosGlobal.codigo || '—') + ' · cargos operacionais próprios da empresa';
  if ($('btnNovoUsuarioEmpresaGlobal')) $('btnNovoUsuarioEmpresaGlobal').hidden = !suportePodeGerenciar();
  usuariosEmpresaGlobalCache = resposta.usuarios || [];
  renderizarUsuariosEmpresaGlobal(usuariosEmpresaGlobalCache);
  definirStatusUsuariosEmpresaGlobal(usuariosEmpresaGlobalCache.length + ' usuário(s) cadastrado(s).');
}

function renderizarUsuariosEmpresaGlobal(usuarios) {
  const tbody = $('tbodyUsuariosEmpresaGlobal');
  if (!tbody) return;
  tbody.replaceChildren();
  if (!usuarios?.length) {
    const linha = document.createElement('tr');
    const celula = document.createElement('td');
    celula.colSpan = 5;
    celula.className = 'vazio';
    celula.textContent = 'Nenhum usuário cadastrado nesta empresa.';
    linha.appendChild(celula);
    tbody.appendChild(linha);
    return;
  }
  usuarios.forEach((usuario) => {
    const linha = document.createElement('tr');
    const login = document.createElement('td');
    login.style.fontFamily = 'monospace';
    login.textContent = usuario.usuario || '—';
    const nome = document.createElement('td');
    nome.textContent = usuario.nome || '—';
    const cargo = document.createElement('td');
    cargo.textContent = empresaUsuariosGlobalEhSuporte
      ? nomePapelSuporte(usuario.papelSuporte || normalizarPapelSuporteRenderer(usuario.cargo))
      : (usuario.cargo || 'Atendente');
    const status = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'suporte-badge-status ' + (usuario.ativo === false ? 'bloqueada' : 'ativa');
    badge.textContent = usuario.ativo === false ? 'Bloqueado' : 'Ativo';
    status.appendChild(badge);
    const acoes = document.createElement('td');
    const grupo = document.createElement('div');
    grupo.className = 'linha-acoes';
    grupo.style.justifyContent = 'flex-end';
    if (suportePodeGerenciar()) {
      grupo.append(
        criarBotaoSuporte('Editar', 'botao-secundario', async () => abrirFormularioUsuarioEmpresaGlobal(usuario)),
        criarBotaoSuporte('Senha', 'botao-fantasma', () => redefinirSenhaUsuarioEmpresaGlobal(usuario)),
        criarBotaoSuporte(usuario.ativo === false ? 'Ativar' : 'Bloquear', usuario.ativo === false ? 'botao-sucesso' : 'botao-perigo', () => alterarStatusUsuarioEmpresaGlobal(usuario)),
        criarBotaoSuporte(suporteEhAdministradorGeral() ? 'Solicitar exclusão' : 'Enviar para exclusão', 'botao-perigo', () => excluirUsuarioEmpresaGlobal(usuario))
      );
    } else {
      const somenteLeitura = document.createElement('span');
      somenteLeitura.className = 'campo-desc';
      somenteLeitura.textContent = 'Somente leitura';
      grupo.appendChild(somenteLeitura);
    }
    acoes.appendChild(grupo);
    linha.append(login, nome, cargo, status, acoes);
    tbody.appendChild(linha);
  });
}

function abrirFormularioUsuarioEmpresaGlobal(usuario = null) {
  const formulario = $('formUsuarioEmpresaGlobal');
  if (!formulario) return;
  $('tituloFormUsuarioEmpresaGlobal').textContent = usuario ? 'Editar usuário' : 'Novo usuário';
  $('usuarioEmpresaGlobalId').value = usuario?.id || '';
  $('usuarioEmpresaGlobalLogin').value = usuario?.usuario || '';
  $('usuarioEmpresaGlobalNome').value = usuario?.nome || '';
  preencherCargosUsuarioEmpresaGlobal(usuario);
  const descricao = $('descricaoCargoUsuarioEmpresaGlobal');
  if (descricao) descricao.textContent = empresaUsuariosGlobalEhSuporte
    ? 'Os cargos abaixo controlam somente a Central de Suporte; não são os cargos de uma empresa cliente.'
    : 'O mesmo acesso funciona no PC e no celular.';
  $('usuarioEmpresaGlobalSenha').value = '';
  $('campoSenhaUsuarioEmpresaGlobal').hidden = !!usuario;
  $('linhaAtivoUsuarioEmpresaGlobal').hidden = !usuario;
  $('usuarioEmpresaGlobalAtivo').checked = usuario?.ativo !== false;
  $('erroUsuarioEmpresaGlobal').hidden = true;
  formulario.hidden = false;
  setTimeout(() => (usuario ? $('usuarioEmpresaGlobalNome') : $('usuarioEmpresaGlobalLogin'))?.focus(), 80);
}

function cancelarFormularioUsuarioEmpresaGlobal() {
  const formulario = $('formUsuarioEmpresaGlobal');
  if (formulario) formulario.hidden = true;
  const erro = $('erroUsuarioEmpresaGlobal');
  if (erro) erro.hidden = true;
}

async function salvarUsuarioEmpresaGlobal(evento) {
  evento?.preventDefault();
  if (!empresaUsuariosGlobal) return;
  const usuarioId = String($('usuarioEmpresaGlobalId').value || '');
  const login = String($('usuarioEmpresaGlobalLogin').value || '').trim().toLowerCase();
  const nome = String($('usuarioEmpresaGlobalNome').value || '').trim();
  const cargoSelecionado = String($('usuarioEmpresaGlobalCargo').value || '').trim();
  const papelSuporte = empresaUsuariosGlobalEhSuporte ? normalizarPapelSuporteRenderer(cargoSelecionado) : '';
  const cargo = empresaUsuariosGlobalEhSuporte
    ? (CARGOS_EQUIPE_SUPORTE.find((item) => item.valor === papelSuporte)?.rotulo || 'Analista de Suporte')
    : cargoSelecionado;
  const senha = String($('usuarioEmpresaGlobalSenha').value || '');
  const erro = $('erroUsuarioEmpresaGlobal');
  const botao = $('btnSalvarUsuarioEmpresaGlobal');
  if (!/^[a-z0-9._-]{3,30}$/.test(login)) {
    erro.textContent = 'O usuário precisa ter de 3 a 30 letras, números, ponto, hífen ou sublinhado.';
    erro.hidden = false;
    return;
  }
  if (!nome) { erro.textContent = 'Informe o nome de exibição.'; erro.hidden = false; return; }
  if (!usuarioId && senha.length < 8) { erro.textContent = 'A senha inicial precisa ter pelo menos 8 caracteres.'; erro.hidden = false; return; }
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  try {
    const acao = usuarioId ? 'atualizar_usuario_empresa' : 'criar_usuario_empresa';
    const dados = { empresaId: empresaUsuariosGlobal.id, usuarioId, usuario: login, nome, cargo, papelSuporte, senha, ativo: $('usuarioEmpresaGlobalAtivo').checked };
    const resposta = await window.api.supabaseadministracaoglobal?.(acao, dados);
    if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível salvar o usuário.');
    cancelarFormularioUsuarioEmpresaGlobal();
    toast(usuarioId ? 'Usuário atualizado.' : 'Usuário criado. O acesso já funciona no PC e no celular.', 'sucesso');
    await carregarUsuariosEmpresaGlobal();
  } catch (falha) {
    erro.textContent = falha.message || String(falha);
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = 'Salvar usuário';
  }
}

async function redefinirSenhaUsuarioEmpresaGlobal(usuario) {
  const senha = await promptModal('Nova senha para ' + usuario.usuario + ' (mínimo de 8 caracteres):', '', { titulo: 'Redefinir senha', senha: true });
  if (senha === null) return;
  if (String(senha).length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  const motivo = await promptModal('Motivo da redefinição:', 'Solicitação do responsável pela empresa', { titulo: 'Auditoria de senha' });
  if (motivo === null) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('resetar_senha', { usuarioId: usuario.id, novaSenha: String(senha), motivo: String(motivo).trim() });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível redefinir a senha.');
  toast('Senha de ' + usuario.usuario + ' redefinida.', 'sucesso');
}

async function alterarStatusUsuarioEmpresaGlobal(usuario) {
  const ativar = usuario.ativo === false;
  const confirmado = await confirmModal((ativar ? 'Ativar ' : 'Bloquear ') + usuario.usuario + '?', { titulo: ativar ? 'Ativar usuário' : 'Bloquear usuário' });
  if (!confirmado) return;
  const resposta = await window.api.supabaseadministracaoglobal?.('atualizar_usuario_empresa', {
    empresaId: empresaUsuariosGlobal.id, usuarioId: usuario.id, usuario: usuario.usuario,
    nome: usuario.nome, cargo: usuario.cargo, papelSuporte: usuario.papelSuporte || '', ativo: ativar
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível alterar o usuário.');
  toast(ativar ? 'Usuário ativado.' : 'Usuário bloqueado.', 'sucesso');
  await carregarUsuariosEmpresaGlobal();
}

async function excluirUsuarioEmpresaGlobal(usuario) {
  if (!empresaUsuariosGlobal) return;
  const login = String(usuario.usuario || usuario.nome || 'usuário');
  const confirmado = await confirmModal(
    'Enviar a exclusão do usuário ' + login + ' para aprovação?\n\nO acesso continuará ativo até o Administrador Geral aprovar com a senha administrativa.',
    { titulo: 'Solicitar exclusão de usuário' }
  );
  if (!confirmado) return;
  const motivo = await promptModal('Motivo da exclusão (obrigatório):', '', { titulo: 'Auditoria da solicitação' });
  if (motivo === null) return;
  if (String(motivo).trim().length < 5) throw new Error('Informe um motivo com pelo menos 5 caracteres.');
  definirStatusUsuariosEmpresaGlobal('Registrando a solicitação…');
  const resposta = await window.api.supabaseadministracaoglobal?.('solicitar_exclusao', {
    tipo: 'usuario', empresaId: empresaUsuariosGlobal.id, alvoId: usuario.id,
    alvoRotulo: login, motivo: String(motivo).trim()
  });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível registrar a solicitação.');
  toast('Solicitação enviada. O usuário ainda não foi apagado.', 'sucesso');
  definirStatusUsuariosEmpresaGlobal('Solicitação de exclusão pendente para ' + login + '.');
  await atualizarPainelGlobalSistema();
}

// ── Primeiro acesso — onboarding de nome ─────────────────────
async function verificarPrimeiroAcesso(usuario) {
  // Considera primeiro acesso quando o nome ainda é igual ao login (padrão do sistema)
  const nomeIgualLogin = (usuario.nome || '').toLowerCase() === (usuario.usuario || '').toLowerCase();
  const nomeGenerico   = /^(administrador|usuário\s|usuario\s)/i.test(usuario.nome || '');
  const jaFezOnboarding = localStorage.getItem('onboarding-' + usuario.id);
  if (jaFezOnboarding || (!nomeIgualLogin && !nomeGenerico)) return false; // retorna false = não é primeiro acesso

  return new Promise(resolve => {
    const modal = $('modalOnboarding');
    const inputNome = $('onboardingNome');
    const btnSalvar = $('btnOnboardingSalvar');
    const saudeEl   = $('onboardingSaude');

    if (!modal) { resolve(false); return; }

    if (inputNome) inputNome.value = '';
    if (saudeEl)  saudeEl.classList.add('escondido');
    modal.classList.remove('escondido');
    setTimeout(() => inputNome?.focus(), 100);

    async function salvar() {
      const nome = (inputNome?.value || '').trim();
      if (!nome) { inputNome?.focus(); return; }
      try {
        // Tenta atualizar o nome via API se disponível
        if (window.api.authatualizarnome) {
          await window.api.authatualizarnome(usuario.id, nome);
        }
        usuarioAtual = { ...usuarioAtual, nome };
        salvarSessao(usuarioAtual);
        if (saudeEl) {
          saudeEl.textContent = `Olá, ${nome}! Seja bem-vindo ao sistema.`;
          saudeEl.classList.remove('escondido');
        }
        localStorage.setItem('onboarding-' + usuario.id, '1');
        setTimeout(() => { modal.classList.add('escondido'); resolve(true); }, 1800);
      } catch { modal.classList.add('escondido'); resolve(false); }
    }

    if (btnSalvar) {
      const novoBtn = btnSalvar.cloneNode(true);
      btnSalvar.parentNode.replaceChild(novoBtn, btnSalvar);
      novoBtn.addEventListener('click', salvar);
    }
    if (inputNome) {
      inputNome.addEventListener('keydown', e => { if (e.key === 'Enter') salvar(); });
    }
    const btnPular = $('btnOnboardingPular');
    if (btnPular) {
      const novoPular = btnPular.cloneNode(true);
      btnPular.parentNode.replaceChild(novoPular, btnPular);
      novoPular.addEventListener('click', () => {
        localStorage.setItem('onboarding-' + usuario.id, '1');
        modal.classList.add('escondido');
        resolve(false);
      });
    }
  });
}

// ── Logout ───────────────────────────────────────────────────
async function fazerLogout() {
  if (!confirm('Deseja sair do sistema?')) return;
  try {
    const statusSupabase = await window.api.supabasestatus?.();
    if (statusSupabase?.ativo) await window.api.supabaselogout();
  } catch (erro) {
    console.warn('Falha ao encerrar sessão remota:', erro.message);
  }
  usuarioAtual = null;
  limparSessao();
  // Recarrega a janela para limpar o estado completamente
  window.location.reload();
}

// ── Modal de Usuários ────────────────────────────────────────
async function abrirModalUsuarios() {
  if (!$('modalUsuarios')) return;
  definirMensagemUsuarios('');
  $('modalUsuarios').classList.remove('escondido');
  await carregarListaUsuarios();
}

let usuariosSupabaseEmpresaCache = [];
function usandoUsuariosSupabaseEmpresa() {
  return usuarioAtual?.origemAuth === 'supabase' && !usuarioAtual?.administradorGlobal;
}

function definirMensagemUsuarios(mensagem, tipo = '') {
  const elemento = $('msgUsuarios');
  if (!elemento) return;
  elemento.textContent = String(mensagem || '');
  elemento.className = 'mensagem' + (tipo ? ' ' + tipo : '');
  elemento.classList.toggle('escondido', !mensagem);
}

async function obterUsuariosDaEmpresaAtual() {
  if (!usandoUsuariosSupabaseEmpresa()) return await window.api.authlistarusuarios();
  const resposta = await window.api.supabaseadministracaoglobal?.('listar_usuarios_empresa', { empresaId: usuarioAtual.empresaId });
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível carregar os usuários da empresa.');
  usuariosSupabaseEmpresaCache = (resposta.usuarios || []).map((usuario) => ({
    ...usuario,
    cargoId: usuario.cargo || 'Atendente',
    cargoNome: usuario.cargo || 'Atendente',
    perfil: /admin|propriet/i.test(usuario.cargo || '') ? 'admin' : 'operador',
    status: usuario.ativo === false ? 'bloqueado' : 'ativo',
    ultimoLogin: usuario.ultimoAcessoEm || null
  }));
  return usuariosSupabaseEmpresaCache;
}

async function carregarListaUsuarios() {
  const tbody = $('tbodyUsuarios');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--texto-sec);">Carregando...</td></tr>';

  try {
    const lista = await obterUsuariosDaEmpresaAtual();
    if (!lista || !lista.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--texto-sec);">Nenhum usuário cadastrado.</td></tr>';
      return;
    }

    tbody.innerHTML = lista.map(u => {
      const statusBadge  = `<span class="badge-usuario badge-${u.status}">${_nomeStatus(u.status)}</span>`;
      const perfilBadge  = `<span class="badge-usuario badge-${u.perfil}">${u.cargoNome || (u.perfil === 'admin' ? 'Admin' : 'Operador')}</span>`;
      const ultimoLogin  = u.ultimoLogin ? new Date(u.ultimoLogin).toLocaleString('pt-BR') : '—';
      const ehEuMesmo    = usuarioAtual && u.id === usuarioAtual.id;

      const acoes = `
        <div style="display:flex;gap:5px;justify-content:center;flex-wrap:wrap;">
          <button class="botao botao-secundario" style="padding:4px 9px;font-size:12px;"
            title="Editar nome e cargo" onclick="abrirFormEditarUsuario('${u.id}')">${ICONE_LAPIS} Editar</button>
          <button class="botao botao-fantasma" style="padding:4px 9px;font-size:12px;"
            title="Alterar senha" onclick="abrirModalAlterarSenha('${u.id}','${u.usuario.replace(/'/g,"\\'")}')">Senha</button>
          ${u.status === 'ativo' && !ehEuMesmo ? `
            <button class="botao botao-perigo" style="padding:4px 9px;font-size:12px;"
              title="Bloquear usuário" onclick="alterarStatusUsuario('${u.id}','bloqueado')">Bloquear</button>
            <button class="botao botao-fantasma" style="padding:4px 9px;font-size:12px;"
              title="Desativar usuário" onclick="alterarStatusUsuario('${u.id}','inativo')">Pausar</button>
          ` : ''}
          ${u.status !== 'ativo' && !ehEuMesmo ? `
            <button class="botao botao-sucesso" style="padding:4px 9px;font-size:12px;"
              title="Reativar usuário" onclick="alterarStatusUsuario('${u.id}','ativo')">Ativar</button>
          ` : ''}
          ${!ehEuMesmo && usuarioAtual?.admin ? `
            <button class="botao botao-perigo" style="padding:4px 9px;font-size:12px;background:#b91c1c;border-color:#b91c1c;"
              title="Excluir usuário permanentemente" data-uid="${u.id}" data-unome="${(u.nome||'').replace(/"/g,'&quot;')}" onclick="excluirUsuarioUI(this.dataset.uid, this.dataset.unome)">${ICONE_LIXEIRA} Excluir</button>
          ` : ''}
        </div>`;

      return `<tr>
        <td style="font-family:monospace;font-size:12px;">${u.usuario}</td>
        <td>${u.nome}${ehEuMesmo ? ' <span style="font-size:10px;color:var(--texto-sec);">(você)</span>' : ''}</td>
        <td>${perfilBadge}</td>
        <td>${statusBadge}</td>
        <td style="font-size:12px;">${ultimoLogin}</td>
        <td>${acoes}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:#c0392b;">Erro ao carregar usuários: ${_escHtml(err.message)}</td></tr>`;
  }
}

function _nomeStatus(s) {
  return { ativo: 'Ativo', bloqueado: 'Bloqueado', inativo: 'Inativo' }[s] || s;
}

// ── Formulário Criar/Editar Usuário ─────────────────────────
let _modoEdicaoUsuario = null; // null = criação, id = edição

async function _popularSelectCargos(selectEl, valorSelecionado) {
  if (!selectEl) return;
  if (usandoUsuariosSupabaseEmpresa()) {
    const cargos = ['Administrador', 'Gerente', 'Técnico', 'Atendente'];
    selectEl.innerHTML = cargos.map((cargo) => `<option value="${cargo}">${cargo}</option>`).join('');
    if (valorSelecionado) selectEl.value = valorSelecionado;
    return;
  }
  const cargos = await window.api.cargoslistar();
  selectEl.innerHTML = cargos.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
  if (valorSelecionado) selectEl.value = valorSelecionado;
}

async function abrirFormNovoUsuario() {
  _modoEdicaoUsuario = null;
  $('tituloFormUsuario').textContent = '+ Novo Usuário';
  $('formUsuarioId').value     = '';
  $('formUsuarioLogin').value  = '';
  $('formUsuarioLogin').disabled = false;
  $('formUsuarioNome').value   = '';
  await _popularSelectCargos($('formUsuarioCargo'));
  $('formUsuarioSenha').value  = '';
  $('labelSenhaForm').textContent = 'Senha';
  $('formUsuarioSenhaHint').textContent = usandoUsuariosSupabaseEmpresa()
    ? 'Informe uma senha inicial com pelo menos 8 caracteres.'
    : 'Deixe em branco para gerar uma senha forte ou use 10 caracteres com maiúscula, minúscula e número.';
  $('formUsuarioErro').classList.add('escondido');
  resetarBotaoFecharModal('modalFormUsuario');
  $('modalFormUsuario').classList.remove('escondido');
  setTimeout(() => $('formUsuarioLogin').focus(), 100);
}

window.abrirFormEditarUsuario = async function(id) {
  _modoEdicaoUsuario = id;
  const lista = await obterUsuariosDaEmpresaAtual();
  const u = lista.find(x => x.id === id);
  if (!u) return;

  $('tituloFormUsuario').textContent = 'Editar Usuário';
  $('formUsuarioId').value     = u.id;
  $('formUsuarioLogin').value  = u.usuario;
  $('formUsuarioLogin').disabled = false; // editável
  $('formUsuarioLoginHint').textContent = 'Alterar o login mudará como o usuário entra no sistema.';
  $('formUsuarioNome').value   = u.nome;
  await _popularSelectCargos($('formUsuarioCargo'), u.cargoId);
  $('formUsuarioSenha').value  = '';
  $('labelSenhaForm').textContent = 'Nova Senha';
  $('formUsuarioSenhaHint').textContent = 'Deixe em branco para manter a senha atual.';
  $('formUsuarioErro').classList.add('escondido');
  resetarBotaoFecharModal('modalFormUsuario');
  $('modalFormUsuario').classList.remove('escondido');
  setTimeout(() => $('formUsuarioNome').focus(), 100);
};

async function salvarFormUsuario() {
  const id      = $('formUsuarioId').value;
  const login   = $('formUsuarioLogin').value.trim();
  const nome    = $('formUsuarioNome').value.trim();
  const cargoId = $('formUsuarioCargo').value;
  const senha   = $('formUsuarioSenha').value.trim();
  const erroEl  = $('formUsuarioErro');

  erroEl.classList.add('escondido');

  let res;
  try {
    if (usandoUsuariosSupabaseEmpresa()) {
      if (!_modoEdicaoUsuario && senha.length < 8) throw new Error('A senha inicial precisa ter pelo menos 8 caracteres.');
      const acao = _modoEdicaoUsuario ? 'atualizar_usuario_empresa' : 'criar_usuario_empresa';
      res = await window.api.supabaseadministracaoglobal?.(acao, {
        empresaId: usuarioAtual.empresaId, usuarioId: id, usuario: login,
        nome, cargo: cargoId, senha, ativo: true
      });
      if (_modoEdicaoUsuario && senha) {
        const senhaResposta = await window.api.supabaseadministracaoglobal?.('resetar_senha', {
          usuarioId: id, novaSenha: senha, motivo: 'Alterada pelo administrador da empresa'
        });
        if (!senhaResposta?.sucesso) throw new Error(senhaResposta?.erro || 'O perfil foi salvo, mas a senha não pôde ser alterada.');
      }
    } else if (_modoEdicaoUsuario) {
      // Edição — inclui novoLogin para permitir alterar o nome de usuário
      res = await window.api.autheditar(id, { nome, novoLogin: login || undefined, cargoId, novaSenha: senha || undefined });
    } else {
      // Criação
      res = await window.api.authcriarusuario({ usuario: login, nome, cargoId, senha: senha || undefined });
    }
  } catch (err) {
    erroEl.textContent = err.message;
    erroEl.classList.remove('escondido');
    return;
  }

  if (!res.sucesso) {
    erroEl.textContent = res.erro || 'Erro ao salvar.';
    erroEl.classList.remove('escondido');
    return;
  }

  marcarModalComoSalvo('modalFormUsuario');

  // Se criou com senha temporária, exibe modal de credenciais
  if (res.usuario?.senhaTemporaria) {
    $('senhaTmpLogin').textContent = res.usuario.usuario;
    $('senhaTmpSenha').textContent = res.usuario.senhaTemporaria;
    $('modalSenhaTmp').classList.remove('escondido');
  }

  await carregarListaUsuarios();
  if (!$('modalConfig')?.classList.contains('escondido')) {
    const config = await window.api.configobter();
    configAtual = config;
    await carregarPoliticaExclusaoConfig(config);
  }
  toast(_modoEdicaoUsuario ? 'Usuário atualizado.' : 'Usuário criado.', 'sucesso');
}

// ── Gerar Usuário Automático ────────────────────────────────
async function gerarUsuarioAutomatico() {
  const cargos = await window.api.cargoslistar();
  const nomes = cargos.map(c => c.nome).join(', ');
  const escolha = await promptModal(`Cargo do usuário gerado (${nomes}):`, 'Atendente', { titulo: ' Gerar usuário automaticamente' });
  if (!escolha) return;
  const cargo = cargos.find(c => c.nome.toLowerCase() === escolha.trim().toLowerCase());
  if (!cargo) { alert('Cargo não encontrado. Use exatamente um destes nomes: ' + nomes); return; }
  try {
    const res = await window.api.authgerarautomatico(cargo.id);
    if (!res.sucesso) { alert('Erro: ' + res.erro); return; }
    await carregarListaUsuarios();
    if (res.usuario?.senhaTemporaria) {
      $('senhaTmpLogin').textContent = res.usuario.usuario;
      $('senhaTmpSenha').textContent = res.usuario.senhaTemporaria;
      $('modalSenhaTmp').classList.remove('escondido');
    }
    toast('Usuário gerado automaticamente.', 'sucesso');
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// ── Alterar Status ──────────────────────────────────────────
// ── Excluir Usuário ─────────────────────────────────────────
window.excluirUsuarioUI = async function(id, nome) {
  definirMensagemUsuarios('');
  // Modal de confirmação dedicado (sem campo de texto — só Cancelar/Excluir)
  const confirmado = await new Promise(resolve => {
    const existente = document.getElementById('_modalConfirmarExcluirUsuario');
    if (existente) existente.remove();

    const overlay = document.createElement('div');
    overlay.id = '_modalConfirmarExcluirUsuario';
    overlay.className = 'modal-fundo';
    overlay.style.zIndex = '999';

    const caixa = document.createElement('div');
    caixa.className = 'modal-caixa';
    caixa.style.cssText = 'max-width:420px;';

    caixa.innerHTML = `
      <div class="modal-cabecalho" style="background:#b91c1c;">
        <h2 style="color:#fff;">Excluir Usuário</h2>
      </div>
      <div style="padding:22px 24px;">
        <p style="font-size:14px;margin-bottom:8px;">Tem certeza que deseja excluir este usuário?</p>
        <p style="font-size:15px;font-weight:700;color:#b91c1c;margin-bottom:8px;">"${nome}"</p>
        <p style="font-size:13px;color:#666;">Esta ação não pode ser desfeita. O usuário será removido permanentemente do sistema.</p>
      </div>
      <div class="modal-rodape">
        <button id="_btnCancelarExcluirUsr" class="botao botao-fantasma">${ICONE_X} Cancelar</button>
        <button id="_btnConfirmarExcluirUsr" class="botao botao-perigo" style="background:#b91c1c;border-color:#b91c1c;">${ICONE_LIXEIRA} Excluir</button>
      </div>`;

    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    let resolvido = false;
    function finalizar(v) {
      if (resolvido) return;
      resolvido = true;
      overlay.remove();
      resolve(v);
    }
    document.getElementById('_btnConfirmarExcluirUsr').addEventListener('click', () => finalizar(true));
    document.getElementById('_btnCancelarExcluirUsr').addEventListener('click', () => finalizar(false));
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) finalizar(false); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); finalizar(false); }
    });
  });

  if (!confirmado) return;

  if (!(await autorizarExclusaoProtegida(`o usuário ${nome}`))) return;

  try {
    const res = usandoUsuariosSupabaseEmpresa()
      ? await window.api.supabaseadministracaoglobal?.('excluir_usuario_empresa', {
          empresaId: usuarioAtual.empresaId,
          usuarioId: id
        })
      : await window.api.authexcluirusuario(id, usuarioAtual?.id);
    if (!res || !res.sucesso) {
      const mensagem = 'Erro ao excluir ' + nome + ': ' + (res?.erro || 'Falha desconhecida');
      definirMensagemUsuarios(mensagem, 'erro');
      toast(mensagem, 'erro');
      await carregarListaUsuarios();
      return;
    }
    definirMensagemUsuarios('Usuário "' + nome + '" removido com sucesso.', 'sucesso');
    toast('Usuário removido com sucesso.', 'sucesso');
    await carregarListaUsuarios();
  } catch (err) {
    const mensagem = 'Erro ao excluir ' + nome + ': ' + err.message;
    definirMensagemUsuarios(mensagem, 'erro');
    toast(mensagem, 'erro');
  }
};

// ── Modal Alterar Senha ──────────────────────────────────────
window.abrirModalAlterarSenha = function(id, login) {
  const modal = $('modalAlterarSenha');
  if (!modal) return;
  $('alterarSenhaUserId').value = id;
  $('alterarSenhaLoginLabel').textContent = login;
  $('alterarSenhaNova').value = '';
  $('alterarSenhaConfirm').value = '';
  $('alterarSenhaErro').classList.add('escondido');
  modal.classList.remove('escondido');
  setTimeout(() => $('alterarSenhaNova')?.focus(), 100);
};

async function salvarAlterarSenha() {
  const id    = $('alterarSenhaUserId')?.value;
  const nova  = $('alterarSenhaNova')?.value || '';
  const conf  = $('alterarSenhaConfirm')?.value || '';
  const erroEl = $('alterarSenhaErro');

  if (!nova) { erroEl.textContent = 'Informe a nova senha.'; erroEl.classList.remove('escondido'); return; }
  if (nova.length < (usandoUsuariosSupabaseEmpresa() ? 8 : 10)) { erroEl.textContent = usandoUsuariosSupabaseEmpresa() ? 'A senha deve ter pelo menos 8 caracteres.' : 'Use pelo menos 10 caracteres, com maiúscula, minúscula e número.'; erroEl.classList.remove('escondido'); return; }
  if (!usandoUsuariosSupabaseEmpresa() && !/[A-Z]/.test(nova)) { erroEl.textContent = 'Inclua ao menos uma letra maiúscula.'; erroEl.classList.remove('escondido'); return; }
  if (!usandoUsuariosSupabaseEmpresa() && !/[a-z]/.test(nova)) { erroEl.textContent = 'Inclua ao menos uma letra minúscula.'; erroEl.classList.remove('escondido'); return; }
  if (!usandoUsuariosSupabaseEmpresa() && !/\d/.test(nova)) { erroEl.textContent = 'Inclua ao menos um número.'; erroEl.classList.remove('escondido'); return; }
  if (nova !== conf)   { erroEl.textContent = 'As senhas não coincidem.'; erroEl.classList.remove('escondido'); return; }

  try {
    const res = usandoUsuariosSupabaseEmpresa()
      ? await window.api.supabaseadministracaoglobal?.('resetar_senha', { usuarioId: id, novaSenha: nova, motivo: 'Alterada pelo administrador da empresa' })
      : await window.api.autheditar(id, { novaSenha: nova });
    if (!res.sucesso) { erroEl.textContent = res.erro || 'Erro ao salvar.'; erroEl.classList.remove('escondido'); return; }
    $('modalAlterarSenha').classList.add('escondido');
    toast('Senha alterada com sucesso!', 'sucesso');
  } catch (err) {
    erroEl.textContent = err.message;
    erroEl.classList.remove('escondido');
  }
}

window.alterarStatusUsuario = async function(id, status) {
  const labels = { bloqueado: 'bloquear', inativo: 'desativar', ativo: 'reativar' };
  if (!confirm(`Deseja ${labels[status] || status} este usuário?`)) return;
  try {
    let res;
    if (usandoUsuariosSupabaseEmpresa()) {
      const usuario = (await obterUsuariosDaEmpresaAtual()).find((item) => item.id === id);
      if (!usuario) throw new Error('Usuário não encontrado.');
      res = await window.api.supabaseadministracaoglobal?.('atualizar_usuario_empresa', {
        empresaId: usuarioAtual.empresaId, usuarioId: id, usuario: usuario.usuario,
        nome: usuario.nome, cargo: usuario.cargoNome, ativo: status === 'ativo'
      });
    } else {
      res = await window.api.authalterarstatus(id, status);
    }
    if (!res.sucesso) { alert('Erro: ' + res.erro); return; }
    await carregarListaUsuarios();
    toast('Status alterado com sucesso.', 'info');
  } catch (err) {
    alert('Erro: ' + err.message);
  }
};

// ── Event Listeners de Auth ─────────────────────────────────
async function carregarContasRapidasUI() {
  const resposta = await window.api.supabaselistarcontasrapidas?.();
  const contas = resposta?.sucesso ? (resposta.contas || []) : [];
  if (resposta?.erroTroca && !usuarioAtual) {
    const contaFalha = contas.find((conta) => conta.id === resposta.erroTrocaContaId);
    if (contaFalha) {
      if ($('loginEmpresa')) $('loginEmpresa').value = contaFalha.empresaCodigo || '';
      if ($('loginUsuario')) $('loginUsuario').value = contaFalha.usuario || '';
      setTimeout(() => $('loginSenha')?.focus(), 0);
    }
    _mostrarErroLogin(resposta.erroTroca);
  }
  const destinos = [
    { bloco: $('contasRapidasLogin'), lista: $('listaContasRapidasLogin'), login: true },
    { bloco: $('contasRapidasConfig'), lista: $('listaContasRapidasConfig'), login: false }
  ];
  destinos.forEach(({ bloco, lista, login }) => {
    if (!bloco || !lista) return;
    bloco.classList.toggle('escondido', login && !contas.length);
    if (!login) bloco.hidden = !(usuarioAtual?.trocaRapidaContas || usuarioAtual?.administradorGlobal);
    lista.replaceChildren();
    if (!contas.length) {
      const vazio = document.createElement('p');
      vazio.className = 'campo-desc';
      vazio.textContent = 'Nenhuma conta adicional salva neste dispositivo.';
      lista.appendChild(vazio);
      return;
    }
    contas.forEach((conta) => {
      const item = document.createElement('div');
      item.className = 'conta-rapida-item';
      const info = document.createElement('div');
      info.className = 'conta-rapida-info';
      const titulo = document.createElement('strong');
      titulo.textContent = (conta.nome || conta.usuario || 'Usuário') + ' · ' + (conta.empresaNome || conta.empresaCodigo || 'Suporte');
      const detalhe = document.createElement('span');
      detalhe.textContent = (conta.empresaCodigo || 'suporte') + ' / ' + (conta.usuario || 'usuário');
      info.append(titulo, detalhe);
      const acoes = document.createElement('div');
      acoes.className = 'conta-rapida-acoes';
      const usar = document.createElement('button');
      usar.type = 'button';
      usar.className = 'botao botao-primario botao-pequeno';
      usar.textContent = conta.id === usuarioAtual?.id ? 'Em uso' : (conta.requerSenha ? 'Entrar com senha' : 'Entrar');
      usar.disabled = conta.id === usuarioAtual?.id;
      usar.addEventListener('click', () => trocarContaRapidaUI(conta.id, usar, conta));
      const remover = document.createElement('button');
      remover.type = 'button';
      remover.className = 'botao botao-fantasma botao-pequeno';
      remover.textContent = 'Remover';
      remover.addEventListener('click', async () => {
        const confirmou = await confirmModal('Remover esta conta salva deste computador?', { titulo: 'Remover conta' });
        if (!confirmou) return;
        await window.api.supabaseremovercontarapida?.(conta.id);
        await carregarContasRapidasUI();
      });
      acoes.append(usar, remover);
      item.append(info, acoes);
      lista.appendChild(item);
    });
  });
  const status = $('statusContasRapidas');
  if (status && !resposta?.sucesso) status.textContent = resposta?.erro || 'Não foi possível acessar o cofre seguro.';
}

let _trocaContaRapidaEmAndamento = false;

async function trocarContaRapidaUI(contaId, botao, conta) {
  // Uma conta já marcada pelo processo principal como expirada não precisa
  // chamar IPC nem rede novamente. Prepare imediatamente o login manual;
  // além de ser mais rápido, isso evita um botão preso em "Entrando..."
  // quando a inicialização em segundo plano ainda está ocupada.
  if (conta?.requerSenha) {
    if (!usuarioAtual) {
      if ($('loginEmpresa')) $('loginEmpresa').value = conta.empresaCodigo || '';
      if ($('loginUsuario')) $('loginUsuario').value = conta.usuario || '';
      if ($('loginSenha')) { $('loginSenha').value = ''; $('loginSenha').focus(); }
      _mostrarErroLogin('Sua sessão salva expirou. Digite a senha para entrar novamente.');
    } else {
      const aviso = 'A conta atual foi mantida. Use Sair e entre na outra conta com sua senha.';
      const status = $('statusContasRapidas');
      if (status) status.textContent = aviso;
      else toast(aviso, 'aviso');
    }
    if (botao) { botao.disabled = false; botao.textContent = 'Entrar com senha'; }
    return;
  }
  if (_trocaContaRapidaEmAndamento) return;
  _trocaContaRapidaEmAndamento = true;
  const textoOriginal = botao?.textContent || 'Entrar';
  const status = usuarioAtual ? $('statusContasRapidas') : null;
  try {
    if (botao) {
      botao.disabled = true;
      botao.textContent = 'Entrando...';
    }
    const empresaNome = conta?.empresaNome || conta?.empresaCodigo || 'outra empresa';
    if (status) status.textContent = `Entrando em ${empresaNome}...`;
    const resposta = await aguardarLoginComLimite(
      window.api.supabasetrocarcontarapida?.(contaId),
      12000
    );
    if (!resposta?.sucesso) {
      if (resposta?.requerSenha) {
        if (conta) conta.requerSenha = true;
        if (!usuarioAtual) {
          if ($('loginEmpresa')) $('loginEmpresa').value = conta?.empresaCodigo || '';
          if ($('loginUsuario')) $('loginUsuario').value = conta?.usuario || '';
          if ($('loginSenha')) { $('loginSenha').value = ''; $('loginSenha').focus(); }
        }
      }
      const orientacao = resposta?.requerSenha && usuarioAtual
        ? ' A conta atual foi mantida. Use Sair e entre na outra conta com sua senha.' : '';
      throw new Error((resposta?.erro || 'Não foi possível trocar de conta.') + orientacao);
    }
    if (resposta.reiniciarAplicacao) {
      if (status) status.textContent = 'Conta selecionada. Reabrindo o Sistema OS na empresa...';
      if (botao) botao.textContent = 'Reabrindo...';
      return;
    }
    usuarioAtual = resposta.usuario;
    salvarSessao(resposta.usuario);
    if (status) status.textContent = 'Conta alterada com sucesso. Carregando os dados da empresa...';
    toast('Conta alterada com sucesso.', 'sucesso');
    setTimeout(() => window.location.reload(), 450);
  } catch (erro) {
    const mensagem = erro?.message === 'TEMPO_LIMITE_LOGIN'
      ? 'O servidor demorou para trocar a conta. Tente novamente em alguns instantes.'
      : mensagemErroAmigavel(erro, 'Não foi possível trocar de conta.');
    if (status) status.textContent = mensagem;
    else _mostrarErroLogin(mensagem);
    if (botao) {
      botao.disabled = false;
      botao.textContent = conta?.requerSenha ? 'Entrar com senha' : textoOriginal;
    }
  } finally {
    _trocaContaRapidaEmAndamento = false;
  }
}

// Confirma visualmente o retorno automático das assinaturas. O evento vem
// do processo principal somente depois de gravar a assinatura e regenerar
// o PDF, portanto a mensagem nunca anuncia um documento ainda incompleto.
if (window.api?.onSupabaseSincronizado && !window.__sistemaOSListenerSyncRegistrado) {
  window.__sistemaOSListenerSyncRegistrado = true;
  window.api.onSupabaseSincronizado((dados) => {
    const total = Number(dados?.assinaturas || 0);
    if (total > 0) {
      toast(
        total === 1
          ? 'Assinatura recebida do celular. O PDF foi atualizado.'
          : `${total} assinaturas recebidas do celular. Os PDFs foram atualizados.`,
        'sucesso'
      );
      try { carregarNotificacoes?.(); } catch (_) {}
    }
  });
}

if (window.api?.supabaseregistrarerrousuario && !window.__sistemaOSRelatorioErrosRegistrado) {
  window.__sistemaOSRelatorioErrosRegistrado = true;
  const enviados = new Map();
  const relatar = (mensagem, stack, funcao) => {
    const textoErro = String(mensagem || '').trim();
    if (!textoErro || /failed to fetch|networkerror|internet/i.test(textoErro)) return;
    const chave = textoErro.slice(0, 300);
    if (Date.now() - Number(enviados.get(chave) || 0) < 60000) return;
    enviados.set(chave, Date.now());
    window.api.supabaseregistrarerrousuario({
      mensagem: textoErro,
      stack: String(stack || ''),
      funcao: String(funcao || ''),
      tela: document.querySelector('.aba-conteudo.ativa, .secao-ativa')?.id || document.title || 'desktop',
      prioridade: 'alta'
    }).catch(() => {});
  };
  window.addEventListener('error', (evento) => relatar(evento.message, evento.error?.stack, evento.filename));
  window.addEventListener('unhandledrejection', (evento) => relatar(evento.reason?.message || evento.reason, evento.reason?.stack, 'promise'));
}

async function adicionarContaRapidaUI() {
  const empresa = await promptModal('Código da empresa:', '', { titulo: 'Adicionar conta protegida' });
  if (empresa === null) return;
  const usuario = await promptModal('Usuário:', '', { titulo: 'Adicionar conta protegida' });
  if (usuario === null) return;
  const senha = await promptModal('Senha:', '', { titulo: 'Adicionar conta protegida', senha: true });
  if (senha === null) return;
  const resposta = await window.api.supabaselogin(String(empresa).trim(), String(usuario).trim(), String(senha));
  if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível adicionar a conta.');
  usuarioAtual = resposta.usuario;
  salvarSessao(resposta.usuario);
  window.location.reload();
}

async function configurarTrocaRapidaUI() {
  const check = $('cfgTrocaRapidaContas');
  if (!check) return;
  check.disabled = true;
  try {
    const resposta = await window.api.supabaseconfigurartrocarapida?.(check.checked);
    if (!resposta?.sucesso) throw new Error(resposta?.erro || 'Não foi possível alterar a troca rápida.');
    usuarioAtual.trocaRapidaContas = resposta.ativa === true;
    toast(resposta.ativa ? 'Troca rápida liberada para esta empresa.' : 'Troca rápida desativada.', 'sucesso');
    await carregarContasRapidasUI();
  } catch (erro) {
    check.checked = !check.checked;
    toast(erro.message || String(erro), 'erro');
  } finally { check.disabled = false; }
}

if ($('btnLogin')) {
  $('btnLogin').addEventListener('click', fazerLogin);
}
if ($('btnAbrirChamadoLogin')) {
  $('btnAbrirChamadoLogin').addEventListener('click', () => abrirChamadoSuporte('login_pc').catch((erro) => _mostrarErroLogin(erro.message || String(erro))));
}
if ($('loginSenha')) {
  $('loginSenha').addEventListener('keydown', e => { if (e.key === 'Enter') fazerLogin(); });
}
if ($('loginUsuario')) {
  $('loginUsuario').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginSenha')?.focus(); });
  // Limpa erro ao digitar — sem validação inline que pode travar o campo
  $('loginUsuario').addEventListener('input', () => {
    const erroEl = $('loginErro');
    if (erroEl) erroEl.classList.add('escondido');
  });
}
if ($('loginSenha')) {
  $('loginSenha').addEventListener('input', () => {
    const erroEl = $('loginErro');
    if (erroEl) erroEl.classList.add('escondido');
  });
}
// Botão mostrar/ocultar senha
if ($('btnVerSenha')) {
  $('btnVerSenha').addEventListener('click', () => {
    const inp = $('loginSenha');
    const aberto = $('olhoAberto');
    const fechado = $('olhoFechado');
    if (!inp) return;
    const mostrar = inp.type === 'password';
    inp.type = mostrar ? 'text' : 'password';
    if (aberto)  aberto.style.display  = mostrar ? 'none'  : '';
    if (fechado) fechado.style.display = mostrar ? ''      : 'none';
    inp.focus();
  });
}
if ($('btnLogout')) {
  $('btnLogout').addEventListener('click', fazerLogout);
}
if ($('btnTrocarUsuarioConfig')) {
  $('btnTrocarUsuarioConfig').addEventListener('click', fazerLogout);
}
if ($('btnAdicionarContaRapida')) {
  $('btnAdicionarContaRapida').addEventListener('click', () => adicionarContaRapidaUI().catch((erro) => toast(erro.message || String(erro), 'erro')));
}
if ($('cfgTrocaRapidaContas')) {
  $('cfgTrocaRapidaContas').addEventListener('change', configurarTrocaRapidaUI);
}
if ($('btnAbrirChamadoConfig')) {
  $('btnAbrirChamadoConfig').addEventListener('click', () => abrirChamadoSuporte('config_pc').catch((erro) => toast(erro.message || String(erro), 'erro')));
}
if ($('btnEsqueciSenha')) {
  $('btnEsqueciSenha').addEventListener('click', () => {
    _mostrarErroLogin('Peça ao administrador da sua empresa para redefinir sua senha.');
  });
}
if ($('btnConectarMercadoPagoEmpresa')) {
  $('btnConectarMercadoPagoEmpresa').addEventListener('click', () => conectarMercadoPagoEmpresa().catch((erro) => escreverStatusIntegracaoMercadoPago(null, erro.message || String(erro))));
}
if ($('btnDesconectarMercadoPagoEmpresa')) {
  $('btnDesconectarMercadoPagoEmpresa').addEventListener('click', () => desconectarMercadoPagoEmpresa().catch((erro) => escreverStatusIntegracaoMercadoPago(null, erro.message || String(erro))));
}
if ($('btnAtualizarMercadoPagoEmpresa')) {
  $('btnAtualizarMercadoPagoEmpresa').addEventListener('click', () => verificarIntegracaoMercadoPagoEmpresa().catch((erro) => escreverStatusIntegracaoMercadoPago(null, erro.message || String(erro))));
}
if ($('btnAtualizarEmpresasGlobal')) {
  $('btnAtualizarEmpresasGlobal').addEventListener('click', () => atualizarPainelGlobalSistema()
    .then(() => toast('Empresas, planos e chamados atualizados.', 'sucesso'))
    .catch((erro) => toast(erro.message || String(erro), 'erro')));
}
if ($('btnCriarEmpresaGlobal')) {
  $('btnCriarEmpresaGlobal').addEventListener('click', () => criarEmpresaGlobal().catch((erro) => toast(erro.message || String(erro), 'erro')));
}
if ($('btnGerenciarPlanosGlobal')) {
  $('btnGerenciarPlanosGlobal').addEventListener('click', () => gerenciarPlanosGlobais().catch((erro) => toast(erro.message || String(erro), 'erro')));
}
if ($('btnDefinirSenhaExclusaoGlobal')) {
  $('btnDefinirSenhaExclusaoGlobal').addEventListener('click', () => definirSenhaExclusaoGlobal().catch((erro) => toast(erro.message || String(erro), 'erro')));
}
if ($('btnNovoPlanoGlobal')) {
  $('btnNovoPlanoGlobal').addEventListener('click', () => salvarPlanoGlobal(null).catch((erro) => toast(erro.message || String(erro), 'erro')));
}
if ($('buscaEmpresaGlobal')) {
  $('buscaEmpresaGlobal').addEventListener('input', () => renderizarEmpresasGlobais(empresasGlobaisCache));
}
if ($('btnNovoUsuarioEmpresaGlobal')) {
  $('btnNovoUsuarioEmpresaGlobal').addEventListener('click', () => abrirFormularioUsuarioEmpresaGlobal());
}
if ($('btnAtualizarUsuariosEmpresaGlobal')) {
  $('btnAtualizarUsuariosEmpresaGlobal').addEventListener('click', () => carregarUsuariosEmpresaGlobal().catch((erro) => toast(erro.message || String(erro), 'erro')));
}
if ($('btnCancelarUsuarioEmpresaGlobal')) {
  $('btnCancelarUsuarioEmpresaGlobal').addEventListener('click', cancelarFormularioUsuarioEmpresaGlobal);
}
if ($('formUsuarioEmpresaGlobal')) {
  $('formUsuarioEmpresaGlobal').addEventListener('submit', salvarUsuarioEmpresaGlobal);
}
async function concluirRecuperacaoSenhaSupabase(url) {
  try {
    const sessao = await window.api.supabaseprocessarrecuperacao?.(url);
    if (!sessao?.sucesso) throw new Error(sessao?.erro || 'Não foi possível validar o link de recuperação.');
    const senha = await promptModal('Digite uma nova senha (mínimo de 8 caracteres):', '', { titulo: 'Redefinir senha', senha: true });
    if (senha === null) return;
    if (senha.length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
    const confirmacao = await promptModal('Repita a nova senha:', '', { titulo: 'Confirmar nova senha', senha: true });
    if (confirmacao === null) return;
    if (senha !== confirmacao) throw new Error('As senhas não coincidem.');
    const atualizada = await window.api.supabaseatualizarsenha?.(senha);
    if (!atualizada?.sucesso) throw new Error(atualizada?.erro || 'Não foi possível atualizar a senha.');
    usuarioAtual = atualizada.usuario;
    salvarSessao(atualizada.usuario);
    mostrarSistema();
    toast('Senha atualizada com sucesso.', 'sucesso');
  } catch (erro) {
    _mostrarErroLogin(erro.message || 'Falha ao recuperar a senha.');
    mostrarTelaLogin();
  }
}
if (window.api.onSupabaseRecuperacaoUrl) {
  window.api.onSupabaseRecuperacaoUrl((url) => {
    setTimeout(() => concluirRecuperacaoSenhaSupabase(url), 0);
  });
}
if ($('btnUsuarios')) {
  $('btnUsuarios').addEventListener('click', abrirModalUsuarios);
}
if ($('btnNovoUsuario')) {
  $('btnNovoUsuario').addEventListener('click', abrirFormNovoUsuario);
}
if ($('btnGerarAutomatico')) {
  $('btnGerarAutomatico').addEventListener('click', gerarUsuarioAutomatico);
}
if ($('btnSalvarUsuario')) {
  $('btnSalvarUsuario').addEventListener('click', salvarFormUsuario);
}
if ($('btnSalvarAlterarSenha')) {
  $('btnSalvarAlterarSenha').addEventListener('click', salvarAlterarSenha);
}

// ═══════════════════════════════════════════════════════════
// ETAPA 11.3 — CARGOS E PERMISSÕES
// ═══════════════════════════════════════════════════════════
let _modulosCargo = []; // [{id,label}], carregado uma vez do main

async function _carregarModulosCargo() {
  if (_modulosCargo.length) return _modulosCargo;
  const { modulos, labels } = await window.api.cargosmodulos();
  _modulosCargo = modulos.map(m => ({ id: m, label: labels[m] || m }));
  return _modulosCargo;
}

async function abrirModalCargos() {
  if (!$('modalCargos')) return;
  $('modalCargos').classList.remove('escondido');
  await carregarListaCargos();
}

async function carregarListaCargos() {
  const tbody = $('tbodyCargos');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--texto-sec);">Carregando...</td></tr>';

  try {
    const [cargos, modulos] = await Promise.all([window.api.cargoslistar(), _carregarModulosCargo()]);

    tbody.innerHTML = cargos.map(c => {
      const permissoesTexto = c.admin
        ? '<span style="color:var(--cor-principal);font-weight:600;">Acesso total (todas)</span>'
        : modulos.filter(m => c.permissoes?.[m.id]).map(m => m.label).join(', ') || '<span style="color:var(--texto-sec);">nenhuma</span>';

      const acoes = c.admin
        ? '<span style="font-size:12px;color:var(--texto-sec);">fixo</span>'
        : `<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
            <button class="botao botao-secundario" style="padding:4px 10px;font-size:12px;" onclick="abrirFormEditarCargo('${c.id}')">️</button>
            ${!c.sistema ? `<button class="botao botao-perigo" style="padding:4px 10px;font-size:12px;" onclick="excluirCargoUI('${c.id}')"></button>` : ''}
          </div>`;

      return `<tr>
        <td><b>${c.nome}</b>${c.sistema ? ' <span style="font-size:10px;color:var(--texto-sec);">(padrão)</span>' : ''}</td>
        <td>${c.qtdUsuarios}</td>
        <td style="font-size:12.5px;">${permissoesTexto}</td>
        <td>${acoes}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:20px;color:#c0392b;">Erro ao carregar cargos: ${_escHtml(err.message)}</td></tr>`;
  }
}

let _modoEdicaoCargo = null; // null = criação, id = edição

async function _renderCheckboxesPermissoes(permissoesAtuais) {
  const modulos = await _carregarModulosCargo();
  const wrap = $('formCargoPermissoes');
  wrap.innerHTML = modulos.map(m => `
    <label style="display:flex;align-items:center;gap:8px;font-size:0.88rem;cursor:pointer;">
      <input type="checkbox" class="chk-permissao-cargo" data-modulo="${m.id}" ${permissoesAtuais?.[m.id] ? 'checked' : ''} />
      ${m.label}
    </label>`).join('');
}

async function abrirFormNovoCargo() {
  _modoEdicaoCargo = null;
  $('tituloFormCargo').textContent = '+ Novo Cargo';
  $('formCargoId').value = '';
  $('formCargoNome').value = '';
  await _renderCheckboxesPermissoes({});
  $('formCargoErro').classList.add('escondido');
  $('modalFormCargo').classList.remove('escondido');
  setTimeout(() => $('formCargoNome').focus(), 100);
}

window.abrirFormEditarCargo = async function(id) {
  const cargos = await window.api.cargoslistar();
  const c = cargos.find(x => x.id === id);
  if (!c) return;

  _modoEdicaoCargo = id;
  $('tituloFormCargo').textContent = 'Editar Cargo';
  $('formCargoId').value = c.id;
  $('formCargoNome').value = c.nome;
  await _renderCheckboxesPermissoes(c.permissoes);
  $('formCargoErro').classList.add('escondido');
  $('modalFormCargo').classList.remove('escondido');
  setTimeout(() => $('formCargoNome').focus(), 100);
};

async function salvarFormCargo() {
  const nome  = $('formCargoNome').value.trim();
  const erroEl = $('formCargoErro');
  erroEl.classList.add('escondido');

  const permissoes = {};
  document.querySelectorAll('.chk-permissao-cargo').forEach(chk => {
    permissoes[chk.dataset.modulo] = chk.checked;
  });

  let res;
  try {
    if (_modoEdicaoCargo) {
      res = await window.api.cargoseditar(_modoEdicaoCargo, { nome, permissoes });
    } else {
      res = await window.api.cargoscriar({ nome, permissoes });
    }
  } catch (err) {
    erroEl.textContent = err.message;
    erroEl.classList.remove('escondido');
    return;
  }

  if (!res.sucesso) {
    erroEl.textContent = res.erro || 'Erro ao salvar cargo.';
    erroEl.classList.remove('escondido');
    return;
  }

  $('modalFormCargo').classList.add('escondido');
  await carregarListaCargos();
  toast(_modoEdicaoCargo ? 'Cargo atualizado.' : 'Cargo criado.', 'sucesso');
}

window.excluirCargoUI = async function(id) {
  if (!confirm('Deseja excluir este cargo? Essa ação não pode ser desfeita.')) return;
  try {
    const res = await window.api.cargosexcluir(id);
    if (!res.sucesso) { alert('Erro: ' + res.erro); return; }
    await carregarListaCargos();
    toast('Cargo excluído.', 'info');
  } catch (err) {
    alert('Erro: ' + err.message);
  }
};

if ($('btnCargos')) {
  $('btnCargos').addEventListener('click', abrirModalCargos);
}
if ($('btnNovoCargo')) {
  $('btnNovoCargo').addEventListener('click', abrirFormNovoCargo);
}
if ($('btnSalvarCargo')) {
  $('btnSalvarCargo').addEventListener('click', salvarFormCargo);
}

// ── Inicializa autenticação ao carregar a página ─────────────
// (substitui a chamada direta de carregarConfig/carregarHistorico/etc. do topo do arquivo)
inicializarAuth();

// ═══════════════════════════════════════════════════════════════
// MÓDULO: COMPRA DE APARELHOS
// ═══════════════════════════════════════════════════════════════

let _modoEdicaoCompra = null; // null = nova, string = número do contrato em edição

function mascaraCpfCompra(input) {
  const pos = input.selectionStart;
  const prevLen = input.value.length;
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  input.value = v;
  const diff = input.value.length - prevLen;
  input.setSelectionRange(pos + diff, pos + diff);
}
function mascaraTelCompra(input) {
  const pos = input.selectionStart;
  const prevLen = input.value.length;
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 10) v = v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  else if (v.length > 6) v = v.replace(/(\d{2})(\d{4,5})(\d{0,4})/, '($1) $2-$3');
  else if (v.length > 2) v = v.replace(/(\d{2})(\d+)/, '($1) $2');
  input.value = v;
  const diff = input.value.length - prevLen;
  input.setSelectionRange(pos + diff, pos + diff);
}

function limparFormCompra() {
  ['cpVNome','cpVCpf','cpVRg','cpVNascimento','cpVTelefone','cpVWhatsapp','cpVEmail',
   'cpVEndereco','cpVNumero','cpVBairro','cpVCidade','cpVEstado','cpVCep',
   'cpATipo','cpAMarca','cpAModelo','cpACor','cpACapacidade','cpAImei1','cpAImei2',
   'cpANumeroSerie','cpAEstado','cpASenha','cpAContaVinculada','cpAEmailConta','cpAEmailSenha','cpAContaRemovida',
   'cpAvDescricao','cpAvDefeitosInfo','cpAvDefeitosEnc','cpAvObs',
   'cpDValor','cpDFormaPagamento','cpDChavePix','cpDObs','cpTermosCompra'
  ].forEach(id => { const el = $(id); if (el) el.value = el.tagName === 'SELECT' ? '' : ''; });
  // Reset selects com value padrão
  const cv = $('cpAContaVinculada'); if (cv) cv.value = 'Não';
  const cr = $('cpAContaRemovida'); if (cr) cr.value = 'Não';
  document.querySelectorAll('.cp-acessorio, .cp-situacao').forEach(cb => cb.checked = false);
  // Peças a trocar
  const listaPecas = $('cpPecasLista');
  if (listaPecas) listaPecas.innerHTML = '';
  aplicarTermosPadraoNoCampo('compra', 'cpTermosCompra', true);
  atualizarResumoCustoCompra();
}

// ── Peças a Trocar (Contrato de Compra) ──────────────────────────
function cpAdicionarLinhaPeca(nome, valor) {
  const lista = $('cpPecasLista');
  if (!lista) return;
  const linha = document.createElement('div');
  linha.className = 'cp-peca-linha';
  linha.innerHTML = `
    <input type="text" data-campo="nome" placeholder="Peça a trocar (ex: Tela, Bateria...)" value="${(nome||'').replace(/"/g,'&quot;')}" />
    <input type="text" data-campo="valor" inputmode="decimal" placeholder="Valor R$" value="${valor!==undefined && valor!==null && valor!=='' ? String(valor).replace('.',',') : ''}" />
    <button type="button" class="cp-peca-remover" title="Remover peça">${ICONE_LIXEIRA}</button>
  `;
  linha.querySelector('.cp-peca-remover').addEventListener('click', () => {
    linha.remove();
    atualizarResumoCustoCompra();
  });
  linha.querySelector('[data-campo="valor"]').addEventListener('input', atualizarResumoCustoCompra);
  lista.appendChild(linha);
  atualizarResumoCustoCompra();
}

function cpColetarPecas() {
  return [...document.querySelectorAll('#cpPecasLista .cp-peca-linha')].map(linha => {
    const nome = linha.querySelector('[data-campo="nome"]').value.trim();
    const valor = parseFloat(linha.querySelector('[data-campo="valor"]').value.replace(',', '.')) || 0;
    return { nome, valor };
  }).filter(p => p.nome || p.valor);
}

function atualizarResumoCustoCompra() {
  const valorAparelho = parseFloat((($('cpDValor')||{}).value||'').replace(',', '.')) || 0;
  const totalPecas = cpColetarPecas().reduce((s, p) => s + p.valor, 0);
  const custoTotal = valorAparelho + totalPecas;
  const fmt = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if ($('cpResumoValorAparelho')) $('cpResumoValorAparelho').textContent = fmt(valorAparelho);
  if ($('cpResumoValorPecas'))    $('cpResumoValorPecas').textContent = fmt(totalPecas);
  if ($('cpResumoCustoTotal'))    $('cpResumoCustoTotal').textContent = fmt(custoTotal);
}

function coletarFormCompra() {
  const acessorios = [...document.querySelectorAll('.cp-acessorio:checked')].map(c => c.value);
  const situacao   = [...document.querySelectorAll('.cp-situacao:checked')].map(c => c.value);
  return {
    vendedor: {
      nome: ($('cpVNome')||{}).value?.trim(),
      cpf:  ($('cpVCpf') ||{}).value?.trim(),
      rg:   ($('cpVRg')  ||{}).value?.trim(),
      dataNascimento: ($('cpVNascimento')||{}).value,
      telefone: ($('cpVTelefone')||{}).value?.trim(),
      whatsapp: ($('cpVWhatsapp')||{}).value?.trim(),
      email:    ($('cpVEmail')   ||{}).value?.trim(),
      endereco: ($('cpVEndereco')||{}).value?.trim(),
      numero:   ($('cpVNumero')  ||{}).value?.trim(),
      bairro:   ($('cpVBairro')  ||{}).value?.trim(),
      cidade:   ($('cpVCidade')  ||{}).value?.trim(),
      estado:   ($('cpVEstado')  ||{}).value?.trim(),
      cep:      ($('cpVCep')     ||{}).value?.trim(),
    },
    aparelho: {
      tipo:   ($('cpATipo')  ||{}).value,
      marca:  ($('cpAMarca') ||{}).value?.trim(),
      modelo: ($('cpAModelo')||{}).value?.trim(),
      cor:    ($('cpACor')   ||{}).value?.trim(),
      capacidade: ($('cpACapacidade')||{}).value?.trim(),
      imei1:  ($('cpAImei1') ||{}).value?.trim(),
      imei2:  ($('cpAImei2') ||{}).value?.trim(),
      numeroSerie: ($('cpANumeroSerie')||{}).value?.trim(),
      estadoConservacao: ($('cpAEstado')||{}).value,
      senha:  ($('cpASenha') ||{}).value?.trim(),
      acessorios: acessorios,
      situacao: situacao,
      contaVinculada: ($('cpAContaVinculada')||{}).value,
      emailConta:     ($('cpAEmailConta')    ||{}).value?.trim(),
      emailSenha:     ($('cpAEmailSenha')    ||{}).value?.trim(),
      contaRemovida:  ($('cpAContaRemovida') ||{}).value === 'Sim',
    },
    avaliacao: {
      descricaoGeral:    ($('cpAvDescricao')   ||{}).value?.trim(),
      defeitosInformados:($('cpAvDefeitosInfo') ||{}).value?.trim(),
      defeitosEncontrados:($('cpAvDefeitosEnc') ||{}).value?.trim(),
      observacoes:       ($('cpAvObs')          ||{}).value?.trim(),
    },
    dadosCompra: (function() {
      const valor = parseFloat((($('cpDValor')||{}).value||'').replace(',','.')) || 0;
      const pecasTrocar = cpColetarPecas();
      const custoPecas = pecasTrocar.reduce((s, p) => s + p.valor, 0);
      return {
        valor,
        formaPagamento: ($('cpDFormaPagamento')||{}).value,
        chavePix:       ($('cpDChavePix')||{}).value?.trim(),
        observacoes:    ($('cpDObs')    ||{}).value?.trim(),
        pecasTrocar,
        custoPecas,
        custoTotal: valor + custoPecas,
      };
    })(),
    termosCompra: ($('cpTermosCompra') || {}).value?.trim() || ''
  };
}

function preencherFormCompra(cp) {
  const v = cp.vendedor || {};
  const ap = cp.aparelho || {};
  const av = cp.avaliacao || {};
  const dc = cp.dadosCompra || {};
  const set = (id, val) => { const el = $(id); if (el) el.value = val || ''; };
  set('cpVNome', v.nome); set('cpVCpf', v.cpf); set('cpVRg', v.rg);
  set('cpVNascimento', v.dataNascimento); set('cpVTelefone', v.telefone);
  set('cpVWhatsapp', v.whatsapp); set('cpVEmail', v.email);
  set('cpVEndereco', v.endereco); set('cpVNumero', v.numero);
  set('cpVBairro', v.bairro); set('cpVCidade', v.cidade);
  set('cpVEstado', v.estado); set('cpVCep', v.cep);
  set('cpATipo', ap.tipo); set('cpAMarca', ap.marca); set('cpAModelo', ap.modelo);
  set('cpACor', ap.cor); set('cpACapacidade', ap.capacidade);
  set('cpAImei1', ap.imei1); set('cpAImei2', ap.imei2);
  set('cpANumeroSerie', ap.numeroSerie); set('cpAEstado', ap.estadoConservacao);
  set('cpASenha', ap.senha);
  set('cpAContaVinculada', ap.contaVinculada || 'Não');
  set('cpAEmailConta', ap.emailConta);
  set('cpAEmailSenha', ap.emailSenha);
  set('cpAContaRemovida', ap.contaRemovida ? 'Sim' : 'Não');
  set('cpAvDescricao', av.descricaoGeral); set('cpAvDefeitosInfo', av.defeitosInformados);
  set('cpAvDefeitosEnc', av.defeitosEncontrados); set('cpAvObs', av.observacoes);
  set('cpDValor', dc.valor || ''); set('cpDFormaPagamento', dc.formaPagamento);
  set('cpDChavePix', dc.chavePix); set('cpDObs', dc.observacoes);
  set('cpTermosCompra', cp.termosCompra);
  if (($('cpTermosCompra')?.value || '').trim()) atualizarIndicadorTermos('cpTermosCompra', true);
  else aplicarTermosPadraoNoCampo('compra', 'cpTermosCompra', true);
  // Checkboxes
  document.querySelectorAll('.cp-acessorio').forEach(cb => {
    cb.checked = (ap.acessorios || []).includes(cb.value);
  });
  document.querySelectorAll('.cp-situacao').forEach(cb => {
    cb.checked = (ap.situacao || []).includes(cb.value);
  });
  // Peças a trocar
  const listaPecas = $('cpPecasLista');
  if (listaPecas) {
    listaPecas.innerHTML = '';
    (dc.pecasTrocar || []).forEach(p => cpAdicionarLinhaPeca(p.nome, p.valor));
  }
  atualizarResumoCustoCompra();
}

async function carregarCompras(termo) {
  const lista = $('compraListagem');
  if (!lista) return;
  lista.innerHTML = '<div style="padding:20px;color:#888;">Carregando...</div>';
  const infoEl = $('compraInfoBusca');
  try {
    const [compras, itensEstoque] = await Promise.all([
      termo ? window.api.comprabuscar({ termo }) : window.api.compralistar(),
      window.api.estoquelistar().catch(() => [])
    ]);
    const estoquePorCompra = new Map((itensEstoque || [])
      .filter(item => item.numeroCompra)
      .map(item => [item.numeroCompra, item]));

    // Feedback da busca
    if (infoEl) {
      if (termo) {
        infoEl.style.display = 'block';
        infoEl.innerHTML = compras && compras.length > 0
          ? `<b>${compras.length}</b> resultado${compras.length !== 1 ? 's' : ''} para "<b>${_escHtml(termo)}</b>"`
          : `Nenhum resultado para "<b>${_escHtml(termo)}</b>"`;
      } else {
        infoEl.style.display = compras && compras.length > 0
          ? 'block' : 'none';
        if (compras && compras.length > 0)
          infoEl.innerHTML = `<b>${compras.length}</b> contrato${compras.length !== 1 ? 's' : ''} cadastrado${compras.length !== 1 ? 's' : ''}`;
      }
    }

    if (!compras || compras.length === 0) {
      lista.innerHTML = termo
        ? `<div style="padding:32px;text-align:center;color:#888;">Nenhum resultado encontrado para "<b>${_escHtml(termo)}</b>".<br><small>Tente buscar pelo número, nome, CPF, IMEI ou modelo.</small></div>`
        : '<div style="padding:32px;text-align:center;color:#888;">Nenhum contrato cadastrado ainda.</div>';
      return;
    }
    lista.innerHTML = compras.map(cp => {
      const v = cp.vendedor || {};
      const ap = cp.aparelho || {};
      const dc = cp.dadosCompra || {};
      const dataFmt = cp.data ? new Date(cp.data).toLocaleDateString('pt-BR') : '—';
      const valorFmt = dc.valor ? Number(dc.valor).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'R$ 0,00';
      const custoPecasFmt = Number(dc.custoPecas || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      const custoTotalFmt = Number(dc.custoTotal ?? ((Number(dc.valor) || 0) + (Number(dc.custoPecas) || 0)))
        .toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      const subInfo = [ap.cor, ap.imei1 ? 'IMEI: '+ap.imei1 : '', ap.estadoConservacao].filter(Boolean).join(' · ') || (v.cpf ? 'CPF: '+v.cpf : '');
      const itemVinculado = estoquePorCompra.get(cp.numero);
      const numeroJs = _argJsUri(cp.numero);
      return `<div class="card-estoque compra-card" onclick="verDetalheCompra(decodeURIComponent('${numeroJs}'))">
        <div class="compra-card-topo">
          <div class="card-est-marca">${ICONE_IMPORTAR} ${_escHtml(ap.marca || '')} ${_escHtml(ap.modelo || ap.tipo || '—')}</div>
          <span class="status-badge status-analise">${_escHtml(ap.estadoConservacao || 'Em análise')}</span>
        </div>
        <div class="compra-card-subtitulo">${_escHtml(subInfo)}</div>
        <div class="compra-card-numero">${_escHtml(cp.numero)} · ${dataFmt}</div>
        ${itemVinculado ? `<span class="compra-vinculo-chip">Vinculada ao estoque ${_escHtml(itemVinculado.id)}</span>` : ''}
        <div class="compra-card-meta">
          <span><small>Vendedor</small><strong>${_escHtml(v.nome || '—')}</strong></span>
          <span><small>Compra</small><strong>${valorFmt}</strong></span>
          <span><small>Peças</small><strong>${custoPecasFmt}</strong></span>
          <span class="compra-card-total"><small>Total investido</small><strong>${custoTotalFmt}</strong></span>
        </div>
        <div class="historico-item-acoes" style="margin-top:10px;" onclick="event.stopPropagation()">
          <button class="botao botao-xs" onclick="editarCompra(decodeURIComponent('${numeroJs}'))">${ICONE_LAPIS} Editar</button>
          <button class="botao botao-xs" onclick="gerarPdfCompraUI(decodeURIComponent('${numeroJs}'))">PDF</button>
          <button class="botao botao-xs botao-perigo" onclick="excluirCompraUI(decodeURIComponent('${numeroJs}'))">${ICONE_LIXEIRA} Excluir</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    lista.innerHTML = `<div style="padding:20px;color:red;">Erro: ${_escHtml(err.message)}</div>`;
  }
}

window.verDetalheCompra = async function(numero) {
  const cp = await window.api.compraobterpornumero(numero);
  if (!cp) return;
  const v = cp.vendedor || {};
  const ap = cp.aparelho || {};
  const av = cp.avaliacao || {};
  const dc = cp.dadosCompra || {};
  const valorFmt = dc.valor ? Number(dc.valor).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : '—';
  const custoPecasFmt = Number(dc.custoPecas || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const custoTotalFmt = Number(dc.custoTotal ?? ((Number(dc.valor) || 0) + (Number(dc.custoPecas) || 0)))
    .toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const pecasCompraHtml = (Array.isArray(dc.pecasTrocar) ? dc.pecasTrocar : [])
    .map(item => `<li>${_escHtml(String(item?.nome || 'Item'))}: <b>${fmtMoeda(Number(item?.valor) || 0)}</b></li>`)
    .join('');
  const fotosHtml = (Array.isArray(cp.fotos) ? cp.fotos : []).map((foto) => {
    const src = foto?.base64 || caminhoParaFileUrl(foto?.path || '');
    if (!src) return '';
    const srcSeguro = _escHtml(src);
    return `<button type="button" class="foto-thumb" data-foto-src="${srcSeguro}" onclick="abrirLightboxFoto(this.dataset.fotoSrc)" aria-label="Ampliar foto da compra"><img src="${srcSeguro}" alt="Foto do aparelho comprado" /></button>`;
  }).filter(Boolean).join('');
  const dataFmt = cp.data ? new Date(cp.data).toLocaleDateString('pt-BR') : '—';
  const numeroJs = _argJsUri(numero);
  $('detalheCompraNumero').textContent = numero;
  $('detalheCompraConteudo').innerHTML = `
    <div style="padding:16px;">
      <h3 style="margin-bottom:8px;"> Vendedor</h3>
      <p><b>Nome:</b> ${_escHtml(v.nome||'—')} &nbsp; <b>CPF:</b> ${_escHtml(v.cpf||'—')} &nbsp; <b>RG:</b> ${_escHtml(v.rg||'—')}</p>
      <p><b>Telefone:</b> ${_escHtml(v.telefone||'—')} &nbsp; <b>WhatsApp:</b> ${_escHtml(v.whatsapp||'—')} &nbsp; <b>E-mail:</b> ${_escHtml(v.email||'—')}</p>
      <p><b>Endereço:</b> ${_escHtml([v.endereco,v.numero,v.bairro,v.cidade,v.estado].filter(Boolean).join(', ')||'—')}</p>
      <hr style="margin:12px 0;"/>
      <h3 style="margin-bottom:8px;">Aparelho</h3>
      <p><b>Tipo:</b> ${_escHtml(ap.tipo||'—')} &nbsp; <b>Marca:</b> ${_escHtml(ap.marca||'—')} &nbsp; <b>Modelo:</b> ${_escHtml(ap.modelo||'—')}</p>
      <p><b>Cor:</b> ${_escHtml(ap.cor||'—')} &nbsp; <b>Capacidade:</b> ${_escHtml(ap.capacidade||'—')} &nbsp; <b>Estado:</b> ${_escHtml(ap.estadoConservacao||'—')}</p>
      <p><b>IMEI 1:</b> ${_escHtml(ap.imei1||'—')} &nbsp; <b>IMEI 2:</b> ${_escHtml(ap.imei2||'—')} &nbsp; <b>N° Série:</b> ${_escHtml(ap.numeroSerie||'—')}</p>
      <p><b>Situação:</b> ${_escHtml((ap.situacao||[]).join(', ')||'—')}</p>
      <p><b>Acessórios:</b> ${_escHtml((ap.acessorios||[]).join(', ')||'—')}</p>
      <p><b>Conta Vinculada:</b> ${_escHtml(ap.contaVinculada||'Não')} ${ap.emailConta?'('+_escHtml(ap.emailConta)+')':''} ${ap.contaRemovida?' — Removida':''}</p>
      <hr style="margin:12px 0;"/>
      <h3 style="margin-bottom:8px;">Avaliação</h3>
      ${av.descricaoGeral?`<p><b>Descrição:</b> ${_escHtml(av.descricaoGeral)}</p>`:''}
      ${av.defeitosInformados?`<p><b>Defeitos informados:</b> ${_escHtml(av.defeitosInformados)}</p>`:''}
      ${av.defeitosEncontrados?`<p><b>Defeitos encontrados:</b> ${_escHtml(av.defeitosEncontrados)}</p>`:''}
      ${av.observacoes?`<p><b>Observações:</b> ${_escHtml(av.observacoes)}</p>`:''}
      <hr style="margin:12px 0;"/>
      <h3 style="margin-bottom:8px;">Compra</h3>
      <p><b>Data:</b> ${dataFmt} &nbsp; <b>Valor:</b> ${valorFmt} &nbsp; <b>Pagamento:</b> ${_escHtml(dc.formaPagamento||'—')}</p>
      <p><b>Custo das peças:</b> ${custoPecasFmt} &nbsp; <b>Total investido:</b> ${custoTotalFmt}</p>
      ${pecasCompraHtml ? `<p><b>Custos adicionados:</b></p><ul>${pecasCompraHtml}</ul>` : ''}
      ${dc.chavePix?`<p><b>Chave PIX:</b> ${_escHtml(dc.chavePix)}</p>`:''}
      ${dc.observacoes?`<p><b>Obs:</b> ${_escHtml(dc.observacoes)}</p>`:''}
      ${fotosHtml ? `<hr style="margin:12px 0;"/><h3 style="margin-bottom:8px;">Fotos do aparelho</h3><div class="fotos-grid">${fotosHtml}</div>` : ''}
    </div>`;
  $('detalheCompraAcoes').innerHTML = `
    <button class="botao botao-secundario" onclick="editarCompra(decodeURIComponent('${numeroJs}'));$('modalDetalheCompra').classList.add('escondido');">${ICONE_LAPIS} Editar</button>
    <button class="botao botao-primario" onclick="gerarPdfCompraUI(decodeURIComponent('${numeroJs}'))">${ICONE_DOCUMENTO} Gerar PDF</button>
    <button class="botao botao-secundario" onclick="exportarParaAssinaturaCelular('compra',decodeURIComponent('${numeroJs}'))">${ICONE_CELULAR} Enviar para assinatura no celular</button>`;
  $('modalDetalheCompra').classList.remove('escondido');
};

window.editarCompra = async function(numero) {
  const cp = await window.api.compraobterpornumero(numero);
  if (!cp) return;
  limparFormCompra();
  preencherFormCompra(cp);
  _modoEdicaoCompra = numero;
  $('tituloFormCompra').textContent = `Editar Contrato ${numero}`;
  resetarBotaoFecharModal('modalFormCompra');
  $('modalFormCompra').classList.remove('escondido');
};

window.gerarPdfCompraUI = async function(numero) {
  try {
    toast('Gerando PDF...', 'info');
    const caminho = await window.api.compragerarpdf(numero);
    await window.api.compraabrirpdf(caminho);
    toast('PDF gerado e aberto.', 'sucesso');
  } catch (err) {
    alert('Erro ao gerar PDF: ' + err.message);
  }
};

window.excluirCompraUI = async function(numero) {
  if (!(await autorizarExclusaoProtegida(`o contrato ${numero}`))) return;
  const responsavel = (await promptModal(`Informe seu nome (responsável pela exclusão do contrato ${numero}):`, '', { titulo: ' Responsável pela exclusão' })) || 'não identificado';
  try {
    await window.api.compraexcluir(numero, responsavel);
    toast('Contrato excluído.', 'info');
    if (typeof $ !== 'undefined') $('modalDetalheCompra')?.classList.add('escondido');
    carregarCompras();
  } catch (err) {
    toast('Erro ao excluir: ' + err.message, 'erro');
  }
};

async function salvarFormCompra() {
  const dados = coletarFormCompra();
  if (!dados.vendedor.nome) { alert('Informe o nome do vendedor.'); return; }
  if (dados.vendedor.cpf && !validarCPF(dados.vendedor.cpf)) { alert('O CPF do vendedor é inválido. Corrija ou deixe o campo vazio.'); return; }
  if (!dados.aparelho.tipo || !dados.aparelho.marca || !dados.aparelho.modelo) {
    alert('Informe tipo, marca e modelo do aparelho.'); return;
  }
  if (!dados.dadosCompra.valor) { alert('Informe o valor pago.'); return; }
  try {
    if (_modoEdicaoCompra) {
      await window.api.compraatualizar(_modoEdicaoCompra, dados);
      toast('Contrato atualizado.', 'sucesso');
    } else {
      const cp = await window.api.compracriar(dados);
      toast(`Contrato ${cp.numero} criado.`, 'sucesso');
      // Gera PDF automaticamente
      try {
        const caminho = await window.api.compragerarpdf(cp.numero);
        await window.api.compraabrirpdf(caminho);
      } catch (e) { console.warn('PDF automático falhou:', e); }
    }
    marcarModalComoSalvo('modalFormCompra');
    carregarCompras();
  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
  }
}

// Listeners
if ($('btnNovaCompra')) {
  $('btnNovaCompra').addEventListener('click', () => {
    limparFormCompra();
    _modoEdicaoCompra = null;
    $('tituloFormCompra').textContent = 'Nova Compra';
    resetarBotaoFecharModal('modalFormCompra');
    $('modalFormCompra').classList.remove('escondido');
  });
}
if ($('btnSalvarCompra')) {
  $('btnSalvarCompra').addEventListener('click', salvarFormCompra);
}
if ($('btnCpAddPeca')) {
  $('btnCpAddPeca').addEventListener('click', () => cpAdicionarLinhaPeca('', ''));
}
if ($('cpDValor')) {
  $('cpDValor').addEventListener('input', atualizarResumoCustoCompra);
}
if ($('btnBuscarCompra')) {
  $('btnBuscarCompra').addEventListener('click', () => {
    const termo = ($('compraFiltroTexto')||{}).value?.trim();
    carregarCompras(termo);
  });
}
if ($('btnLimparBuscaCompra')) {
  $('btnLimparBuscaCompra').addEventListener('click', () => {
    const campo = $('compraFiltroTexto');
    if (campo) { campo.value = ''; campo.focus(); }
    const infoEl = $('compraInfoBusca');
    if (infoEl) infoEl.style.display = 'none';
    carregarCompras();
  });
}
if ($('compraFiltroTexto')) {
  $('compraFiltroTexto').addEventListener('keydown', e => {
    if (e.key === 'Enter') carregarCompras(e.target.value.trim());
    if (e.key === 'Escape') {
      e.target.value = '';
      const infoEl = $('compraInfoBusca');
      if (infoEl) infoEl.style.display = 'none';
      carregarCompras();
    }
  });
  // Busca em tempo real com debounce
  let _compraBuscaTimer = null;
  $('compraFiltroTexto').addEventListener('input', e => {
    clearTimeout(_compraBuscaTimer);
    _compraBuscaTimer = setTimeout(() => {
      carregarCompras(e.target.value.trim());
    }, 350);
  });
}

// Máscaras no modal de compra
['cpVCpf'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('input', () => mascaraCpfCompra(el));
});
['cpVTelefone','cpVWhatsapp'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('input', () => mascaraTelCompra(el));
});


// ═══════════════════════════════════════════════════════════════
// ETAPA 18 — PEÇAS E COMPONENTES + DASHBOARD DE ESTOQUE
// ═══════════════════════════════════════════════════════════════

// ── Tab switcher ──────────────────────────────────────────────
window.trocarTabEstoque = function(tab) {
  ['aparelhos','pecas','dashboard','compras'].forEach(t => {
    if (t === 'dashboard') {
      const s = $('sub-dashboard-estoque');
      const b = $('tabDashboardEst');
      if (s) s.style.display = tab === 'dashboard' ? '' : 'none';
      if (b) b.classList.toggle('ativa', tab === 'dashboard');
    } else if (t === 'compras') {
      const s = $('sub-compras-estoque');
      const b = $('tabComprasEst');
      if (s) s.style.display = tab === 'compras' ? '' : 'none';
      if (b) b.classList.toggle('ativa', tab === 'compras');
    } else {
      const sub = $('sub-' + t + '-estoque');
      const btn = $(`tab${t.charAt(0).toUpperCase()+t.slice(1)}`);
      if (sub) sub.style.display = tab === t ? '' : 'none';
      if (btn) btn.classList.toggle('ativa', tab === t);
    }
  });
  if (tab === 'pecas') carregarPecas();
  if (tab === 'dashboard') carregarDashboardEstoque();
  if (tab === 'compras') carregarCompras();
};

// ── Estado das peças ──────────────────────────────────────────
let _pecaAtualId = null;
let _pecasFiltroExtra = '';

// ── Carregar categorias no select ─────────────────────────────
async function carregarCategoriasPeca() {
  try {
    const cats = await window.api.pecacategorias();
    const sel = $('pecaCategoria');
    const selFiltro = $('pecaFiltroCategoria');
    if (sel) {
      sel.innerHTML = '<option value="">Selecione...</option>' +
        cats.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    if (selFiltro) {
      selFiltro.innerHTML = '<option value="">Todas categorias</option>' +
        cats.map(c => `<option value="${c}">${c}</option>`).join('');
    }
  } catch(e) {}
}

// ── Carregar autocomplete de modelos ─────────────────────────
async function carregarModelosAutocomplete() {
  try {
    const modelos = await window.api.modeloslistar();
    const dl = $('listModelosCompat');
    if (dl) {
      dl.innerHTML = modelos.map(m => `<option value="${m}">`).join('');
    }
  } catch(e) {}
}

// ── Render lista de peças ─────────────────────────────────────
async function carregarPecas() {
  const lista = $('listaPecas');
  if (!lista) return;
  try {
    const termo = ($('pecaFiltroTexto')?.value || '').trim();
    const cat = $('pecaFiltroCategoria')?.value || '';
    const tipoItem = $('pecaFiltroTipoItem')?.value || '';
    const filtros = { termo, categoria: cat, tipoItem };
    if (_pecasFiltroExtra === 'critico') filtros.estoqueCritico = true;
    if (_pecasFiltroExtra === 'zerado') filtros.estoqueZerado = true;
    const pecas = await window.api.pecabuscar(filtros);
    if (!pecas.length) {
      lista.innerHTML = '<p class="vazio" style="text-align:center;padding:40px;grid-column:1/-1;">Nenhum item encontrado.</p>';
      lista.className = 'lista-estoque';
      return;
    }
    lista.className = 'lista-pecas';
    lista.innerHTML = pecas.map(p => {
      let badgeClass = 'badge-qtd-ok';
      if (p.quantidade === 0) badgeClass = 'badge-qtd-zero';
      else if (p.quantidade <= p.estoqueMinimo) badgeClass = 'badge-qtd-critico';
      return `<div class="card-peca" onclick="abrirModalPeca('${p.id}')">
        <div class="card-peca-header">
          <div>
            <div class="card-peca-nome">${p.nome}</div>
            <div class="card-peca-cat">${p.tipoItem || 'Peça / Componente'} · ${p.categoria}${p.compatibilidade ? ' · ' + p.compatibilidade.slice(0,40) : ''}</div>
          </div>
          <span class="badge-qtd ${badgeClass}">${p.quantidade} un</span>
        </div>
        <div class="card-peca-valores">
          <span>Custo: ${fmtMoeda(p.custo)}</span>
          <span>Total: ${fmtMoeda(p.custo * p.quantidade)}</span>
          ${p.localizacao ? `<span>${ICONE_PIN} ${p.localizacao}</span>` : ''}
        </div>
        <div style="font-size:11px;color:var(--texto-sec);margin-top:6px;">${p.id} · ${fmtData(p.dataEntrada||p.dataCadastro)}</div>
      </div>`;
    }).join('');
  } catch(e) {
    lista.innerHTML = `<p class="vazio" style="text-align:center;padding:40px;">Erro: ${_escHtml(e.message)}</p>`;
  }
}

// ── Abrir modal peça ──────────────────────────────────────────
window.abrirModalPeca = async function(id) {
  _pecaAtualId = id || null;
  await carregarCategoriasPeca();
  await carregarModelosAutocomplete();
  const hoje = new Date().toISOString().slice(0,10);
  if (!id) {
    // novo item
    $('tituloModalPeca').textContent = 'Novo Item de Estoque';
    $('pecaTipoItem').value = 'Peça / Componente';
    $('pecaNome').value = '';
    $('pecaCategoria').value = '';
    $('pecaCompatibilidade').value = '';
    $('pecaFornecedor').value = '';
    $('pecaCusto').value = '';
    $('pecaQuantidade').value = '1';
    $('pecaQuantidade').readOnly = false;
    $('dicaQuantidadePeca').textContent = 'No cadastro, informe o saldo inicial.';
    $('pecaEstoqueMinimo').value = '1';
    $('pecaLocalizacao').value = '';
    $('pecaDataEntrada').value = hoje;
    $('pecaObs').value = '';
    $('btnExcluirPeca').style.display = 'none';
    $('btnEntradaPeca').style.display = 'none';
    $('btnSaidaPeca').style.display = 'none';
    $('msgPeca').textContent = '';
  } else {
    try {
      const p = await window.api.pecaobter(id);
      if (!p) { toast('Item não encontrado.', 'erro'); return; }
      $('tituloModalPeca').textContent = 'Editar Item — ' + p.nome;
      $('pecaTipoItem').value = p.tipoItem || 'Peça / Componente';
      $('pecaNome').value = p.nome || '';
      $('pecaCategoria').value = p.categoria || '';
      $('pecaCompatibilidade').value = p.compatibilidade || '';
      $('pecaFornecedor').value = p.fornecedor || '';
      $('pecaCusto').value = p.custo || '';
      $('pecaQuantidade').value = p.quantidade ?? '';
      $('pecaQuantidade').readOnly = true;
      $('dicaQuantidadePeca').textContent = 'Use os botões Entrada e Saída para alterar o saldo com histórico.';
      $('pecaEstoqueMinimo').value = p.estoqueMinimo ?? '';
      $('pecaLocalizacao').value = p.localizacao || '';
      $('pecaDataEntrada').value = (p.dataEntrada || hoje).slice(0,10);
      $('pecaObs').value = p.observacoes || '';
      $('btnExcluirPeca').style.display = '';
      $('btnEntradaPeca').style.display = '';
      $('btnSaidaPeca').style.display = '';
      $('msgPeca').textContent = '';
    } catch(e) { toast('Erro ao carregar peça.', 'erro'); return; }
  }
  resetarBotaoFecharModal('modalPeca');
  $('modalPeca').classList.remove('escondido');
  setTimeout(() => $('pecaNome')?.focus(), 100);
};

// ── Salvar peça ───────────────────────────────────────────────
if ($('btnSalvarPeca')) {
  $('btnSalvarPeca').addEventListener('click', async () => {
    const dados = {
      tipoItem: $('pecaTipoItem').value,
      nome: $('pecaNome').value.trim(),
      categoria: $('pecaCategoria').value,
      compatibilidade: $('pecaCompatibilidade').value.trim(),
      fornecedor: $('pecaFornecedor').value.trim(),
      custo: parseFloat($('pecaCusto').value) || 0,
      quantidade: parseInt($('pecaQuantidade').value) || 0,
      estoqueMinimo: parseInt($('pecaEstoqueMinimo').value) || 0,
      localizacao: $('pecaLocalizacao').value.trim(),
      dataEntrada: $('pecaDataEntrada').value,
      observacoes: $('pecaObs').value.trim()
    };
    const msg = $('msgPeca');
    msg.textContent = '';
    try {
      if (_pecaAtualId) {
        await window.api.pecaatualizar(_pecaAtualId, dados);
        toast('Item atualizado com sucesso.', 'sucesso');
      } else {
        await window.api.pecacriar(dados);
        toast('Item cadastrado com sucesso.', 'sucesso');
        // Registrar modelos para autocomplete
        if (dados.compatibilidade) {
          dados.compatibilidade.split(/[,;]/).forEach(async m => {
            const t = m.trim();
            if (t) await window.api.modelosregistrar(t).catch(() => {});
          });
        }
      }
      marcarModalComoSalvo('modalPeca');
      carregarPecas();
    } catch(e) {
      msg.style.color = 'var(--erro)';
      msg.textContent = e.message || 'Erro ao salvar item.';
    }
  });
}

// ── Excluir peça ──────────────────────────────────────────────
if ($('btnExcluirPeca')) {
  $('btnExcluirPeca').addEventListener('click', async () => {
    if (!_pecaAtualId) return;
    if (!confirm('Tem certeza que deseja excluir este item do estoque?')) return;
    try {
      const r = await window.api.pecaexcluir(_pecaAtualId, usuarioAtual?.login || '');
      if (r?.sucesso) {
        toast('Item removido com sucesso.', 'sucesso');
        $('modalPeca').classList.add('escondido');
        carregarPecas();
      } else {
        toast(r?.erro || 'Erro ao excluir.', 'erro');
      }
    } catch(e) {
      toast(e.message || 'Erro ao excluir.', 'erro');
    }
  });
}

// ── Entrada e saída manual de peças, consumíveis e acessórios ───────────
let _movimentacaoPecaTipo = '';

async function abrirModalMovimentacaoPeca(tipo) {
  if (!_pecaAtualId || !['entrada', 'saida'].includes(tipo)) return;
  const peca = await window.api.pecaobter(_pecaAtualId);
  if (!peca) { toast('Item não encontrado.', 'erro'); return; }
  _movimentacaoPecaTipo = tipo;
  $('tituloMovimentacaoPeca').textContent = tipo === 'entrada' ? 'Registrar Entrada' : 'Registrar Saída';
  $('resumoMovimentacaoPeca').textContent = `${peca.nome} — saldo atual: ${peca.quantidade || 0} un`;
  $('movimentacaoPecaQuantidade').value = '1';
  if (tipo === 'saida') $('movimentacaoPecaQuantidade').max = String(peca.quantidade || 0);
  else $('movimentacaoPecaQuantidade').removeAttribute('max');
  $('movimentacaoPecaMotivo').value = '';
  $('msgMovimentacaoPeca').textContent = '';
  resetarBotaoFecharModal('modalMovimentacaoPeca');
  $('modalMovimentacaoPeca').classList.remove('escondido');
  setTimeout(() => $('movimentacaoPecaQuantidade')?.focus(), 100);
}

if ($('btnEntradaPeca')) {
  $('btnEntradaPeca').addEventListener('click', () => abrirModalMovimentacaoPeca('entrada'));
}
if ($('btnSaidaPeca')) {
  $('btnSaidaPeca').addEventListener('click', () => abrirModalMovimentacaoPeca('saida'));
}
if ($('btnConfirmarMovimentacaoPeca')) {
  $('btnConfirmarMovimentacaoPeca').addEventListener('click', async () => {
    const quantidade = parseInt($('movimentacaoPecaQuantidade').value, 10);
    const motivo = $('movimentacaoPecaMotivo').value.trim();
    const msg = $('msgMovimentacaoPeca');
    msg.textContent = '';
    try {
      const resultado = await window.api.pecamovimentar(
        _pecaAtualId,
        _movimentacaoPecaTipo,
        quantidade,
        {
          motivo,
          referencia: 'Movimentação manual',
          usuario: usuarioAtual?.login || ''
        }
      );
      if (!resultado?.sucesso) throw new Error(resultado?.erro || 'Não foi possível movimentar o estoque.');
      $('modalMovimentacaoPeca').classList.add('escondido');
      toast(_movimentacaoPecaTipo === 'entrada' ? 'Entrada registrada.' : 'Saída registrada.', 'sucesso');
      await abrirModalPeca(_pecaAtualId);
      carregarPecas();
    } catch (erro) {
      msg.style.color = 'var(--erro)';
      msg.textContent = erro.message || 'Erro ao movimentar o estoque.';
    }
  });
}

// ── Botão nova peça ───────────────────────────────────────────
if ($('btnNovaPeca')) {
  $('btnNovaPeca').addEventListener('click', () => abrirModalPeca(null));
}

// ── Filtros de peças ──────────────────────────────────────────
if ($('pecaFiltroTexto')) {
  let _pecaBuscaTimer = null;
  $('pecaFiltroTexto').addEventListener('input', () => {
    clearTimeout(_pecaBuscaTimer);
    _pecaBuscaTimer = setTimeout(carregarPecas, 300);
  });
}
if ($('pecaFiltroCategoria')) {
  $('pecaFiltroCategoria').addEventListener('change', carregarPecas);
}
if ($('pecaFiltroTipoItem')) {
  $('pecaFiltroTipoItem').addEventListener('change', carregarPecas);
}
if ($('btnLimparBuscaPeca')) {
  $('btnLimparBuscaPeca').addEventListener('click', () => {
    if ($('pecaFiltroTexto')) $('pecaFiltroTexto').value = '';
    if ($('pecaFiltroTipoItem')) $('pecaFiltroTipoItem').value = '';
    if ($('pecaFiltroCategoria')) $('pecaFiltroCategoria').value = '';
    _pecasFiltroExtra = '';
    document.querySelectorAll('[data-filtro-peca]').forEach(b => b.classList.remove('ativo'));
    const todasBtn = document.querySelector('[data-filtro-peca=""]');
    if (todasBtn) todasBtn.classList.add('ativo');
    carregarPecas();
  });
}
document.querySelectorAll('[data-filtro-peca]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-filtro-peca]').forEach(b => b.classList.remove('ativo'));
    btn.classList.add('ativo');
    _pecasFiltroExtra = btn.dataset.filtroPeca || '';
    carregarPecas();
  });
});

// ── Dashboard de Estoque ──────────────────────────────────────
async function carregarDashboardEstoque() {
  const cont = $('dashboardEstoqueConteudo');
  if (!cont) return;
  try {
    const d = await window.api.estoquedashboard();
    const kpi = (val, label, destaque) =>
      `<div class="kpi-card-est${destaque ? ' destaque' : ''}">
        <div class="kpi-valor">${val}</div>
        <div class="kpi-label">${label}</div>
      </div>`;
    const maisUsadasHTML = d.maisUsadas && d.maisUsadas.length
      ? `<ul class="lista-mais-usadas">${d.maisUsadas.map(p =>
          `<li><span>${p.nome} <small style="color:var(--texto-sec)">(${p.categoria})</small></span><strong>${p.vezes}x usada</strong></li>`
        ).join('')}</ul>`
      : '<p style="color:var(--texto-sec);font-size:13px;">Nenhum uso registrado ainda.</p>';
    cont.innerHTML = `
      <h3 style="font-size:16px;font-weight:700;margin-bottom:14px;">Resumo do Estoque</h3>
      <div class="dashboard-grid-est">
        ${kpi(fmtMoeda(d.valorTotalEstoque), 'Valor Total em Estoque', true)}
        ${kpi(fmtMoeda(d.valorAparelhos), 'Investido em Aparelhos')}
        ${kpi(fmtMoeda(d.valorPecas), 'Investido em Peças')}
        ${kpi(fmtMoeda(d.lucroPotencial >= 0 ? d.lucroPotencial : 0), 'Lucro Potencial (aparelhos)', d.lucroPotencial > 0)}
        ${kpi(d.qtdAparelhos, 'Total de Aparelhos')}
        ${kpi(d.qtdPecas, 'Tipos de Peças')}
        ${kpi(d.qtdItensEmPecas, 'Itens em Peças')}
        ${kpi(d.disponiveis, 'Aparelhos p/ Venda')}
        ${kpi(`<span style="color:${d.pecasCriticas>0?'#d97706':'inherit'}">${d.pecasCriticas}</span>`, 'Peças em Estoque Crítico')}
        ${kpi(`<span style="color:${d.pecasZeradas>0?'#dc2626':'inherit'}">${d.pecasZeradas}</span>`, 'Peças Zeradas')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px;">
        <div class="card">
          <div class="card-titulo" style="font-size:14px;margin-bottom:10px;">${ICONE_FERRAMENTA} Peças Mais Utilizadas</div>
          ${maisUsadasHTML}
        </div>
        <div class="card">
          <div class="card-titulo" style="font-size:14px;margin-bottom:10px;">${ICONE_DOCUMENTO} Últimas Movimentações</div>
          ${d.ultimasMovimentacoes && d.ultimasMovimentacoes.length
            ? `<ul class="lista-mais-usadas">${d.ultimasMovimentacoes.map(l =>
                `<li><span>${l.nome || l.id} <small style="color:var(--texto-sec)">${l.tipo}</small></span><small>${fmtData(l.data)}</small></li>`
              ).join('')}</ul>`
            : '<p style="color:var(--texto-sec);font-size:13px;">Sem movimentações ainda.</p>'}
        </div>
      </div>

      <!-- ── Cards financeiros (ex-aba Painel) ── -->
      <h3 style="font-size:16px;font-weight:700;margin:24px 0 14px;">Painel Financeiro</h3>
      <div class="painel-cards" id="painelCards"></div>
      <div class="painel-graficos">
        <div class="card">
          <div class="card-titulo">Atividade por Mês</div>
          <div id="graficoMeses"></div>
        </div>
      </div>`;
    if (typeof carregarPainel === 'function') await carregarPainel();
  } catch(e) {
    cont.innerHTML = `<p style="text-align:center;color:var(--erro);">Erro ao carregar dashboard: ${_escHtml(e.message)}</p>`;
  }
}

// ── Carregar categorias quando aba estoque abre ───────────────
document.querySelector('[data-aba="estoque"]')?.addEventListener('click', () => {
  setTimeout(carregarCategoriasPeca, 200);
});


// ═══════════════════════════════════════════════════════════════
// PEÇAS TROCADAS (MANUAL) NA OS — nome + valor livre, sem depender do
// estoque cadastrado. Mesmo padrão já usado no Contrato de Compra
// (cpAdicionarLinhaPeca/cpColetarPecas), reaproveitado aqui para os
// formulários de Nova OS ('nv') e Editar OS ('ed'). Soma ao custo total
// da OS junto com o que já é baixado do estoque (ETAPA 18, mais abaixo).
// ═══════════════════════════════════════════════════════════════
const _PECAS_TROCAR_IDS = {
  nv: { lista: 'diagPecasTrocarLista', addBtn: 'btnDiagAddPecaTrocar', resumo: 'diagResumoCustoPecas' },
  ed: { lista: 'editDiagPecasTrocarLista', addBtn: 'btnEditDiagAddPecaTrocar', resumo: 'editDiagResumoCustoPecas' }
};

function diagAdicionarLinhaPecaTrocar(prefixo, nome, valor) {
  const ids = _PECAS_TROCAR_IDS[prefixo];
  const lista = $(ids.lista);
  if (!lista) return;
  const linha = document.createElement('div');
  linha.className = 'cp-peca-linha';
  linha.innerHTML = `
    <input type="text" data-campo="nome" placeholder="Peça trocada (ex: Tela, Bateria...)" value="${(nome||'').replace(/"/g,'&quot;')}" />
    <input type="text" data-campo="valor" inputmode="decimal" placeholder="Valor R$" value="${valor!==undefined && valor!==null && valor!=='' ? String(valor).replace('.',',') : ''}" />
    <button type="button" class="cp-peca-remover" title="Remover peça">${ICONE_LIXEIRA}</button>
  `;
  linha.querySelector('.cp-peca-remover').addEventListener('click', () => {
    linha.remove();
    diagAtualizarResumoCustoPecas(prefixo);
  });
  linha.querySelector('[data-campo="valor"]').addEventListener('input', () => diagAtualizarResumoCustoPecas(prefixo));
  lista.appendChild(linha);
  diagAtualizarResumoCustoPecas(prefixo);
}

function diagColetarPecasTrocar(prefixo) {
  const ids = _PECAS_TROCAR_IDS[prefixo];
  return [...document.querySelectorAll(`#${ids.lista} .cp-peca-linha`)].map(linha => {
    const nome = linha.querySelector('[data-campo="nome"]').value.trim();
    const valor = parseFloat(linha.querySelector('[data-campo="valor"]').value.replace(',', '.')) || 0;
    return { nome, valor };
  }).filter(p => p.nome || p.valor);
}

function diagAtualizarResumoCustoPecas(prefixo) {
  const ids = _PECAS_TROCAR_IDS[prefixo];
  const total = diagColetarPecasTrocar(prefixo).reduce((s, p) => s + p.valor, 0);
  const el = $(ids.resumo);
  if (el) el.textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function diagLimparPecasTrocar(prefixo) {
  const ids = _PECAS_TROCAR_IDS[prefixo];
  const lista = $(ids.lista);
  if (lista) lista.innerHTML = '';
  diagAtualizarResumoCustoPecas(prefixo);
}

Object.keys(_PECAS_TROCAR_IDS).forEach(prefixo => {
  const btn = $(_PECAS_TROCAR_IDS[prefixo].addBtn);
  if (btn) btn.addEventListener('click', () => diagAdicionarLinhaPecaTrocar(prefixo, '', ''));
});

// ═══════════════════════════════════════════════════════════════
// ETAPA 18 — INTEGRAÇÃO OS ↔ PEÇAS DO ESTOQUE
// ═══════════════════════════════════════════════════════════════

// Lista de peças adicionadas à OS atual (array de {id, nome, categoria, quantidade, custoUnit})
let _pecasNaOS = [];

// Renderiza a lista de peças vinculadas à OS no formulário
function renderizarPecasNaOS() {
  const cont = $('listaPecasOS');
  if (!cont) return;
  if (!_pecasNaOS.length) {
    cont.innerHTML = '<p style="font-size:12px;color:var(--texto-sec);margin:0;">Nenhuma peça selecionada.</p>';
    return;
  }
  cont.innerHTML = _pecasNaOS.map((p, idx) =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--borda);gap:8px;">
      <span style="font-size:13px;flex:1;">${p.nome} <small style="color:var(--texto-sec)">(${p.categoria})</small></span>
      <div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:12px;color:var(--texto-sec);">Qtd:</label>
        <input type="number" min="1" value="${p.quantidade}" style="width:56px;padding:3px 6px;border:1px solid var(--borda);border-radius:6px;background:var(--bg-input,var(--bg-card));color:var(--texto);font-size:13px;"
          onchange="alterarQtdPecaOS(${idx}, this.value)" />
        <button onclick="removerPecaOS(${idx})" style="background:none;border:none;color:var(--erro);cursor:pointer;font-size:15px;" title="Remover">${ICONE_X}</button>
      </div>
    </div>`
  ).join('');
}

window.alterarQtdPecaOS = function(idx, val) {
  const qtd = parseInt(val) || 1;
  if (_pecasNaOS[idx]) _pecasNaOS[idx].quantidade = qtd;
};

window.removerPecaOS = function(idx) {
  _pecasNaOS.splice(idx, 1);
  renderizarPecasNaOS();
};

// ── Modal genérico: Buscar OS por nome/CPF/número ──────────────────────
// Usado pela aba Garantia (e reaproveitável por qualquer outro campo que
// precise "atrelar" um documento a uma OS). Busca com window.api.osbuscar
// (mesma busca combinada — nome, CPF, telefone, número — já usada na aba
// OS). Ao confirmar, chama o callback registrado em _buscaOSGenericoCtx.
let _buscaOSGenericoCtx = null;

window.abrirBuscaOSGenerico = function (contexto) {
  _buscaOSGenericoCtx = contexto;
  $('modalBuscarOSGenerico').classList.remove('escondido');
  $('buscaOSGenerico').value = '';
  $('resultadosBuscaOSGenerico').innerHTML = '<p style="text-align:center;color:var(--texto-sec);padding:20px;">Digite para buscar...</p>';
  setTimeout(() => $('buscaOSGenerico')?.focus(), 100);
};

if ($('buscaOSGenerico')) {
  let _timerBuscaOS = null;
  $('buscaOSGenerico').addEventListener('input', (e) => {
    clearTimeout(_timerBuscaOS);
    const termo = e.target.value.trim();
    if (!termo) {
      $('resultadosBuscaOSGenerico').innerHTML = '<p style="text-align:center;color:var(--texto-sec);padding:20px;">Digite para buscar...</p>';
      return;
    }
    _timerBuscaOS = setTimeout(async () => {
      try {
        const oss = await window.api.osbuscar(termo);
        const cont = $('resultadosBuscaOSGenerico');
        if (!oss.length) {
          cont.innerHTML = '<p style="text-align:center;color:var(--texto-sec);padding:20px;">Nenhuma OS encontrada.</p>';
          return;
        }
        cont.innerHTML = oss.slice(0, 30).map(os => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 8px;border-bottom:1px solid var(--borda);gap:8px;">
            <div>
              <div style="font-size:13px;font-weight:600;">${os.numero} — ${os.cliente?.nome || 'Sem nome'}</div>
              <div style="font-size:11px;color:var(--texto-sec);">${os.cliente?.telefone || 'Sem telefone'}${os.aparelho?.modelo ? ' · ' + os.aparelho.modelo : ''}</div>
            </div>
            <button onclick="confirmarBuscaOSGenerico('${os.numero}')" class="botao botao-primario" style="font-size:12px;padding:5px 12px;white-space:nowrap;">
              ${ICONE_CHECK} Confirmar
            </button>
          </div>`).join('');
      } catch (e) {
        $('resultadosBuscaOSGenerico').innerHTML = `<p style="text-align:center;color:var(--erro);padding:20px;">${_escHtml(e.message)}</p>`;
      }
    }, 300);
  });
}

window.confirmarBuscaOSGenerico = function (numeroOS) {
  $('modalBuscarOSGenerico').classList.add('escondido');
  if (_buscaOSGenericoCtx === 'garantia') {
    window.buscarOSParaGarantia(numeroOS);
  } else if (_buscaOSGenericoCtx === 'entrega') {
    window.buscarOSParaNovaEntrega(numeroOS);
  }
};

document.querySelectorAll('[data-fechar="modalBuscarOSGenerico"]').forEach(btn => {
  btn.addEventListener('click', () => $('modalBuscarOSGenerico').classList.add('escondido'));
});

if ($('btnAdicionarPecaOS')) {
  $('btnAdicionarPecaOS').addEventListener('click', () => {
    $('modalSelecionarPeca').classList.remove('escondido');
    $('buscaPecaOS').value = '';
    $('resultadosBuscaPecaOS').innerHTML = '<p style="text-align:center;color:var(--texto-sec);padding:20px;">Digite para buscar...</p>';
    setTimeout(() => $('buscaPecaOS')?.focus(), 100);
  });
}

// Busca de peças no modal de seleção
if ($('buscaPecaOS')) {
  let _timer = null;
  $('buscaPecaOS').addEventListener('input', async (e) => {
    clearTimeout(_timer);
    const termo = e.target.value.trim();
    if (!termo) {
      $('resultadosBuscaPecaOS').innerHTML = '<p style="text-align:center;color:var(--texto-sec);padding:20px;">Digite para buscar...</p>';
      return;
    }
    _timer = setTimeout(async () => {
      try {
        const pecas = await window.api.pecabuscar({ termo });
        const cont = $('resultadosBuscaPecaOS');
        if (!pecas.length) {
          cont.innerHTML = '<p style="text-align:center;color:var(--texto-sec);padding:20px;">Nenhuma peça encontrada.</p>';
          return;
        }
        cont.innerHTML = pecas.map(p => {
          const disponivel = p.quantidade > 0;
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 8px;border-bottom:1px solid var(--borda);gap:8px;">
            <div>
              <div style="font-size:13px;font-weight:600;">${p.nome}</div>
              <div style="font-size:11px;color:var(--texto-sec);">${p.categoria}${p.compatibilidade ? ' · ' + p.compatibilidade : ''}</div>
              <div style="font-size:11px;color:var(--texto-sec);">Estoque: <strong style="color:${p.quantidade===0?'var(--erro)':p.quantidade<=p.estoqueMinimo?'#d97706':'var(--sucesso)'}">${p.quantidade} un</strong> · Custo: ${fmtMoeda(p.custo)}</div>
            </div>
            <button ${!disponivel ? 'disabled title="Sem estoque"' : ''} onclick="selecionarPecaParaOS('${p.id}','${p.nome.replace(/'/g,"\\'")}','${p.categoria.replace(/'/g,"\\'")}',${p.custo},${p.quantidade})"
              class="botao botao-primario" style="font-size:12px;padding:5px 12px;white-space:nowrap;${!disponivel?'opacity:.4;cursor:not-allowed;':''}">
              + Adicionar
            </button>
          </div>`;
        }).join('');
      } catch(e) {
        $('resultadosBuscaPecaOS').innerHTML = `<p style="text-align:center;color:var(--erro);padding:20px;">${_escHtml(e.message)}</p>`;
      }
    }, 300);
  });
}

window.selecionarPecaParaOS = function(id, nome, categoria, custoUnit, estoqueDisp) {
  // Se já existe, apenas incrementa
  const existente = _pecasNaOS.find(p => p.id === id);
  if (existente) {
    if (existente.quantidade < estoqueDisp) {
      existente.quantidade++;
    } else {
      toast(`Estoque disponível: ${estoqueDisp} un.`, 'aviso');
    }
  } else {
    _pecasNaOS.push({ id, nome, categoria, custoUnit, quantidade: 1, estoqueDisp });
  }
  renderizarPecasNaOS();
  $('modalSelecionarPeca').classList.add('escondido');
  toast(`"${nome}" adicionada à OS.`, 'sucesso');
};

// Baixar estoque ao salvar OS — chamado logo após criar/atualizar OS com sucesso
async function baixarEstoquePecasDaOS(numeroOS, usuarioLogin) {
  if (!_pecasNaOS.length) return;
  for (const p of _pecasNaOS) {
    try {
      const r = await window.api.pecabaixarestoque(p.id, p.quantidade, `OS-${numeroOS}`, usuarioLogin || '');
      if (!r.sucesso) {
        toast(`Aviso: ${r.erro} (${p.nome})`, 'aviso');
      }
    } catch(e) {
      toast(`Erro ao baixar estoque de "${p.nome}": ${e.message}`, 'erro');
    }
  }
  _pecasNaOS = [];
  renderizarPecasNaOS();
}

// Hook na criação de OS — interceptar o botão salvar OS para chamar baixarEstoquePecas
// O renderer.js original já tem btnSalvarOS; vamos observar o evento de sucesso via MutationObserver
// Estratégia: monkey-patch na função de salvar OS existente
const _btnSalvarOS = $('btnSalvarOS');
if (_btnSalvarOS) {
  const _originalClick = _btnSalvarOS.onclick;
  // Adicionamos listener que captura o toast de sucesso e dispara baixa de estoque
  // via override do window.api.oscriar / osatualizar
  const _originalOscriar = window.api.oscriar;
  window.api.oscriar = async function(...args) {
    const resultado = await _originalOscriar.apply(this, args);
    if (resultado && (resultado.numero || resultado.sucesso !== false) && _pecasNaOS.length) {
      const numOS = resultado.numero || resultado;
      await baixarEstoquePecasDaOS(numOS, usuarioAtual?.login || '');
    }
    return resultado;
  };
  const _originalOsatualizar = window.api.osatualizar;
  window.api.osatualizar = async function(numero, ...rest) {
    const resultado = await _originalOsatualizar.apply(this, [numero, ...rest]);
    if (resultado && _pecasNaOS.length) {
      await baixarEstoquePecasDaOS(numero, usuarioAtual?.login || '');
    }
    return resultado;
  };
}

// Limpar peças ao fechar modal de OS
document.querySelectorAll('[data-fechar]').forEach(btn => {
  const alvo = btn.dataset.fechar;
  if (alvo === 'modalOS' || alvo === 'modalDetalheOS') {
    btn.addEventListener('click', () => {
      _pecasNaOS = [];
      renderizarPecasNaOS();
    });
  }
});

// ══════════════════════════════════════════
// INTEGRAÇÃO PEÇAS ↔ EDIÇÃO DE OS
// ══════════════════════════════════════════

let _pecasEditOS = [];

function renderizarPecasEditOS() {
  const cont = $('editListaPecasOS');
  if (!cont) return;
  if (!_pecasEditOS.length) {
    cont.innerHTML = '<p style="font-size:12px;color:var(--texto-sec);margin:0;">Nenhuma peça selecionada.</p>';
    return;
  }
  cont.innerHTML = _pecasEditOS.map((p, idx) =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--borda);gap:8px;">
      <span style="font-size:13px;flex:1;">${p.nome} <small style="color:var(--texto-sec)">(${p.categoria})</small></span>
      <div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:12px;color:var(--texto-sec);">Qtd:</label>
        <input type="number" min="1" value="${p.quantidade}" style="width:56px;padding:3px 6px;border:1px solid var(--borda);border-radius:6px;background:var(--bg-input,var(--bg-card));color:var(--texto);font-size:13px;"
          onchange="alterarQtdPecaEditOS(${idx}, this.value)" />
        <button onclick="removerPecaEditOS(${idx})" style="background:none;border:none;color:var(--erro);cursor:pointer;font-size:15px;" title="Remover">${ICONE_X}</button>
      </div>
    </div>`
  ).join('');
}

window.alterarQtdPecaEditOS = function(idx, val) {
  const qtd = parseInt(val) || 1;
  if (_pecasEditOS[idx]) _pecasEditOS[idx].quantidade = qtd;
};

window.removerPecaEditOS = function(idx) {
  _pecasEditOS.splice(idx, 1);
  renderizarPecasEditOS();
};

// Botão + Adicionar peça do estoque (modal editar OS)
if ($('btnAdicionarPecaEditOS')) {
  $('btnAdicionarPecaEditOS').addEventListener('click', () => {
    // Reutiliza o mesmo modal de seleção mas direciona para _pecasEditOS
    _modalPecaParaEdit = true;
    $('modalSelecionarPeca').classList.remove('escondido');
    $('buscaPecaOS').value = '';
    $('resultadosBuscaPecaOS').innerHTML = '<p style="text-align:center;color:var(--texto-sec);padding:20px;">Digite para buscar...</p>';
    setTimeout(() => $('buscaPecaOS')?.focus(), 100);
  });
}

// Flag para saber qual lista recebe a peça selecionada
let _modalPecaParaEdit = false;

// Override do selecionarPecaParaOS para suportar os dois contextos
const _originalSelecionarPeca = window.selecionarPecaParaOS;
window.selecionarPecaParaOS = function(id, nome, categoria, custoUnit, estoqueDisp) {
  if (_modalPecaParaEdit) {
    const existente = _pecasEditOS.find(p => p.id === id);
    if (existente) {
      if (existente.quantidade < estoqueDisp) {
        existente.quantidade++;
      } else {
        toast(`Estoque disponível: ${estoqueDisp} un.`, 'aviso');
      }
    } else {
      _pecasEditOS.push({ id, nome, categoria, custoUnit, quantidade: 1, estoqueDisp });
    }
    renderizarPecasEditOS();
    $('modalSelecionarPeca').classList.add('escondido');
    toast(`"${nome}" adicionada à OS.`, 'sucesso');
    _modalPecaParaEdit = false;
  } else {
    _originalSelecionarPeca(id, nome, categoria, custoUnit, estoqueDisp);
  }
};

// Resetar flag ao fechar modal de seleção de peça
document.querySelectorAll('[data-fechar="modalSelecionarPeca"]').forEach(btn => {
  btn.addEventListener('click', () => { _modalPecaParaEdit = false; });
});

// Baixar estoque ao salvar edição de OS
async function baixarEstoquePecasEditOS(numeroOS, usuarioLogin) {
  if (!_pecasEditOS.length) return;
  for (const p of _pecasEditOS) {
    try {
      const r = await window.api.pecabaixarestoque(p.id, p.quantidade, `OS-${numeroOS}`, usuarioLogin || '');
      if (!r.sucesso) toast(`Aviso: ${r.erro} (${p.nome})`, 'aviso');
    } catch(e) {
      toast(`Erro ao baixar estoque de "${p.nome}": ${e.message}`, 'erro');
    }
  }
  _pecasEditOS = [];
  renderizarPecasEditOS();
}

// Hook no botão salvar edição de OS
const _btnSalvarEditar = $('btnSalvarEditar');
if (_btnSalvarEditar) {
  const _originalOsatualizar2 = window.api.osatualizar;
  // Patch duplo-seguro: osatualizar pode já ter sido patchado acima (para _pecasNaOS)
  // Encadeamos um segundo patch que dispara baixa de _pecasEditOS após salvar edição
  window.api.osatualizar = async function(numero, ...rest) {
    const resultado = await _originalOsatualizar2.apply(this, [numero, ...rest]);
    if (resultado && _pecasEditOS.length) {
      await baixarEstoquePecasEditOS(numero, usuarioAtual?.login || '');
    }
    return resultado;
  };
}

// Limpar _pecasEditOS ao fechar o modal editar
document.querySelectorAll('[data-fechar="modalEditarOS"]').forEach(btn => {
  btn.addEventListener('click', () => {
    _pecasEditOS = [];
    renderizarPecasEditOS();
  });
});

// Ao abrir o modal editar OS, resetar a lista de peças
const _originalAbrirEditarOS = window.abrirEditarOS;
window.abrirEditarOS = async function(numero) {
  _pecasEditOS = [];
  await _originalAbrirEditarOS(numero);
  renderizarPecasEditOS();
};

// Expor usuarioLogado para o hook acima
const _origAuthLogin = window.api?.authlogin;



// ═══════════════════════════════════════════════════════════════
// MÓDULO: AUTORIZADAS (decisão do cliente, independente do pagamento)
// ═══════════════════════════════════════════════════════════════

// ── Aba Autorizadas no sistema de navegação ─────────────────────
document.querySelector('[data-aba="orcamentos"]')?.addEventListener('click', () => {
  carregarAutorizadas();
});

let _autorizadasSubaba = 'todas';
document.querySelectorAll('[data-orc-subaba]').forEach((botao) => {
  botao.addEventListener('click', () => {
    _autorizadasSubaba = botao.dataset.orcSubaba || 'todas';
    document.querySelectorAll('[data-orc-subaba]').forEach((item) => {
      item.classList.toggle('ativa', item === botao);
    });
    carregarAutorizadas(document.getElementById('orcFiltroTexto')?.value.trim() || '');
  });
});

window.carregarAutorizadas = async function carregarAutorizadas(termo) {
  const lista = document.getElementById('orcListagem');
  if (!lista) return;
  lista.innerHTML = '<div style="padding:20px;color:#888;grid-column:1/-1;">Carregando...</div>';
  const infoEl = document.getElementById('orcInfoBusca');
  try {
    const todas = await window.api.oslistar();
    // A aba acompanha a aprovação da OS. Pagamento aparece como informação
    // separada e nunca decide sozinho se a OS está aprovada.
    let autorizadas = todas.filter((os) => {
      if (os.status === 'Cancelado' || os.status === 'Entregue') return false;
      const aprovada = (os.statusAprovacao || (os.aceitouTermos === true ? 'Aprovado' : 'Pendente')) === 'Aprovado';
      if (!aprovada) return false;
      const naRetirada = os.statusPagamento === 'Aguardando Pagamento na Retirada'
        && os.entrada50Paga !== true;
      const pagaIntegral = ['Pago', 'Autorizado'].includes(os.statusPagamento);
      const entradaPaga = os.entrada50Paga === true && os.status !== 'Cancelado';
      if (_autorizadasSubaba === 'retirada') {
        return naRetirada;
      }
      if (_autorizadasSubaba === 'pagas') return pagaIntegral || entradaPaga;
      return true;
    });
    if (termo) {
      const t = termo.toLowerCase();
      autorizadas = autorizadas.filter(os =>
        (os.numero||'').toLowerCase().includes(t) ||
        (os.cliente?.nome||'').toLowerCase().includes(t) ||
        (os.cliente?.telefone||'').toLowerCase().includes(t) ||
        (os.aparelho?.marca||'').toLowerCase().includes(t) ||
        (os.aparelho?.modelo||'').toLowerCase().includes(t)
      );
    }
    if (infoEl) {
      infoEl.style.display = 'block';
      infoEl.innerHTML = termo
        ? `<b>${autorizadas.length}</b> resultado(s) para "<b>${_escHtml(termo)}</b>"`
        : `<b>${autorizadas.length}</b> OS ${_autorizadasSubaba === 'retirada'
          ? 'com pagamento na retirada'
          : (_autorizadasSubaba === 'pagas' ? 'paga(s)' : 'autorizada(s)')}`;
    }
    if (!autorizadas.length) {
      lista.innerHTML = `<div style="padding:32px;text-align:center;color:#888;grid-column:1/-1;">${termo ? 'Nenhum resultado.' : 'Nenhuma OS autorizada no momento.'}</div>`;
      return;
    }
    lista.innerHTML = autorizadas.map(os => {
      const cl = os.cliente || {};
      const ap = os.aparelho || {};
      const dataFmt = os.data ? new Date(os.data).toLocaleDateString('pt-BR') : '—';
      const valorFmt = _valorServicoOS(os).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      const valorCobradoFmt = _valorCobradoOS(os).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      const entrada50Paga = os.entrada50Paga === true || Number(os.percentualPagamentoConfirmado) === 50;
      const naRetirada = os.statusPagamento === 'Aguardando Pagamento na Retirada' && !entrada50Paga;
      const pagInfo = naRetirada
        ? `<span style="font-size:11px;color:#b45309;">Pagamento combinado na retirada</span>`
        : (entrada50Paga
          ? `<span style="font-size:11px;color:#059669;">${ICONE_CHECK} Entrada de 50% paga · saldo na retirada</span>`
          : (os.pagamentoId ? `<span style="font-size:11px;color:#059669;">${ICONE_CHECK} 100% pago</span>` : ''));
      const formaPagBadge = os.formaPagamento ? `<span style="display:inline-block;background:#ede9fe;color:#6d28d9;border-radius:10px;padding:1px 8px;font-size:10px;font-weight:600;margin-left:6px;white-space:nowrap;">${ICONE_CARTAO} ${_escHtml(os.formaPagamento)}</span>` : '';
      const numeroJs = _argJsUri(os.numero);
      return `<div class="card-estoque" style="cursor:pointer;" onclick="verDetalheOSrapido(decodeURIComponent('${numeroJs}'))">
        <div class="card-est-header">
          <div>
            <div class="card-est-marca">${ICONE_CELULAR} ${_escHtml(_aparelhoSemRepeticao(ap.marca, ap.modelo) || '—')}</div>
            <div class="card-est-modelo">${_escHtml(cl.nome||'—')} ${cl.telefone ? '· '+_escHtml(cl.telefone) : ''}</div>
          </div>
          <span class="status-badge ${naRetirada ? 'status-aguardando-pag' : 'status-autorizado'}">${naRetirada ? 'Pagamento na retirada' : `${ICONE_CHECK} ${entrada50Paga ? '50% pago' : '100% pago'}`}</span>
        </div>
        <div style="font-size:12px;color:var(--texto-sec);">${_escHtml(os.numero)} · ${dataFmt} ${pagInfo}${formaPagBadge}</div>
        <div class="card-est-valores">
          <span>Total: <strong>${valorFmt}</strong></span>
          <span style="font-weight:800;">Cobrado: ${valorCobradoFmt}</span>
        </div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;" onclick="event.stopPropagation()">
          <button class="botao botao-primario" style="padding:4px 9px;font-size:12px;" onclick="abrirEditarOS(decodeURIComponent('${numeroJs}'))">${ICONE_LAPIS} Editar OS</button>
          <button class="botao botao-fantasma" style="padding:4px 9px;font-size:12px;" onclick="verDetalheOSrapido(decodeURIComponent('${numeroJs}'))">${ICONE_OLHO} Detalhe</button>
        </div>
      </div>`;
    }).join('');
  } catch(err) {
    lista.innerHTML = `<div style="padding:20px;color:red;grid-column:1/-1;">Erro: ${_escHtml(err.message)}</div>`;
  }
}

// Busca com debounce
let _autorizadasBuscaTimer = null;
if (document.getElementById('orcFiltroTexto')) {
  document.getElementById('orcFiltroTexto').addEventListener('input', e => {
    clearTimeout(_autorizadasBuscaTimer);
    _autorizadasBuscaTimer = setTimeout(() => carregarAutorizadas(e.target.value.trim()), 300);
  });
}

// Abrir detalhe rápido de OS (reutiliza modal de detalhe existente)
window.verDetalheOSrapido = async function(numero) {
  try {
    const os = await window.api.osobter(numero);
    if (!os) { toast('OS não encontrada.', 'erro'); return; }
    window._osDetalhe = os;
    window.mostrarDetalheOS(os);
  } catch(err) { toast('Erro ao abrir OS: ' + err.message, 'erro'); }
};

// ═══════════════════════════════════════════════════════════════
// HISTÓRICO DO CLIENTE — exibe ao preencher CPF ou nome na Nova OS
// ═══════════════════════════════════════════════════════════════
let _histClienteTimer = null;

async function buscarHistoricoCliente() {
  const cpf = ($('cpf')||{}).value?.trim();
  const nome = ($('nome')||{}).value?.trim();
  if (!cpf && (!nome || nome.length < 3)) {
    $('historicoClienteBox')?.classList.add('escondido');
    return;
  }
  try {
    const historico = await window.api.clientehistorico(cpf, nome);
    const box = $('historicoClienteBox');
    const lista = $('historicoClienteLista');
    if (!historico || historico.length === 0) { box?.classList.add('escondido'); return; }
    lista.innerHTML = historico.map(os => {
      const dataFmt = os.data ? new Date(os.data).toLocaleDateString('pt-BR') : '—';
      const ap = os.aparelho || {};
      const numeroJs = _argJsUri(os.numero);
      return `<div style="background:var(--bg);border-radius:6px;padding:6px 10px;font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div>
          <strong>${_escHtml(os.numero)}</strong> · ${dataFmt}
          <span style="margin-left:6px;" class="${_escHtml(statusClass(os.status))}">${_escHtml(os.status)}</span>
          <div style="color:var(--texto-sec);margin-top:2px;">${_escHtml(ap.marca||'')} ${_escHtml(ap.modelo||'')} ${ap.defeitoRelatado ? '— '+_escHtml(ap.defeitoRelatado.slice(0,40))+(ap.defeitoRelatado.length>40?'…':'') : ''}</div>
        </div>
        <button class="botao botao-xs" onclick="verDetalheOS(decodeURIComponent('${numeroJs}'))">Ver</button>
      </div>`;
    }).join('');
    box?.classList.remove('escondido');
  } catch(e) { /* silencioso */ }
}

// Gatilhos: ao sair do campo CPF ou após digitar nome
if ($('cpf')) {
  $('cpf').addEventListener('blur', buscarHistoricoCliente);
}
if ($('nome')) {
  $('nome').addEventListener('blur', () => {
    clearTimeout(_histClienteTimer);
    _histClienteTimer = setTimeout(buscarHistoricoCliente, 400);
  });
}

// ═══════════════════════════════════════════════════════════════
// ETIQUETA — impressão térmica 58/80 mm + QR Code que abre a OS
// ═══════════════════════════════════════════════════════════════
let _etiquetaOSAtual = null;
let _etiquetaQrAtual = null;
let _etiquetaConfigAtual = null;

function _textoEtiqueta(valor, limite) {
  const texto = String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ');
  if (!limite || texto.length <= limite) return texto;
  return texto.slice(0, Math.max(1, limite - 1)).trimEnd() + '…';
}

function _nomeEmpresaEtiqueta(config) {
  return _textoEtiqueta(
    config?.nomeEmpresa || config?.empresaNome || config?.nomeAssistencia || config?.razaoSocial || 'Sistema OS',
    42
  );
}

function _htmlEtiqueta(os, qr, config, formato) {
  const ap = os.aparelho || {};
  const cl = os.cliente || {};
  const tamanho = formato === '58' ? '58' : '80';
  const aparelho = _textoEtiqueta([ap.marca, ap.modelo].filter(Boolean).join(' ') || ap.tipoEquipamento || 'Aparelho', tamanho === '58' ? 27 : 40);
  const cliente = _textoEtiqueta(cl.nome || 'Cliente não informado', tamanho === '58' ? 25 : 38);
  const data = os.data ? new Date(os.data).toLocaleDateString('pt-BR') : '';
  const meta = _textoEtiqueta([os.status || 'Sem status', data].filter(Boolean).join(' · '), tamanho === '58' ? 30 : 48);
  return `
    <section class="etiqueta-termica etiqueta-termica--${tamanho}" data-etiqueta-formato="${tamanho}">
      <div class="etiqueta-dados">
        <div class="etiqueta-marca">${_escHtml(_nomeEmpresaEtiqueta(config))}</div>
        <div class="etiqueta-numero">${_escHtml(_textoEtiqueta(os.numero, 24))}</div>
        <div class="etiqueta-cliente">${_escHtml(cliente)}</div>
        <div class="etiqueta-aparelho">${_escHtml(aparelho)}</div>
        <div class="etiqueta-meta">${_escHtml(meta)}</div>
      </div>
      <div class="etiqueta-qr-bloco">
        <img src="${qr.dataUrl}" alt="QR Code para abrir ${_escHtml(os.numero)}" />
        <span>Escaneie · abrir OS</span>
      </div>
    </section>`;
}

function _atualizarPreviewEtiqueta() {
  if (!_etiquetaOSAtual || !_etiquetaQrAtual) return;
  const formato = $('etiquetaFormato')?.value === '58' ? '58' : '80';
  $('etiquetaPreview').innerHTML = _htmlEtiqueta(_etiquetaOSAtual, _etiquetaQrAtual, _etiquetaConfigAtual, formato);
}

window.abrirEtiqueta = async function(numero) {
  const preview = $('etiquetaPreview');
  const imprimir = $('btnImprimirEtiqueta');
  if (preview) preview.innerHTML = '<p class="etiqueta-carregando">Preparando etiqueta…</p>';
  if (imprimir) imprimir.disabled = true;
  $('modalEtiqueta').classList.remove('escondido');
  try {
    const [os, qr, config] = await Promise.all([
      window.api.osobter(numero),
      window.api.etiquetagerarqr(numero),
      window.api.configobter().catch(() => ({}))
    ]);
    if (!os) throw new Error('OS não encontrada.');
    _etiquetaOSAtual = os;
    _etiquetaQrAtual = qr;
    _etiquetaConfigAtual = config || {};
    _atualizarPreviewEtiqueta();
    if (imprimir) imprimir.disabled = false;
  } catch (erro) {
    _etiquetaOSAtual = null;
    _etiquetaQrAtual = null;
    if (preview) preview.innerHTML = `<p class="etiqueta-carregando" style="color:#b91c1c;">${_escHtml(erro.message || String(erro))}</p>`;
    toast('Não foi possível gerar a etiqueta: ' + (erro.message || String(erro)), 'erro');
  }
};

$('etiquetaFormato')?.addEventListener('change', _atualizarPreviewEtiqueta);
$('etiquetaCopias')?.addEventListener('change', evento => {
  evento.target.value = String(Math.max(1, Math.min(20, Number(evento.target.value) || 1)));
});

if ($('btnImprimirEtiqueta')) {
  $('btnImprimirEtiqueta').addEventListener('click', () => {
    if (!_etiquetaOSAtual || !_etiquetaQrAtual) return;
    const formato = $('etiquetaFormato')?.value === '58' ? '58' : '80';
    const copias = Math.max(1, Math.min(20, Number($('etiquetaCopias')?.value) || 1));
    const pagina = _htmlEtiqueta(_etiquetaOSAtual, _etiquetaQrAtual, _etiquetaConfigAtual, formato);
    const paginas = Array.from({ length: copias }, () => `<div class="pagina-etiqueta">${pagina}</div>`).join('');
    const dimensao = formato === '58' ? '58mm 40mm' : '80mm 50mm';
    const larguraInterna = formato === '58' ? '54mm' : '76mm';
    const alturaInterna = formato === '58' ? '36mm' : '46mm';
    const janela = window.open('', '_blank', `width=${formato === '58' ? 360 : 500},height=520`);
    if (!janela) {
      toast('A janela de impressão foi bloqueada.', 'erro');
      return;
    }
    janela.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Etiqueta ${_escHtml(_etiquetaOSAtual.numero)}</title>
    <style>
      *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif}
      .pagina-etiqueta{width:${formato}mm;height:${formato === '58' ? '40' : '50'}mm;padding:2mm;break-after:page;page-break-after:always;overflow:hidden}.pagina-etiqueta:last-child{break-after:auto;page-break-after:auto}
      .etiqueta-termica{width:${larguraInterna};height:${alturaInterna};display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:2.2mm;overflow:hidden;background:#fff;color:#000;line-height:1.12}
      .etiqueta-marca{overflow:hidden;margin-bottom:.8mm;font-size:7.5pt;font-weight:700;text-overflow:ellipsis;text-transform:uppercase;white-space:nowrap}.etiqueta-numero{margin-bottom:1.2mm;font-family:'Courier New',monospace;font-size:${formato === '58' ? '13' : '17'}pt;font-weight:900;letter-spacing:.2mm;white-space:nowrap}
      .etiqueta-cliente,.etiqueta-aparelho{overflow:hidden;max-width:100%;text-overflow:ellipsis;white-space:nowrap}.etiqueta-cliente{font-size:9pt;font-weight:800}.etiqueta-aparelho{margin-top:.8mm;font-size:7.5pt}.etiqueta-meta{overflow:hidden;margin-top:1.3mm;font-size:6.5pt;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
      .etiqueta-qr-bloco{display:flex;flex-direction:column;align-items:center;justify-content:center}.etiqueta-qr-bloco img{display:block;width:${formato === '58' ? '22' : '27'}mm;height:${formato === '58' ? '22' : '27'}mm;image-rendering:pixelated}.etiqueta-qr-bloco span{margin-top:.5mm;font-size:5.8pt;font-weight:800;text-transform:uppercase}
      @page{size:${dimensao};margin:0}@media screen{body{padding:12px;background:#eee}.pagina-etiqueta{margin:0 auto 12px;background:#fff;box-shadow:0 2px 12px #999}}
    </style></head><body>${paginas}<script>window.onload=async()=>{await Promise.all(Array.from(document.images).map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r})));window.print();window.close();}<\/script></body></html>`);
    janela.document.close();
  });
}

// O protocolo também funciona com leitores no Windows. Se a etiqueta for
// lida antes do login, a OS fica pendente e abre assim que a sessão voltar.
let _numeroOSPendentePorQR = '';
async function _abrirOSPendentePorQR() {
  if (!_numeroOSPendentePorQR || !usuarioAtual) return;
  const numero = _numeroOSPendentePorQR;
  _numeroOSPendentePorQR = '';
  await window.verDetalheOSrapido(numero);
  toast(`OS ${numero} aberta pela etiqueta.`, 'sucesso');
}
window.api.onAbrirOSPorUrl?.(dados => {
  const numero = String(dados?.numero || '').trim();
  if (!numero) return;
  _numeroOSPendentePorQR = numero;
  if (!usuarioAtual) toast(`Etiqueta lida. Entre no sistema para abrir a OS ${numero}.`, 'aviso');
  _abrirOSPendentePorQR().catch(erro => toast('Erro ao abrir OS da etiqueta: ' + erro.message, 'erro'));
});
if ($('telaLogin')) {
  new MutationObserver(() => {
    if (!$('telaLogin').classList.contains('escondido')) return;
    _abrirOSPendentePorQR().catch(() => {});
  }).observe($('telaLogin'), { attributes: true, attributeFilter: ['class'] });
}

// ══════════════════════════════════════════════════════════════
// v20 — BOTÃO WHATSAPP + MERCADO PAGO
// ══════════════════════════════════════════════════════════════

// Carregar/salvar token MP nas configurações
const _origCarregarConfig = typeof carregarConfig === 'function' ? carregarConfig : null;

// Patch: preenche campo do token MP ao abrir config
const _origBtnConfig = document.querySelector('[data-abre="modalConfig"]');

// Observa abertura do modal de config para preencher o token
(function() {
  const observer = new MutationObserver(() => {
    const modal = document.getElementById('modalConfig');
    if (!modal || modal.classList.contains('escondido')) return;
    window.api.configobter().then(cfg => {
      const el = document.getElementById('mpTokenConfig');
      if (el && cfg.mercadoPagoToken) el.placeholder = 'Token configurado (•••••)';
    }).catch(() => {});
  });
  const modal = document.getElementById('modalConfig');
  if (modal) observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
})();

// Patch salvar config: inclui token MP
(function() {
  const btnSalvar = document.getElementById('btnSalvarConfig');
  if (!btnSalvar) return;
  const origClick = btnSalvar.onclick;
  // Injeta o token antes do save original — interceptando via captura
  btnSalvar.addEventListener('click', () => {
    const el = document.getElementById('mpTokenConfig');
    if (el && el.value.trim()) {
      // Será lido no salvarConfig do renderer junto com os outros campos
      el.dataset.pendingSave = el.value.trim();
    }
  }, true); // capture phase — antes do handler original
})();

function _valorNumeroWhatsApp(valor) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!texto) return 0;
  return Number(texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto) || 0;
}

function _atualizarCamposMercadoPagoEnvio() {
  const usar = document.getElementById('mpUsarNestaVez')?.checked === true;
  const tipoFluxo = document.getElementById('modalMpValor')?.dataset.tipoFluxo || 'aprovacao';
  const entrada50Grupo = document.getElementById('mpEntrada50Grupo');
  // O valor faz parte do orçamento, não do Mercado Pago. Mesmo sem link de
  // pagamento, ele precisa ser informado, salvo na OS e exibido ao cliente.
  const valorObrigatorio = tipoFluxo === 'aprovacao' || usar;
  document.getElementById('mpValorGrupo')?.classList.toggle('escondido', !valorObrigatorio);
  const rotuloValor = document.getElementById('mpValorLabel');
  if (rotuloValor) rotuloValor.textContent = tipoFluxo === 'aprovacao'
    ? 'Valor do orçamento (R$)'
    : 'Valor a cobrar (R$)';
  entrada50Grupo?.classList.toggle('escondido', !usar || tipoFluxo !== 'aprovacao');
  if ((!usar || tipoFluxo !== 'aprovacao') && document.getElementById('mpExigirEntrada50')) {
    document.getElementById('mpExigirEntrada50').checked = false;
  }
  const valorTotal = _valorNumeroWhatsApp(document.getElementById('mpValorInput')?.value);
  const resumo = document.getElementById('mpEntrada50Resumo');
  if (resumo) {
    resumo.textContent = valorTotal > 0
      ? `Total R$ ${valorTotal.toFixed(2).replace('.', ',')} · entrada R$ ${(valorTotal / 2).toFixed(2).replace('.', ',')}`
      : 'Informe o valor total para calcular a entrada.';
  }
}

async function abrirModalEnvioWhatsAppManual(tipoFluxo, numero, opcoes = {}) {
  if (!numero) {
    toast('Erro: OS não identificada. Feche e abra a OS novamente.', 'erro');
    return;
  }
  const modal = document.getElementById('modalMpValor');
  if (!modal) return;

  const [osData, cfg] = await Promise.all([
    window.api.osobter(numero).catch(() => null),
    window.api.configobter().catch(() => ({})),
  ]);
  if (!osData) { toast('OS não encontrada.', 'erro'); return; }
  if (!(osData.cliente?.telefone || '').trim()) { toast('Cliente sem telefone cadastrado.', 'erro'); return; }

  const valorSalvo = _valorNumeroWhatsApp(osData?.diagnosticoTecnico?.valorEstimado)
    || _valorNumeroWhatsApp(osData?.valorInvestido);
  modal.dataset.tipoFluxo = tipoFluxo;
  modal.dataset.osNumero = numero;
  modal.dataset.valorSalvo = String(valorSalvo || 0);

  const titulo = document.getElementById('mpModalTitulo');
  const desc = document.getElementById('mpValorDesc');
  if (tipoFluxo === 'aprovacao') {
    if (titulo) titulo.innerHTML = `${ICONE_DOCUMENTO} Confirmar Envio do Orçamento`;
    if (desc) desc.textContent = opcoes.pagamentoMisto
      ? `OS ${numero} — O total será dividido em duas metades: 50% pelo link remoto e 50% presencial. Confirme os valores antes de enviar.`
      : `OS ${numero} — Informe o valor que aparecerá no orçamento e no PDF. O Mercado Pago é opcional e só adiciona o link de pagamento.`;
  } else {
    if (titulo) titulo.innerHTML = `${ICONE_CAIXA} Confirmar Pronto para Retirada`;
    if (desc) desc.textContent = `OS ${numero} — Confirme o aviso ao cliente. O link do Mercado Pago é opcional.`;
  }

  const usarMP = document.getElementById('mpUsarNestaVez');
  if (usarMP) usarMP.checked = opcoes.pagamentoMisto === true || cfg.mercadoPagoWhatsAppAtivo === true;
  const exigirEntrada50 = document.getElementById('mpExigirEntrada50');
  if (exigirEntrada50) exigirEntrada50.checked = opcoes.pagamentoMisto === true || osData.exigirEntrada50Aprovacao === true;
  const valorInput = document.getElementById('mpValorInput');
  if (valorInput) valorInput.value = valorSalvo > 0 ? String(valorSalvo) : '';
  const prazo = document.getElementById('mpPrazoGrupo');
  if (prazo) prazo.classList.toggle('escondido', tipoFluxo !== 'aprovacao');
  const ddi = document.getElementById('codigoPaisCobranca');
  if (ddi) ddi.value = cfg.codigoPaisWhatsapp || '55';
  const erro = document.getElementById('mpValorErro');
  if (erro) { erro.style.display = 'none'; erro.textContent = ''; }
  const confirmar = document.getElementById('btnMpConfirmar');
  if (confirmar) confirmar.innerHTML = `${ICONE_CELULAR} Confirmar e Enviar`;
  _atualizarCamposMercadoPagoEnvio();
  modal.classList.remove('escondido');
  (tipoFluxo === 'aprovacao' || usarMP?.checked ? valorInput : usarMP)?.focus();
}
window.abrirModalEnvioWhatsAppManual = abrirModalEnvioWhatsAppManual;
document.getElementById('mpUsarNestaVez')?.addEventListener('change', _atualizarCamposMercadoPagoEnvio);
document.getElementById('mpExigirEntrada50')?.addEventListener('change', _atualizarCamposMercadoPagoEnvio);
document.getElementById('mpValorInput')?.addEventListener('input', _atualizarCamposMercadoPagoEnvio);

(function() {
  const btn = document.getElementById('btnWhatsAppOS');
  if (!btn) return;
  btn.addEventListener('click', () => abrirModalEnvioWhatsAppManual(btn.dataset.tipoCobranca || 'aprovacao', btn.dataset.osNumero));
})();

(function() {
  const btnConfirmar = document.getElementById('btnMpConfirmar');
  if (!btnConfirmar) return;

  btnConfirmar.addEventListener('click', async () => {
    const modal = document.getElementById('modalMpValor');
    const numero = modal?.dataset.osNumero;
    const tipoFluxo = modal?.dataset.tipoFluxo || 'aprovacao';
    const usarMercadoPago = document.getElementById('mpUsarNestaVez')?.checked === true;
    const exigirEntrada50 = tipoFluxo === 'aprovacao'
      && document.getElementById('mpExigirEntrada50')?.checked === true;
    const mpErro = document.getElementById('mpValorErro');
    const valor = _valorNumeroWhatsApp(document.getElementById('mpValorInput')?.value);

    if ((tipoFluxo === 'aprovacao' || usarMercadoPago) && valor < 1) {
      if (mpErro) { mpErro.textContent = tipoFluxo === 'aprovacao'
        ? 'Informe o valor do orçamento (mínimo R$ 1,00).'
        : 'Para usar Mercado Pago, informe um valor válido (mínimo R$ 1,00).'; mpErro.style.display = 'block'; }
      return;
    }

    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = `${ICONE_RELOGIO} Enviando...`;
    try {
      const [osData, cfg, integracaoMP] = await Promise.all([
        window.api.osobter(numero),
        window.api.configobter().catch(() => ({})),
        usarMercadoPago && typeof window.api.supabaseobterintegracaomercadopago === 'function'
          ? window.api.supabaseobterintegracaomercadopago()
          : Promise.resolve(null),
      ]);
      if (usarMercadoPago && (!integracaoMP?.sucesso || integracaoMP?.integracao?.status !== 'conectada')) {
        throw new Error(integracaoMP?.erro || integracaoMP?.integracao?.ultimo_erro || 'Mercado Pago foi marcado, mas a conta da empresa não está conectada. Conecte-a nas Configurações ou desmarque esta opção.');
      }
      const tel = (osData?.cliente?.telefone || '').trim();
      if (!tel) throw new Error('OS sem telefone cadastrado.');
      const ap = osData.aparelho || {};
      const codigoPais = (document.getElementById('codigoPaisCobranca')?.value || cfg.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55';
      const valorDisponivel = tipoFluxo === 'aprovacao'
        ? valor
        : (usarMercadoPago ? valor : (_valorNumeroWhatsApp(modal?.dataset.valorSalvo) || 0));
      const valorExibicao = valorDisponivel > 0
        ? `R$ ${valorDisponivel.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '';
      let resultado;

      if (tipoFluxo === 'aprovacao') {
        const prazoEl = document.getElementById('prazoReparoCobranca');
        const caminhoPdf = osData.pdfPath || null;
        // Salva a escolha antes do envio. Assim uma resposta muito rápida do
        // cliente nunca é processada com o estado anterior da OS.
        const atualizacao = {
          estadoConversaAprovacao: 'aguardando_sim_nao',
          usarMercadoPagoAprovacao: usarMercadoPago,
          exigirEntrada50Aprovacao: exigirEntrada50,
          valorTotalServico: valor,
          valorEntradaAprovacao: exigirEntrada50 ? Number((valor / 2).toFixed(2)) : 0,
          entrada50Paga: false,
          contextoFormaPagamento: '',
          ultimaAprovacaoEnviada: {
            marca: ap.marca || '', modelo: ap.modelo || '', valor: valorExibicao,
            prazoReparo: prazoEl?.value || '', usarMercadoPago, exigirEntrada50,
          },
        };
        atualizacao.diagnosticoTecnico = { ...(osData.diagnosticoTecnico || {}), valorEstimado: valor };
        const osPreparada = await window.api.osatualizar(numero, atualizacao, null);
        if (!osPreparada || osPreparada.estadoConversaAprovacao !== 'aguardando_sim_nao' ||
            osPreparada.usarMercadoPagoAprovacao !== usarMercadoPago) {
          throw new Error('Não foi possível salvar a opção de pagamento deste envio.');
        }

        // O anexo deve refletir o mesmo orçamento que será enviado no texto.
        // Regenerar aqui evita PDF antigo com "a combinar" ou valor desatualizado.
        const caminhoPdfAtualizado = await window.api.osgerarPdf(numero);
        const osComOrcamento = await window.api.osobter(numero);

        resultado = await window.api.wappenviaraprovacao({
          telefone: tel,
          os: {
            nome_cliente: osData.cliente?.nome || '', numero,
            marca: ap.marca || '', modelo: ap.modelo || '',
            valor: valorExibicao,
            diagnostico_tecnico: osComOrcamento?.diagnosticoTecnico?.diagnostico || ap.defeitoRelatado || '',
            prazo_reparo: prazoEl?.value || '', tem_pdf: !!(caminhoPdfAtualizado || osComOrcamento?.pdfPath || caminhoPdf),
          },
          config: { nomeEmpresa: cfg.nomeEmpresa || 'Assistência Técnica', codigoPais },
          caminhoPdf: caminhoPdfAtualizado || osComOrcamento?.pdfPath || caminhoPdf,
        });

        if (!resultado?.sucesso) {
          // Nenhuma mensagem foi enviada: restaura o estado para a OS não
          // aguardar uma resposta que o cliente nunca recebeu.
          await window.api.osatualizar(numero, {
            estadoConversaAprovacao: osData.estadoConversaAprovacao || 'nao_iniciada',
            usarMercadoPagoAprovacao: osData.usarMercadoPagoAprovacao === true,
            exigirEntrada50Aprovacao: osData.exigirEntrada50Aprovacao === true,
            valorTotalServico: osData.valorTotalServico || 0,
            valorEntradaAprovacao: osData.valorEntradaAprovacao || 0,
            entrada50Paga: osData.entrada50Paga === true,
            contextoFormaPagamento: osData.contextoFormaPagamento || '',
          }, null).catch(() => {});
        }
      } else {
        const dadosEnvio = {
          telefone: tel,
          os: { nome_cliente: osData.cliente?.nome || '', numero, marca: ap.marca || '', modelo: ap.modelo || '' },
          config: {
            nomeEmpresa: cfg.nomeEmpresa || 'Assistência Técnica',
            horarioFuncionamento: cfg.horarioFuncionamento || '', codigoPais,
          },
        };
        resultado = usarMercadoPago
          ? await window.api.wappenviarretiradacomcobranca({ ...dadosEnvio, valor })
          : await window.api.wappenviarretirada(dadosEnvio);
        if (resultado?.sucesso) {
          toast(usarMercadoPago
            ? `${ICONE_CHECK} Aviso e link do Mercado Pago enviados.`
            : `${ICONE_CHECK} Aviso de pronto para retirada enviado sem Mercado Pago.`, 'sucesso');
        } else {
          toast('Falha ao enviar: ' + (resultado?.erro || 'verifique o WhatsApp.'), 'erro');
        }
      }

      if (!resultado?.sucesso) return;
      modal?.classList.add('escondido');
      if (typeof carregarHistorico === 'function') await carregarHistorico();
      if (typeof carregarPagamentos === 'function') carregarPagamentos();
    } catch (e) {
      if (mpErro) { mpErro.textContent = 'Erro: ' + e.message; mpErro.style.display = 'block'; }
    } finally {
      btnConfirmar.disabled = false;
      btnConfirmar.innerHTML = `${ICONE_CELULAR} Confirmar e Enviar`;
    }
  });
})();

// Fechar modal MP pelo data-fechar
document.querySelectorAll('[data-fechar="modalMpValor"]').forEach(b => {
  b.addEventListener('click', () => document.getElementById('modalMpValor')?.classList.add('escondido'));
});

// ══════════════════════════════════════════════════════════════
// v20 — ABA FINANCEIRO
// ══════════════════════════════════════════════════════════════
(function() {
  // Populando selects de mês/ano
  const selMes = document.getElementById('finMes');
  const selAno = document.getElementById('finAno');
  if (!selMes || !selAno) return;

  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  MESES.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = i + 1;
    opt.textContent = m;
    selMes.appendChild(opt);
  });
  const anoAtual = new Date().getFullYear();
  for (let a = anoAtual; a >= anoAtual - 3; a--) {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    selAno.appendChild(opt);
  }
  selMes.value = new Date().getMonth() + 1;
  selAno.value = anoAtual;

  const btn = document.getElementById('btnCarregarFinanceiro');
  if (btn) btn.addEventListener('click', () => carregarFinanceiro(true));
  // Trocar o mês/ano também atualiza a visão. O botão continua disponível
  // para recarregar manualmente os mesmos dados.
  const carregarMesSelecionado = () => {
    const inicio = document.getElementById('finDataInicio');
    const fim = document.getElementById('finDataFim');
    if (inicio) inicio.value = '';
    if (fim) fim.value = '';
    carregarFinanceiro();
  };
  selMes.addEventListener('change', carregarMesSelecionado);
  selAno.addEventListener('change', carregarMesSelecionado);
})();

async function carregarFinanceiroLegado(mostrarFeedback = false) {
  const selMes = document.getElementById('finMes');
  const selAno = document.getElementById('finAno');
  const mes = parseInt(selMes?.value) || (new Date().getMonth() + 1);
  const ano = parseInt(selAno?.value) || new Date().getFullYear();
  const btnAtualizar = document.getElementById('btnCarregarFinanceiro');
  const cardsFinanceiro = document.getElementById('finCards');
  const textoOriginalBotao = btnAtualizar?.innerHTML;

  let rel, cruza;
  try {
    if (typeof window.api?.financeirorelatorio !== 'function') {
      throw new Error('O módulo financeiro não está disponível nesta instalação.');
    }
    if (btnAtualizar) {
      btnAtualizar.disabled = true;
      btnAtualizar.textContent = 'Atualizando…';
    }

    // O relatório principal não pode deixar de carregar só porque o painel
    // secundário de cruzamento de estoque falhou.
    rel = await window.api.financeirorelatorio({ mes, ano });
    cruza = typeof window.api?.estoquecruza === 'function'
      ? await window.api.estoquecruza().catch((erroCruzamento) => {
        console.warn('Cruzamento de estoque indisponível:', erroCruzamento);
        return null;
      })
      : null;
  } catch(e) {
    console.error('Erro financeiro:', e);
    if (cardsFinanceiro) {
      cardsFinanceiro.innerHTML = `<div class="vazio" style="grid-column:1/-1;padding:18px;color:var(--perigo);">Não foi possível atualizar o financeiro: ${_escHtml(e.message || String(e))}</div>`;
    }
    if (mostrarFeedback) toast('Não foi possível atualizar o financeiro: ' + (e.message || e), 'erro');
    return;
  } finally {
    if (btnAtualizar) {
      btnAtualizar.disabled = false;
      btnAtualizar.innerHTML = textoOriginalBotao || `${ICONE_SYNC} Atualizar`;
    }
  }

  // Migrações antigas podem não ter todos os blocos; normalizar aqui evita
  // uma exceção silenciosa ao clicar em Atualizar.
  rel = rel || {};
  rel.entradas = rel.entradas || {};
  rel.saidas = rel.saidas || {};
  rel.historico = Array.isArray(rel.historico) ? rel.historico : [];
  rel.detalheOS = Array.isArray(rel.detalheOS) ? rel.detalheOS : [];
  rel.detalheVendas = Array.isArray(rel.detalheVendas) ? rel.detalheVendas : [];
  rel.aReceber = rel.aReceber || { qtd: 0, total: 0, detalhe: [] };
  rel.aReceber.detalhe = Array.isArray(rel.aReceber.detalhe) ? rel.aReceber.detalhe : [];
  rel.resultado = rel.resultado || {
    lucroServicos: (rel.entradas.servicos || 0) - (rel.saidas.custoServicos || 0),
    lucroVendas: (rel.entradas.vendas || 0) - (rel.saidas.custoAparelhos || 0),
    lucroTotal: rel.lucroLiquido || 0,
    margemLucro: 0
  };

  const fmt = v => 'R$ ' + (v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cor = v => v >= 0 ? '#15803d' : '#dc2626';

  const grupoFinanceiro = (titulo, descricao, cards) => `
    <section class="fin-resumo-grupo" aria-label="${titulo}">
      <header><strong>${titulo}</strong><span>${descricao}</span></header>
      <div class="fin-resumo-cards">${cards.map(c => `
        <article class="fin-metrica ${c.classe || ''}">
          <span>${c.label}</span><strong>${c.valor}</strong>${c.obs ? `<small>${c.obs}</small>` : ''}
        </article>`).join('')}</div>
    </section>`;
  const finCards = document.getElementById('finCards');
  if (finCards) finCards.innerHTML = [
    grupoFinanceiro('Receitas', 'Valores realmente recebidos no período', [
      { label: 'Serviços e reparos', valor: fmt(rel.entradas.servicos), classe: 'positivo' },
      { label: 'Venda de aparelhos', valor: fmt(rel.entradas.vendas), classe: 'positivo' },
      { label: 'Total recebido', valor: fmt(rel.entradas.total), classe: 'destaque' },
      { label: 'Ainda a receber', valor: fmt(rel.aReceber.total), classe: 'pendente', obs: `${rel.aReceber.qtd || 0} OS com saldo` }
    ]),
    grupoFinanceiro('Custos', 'Custos ligados ao que gerou receita, sem duplicar compras', [
      { label: 'Peças usadas em OS', valor: fmt(rel.saidas.custoServicos), classe: 'negativo' },
      { label: 'Aparelhos vendidos', valor: fmt(rel.saidas.custoAparelhos), classe: 'negativo' },
      { label: 'Total de custos', valor: fmt(rel.saidas.total), classe: 'negativo' },
      { label: 'Compras para estoque', valor: fmt((rel.saidas.compras || 0) + (rel.saidas.custoPecasCompra || 0)), obs: 'Investimento do mês; não descontado outra vez' }
    ]),
    grupoFinanceiro('Resultado', 'Lucro após os custos diretamente ligados às vendas', [
      { label: 'Lucro em reparos', valor: fmt(rel.resultado.lucroServicos), classe: rel.resultado.lucroServicos >= 0 ? 'positivo' : 'negativo' },
      { label: 'Lucro em aparelhos', valor: fmt(rel.resultado.lucroVendas), classe: rel.resultado.lucroVendas >= 0 ? 'positivo' : 'negativo' },
      { label: 'Lucro total', valor: fmt(rel.resultado.lucroTotal), classe: rel.resultado.lucroTotal >= 0 ? 'destaque' : 'negativo' },
      { label: 'Margem total', valor: `${Number(rel.resultado.margemLucro || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` }
    ])
  ].join('');

  // Gráfico 6 meses
  const hist = rel.historico || [];
  const maxV = Math.max(...hist.map(h => Math.max(h.entradas, h.saidas, 1)), 1);
  const MESES_CURTO = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const finGraf = document.getElementById('finGrafico');
  if (finGraf) {
    finGraf.innerHTML = `
      <div style="display:flex;gap:6px;align-items:flex-end;height:160px;padding-top:10px;overflow-x:auto;">
        ${hist.map(h => {
          const [a, m] = h.mes.split('-');
          const hE = Math.max(Math.round((h.entradas / maxV) * 120), h.entradas > 0 ? 3 : 0);
          const hS = Math.max(Math.round((h.saidas / maxV) * 120), h.saidas > 0 ? 3 : 0);
          const hL = Math.max(Math.round((Math.abs(h.lucro) / maxV) * 120), Math.abs(h.lucro) > 0 ? 3 : 0);
          const corL = h.lucro >= 0 ? '#15803d' : '#dc2626';
          return `<div class="barra-grupo" style="min-width:52px;">
            <div class="barra-wrap" style="gap:2px;">
              <div style="width:12px;height:${hE}px;background:var(--primario);border-radius:3px 3px 0 0;" title="Entradas: ${fmt(h.entradas)}"></div>
              <div style="width:12px;height:${hS}px;background:#ef4444;border-radius:3px 3px 0 0;" title="Saídas: ${fmt(h.saidas)}"></div>
              <div style="width:12px;height:${hL}px;background:${corL};border-radius:3px 3px 0 0;" title="Lucro: ${fmt(h.lucro)}"></div>
            </div>
            <div class="barra-mes">${MESES_CURTO[parseInt(m)-1]}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;">
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:var(--primario);display:inline-block;border-radius:2px;"></span>Entradas</span>
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:#ef4444;display:inline-block;border-radius:2px;"></span>Saídas</span>
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:#15803d;display:inline-block;border-radius:2px;"></span>Lucro</span>
      </div>`;
  }

  // Detalhe OS: inclui valores estimados antes do pagamento e separa o que
  // já entrou do saldo que ainda precisa ser cobrado.
  const finOS = document.getElementById('finDetalheOS');
  if (finOS) {
    finOS.innerHTML = rel.detalheOS.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="border-bottom:1px solid var(--borda);">
            <th style="text-align:left;padding:4px 6px;">OS</th>
            <th style="text-align:left;padding:4px 6px;">Cliente</th>
            <th style="text-align:right;padding:4px 6px;">Estimado</th>
            <th style="text-align:right;padding:4px 6px;">Recebido</th>
            <th style="text-align:right;padding:4px 6px;">Falta receber</th>
          </tr></thead>
          <tbody>${rel.detalheOS.map(o => `
            <tr style="border-bottom:1px solid var(--borda);">
              <td style="padding:4px 6px;color:var(--primario);">${o.numero}</td>
              <td style="padding:4px 6px;">${o.cliente} <small>#${o.clienteId || '00000'}</small> <span style="color:var(--texto-sec);">(${o.aparelho})</span></td>
              <td style="padding:4px 6px;text-align:right;font-weight:700;">${fmt(o.valorEstimado)}</td>
              <td style="padding:4px 6px;text-align:right;color:#15803d;">${fmt(o.valorRecebido)}</td>
              <td style="padding:4px 6px;text-align:right;color:${o.valorPendente > 0 ? '#d97706' : '#15803d'};">${fmt(o.valorPendente)}</td>
            </tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3" style="padding:6px;font-weight:700;">Recebido no período (${rel.qtdOsEntregues} OS)</td>
            <td colspan="2" style="padding:6px;text-align:right;font-weight:700;color:#15803d;">${fmt(rel.entradas.servicos)}</td></tr></tfoot>
        </table>`
      : '<p style="color:var(--texto-sec);font-size:12px;padding:8px 0;">Nenhuma OS aberta ou paga no período.</p>';
  }

  // A Receber — OS com forma de pagamento já informada na retirada, mas
  // pagamento ainda NÃO confirmado. Não entra em nenhum total do DRE
  // acima; é só uma visão à parte de quanto ainda deve entrar em caixa.
  const finAReceber = document.getElementById('finAReceber');
  if (finAReceber) {
    const ar = rel.aReceber || { qtd: 0, total: 0, detalhe: [] };
    finAReceber.innerHTML = ar.detalhe.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="border-bottom:1px solid var(--borda);">
            <th style="text-align:left;padding:4px 6px;">OS</th>
            <th style="text-align:left;padding:4px 6px;">Cliente</th>
            <th style="text-align:left;padding:4px 6px;">Forma</th>
            <th style="text-align:right;padding:4px 6px;">Valor pendente</th>
          </tr></thead>
          <tbody>${ar.detalhe.map(o => `
            <tr style="border-bottom:1px solid var(--borda);">
              <td style="padding:4px 6px;color:var(--primario);">${o.numero}</td>
              <td style="padding:4px 6px;">${o.cliente} <small>#${o.clienteId || '00000'}</small> <span style="color:var(--texto-sec);">(${o.aparelho})</span></td>
              <td style="padding:4px 6px;color:var(--texto-sec);">${o.formaPagamento || '—'}</td>
              <td style="padding:4px 6px;text-align:right;font-weight:700;color:#d97706;">${fmt(o.valor)}</td>
            </tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3" style="padding:6px;font-weight:700;">Total a receber (${ar.qtd} OS)</td>
            <td style="padding:6px;text-align:right;font-weight:700;color:#d97706;">${fmt(ar.total)}</td></tr></tfoot>
        </table>`
      : '<p style="color:var(--texto-sec);font-size:12px;padding:8px 0;">Nenhuma OS com saldo pendente.</p>';
  }

  // Detalhe Vendas
  const finVendas = document.getElementById('finDetalheVendas');
  if (finVendas) {
    finVendas.innerHTML = rel.detalheVendas.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="border-bottom:1px solid var(--borda);">
            <th style="text-align:left;padding:4px 6px;">Aparelho</th>
            <th style="text-align:right;padding:4px 6px;">Venda</th>
            <th style="text-align:right;padding:4px 6px;">Lucro</th>
          </tr></thead>
          <tbody>${rel.detalheVendas.map(v => `
            <tr style="border-bottom:1px solid var(--borda);">
              <td style="padding:4px 6px;">${v.descricao} <span style="color:var(--texto-sec);">${v.comprador ? '('+v.comprador+')' : ''}</span></td>
              <td style="padding:4px 6px;text-align:right;">${fmt(v.valorVenda)}</td>
              <td style="padding:4px 6px;text-align:right;font-weight:700;" style="color:${cor(v.lucro)}">${fmt(v.lucro)}</td>
            </tr>`).join('')}</tbody>
          <tfoot><tr><td style="padding:6px;font-weight:700;">Total (${rel.qtdAparelhoVendidos})</td>
            <td style="padding:6px;text-align:right;font-weight:700;">${fmt(rel.entradas.vendas)}</td>
            <td style="padding:6px;text-align:right;font-weight:700;color:#15803d;">${fmt(rel.detalheVendas.reduce((s,v)=>s+v.lucro,0))}</td></tr></tfoot>
        </table>`
      : '<p style="color:var(--texto-sec);font-size:12px;padding:8px 0;">Nenhum aparelho vendido no período.</p>';
  }

  // Cruzamento Estoque × OS
  const finCruz = document.getElementById('finCruzamento');
  if (finCruz && cruza) {
    const partes = [];
    if (cruza.osAguardandoPeca.length) {
      partes.push(`<div style="margin-bottom:12px;">
        <strong style="color:#d97706;">${ICONE_ALERTA} OS aguardando peça (${cruza.osAguardandoPeca.length})</strong>
        <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">
          ${cruza.osAguardandoPeca.map(os => `
            <div style="display:flex;justify-content:space-between;padding:4px 8px;background:var(--bg);border-radius:4px;font-size:12px;">
              <span style="color:var(--primario);font-weight:700;">${os.numero}</span>
              <span>${os.cliente} — ${os.aparelho}</span>
              <span style="color:var(--texto-sec);">${os.pecaDescrita ? '"'+os.pecaDescrita.slice(0,40)+'"' : ''}</span>
            </div>`).join('')}
        </div></div>`);
    }
    if (cruza.pecasCriticas.length) {
      partes.push(`<div style="margin-bottom:12px;">
        <strong style="color:#dc2626;">${ICONE_BOLA_VERMELHA} Peças com estoque crítico/zerado (${cruza.pecasCriticas.length})</strong>
        <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">
          ${cruza.pecasCriticas.map(p => `
            <div style="display:flex;justify-content:space-between;padding:4px 8px;background:var(--bg);border-radius:4px;font-size:12px;">
              <span>${p.nome}</span>
              <span style="color:var(--texto-sec);">${p.categoria}</span>
              <span style="font-weight:700;color:${p.quantidade===0?'#dc2626':'#d97706'};">Qtd: ${p.quantidade} (mín: ${p.minimo})</span>
            </div>`).join('')}
        </div></div>`);
    }
    if (cruza.prontos.length) {
      partes.push(`<div style="margin-bottom:12px;">
        <strong style="color:#15803d;">${ICONE_CHECK} Prontos para venda (${cruza.prontos.length}) — Lucro potencial: ${fmt(cruza.prontos.reduce((s,p)=>s+p.lucroPotencial,0))}</strong>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">
          ${cruza.prontos.map(p => `
            <div style="padding:4px 10px;background:#d1fae5;border-radius:4px;font-size:12px;color:#15803d;">
              ${p.descricao} — ${fmt(p.valorVenda)}
            </div>`).join('')}
        </div></div>`);
    }
    finCruz.innerHTML = partes.length
      ? partes.join('')
      : '<p style="color:var(--texto-sec);font-size:12px;padding:8px 0;">Nenhum cruzamento de atenção no momento.</p>';
  }

  // Painel Mercado Pago usa o mesmo período (mês/ano) selecionado acima
  carregarPainelMP(mes, ano);
}

const FINANCEIRO_TIPOS = Object.freeze({
  recebimento_os: 'Recebimento de OS',
  custo_os: 'Custo de OS',
  venda_aparelho: 'Venda de aparelho',
  custo_aparelho: 'Custo de aparelho',
  compra_estoque: 'Compra para estoque',
  reembolso: 'Reembolso'
});

function _obterFiltrosFinanceiros() {
  const valor = (id) => document.getElementById(id)?.value?.trim?.() || '';
  const marcados = (atributo) => Array.from(document.querySelectorAll(`[${atributo}]:checked`))
    .map((item) => item.getAttribute(atributo))
    .filter(Boolean);
  const filtros = {
    mes: parseInt(valor('finMes')) || (new Date().getMonth() + 1),
    ano: parseInt(valor('finAno')) || new Date().getFullYear(),
    busca: valor('finBusca'),
    valorMin: valor('finValorMin'),
    valorMax: valor('finValorMax'),
    tipos: marcados('data-fin-tipo'),
    direcoes: marcados('data-fin-direcao'),
    metodos: marcados('data-fin-metodo')
  };
  const dataInicio = valor('finDataInicio');
  const dataFim = valor('finDataFim');
  if (dataInicio) filtros.dataInicio = dataInicio;
  if (dataFim) filtros.dataFim = dataFim;
  return filtros;
}

function _renderizarFiltrosFinanceiros(relatorio, filtros) {
  const opcoes = document.getElementById('finMetodosOpcoes');
  if (opcoes) {
    const selecionados = new Set(filtros.metodos || []);
    const metodos = relatorio?.filtrosDisponiveis?.metodos || [];
    opcoes.innerHTML = metodos.length
      ? metodos.map((metodo) => `<label class="finance-check-option"><input type="checkbox" data-fin-metodo="${_escHtml(metodo)}" ${selecionados.has(metodo) ? 'checked' : ''} /> ${_escHtml(metodo)}</label>`).join('')
      : '<span class="finance-empty">Nenhuma forma registrada.</span>';
  }

  const ativos = [];
  if (filtros.busca) ativos.push(`Busca: “${filtros.busca}”`);
  if (filtros.dataInicio || filtros.dataFim) ativos.push(`Período personalizado: ${filtros.dataInicio || 'início'} a ${filtros.dataFim || 'hoje'}`);
  if (filtros.valorMin !== '') ativos.push(`Mínimo: ${_fmtMoedaMP(Number(filtros.valorMin) || 0)}`);
  if (filtros.valorMax !== '') ativos.push(`Máximo: ${_fmtMoedaMP(Number(filtros.valorMax) || 0)}`);
  (filtros.tipos || []).forEach((tipo) => ativos.push(FINANCEIRO_TIPOS[tipo] || tipo));
  (filtros.direcoes || []).forEach((direcao) => ativos.push(direcao === 'saida' ? 'Somente saídas' : 'Somente entradas'));
  (filtros.metodos || []).forEach((metodo) => ativos.push(`Forma: ${metodo}`));
  const painel = document.getElementById('finFiltrosAtivos');
  if (painel) painel.innerHTML = ativos.length
    ? ativos.map((item) => `<span class="finance-filter-chip">${_escHtml(item)}</span>`).join('')
    : 'Nenhum filtro adicional. Mostrando todo o mês selecionado.';
}

function _renderizarResumoFinanceiro(relatorio) {
  const resumo = relatorio.resumoExtrato || {};
  const caixa = resumo.caixa || {};
  const resultado = resumo.resultado || {};
  const cards = document.getElementById('finCards');
  if (cards) cards.innerHTML = [
    ['Entrou no caixa', caixa.entradas, 'Pagamentos e vendas realmente recebidos.'],
    ['Saiu do caixa', caixa.saidas, 'Compras para estoque e reembolsos no período.'],
    ['Saldo de caixa', caixa.saldo, 'Entradas menos saídas; não é o lucro.'],
    ['Lucro total', resultado.lucroTotal, 'Receitas menos custos reconhecidos.', 'finance-metric--primary']
  ].map(([rotulo, valor, ajuda, classe]) => `<article class="finance-metric ${classe || ''}"><span>${rotulo}</span><strong>${_fmtMoedaMP(Number(valor) || 0)}</strong><small>${ajuda}</small></article>`).join('');

  const composicao = resumo.composicao || {};
  const ponte = document.getElementById('finLucroExplicacao');
  if (ponte) ponte.innerHTML = `
    <div class="finance-profit-line"><span>Recebimentos de OS, após reembolsos</span><strong>+ ${_fmtMoedaMP(composicao.receitaOS)}</strong></div>
    <div class="finance-profit-line"><span>Peças e custos diretos das OS</span><strong>− ${_fmtMoedaMP(composicao.custoOS)}</strong></div>
    <div class="finance-profit-line finance-profit-line--subtotal"><span>Lucro em reparos</span><strong>${_fmtMoedaMP(resultado.lucroOS)}</strong></div>
    <div class="finance-profit-line"><span>Venda de aparelhos</span><strong>+ ${_fmtMoedaMP(composicao.receitaVendas)}</strong></div>
    <div class="finance-profit-line"><span>Aquisição, peças e extras dos aparelhos vendidos</span><strong>− ${_fmtMoedaMP(composicao.custoVendas)}</strong></div>
    <div class="finance-profit-line finance-profit-line--subtotal"><span>Lucro em aparelhos</span><strong>${_fmtMoedaMP(resultado.lucroVendas)}</strong></div>
    <div class="finance-profit-line"><span>Descontos registrados</span><strong>${_fmtMoedaMP(composicao.descontos)}</strong></div>
    <div class="finance-profit-line"><span>Acréscimos registrados</span><strong>${_fmtMoedaMP(composicao.acrescimos)}</strong></div>
    <div class="finance-profit-line finance-profit-line--total"><span>Lucro total do período</span><strong>${_fmtMoedaMP(resultado.lucroTotal)}</strong></div>`;
}

function _renderizarHistoricoFinanceiro(relatorio) {
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const historico = Array.isArray(relatorio.historico) ? relatorio.historico : [];
  const painel = document.getElementById('finGrafico');
  if (!painel) return;
  painel.innerHTML = historico.length ? `<div class="finance-table-wrap"><table class="finance-table">
    <thead><tr><th>Mês</th><th class="finance-value">Receitas</th><th class="finance-value">Custos</th><th class="finance-value">Lucro</th><th class="finance-value">Saldo de caixa</th></tr></thead>
    <tbody>${historico.map((item) => {
      const [ano, mes] = String(item.mes || '').split('-');
      return `<tr><td>${meses[(Number(mes) || 1) - 1]}/${ano}</td><td class="finance-value">${_fmtMoedaMP(item.entradas)}</td><td class="finance-value">${_fmtMoedaMP(item.saidas)}</td><td class="finance-value">${_fmtMoedaMP(item.lucro)}</td><td class="finance-value">${_fmtMoedaMP(item.caixa)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="finance-empty">Nenhum histórico para exibir.</div>';
}

function _rotuloDetalheFinanceiro(chave) {
  const rotulos = {
    aparelho: 'Aparelho', origem: 'Origem', valorTotalOS: 'Valor total da OS', pagamentoId: 'Pagamento',
    custoPecasEstoque: 'Peças baixadas do estoque', custoPecasManuais: 'Peças informadas na OS',
    proporcaoReconhecida: 'Parcela do custo reconhecida', custoTotalOS: 'Custo total da OS',
    custoAquisicao: 'Aquisição', custoPecas: 'Peças', gastosExtras: 'Gastos extras',
    valorAquisicao: 'Aquisição', custoPecasInicial: 'Peças iniciais', marca: 'Marca', modelo: 'Modelo'
  };
  return rotulos[chave] || chave;
}

function _valorDetalheFinanceiro(chave, valor) {
  if (chave === 'proporcaoReconhecida') return `${(Number(valor || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (/valor|custo|gasto/i.test(chave) && Number.isFinite(Number(valor))) return _fmtMoedaMP(Number(valor));
  return String(valor ?? '—') || '—';
}

function _renderizarExtratoFinanceiro(relatorio) {
  const extrato = Array.isArray(relatorio.extrato) ? relatorio.extrato : [];
  const resumo = document.getElementById('finExtratoResumo');
  if (resumo) resumo.textContent = `${extrato.length} movimentação${extrato.length === 1 ? '' : 'ões'} no período. Clique na seta para entender cada valor.`;
  const painel = document.getElementById('finExtrato');
  if (!painel) return;
  if (!extrato.length) {
    painel.innerHTML = '<div class="finance-empty"><strong>Nenhuma movimentação encontrada.</strong><br />Ajuste ou limpe os filtros para ampliar a busca.</div>';
    return;
  }
  painel.innerHTML = `<table class="finance-table">
    <thead><tr><th><span class="sr-only">Detalhes</span></th><th>Data</th><th>Movimentação</th><th>Documento</th><th>Impacto</th><th class="finance-value">Valor</th></tr></thead>
    <tbody>${extrato.map((item, indice) => {
      const detalhes = Object.entries(item.detalhes || {}).filter(([, valor]) => valor !== '' && valor !== null && valor !== undefined);
      const impacto = item.impactaCaixa && item.impactaResultado ? 'Caixa e lucro' : (item.impactaCaixa ? 'Somente caixa' : 'Somente lucro');
      const sinal = item.direcao === 'saida' ? '−' : '+';
      const data = item.data ? item.data.split('-').reverse().join('/') : '—';
      const detalheId = `fin-detalhe-${indice}`;
      return `<tr>
        <td><button type="button" class="finance-expand" data-fin-expandir="${detalheId}" aria-expanded="false" aria-controls="${detalheId}" title="Mostrar detalhes">⌄</button></td>
        <td class="finance-date">${data}</td>
        <td class="finance-description"><strong>${_escHtml(item.descricao)}</strong><small>${_escHtml([item.contraparte, item.metodo].filter(Boolean).join(' · ') || FINANCEIRO_TIPOS[item.tipo] || item.tipo)}</small></td>
        <td>${_escHtml(item.documento || '—')}${item.clienteId ? `<small style="display:block;color:var(--texto-sec);">Cliente #${_escHtml(item.clienteId)}</small>` : ''}</td>
        <td><span class="finance-direction">${impacto}</span></td>
        <td class="finance-value">${sinal} ${_fmtMoedaMP(item.valor)}</td>
      </tr>
      <tr class="finance-detail-row" id="${detalheId}" data-open="false"><td colspan="6"><div class="finance-detail-content">
        <div><strong>Tipo</strong><br />${_escHtml(FINANCEIRO_TIPOS[item.tipo] || item.tipo)}</div>
        <div><strong>Observação</strong><br />${_escHtml(item.observacao || 'Nenhuma observação.')}</div>
        ${detalhes.map(([chave, valor]) => `<div><strong>${_escHtml(_rotuloDetalheFinanceiro(chave))}</strong><br />${_escHtml(_valorDetalheFinanceiro(chave, valor))}</div>`).join('')}
      </div></td></tr>`;
    }).join('')}</tbody></table>`;
}

function _renderizarDetalhesFinanceiros(relatorio, cruza) {
  const tabela = (cabecalhos, linhas, vazio) => linhas.length ? `<table class="finance-table"><thead><tr>${cabecalhos.map((item) => `<th>${item}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table>` : `<div class="finance-empty">${vazio}</div>`;
  const aReceber = relatorio.aReceber || { detalhe: [], total: 0 };
  const ar = document.getElementById('finAReceber');
  if (ar) ar.innerHTML = tabela(['OS', 'Cliente', 'Aparelho', 'Total', 'Recebido', 'Falta receber'], (aReceber.detalhe || []).map((item) => `<tr><td>${_escHtml(item.numero)}</td><td>${_escHtml(item.cliente)} <small>#${_escHtml(item.clienteId || '00000')}</small></td><td>${_escHtml(item.aparelho)}</td><td class="finance-value">${_fmtMoedaMP(item.valorTotal)}</td><td class="finance-value">${_fmtMoedaMP(item.valorRecebido)}</td><td class="finance-value">${_fmtMoedaMP(item.valor)}</td></tr>`), 'Nenhuma OS com saldo pendente.');

  const osPainel = document.getElementById('finDetalheOS');
  if (osPainel) osPainel.innerHTML = tabela(['OS', 'Cliente', 'Aparelho', 'Estimado', 'Recebido no período', 'Falta receber'], (relatorio.detalheOS || []).map((item) => `<tr><td>${_escHtml(item.numero)}</td><td>${_escHtml(item.cliente)} <small>#${_escHtml(item.clienteId || '00000')}</small></td><td>${_escHtml(item.aparelho)}</td><td class="finance-value">${_fmtMoedaMP(item.valorEstimado)}</td><td class="finance-value">${_fmtMoedaMP(item.valorRecebido)}</td><td class="finance-value">${_fmtMoedaMP(item.valorPendente)}</td></tr>`), 'Nenhuma OS aberta ou paga no período.');

  const vendas = document.getElementById('finDetalheVendas');
  if (vendas) vendas.innerHTML = tabela(['Aparelho', 'Comprador', 'Venda', 'Custo', 'Lucro'], (relatorio.detalheVendas || []).map((item) => `<tr><td>${_escHtml(item.descricao)}</td><td>${_escHtml(item.comprador || '—')}</td><td class="finance-value">${_fmtMoedaMP(item.valorVenda)}</td><td class="finance-value">${_fmtMoedaMP(item.custo)}</td><td class="finance-value">${_fmtMoedaMP(item.lucro)}</td></tr>`), 'Nenhum aparelho vendido no período.');

  const alertas = [];
  if (cruza?.osAguardandoPeca?.length) alertas.push(`${cruza.osAguardandoPeca.length} OS aguardando peça`);
  if (cruza?.pecasCriticas?.length) alertas.push(`${cruza.pecasCriticas.length} peça(s) com estoque crítico`);
  if (cruza?.prontos?.length) alertas.push(`${cruza.prontos.length} aparelho(s) pronto(s) para venda`);
  const cruzamento = document.getElementById('finCruzamento');
  if (cruzamento) cruzamento.innerHTML = alertas.length
    ? `<ul>${alertas.map((item) => `<li>${_escHtml(item)}</li>`).join('')}</ul>`
    : '<div class="finance-empty">Nenhum alerta de estoque ou OS neste momento.</div>';
}

async function carregarFinanceiro(mostrarFeedback = false) {
  const filtros = _obterFiltrosFinanceiros();
  const btn = document.getElementById('btnCarregarFinanceiro');
  const original = btn?.innerHTML;
  try {
    if (typeof window.api?.financeirorelatorio !== 'function') throw new Error('O módulo financeiro não está disponível nesta instalação.');
    if (btn) { btn.disabled = true; btn.textContent = 'Atualizando…'; }
    const [relatorio, cruza] = await Promise.all([
      window.api.financeirorelatorio(filtros),
      typeof window.api?.estoquecruza === 'function' ? window.api.estoquecruza().catch(() => null) : Promise.resolve(null)
    ]);
    _renderizarFiltrosFinanceiros(relatorio, filtros);
    _renderizarResumoFinanceiro(relatorio);
    _renderizarHistoricoFinanceiro(relatorio);
    _renderizarExtratoFinanceiro(relatorio);
    _renderizarDetalhesFinanceiros(relatorio, cruza);
    const mes = parseInt(document.getElementById('finMes')?.value) || (new Date().getMonth() + 1);
    const ano = parseInt(document.getElementById('finAno')?.value) || new Date().getFullYear();
    carregarPainelMP(mes, ano);
    if (mostrarFeedback) toast('Extrato atualizado.', 'sucesso');
  } catch (erro) {
    console.error('Erro financeiro:', erro);
    const painel = document.getElementById('finExtrato');
    if (painel) painel.innerHTML = `<div class="finance-empty">Não foi possível carregar o extrato: ${_escHtml(erro?.message || String(erro))}</div>`;
    if (mostrarFeedback) toast('Não foi possível atualizar o financeiro.', 'erro');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original || `${ICONE_SYNC} Atualizar`; }
  }
}

(function prepararInteracoesExtratoFinanceiro() {
  const aba = document.getElementById('aba-financeiro');
  if (!aba) return;
  let buscaTimer = null;
  document.getElementById('finBusca')?.addEventListener('input', () => {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => carregarFinanceiro(), 260);
  });
  ['finDataInicio', 'finDataFim', 'finValorMin', 'finValorMax'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => carregarFinanceiro());
  });
  aba.addEventListener('change', (evento) => {
    const alvo = evento.target;
    if (alvo?.matches?.('[data-fin-tipo], [data-fin-direcao], [data-fin-metodo]')) carregarFinanceiro();
  });
  aba.addEventListener('click', (evento) => {
    const botao = evento.target.closest?.('[data-fin-expandir]');
    if (!botao) return;
    const linha = document.getElementById(botao.dataset.finExpandir);
    if (!linha) return;
    const aberto = linha.dataset.open === 'true';
    linha.dataset.open = String(!aberto);
    botao.setAttribute('aria-expanded', String(!aberto));
    botao.textContent = aberto ? '⌄' : '⌃';
  });
  document.getElementById('btnLimparFinanceiro')?.addEventListener('click', () => {
    ['finBusca', 'finDataInicio', 'finDataFim', 'finValorMin', 'finValorMax'].forEach((id) => {
      const campo = document.getElementById(id);
      if (campo) campo.value = '';
    });
    aba.querySelectorAll('[data-fin-tipo], [data-fin-direcao], [data-fin-metodo]').forEach((item) => { item.checked = false; });
    document.getElementById('finMes').value = new Date().getMonth() + 1;
    document.getElementById('finAno').value = new Date().getFullYear();
    carregarFinanceiro(true);
  });
  document.getElementById('btnFinanceiroCsv')?.addEventListener('click', async () => {
    const botao = document.getElementById('btnFinanceiroCsv');
    const original = botao.textContent;
    botao.disabled = true;
    botao.textContent = 'Gerando…';
    try {
      const resposta = await window.api.financeiroexportarcsv(_obterFiltrosFinanceiros());
      if (!resposta?.cancelado) toast(resposta?.sucesso ? `Extrato CSV salvo (${resposta.quantidade} movimentações).` : `Não foi possível salvar: ${resposta?.erro || 'erro desconhecido'}`, resposta?.sucesso ? 'sucesso' : 'erro');
    } finally {
      botao.disabled = false;
      botao.textContent = original;
    }
  });
  document.getElementById('btnFinanceiroPdf')?.addEventListener('click', async () => {
    const botao = document.getElementById('btnFinanceiroPdf');
    const original = botao.textContent;
    botao.disabled = true;
    botao.textContent = 'Gerando…';
    try {
      const resposta = await window.api.financeiroexportarpdf();
      if (!resposta?.cancelado) toast(resposta?.sucesso ? 'Extrato PDF salvo.' : `Não foi possível salvar: ${resposta?.erro || 'erro desconhecido'}`, resposta?.sucesso ? 'sucesso' : 'erro');
    } finally {
      botao.disabled = false;
      botao.textContent = original;
    }
  });
})();

// ══════════════════════════════════════════════════════════════
// v36 — PAINEL FINANCEIRO MERCADO PAGO (Prompt 3B)
//
// Dois grupos de dado, tratados separadamente para que uma falha na API
// do Mercado Pago nunca impeça o Saldo Estimado (que não depende da API)
// de aparecer, e vice-versa.
// ══════════════════════════════════════════════════════════════
let _mpPainelTimer = null;

function _fmtMoedaMP(v) {
  return 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function carregarPainelMP(mes, ano) {
  const cardsEl = document.getElementById('mpPainelCards');
  const erroEl  = document.getElementById('mpPainelErro');
  const graficoEl = document.getElementById('mpPainelGrafico');
  const atualizadoEl = document.getElementById('mpPainelAtualizadoEm');
  if (!cardsEl) return; // aba ainda não renderizada nesta sessão

  const dataInicio = new Date(ano, mes - 1, 1).toISOString();
  const dataFim     = new Date(ano, mes, 0, 23, 59, 59).toISOString();

  let painel;
  try {
    painel = await window.api.mpobterpainelfinanceiro({ dataInicio, dataFim });
  } catch (e) {
    console.error('[Painel MP] Erro de comunicação:', e);
    if (erroEl) {
      erroEl.textContent = 'Não foi possível carregar o Painel Mercado Pago agora. O restante do Relatório Financeiro acima não foi afetado.';
      erroEl.classList.remove('escondido');
    }
    if (cardsEl) cardsEl.innerHTML = '';
    return;
  }

  const cards = [];

  // ── Saldo Estimado — sempre calculado localmente, independente da API ──
  const se = painel.saldoEstimado;
  if (se && !se.erro) {
    cards.push({
      classe: 'laranja',
      valor: _fmtMoedaMP(se.saldoEstimado),
      label: 'Saldo Estimado ⓘ',
      title: 'Cálculo interno do Sistema OS: soma dos pagamentos recebidos via ' +
             'Mercado Pago menos os reembolsos registrados manualmente. NÃO é o saldo ' +
             'oficial da sua conta Mercado Pago (a API pública não oferece mais esse ' +
             'número desde 2022) — taxas, antecipações e outros movimentos da conta não entram aqui.'
    });
  } else {
    cards.push({
      classe: 'laranja',
      valor: '—',
      label: 'Saldo Estimado ⓘ',
      title: 'Não foi possível calcular o saldo estimado agora.' + (se?.erro ? (' Detalhe: ' + se.erro) : '')
    });
  }

  // ── Dados reais da API (podem falhar independentemente do saldo acima) ──
  if (erroEl) erroEl.classList.add('escondido');

  if (painel.api?.sucesso) {
    const a = painel.api;
    cards.push({ classe: 'verde',    valor: _fmtMoedaMP(a.totalRecebidoPeriodo), label: 'Recebido no Período (MP)' });
    cards.push({ classe: 'verde',    valor: String(a.qtdAprovados),              label: 'Pagamentos Aprovados', title: 'Status "approved" retornado pela API do Mercado Pago — não é o mesmo campo que "Autorizado" (statusPagamento) usado no resto do sistema, que também inclui Pix e pagamento manual.' });
    cards.push({ classe: '',         valor: _fmtMoedaMP(a.ticketMedio),          label: 'Ticket Médio' });
    cards.push({ classe: '',         valor: String(a.totalTransacoes),           label: 'Total de Transações' });
  } else if (painel.api && !painel.api.sucesso) {
    if (erroEl) {
      erroEl.textContent = painel.api.mensagem || 'Não foi possível consultar o Mercado Pago agora.';
      erroEl.classList.remove('escondido');
    }
  }

  // ── Reembolsos — sempre aparece, mesmo que zerado, sem esconder a lacuna ──
  if (se && !se.erro) {
    cards.push({
      classe: 'vermelho',
      valor: _fmtMoedaMP(se.totalReembolsadoMP),
      label: `Reembolsos Registrados (${se.qtdReembolsosMP})`,
      title: 'Soma dos reembolsos registrados manualmente pelo usuário, vinculados a pagamentos do Mercado Pago. O sistema não detecta estornos sozinho — é preciso registrar cada um.'
    });
  }

  if (cardsEl) {
    cardsEl.innerHTML = cards.map(c => `
      <div class="painel-card ${c.classe}" ${c.title ? `title="${c.title.replace(/"/g,'&quot;')}"` : ''}>
        <div class="valor" style="font-size:15px;">${c.valor}</div>
        <div class="label">${c.label}</div>
      </div>`).join('');
  }

  // ── Gráfico de recebimento por dia — mesmo padrão de <div> proporcional do DRE ──
  if (graficoEl) {
    const pontos = painel.grafico || [];
    if (pontos.length === 0) {
      graficoEl.innerHTML = '<p style="color:var(--texto-sec);font-size:12px;padding:8px 0;">Nenhum recebimento via Mercado Pago no período (ou dados da API indisponíveis).</p>';
    } else {
      const maxV = Math.max(...pontos.map(p => p.valor), 1);
      graficoEl.innerHTML = `
        <div style="display:flex;gap:6px;align-items:flex-end;height:140px;padding-top:10px;overflow-x:auto;">
          ${pontos.map(p => {
            const h = Math.max(Math.round((p.valor / maxV) * 110), p.valor > 0 ? 3 : 0);
            const dia = p.dia.slice(8, 10) + '/' + p.dia.slice(5, 7);
            return `<div class="barra-grupo" style="min-width:34px;">
              <div class="barra-wrap">
                <div style="width:18px;height:${h}px;background:var(--sucesso);border-radius:3px 3px 0 0;" title="${dia}: ${_fmtMoedaMP(p.valor)}"></div>
              </div>
              <div class="barra-mes">${dia}</div>
            </div>`;
          }).join('')}
        </div>`;
    }
  }

  if (atualizadoEl) {
    const hora = new Date(painel.atualizadoEm || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    atualizadoEl.textContent = painel.api?.sucesso ? `Atualizado às ${hora}` : `Última tentativa às ${hora}`;
  }
}

// Timer próprio do Painel MP — independente do poll de cobrança de src/backup.js,
// que resolve um problema diferente (confirmar UMA cobrança pendente por OS).
// 5 minutos: não há rate limit documentado para /v1/payments/search, mas esse
// intervalo evita consultas excessivas; se a API responder 429 em uso real,
// aumentar este valor.
const MP_PAINEL_INTERVALO_MS = 5 * 60 * 1000;

function _iniciarTimerPainelMP() {
  if (_mpPainelTimer) clearInterval(_mpPainelTimer);
  _mpPainelTimer = setInterval(() => {
    if (document.hidden || window.__SISTEMA_OS_MODO_SEGUNDO_PLANO__ === true) return;
    const abaAtiva = document.getElementById('aba-financeiro');
    if (!abaAtiva || abaAtiva.classList.contains('escondido')) return; // só atualiza se a aba estiver visível
    const selMes = document.getElementById('finMes');
    const selAno = document.getElementById('finAno');
    const mes = parseInt(selMes?.value) || (new Date().getMonth() + 1);
    const ano = parseInt(selAno?.value) || new Date().getFullYear();
    carregarPainelMP(mes, ano);
  }, MP_PAINEL_INTERVALO_MS);
}
_iniciarTimerPainelMP();

(function() {
  const btnMp = document.getElementById('btnAtualizarMpPainel');
  if (!btnMp) return;
  btnMp.addEventListener('click', async () => {
    const orig = btnMp.textContent;
    btnMp.disabled = true;
    btnMp.innerHTML = `${ICONE_RELOGIO} Atualizando...`;
    const selMes = document.getElementById('finMes');
    const selAno = document.getElementById('finAno');
    const mes = parseInt(selMes?.value) || (new Date().getMonth() + 1);
    const ano = parseInt(selAno?.value) || new Date().getFullYear();
    try {
      await carregarPainelMP(mes, ano);
    } finally {
      btnMp.disabled = false;
      btnMp.textContent = orig;
    }
  });
})();

// ══════════════════════════════════════════════════════════════
// v20 — BOTÃO VERIFICAR PAGAMENTO
// ══════════════════════════════════════════════════════════════
(function() {
  const btn = document.getElementById('btnVerificarPagamento');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const numero = btn.dataset.osNumero;
    if (!numero) return;

    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${ICONE_RELOGIO} Verificando...`;

    try {
      const r = await window.api.mpverificarpag(numero);

      if (!r.sucesso) {
        toast('Erro: ' + r.erro, 'erro');
        return;
      }

      if (r.pago) {
        // Pagamento confirmado — fecha modal e recarrega lista de OS
        toast(r.mensagem, 'sucesso');
        document.getElementById('modalEditarOS')?.classList.add('escondido');
        if (typeof carregarHistorico === 'function') carregarHistorico();
      } else {
        // Ainda não pago
        toast(r.mensagem, 'aviso');
      }
    } catch(e) {
      toast('Erro ao verificar: ' + e.message, 'erro');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });
})();

// ══════════════════════════════════════════════════════════════
// v20 — ABA PAGAMENTOS
// ══════════════════════════════════════════════════════════════

async function carregarPagamentos(query) {
  const q = query !== undefined ? query : (document.getElementById('pagBusca')?.value || '');

  // v24: cobranças pendentes + pagamentos confirmados
  let cobrancas = [], pags = [];
  try { cobrancas = await window.api.cobrancabuscar(q); } catch(e) { cobrancas = []; }
  try { pags      = await window.api.pagbuscar(q);       } catch(e) { pags = []; }

  const fmt  = v => 'R$ ' + (v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const fmtD = s => { try { return new Date(s).toLocaleString('pt-BR'); } catch { return '—'; } };
  const el = document.getElementById('pagTabela');
  if (!el) return;

  const osComPagamento = new Set(pags.map(p => p.osNumero));
  const cobPendentes = cobrancas.filter(c => c.status === 'aguardando' && !osComPagamento.has(c.osNumero));

  if (!cobPendentes.length && !pags.length) {
    el.innerHTML = '<p style="color:var(--texto-sec);font-size:13px;padding:16px;">Nenhum registro encontrado.</p>';
    return;
  }

  const badgeStatus = st => {
    if (st === 'aguardando') return `<span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#fef9c3;color:#854d0e;">${ICONE_RELOGIO} Aguardando</span>`;
    return `<span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#dcfce7;color:#15803d;">${ICONE_CHECK} Autorizado</span>`;
  };

  const linhasCob = cobPendentes.map(c => `
    <tr style="border-bottom:1px solid var(--borda);background:rgba(254,243,199,0.18);" data-cob-id="${c.id}">
      <td style="padding:8px 10px;color:var(--texto-sec);font-size:11px;">${c.id}</td>
      <td style="padding:8px 10px;color:var(--primario);font-weight:700;">${c.osNumero}</td>
      <td style="padding:8px 10px;"><div style="font-weight:600;">${c.clienteNome || '—'}</div>${c.clienteCpf ? `<div style="font-size:11px;color:var(--texto-sec);">CPF: ${c.clienteCpf}</div>` : ''}</td>
      <td style="padding:8px 10px;">${c.aparelho || '—'}</td>
      <td style="padding:8px 10px;">${badgeStatus('aguardando')}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;color:#b45309;">${fmt(c.valor)}</td>
      <td style="padding:8px 10px;font-size:12px;color:var(--texto-sec);">${fmtD(c.criadoEm)}</td>
      <td style="padding:8px 10px;">
        <button class="botao botao-fantasma" style="font-size:11px;padding:3px 8px;border-color:#f59e0b;color:#b45309;"
          onclick="verificarPagamentoManual('${c.id}','${c.osNumero}')">${ICONE_BUSCAR} Verificar Manual</button>
      </td>
    </tr>`).join('');

  const linhasPag = pags.map(p => `
    <tr style="border-bottom:1px solid var(--borda);" data-pag-id="${p.id}">
      <td style="padding:8px 10px;color:var(--texto-sec);font-size:11px;">${p.id}</td>
      <td style="padding:8px 10px;color:var(--primario);font-weight:700;">${p.osNumero}</td>
      <td style="padding:8px 10px;"><div style="font-weight:600;">${p.clienteNome || '—'}</div>${p.clienteCpf ? `<div style="font-size:11px;color:var(--texto-sec);">CPF: ${p.clienteCpf}</div>` : ''}</td>
      <td style="padding:8px 10px;">${p.aparelho || '—'}</td>
      <td style="padding:8px 10px;">${badgeStatus('pago')}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;color:#15803d;">${fmt(p.valor)}</td>
      <td style="padding:8px 10px;font-size:12px;color:var(--texto-sec);">${fmtD(p.dataPagamento)}</td>
      <td style="padding:8px 10px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${p.caminhoComprovante
            ? `<button class="botao botao-secundario" style="font-size:11px;padding:3px 8px;" onclick="abrirComprovanteExt('${p.caminhoComprovante.replace(/'/g,"\\'")}','${String(p.id || '').replace(/'/g,"\\'")}')">${ICONE_CLIPE} Ver</button>`
            : `<button class="botao botao-fantasma" style="font-size:11px;padding:3px 8px;" onclick="anexarComprovanteExt('${p.id}')">${ICONE_PASTA} Anexar</button>`
          }
          <button class="botao botao-fantasma" style="font-size:11px;padding:3px 8px;" onclick="gerarComprovantePDF('${p.id}')">${ICONE_IMPRESSORA} PDF</button>
          <button class="botao botao-fantasma" style="font-size:11px;padding:3px 8px;border-color:#dc2626;color:#dc2626;" onclick="excluirPagamentoExt('${p.id}')">${ICONE_LIXEIRA} Excluir</button>
        </div>
      </td>
    </tr>`).join('');

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="border-bottom:2px solid var(--borda);text-align:left;">
          <th style="padding:8px 10px;">ID</th><th style="padding:8px 10px;">OS</th>
          <th style="padding:8px 10px;">Cliente</th><th style="padding:8px 10px;">Aparelho</th>
          <th style="padding:8px 10px;">Status</th>
          <th style="padding:8px 10px;text-align:right;">Valor</th>
          <th style="padding:8px 10px;">Data/Hora</th><th style="padding:8px 10px;">Ações</th>
        </tr>
      </thead>
      <tbody>${linhasCob}${linhasPag}</tbody>
    </table>`;
}


// Busca ao pressionar Enter ou clicar
(function() {
  const inp = document.getElementById('pagBusca');
  const btn = document.getElementById('btnBuscarPag');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') carregarPagamentos(); });
  if (btn) btn.addEventListener('click', () => carregarPagamentos());
})();

async function abrirComprovanteExt(caminho, pagamentoId = '') {
  try {
    const r = await window.api.pagabrircomp(caminho);
    if (r && r.sucesso === false) {
      // Versões antigas podiam salvar o PDF fora da pasta atual da empresa.
      // Se isso ocorrer, regenere o documento no local seguro e abra-o.
      if (pagamentoId) {
        const reparado = await window.api.paggerarpdf(pagamentoId);
        if (reparado?.sucesso) {
          toast('Comprovante recuperado e aberto.', 'sucesso');
          carregarPagamentos();
          return;
        }
        toast('Erro: ' + (reparado?.erro || r.erro), 'erro');
        return;
      }
      toast('Erro: ' + r.erro, 'erro');
    }
  }
  catch(e) { toast('Erro ao abrir comprovante: ' + e.message, 'erro'); }
}

async function anexarComprovanteExt(pagId) {
  try {
    const r = await window.api.paganexar(pagId);
    if (r.cancelado) return;
    if (r.sucesso) { toast('Comprovante anexado!', 'sucesso'); carregarPagamentos(); }
    else toast('Erro: ' + r.erro, 'erro');
  } catch(e) { toast('Erro: ' + e.message, 'erro'); }
}

async function excluirPagamentoExt(pagId) {
  const confirmado = confirm(
    'Excluir este pagamento?\n\nIsso vai reverter o status de pagamento da OS para "sem pagamento" e apagar o comprovante anexado, se houver. Essa ação não pode ser desfeita.'
  );
  if (!confirmado) return;
  try {
    const r = await window.api.pagexcluir(pagId);
    if (r.sucesso) { toast('Pagamento excluído.', 'sucesso'); carregarPagamentos(); if (typeof carregarHistorico === 'function') carregarHistorico(); }
    else toast('Erro: ' + r.erro, 'erro');
  } catch(e) { toast('Erro: ' + e.message, 'erro'); }
}

// Bug fix: expõe funções no window para que os botões gerados via innerHTML
// possam chamá-las de forma confiável (onclick inline executa no escopo global)
window.anexarComprovanteExt      = anexarComprovanteExt;
window.abrirComprovanteExt       = abrirComprovanteExt;
window.excluirPagamentoExt       = excluirPagamentoExt;

async function gerarComprovantePDF(pagId) {
  try {
    const r = await window.api.paggerarpdf(pagId);
    if (r.sucesso) { toast('Comprovante PDF gerado e aberto!', 'sucesso'); carregarPagamentos(); }
    else toast('Erro: ' + r.erro, 'erro');
  } catch(e) { toast('Erro: ' + e.message, 'erro'); }
}

// Autoriza manualmente o reparo sem registrar um pagamento inexistente.
// O valor permanece a receber e será confirmado somente na retirada.
(function() {
  const btn = document.getElementById('btnDefinirPagamentoRetirada');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const numero = btn.dataset.osNumero;
    if (!numero) return;
    const confirmado = confirm(
      `Autorizar a OS ${numero} com pagamento na retirada?\n\n` +
      'O reparo irá para “Em reparo”, mas nenhum valor será marcado como pago. ' +
      'O recebimento deverá ser confirmado na retirada.'
    );
    if (!confirmado) return;
    btn.disabled = true;
    btn.innerHTML = `${ICONE_RELOGIO} Salvando...`;
    try {
      await window.api.osatualizar(numero, {
        status: 'Em reparo',
        statusAprovacao: 'Aprovado',
        statusPagamento: 'Aguardando Pagamento na Retirada',
        percentualPagamentoAguardado: 100
      });
      toast(`${ICONE_CHECK} OS ${numero} autorizada com pagamento na retirada.`, 'sucesso');
      document.getElementById('modalEditarOS')?.classList.add('escondido');
      if (typeof carregarHistorico === 'function') carregarHistorico();
      if (typeof carregarAutorizadas === 'function') carregarAutorizadas();
    } catch (erro) {
      toast('Não foi possível definir o pagamento na retirada: ' + (erro?.message || erro), 'erro');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${ICONE_RELOGIO} Pagamento na Retirada`;
    }
  });
})();

// ── Botão Registrar Pagamento Manual ──────────────────────────
(function() {
  const btn = document.getElementById('btnRegistrarPagManual');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const numero = btn.dataset.osNumero;
    const valorSugerido = parseFloat(btn.dataset.osValor) || 0;
    if (!numero) return;

    const metodo = await promptModal('Forma de pagamento:', 'Dinheiro', {
      opcoes: ['Dinheiro', 'Pix', 'Cartão de crédito', 'Cartão de débito', 'Transferência']
    }).catch(() => null);
    if (!metodo) return;

    const valorStr = await promptModal(`Valor recebido (R$):`, valorSugerido.toFixed(2)).catch(() => null);
    if (!valorStr) return;
    const valor = parseFloat(String(valorStr).replace(',', '.'));
    if (!valor || valor <= 0) { toast('Valor inválido.', 'erro'); return; }

    try {
      const pag = await window.api.pagregistrar({
        osNumero: numero,
        valor,
        metodo,
        origem: 'manual',
        observacao: 'Registrado manualmente pelo operador'
      });
      toast(`Pagamento de R$ ${valor.toFixed(2)} registrado! OS marcada como Autorizada.`, 'sucesso');
      document.getElementById('modalEditarOS')?.classList.add('escondido');
      if (typeof carregarHistorico === 'function') carregarHistorico();
      if (typeof carregarPagamentos === 'function') carregarPagamentos();

      // Pagamento lançado manualmente é uma operação interna e silenciosa.
      // O status muda, mas nenhuma mensagem é enviada ao cliente.
      return;

      // ── WhatsApp de confirmação de pagamento (manual) ──────────
      // Envia o template de pagamento confirmado com comprovante PDF
      (async () => {
        try {
          if (!window.api.wappenviarpagconf) return;
          const cfg = (typeof configAtual !== 'undefined' && configAtual?.nomeEmpresa)
            ? configAtual
            : await window.api.configobter().catch(() => ({}));
          const os = await window.api.osobter(numero).catch(() => null);
          const tel = (os?.cliente?.telefone || '').replace(/\D/g, '');
          if (!tel) {
            console.log('[PagManual] Sem telefone — WhatsApp não enviado.');
            return;
          }

          // Gera PDF do comprovante para anexar à mensagem
          let caminhoPdfComprovante = '';
          const pagamentoId = pag?.id || pag?.pagamentoId || null;
          if (pagamentoId && window.api.paggerarpdfsilencioso) {
            try {
              const rPdf = await window.api.paggerarpdfsilencioso(pagamentoId);
              if (rPdf?.sucesso) caminhoPdfComprovante = rPdf.caminho;
            } catch (ePdf) {
              console.warn('[PagManual] Falha ao gerar comprovante PDF:', ePdf.message);
            }
          }

          const rWapp = await window.api.wappenviarpagconf({
            telefone: tel,
            os: {
              nome_cliente : os?.cliente?.nome  || '',
              numero       : numero,
              marca        : os?.aparelho?.marca  || '',
              modelo       : os?.aparelho?.modelo || '',
            },
            config: {
              nomeEmpresa : cfg.nomeEmpresa || 'Assistência Técnica',
              codigoPais  : (cfg.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55',
            },
            caminhoPdf: caminhoPdfComprovante,
          });

          if (rWapp?.sucesso) {
            console.log(`[PagManual] WhatsApp de confirmação enviado — OS ${numero}`);
            if (typeof window.adicionarNotificacao === 'function') {
              window.adicionarNotificacao({
                tipo: 'mensagem_enviada',
                titulo: `WhatsApp enviado — confirmação de pagamento manual`,
                descricao: `OS ${numero} · ${os?.cliente?.nome || ''}`,
                osNumero: numero
              });
            }
          } else {
            console.warn('[PagManual] WhatsApp de confirmação falhou:', rWapp?.erro);
            if (typeof window.adicionarNotificacao === 'function') {
              window.adicionarNotificacao({
                tipo: 'erro',
                titulo: `Erro ao enviar WhatsApp — OS ${numero}`,
                descricao: rWapp?.erro || 'WhatsApp desconectado ou sem resposta.',
                osNumero: numero
              });
            }
            toast(`${ICONE_ALERTA} Pagamento registrado, mas WhatsApp não foi enviado: ` + (rWapp?.erro || 'desconectado'), 'aviso');
          }
        } catch (e) {
          console.warn('[PagManual] WhatsApp falhou:', e.message);
          toast(`${ICONE_ALERTA} Pagamento registrado, mas WhatsApp não foi enviado: ` + e.message, 'aviso');
        }
      })();
      // ────────────────────────────────────────────────────────────

    } catch(e) { toast('Erro: ' + e.message, 'erro'); }
  });
})();

// ── Fase 6 — Botão "Confirmar Pagamento Presencial" ────────────────────────
//
// Só aparece quando statusPagamento === 'Aguardando Pagamento na Retirada'
// (Fase 5: cliente já respondeu pelo WhatsApp a forma de pagamento combinada
// na retirada, mas ninguém confirmou ainda que o dinheiro foi de fato
// recebido). Diferente de "Registrar Pagamento" (genérico, pede forma e
// valor sempre), este botão já conhece a forma de pagamento combinada e o
// valor da cobrança enviada — só pede confirmação de que o recebimento
// presencial realmente aconteceu, já que essa ação marca a OS como paga
// sem nenhuma validação automática (sem checar Mercado Pago, sem
// comprovante).
(function() {
  const btn = document.getElementById('btnConfirmarPagamentoPresencial');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const numero = btn.dataset.osNumero;
    if (!numero) { toast('OS não identificada.', 'erro'); return; }

    const valorSugerido = parseFloat(btn.dataset.osValor) || 0;
    const percentualAguardado = Number(btn.dataset.osPercentual) === 50 ? 50 : 100;
    const formaPagamento = btn.dataset.osFormaPagamento || '';

    const descricaoValor = valorSugerido > 0 ? `R$ ${valorSugerido.toFixed(2)}` : 'valor não identificado';
    const descricaoForma = formaPagamento ? ` via ${formaPagamento}` : '';

    // Confirmação explícita — esta ação marca a OS como paga manualmente,
    // sem nenhuma validação automática (não consulta Mercado Pago nem exige
    // comprovante).
    const confirmado = confirm(
      `Confirmar o recebimento presencial de ${percentualAguardado}% (${descricaoValor})${descricaoForma} para a OS ${numero}?\n\n` +
      `${percentualAguardado === 50
        ? 'A entrada autoriza o início do reparo e os 50% restantes ficam para a retirada.'
        : 'O pagamento integral quita o serviço e autoriza o início do reparo.'}\n\n` +
      `Esta confirmação é manual e não consulta o Mercado Pago. ` +
      `Use apenas depois de conferir que o valor foi realmente recebido.`
    );
    if (!confirmado) return;

    btn.disabled = true;
    btn.innerHTML = `${ICONE_RELOGIO} Confirmando...`;

    try {
      if (!window.api.osconfirmarpagamentopresencial) {
        toast('Recurso não disponível — atualize o sistema.', 'erro');
        return;
      }

      const r = await window.api.osconfirmarpagamentopresencial({
        osNumero: numero,
        enviarWhatsapp: false,
        // valor/metodo ficam de fora: a função no processo principal já
        // reaproveita o que a Fase 5 registrou na OS (valor da cobrança,
        // forma de pagamento respondida pelo cliente).
      });

      if (!r?.sucesso) {
        toast('Erro ao confirmar pagamento: ' + (r?.erro || 'erro desconhecido'), 'erro');
        return;
      }

      toast(`${ICONE_CHECK} ${r.mensagem || 'Pagamento presencial confirmado!'}`, 'sucesso');
      if (r.avisoComprovante) {
        toast(`${ICONE_ALERTA} Pagamento salvo, mas o comprovante não foi gerado: ${r.avisoComprovante}`, 'aviso');
      }
      document.getElementById('modalEditarOS')?.classList.add('escondido');
      if (typeof carregarHistorico === 'function') carregarHistorico();
      if (typeof carregarPagamentos === 'function') carregarPagamentos();

      if (typeof window.adicionarNotificacao === 'function') {
        window.adicionarNotificacao({
          tipo: 'mensagem_enviada',
          titulo: 'Pagamento presencial confirmado',
          descricao: `OS ${numero} — R$ ${(r.pagamento?.valor || valorSugerido).toFixed(2)}`,
          osNumero: numero
        });
      }

      if (r.wppEnviado) {
        console.log(`[PagamentoPresencial] WhatsApp de confirmação enviado — OS ${numero}`);
      } else if (r.wppErro) {
        console.warn('[PagamentoPresencial] WhatsApp não enviado:', r.wppErro);
        toast(`${ICONE_ALERTA} Pagamento confirmado, mas WhatsApp não foi enviado: ` + r.wppErro, 'aviso');
      }
    } catch (e) {
      toast('Erro: ' + e.message, 'erro');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${ICONE_CIFRAO} Confirmar Pagamento Presencial`;
    }
  });
})();

// ══════════════════════════════════════════════════════════════
// v24 PARTE 2 — POLLING AUTOMÁTICO + STATUS ENTREGUE + PÓS-VENDA
// Acrescente este bloco ao FINAL do renderer.js
// ══════════════════════════════════════════════════════════════

// A verificação automática roda somente no processo principal. Manter um
// segundo setInterval no renderer criava corrida entre cobranças de uma mesma
// OS; esta camada apenas recebe o evento exato emitido pelo backend.

/**
 * Chamada interna quando o polling (ou verificação manual) detecta pagamento.
 * Atualiza DB, envia 2º WhatsApp (apenas se não enviado antes) e recarrega a tabela.
 * @param {string} cobId       - ID da cobrança
 * @param {string} osNumero    - Número da OS
 * @param {string} [pagamentoId] - ID do pagamento gerado (para linkar na cobrança)
 * @param {boolean} [jaConfirmado] - true = pagamento já estava registrado (dedup: não reenvia WhatsApp)
 */
async function _confirmarPagamentoComWapp(cobId, osNumero, pagamentoId, jaConfirmado, wppJaEnviado) {
  try {
    // 1) Atualiza status da cobrança para 'pago', vinculando o pagamentoId
    await window.api.cobrancaatualizar(cobId, { status: 'pago', pagamentoId: pagamentoId || undefined });

    // 2) Recupera dados da cobrança (telefone + nome cliente)
    const todasCobrancas = await window.api.cobrancabuscar(osNumero);
    const cob = todasCobrancas.find(c => c.id === cobId);
    const tel         = (cob?.clienteTel || '').replace(/\D/g, '');
    const nomeCliente = cob?.clienteNome || '';

    // 3) Notificação interna — pagamento confirmado
    // Só cria se for primeira confirmação; se jaConfirmado=true, o
    // evento onMpPagamentoConfirmado já criou a notificação antes.
    if (!jaConfirmado && typeof window.adicionarNotificacao === 'function') {
      window.adicionarNotificacao({
        tipo: 'pagamento_confirmado',
        titulo: `Pagamento confirmado — OS ${osNumero}`,
        descricao: nomeCliente ? `Cliente: ${nomeCliente}` : '',
        osNumero
      });
    }

    // 4) WhatsApp de confirmação — com await para garantir envio antes de atualizar UI
    // wppJaEnviado=true indica que main.js já enviou dentro de mp:verificarPagamento (evita duplicata)
    if (!jaConfirmado && !wppJaEnviado && tel && window.api.wappenviarpagconf) {
      try {
        const cfg = (typeof configAtual !== 'undefined' && configAtual?.nomeEmpresa)
          ? configAtual
          : await window.api.configobter().catch(() => ({}));

        // Busca marca/modelo da OS para compor a mensagem do template
        const osData = await window.api.osobter(osNumero).catch(() => null);
        const apPag  = osData?.aparelho || {};

        // Gera o comprovante de pagamento em PDF para anexar à mensagem
        let caminhoPdfComprovante = '';
        if (pagamentoId && window.api.paggerarpdfsilencioso) {
          try {
            const rPdf = await window.api.paggerarpdfsilencioso(pagamentoId);
            if (rPdf?.sucesso) caminhoPdfComprovante = rPdf.caminho;
          } catch (ePdfGen) {
            console.warn('[PagConf] Falha ao gerar comprovante PDF:', ePdfGen.message);
          }
        }

        const rWapp = await window.api.wappenviarpagconf({
          telefone: tel,
          os: {
            nome_cliente: nomeCliente,
            numero      : osNumero,
            marca       : apPag.marca  || '',
            modelo      : apPag.modelo || '',
          },
          config: {
            nomeEmpresa: cfg.nomeEmpresa || 'Assistência Técnica',
            codigoPais : (cfg.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55',
          },
          caminhoPdf: caminhoPdfComprovante,
        });

        if (typeof window.adicionarNotificacao === 'function') {
          if (rWapp?.sucesso) {
            window.adicionarNotificacao({
              tipo: 'mensagem_enviada',
              titulo: `WhatsApp enviado — confirmação de pagamento`,
              descricao: `OS ${osNumero} · ${nomeCliente}`,
              osNumero
            });
          } else {
            window.adicionarNotificacao({
              tipo: 'erro',
              titulo: `Erro ao enviar WhatsApp — OS ${osNumero}`,
              descricao: rWapp?.erro || 'Verifique a conexão do WhatsApp.',
              osNumero
            });
          }
        }
      } catch (eWapp) {
        console.warn('[PagConf] WhatsApp de confirmação falhou:', eWapp.message);
        if (typeof window.adicionarNotificacao === 'function') {
          window.adicionarNotificacao({
            tipo: 'erro',
            titulo: `Erro ao enviar WhatsApp — OS ${osNumero}`,
            descricao: eWapp.message,
            osNumero
          });
        }
      }
    }

    toast(`${ICONE_CHECK} Pagamento da OS ${osNumero} confirmado automaticamente!`, 'sucesso');

    // 5) Atualiza a UI
    if (typeof carregarPagamentos === 'function') carregarPagamentos();
    if (typeof carregarHistorico === 'function') carregarHistorico();

  } catch (e) {
    console.error('[PagConf] Erro ao confirmar pagamento:', e.message);
  }
}

// Verificação manual da cobrança exata. O cobId evita confundir entrada e
// pagamento integral quando pertencem à mesma OS.

window.verificarPagamentoManual = async function (cobId, osNumero) {
  const row = document.querySelector(`[data-cob-id="${cobId}"]`);
  const btn = row ? row.querySelector('button') : null;
  if (btn) { btn.disabled = true; btn.innerHTML = `${ICONE_RELOGIO} Verificando...`; }

  try {
    if (!window.api.mpverificarpag) throw new Error('Canal MP não disponível.');
    const r = await window.api.mpverificarpag({ numero: osNumero, cobId });
    if (!r.sucesso) {
      toast('Erro ao verificar: ' + r.erro, 'erro');
      return;
    }
    if (r.pago) {
      const cobConfirmada = r.cobId || cobId;
      if (cobConfirmada !== cobId) throw new Error('O Mercado Pago confirmou outra cobrança desta OS. A lista será atualizada.');
      await _confirmarPagamentoComWapp(cobConfirmada, osNumero, r.pagamentoId, r.jaConfirmado, r.wppEnviado || false);
    } else {
      toast(`${ICONE_RELOGIO} Pagamento ainda não detectado. ` + (r.mensagem || ''), 'aviso');
      if (r.status === 'cobranca_alternativa_cancelada' && typeof carregarPagamentos === 'function') carregarPagamentos();
      if (btn) { btn.disabled = false; btn.innerHTML = `${ICONE_BUSCAR} Verificar Manual`; }
    }
  } catch (e) {
    toast('Erro: ' + e.message, 'erro');
    if (btn) { btn.disabled = false; btn.innerHTML = `${ICONE_BUSCAR} Verificar Manual`; }
  }
};



// Botão WhatsApp Confirmação de Pagamento — envio manual
(function() {
  const btn = document.getElementById('btnWappPagConf');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const numero = btn.dataset.osNumero;
    if (!numero) { toast('OS não identificada.', 'erro'); return; }
    await reenviarWappPagConf(numero);
  });
})();

window.reenviarWappPagConf = async function(numero) {
  try {
    if (!window.api.wappenviarpagconf) { toast('WhatsApp não disponível.', 'erro'); return; }
    const cfg = (typeof configAtual !== 'undefined' && configAtual?.nomeEmpresa)
      ? configAtual
      : await window.api.configobter().catch(() => ({}));
    const os  = await window.api.osobter(numero).catch(() => null);
    const tel = (os?.cliente?.telefone || '').replace(/\D/g, '');
    if (!tel) { toast('Cliente sem telefone cadastrado.', 'erro'); return; }
    const confirmarEnvio = await confirmModal(
      `Enviar agora a confirmação de pagamento da OS ${numero} para ${os?.cliente?.nome || 'o cliente'}?`,
      { titulo: 'Confirmar envio pelo WhatsApp', textoOk: 'Confirmar e enviar' }
    );
    if (!confirmarEnvio) return;

    // Busca o pagamento desta OS para gerar/anexar o comprovante PDF
    let caminhoPdfComprovante = '';
    try {
      const pagsDaOs = await window.api.pagbuscar(numero).catch(() => []);
      const pagMaisRecente = (pagsDaOs || []).find(p => p.osNumero === numero);
      if (pagMaisRecente && window.api.paggerarpdfsilencioso) {
        const rPdf = await window.api.paggerarpdfsilencioso(pagMaisRecente.id);
        if (rPdf?.sucesso) caminhoPdfComprovante = rPdf.caminho;
      }
    } catch (ePdf) {
      console.warn('[ReenvioPagConf] Falha ao gerar comprovante PDF:', ePdf.message);
    }

    toast('Enviando confirmação de pagamento...', 'info');
    const r = await window.api.wappenviarpagconf({
      telefone: tel,
      os: {
        nome_cliente : os?.cliente?.nome    || '',
        numero       : numero,
        marca        : os?.aparelho?.marca  || '',
        modelo       : os?.aparelho?.modelo || '',
      },
      config: {
        nomeEmpresa : cfg.nomeEmpresa || 'Assistência Técnica',
        codigoPais  : (cfg.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55',
      },
      caminhoPdf: caminhoPdfComprovante,
    });
    if (r?.sucesso) toast(`${ICONE_CHECK} Confirmação aceita pelo servidor do WhatsApp.`, 'sucesso');
    else toast('Erro ao enviar: ' + (r?.erro || 'verifique o WhatsApp.'), 'erro');
  } catch(e) {
    toast('Erro: ' + e.message, 'erro');
  }
};

// Botão WhatsApp Avaliação (OS Entregue) — reenvio manual
(function() {
  const btn = document.getElementById('btnWappAvaliacao');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const numero = btn.dataset.osNumero;
    if (!numero) { toast('OS não identificada.', 'erro'); return; }
    await reenviarWappEntregue(numero);
  });
})();

// Envio manual de "Pronto para Retirada". Usa o mesmo modal de confirmação do
// orçamento e deixa Mercado Pago opcional por envio.
(function() {
  const btn = document.getElementById('btnProntoRetirada');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const numero = btn.dataset.osNumero;
    if (!numero) { toast('OS não identificada.', 'erro'); return; }
    abrirModalEnvioWhatsAppManual('retirada', numero);
  });
})();

window.reenviarWappEntregue = async function(numero) {
  try {
    const cfg = (typeof configAtual !== 'undefined' && configAtual?.nomeEmpresa)
      ? configAtual
      : await window.api.configobter().catch(() => ({}));
    const os  = await window.api.osobter(numero).catch(() => null);
    const tel = (os?.cliente?.telefone || '').replace(/\D/g, '');
    if (!tel) { toast('Cliente sem telefone cadastrado.', 'erro'); return; }
    if (!window.api.wappenviarentregue) { toast('WhatsApp não disponível.', 'erro'); return; }
    const confirmarEnvio = await confirmModal(
      `Enviar agora a mensagem de avaliação da OS ${numero} para ${os?.cliente?.nome || 'o cliente'}?`,
      { titulo: 'Confirmar envio pelo WhatsApp', textoOk: 'Confirmar e enviar' }
    );
    if (!confirmarEnvio) return;
    toast('Enviando mensagem de avaliação...', 'info');
    const r = await window.api.wappenviarentregue({
      telefone: tel,
      os: { nome_cliente: os?.cliente?.nome || '' },
      config: {
        nomeEmpresa        : cfg.nomeEmpresa || 'Assistência Técnica',
        linkGoogleAvaliacao: cfg.linkGoogleAvaliacao || cfg.googleMapsReviewLink || '',
        codigoPais         : (cfg.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55',
      },
    });
    if (r?.sucesso) toast(`${ICONE_CHECK} Mensagem de avaliação aceita pelo servidor.`, 'sucesso');
    else toast('Erro ao enviar: ' + (r?.erro || 'verifique o WhatsApp.'), 'erro');
  } catch(e) {
    toast('Erro: ' + e.message, 'erro');
  }
};

// ── 4. HOOK STATUS "ENTREGUE" — 3º WhatsApp pós-venda ──────────
//
// Terceiro patch em window.api.osatualizar (os dois primeiros são do
// controle de estoque de peças). Detecta status = 'Entregue' e dispara
// WhatsApp de agradecimento + link Google Maps.

(function () {
  const _anteriorOsAtualizar = window.api.osatualizar;
  if (!_anteriorOsAtualizar) return;

  window.api.osatualizar = async function (numero, dados, ...rest) {
    const novoStatus = dados?.status;
    const osAntesDaAtualizacao = novoStatus === 'Entregue'
      ? await window.api.osobter(numero).catch(() => null)
      : null;
    const virouEntregue = novoStatus === 'Entregue' && osAntesDaAtualizacao?.status !== 'Entregue';

    // Chama a cadeia de patches anterior
    const resultado = await _anteriorOsAtualizar.apply(this, [numero, dados, ...rest]);

    // Disparo assíncrono do WhatsApp ao marcar como Entregue
    if (virouEntregue) {
      (async () => {
        try {
          // Usa configAtual (variável global do renderer) ou faz nova leitura
          const cfg = (typeof configAtual !== 'undefined' && configAtual?.nomeEmpresa)
            ? configAtual
            : await window.api.configobter().catch(() => ({}));

          const googleMapsLink = cfg.googleMapsReviewLink || '';
          const empresa        = cfg.nomeEmpresa || 'Assistência Técnica';

          // Busca dados da OS para pegar telefone e nome
          const os = await window.api.osobter(numero).catch(() => null);
          const tel          = (os?.cliente?.telefone || '').replace(/\D/g, '');
          const primeiroNome = (os?.cliente?.nome || '').split(' ')[0] || 'cliente';

          if (!tel || !window.api.wappenviarentregue) return;

          // v25.1: usa wappenviarentregue com template estruturado
          // linkGoogleAvaliacao tem prioridade; cai em googleMapsReviewLink (legado)
          await window.api.wappenviarentregue({
            telefone: tel,
            os: {
              nome_cliente: os?.cliente?.nome || primeiroNome,
            },
            config: {
              nomeEmpresa         : empresa,
              linkGoogleAvaliacao : cfg.linkGoogleAvaliacao || googleMapsLink || '',
              codigoPais          : (cfg.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55',
            },
          });
          console.log(`[Entregue] 3º WhatsApp enviado para OS ${numero} (${tel})`);

        } catch (e) {
          console.warn('[Entregue] Erro ao enviar WhatsApp pós-venda:', e.message);
        }
      })();
    }

    return resultado;
  };
})();

// ── 5. HOOK DE APROVAÇÃO E PAGAMENTO ───────────────────────────
// Aprovação gera o aviso operacional; pagamento total pode gerar a mensagem
// financeira. Os eventos são independentes para não cobrar/confirmar errado.

(function () {
  const _anteriorPago = window.api.osatualizar;
  if (!_anteriorPago) return;

  window.api.osatualizar = async function (numero, dados, ...rest) {
    const novoStatus    = dados?.status;
    const novoStatusAprovacao = dados?.statusAprovacao;
    const novoStatusPag = dados?.statusPagamento;
    const solicitouAutorizacao = novoStatusAprovacao === 'Aprovado' ||
      (novoStatus === 'Em reparo' && novoStatusPag === 'Aguardando Pagamento na Retirada');
    const pagamentoQuitado = ['Pago', 'Autorizado'].includes(novoStatusPag);
    const osAnterior = (solicitouAutorizacao || pagamentoQuitado)
      ? await window.api.osobter(numero).catch(() => null)
      : null;
    const jaEstavaAutorizada = osAnterior?.statusAprovacao === 'Aprovado'
      || osAnterior?.aceitouTermos === true;
    const jaEstavaPaga = ['Pago', 'Autorizado'].includes(osAnterior?.statusPagamento)
      || Number(osAnterior?.percentualPagamentoConfirmado) >= 100;
    const resultado = await _anteriorPago.apply(this, [numero, dados, ...rest]);

    if (solicitouAutorizacao && !jaEstavaAutorizada && typeof window.adicionarNotificacao === 'function') {
      const osAtualizada = await window.api.osobter(numero).catch(() => null);
      const aparelho = _aparelhoSemRepeticao(
        osAtualizada?.aparelho?.marca,
        osAtualizada?.aparelho?.modelo
      ) || 'Aparelho não informado';
      window.adicionarNotificacao({
        tipo: 'sistema',
        titulo: `OS ${numero} autorizada`,
        descricao: `${aparelho} foi autorizado para reparo.`,
        osNumero: numero
      });
    }

    if (!jaEstavaPaga && pagamentoQuitado) {
      (async () => {
        try {
          const cfg = (typeof configAtual !== 'undefined' && configAtual?.nomeEmpresa)
            ? configAtual
            : await window.api.configobter().catch(() => ({}));
          const os = await window.api.osobter(numero).catch(() => null);
          const tel = (os?.cliente?.telefone || '').replace(/\D/g, '');
          if (!tel || !window.api.wappenviarpagconf) return;
          await window.api.wappenviarpagconf({
            telefone: tel,
            os: {
              nome_cliente : os?.cliente?.nome  || '',
              numero       : numero,
              marca        : os?.aparelho?.marca  || '',
              modelo       : os?.aparelho?.modelo || '',
            },
            config: {
              nomeEmpresa : cfg.nomeEmpresa || 'Assistência Técnica',
              codigoPais  : (cfg.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55',
            },
          });
          console.log('[Pagamento] WhatsApp de confirmação enviado — OS ' + numero);
        } catch (e) {
          console.warn('[Pagamento] Erro ao enviar WhatsApp (não crítico):', e.message);
        }
      })();
    }

    return resultado;
  };
})();

// ── Fim da Parte 2 ─────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO WHATSAPP — Painel de Conexão com QR Code (v25.2)
// Gerencia o modal, status em tempo real e eventos do backend Baileys
// ══════════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── Referências DOM ───────────────────────────────────────────────────────
  const modal            = document.getElementById('modalWapp');
  const statusCard       = document.getElementById('wappStatusCard');
  const statusIcone      = document.getElementById('wappStatusIcone');
  const statusLabel      = document.getElementById('wappStatusLabel');
  const statusDetalhe    = document.getElementById('wappStatusDetalhe');
  const statusBadge      = document.getElementById('wappStatusBadge');

  const qrWrapper        = document.getElementById('wappQrWrapper');
  const qrImg            = document.getElementById('wappQrImg');
  const loadingArea      = document.getElementById('wappLoadingArea');
  const loadingTexto     = document.getElementById('wappLoadingTexto');
  const conectadoArea    = document.getElementById('wappConectadoArea');
  const conectadoNumero  = document.getElementById('wappConectadoNumero');
  const erroArea         = document.getElementById('wappErroArea');
  const erroMensagem     = document.getElementById('wappErroMensagem');

  const btnDesconectar   = document.getElementById('btnWappDesconectar');
  const btnReconectar    = document.getElementById('btnWappReconectar');
  const btnPainel        = document.getElementById('btnWappPanel');
  const statusDot        = document.getElementById('wappStatusDot');

  // ─── Mapa de status → UI ───────────────────────────────────────────────────
  const STATUS_MAP = {
    'desconectado': {
      icone: `${ICONE_CELULAR_OFF}`,
      label: 'Desconectado',
      detalhe: 'Escaneie o QR Code para conectar',
      area: 'loading',
      loadingTxt: 'Aguardando conexão...',
    },
    'conectando': {
      icone: `${ICONE_SYNC}`,
      label: 'Conectando...',
      detalhe: 'Estabelecendo conexão com o WhatsApp',
      area: 'loading',
      loadingTxt: 'Conectando ao WhatsApp...',
    },
    'aguardando-qr': {
      icone: `${ICONE_CAMERA}`,
      label: 'Aguardando QR Code',
      detalhe: 'Escaneie o QR Code com o celular',
      area: 'qr',
    },
    'conectado': {
      icone: `${ICONE_CHECK}`,
      label: 'Conectado',
      detalhe: 'Integração ativa e funcionando',
      area: 'conectado',
    },
    'reconectando': {
      icone: `${ICONE_SYNC}`,
      label: 'Reconectando...',
      detalhe: 'Conexão perdida — tentando reconectar',
      area: 'loading',
      loadingTxt: 'Reconectando ao WhatsApp...',
    },
    'erro': {
      icone: `${ICONE_ALERTA}`,
      label: 'Erro de Conexão',
      detalhe: 'Falha na integração — verifique os logs',
      area: 'erro',
    },
  };

  // ─── Atualiza a UI com base no status ─────────────────────────────────────
  function aplicarStatus(status, extra) {
    const cfg = STATUS_MAP[status] || STATUS_MAP['desconectado'];

    // Atualiza card de status
    statusCard.dataset.status = status;
    statusIcone.innerHTML     = cfg.icone;
    statusLabel.textContent   = cfg.label;
    statusDetalhe.textContent = cfg.detalhe;

    // Atualiza dot no botão do topo
    if (statusDot) {
      statusDot.dataset.status = status;
      statusDot.title = cfg.label;
    }

    // Atualiza label do botão no topo
    const btnLabel = document.getElementById('wappBtnLabel');
    if (btnLabel) {
      btnLabel.innerHTML = status === 'conectado' ? `WhatsApp ${ICONE_CHECK}` : 'WhatsApp';
    }

    // Mostra/esconde áreas
    qrWrapper.style.display      = cfg.area === 'qr'        ? 'flex'   : 'none';
    loadingArea.style.display    = cfg.area === 'loading'   ? 'flex'   : 'none';
    conectadoArea.style.display  = cfg.area === 'conectado' ? 'flex'   : 'none';
    erroArea.style.display       = cfg.area === 'erro'      ? 'flex'   : 'none';

    // Texto do loading
    if (cfg.loadingTxt && loadingTexto) {
      loadingTexto.textContent = cfg.loadingTxt;
    }

    // Número conectado
    if (status === 'conectado' && extra?.numero && conectadoNumero) {
      const num = extra.numero;
      const formatado = num.length === 13
        ? `+${num.slice(0,2)} (${num.slice(2,4)}) ${num.slice(4,9)}-${num.slice(9)}`
        : `+${num}`;
      conectadoNumero.innerHTML = `${ICONE_CELULAR} ` + formatado;
    }

    // Mensagem de erro
    if (status === 'erro' && extra?.mensagem && erroMensagem) {
      erroMensagem.textContent = extra.mensagem;
    }

    // Botões do rodapé
    if (btnDesconectar) btnDesconectar.style.display = status === 'conectado' ? '' : 'none';
    if (btnReconectar)  btnReconectar.style.display  = (status === 'desconectado' || status === 'erro') ? '' : 'none';
  }

  // ─── Recebe QR Code do backend ────────────────────────────────────────────
  function onQrRecebido(dataUrl) {
    if (!dataUrl) return;
    qrImg.src = dataUrl;
    aplicarStatus('aguardando-qr');
  }

  // ─── Recebe update de status do backend ───────────────────────────────────
  function onStatusRecebido(payload) {
    const { status, ...extra } = payload || {};
    if (status) aplicarStatus(status, extra);
  }

  // ─── Botões de ação ───────────────────────────────────────────────────────
  if (btnDesconectar) {
    btnDesconectar.addEventListener('click', async () => {
      if (!confirm('Deseja realmente desconectar o WhatsApp? Você precisará escanear o QR Code novamente.')) return;
      btnDesconectar.disabled = true;
      btnDesconectar.innerHTML = `${ICONE_RELOGIO} Desconectando...`;
      try {
        await window.api.wappdesconectar();
        aplicarStatus('desconectado');
      } catch (e) {
        toast('Erro ao desconectar: ' + e.message, 'erro');
      }
      btnDesconectar.disabled = false;
      btnDesconectar.innerHTML = `${ICONE_PLUGUE} Desconectar`;
    });
  }

  if (btnReconectar) {
    btnReconectar.addEventListener('click', async () => {
      btnReconectar.disabled = true;
      btnReconectar.innerHTML = `${ICONE_RELOGIO} Reconectando...`;
      aplicarStatus('conectando');
      try {
        await window.api.wappreconectar();
      } catch (e) {
        toast('Erro ao reconectar: ' + e.message, 'erro');
        aplicarStatus('erro', { mensagem: e.message });
      }
      btnReconectar.disabled = false;
      btnReconectar.innerHTML = `${ICONE_SYNC} Reconectar`;
    });
  }

  // ─── Abre o modal e consulta status atual ─────────────────────────────────
  if (btnPainel) {
    btnPainel.addEventListener('click', async () => {
      if (!modal) return;
      modal.classList.remove('escondido');

      // Consulta status inicial para montar a UI
      aplicarStatus('conectando'); // estado intermediário enquanto consulta
      try {
        if (window.api.wappstatus) {
          const r = await window.api.wappstatus();
          aplicarStatus(r.status || 'desconectado', r);
        } else {
          aplicarStatus('desconectado');
        }
      } catch {
        aplicarStatus('desconectado');
      }
    });
  }

  // ─── Registra listeners de eventos push do backend ────────────────────────
  if (window.api.onwappqr)     window.api.onwappqr(onQrRecebido);
  if (window.api.onwappstatus) window.api.onwappstatus(onStatusRecebido);

  // v46: notificação quando uma classificação por IA (forma de pagamento ou
  // aceite de termos, no WhatsApp) cai no fallback por ERRO real — nunca
  // quando a IA está desligada/sem chave de propósito (ver src/ia-groq.js,
  // _registrarLog só emite este evento para origem 'fallback_erro').
  if (window.api.oniaClassificacaoFallback) {
    window.api.oniaClassificacaoFallback((dados) => {
      toast(`${ICONE_ALERTA} Classificação por IA falhou (usando reserva por palavras-chave) — OS ${dados.osNumero || '?'}`, 'erro');
      if (typeof window.adicionarNotificacao === 'function') {
        window.adicionarNotificacao({
          tipo: 'erro',
          titulo: `IA indisponível — OS ${dados.osNumero || '?'}`,
          descricao: `${dados.motivoFallback || 'Falha desconhecida'}${dados.clienteNome ? ' · ' + dados.clienteNome : ''}. O sistema usou o classificador por palavras-chave normalmente.`,
          osNumero: dados.osNumero
        });
      }
    });
  }

  // ─── Auto-poll Mercado Pago: notificação automática de pagamento ──────────
  if (window.api.onMpPagamentoConfirmado) {
    window.api.onMpPagamentoConfirmado(async (dados) => {
      const valorFmt = 'R$ ' + parseFloat(dados.valorPago || 0)
        .toLocaleString('pt-BR', { minimumFractionDigits: 2 });
      const metodo = dados.metodo || 'Mercado Pago';
      const pagamentoParcial = Number(dados.percentualPagamentoConfirmado || 0) === 50
        && Number(dados.valorRestante || 0) > 0;
      const resumoPagamento = pagamentoParcial
        ? 'Entrada de 50% confirmada; reparo autorizado'
        : 'Pagamento integral confirmado';
      const osAutorizada = await window.api.osobter(dados.osNumero).catch(() => null);
      const aparelhoAutorizado = _aparelhoSemRepeticao(
        osAutorizada?.aparelho?.marca,
        osAutorizada?.aparelho?.modelo
      ) || 'Aparelho não informado';

      // Toast visual no sistema
      toast(`${ICONE_CHECK} ${resumoPagamento} — OS ${dados.osNumero}, ${valorFmt} via ${metodo}.`, 'sucesso');

      // Notificação interna — pagamento confirmado (auto-poll backend)
      if (typeof window.adicionarNotificacao === 'function') {
        window.adicionarNotificacao({
          tipo: 'pagamento_confirmado',
          titulo: `Pagamento confirmado — OS ${dados.osNumero}`,
          descricao: `${valorFmt} via ${metodo}${dados.clienteNome ? ' · ' + dados.clienteNome : ''}`,
          osNumero: dados.osNumero
        });
        window.adicionarNotificacao({
          tipo: 'sistema',
          titulo: `OS ${dados.osNumero} autorizada`,
          descricao: `${aparelhoAutorizado} foi autorizado para reparo.`,
          osNumero: dados.osNumero
        });
      }

      // Recarrega a lista de OS (aba Histórico) e a de Pagamentos/Cobranças.
      // BUGFIX (correcoesbugs.txt #1): 'listarOS' e 'listarCobrancas' nunca
      // existiram no arquivo — a checagem `typeof === 'function'` sempre dava
      // falso e as chamadas eram sempre puladas, sem erro nenhum. A função real
      // que recarrega a tabela de OS é 'carregarHistorico' (linha ~1110); a aba
      // "Cobranças" é a mesma tabela de 'carregarPagamentos' (que já é chamada
      // logo abaixo e cobre tanto pagamentos confirmados quanto cobranças
      // pendentes — ver window.api.cobrancabuscar dentro dessa função).
      if (typeof carregarHistorico === 'function') carregarHistorico($('campoBusca')?.value || '');
      if (typeof carregarPagamentos === 'function') carregarPagamentos();

      console.log('[MP Auto-Poll] Pagamento confirmado pelo backend:', dados);

      // ── Envio automático do WhatsApp de confirmação de pagamento ──────────
      // O backend já registrou o pagamento e atualizou a cobrança.
      // Aqui só precisamos gerar o comprovante PDF e disparar a mensagem.
      const tel = (dados.clienteTel || '').replace(/\D/g, '');
      if (!dados.jaConfirmado && tel && window.api.wappenviarpagconf) {
        try {
          const cfg = (typeof configAtual !== 'undefined' && configAtual?.nomeEmpresa)
            ? configAtual
            : await window.api.configobter().catch(() => ({}));

          const osData = await window.api.osobter(dados.osNumero).catch(() => null);
          const apPag  = osData?.aparelho || {};

          // Gera comprovante PDF para anexar
          let caminhoPdfComprovante = '';
          if (dados.pagamentoId && window.api.paggerarpdfsilencioso) {
            try {
              const rPdf = await window.api.paggerarpdfsilencioso(dados.pagamentoId);
              if (rPdf?.sucesso) caminhoPdfComprovante = rPdf.caminho;
            } catch (ePdf) {
              console.warn('[MP Auto-Poll] Falha ao gerar comprovante PDF:', ePdf.message);
            }
          }

          const rWapp = await window.api.wappenviarpagconf({
            telefone: tel,
            os: {
              nome_cliente: dados.clienteNome || '',
              numero      : dados.osNumero,
              marca       : apPag.marca  || '',
              modelo      : apPag.modelo || '',
              exigir_entrada_50: osData?.exigirEntrada50Aprovacao === true || dados.exigirEntrada50 === true,
              valor_entrada: Number(osData?.valorEntradaAprovacao || dados.valorEntrada || dados.valorPago || 0)
                .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              valor_restante: Number(osData?.valorRestanteServico ?? dados.valorRestante ?? 0)
                .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            },
            config: {
              nomeEmpresa: cfg.nomeEmpresa || 'Assistência Técnica',
              codigoPais : (cfg.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55',
            },
            caminhoPdf: caminhoPdfComprovante,
          });

          if (rWapp?.sucesso) {
            console.log(`[MP Auto-Poll] WhatsApp de confirmação enviado para OS ${dados.osNumero}`);
            if (typeof window.adicionarNotificacao === 'function') {
              window.adicionarNotificacao({
                tipo: 'mensagem_enviada',
                titulo: `WhatsApp enviado — confirmação de pagamento`,
                descricao: `OS ${dados.osNumero} · ${dados.clienteNome || ''}`,
                osNumero: dados.osNumero
              });
            }
          } else {
            console.warn(`[MP Auto-Poll] WhatsApp de confirmação falhou — OS ${dados.osNumero}:`, rWapp?.erro);
            toast(`${ICONE_ALERTA} Pagamento confirmado, mas WhatsApp não foi enviado (OS ${dados.osNumero}): ${rWapp?.erro || 'desconectado'}`, 'aviso');
            if (typeof window.adicionarNotificacao === 'function') {
              window.adicionarNotificacao({
                tipo: 'erro',
                titulo: `WhatsApp não enviado — confirmação de pagamento`,
                descricao: `OS ${dados.osNumero} · ${rWapp?.erro || 'WhatsApp desconectado ou sem resposta.'}`,
                osNumero: dados.osNumero
              });
            }
          }
        } catch (eWapp) {
          console.warn('[MP Auto-Poll] Erro ao enviar WhatsApp de confirmação:', eWapp.message);
          toast(`${ICONE_ALERTA} Pagamento confirmado, mas houve erro ao enviar WhatsApp (OS ${dados.osNumero}): ${eWapp.message}`, 'aviso');
          if (typeof window.adicionarNotificacao === 'function') {
            window.adicionarNotificacao({
              tipo: 'erro',
              titulo: `WhatsApp não enviado — confirmação de pagamento`,
              descricao: `OS ${dados.osNumero} · ${eWapp.message}`,
              osNumero: dados.osNumero
            });
          }
        }
      }
    });
  }

  // ─── Consulta status inicial para atualizar o dot no topo ─────────────────
  (async function consultarStatusInicial() {
    try {
      if (window.api.wappstatus) {
        const r = await window.api.wappstatus();
        if (r?.status && statusDot) {
          statusDot.dataset.status = r.status;
          const btnLabel = document.getElementById('wappBtnLabel');
          if (btnLabel && r.status === 'conectado') btnLabel.innerHTML = `WhatsApp ${ICONE_CHECK}`;
        }
      }
    } catch { /* silencioso */ }
  })();

  // ─── Suporte ao botão fechar padrão do sistema ────────────────────────────
  // O sistema já possui delegação global para data-fechar, então não é necessário
  // adicionar listener extra — apenas garante que o modal tem o atributo correto.

})();

// ── Fim do Módulo WhatsApp ────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO: ABA MENSAGENS WHATSAPP (v28)
// Exibe histórico de mensagens enviadas agrupado por cliente.
// Cada envio (cobrança / pagamento confirmado / entregue) é registrado
// automaticamente no banco; esta aba lê e exibe esses registros.
// ══════════════════════════════════════════════════════════════════════════════

(function () {

  // ── helpers ─────────────────────────────────────────────────────────────────

  const TIPO_LABEL = {
    cobranca            : `${ICONE_CIFRAO} Cobrança`,
    pagamento_confirmado: `${ICONE_CHECK} Pgto Confirmado`,
    entregue            : `${ICONE_CAIXA} Entregue`,
    pronto_retirada     : `${ICONE_CAIXA} Pronto Retirada`,
    manual              : `${ICONE_ENVELOPE} Manual`,
  };

  const TIPO_COR = {
    cobranca            : '#f0a500',
    pagamento_confirmado: '#25d366',
    entregue            : '#4a90d9',
    pronto_retirada     : '#16a34a',
    manual              : '#888',
  };

  function fmtDataHoraMensagem(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  // ── estado ──────────────────────────────────────────────────────────────────

  let _gruposAtual   = [];  // lista de grupos (por cliente)
  let _clienteAtivo  = null; // telefone do cliente selecionado

  // ── elementos DOM (acessados tarde para garantir que existem) ───────────────

  function el(id) { return document.getElementById(id); }

  // ── renderizar lista de clientes ────────────────────────────────────────────

  function renderListaClientes(grupos) {
    const lista = el('mensagensClientesLista');
    if (!lista) return;

    if (!grupos || grupos.length === 0) {
      lista.innerHTML = '<div class="vazio" style="padding:24px 12px;text-align:center;color:var(--texto-sec);">Nenhuma mensagem enviada ainda.</div>';
      return;
    }

    lista.innerHTML = grupos.map(g => {
      const ativo   = g.telefone === _clienteAtivo ? 'style="background:var(--fundo-hover,rgba(37,211,102,.12));"' : '';
      const temErro = g.totalErro > 0;
      const badge   = temErro
        ? `<span style="background:#991b1b;color:#fff;border-radius:10px;padding:1px 6px;font-size:11px;font-weight:700;">${g.totalErro} ${ICONE_X}</span>`
        : `<span style="color:#25d366;font-size:11px;">${g.totalEnviado} ${ICONE_CHECK}</span>`;

      return `<div class="mensagem-cliente-item" data-tel="${g.telefone}"
          ${ativo}
          style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--borda);transition:background .15s;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <span style="display:flex;align-items:center;gap:4px;overflow:hidden;flex:1;min-width:0;">
            <span style="font-weight:600;font-size:13px;color:var(--texto);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;">${g.clienteNome || 'Sem nome'}</span>
            <button type="button" class="botao-editar-nome-cliente-msg" title="Editar nome do cliente"
              data-tel-editar="${g.telefone}" data-nome-atual="${(g.clienteNome || '').replace(/"/g,'&quot;')}"
              style="border:none;background:transparent;cursor:pointer;font-size:12px;opacity:0.6;padding:2px 4px;line-height:1;flex-shrink:0;">${ICONE_LAPIS}</button>
            <button type="button" class="botao-excluir-contato-msg" title="Excluir todas as mensagens deste contato"
              data-tel-excluir="${g.telefone}" data-nome-contato="${(g.clienteNome || '').replace(/"/g,'&quot;')}"
              style="border:none;background:transparent;cursor:pointer;font-size:12px;opacity:0.5;padding:2px 4px;line-height:1;flex-shrink:0;color:#e55;">${ICONE_LIXEIRA}</button>
          </span>
          ${badge}
        </div>
        <div style="font-size:11px;color:var(--texto-sec);margin-top:2px;">${g.telefone || '—'}</div>
        <div style="font-size:10px;color:var(--texto-sec);margin-top:1px;">${fmtDataHoraMensagem(g.ultimaData)}</div>
      </div>`;
    }).join('');

    // eventos de clique
    lista.querySelectorAll('.mensagem-cliente-item').forEach(item => {
      item.addEventListener('click', () => {
        _clienteAtivo = item.dataset.tel;
        renderListaClientes(_gruposAtual); // re-render para destacar ativo
        const grupo = _gruposAtual.find(g => g.telefone === _clienteAtivo);
        if (grupo) renderConversa(grupo);
      });
    });

    // Lápis de editar nome direto na lista lateral — precisa de
    // stopPropagation para não disparar também o clique do card pai.
    lista.querySelectorAll('.botao-editar-nome-cliente-msg').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const telefone  = btn.dataset.telEditar;
        const nomeAtual = btn.dataset.nomeAtual || '';
        const novoNome  = await promptModal('Nome do cliente:', nomeAtual);
        if (novoNome === null || novoNome === undefined) return; // cancelado
        const nomeLimpo = novoNome.trim();
        if (!nomeLimpo) { toast('O nome não pode ficar vazio.', 'erro'); return; }
        try {
          await window.api.wapplogatualizarnomecliente(telefone, nomeLimpo);
          toast('Nome do cliente atualizado!', 'sucesso');
          carregarMensagensWapp();
          if (typeof carregarConversas === 'function') carregarConversas();
        } catch (e) {
          toast('Erro ao atualizar nome: ' + e.message, 'erro');
        }
      });
    });

    // Botão de excluir todas as mensagens de um contato — confirmação
    // antes de apagar, e recarrega a lista depois da exclusão.
    lista.querySelectorAll('.botao-excluir-contato-msg').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const telefone  = btn.dataset.telExcluir;
        const nomeContato = btn.dataset.nomeContato || 'este contato';
        if (!telefone) return;
        const confirmou = confirm(`Excluir todo o histórico de mensagens de ${nomeContato} (${telefone})?\n\nEsta ação não pode ser desfeita.`);
        if (!confirmou) return;
        try {
          const r = await window.api.wapplogexcluirporelefone(telefone, usuarioAtual?.id);
          if (r && r.sucesso) {
            toast(`${r.excluidas} mensagem(ns) excluída(s) de ${nomeContato}.`, 'sucesso');
            if (_clienteAtivo === telefone) {
              _clienteAtivo = null;
              const listaEl = el('mensagensConversaLista');
              if (listaEl) listaEl.innerHTML = '<div class="vazio" style="margin:auto;color:var(--texto-sec);">← Selecione um cliente para ver o histórico</div>';
              const nomeEl = el('mensagensConversaNome');
              if (nomeEl) nomeEl.textContent = 'Selecione um cliente';
            }
            carregarMensagensWapp();
            if (typeof carregarConversas === 'function') carregarConversas();
          } else {
            toast('Nenhuma mensagem encontrada para este contato.', 'erro');
          }
        } catch (e) {
          toast('Erro ao excluir: ' + e.message, 'erro');
        }
      });
    });
  }

  // ── renderizar conversa de um cliente ────────────────────────────────────────
  // v40: aceita um segundo argumento opcional com ids alternativos, para que a
  // aba Conversas reaproveite esta mesma função ao abrir o modal de histórico
  // completo, sem duplicar a lógica de render. Sem esse argumento, o
  // comportamento é idêntico ao original (aba Mensagens).

  function renderConversa(grupo, ids) {
    const idNome  = (ids && ids.nome)  || 'mensagensConversaNome';
    const idTel   = (ids && ids.tel)   || 'mensagensConversaTel';
    const idLista = (ids && ids.lista) || 'mensagensConversaLista';

    const nomeEl  = el(idNome);
    const telEl   = el(idTel);
    const listaEl = el(idLista);
    if (!nomeEl || !listaEl) return;

    nomeEl.textContent = grupo.clienteNome || 'Sem nome';
    if (telEl) telEl.textContent = grupo.telefone || '';

    // Lápis de editar nome do cliente — reaproveitado pela aba Mensagens e
    // pelo modal da aba Conversas (mesma função renderConversa). Grava por
    // TELEFONE em todos os lugares (log de mensagens + OS), então editar
    // aqui também atualiza o nome mostrado na outra tela.
    let lapisEl = nomeEl.parentElement?.querySelector('.botao-editar-nome-conversa');
    if (!lapisEl && nomeEl.parentElement) {
      lapisEl = document.createElement('button');
      lapisEl.type = 'button';
      lapisEl.className = 'botao-editar-nome-conversa';
      lapisEl.title = 'Editar nome do cliente';
      lapisEl.innerHTML = `${ICONE_LAPIS}`;
      lapisEl.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:13px;opacity:0.65;padding:2px 4px;line-height:1;';
      nomeEl.insertAdjacentElement('afterend', lapisEl);
    }
    if (lapisEl) {
      lapisEl.style.display = grupo.telefone ? '' : 'none';
      lapisEl.onclick = async (ev) => {
        ev.stopPropagation();
        const nomeAtual = (grupo.clienteNome && grupo.clienteNome !== 'Sem nome') ? grupo.clienteNome : '';
        const novoNome = await promptModal('Nome do cliente:', nomeAtual);
        if (novoNome === null || novoNome === undefined) return; // cancelado
        const nomeLimpo = novoNome.trim();
        if (!nomeLimpo) { toast('O nome não pode ficar vazio.', 'erro'); return; }
        try {
          await window.api.wapplogatualizarnomecliente(grupo.telefone, nomeLimpo);
          grupo.clienteNome = nomeLimpo;
          nomeEl.textContent = nomeLimpo;
          toast('Nome do cliente atualizado!', 'sucesso');
          // atualiza também a lista lateral da aba Mensagens, se existir
          if (typeof window.carregarMensagensWapp === 'function') window.carregarMensagensWapp();
          if (typeof carregarConversas === 'function') carregarConversas();
        } catch (e) {
          toast('Erro ao atualizar nome: ' + e.message, 'erro');
        }
      };
    }

    if (!grupo.mensagens || grupo.mensagens.length === 0) {
      listaEl.innerHTML = '<div class="vazio" style="margin:auto;color:var(--texto-sec);">Sem mensagens.</div>';
      return;
    }

    // ordenar cronologicamente (mais antiga primeiro — estilo chat)
    const ordenadas = [...grupo.mensagens].sort((a, b) => new Date(a.data) - new Date(b.data));

    listaEl.innerHTML = ordenadas.map(m => {
      const cor     = TIPO_COR[m.tipo]  || '#888';
      const label   = TIPO_LABEL[m.tipo] || m.tipo;
      const statusEnvio = m.statusEnvio || (m.sucesso ? 'aceito-servidor' : 'erro');
      const enviadoAoServidor = statusEnvio === 'aceito-servidor';
      const statusIcon = enviadoAoServidor ? `${ICONE_CHECK}` : `${ICONE_X}`;
      const statusCor  = enviadoAoServidor ? '#25d366' : '#e55';
      const statusTexto = enviadoAoServidor ? 'Aceito pelo servidor' : 'Erro';
      const osTag   = m.osNumero ? `<span style="background:var(--borda);border-radius:4px;padding:1px 6px;font-size:11px;">${m.osNumero}</span>` : '';
      const erroBloq = !m.sucesso && m.erro
        ? `<div style="margin-top:6px;padding:6px 8px;background:rgba(229,85,85,.1);border-left:3px solid #e55;border-radius:4px;font-size:12px;color:#e55;">${ICONE_ALERTA} ${_escHtml(m.erro)}</div>`
        : '';
      const preview = (m.mensagem || '').length > 180
        ? m.mensagem.slice(0, 180) + '…'
        : m.mensagem;

      return `<div style="border:1px solid var(--borda);border-radius:8px;padding:10px 14px;background:var(--card-bg,var(--fundo));position:relative;" data-msg-id="${m.id || ''}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
          <span style="background:${cor};color:#fff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;">${label}</span>
          ${osTag}
          <span style="margin-left:auto;font-size:12px;color:${statusCor};font-weight:700;">${statusIcon} ${statusTexto}</span>
          <button type="button" class="botao-excluir-mensagem" title="Excluir mensagem" data-excluir-msg="${m.id || ''}"
            style="border:none;background:transparent;cursor:pointer;font-size:12px;opacity:0.55;padding:2px 4px;line-height:1;">${ICONE_LIXEIRA}</button>
        </div>
        <div style="font-size:12px;color:var(--texto-sec);white-space:pre-wrap;line-height:1.5;margin-bottom:4px;">${preview}</div>
        ${erroBloq}
        <div style="font-size:11px;color:var(--texto-sec);margin-top:4px;">${fmtDataHoraMensagem(m.data)}</div>
      </div>`;
    }).join('');

    // scroll para o fundo (mensagem mais recente)
    setTimeout(() => { listaEl.scrollTop = listaEl.scrollHeight; }, 50);

    // Botão de excluir mensagem — remove só aquele registro do histórico,
    // pede confirmação (ação destrutiva, mesmo padrão usado em outras
    // exclusões do sistema) e recarrega a conversa in-place.
    listaEl.querySelectorAll('.botao-excluir-mensagem').forEach(btn => {
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const id = btn.dataset.excluirMsg;
        if (!id) return;
        if (!confirm('Excluir esta mensagem do histórico? Essa ação não pode ser desfeita.')) return;
        try {
          const r = await window.api.wapplogexcluirmensagem(id, usuarioAtual?.id);
          if (!r.sucesso) { toast('Erro ao excluir: ' + r.erro, 'erro'); return; }
          toast('Mensagem excluída.', 'sucesso');
          grupo.mensagens = (grupo.mensagens || []).filter(msg => msg.id !== id);
          renderConversa(grupo, ids);
          if (typeof window.carregarMensagensWapp === 'function') window.carregarMensagensWapp();
          if (typeof carregarConversas === 'function') carregarConversas();
        } catch (e) {
          toast('Erro ao excluir mensagem: ' + e.message, 'erro');
        }
      };
    });
  }

  // Expostos para o módulo da aba Conversas (v40) reaproveitar sem duplicar.
  window._wappConversaShared = { renderConversa, TIPO_COR, TIPO_LABEL, fmtDataHoraMensagem };

  // ── atualizar rodapé ─────────────────────────────────────────────────────────

  function atualizarRodape(grupos) {
    const totalClientes = grupos.length;
    const totalEnvios   = grupos.reduce((s, g) => s + g.totalEnviado, 0);
    const totalErros    = grupos.reduce((s, g) => s + g.totalErro, 0);

    const elC = el('mensagensTotalClientes');
    const elE = el('mensagensTotalEnvios');
    const elR = el('mensagensTotalErros');

    if (elC) elC.textContent = `${totalClientes} cliente${totalClientes !== 1 ? 's' : ''}`;
    if (elE) elE.textContent = `${totalEnvios} mensage${totalEnvios !== 1 ? 'ns' : 'm'} enviada${totalEnvios !== 1 ? 's' : ''}`;
    if (elR) elR.textContent = `${totalErros} erro${totalErros !== 1 ? 's' : ''}`;
  }

  // ── carregarMensagensWapp (chamada pela troca de aba e pela busca) ───────────

  window.carregarMensagensWapp = async function (query) {
    try {
      const q = query !== undefined ? query : (el('campoBuscaMensagens')?.value || '');
      const grupos = await window.api.wapplogporcliente(q);
      _gruposAtual = grupos || [];

      renderListaClientes(_gruposAtual);
      atualizarRodape(_gruposAtual);

      // se havia cliente ativo, re-renderiza conversa dele (caso haja atualização)
      if (_clienteAtivo) {
        const grupo = _gruposAtual.find(g => g.telefone === _clienteAtivo);
        if (grupo) renderConversa(grupo);
        else {
          // cliente sumiu do filtro — limpar conversa
          const listaEl = el('mensagensConversaLista');
          if (listaEl) listaEl.innerHTML = '<div class="vazio" style="margin:auto;color:var(--texto-sec);">← Selecione um cliente para ver o histórico</div>';
          const nomeEl = el('mensagensConversaNome');
          if (nomeEl) nomeEl.textContent = 'Selecione um cliente';
        }
      }
    } catch (e) {
      console.error('[MensagensWapp] Erro ao carregar:', e.message);
      const lista = el('mensagensClientesLista');
      if (lista) lista.innerHTML = '<div class="vazio" style="padding:16px;color:#e55;">Erro ao carregar histórico.</div>';
    }
  };

  // ── debounce busca ───────────────────────────────────────────────────────────

  let _debMensagens;
  const campoBuscaMensagens = document.getElementById('campoBuscaMensagens');
  if (campoBuscaMensagens) {
    campoBuscaMensagens.addEventListener('input', e => {
      clearTimeout(_debMensagens);
      _debMensagens = setTimeout(() => carregarMensagensWapp(e.target.value), 300);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // v40.2 — ABA LOG IA: classificação automática (Groq) da forma de pagamento
  // manual. Lista o histórico de classificações, mostra se cada uma veio da
  // IA ou do fallback por palavras-chave, e permite testar a chave da Groq
  // direto na tela de Configurações.
  // ══════════════════════════════════════════════════════════════════════════

  // Escape defensivo: o texto exibido aqui vem de mensagens digitadas por
  // clientes no WhatsApp (conteúdo não confiável). Nunca inserir cru via
  // innerHTML, para não abrir brecha de HTML/script injection na tela.
  function _escapeHtmlLogIA(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _badgeOrigemLogIA(origem) {
    const mapa = {
      ia:              { texto: 'Por IA', bg: '#dcfce7', cor: '#15803d' },
      fallback_regras: { texto: 'Fallback por regras', bg: '#fef3c7', cor: '#b45309' },
      fallback_erro:   { texto: 'Fallback por erro', bg: '#fee2e2', cor: '#b91c1c' },
    };
    const origemTexto = String(origem || '').trim();
    const origemLegadaComSvg = /<svg\b|<\/svg>/i.test(origemTexto);
    const cfg = mapa[origemTexto] || {
      texto: origemLegadaComSvg ? 'Classificação automática' : (origemTexto || '—'),
      bg: '#e5e7eb',
      cor: '#374151'
    };
    return `<span class="status-badge" style="background:${cfg.bg};color:${cfg.cor};">${_escapeHtmlLogIA(cfg.texto)}</span>`;
  }

  window.carregarLogIA = async function (query) {
    const corpo = document.getElementById('corpoTabelaLogIA');
    const painelContadores = document.getElementById('logIaContadores');
    if (!corpo) return;

    try {
      const [logs, contadores] = await Promise.all([
        query ? window.api.ialogbuscar(query) : window.api.ialoglistar(),
        window.api.ialogcontadores()
      ]);

      if (painelContadores) {
        const cartao = (label, valor, cor) => `
          <div class="painel-card" style="border-left:3px solid ${cor};">
            <div style="font-size:20px;font-weight:800;color:${cor};">${valor}</div>
            <div class="label" style="color:var(--texto-sec);">${_escapeHtmlLogIA(label)}</div>
          </div>`;
        painelContadores.innerHTML =
          cartao('Total de classificações', contadores.total, '#6366f1') +
          cartao('Classificadas pela IA', contadores.porIA, '#15803d') +
          cartao('Fallback (regras)', contadores.porFallbackRegras, '#b45309') +
          cartao('Fallback (erro na IA)', contadores.porFallbackErro, '#b91c1c');
      }

      if (!logs || logs.length === 0) {
        corpo.innerHTML = `<tr><td colspan="7" class="vazio">${query ? 'Nenhum resultado encontrado.' : 'Nenhuma classificação registrada ainda. Assim que um cliente escolher pagamento manual e digitar como vai pagar, o registro aparece aqui.'}</td></tr>`;
        return;
      }

      corpo.innerHTML = logs.map(l => `
        <tr>
          <td style="white-space:nowrap;font-size:12px;">${fmtDataHora(l.data)}</td>
          <td style="white-space:nowrap;">${_escapeHtmlLogIA(l.osNumero) || '—'}</td>
          <td>${_escapeHtmlLogIA(l.clienteNome) || '—'}</td>
          <td style="max-width:280px;white-space:normal;word-break:break-word;font-size:12.5px;color:var(--texto-sec);">${_escapeHtmlLogIA(l.textoOriginal) || '—'}</td>
          <td style="font-weight:600;">${_escapeHtmlLogIA(l.rotulo) || '—'}</td>
          <td>${_badgeOrigemLogIA(l.origem)}</td>
          <td style="white-space:nowrap;font-size:12px;color:var(--texto-sec);" title="${l.motivoFallback ? _escapeHtmlLogIA(l.motivoFallback) : ''}">${l.tempoRespostaMs != null ? l.tempoRespostaMs + 'ms' : '—'}</td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('Erro ao carregar log de IA:', e);
      corpo.innerHTML = `<tr><td colspan="7" class="vazio">Erro ao carregar: ${_escapeHtmlLogIA(e.message)}</td></tr>`;
    }
  };

  let _debLogIA;
  const campoBuscaLogIA = document.getElementById('logIaBusca');
  if (campoBuscaLogIA) {
    campoBuscaLogIA.addEventListener('input', e => {
      clearTimeout(_debLogIA);
      _debLogIA = setTimeout(() => carregarLogIA(e.target.value), 300);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ABA: ENTREGAS (App Celular — comprovante de retirada + garantia)
  // ═══════════════════════════════════════════════════════════════
  // Ver PROMPT-PC-aba-entregas.md. Só leitura/listagem: comprovantes
  // chegam exclusivamente pela importação de Lote do Celular
  // (Configurações → Importar Lote do Celular). Nenhuma criação/edição
  // manual aqui.

  // Escape defensivo: nomeRetirou/marca/modelo/reparoRealizado vêm de
  // texto livre digitado no celular (conteúdo não confiável do ponto de
  // vista do PC) — nunca inserir cru via innerHTML. Mesmo padrão já usado
  // em _escapeHtmlLogIA logo acima.
  function _escapeHtmlEntregas(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Só a data (sem hora) — mesmo critério usado no PDF (ver
  // entrega-template.js, formatarDataSimples) para "VÁLIDA ATÉ": a hora
  // exata do limite de garantia não é relevante para o usuário do PC.
  function _fmtDataSimplesEntregas(iso) {
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso || ''; }
  }

  // Mesmo critério de omissão condicional usado no PDF e na spec: só
  // mostra a linha de garantia se garantiaDias > 0. Comprovantes antigos
  // (sem o campo, ou com garantiaDias:0) simplesmente não mostram nada,
  // em vez de "Garantia: 0 dias".
  function _garantiaHtmlEntregas(en) {
    const dias = Number(en.garantiaDias) || 0;
    if (dias <= 0) return '<span style="color:var(--texto-sec);">—</span>';
    const validaAte = en.dataLimiteGarantia ? _fmtDataSimplesEntregas(en.dataLimiteGarantia) : '—';
    return `<span class="status-badge" style="background:#dcfce7;color:#15803d;">${ICONE_ESCUDO} ${dias} dias — até ${validaAte}</span>`;
  }

  // Badge indicando se o numeroOS gravado na entrega corresponde a uma OS
  // que realmente existe no sistema hoje. Uma entrega pode chegar do
  // celular referenciando uma OS que nunca foi importada no PC, ou que
  // foi excluída depois — nesses casos o comprovante fica "órfão"
  // (documento válido, mas sem OS para abrir a partir dele).
  function _statusAtreladoHtmlEntregas(numeroOS, numerosOSExistentes) {
    const existe = numerosOSExistentes.has(String(numeroOS || '').trim());
    return existe
      ? `<span class="status-badge" style="background:#dcfce7;color:#15803d;">${ICONE_CHECK} Atrelada</span>`
      : `<span class="status-badge" style="background:#fef3c7;color:#b45309;">${ICONE_ALERTA} Não atrelada</span>`;
  }

  function _statusAssinaturaHtmlEntregas(en) {
    if (en.assinaturaRetirouBase64) {
      return `<span class="status-badge" style="background:#dcfce7;color:#15803d;">${ICONE_CHECK} Assinado</span>`;
    }
    if (en.assinaturaPendente === true) {
      return `<span class="status-badge" style="background:#fef3c7;color:#b45309;">${ICONE_RELOGIO} Aguardando assinatura</span>`;
    }
    return `<span class="status-badge" style="background:#fee2e2;color:#b91c1c;">${ICONE_ALERTA} Não assinado</span>`;
  }

  function _rotuloCicloEntrega(en) {
    return en.tipoEntrega === 'retorno_garantia' || en.retornoGarantiaId
      ? 'Entrega da garantia'
      : 'Entrega original';
  }

  window.carregarEntregas = async function (query) {
    const corpo = document.getElementById('corpoTabelaEntregas');
    if (!corpo) return;
    corpo.innerHTML = '<tr><td colspan="6" class="vazio">Carregando...</td></tr>';

    try {
      const [todas, todasOS] = await Promise.all([
        window.api.entregalistar(),
        window.api.oslistar(),
      ]);
      const numerosOSExistentes = new Set(todasOS.map(os => String(os.numero || '').trim()));
      const termo = (query || '').trim().toLowerCase();
      const entregas = termo
        ? todas.filter(en =>
            String(en.numeroOS || '').toLowerCase().includes(termo) ||
            String(en.nomeRetirou || '').toLowerCase().includes(termo) ||
            String(en.clienteId || en.clienteNumero || '').includes(termo.replace(/\D/g, '')))
        : todas;

      if (!entregas || entregas.length === 0) {
        corpo.innerHTML = `<tr><td colspan="6" class="vazio">${
          termo
            ? 'Nenhum resultado encontrado.'
            : 'Nenhum comprovante de entrega importado ainda. Importe um lote do celular em Configurações → Importar Lote do Celular.'
        }</td></tr>`;
        return;
      }

      corpo.innerHTML = entregas.map(en => `
        <tr>
          <td style="white-space:nowrap;font-weight:600;">${_escapeHtmlEntregas(en.numeroOS) || '—'}<br><small style="color:var(--texto-sec);font-weight:600;">${_rotuloCicloEntrega(en)}</small></td>
          <td>${_escapeHtmlEntregas(en.nomeRetirou) || '—'}</td>
          <td style="white-space:nowrap;font-size:12px;color:var(--texto-sec);">${fmtDataHora(en.dataHoraAssinatura)}</td>
          <td>${_garantiaHtmlEntregas(en)}</td>
          <td style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            ${_statusAtreladoHtmlEntregas(en.numeroOS, numerosOSExistentes)}
            ${_statusAssinaturaHtmlEntregas(en)}
          </td>
          <td style="white-space:nowrap;">
            <button class="botao botao-xs botao-secundario" onclick="editarEntregaUI('${_escapeHtmlEntregas(en.numeroOS)}','${encodeURIComponent(en.cicloEntregaId || 'original')}')">${ICONE_DOCUMENTO} Editar entrega</button>
            <button class="botao botao-xs" onclick="abrirPdfEntregaUI('${_escapeHtmlEntregas(en.numeroOS)}','${encodeURIComponent(en.cicloEntregaId || 'original')}')">${ICONE_DOCUMENTO} ${en.pdfPath ? 'Ver PDF' : 'Gerar/Ver PDF'}</button>
            <button class="botao botao-xs botao-secundario" onclick="imprimirEntregaTermicaUI('${_escapeHtmlEntregas(en.numeroOS)}')">${ICONE_DOCUMENTO} Imprimir 2 vias</button>
            <button class="botao botao-xs botao-perigo" onclick="excluirEntregaUI('${_escapeHtmlEntregas(en.numeroOS)}','${encodeURIComponent(en.cicloEntregaId || 'original')}')">${ICONE_LIXEIRA} Excluir</button>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('Erro ao carregar entregas:', e);
      corpo.innerHTML = `<tr><td colspan="6" class="vazio">Erro ao carregar: ${_escapeHtmlEntregas(e.message)}</td></tr>`;
    }
  };

  // Abre o PDF já gerado na importação. Se por algum motivo o arquivo não
  // existir mais em disco (ex.: apagado manualmente, pasta movida), tenta
  // regenerar antes de desistir — mesmo espírito de resiliência de
  // gerarPdfCompraUI, mas sem forçar regeneração a cada clique (o PDF de
  // entrega não muda depois de importado, ao contrário de OS/Compra/Venda
  // que podem ser editadas no PC).
  window.abrirPdfEntregaUI = async function (numeroOS, cicloCodificado) {
    try {
      const ciclo = cicloCodificado ? decodeURIComponent(cicloCodificado) : undefined;
      const en = await window.api.entregaobterporos(numeroOS, ciclo);
      if (!en) { toast('Comprovante não encontrado.', 'erro'); return; }
      let caminho = en.pdfPath;
      try {
        await window.api.entregaabrirpdf(caminho);
      } catch (err) {
        // Arquivo ausente em disco — regenera uma vez e tenta abrir de novo.
        toast('Regenerando PDF...', 'info');
        caminho = await window.api.entregagerarpdf(numeroOS, ciclo);
        await window.api.entregaabrirpdf(caminho);
      }
    } catch (err) {
      toast('Erro ao abrir PDF: ' + err.message, 'erro');
    }
  };

  window.imprimirEntregaTermicaUI = async function (numeroOS) {
    const osAtual = await window.api.osobter(numeroOS).catch(() => null);
    const dadosEntrega = await solicitarNomeRecebedorComprovante(numeroOS, osAtual);
    if (!dadosEntrega) return;
    const formato = await escolherOpcaoModal({
      titulo: 'Imprimir comprovante de entrega em 2 vias',
      alternativas: [
        { valor: '1', titulo: 'Bobina 80 mm', descricao: 'Mais espaço e melhor leitura.' },
        { valor: '2', titulo: 'Bobina 58 mm', descricao: 'Formato compacto.' }
      ]
    });
    if (formato === null) return;
    try {
      await window.api.osimprimircomprovante(numeroOS, String(formato).trim() === '2' ? '58mm' : '80mm', undefined, 2, dadosEntrega);
      toast('Duas vias do comprovante de entrega foram enviadas para impressão.', 'sucesso');
    } catch (erro) {
      toast('Não foi possível imprimir: ' + (erro?.message || erro), 'erro');
    }
  };

  window.excluirEntregaUI = async function (numeroOS, cicloCodificado) {
    if (!numeroOS) return;
    const ciclo = cicloCodificado ? decodeURIComponent(cicloCodificado) : undefined;
    const confirmou = confirm(`Excluir ${ciclo === 'original' ? 'a entrega original' : 'este comprovante de entrega'} da OS ${numeroOS}?\n\nEsta ação não pode ser desfeita.`);
    if (!confirmou) return;
    try {
      const r = await window.api.entregaexcluir(numeroOS, usuarioAtual?.id, ciclo);
      if (r && r.sucesso) {
        toast(`Entrega da OS ${numeroOS} excluída.`, 'sucesso');
        carregarEntregas();
      } else {
        toast(r?.erro || 'Nenhuma entrega encontrada.', 'erro');
      }
    } catch (e) {
      toast('Erro ao excluir entrega: ' + e.message, 'erro');
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // SUB-ABA: NOVA ENTREGA (Bloco 3 — cria pendente no PC, assina no
  // celular). Mesmo padrão de sub-navegação de trocarTabEstoque.
  // ═══════════════════════════════════════════════════════════════
  window.trocarTabEntregas = function (tab) {
    const s1 = $('subaba-entregas-comprovantes');
    const b1 = $('tabEntregasComprovantes');
    const s2 = $('subaba-entregas-nova');
    const b2 = $('tabEntregasNova');
    if (s1) s1.classList.toggle('escondido', tab !== 'comprovantes');
    if (b1) b1.classList.toggle('ativa', tab === 'comprovantes');
    if (s2) s2.classList.toggle('escondido', tab !== 'nova');
    if (b2) b2.classList.toggle('ativa', tab === 'nova');
    if (tab === 'nova') window.carregarEntregasPendentes();
  };

  let _entregaEmEdicao = null;
  const acoesEditarEntrega = document.createElement('div');
  acoesEditarEntrega.className = 'acoes-formulario';
  acoesEditarEntrega.id = 'acoesEditarEntrega';
  acoesEditarEntrega.hidden = true;
  acoesEditarEntrega.innerHTML = '<div class="campo"><label for="entregaEditarEstado">Assinatura do comprovante</label><select id="entregaEditarEstado"><option value="manter">Manter estado atual</option><option value="nao_assinado">Não assinado</option><option value="pendente">Aguardando assinatura</option></select></div><button class="botao botao-primario" id="btnSalvarEdicaoEntrega" type="button">Salvar alterações da entrega</button>';
  $('btnNovaEntregaLimpar')?.parentElement?.before(acoesEditarEntrega);
  $('btnSalvarEdicaoEntrega')?.addEventListener('click', async () => {
    if (!_entregaEmEdicao) return;
    const dados = _coletarDadosNovaEntrega();
    dados.estadoAssinatura = $('entregaEditarEstado').value;
    if (_entregaEmEdicao.assinaturaRetirouBase64) {
      if (!confirm('Se os dados forem alterados, a assinatura anterior será retirada deste comprovante. Será necessário assinar a versão corrigida. Salvar?')) return;
      dados.confirmarNovaAssinatura = true;
    }
    const btn = $('btnSalvarEdicaoEntrega');
    btn.disabled = true;
    try {
      await window.api.entregaeditar(_entregaEmEdicao.numeroOS, dados, _entregaEmEdicao.cicloEntregaId || 'original');
      toast('Entrega atualizada. A garantia acompanha o prazo informado.', 'sucesso');
      window.limparFormNovaEntrega();
      window.trocarTabEntregas('comprovantes');
      await window.carregarEntregas();
      await window.carregarGarantias();
    } catch (erro) { toast(erro.message, 'erro'); }
    finally { btn.disabled = false; }
  });
  window.editarEntregaUI = async function (numeroOS, cicloCodificado) {
    const ciclo = cicloCodificado ? decodeURIComponent(cicloCodificado) : undefined;
    const entrega = await window.api.entregaobterporos(numeroOS, ciclo);
    if (!entrega) { toast('Entrega não encontrada.', 'erro'); return; }
    document.querySelector('[data-aba="entregas"]')?.click();
    window.trocarTabEntregas('nova');
    await window.buscarOSParaNovaEntrega(numeroOS);
    _entregaEmEdicao = entrega;
    const campos = { NomeRetirou: 'nomeRetirou', CpfRetirou: 'cpfRetirou', TelefoneRetirou: 'telefoneRetirou', Marca: 'marca', Modelo: 'modelo', ReparoRealizado: 'reparoRealizado', ValorReparo: 'valorReparo', FormaPagamento: 'formaPagamento', GarantiaDias: 'garantiaDias' };
    Object.entries(campos).forEach(([id, campo]) => { $('novaEntrega' + id).value = entrega[campo] ?? ''; });
    $('novaEntregaData').value = String(entrega.dataHoraAssinatura || '').slice(0, 10);
    $('novaEntregaGarantiaInicio').value = String(entrega.garantiaDataInicio || entrega.dataHoraAssinatura || '').slice(0, 10);
    $('novaEntregaMsgBusca').textContent = `Editando ${_rotuloCicloEntrega(entrega).toLowerCase()} da ${numeroOS}. O documento anterior continuará preservado.`;
    $('entregaEditarEstado').value = entrega.assinaturaRetirouBase64 ? 'manter' : entrega.assinaturaPendente ? 'pendente' : 'nao_assinado';
    acoesEditarEntrega.hidden = false;
    $('novaEntregaNomeRetirou').focus();
  };

  window.abrirBuscaOSParaNovaEntrega = function () {
    window.abrirBuscaOSGenerico('entrega');
  };

  // Preenche o formulário a partir da OS buscada. Se já existir uma
  // pendente para essa OS, carrega os campos dela em vez dos defaults
  // da OS (mesmo padrão de garantiaExistente em buscarOSParaGarantia).
  window.buscarOSParaNovaEntrega = async function (numeroOS) {
    _entregaEmEdicao = null;
    acoesEditarEntrega.hidden = true;
    const msg = $('novaEntregaMsgBusca');
    if (msg) msg.textContent = '';
    if (!numeroOS) return;

    try {
      const [osEncontrada, garantiaExistente] = await Promise.all([
        window.api.entregabuscaros(numeroOS),
        window.api.garantiaobterporos(numeroOS).catch(() => null)
      ]);
      if (!osEncontrada) {
        if (msg) { msg.style.color = 'var(--erro, #dc2626)'; msg.textContent = `OS ${numeroOS} não encontrada.`; }
        return;
      }
      $('novaEntregaNumeroOS').value = numeroOS.replace(/^OS-0*/, '') || '0';
      $('novaEntregaNumeroOS').dataset.numeroCompleto = numeroOS;
      $('novaEntregaNomeRetirou').value = osEncontrada?.cliente?.nome || '';
      $('novaEntregaCpfRetirou').value = osEncontrada?.cliente?.cpf || '';
      $('novaEntregaTelefoneRetirou').value = osEncontrada?.cliente?.telefone || '';
      $('novaEntregaMarca').value = osEncontrada?.aparelho?.marca || '';
      $('novaEntregaModelo').value = osEncontrada?.aparelho?.modelo || '';
      $('novaEntregaReparoRealizado').value = osEncontrada?.diagnosticoTecnico?.solucao || osEncontrada?.servicoRealizado || osEncontrada?.observacoesSaida || '';
      $('novaEntregaValorReparo').value = Number(osEncontrada?.valorTotalServico || osEncontrada?.diagnosticoTecnico?.valorEstimado || 0) || '';
      $('novaEntregaFormaPagamento').value = osEncontrada?.formaPagamento || osEncontrada?.pagamentoForma || '';
      const garantiaDiasHerdados = Number(garantiaExistente?.garantiaDias || osEncontrada?.garantiaDias || 0) || 0;
      $('novaEntregaGarantiaDias').value = garantiaDiasHerdados > 0 ? garantiaDiasHerdados : '';
      $('novaEntregaData').value = new Date().toLocaleDateString('en-CA');
      $('novaEntregaGarantiaInicio').value = String(garantiaExistente?.dataInicio || '').slice(0, 10) || $('novaEntregaData').value;

      const pendente = await window.api.entregaobterpendenteporos(numeroOS);
      if (pendente) {
        $('novaEntregaNomeRetirou').value = pendente.nomeRetirou || $('novaEntregaNomeRetirou').value;
        $('novaEntregaCpfRetirou').value = pendente.cpfRetirou || $('novaEntregaCpfRetirou').value;
        $('novaEntregaTelefoneRetirou').value = pendente.telefoneRetirou || $('novaEntregaTelefoneRetirou').value;
        $('novaEntregaMarca').value = pendente.marca || $('novaEntregaMarca').value;
        $('novaEntregaModelo').value = pendente.modelo || $('novaEntregaModelo').value;
        $('novaEntregaReparoRealizado').value = pendente.reparoRealizado || $('novaEntregaReparoRealizado').value;
        $('novaEntregaValorReparo').value = Number(pendente.valorReparo || $('novaEntregaValorReparo').value || 0) || '';
        $('novaEntregaFormaPagamento').value = pendente.formaPagamento || $('novaEntregaFormaPagamento').value;
        if (Number(pendente.garantiaDias) > 0 || garantiaDiasHerdados <= 0) {
          $('novaEntregaGarantiaDias').value = Number(pendente.garantiaDias) > 0 ? pendente.garantiaDias : '';
        }
        if (pendente.garantiaDataInicio) $('novaEntregaGarantiaInicio').value = String(pendente.garantiaDataInicio).slice(0, 10);
        if (msg) {
          msg.style.color = 'var(--texto-sec)';
          msg.textContent = `Dados da OS carregados. Já existe uma pendente de assinatura para esta OS — gerar novamente vai substituí-la.${garantiaDiasHerdados > 0 ? ` Garantia de ${garantiaDiasHerdados} dias mantida automaticamente.` : ''}`;
        }
      } else if (msg) {
        msg.style.color = 'var(--sucesso, #15803d)';
        msg.textContent = garantiaDiasHerdados > 0
          ? `Dados carregados. A garantia existente de ${garantiaDiasHerdados} dias foi preenchida automaticamente.`
          : 'Dados da OS carregados com sucesso.';
      }

      const fotos = (osEncontrada?.fotos || []).filter(f => f.categoria === 'entrega');
      const preview = $('novaEntregaFotosPreview');
      if (preview) preview.textContent = fotos.length > 0 ? `${fotos.length} foto(s) de entrega já anexadas na OS.` : '';

      const btnEnviar = $('btnNovaEntregaEnviarAssinatura');
      if (btnEnviar) btnEnviar.disabled = false;
      const btnNaoAssinada = $('btnNovaEntregaCriarNaoAssinada');
      if (btnNaoAssinada) btnNaoAssinada.disabled = false;
    } catch (e) {
      if (msg) { msg.style.color = 'var(--erro, #dc2626)'; msg.textContent = 'Erro ao buscar OS: ' + e.message; }
    }
  };

  window.limparFormNovaEntrega = function () {
    _entregaEmEdicao = null;
    acoesEditarEntrega.hidden = true;
    $('novaEntregaData').value = '';
    $('novaEntregaGarantiaInicio').value = '';
    ['novaEntregaNumeroOS','novaEntregaNomeRetirou','novaEntregaCpfRetirou','novaEntregaTelefoneRetirou','novaEntregaMarca','novaEntregaModelo','novaEntregaReparoRealizado','novaEntregaValorReparo','novaEntregaFormaPagamento','novaEntregaGarantiaDias']
      .forEach(id => { const el = $(id); if (el) el.value = ''; });
    delete $('novaEntregaNumeroOS').dataset.numeroCompleto;
    const preview = $('novaEntregaFotosPreview');
    if (preview) preview.textContent = '';
    const msg = $('novaEntregaMsgBusca');
    if (msg) msg.textContent = '';
    const btnEnviar = $('btnNovaEntregaEnviarAssinatura');
    if (btnEnviar) btnEnviar.disabled = true;
    const btnNaoAssinada = $('btnNovaEntregaCriarNaoAssinada');
    if (btnNaoAssinada) btnNaoAssinada.disabled = true;
  };

  function _coletarDadosNovaEntrega() {
    const resolverData = (id, anterior) => $(id).value === String(anterior || '').slice(0, 10) ? anterior : ($(id).value ? new Date($(id).value + 'T12:00:00').toISOString() : new Date().toISOString());
    return {
      dataHoraAssinatura: resolverData('novaEntregaData', _entregaEmEdicao?.dataHoraAssinatura),
      garantiaDataInicio: resolverData('novaEntregaGarantiaInicio', _entregaEmEdicao?.garantiaDataInicio || _entregaEmEdicao?.dataHoraAssinatura),
      nomeRetirou: $('novaEntregaNomeRetirou').value.trim(),
      cpfRetirou: $('novaEntregaCpfRetirou').value.trim(),
      telefoneRetirou: $('novaEntregaTelefoneRetirou').value.trim(),
      marca: $('novaEntregaMarca').value.trim(),
      modelo: $('novaEntregaModelo').value.trim(),
      reparoRealizado: $('novaEntregaReparoRealizado').value.trim(),
      valorReparo: Number($('novaEntregaValorReparo').value) || 0,
      formaPagamento: $('novaEntregaFormaPagamento').value,
      garantiaDias: parseInt($('novaEntregaGarantiaDias').value, 10) || 0,
    };
  }

  window.enviarNovaEntregaParaAssinatura = async function () {
    const numeroOS = $('novaEntregaNumeroOS').dataset.numeroCompleto;
    if (!numeroOS) { toast('Busque uma OS primeiro.', 'erro'); return; }
    if (_entregaEmEdicao?.assinaturaRetirouBase64 && !confirm('A entrega corrigida precisará de uma nova assinatura. Substituir a assinatura anterior e enviar para o celular?')) return;

    const dados = _coletarDadosNovaEntrega();

    const btn = $('btnNovaEntregaEnviarAssinatura');
    let sucesso = false;
    try {
      if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
      await window.api.entregacriarpendente(numeroOS, dados, usuarioAtual?.id);
      await window.exportarParaAssinaturaCelular('entrega', numeroOS);
      sucesso = true;
      window.limparFormNovaEntrega();
      await window.carregarEntregasPendentes();
    } catch (e) {
      toast('Erro ao enviar para assinatura: ' + e.message, 'erro');
    } finally {
      // Sucesso: limparFormNovaEntrega() já deixou o botão disabled=true
      // (formulário limpo, sem OS carregada). Erro: reabilita para o
      // usuário poder tentar de novo sem sair da tela e buscar a OS outra vez.
      if (btn) {
        btn.disabled = sucesso;
        btn.innerHTML = '<span class="icone-svg"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span> Enviar para assinatura no celular';
      }
    }
  };

  window.criarNovaEntregaNaoAssinada = async function () {
    const numeroOS = $('novaEntregaNumeroOS').dataset.numeroCompleto;
    if (!numeroOS) { toast('Busque uma OS primeiro.', 'erro'); return; }
    if (!confirm(`Confirmar que o aparelho da OS ${numeroOS} foi realmente retirado sem assinatura?\n\nEsta ação marcará a OS como Entregue e o PDF exibirá "NÃO ASSINADO". Se o aparelho ainda está na loja, cancele e mantenha o status Pronto para retirada.`)) return;

    const btn = $('btnNovaEntregaCriarNaoAssinada');
    try {
      if (btn) { btn.disabled = true; btn.textContent = 'Gerando PDF...'; }
      const resultado = await window.api.entregacriarnaoassinada(numeroOS, _coletarDadosNovaEntrega(), usuarioAtual?.id);
      if (!resultado?.sucesso || !resultado?.entrega) throw new Error(resultado?.erro || 'Nao foi possivel criar o comprovante.');
      toast(`Entrega da ${numeroOS} criada sem assinatura.`, 'sucesso');
      window.limparFormNovaEntrega();
      window.trocarTabEntregas('comprovantes');
      await window.carregarEntregas();
      await window.api.entregaabrirpdf(resultado.entrega.pdfPath);
    } catch (e) {
      toast('Erro ao criar entrega sem assinatura: ' + e.message, 'erro');
      if (btn) btn.disabled = false;
    } finally {
      if (btn) {
        btn.innerHTML = '<span class="icone-svg"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span> Confirmar retirada sem assinatura';
      }
    }
  };

  window.carregarEntregasPendentes = async function () {
    const corpo = $('corpoTabelaEntregasPendentes');
    if (!corpo) return;
    corpo.innerHTML = '<tr><td colspan="5" class="vazio">Carregando...</td></tr>';
    try {
      const pendentes = await window.api.entregalistarpendentes();
      if (!pendentes || pendentes.length === 0) {
        corpo.innerHTML = '<tr><td colspan="5" class="vazio">Nenhuma entrega pendente de assinatura.</td></tr>';
        return;
      }
      corpo.innerHTML = pendentes.map(p => `
        <tr>
          <td style="white-space:nowrap;font-weight:600;">${_escapeHtmlEntregas(p.numeroOS) || '—'}<br><small style="color:var(--texto-sec);">${_rotuloCicloEntrega(p)}</small></td>
          <td>${_escapeHtmlEntregas(p.nomeRetirou) || '—'}</td>
          <td>${_escapeHtmlEntregas([p.marca, p.modelo].filter(Boolean).join(' ')) || '—'}</td>
          <td style="white-space:nowrap;font-size:12px;color:var(--texto-sec);">${_fmtDataSimplesEntregas(p.criadoEm)}</td>
          <td>
            <button class="botao botao-xs botao-perigo" onclick="excluirEntregaPendenteUI('${_escapeHtmlEntregas(p.numeroOS)}','${encodeURIComponent(p.cicloEntregaId || 'original')}')">${ICONE_LIXEIRA} Excluir</button>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      corpo.innerHTML = `<tr><td colspan="5" class="vazio">Erro ao carregar: ${_escapeHtmlEntregas(e.message)}</td></tr>`;
    }
  };

  window.excluirEntregaPendenteUI = async function (numeroOS, cicloCodificado) {
    const ciclo = cicloCodificado ? decodeURIComponent(cicloCodificado) : undefined;
    if (!confirm(`Excluir a entrega pendente da OS ${numeroOS}? Esta ação não pode ser desfeita.`)) return;
    try {
      await window.api.entregaexcluirpendente(numeroOS, usuarioAtual?.id, ciclo);
      toast('Pendente excluída.', 'sucesso');
      await window.carregarEntregasPendentes();
    } catch (e) {
      toast('Erro ao excluir: ' + e.message, 'erro');
    }
  };

  if ($('btnNovaEntregaBuscarOS')) $('btnNovaEntregaBuscarOS').addEventListener('click', () => window.abrirBuscaOSParaNovaEntrega());
  if ($('btnNovaEntregaEnviarAssinatura')) $('btnNovaEntregaEnviarAssinatura').addEventListener('click', () => window.enviarNovaEntregaParaAssinatura());
  if ($('btnNovaEntregaCriarNaoAssinada')) $('btnNovaEntregaCriarNaoAssinada').addEventListener('click', () => window.criarNovaEntregaNaoAssinada());
  if ($('btnNovaEntregaLimpar')) $('btnNovaEntregaLimpar').addEventListener('click', () => window.limparFormNovaEntrega());

  // Expostas em window: usadas por _carregarEntregaNoDetalhe (tela de
  // detalhe da OS), que vive em outro ponto do arquivo, fora deste IIFE.
  window._escapeHtmlEntregas = _escapeHtmlEntregas;
  window._fmtDataSimplesEntregas = _fmtDataSimplesEntregas;
  window._garantiaHtmlEntregas = _garantiaHtmlEntregas;

  let _debEntregas;
  const campoBuscaEntregas = document.getElementById('entregaBusca');
  if (campoBuscaEntregas) {
    campoBuscaEntregas.addEventListener('input', e => {
      clearTimeout(_debEntregas);
      _debEntregas = setTimeout(() => carregarEntregas(e.target.value), 300);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ABA: GARANTIA (criada manualmente no PC)
  // ═══════════════════════════════════════════════════════════════
  // Usuário digita o nº da OS → busca puxa cliente/aparelho da OS já
  // existente → usuário define prazo (dias) + termos → gera PDF em via
  // única. Mesmo padrão de escape/formatação usado na aba Entregas.

  function _escapeHtmlGarantia(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _fmtDataSimplesGarantia(iso) {
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso || ''; }
  }

  // O campo garNumeroOS só aceita dígitos (ver listener de input logo
  // abaixo); aqui convertemos o número puro digitado ("1", "23") no
  // formato completo usado como chave em toda a base ("OS-0001",
  // "OS-0023") — mesmo formato/padStart de formatarNumeroOS no db.js.
  function _numeroOSCompletoGarantia() {
    const digitos = $('garNumeroOS').value.trim();
    if (!digitos) return '';
    return 'OS-' + digitos.padStart(4, '0');
  }

  // Preenche o formulário a partir de uma OS encontrada (cliente + aparelho).
  function _preencherFormGarantiaComOS(osEncontrada) {
    $('garClienteNome').value = osEncontrada?.cliente?.nome || '';
    $('garClienteTelefone').value = osEncontrada?.cliente?.telefone || '';
    $('garClienteCpf').value = osEncontrada?.cliente?.cpf || '';
    $('garMarca').value = osEncontrada?.aparelho?.marca || '';
    $('garModelo').value = osEncontrada?.aparelho?.modelo || '';
    $('garImei').value = osEncontrada?.aparelho?.imei || '';
  }

  // Chamada pelo modal genérico de busca (modalBuscarOSGenerico) após o
  // usuário confirmar a OS escolhida. numeroOS já vem completo ("OS-0001").
  window.buscarOSParaGarantia = async function (numeroOS) {
    const msg = $('garMsgBusca');
    msg.textContent = '';
    if (!numeroOS) { return; }
    $('garNumeroOS').value = numeroOS.replace(/^OS-0*/, '') || '0';
    limparErro('garNumeroOS');

    try {
      const osEncontrada = await window.api.garantiabuscaros(numeroOS);
      if (!osEncontrada) {
        msg.style.color = 'var(--erro, #dc2626)';
        msg.textContent = `OS ${numeroOS} não encontrada. Verifique o número digitado.`;
        return;
      }
      _preencherFormGarantiaComOS(osEncontrada);

      // Se já existe uma garantia para essa OS, carrega prazo/termos dela
      // também (edição em vez de recomeçar do zero).
      const garantiaExistente = await window.api.garantiaobterporos(numeroOS);
      if (garantiaExistente) {
        $('btnGarGerar').disabled = false;
        const campos = { garClienteNome: 'clienteNome', garClienteTelefone: 'clienteTelefone', garClienteCpf: 'clienteCpf', garMarca: 'marca', garModelo: 'modelo', garImei: 'imei' };
        Object.entries(campos).forEach(([id, campo]) => { $(id).value = garantiaExistente[campo] ?? $(id).value; });
        $('garDias').value = garantiaExistente.garantiaDias || '';
        $('garTermos').value = garantiaExistente.termos || '';
        if ($('garTermos').value.trim()) {
          atualizarIndicadorTermos('garTermos', true);
        } else {
          aplicarTermosPadraoNoCampo('garantia', 'garTermos', true);
        }
        $('garServicoRealizado').value = garantiaExistente.servicoRealizado || '';
        if (garantiaExistente.dataInicio) {
          $('garDataInicio').value = new Date(garantiaExistente.dataInicio).toISOString().slice(0, 10);
        }
        msg.style.color = 'var(--texto-sec)';
        msg.textContent = `Dados da OS carregados. Já existe uma garantia emitida para esta OS em ${_fmtDataSimplesGarantia(garantiaExistente.criadoEm)} — gerar novamente vai substituí-la.`;
      } else {
        msg.style.color = 'var(--aviso, #b45309)';
        msg.textContent = 'Esta OS ainda não possui garantia. Gere a entrega: o sistema aplicará automaticamente o prazo padrão e criará a garantia.';
        $('btnGarGerar').disabled = true;
      }

      if (!$('garDataInicio').value) {
        $('garDataInicio').value = new Date().toISOString().slice(0, 10);
      }
    } catch (e) {
      msg.style.color = 'var(--erro, #dc2626)';
      msg.textContent = 'Erro ao buscar OS: ' + e.message;
    }
  };

  window.limparFormGarantia = function () {
    ['garNumeroOS','garClienteNome','garClienteTelefone','garClienteCpf',
     'garMarca','garModelo','garImei','garServicoRealizado','garDias','garTermos']
      .forEach(id => { $(id).value = ''; });
    $('garDataInicio').value = new Date().toISOString().slice(0, 10);
    $('garMsgBusca').textContent = '';
    limparErros('garNumeroOS', 'garDias');
    aplicarTermosPadraoNoCampo('garantia', 'garTermos', true);
  };

  window.gerarComprovanteGarantia = async function () {
    const numeroOS = _numeroOSCompletoGarantia();
    const garantiaDias = parseInt($('garDias').value, 10);
    const existente = numeroOS ? await window.api.garantiaobterporos(numeroOS) : null;
    if (!existente) {
      toast('A garantia nasce automaticamente na entrega. Abra a aba Entregas e gere o comprovante desta OS.', 'aviso');
      return;
    }
    limparErros('garNumeroOS', 'garDias');

    let valido = true;
    if (!numeroOS) {
      const msg = $('garMsgBusca');
      msg.style.color = 'var(--erro, #dc2626)';
      msg.textContent = 'Selecione uma OS primeiro (botão "Buscar OS").';
      valido = false;
    }
    if (!Number.isInteger(garantiaDias) || garantiaDias < 0 || garantiaDias > 36500) { marcarErro('garDias', 'Informe de 0 a 36500 dias. Zero significa sem garantia adicional.'); valido = false; }
    if (!valido) return;

    const dados = {
      numeroOS,
      clienteNome: $('garClienteNome').value.trim(),
      clienteTelefone: $('garClienteTelefone').value.trim(),
      clienteCpf: $('garClienteCpf').value.trim(),
      marca: $('garMarca').value.trim(),
      modelo: $('garModelo').value.trim(),
      imei: $('garImei').value.trim(),
      servicoRealizado: $('garServicoRealizado').value.trim(),
      garantiaDias,
      dataInicio: $('garDataInicio').value ? new Date($('garDataInicio').value + 'T12:00:00').toISOString() : new Date().toISOString(),
      termos: $('garTermos').value.trim()
    };

    try {
      const btn = $('btnGarGerar');
      btn.disabled = true;
      btn.textContent = 'Gerando...';
      const garantiaSalva = await window.api.garantiasalvar(dados);
      toast('Comprovante de garantia gerado com sucesso!', 'sucesso');
      if (garantiaSalva?.pdfPath) {
        await window.api.garantiaabrirpdf(garantiaSalva.pdfPath);
      }
      await carregarGarantias();
    } catch (e) {
      toast('Erro ao gerar comprovante: ' + e.message, 'erro');
    } finally {
      const btn = $('btnGarGerar');
      btn.disabled = false;
      btn.innerHTML = `${ICONE_ESCUDO} Salvar correção da garantia`;
    }
  };

  function _retornoAtualGarantia(garantia) {
    const retornos = Array.isArray(garantia?.retornosGarantia) ? garantia.retornosGarantia : [];
    return retornos.find((item) => item.id === garantia.retornoAtualId)
      || retornos.find((item) => item.status !== 'Entregue')
      || retornos[0]
      || null;
  }

  function _abrirModalRetornoGarantia(garantia, retorno) {
    const editando = !!retorno;
    $('retornoGarantiaNumeroOS').value = garantia.numeroOS;
    $('retornoGarantiaId').value = retorno?.id || '';
    $('retornoGarantiaTitulo').textContent = editando ? 'Atualizar retorno em garantia' : 'Registrar retorno em garantia';
    $('retornoGarantiaContexto').textContent = `${garantia.numeroOS} · ${garantia.clienteNome || 'Cliente'} · ${[garantia.marca, garantia.modelo].filter(Boolean).join(' ') || 'Aparelho não informado'}`;
    $('retornoGarantiaMotivoGrupo').classList.remove('escondido');
    $('retornoGarantiaStatusGrupo').classList.toggle('escondido', !editando);
    $('retornoGarantiaHistoricoGrupo').classList.toggle('escondido', !editando);
    $('retornoGarantiaMotivo').value = editando ? (retorno.motivo || '') : '';
    const opcaoEntregue = Array.from($('retornoGarantiaStatus').options).find((opcao) => opcao.value === 'Entregue');
    if (opcaoEntregue) opcaoEntregue.hidden = retorno?.status !== 'Entregue';
    $('retornoGarantiaStatus').value = retorno?.status || 'Em análise';
    $('retornoGarantiaObservacao').value = '';
    $('retornoGarantiaMensagem').textContent = '';
    $('btnSalvarRetornoGarantia').textContent = editando ? 'Salvar nova etapa' : 'Registrar retorno';
    if (editando) {
      const historico = Array.isArray(retorno.historico) ? retorno.historico : [];
      $('retornoGarantiaHistorico').innerHTML = historico.length
        ? `<ol style="display:grid;gap:10px;margin:0;padding-left:22px;">${historico.map((item) => `<li><strong>${_escapeHtmlGarantia(item.status)}</strong> · ${_fmtDataSimplesGarantia(item.em)}<br /><span style="color:var(--texto-sec);">${_escapeHtmlGarantia(item.observacao || 'Sem observação.')}</span></li>`).join('')}</ol>`
        : '<p class="vazio">Nenhuma etapa registrada.</p>';
    }
    $('modalRetornoGarantia').classList.remove('escondido');
    setTimeout(() => (editando ? $('retornoGarantiaStatus') : $('retornoGarantiaMotivo'))?.focus(), 60);
  }

  window.abrirNovoRetornoGarantiaUI = async function (numeroOS) {
    try {
      const garantia = await window.api.garantiaobterporos(numeroOS);
      if (!garantia) throw new Error('Garantia não encontrada.');
      _abrirModalRetornoGarantia(garantia, null);
    } catch (erro) {
      toast('Não foi possível abrir o retorno: ' + erro.message, 'erro');
    }
  };

  window.abrirStatusRetornoGarantiaUI = async function (numeroOS, retornoId) {
    try {
      const garantia = await window.api.garantiaobterporos(numeroOS);
      const retorno = (garantia?.retornosGarantia || []).find((item) => item.id === retornoId);
      if (!garantia || !retorno) throw new Error('Retorno não encontrado.');
      _abrirModalRetornoGarantia(garantia, retorno);
    } catch (erro) {
      toast('Não foi possível abrir o histórico: ' + erro.message, 'erro');
    }
  };

  window.salvarRetornoGarantiaUI = async function () {
    const numeroOS = $('retornoGarantiaNumeroOS').value;
    const retornoId = $('retornoGarantiaId').value;
    const btn = $('btnSalvarRetornoGarantia');
    const mensagem = $('retornoGarantiaMensagem');
    const usuario = { id: usuarioAtual?.id || usuarioAtual?.login || '', nome: usuarioAtual?.nome || usuarioAtual?.login || 'Usuário' };
    mensagem.textContent = '';
    try {
      btn.disabled = true;
      btn.textContent = 'Salvando…';
      let resposta;
      if (retornoId) {
        resposta = await window.api.garantiaatualizarstatusretorno(numeroOS, retornoId, {
          status: $('retornoGarantiaStatus').value,
          motivo: $('retornoGarantiaMotivo').value.trim(),
          observacao: $('retornoGarantiaObservacao').value.trim()
        }, usuario);
      } else {
        const motivo = $('retornoGarantiaMotivo').value.trim();
        if (motivo.length < 3) throw new Error('Informe o motivo do retorno.');
        resposta = await window.api.garantiaregistrarretorno(numeroOS, {
          motivo,
          observacao: $('retornoGarantiaObservacao').value.trim()
        }, usuario);
      }
      $('modalRetornoGarantia').classList.add('escondido');
      toast(resposta?.entregaPendente
        ? 'Nova entrega da garantia criada. A entrega original continua salva; agora colete a nova assinatura.'
        : resposta?.duplicado ? 'Esse retorno já estava aberto; o histórico foi preservado.' : 'Retorno em garantia atualizado.', resposta?.duplicado ? 'aviso' : 'sucesso');
      await window.carregarGarantias($('garBusca')?.value || '');
      if (typeof carregarHistorico === 'function') await carregarHistorico();
      if (resposta?.entregaPendente) {
        document.querySelector('[data-aba="entregas"]')?.click();
        window.trocarTabEntregas('nova');
        await window.buscarOSParaNovaEntrega(numeroOS);
      }
    } catch (erro) {
      mensagem.textContent = erro.message || String(erro);
      mensagem.className = 'mensagem erro';
    } finally {
      btn.disabled = false;
      btn.textContent = retornoId ? 'Salvar nova etapa' : 'Registrar retorno';
    }
  };

  window.carregarGarantias = async function (query) {
    const corpo = document.getElementById('corpoTabelaGarantias');
    if (!corpo) return;
    corpo.innerHTML = '<tr><td colspan="7" class="vazio">Carregando...</td></tr>';

    try {
      const todas = await window.api.garantialistar();
      const termo = (query || '').trim().toLowerCase();
      const garantias = termo
        ? todas.filter(g =>
            String(g.numeroOS || '').toLowerCase().includes(termo) ||
            String(g.clienteNome || '').toLowerCase().includes(termo) ||
            String(g.clienteId || g.clienteNumero || '').toLowerCase().includes(termo.replace(/\D/g, '')))
        : todas;

      if (!garantias || garantias.length === 0) {
        corpo.innerHTML = `<tr><td colspan="7" class="vazio">${
          termo ? 'Nenhum resultado encontrado.' : 'Nenhuma garantia emitida ainda.'
        }</td></tr>`;
        return;
      }

      corpo.innerHTML = garantias.map(g => {
        const aparelho = [g.marca, g.modelo].filter(Boolean).join(' ') || '—';
        const retorno = _retornoAtualGarantia(g);
        const quantidadeRetornos = Array.isArray(g.retornosGarantia) ? g.retornosGarantia.length : 0;
        const rotuloRetornos = quantidadeRetornos === 1 ? '1 retorno' : `${quantidadeRetornos} retornos`;
        return `
        <tr>
          <td style="white-space:nowrap;font-weight:600;">${_escapeHtmlGarantia(g.numeroOS) || '—'}</td>
          <td>${_escapeHtmlGarantia(g.clienteNome) || '—'}</td>
          <td>${_escapeHtmlGarantia(aparelho)}</td>
          <td><span class="status-badge">${ICONE_ESCUDO} ${Number(g.garantiaDias) > 0 ? `${Number(g.garantiaDias)} dias — até ${g.dataLimite ? _fmtDataSimplesGarantia(g.dataLimite) : '—'}` : 'Sem garantia adicional'}</span></td>
          <td>${retorno ? `<button class="garantia-retorno-resumo" onclick="abrirStatusRetornoGarantiaUI('${_escapeHtmlGarantia(g.numeroOS)}','${_escapeHtmlGarantia(retorno.id)}')" aria-label="Ver ${_escapeHtmlGarantia(rotuloRetornos)} da OS ${_escapeHtmlGarantia(g.numeroOS)}"><span class="garantia-retorno-ponto" aria-hidden="true"></span><span class="garantia-retorno-texto"><strong>${_escapeHtmlGarantia(retorno.status)}</strong><small>${_escapeHtmlGarantia(rotuloRetornos)}</small></span><span class="garantia-retorno-ver">Ver</span></button>` : '<span class="garantia-sem-retorno">Nenhum retorno</span>'}</td>
          <td style="white-space:nowrap;font-size:12px;color:var(--texto-sec);">${_fmtDataSimplesGarantia(g.criadoEm)}</td>
          <td>
            <button class="botao botao-xs botao-primario" onclick="abrirNovoRetornoGarantiaUI('${_escapeHtmlGarantia(g.numeroOS)}')">Registrar retorno</button>
            <button class="botao botao-xs botao-secundario" onclick="editarGarantiaUI('${_escapeHtmlGarantia(g.numeroOS)}')">${ICONE_DOCUMENTO} Editar garantia</button>
            <button class="botao botao-xs" onclick="abrirPdfGarantiaUI('${_escapeHtmlGarantia(g.numeroOS)}')">${ICONE_DOCUMENTO} Ver PDF</button>
            <button class="botao botao-xs" style="background:#0f6b35;color:#fff;" onclick="enviarWhatsAppGarantiaUI('${_escapeHtmlGarantia(g.numeroOS)}')">${ICONE_CELULAR} WhatsApp</button>
          </td>
        </tr>
      `;
      }).join('');
    } catch (e) {
      console.error('Erro ao carregar garantias:', e);
      corpo.innerHTML = `<tr><td colspan="7" class="vazio">Erro ao carregar: ${_escapeHtmlGarantia(e.message)}</td></tr>`;
    }
  };

  window.editarGarantiaUI = async function (numeroOS) {
    document.querySelector('[data-aba="garantia"]')?.click();
    await window.buscarOSParaGarantia(numeroOS);
    $('btnGarGerar').disabled = false;
    $('btnGarGerar').innerHTML = `${ICONE_CHECK} Salvar garantia e atualizar PDF`;
    $('garMsgBusca').textContent = `Editando a garantia ${numeroOS}. O número da OS será mantido.`;
    $('garDias').focus();
    $('garDias').scrollIntoView({ block: 'center' });
  };

  window.abrirPdfGarantiaUI = async function (numeroOS) {
    try {
      const g = await window.api.garantiaobterporos(numeroOS);
      if (!g) { toast('Garantia não encontrada.', 'erro'); return; }
      let caminho = g.pdfPath;
      try {
        await window.api.garantiaabrirpdf(caminho);
      } catch (err) {
        toast('Regenerando PDF...', 'info');
        caminho = await window.api.garantiagerarpdf(numeroOS);
        await window.api.garantiaabrirpdf(caminho);
      }
    } catch (err) {
      toast('Erro ao abrir PDF: ' + err.message, 'erro');
    }
  };

  // Envia o comprovante de garantia por WhatsApp: mensagem profissional
  // avisando que o documento precisa ser apresentado para a garantia valer,
  // + o PDF anexado. Mesmo padrão (Baileys real, não link wa.me) já usado
  // no envio de orçamento/cobrança da OS — ver whatsapp:enviarGarantia.
  window.enviarWhatsAppGarantiaUI = async function (numeroOS) {
    try {
      if (!window.api.wappenviargarantia) { toast('WhatsApp não disponível.', 'erro'); return; }

      const g = await window.api.garantiaobterporos(numeroOS);
      if (!g) { toast('Garantia não encontrada.', 'erro'); return; }

      const tel = (g.clienteTelefone || '').replace(/\D/g, '');
      if (!tel) { toast('Cliente sem telefone cadastrado nesta garantia.', 'erro'); return; }
      const confirmarEnvio = await confirmModal(
        `Enviar agora o comprovante de garantia da OS ${numeroOS} para ${g.clienteNome || 'o cliente'}?`,
        { titulo: 'Confirmar envio pelo WhatsApp', textoOk: 'Confirmar e enviar' }
      );
      if (!confirmarEnvio) return;

      // Sempre regenera o PDF antes de anexar — garante que o arquivo em
      // disco existe e está atualizado (mesmo se pdfPath estiver ausente
      // ou apontando pra um arquivo apagado). Barato e idempotente, mesmo
      // padrão de confiança usado no restante do envio por WhatsApp.
      let caminho;
      try {
        caminho = await window.api.garantiagerarpdf(numeroOS);
      } catch (err) {
        toast('Erro ao gerar PDF da garantia: ' + err.message, 'erro');
        return;
      }

      const cfg = (typeof configAtual !== 'undefined' && configAtual?.nomeEmpresa)
        ? configAtual
        : await window.api.configobter().catch(() => ({}));

      toast('Enviando comprovante de garantia...', 'info');
      const r = await window.api.wappenviargarantia({
        telefone: tel,
        garantia: {
          nome_cliente   : g.clienteNome || '',
          numero_os      : g.numeroOS || '',
          aparelho       : [g.marca, g.modelo].filter(Boolean).join(' ') || 'seu aparelho',
          prazo_garantia : `${Number(g.garantiaDias) || 0} dias`,
          data_limite    : g.dataLimite ? _fmtDataSimplesGarantia(g.dataLimite) : '',
        },
        config: {
          nomeEmpresa: cfg.nomeEmpresa || 'Assistência Técnica',
          codigoPais : (cfg.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55',
        },
        caminhoPdf: caminho,
      });

      if (r?.sucesso) {
        toast(r.pdfEnviado ? `${ICONE_CHECK} Garantia e PDF aceitos pelo servidor do WhatsApp.` : `${ICONE_CHECK} Mensagem aceita pelo servidor (PDF não anexado)`, r.pdfEnviado ? 'sucesso' : 'aviso');
      } else {
        toast('Erro ao enviar: ' + (r?.erro || 'verifique o WhatsApp.'), 'erro');
      }
    } catch (err) {
      toast('Erro ao enviar WhatsApp: ' + err.message, 'erro');
    }
  };

  const btnGarBuscarOS = document.getElementById('btnGarBuscarOS');
  if (btnGarBuscarOS) btnGarBuscarOS.addEventListener('click', () => window.abrirBuscaOSGenerico('garantia'));

  const btnGarGerar = document.getElementById('btnGarGerar');
  if (btnGarGerar) btnGarGerar.addEventListener('click', () => window.gerarComprovanteGarantia());

  const btnGarLimpar = document.getElementById('btnGarLimpar');
  if (btnGarLimpar) btnGarLimpar.addEventListener('click', () => window.limparFormGarantia());

  const btnSalvarRetornoGarantia = document.getElementById('btnSalvarRetornoGarantia');
  if (btnSalvarRetornoGarantia) btnSalvarRetornoGarantia.addEventListener('click', () => window.salvarRetornoGarantiaUI());

  let _debGarantias;
  const campoBuscaGarantias = document.getElementById('garBusca');
  if (campoBuscaGarantias) {
    campoBuscaGarantias.addEventListener('input', e => {
      clearTimeout(_debGarantias);
      _debGarantias = setTimeout(() => carregarGarantias(e.target.value), 300);
    });
  }

  // Botão "Testar Conexão" na tela de Configurações → Integrações IA (Groq)
  const btnTestarGroq = document.getElementById('btnTestarGroq');
  if (btnTestarGroq) {
    btnTestarGroq.addEventListener('click', async () => {
      const statusEl = document.getElementById('statusTesteGroq');
      const chaveDigitada = document.getElementById('groqApiKeyConfig')?.value?.trim();
      btnTestarGroq.disabled = true;
      btnTestarGroq.innerHTML = `${ICONE_SYNC} Testando...`;
      if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
      try {
        // Se o usuário digitou uma chave nova (ainda não salva), testa ela;
        // caso o campo esteja vazio, testa a chave já salva nas configurações
        // (a de classificação de forma de pagamento/aceite de termos).
        const r = await window.api.iatestarconexao(chaveDigitada || undefined, 'classificacao');
        if (statusEl) {
          if (r.sucesso) {
            statusEl.style.color = '#15803d';
            statusEl.innerHTML = `${ICONE_CHECK} Conexão OK (${r.tempoRespostaMs}ms). Não esqueça de clicar em "Salvar" para gravar a chave.`;
          } else {
            statusEl.style.color = '#b91c1c';
            statusEl.innerHTML = `${ICONE_X} Falha: ${_escHtml(r.erro)}`;
          }
        }
      } catch (e) {
        if (statusEl) { statusEl.style.color = '#b91c1c'; statusEl.innerHTML = `${ICONE_X} Erro: ${_escHtml(e.message)}`; }
      } finally {
        btnTestarGroq.disabled = false;
        btnTestarGroq.innerHTML = `${ICONE_PLUGUE} Testar Conexão`;
      }
    });
  }

  // v46: Botão "Testar Conexão" da chave separada do Assistente de Chat.
  // Reaproveita o MESMO IPC genérico (ia:testarConexao aceita qualquer chave
  // passada, não é amarrado à classificação de pagamento) — só aponta para o
  // campo/status do novo bloco.
  // BUGFIX (correcoesbugs.txt #3): passa 'chat' como segundo argumento para
  // que, com o campo vazio, o fallback de testarConexao olhe
  // configFull.groqChatApiKey (a chave já salva do Chat) em vez de
  // configFull.groqApiKey (a de classificação) — antes disso, testar com o
  // campo em branco sempre reportava "Nenhuma chave configurada" mesmo com
  // a chave do chat salva e válida.
  const btnTestarGroqChat = document.getElementById('btnTestarGroqChat');
  if (btnTestarGroqChat) {
    btnTestarGroqChat.addEventListener('click', async () => {
      const statusEl = document.getElementById('statusTesteGroqChat');
      const chaveDigitada = document.getElementById('iaChatApiKeyConfig')?.value?.trim();
      btnTestarGroqChat.disabled = true;
      btnTestarGroqChat.innerHTML = `${ICONE_SYNC} Testando...`;
      if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
      try {
        const provedor = $('iaChatProviderConfig')?.value || 'groq';
        const modelo = $('iaChatModelConfig')?.value || '';
        const remotoConfigurado = integracaoIAEmpresaCache?.status === 'conectada';
        const r = chaveDigitada || !remotoConfigurado
          ? await window.api.iatestarconexao(chaveDigitada || undefined, 'chat', provedor, modelo)
          : await window.api.supabaseintegracaoia('testar', { provedor, modelo, apiKey: '' });
        if (statusEl) {
          if (r.sucesso) {
            statusEl.style.color = '#15803d';
            statusEl.innerHTML = `${ICONE_CHECK} Conexão OK${r.tempoRespostaMs ? ` (${r.tempoRespostaMs}ms)` : ''}. ${chaveDigitada ? 'Clique em "Salvar" para proteger a nova chave.' : 'A configuração salva está funcionando.'}`;
          } else {
            statusEl.style.color = '#b91c1c';
            statusEl.innerHTML = `${ICONE_X} Falha: ${_escHtml(r.erro)}`;
          }
        }
      } catch (e) {
        if (statusEl) { statusEl.style.color = '#b91c1c'; statusEl.innerHTML = `${ICONE_X} Erro: ${_escHtml(e.message)}`; }
      } finally {
        btnTestarGroqChat.disabled = false;
        btnTestarGroqChat.innerHTML = `${ICONE_PLUGUE} Testar Conexão`;
      }
    });
  }

  // Botão "Testar Conexão" na tela de Configurações → Integrações Mercado Pago
  const btnTestarMP = document.getElementById('btnTestarMP');
  if (btnTestarMP) {
    btnTestarMP.addEventListener('click', async () => {
      const statusEl = document.getElementById('statusTesteMP');
      const tokenDigitado = document.getElementById('mpTokenConfig')?.value?.trim();
      btnTestarMP.disabled = true;
      btnTestarMP.innerHTML = `${ICONE_SYNC} Testando...`;
      if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
      try {
        // Se o usuário digitou um token novo (ainda não salvo), testa ele;
        // caso o campo esteja vazio, testa o token já salvo nas configurações.
        const r = await window.api.mptestarconexao(tokenDigitado || undefined);
        if (statusEl) {
          if (r.sucesso) {
            statusEl.style.color = '#15803d';
            statusEl.innerHTML = `${ICONE_CHECK} Conectado como "${r.nomeConta}" (${r.tempoRespostaMs}ms). Não esqueça de clicar em "Salvar" para gravar o token.`;
          } else {
            statusEl.style.color = '#b91c1c';
            statusEl.innerHTML = `${ICONE_X} Falha: ${_escHtml(r.erro)}`;
          }
        }
      } catch (e) {
        if (statusEl) { statusEl.style.color = '#b91c1c'; statusEl.innerHTML = `${ICONE_X} Erro: ${_escHtml(e.message)}`; }
      } finally {
        btnTestarMP.disabled = false;
        btnTestarMP.innerHTML = `${ICONE_PLUGUE} Testar Conexão`;
      }
    });
  }

  const btnTestarSupabase = document.getElementById('btnTestarSupabase');
  if (btnTestarSupabase) {
    btnTestarSupabase.addEventListener('click', async () => {
      const statusEl = document.getElementById('statusTesteSupabase');
      const credenciais = {
        url: document.getElementById('supabaseUrlConfig')?.value?.trim() || undefined,
        anonKey: document.getElementById('supabaseAnonKeyConfig')?.value?.trim() || undefined
      };
      btnTestarSupabase.disabled = true;
      btnTestarSupabase.innerHTML = `${ICONE_SYNC} Testando...`;
      try {
        const r = await window.api.supabasetestarconexao(credenciais);
        if (statusEl) {
          statusEl.style.color = r.sucesso ? '#15803d' : '#b91c1c';
          statusEl.textContent = r.sucesso ? 'Conexão com o Supabase confirmada.' : `Falha: ${r.erro}`;
        }
      } catch (erro) {
        if (statusEl) { statusEl.style.color = '#b91c1c'; statusEl.textContent = `Erro: ${erro.message}`; }
      } finally {
        btnTestarSupabase.disabled = false;
        btnTestarSupabase.innerHTML = `${ICONE_PLUGUE} Testar Conexão`;
      }
    });
  }

  const btnSincronizarSupabase = document.getElementById('btnSincronizarSupabase');
  if (btnSincronizarSupabase) {
    btnSincronizarSupabase.addEventListener('click', async () => {
      btnSincronizarSupabase.disabled = true;
      btnSincronizarSupabase.innerHTML = `${ICONE_SYNC} Sincronizando...`;
      try {
        const r = await window.api.supabasesincronizaragora();
        if (!r.sucesso) throw new Error(r.erro || 'Não foi possível sincronizar.');
        toast(`Supabase: ${r.enviados} enviada(s), ${r.recebidos} recebida(s).`, 'sucesso');
        await atualizarStatusSyncSupabaseNaTela();
      } catch (erro) {
        toast(erro.message, 'erro');
      } finally {
        btnSincronizarSupabase.disabled = false;
        btnSincronizarSupabase.innerHTML = `${ICONE_SYNC} Sincronizar Agora`;
      }
    });
  }

  // ── hover nos itens da lista ─────────────────────────────────────────────────
  document.getElementById('mensagensClientesLista')?.addEventListener('mouseover', e => {
    const item = e.target.closest('.mensagem-cliente-item');
    if (item && item.dataset.tel !== _clienteAtivo) {
      item.style.background = 'var(--fundo-hover,rgba(0,0,0,.05))';
    }
  });
  document.getElementById('mensagensClientesLista')?.addEventListener('mouseout', e => {
    const item = e.target.closest('.mensagem-cliente-item');
    if (item && item.dataset.tel !== _clienteAtivo) {
      item.style.background = '';
    }
  });

  // ── PATCH nos envios: toast de confirmação/erro imediato ────────────────────
  // Intercepta wappenviaraprovacao, wappenviarcobranca, wappenviarpagconf e wappenviarentregue
  // para exibir toast visual logo após o resultado do envio.

  const _origAprovacao = window.api.wappenviaraprovacao;
  if (_origAprovacao) {
    window.api.wappenviaraprovacao = async function (...args) {
      const r = await _origAprovacao.apply(this, args);
      if (r?.sucesso) {
        const pdfOk = r.pdfEnviado !== false;
        toast(pdfOk ? `${ICONE_CHECK} Orçamento e PDF aceitos pelo servidor do WhatsApp.` : `${ICONE_CHECK} Orçamento aceito pelo servidor (PDF não anexado)`, pdfOk ? 'sucesso' : 'aviso');
      } else if (r && !r.sucesso) {
        toast(`${ICONE_X} Falha ao enviar orçamento: ` + (r.erro || 'erro desconhecido'), 'erro');
      }
      if (!document.getElementById('aba-mensagens-wapp')?.classList.contains('escondido')) {
        setTimeout(() => carregarMensagensWapp(), 400);
      }
      return r;
    };
  }

  const _origCobranca = window.api.wappenviarcobranca;
  if (_origCobranca) {
    window.api.wappenviarcobranca = async function (...args) {
      const r = await _origCobranca.apply(this, args);
      // Toast de sucesso/erro já é exibido pelo fluxo que chamou (cobrança de
      // retirada ou orçamento de aprovação), então aqui só tratamos o reload
      // da aba de mensagens para não duplicar notificações.
      if (!document.getElementById('aba-mensagens-wapp')?.classList.contains('escondido')) {
        setTimeout(() => carregarMensagensWapp(), 400);
      }
      return r;
    };
  }

  const _origPagConf = window.api.wappenviarpagconf;
  if (_origPagConf) {
    window.api.wappenviarpagconf = async function (...args) {
      const r = await _origPagConf.apply(this, args);
      if (r?.sucesso) {
        toast(`${ICONE_CHECK} Confirmação de pagamento aceita pelo servidor.`, 'sucesso');
      } else if (r && !r.sucesso) {
        toast(`${ICONE_X} Falha ao enviar confirmação: ` + (r.erro || 'erro desconhecido'), 'erro');
      }
      if (!document.getElementById('aba-mensagens-wapp')?.classList.contains('escondido')) {
        setTimeout(() => carregarMensagensWapp(), 400);
      }
      return r;
    };
  }

  const _origEntregue = window.api.wappenviarentregue;
  if (_origEntregue) {
    window.api.wappenviarentregue = async function (...args) {
      const r = await _origEntregue.apply(this, args);
      if (r?.sucesso) {
        toast(`${ICONE_CHECK} Mensagem de entrega aceita pelo servidor.`, 'sucesso');
      } else if (r && !r.sucesso) {
        toast(`${ICONE_X} Falha ao enviar mensagem de entrega: ` + (r.erro || 'erro desconhecido'), 'erro');
      }
      if (!document.getElementById('aba-mensagens-wapp')?.classList.contains('escondido')) {
        setTimeout(() => carregarMensagensWapp(), 400);
      }
      return r;
    };
  }

})();

// ── Fim do Módulo Mensagens WhatsApp ──────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// ABA CONVERSAS (v40)
// Visão por classificacaoResposta (✅ Aceitas / ✕ Negadas / 💰 Pagas) + aba
// Não Entendidas (🔴 No momento / 🕓 Histórico). Reaproveita:
//   - db.listarConversasPorClassificacao / listarConversasNaoEntendidas /
//     contarConversasPorClassificacao (via IPC conversas:*)
//   - db.listarLogMensagensPorCliente (via IPC wapplog:porCliente) para montar
//     o histórico completo de uma conversa
//   - renderConversa() já existente (window._wappConversaShared), para exibir
//     esse histórico dentro do modal
// Nenhuma lógica de automação/db é criada ou alterada aqui — apenas leitura
// e apresentação.
// ══════════════════════════════════════════════════════════════════════════════

(function () {

  // Estados do listener (src/whatsapp.js: ESTADOS_AUTOMACAO_ATIVOS) em que a
  // conversa ainda está com o bot aguardando entendimento do cliente. Usado
  // apenas para separar "No momento" de "Histórico" na tela — não altera nem
  // reimplementa a automação, só lê o campo já gravado por ela.
  const ESTADOS_CONVERSA_EM_ABERTO = [
    'aguardando_sim_nao',
    'aguardando_forma_pagamento_retirada', // v45 — nome novo, espelha ESTADOS_AUTOMACAO_ATIVOS de src/whatsapp.js
    'aguardando_motivo_recusa'
  ];

  function el(id) { return document.getElementById(id); }

  function fmtData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR');
  }
  function fmtHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  // Texto da "última mensagem" de uma OS: preferimos o motivo de recusa ou a
  // forma de pagamento informada pelo cliente (é o dado mais específico que já
  // temos na própria OS); como fallback, buscamos no log de mensagens.
  function ultimaMensagemDaOS(os) {
    if (os.classificacaoResposta === 'recusa_termos' && os.motivoRecusaTermos) {
      return os.motivoRecusaTermos;
    }
    if (os.classificacaoResposta === 'forma_pagamento' && os.respostaPreferenciaPagamento) {
      return os.respostaPreferenciaPagamento;
    }
    return '';
  }

  // ── item de conversa (usado nas 3 colunas e nas 2 sub-abas de Não Entendidas) ──

  function itemConversaHTML(os) {
    const cliente  = os.cliente?.nome || 'Sem nome';
    const telefone = os.cliente?.telefone || '—';
    const quando   = os.dataRespostaTermos || os.data;
    const ultima   = ultimaMensagemDaOS(os);

    return `<div class="conversa-item" data-os="${os.numero}" data-tel="${(os.cliente?.telefone || '').replace(/\D/g,'')}">
      <div class="conversa-item-topo">
        <span class="conversa-item-os">${os.numero}</span>
        <span class="conversa-item-data">${fmtData(quando)} · ${fmtHora(quando)}</span>
      </div>
      <div class="conversa-item-cliente" style="display:flex;align-items:center;gap:6px;white-space:normal;overflow:visible;">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${cliente}</span>
        <button type="button" class="botao-editar-nome-cliente" title="Editar nome do cliente"
          data-tel-editar="${(os.cliente?.telefone || '').replace(/\D/g,'')}" data-nome-atual="${cliente.replace(/"/g,'&quot;')}"
          style="border:none;background:transparent;cursor:pointer;font-size:12px;opacity:0.6;padding:2px 4px;line-height:1;flex-shrink:0;">${ICONE_LAPIS}</button>
      </div>
      <div class="conversa-item-tel">${telefone}</div>
      ${ultima ? `<div class="conversa-item-ultima">${ultima}</div>` : ''}
    </div>`;
  }

  function renderListaOS(containerId, lista) {
    const container = el(containerId);
    if (!container) return;
    if (!lista || lista.length === 0) {
      container.innerHTML = '<div class="vazio" style="padding:16px;text-align:center;color:var(--texto-sec);">Nenhuma conversa aqui ainda.</div>';
      return;
    }
    container.innerHTML = lista.map(itemConversaHTML).join('');
    container.querySelectorAll('.conversa-item').forEach(item => {
      item.addEventListener('click', () => abrirHistoricoCompleto(item.dataset.tel, item.dataset.os));
    });
    // Botão de editar nome: precisa de stopPropagation para não disparar
    // também o clique do card pai (que abriria o histórico completo por cima).
    container.querySelectorAll('.botao-editar-nome-cliente').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const telefone = btn.dataset.telEditar;
        const nomeAtual = btn.dataset.nomeAtual === 'Sem nome' ? '' : btn.dataset.nomeAtual;
        const novoNome = await promptModal('Nome do cliente:', nomeAtual || '');
        if (novoNome === null || novoNome === undefined) return; // cancelado
        const nomeLimpo = novoNome.trim();
        if (!nomeLimpo) { toast('O nome não pode ficar vazio.', 'erro'); return; }
        try {
          // Grava por telefone em todos os lugares (log de mensagens + OS),
          // para que a aba Mensagens mostre o mesmo nome atualizado.
          await window.api.wapplogatualizarnomecliente(telefone, nomeLimpo);
          toast('Nome do cliente atualizado!', 'sucesso');
          if (typeof carregarConversas === 'function') carregarConversas();
          if (typeof window.carregarMensagensWapp === 'function') window.carregarMensagensWapp();
        } catch (e) {
          toast('Erro ao atualizar nome: ' + e.message, 'erro');
        }
      });
    });
  }

  // ── abrir histórico completo (modal), reaproveitando renderConversa() ────────

  async function abrirHistoricoCompleto(telefoneDigitos, osNumero) {
    const shared = window._wappConversaShared;
    const modal  = el('modalConversaCompleta');
    if (!shared || !modal) return;

    modal.classList.remove('escondido');
    const listaEl = el('conversaCompletaLista');
    if (listaEl) listaEl.innerHTML = '<div class="vazio" style="margin:auto;color:var(--texto-sec);">Carregando...</div>';

    try {
      // listarLogMensagensPorCliente() já agrupa por telefone — buscamos pelo
      // dígitos do telefone do item clicado e localizamos o grupo correspondente.
      const grupos = await window.api.wapplogporcliente('');
      const grupo = (grupos || []).find(g => (g.telefone || '').replace(/\D/g, '') === telefoneDigitos)
        || { telefone: telefoneDigitos, clienteNome: '', mensagens: [] };

      shared.renderConversa(grupo, {
        nome:  'conversaCompletaNome',
        tel:   'conversaCompletaTel',
        lista: 'conversaCompletaLista'
      });
    } catch (e) {
      console.error('[Conversas] Erro ao abrir histórico:', e.message);
      if (listaEl) listaEl.innerHTML = '<div class="vazio" style="margin:auto;color:#e55;">Erro ao carregar histórico.</div>';
    }
  }

  // ── contadores (topo das colunas + badge de Não Entendidas) ──────────────────

  async function carregarContadores() {
    try {
      const c = await window.api.conversascontadores();
      const p = c?.porClassificacao || {};
      if (el('contadorAceitas')) el('contadorAceitas').textContent = p.aceite_termos || 0;
      if (el('contadorNegadas')) el('contadorNegadas').textContent = p.recusa_termos || 0;
      if (el('contadorPagas'))   el('contadorPagas').textContent   = p.forma_pagamento || 0;

      const badge = el('badgeNaoEntendidas');
      if (badge) {
        const n = c?.naoEntendidas || 0;
        badge.textContent = n;
        badge.classList.toggle('escondido', n === 0);
      }

      const badgeHumano = el('badgeAguardandoHumano');
      if (badgeHumano) {
        const n = c?.aguardandoHumano || 0;
        badgeHumano.textContent = n;
        badgeHumano.classList.toggle('escondido', n === 0);
      }

      const badgePagRetirada = el('badgePagamentoRetirada');
      if (badgePagRetirada) {
        const n = c?.pagamentoNaRetirada || 0;
        badgePagRetirada.textContent = n;
        badgePagRetirada.classList.toggle('escondido', n === 0);
      }
    } catch (e) {
      console.error('[Conversas] Erro ao carregar contadores:', e.message);
    }
  }

  // ── painel: visão geral (3 colunas) ───────────────────────────────────────────

  async function carregarVisaoGeral() {
    try {
      const [aceitas, negadas, pagas] = await Promise.all([
        window.api.conversasporclassificacao('aceite_termos'),
        window.api.conversasporclassificacao('recusa_termos'),
        window.api.conversasporclassificacao('forma_pagamento'),
      ]);
      renderListaOS('listaAceitas', aceitas);
      renderListaOS('listaNegadas', negadas);
      renderListaOS('listaPagas', pagas);
    } catch (e) {
      console.error('[Conversas] Erro ao carregar visão geral:', e.message);
    }
  }

  // ── painel: não entendidas (No momento / Histórico) ───────────────────────────

  async function carregarNaoEntendidas() {
    try {
      const todas = await window.api.conversasnaoentendidas();
      const atual     = (todas || []).filter(os => ESTADOS_CONVERSA_EM_ABERTO.includes(os.estadoConversaAprovacao));
      const historico = (todas || []).filter(os => !ESTADOS_CONVERSA_EM_ABERTO.includes(os.estadoConversaAprovacao));
      renderListaOS('listaNaoEntendidasAtual', atual);
      renderListaOS('listaNaoEntendidasHistorico', historico);
    } catch (e) {
      console.error('[Conversas] Erro ao carregar não entendidas:', e.message);
    }
  }

  // ── painel: aguardando humano ─────────────────────────────────────────────────
  // v40.4 — conversas encaminhadas para atendente (cliente digitou 1, ou a
  // automação esgotou as tentativas). Separado de "Não Entendidas".

  async function carregarAguardandoHumano() {
    try {
      const lista = await window.api.conversasaguardandohumano();
      renderListaOS('listaAguardandoHumano', lista);
    } catch (e) {
      console.error('[Conversas] Erro ao carregar aguardando humano:', e.message);
    }
  }

  // ── painel: pagamento na retirada ─────────────────────────────────────────────
  // Fase 7 — OS com forma de pagamento já informada na retirada, mas
  // pagamento ainda não confirmado. Separado de "Aguardando Humano": aqui a
  // automação de texto já terminou, falta só a confirmação do pagamento.

  async function carregarPagamentoNaRetirada() {
    try {
      const lista = await window.api.conversaspagamentonaretirada();
      renderListaOS('listaPagamentoRetirada', lista);
    } catch (e) {
      console.error('[Conversas] Erro ao carregar pagamento na retirada:', e.message);
    }
  }

  // ── carregarConversas (chamada ao entrar na sub-aba "Conversas" dentro de Mensagens) ──

  window.carregarConversas = async function () {
    await Promise.all([
      carregarContadores(),
      carregarVisaoGeral(),
      carregarNaoEntendidas(),
      carregarAguardandoHumano(),
      carregarPagamentoNaRetirada()
    ]);
  };

  // ── sub-navegação (dentro da aba Mensagens): Histórico x Conversas ───────────

  document.querySelectorAll('#mensagensSubNav [data-msg-subaba]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mensagensSubNav [data-msg-subaba]').forEach(b => b.classList.toggle('ativa', b === btn));
      const modo = btn.dataset.msgSubaba;
      el('mensagensPainelHistorico')?.classList.toggle('escondido', modo !== 'historico');
      el('mensagensPainelConversas')?.classList.toggle('escondido', modo !== 'conversas');
      if (modo === 'conversas') carregarConversas();
    });
  });

  // ── sub-navegação: Visão Geral x Não Entendidas x Aguardando Humano ──────────

  document.querySelectorAll('#conversasSubNav [data-conv-subaba]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#conversasSubNav [data-conv-subaba]').forEach(b => b.classList.toggle('ativa', b === btn));
      const modo = btn.dataset.convSubaba;
      el('conversasPainelGeral')?.classList.toggle('escondido', modo !== 'geral');
      el('conversasPainelNaoEntendidas')?.classList.toggle('escondido', modo !== 'nao-entendidas');
      el('conversasPainelAguardandoHumano')?.classList.toggle('escondido', modo !== 'aguardando-humano');
      el('conversasPainelPagamentoRetirada')?.classList.toggle('escondido', modo !== 'pagamento-retirada');
    });
  });

  // ── sub-abas de Não Entendidas: No momento x Histórico ────────────────────────

  document.querySelectorAll('#conversasPainelNaoEntendidas [data-conv-ne]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#conversasPainelNaoEntendidas [data-conv-ne]').forEach(b => b.classList.toggle('ativa', b === btn));
      const modo = btn.dataset.convNe;
      el('listaNaoEntendidasAtual')?.classList.toggle('escondido', modo !== 'atual');
      el('listaNaoEntendidasHistorico')?.classList.toggle('escondido', modo !== 'historico');
    });
  });

})();

// ── Fim do Módulo Aba Conversas ───────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO: ATUALIZAÇÃO PELO GITHUB RELEASES
// ══════════════════════════════════════════════════════════════════════════════
(function iniciarModuloAtualizacaoGitHub() {
  const modalConfig = document.getElementById('modalConfig');
  const versao = document.getElementById('updateVersaoAtual');
  const status = document.getElementById('updateStatus');
  const verificar = document.getElementById('btnVerificarUpdate');
  const verificarSuporte = document.getElementById('btnVerificarUpdateSuporte');
  const textoVerificarSuporte = document.getElementById('textoVerificarUpdateSuporte');
  const statusUpdateSuporte = document.getElementById('statusUpdateSuporte');
  const instalar = document.getElementById('btnInstalarUpdate');
  const loginAtualizacao = document.getElementById('loginAtualizacao');
  const loginAtualizacaoTexto = document.getElementById('loginAtualizacaoTexto');
  const loginAtualizacaoPercentual = document.getElementById('loginAtualizacaoPercentual');
  const loginAtualizacaoBarra = document.getElementById('loginAtualizacaoBarra');
  const instalarLogin = document.getElementById('btnInstalarAtualizacaoLogin');
  const updateGlobal = document.getElementById('updateGlobal');
  const updateGlobalTexto = document.getElementById('updateGlobalTexto');
  const updateGlobalPercentual = document.getElementById('updateGlobalPercentual');
  const updateGlobalBarra = document.getElementById('updateGlobalBarra');
  const updateAplicacaoOverlay = document.getElementById('updateAplicacaoOverlay');
  const updateAplicacaoTitulo = document.getElementById('updateAplicacaoTitulo');
  const updateAplicacaoTexto = document.getElementById('updateAplicacaoTexto');
  const updateAplicacaoPercentual = document.getElementById('updateAplicacaoPercentual');
  const updateAplicacaoBarra = document.getElementById('updateAplicacaoBarra');
  const telaLogin = document.getElementById('telaLogin');
  let ultimoEstadoAtualizacao = null;

  function mostrarEstado(dados) {
    if (!dados) return;
    ultimoEstadoAtualizacao = dados;
    if (versao) versao.textContent = 'Versão instalada: ' + (dados.versaoAtual || '—');
    if (status) status.textContent = dados.mensagem || '';
    // A versão para PC aplica a atualização automaticamente depois do download.
    // Os botões permanecem no DOM apenas para compatibilidade com versões antigas.
    if (instalar) instalar.classList.add('escondido');
    const atualizacaoOcupada = dados.fase === 'verificando' || dados.fase === 'baixando' || dados.fase === 'instalando';
    if (verificar) verificar.disabled = atualizacaoOcupada;
    if (verificarSuporte) verificarSuporte.disabled = atualizacaoOcupada;
    if (textoVerificarSuporte) {
      textoVerificarSuporte.textContent = dados.fase === 'verificando'
        ? 'Verificando...'
        : dados.fase === 'baixando'
          ? `Baixando ${Math.round(Number(dados.progresso || 0))}%`
          : 'Verificar atualização';
    }
    if (statusUpdateSuporte) statusUpdateSuporte.textContent = dados.mensagem || '';
    const faseVisivel = ['verificando', 'baixando', 'pronto', 'instalando'].includes(dados.fase);
    const loginVisivel = !!telaLogin && !telaLogin.classList.contains('escondido');
    const exibirNoLogin = faseVisivel && loginVisivel;
    const exibirGlobal = faseVisivel && !loginVisivel;
    if (loginAtualizacao) loginAtualizacao.classList.toggle('escondido', !exibirNoLogin);
    if (loginAtualizacao) loginAtualizacao.dataset.fase = dados.fase || 'ocioso';
    if (loginAtualizacaoTexto && exibirNoLogin) {
      loginAtualizacaoTexto.textContent = dados.fase === 'baixando'
        ? 'Atualizando o Sistema OS'
        : (dados.mensagem || '');
    }
    const progresso = Math.max(0, Math.min(100, Number(dados.progresso || 0)));
    if (loginAtualizacaoBarra) loginAtualizacaoBarra.style.width = `${progresso}%`;
    if (loginAtualizacaoPercentual) {
      loginAtualizacaoPercentual.textContent = dados.fase === 'baixando' ? `${Math.round(progresso)}%` : '';
    }
    if (updateGlobal) {
      updateGlobal.classList.toggle('escondido', !exibirGlobal);
      updateGlobal.dataset.fase = dados.fase || 'ocioso';
    }
    if (updateGlobalTexto && exibirGlobal) {
      updateGlobalTexto.textContent = dados.fase === 'baixando'
        ? 'Atualizando o Sistema OS'
        : (dados.mensagem || 'Verificando atualizações...');
    }
    if (updateGlobalBarra) updateGlobalBarra.style.width = `${progresso}%`;
    if (updateGlobalPercentual) {
      updateGlobalPercentual.textContent = dados.fase === 'baixando' ? `${Math.round(progresso)}%` : '';
    }
    const bloqueiaDuranteAtualizacao = ['baixando', 'pronto', 'instalando'].includes(dados.fase);
    if (updateAplicacaoOverlay) {
      updateAplicacaoOverlay.classList.toggle('escondido', !bloqueiaDuranteAtualizacao);
      updateAplicacaoOverlay.dataset.fase = dados.fase || 'ocioso';
    }
    if (updateAplicacaoTitulo) {
      updateAplicacaoTitulo.textContent = dados.fase === 'instalando' || dados.fase === 'pronto'
        ? 'Instalando a atualização'
        : 'Atualizando o Sistema OS';
    }
    if (updateAplicacaoTexto) updateAplicacaoTexto.textContent = dados.mensagem || 'Aguarde enquanto a nova versão é preparada.';
    if (updateAplicacaoBarra) updateAplicacaoBarra.style.width = `${progresso}%`;
    if (updateAplicacaoPercentual) {
      updateAplicacaoPercentual.textContent = dados.fase === 'baixando' ? `${Math.round(progresso)}% concluído` : 'Aguarde…';
    }
    if (instalarLogin) instalarLogin.classList.add('escondido');
  }

  async function solicitarInstalacao() {
    try {
      mostrarEstado({ fase: 'instalando', mensagem: 'Iniciando o instalador da atualização...' });
      const resposta = await window.api?.updateInstalar?.();
      if (!resposta?.sucesso) {
        mostrarEstado({ fase: 'erro', mensagem: resposta?.erro || 'Não foi possível iniciar a instalação.' });
        return;
      }
      mostrarEstado({ fase: 'instalando', mensagem: resposta.mensagem || 'Fechando o Sistema OS para instalar a atualização...' });
    } catch (erro) {
      mostrarEstado({ fase: 'erro', mensagem: erro?.message || 'Não foi possível iniciar a instalação.' });
    }
  }

  async function atualizarTela() {
    if (!window.api?.updateEstado) return;
    try { mostrarEstado(await window.api.updateEstado()); } catch (_) {}
  }

  if (modalConfig) {
    new MutationObserver(() => {
      if (!modalConfig.classList.contains('escondido')) atualizarTela();
    }).observe(modalConfig, { attributes: true, attributeFilter: ['class'] });
  }

  if (telaLogin) {
    new MutationObserver(() => {
      if (ultimoEstadoAtualizacao) mostrarEstado(ultimoEstadoAtualizacao);
    }).observe(telaLogin, { attributes: true, attributeFilter: ['class'] });
  }

  if (window.api?.onupdateStatus) window.api.onupdateStatus(mostrarEstado);

  const verificarAtualizacaoAgora = async () => {
    try { mostrarEstado(await window.api.updateVerificar()); }
    catch (erro) { mostrarEstado({ fase: 'erro', mensagem: erro.message || 'Não foi possível verificar atualizações.' }); }
  };

  if (verificar) verificar.addEventListener('click', verificarAtualizacaoAgora);
  if (verificarSuporte) verificarSuporte.addEventListener('click', verificarAtualizacaoAgora);

  if (instalar) instalar.addEventListener('click', solicitarInstalacao);
  if (instalarLogin) instalarLogin.addEventListener('click', solicitarInstalacao);

  atualizarTela();
})();
// ── Fim do Módulo Atualização ─────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO NOTIFICAÇÕES INTERNAS — Central de Notificações com Sininho
// v31: checkboxes de tipo substituídos por abas (filtro de visualização).
// O badge/contagem de não lidas agora considera todos os tipos sempre.
// ══════════════════════════════════════════════════════════════════════════════
(function () {

  // ── Armazenamento local de notificações ──────────────────────────────────
  const STORAGE_KEY = 'sistemaos_notificacoes_v2';

  function _idEscopoNotificacao() {
    if (usuarioAtual?.administradorGlobal) return 'suporte-global';
    return String(usuarioAtual?.empresaId || usuarioAtual?.id || 'sem-sessao').replace(/[^a-z0-9_-]/gi, '_');
  }
  function _chaveEscopo(base) { return `${base}:${_idEscopoNotificacao()}`; }

  function _carregarNotifs() {
    try { return JSON.parse(localStorage.getItem(_chaveEscopo(STORAGE_KEY)) || '[]'); } catch { return []; }
  }
  function _salvarNotifs(lista) {
    try { localStorage.setItem(_chaveEscopo(STORAGE_KEY), JSON.stringify(lista.slice(0, 200))); } catch {}
  }

  // ── Aba de filtro ativa ("todas" ou um tipo específico) ───────────────────
  let _abaAtiva = 'todas';
  window.trocarAbaNotificacao = function(tipo) {
    _abaAtiva = tipo;
    document.querySelectorAll('#notifAbas .tab-historico-interna').forEach(btn => {
      btn.classList.toggle('ativa', btn.dataset.tipoNotif === tipo);
    });
    _renderizarLista();
  };

  // ── Ícone por tipo ────────────────────────────────────────────────────────
  function _icone(tipo) {
    return { pagamento_confirmado: `${ICONE_CIFRAO}`, mensagem_enviada: `${ICONE_EXPORTAR}`, cobranca: `${ICONE_DOCUMENTO}`, erro: `${ICONE_ALERTA}`, sistema: `${ICONE_INFO}` }[tipo] || `${ICONE_SINO}`;
  }

  // ── Tempo relativo ────────────────────────────────────────────────────────
  function _tempoRelativo(iso) {
    const dataNotificacao = new Date(iso);
    if (Number.isNaN(dataNotificacao.getTime())) return '';
    const diff = Date.now() - dataNotificacao.getTime();
    if (diff < 60000)    return 'agora mesmo';
    if (diff < 3600000)  return `há ${Math.floor(diff/60000)}min`;
    if (diff < 86400000) return `há ${Math.floor(diff/3600000)}h`;
    return dataNotificacao.toLocaleDateString('pt-BR') + ' às ' +
      dataNotificacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Adicionar notificação (API global) ────────────────────────────────────
  window.adicionarNotificacao = function({ tipo, titulo, descricao, osNumero, acao }) {
    if (!usuarioAtual) return;
    const numeroCanonico = osNumero ? normalizarNumeroOSVisual(osNumero) : null;
    const notif = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2,6),
      tipo: tipo || 'sistema',
      titulo: normalizarReferenciasOS(titulo || ''),
      descricao: normalizarReferenciasOS(descricao || ''),
      osNumero: numeroCanonico,
      acao: acao || null,
      lida: false,
      data: new Date().toISOString()
    };
    const lista = _carregarNotifs();
    lista.unshift(notif);
    _salvarNotifs(lista);

    // Atualiza badge e renderiza se a aba estiver aberta
    _atualizarBadge();
    if (!document.getElementById('aba-notificacoes')?.classList.contains('escondido')) {
      _renderizarLista();
    }

    // Toast rápido
    if (typeof toast === 'function') toast(`${_icone(notif.tipo)} ${notif.titulo}`, tipo === 'erro' ? 'erro' : 'sucesso');
  };

  // ── Atualizar badge no sininho ────────────────────────────────────────────
  function _atualizarBadge() {
    const lista = _carregarNotifs();
    const naoLidas = lista.filter(n => !n.lida).length;
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (naoLidas > 0) {
      badge.textContent = naoLidas > 99 ? '99+' : naoLidas;
      badge.classList.remove('escondido');
    } else {
      badge.classList.add('escondido');
    }
  }

  // ── Contagem por aba (para o número ao lado de cada aba) ──────────────────
  function _atualizarContagemAbas() {
    const lista = _carregarNotifs();
    document.querySelectorAll('#notifAbas .tab-historico-interna').forEach(btn => {
      const tipo = btn.dataset.tipoNotif;
      const qtdNaoLidas = tipo === 'todas'
        ? lista.filter(n => !n.lida).length
        : lista.filter(n => n.tipo === tipo && !n.lida).length;
      // Remove contagem anterior do texto do botão, preservando ícones SVG internos
      const svgPartes = [];
      btn.querySelectorAll('svg').forEach(svg => svgPartes.push(svg.outerHTML));
      const textoLimpo = btn.textContent.replace(/\s*\(\d+\)$/, '').trim();
      btn.innerHTML = svgPartes.join(' ') + (svgPartes.length ? ' ' : '') + textoLimpo + (qtdNaoLidas > 0 ? ` (${qtdNaoLidas})` : '');
    });
  }

  // ── Renderizar lista de notificações (filtrada pela aba ativa) ────────────
  function _renderizarLista() {
    const lista  = _carregarNotifs();
    const el     = document.getElementById('notifLista');
    if (!el) return;

    const visiveis = _abaAtiva === 'todas' ? lista : lista.filter(n => n.tipo === _abaAtiva);

    _atualizarContagemAbas();

    if (!visiveis.length) {
      el.innerHTML = '<p style="color:var(--texto-sec);text-align:center;padding:40px 0;">Nenhuma notificação para exibir.</p>';
      return;
    }

    el.innerHTML = visiveis.map(n => `
      <div class="notif-card ${n.lida ? '' : 'nao-lida'} tipo-${n.tipo}${n.acao ? ' notif-acionavel' : ''}" data-notif-id="${n.id}" ${n.acao ? `role="button" tabindex="0" onclick="window._abrirNotificacao('${n.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window._abrirNotificacao('${n.id}')}"` : ''}>
        <div class="notif-icone">${_icone(n.tipo)}</div>
        <div class="notif-corpo">
          <div class="notif-titulo">${_renderComIcones(normalizarReferenciasOS(n.titulo))}</div>
          ${n.descricao ? `<div class="notif-desc">${_renderComIcones(normalizarReferenciasOS(n.descricao))}</div>` : ''}
          ${n.osNumero ? `<div class="notif-desc">${normalizarNumeroOSVisual(n.osNumero)}</div>` : ''}
          <div class="notif-tempo">${_tempoRelativo(n.data)}</div>
        </div>
        ${!n.lida ? `<button class="notif-lida-btn" onclick="window._marcarNotifLida('${n.id}')" title="Marcar como lida">${ICONE_CHECK}</button>` : ''}
      </div>
    `).join('');
  }

  // ── Marcar uma notificação como lida ─────────────────────────────────────
  window._marcarNotifLida = function(id) {
    const lista = _carregarNotifs();
    const idx = lista.findIndex(n => n.id === id);
    if (idx !== -1) { lista[idx].lida = true; _salvarNotifs(lista); }
    _atualizarBadge();
    _renderizarLista();
  };

  window._abrirNotificacao = function(id) {
    const lista = _carregarNotifs();
    const notif = lista.find((item) => item.id === id);
    if (!notif) return;
    if (!notif.lida) {
      notif.lida = true;
      _salvarNotifs(lista);
      _atualizarBadge();
      _renderizarLista();
    }
    if (notif.acao === 'abrir_assinatura') window.SistemaOSAssinaturasUI?.abrir?.();
    if (notif.acao === 'abrir_cobranca' && notif.osNumero) {
      document.querySelector('[data-aba="historico"]')?.click();
      setTimeout(() => window.verDetalheOS?.(notif.osNumero), 120);
    }
  };

  // ── Botões da aba de notificações ─────────────────────────────────────────
  document.getElementById('btnNotifMarcarLidas')?.addEventListener('click', () => {
    const lista = _carregarNotifs().map(n => ({ ...n, lida: true }));
    _salvarNotifs(lista);
    _atualizarBadge();
    _atualizarContagemAbas(); // BUGFIX: atualiza contagem nas abas após marcar todas como lidas
    _renderizarLista();
  });

  document.getElementById('btnNotifLimpar')?.addEventListener('click', () => {
    if (!confirm('Apagar todas as notificações?')) return;
    _salvarNotifs([]);
    _atualizarBadge();
    _renderizarLista();
  });

  // ── Ao abrir a aba, renderiza (não marca mais como lida automaticamente —
  //    cada notificação só é marcada como lida explicitamente pelo botão ✅
  //    ou por "Marcar todas como lidas") ─────────────────────────────────────
  document.querySelector('[data-aba="notificacoes"]')?.addEventListener('click', () => {
    setTimeout(() => {
      _renderizarLista();
    }, 100);
  });

  // ── Lembretes de cobrança das OS ──────────────────────────────────────────
  const STORAGE_LEMBRETES = 'sistemaos_lembretes_cobranca_notificados_v2';
  async function _verificarLembretesCobranca() {
    // A central global de suporte não pertence a uma assistência e jamais
    // pode herdar cobranças de OS da última empresa aberta neste computador.
    if (!window.api?.oslistar || !usuarioAtual || usuarioAtual.administradorGlobal || usuarioAtual.acessoSomenteCobranca) return;
    try {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const chaveLembretes = _chaveEscopo(STORAGE_LEMBRETES);
      const enviados = JSON.parse(localStorage.getItem(chaveLembretes) || '{}');
      const ordens = await window.api.oslistar();
      for (const os of (ordens || [])) {
        const total = Number(os.valorTotalServico || os.diagnosticoTecnico?.valorEstimado || 0);
        const recebido = Number(os.valorRecebidoConfirmado || 0);
        const falta = Math.max(0, total - recebido);
        if (!(falta > 0)) continue;
        for (const lembrete of (os.lembretesCobranca || [])) {
          const situacao = String(lembrete?.status || '').toLowerCase();
          if (!lembrete?.data || lembrete.confirmadoEm || lembrete.pagoEm || situacao === 'paga' || situacao === 'desativada') continue;
          const data = new Date(`${lembrete.data}T00:00:00`);
          if (!Number.isFinite(data.getTime()) || data > hoje) continue;
          const estado = data < hoje ? 'atrasada' : 'para hoje';
          const chave = `${os.numero}:${lembrete.id || lembrete.data}:${estado}`;
          if (enviados[chave]) continue;
          const valor = Number(lembrete.valor || 0) || falta;
          window.adicionarNotificacao({
            tipo: 'cobranca',
            titulo: `Cobrança ${estado}: ${os.numero}`,
            descricao: `${os.cliente?.nome || 'Cliente'} · ${fmtMoeda(Math.min(valor, falta))} · falta ${fmtMoeda(falta)}. Clique para abrir.`,
            osNumero: os.numero,
            acao: 'abrir_cobranca'
          });
          enviados[chave] = new Date().toISOString();
        }
      }
      localStorage.setItem(chaveLembretes, JSON.stringify(enviados));
    } catch (erro) {
      console.warn('[Cobrança] Não foi possível atualizar os lembretes:', erro?.message || erro);
    }
  }

  // ── Inicializa badge e lembretes ao carregar ──────────────────────────────
  setTimeout(_atualizarBadge, 2000);
  setTimeout(_verificarLembretesCobranca, 3500);
  setInterval(_verificarLembretesCobranca, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _verificarLembretesCobranca();
  });
  document.addEventListener('sistemaos:sessao-pronta', () => {
    _atualizarBadge();
    _renderizarLista();
    _verificarLembretesCobranca();
  });

})();
// ══ Fim Módulo Notificações ══════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// MÓDULO: DESENHAR PADRÃO DE PIN (campos de senha do aparelho)
// ──────────────────────────────────────────────────────────────────────────
// Abre um modal com uma grade 3x3, o usuário arrasta o dedo/mouse pelos
// pontos na ordem do padrão, e ao salvar o padrão é convertido em texto
// (ex: "Padrão: 1-2-3-6-9") e colocado no campo de senha alvo — que continua
// sendo um <input type="text"> comum, então tudo mais no sistema (salvar OS,
// PDFs, etc.) funciona sem nenhuma outra mudança.
// ══════════════════════════════════════════════════════════════════════════
(function moduloPinPadrao() {
  const NS = 'http://www.w3.org/2000/svg';
  const RAIO_PONTO = 10;
  const RAIO_TOQUE = 26; // área sensível ao toque, maior que o ponto visual
  // Posições dos 9 pontos numa grade 3x3 dentro do viewBox 240x240
  const POSICOES = [40, 120, 200].flatMap(y => [40, 120, 200].map(x => ({ x, y })))
    .map((p, i) => ({ ...p, num: i + 1 }));

  let svg, linhaAtiva, resumoEl, erroEl, campoAlvoId = null;
  let sequencia = [];      // ex: [1,2,3,6,9]
  let linhasFixas = [];    // elementos <line> já desenhados
  let arrastando = false;

  function montarSvgSeNecessario() {
    svg = $('pinSvg');
    linhaAtiva = $('pinLinhaAtiva');
    resumoEl = $('pinResumo');
    erroEl = $('pinErro');
    if (svg.dataset.montado === '1') return;
    svg.dataset.montado = '1';

    POSICOES.forEach(p => {
      const g = document.createElementNS(NS, 'g');
      g.dataset.num = p.num;

      const circExterno = document.createElementNS(NS, 'circle');
      circExterno.setAttribute('cx', p.x);
      circExterno.setAttribute('cy', p.y);
      circExterno.setAttribute('r', RAIO_PONTO);
      circExterno.setAttribute('class', 'pin-ponto');
      circExterno.dataset.num = p.num;

      const nucleo = document.createElementNS(NS, 'circle');
      nucleo.setAttribute('cx', p.x);
      nucleo.setAttribute('cy', p.y);
      nucleo.setAttribute('r', 3.5);
      nucleo.setAttribute('class', 'pin-ponto-nucleo-fill');
      nucleo.dataset.num = p.num;

      // área invisível maior, só pra facilitar acertar o ponto no toque
      const areaToque = document.createElementNS(NS, 'circle');
      areaToque.setAttribute('cx', p.x);
      areaToque.setAttribute('cy', p.y);
      areaToque.setAttribute('r', RAIO_TOQUE);
      areaToque.setAttribute('fill', 'transparent');
      areaToque.dataset.num = p.num;

      g.appendChild(circExterno);
      g.appendChild(nucleo);
      g.appendChild(areaToque);
      svg.insertBefore(g, linhaAtiva);
    });
  }

  function pontoPorNum(num) { return POSICOES.find(p => p.num === num); }

  function pontoSobPosicao(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const escalaX = 240 / rect.width, escalaY = 240 / rect.height;
    const x = (clientX - rect.left) * escalaX;
    const y = (clientY - rect.top) * escalaY;
    let alvo = null, menorDist = Infinity;
    POSICOES.forEach(p => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= RAIO_TOQUE && d < menorDist) { menorDist = d; alvo = p; }
    });
    return alvo;
  }

  function marcarPontoAtivo(num) {
    svg.querySelectorAll(`.pin-ponto[data-num="${num}"]`).forEach(el => el.classList.add('ativo'));
  }

  function desenharLinhaFixa(a, b) {
    const linha = document.createElementNS(NS, 'line');
    linha.setAttribute('x1', a.x); linha.setAttribute('y1', a.y);
    linha.setAttribute('x2', b.x); linha.setAttribute('y2', b.y);
    linha.setAttribute('class', 'pin-linha-fixa');
    svg.insertBefore(linha, linhaAtiva);
    linhasFixas.push(linha);
  }

  function atualizarResumo() {
    erroEl.classList.add('escondido');
    resumoEl.textContent = sequencia.length ? `Padrão: ${sequencia.join('-')}` : '';
  }

  function limparDesenho() {
    sequencia = [];
    arrastando = false;
    linhasFixas.forEach(l => l.remove());
    linhasFixas = [];
    svg.querySelectorAll('.pin-ponto').forEach(el => el.classList.remove('ativo'));
    linhaAtiva.style.display = 'none';
    atualizarResumo();
  }

  function registrarPonto(p) {
    if (!p) return;
    if (sequencia.includes(p.num)) return; // não repete ponto já usado
    if (sequencia.length > 0) {
      const anterior = pontoPorNum(sequencia[sequencia.length - 1]);
      desenharLinhaFixa(anterior, p);
    }
    sequencia.push(p.num);
    marcarPontoAtivo(p.num);
    atualizarResumo();
  }

  // Lê "Padrão: 1-5-9-8-7" do campo alvo (se já tiver um padrão salvo) e
  // devolve os números como array, ou [] se o campo estiver vazio/não for
  // nesse formato (senha digitada à mão, por exemplo — nesse caso não há
  // nada pra pré-desenhar, e a tela simplesmente abre limpa como já era).
  function lerPadraoExistente(valorCampo) {
    const m = /^Padrão:\s*([1-9](?:-[1-9]){1,8})\s*$/.exec((valorCampo || '').trim());
    if (!m) return [];
    const nums = m[1].split('-').map(Number);
    // Defesa: garante 1..9 sem repetição (um valor editado à mão poderia
    // ter número fora da grade ou repetido) — se algo não bater, trata
    // como "não reconhecido" em vez de desenhar um padrão inválido.
    const vistos = new Set();
    for (const n of nums) {
      if (n < 1 || n > 9 || vistos.has(n)) return [];
      vistos.add(n);
    }
    return nums;
  }

  // Redesenha um padrão já existente (pontos ativos + linhas fixas
  // conectando-os, na ordem original) sem precisar de arrasto — mesmo
  // efeito visual de tê-lo acabado de desenhar. Usado ao reabrir a tela
  // com um campo que já tem um padrão salvo, pra a pessoa ver o que já
  // estava lá em vez de começar sempre do zero.
  function redesenharPadrao(nums) {
    nums.forEach(num => registrarPonto(pontoPorNum(num)));
  }

  function coordsDoEvento(ev) {
    if (ev.touches && ev.touches[0]) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    return { x: ev.clientX, y: ev.clientY };
  }

  function aoIniciar(ev) {
    ev.preventDefault();
    limparDesenho();
    arrastando = true;
    const { x, y } = coordsDoEvento(ev);
    registrarPonto(pontoSobPosicao(x, y));
  }

  function aoMover(ev) {
    if (!arrastando) return;
    ev.preventDefault();
    const { x, y } = coordsDoEvento(ev);
    const rect = svg.getBoundingClientRect();
    const escalaX = 240 / rect.width, escalaY = 240 / rect.height;

    if (sequencia.length > 0) {
      const ultimo = pontoPorNum(sequencia[sequencia.length - 1]);
      linhaAtiva.style.display = '';
      linhaAtiva.setAttribute('x1', ultimo.x);
      linhaAtiva.setAttribute('y1', ultimo.y);
      linhaAtiva.setAttribute('x2', (x - rect.left) * escalaX);
      linhaAtiva.setAttribute('y2', (y - rect.top) * escalaY);
    }

    const p = pontoSobPosicao(x, y);
    if (p) registrarPonto(p);
  }

  function aoSoltar() {
    if (!arrastando) return;
    arrastando = false;
    linhaAtiva.style.display = 'none';
  }

  function abrirModalPin(idCampoAlvo) {
    montarSvgSeNecessario();
    campoAlvoId = idCampoAlvo;
    limparDesenho();
    // Se o campo já tiver um padrão salvo (ex.: reabrir pra conferir ou
    // trocar), desenha ele de cara em vez de abrir sempre em branco.
    const campo = campoAlvoId ? $(campoAlvoId) : null;
    const numsExistentes = lerPadraoExistente(campo ? campo.value : '');
    if (numsExistentes.length) redesenharPadrao(numsExistentes);
    $('modalPin').classList.remove('escondido');
  }

  function salvarPadrao() {
    if (sequencia.length < 2) {
      erroEl.classList.remove('escondido');
      return;
    }
    const campo = campoAlvoId ? $(campoAlvoId) : null;
    if (campo) {
      campo.value = `Padrão: ${sequencia.join('-')}`;
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      campo.dispatchEvent(new Event('change', { bubbles: true }));
    }
    $('modalPin').classList.add('escondido');
    toast('Padrão salvo no campo de senha!', 'sucesso');
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Sincronização do campo "Tamanho da fonte dos termos nos PDFs"
    // (range + número + botão Restaurar). 0/vazio = usar fábrica.
    const fonteTermosRange = $('tamanhoFonteTermosPdfRange');
    const fonteTermosNum   = $('tamanhoFonteTermosPdf');
    const btnRestaurarFonteTermos = $('btnRestaurarFonteTermos');
    if (fonteTermosRange && fonteTermosNum) {
      fonteTermosRange.addEventListener('input', () => {
        fonteTermosNum.value = fonteTermosRange.value;
      });
      fonteTermosNum.addEventListener('input', () => {
        const v = parseFloat(fonteTermosNum.value);
        if (!isNaN(v)) fonteTermosRange.value = String(v);
      });
    }
    if (btnRestaurarFonteTermos && fonteTermosNum && fonteTermosRange) {
      btnRestaurarFonteTermos.addEventListener('click', () => {
        fonteTermosNum.value = '';
        fonteTermosRange.value = '7.8';
      });
    }

    document.querySelectorAll('.botao-pin[data-alvo-pin]').forEach(btn => {
      btn.addEventListener('click', () => abrirModalPin(btn.dataset.alvoPin));
    });

    const svgEl = $('pinSvg');
    if (svgEl) {
      svgEl.addEventListener('mousedown', aoIniciar);
      svgEl.addEventListener('mousemove', aoMover);
      window.addEventListener('mouseup', aoSoltar);
      svgEl.addEventListener('touchstart', aoIniciar, { passive: false });
      svgEl.addEventListener('touchmove', aoMover, { passive: false });
      svgEl.addEventListener('touchend', aoSoltar);
    }

    $('btnPinLimpar')?.addEventListener('click', limparDesenho);
    $('btnPinSalvar')?.addEventListener('click', salvarPadrao);
  });
})();
// ══ Fim Módulo Padrão de PIN ═════════════════════════════════════════════════



// ══════════════════════════════════════════════════════════════════════════════
// v41 — CHATBOT FLUTUANTE (Assistente IA / Groq)
// Botão arrastável (Pointer Events, mouse + touch), visível em todas as telas
// (o HTML fica fora das .aba, no root do <body>). Reaproveita:
//   - window.api.iaperguntar → main.js → src/ia-chat.js → mesma infraestrutura
//     de rede de src/ia-groq.js (nenhuma chamada HTTP nova neste arquivo);
//   - window.api.configobter → mesmo canal já usado na tela de Configurações,
//     só pra avisar o usuário se a chave da Groq ainda não foi configurada;
//   - $() e a classe .escondido, já usados no resto do sistema para modais.
// ══════════════════════════════════════════════════════════════════════════════
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const widget      = $('iaChatWidget');
    const botao       = $('iaChatBotao');
    const painel      = $('iaChatPainel');
    const cabecalho   = $('iaChatCabecalho');
    const mensagensEl = $('iaChatMensagens');
    const digitandoEl = $('iaChatDigitando');
    const inputEl     = $('iaChatInput');
    const enviarBtn   = $('iaChatEnviar');
    const limparBtn   = $('iaChatLimpar');
    const fecharBtn   = $('iaChatFechar');
    if (!widget || !botao || !painel || !window.api?.iaperguntar) return; // não quebra o resto do app se algo faltar

    let historico = [];
    let primeiraAberturaFeita = false;

    function fixarChatNoCanto() {
      widget.style.removeProperty('left');
      widget.style.removeProperty('top');
      widget.style.removeProperty('right');
      widget.style.removeProperty('bottom');
      try { localStorage.removeItem('iaChatPos'); } catch (_) {}
    }
    fixarChatNoCanto();
    window.addEventListener('resize', fixarChatNoCanto);

    // ── Arraste do widget inteiro (botão quando fechado, cabeçalho quando aberto) ──
    let arrastando = false, moveuBastante = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    function iniciarArraste(e) {
      return;
      arrastando = true; moveuBastante = false;
      const rect = widget.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
    }
    function moverArraste(e) {
      if (!arrastando) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moveuBastante = true;
      if (!moveuBastante) return;
      const largura = widget.offsetWidth, altura = widget.offsetHeight;
      const novoLeft = Math.min(Math.max(8, startLeft + dx), window.innerWidth - largura - 8);
      const novoTop  = Math.min(Math.max(8, startTop + dy), window.innerHeight - altura - 8);
      widget.style.left = novoLeft + 'px';
      widget.style.top = novoTop + 'px';
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';
    }
    function finalizarArraste() {
      if (!arrastando) return;
      arrastando = false;
      if (moveuBastante) {
        try { localStorage.setItem('iaChatPos', JSON.stringify({ left: widget.style.left, top: widget.style.top })); } catch (e) {}
      }
    }

    botao.addEventListener('pointerdown', iniciarArraste);
    cabecalho?.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return; // clique nos botões do cabeçalho não deve iniciar arraste
      iniciarArraste(e);
    });
    window.addEventListener('pointermove', moverArraste);
    window.addEventListener('pointerup', finalizarArraste);

    // Restaura a última posição arrastada (se houver)
    try {
      const posSalva = JSON.parse(localStorage.getItem('iaChatPos') || 'null');
      if (posSalva?.left && posSalva?.top) {
        widget.style.left = posSalva.left;
        widget.style.top = posSalva.top;
        widget.style.right = 'auto';
        widget.style.bottom = 'auto';
      }
    } catch (e) {}

    // ── Abrir / fechar painel ──────────────────────────────────────────────
    function adicionarMensagem(texto, tipo) {
      const bolha = document.createElement('div');
      bolha.className = 'iaChatMsg iaChatMsg-' + tipo;
      // O chat preserva ícones internos confiáveis e renderiza **negrito**
      // sem liberar HTML produzido pela IA ou digitado pelo usuário.
      bolha.innerHTML = _renderMarkdownSeguro(texto);
      mensagensEl.appendChild(bolha);
      mensagensEl.scrollTop = mensagensEl.scrollHeight;
      return bolha;
    }

    function mensagemBoasVindas() {
      adicionarMensagem('Olá! Sou o assistente do Sistema OS. Posso consultar OS, clientes, estoque, compras, financeiro e sua assinatura, além de explicar como usar o sistema.', 'ia');
    }

    async function primeiraAbertura() {
      mensagemBoasVindas();
      try {
        const config = await window.api.configobter();
        // v46: chatbot usa chave própria (possuiGroqChatKey), independente
        // da chave/toggle de classificação de pagamento do WhatsApp.
        const provedor = config?.iaChatProvider || 'groq';
        const possuiChave = provedor === 'openai' ? config?.possuiOpenAIKey
          : provedor === 'anthropic' ? config?.possuiAnthropicKey
          : provedor === 'deepseek' ? config?.possuiDeepSeekKey
          : config?.possuiGroqChatKey || config?.possuiGroqKey;
        if (!possuiChave) {
          adicionarMensagem(`${ICONE_ALERTA} A IA ainda não está configurada. Vá em Configurações → Integração IA — Assistente de Chat para ativar o assistente.`, 'erro');
        }
      } catch (e) { /* não bloqueia o chat por falha ao checar configuração */ }
    }

    function abrirPainel() {
      fixarChatNoCanto();
      painel.classList.remove('escondido');
      painel.setAttribute('aria-hidden', 'false');
      botao.setAttribute('aria-expanded', 'true');
      botao.setAttribute('aria-label', 'Fechar assistente IA');
      if (!primeiraAberturaFeita) { primeiraAberturaFeita = true; primeiraAbertura(); }
      inputEl.focus();
    }
    function fecharPainel() {
      painel.classList.add('escondido');
      painel.setAttribute('aria-hidden', 'true');
      botao.setAttribute('aria-expanded', 'false');
      botao.setAttribute('aria-label', 'Abrir assistente IA');
      fixarChatNoCanto();
    }

    botao.addEventListener('click', () => {
      if (moveuBastante) return;
      // Microanimação da marca do assistente a cada clique real (não arraste).
      botao.classList.remove('iaChatBotaoAnimando');
      void botao.offsetWidth; // força reflow para poder reiniciar a animação em cliques seguidos
      botao.classList.add('iaChatBotaoAnimando');
      botao.addEventListener('animationend', () => botao.classList.remove('iaChatBotaoAnimando'), { once: true });
      painel.classList.contains('escondido') ? abrirPainel() : fecharPainel();
    });
    fecharBtn?.addEventListener('click', fecharPainel);
    limparBtn?.addEventListener('click', () => {
      historico = [];
      mensagensEl.innerHTML = '';
      mensagemBoasVindas();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !painel.classList.contains('escondido')) fecharPainel();
    });

    // ── Enviar pergunta ──────────────────────────────────────────────────────
    async function responderAssinaturaSeNecessario(pergunta) {
      const simples = String(pergunta || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const assunto = /\b(assinatura|plano|vencimento|vence|vencer|renovar|renovacao|mais tempo|pagar agora|mensalidade|upgrade|downgrade)\b/.test(simples);
      if (!assunto || !window.SistemaOSAssinaturasUI) return false;
      await window.SistemaOSAssinaturasUI.carregar();
      const dados = window.SistemaOSAssinaturasUI.obterResumoParaAssistente();
      if (!dados) {
        adicionarMensagem('Não consegui consultar sua assinatura agora. Tente novamente em instantes.', 'erro');
        return true;
      }
      const querPagar = /\b(pagar|renovar|mais tempo|upgrade|downgrade|mudar plano|trocar plano)\b/.test(simples);
      if (querPagar) {
        adicionarMensagem(`Seu plano atual é **${dados.plano}** e o vencimento é **${dados.vencimento}**. Vou abrir as opções para você continuar no mesmo plano, melhorar ou escolher um mais econômico.`, 'ia');
        await window.SistemaOSAssinaturasUI.abrir();
      } else {
        const prazo = dados.diasRestantes == null ? '' : dados.diasRestantes < 0
          ? ' A assinatura está vencida.'
          : dados.diasRestantes === 0 ? ' Ela vence hoje.' : ` Faltam ${dados.diasRestantes} dia(s).`;
        adicionarMensagem(`Seu plano é **${dados.plano}** e vence em **${dados.vencimento}**.${prazo} Se quiser, diga **“pagar agora”** para ver os planos e gerar o link.`, 'ia');
      }
      historico.push({ role: 'user', content: pergunta }, { role: 'assistant', content: `Assinatura consultada: ${dados.plano}, vencimento ${dados.vencimento}.` });
      return true;
    }

    async function enviarPergunta() {
      const texto = inputEl.value.trim();
      if (!texto) return;
      inputEl.value = '';
      enviarBtn.disabled = true;
      enviarBtn.setAttribute('aria-busy', 'true');
      inputEl.disabled = true;
      adicionarMensagem(texto, 'usuario');
      digitandoEl.classList.remove('escondido');
      mensagensEl.scrollTop = mensagensEl.scrollHeight;

      try {
        if (await responderAssinaturaSeNecessario(texto)) return;
        const r = await window.api.iaperguntar(texto, historico);
        if (r?.sucesso) {
          adicionarMensagem(r.resposta, 'ia');
          historico.push({ role: 'user', content: texto }, { role: 'assistant', content: r.resposta });
          if (historico.length > 16) historico = historico.slice(-16);
          if (r.acaoProposta) renderizarCartaoAcao(r.acaoProposta);
        } else {
          adicionarMensagem(r?.erro || 'Não consegui responder agora.', 'erro');
        }
      } catch (e) {
        console.error('[IA-Chat] Falha ao consultar ou montar a resposta:', e);
        adicionarMensagem('Não consegui concluir esta solicitação agora. Tente novamente.', 'erro');
      } finally {
        digitandoEl.classList.add('escondido');
        enviarBtn.disabled = false;
        enviarBtn.setAttribute('aria-busy', 'false');
        inputEl.disabled = false;
        inputEl.focus();
      }
    }

    enviarBtn.addEventListener('click', enviarPergunta);
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); enviarPergunta(); } });

    // ══════════════════════════════════════════════════════════════════════
    // v42 — PARTE 2: confirmação de ações da IA (criar / alterar status /
    // excluir OS). A IA nunca executa nada sozinha — ia:perguntar só devolve
    // uma PROPOSTA (acaoProposta). Aqui montamos um cartão dentro da própria
    // bolha do chat, com um resumo legível da ação e os botões
    // Confirmar/Cancelar. Só ao clicar em Confirmar chamamos
    // window.api.iaexecutaracao — e, para exclusão, reaproveitamos o mesmo
    // modal de senha (promptModal + configverificarsenhaexclusao) já usado
    // pela exclusão manual de OS (ver window.excluirOS acima nesse arquivo).
    // ══════════════════════════════════════════════════════════════════════
    function _resumoAcao(acao) {
      if (acao.tipo === 'criar_os') {
        const c = acao.dados.cliente, a = acao.dados.aparelho;
        const aparelhoTxt = [a.marca, a.modelo].filter(Boolean).join(' ') || 'aparelho não especificado';
        return {
          titulo: 'Criar nova OS',
          linhas: [
            `Cliente: ${c.nome}`,
            c.telefone ? `Telefone: ${c.telefone}` : null,
            `Aparelho: ${aparelhoTxt}`,
            `Defeito: ${a.defeitoRelatado}`,
            acao.dados.observacoes ? `Obs.: ${acao.dados.observacoes}` : null
          ].filter(Boolean)
        };
      }
      if (acao.tipo === 'alterar_status_os') {
        return {
          titulo: `${ICONE_SYNC} Alterar status de OS`,
          linhas: [`OS: ${acao.dados.numero}`, `Novo status: ${acao.dados.novoStatus}`]
        };
      }
      if (acao.tipo === 'excluir_os') {
        return {
          titulo: `${ICONE_LIXEIRA} Excluir OS`,
          linhas: [`OS: ${acao.dados.numero}`, 'Esta ação NÃO pode ser desfeita.']
        };
      }
      if (acao.tipo === 'enviar_mensagem_whatsapp') {
        return {
          titulo: `${ICONE_BALAO} Enviar mensagem WhatsApp`,
          linhas: [`OS: ${acao.dados.numero}`, 'Revise o texto abaixo antes de enviar:']
        };
      }
      if (acao.tipo === 'adicionar_custos_compra') {
        const total = (acao.dados.itens || []).reduce((soma, item) => soma + (Number(item.valor) || 0), 0);
        return {
          titulo: `${ICONE_LAPIS} Adicionar custos à compra`,
          linhas: [
            `Compra: ${acao.dados.numero}`,
            ...(acao.dados.itens || []).map(item => `${item.nome}: ${fmtMoeda(Number(item.valor) || 0)}`),
            `Total a acrescentar: ${fmtMoeda(total)}`,
            'Os custos já registrados serão preservados.'
          ]
        };
      }
      if (acao.tipo === 'alterar_status_cobranca') {
        return {
          titulo: `${ICONE_CIFRAO} Alterar cobrança`,
          linhas: [
            `OS: ${acao.dados.numero}`,
            `Vencimento: ${fmtData(acao.dados.data)}`,
            `Nova situação: ${String(acao.dados.novoStatus || '').replace(/^./, letra => letra.toUpperCase())}`
          ]
        };
      }
      return { titulo: 'Ação', linhas: [] };
    }

    function renderizarCartaoAcao(acao) {
      const { titulo, linhas } = _resumoAcao(acao);

      const cartao = document.createElement('div');
      cartao.className = 'iaChatMsg iaChatAcaoCartao' + (acao.tipo === 'excluir_os' ? ' iaChatAcaoCartao-perigo' : '');

      const h = document.createElement('div');
      h.className = 'iaChatAcaoTitulo';
      // Os títulos são internos e os ícones são SVGs do próprio sistema.
      // textContent mostrava o SVG como código em vez de desenhá-lo.
      h.innerHTML = titulo;
      cartao.appendChild(h);

      const ul = document.createElement('ul');
      ul.className = 'iaChatAcaoLinhas';
      linhas.forEach(l => { const li = document.createElement('li'); li.textContent = l; ul.appendChild(li); });
      cartao.appendChild(ul);

      // Para propostas de mensagem WhatsApp, o texto sugerido pela IA fica
      // num textarea editável — o usuário pode ajustar livremente antes de
      // confirmar o envio (a IA nunca envia direto, só sugere o texto).
      let textareaMsg = null;
      if (acao.tipo === 'enviar_mensagem_whatsapp') {
        textareaMsg = document.createElement('textarea');
        textareaMsg.className = 'iaChatAcaoTextarea';
        textareaMsg.value = acao.dados.mensagem || '';
        textareaMsg.rows = 6;
        cartao.appendChild(textareaMsg);
      }

      const acoesEl = document.createElement('div');
      acoesEl.className = 'iaChatAcaoBotoes';
      const btnCancelar = document.createElement('button');
      btnCancelar.className = 'botao botao-fantasma';
      btnCancelar.textContent = 'Cancelar';
      const btnConfirmar = document.createElement('button');
      btnConfirmar.className = acao.tipo === 'excluir_os' ? 'botao botao-perigo' : 'botao botao-primario';
      btnConfirmar.textContent = acao.tipo === 'excluir_os' ? 'Excluir definitivamente' : (acao.tipo === 'enviar_mensagem_whatsapp' ? 'Enviar mensagem' : 'Confirmar');
      acoesEl.appendChild(btnCancelar);
      acoesEl.appendChild(btnConfirmar);
      cartao.appendChild(acoesEl);

      mensagensEl.appendChild(cartao);
      mensagensEl.scrollTop = mensagensEl.scrollHeight;

      btnCancelar.addEventListener('click', () => {
        acoesEl.remove();
        const aviso = document.createElement('div');
        aviso.className = 'iaChatAcaoStatus';
        aviso.textContent = 'Ação cancelada.';
        cartao.appendChild(aviso);
      });

      btnConfirmar.addEventListener('click', async () => {
        let autorizacaoExclusao = { tipo: 'sem_senha' };
        if (acao.tipo === 'excluir_os') {
          autorizacaoExclusao = await autorizarExclusaoProtegida(`a ${acao.dados.numero}`, { retornarCredencial: true });
          if (!autorizacaoExclusao) return;
        }

        // Para mensagem de WhatsApp, usa o texto tal como está no textarea
        // no momento da confirmação — se o usuário editou, é o texto editado
        // que vai (nunca o original sugerido pela IA, se ele mudou algo).
        let acaoParaEnviar = acao;
        if (acao.tipo === 'enviar_mensagem_whatsapp' && textareaMsg) {
          const mensagemEditada = textareaMsg.value.trim();
          if (!mensagemEditada) {
            alert('A mensagem não pode ficar vazia.');
            return;
          }
          acaoParaEnviar = { ...acao, dados: { ...acao.dados, mensagem: mensagemEditada } };
        }

        btnConfirmar.disabled = true;
        btnCancelar.disabled = true;
        btnConfirmar.textContent = 'Processando...';

        try {
          const r = await window.api.iaexecutaracao(acaoParaEnviar, usuarioAtual?.nome || usuarioAtual?.login || 'não identificado', autorizacaoExclusao);
          acoesEl.remove();
          const status = document.createElement('div');
          if (r?.sucesso) {
            status.className = 'iaChatAcaoStatus iaChatAcaoStatus-ok';
            if (acao.tipo === 'criar_os') status.innerHTML = `${ICONE_CHECK} OS ${r.os?.numero || ''} criada com sucesso.`;
            else if (acao.tipo === 'alterar_status_os') status.innerHTML = `${ICONE_CHECK} Status da ${acao.dados.numero} atualizado para "${acao.dados.novoStatus}".`;
            else if (acao.tipo === 'excluir_os') status.innerHTML = `${ICONE_CHECK} OS ${acao.dados.numero} excluída com sucesso.`;
            else if (acao.tipo === 'enviar_mensagem_whatsapp') status.innerHTML = `${ICONE_CHECK} Mensagem enviada para o cliente da ${acao.dados.numero}.`;
            else if (acao.tipo === 'adicionar_custos_compra') status.innerHTML = `${ICONE_CHECK} Custos confirmados na ${acao.dados.numero}. Adicionado agora: ${fmtMoeda(r.custoAdicionado || 0)}. Custo acumulado das peças: ${fmtMoeda(r.custoTotal || 0)}. Total investido: ${fmtMoeda(r.valorTotal || 0)}.`;
            else if (acao.tipo === 'alterar_status_cobranca') status.innerHTML = `${ICONE_CHECK} Cobrança da ${acao.dados.numero} marcada como ${_escHtml(acao.dados.novoStatus)}.`;
            else status.innerHTML = `${ICONE_CHECK} Ação concluída.`;
            // Atualiza as telas relevantes se estiverem carregadas, mesmo padrão do excluirOS/salvar OS manual.
            if (acao.tipo === 'adicionar_custos_compra') {
              await Promise.allSettled([
                Promise.resolve().then(() => carregarCompras()),
                Promise.resolve().then(() => carregarDashboardEstoque()),
                Promise.resolve().then(() => carregarRelatorios()),
                Promise.resolve().then(() => window.carregarPainel?.())
              ]);
            } else {
              if (typeof carregarHistorico === 'function') carregarHistorico();
              if (typeof window.carregarAutorizadas === 'function') window.carregarAutorizadas();
            }
          } else {
            status.className = 'iaChatAcaoStatus iaChatAcaoStatus-erro';
            status.innerHTML = `${ICONE_X} ` + _escHtml(r?.erro || 'Não foi possível concluir a ação.');
          }
          cartao.appendChild(status);
          mensagensEl.scrollTop = mensagensEl.scrollHeight;
        } catch (e) {
          acoesEl.remove();
          const status = document.createElement('div');
          status.className = 'iaChatAcaoStatus iaChatAcaoStatus-erro';
          status.innerHTML = `${ICONE_X} Não foi possível concluir a ação agora.`;
          cartao.appendChild(status);
        }
      });
    }
  });
})();
// ══ Fim Módulo Chatbot Flutuante (IA) ════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════

// ══ Barra de abas: arrastar com o mouse (drag-to-scroll) ═════════════════════
// A nav de abas (.abas) tem mais botões do que cabem na largura da janela em
// telas menores — ela já rola horizontalmente (overflow-x:auto, ver
// style.css), mas depender só da scrollbar/shift+scroll não é óbvio pra quem
// usa mouse. Isso adiciona "clique e arraste" na própria barra.
//
// BUG CORRIGIDO AQUI: a versão anterior adicionava a classe .abas-arrastando
// durante o arraste, que via CSS (.abas.abas-arrastando .aba { pointer-events:
// none }) desligava TODOS os botões de aba. Resultado: ao clicar e mover um
// pouquinho o mouse antes de soltar, o navegador ainda tentava disparar o
// click; como a aba embaixo do cursor tinha ficado pointer-events:none durante
// o movimento, o click acabava se mandando para a aba adjacente — o usuário
// clicava numa e "entrava" nela e na de baixo ao mesmo tempo. A supressão do
// click via setTimeout(0) era frágil (ordem de eventos do navegador não é
// garantida) e não cobria todos os casos.
//
// Nova abordagem:
//  - NUNCA mexemos em pointer-events das .aba.
//  - Se o mouse se mover além do limiar durante o mousedown, marcamos
//    `suprimirProximoClick = true`.
//  - No próximo click DENTRO de nav.abas, capturamos no início do dispatch
//    e cancelamos (preventDefault + stopPropagation) — de forma determinística,
//    sem setTimeout. Isto garante que um arraste não vire ativação de aba.
//  - Click sem movimento (≤ limiar) é um click normal: passa direto para a
//    aba-alvo sem nenhuma interferência.
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const nav = document.querySelector('nav.abas');
    if (!nav) return;

    let arrastando = false;
    let moveuAlemDoLimiar = false;
    let suprimirProximoClick = false;
    let inicioX = 0;
    let scrollInicial = 0;
    const LIMIAR = 5; // pixels — abaixo disso é click, não arraste

    nav.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      arrastando = true;
      moveuAlemDoLimiar = false;
      inicioX = e.pageX;
      scrollInicial = nav.scrollLeft;
      // Cursor de "agarrando" só como feedback visual — não desativa
      // pointer-events, então não desvia o click para uma aba errada.
      nav.classList.add('abas-arrastando');
    });

    window.addEventListener('mousemove', (e) => {
      if (!arrastando) return;
      const delta = e.pageX - inicioX;
      if (Math.abs(delta) > LIMIAR) moveuAlemDoLimiar = true;
      if (moveuAlemDoLimiar) {
        e.preventDefault();
        nav.scrollLeft = scrollInicial - delta;
      }
    });

    function pararArraste() {
      if (!arrastando) return;
      arrastando = false;
      // Se houve arraste de fato, sinaliza que o click de "mouseup" deve ser
      // suprimido. Não usamos setTimeout; o click que vier agora dispara o
      // handler abaixo no capture phase e é cancelado de forma determinística.
      if (moveuAlemDoLimiar) suprimirProximoClick = true;
      nav.classList.remove('abas-arrastando');
    }
    window.addEventListener('mouseup', pararArraste);
    window.addEventListener('mouseleave', pararArraste);

    // Supressor determinístico do click pós-arraste. Ouvimos na fase CAPTURE
    // para interceptar antes que qualquer handler de click em .aba dispare.
    // Funciona para o próximo click após um arraste (mesmo que ele ocorra
    // sobre uma aba), e se rearma automaticamente.
    nav.addEventListener('click', (ev) => {
      if (!suprimirProximoClick) return;
      suprimirProximoClick = false;
      ev.preventDefault();
      ev.stopPropagation();
    }, { capture: true });

    // Roda do mouse rola horizontalmente sem precisar de Shift.
    nav.addEventListener('wheel', (e) => {
      if (e.deltaY === 0) return;
      nav.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  });
})();

// ══════════════════════════════════════════════════════════════════════════════
// Autocompletar aparelhos e clientes ao criar/editar OS
// ══════════════════════════════════════════════════════════════════════════════
// O catálogo é local para funcionar sem internet. Modelos ficam filtrados pela
// marca escolhida; clientes são buscados na aba Clientes do banco local.
(function () {
  'use strict';

  const CATALOGO_APARELHOS = {
    Apple: ['iPhone 6', 'iPhone 6 Plus', 'iPhone 6s', 'iPhone 6s Plus', 'iPhone 7', 'iPhone 7 Plus', 'iPhone 8', 'iPhone 8 Plus', 'iPhone SE (2020)', 'iPhone SE (2022)', 'iPhone X', 'iPhone XR', 'iPhone XS', 'iPhone XS Max', 'iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max', 'iPhone 12', 'iPhone 12 mini', 'iPhone 12 Pro', 'iPhone 12 Pro Max', 'iPhone 13', 'iPhone 13 mini', 'iPhone 13 Pro', 'iPhone 13 Pro Max', 'iPhone 14', 'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max', 'iPhone 15', 'iPhone 15 Plus', 'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPad 9', 'iPad 10', 'iPad Air 4', 'iPad Air 5', 'iPad Pro 11', 'iPad Pro 12.9'],
    Asus: ['ROG Phone 3', 'ROG Phone 5', 'ROG Phone 5s', 'ROG Phone 6', 'ROG Phone 7', 'ROG Phone 8', 'Zenfone 5', 'Zenfone 8', 'Zenfone 9', 'Zenfone 10', 'Zenfone 11 Ultra'],
    Google: ['Pixel 5', 'Pixel 5a', 'Pixel 6', 'Pixel 6 Pro', 'Pixel 6a', 'Pixel 7', 'Pixel 7 Pro', 'Pixel 7a', 'Pixel 8', 'Pixel 8 Pro', 'Pixel 8a', 'Pixel 9', 'Pixel 9 Pro', 'Pixel 9 Pro XL', 'Pixel 9 Pro Fold'],
    Huawei: ['Nova 5T', 'Nova 9', 'Nova 10', 'P30 Lite', 'P30 Pro', 'P40 Lite', 'P40 Pro', 'P50 Pro', 'Mate 20', 'Mate 30 Pro', 'Y7', 'Y9 Prime'],
    LG: ['G3', 'G4', 'G5', 'G6', 'G7 ThinQ', 'G8 ThinQ', 'K4', 'K8', 'K9', 'K10', 'K11', 'K12', 'K12+', 'K22', 'K40', 'K41S', 'K42', 'K50', 'K51S', 'K52', 'K61', 'K62', 'K71', 'Q6', 'Q7', 'Q60', 'Q70', 'Velvet', 'X Power', 'X Power 2'],
    Lenovo: ['Tab M8', 'Tab M9', 'Tab M10', 'Tab M11', 'Tab P11', 'Tab P12'],
    Motorola: ['Edge 20', 'Edge 20 Lite', 'Edge 20 Pro', 'Edge 30', 'Edge 30 Fusion', 'Edge 30 Neo', 'Edge 30 Pro', 'Edge 40', 'Edge 40 Neo', 'Edge 50', 'Edge 50 Fusion', 'Edge 50 Neo', 'Edge 50 Pro', 'Edge 50 Ultra', 'Moto E', 'Moto E2', 'Moto E4', 'Moto E4 Plus', 'Moto E5', 'Moto E5 Play', 'Moto E5 Plus', 'Moto E6 Play', 'Moto E6 Plus', 'Moto E7', 'Moto E7 Plus', 'Moto E13', 'Moto E20', 'Moto E22', 'Moto E22i', 'Moto E32', 'Moto E32s', 'Moto E40', 'Moto G', 'Moto G 2ª geração', 'Moto G 3ª geração', 'Moto G4', 'Moto G4 Play', 'Moto G4 Plus', 'Moto G5', 'Moto G5 Plus', 'Moto G5S', 'Moto G5S Plus', 'Moto G6', 'Moto G6 Play', 'Moto G6 Plus', 'Moto G7', 'Moto G7 Play', 'Moto G7 Plus', 'Moto G7 Power', 'Moto G8', 'Moto G8 Play', 'Moto G8 Plus', 'Moto G8 Power', 'Moto G8 Power Lite', 'Moto G9', 'Moto G9 Play', 'Moto G9 Plus', 'Moto G9 Power', 'Moto G10', 'Moto G20', 'Moto G22', 'Moto G23', 'Moto G24', 'Moto G30', 'Moto G31', 'Moto G32', 'Moto G34', 'Moto G40 Fusion', 'Moto G41', 'Moto G42', 'Moto G50', 'Moto G51', 'Moto G52', 'Moto G53', 'Moto G54', 'Moto G55', 'Moto G60', 'Moto G60s', 'Moto G62', 'Moto G71', 'Moto G72', 'Moto G73', 'Moto G75', 'Moto G82', 'Moto G84', 'Moto G85', 'Motorola One', 'Motorola One Action', 'Motorola One Fusion', 'Motorola One Fusion+', 'Motorola One Hyper', 'Motorola One Macro', 'Motorola One Vision', 'Razr 40', 'Razr 40 Ultra', 'Razr 50', 'Razr 50 Ultra'],
    Nokia: ['C01 Plus', 'C21 Plus', 'C32', 'G10', 'G20', 'G21', 'G22', 'G42', 'X20', 'X30'],
    Oppo: ['A16', 'A17', 'A38', 'A54', 'A57', 'A58', 'A78', 'A79', 'Reno 7', 'Reno 8', 'Reno 10', 'Reno 11'],
    Realme: ['C30', 'C35', 'C51', 'C53', 'C55', 'C67', 'C75', 'GT 2', 'GT Neo 3', 'Narzo 50', 'Narzo 60'],
    Samsung: ['Galaxy A04', 'Galaxy A04e', 'Galaxy A04s', 'Galaxy A05', 'Galaxy A05s', 'Galaxy A06', 'Galaxy A12', 'Galaxy A13', 'Galaxy A14', 'Galaxy A15', 'Galaxy A16', 'Galaxy A22', 'Galaxy A23', 'Galaxy A24', 'Galaxy A25', 'Galaxy A32', 'Galaxy A33', 'Galaxy A34', 'Galaxy A35', 'Galaxy A52', 'Galaxy A52s', 'Galaxy A53', 'Galaxy A54', 'Galaxy A55', 'Galaxy A56', 'Galaxy M12', 'Galaxy M13', 'Galaxy M14', 'Galaxy M15', 'Galaxy M23', 'Galaxy M32', 'Galaxy M34', 'Galaxy M35', 'Galaxy M52', 'Galaxy M54', 'Galaxy Note 8', 'Galaxy Note 9', 'Galaxy Note 10', 'Galaxy Note 10+', 'Galaxy Note 20', 'Galaxy Note 20 Ultra', 'Galaxy S8', 'Galaxy S8+', 'Galaxy S9', 'Galaxy S9+', 'Galaxy S10e', 'Galaxy S10', 'Galaxy S10+', 'Galaxy S20', 'Galaxy S20+', 'Galaxy S20 Ultra', 'Galaxy S20 FE', 'Galaxy S21', 'Galaxy S21+', 'Galaxy S21 Ultra', 'Galaxy S21 FE', 'Galaxy S22', 'Galaxy S22+', 'Galaxy S22 Ultra', 'Galaxy S23', 'Galaxy S23+', 'Galaxy S23 Ultra', 'Galaxy S23 FE', 'Galaxy S24', 'Galaxy S24+', 'Galaxy S24 Ultra', 'Galaxy S24 FE', 'Galaxy S25', 'Galaxy S25+', 'Galaxy S25 Ultra', 'Galaxy S25 Edge', 'Galaxy Tab A7', 'Galaxy Tab A8', 'Galaxy Tab A9', 'Galaxy Tab A9+', 'Galaxy Tab S6 Lite', 'Galaxy Tab S7 FE', 'Galaxy Tab S8', 'Galaxy Tab S9', 'Galaxy Z Flip 3', 'Galaxy Z Flip 4', 'Galaxy Z Flip 5', 'Galaxy Z Flip 6', 'Galaxy Z Fold 3', 'Galaxy Z Fold 4', 'Galaxy Z Fold 5', 'Galaxy Z Fold 6'],
    Sony: ['Xperia 1 III', 'Xperia 1 IV', 'Xperia 5 III', 'Xperia 5 IV', 'Xperia 10 IV', 'Xperia 10 V'],
    Xiaomi: ['Mi 11 Lite', 'Mi 11T', 'Mi 12', 'Mi 13', 'Poco C40', 'Poco C55', 'Poco C65', 'Poco M4 Pro', 'Poco M5', 'Poco M6', 'Poco X3', 'Poco X4 Pro', 'Poco X5', 'Poco X5 Pro', 'Poco X6', 'Poco X6 Pro', 'Poco F3', 'Poco F4', 'Poco F5', 'Redmi 9A', 'Redmi 9C', 'Redmi 10', 'Redmi 10C', 'Redmi 12', 'Redmi 12C', 'Redmi 13', 'Redmi 13C', 'Redmi 14C', 'Redmi Note 10', 'Redmi Note 10 Pro', 'Redmi Note 11', 'Redmi Note 11 Pro', 'Redmi Note 12', 'Redmi Note 12 Pro', 'Redmi Note 13', 'Redmi Note 13 Pro', 'Redmi Note 14', 'Redmi Note 14 Pro']
  };

  CATALOGO_APARELHOS.Samsung.push(
    'Galaxy J1', 'Galaxy J2', 'Galaxy J2 Prime', 'Galaxy J3', 'Galaxy J4', 'Galaxy J4+',
    'Galaxy J5', 'Galaxy J5 Prime', 'Galaxy J6', 'Galaxy J6+', 'Galaxy J7', 'Galaxy J7 Prime',
    'Galaxy J7 Pro', 'Galaxy J8', 'Galaxy A01', 'Galaxy A02', 'Galaxy A02s', 'Galaxy A03',
    'Galaxy A03 Core', 'Galaxy A03s', 'Galaxy A10', 'Galaxy A10s', 'Galaxy A11', 'Galaxy A20',
    'Galaxy A20s', 'Galaxy A21s', 'Galaxy A30', 'Galaxy A30s', 'Galaxy A31', 'Galaxy A50',
    'Galaxy A50s', 'Galaxy A51', 'Galaxy A70', 'Galaxy A71', 'Galaxy A72', 'Galaxy A73'
  );

  const ordenar = (itens) => Array.from(new Set(itens || [])).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  const marcas = ordenar(Object.keys(CATALOGO_APARELHOS));
  const CORES_APARELHOS = ordenar([
    'Amarelo', 'Azul', 'Azul-claro', 'Azul-escuro', 'Bege', 'Branco', 'Bronze',
    'Cinza', 'Cinza-espacial', 'Cobre', 'Dourado', 'Grafite', 'Laranja', 'Lilás',
    'Marrom', 'Prata', 'Preto', 'Rosa', 'Roxo', 'Titânio', 'Titânio Azul',
    'Titânio Branco', 'Titânio Natural', 'Titânio Preto', 'Verde', 'Vermelho',
    'Vinho'
  ]);

  function obterDatalist(id) {
    let lista = document.getElementById(id);
    if (!lista) {
      lista = document.createElement('datalist');
      lista.id = id;
      document.body.appendChild(lista);
    }
    return lista;
  }

  function preencherDatalist(lista, opcoes) {
    lista.replaceChildren();
    ordenar(opcoes).forEach((opcao) => {
      const item = document.createElement('option');
      item.value = opcao;
      lista.appendChild(item);
    });
  }

  function marcaCanonica(valor) {
    return marcas.find((marca) => marca.toLocaleLowerCase('pt-BR') === String(valor || '').trim().toLocaleLowerCase('pt-BR')) || '';
  }

  function normalizarBuscaModelo(valor) {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/\+/g, ' plus ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function primeiraOpcaoCompativel(valor, opcoes) {
    const termo = normalizarBuscaModelo(valor);
    if (!termo) return '';
    const candidatas = (opcoes || []).filter((opcao) => normalizarBuscaModelo(opcao).includes(termo));
    return candidatas.find((opcao) => normalizarBuscaModelo(opcao).startsWith(termo)) || candidatas[0] || '';
  }

  // Regra única para todo input com datalist: Tab aceita a primeira sugestão
  // compatível e mantém o comportamento normal de avançar ao campo seguinte.
  document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Tab' || evento.shiftKey) return;
    const campo = evento.target;
    if (!(campo instanceof HTMLInputElement) || !campo.hasAttribute('list') || !campo.value.trim()) return;
    const lista = document.getElementById(campo.getAttribute('list'));
    if (!lista) return;
    const opcoes = [...lista.querySelectorAll('option')].map((opcao) => opcao.value).filter(Boolean);
    const primeira = primeiraOpcaoCompativel(campo.value, opcoes);
    if (!primeira || normalizarBuscaModelo(primeira) === normalizarBuscaModelo(campo.value)) return;
    campo.value = primeira;
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  }, true);

  function instalarAutocompleteAparelhos() {
    const listaMarcas = obterDatalist('listaMarcasOS');
    const listaModelos = obterDatalist('listaModelosOS');
    preencherDatalist(listaMarcas, marcas);
    const todosModelos = ordenar(Object.keys(CATALOGO_APARELHOS).flatMap((marca) => CATALOGO_APARELHOS[marca]));
    const modelosComMarca = ordenar(Object.keys(CATALOGO_APARELHOS).flatMap((marca) =>
      CATALOGO_APARELHOS[marca].map((modelo) => `${marca} ${modelo}`)
    ));
    const listaModelosTabelaPrecos = obterDatalist('listaModelosTabelaPrecos');
    preencherDatalist(listaModelosTabelaPrecos, ordenar(todosModelos.concat(modelosComMarca)));
    const modeloTabelaPrecos = document.getElementById('tabelaPrecoModelo');
    if (modeloTabelaPrecos) {
      modeloTabelaPrecos.setAttribute('list', listaModelosTabelaPrecos.id);
      modeloTabelaPrecos.setAttribute('autocomplete', 'off');
    }
    window.SistemaOSCatalogoModelos = Object.freeze(ordenar(todosModelos.concat(modelosComMarca)));

    function configurar(marcaId, modeloId) {
      const marca = document.getElementById(marcaId);
      const modelo = document.getElementById(modeloId);
      if (!marca || !modelo) return;
      marca.setAttribute('list', 'listaMarcasOS');
      modelo.setAttribute('list', 'listaModelosOS');
      const atualizarModelos = () => {
        const selecionada = marcaCanonica(marca.value);
        preencherDatalist(listaModelos, selecionada ? CATALOGO_APARELHOS[selecionada] : todosModelos);
      };
      marca.addEventListener('input', atualizarModelos);
      marca.addEventListener('change', () => {
        const selecionada = marcaCanonica(marca.value);
        if (selecionada) marca.value = selecionada;
        atualizarModelos();
      });
      modelo.addEventListener('focus', atualizarModelos);
      atualizarModelos();
    }
    configurar('marca', 'modelo');
    configurar('editMarca', 'editModelo');
    configurar('estMarca', 'estModelo');
    configurar('cpAMarca', 'cpAModelo');
    configurar('orcMarca', 'orcModelo');
    configurar('novaEntregaMarca', 'novaEntregaModelo');
    configurar('garMarca', 'garModelo');

    const listaCores = obterDatalist('listaCoresAparelhos');
    preencherDatalist(listaCores, CORES_APARELHOS);
    ['cor', 'editCor', 'estCor', 'cpACor'].forEach((id) => {
      const campo = document.getElementById(id);
      if (campo) {
        campo.setAttribute('list', 'listaCoresAparelhos');
        campo.setAttribute('autocomplete', 'off');
      }
    });

    const listasRapidas = [
      {
        id: 'listaCapacidadesAparelhos',
        campos: ['cpACapacidade'],
        opcoes: ['8GB', '16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB'],
      },
      {
        id: 'listaGarantiasVenda',
        campos: ['estGarantia'],
        opcoes: ['7 dias', '15 dias', '30 dias', '60 dias', '90 dias', '180 dias', '365 dias'],
      },
      {
        id: 'listaEstadosBrasil',
        campos: ['cpVEstado'],
        opcoes: ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'],
      },
    ];
    listasRapidas.forEach(({ id, campos, opcoes }) => {
      const lista = obterDatalist(id);
      preencherDatalist(lista, opcoes);
      campos.forEach((campoId) => {
        const campo = document.getElementById(campoId);
        if (campo) {
          campo.setAttribute('list', id);
          campo.setAttribute('autocomplete', 'off');
        }
      });
    });
  }

  function instalarAutocompleteCliente(ids) {
    const nome = document.getElementById(ids.nome);
    const cpf = document.getElementById(ids.cpf);
    const telefone = document.getElementById(ids.telefone);
    const telefoneExtra = document.getElementById(ids.telefoneExtra);
    const email = document.getElementById(ids.email);
    const semNumero = document.getElementById(ids.semNumero);
    if (!nome || !cpf || !window.api?.clientesbuscar) return;

    let resultados = [];
    let timer = null;
    let requisicao = 0;
    let preenchendo = false;
    const caixa = document.createElement('div');
    caixa.className = 'sugestoes-cliente-os escondido';
    caixa.style.cssText = 'position:absolute;z-index:50;left:0;right:0;top:calc(100% + 3px);max-height:220px;overflow:auto;background:var(--fundo-card, #1c2430);border:1px solid var(--borda, #445);border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.25);padding:4px;';
    const pai = nome.parentElement;
    if (pai) {
      if (getComputedStyle(pai).position === 'static') pai.style.position = 'relative';
      pai.appendChild(caixa);
    }

    function esconder() {
      caixa.classList.add('escondido');
      caixa.replaceChildren();
    }

    function preencher(cliente) {
      if (!cliente) return;
      preenchendo = true;
      if (cliente.nome) nome.value = cliente.nome;
      if (cliente.cpf) cpf.value = cliente.cpf;
      if (telefone && cliente.telefone) telefone.value = cliente.telefone;
      if (telefoneExtra && cliente.telefone) telefoneExtra.value = cliente.telefone;
      if (email && cliente.email) email.value = cliente.email;
      if (semNumero && cliente.telefone) {
        semNumero.checked = false;
        semNumero.dispatchEvent(new Event('change', { bubbles: true }));
      }
      [nome, cpf, telefone, telefoneExtra, email].filter(Boolean).forEach((campo) => campo.dispatchEvent(new Event('change', { bubbles: true })));
      preenchendo = false;
      esconder();
    }

    function mostrar(clientes) {
      resultados = clientes.slice(0, 8);
      caixa.replaceChildren();
      resultados.forEach((cliente) => {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.style.cssText = 'display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:8px 10px;border-radius:6px;cursor:pointer;';
        const titulo = document.createElement('strong');
        titulo.textContent = cliente.nome || 'Cliente sem nome';
        const detalhe = document.createElement('small');
        detalhe.style.cssText = 'display:block;opacity:.72;margin-top:2px;';
        detalhe.textContent = [cliente.cpf, cliente.telefone, cliente.email].filter(Boolean).join(' · ');
        botao.append(titulo, detalhe);
        botao.addEventListener('mousedown', (evento) => {
          evento.preventDefault();
          preencher(cliente);
          if (telefone) telefone.focus();
        });
        caixa.appendChild(botao);
      });
      caixa.classList.toggle('escondido', !resultados.length);
    }

    function buscar() {
      if (preenchendo) return;
      const termoNome = nome.value.trim();
      const termoCpf = cpf.value.replace(/\D/g, '');
      const termo = termoCpf.length >= 3 ? termoCpf : termoNome;
      if (termo.length < 2) { esconder(); return; }
      const atual = ++requisicao;
      window.api.clientesbuscar(termo).then((clientes) => {
        if (atual !== requisicao) return;
        mostrar(Array.isArray(clientes) ? clientes : []);
      }).catch(esconder);
    }

    [nome, cpf].forEach((campo) => {
      campo.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(buscar, 180);
      });
      campo.addEventListener('keydown', (evento) => {
        if (evento.key === 'Tab' && resultados.length) {
          preencher(resultados[0]);
        } else if (evento.key === 'Enter' && resultados.length) {
          evento.preventDefault();
          preencher(resultados[0]);
        } else if (evento.key === 'Escape') esconder();
      });
      campo.addEventListener('blur', () => setTimeout(esconder, 160));
    });
  }

  function instalar() {
    instalarAutocompleteAparelhos();
    instalarAutocompleteCliente({ nome: 'nome', cpf: 'cpf', telefone: 'telefone', email: 'email', semNumero: 'semNumero' });
    instalarAutocompleteCliente({ nome: 'editNome', cpf: 'editCpf', telefone: 'editTelefone', email: 'editEmail', semNumero: 'editSemNumero' });
    instalarAutocompleteCliente({ nome: 'estCompradorNome', cpf: 'estCompradorCpf', telefone: 'estCompradorTel', semNumero: 'estCompradorSemNumero' });
    instalarAutocompleteCliente({ nome: 'cpVNome', cpf: 'cpVCpf', telefone: 'cpVTelefone', telefoneExtra: 'cpVWhatsapp', email: 'cpVEmail' });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar);
  else instalar();
})();
// ══ Fim: Barra de abas arrastável ═════════════════════════════════════════
