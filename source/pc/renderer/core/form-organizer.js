// Organiza formularios longos sem remover campos ou alterar IDs/callbacks.
// Cada card vira uma secao recolhivel e erros de validacao reabrem a secao.
(function () {
  'use strict';

  const formularios = [
    {
      raiz: '#aba-nova-os .formulario-layout',
      titulo: 'Dados principais sempre à vista',
      dica: 'Cliente, aparelho, valor e prazo. Sem campos repetidos de controle interno.',
      essenciais: ['dados do cliente', 'dados do aparelho', 'valor prazo e status', 'salvar ordem']
    },
    {
      raiz: '#modalEditarOS .formulario-layout',
      titulo: 'Edição organizada por seções',
      dica: 'Confira cadastro, orçamento, prazo e situação. O histórico técnico permanece disponível.',
      essenciais: ['cliente', 'aparelho', 'valor prazo e status']
    },
    {
      raiz: '#modalFormCompra .modal-compra-conteudo',
      titulo: 'Contrato em etapas simples',
      dica: 'Confira vendedor, aparelho e valor. Avaliação, termos e peças são opções complementares.',
      essenciais: ['dados do vendedor', 'dados do aparelho', 'dados da compra']
    }
  ];

  function normalizar(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  const PALAVRAS_IGNORADAS = new Set([
    'a', 'as', 'o', 'os', 'de', 'da', 'das', 'do', 'dos', 'e', 'em', 'no', 'na',
    'nos', 'nas', 'para', 'por', 'com', 'uma', 'um', 'onde', 'quero', 'preciso',
    'como', 'fazer', 'usar', 'colocar', 'alterar', 'mudar', 'editar', 'ver',
    'configuracao', 'configuracoes', 'funcao', 'funcoes', 'opcao', 'opcoes'
  ]);

  const GRUPOS_SINONIMOS = [
    ['whatsapp', 'whats', 'wpp', 'zap', 'baileys', 'mensagem', 'mensagens'],
    ['nota', 'fiscal', 'nf', 'nfe', 'nfse', 'danfe', 'danfse', 'imposto'],
    ['mercado', 'pago', 'mp', 'pix', 'cartao', 'pagamento', 'pagamentos', 'cobranca', 'cobrancas', 'checkout'],
    ['usuario', 'usuarios', 'conta', 'contas', 'login', 'acesso', 'acessos', 'equipe'],
    ['excluir', 'exclusao', 'apagar', 'deletar', 'remover', 'lixeira'],
    ['backup', 'backups', 'copia', 'copias', 'restaurar', 'restauracao', 'recuperar'],
    ['sincronizar', 'sincronizacao', 'nuvem', 'supabase', 'celular', 'android'],
    ['tema', 'escuro', 'claro', 'cor', 'cores', 'visual', 'aparencia'],
    ['atualizar', 'atualizacao', 'versao', 'update', 'github', 'baixar', 'instalar'],
    ['assinatura', 'assinaturas', 'plano', 'planos', 'licenca', 'vencimento', 'renovar', 'upgrade', 'downgrade'],
    ['api', 'token', 'chave', 'integracao', 'integracoes', 'webhook'],
    ['ia', 'inteligencia', 'artificial', 'assistente', 'chat', 'groq', 'openai', 'chatgpt', 'claude', 'anthropic', 'deepseek'],
    ['notificacao', 'notificacoes', 'aviso', 'avisos', 'lembrete', 'lembretes', 'cobranca', 'vencimento'],
    ['senha', 'password', 'credencial', 'credenciais'],
    ['logo', 'marca', 'imagem'],
    ['pdf', 'imprimir', 'impressao', 'documento', 'documentos'],
    ['empresa', 'oficina', 'assistencia', 'negocio', 'loja'],
    ['telefone', 'celular', 'contato', 'email'],
    ['endereco', 'cep', 'rua', 'bairro', 'cidade', 'estado', 'uf', 'localizacao']
  ];

  const ALIASES_POR_TITULO = {
    'dados da empresa': 'cadastro oficina assistência razão social nome fantasia dados do negócio',
    contato: 'telefone celular e-mail atendimento',
    endereco: 'cep rua número bairro cidade estado uf localização',
    'cnpj ie': 'documento fiscal inscrição estadual cpf cnpj cadastro tributário',
    'lucro padrao': 'margem porcentagem preço valor rentabilidade',
    'termos padrao da os': 'contrato condições ordem serviço texto padrão',
    'termos padrao de venda de aparelho': 'contrato venda celular aparelho condições pdf',
    'termos padrao de compra de aparelho': 'contrato compra vendedor aparelho condições pdf',
    'termos padrao de garantia': 'contrato garantia prazo cobertura condições pdf',
    logo: 'marca imagem empresa cabeçalho',
    pdf: 'imprimir impressão documento papel tamanho vias',
    'datas e horarios': 'data hora relógio fuso horário',
    'personalizacao visual do sistema': 'tema escuro claro cor fonte aparência tela',
    'tema dos pdfs': 'documento impressão cor cabeçalho layout',
    'integracao mercado pago': 'mp pix cartão cobrança pagamento checkout link receber',
    'sessao da conta': 'usuário login senha sair acesso conta trocar alternar empresa troca rápida',
    'precisa de ajuda': 'suporte chamado dúvida problema erro atendimento',
    'central administrativa sistema os': 'administrador máximo suporte empresas clientes saas painel global',
    'integracoes whatsapp avaliacao': 'whatsapp whats wpp zap baileys api qr code mensagem avaliação google',
    whatsapp: 'whats wpp zap baileys api qr code sessão mensagem',
    'permissoes de exclusao': 'excluir apagar deletar remover senha usuário administrador autorização',
    'windows e desempenho': 'inicialização iniciar ligar computador abrir automático bandeja segundo plano cpu ram memória desempenho economizar recursos',
    'backup automatico': 'cópia segurança recuperar restaurar salvar dados',
    'importar lote do celular': 'android celular importar sincronizar arquivo lote',
    'assinatura recebida do celular': 'cliente assinar documento android celular',
    'zona de risco': 'zerar resetar apagar todos dados fábrica',
    'atualizacao do sistema': 'versão update github baixar instalar atualizador',
    'nf s e e danfse': 'nota fiscal serviço nfse danfse imposto certificado prefeitura',
    'assinatura do sistema os': 'plano licença vencimento renovar pagar upgrade downgrade',
    'cobranca automatica do sistema os': 'assinatura saas mercado pago webhook plano pagamento automático'
  };

  const SECOES_IMPORTANTES = [
    'dados da empresa', 'contato', 'endereco', 'sessao da conta', 'cnpj ie',
    'central administrativa sistema os', 'integracao mercado pago',
    'integracao ia', 'integracoes whatsapp', 'whatsapp', 'permissoes de exclusao',
    'windows e desempenho',
    'backup automatico', 'atualizacao do sistema', 'assinatura do sistema os',
    'cobranca automatica do sistema os'
  ];

  // A busca da Configuração também funciona como localizador das áreas do
  // sistema. Assim termos como "financeiro" não retornam vazio só porque a
  // função procurada fica em uma aba principal, e não dentro da configuração.
  const ROTAS_DA_BUSCA = [
    { titulo: 'Relatórios › Financeiro', aba: 'relatorios', subaba: 'financeiro', termos: 'financeiro finanças faturamento receita despesas lucro caixa relatório de pagamentos os pagas valor cobrado' },
    { titulo: 'Relatórios › Visão geral', aba: 'relatorios', subaba: 'geral', termos: 'relatório relatórios indicadores estatísticas desempenho visão geral' },
    { titulo: 'Nova OS', aba: 'nova-os', termos: 'nova os ordem serviço atendimento cadastrar aparelho cliente' },
    { titulo: 'OS autorizadas', aba: 'orcamentos', termos: 'autorizadas aprovação aprovada reparo orçamento' },
    { titulo: 'Histórico de OS', aba: 'historico', termos: 'histórico os pagas finalizadas canceladas buscar ordem serviço' },
    { titulo: 'Entregas', aba: 'entregas', termos: 'entrega retirada comprovante entregar assinatura' },
    { titulo: 'Garantia', aba: 'garantia', termos: 'garantia retorno cobertura prazo' },
    { titulo: 'Desbloqueios', aba: 'desbloqueios', termos: 'desbloqueio autorização titularidade riscos assinatura reset aparelho' },
    { titulo: 'Clientes', aba: 'clientes', termos: 'cliente clientes cadastro telefone histórico' },
    { titulo: 'Estoque', aba: 'estoque', termos: 'estoque consumível consumíveis peças aparelhos venda compra entrada saída' },
    { titulo: 'Tabela de preços', aba: 'precos', termos: 'tabela preço preços serviço peça orçamento' },
    { titulo: 'Pagamentos', aba: 'pagamentos', termos: 'pagamento pagamentos cobrança mercado pago pix transação' },
    { titulo: 'Mensagens', aba: 'mensagens-wapp', termos: 'mensagem mensagens whatsapp cliente conversa' },
    { titulo: 'Log da IA', aba: 'log-ia', termos: 'log ia inteligência artificial classificação' }
  ];

  function rotaDaBusca(consulta) {
    const termos = termosDaConsulta(consulta);
    if (!termos.length) return null;
    let melhor = null;
    ROTAS_DA_BUSCA.forEach((rota) => {
      const indice = normalizar(`${rota.titulo} ${rota.termos}`).split(' ').filter(Boolean);
      const corresponde = termos.every((termo) => alternativasDoTermo(termo)
        .some((alternativa) => indice.some((palavra) => palavraCorresponde(palavra, alternativa))));
      if (!corresponde) return;
      const pontos = termos.reduce((total, termo) => total + (normalizar(rota.titulo).includes(termo) ? 80 : 45), 0);
      if (!melhor || pontos > melhor.pontos) melhor = { ...rota, pontos };
    });
    return melhor;
  }

  function abrirRotaDaBusca(rota) {
    if (!rota) return;
    document.getElementById('modalConfig')?.classList.add('escondido');
    document.querySelector(`.aba[data-aba="${rota.aba}"]`)?.click();
    if (rota.subaba) setTimeout(() => window.trocarSubabaRelatorios?.(rota.subaba), 0);
  }

  function termosDaConsulta(valor) {
    const todos = normalizar(valor).split(' ').filter(Boolean);
    const uteis = todos.filter((termo) => !PALAVRAS_IGNORADAS.has(termo));
    return uteis.length ? [...new Set(uteis)] : [...new Set(todos.filter((termo) => termo.length > 1))];
  }

  function alternativasDoTermo(termo) {
    const relacionadas = GRUPOS_SINONIMOS
      .filter((grupo) => grupo.includes(termo))
      .flat();
    return relacionadas.length ? [...new Set(relacionadas)] : [termo];
  }

  function distanciaEdicao(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const anterior = Array.from({ length: b.length + 1 }, (_, indice) => indice);
    for (let i = 1; i <= a.length; i += 1) {
      const atual = [i];
      for (let j = 1; j <= b.length; j += 1) {
        atual[j] = Math.min(
          atual[j - 1] + 1,
          anterior[j] + 1,
          anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      for (let j = 0; j < atual.length; j += 1) anterior[j] = atual[j];
    }
    return anterior[b.length];
  }

  function palavraCorresponde(palavra, alternativa) {
    if (!palavra || !alternativa) return false;
    if (palavra === alternativa) return true;
    if (alternativa.length <= 2) return palavra.startsWith(alternativa);
    if (palavra.startsWith(alternativa) || alternativa.startsWith(palavra)) return true;
    if (alternativa.length >= 4 && palavra.includes(alternativa)) return true;
    const limite = alternativa.length >= 7 ? 2 : 1;
    return Math.abs(palavra.length - alternativa.length) <= limite
      && distanciaEdicao(palavra, alternativa) <= limite;
  }

  function indiceDaSecao(secao) {
    const titulo = normalizar(tituloConfigDireto(secao)?.textContent);
    const aliases = normalizar(Object.entries(ALIASES_POR_TITULO)
      .filter(([chave]) => titulo.includes(chave))
      .map(([, termos]) => termos)
      .join(' '));
    const acoes = normalizar(Array.from(secao.querySelectorAll('input, select, textarea, button, label'))
      .map((elemento) => [
        elemento.id,
        elemento.name,
        elemento.getAttribute('placeholder'),
        elemento.getAttribute('aria-label'),
        elemento.textContent
      ].filter(Boolean).join(' '))
      .join(' '));
    const resumo = normalizar(Array.from(secao.children)
      .filter((elemento) => elemento.matches?.('p, .campo-desc'))
      .map((elemento) => elemento.textContent || '')
      .join(' '));
    const texto = normalizar(`${titulo} ${aliases} ${acoes} ${resumo}`);
    return {
      titulo, aliases, acoes, resumo, texto,
      palavrasTitulo: [...new Set(titulo.split(' ').filter(Boolean))],
      palavrasAliases: [...new Set(aliases.split(' ').filter(Boolean))],
      palavrasAcoes: [...new Set(acoes.split(' ').filter(Boolean))]
    };
  }

  function pontuarSecao(secao, consulta) {
    const termos = termosDaConsulta(consulta);
    if (!termos.length) return 1;
    const indice = indiceDaSecao(secao);
    let pontos = 0;
    let termosEncontrados = 0;
    for (const termo of termos) {
      let pontosTermo = 0;
      for (const alternativa of alternativasDoTermo(termo)) {
        if (indice.titulo === alternativa) pontosTermo = Math.max(pontosTermo, 90);
        else if (indice.palavrasTitulo.some((palavra) => palavraCorresponde(palavra, alternativa))) pontosTermo = Math.max(pontosTermo, 70);
        else if (indice.palavrasAliases.some((palavra) => palavraCorresponde(palavra, alternativa))) pontosTermo = Math.max(pontosTermo, 58);
        else if (indice.palavrasAcoes.some((palavra) => palavraCorresponde(palavra, alternativa))) pontosTermo = Math.max(pontosTermo, 44);
        else if (alternativa.length >= 5 && indice.resumo.split(' ').includes(alternativa)) pontosTermo = Math.max(pontosTermo, 22);
      }
      if (!pontosTermo) continue;
      termosEncontrados += 1;
      pontos += pontosTermo;
    }
    if (!termosEncontrados) return 0;
    const cobertura = termosEncontrados / termos.length;
    if (cobertura < 0.5 && termos.length > 1) return 0;
    pontos += Math.round(cobertura * 35);
    if (indice.titulo.includes(normalizar(consulta))) pontos += 100;
    else if (indice.aliases.includes(normalizar(consulta))) pontos += 65;
    else if (indice.acoes.includes(normalizar(consulta))) pontos += 40;
    return pontos;
  }

  function tituloDireto(card) {
    return Array.from(card.children).find((filho) => filho.classList?.contains('card-titulo')) || null;
  }

  function recolher(card, recolhido) {
    const titulo = tituloDireto(card);
    if (!titulo) return;
    if (card.dataset.formEssencial === 'true') recolhido = false;
    card.dataset.recolhido = recolhido ? 'true' : 'false';
    titulo.setAttribute('aria-expanded', recolhido ? 'false' : 'true');
  }

  function cardsDaRaiz(raiz) {
    return Array.from(raiz.querySelectorAll('.card')).filter((card) => {
      if (card.classList.contains('form-retirado')) return false;
      if (card.dataset.formRecolhivel === 'false') return false;
      return !!tituloDireto(card);
    });
  }

  function atualizarResumo(toolbar, cards) {
    const status = toolbar.querySelector('[data-form-status]');
    const abertas = cards.filter((card) => card.dataset.recolhido !== 'true').length;
    if (status) status.textContent = '';
  }

  function criarToolbar(config, cards) {
    const barra = document.createElement('div');
    barra.className = 'form-organizador';
    barra.innerHTML = `
      <div class="form-organizador-texto">
        <strong>${config.titulo}</strong>
        <span>${config.dica} <b data-form-status></b></span>
      </div>
      <div class="form-organizador-acoes">
        <button type="button" class="botao botao-fantasma botao-xs" data-form-essenciais>Mostrar essenciais</button>
        <button type="button" class="botao botao-secundario botao-xs" data-form-todas>Expandir tudo</button>
      </div>`;

    const essenciais = () => {
      document.querySelector(config.raiz)?.querySelectorAll('details.form-detalhes').forEach(d => { d.open = false; });
      cards.forEach((card) => {
        const texto = normalizar(tituloDireto(card)?.textContent);
        const deveAbrir = config.essenciais.some((item) => texto.includes(normalizar(item)));
        recolher(card, !deveAbrir);
      });
      barra.querySelector('[data-form-todas]').textContent = 'Expandir tudo';
      atualizarResumo(barra, cards);
    };

    barra.querySelector('[data-form-essenciais]').addEventListener('click', essenciais);
    barra.querySelector('[data-form-todas]').addEventListener('click', () => {
      const todasAbertas = cards.every((card) => card.dataset.recolhido !== 'true');
      if (todasAbertas) { essenciais(); return; }
      document.querySelector(config.raiz)?.querySelectorAll('details.form-detalhes').forEach(d => { d.open = true; });
      cards.forEach((card) => recolher(card, false));
      barra.querySelector('[data-form-todas]').textContent = 'Recolher opcionais';
      atualizarResumo(barra, cards);
    });
    barra._mostrarEssenciais = essenciais;
    return barra;
  }

  function posicionarToolbar(config, raiz, toolbar) {
    if (config.raiz.includes('modalFormCompra')) {
      const intro = raiz.querySelector(':scope > .formulario-intro');
      intro?.insertAdjacentElement('afterend', toolbar);
      if (!intro) raiz.prepend(toolbar);
      return;
    }
    raiz.parentElement?.insertBefore(toolbar, raiz);
  }

  function prepararCard(card, toolbar, cards) {
    const titulo = tituloDireto(card);
    if (!titulo || card.classList.contains('card-recolhivel')) return;
    if (card.dataset.formEssencial === 'true') { recolher(card, false); return; }
    card.classList.add('card-recolhivel');
    titulo.setAttribute('role', 'button');
    titulo.setAttribute('tabindex', '0');
    const alternar = (evento) => {
      if (evento?.target?.closest?.('button, a, input, select, textarea, label')) return;
      recolher(card, card.dataset.recolhido !== 'true');
      atualizarResumo(toolbar, cards);
    };
    titulo.addEventListener('click', alternar);
    titulo.addEventListener('keydown', (evento) => {
      if (evento.key !== 'Enter' && evento.key !== ' ') return;
      evento.preventDefault();
      alternar(evento);
    });
  }

  function prepararFormulario(config) {
    const raiz = document.querySelector(config.raiz);
    if (!raiz || raiz.dataset.formOrganizado === 'true') return;
    const cards = cardsDaRaiz(raiz);
    if (cards.length < 4) return;
    raiz.dataset.formOrganizado = 'true';
    const toolbar = criarToolbar(config, cards);
    posicionarToolbar(config, raiz, toolbar);
    cards.forEach((card) => prepararCard(card, toolbar, cards));
    toolbar._mostrarEssenciais();
  }

  function tituloConfigDireto(secao) {
    return Array.from(secao.children).find((filho) => filho.classList?.contains('config-secao-titulo')) || null;
  }

  function recolherConfig(secao, recolhido) {
    const titulo = tituloConfigDireto(secao);
    if (!titulo) return;
    secao.dataset.recolhido = recolhido ? 'true' : 'false';
    titulo.setAttribute('aria-expanded', recolhido ? 'false' : 'true');
  }

  function secaoConfigImportante(secao, indice = 0) {
    const nome = normalizar(tituloConfigDireto(secao)?.textContent);
    if (!nome) return indice < 2;
    return indice < 2 || SECOES_IMPORTANTES.some((item) => nome.includes(normalizar(item)));
  }

  function mostrarSomenteConfiguracoesImportantes(caixa) {
    Array.from(caixa.querySelectorAll(':scope > .config-secao.config-recolhivel')).forEach((secao, indice) => {
      secao.classList.remove('config-filtrada', 'config-corresponde');
      recolherConfig(secao, !secaoConfigImportante(secao, indice));
    });
  }

  function prepararConfiguracoes() {
    const caixa = document.querySelector('#modalConfig > .modal-caixa');
    if (!caixa) return;
    let toolbar = caixa.querySelector(':scope > .config-organizador');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'config-organizador';
      toolbar.innerHTML = `
        <div class="config-busca">
          <label for="configBuscaFuncoes">Buscar nas configurações</label>
          <div class="config-busca-campo">
            <span class="config-busca-icone" aria-hidden="true">⌕</span>
            <input id="configBuscaFuncoes" type="search"
              placeholder="Ex.: WhatsApp, nota fiscal, senha ou backup"
              aria-describedby="configBuscaStatus" autocomplete="off" spellcheck="false">
            <button type="button" class="config-busca-limpar" data-config-limpar hidden>Limpar</button>
          </div>
          <span id="configBuscaStatus" class="config-busca-status" data-config-status aria-live="polite"></span>
          <div class="config-busca-resultados" data-config-resultados aria-label="Resultados da busca"></div>
        </div>
        <div class="config-organizador-acoes">
          <button type="button" class="botao botao-fantasma botao-xs" data-config-recolher>Mostrar essenciais</button>
          <button type="button" class="botao botao-secundario botao-xs" data-config-expandir>Expandir tudo</button>
        </div>`;
      caixa.querySelector(':scope > .modal-cabecalho')?.insertAdjacentElement('afterend', toolbar);

      toolbar.querySelector('[data-config-recolher]').addEventListener('click', () => {
        const input = toolbar.querySelector('#configBuscaFuncoes');
        if (input) input.value = '';
        mostrarSomenteConfiguracoesImportantes(caixa);
        toolbar._aplicarBusca?.();
      });
      toolbar.querySelector('[data-config-expandir]').addEventListener('click', () => {
        caixa.querySelectorAll(':scope > .config-secao.config-recolhivel').forEach((secao) => recolherConfig(secao, false));
      });

      const inputBusca = toolbar.querySelector('#configBuscaFuncoes');
      const botaoLimpar = toolbar.querySelector('[data-config-limpar]');
      const statusBusca = toolbar.querySelector('[data-config-status]');
      const caixaResultados = toolbar.querySelector('[data-config-resultados]');
      let buscaEstavaAtiva = false;

      const aplicarBusca = () => {
        const consulta = inputBusca.value.trim();
        const rota = consulta ? rotaDaBusca(consulta) : null;
        const secoes = Array.from(caixa.querySelectorAll(':scope > .config-secao'));
        const disponiveis = secoes.filter((secao) => !secao.hidden && secao.getAttribute('aria-hidden') !== 'true');
        const resultados = [];

        secoes.forEach((secao) => {
          const disponivel = disponiveis.includes(secao);
          const pontos = disponivel ? pontuarSecao(secao, consulta) : 0;
          const corresponde = !consulta ? disponivel : pontos >= 20;
          secao.classList.toggle('config-filtrada', !corresponde);
          secao.classList.toggle('config-corresponde', !!consulta && corresponde);
          secao.dataset.buscaPontos = String(pontos);
          if (consulta && corresponde) {
            resultados.push({ secao, pontos });
            if (secao.classList.contains('config-recolhivel')) recolherConfig(secao, false);
          }
        });

        resultados.sort((a, b) => b.pontos - a.pontos);
        const encontradas = resultados.length + (rota ? 1 : 0);
        if (!consulta && buscaEstavaAtiva) mostrarSomenteConfiguracoesImportantes(caixa);
        buscaEstavaAtiva = !!consulta;

        botaoLimpar.hidden = !consulta;
        toolbar.classList.toggle('config-sem-resultado', !!consulta && !encontradas);
        if (!consulta) statusBusca.textContent = 'Digite acima para localizar uma opção ou uma área do sistema.';
        else if (!encontradas) statusBusca.textContent = 'Nenhuma função encontrada. Tente uma palavra mais simples, como “senha”, “nota” ou “backup”.';
        else statusBusca.textContent = `${encontradas} ${encontradas === 1 ? 'resultado encontrado' : 'resultados encontrados'}. Pressione Enter para abrir o primeiro.`;
        caixaResultados.replaceChildren();
        const adicionarResultado = (tituloResultado, tipoResultado, aoAbrir) => {
          const botao = document.createElement('button');
          botao.type = 'button';
          botao.className = 'config-busca-resultado';
          const nome = document.createElement('span');
          nome.textContent = tituloResultado;
          const tipo = document.createElement('small');
          tipo.textContent = tipoResultado;
          botao.append(nome, tipo);
          botao.addEventListener('click', aoAbrir);
          caixaResultados.appendChild(botao);
        };
        if (rota) adicionarResultado(rota.titulo, 'Abrir área do sistema', () => abrirRotaDaBusca(rota));
        resultados.slice(0, 6).forEach(({ secao }) => {
          const titulo = tituloConfigDireto(secao);
          adicionarResultado(titulo?.textContent?.trim() || 'Abrir configuração', 'Configuração', () => {
            inputBusca.value = '';
            aplicarBusca();
            recolherConfig(secao, false);
            titulo?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            setTimeout(() => titulo?.focus?.(), 180);
          });
        });
        caixaResultados.hidden = !consulta || !encontradas;
        toolbar._rotaResultado = rota;
        toolbar._primeiroResultado = rota || resultados[0]?.secao || null;
      };

      inputBusca.addEventListener('input', aplicarBusca);
      inputBusca.addEventListener('search', aplicarBusca);
      inputBusca.addEventListener('keydown', (evento) => {
        if (evento.key === 'Escape' && inputBusca.value) {
          evento.preventDefault();
          inputBusca.value = '';
          aplicarBusca();
          return;
        }
        if (evento.key !== 'Enter' || !toolbar._primeiroResultado) return;
        evento.preventDefault();
        if (toolbar._rotaResultado) {
          abrirRotaDaBusca(toolbar._rotaResultado);
          return;
        }
        const titulo = tituloConfigDireto(toolbar._primeiroResultado);
        titulo?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        setTimeout(() => titulo?.focus?.(), 180);
      });
      botaoLimpar.addEventListener('click', () => {
        inputBusca.value = '';
        aplicarBusca();
        inputBusca.focus();
      });
      toolbar._aplicarBusca = aplicarBusca;
    }

    const secoes = Array.from(caixa.querySelectorAll(':scope > .config-secao'));
    secoes.forEach((secao, indice) => {
      const titulo = tituloConfigDireto(secao);
      if (!titulo || secao.classList.contains('config-recolhivel')) return;
      secao.classList.add('config-recolhivel');
      titulo.setAttribute('role', 'button');
      titulo.setAttribute('tabindex', '0');
      const alternar = (evento) => {
        if (evento?.target?.closest?.('button, a, input, select, textarea, label')) return;
        recolherConfig(secao, secao.dataset.recolhido !== 'true');
      };
      titulo.addEventListener('click', alternar);
      titulo.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Enter' && evento.key !== ' ') return;
        evento.preventDefault();
        alternar(evento);
      });
      recolherConfig(secao, !secaoConfigImportante(secao, indice));
    });

    toolbar._aplicarBusca?.();

    if (caixa.dataset.configObservada !== 'true') {
      caixa.dataset.configObservada = 'true';
      new MutationObserver(() => prepararConfiguracoes()).observe(caixa, { childList: true });
    }

    if (caixa.dataset.configAtalhos !== 'true') {
      caixa.dataset.configAtalhos = 'true';
      document.addEventListener('keydown', (evento) => {
        if (caixa.closest('#modalConfig')?.classList.contains('escondido')) return;
        if (!(evento.ctrlKey && evento.key.toLowerCase() === 'f')) return;
        evento.preventDefault();
        const input = toolbar.querySelector('#configBuscaFuncoes');
        input?.focus();
        input?.select();
      });
    }
  }

  function abrirCardDoCampo(campo) {
    window.SistemaOSFormLayout?.revelar(campo);
    const card = campo?.closest?.('.card.card-recolhivel');
    if (!card) return;
    recolher(card, false);
    const contexto = card.closest('[data-form-organizado="true"]');
    const toolbar = contexto?.previousElementSibling?.classList?.contains('form-organizador')
      ? contexto.previousElementSibling
      : contexto?.querySelector?.(':scope > .form-organizador');
    if (toolbar) atualizarResumo(toolbar, cardsDaRaiz(contexto));
  }

  document.addEventListener('invalid', (evento) => abrirCardDoCampo(evento.target), true);
  document.addEventListener('click', (evento) => {
    if (!evento.target.closest('#btnGerarPDF, #btnSalvarEditar, #btnSalvarCompra')) return;
    setTimeout(() => {
      const invalido = document.querySelector('.campo-invalido, :invalid');
      if (invalido) abrirCardDoCampo(invalido);
    }, 0);
  });

  function iniciar() {
    formularios.forEach(prepararFormulario);
    prepararConfiguracoes();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();
})();
