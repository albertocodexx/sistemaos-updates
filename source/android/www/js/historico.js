// js/historico.js
//
// Histórico LOCAL do celular (Parte 4) — separado do histórico oficial
// do PC. Usa IndexedDB em vez de localStorage porque cada registro
// carrega a assinatura em base64 (e no futuro pode carregar fotos), o
// que estoura rápido o limite de localStorage (~5MB por origem,
// compartilhado com qualquer outro uso do navegador nesse domínio).
//
// Cada registro guarda o objeto `os` COMPLETO — o mesmo objeto que já
// foi passado pra gerarHtmlOS(os, config) pra gerar a prévia, com a
// assinatura já embutida em os.assinaturaClienteBase64. Assim, reabrir
// um item da lista não exige reconstruir nada: é só chamar
// gerarHtmlOS(os, config) de novo com o MESMO objeto salvo e reinjetar
// a assinatura no iframe — sem precisar assinar de novo.

(function () {
  'use strict';

  var NOME_BANCO_BASE = 'sistemaOSCelular';
  var empresaAtivaId = '';
  // Versão 3 acrescenta rascunhos recuperáveis do formulário de Nova OS.
  // A migração só cria stores ausentes, sem apagar histórico existente.
  // Versao 4 acrescenta a fila duravel de operacoes Supabase. Ela vive no
  // mesmo banco do historico para que o retry existente tenha uma unica
  // fonte local de pendencias.
  var VERSAO_BANCO = 4;
  var NOME_LOJA = 'historico';
  var NOME_LOJA_DOCS = 'documentosPendentes';
  var NOME_LOJA_RASCUNHOS = 'rascunhos';
  var NOME_LOJA_OPERACOES_NUVEM = 'operacoesNuvem';

  var promessaDb = null;

  function normalizarEmpresaId(valor) {
    return String(valor || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 80);
  }

  try {
    empresaAtivaId = normalizarEmpresaId(window.localStorage && window.localStorage.getItem('sistema-os-empresa-ativa-v1'));
  } catch (_) { empresaAtivaId = ''; }

  function obterNomeBancoAtual() {
    try {
      if (empresaAtivaId && window.localStorage &&
          window.localStorage.getItem('sistema-os-dados-legados-empresa-v1') === empresaAtivaId) {
        return NOME_BANCO_BASE;
      }
    } catch (_) {}
    return empresaAtivaId
      ? NOME_BANCO_BASE + '-empresa-' + empresaAtivaId
      : NOME_BANCO_BASE + '-sem-empresa';
  }

  function definirEmpresa(empresaId) {
    var proxima = normalizarEmpresaId(empresaId);
    if (proxima === empresaAtivaId) return obterNomeBancoAtual();
    var bancoAnterior = promessaDb;
    promessaDb = null;
    empresaAtivaId = proxima;
    if (bancoAnterior) {
      bancoAnterior.then(function (db) {
        try { db.close(); } catch (_) {}
      }).catch(function () {});
    }
    return obterNomeBancoAtual();
  }

  function abrirBanco() {
    if (promessaDb) return promessaDb;
    promessaDb = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('Este navegador não suporta armazenamento local (IndexedDB).'));
        return;
      }
      var pedido = indexedDB.open(obterNomeBancoAtual(), VERSAO_BANCO);
      pedido.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(NOME_LOJA)) {
          var loja = db.createObjectStore(NOME_LOJA, { keyPath: 'id' });
          loja.createIndex('salvoEm', 'salvoEm', { unique: false });
        }
        // Nova store (versão 2): documentos que o PC gerou e mandou pro
        // celular assinar remotamente. Independente de 'historico' — não
        // é uma cópia do histórico local, é um recebido de fora, com seu
        // próprio ciclo de vida (pendente → assinado → exportado de volta).
        if (!db.objectStoreNames.contains(NOME_LOJA_DOCS)) {
          var lojaDocs = db.createObjectStore(NOME_LOJA_DOCS, { keyPath: 'id' });
          lojaDocs.createIndex('recebidoEm', 'recebidoEm', { unique: false });
          lojaDocs.createIndex('idEnvioAssinatura', 'idEnvioAssinatura', { unique: false });
        }
        if (!db.objectStoreNames.contains(NOME_LOJA_RASCUNHOS)) {
          db.createObjectStore(NOME_LOJA_RASCUNHOS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(NOME_LOJA_OPERACOES_NUVEM)) {
          var lojaOperacoes = db.createObjectStore(NOME_LOJA_OPERACOES_NUVEM, { keyPath: 'id' });
          lojaOperacoes.createIndex('status', 'status', { unique: false });
          lojaOperacoes.createIndex('criadoEm', 'criadoEm', { unique: false });
        }
      };
      pedido.onsuccess = function (ev) { resolve(ev.target.result); };
      pedido.onerror = function () {
        reject(pedido.error || new Error('Falha ao abrir o histórico local.'));
      };
    });
    return promessaDb;
  }

  function gerarId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function documentoTemArquivos(dados, tipo) {
    if (!dados) return false;
    var assinaturaParte = tipo === 'compra' ? dados.assinaturaVendedorBase64
      : tipo === 'venda' ? dados.assinaturaCompradorBase64
      : tipo === 'entrega' ? dados.assinaturaRetirouBase64
      : dados.assinaturaClienteBase64;
    return !!((Array.isArray(dados.fotos) && dados.fotos.length) ||
      assinaturaParte || dados.assinaturaAssistenciaBase64);
  }

  // Salva uma cópia independente de `dados` (já com assinatura embutida).
  // `tipoDocumento` é 'os' | 'compra' | 'venda' — usado pela tela de
  // histórico pra filtrar e pra saber qual gerarHtmlXxx usar ao reabrir.
  // Parâmetro opcional e colocado por último por retrocompatibilidade:
  // chamadas antigas (`salvar(os)`) continuam funcionando exatamente
  // como antes, tratadas como tipoDocumento 'os'.
  //
  // O campo salvo no registro chama-se `os` por herança do formato
  // original (Parte 4, só-OS) — manter esse nome de campo evita ter que
  // migrar registros já salvos no IndexedDB de usuários existentes.
  function salvar(dados, tipoDocumento) {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tipoFinal = tipoDocumento || 'os';
        var registro = {
          id: gerarId(),
          salvoEm: new Date().toISOString(),
          tipoDocumento: tipoFinal,
          // false até ser incluído com sucesso em uma exportação (individual
          // ou em lote) para o PC. Usado pelo botão "Exportar pendentes" da
          // tela de Histórico para saber o que ainda falta enviar, e pela
          // listagem para mostrar um selo "✓ Sincronizado" / "Pendente".
          sincronizadoComPC: false,
          sincronizadoEm: null,
          arquivosSincronizadosSupabase: !documentoTemArquivos(dados, tipoFinal),
          // Bloco 4 (editar no celular depois de salvo, reenviando pro PC):
          // idExportacao calculado UMA VEZ, no momento do salvamento
          // original, e persistido aqui — não recalculado depois. Motivo:
          // o hash (window.IdExportacao.gerar) inclui campos que o técnico
          // pode editar mais tarde (cliente, aparelho, valores etc.); se o
          // reenvio recalculasse o id a partir dos dados já editados, o
          // idExportacao mudaria e o PC trataria a edição como um documento
          // NOVO em vez de uma atualização do registro já existente. Fixar
          // o valor aqui garante que reenviarItemEditado() (abaixo) sempre
          // usa o MESMO idExportacao usado no envio original, não importa
          // quantas vezes o registro seja editado e reenviado depois.
          // Registros salvos ANTES desta mudança não têm este campo — nesse
          // caso o comportamento antigo (recalcular) continua valendo, ver
          // reenviarItemEditado().
          idExportacaoOriginal: window.IdExportacao ? window.IdExportacao.gerar(tipoFinal, dados) : null,
          os: JSON.parse(JSON.stringify(dados)) // cópia própria, sem referência ao objeto em uso na tela
        };
        var tx = db.transaction(NOME_LOJA, 'readwrite');
        tx.objectStore(NOME_LOJA).add(registro);
        tx.oncomplete = function () { resolve(registro); };
        tx.onerror = function () {
          reject(tx.error || new Error('Falha ao salvar no histórico local.'));
        };
      });
    });
  }


  // ── Entregas: uma versão por ciclo da OS ───────────────────────
  // A entrega original e cada retorno em garantia são documentos legais
  // independentes. Reemitir dentro do MESMO ciclo substitui apenas aquela
  // versão; iniciar um retorno cria um novo ciclo e preserva para sempre a
  // entrega anterior. Registros legados, sem identificador, pertencem ao
  // ciclo `original`.
  // `salvar()` (acima) não serve para isso sozinha porque sempre faz
  // `add()` com um id novo; salvarEntrega() ao redor dela decide, ANTES de
  // chamar salvar(), se deve apagar um registro existente do mesmo
  // numeroOS primeiro. Mantido como função separada (em vez de mudar o
  // comportamento de salvar() para todo mundo) porque essa regra de
  // "1 por chave de negócio" é específica de Entregas — OS/Compra/Venda
  // continuam podendo ter vários registros no histórico local sem
  // problema, cada submissão é um documento novo e independente.
  //
  // Comparação de numeroOS: exata após trim() — o celular não normaliza
  // maiúsculas/zeros à esquerda/etc. (é texto livre, sem checagem, por
  // decisão de arquitetura); "123" e "0123" são tratados como OSs
  // diferentes aqui, igual quando forem comparados depois no PC.
  function cicloEntregaId(dados) {
    return String(dados && (dados.cicloEntregaId || dados.retornoGarantiaId) || 'original').trim() || 'original';
  }

  function buscarEntregaPorNumeroOS(numeroOS, cicloId) {
    var alvo = String(numeroOS || '').trim();
    var cicloAlvo = cicloId == null ? null : (String(cicloId || '').trim() || 'original');
    return listarPorTipo('entrega').then(function (lista) {
      for (var i = 0; i < lista.length; i++) {
        var doNumeroOS = lista[i].os && lista[i].os.numeroOS;
        if (String(doNumeroOS || '').trim() === alvo &&
            (cicloAlvo == null || cicloEntregaId(lista[i].os) === cicloAlvo)) return lista[i];
      }
      return null;
    });
  }

  // Salva um comprovante de Entrega aplicando a regra "um vale por OS":
  // se já existir um registro de entrega para o mesmo numeroOS, o registro
  // ANTERIOR é excluído antes de salvar o novo (troca de id — mais simples
  // e robusto do que sobrescrever campo a campo via put, e não há nenhum
  // outro lugar que dependa do id de uma Entrega permanecer estável entre
  // gerações diferentes do comprovante, ao contrário de
  // registroHistoricoAtualId em app.js, que é sempre reatribuído ao id
  // devolvido por esta função). Resolve com o registro novo já salvo.
  function salvarEntrega(dados) {
    var dadosComCiclo = Object.assign({}, dados || {});
    dadosComCiclo.cicloEntregaId = cicloEntregaId(dadosComCiclo);
    dadosComCiclo.tipoEntrega = dadosComCiclo.cicloEntregaId === 'original' ? 'original' : 'retorno_garantia';
    return buscarEntregaPorNumeroOS(dadosComCiclo.numeroOS, dadosComCiclo.cicloEntregaId).then(function (existente) {
      var remocao = existente ? excluir(existente.id) : Promise.resolve();
      return remocao.then(function () { return salvar(dadosComCiclo, 'entrega'); });
    });
  }

  // Lista todos os registros, mais recente primeiro. Registros salvos
  // antes desta mudança não têm `tipoDocumento` gravado — normalizamos
  // aqui para 'os' (era o único tipo possível naquela época), sem
  // reescrever nada no banco: a normalização é só na leitura.
  function listarTodos() {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA, 'readonly');
        var pedido = tx.objectStore(NOME_LOJA).getAll();
        pedido.onsuccess = function () {
          var lista = pedido.result || [];
          lista.forEach(function (registro) {
            if (!registro.tipoDocumento) registro.tipoDocumento = 'os';
          });
          lista.sort(function (a, b) { return b.salvoEm.localeCompare(a.salvoEm); });
          resolve(lista);
        };
        pedido.onerror = function () {
          reject(pedido.error || new Error('Falha ao ler o histórico local.'));
        };
      });
    });
  }

  // Mesma lista de listarTodos(), já filtrada por tipo. `tipo === 'todos'`
  // (ou omitido) devolve tudo, sem filtrar — usado pelo botão "Todos" do
  // filtro de histórico.
  function listarPorTipo(tipo) {
    return listarTodos().then(function (lista) {
      if (!tipo || tipo === 'todos') return lista;
      return lista.filter(function (registro) { return registro.tipoDocumento === tipo; });
    });
  }

  // Registros ainda não incluídos em nenhuma exportação bem-sucedida para
  // o PC. Registros salvos antes desta mudança não têm `sincronizadoComPC`
  // gravado — tratados aqui como pendentes (false), igual à normalização
  // de tipoDocumento em listarTodos()/obterPorId().
  function listarPendentesSincronizacao() {
    return listarTodos().then(function (lista) {
      return lista.filter(function (registro) {
        return registro.sincronizadoComPC !== true;
      });
    });
  }

  // Marca um conjunto de ids como já sincronizados, todos com o mesmo
  // carimbo de data/hora (o momento em que a exportação foi gerada com
  // sucesso). Usada logo depois que o .json — individual ou em lote —
  // termina de ser baixado/compartilhado, nunca antes: se o usuário
  // cancelar o compartilhamento, os registros continuam pendentes.
  function marcarComoSincronizado(ids) {
    if (!ids || !ids.length) return Promise.resolve();
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var agora = new Date().toISOString();
        var tx = db.transaction(NOME_LOJA, 'readwrite');
        var loja = tx.objectStore(NOME_LOJA);
        ids.forEach(function (id) {
          var pedido = loja.get(id);
          pedido.onsuccess = function () {
            var registro = pedido.result;
            if (!registro) return;
            registro.sincronizadoComPC = true;
            registro.sincronizadoEm = agora;
            loja.put(registro);
          };
        });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () {
          reject(tx.error || new Error('Falha ao marcar itens como sincronizados.'));
        };
      });
    });
  }

  // Marca que uma tentativa de sincronização (automática ao salvar, ou
  // retry em segundo plano) falhou para estes ids, com o carimbo de
  // quando isso aconteceu. NÃO mexe em sincronizadoComPC — só alimenta
  // o 3º estado do badge na tela de histórico ("tentou e falhou" em vez
  // de "nunca tentou"). Uma sincronização bem-sucedida posterior
  // (marcarComoSincronizado) não precisa limpar este campo: uma vez
  // sincronizadoComPC === true, o selo passa a usar esse campo primeiro
  // e ultimaTentativaSincFalhouEm deixa de ser consultado.
  function marcarTentativaSincronizacaoFalhou(ids) {
    if (!ids || !ids.length) return Promise.resolve();
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var agora = new Date().toISOString();
        var tx = db.transaction(NOME_LOJA, 'readwrite');
        var loja = tx.objectStore(NOME_LOJA);
        ids.forEach(function (id) {
          var pedido = loja.get(id);
          pedido.onsuccess = function () {
            var registro = pedido.result;
            if (!registro) return;
            registro.ultimaTentativaSincFalhouEm = agora;
            loja.put(registro);
          };
        });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () {
          reject(tx.error || new Error('Falha ao marcar tentativa de sincronização como falhada.'));
        };
      });
    });
  }

  // ── Número de OS atribuído pelo PC ────────────────────────────────
  // Antes desta função existir, o número oficial gerado pelo PC só era
  // exibido enquanto a aba "Consulta" estivesse
  // aberta, escutando em tempo real — nunca era gravado no histórico
  // local. Resultado: o técnico só via o número se entrasse manualmente
  // na aba Consulta bem na hora em que o PC respondesse; a lista de
  // Histórico continuava mostrando a OS como "prévia sem número" para
  // sempre, mesmo depois de sincronizada e numerada de verdade no PC.
  //
  // Esta função casa o número recebido com o registro certo RECALCULANDO
  // o idExportacao de cada item do histórico (window.IdExportacao.gerar,
  // o mesmo cálculo que gerarIdExportacao já fazia em app.js) — o
  // registro do histórico não guarda idExportacao persistido, mas o
  // cálculo é determinístico a partir de registro.tipoDocumento +
  // registro.os, então recalcular aqui é seguro e não exige migrar
  // nenhum registro já salvo.
  function gravarNumeroAtribuido(idExportacao, numero) {
    if (!idExportacao || !numero) return Promise.resolve(false);
    return listarTodos().then(function (lista) {
      var alvo = null;
      for (var i = 0; i < lista.length; i++) {
        var registro = lista[i];
        if (registro.numeroOSAtribuido) continue; // já numerado, não recalcula à toa
        // Usa idExportacaoOriginal quando disponível (preservado no
        // momento do salvamento original), senão recalcula como fallback
        // para registros salvos antes deste campo existir.
        var idCalculado = registro.idExportacaoOriginal
          || (window.IdExportacao ? window.IdExportacao.gerar(registro.tipoDocumento, registro.os) : null);
        if (idCalculado === idExportacao) { alvo = registro; break; }
      }
      if (!alvo) return false;
      return abrirBanco().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(NOME_LOJA, 'readwrite');
          var loja = tx.objectStore(NOME_LOJA);
          var pedido = loja.get(alvo.id);
          pedido.onsuccess = function () {
            var registroAtual = pedido.result;
            if (!registroAtual) { resolve(false); return; }
            registroAtual.numeroOSAtribuido = numero;
            if (registroAtual.os) {
              registroAtual.os = Object.assign({}, registroAtual.os, {
                numeroOSAtribuido: numero
              });
              if ((registroAtual.tipoDocumento || 'os') === 'os') {
                registroAtual.os.numero = numero;
              }
            }
            loja.put(registroAtual);
          };
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () {
            reject(tx.error || new Error('Falha ao gravar o número atribuído no histórico.'));
          };
        });
      });
    });
  }

  // Exclui do histórico local o registro cujo idExportacao (recalculado,
  // mesma técnica de gravarNumeroAtribuido acima) bate com o idExportacao
  // recebido. Não lança se não encontrar nada: um aviso para
  // um item que já foi removido localmente (ex.: o técnico já tinha
  // apagado manualmente) é um não-evento, não um erro.
  function excluirPorIdExportacao(idExportacao) {
    if (!idExportacao) return Promise.resolve(false);
    return listarTodos().then(function (lista) {
      var alvo = null;
      for (var i = 0; i < lista.length; i++) {
        var registro = lista[i];
        // Usa idExportacaoOriginal quando disponível (preservado no
        // momento do salvamento original), senão recalcula como fallback
        // para registros salvos antes deste campo existir.
        var idCalculado = registro.idExportacaoOriginal
          || (window.IdExportacao ? window.IdExportacao.gerar(registro.tipoDocumento, registro.os) : null);
        if (idCalculado === idExportacao) { alvo = registro; break; }
      }
      if (!alvo) return false;
      return excluir(alvo.id).then(function () { return true; });
    });
  }

  function obterPorId(id) {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA, 'readonly');
        var pedido = tx.objectStore(NOME_LOJA).get(id);
        pedido.onsuccess = function () {
          var registro = pedido.result || null;
          if (registro && !registro.tipoDocumento) registro.tipoDocumento = 'os';
          resolve(registro);
        };
        pedido.onerror = function () {
          reject(pedido.error || new Error('Falha ao abrir este item do histórico.'));
        };
      });
    });
  }

  // ── Bloco 4: editar no celular depois de salvo, reenviando pro PC ──
  // Reabre um item ('os' | 'compra' | 'venda' — 'entrega' fica de fora,
  // ver comentário abaixo) e grava os campos editados por cima do que já
  // estava salvo em registro.os, SEM tocar nos campos de assinatura nem no
  // idExportacaoOriginal — a assinatura já capturada continua valendo
  // depois da edição (o técnico está corrigindo um dado, não pedindo uma
  // assinatura nova), e o idExportacaoOriginal precisa continuar estável
  // para reenviarItemEditado() encontrar o mesmo registro no PC.
  //
  // 'entrega' não usa esta função porque o comprovante de entrega não tem
  // um fluxo de edição pós-assinatura no escopo deste bloco — ver
  // PROMPT-CELULAR (Bloco 4), que só cobre 'os'|'compra'|'venda'.
  //
  // `camposEditados` é um objeto parcial (ex.: { cliente: {...} } ou
  // { aparelho: {...}, observacoes: '...' }) — mesclado por cima do objeto
  // `os` salvo, um nível (Object.assign raso, mesmo padrão usado em outras
  // atualizações deste arquivo). Quem chama é responsável por montar o
  // objeto já mesclado com os sub-campos que devem mudar (ex.: cliente
  // inteiro, não só um campo dele), já que Object.assign raso substitui o
  // objeto aninhado inteiro em vez de mesclar campo a campo dentro dele.
  function editarRegistro(id, camposEditados) {
    return obterPorId(id).then(function (registro) {
      if (!registro) return null;
      var osEditado = Object.assign({}, registro.os, camposEditados || {});
      return abrirBanco().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(NOME_LOJA, 'readwrite');
          var loja = tx.objectStore(NOME_LOJA);
          var pedido = loja.get(id);
          pedido.onsuccess = function () {
            var registroAtual = pedido.result;
            if (!registroAtual) { resolve(null); return; }
            registroAtual.os = osEditado;
            registroAtual.editadoEm = new Date().toISOString();
            // Uma edição volta a marcar como pendente de sincronização —
            // mesmo que já tivesse sido sincronizado antes, o PC ainda não
            // tem os campos novos até reenviarItemEditado() rodar com
            // sucesso. Sem isso, o selo "✓ Sincronizado" ficaria mentindo
            // sobre o estado real depois de uma edição.
            registroAtual.sincronizadoComPC = false;
            if (documentoTemArquivos(osEditado, registroAtual.tipoDocumento || 'os')) {
              registroAtual.arquivosSincronizadosSupabase = false;
            }
            loja.put(registroAtual);
          };
          tx.oncomplete = function () { resolve(Object.assign({}, registro, { os: osEditado })); };
          tx.onerror = function () {
            reject(tx.error || new Error('Falha ao salvar a edição no histórico local.'));
          };
        });
      });
    });
  }

  // Monta o item de lote pronto para exportação ({ idExportacao,
  // tipoDocumento, dados }) a partir de um registro já editado.
  //
  // `montarDadosParaEnvio` é injetado por quem chama (js/app.js já tem
  // montarDadosOSParaEnvio/montarDadosCompraParaEnvio/montarDadosVendaParaEnvio
  // — passe a função certa para o tipoDocumento do registro; evita este
  // módulo depender de app.js, mantendo historico.js sem conhecer o
  // formato de payload de cada tipo de documento).
  //
  // idExportacao do item SEMPRE vem de registro.idExportacaoOriginal
  // quando presente (persistido no momento do salvamento original — ver
  // salvar()) — nunca recalculado a partir de registro.os já editado, ou
  // o PC trataria o reenvio como um documento novo em vez de atualizar o
  // existente. Registros salvos ANTES desta mudança não têm
  // idExportacaoOriginal gravado; para esses (só eles), recalcula como
  // fallback — mesmo comportamento de sempre, sem quebrar histórico antigo.
  function montarItemReenvio(registro, montarDadosParaEnvio) {
    var idExportacao = registro.idExportacaoOriginal
      || (window.IdExportacao ? window.IdExportacao.gerar(registro.tipoDocumento, registro.os) : null);
    return {
      idExportacao: idExportacao,
      tipoDocumento: registro.tipoDocumento,
      dados: montarDadosParaEnvio(registro.os)
    };
  }

  // Exclui um registro do histórico local por id. Usado pelo botão de
  // exclusão (com confirmação) na listagem do histórico.
  function excluir(id) {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA, 'readwrite');
        tx.objectStore(NOME_LOJA)['delete'](id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () {
          reject(tx.error || new Error('Falha ao excluir este item do histórico.'));
        };
      });
    });
  }

  function excluirRelacionadosOS(numeroOS) {
    var digitosAlvo = String(numeroOS || '').replace(/\D/g, '').replace(/^0+/, '') || '0';
    function corresponde(valor) {
      var digitos = String(valor || '').replace(/\D/g, '').replace(/^0+/, '') || '0';
      return !!valor && digitos === digitosAlvo;
    }
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([NOME_LOJA, NOME_LOJA_DOCS], 'readwrite');
        var historico = tx.objectStore(NOME_LOJA);
        var docs = tx.objectStore(NOME_LOJA_DOCS);
        var removidos = 0;
        var pedidoHistorico = historico.getAll();
        pedidoHistorico.onsuccess = function () {
          (pedidoHistorico.result || []).forEach(function (registro) {
            var tipo = registro.tipoDocumento || 'os';
            if (tipo !== 'os' && tipo !== 'entrega') return;
            var dados = registro.os || {};
            var numero = tipo === 'entrega'
              ? dados.numeroOS
              : (registro.numeroOSAtribuido || dados.numero || dados.numeroOS);
            if (corresponde(numero)) {
              historico['delete'](registro.id);
              removidos += 1;
            }
          });
        };
        var pedidoDocs = docs.getAll();
        pedidoDocs.onsuccess = function () {
          (pedidoDocs.result || []).forEach(function (registro) {
            if (registro.tipoDocumento !== 'os' && registro.tipoDocumento !== 'entrega') return;
            var numero = registro.identificador && registro.identificador.numero;
            if (!numero && registro.dados) numero = registro.dados.numero || registro.dados.numeroOS;
            if (corresponde(numero)) {
              docs['delete'](registro.id);
              removidos += 1;
            }
          });
        };
        tx.oncomplete = function () { resolve(removidos); };
        tx.onerror = function () {
          reject(tx.error || new Error('Falha ao limpar os documentos relacionados à OS.'));
        };
      });
    });
  }

  // ── Documentos recebidos do PC para assinatura remota ────────────
  // Store separada (documentosPendentes), mesmo banco. Cada registro:
  // { id, recebidoEm, tipoArquivoOriginal, tipoDocumento, idEnvioAssinatura,
  //   identificador, dados, statusLocal: 'pendente' | 'assinado' }
  // dados já vem com a assinatura embutida assim que statusLocal vira
  // 'assinado' (mesmo princípio do campo `os` em 'historico').

  function salvarDocumentoRecebido(registro) {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_DOCS, 'readwrite');
        tx.objectStore(NOME_LOJA_DOCS).put(registro);
        tx.oncomplete = function () { resolve(registro); };
        tx.onerror = function () {
          reject(tx.error || new Error('Falha ao salvar o documento recebido.'));
        };
      });
    });
  }

  function listarDocumentosRecebidos(incluirExcluidos) {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_DOCS, 'readonly');
        var pedido = tx.objectStore(NOME_LOJA_DOCS).getAll();
        pedido.onsuccess = function () {
          var lista = (pedido.result || []).filter(function (registro) {
            return incluirExcluidos === true || registro.statusLocal !== 'excluido';
          });
          lista.sort(function (a, b) { return (b.recebidoEm || '').localeCompare(a.recebidoEm || ''); });
          resolve(lista);
        };
        pedido.onerror = function () {
          reject(pedido.error || new Error('Falha ao ler os documentos recebidos.'));
        };
      });
    });
  }

  function obterDocumentoRecebidoPorId(id) {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_DOCS, 'readonly');
        var pedido = tx.objectStore(NOME_LOJA_DOCS).get(id);
        pedido.onsuccess = function () { resolve(pedido.result || null); };
        pedido.onerror = function () {
          reject(pedido.error || new Error('Falha ao abrir este documento.'));
        };
      });
    });
  }

  // Usado na importação para checar duplicata pelo idEnvioAssinatura (o
  // mesmo pacote do PC importado duas vezes não deve virar dois registros).
  function obterDocumentoRecebidoPorIdEnvio(idEnvioAssinatura) {
    // A busca inclui tombstones. Assim um pacote apagado continua sendo
    // reconhecido e não é importado novamente depois que o app reinicia.
    return listarDocumentosRecebidos(true).then(function (lista) {
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].idEnvioAssinatura === idEnvioAssinatura) return lista[i];
      }
      return null;
    });
  }

  function excluirDocumentoRecebido(id) {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_DOCS, 'readwrite');
        tx.objectStore(NOME_LOJA_DOCS)['delete'](id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () {
          reject(tx.error || new Error('Falha ao excluir este documento.'));
        };
      });
    });
  }

  function marcarDocumentoRecebidoExcluido(registro, exclusaoNuvemConfirmada) {
    if (!registro || !registro.id) return Promise.reject(new Error('Documento não informado.'));
    // Conserva somente os identificadores necessários para impedir a
    // reimportação e repetir a exclusão na nuvem. O conteúdo pessoal e as
    // assinaturas deixam o aparelho imediatamente.
    return salvarDocumentoRecebido({
      id: registro.id,
      recebidoEm: registro.recebidoEm || new Date().toISOString(),
      tipoDocumento: registro.tipoDocumento || 'os',
      idEnvioAssinatura: String(registro.idEnvioAssinatura || ''),
      identificador: registro.identificador || {},
      _origemSupabase: registro._origemSupabase === true,
      statusLocal: 'excluido',
      removidoEm: registro.removidoEm || new Date().toISOString(),
      exclusaoNuvemConfirmada: exclusaoNuvemConfirmada === true
    });
  }

  function listarDocumentosRecebidosExcluidos() {
    return listarDocumentosRecebidos(true).then(function (lista) {
      return lista.filter(function (registro) {
        return registro.statusLocal === 'excluido' && registro.exclusaoNuvemConfirmada !== true;
      });
    });
  }

  function confirmarExclusaoDocumentoRecebido(id) {
    return obterDocumentoRecebidoPorId(id).then(function (registro) {
      if (!registro || registro.statusLocal !== 'excluido') return false;
      registro.exclusaoNuvemConfirmada = true;
      registro.exclusaoNuvemConfirmadaEm = new Date().toISOString();
      return salvarDocumentoRecebido(registro).then(function () { return true; });
    });
  }

  // Rascunhos ficam em IndexedDB (não no localStorage) porque podem conter
  // as fotos já comprimidas. Assim uma recriação da WebView pela câmera não
  // apaga os campos que o técnico já preencheu.
  function salvarRascunho(id, dados) {
    if (!id) return Promise.resolve(false);
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_RASCUNHOS, 'readwrite');
        tx.objectStore(NOME_LOJA_RASCUNHOS).put({
          id: id,
          salvoEm: new Date().toISOString(),
          dados: dados || {}
        });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error || new Error('Falha ao salvar o rascunho.')); };
      });
    });
  }

  function obterRascunho(id) {
    if (!id) return Promise.resolve(null);
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_RASCUNHOS, 'readonly');
        var pedido = tx.objectStore(NOME_LOJA_RASCUNHOS).get(id);
        pedido.onsuccess = function () { resolve(pedido.result || null); };
        pedido.onerror = function () { reject(pedido.error || new Error('Falha ao recuperar o rascunho.')); };
      });
    });
  }

  function removerRascunho(id) {
    if (!id) return Promise.resolve(false);
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_RASCUNHOS, 'readwrite');
        tx.objectStore(NOME_LOJA_RASCUNHOS)['delete'](id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error || new Error('Falha ao remover o rascunho.')); };
      });
    });
  }

  // Marca o rascunho como concluído numa única gravação. É mais seguro do
  // que apenas excluir: se o Android suspender a WebView logo após salvar a
  // OS, nunca sobra um rascunho antigo que possa ser restaurado na abertura.
  function concluirRascunho(id) {
    if (!id) return Promise.resolve(false);
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_RASCUNHOS, 'readwrite');
        tx.objectStore(NOME_LOJA_RASCUNHOS).put({
          id: id,
          salvoEm: new Date().toISOString(),
          concluidoEm: new Date().toISOString(),
          dados: {}
        });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error || new Error('Falha ao concluir o rascunho.')); };
      });
    });
  }

  // Fila offline da migracao Supabase (Etapa 5). Os itens concluidos nao
  // sao apagados automaticamente: a confirmacao do servidor fica registrada
  // e pode ser auditada, enquanto listarOperacoesNuvemPendentes ignora esses
  // itens. O id deterministico fornecido pelo chamador garante idempotencia.
  function enfileirarOperacaoNuvem(operacao) {
    if (!operacao || !operacao.id) return Promise.reject(new Error('Operacao de nuvem sem id.'));
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_OPERACOES_NUVEM, 'readwrite');
        var loja = tx.objectStore(NOME_LOJA_OPERACOES_NUVEM);
        var pedido = loja.get(operacao.id);
        var registroFinal;
        pedido.onsuccess = function () {
          var existente = pedido.result;
          if (existente && existente.status === 'concluido') {
            registroFinal = existente;
            return;
          }
          registroFinal = Object.assign({
            status: 'pendente',
            tentativas: 0,
            criadoEm: new Date().toISOString(),
            ultimoErro: null,
            proximaTentativaEm: null
          }, existente || {}, operacao, {
            status: 'pendente',
            ultimoErro: null,
            proximaTentativaEm: null
          });
          loja.put(registroFinal);
        };
        tx.oncomplete = function () { resolve(registroFinal); };
        tx.onerror = function () { reject(tx.error || new Error('Falha ao salvar operacao na fila offline.')); };
      });
    });
  }

  function listarOperacoesNuvem() {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_OPERACOES_NUVEM, 'readonly');
        var pedido = tx.objectStore(NOME_LOJA_OPERACOES_NUVEM).getAll();
        pedido.onsuccess = function () {
          var itens = pedido.result || [];
          itens.sort(function (a, b) { return String(a.criadoEm || '').localeCompare(String(b.criadoEm || '')); });
          resolve(itens);
        };
        pedido.onerror = function () { reject(pedido.error || new Error('Falha ao ler a fila offline.')); };
      });
    });
  }

  function listarOperacoesNuvemPendentes(filtroIdentidade) {
    var agora = Date.now();
    var limiteEnvioTravado = agora - (5 * 60 * 1000);
    return listarOperacoesNuvem().then(function (itens) {
      return itens.filter(function (item) {
        // O banco local é isolado por empresa, mas pode conter operações de
        // vários usuários da mesma assistência. Filtrar antes do limite evita
        // que dez pendências de outro usuário escondam indefinidamente as da
        // conta que está aberta agora.
        if (filtroIdentidade &&
            ((item.empresaId && item.empresaId !== filtroIdentidade.empresaId) ||
             (item.usuarioId && item.usuarioId !== filtroIdentidade.usuarioId))) return false;
        if (item.status === 'pendente') return true;
        if (item.status === 'erro') {
          return !item.proximaTentativaEm || new Date(item.proximaTentativaEm).getTime() <= agora;
        }
        // Recupera um envio interrompido somente depois de cinco minutos. Antes
        // disso ele pode continuar ativo no servidor; reenviar imediatamente ao
        // reabrir a WebView causava dezenas de RPCs iguais e saturava o banco.
        if (item.status === 'enviando') {
          var ultima = new Date(item.ultimaTentativaEm || item.atualizadoEm || 0).getTime();
          return !ultima || ultima <= limiteEnvioTravado;
        }
        return false;
      }).slice(0, 10);
    });
  }

  function atualizarOperacaoNuvem(id, patch) {
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA_OPERACOES_NUVEM, 'readwrite');
        var loja = tx.objectStore(NOME_LOJA_OPERACOES_NUVEM);
        var pedido = loja.get(id);
        var atualizado = null;
        pedido.onsuccess = function () {
          if (!pedido.result) return;
          atualizado = Object.assign({}, pedido.result, patch || {});
          loja.put(atualizado);
        };
        tx.oncomplete = function () { resolve(atualizado); };
        tx.onerror = function () { reject(tx.error || new Error('Falha ao atualizar a fila offline.')); };
      });
    });
  }

  function gravarEstadoSupabase(id, dadosRemotos, opcoes) {
    if (!id || !dadosRemotos) return Promise.resolve(null);
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA, 'readwrite');
        var loja = tx.objectStore(NOME_LOJA);
        var pedido = loja.get(id);
        var atualizado = null;
        pedido.onsuccess = function () {
          var registro = pedido.result;
          if (!registro) return;
          registro.supabaseId = dadosRemotos.id || registro.supabaseId || null;
          registro.supabaseRevision = Number(dadosRemotos.revision || registro.supabaseRevision || 0) || null;
          registro.numeroOSAtribuido = dadosRemotos.numero || registro.numeroOSAtribuido || null;
          if (registro.numeroOSAtribuido && registro.os) {
            registro.os = Object.assign({}, registro.os, {
              numeroOSAtribuido: registro.numeroOSAtribuido
            });
            if ((registro.tipoDocumento || 'os') === 'os') {
              registro.os.numero = registro.numeroOSAtribuido;
            }
          }
          registro.sincronizadoComPC = !(opcoes && opcoes.pendente);
          registro.sincronizadoEm = registro.sincronizadoComPC ? new Date().toISOString() : null;
          registro.ultimaTentativaSincFalhouEm = null;
          loja.put(registro);
          atualizado = registro;
        };
        tx.oncomplete = function () { resolve(atualizado); };
        tx.onerror = function () { reject(tx.error || new Error('Falha ao gravar estado Supabase no historico.')); };
      });
    });
  }

  function marcarArquivosSupabaseSincronizados(id) {
    if (!id) return Promise.resolve(null);
    return abrirBanco().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(NOME_LOJA, 'readwrite');
        var loja = tx.objectStore(NOME_LOJA);
        var pedido = loja.get(id);
        var atualizado = null;
        pedido.onsuccess = function () {
          if (!pedido.result) return;
          atualizado = pedido.result;
          atualizado.arquivosSincronizadosSupabase = true;
          atualizado.arquivosSincronizadosEm = new Date().toISOString();
          loja.put(atualizado);
        };
        tx.oncomplete = function () { resolve(atualizado); };
        tx.onerror = function () { reject(tx.error || new Error('Falha ao confirmar arquivos sincronizados.')); };
      });
    });
  }

  window.SistemaOSHistorico = {
    definirEmpresa: definirEmpresa,
    obterEmpresaAtiva: function () { return empresaAtivaId; },
    obterNomeBancoAtual: obterNomeBancoAtual,
    salvar: salvar,
    salvarEntrega: salvarEntrega,
    buscarEntregaPorNumeroOS: buscarEntregaPorNumeroOS,
    obterCicloEntregaId: cicloEntregaId,
    listarTodos: listarTodos,
    listarPorTipo: listarPorTipo,
    listarPendentesSincronizacao: listarPendentesSincronizacao,
    marcarComoSincronizado: marcarComoSincronizado,
    marcarTentativaSincronizacaoFalhou: marcarTentativaSincronizacaoFalhou,
    gravarNumeroAtribuido: gravarNumeroAtribuido,
    obterPorId: obterPorId,
    editarRegistro: editarRegistro,
    montarItemReenvio: montarItemReenvio,
    excluir: excluir,
    excluirRelacionadosOS: excluirRelacionadosOS,
    excluirPorIdExportacao: excluirPorIdExportacao,
    // Documentos recebidos do PC (assinatura remota)
    salvarDocumentoRecebido: salvarDocumentoRecebido,
    listarDocumentosRecebidos: listarDocumentosRecebidos,
    obterDocumentoRecebidoPorId: obterDocumentoRecebidoPorId,
    obterDocumentoRecebidoPorIdEnvio: obterDocumentoRecebidoPorIdEnvio,
    excluirDocumentoRecebido: excluirDocumentoRecebido,
    marcarDocumentoRecebidoExcluido: marcarDocumentoRecebidoExcluido,
    listarDocumentosRecebidosExcluidos: listarDocumentosRecebidosExcluidos,
    confirmarExclusaoDocumentoRecebido: confirmarExclusaoDocumentoRecebido,
    salvarRascunho: salvarRascunho,
    obterRascunho: obterRascunho,
    removerRascunho: removerRascunho,
    concluirRascunho: concluirRascunho,
    enfileirarOperacaoNuvem: enfileirarOperacaoNuvem,
    listarOperacoesNuvem: listarOperacoesNuvem,
    listarOperacoesNuvemPendentes: listarOperacoesNuvemPendentes,
    atualizarOperacaoNuvem: atualizarOperacaoNuvem,
    gravarEstadoSupabase: gravarEstadoSupabase,
    marcarArquivosSupabaseSincronizados: marcarArquivosSupabaseSincronizados,
    // Exposto só para js/backup.js — dá acesso à MESMA conexão de banco
    // (promessaDb, com cache) usada por todo o resto deste arquivo, para
    // que exportar/restaurar/apagar backup completo não abra uma segunda
    // conexão paralela nem duplique a lógica de onupgradeneeded.
    _abrirBancoParaRestauracao: abrirBanco
  };
})();
