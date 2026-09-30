(function (root) {
  'use strict';
  var historico = [];
  var ocupado = false;
  var ultimoFoco = null;
  function $(id) { return root.document.getElementById(id); }

  var PROMPT_SISTEMA = [
    'Você é o Assistente Sistema OS no APLICATIVO ANDROID.',
    'Responda em português do Brasil, de forma curta, prática e sem inventar recursos.',
    'PLATAFORMA ATUAL: CELULAR ANDROID. Ensine somente caminhos existentes no celular e avise claramente quando algo exigir o PC.',
    'No Android é possível criar OS, compra, venda, entrega e desbloqueio; consultar histórico, documentos, cobranças, clientes, estoque, tabela de preços, estatísticas, reparos e notas fiscais; coletar assinaturas; abrir e compartilhar PDFs.',
    'A IA do celular é apenas orientativa: não altera, exclui, envia nem confirma operações. Toda ação deve ser feita e confirmada pelo usuário nas telas do aplicativo.',
    'Fiscal no Android: a aba Notas fiscais pesquisa documentos por cliente/operação/chave, mostra status, cota, saldo, abre e compartilha o DANFSe autorizado e permite iniciar recarga via Mercado Pago quando habilitada.',
    'Fiscal que exige PC: cadastrar emitente, município/regime/serviço, criar ou conferir empresa no emissor, cadastrar inscrição municipal, enviar e-CNPJ A1 e solicitar/cancelar NFS-e. Caminho no PC: Configurações > NFS-e e DANFSe.',
    'NF-e e NFC-e de produtos ainda não estão implementadas. Compra não gera nota de saída. CPF pode ser tomador; emitente CPF depende do município, e a integração NFE.io atual exige CNPJ e e-CNPJ A1.',
    'Critério de preenchimento: OS usa cliente, número e valor total do serviço/orçamento; Venda usa comprador e somente serviço/mão de obra, nunca o preço do aparelho; Compra guarda o documento do fornecedor; emissão avulsa ainda não tem formulário.',
    'Cadastro fiscal salvo não garante emissão: o servidor fiscal, o provedor e a prefeitura precisam autorizar. Nunca peça chave de API, senha GOV.BR, senha de certificado ou dados secretos.',
    'Se a pergunta depender de dados atuais de uma OS/cliente/estoque que não foram fornecidos na conversa, explique onde consultar; não invente dados.'
  ].join('\n');

  function definirStatus(texto) { if ($('ia-mobile-status')) $('ia-mobile-status').textContent = texto || ''; }

  function adicionarTrechoSeguro(p, texto) {
    String(texto || '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean).forEach(function (parte) {
      if (/^\*\*[^*]+\*\*$/.test(parte)) {
        var forte = root.document.createElement('strong'); forte.textContent = parte.slice(2, -2); p.append(forte);
      } else p.append(root.document.createTextNode(parte));
    });
  }

  function adicionarMensagem(papel, texto) {
    var caixa = root.document.createElement('article');
    caixa.className = 'ia-mobile-msg ia-mobile-msg-' + papel;
    String(texto || '').split(/\n{2,}/).forEach(function (bloco) {
      var p = root.document.createElement('p'); adicionarTrechoSeguro(p, bloco); caixa.append(p);
    });
    $('ia-mobile-mensagens').append(caixa);
    $('ia-mobile-mensagens').scrollTop = $('ia-mobile-mensagens').scrollHeight;
  }

  function respostaTexto(retorno) {
    return String(retorno?.resposta?.choices?.[0]?.message?.content || retorno?.resposta?.output_text || '').trim();
  }

  async function perguntar(texto) {
    var cliente = root.SupabaseClientApp?.obterCliente?.();
    if (!cliente) throw new Error('Entre na conta da empresa para usar a IA.');
    var mensagens = [{ role: 'system', content: PROMPT_SISTEMA }].concat(historico.slice(-9), [{ role: 'user', content: texto }]);
    var resposta = await cliente.functions.invoke('integracoes-empresa', {
      body: { tipo: 'ia', acao: 'chat', dados: { mensagens: mensagens, opcoes: { maxTokens: 900, temperature: 0.2 } } }
    });
    if (resposta.error && root.SistemaOSEdgeError) await root.SistemaOSEdgeError.lancar(resposta.error, 'Não foi possível consultar a IA.');
    if (resposta.error) throw resposta.error;
    if (resposta.data?.erro) throw new Error(resposta.data.erro);
    var textoResposta = respostaTexto(resposta.data);
    if (!textoResposta) throw new Error('A IA não retornou uma resposta válida.');
    return textoResposta;
  }

  function abrir() {
    if (!$('painel-ia-mobile') || !$('painel-ia-mobile').hidden) return;
    ultimoFoco = root.document.activeElement;
    $('painel-ia-mobile').hidden = false;
    root.document.body.classList.add('ia-mobile-aberta');
    if (!historico.length && !$('ia-mobile-mensagens').children.length) adicionarMensagem('assistente', 'Olá! Posso explicar como usar o Sistema OS neste celular e avisar quando uma etapa precisa ser feita no PC.');
    definirStatus('A IA usa a configuração global ou a chave permitida para sua empresa.');
    setTimeout(function () { $('ia-mobile-pergunta')?.focus(); }, 0);
  }

  function fechar() {
    if (!$('painel-ia-mobile')) return;
    $('painel-ia-mobile').hidden = true;
    root.document.body.classList.remove('ia-mobile-aberta');
    ultimoFoco?.focus?.();
  }

  function limpar() {
    historico = [];
    $('ia-mobile-mensagens')?.replaceChildren();
    adicionarMensagem('assistente', 'Conversa reiniciada. O que você precisa fazer no aplicativo?');
    definirStatus('');
  }

  function aplicarSessao(estado) {
    var contexto = estado?.contexto || root.SistemaOSPermissoes?.obterContexto?.();
    var disponivel = estado?.tipo === 'autenticado' && contexto?.usuario_ativo === true &&
      contexto?.empresa_ativa === true && contexto?.administrador_global !== true && !!contexto?.empresa_id;
    if ($('btn-ia-mobile')) $('btn-ia-mobile').hidden = !disponivel;
    if (!disponivel) {
      historico = [];
      fechar();
      $('ia-mobile-mensagens')?.replaceChildren();
    }
  }

  root.document.addEventListener('DOMContentLoaded', function () {
    $('btn-ia-mobile')?.addEventListener('click', abrir);
    $('btn-fechar-ia-mobile')?.addEventListener('click', fechar);
    $('btn-limpar-ia-mobile')?.addEventListener('click', limpar);
    $('painel-ia-mobile')?.addEventListener('click', function (evento) { if (evento.target === $('painel-ia-mobile')) fechar(); });
    $('painel-ia-mobile')?.addEventListener('keydown', function (evento) {
      if (evento.key === 'Escape') { evento.preventDefault(); fechar(); }
      if (evento.key !== 'Tab') return;
      var focaveis = Array.from($('painel-ia-mobile').querySelectorAll('button:not(:disabled),textarea:not(:disabled)'));
      if (!focaveis.length) return;
      var primeiro = focaveis[0]; var ultimo = focaveis[focaveis.length - 1];
      if (evento.shiftKey && root.document.activeElement === primeiro) { evento.preventDefault(); ultimo.focus(); }
      else if (!evento.shiftKey && root.document.activeElement === ultimo) { evento.preventDefault(); primeiro.focus(); }
    });
    $('form-ia-mobile')?.addEventListener('submit', async function (evento) {
      evento.preventDefault();
      if (ocupado) return;
      var entrada = $('ia-mobile-pergunta');
      var pergunta = String(entrada?.value || '').trim();
      if (!pergunta) return;
      ocupado = true; entrada.value = ''; $('btn-enviar-ia-mobile').disabled = true;
      adicionarMensagem('usuario', pergunta); definirStatus('Consultando com segurança…');
      try {
        var resposta = await perguntar(pergunta);
        historico.push({ role: 'user', content: pergunta }, { role: 'assistant', content: resposta });
        historico = historico.slice(-10);
        adicionarMensagem('assistente', resposta); definirStatus('');
      } catch (erro) {
        definirStatus(erro?.message || 'Não foi possível consultar a IA agora.');
      } finally {
        ocupado = false; $('btn-enviar-ia-mobile').disabled = false; entrada.focus();
      }
    });
    aplicarSessao(root.SistemaOSSessao?.obterEstado?.() || null);
  });
  root.document.addEventListener('sistema-os:sessao-alterada', function (evento) {
    historico = [];
    fechar();
    $('ia-mobile-mensagens')?.replaceChildren();
    aplicarSessao(evento?.detail || null);
  });
})(window);
