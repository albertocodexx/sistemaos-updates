// js/consulta.js
//
// Aba "Consulta" (7ª posição na nav). Busca OS, garantia e entrega nas
// views leves do Supabase somente quando o usuário solicitar.

(function () {
  'use strict';

  var painel = document.getElementById('painel-consulta');
  if (!painel) return; // painel-consulta não existe nesta versão do HTML

  var avisoStatusSync = document.getElementById('consulta-status-sync');

  var campoConsultaOS = document.getElementById('consulta-os-numero');
  var btnConsultarOS = document.getElementById('btn-consultar-os');
  var resultadoOS = document.getElementById('consulta-os-resultado');
  var campoConsultaCliente = document.getElementById('consulta-cliente-termo');
  var btnConsultarCliente = document.getElementById('btn-consultar-cliente');
  var resultadoCliente = document.getElementById('consulta-cliente-resultado');
  // `app.js` mantém a referência da navegação no escopo dele. O leitor QR
  // roda em outro módulo, então precisa obter seu próprio botão antes de
  // abrir a consulta. Sem esta referência, uma leitura válida terminava em
  // ReferenceError logo depois de reconhecer a etiqueta.
  var btnIrConsulta = document.getElementById('btn-ir-consulta');

  var campoConsultaGarantia = document.getElementById('consulta-garantia-numero');
  var btnConsultarGarantia = document.getElementById('btn-consultar-garantia');
  var resultadoGarantia = document.getElementById('consulta-garantia-resultado');

  var campoConsultaEntrega = document.getElementById('consulta-entrega-numero');
  var btnConsultarEntrega = document.getElementById('btn-consultar-entrega');
  var resultadoEntrega = document.getElementById('consulta-entrega-resultado');

  // Editar/Excluir (bloco novo): só a busca de OS ganha essas ações —
  // garantia/entrega continuam somente leitura (não fazem sentido editar
  // por aqui: são derivadas da OS). Guarda o último resultado de OS
  // consultado, indexado por número, para o formulário de edição
  // preencher os valores atuais sem precisar buscar de novo.
  var ultimaConsultaOSPorNumero = {}; // numero -> dados (envelope.dados)
  var consultaAbertaPorQR = false;

  // Espelha STATUS_OS_VALIDOS / PRIORIDADES_OS_VALIDAS do sistema principal.
  // O servidor segue validando de verdade; esta lista monta os selects.
  // Se a lista mudar no PC, atualizar aqui também.
  var STATUS_OS_VALIDOS = ['Aguardando análise', 'Em diagnóstico', 'Aguardando aprovação', 'Aguardando peça', 'Em reparo', 'Em testes', 'Pronto para retirada', 'Entregue', 'Cancelado'];
  var PRIORIDADES_OS_VALIDAS = ['Baixa', 'Normal', 'Alta', 'Urgente'];

  function escaparHtml(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function rotuloOS(valor) {
    return window.SistemaOSNumero && window.SistemaOSNumero.formatar
      ? (window.SistemaOSNumero.formatar(valor) || 'OS')
      : String(valor || 'OS');
  }

  // ── Busca livre (OS / garantia / entrega) ────────────────────────
  // Renderiza o payload que o PC devolve de forma genérica/defensiva:
  // mostra os campos mais prováveis (número, status, defeito relatado,
  // reparo realizado, garantia) quando presentes, sem travar se algum
  // não vier — o formato exato do payload é responsabilidade do PC, este
  // módulo só exibe o que chegar.
  var ROTULOS_CAMPOS = {
    numero: 'Número',
    numeroOS: 'Nº OS',
    status: 'Status',
    statusAprovacao: 'Aprovação da OS',
    statusPagamento: 'Pagamento',
    clienteNome: 'Cliente',
    clienteTelefone: 'Telefone',
    clienteCpf: 'CPF',
    clienteId: 'ID do cliente',
    nomeRetirou: 'Retirado por',
    aparelhoMarca: 'Marca',
    aparelhoModelo: 'Modelo',
    aparelhoNome: 'Aparelho',
    defeitoRelatado: 'Defeito relatado',
    defeitoGarantia: 'Defeito da garantia',
    reparoRealizado: 'Reparo realizado',
    observacoes: 'Observações',
    descricao: 'Descrição',
    cor: 'Cor',
    estadoAssinatura: 'Assinatura',
    prioridade: 'Prioridade',
    valor: 'Valor',
    formaPagamento: 'Forma de pagamento',
    formaEntrega: 'Forma de entrega',
    garantiaDias: 'Garantia (dias)',
    dataLimiteGarantia: 'Garantia válida até',
    dataPrevista: 'Data prevista',
    horaPrevista: 'Hora prevista',
    semPrazo: 'Prazo',
    dataConclusao: 'Data de conclusão',
    dataHoraEntrega: 'Data/hora da entrega',
    data: 'Data',
    dataHoraAssinatura: 'Data/hora assinatura'
  };

  var ENTIDADE_ARQUIVO_POR_TIPO = {
    os: 'ordem_servico',
    garantia: 'garantia',
    entrega: 'entrega',
    compra: 'compra',
    venda: 'venda'
  };

  function tamanhoLegivel(bytes) {
    var total = Number(bytes || 0);
    if (!total) return '';
    if (total < 1024) return total + ' B';
    if (total < 1024 * 1024) return Math.round(total / 1024) + ' KB';
    return (total / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
  }

  function abrirUrlExterna(url) {
    var browserNativo = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (browserNativo && typeof browserNativo.open === 'function') {
      return browserNativo.open({ url: url }).catch(function () {
        window.open(url, '_blank');
      });
    }
    var novaJanela = window.open(url, '_blank');
    if (!novaJanela) window.location.href = url;
    return Promise.resolve();
  }

  function lerArquivoComoDataUrl(arquivo) {
    return new Promise(function (resolve, reject) {
      var leitor = new FileReader();
      leitor.onload = function () { resolve(leitor.result); };
      leitor.onerror = function () { reject(new Error('Não foi possível ler o arquivo selecionado.')); };
      leitor.readAsDataURL(arquivo);
    });
  }

  async function prepararComprovanteSelecionado(arquivo) {
    var dataUrl = await lerArquivoComoDataUrl(arquivo);
    if (!/^image\//i.test(arquivo.type || '')) return dataUrl;
    return new Promise(function (resolve, reject) {
      var imagem = new Image();
      imagem.onload = function () {
        try {
          var largura = imagem.naturalWidth || imagem.width;
          var altura = imagem.naturalHeight || imagem.height;
          var limite = 1600;
          if (largura > altura && largura > limite) {
            altura = Math.round(altura * limite / largura); largura = limite;
          } else if (altura > limite) {
            largura = Math.round(largura * limite / altura); altura = limite;
          }
          var canvas = document.createElement('canvas');
          canvas.width = largura; canvas.height = altura;
          var ctx = canvas.getContext('2d', { alpha: false });
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, largura, altura);
          ctx.drawImage(imagem, 0, 0, largura, altura);
          resolve(canvas.toDataURL('image/jpeg', 0.62));
        } catch (erro) { reject(erro); }
      };
      imagem.onerror = function () { reject(new Error('A imagem selecionada não pôde ser processada.')); };
      imagem.src = dataUrl;
    });
  }

  function criarBlocoAnexoComprovante(dados) {
    var bloco = document.createElement('section');
    bloco.className = 'anexo-comprovante-consulta';
    var ajuda = document.createElement('small');
    ajuda.textContent = 'Anexe uma foto ou o PDF do comprovante térmico assinado. O PC receberá este arquivo dentro da OS.';
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,application/pdf';
    var botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'btn-secundario';
    botao.textContent = 'Anexar comprovante assinado';
    var estado = document.createElement('small');
    estado.hidden = true;
    botao.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', async function () {
      var arquivo = input.files && input.files[0];
      if (!arquivo) return;
      botao.disabled = true;
      botao.textContent = 'Enviando comprovante…';
      estado.hidden = false;
      estado.textContent = 'Preparando o arquivo com segurança…';
      try {
        var dataUrl = await prepararComprovanteSelecionado(arquivo);
        await window.CloudData.anexarComprovanteTermicoAssinado(
          dados.id, dados.numero || dados.numeroOS, dataUrl, arquivo.name
        );
        estado.textContent = 'Comprovante anexado e sincronizado. Ele aparecerá no PC dentro desta OS.';
        if (window.SistemaOSToast) window.SistemaOSToast.mostrar('Comprovante assinado anexado à OS.', 'sucesso');
      } catch (erro) {
        estado.textContent = erro && erro.message ? erro.message : 'Não foi possível anexar o comprovante.';
        if (window.SistemaOSToast) window.SistemaOSToast.mostrar(estado.textContent, 'erro');
      } finally {
        botao.disabled = false;
        botao.textContent = 'Anexar outro comprovante assinado';
        input.value = '';
      }
    });
    bloco.appendChild(ajuda);
    bloco.appendChild(input);
    bloco.appendChild(botao);
    bloco.appendChild(estado);
    return bloco;
  }

  function moeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function mensagemCompartilhamento(tipo, dados, numeroConsultado) {
    var empresa = window.ConfigApp?.montarDadosEmpresa?.() || {};
    var nomeEmpresa = String(empresa.nomeFantasia || empresa.nomeEmpresa || empresa.razaoSocial || 'assistência técnica').trim();
    var cliente = String(dados.clienteNome || dados.nomeRetirou || dados.cliente?.nome || '').trim();
    var numero = String(dados.numero || dados.numeroOS || numeroConsultado || 'OS').trim();
    var saudacao = cliente ? 'Olá, ' + cliente + '. ' : 'Olá! ';
    var descricao = tipo === 'garantia'
      ? 'Segue o comprovante de garantia da ' + numero
      : tipo === 'entrega'
        ? 'Segue o comprovante de entrega da ' + numero
        : tipo === 'compra' ? 'Segue o comprovante de compra ' + numero
        : tipo === 'venda' ? 'Segue o comprovante de venda ' + numero
        : 'Segue a Ordem de Serviço ' + numero;
    var concordancia = tipo === 'os' ? 'emitida' : 'emitido';
    return saudacao + descricao + ', ' + concordancia + ' pela ' + nomeEmpresa + '.';
  }

  function recebidoNaOS(dados) {
    var exato = Number(dados.valorRecebidoConfirmado || 0);
    if (exato > 0) return exato;
    var total = Number(dados.valorTotalServico || dados.valor || 0);
    var percentual = Number(dados.percentualPagamentoConfirmado || 0);
    if (/^(autorizado|pago)$/.test(String(dados.statusPagamento || '').toLowerCase())) percentual = 100;
    return total * Math.max(0, Math.min(100, percentual)) / 100;
  }

  function statusLembrete(item) {
    var salvo = String(item.status || '').toLowerCase();
    if ((item.confirmadoEm || item.pagoEm) && salvo !== 'desativada') return 'Paga';
    if (salvo === 'paga') return 'Paga';
    if (salvo === 'desativada') return 'Desativada';
    if (salvo === 'atrasada') return 'Atrasada';
    var limite = new Date(String(item.data || '') + 'T23:59:59');
    return Number.isFinite(limite.getTime()) && limite.getTime() < Date.now() ? 'Atrasado' : 'Agendado';
  }

  function criarBlocoCobrancaOS(dados, numeroRealOS) {
    var bloco = document.createElement('section');
    bloco.className = 'cobranca-os-consulta';
    var total = Number(dados.valorTotalServico || dados.valor || 0);
    var recebido = Math.min(total || Infinity, recebidoNaOS(dados));
    var falta = Math.max(0, total - recebido);
    var lembretes = Array.isArray(dados.lembretesCobranca) ? dados.lembretesCobranca.map(function (item) {
      return Object.assign({}, item);
    }) : [];

    var titulo = document.createElement('header');
    titulo.innerHTML = '<strong>Cobrança da OS</strong><span>' + (falta > 0 ? 'Pagamento pendente' : 'Pagamento concluído') + '</span>';
    bloco.appendChild(titulo);

    var resumo = document.createElement('div');
    resumo.className = 'cobranca-os-resumo';
    resumo.innerHTML = '<div><span>Total</span><strong>' + moeda(total) + '</strong></div>' +
      '<div><span>Recebido</span><strong>' + moeda(recebido) + '</strong></div>' +
      '<div><span>Falta</span><strong>' + moeda(falta) + '</strong></div>';
    bloco.appendChild(resumo);

    var lista = document.createElement('div');
    lista.className = 'cobranca-os-lembretes';
    lembretes.forEach(function (item) {
      var estado = statusLembrete(item);
      var linha = document.createElement('div');
      linha.className = 'cobranca-os-lembrete ' + estado.toLowerCase();
      var dataBr = String(item.data || '').split('-').reverse().join('/');
      linha.innerHTML = '<div><strong>' + escaparHtml(dataBr) + '</strong><span>' + escaparHtml(estado) +
        (Number(item.valor || 0) > 0 ? ' · ' + moeda(item.valor) : '') + '</span></div>';
      if (statusLembrete(item) !== 'Paga' && statusLembrete(item) !== 'Desativada' && falta > 0) {
        var receberParcela = document.createElement('button');
        receberParcela.type = 'button';
        receberParcela.className = 'btn-secundario';
        receberParcela.textContent = 'Confirmar';
        receberParcela.addEventListener('click', function () {
          confirmarRecebimentoCobranca(dados, numeroRealOS, item, Number(item.valor || 0) || falta, receberParcela);
        });
        linha.appendChild(receberParcela);
      }
      lista.appendChild(linha);
    });
    if (lembretes.length) bloco.appendChild(lista);

    if (falta > 0 && total > 0) {
      var acoes = document.createElement('div');
      acoes.className = 'cobranca-os-confirmar';
      var campo = document.createElement('input');
      campo.type = 'number'; campo.min = '0.01'; campo.step = '0.01'; campo.value = String(Number(falta.toFixed(2)));
      campo.setAttribute('aria-label', 'Valor recebido agora');
      var botao = document.createElement('button');
      botao.type = 'button'; botao.className = 'btn-primario'; botao.textContent = 'Confirmar recebimento';
      botao.addEventListener('click', function () {
        confirmarRecebimentoCobranca(dados, numeroRealOS, null, Number(campo.value), botao);
      });
      acoes.appendChild(campo); acoes.appendChild(botao); bloco.appendChild(acoes);
    } else if (!(total > 0)) {
      var aviso = document.createElement('small');
      aviso.textContent = 'Informe o valor da OS no PC para acompanhar a cobrança.';
      bloco.appendChild(aviso);
    }
    return bloco;
  }

  async function confirmarRecebimentoCobranca(dados, numeroRealOS, lembrete, valor, botao) {
    var total = Number(dados.valorTotalServico || dados.valor || 0);
    var recebidoAntes = recebidoNaOS(dados);
    var falta = Math.max(0, total - recebidoAntes);
    valor = Number(valor || 0);
    if (!(valor > 0) || valor > falta + 0.01) {
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar('Informe um valor entre R$ 0,01 e ' + moeda(falta) + '.', 'erro');
      return;
    }
    if (!window.confirm('Confirmar o recebimento de ' + moeda(valor) + ' na ' + rotuloOS(numeroRealOS) + '?')) return;
    var recebidoNovo = Math.min(total, Number((recebidoAntes + valor).toFixed(2)));
    var percentual = total > 0 ? Math.min(100, Math.round(recebidoNovo / total * 100)) : 0;
    var lembretes = (dados.lembretesCobranca || []).map(function (item) {
      if (!lembrete || String(item.id || item.data) !== String(lembrete.id || lembrete.data)) return item;
      return Object.assign({}, item, { confirmadoEm: new Date().toISOString(), valorRecebido: valor });
    });
    var extras = Object.assign({}, dados.dadosExtras || {}, {
      valor_total_servico: total,
      valor_recebido_confirmado: recebidoNovo,
      valor_restante_servico: Math.max(0, total - recebidoNovo),
      percentual_pagamento_confirmado: percentual,
      entrada_50_paga: percentual === 50,
      status_aprovacao: percentual > 0 ? 'Aprovado' : (dados.statusAprovacao || 'Pendente'),
      status_pagamento_local: percentual >= 100 ? 'Pago' : (percentual === 50 ? 'Pago 50%' : (dados.statusPagamento || '')),
      lembretes_cobranca: lembretes
    });
    var textoOriginal = botao.textContent;
    botao.disabled = true; botao.textContent = 'Confirmando…';
    try {
      var resultado = await window.CloudData.atualizarOS(dados, dados.revision, {
        dados_extras: extras,
        status_pagamento: percentual >= 100 ? 'Autorizado' : (dados.statusPagamento || 'Aguardando Pagamento')
      });
      if (!resultado || (!resultado.enviado && !resultado.enfileirado)) throw new Error('A confirmação não foi aceita pela nuvem.');
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar(
        resultado.enfileirado ? 'Recebimento salvo. Será sincronizado ao reconectar.' : 'Recebimento confirmado e enviado ao PC.',
        resultado.enfileirado ? 'aviso' : 'sucesso'
      );
      campoConsultaOS.value = numeroRealOS;
      if (!resultado.enfileirado) await executarConsultaUnificada();
    } catch (erro) {
      botao.disabled = false; botao.textContent = textoOriginal;
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar(erro.message || 'Não foi possível confirmar o recebimento.', 'erro');
    }
  }

  function mostrarResultadoArquivo(arquivo, resultado, item, botao, miniatura) {
    botao.disabled = false;
    botao.textContent = miniatura ? 'Ver miniatura' : 'Abrir arquivo';
    var aviso = item.querySelector('.arquivo-consulta-aviso');
    if (!aviso) {
      aviso = document.createElement('p');
      aviso.className = 'arquivo-consulta-aviso';
      item.appendChild(aviso);
    }
    if (!resultado || !resultado.disponivel) {
      aviso.textContent = resultado && resultado.mensagem
        ? resultado.mensagem
        : 'Arquivo indisponível no momento.';
      aviso.hidden = false;
      return;
    }
    aviso.hidden = true;
    if (miniatura) {
      var imagem = item.querySelector('.arquivo-consulta-miniatura');
      if (!imagem) {
        imagem = document.createElement('img');
        imagem.className = 'arquivo-consulta-miniatura';
        imagem.alt = 'Miniatura de ' + (arquivo.nomeArquivo || 'arquivo');
        item.appendChild(imagem);
      }
      // O download da imagem acontece somente aqui, depois do clique.
      imagem.src = resultado.url;
      return;
    }
    abrirUrlExterna(resultado.url);
  }

  function criarBotaoCompartilhar(dados, tipo, arquivo) {
    var botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'btn-secundario btn-compartilhar-pdf-consulta';
    botao.textContent = 'Compartilhar PDF';
    botao.addEventListener('click', async function () {
      var versao = versaoConsultaCliente;
      botao.disabled = true; botao.textContent = 'Preparando PDF…';
      try {
        if (tipo === 'desbloqueio') {
          await window.SistemaOSDesbloqueiosMobile.compartilhar(dados.id);
          return;
        }
        var lista = arquivo ? [arquivo] : await window.CloudData.listarArquivos(ENTIDADE_ARQUIVO_POR_TIPO[tipo], dados.id);
        if (versao !== versaoConsultaCliente) return;
        var pdf = lista.find(function (a) { return a.mimeType === 'application/pdf' || /\.pdf$/i.test(a.nomeArquivo || ''); });
        if (!pdf) throw new Error('Ainda não há PDF disponível. Gere o documento e aguarde a sincronização.');
        var acesso = await window.CloudData.obterArquivo(pdf.id, { miniatura: false });
        if (versao !== versaoConsultaCliente) return;
        if (!acesso?.disponivel || !acesso.url) throw new Error(acesso?.mensagem || 'O PDF está no computador. Aguarde a sincronização e tente novamente.');
        var resposta = await window.SistemaOSCompartilhar.compartilharPdfPorUrl(acesso.url, pdf.nomeArquivo || tipo + '.pdf', 'Compartilhar documento', mensagemCompartilhamento(tipo, dados));
        if (versao === versaoConsultaCliente) window.SistemaOSToast?.mostrar(window.SistemaOSCompartilhar.mensagemResultado(resposta), 'sucesso');
      } catch (erro) {
        if (versao === versaoConsultaCliente) {
          var aviso = botao.parentElement.querySelector('.consulta-compartilhar-erro');
          if (!aviso) { aviso = document.createElement('p'); aviso.className = 'consulta-compartilhar-erro aviso'; botao.parentElement.appendChild(aviso); }
          aviso.textContent = erro.message || 'Não foi possível compartilhar. Tente novamente.';
        }
      } finally { botao.disabled = false; botao.textContent = 'Compartilhar PDF'; }
    });
    return botao;
  }

  function renderizarArquivosSobDemanda(lista, container, dados, tipo) {
    container.innerHTML = '';
    if (!lista || !lista.length) {
      container.textContent = 'Nenhum arquivo disponível para este registro.';
      return;
    }
    lista.forEach(function (arquivo) {
      var item = document.createElement('div');
      item.className = 'arquivo-consulta-item';
      var info = document.createElement('div');
      info.className = 'arquivo-consulta-info';
      var nome = document.createElement('strong');
      nome.textContent = arquivo.nomeArquivo || 'Arquivo';
      var detalhes = document.createElement('span');
      var categoria = arquivo.categoria === 'comprovante_termico_assinado'
        ? 'Comprovante térmico assinado' : arquivo.categoria;
      detalhes.textContent = [categoria, tamanhoLegivel(arquivo.tamanhoBytes), arquivo.disponibilidade]
        .filter(Boolean).join(' · ');
      info.appendChild(nome);
      info.appendChild(detalhes);
      item.appendChild(info);

      var acoes = document.createElement('div');
      acoes.className = 'arquivo-consulta-acoes';
      if (arquivo.temMiniatura) {
        var btnMiniatura = document.createElement('button');
        btnMiniatura.type = 'button';
        btnMiniatura.className = 'btn-secundario';
        btnMiniatura.textContent = 'Ver miniatura';
        btnMiniatura.addEventListener('click', function () {
          btnMiniatura.disabled = true;
          btnMiniatura.textContent = 'Carregando…';
          window.CloudData.obterArquivo(arquivo.id, { miniatura: true })
            .then(function (resultado) { mostrarResultadoArquivo(arquivo, resultado, item, btnMiniatura, true); })
            .catch(function () { mostrarResultadoArquivo(arquivo, null, item, btnMiniatura, true); });
        });
        acoes.appendChild(btnMiniatura);
      }
      if (arquivo.temArquivoNuvem || arquivo.temArquivoLocal || arquivo.temArquivoLegado) {
        var btnAbrir = document.createElement('button');
        btnAbrir.type = 'button';
        btnAbrir.className = 'btn-primario';
        btnAbrir.textContent = 'Abrir arquivo';
        btnAbrir.addEventListener('click', function () {
          btnAbrir.disabled = true;
          btnAbrir.textContent = 'Preparando…';
          window.CloudData.obterArquivo(arquivo.id, { miniatura: false })
            .then(function (resultado) { mostrarResultadoArquivo(arquivo, resultado, item, btnAbrir, false); })
            .catch(function () { mostrarResultadoArquivo(arquivo, null, item, btnAbrir, false); });
        });
        acoes.appendChild(btnAbrir);
        if (arquivo.mimeType === 'application/pdf' || /\.pdf$/i.test(arquivo.nomeArquivo || '')) {
          acoes.appendChild(criarBotaoCompartilhar(dados, tipo, arquivo));
        }
      }
      item.appendChild(acoes);
      container.appendChild(item);
    });
  }

  function criarBlocoArquivosSobDemanda(dados, tipo) {
    var bloco = document.createElement('section');
    bloco.className = 'arquivos-consulta-bloco';
    var botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'btn-secundario btn-listar-arquivos-consulta';
    // A view inclui fotos, assinaturas e versões antigas. Só contar a lista
    // efetivamente visível, depois da leitura de metadados (sem download).
    botao.textContent = 'Ver arquivos';
    var lista = document.createElement('div');
    lista.className = 'arquivos-consulta-lista';
    lista.hidden = true;
    botao.addEventListener('click', function () {
      if (!lista.hidden) { lista.hidden = true; return; }
      lista.hidden = false;
      botao.disabled = true;
      lista.textContent = 'Carregando metadados…';
      window.CloudData.listarArquivos(ENTIDADE_ARQUIVO_POR_TIPO[tipo], dados.id)
        .then(function (arquivos) {
          botao.textContent = 'Ver arquivos (' + arquivos.length + ')';
          renderizarArquivosSobDemanda(arquivos, lista, dados, tipo);
        })
        .catch(function () { lista.textContent = 'Não foi possível carregar os metadados dos arquivos.'; })
        .then(function () { botao.disabled = false; });
    });
    bloco.appendChild(botao);
    bloco.appendChild(lista);
    return bloco;
  }

  function renderizarResultadoConsulta(elemento, dados, tipo, numeroConsultado, origem) {
    // Campos internos/metadata que NÃO devem aparecer na tela
    var CAMPOS_EXTERNOS = {
      tipo: 1, encontrado: 1, respondidoEm: 1, erro: 1,
      pdfUrl: 1, pdfFalhou: 1, pdfPath: 1, criadoEm: 1, atualizadoEm: 1,
      id: 1, empresaId: 1, ordemServicoId: 1, tecnicoId: 1, revision: 1,
      createdAt: 1, updatedAt: 1
    };
    // O comprovante de garantia já contém os termos completos no PDF. Na
    // consulta rápida do celular, mostrar esse texto só polui a tela.
    if (tipo === 'garantia') CAMPOS_EXTERNOS.termos = 1;

    function formatarValorConsulta(chave, valor) {
      if (chave === 'valor') return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
      if (typeof valor !== 'string') return valor;
      if (!/^data/i.test(chave)) return valor;
      var encontrouData = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
      return encontrouData ? encontrouData[3] + '/' + encontrouData[2] + '/' + encontrouData[1] : valor;
    }

    // Achata objetos aninhados (cliente {nome,telefone}, aparelho {marca,modelo})
    // para campos planos, para que o ROTULOS_CAMPOS encontre tudo.
    var dadosPlanos = {};
    Object.keys(dados).forEach(function (chave) {
      if (CAMPOS_EXTERNOS[chave]) return;
      if (CAMPOS_EXTERNOS[chave]) return;
      var valor = dados[chave];
      if (valor === undefined || valor === null) return;
      if (typeof valor === 'object' && !Array.isArray(valor)) {
        // Achata: ex. cliente.nome → chave "clienteNome", aparelho.marca → "marca"
        Object.keys(valor).forEach(function (sub) {
          if (valor[sub] === undefined || valor[sub] === null || valor[sub] === '') return;
          // Mapeia sub-chaves conhecidas para rótulos bonitos
          if (chave === 'cliente') {
            if (sub === 'nome') dadosPlanos.clienteNome = valor[sub];
            else if (sub === 'telefone') dadosPlanos.clienteTelefone = valor[sub];
            else if (sub === 'cpf') dadosPlanos.clienteCpf = valor[sub];
            else if (sub === 'clienteId') dadosPlanos.clienteId = valor[sub];
          } else if (chave === 'aparelho') {
            if (sub === 'nome') dadosPlanos.aparelhoNome = valor[sub];
            else if (sub === 'marca') dadosPlanos.aparelhoMarca = valor[sub];
            else if (sub === 'modelo') dadosPlanos.aparelhoModelo = valor[sub];
            else if (sub === 'defeitoRelatado') dadosPlanos.defeitoRelatado = valor[sub];
            else if (sub === 'observacoes') dadosPlanos.aparelhoObs = valor[sub];
          } else {
            dadosPlanos[chave + '_' + sub] = valor[sub];
          }
        });
      } else if (!Array.isArray(valor)) {
        dadosPlanos[chave] = valor;
      }
    });
    if (tipo === 'os' && (dados.semPrazo === true || (!dados.dataPrevista && !dados.horaPrevista))) {
      dadosPlanos.semPrazo = 'Sem prazo';
      delete dadosPlanos.dataPrevista;
      delete dadosPlanos.horaPrevista;
    }

    var linhas = Object.keys(ROTULOS_CAMPOS)
      .filter(function (chave) { return dadosPlanos[chave] !== undefined && dadosPlanos[chave] !== null && dadosPlanos[chave] !== ''; })
      .map(function (chave) {
        var valor = dadosPlanos[chave];
        if (typeof valor === 'object' && valor !== null) {
          valor = valor.nome || valor.clienteNome || JSON.stringify(valor);
        }
        return '<p><strong>' + escaparHtml(ROTULOS_CAMPOS[chave]) + ':</strong> ' + escaparHtml(formatarValorConsulta(chave, valor)) + '</p>';
      });

    // Apenas rótulos conhecidos: não expor chaves de sincronização ou zeros
    // de campos financeiros que não vieram nesta consulta leve.
    elemento.innerHTML = linhas.length ? linhas.join('') : '<p>Sem dados para exibir.</p>';
    // Botão "Abrir PDF" — aparece quando o PC devolve pdfUrl (para OS,
    // garantia e entrega). Baixa o PDF como blob e abre em nova aba,
    // evitando problemas do window.open() direto no WebView do Capacitor
    // (que baixa o arquivo em vez de abrir, ou o Google dá erro ao abrir).
    //
    // Se o PDF não estiver disponível, mostramos o motivo em vez de
    // simplesmente ocultar o botão. O servidor pode mandar `pdfFalhou` e
    // mostramos um aviso
    // visível em vez de botão nenhum. Logs `[Pdf]` em todo o clique para
    // rastrear falha de fetch/fallback.
    if (dados.pdfUrl) {
      var botaoPdf = document.createElement('button');
      botaoPdf.type = 'button';
      botaoPdf.className = 'btn-primario btn-abrir-pdf-consulta';
      var rotuloPdf = tipo === 'garantia' ? 'Abrir PDF da garantia'
        : tipo === 'entrega' ? 'Abrir PDF da entrega' : 'Abrir PDF da OS';
      botaoPdf.textContent = rotuloPdf;
      botaoPdf.addEventListener('click', function () {
        botaoPdf.disabled = true;
        botaoPdf.textContent = '⏳ Abrindo…';
        var reabilitar = function () {
          botaoPdf.disabled = false;
          botaoPdf.textContent = rotuloPdf;
        };
        // No APK, abre a URL HTTPS original pelo plugin Browser. Não usamos
        // blob: aqui: ele pertence ao WebView e não pode ser lido pelo
        // navegador nativo/externo que recebe a abertura.
        var browserNativo = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
        if (browserNativo && typeof browserNativo.open === 'function') {
          browserNativo.open({ url: dados.pdfUrl })
            .catch(function (err) {
              console.error('[Pdf] Browser nativo falhou:', err && err.message);
              window.open(dados.pdfUrl, '_blank');
            })
            .then(reabilitar);
        } else {
          // Navegador comum (fora do APK): mantém uma abertura utilizável.
          var novaJanela = window.open(dados.pdfUrl, '_blank');
          if (!novaJanela) window.location.href = dados.pdfUrl;
          reabilitar();
        }
      });
      elemento.appendChild(botaoPdf);
      var botaoCompartilharPdf = document.createElement('button');
      botaoCompartilharPdf.type = 'button';
      botaoCompartilharPdf.className = 'btn-secundario btn-compartilhar-pdf-consulta';
      botaoCompartilharPdf.textContent = 'Compartilhar PDF';
      botaoCompartilharPdf.addEventListener('click', function () {
        botaoCompartilharPdf.disabled = true;
        botaoCompartilharPdf.textContent = 'Preparando PDF…';
        var numeroDocumento = String(dados.numero || dados.numeroOS || numeroConsultado || 'OS');
        window.SistemaOSCompartilhar.compartilharPdfPorUrl(
          dados.pdfUrl,
          tipo + '-' + numeroDocumento + '.pdf',
          'Compartilhar ' + (tipo === 'garantia' ? 'garantia' : tipo === 'entrega' ? 'comprovante de entrega' : 'Ordem de Serviço'),
          mensagemCompartilhamento(tipo, dados, numeroConsultado)
          ).then(function (resultado) {
          if (window.SistemaOSToast) window.SistemaOSToast.mostrar(window.SistemaOSCompartilhar.mensagemResultado(resultado), 'sucesso');
        }).catch(function (erro) {
          if (window.SistemaOSToast) window.SistemaOSToast.mostrar('Não foi possível compartilhar: ' + (erro.message || erro), 'erro');
        }).then(function () {
          botaoCompartilharPdf.disabled = false;
          botaoCompartilharPdf.textContent = 'Compartilhar PDF';
        });
      });
      elemento.appendChild(botaoCompartilharPdf);
    } else if (dados.pdfFalhou) {
      // PDF indisponível no PC (upload falhou / arquivo sumiu / sem path).
      // Antes só sumia o botão silenciosamente.
      console.warn('[Pdf] PDF indisponível nesta consulta. motivo:', dados.pdfFalhou);
      var avisoPdf = document.createElement('p');
      avisoPdf.className = 'aviso-pdf-indisponivel';
      avisoPdf.style.cssText = 'color:#b00;font-size:0.9em;margin-top:8px;';
      var msgMotivo = {
        'upload-falhou': 'O PC não conseguiu enviar o PDF para a nuvem.',
        'arquivo-ausente': 'O arquivo do PDF não foi encontrado no PC.',
        'sem-path': 'Ainda não há PDF gerado para este registro no PC.'
      }[dados.pdfFalhou] || ('PDF indisponível no PC (' + dados.pdfFalhou + ').');
      avisoPdf.textContent = '⚠️ ' + msgMotivo + ' Os demais dados desta OS continuam corretos acima.';
      elemento.appendChild(avisoPdf);
    }
    if (origem === 'supabase' && dados.id && ENTIDADE_ARQUIVO_POR_TIPO[tipo] && window.CloudData &&
        window.CloudData.listarArquivos && window.CloudData.obterArquivo) {
      elemento.appendChild(criarBlocoArquivosSobDemanda(dados, tipo));
    }
    // A OS e seus documentos têm ações próprias para manter o vínculo original.
    if (tipo === 'os' && numeroConsultado) {
      // O campo digitado pode ser apenas "3", enquanto o PC devolve o
      // identificador real "OS-0003". Editar/excluir devem sempre usar o
      // número real retornado, não o texto usado na busca.
      var numeroRealOS = dados.numero || numeroConsultado;
      ultimaConsultaOSPorNumero[String(numeroRealOS)] = dados;
      var ehComprovanteTermicoRetirada = /pronto.*retir|entreg|finaliz|conclu/i.test(String(dados.status || ''));
      var btnComprovante = document.createElement('button');
      btnComprovante.type = 'button';
      btnComprovante.className = 'btn-primario btn-emitir-comprovante-consulta';
      btnComprovante.textContent = ehComprovanteTermicoRetirada
        ? 'Comprovante térmico / imprimir'
        : 'Emitir comprovante';
      btnComprovante.addEventListener('click', function () {
        var config = window.ConfigApp && window.ConfigApp.carregarConfig
          ? window.ConfigApp.carregarConfig()
          : {};
        if (!window.SistemaOSComprovante || typeof window.SistemaOSGerarHtmlComprovante !== 'function') {
          window.alert('O emissor de comprovante ainda está carregando. Tente novamente.');
          return;
        }
        window.SistemaOSComprovante.abrir({
          dados: ehComprovanteTermicoRetirada
            ? Object.assign({}, dados, { tipoComprovante: 'entrega' })
            : dados,
          config: config,
          gerarHtml: window.SistemaOSGerarHtmlComprovante
        });
      });
      elemento.appendChild(btnComprovante);
      if (window.SistemaOSAssinatura && window.CloudData && window.CloudData.assinarOSConsultada) {
        var btnAssinarOS = document.createElement('button');
        btnAssinarOS.type = 'button';
        btnAssinarOS.className = 'btn-primario btn-assinar-os-consulta';
        btnAssinarOS.textContent = dados.assinaturaDisponivel ? 'Substituir assinatura da OS' : 'Assinar OS';
        btnAssinarOS.addEventListener('click', function () {
          window.SistemaOSAssinatura.abrir(async function (assinaturaBase64) {
            var textoOriginal = btnAssinarOS.textContent;
            btnAssinarOS.disabled = true;
            btnAssinarOS.textContent = 'Enviando assinatura…';
            try {
              await window.CloudData.assinarOSConsultada(dados, assinaturaBase64);
              dados.assinaturaClienteBase64 = assinaturaBase64;
              dados.assinaturaDisponivel = true;
              dados.assinaturaPendente = false;
              dados.naoAssinado = false;
              ultimaConsultaOSPorNumero[String(numeroRealOS)] = dados;
              btnAssinarOS.textContent = 'Substituir assinatura da OS';
              if (window.SistemaOSToast) window.SistemaOSToast.mostrar(
                rotuloOS(numeroRealOS) + ' assinada e enviada ao PC sem duplicar o registro.', 'sucesso'
              );
            } catch (erro) {
              btnAssinarOS.textContent = textoOriginal;
              if (window.SistemaOSToast) window.SistemaOSToast.mostrar(
                erro && erro.message ? erro.message : 'Não foi possível enviar a assinatura.', 'erro'
              );
            } finally {
              btnAssinarOS.disabled = false;
            }
          });
        });
        elemento.appendChild(btnAssinarOS);
      }
      if (ehComprovanteTermicoRetirada && window.SistemaOSEntrega &&
          typeof window.SistemaOSEntrega.iniciarPorOS === 'function') {
        var btnPrepararEntrega = document.createElement('button');
        btnPrepararEntrega.type = 'button';
        btnPrepararEntrega.className = 'btn-secundario';
        btnPrepararEntrega.textContent = 'Preencher / assinar entrega';
        btnPrepararEntrega.addEventListener('click', function () {
          window.SistemaOSEntrega.iniciarPorOS(dados);
        });
        elemento.appendChild(btnPrepararEntrega);
      }
      if (window.CloudData && window.CloudData.anexarComprovanteTermicoAssinado) {
        elemento.appendChild(criarBlocoAnexoComprovante(dados));
      }
      elemento.appendChild(criarBlocoCobrancaOS(dados, numeroRealOS));
      elemento.appendChild(criarBlocoAcoesOS(numeroRealOS));
    }
    if (tipo === 'entrega' && numeroConsultado && window.SistemaOSEntrega &&
        typeof window.SistemaOSEntrega.iniciarPorOS === 'function') {
      var acoesEntrega = document.createElement('div');
      acoesEntrega.className = 'acoes-documento-consulta';
      var btnAssinarEntrega = document.createElement('button');
      btnAssinarEntrega.type = 'button';
      btnAssinarEntrega.className = 'btn-primario';
      btnAssinarEntrega.textContent = 'Editar entrega / assinatura';
      btnAssinarEntrega.addEventListener('click', function () {
        window.SistemaOSEntrega.editar(dados.numeroOS || numeroConsultado).catch(function(erro) { window.SistemaOSToast.mostrar(erro.message, 'erro'); });
      });
      acoesEntrega.appendChild(btnAssinarEntrega);
      elemento.appendChild(acoesEntrega);
    }
    if (tipo === 'garantia' && numeroConsultado && window.SistemaOSGarantiaUI) {
      var acoesGarantia = document.createElement('div');
      acoesGarantia.className = 'acoes-documento-consulta';
      ['Editar garantia', 'Ver / imprimir garantia'].forEach(function(rotulo, indice) {
        var botao = document.createElement('button');
        botao.type = 'button'; botao.className = indice ? 'btn-secundario' : 'btn-primario'; botao.textContent = rotulo;
        botao.addEventListener('click', function() { window.SistemaOSGarantiaUI.abrir(dados.numeroOS || numeroConsultado, !!indice); });
        acoesGarantia.appendChild(botao);
      });
      elemento.appendChild(acoesGarantia);
    }
    elemento.hidden = false;
  }

  // ── Bloco de ações (Editar/Excluir) da OS consultada ────────────
  // Usa as operações remotas do adaptador único, com fila e confirmação.
  function criarBlocoAcoesOS(numero) {
    var acoes = document.createElement('div');
    acoes.className = 'resultado-consulta-acoes';

    var btnEditar = document.createElement('button');
    btnEditar.type = 'button';
    btnEditar.className = 'btn-editar-consulta';
    btnEditar.textContent = 'Editar';

    var btnExcluir = document.createElement('button');
    btnExcluir.type = 'button';
    btnExcluir.className = 'btn-excluir-consulta';
    btnExcluir.textContent = 'Excluir';

    btnEditar.addEventListener('click', function () {
      abrirFormularioEdicaoOS(numero, acoes);
    });

    btnExcluir.addEventListener('click', function () {
      excluirOSConsultada(numero, btnEditar, btnExcluir);
    });

    acoes.appendChild(btnEditar);
    acoes.appendChild(btnExcluir);
    return acoes;
  }

  async function excluirOSConsultada(numero, btnEditar, btnExcluir) {
    if (!window.confirm('Excluir a ' + rotuloOS(numero) + '? Esta ação não pode ser desfeita.')) return;
    try {
      if (window.SistemaOSExclusao && !await window.SistemaOSExclusao.autorizar('excluir a ' + rotuloOS(numero))) return;
    } catch (erroAutorizacao) {
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar(
        erroAutorizacao.message || String(erroAutorizacao), 'erro'
      );
      return;
    }
    if (!window.CloudData || !window.CloudData.excluirOS) {
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar('Sincronização não configurada — não foi possível excluir.', 'erro');
      return;
    }

    // Repassa origemIdExportacao quando disponível (OS que veio deste
    // celular). Com isso o PC localiza o registro pelo caminho robusto
    // (origemIdExportacao) em vez do fallback frágil por número —
    // protege contra OSs com números parecidos/iguais e torna a
    // exclusão determinística. Quando a OS foi criada direto no PC
    // (sem origemIdExportacao), cai no fallback 'numero:<numero>',
    // que o PC também sabe tratar.
    var dadosConsulta = ultimaConsultaOSPorNumero[String(numero)] || {};
    var idExportacao = dadosConsulta.origemIdExportacao || null;
    console.log('[Consulta] Excluir OS nº', numero, '| tipo: os | idExportacao:', idExportacao);
    var textoOriginal = btnExcluir.textContent;
    btnEditar.disabled = true;
    btnExcluir.disabled = true;
    btnExcluir.textContent = 'Excluindo…';

    var promessaExclusao = window.CloudData.excluirOS(dadosConsulta, dadosConsulta.revision);
    promessaExclusao.then(function (resultado) {
      console.log('[Consulta] Resultado da exclusão OS', numero, ':', JSON.stringify(resultado));
      if (resultado && resultado.enfileirado === true) {
        if (window.SistemaOSToast) window.SistemaOSToast.mostrar(
          'Sem internet. A exclusão da ' + rotuloOS(numero) + ' ficou na fila e será confirmada ao reconectar.', 'aviso'
        );
        btnEditar.disabled = false;
        btnExcluir.disabled = false;
        btnExcluir.textContent = textoOriginal;
        return;
      }
      if (!resultado || resultado.enviado !== true) {
        var motivo = (resultado && resultado.motivo) || 'desconhecido';
        var mensagem = motivo === 'conflito'
          ? 'A OS foi alterada em outro dispositivo. A versão atual será recarregada.'
          : motivo === 'timeout'
          ? 'O PC não respondeu a tempo. Confirme se o sistema do PC está aberto e conectado, e tente de novo.'
          : motivo === 'nao-encontrada'
            ? 'O PC não encontrou a ' + rotuloOS(numero) + ' (pode já ter sido excluída).'
            : 'Não foi possível excluir a ' + rotuloOS(numero) + ' (' + motivo + ').';
        console.warn('[Consulta] Exclusão OS', numero, 'FALHOU. motivo:', motivo);
        if (window.SistemaOSToast) window.SistemaOSToast.mostrar(mensagem, 'erro');
        btnEditar.disabled = false;
        btnExcluir.disabled = false;
        btnExcluir.textContent = textoOriginal;
        if (motivo === 'conflito') {
          if (campoConsultaOS) campoConsultaOS.value = numero;
          executarConsulta('os', campoConsultaOS, resultadoOS, btnConsultarOS);
        }
        return;
      }
      delete ultimaConsultaOSPorNumero[String(numero)];
      console.log('[Consulta] OS', numero, 'excluída com sucesso.');
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar(rotuloOS(numero) + ' excluída.', 'sucesso');
      // Limpa o card de resultado — o registro não existe mais no PC.
      resultadoOS.hidden = true;
      resultadoOS.innerHTML = '';
    }).catch(function (erro) {
      console.error('[Consulta] Erro ao excluir OS', numero, ':', erro);
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar('Erro ao excluir a ' + rotuloOS(numero) + '.', 'erro');
      btnEditar.disabled = false;
      btnExcluir.disabled = false;
      btnExcluir.textContent = textoOriginal;
    });
  }

  // Abre (ou fecha, se já aberto) o formulário inline de edição logo
  // abaixo dos botões Editar/Excluir, pré-preenchido com os dados da
  // última consulta feita para este número. Só os campos que o PC de
  // fato aceita editar remotamente: status, defeito relatado, observações,
  // prioridade — nunca cliente, valores ou termos.
  function abrirFormularioEdicaoOS(numero, elementoAcoes) {
    var formExistente = elementoAcoes.parentNode.querySelector('.form-edicao-consulta');
    if (formExistente) { formExistente.remove(); return; } // clique de novo fecha

    var dados = ultimaConsultaOSPorNumero[String(numero)] || {};
    var aparelho = dados.aparelho || {};

    var form = document.createElement('div');
    form.className = 'form-edicao-consulta';

    var htmlOpcoesStatus = STATUS_OS_VALIDOS.map(function (s) {
      var selecionado = s === dados.status ? ' selected' : '';
      return '<option value="' + escaparHtml(s) + '"' + selecionado + '>' + escaparHtml(s) + '</option>';
    }).join('');
    var statusAprovacaoAtual = dados.statusAprovacao || 'Pendente';
    var htmlOpcoesAprovacao = ['Pendente', 'Aprovado', 'Desaprovado'].map(function (s) {
      return '<option value="' + s + '"' + (s === statusAprovacaoAtual ? ' selected' : '') + '>' + s + '</option>';
    }).join('');

    var htmlOpcoesPrioridade = PRIORIDADES_OS_VALIDAS.map(function (p) {
      var selecionado = p === (dados.prioridade || 'Normal') ? ' selected' : '';
      return '<option value="' + escaparHtml(p) + '"' + selecionado + '>' + escaparHtml(p) + '</option>';
    }).join('');

    form.innerHTML =
      '<div>' +
      '<label for="edicao-consulta-status-' + escaparHtml(numero) + '">Status</label>' +
      '<select id="edicao-consulta-status-' + escaparHtml(numero) + '" class="campo-edicao-status">' + htmlOpcoesStatus + '</select>' +
      '</div>' +
      '<div>' +
      '<label for="edicao-consulta-aprovacao-' + escaparHtml(numero) + '">Aprovação da OS</label>' +
      '<select id="edicao-consulta-aprovacao-' + escaparHtml(numero) + '" class="campo-edicao-aprovacao">' + htmlOpcoesAprovacao + '</select>' +
      '</div>' +
      '<div>' +
      '<label for="edicao-consulta-prioridade-' + escaparHtml(numero) + '">Prioridade</label>' +
      '<select id="edicao-consulta-prioridade-' + escaparHtml(numero) + '" class="campo-edicao-prioridade">' + htmlOpcoesPrioridade + '</select>' +
      '</div>' +
      '<div>' +
      '<label for="edicao-consulta-defeito-' + escaparHtml(numero) + '">Defeito relatado</label>' +
      '<textarea id="edicao-consulta-defeito-' + escaparHtml(numero) + '" class="campo-edicao-defeito">' + escaparHtml(aparelho.defeitoRelatado || '') + '</textarea>' +
      '</div>' +
      '<div>' +
      '<label for="edicao-consulta-obs-' + escaparHtml(numero) + '">Observações</label>' +
      '<textarea id="edicao-consulta-obs-' + escaparHtml(numero) + '" class="campo-edicao-obs">' + escaparHtml(dados.observacoes || '') + '</textarea>' +
      '</div>' +
      '<div class="form-edicao-consulta-acoes">' +
      '<button type="button" class="btn-cancelar-edicao-consulta">Cancelar</button>' +
      '<button type="button" class="btn-primario btn-salvar-edicao-consulta">Salvar</button>' +
      '</div>';

    elementoAcoes.insertAdjacentElement('afterend', form);

    form.querySelector('.btn-cancelar-edicao-consulta').addEventListener('click', function () {
      form.remove();
    });

    form.querySelector('.btn-salvar-edicao-consulta').addEventListener('click', function () {
      salvarEdicaoOS(numero, form);
    });
  }

  function perguntarComprovanteEntrega(dadosOS, statusAnterior, novoStatus) {
    if (statusAnterior === 'Entregue' || novoStatus !== 'Entregue') return;
    var emitir = window.confirm(
      'A ' + rotuloOS(dadosOS.numero) + ' foi marcada como entregue.\n\n' +
      'Deseja preencher, assinar e emitir agora o comprovante de entrega?'
    );
    if (emitir && window.SistemaOSEntrega && typeof window.SistemaOSEntrega.iniciarPorOS === 'function') {
      window.SistemaOSEntrega.iniciarPorOS(dadosOS);
    } else if (!emitir && window.SistemaOSToast) {
      window.SistemaOSToast.mostrar(
        'Você pode emitir depois pelo botão “Comprovante de entrega” da OS.',
        'aviso'
      );
    }
  }

  function salvarEdicaoOS(numero, form) {
    if (!window.CloudData || !window.CloudData.atualizarOS) {
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar('Sincronização não configurada — não foi possível editar.', 'erro');
      return;
    }

    var dadosAnteriores = ultimaConsultaOSPorNumero[String(numero)] || {};
    var aparelhoAnterior = dadosAnteriores.aparelho || {};

    var novoStatus = form.querySelector('.campo-edicao-status').value;
    var novaAprovacao = form.querySelector('.campo-edicao-aprovacao').value;
    var novaPrioridade = form.querySelector('.campo-edicao-prioridade').value;
    var novoDefeito = form.querySelector('.campo-edicao-defeito').value.trim();
    var novaObs = form.querySelector('.campo-edicao-obs').value.trim();

    // Só envia o que de fato mudou — evita gravar edições vazias e deixa
    // o histórico de status do PC (ver atualizarOS) só registrar uma
    // troca real quando o status realmente mudou.
    var campos = {};
    if (novoStatus !== dadosAnteriores.status) campos.status = novoStatus;
    if (novaAprovacao !== (dadosAnteriores.statusAprovacao || 'Pendente')) {
      campos.dados_extras = Object.assign({}, dadosAnteriores.dadosExtras || {}, {
        status_aprovacao: novaAprovacao,
        status_pagamento_local: dadosAnteriores.statusPagamento || ''
      });
    }
    if (novaPrioridade !== (dadosAnteriores.prioridade || 'Normal')) campos.prioridade = novaPrioridade;
    if (novoDefeito !== (aparelhoAnterior.defeitoRelatado || '')) campos['aparelho.defeitoRelatado'] = novoDefeito;
    if (novaObs !== (dadosAnteriores.observacoes || '')) campos.observacoes = novaObs;

    if (!Object.keys(campos).length) {
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar('Nenhuma alteração para salvar.', 'aviso');
      form.remove();
      return;
    }

    var botaoSalvar = form.querySelector('.btn-salvar-edicao-consulta');
    var botaoCancelar = form.querySelector('.btn-cancelar-edicao-consulta');
    var textoOriginal = botaoSalvar.textContent;
    botaoSalvar.disabled = true;
    botaoCancelar.disabled = true;
    botaoSalvar.textContent = 'Salvando…';

    var promessaEdicao = window.CloudData.atualizarOS(dadosAnteriores, dadosAnteriores.revision, campos);
    promessaEdicao.then(function (resultado) {
      if (resultado && resultado.enfileirado === true) {
        if (window.SistemaOSToast) window.SistemaOSToast.mostrar(
          'Sem internet. A edição da ' + rotuloOS(numero) + ' ficou na fila e será confirmada ao reconectar.', 'aviso'
        );
        form.remove();
        perguntarComprovanteEntrega(dadosAnteriores, dadosAnteriores.status, novoStatus);
        return;
      }
      if (!resultado || resultado.enviado !== true) {
        var motivo = (resultado && resultado.motivo) || 'desconhecido';
        var mensagem = motivo === 'conflito'
          ? 'A OS foi alterada em outro dispositivo. A versão atual será recarregada.'
          : motivo === 'timeout'
          ? 'O PC não respondeu a tempo. Confirme se o sistema do PC está aberto e conectado, e tente de novo.'
          : motivo === 'nao-encontrada'
            ? 'O PC não encontrou a ' + rotuloOS(numero) + ' (pode ter sido excluída).'
            : 'Não foi possível salvar a edição da ' + rotuloOS(numero) + ' (' + motivo + ').';
        if (window.SistemaOSToast) window.SistemaOSToast.mostrar(mensagem, 'erro');
        botaoSalvar.disabled = false;
        botaoCancelar.disabled = false;
        botaoSalvar.textContent = textoOriginal;
        if (motivo === 'conflito') {
          form.remove();
          if (campoConsultaOS) campoConsultaOS.value = numero;
          executarConsulta('os', campoConsultaOS, resultadoOS, btnConsultarOS);
        }
        return;
      }
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar(rotuloOS(numero) + ' atualizada.', 'sucesso');
      form.remove();
      perguntarComprovanteEntrega(dadosAnteriores, dadosAnteriores.status, novoStatus);
      // Re-busca a OS para o card de resultado (e o PDF) refletirem o
      // que foi salvo de verdade no PC — nunca assume localmente que o
      // que foi enviado é exatamente o que ficou gravado.
      if (campoConsultaOS) campoConsultaOS.value = numero;
      executarConsulta('os', campoConsultaOS, resultadoOS, btnConsultarOS);
    }).catch(function () {
      if (window.SistemaOSToast) window.SistemaOSToast.mostrar('Erro ao salvar a edição da ' + rotuloOS(numero) + '.', 'erro');
      botaoSalvar.disabled = false;
      botaoCancelar.disabled = false;
      botaoSalvar.textContent = textoOriginal;
    });
  }

  function consultarNuvem(tipo, numero) {
    if (!window.CloudData || typeof window.CloudData.consultar !== 'function') {
      return Promise.resolve({ encontrada: false, motivo: 'sem-sessao', origem: 'supabase' });
    }
    return window.CloudData.consultar(tipo, numero);
  }

  function executarConsulta(tipo, campoInput, elementoResultado, botao) {
    var numero = campoInput ? campoInput.value.trim() : '';
    if (!numero) {
      elementoResultado.hidden = false;
      elementoResultado.innerHTML = '<p class="historico-erro">Digite o número da OS antes de buscar.</p>';
      return;
    }
    if (!window.CloudData || typeof window.CloudData.consultar !== 'function') {
      elementoResultado.hidden = false;
      elementoResultado.innerHTML = '<p class="historico-erro">Não foi possível consultar agora. Entre novamente e tente de novo.</p>';
      return;
    }

    botao.disabled = true;
    elementoResultado.hidden = false;
    elementoResultado.innerHTML = '<p class="historico-carregando">Buscando…</p>';

    consultarNuvem(tipo, numero, 30000)
      .then(function (resultado) {
        if (!resultado.encontrada) {
          var mensagem = resultado.motivo === 'sem-config'
            ? 'Consulta indisponível. Entre novamente na sua conta e tente de novo.'
            : resultado.motivo === 'timeout'
              ? 'A consulta demorou mais que o esperado. Tente novamente.'
              : resultado.motivo === 'nao-encontrada'
                ? 'Nenhum registro encontrado com o número ' + numero + '.'
                : resultado.motivo === 'erro-supabase'
                  ? 'Não foi possível atualizar. Verifique sua internet e tente de novo.'
              : 'Não foi possível concluir a busca. Verifique a internet e tente de novo.';
          elementoResultado.innerHTML = '<p class="historico-erro">' + escaparHtml(mensagem) + '</p>';
          return;
        }
        renderizarResultadoConsulta(elementoResultado, resultado.dados || {}, tipo, numero, resultado.origem);
      })
      .catch(function () {
        elementoResultado.innerHTML = '<p class="historico-erro">Não foi possível concluir a busca. Verifique a internet e tente de novo.</p>';
      })
      .then(function () {
        botao.disabled = false;
      });
  }

  function executarConsultaUnificada() {
    var numero = campoConsultaOS ? campoConsultaOS.value.trim() : '';
    var destinos = [
      { tipo: 'os', elemento: resultadoOS, vazio: 'OS não encontrada.' },
      { tipo: 'garantia', elemento: resultadoGarantia, vazio: 'Nenhuma garantia vinculada a esta OS.' },
      { tipo: 'entrega', elemento: resultadoEntrega, vazio: 'Nenhuma entrega vinculada a esta OS.' }
    ];
    if (!numero) {
      resultadoOS.hidden = false;
      resultadoOS.innerHTML = '<p class="historico-erro">Digite o número da OS antes de buscar.</p>';
      return Promise.resolve();
    }
    if (!window.CloudData || typeof window.CloudData.consultar !== 'function') {
      resultadoOS.hidden = false;
      resultadoOS.innerHTML = '<p class="historico-erro">Não foi possível consultar agora. Entre novamente e tente de novo.</p>';
      return Promise.resolve();
    }
    btnConsultarOS.disabled = true;
    destinos.forEach(function (destino) {
      destino.elemento.hidden = false;
      destino.elemento.innerHTML = '<p class="historico-carregando">Buscando…</p>';
    });
    return Promise.all(destinos.map(function (destino) {
      return consultarNuvem(destino.tipo, numero).catch(function (erro) {
        return { encontrada: false, motivo: 'erro-supabase', erro: erro, origem: 'supabase' };
      });
    })).then(function (respostas) {
      respostas.forEach(function (resposta, indice) {
        var destino = destinos[indice];
        if (resposta && resposta.encontrada) {
          renderizarResultadoConsulta(destino.elemento, resposta.dados || {}, destino.tipo, numero, resposta.origem);
          return;
        }
        var textoErro = resposta && resposta.motivo === 'erro-supabase'
          ? 'Não foi possível consultar este documento agora.' : destino.vazio;
        if (indice === 0 && consultaAbertaPorQR && (!resposta || resposta.motivo !== 'erro-supabase')) {
          textoErro = 'OS não encontrada. Confira a etiqueta ou tente novamente em instantes.';
        }
        destino.elemento.innerHTML = '<p class="historico-vazio">' + escaparHtml(textoErro) + '</p>';
      });
    }).finally(function () {
      btnConsultarOS.disabled = false;
    });
  }

  function rotuloDocumento(tipo, item) {
    if (tipo === 'OS') return item.numero || 'OS';
    if (tipo === 'Desbloqueio') return item.numero || 'Autorização';
    return tipo + ((item.numero || item.numero_os_snapshot) ? ' · ' + (item.numero || item.numero_os_snapshot) : '');
  }

  function detalheDocumento(tipo, item) {
    if (tipo === 'OS') return [item.marca, item.modelo, item.status].filter(Boolean).join(' · ');
    if (tipo === 'Desbloqueio') return [item.marca, item.modelo, item.assinatura_estado === 'assinado' ? 'Assinado' : item.assinatura_estado === 'aguardando' ? 'Aguardando assinatura' : 'Não assinado'].filter(Boolean).join(' · ');
    return [item.status, item.created_at ? new Date(item.created_at).toLocaleDateString('pt-BR') : ''].filter(Boolean).join(' · ');
  }

  function adicionarGrupoCliente(container, titulo, itens, tipo) {
    (itens || []).forEach(function (item) {
      if (window.SistemaOSConsultasBusca) {
        adicionarDocumentoBusca(container, tipo.toLowerCase(), window.SistemaOSConsultasBusca.normalizar(tipo.toLowerCase(), item));
        return;
      }
      var linha = document.createElement('div');
      linha.className = 'consulta-cliente-documento';
      linha.innerHTML = '<div><strong>' + escaparHtml(rotuloDocumento(tipo, item)) + '</strong><br><span>' + escaparHtml(detalheDocumento(tipo, item)) + '</span></div>';
      if (tipo === 'OS' || tipo === 'Desbloqueio') {
        var botao = document.createElement('button');
        botao.type = 'button'; botao.className = 'btn-secundario'; botao.textContent = 'Abrir';
        botao.addEventListener('click', function () {
          if (tipo === 'OS') abrirOSPorNumero(item.numero);
          else {
            document.getElementById('btn-ir-desbloqueios')?.click();
            window.SistemaOSDesbloqueiosMobile?.abrir(item.id);
          }
        });
        linha.appendChild(botao);
      }
      container.appendChild(linha);
    });
  }

  var versaoConsultaCliente = 0;
  var tipoConsultaAtivo = 'os';
  var NOMES_CONSULTA = { os: 'OS', entrega: 'Entregas', garantia: 'Garantias', desbloqueio: 'Desbloqueios', compra: 'Compras', venda: 'Vendas', cliente: 'Clientes' };
  function selecionarTipoConsulta(tipo, buscar) {
    if (!Object.hasOwn(NOMES_CONSULTA, tipo)) return;
    versaoConsultaCliente++;
    tipoConsultaAtivo = tipo;
    painel.querySelectorAll('[data-consulta-tipo]').forEach(function (tab) {
      var ativo = tab.dataset.consultaTipo === tipo;
      tab.setAttribute('aria-selected', String(ativo)); tab.tabIndex = ativo ? 0 : -1;
    });
    resultadoCliente.setAttribute('aria-labelledby', 'consulta-aba-' + tipo);
    document.getElementById('consulta-busca-rotulo').textContent = tipo === 'cliente'
      ? 'Buscar cliente por nome, ID, CPF ou telefone'
      : 'Buscar ' + NOMES_CONSULTA[tipo] + ' por nome, número ou dados do documento';
    campoConsultaCliente.placeholder = tipo === 'cliente' ? 'Nome, ID, CPF ou telefone' : 'Nome do cliente ou número do documento';
    [resultadoOS, resultadoGarantia, resultadoEntrega].forEach(function (el) { if (el) { el.hidden = true; el.innerHTML = ''; } });
    resultadoCliente.innerHTML = '<p class="aviso">Informe o nome ou número para consultar.</p>';
    btnConsultarCliente.disabled = false;
    if (buscar && campoConsultaCliente.value.trim()) return executarBuscaDocumentos();
  }

  function adicionarDocumentoBusca(container, tipo, dados) {
    var card = document.createElement('article'); card.className = 'consulta-busca-documento';
    var numero = dados.numero || dados.numeroOS || '';
    var nome = dados.clienteNome || dados.cliente?.nome || '';
    var aparelho = [dados.aparelhoMarca || dados.aparelho?.marca, dados.aparelhoModelo || dados.aparelho?.modelo].filter(Boolean).join(' ');
    var valor = dados.valor != null ? Number(dados.valor).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }) : '';
    card.innerHTML = '<h3>' + escaparHtml((NOMES_CONSULTA[tipo] || tipo) + ' · ' + numero) + '</h3><p>' + escaparHtml(nome) + '</p><p>' + escaparHtml([aparelho, dados.status, valor].filter(Boolean).join(' · ')) + '</p>';
    var acoes = document.createElement('div'); acoes.className = 'consulta-busca-acoes';
    var detalhe = document.createElement('div'); detalhe.className = 'consulta-busca-detalhe'; detalhe.hidden = true;
    var abrir = document.createElement('button'); abrir.type = 'button'; abrir.className = 'btn-primario'; abrir.textContent = 'Ver detalhes'; abrir.setAttribute('aria-expanded', 'false');
    abrir.addEventListener('click', function () {
      if (tipo === 'desbloqueio') { window.SistemaOSDesbloqueiosMobile?.visualizar(dados.id); return; }
      if (!detalhe.hidden) { detalhe.hidden = true; abrir.textContent = 'Ver detalhes'; abrir.setAttribute('aria-expanded', 'false'); return; }
      renderizarResultadoConsulta(detalhe, dados, tipo, numero, 'supabase');
      abrir.textContent = 'Recolher detalhes'; abrir.setAttribute('aria-expanded', 'true');
    });
    acoes.appendChild(abrir); acoes.appendChild(criarBotaoCompartilhar(dados, tipo));
    card.appendChild(acoes); card.appendChild(detalhe); container.appendChild(card);
  }

  async function buscarDocumentosSemVinculo(termo, versao) {
    var respostas = await Promise.allSettled(window.SistemaOSConsultasBusca.tipos.map(function (tipo) { return window.SistemaOSConsultasBusca.buscar(tipo, termo); }));
    if (versao !== versaoConsultaCliente) return;
    var total = 0;
    respostas.forEach(function (r) {
      if (r.status !== 'fulfilled') return;
      r.value.itens.forEach(function (item) { adicionarDocumentoBusca(resultadoCliente, item.tipo, item.dados); total++; });
    });
    var aviso = document.createElement('p'); aviso.className = 'aviso';
    aviso.textContent = total ? 'Documentos encontrados pelo nome salvo no atendimento.'
      : respostas.some(function (r) { return r.status === 'rejected'; }) ? 'Não foi possível consultar todos os documentos. Verifique a conexão e tente novamente.'
      : 'Nenhum registro encontrado. Confira o nome ou tente o número do documento.';
    resultadoCliente.prepend(aviso);
  }

  async function executarBuscaDocumentos() {
    if (tipoConsultaAtivo === 'cliente') return executarConsultaCliente();
    var versao = ++versaoConsultaCliente;
    var tipo = tipoConsultaAtivo, termo = campoConsultaCliente.value.trim();
    [resultadoOS, resultadoGarantia, resultadoEntrega].forEach(function (el) { if (el) el.hidden = true; });
    if (!termo) { resultadoCliente.innerHTML = '<p class="aviso">Digite um nome ou número antes de buscar.</p>'; return; }
    btnConsultarCliente.disabled = true;
    resultadoCliente.innerHTML = '<p class="aviso">Buscando…</p>';
    try {
      var resposta = await window.SistemaOSConsultasBusca.buscar(tipo, termo);
      if (versao !== versaoConsultaCliente) return;
      resultadoCliente.innerHTML = '';
      var aviso = document.createElement('p'); aviso.className = 'aviso';
      aviso.textContent = resposta.itens.length ? resposta.itens.length + ' registro(s)' + (resposta.mais ? ' · Refine a busca para ver os demais.' : '.') : 'Nenhum registro encontrado nesta subaba. Confira o nome ou número.';
      resultadoCliente.appendChild(aviso);
      resposta.itens.forEach(function (item) { adicionarDocumentoBusca(resultadoCliente, item.tipo, item.dados); });
    } catch (_) {
      if (versao === versaoConsultaCliente) resultadoCliente.innerHTML = '<p class="aviso aviso-erro">Não foi possível consultar. Verifique a conexão e tente novamente.</p>';
    } finally { if (versao === versaoConsultaCliente) btnConsultarCliente.disabled = false; }
  }

  painel.querySelectorAll('[data-consulta-tipo]').forEach(function (tab) {
    tab.addEventListener('click', function () { selecionarTipoConsulta(tab.dataset.consultaTipo, true); });
    tab.addEventListener('keydown', function (e) {
      var tabs = Array.from(painel.querySelectorAll('[data-consulta-tipo]')), index = tabs.indexOf(tab);
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
      e.preventDefault();
      var next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus(); tabs[next].click();
    });
  });
  document.addEventListener('sistema-os:sessao-alterada', function () {
    versaoConsultaCliente++;
    if (resultadoCliente) resultadoCliente.innerHTML = '';
    if (campoConsultaCliente) campoConsultaCliente.value = '';
    if (btnConsultarCliente) btnConsultarCliente.disabled = false;
    ultimaConsultaOSPorNumero = {};
    [resultadoOS, resultadoGarantia, resultadoEntrega].forEach(function (el) { if (el) { el.innerHTML = ''; el.hidden = true; } });
  });

  async function executarConsultaCliente() {
    var versao = ++versaoConsultaCliente;
    var termo = String(campoConsultaCliente?.value || '').trim();
    if (termo.length < 2) {
      resultadoCliente.innerHTML = '<p class="aviso">Digite ao menos 2 caracteres do nome ou o ID do cliente.</p>';
      return;
    }
    btnConsultarCliente.disabled = true;
    resultadoCliente.innerHTML = '<p class="aviso">Buscando cliente e documentos…</p>';
    try {
      var client = window.SupabaseClientApp.obterCliente();
      var resposta = await client.rpc('buscar_cliente_documentos', { p_termo: termo });
      if (versao !== versaoConsultaCliente) return;
      if (resposta.error) throw resposta.error;
      var clientes = resposta.data || [];
      resultadoCliente.innerHTML = '';
      if (!clientes.length) {
        await buscarDocumentosSemVinculo(termo, versao);
        return;
      }
      clientes.forEach(function (cliente) {
        var card = document.createElement('article');
        card.className = 'consulta-cliente-card';
        var contatos = [cliente.telefone, cliente.email].filter(Boolean).join(' · ');
        card.innerHTML = '<h3>' + escaparHtml(cliente.nome || 'Cliente') + '</h3><div class="consulta-cliente-meta">ID ' + escaparHtml(cliente.clienteId || '00000') + (contatos ? ' · ' + escaparHtml(contatos) : '') + '</div><div class="consulta-cliente-documentos"></div>';
        var docs = card.querySelector('.consulta-cliente-documentos');
        adicionarGrupoCliente(docs, 'OS', cliente.ordens, 'OS');
        adicionarGrupoCliente(docs, 'Garantia', cliente.garantias, 'Garantia');
        adicionarGrupoCliente(docs, 'Entrega', cliente.entregas, 'Entrega');
        adicionarGrupoCliente(docs, 'Venda', cliente.vendas, 'Venda');
        adicionarGrupoCliente(docs, 'Compra', cliente.compras, 'Compra');
        adicionarGrupoCliente(docs, 'Desbloqueio', cliente.desbloqueios, 'Desbloqueio');
        if (!docs.children.length) docs.innerHTML = '<span class="consulta-cliente-meta">Cliente cadastrado, ainda sem documentos.</span>';
        resultadoCliente.appendChild(card);
      });
    } catch (erro) {
      if (versao === versaoConsultaCliente) {
        resultadoCliente.innerHTML = '';
        await buscarDocumentosSemVinculo(termo, versao);
      }
    } finally { if (versao === versaoConsultaCliente) btnConsultarCliente.disabled = false; }
  }

  if (btnConsultarCliente) btnConsultarCliente.addEventListener('click', executarBuscaDocumentos);
  if (campoConsultaCliente) campoConsultaCliente.addEventListener('keydown', function (evento) {
    if (evento.key === 'Enter') { evento.preventDefault(); executarBuscaDocumentos(); }
  });

  if (btnConsultarOS) {
    btnConsultarOS.addEventListener('click', function () {
      executarConsultaUnificada();
    });
  }
  if (campoConsultaOS) {
    campoConsultaOS.addEventListener('keydown', function (evento) {
      if (evento.key !== 'Enter') return;
      evento.preventDefault();
      executarConsultaUnificada();
    });
  }
  if (btnConsultarGarantia) {
    btnConsultarGarantia.addEventListener('click', function () {
      executarConsulta('garantia', campoConsultaGarantia, resultadoGarantia, btnConsultarGarantia);
    });
  }
  if (btnConsultarEntrega) {
    btnConsultarEntrega.addEventListener('click', function () {
      executarConsulta('entrega', campoConsultaEntrega, resultadoEntrega, btnConsultarEntrega);
    });
  }

  // ── Estado da sessão de consulta ─────────────────────────────────
  function atualizarAvisoConfig() {
    if (!avisoStatusSync) return;
    if (window.CloudData && typeof window.CloudData.providerConsultas === 'function' &&
        window.CloudData.providerConsultas() === 'supabase') {
      avisoStatusSync.hidden = false;
      avisoStatusSync.textContent = 'Informações atualizadas automaticamente.';
      return;
    }
    avisoStatusSync.hidden = false;
    avisoStatusSync.textContent = 'Entre novamente para consultar os dados da sua empresa.';
  }

  // ── Ciclo de vida da aba ─────────────────────────────────────────
  document.addEventListener('sistema-os:tela-consulta-aberta', function () {
    atualizarAvisoConfig();
  });
  document.addEventListener('sistema-os:conflito-sincronizacao', function (evento) {
    var operacao = evento.detail && evento.detail.operacao ? evento.detail.operacao : {};
    if (window.SistemaOSToast) window.SistemaOSToast.mostrar(
      'Conflito de edição: existe uma versão mais nova desta OS. Revise os dados atuais.', 'erro'
    );
    if (operacao.numero && campoConsultaOS && resultadoOS && btnConsultarOS) {
      campoConsultaOS.value = operacao.numero;
      executarConsulta('os', campoConsultaOS, resultadoOS, btnConsultarOS);
    }
  });

  // Entrada única para QR Code, deep link e outros atalhos. A consulta usa
  // o Supabase da empresa autenticada, portanto o PC pode estar desligado;
  // se a última alteração ainda não tiver sido sincronizada, o card explica
  // que é necessário abrir/sincronizar o computador e permite tentar de novo.
  async function abrirOSPorNumero(numero, opcoes) {
    var valor = String(numero == null ? '' : numero).trim();
    if (!valor) throw new Error('A etiqueta não contém um número de OS válido.');
    if (btnIrConsulta && typeof btnIrConsulta.click === 'function') btnIrConsulta.click();
    campoConsultaOS.value = valor;
    selecionarTipoConsulta('os', false);
    campoConsultaCliente.value = valor;
    consultaAbertaPorQR = !!(opcoes && opcoes.origem === 'qr');
    try {
      await executarBuscaDocumentos();
    } finally {
      consultaAbertaPorQR = false;
    }
    if (resultadoCliente && typeof resultadoCliente.scrollIntoView === 'function') {
      resultadoCliente.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return valor;
  }

  window.SistemaOSConsulta = Object.freeze({
    abrirOS: abrirOSPorNumero,
    consultarNovamente: executarConsultaUnificada
  });
  document.dispatchEvent(new CustomEvent('sistema-os:consulta-pronta'));
})();
