// js/backup.js
//
// Backup COMPLETO do app: tudo que existe localmente (config da empresa +
// tema + todo o histórico de OS/Compra/Venda/Entrega + documentos
// recebidos do PC para assinatura remota) num único .json exportável, e
// a importação de volta que restaura tudo — mesmo depois de desinstalar
// e reinstalar o app (o que apaga localStorage e IndexedDB juntos).
//
// Reusa window.SistemaOSCompartilhar (mesmo mecanismo de "Exportar lote"
// já usado no app) para tirar o arquivo do app, e window.SistemaOSHistorico
// para ler/gravar o IndexedDB. Isolado dos dois em arquivo próprio pelo
// mesmo motivo dos outros componentes (fotos.js, assinatura.js): tela de
// Configurações só chama os métodos públicos abaixo.
//
// FORMATO DO ARQUIVO:
// {
//   tipoArquivo: 'backup-sistema-os-celular',
//   versao: 1,
//   geradoEm: ISOString,
//   configEmpresa: { ...objeto cru salvo em localStorage... },
//   historico: [ ...todos os registros da store 'historico'... ],
//   documentosPendentes: [ ...todos os registros da store 'documentosPendentes'... ],
//   operacoesNuvem: [ ...fila offline Supabase, inclusive confirmacoes... ]
// }
//
// IMPORTAÇÃO: por padrão faz MERGE (não apaga nada que já existe) —
// registros de histórico/documentos são reconhecidos pelo próprio `id`
// gravado no backup; um id que já existe localmente é ignorado (não
// duplica), e um id novo é inserido. configEmpresa do backup SUBSTITUI a
// config atual (comportamento esperado ao restaurar).

(function () {
  'use strict';

  var TIPO_ARQUIVO = 'backup-sistema-os-celular';
  var VERSAO_BACKUP = 2;
  var CHAVE_STORAGE_CONFIG = 'osapp_config_empresa_v1';

  function obterChaveStorageConfig() {
    return window.ConfigApp && typeof window.ConfigApp.obterChaveStorage === 'function'
      ? window.ConfigApp.obterChaveStorage()
      : CHAVE_STORAGE_CONFIG;
  }

  function nomeArquivoBackup() {
    var agora = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var carimbo = agora.getFullYear() + pad(agora.getMonth() + 1) + pad(agora.getDate()) +
      '-' + pad(agora.getHours()) + pad(agora.getMinutes());
    return 'backup-sistema-os-' + carimbo + '.json';
  }

  function lerConfigCrua() {
    try {
      var bruto = localStorage.getItem(obterChaveStorageConfig());
      return bruto ? JSON.parse(bruto) : null;
    } catch (erro) {
      return null;
    }
  }

  // Monta o objeto completo do backup lendo tudo: config (localStorage) +
  // as duas stores do IndexedDB (historico.js já expõe listarTodos e
  // listarDocumentosRecebidos prontos para isso).
  function montarBackupCompleto() {
    return Promise.all([
      window.SistemaOSHistorico.listarTodos(),
      window.SistemaOSHistorico.listarDocumentosRecebidos(),
      window.SistemaOSHistorico.listarOperacoesNuvem
        ? window.SistemaOSHistorico.listarOperacoesNuvem()
        : Promise.resolve([])
    ]).then(function (resultados) {
      return {
        tipoArquivo: TIPO_ARQUIVO,
        versao: VERSAO_BACKUP,
        geradoEm: new Date().toISOString(),
        configEmpresa: lerConfigCrua(),
        historico: resultados[0] || [],
        documentosPendentes: resultados[1] || [],
        operacoesNuvem: resultados[2] || []
      };
    });
  }

  // Exporta o backup completo via o mesmo mecanismo de compartilhar/baixar
  // arquivo já usado no resto do app (menu nativo de compartilhar quando
  // disponível, senão download direto).
  function exportarBackupCompleto() {
    return montarBackupCompleto().then(function (backup) {
      return window.SistemaOSCompartilhar.compartilharOuBaixarArquivo(
        backup,
        nomeArquivoBackup(),
        'Backup do Sistema OS',
        'Backup completo do app (config + histórico + documentos).'
      );
    });
  }

  function validarArquivoBackup(objeto) {
    return !!(objeto && objeto.tipoArquivo === TIPO_ARQUIVO && objeto.versao && typeof objeto.versao === 'number');
  }

  // Grava diretamente na store do IndexedDB, ignorando o registro se o id
  // já existir (merge sem duplicar) — usa a API nativa por baixo em vez de
  // passar por salvar()/salvarEntrega() porque o backup já tem os ids e
  // carimbos originais prontos e não deve gerar novos.
  //
  // CUIDADO ESPECIAL COM 'entrega': diferente de OS/Compra/Venda, Entrega
  // segue a regra "uma versão por OS e ciclo" (ver salvarEntrega em
  // historico.js). A entrega original e cada retorno em garantia precisam
  // coexistir; somente reemissões do mesmo ciclo são substituídas. Um backup
  // pode conter uma entrega que já foi substituída (ex.: comprovante
  // reemitido para o mesmo numeroOS). Gravar esse registro antigo direto
  // por id, ignorando essa regra, ressuscitaria um comprovante que o
  // técnico já tinha corrigido/substituído, deixando dois vales para a
  // mesma OS. Por isso, para 'historico', cada registro do tipo 'entrega'
  // é comparado por numeroOS com o que já está salvo: só entra se não
  // houver nenhum registro (do backup ou já existente) mais recente para
  // o mesmo numeroOS.
  function restaurarRegistrosNaLoja(nomeLoja, registros) {
    if (!registros || !registros.length) return Promise.resolve({ inseridos: 0, ignorados: 0 });
    return window.SistemaOSHistorico._abrirBancoParaRestauracao().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(nomeLoja, 'readwrite');
        var loja = tx.objectStore(nomeLoja);
        var inseridos = 0;
        var ignorados = 0;

        // Registros de entrega já existentes localmente, indexados por
        // numeroOS+ciclo, para checar a regra sem precisar de
        // uma segunda transação (getAll aqui é síncrono dentro da mesma tx).
        var entregasLocaisPorNumeroOS = {};
        var indiceProntoPromise = new Promise(function (resolveIndice) {
          if (nomeLoja !== 'historico') { resolveIndice(); return; }
          var pedidoTudo = loja.getAll();
          pedidoTudo.onsuccess = function () {
            (pedidoTudo.result || []).forEach(function (r) {
              if (r && r.tipoDocumento === 'entrega' && r.os && r.os.numeroOS) {
                var cicloLocal = String(r.os.cicloEntregaId || r.os.retornoGarantiaId || 'original').trim() || 'original';
                entregasLocaisPorNumeroOS[String(r.os.numeroOS).trim() + '::' + cicloLocal] = r;
              }
            });
            resolveIndice();
          };
          pedidoTudo.onerror = function () { resolveIndice(); };
        });

        indiceProntoPromise.then(function () {
          registros.forEach(function (registro) {
            if (!registro || !registro.id) { return; }

            // Regra "uma versão por OS+ciclo", nos dois sentidos:
            if (nomeLoja === 'historico' && registro.tipoDocumento === 'entrega' &&
                registro.os && registro.os.numeroOS) {
              var cicloRegistro = String(registro.os.cicloEntregaId || registro.os.retornoGarantiaId || 'original').trim() || 'original';
              var chave = String(registro.os.numeroOS).trim() + '::' + cicloRegistro;
              var existenteLocal = entregasLocaisPorNumeroOS[chave];
              if (existenteLocal && existenteLocal.id !== registro.id) {
                if (String(existenteLocal.salvoEm || '') >= String(registro.salvoEm || '')) {
                  // O que já está salvo localmente é igual ou mais recente
                  // — não ressuscita a versão antiga do backup.
                  ignorados++;
                  return;
                }
                // O registro do backup é mais recente que o local — o
                // local é a versão desatualizada e precisa sair, senão
                // ficam DOIS comprovantes para a mesma OS depois do
                // insert abaixo (violaria a regra "um vale por OS").
                loja['delete'](existenteLocal.id);
                delete entregasLocaisPorNumeroOS[chave];
              }
            }

            var pedidoLeitura = loja.get(registro.id);
            pedidoLeitura.onsuccess = function () {
              if (pedidoLeitura.result) {
                ignorados++;
              } else {
                loja.add(registro);
                inseridos++;
              }
            };
          });
        });

        tx.oncomplete = function () { resolve({ inseridos: inseridos, ignorados: ignorados }); };
        tx.onerror = function () {
          reject(tx.error || new Error('Falha ao restaurar dados do backup.'));
        };
      });
    });
  }

  // Restaura um backup completo a partir do objeto já parseado do .json.
  // - configEmpresa: SUBSTITUI a config atual salva (se presente no backup).
  // - historico / documentosPendentes: MERGE por id (não duplica, não apaga
  //   nada que já esteja salvo localmente que não esteja no backup).
  function restaurarBackupCompleto(objeto) {
    if (!validarArquivoBackup(objeto)) {
      return Promise.reject(new Error('Este arquivo não é um backup válido do Sistema OS.'));
    }

    if (objeto.configEmpresa) {
      try {
        localStorage.setItem(obterChaveStorageConfig(), JSON.stringify(objeto.configEmpresa));
      } catch (erro) {
        return Promise.reject(new Error('Falha ao restaurar as configurações salvas.'));
      }
    }

    return Promise.all([
      restaurarRegistrosNaLoja('historico', objeto.historico),
      restaurarRegistrosNaLoja('documentosPendentes', objeto.documentosPendentes),
      restaurarRegistrosNaLoja('operacoesNuvem', objeto.operacoesNuvem)
    ]).then(function (resultados) {
      return {
        historico: resultados[0],
        documentosPendentes: resultados[1],
        operacoesNuvem: resultados[2]
      };
    });
  }

  // Apaga TUDO: config (localStorage) + as duas stores do IndexedDB.
  // Não apaga o próprio banco (indexedDB.deleteDatabase) de propósito —
  // limpar cada store com clear() é suficiente e evita qualquer problema
  // de conexão aberta (onupgradeneeded/versionchange) que deleteDatabase
  // poderia disparar enquanto o app ainda está rodando.
  function apagarTudo() {
    try {
      // A Etapa 3 adicionou sessão Supabase e cache de autorização em
      // chaves próprias. "Apagar tudo" também precisa remover esses dados
      // locais; a senha nunca é armazenada, mas tokens de sessão não podem
      // sobreviver a uma limpeza total do aparelho.
      if (window.SistemaOSSessao && window.SistemaOSSessao.limparCachesContexto) {
        window.SistemaOSSessao.limparCachesContexto();
      }
      var chavesAuth = [];
      for (var i = 0; i < localStorage.length; i += 1) {
        var chave = localStorage.key(i);
        if (chave && chave.indexOf('sistema-os-auth-') === 0) chavesAuth.push(chave);
      }
      chavesAuth.forEach(function (chave) { localStorage.removeItem(chave); });
      localStorage.removeItem(obterChaveStorageConfig());
    } catch (erro) {
      // segue mesmo assim para tentar limpar o IndexedDB também
    }
    return window.SistemaOSHistorico._abrirBancoParaRestauracao().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(['historico', 'documentosPendentes', 'operacoesNuvem'], 'readwrite');
        tx.objectStore('historico').clear();
        tx.objectStore('documentosPendentes').clear();
        tx.objectStore('operacoesNuvem').clear();
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () {
          reject(tx.error || new Error('Falha ao apagar os dados do app.'));
        };
      });
    });
  }

  window.SistemaOSBackup = {
    exportarBackupCompleto: exportarBackupCompleto,
    restaurarBackupCompleto: restaurarBackupCompleto,
    apagarTudo: apagarTudo,
    validarArquivoBackup: validarArquivoBackup
  };
})();
