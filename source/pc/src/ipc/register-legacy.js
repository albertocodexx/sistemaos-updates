// Registro dos canais IPC já existentes. Dependências são injetadas pelo
// processo principal; este módulo não cria BrowserWindow nem toca no boot.
function registerLegacyHandlers(deps) {
  const {
    ipcMain, dialog, shell, app, BrowserWindow, path, fs,
    db, backup, pdf, comprovanteOS, uploadService, licenca,
    auth, auditoria, whatsapp, atualizador, iaGroq, iaChat, supabaseDesktop,
    etiquetaOS,
    registerAllIpcHandlers, caminhoDentroDe, getJanelaPrincipal, raizApp, getUsuarioAutenticado
  } = deps;

  ipcMain.handle('db:verificarTamanho', () => db.verificarTamanhoDB());
  ipcMain.handle('auditoria:listar', (_e, filtros) => auditoria.listar(filtros || {}));
  ipcMain.handle('sistema:abrirLinkSeguro', async (_e, valor) => {
    let destino;
    try { destino = new URL(String(valor || '')); } catch (_) {
      return { sucesso: false, erro: 'Link inválido.' };
    }
    const host = destino.hostname.toLowerCase();
    const permitido = destino.protocol === 'https:' && (
      host === 'mercadopago.com' || host.endsWith('.mercadopago.com') ||
      host === 'mercadopago.com.br' || host.endsWith('.mercadopago.com.br') ||
      host === 'mercadolivre.com' || host.endsWith('.mercadolivre.com') ||
      host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br') ||
      host === 'mercadolibre.com' || host.endsWith('.mercadolibre.com') ||
      host === 'mercadolibre.com.br' || host.endsWith('.mercadolibre.com.br')
    );
    if (!permitido) return { sucesso: false, erro: 'Esse link de pagamento não é permitido.' };
    await shell.openExternal(destino.toString());
    return { sucesso: true };
  });

  ipcMain.handle('fiscal:abrirDanfse', async (_e, notaIdBruto) => {
    try {
      const notaId = String(notaIdBruto || '').trim();
      if (!/^[0-9a-f-]{20,50}$/i.test(notaId)) return { sucesso: false, erro: 'Nota fiscal inválida.' };
      const resultado = await supabaseDesktop?.fiscalDocumentos?.('obter_danfse', { id: notaId });
      const urlBruta = resultado?.danfse?.url;
      if (!resultado?.sucesso || !urlBruta) {
        return { sucesso: false, erro: resultado?.erro || 'DANFSe indisponível.' };
      }

      const validarDestino = (valor) => {
        let destino;
        try { destino = new URL(String(valor || '')); } catch (_) { throw new Error('Link do DANFSe inválido.'); }
        const host = destino.hostname.toLowerCase();
        const ipv4Privado = /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
        if (destino.protocol !== 'https:' || host === 'localhost' || host === '::1' || host.endsWith('.local') || ipv4Privado) {
          throw new Error('O provedor retornou um link de DANFSe inseguro.');
        }
        return destino;
      };

      let destino = validarDestino(urlBruta);
      let download;
      for (let redirecionamentos = 0; redirecionamentos < 4; redirecionamentos += 1) {
        download = await fetch(destino, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
        if (![301, 302, 303, 307, 308].includes(download.status)) break;
        const local = download.headers.get('location');
        if (!local) throw new Error('Redirecionamento inválido ao baixar o DANFSe.');
        destino = validarDestino(new URL(local, destino).toString());
      }
      if (!download?.ok) throw new Error(`O provedor não liberou o DANFSe (${download?.status || 'sem resposta'}).`);
      const tamanhoInformado = Number(download.headers.get('content-length') || 0);
      if (tamanhoInformado > 20 * 1024 * 1024) throw new Error('DANFSe maior que o limite de 20 MB.');
      const bytes = Buffer.from(await download.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024 || bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new Error('O provedor não retornou um PDF válido de DANFSe.');
      }

      const numero = String(resultado.danfse.numero || notaId).replace(/[^0-9A-Za-z_-]/g, '').slice(0, 80) || notaId;
      const pasta = path.join(app.getPath('temp'), 'Sistema OS', 'documentos-fiscais');
      fs.mkdirSync(pasta, { recursive: true });
      const arquivo = path.join(pasta, `DANFSe-${numero}.pdf`);
      fs.writeFileSync(arquivo, bytes, { mode: 0o600 });
      const erroAbertura = await shell.openPath(arquivo);
      if (erroAbertura) throw new Error(erroAbertura);
      return { sucesso: true };
    } catch (erro) {
      return { sucesso: false, erro: erro?.message || String(erro) };
    }
  });

  // A fila local do Supabase e o timer de sincronização continuam sendo a
  // fonte única de integração PC ↔ celular. O pequeno atraso garante que a
  // alteração atual termine de ser enfileirada antes de iniciar o envio.
  function sincronizarSupabaseEmSegundoPlano() {
    if (supabaseDesktop?.solicitarSincronizacao) {
      supabaseDesktop.solicitarSincronizacao();
      return;
    }
    setTimeout(() => supabaseDesktop?.sincronizarAgora?.().catch((erro) => {
      console.warn('[Supabase] Sincronização pendente (não fatal):', erro.message);
    }), 1200);
  }

  async function gerarDocumentosDaEntrega(entrega) {
    const caminhoEntrega = await pdf.gerarPdfEntrega(entrega);
    const garantia = Number(entrega?.garantiaDias) > 0
      ? db.obterGarantiaPorNumeroOS(entrega.numeroOS)
      : null;
    if (garantia) await pdf.gerarPdfGarantia(garantia);
    return caminhoEntrega;
  }

  function criarPagadorMercadoPago(os) {
    const cliente = os?.cliente || {};
    const nome = String(cliente.nome || '').trim().slice(0, 120);
    const emailBruto = String(cliente.email || '').trim().toLowerCase();
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailBruto) ? emailBruto.slice(0, 254) : '';
    let telefone = String(cliente.telefone || '').replace(/\D/g, '');
    if ((telefone.length === 12 || telefone.length === 13) && telefone.startsWith('55')) telefone = telefone.slice(2);
    const pagador = {};
    if (nome) pagador.name = nome;
    if (email) pagador.email = email;
    if (telefone.length >= 10) pagador.phone = { area_code: telefone.slice(0, 2), number: telefone.slice(2) };
    return pagador;
  }

  // Uma OS criada no celular chega primeiro como dados e anexos no
  // Supabase. No desktop, baixa anexos, recompõe o PDF e o publica de volta
  // para que o botão “Abrir PDF” funcione também no celular.
  supabaseDesktop?.definirProcessadorOSRemota?.(async (numero) => {
    const os = db.obterOSPorNumero(numero);
    if (!os) return null;
    await pdf.gerarPdfDaOS(os);
    await comprovanteOS.gerarComprovanteOS(os, '80mm').catch((erro) => {
      console.warn('[Comprovante OS] Geração remota pendente:', erro.message);
    });
    return db.obterOSPorNumero(numero);
  });

  // A assinatura remota não usa mais arquivos .json nem o sincronizador
  // legado. O PC publica o pacote no Supabase e o celular autenticado da
  // mesma empresa recebe o documento na aba Documentos.
  supabaseDesktop?.definirProcessadorRespostaAssinatura?.(async (conteudo) => {
    const resultado = conteudo?.tipoDocumento === 'entrega'
      ? db.importarRespostaAssinaturaEntrega(conteudo)
      : db.importarRespostaAssinatura(conteudo);
    if (!resultado?.sucesso) return resultado;
    const { tipoDocumento, registro } = resultado;
    try {
      if (tipoDocumento === 'os') {
        await pdf.gerarPdfDaOS(registro);
        await comprovanteOS.gerarComprovanteOS(registro, '80mm').catch((erro) => {
          console.warn('[Comprovante OS] Atualização da assinatura pendente:', erro.message);
        });
        supabaseDesktop.registrarAlteracaoOS('update', db.obterOSPorNumero(registro.numero));
      } else if (tipoDocumento === 'compra') await pdf.gerarPdfCompra(registro);
      else if (tipoDocumento === 'venda') await pdf.gerarPdfVenda(registro);
      else if (tipoDocumento === 'entrega') await gerarDocumentosDaEntrega(registro);
      else if (tipoDocumento === 'desbloqueio') await pdf.gerarPdfDesbloqueio(registro);
    } catch (erro) {
      console.error('PDF da assinatura remota falhou:', erro);
      // Não confirma a resposta no servidor enquanto o documento assinado não
      // foi regenerado. O próximo ciclo tenta novamente sem perder a assinatura.
      return { sucesso: false, erro: `A assinatura foi recebida, mas o PDF não pôde ser atualizado: ${erro.message}` };
    }
    try { backup.agendarBackupEmBreve('assinatura-remota'); } catch (_) {}
    return resultado;
  });

  // Compra e Venda criadas no APK chegam automaticamente pelo Supabase,
  // inclusive as assinaturas privadas. A importação usa o mesmo domínio do
  // lote manual para alimentar estoque, compras, financeiro e gráficos.
  supabaseDesktop?.definirProcessadorDocumentoComercialRemoto?.(async (conteudo) => {
    const resultado = db.importarLoteDoCelular(conteudo);
    if (!resultado?.sucesso) return resultado;
    const item = Array.isArray(conteudo?.itens) ? conteudo.itens[0] : null;
    const idExportacao = item?.idExportacao;
    try {
      if (item?.tipoDocumento === 'compra') {
        const compra = db.listarCompras().find((registro) => registro.origemIdExportacao === idExportacao);
        if (compra) await pdf.gerarPdfCompra(compra);
      } else if (item?.tipoDocumento === 'venda') {
        const venda = db.listarEstoque().find((registro) => registro.origemIdExportacao === idExportacao);
        if (venda) await pdf.gerarPdfVenda(venda);
      } else if (item?.tipoDocumento === 'entrega') {
        const entrega = db.obterEntregaPorNumeroOS(item?.dados?.numeroOS, item?.dados?.cicloEntregaId || item?.dados?.retornoGarantiaId);
        if (entrega) await gerarDocumentosDaEntrega(entrega);
      }
    } catch (erro) {
      return { sucesso: false, erro: `O documento chegou do celular, mas o PDF não pôde ser atualizado: ${erro.message}` };
    }
    try { backup.agendarBackupEmBreve('documento-comercial-celular'); } catch (_) {}
    try {
      auditoria.registrar('documento:recebidoDoCelular', {
        tipoDocumento: item?.tipoDocumento || '', idExportacao: idExportacao || ''
      }, null);
    } catch (_) {}
    return resultado;
  });
  
  // ─── OS ───────────────────────────────────────────────────────
  ipcMain.handle('os:criar', async (_e, dadosOS, usuarioId) => {
    const os = db.criarOS(dadosOS);
    try { await pdf.gerarPdfDaOS(os); } catch (err) { console.error('PDF OS falhou:', err); }
    try { await comprovanteOS.gerarComprovanteOS(os, '80mm'); } catch (err) { console.error('Comprovante OS falhou:', err); }
    const osAtualizada = db.obterOSPorNumero(os.numero);
    try { backup.backupAutomaticoDaOS(osAtualizada); } catch (err) { console.error('Backup OS falhou:', err); }
    sincronizarSupabaseEmSegundoPlano();
    auditoria.registrar('os:criar', { numero: os.numero }, usuarioId);
    supabaseDesktop?.registrarAlteracaoOS('insert', osAtualizada);
    return osAtualizada;
  });
  
  ipcMain.handle('os:atualizar', async (_e, numero, dadosOS, usuarioId) => {
    const os = db.atualizarOS(numero, dadosOS);
    if (!os) return null;
    try { await pdf.gerarPdfDaOS(os); } catch (err) { console.error('PDF OS falhou:', err); }
    try { await comprovanteOS.gerarComprovanteOS(os, '80mm'); } catch (err) { console.error('Comprovante OS falhou:', err); }
    const osAtualizada = db.obterOSPorNumero(os.numero);
    try { backup.backupAutomaticoDaOS(osAtualizada); } catch (err) { console.error('Backup OS falhou:', err); }
    sincronizarSupabaseEmSegundoPlano();
    auditoria.registrar('os:atualizar', { numero: os.numero }, usuarioId);
    supabaseDesktop?.registrarAlteracaoOS('update', osAtualizada);
    return osAtualizada;
  });
  
  ipcMain.handle('os:listar', () => db.listarOrdens());
  ipcMain.handle('os:buscar', (_e, termo) => db.buscarOrdens(termo));
  ipcMain.handle('os:obter', (_e, numero) => db.obterOSPorNumero(numero));
  ipcMain.handle('os:statusValidos', () => db.STATUS_OS_VALIDOS);
  ipcMain.handle('os:stats', (_e, filtro) => db.obterEstatisticasOS(filtro));
  
  ipcMain.handle('os:gerarPdfNovamente', async (_e, numero) => {
    return pdf.regenerarPdfPorNumero(numero);
  });
  ipcMain.handle('os:abrirPdf', async (_e, caminhoPdf) => {
    if (!caminhoPdf || !caminhoDentroDe(caminhoPdf)) {
      return { sucesso: false, erro: 'Caminho de PDF inválido (fora do diretório do app).' };
    }
    caminhoPdf = await pdf.atualizarPdfLegadoAntesDeAbrir(caminhoPdf);
    if (!caminhoDentroDe(caminhoPdf)) return { sucesso: false, erro: 'PDF inválido.' };
    const r = await shell.openPath(caminhoPdf);
    return r ? { sucesso: false, erro: r } : { sucesso: true };
  });
  ipcMain.handle('os:gerarComprovante', (_e, numero, formato) => {
    return comprovanteOS.gerarComprovanteOS(numero, formato, { forcar: true });
  });
  ipcMain.handle('os:abrirComprovante', (_e, numero, formato, dadosExtras) => {
    return comprovanteOS.abrirComprovanteOS(numero, formato, dadosExtras);
  });
  ipcMain.handle('os:imprimirComprovante', (_e, numero, formato, impressora, copias, dadosExtras) => {
    return comprovanteOS.imprimirComprovanteOS(numero, formato, impressora, copias, dadosExtras);
  });
  ipcMain.handle('os:salvarComprovanteTermico', (_e, numero, base64, nome, mimeType) => {
    const anexo = db.salvarComprovanteTermicoOS(numero, base64, nome, mimeType);
    const osAtualizada = db.obterOSPorNumero(numero);
    if (supabaseDesktop && osAtualizada) {
      supabaseDesktop.registrarAlteracaoOS('update', osAtualizada);
      sincronizarSupabaseEmSegundoPlano();
    }
    return { sucesso: true, anexo, os: osAtualizada };
  });
  ipcMain.handle('os:listarImpressoras', () => comprovanteOS.listarImpressoras());

  // A etiqueta é gerada inteiramente no computador. O renderer recebe apenas
  // a imagem PNG em memória e o link interno; nenhuma API pública nem dado
  // pessoal do cliente participa do QR Code.
  ipcMain.handle('etiqueta:gerarQr', (_e, numero) => etiquetaOS.gerarQrEtiqueta(numero));
  
  // ─── App Celular (assinatura em campo) — v43 ────────────────────
  // Importa uma OS preenchida e assinada no app web do celular (fase 1).
  // O celular exporta um .json com os mesmos campos de criarOS + a
  // assinatura do cliente em base64, SEM número de OS (só o PC numera).
  // Botão fica dentro de Configurações (ver renderer/index.html).
  ipcMain.handle('os:importarDoCelular', async (_e, usuarioId) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getJanelaPrincipal(), {
      title: 'Importar OS do Celular', properties: ['openFile'],
      filters: [{ name: 'OS exportada do celular', extensions: ['json'] }]
    });
    if (canceled || !filePaths?.length) return { sucesso: false, cancelado: true };
  
    let conteudo;
    try {
      conteudo = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
    } catch (err) {
      return { sucesso: false, erro: 'Não foi possível ler o arquivo selecionado (JSON inválido).' };
    }
  
    const resultado = db.importarOSDoCelular(conteudo);
    if (!resultado.sucesso) return resultado;
  
    const osImportada = resultado.os;
    try { await pdf.gerarPdfDaOS(osImportada); } catch (err) { console.error('PDF OS (importada do celular) falhou:', err); }
    const osAtualizada = db.obterOSPorNumero(osImportada.numero);
    try { backup.backupAutomaticoDaOS(osAtualizada); } catch (err) { console.error('Backup OS (importada do celular) falhou:', err); }
    auditoria.registrar('os:importarDoCelular', { numero: osImportada.numero }, usuarioId);
    return { sucesso: true, os: osAtualizada };
  });
  
  // ─── App Celular — lote v2 ────────────────────────────────────
  // Importa um lote misto (OS + Compra + Venda + Entrega) exportado do app
  // celular, ou o formato antigo de item único de OS (compatibilidade). Gera
  // PDF (já com assinatura injetada) para cada item importado com sucesso,
  // roda backup uma única vez ao final e registra uma única entrada de
  // auditoria agregada — nunca uma por item.
  // Entrega (App Celular — aba Entregas/garantia) tem uma regra diferente dos
  // outros 3: pode ser REJEITADA (OS não encontrada, sem criar órfão) ou
  // SUBSTITUIR um comprovante anterior do mesmo numeroOS — ver
  // db.importarLoteDoCelular e PROMPT-PC-aba-entregas.md.
  ipcMain.handle('lote:importarDoCelular', async (_e, usuarioId) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getJanelaPrincipal(), {
      title: 'Importar Lote do Celular', properties: ['openFile'],
      filters: [{ name: 'Lote exportado do celular', extensions: ['json'] }]
    });
    if (canceled || !filePaths?.length) return { sucesso: false, cancelado: true };
  
    let conteudo;
    try {
      conteudo = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
    } catch (err) {
      return { sucesso: false, erro: 'Não foi possível ler o arquivo selecionado (JSON inválido).' };
    }
  
    const resultado = db.importarLoteDoCelular(conteudo);
    if (!resultado.sucesso) return resultado;
  
    // Gera PDF de cada item recém-importado. O lote não devolve as
    // entidades criadas (só contadores), então identificamos exatamente
    // quais foram criadas nesta chamada casando origemIdExportacao com os
    // idExportacao presentes no arquivo — mais seguro que "pegar os N
    // últimos" (independe de ordenação de listarOrdens/listarEstoque/
    // listarCompras e não se confunde com uso concorrente do sistema).
    try {
      const idsDoArquivo = new Set(
        (conteudo.itens || [conteudo]).map(i => i.idExportacao).filter(Boolean)
      );
      if (resultado.importados.os > 0) {
        // Formato antigo de item único não tem idExportacao — nesse caso
        // é sempre exatamente 1 OS importada, então pega a mais recente.
        const novas = idsDoArquivo.size > 0
          ? db.listarOrdens().filter(o => idsDoArquivo.has(o.origemIdExportacao))
          : db.listarOrdens().slice(0, 1);
        for (const os of novas) {
          try { await pdf.gerarPdfDaOS(os); } catch (err) { console.error('PDF OS (lote celular) falhou:', err); }
        }
      }
      if (resultado.importados.compra > 0) {
        const novas = db.listarCompras().filter(c => idsDoArquivo.has(c.origemIdExportacao));
        for (const cp of novas) {
          try { await pdf.gerarPdfCompra(cp); } catch (err) { console.error('PDF Compra (lote celular) falhou:', err); }
        }
      }
      if (resultado.importados.venda > 0) {
        const novos = db.listarEstoque().filter(e => idsDoArquivo.has(e.origemIdExportacao));
        for (const item of novos) {
          try { await pdf.gerarPdfVenda(item); } catch (err) { console.error('PDF Venda (lote celular) falhou:', err); }
        }
      }
      if (resultado.importados.entrega > 0) {
        // Mesma técnica de casamento por origemIdExportacao dos outros 3
        // tipos — funciona também no caso de SUBSTITUIÇÃO (garantiaDias
        // diferente reemitido para o mesmo numeroOS): o registro salvo em
        // db.entregas carrega o origemIdExportacao do item mais recente do
        // lote, que está em idsDoArquivo.
        const novas = db.listarEntregas().filter(en => idsDoArquivo.has(en.origemIdExportacao));
        for (const en of novas) {
          try { await gerarDocumentosDaEntrega(en); } catch (err) {
            console.error('PDF Entrega (lote celular) falhou:', err);
            // Registro importado com sucesso, mas o PDF/assinatura não ficou
            // acessível (pdfPath continua '' — ver botão condicional no
            // renderer, que agora sempre aparece e tenta regenerar ao clicar).
            // Reporta aqui também para o usuário saber na hora, sem precisar
            // descobrir sozinho.
            resultado.pdfsEntregaComFalha = resultado.pdfsEntregaComFalha || [];
            resultado.pdfsEntregaComFalha.push(en.numeroOS);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao gerar PDFs do lote do celular:', err);
    }
  
    // Backup completo uma única vez, ao final do lote inteiro (não por item).
    try { backup.agendarBackupEmBreve('lote-importado-celular'); } catch (err) { console.error('Backup lote (celular) falhou:', err); }
  
    auditoria.registrar('lote:importarDoCelular', {
      total: resultado.total,
      importados: resultado.importados,
      pulados: resultado.pulados,
      erros: resultado.erros.length,
      // App Celular — Entregas (garantia): contagens específicas, além do
      // "erros" genérico já existente acima — OS não encontrada não é um
      // "erro" de item malformado, é uma rejeição de validação de negócio.
      entregasRejeitadas: (resultado.rejeitados || []).length,
      entregasSubstituidas: resultado.entregasSubstituidas || 0,
      pdfsEntregaComFalha: (resultado.pdfsEntregaComFalha || []).length
    }, usuarioId);
  
    return resultado;
  });
  
  // ─── Exportar documento (OS/Compra/Venda) para assinatura remota no
  // celular — envio INDIVIDUAL, diferente do lote acima. O documento já
  // existe no PC, sem assinatura da outra parte; o celular só coleta essa
  // assinatura fisicamente e devolve (ver handler de import mais abaixo).
  // tipoDocumento: 'os' | 'compra' | 'venda'; identificador: numero (os/compra) ou id (venda).
  // O envio remoto é sempre online e pertence ao Supabase.
  ipcMain.handle('assinatura:exportar', async (_e, tipoDocumento, identificador, usuarioId) => {
    // Bloco 3 — Entrega usa um pipeline PARALELO: o registro pendente
    // (db.entregasPendentes) já nasce com idEnvioAssinatura definido em
    // criarEntregaPendente, então não passa pelo bloco de
    // atualizarOS/atualizarCompra/atualizarItemEstoque abaixo (que muta um
    // registro pré-existente em ordens/compras/estoque — entrega não é
    // nenhum desses). Ver db.js:gerarPacoteEntregaParaAssinar.
    if (tipoDocumento === 'entrega') {
      const pendente = db.obterEntregaPendentePorNumeroOS(identificador);
      if (!pendente) return { sucesso: false, erro: 'Entrega pendente não encontrada.' };
  
      let pacoteEntrega;
      try {
        pacoteEntrega = db.gerarPacoteEntregaParaAssinar(identificador);
      } catch (err) {
        return { sucesso: false, erro: err.message };
      }
      const resultado = await supabaseDesktop?.solicitarAssinaturaRemota?.(pacoteEntrega);
      if (!resultado?.sucesso) return resultado || { sucesso: false, erro: 'A assinatura remota não está disponível. Entre novamente.' };
      auditoria.registrar('assinatura:exportar', { tipoDocumento, identificador, idEnvioAssinatura: pendente.idEnvioAssinatura, via: 'supabase' }, usuarioId);
      return Object.assign({}, resultado, { idEnvioAssinatura: pendente.idEnvioAssinatura });
    }
  
    let registro = null;
    if (tipoDocumento === 'os') registro = db.obterOSPorNumero(identificador);
    else if (tipoDocumento === 'compra') registro = db.obterCompraPorNumero(identificador);
    else if (tipoDocumento === 'venda') registro = db.obterItemEstoquePorId(identificador);
    else return { sucesso: false, erro: `Tipo de documento inválido: "${tipoDocumento}".` };
  
    if (!registro) return { sucesso: false, erro: 'Documento não encontrado.' };
  
    // Garante um idEnvioAssinatura estável (<tipo>-<id-do-registro>), gravado
    // no próprio registro ANTES de gerar o pacote — é o que permite localizar
    // este documento de volta quando a resposta assinada for importada, e
    // também o que faz reexportações do mesmo documento carregarem o MESMO
    // id (o celular usa isso para atualizar o pendente em vez de duplicar).
    if (!registro.idEnvioAssinatura) {
      const idBase = tipoDocumento === 'venda' ? registro.id : registro.numero;
      const idEnvioAssinatura = db.gerarIdEnvioAssinatura(tipoDocumento, idBase);
      if (tipoDocumento === 'os') registro = db.atualizarOS(registro.numero, { idEnvioAssinatura });
      else if (tipoDocumento === 'compra') registro = db.atualizarCompra(registro.numero, { idEnvioAssinatura });
      // atualizarItemEstoque (diferente de atualizarOS/atualizarCompra) valida
      // marca/modelo no PRÓPRIO payload de entrada — precisa do item inteiro.
      else registro = db.atualizarItemEstoque(registro.id, Object.assign({}, registro, { idEnvioAssinatura }));
    }
  
      let pacote;
    try {
      pacote = db.gerarPacoteParaAssinar(tipoDocumento, registro);
    } catch (err) {
      return { sucesso: false, erro: err.message };
    }
  
    const numeroDocumento = tipoDocumento === 'venda' ? registro.id : registro.numero;
    // A fila de assinatura e a fila de OS são independentes. Publica a OS
    // antes do documento para que, ao receber a solicitação, o celular já
    // consiga localizar o mesmo número na aba Consulta.
    if (tipoDocumento === 'os' && supabaseDesktop) {
      const sincronizacao = await supabaseDesktop.garantirOSPublicada(db.obterOSPorNumero(registro.numero));
      if (!sincronizacao?.sucesso) {
        return {
          sucesso: false,
          erro: 'A OS ainda não foi publicada para o celular: ' + (sincronizacao?.erro || 'verifique a internet e tente novamente.')
        };
      }
    }
    const resultado = await supabaseDesktop?.solicitarAssinaturaRemota?.(pacote);
    if (!resultado?.sucesso) return resultado || { sucesso: false, erro: 'A assinatura remota não está disponível. Entre novamente.' };
    auditoria.registrar('assinatura:exportar', { tipoDocumento, identificador: numeroDocumento, idEnvioAssinatura: registro.idEnvioAssinatura, via: 'supabase' }, usuarioId);
    return Object.assign({}, resultado, { idEnvioAssinatura: registro.idEnvioAssinatura });
  });
  
  // ─── Importar a resposta assinada (celular -> PC) ────────────────────
  // Ainda não existia nenhum lado de import para este formato — grava a
  // assinatura de volta no MESMO registro que foi exportado (nunca cria um
  // documento novo), localizado pelo idEnvioAssinatura.
  ipcMain.handle('assinatura:importarResposta', async (_e, usuarioId) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getJanelaPrincipal(), {
      title: 'Importar Assinatura do Celular', properties: ['openFile'],
      filters: [{ name: 'Resposta de assinatura (celular)', extensions: ['json'] }]
    });
    if (canceled || !filePaths?.length) return { sucesso: false, cancelado: true };
  
    let conteudo;
    try {
      conteudo = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
    } catch (err) {
      return { sucesso: false, erro: 'Não foi possível ler o arquivo selecionado (JSON inválido).' };
    }
  
    // Bloco 3 — Entrega usa um pipeline PARALELO (grava em db.entregas via
    // criarOuSubstituirEntrega, não em db.ordens/compras/estoque), porque
    // não existe um registro pré-existente para localizar por
    // idEnvioAssinatura como acontece com os/compra/venda — ver comentário
    // em db.js:importarRespostaAssinaturaEntrega.
    const resultado = conteudo.tipoDocumento === 'entrega'
      ? db.importarRespostaAssinaturaEntrega(conteudo)
      : db.importarRespostaAssinatura(conteudo);
    if (!resultado.sucesso) return resultado;
  
    const { tipoDocumento, registro } = resultado;
    try {
      if (tipoDocumento === 'os') await pdf.gerarPdfDaOS(registro);
      else if (tipoDocumento === 'compra') await pdf.gerarPdfCompra(registro);
      else if (tipoDocumento === 'venda') await pdf.gerarPdfVenda(registro);
      else if (tipoDocumento === 'entrega') await gerarDocumentosDaEntrega(registro);
      else if (tipoDocumento === 'desbloqueio') await pdf.gerarPdfDesbloqueio(registro);
    } catch (err) {
      console.error('PDF (resposta de assinatura do celular) falhou:', err);
    }
    try { backup.agendarBackupEmBreve('assinatura-importada-celular'); } catch (err) { console.error('Backup (assinatura celular) falhou:', err); }
  
    auditoria.registrar('assinatura:importarResposta', {
      tipoDocumento,
      identificador: tipoDocumento === 'venda' ? registro.id : registro.numero
    }, usuarioId);
  
    return resultado;
  });
  
  ipcMain.handle('os:excluir', async (_e, numero, usuario) => {
    // Pede confirmação via dialog nativo
    const { response } = await dialog.showMessageBox(getJanelaPrincipal(), {
      type: 'warning',
      buttons: ['Cancelar', 'Excluir definitivamente'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirmar exclusão',
      message: `Excluir OS ${numero}?`,
      detail: `Usuário: ${usuario || 'não identificado'}\n\nEsta ação NÃO pode ser desfeita. A exclusão será registrada no histórico.`
    });
    if (response !== 1) return { sucesso: false, cancelado: true };
    const resultado = db.excluirOS(numero, usuario);
    auditoria.registrar('os:excluir', { numero, sucesso: resultado.sucesso }, usuario);
    if (resultado.sucesso && resultado.removida && supabaseDesktop) {
      supabaseDesktop.registrarAlteracaoOS('delete', resultado.removida);
      await supabaseDesktop.sincronizarAgora().catch((err) => {
        console.warn('[Supabase] Exclusão ficou pendente para sincronizar:', err.message);
      });
    }
    if (resultado.sucesso) sincronizarSupabaseEmSegundoPlano();
    return resultado;
  });
  
  // ─── ETAPA 8.7.2 — Galeria de Fotos da OS ──────────────────────
  ipcMain.handle('os:salvarFoto', (_e, numero, categoria, base64Data, nomeOriginal) => {
    const resultado = db.salvarFotoOS(numero, categoria, base64Data, nomeOriginal);
    supabaseDesktop?.registrarAlteracaoOS('update', db.obterOSPorNumero(numero));
    return resultado;
  });
  ipcMain.handle('os:excluirFoto', (_e, numero, fotoId) => {
    const resultado = db.excluirFotoOS(numero, fotoId);
    supabaseDesktop?.registrarAlteracaoOS('update', db.obterOSPorNumero(numero));
    return resultado;
  });
  ipcMain.handle('os:substituirFoto', (_e, numero, fotoId, base64Data, nomeOriginal) => {
    const resultado = db.substituirFotoOS(numero, fotoId, base64Data, nomeOriginal);
    supabaseDesktop?.registrarAlteracaoOS('update', db.obterOSPorNumero(numero));
    return resultado;
  });
  
  // ─── Parte 2.1 — Registro de Resposta de Termos do Cliente ──────
  ipcMain.handle('os:registrarRespostaTermos', (_e, numero, dados) => {
    // dados: { aceitouTermos: true/false, motivoRecusa?: string, respostaPreferenciaPagamento?: string }
    const atualizacao = {
      aceitouTermos: dados.aceitouTermos,
      motivoRecusaTermos: dados.motivoRecusaTermos || '',
      respostaPreferenciaPagamento: dados.respostaPreferenciaPagamento || '',
      dataRespostaTermos: new Date().toISOString(),
    };
    const os = db.atualizarOS(numero, atualizacao);
    if (!os) return { sucesso: false, erro: 'OS não encontrada.' };
    auditoria.registrar('os:registrarRespostaTermos', { numero, aceitouTermos: dados.aceitouTermos });
    return { sucesso: true, os };
  });
  
  // ─── Config ───────────────────────────────────────────────────
  ipcMain.handle('config:obter', async () => {
    const config = db.obterConfig();
    const politica = await supabaseDesktop?.obterPoliticaExclusao?.();
    if (politica) {
      config.politicaExclusao = politica;
      config.possuiSenhaExclusao = politica.exige_senha === true;
      config.senhaExclusaoConfigurada = politica.senha_configurada === true;
    }
    return config;
  });
  ipcMain.handle('config:termosResolvidos', () => {
    const config = db.obterConfig() || {};
    const {
      TERMOS_OS,
      TERMOS_VENDA,
      TERMOS_COMPRA,
      TERMOS_GARANTIA
    } = require('../termos-predefinidos');
    const resolver = (personalizado, usarPredefinido, predefinido) => {
      const textoPersonalizado = String(personalizado || '').trim();
      if (textoPersonalizado) return textoPersonalizado;
      return usarPredefinido ? predefinido : '';
    };
    return {
      os: resolver(config.termosOS, config.usarTermosPredefinidosOS, TERMOS_OS),
      venda: resolver(config.termosVenda, config.usarTermosPredefinidosVenda, TERMOS_VENDA),
      compra: resolver(config.termosCompra, config.usarTermosPredefinidosCompra, TERMOS_COMPRA),
      garantia: resolver(config.termosGarantia, config.usarTermosPredefinidosGarantia, TERMOS_GARANTIA)
    };
  });
  ipcMain.handle('config:salvar', async (_e, novaConfig) => {
    const entradaConfig = Object.assign({}, novaConfig || {});
    const camposCompartilhados = [
      'nomeEmpresa', 'nomeFantasia', 'razaoSocial', 'garantiaPadrao',
      'telefonePrincipal', 'telefoneEmpresa', 'telefoneFixo', 'whatsapp', 'email', 'site',
      'endereco', 'enderecoEmpresa', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'cep',
      'possuiCnpj', 'cnpj', 'inscricaoEstadual', 'exibirCnpjDocumentos',
      'usarTermosPredefinidosOS', 'termosOS', 'usarTermosPredefinidosVenda', 'termosVenda',
      'usarTermosPredefinidosCompra', 'termosCompra', 'usarTermosPredefinidosGarantia', 'termosGarantia',
      'textoRodapePdf', 'tamanhoLogoPdf', 'tamanhoFonteTermosPdf', 'logoBase64', 'logoPath'
    ];
    if (supabaseDesktop?.podeAlterarConfiguracoesEmpresa?.() === false) {
      const atual = db.obterConfig() || {};
      const tentouAlterar = camposCompartilhados.some((chave) =>
        Object.prototype.hasOwnProperty.call(entradaConfig, chave) &&
        JSON.stringify(entradaConfig[chave] ?? null) !== JSON.stringify(atual[chave] ?? null)
      );
      if (tentouAlterar) {
        throw new Error('Os dados e a logo da empresa são definidos pelo administrador e sincronizados automaticamente.');
      }
      camposCompartilhados.forEach((chave) => { delete entradaConfig[chave]; });
    }
    if (Object.prototype.hasOwnProperty.call(entradaConfig, 'logoBase64')) {
      const logoAtual = String(db.obterConfig().logoBase64 || '');
      const logoNova = String(entradaConfig.logoBase64 || '');
      if (logoNova !== logoAtual) {
        await supabaseDesktop?.atualizarLogoEmpresa?.(logoNova);
        // A rotina acima ja persiste a logo validada. Mantem os demais
        // campos nesta gravacao sem permitir que o renderer contorne a regra.
        delete entradaConfig.logoBase64;
        delete entradaConfig.logoPath;
      }
    }
    if (Object.prototype.hasOwnProperty.call(entradaConfig, 'senhaExclusao')) {
      auditoria.registrar('config:senhaExclusao:alterada', {});
    }
    auditoria.registrar('config:salvar', {});
    const resultado = db.salvarConfig(entradaConfig);
    // A configuracao compartilhada e a fonte usada pelo APK em instalacoes
    // novas. Publicar apos o banco local evita que uma falha de rede apague a
    // edicao do PC; a UI recebe um aviso claro para tentar novamente.
    const nuvem = await supabaseDesktop?.publicarConfiguracaoMobile?.(resultado);
    if (nuvem && nuvem.sucesso === false && !nuvem.ignorado) {
      resultado.configuracaoCompartilhadaPendente = true;
      resultado.avisoConfiguracaoCompartilhada =
        'A configuracao foi salva neste computador, mas ainda aguarda envio para o celular: ' + (nuvem.erro || 'falha temporaria.');
      auditoria.registrar('config:salvar:nuvem-pendente', { erro: nuvem.erro || '' });
    }
    if (Object.prototype.hasOwnProperty.call(entradaConfig, 'supabaseAtivo') || entradaConfig.supabaseConfig) {
      await supabaseDesktop?.reconfigurar({ restaurar: true });
    }
    backup.agendarBackupEmBreve('config:salvar');
    return resultado;
  });
  ipcMain.handle('config:verificarSenhaExclusao', async (_e, senhaDigitada) => {
    const validacaoNuvem = await supabaseDesktop?.validarMinhaSenhaExclusao?.(senhaDigitada);
    return validacaoNuvem === null || validacaoNuvem === undefined
      ? db.verificarSenhaExclusao(senhaDigitada)
      : validacaoNuvem;
  });
  ipcMain.handle('config:politicaExclusao', () => supabaseDesktop?.obterPoliticaExclusao?.());
  ipcMain.handle('config:definirMinhaSenhaExclusao', (_e, senha) =>
    supabaseDesktop?.definirMinhaSenhaExclusao?.(senha)
      || { sucesso: false, erro: 'Supabase indisponivel.' });
  ipcMain.handle('config:configurarPoliticaExclusao', (_e, semSenhaTodos, usuariosSemSenha) =>
    supabaseDesktop?.configurarPoliticaExclusao?.(semSenhaTodos, usuariosSemSenha)
      || { sucesso: false, erro: 'Supabase indisponivel.' });
  ipcMain.handle('config:salvarLogo', async (_e, base64Data) => {
    return supabaseDesktop.atualizarLogoEmpresa(base64Data);
  });
  
  // ─── Zerar Sistema (reset completo, irreversível) ──────────────
  // Fluxo de segurança em duas etapas, ambas OBRIGATÓRIAS e feitas aqui
  // (nunca confiar só no renderer): 1) backup automático síncrono antes
  // de tocar nos dados; 2) validação da senha de exclusão. Só zera o
  // banco se as duas etapas passarem.
  ipcMain.handle('sistema:zerar', async (_e, senhaDigitada, responsavel) => {
    // 1) Backup de segurança primeiro — se falhar, aborta sem zerar nada.
    // CRIT-7: usando await + try/catch para garantir que o backup foi criado
    let resultadoBackup;
    try {
      resultadoBackup = backup.fazerBackupAutoDiario();
    } catch (err) {
      return { sucesso: false, erro: 'Não foi possível criar o backup de segurança antes de zerar: ' + err.message };
    }
    if (!resultadoBackup || !resultadoBackup.sucesso) {
      return { sucesso: false, erro: 'Não foi possível criar o backup de segurança antes de zerar: ' + ((resultadoBackup && resultadoBackup.erro) || 'falha desconhecida') };
    }
  
    // 2) Validação da senha de exclusão (mesma trava usada para excluir OS/estoque).
    if (!db.verificarSenhaExclusao(senhaDigitada)) {
      auditoria.registrar('sistema:zerar:senhaIncorreta', { backup: resultadoBackup.nome }, responsavel);
      return { sucesso: false, erro: 'Senha de exclusão incorreta.' };
    }
  
    const resultado = db.zerarSistema();
    sincronizarSupabaseEmSegundoPlano();
    auditoria.registrar('sistema:zerar', { backup: resultadoBackup.nome, backupCaminho: resultadoBackup.caminho }, responsavel);
    return { sucesso: true, backup: resultadoBackup };
  });
  
  // ─── Rede / Modo de Operação (Etapa 11.4 — Arquitetura Futura) ─
  ipcMain.handle('rede:obter', () => db.obterConfigRede());
  ipcMain.handle('rede:salvar', (_e, dados) => {
    try { return { sucesso: true, rede: db.salvarConfigRede(dados) }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  // ─── Estoque ──────────────────────────────────────────────────
  ipcMain.handle('estoque:criar', (_e, dados) => {
    const item = db.criarItemEstoque(dados);
    backup.agendarBackupEmBreve('estoque:criar');
    supabaseDesktop?.sincronizarEstoqueAgora?.();
    return item;
  });
  ipcMain.handle('estoque:atualizar', (_e, id, dados) => {
    const item = db.atualizarItemEstoque(id, dados);
    backup.agendarBackupEmBreve('estoque:atualizar');
    supabaseDesktop?.sincronizarEstoqueAgora?.();
    return item;
  });
  ipcMain.handle('estoque:listar', () => db.listarEstoque());
  ipcMain.handle('estoque:obter', (_e, id) => db.obterItemEstoquePorId(id));
  ipcMain.handle('estoque:stats', () => db.obterEstatisticasEstoque());
  ipcMain.handle('estoque:statusValidos', () => db.STATUS_ESTOQUE_VALIDOS);
  ipcMain.handle('estoque:checklistPadrao', () => db.CHECKLIST_PADRAO);
  
  ipcMain.handle('estoque:salvarFoto', (_e, id, base64Data, nomeOriginal) => {
    return db.salvarFotoEstoque(id, base64Data, nomeOriginal);
  });
  
  ipcMain.handle('estoque:gerarPdfVenda', async (_e, id) => {
    const item = db.obterItemEstoquePorId(id);
    if (!item) throw new Error('Item não encontrado.');
    try {
      const caminho = await pdf.gerarPdfVenda(item);
      return { sucesso: true, caminho };
    } catch (err) {
      return { sucesso: false, erro: err.message };
    }
  });
  
  ipcMain.handle('estoque:abrirPdfVenda', async (_e, caminho) => {
    if (!caminho || !caminhoDentroDe(caminho)) return { sucesso: false, erro: 'Caminho inválido (fora do diretório do app).' };
    caminho = await pdf.atualizarPdfLegadoAntesDeAbrir(caminho);
    if (!caminhoDentroDe(caminho)) return { sucesso: false, erro: 'PDF inválido.' };
    const r = await shell.openPath(caminho);
    return r ? { sucesso: false, erro: r } : { sucesso: true };
  });
  
  ipcMain.handle('estoque:buscar', (_e, filtros) => db.buscarEstoque(filtros));
  
  ipcMain.handle('estoque:obterLog', (_e, filtros) => db.obterLogEstoque(filtros || {}));
  
  ipcMain.handle('estoque:exportarLogCsv', async (_e, filtros) => {
    const csv = db.exportarLogEstoqueCsv(filtros || {});
    const { filePath, canceled } = await dialog.showSaveDialog(getJanelaPrincipal(), {
      title: 'Exportar Log de Estoque',
      defaultPath: `log-estoque-${new Date().toISOString().slice(0,10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (canceled || !filePath) return { sucesso: false, cancelado: true };
    require('fs').writeFileSync(filePath, '\uFEFF' + csv, 'utf-8'); // BOM para Excel
    shell.openPath(filePath);
    return { sucesso: true, caminho: filePath };
  });
  
  ipcMain.handle('estoque:excluir', async (_e, id, usuario) => {
    const item = db.obterItemEstoquePorId(id);
    const desc = item ? [item.marca, item.modelo].filter(Boolean).join(' ') || `ID ${id}` : `ID ${id}`;
    const { response } = await dialog.showMessageBox(getJanelaPrincipal(), {
      type: 'warning',
      buttons: ['Cancelar', 'Excluir definitivamente'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirmar exclusão',
      message: `Excluir "${desc}"?`,
      detail: `Usuário: ${usuario || 'não identificado'}\n\nEsta ação NÃO pode ser desfeita. O registro será removido do estoque, financeiro e relatórios.`
    });
    if (response !== 1) return { sucesso: false, cancelado: true };
    const resultado = db.excluirItemEstoque(id, usuario);
    auditoria.registrar('estoque:excluir', { id, desc, sucesso: resultado.sucesso }, usuario);
    if (resultado.sucesso) supabaseDesktop?.sincronizarEstoqueAgora?.();
    return resultado;
  });
  
  // ─── Peças e Componentes ──────────────────────────────────────
  ipcMain.handle('peca:criar', (_e, dados) => {
    const item = db.criarPeca(dados);
    supabaseDesktop?.sincronizarEstoqueAgora?.();
    return item;
  });
  ipcMain.handle('peca:atualizar', (_e, id, dados) => {
    const item = db.atualizarPeca(id, dados);
    supabaseDesktop?.sincronizarEstoqueAgora?.();
    return item;
  });
  ipcMain.handle('peca:listar', () => db.listarPecas());
  ipcMain.handle('peca:obter', (_e, id) => db.obterPecaPorId(id));
  ipcMain.handle('peca:buscar', (_e, filtros) => db.buscarPecas(filtros));
  ipcMain.handle('peca:excluir', async (_e, id, usuario) => {
    // ALT-29: Adiciona confirmação + validação de senha para exclusão de peça
    const { response } = await dialog.showMessageBox(getJanelaPrincipal(), {
      type: 'warning',
      buttons: ['Cancelar', 'Excluir peça'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirmar exclusão',
      message: 'Excluir esta peça/componente?',
      detail: 'Esta ação não pode ser desfeita.'
    });
    if (response !== 1) return { sucesso: false, cancelado: true };
    const resultado = db.excluirPeca(id, usuario);
    auditoria.registrar('peca:excluir', { id, sucesso: resultado.sucesso }, usuario);
    if (resultado.sucesso) supabaseDesktop?.sincronizarEstoqueAgora?.();
    return resultado;
  });
  ipcMain.handle('peca:movimentar', (_e, pecaId, tipo, quantidade, detalhes) => {
    const resultado = db.movimentarEstoquePeca(pecaId, tipo, quantidade, detalhes || {});
    auditoria.registrar('peca:movimentar', {
      id: pecaId,
      tipo,
      quantidade,
      sucesso: resultado?.sucesso === true
    }, detalhes?.usuario || '');
    if (resultado?.sucesso) {
      backup.agendarBackupEmBreve('peca:movimentar');
      supabaseDesktop?.sincronizarEstoqueAgora?.();
    }
    return resultado;
  });
  ipcMain.handle('peca:baixarEstoque', (_e, pecaId, quantidade, osRef, usuario) => {
    const resultado = db.baixarEstoquePeca(pecaId, quantidade, osRef, usuario);
    if (resultado?.sucesso) supabaseDesktop?.sincronizarEstoqueAgora?.();
    return resultado;
  });
  ipcMain.handle('peca:stats', () => db.obterEstatisticasPecas());
  ipcMain.handle('peca:categorias', () => db.CATEGORIAS_PECA);
  ipcMain.handle('estoque:dashboardCompleto', () => db.obterEstatisticasDashboard());
  ipcMain.handle('modelos:listar', () => db.listarModelosCadastrados());
  ipcMain.handle('modelos:registrar', (_e, modelo) => db.registrarModeloManual(modelo));
  
  // ─── Compras ──────────────────────────────────────────────────
  ipcMain.handle('compra:criar', (_e, dados) => {
    const compra = db.criarCompra(dados);
    backup.agendarBackupEmBreve('compra:criar');
    return compra;
  });
  ipcMain.handle('compra:atualizar', (_e, numero, dados) => {
    const compra = db.atualizarCompra(numero, dados);
    backup.agendarBackupEmBreve('compra:atualizar');
    return compra;
  });
  ipcMain.handle('compra:listar', () => db.listarCompras());
  ipcMain.handle('compra:obter', (_e, numero) => db.obterCompraPorNumero(numero));
  ipcMain.handle('compra:buscar', (_e, filtros) => db.buscarCompras(filtros));
  ipcMain.handle('compra:excluir', async (_e, numero, usuario) => {
    // ALT-30: Adiciona confirmação para exclusão de compra
    const { response } = await dialog.showMessageBox(getJanelaPrincipal(), {
      type: 'warning',
      buttons: ['Cancelar', 'Excluir compra'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirmar exclusão',
      message: `Excluir compra ${numero}?`,
      detail: 'Esta ação não pode ser desfeita.'
    });
    if (response !== 1) return { sucesso: false, cancelado: true };
    const removida = db.excluirCompra(numero, usuario);
    backup.agendarBackupEmBreve('compra:excluir');
    sincronizarSupabaseEmSegundoPlano();
    return { sucesso: true, removida };
  });
  ipcMain.handle('compra:gerarPdf', async (_e, numero) => {
    const cp = db.obterCompraPorNumero(numero);
    if (!cp) throw new Error(`Compra ${numero} não encontrada.`);
    const caminho = await pdf.gerarPdfCompra(cp);
    return caminho;
  });
  ipcMain.handle('compra:abrirPdf', async (_e, caminho) => {
    if (!caminho || !caminhoDentroDe(caminho) || !require('fs').existsSync(caminho)) throw new Error('PDF não encontrado.');
    caminho = await pdf.atualizarPdfLegadoAntesDeAbrir(caminho);
    if (!caminhoDentroDe(caminho)) throw new Error('PDF inválido.');
    await shell.openPath(caminho);
    return { sucesso: true };
  });
  
  // ─── Entregas (App Celular — comprovante de retirada + garantia) ───────
  // Leitura/exibição dos comprovantes já assinados: essa parte é alimentada
  // via importação de lote do celular (lote:importarDoCelular acima).
  // A criação de uma NOVA entrega para assinatura remota (Bloco 3) tem seu
  // próprio bloco de handlers logo abaixo ("Nova Entrega").
  ipcMain.handle('entrega:listar', () => db.listarEntregas());
  ipcMain.handle('entrega:obterPorOS', (_e, numeroOS, cicloEntregaId) => db.obterEntregaPorNumeroOS(numeroOS, cicloEntregaId));
  ipcMain.handle('entrega:listarPorOS', (_e, numeroOS) => db.listarEntregasPorNumeroOS(numeroOS));
  ipcMain.handle('entrega:editar', async (_e, numeroOS, dados, cicloEntregaId) => {
    const resultado = db.editarEntrega(numeroOS, dados, cicloEntregaId);
    await gerarDocumentosDaEntrega(resultado.entrega);
    auditoria.registrar('entrega:editar', { numeroOS, cicloEntregaId: resultado.entrega.cicloEntregaId });
    try { backup.agendarBackupEmBreve('entrega-editada'); } catch (_) {}
    sincronizarSupabaseEmSegundoPlano();
    return { sucesso: true, entrega: db.obterEntregaPorNumeroOS(numeroOS, resultado.entrega.cicloEntregaId) };
  });
  ipcMain.handle('entrega:atualizarRecebedor', (_e, numeroOS, nome, usuarioId, cicloEntregaId) => {
    const resultado = db.atualizarRecebedorEntrega(numeroOS, nome, cicloEntregaId);
    auditoria.registrar('entrega:atualizarRecebedor', { numeroOS, nome }, usuarioId);
    if (supabaseDesktop && resultado.os) {
      supabaseDesktop.registrarAlteracaoOS('update', resultado.os);
      sincronizarSupabaseEmSegundoPlano();
    }
    return resultado;
  });
  ipcMain.handle('entrega:abrirPdf', async (_e, caminho) => {
    if (!caminho || !caminhoDentroDe(caminho) || !require('fs').existsSync(caminho)) throw new Error('PDF não encontrado.');
    caminho = await pdf.atualizarPdfLegadoAntesDeAbrir(caminho);
    if (!caminhoDentroDe(caminho)) throw new Error('PDF inválido.');
    await shell.openPath(caminho);
    return { sucesso: true };
  });
  // Regenerar PDF de uma entrega já importada (ex.: mudou tema/logo em
  // Configurações depois da importação) — mesmo padrão de compra:gerarPdf.
  ipcMain.handle('entrega:gerarPdf', async (_e, numeroOS, cicloEntregaId) => {
    const en = db.obterEntregaPorNumeroOS(numeroOS, cicloEntregaId);
    if (!en) throw new Error(`Comprovante de entrega para a OS ${numeroOS} não encontrado.`);
    const caminho = await gerarDocumentosDaEntrega(en);
    return caminho;
  });
  
  // ─── Nova Entrega (Bloco 3 — criada no PC, enviada para assinatura
  // remota no celular). Pipeline paralelo ao de assinatura:exportar acima
  // — ver comentário lá e em db.js. Busca OS reaproveita db.obterOSPorNumero
  // (mesma usada pela aba Garantia).
  ipcMain.handle('entrega:buscarOS', (_e, numeroOS) => db.obterOSPorNumero(numeroOS));
  ipcMain.handle('entrega:listarPendentes', () => db.listarEntregasPendentes());
  ipcMain.handle('entrega:obterPendentePorOS', (_e, numeroOS, cicloEntregaId) => db.obterEntregaPendentePorNumeroOS(numeroOS, cicloEntregaId));
  ipcMain.handle('entrega:criarPendente', async (_e, numeroOS, dados, usuarioId) => {
    const pendente = db.criarEntregaPendente(numeroOS, dados);
    const { entrega } = db.criarOuSubstituirEntrega({ ...pendente, assinaturaRetirouBase64: '', assinaturaPendente: true, naoAssinado: false });
    await gerarDocumentosDaEntrega(entrega);
    sincronizarSupabaseEmSegundoPlano();
    auditoria.registrar('entrega:criarPendente', { numeroOS }, usuarioId);
    return pendente;
  });
  ipcMain.handle('entrega:criarNaoAssinada', async (_e, numeroOS, dados, usuarioId) => {
    const resultado = db.criarEntregaNaoAssinada(numeroOS, dados);
    await gerarDocumentosDaEntrega(resultado.entrega);
    const entrega = db.obterEntregaPorNumeroOS(numeroOS, resultado.entrega.cicloEntregaId);
    auditoria.registrar('entrega:criarNaoAssinada', { numeroOS }, usuarioId);
    try { backup.agendarBackupEmBreve('entrega-nao-assinada'); } catch (_) {}
    sincronizarSupabaseEmSegundoPlano();
    return { sucesso: true, entrega };
  });
  ipcMain.handle('entrega:excluirPendente', (_e, numeroOS, usuarioId, cicloEntregaId) => {
    const excluiu = db.excluirEntregaPendente(numeroOS, cicloEntregaId);
    if (excluiu) auditoria.registrar('entrega:excluirPendente', { numeroOS }, usuarioId);
    return excluiu;
  });
  ipcMain.handle('entrega:excluir', (_e, numeroOS, usuarioId, cicloEntregaId) => {
    const alvo = db.obterEntregaPorNumeroOS(numeroOS, cicloEntregaId);
    const numero = alvo?.numeroOS || numeroOS;
    const resultado = db.excluirEntrega(numeroOS, cicloEntregaId);
    if (resultado.sucesso) {
      supabaseDesktop?.aftercareService?.registrarExclusao('entrega', numero, alvo?.cicloEntregaId, alvo?.supabaseId);
      auditoria.registrar('entrega:excluir', { numeroOS, cicloEntregaId: alvo?.cicloEntregaId }, usuarioId);
      sincronizarSupabaseEmSegundoPlano();
    }
    return resultado;
  });
  
  // ─── Garantia (aba nova, criada manualmente no PC) ─────────────────────
  // Usuário digita o nº da OS; o sistema puxa cliente/aparelho dela. Salva
  // (ou sobrescreve, se já existir garantia pra essa OS) e gera o PDF em
  // via única.
  ipcMain.handle('garantia:buscarOS', (_e, numeroOS) => db.obterOSPorNumero(numeroOS));
  ipcMain.handle('garantia:termosPadrao', () => require('../termos-predefinidos').TERMOS_GARANTIA);
  ipcMain.handle('garantia:listar', () => db.listarGarantias());
  ipcMain.handle('garantia:obterPorOS', (_e, numeroOS) => db.obterGarantiaPorNumeroOS(numeroOS));
  ipcMain.handle('garantia:salvar', async (_e, dados) => {
    const garantia = db.criarOuAtualizarGarantia(dados);
    const caminho = await pdf.gerarPdfGarantia(garantia);
    sincronizarSupabaseEmSegundoPlano();
    return db.obterGarantiaPorNumeroOS(garantia.numeroOS);
  });
  ipcMain.handle('garantia:gerarPdf', async (_e, numeroOS) => {
    const g = db.obterGarantiaPorNumeroOS(numeroOS);
    if (!g) throw new Error(`Garantia para a OS ${numeroOS} não encontrada.`);
    const caminho = await pdf.gerarPdfGarantia(g);
    return caminho;
  });
  ipcMain.handle('garantia:registrarRetorno', async (_e, numeroOS, dados, usuario) => {
    const resultado = db.registrarRetornoGarantia(numeroOS, dados || {}, usuario);
    if (resultado.ordem) supabaseDesktop?.registrarAlteracaoOS?.('update', resultado.ordem);
    auditoria.registrar('garantia:registrarRetorno', {
      numeroOS: resultado.garantia?.numeroOS || numeroOS,
      retornoId: resultado.retorno?.id,
      status: resultado.retorno?.status,
      duplicado: resultado.duplicado === true
    }, usuario);
    try { backup.agendarBackupEmBreve('retorno-garantia'); } catch (_) {}
    sincronizarSupabaseEmSegundoPlano();
    return resultado;
  });
  ipcMain.handle('garantia:atualizarStatusRetorno', async (_e, numeroOS, retornoId, dados, usuario) => {
    const resultado = db.atualizarStatusRetornoGarantia(numeroOS, retornoId, dados || {}, usuario);
    if (resultado.entrega) await gerarDocumentosDaEntrega(resultado.entrega);
    if (resultado.ordem) supabaseDesktop?.registrarAlteracaoOS?.('update', resultado.ordem);
    auditoria.registrar('garantia:atualizarStatusRetorno', {
      numeroOS: resultado.garantia?.numeroOS || numeroOS,
      retornoId,
      status: resultado.retorno?.status
    }, usuario);
    try { backup.agendarBackupEmBreve('status-retorno-garantia'); } catch (_) {}
    sincronizarSupabaseEmSegundoPlano();
    return resultado;
  });
  ipcMain.handle('garantia:abrirPdf', async (_e, caminho) => {
    if (!caminho || !caminhoDentroDe(caminho) || !require('fs').existsSync(caminho)) throw new Error('PDF não encontrado.');
    await shell.openPath(caminho);
    return { sucesso: true };
  });
  ipcMain.handle('garantia:excluir', (_e, numeroOS) => {
    const numero = db.obterGarantiaPorNumeroOS(numeroOS)?.numeroOS || numeroOS;
    const resultado = db.excluirGarantia(numeroOS);
    if (resultado) {
      supabaseDesktop?.aftercareService?.registrarExclusao('garantia', numero);
      sincronizarSupabaseEmSegundoPlano();
    }
    return resultado;
  });

  // ─── Autorizações de desbloqueio ─────────────────────────────────────
  ipcMain.handle('desbloqueio:listar', () => db.listarDesbloqueios());
  ipcMain.handle('desbloqueio:obter', (_e, numero) => db.obterDesbloqueio(numero));
  ipcMain.handle('desbloqueio:termos', () => require('../templates/desbloqueio-template').TERMOS_DESBLOQUEIO);
  ipcMain.handle('desbloqueio:salvar', async (_e, dados, modo, usuarioId) => {
    const enviar = modo === 'enviar';
    const anterior = dados?.numero ? db.obterDesbloqueio(dados.numero) : null;
    // Ao transformar um pedido pendente em documento não assinado, remova
    // primeiro a cópia da nuvem. Assim ele não reaparece no celular depois
    // de fechar, reinstalar ou sincronizar o aplicativo.
    if (!enviar && anterior?.idEnvioAssinatura && anterior.assinaturaPendente) {
      const cancelamento = await supabaseDesktop?.cancelarAssinaturaRemota?.(anterior.idEnvioAssinatura);
      if (cancelamento && !cancelamento.sucesso) return cancelamento;
    }
    let documento = db.salvarDesbloqueio({
      ...(dados || {}), assinaturaPendente: enviar, naoAssinado: !enviar,
      __preservarAssinatura: false,
      assinaturaClienteBase64: '',
      supabaseId: anterior?.supabaseId || '',
      supabaseRevision: anterior?.supabaseRevision || 0,
      supabaseClienteId: anterior?.supabaseClienteId || '',
      origemIdExportacao: anterior?.origemIdExportacao || '',
      idEnvioAssinatura: anterior?.idEnvioAssinatura || ''
    });
    await pdf.gerarPdfDesbloqueio(documento);
    documento = db.obterDesbloqueio(documento.numero);
    if (enviar) {
      const pacote = db.gerarPacoteParaAssinar('desbloqueio', documento);
      const remoto = await supabaseDesktop?.solicitarAssinaturaRemota?.(pacote);
      if (!remoto?.sucesso) {
        // Uma falha de rede pode acontecer depois de o servidor já ter
        // recebido o documento. Só converta para "não assinado" quando a
        // nuvem confirmar a remoção; caso contrário mantenha "aguardando"
        // para que PC e celular não exibam estados contraditórios.
        const cancelamento = await supabaseDesktop?.cancelarAssinaturaRemota?.(documento.idEnvioAssinatura);
        if (cancelamento?.sucesso) {
          documento = db.atualizarDesbloqueio(documento.numero, { assinaturaPendente: false, naoAssinado: true });
          await pdf.gerarPdfDesbloqueio(documento);
        }
        return remoto || { sucesso: false, erro: 'Não foi possível enviar para o celular.' };
      }
    }
    auditoria.registrar('desbloqueio:salvar', {
      numero: documento.numero, assinatura: enviar ? 'aguardando' : 'nao_assinado'
    }, usuarioId);
    try { backup.agendarBackupEmBreve('desbloqueio'); } catch (_) {}
    sincronizarSupabaseEmSegundoPlano();
    return { sucesso: true, documento: db.obterDesbloqueio(documento.numero) };
  });
  ipcMain.handle('desbloqueio:gerarPdf', async (_e, numero) => {
    const documento = db.obterDesbloqueio(numero);
    if (!documento) throw new Error('Autorização de desbloqueio não encontrada.');
    return pdf.gerarPdfDesbloqueio(documento);
  });
  ipcMain.handle('desbloqueio:imprimirTermico', async (_e, numero, formato, nomeImpressora) => {
    const documento = db.obterDesbloqueio(numero);
    if (!documento) throw new Error('Autorização de desbloqueio não encontrada.');
    return pdf.imprimirDesbloqueioTermico(documento, formato, nomeImpressora);
  });
  ipcMain.handle('desbloqueio:abrirPdf', async (_e, caminho) => {
    if (!caminho || !caminhoDentroDe(caminho) || !fs.existsSync(caminho)) throw new Error('PDF não encontrado.');
    // Refaz PDFs antigos antes de abrir. Isso aplica o layout atual (uma
    // assinatura centralizada, CPF oculto quando vazio e sem o antigo aviso)
    // inclusive aos documentos restaurados de backup ou sincronizados.
    const atualizado = await pdf.atualizarPdfLegadoAntesDeAbrir(caminho);
    const erro = await shell.openPath(atualizado || caminho);
    return erro ? { sucesso: false, erro } : { sucesso: true };
  });
  ipcMain.handle('desbloqueio:excluir', async (_e, numero, usuarioId) => {
    const documento = db.obterDesbloqueio(numero);
    if (!documento) return { sucesso: false, erro: 'Autorização não encontrada.' };
    const { response } = await dialog.showMessageBox(getJanelaPrincipal(), {
      type: 'warning', buttons: ['Cancelar', 'Excluir autorização'], defaultId: 0, cancelId: 0,
      title: 'Excluir autorização', message: `Excluir ${numero}?`,
      detail: 'A autorização e o PDF serão removidos. Esta ação não pode ser desfeita.'
    });
    if (response !== 1) return { sucesso: false, cancelado: true };
    if (documento.idEnvioAssinatura) {
      const remoto = await supabaseDesktop?.cancelarAssinaturaRemota?.(documento.idEnvioAssinatura);
      if (remoto && !remoto.sucesso) return remoto;
    }
    const exclusaoNuvem = await supabaseDesktop?.excluirDesbloqueioNuvem?.(documento);
    if (exclusaoNuvem && exclusaoNuvem.sucesso === false) return exclusaoNuvem;
    const resultado = db.excluirDesbloqueio(numero);
    if (resultado.sucesso) auditoria.registrar('desbloqueio:excluir', { numero }, usuarioId);
    return resultado;
  });
  
  ipcMain.handle('backup:exportar', async () => {
    const sugestao = `backup-sistema-os-${new Date().toISOString().slice(0,10)}.json`;
    const { canceled, filePath } = await dialog.showSaveDialog(getJanelaPrincipal(), {
      title: 'Exportar Backup', defaultPath: sugestao,
      filters: [{ name: 'Backup do Sistema OS', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { sucesso: false, cancelado: true };
    try {
      const resultado = backup.exportarBackupCompleto(filePath);
      return { sucesso: true, ...resultado };
    } catch (err) {
      return { sucesso: false, erro: err.message };
    }
  });
  
  ipcMain.handle('backup:importar', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getJanelaPrincipal(), {
      title: 'Importar Backup', properties: ['openFile'],
      filters: [{ name: 'Backup do Sistema OS', extensions: ['json'] }]
    });
    if (canceled || !filePaths?.length) return { sucesso: false, cancelado: true };
    try { return { sucesso: true, ...backup.importarBackup(filePaths[0]) }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  ipcMain.handle('backup:abrirPasta', async () => { await shell.openPath(db.getBackupDir()); return { sucesso: true }; });
  ipcMain.handle('backup:abrirPastaDados', async () => { await shell.openPath(db.getRootDir()); return { sucesso: true }; });
  
  // Backup automático manual (forçar agora)
  ipcMain.handle('backup:fazerAgora', async () => {
    return backup.fazerBackupAutoDiario();
  });
  
  // ── Backup visual do Painel (Relatórios) — PDF com cards e gráficos ──
  // Captura a própria aba de Relatórios já renderizada na janela principal
  // (cards, KPIs e gráficos são calculados dinamicamente e não fazem parte
  // do backup de dados em JSON). Aplica um CSS temporário que esconde o
  // cabeçalho/menu/controles de interação, imprime só o conteúdo da aba,
  // e remove o CSS em seguida — sem alterar a tela do usuário.
  ipcMain.handle('backup:exportarPainelPDF', async () => {
    const fs = require('fs');
    if (!getJanelaPrincipal() || getJanelaPrincipal().isDestroyed()) {
      return { sucesso: false, erro: 'Janela principal indisponível.' };
    }
  
    const config = db.obterConfig();
    const empresa = config.nomeEmpresa || config.nomeFantasia || 'Assistência Técnica';
    const sugestao = `painel-relatorios-${empresa.replace(/[^a-zA-Z0-9]+/g,'_')}-${new Date().toISOString().slice(0,10)}.pdf`;
  
    const { canceled, filePath } = await dialog.showSaveDialog(getJanelaPrincipal(), {
      title: 'Exportar Painel (PDF)', defaultPath: sugestao,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { sucesso: false, cancelado: true };
  
    const CSS_IMPRESSAO = `
      body.modo-print-painel .topo,
      body.modo-print-painel .abas,
      body.modo-print-painel #btnAtualizarRelatorios,
      body.modo-print-painel #btnExportarPainelPDF {
        display: none !important;
      }
      body.modo-print-painel .conteudo { padding: 12px 20px; max-width: none; }
      body.modo-print-painel .secao-aba { display: none !important; }
      body.modo-print-painel #aba-relatorios { display: block !important; }
      body.modo-print-painel #aba-relatorios .card { break-inside: avoid; }
      body.modo-print-painel::before {
        content: "${empresa.replace(/"/g,'\\"')} — Painel de Relatórios — ${new Date().toLocaleString('pt-BR')}";
        display: block; font-size: 11px; color: #666; margin-bottom: 14px;
        border-bottom: 1px solid #ccc; padding-bottom: 8px;
      }
    `;
  
    let cssKey = null;
    try {
      cssKey = await getJanelaPrincipal().webContents.insertCSS(CSS_IMPRESSAO);
      await getJanelaPrincipal().webContents.executeJavaScript(
        `document.body.classList.add('modo-print-painel'); void 0;`
      );
      // Pequena espera para garantir reflow antes de capturar
      await new Promise(r => setTimeout(r, 150));
  
      const buffer = await getJanelaPrincipal().webContents.printToPDF({
        printBackground: true, landscape: false, pageSize: 'A4',
        margins: { marginType: 'default' }
      });
      fs.writeFileSync(filePath, buffer);
      return { sucesso: true, caminho: filePath };
    } catch (err) {
      return { sucesso: false, erro: err.message };
    } finally {
      try {
        await getJanelaPrincipal().webContents.executeJavaScript(
          `document.body.classList.remove('modo-print-painel'); void 0;`
        );
        if (cssKey) await getJanelaPrincipal().webContents.removeInsertedCSS(cssKey);
      } catch { /* melhor esforço — não bloqueia o retorno */ }
    }
  });
  
  // Listar backups automáticos
  ipcMain.handle('backup:listarAuto', async () => {
    return backup.listarBackupsAuto();
  });
  
  // Baixar/abrir um backup automático específico
  ipcMain.handle('backup:baixarAuto', async (_e, caminhoArquivo) => {
    if (!caminhoDentroDe(caminhoArquivo, db.getBackupAutoDir(), ['.json'])) {
      return { sucesso: false, erro: 'Selecione um backup automático desta empresa.' };
    }
    const { canceled, filePath } = await dialog.showSaveDialog(getJanelaPrincipal(), {
      title: 'Salvar cópia do backup',
      defaultPath: path.basename(caminhoArquivo),
      filters: [{ name: 'Backup do Sistema OS', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { sucesso: false, cancelado: true };
    try {
      const fs = require('fs');
      if (!caminhoDentroDe(caminhoArquivo, db.getBackupAutoDir(), ['.json'])) throw new Error('Backup inválido.');
      fs.copyFileSync(caminhoArquivo, filePath);
      return { sucesso: true };
    } catch (err) {
      return { sucesso: false, erro: err.message };
    }
  });
  
  ipcMain.handle('backup:abrirPastaAuto', async () => {
    await shell.openPath(db.getBackupAutoDir());
    return { sucesso: true };
  });
  
  // Status do agendamento automático — para exibição na tela de Configurações
  ipcMain.handle('backup:statusAutomatico', async () => {
    return backup.statusAgendamento();
  });
  
  // ─── Manual ───────────────────────────────────────────────────
  ipcMain.handle('app:abrirManual', async () => {
    const manualPath = path.join(raizApp, 'src', 'manual.html');
    const manualWin = new BrowserWindow({
      width: 900, height: 800, title: 'Manual do Sistema OS',
      webPreferences: {
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        webSecurity: true, allowRunningInsecureContent: false, devTools: false
      }
    });
    manualWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    manualWin.webContents.on('will-navigate', (evento, destino) => {
      if (destino !== manualWin.webContents.getURL()) evento.preventDefault();
    });
  
    // manual.html é estático e trazia números de versão hardcoded (v26.6.1 em
    // duas linhas + "Versao 4.0" solto na capa, três valores divergentes entre
    // si e desatualizados frente ao package.json real). Em vez de manter mais
    // uma string fixa para lembrar de atualizar a cada release, lemos o HTML,
    // trocamos os placeholders pela versão real e servimos a partir de uma
    // cópia temporária — o arquivo original em src/ não é alterado.
    try {
      const fs = require('fs');
      const os = require('os');
      const vAtual = atualizador.versaoAtual();
      let html = fs.readFileSync(manualPath, 'utf-8');
      html = html
        .replace(/Manual do Sistema OS v[\d.]+/g, `Manual do Sistema OS v${vAtual}`)
        .replace(/Sistema OS v[\d.]+(?=<\/h1>)/g, `Sistema OS v${vAtual}`)
        .replace(/Versao [\d.]+ &mdash; 2026/g, `Versao ${vAtual} &mdash; 2026`);
      const tmpManual = path.join(os.tmpdir(), 'sistemaos-manual-' + Date.now() + '.html');
      fs.writeFileSync(tmpManual, html, 'utf-8');
      manualWin.loadFile(tmpManual);
      manualWin.once('closed', () => { try { fs.unlinkSync(tmpManual); } catch {} });
    } catch (e) {
      // Se algo falhar na substituição (ex.: erro de leitura), não deixa o
      // usuário sem manual nenhum — cai de volta para o arquivo original.
      manualWin.loadFile(manualPath);
    }
  
    manualWin.setMenu(null);
    return { sucesso: true };
  });
  
  // ─── Licença ──────────────────────────────────────────────────
  registerAllIpcHandlers({ ipcMain, licenca, supabaseDesktop, app });
  
  // ─── Auth / Usuários (Etapa 11.2) ────────────────────────────
  ipcMain.handle('auth:login', (_e, usuario, senha) => {
    const r = auth.autenticar(usuario, senha);
    auditoria.registrar('auth:login', { sucesso: !!(r && r.sucesso), usuarioTentado: usuario });
    return r;
  });
  
  // Etapa 11.3 — bugfix: revalida sessão persistida contra o banco
  // (status do usuário e permissões do cargo podem ter mudado desde o login)
  ipcMain.handle('auth:revalidar', (_e, id) => {
    return auth.revalidarSessao(id);
  });
  
  ipcMain.handle('auth:listarUsuarios', () => {
    return auth.listarUsuarios();
  });
  
  ipcMain.handle('auth:criarUsuario', (_e, dados) => {
    try { return { sucesso: true, usuario: auth.criarUsuario(dados) }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  ipcMain.handle('auth:gerarAutomatico', (_e, perfil) => {
    try { return { sucesso: true, usuario: auth.gerarUsuarioAutomatico(perfil) }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  ipcMain.handle('auth:editarUsuario', (_e, id, dados) => {
    try { return { sucesso: true, usuario: auth.editarUsuario(id, dados) }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  ipcMain.handle('auth:alterarStatus', (_e, id, status) => {
    try { return { sucesso: true, usuario: auth.alterarStatus(id, status) }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  // Onboarding: atualiza apenas o nome do usuário (primeiro acesso)
  ipcMain.handle('auth:atualizarNome', (_e, id, nome) => {
    try { return { sucesso: true, usuario: auth.editarUsuario(id, { nome }) }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  ipcMain.handle('auth:excluirUsuario', (_e, id, solicitanteId) => {
    try { auth.excluirUsuario(id, solicitanteId); return { sucesso: true }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  // ─── Cargos e Permissões (Etapa 11.3) ─────────────────────────
  ipcMain.handle('cargos:listar', () => {
    return auth.listarCargos();
  });
  
  ipcMain.handle('cargos:modulos', () => {
    return { modulos: auth.MODULOS, labels: auth.MODULOS_LABEL };
  });
  
  ipcMain.handle('cargos:criar', (_e, dados) => {
    try { return { sucesso: true, cargo: auth.criarCargo(dados) }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  ipcMain.handle('cargos:editar', (_e, id, dados) => {
    try { return { sucesso: true, cargo: auth.editarCargo(id, dados) }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  ipcMain.handle('cargos:excluir', (_e, id) => {
    try { auth.excluirCargo(id); return { sucesso: true }; }
    catch (err) { return { sucesso: false, erro: err.message }; }
  });
  
  // ── Orçamentos ─────────────────────────────────────────────────
  ipcMain.handle('orc:criar',   (_e, dados) => db.criarOrcamento(dados));
  ipcMain.handle('orc:atualizar', (_e, num, dados) => db.atualizarOrcamento(num, dados));
  ipcMain.handle('orc:listar',  () => db.listarOrcamentos());
  ipcMain.handle('orc:obter',   (_e, num) => db.obterOrcamentoPorNumero(num));
  ipcMain.handle('orc:buscar',  (_e, termo) => db.buscarOrcamentos(termo));
  // ALT-31: Adiciona confirmação para exclusão de orçamento
  ipcMain.handle('orc:excluir', async (_e, num, u) => {
    const { response } = await dialog.showMessageBox(getJanelaPrincipal(), {
      type: 'warning',
      buttons: ['Cancelar', 'Excluir orçamento'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirmar exclusão',
      message: `Excluir orçamento ${num}?`,
      detail: 'Esta ação não pode ser desfeita.'
    });
    if (response !== 1) return { sucesso: false, cancelado: true };
    return db.excluirOrcamento(num, u);
  });
  ipcMain.handle('orc:converterEmOS', (_e, num, extras) => db.converterOrcamentoEmOS(num, extras));
  
  // ── Histórico do cliente ────────────────────────────────────────
  ipcMain.handle('cliente:historico', (_e, cpf, nome) => db.buscarHistoricoCliente(cpf, nome));
  
  // ── Aba Clientes: agregação de OS + Vendas + Compras ────────────
  ipcMain.handle('clientes:listar', () => db.listarClientes());
  ipcMain.handle('clientes:buscar', (_e, termo) => db.buscarClientes(termo));
  ipcMain.handle('clientes:perfil', (_e, chave) => db.obterPerfilCliente(chave));
  
  // v46.2.8 — edição de dados de cliente (nome/telefone/CPF), propagada para
  // todos os registros de origem (OS, itens de estoque vendidos, compras) que
  // compõem o cliente agregado. Registrado em auditoria por envolver dado de
  // cliente em múltiplos registros de uma vez.
  ipcMain.handle('clientes:atualizarDados', async (_e, chave, dados, usuario) => {
    const resultado = db.atualizarDadosCliente(chave, dados);
    if (resultado.sucesso) {
      for (const numero of resultado.ordensAtualizadas || []) {
        const osAtualizada = db.obterOSPorNumero(numero);
        if (osAtualizada) supabaseDesktop?.registrarAlteracaoOS?.('update', osAtualizada);
      }
      try { await supabaseDesktop?.sincronizarAgora?.(); } catch (_) {}
    }
    auditoria.registrar('clientes:atualizarDados', {
      chave, dados, sucesso: resultado.sucesso,
      registrosAtualizados: resultado.registrosAtualizados, erro: resultado.erro
    }, usuario);
    return resultado;
  });
  ipcMain.handle('clientes:excluir', async (_e, chave, usuario) => {
    const resultado = db.excluirCliente(chave);
    if (resultado.sucesso) {
      for (const numero of resultado.ordensAtualizadas || []) {
        const osAtualizada = db.obterOSPorNumero(numero);
        if (osAtualizada) supabaseDesktop?.registrarAlteracaoOS?.('update', osAtualizada);
      }
      try { await supabaseDesktop?.sincronizarAgora?.(); } catch (_) {}
      backup.agendarBackupEmBreve('clientes:excluir');
    }
    auditoria.registrar('clientes:excluir', {
      chave,
      sucesso: resultado.sucesso,
      registrosAtualizados: resultado.registrosAtualizados,
      erro: resultado.erro
    }, usuario);
    return resultado;
  });
  
  // ── v20: Relatório Financeiro ──────────────────────────────────
  ipcMain.handle('financeiro:relatorio', (_e, filtros) => db.obterRelatorioFinanceiro(filtros || {}));

  ipcMain.handle('financeiro:exportarCsv', async (_e, filtros) => {
    const relatorio = db.obterRelatorioFinanceiro(filtros || {});
    const periodo = relatorio.periodo || {};
    const sugestao = `extrato-financeiro-${periodo.inicio || 'inicio'}-a-${periodo.fim || 'fim'}.csv`;
    const { canceled, filePath } = await dialog.showSaveDialog(getJanelaPrincipal(), {
      title: 'Baixar extrato financeiro (CSV)',
      defaultPath: sugestao,
      filters: [{ name: 'Planilha CSV', extensions: ['csv'] }]
    });
    if (canceled || !filePath) return { sucesso: false, cancelado: true };

    const protegerCelula = (valor) => {
      let texto = String(valor ?? '').replace(/\r?\n/g, ' ');
      if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
      return `"${texto.replace(/"/g, '""')}"`;
    };
    const cabecalho = ['Data', 'Movimento', 'Descrição', 'Documento', 'Cliente', 'ID do cliente', 'Forma', 'Valor', 'Caixa', 'Lucro', 'Observação'];
    const linhas = (relatorio.extrato || []).map((item) => [
      item.data,
      item.direcao === 'saida' ? 'Saída' : 'Entrada',
      item.descricao,
      item.documento,
      item.contraparte,
      item.clienteId || '00000',
      item.metodo,
      Number(item.valorAssinado || 0).toFixed(2).replace('.', ','),
      item.impactaCaixa ? 'Sim' : 'Não',
      item.impactaResultado ? 'Sim' : 'Não',
      item.observacao
    ]);
    const csv = '\uFEFF' + [cabecalho, ...linhas].map((linha) => linha.map(protegerCelula).join(';')).join('\r\n');
    fs.writeFileSync(filePath, csv, { encoding: 'utf8', mode: 0o600 });
    return { sucesso: true, caminho: filePath, quantidade: linhas.length };
  });

  ipcMain.handle('financeiro:exportarPdf', async () => {
    const janela = getJanelaPrincipal();
    if (!janela || janela.isDestroyed()) return { sucesso: false, erro: 'Janela principal indisponível.' };
    const { canceled, filePath } = await dialog.showSaveDialog(janela, {
      title: 'Baixar extrato financeiro (PDF)',
      defaultPath: `extrato-financeiro-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { sucesso: false, cancelado: true };
    try {
      await janela.webContents.executeJavaScript("document.body.classList.add('modo-print-extrato'); void 0;");
      await new Promise((resolve) => setTimeout(resolve, 120));
      const buffer = await janela.webContents.printToPDF({
        printBackground: true,
        landscape: true,
        pageSize: 'A4',
        margins: { top: 0.35, bottom: 0.35, left: 0.35, right: 0.35 }
      });
      fs.writeFileSync(filePath, buffer, { mode: 0o600 });
      return { sucesso: true, caminho: filePath };
    } catch (erro) {
      return { sucesso: false, erro: erro?.message || String(erro) };
    } finally {
      try { await janela.webContents.executeJavaScript("document.body.classList.remove('modo-print-extrato'); void 0;"); } catch (_) {}
    }
  });
  
  // ── v20: Cruzamento Estoque × OS ──────────────────────────────
  ipcMain.handle('estoque:cruzarOS', () => db.cruzarEstoqueOS());
  
  // ── v20: Notificação WhatsApp ──────────────────────────────────
  ipcMain.handle('notificacao:whatsappOS', async (_e, numero) => {
    const os = db.obterOSPorNumero(numero);
    if (!os) return { sucesso: false, erro: 'OS não encontrada.' };
    const config = db.obterConfig();
    const telefone = (os.cliente?.telefone || '').replace(/\D/g, '');
    if (!telefone) return { sucesso: false, erro: 'Cliente sem telefone cadastrado.' };
    const ddi     = (config.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55';
    const empresa = config.nomeEmpresa || config.nomeFantasia || 'Assistência Técnica';
    const aparelho = [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' ') || 'seu aparelho';
    const mensagem = encodeURIComponent(
      `Olá ${os.cliente?.nome || ''}! 😊\n\n` +
      `Sua OS *${os.numero}* — *${aparelho}* está *pronta para retirada*! ✅\n\n` +
      `Pode passar na nossa loja para buscar.\n\n` +
      `Qualquer dúvida estamos à disposição.\n` +
      `*${empresa}*`
    );
    const telFinal = telefone.startsWith(ddi) ? telefone : `${ddi}${telefone}`;
    const url = `https://wa.me/${telFinal}?text=${mensagem}`;
    await shell.openExternal(url);
    return { sucesso: true, url };
  });
  
  // ── v40.2: Mercado Pago — testar conexão do token ──────────────
  // Faz uma chamada mínima (GET /users/me) só para validar que o Access Token
  // funciona, sem tocar em nenhum pagamento/preferência. Usado pelo botão
  // "Testar Conexão" em Configurações > Integrações — Mercado Pago, para o
  // usuário saber na hora se o token que colou é válido, em vez de só
  // descobrir isso quando um cliente tentar pagar.
  // Referência oficial do endpoint: documentação da Mercado Pago usa GET
  // /users/me como exemplo padrão de chamada autenticada com o Access Token.
  ipcMain.handle('mp:testarConexao', async (_e, tokenForcado) => {
    const configRaw = db.loadDB().config; // obterConfig() removeria o token; precisamos do valor real aqui
    const token = (tokenForcado && tokenForcado.trim()) || configRaw.mercadoPagoToken || '';
    if (!token) return { sucesso: false, erro: 'Nenhum token do Mercado Pago configurado.' };
  
    const https = require('https');
    const inicio = Date.now();
  
    try {
      const resultado = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.mercadopago.com',
          path: '/users/me',
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
          timeout: 8000
        }, res => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode === 401 || res.statusCode === 403) {
              reject(new Error('Token inválido, expirado, ou sem permissão. Confira se copiou o token de PRODUÇÃO (não o de teste) em mercadopago.com.br → Suas integrações → Credenciais.'));
              return;
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`O Mercado Pago retornou status ${res.statusCode}. Corpo: ${data.slice(0, 200)}`));
              return;
            }
            try {
              const json = JSON.parse(data);
              resolve(json);
            } catch (e) {
              reject(new Error('Resposta do Mercado Pago não é um JSON válido.'));
            }
          });
        });
        req.on('timeout', () => req.destroy(new Error('Tempo limite (8s) excedido ao conectar com o Mercado Pago.')));
        req.on('error', reject);
        req.end();
      });
  
      // A resposta de /users/me traz nickname, email e site_id (ex.: MLB para
      // Brasil) — devolvemos só o essencial para exibir "conectado como Fulano".
      return {
        sucesso: true,
        tempoRespostaMs: Date.now() - inicio,
        nomeConta: resultado.nickname || resultado.email || 'Conta Mercado Pago',
        siteId: resultado.site_id || null
      };
    } catch (err) {
      return { sucesso: false, erro: err.message };
    }
  });
  
  // ── v20: Mercado Pago — gerar link de pagamento ────────────────
  ipcMain.handle('mp:gerarLink', async (_e, numero, valor) => {
    const os = db.obterOSPorNumero(numero);
    if (!os) return { sucesso: false, erro: 'OS não encontrada.' };
  
    // Bug 4 fix: rejeita valor zero ou negativo
    const valorNum = parseFloat(valor);
    if (!valorNum || valorNum <= 0) return { sucesso: false, erro: 'Valor inválido. Informe um valor maior que R$ 0,00.' };
  
    const configRaw = db.loadDB().config; // Fix: obterConfig() remove o token por segurança; usar loadDB direto
    const token = configRaw.mercadoPagoToken || '';
    if (!token) return { sucesso: false, erro: 'Token do Mercado Pago não configurado. Vá em Configurações > Integrações.' };
  
    const aparelho = [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' ') || 'Serviço de assistência técnica';
    const titulo = `${os.numero} — ${aparelho}`;
    const pagador = criarPagadorMercadoPago(os);
  
    try {
      const https = require('https');
      const body = JSON.stringify({
        items: [{
          title: titulo,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: valorNum
        }],
        payment_methods: {
          excluded_payment_types: [],
          installments: 1
        },
        ...(Object.keys(pagador).length ? { payer: pagador } : {}),
        external_reference: os.numero, // Fix: necessário para mp:verificarPagamento encontrar o pagamento
        expires: true,
        expiration_date_to: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '.000-03:00')
      });
  
      const linkPagamento = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.mercadopago.com',
          path: '/checkout/preferences',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Content-Length': Buffer.byteLength(body)
          }
        }, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.init_point) resolve(json.init_point);
              else reject(new Error(json.message || json.error || 'Resposta inválida do Mercado Pago'));
            } catch(e) { reject(new Error('Erro ao parsear resposta: ' + data.slice(0,200))); }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
  
      return { sucesso: true, link: linkPagamento };
    } catch(err) {
      return { sucesso: false, erro: err.message };
    }
  });
  
  // ── v20: WhatsApp com link Mercado Pago ────────────────────────
  ipcMain.handle('notificacao:whatsappOSML', async (_e, numero, valor, linkPagamento) => {
    const os = db.obterOSPorNumero(numero);
    if (!os) return { sucesso: false, erro: 'OS não encontrada.' };
    const config = db.obterConfig();
    const telefone = (os.cliente?.telefone || '').replace(/\D/g, '');
    if (!telefone) return { sucesso: false, erro: 'Cliente sem telefone cadastrado.' };
    const ddi     = (config.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55';
    const empresa = config.nomeEmpresa || config.nomeFantasia || 'Assistência Técnica';
    const aparelho = [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' ') || 'seu aparelho';
    const valorFmt = 'R$ ' + parseFloat(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  
    let mensagem;
    if (linkPagamento) {
      mensagem =
        `Olá ${os.cliente?.nome || ''}! 😊\n\n` +
        `Sua OS *${os.numero}* — *${aparelho}* está *pronta para retirada*! ✅\n\n` +
        `💳 *Valor: ${valorFmt}*\n\n` +
        `Você pode pagar pelo link abaixo (Mercado Pago — cartão, Pix, boleto):\n` +
        `${linkPagamento}\n\n` +
        `⚠️ Após pagar, envie o *comprovante* por aqui para confirmarmos sua OS como *autorizada*.\n\n` +
        `Qualquer dúvida estamos à disposição!\n` +
        `*${empresa}*`;
    } else {
      mensagem =
        `Olá ${os.cliente?.nome || ''}! 😊\n\n` +
        `Sua OS *${os.numero}* — *${aparelho}* está *pronta para retirada*! ✅\n\n` +
        `💳 *Valor: ${valorFmt}*\n\n` +
        `⚠️ Após o pagamento, envie o *comprovante* por aqui para confirmarmos sua OS como *autorizada*.\n\n` +
        `Qualquer dúvida estamos à disposição!\n` +
        `*${empresa}*`;
    }
  
    const telFinal = telefone.startsWith(ddi) ? telefone : `${ddi}${telefone}`;
    const url = `https://wa.me/${telFinal}?text=${encodeURIComponent(mensagem)}`;
    await shell.openExternal(url);
    return { sucesso: true, url };
  });
  
  // ── v20: Gerar link ML + Pix copia-e-cola juntos ──────────────
  const pix = require('../pix');
  
  ipcMain.handle('mp:gerarLinkEPix', async (_e, numero, valor) => {
    const os = db.obterOSPorNumero(numero);
    if (!os) return { sucesso: false, erro: 'OS não encontrada.' };
    const config = db.obterConfig();
    const configFull = db.loadDB().config; // precisa do token que é removido do obterConfig()
    const token = configFull.mercadoPagoToken || '';
  
    const telefone = (os.cliente?.telefone || '').replace(/\D/g, '');
    if (!telefone) return { sucesso: false, erro: 'Cliente sem telefone cadastrado.' };
    const ddi = (config.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55';
  
    const empresa = config.nomeEmpresa || config.nomeFantasia || 'Assistência Técnica';
    const aparelho = [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' ') || 'serviço';
    const valorNum = parseFloat(valor);
    // Bug 5 fix: rejeita valor zero ou negativo
    if (!valorNum || valorNum <= 0) return { sucesso: false, erro: 'Valor inválido. Informe um valor maior que R$ 0,00.' };
    const valorFmt = 'R$ ' + valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const pagador = criarPagadorMercadoPago(os);
  
    // ── Link Mercado Pago ────────────────────────────────────────
    let linkML = null;
    let erroML = null;
    if (token) {
      try {
        const https = require('https');
        const body = JSON.stringify({
          items: [{ title: `${os.numero} — ${aparelho}`, quantity: 1, currency_id: 'BRL', unit_price: valorNum }],
          ...(Object.keys(pagador).length ? { payer: pagador } : {}),
          statement_descriptor: 'ASSISTENCIA TEC',
          external_reference: os.numero,
          expires: true,
          expiration_date_to: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '.000-03:00')
        });
        linkML = await new Promise((resolve, reject) => {
          const req = https.request({
            hostname: 'api.mercadopago.com', path: '/checkout/preferences', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Content-Length': Buffer.byteLength(body) }
          }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              try {
                const j = JSON.parse(data);
                j.init_point ? resolve(j.init_point) : reject(new Error(j.message || j.error || 'Resposta inválida'));
              } catch(e) { reject(e); }
            });
          });
          req.on('error', reject);
          req.write(body);
          req.end();
        });
      } catch(e) { erroML = e.message; }
    } else {
      erroML = 'Token Mercado Pago não configurado.';
    }
  
    // ── Pix copia-e-cola ─────────────────────────────────────────
    let pixCodigo = null;
    let erroPix = null;
    const pixChave = configFull.pixChave || '';
    const pixTipo  = configFull.pixTipoChave || 'telefone';
    if (pixChave) {
      try {
        pixCodigo = pix.gerarPixCopiaCola({
          chave: pixChave,
          tipoChave: pixTipo,
          nome: empresa,
          cidade: config.cidade || 'Brasil',
          valor: valorNum,
          txid: os.numero.replace(/\D/g, ''),
          descricao: `OS ${os.numero}`
        });
      } catch(e) { erroPix = e.message; }
    } else {
      erroPix = 'Chave Pix não configurada.';
    }
  
    // ── Montar mensagem WhatsApp ──────────────────────────────────
    const linhas = [
      `Olá ${os.cliente?.nome || ''}! 😊`,
      '',
      `Sua OS *${os.numero}* — *${aparelho}* está *pronta para retirada*! ✅`,
      '',
      `💰 *Valor: ${valorFmt}*`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '💳 *FORMAS DE PAGAMENTO*',
      '━━━━━━━━━━━━━━━━━━━━━━',
    ];
  
    if (linkML) {
      linhas.push('');
      linhas.push('🔗 *Mercado Pago* (cartão, Pix, boleto):');
      linhas.push(linkML);
    }
  
    if (pixCodigo) {
      linhas.push('');
      linhas.push('📋 *Pix Copia e Cola:*');
      linhas.push('```' + pixCodigo + '```');
      linhas.push('_(Abra seu banco → Pix → Copia e Cola → cole o código acima)_');
    }
  
    linhas.push('');
    linhas.push('━━━━━━━━━━━━━━━━━━━━━━');
    linhas.push('⚠️ Após pagar, envie o *comprovante* aqui para confirmarmos sua OS como *autorizada*.');
    linhas.push('');
    linhas.push(`*${empresa}*`);
  
    const mensagem = linhas.join('\n');
    const telFinal = telefone.startsWith(ddi) ? telefone : `${ddi}${telefone}`;
    const url = `https://wa.me/${telFinal}?text=${encodeURIComponent(mensagem)}`;
    await shell.openExternal(url);
  
    return {
      sucesso: true,
      linkML, erroML,
      pixCodigo, erroPix
    };
  });
  
  // ── v20: Verificar pagamento Mercado Pago por OS ───────────────
  ipcMain.handle('mp:verificarPagamento', async (_e, solicitacao) => {
    const numero = typeof solicitacao === 'object'
      ? String(solicitacao?.numero || solicitacao?.osNumero || '')
      : String(solicitacao || '');
    const cobIdSolicitado = typeof solicitacao === 'object'
      ? String(solicitacao?.cobId || '')
      : '';
    const os = db.obterOSPorNumero(numero);
    if (!os) return { sucesso: false, erro: 'OS não encontrada.' };

    const cobrancasDaOS = db.listarCobrancas
      ? db.listarCobrancas().filter(c => c.osNumero === numero)
      : [];
    const cobrancaSolicitada = cobIdSolicitado
      ? cobrancasDaOS.find(c => c.id === cobIdSolicitado)
      : null;
    if (cobIdSolicitado && !cobrancaSolicitada) {
      return { sucesso: false, erro: 'Cobrança não encontrada ou não pertence a esta OS.' };
    }
    if (cobrancaSolicitada?.status === 'pago') {
      const pagamento = db.listarPagamentos().find(p => p.id === cobrancaSolicitada.pagamentoId);
      return {
        sucesso: true,
        pago: true,
        cobId: cobrancaSolicitada.id,
        pagamentoId: pagamento?.id || cobrancaSolicitada.pagamentoId || null,
        jaConfirmado: true,
        valorPago: pagamento?.valor || cobrancaSolicitada.valor || 0,
        metodoPag: pagamento?.metodo || 'Registrado',
        mensagem: 'Esta cobrança já foi confirmada anteriormente.'
      };
    }
  
    // Early-return: se a OS já está Autorizado por qualquer canal (manual, Pix, MP),
    // encerra o poll imediatamente sem precisar consultar a API do Mercado Pago.
    // Isso evita polling infinito quando o pagamento foi registrado por outro meio (ex: dinheiro).
    // v31: Autorizado está em statusPagamento (campo separado do status técnico)
    if (['Pago', 'Autorizado'].includes(os.statusPagamento) || os.status === 'Entregue') {
      // Uma OS com entrada de 50% pode ter mais de um pagamento. Deduplica
      // somente a mesma confirmação do Mercado Pago, não qualquer lançamento
      // anterior da OS.
      const pagExistente = db.listarPagamentos().find(p =>
        p.osNumero === numero && p.origem === 'mercadopago'
      );
      if (cobrancaSolicitada?.status === 'aguardando') {
        db.atualizarStatusCobranca(cobrancaSolicitada.id, { status: 'cancelado', pagamentoId: null });
        return {
          sucesso: true,
          pago: false,
          cobId: cobrancaSolicitada.id,
          status: 'cobranca_alternativa_cancelada',
          mensagem: 'A OS já foi quitada por outra forma; esta cobrança alternativa foi cancelada.'
        };
      }
      return {
        sucesso: true,
        pago: true,
        cobId: cobrancaSolicitada?.id || '',
        pagamentoId: pagExistente?.id || null,
        jaConfirmado: true,
        valorPago: pagExistente?.valor || 0,
        metodoPag: pagExistente?.metodo || 'Registrado',
        mensagem: `OS ${numero} já está ${os.status} — pagamento previamente confirmado.`
      };
    }
  
    try {
      const https = require('https');

      // A consulta principal usa o token criptografado no cofre Supabase. O
      // token local é apenas compatibilidade para instalações antigas.
      let resultado = null;
      if (supabaseDesktop?.consultarPagamentosMercadoPago) {
        const consultaSegura = await supabaseDesktop.consultarPagamentosMercadoPago(numero);
        if (consultaSegura?.sucesso) {
          resultado = { results: Array.isArray(consultaSegura.pagamentos) ? consultaSegura.pagamentos : [] };
        } else if (!db.loadDB().config?.mercadoPagoToken) {
          return { sucesso: false, erro: consultaSegura?.erro || 'Não foi possível consultar o Mercado Pago.' };
        }
      }
      if (!resultado) {
        const token = db.loadDB().config?.mercadoPagoToken || '';
        if (!token) return { sucesso: false, erro: 'A conta Mercado Pago não está conectada para esta empresa.' };
        resultado = await new Promise((resolve, reject) => {
          const path = `/v1/payments/search?external_reference=${encodeURIComponent(numero)}&sort=date_created&criteria=desc&limit=20`;
          const req = https.request({
            hostname: 'api.mercadopago.com',
            path,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
          }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); }
              catch(e) { reject(new Error('Resposta inválida: ' + data.slice(0, 100))); }
            });
          });
          req.on('error', reject);
          req.end();
        });
      }
  
      const pagamentos = resultado.results || [];
  
      // Referência primária: a cobrança 'aguardando' mais recente da OS (a atual).
      // Bug fix (pagamento antigo confundido com o novo): como external_reference é o
      // NÚMERO DA OS — e não muda entre cobranças diferentes da mesma OS — a busca no MP
      // sempre retorna TODO o histórico de pagamentos daquela OS, incluindo aprovações
      // antigas de ciclos anteriores (ex: OS reaberta e cobrada de novo com outro valor).
      // Antes, o código pegava o primeiro "approved" da lista sem checar se ele pertencia
      // à cobrança atual, então um pagamento antigo (ex: R$ 100 de um teste anterior)
      // podia ser confundido com o pagamento novo (ex: R$ 1 pago agora).
      const cobs = cobrancaSolicitada
        ? [cobrancaSolicitada]
        : cobrancasDaOS.filter(c => c.status === 'aguardando');
      let cobReferencia = null;
      const aprovado = pagamentos.find(p => {
        if (p.status !== 'approved') return false;
        if (cobs.length) {
          const dataPagMs = new Date(p.date_approved || p.date_created).getTime();
          const correspondente = cobs.find(c => {
            const criadoEmCobMs = new Date(c.criadoEm).getTime() - (5 * 60 * 1000);
            return dataPagMs >= criadoEmCobMs
              && Math.abs(Number(p.transaction_amount || 0) - Number(c.valor || 0)) <= 0.01;
          });
          if (!correspondente) return false;
          cobReferencia = correspondente;
        }
        return true;
      });
      const valorEsperadoRaw = cobReferencia?.valor
        ?? os.diagnosticoTecnico?.valorEstimado
        ?? os.valorInvestido
        ?? 0;
      const valorEsperado = parseFloat(valorEsperadoRaw) || 0;
  
      if (!aprovado) {
        const pendente = pagamentos.find(p => p.status === 'pending' || p.status === 'in_process');
        return {
          sucesso: true,
          pago: false,
          cobId: cobrancaSolicitada?.id || '',
          status: pendente ? 'pendente' : 'nenhum',
          mensagem: pendente ? 'Pagamento pendente/em processamento.' : 'Nenhum pagamento aprovado encontrado para a cobrança atual.'
        };
      }
  
      const valorPago = aprovado.transaction_amount;
  
      // Bug fix (autorização indevida): se não há NENHUM valor de referência confiável
      // (nem cobrança registrada nem valorInvestido preenchido), o sistema antes pulava
      // a validação inteira (porque `valorEsperado > 0` era falso) e autorizava qualquer
      // pagamento aprovado encontrado com esse external_reference — mesmo de outro cliente
      // ou de um teste antigo. Agora, sem referência, NÃO autoriza automaticamente:
      // exige confirmação manual explícita do usuário.
      if (valorEsperado <= 0) {
        return {
          sucesso: true,
          pago: false,
          status: 'sem_valor_referencia',
          mensagem: `Pagamento aprovado de R$ ${valorPago.toFixed(2)} encontrado no Mercado Pago, mas a OS ${numero} não tem valor de cobrança registrado para comparar. ` +
                    `Por segurança, a autorização automática foi bloqueada. Confira o pagamento e registre manualmente em Pagamentos.`
        };
      }
  
      if (valorPago < valorEsperado * 0.99) {
        return {
          sucesso: true,
          pago: false,
          status: 'valor_insuficiente',
          mensagem: `Pagamento de R$ ${valorPago.toFixed(2)} inferior ao valor cobrado (R$ ${valorEsperado.toFixed(2)}). Não autorizado.`
        };
      }
      const dataPag = aprovado.date_approved;
      const metodoPag = aprovado.payment_type_id === 'credit_card' ? 'Cartão de crédito'
        : aprovado.payment_type_id === 'debit_card' ? 'Cartão de débito'
        : aprovado.payment_type_id === 'account_money' ? 'Saldo Mercado Pago'
        : aprovado.payment_type_id === 'bank_transfer' ? 'Pix'
        : aprovado.payment_type_id === 'ticket' ? 'Boleto'
        : `Outro (${aprovado.payment_type_id})`;
  
      // Deduplica somente esta confirmação do Mercado Pago. Um pagamento
      // manual anterior ou a entrada de outra etapa não pode bloquear o atual.
      const idMp = String(aprovado.id || '');
      const pagExistente = db.listarPagamentos().find(p =>
        p.osNumero === numero
        && p.origem === 'mercadopago'
        && (
          (idMp && String(p.observacao || '').includes(`ID MP: ${idMp}`))
          || (!idMp && Math.abs(Number(p.valor || 0) - valorPago) < 0.01)
        )
      );
      let pagamentoId = pagExistente?.id || null;
      let jaConfirmado = !!pagExistente;
      if (!pagExistente) {
        const pag = db.registrarPagamento({
          osNumero: numero,
          valor: valorPago,
          metodo: metodoPag,
          origem: 'mercadopago',
          observacao: `ID MP: ${aprovado.id} | Data: ${new Date(dataPag).toLocaleString('pt-BR')}`
        });
        pagamentoId = pag.id;
      }

      if (cobReferencia) {
        db.atualizarStatusCobranca(cobReferencia.id, { status: 'pago', pagamentoId });
        if (['entrada_50', 'integral_100'].includes(String(cobReferencia.tipo || ''))) {
          const alternativas = db.listarCobrancas().filter(outra =>
            outra.id !== cobReferencia.id
            && outra.osNumero === numero
            && outra.status === 'aguardando'
            && ['entrada_50', 'integral_100'].includes(String(outra.tipo || ''))
          );
          for (const alternativa of alternativas) {
            db.atualizarStatusCobranca(alternativa.id, { status: 'cancelado', pagamentoId: null });
          }
        }
      }
  
      // ── Envio automático de WhatsApp + PDF ao confirmar pagamento pelo MP ──────
      // Só dispara na PRIMEIRA confirmação (jaConfirmado = false) para evitar spam.
      let wppEnviado       = false;
      let wppErro          = null;
      let caminhoComprovante = null;
  
      if (!jaConfirmado && pagamentoId) {
        try {
          const config  = db.obterConfig();
          const osFull  = db.obterOSPorNumero(numero);
          const telefone = osFull?.cliente?.telefone || osFull?.telefone || '';
  
          if (!telefone) {
            wppErro = 'Telefone do cliente não encontrado na OS.';
            console.warn('[MP→WhatsApp]', wppErro);
          } else {
            // 1. Gerar PDF do comprovante silenciosamente
            try {
              const resultPdf = await gerarComprovantePagamentoPDF(pagamentoId);
              if (resultPdf?.sucesso && resultPdf?.caminho) {
                caminhoComprovante = resultPdf.caminho;
              }
            } catch (ePdf) {
              console.warn('[MP→WhatsApp] Não foi possível gerar PDF:', ePdf.message);
            }
  
            // 2. Montar e enviar mensagem de texto
            const mensagensWpp = require('../mensagens-whatsapp');
            const osParaMsg = {
              numero      : osFull.numero,
              nome_cliente: osFull.cliente?.nome || osFull.nomeCliente || '',
              marca       : osFull.aparelho?.marca  || '',
              modelo      : osFull.aparelho?.modelo || '',
              exigir_entrada_50: osFull.exigirEntrada50Aprovacao === true,
              valor_entrada: Number(osFull.valorEntradaAprovacao || valorPago || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              valor_restante: Number(osFull.valorRestanteServico || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            };
            const msg        = mensagensWpp.montarPagamentoConfirmado(osParaMsg, config);
            const codigoPais = (config.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55';
            const envioMsg   = await whatsapp.enviarMensagem(telefone, msg, codigoPais);
  
            if (envioMsg.sucesso) {
              wppEnviado = true;
  
              // 3. Enviar PDF como documento separado, se gerado
              if (caminhoComprovante) {
                const nomeArq = `Comprovante-Pagamento-OS-${numero}.pdf`;
                const envioDoc = await whatsapp.enviarDocumento(telefone, caminhoComprovante, nomeArq, codigoPais);
                if (!envioDoc.sucesso) {
                  console.warn('[MP→WhatsApp] PDF enviado parcialmente (documento falhou):', envioDoc.erro);
                }
              }
  
              // 4. Registrar log no banco
              try {
                db.registrarLogMensagem({
                  tipo       : 'pagamento_confirmado',
                  osNumero   : numero,
                  clienteNome: osParaMsg.nome_cliente,
                  telefone,
                  mensagem   : msg,
                  sucesso    : true,
                  erro       : null,
                });
              } catch (eLog) { console.warn('[MP→WhatsApp] Erro ao salvar log:', eLog.message); }
  
            } else {
              wppErro = envioMsg.erro || 'Falha no envio';
              console.warn('[MP→WhatsApp] Mensagem não enviada:', wppErro);
            }
          }
        } catch (eWpp) {
          wppErro = eWpp.message;
          console.error('[MP→WhatsApp] Erro inesperado:', eWpp.message);
        }
      }
      // ── fim do bloco de envio automático ─────────────────────────────────────
  
      return {
        sucesso: true,
        pago: true,
        cobId: cobReferencia?.id || cobrancaSolicitada?.id || '',
        pagamentoId,          // para o renderer linkar na cobrança via cobrancaatualizar
        jaConfirmado,         // sinaliza dedup: true = WhatsApp já foi enviado antes
        valorPago,
        metodoPag,
        dataPag,
        wppEnviado,
        wppErro,
        mensagem: jaConfirmado
          ? `Pagamento de R$ ${valorPago.toFixed(2)} já registrado. OS Autorizada.`
          : `Pagamento de R$ ${valorPago.toFixed(2)} confirmado! OS marcada como Autorizada.`
      };
  
    } catch(e) {
      return { sucesso: false, erro: e.message };
    }
  });
  
  // ── v36: Painel Financeiro (Mercado Pago) — Prompt 3B ──────────────────────
  //
  // Combina dois tipos de dado, de propósitos diferentes — não misturar:
  //   1. Dados REAIS vindos agora da API do Mercado Pago (GET /v1/payments/search
  //      filtrado por período): valor recebido no período, qtd aprovados,
  //      ticket médio, total de transações. Isso É o que a API confirma agora.
  //   2. Saldo ESTIMADO calculado por dentro do próprio sistema, a partir de
  //      db.obterSaldoEstimado() — NÃO vem da API do MP (que não oferece mais
  //      um endpoint de saldo simples desde 2022, ver RESULTADO-PROMPT-3A.md).
  //
  // Requisito de isolamento: se a API do MP falhar (token inválido, rede fora,
  // timeout), a parte 1 vem com erro mas a parte 2 (saldo estimado, que não
  // depende da API) continua funcionando normalmente — por isso são calculadas
  // em blocos try/catch separados, não uma dependendo da outra.
  ipcMain.handle('mp:obterPainelFinanceiro', async (_e, periodo) => {
    const resultado = {
      sucesso: true,
      atualizadoEm: new Date().toISOString(),
      api: null,       // dados vindos da API do MP no período (ou erro)
      saldoEstimado: null, // sempre calculado localmente, independente da API
      grafico: []       // recebimento por dia, dentro do período
    };
  
    // ── Parte 1: dados reais da API do Mercado Pago ──────────────────────────
    try {
      const cfg = db.loadDB().config;
      const token = cfg.mercadoPagoToken || '';
  
      if (!token) {
        resultado.api = {
          sucesso: false,
          erro: 'token_ausente',
          mensagem: 'Configure o token do Mercado Pago em Configurações > Integrações — Mercado Pago para ver os dados de recebimento em tempo real.'
        };
      } else {
        const https = require('https');
        const hoje = new Date();
        const inicio = periodo?.dataInicio ? new Date(periodo.dataInicio) : new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        const fim    = periodo?.dataFim    ? new Date(periodo.dataFim)    : hoje;
  
        const fmtISO = (d, horaFinal) => {
          const pad = n => String(n).padStart(2, '0');
          const dataStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
          return horaFinal ? `${dataStr}T23:59:59.000-03:00` : `${dataStr}T00:00:00.000-03:00`;
        };
  
        // Busca paginada — /v1/payments/search limita por página (usamos 50,
        // suficiente pra um negócio pequeno/médio; se algum mês vier com mais
        // transações que isso, os agregados abaixo ficam subestimados e vale
        // aumentar o limit ou paginar de verdade no futuro).
        const dadosMP = await new Promise((resolve, reject) => {
          const qpath = `/v1/payments/search?sort=date_created&criteria=desc&range=date_created` +
                        `&begin_date=${encodeURIComponent(fmtISO(inicio, false))}` +
                        `&end_date=${encodeURIComponent(fmtISO(fim, true))}&limit=50`;
          const req = https.request({
            hostname: 'api.mercadopago.com',
            path: qpath,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
          }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              resolve({ status: res.statusCode, body: data });
            });
          });
          req.on('error', err => reject(err));
          req.setTimeout(15000, () => req.destroy(new Error('Tempo esgotado ao consultar Mercado Pago.')));
          req.end();
        });
  
        if (dadosMP.status === 401 || dadosMP.status === 403) {
          resultado.api = {
            sucesso: false,
            erro: 'token_invalido',
            mensagem: 'O token do Mercado Pago configurado não tem permissão para consultar pagamentos. Verifique o token em Configurações > Integrações.'
          };
        } else if (dadosMP.status !== 200) {
          resultado.api = {
            sucesso: false,
            erro: 'api_indisponivel',
            mensagem: `O Mercado Pago retornou um erro inesperado (HTTP ${dadosMP.status}). Tente novamente em instantes.`
          };
        } else {
          let json;
          try { json = JSON.parse(dadosMP.body); }
          catch (eParse) {
            resultado.api = { sucesso: false, erro: 'resposta_invalida', mensagem: 'Resposta inesperada do Mercado Pago.' };
            json = null;
          }
  
          if (json) {
            const pagamentos = json.results || [];
            const aprovados = pagamentos.filter(p => p.status === 'approved');
            const totalRecebidoPeriodo = aprovados.reduce((soma, p) => soma + (p.transaction_amount || 0), 0);
            const qtdAprovados = aprovados.length;
            const ticketMedio = qtdAprovados > 0 ? totalRecebidoPeriodo / qtdAprovados : 0;
  
            // Recebimento por dia, para o gráfico
            const porDia = {};
            aprovados.forEach(p => {
              const dia = (p.date_approved || p.date_created || '').slice(0, 10);
              if (!dia) return;
              porDia[dia] = (porDia[dia] || 0) + (p.transaction_amount || 0);
            });
            resultado.grafico = Object.keys(porDia).sort().map(dia => ({ dia, valor: porDia[dia] }));
  
            resultado.api = {
              sucesso: true,
              totalRecebidoPeriodo,
              qtdAprovados,
              ticketMedio,
              totalTransacoes: pagamentos.length
            };
          }
        }
      }
    } catch (eApi) {
      resultado.api = {
        sucesso: false,
        erro: 'excecao',
        mensagem: 'Não foi possível consultar o Mercado Pago agora: ' + eApi.message
      };
    }
  
    // ── Parte 2: saldo estimado, calculado localmente (não depende da API) ──
    try {
      resultado.saldoEstimado = db.obterSaldoEstimado();
    } catch (eSaldo) {
      // Isolamento: mesmo se isso falhar por algum motivo, não derruba o
      // painel inteiro — a parte 1 (API) pode ter funcionado normalmente.
      resultado.saldoEstimado = { erro: eSaldo.message };
    }
  
    return resultado;
  });
  
  // ── v20: IPCs de Pagamentos ────────────────────────────────────
  ipcMain.handle('pag:registrar', (_e, dados) => {
    const pag = db.registrarPagamento(dados);
    backup.agendarBackupEmBreve('pag:registrar');
    return pag;
  });
  ipcMain.handle('pag:listar',     ()            => db.listarPagamentos());
  ipcMain.handle('pag:buscar',     (_e, q)       => db.buscarPagamentos(q));
  ipcMain.handle('pag:obter',      (_e, id)      => db.obterPagamento(id));
  
  // Exclui um pagamento (reverte statusPagamento/pagamentoId/formaPagamento da
  // OS vinculada) e remove o arquivo físico do comprovante do disco, se houver.
  ipcMain.handle('pag:excluir', (_e, pagamentoId) => {
    try {
      const resultado = db.excluirPagamento(pagamentoId);
      if (resultado.caminhoComprovante) {
        const fs = require('fs');
        try {
          if (fs.existsSync(resultado.caminhoComprovante)) {
            fs.unlinkSync(resultado.caminhoComprovante);
          }
        } catch (eArquivo) {
          // Não falha a operação por causa disso — o registro já foi excluído
          // do banco, que é o que importa para o fluxo de trabalho. O arquivo
          // órfão no disco é um problema secundário, não crítico.
          console.error('[pag:excluir] Falha ao remover arquivo físico do comprovante:', eArquivo.message);
        }
      }
      backup.agendarBackupEmBreve('pag:excluir');
      return { sucesso: true };
    } catch (e) {
      return { sucesso: false, erro: e.message };
    }
  });
  
  // ── Fase 6: Confirmação manual de pagamento presencial ─────────────────────
  //
  // Handler do botão "Confirmar Pagamento Presencial" (tela de edição da OS),
  // visível apenas quando statusPagamento === 'Aguardando Pagamento na Retirada'
  // (Fase 5: cliente já respondeu pelo WhatsApp qual seria a forma de pagamento,
  // mas ninguém confirmou ainda que o dinheiro foi de fato recebido).
  //
  // db.confirmarPagamentoPresencial já valida o status da OS e delega para
  // registrarPagamento (mesma trilha de auditoria/histórico de qualquer outro
  // pagamento) — aqui só tratamos o envio opcional da mensagem de confirmação
  // pelo WhatsApp, sem PDF de comprovante (foi um pagamento manual, sem
  // registro automático de transação para gerar um comprovante a partir dele).
  ipcMain.handle('os:confirmarPagamentoPresencial', async (_e, dados) => {
    try {
      const { osNumero, valor, metodo, observacao, enviarWhatsapp } = dados || {};
      if (!osNumero) return { sucesso: false, erro: 'Número da OS não informado.' };
  
      const pagamento = db.confirmarPagamentoPresencial(osNumero, { valor, metodo, observacao });
      backup.agendarBackupEmBreve('os:confirmarPagamentoPresencial');
      const osAposPagamento = db.obterOSPorNumero(osNumero);
      const pagamentoParcial = osAposPagamento?.entrada50Paga === true
        && Number(osAposPagamento?.percentualPagamentoConfirmado || 0) === 50;

      // Gera o comprovante em segundo plano, mas não o envia. A primeira
      // parcela fica identificada como 50%; ao receber o saldo, o novo
      // comprovante representa a quitação acumulada de 100%.
      let comprovante = null;
      try {
        comprovante = await gerarComprovantePagamentoPDF(pagamento.id);
      } catch (erroComprovante) {
        comprovante = { sucesso: false, erro: erroComprovante.message };
        console.warn('[PagamentoPresencial] Pagamento salvo, mas o comprovante não foi gerado:', erroComprovante.message);
      }
  
      let wppEnviado = false;
      let wppErro    = null;
  
      // Confirmação manual é silenciosa por padrão. Só envia mensagem se uma
      // tela futura solicitar isso explicitamente com enviarWhatsapp: true.
      // desfaz o pagamento já confirmado se falhar — o pagamento em si já
      // está gravado e é o que importa para o fluxo de trabalho.
      if (enviarWhatsapp === true) {
        try {
          const os = db.obterOSPorNumero(osNumero);
          const telefone = os?.cliente?.telefone || os?.telefone || '';
  
          if (!telefone) {
            wppErro = 'Telefone do cliente não encontrado na OS.';
          } else {
            const config = db.obterConfig();
            const mensagensWpp = require('../mensagens-whatsapp');
            const osParaMsg = {
              numero      : os.numero,
              nome_cliente: os.cliente?.nome || os.nomeCliente || '',
              marca       : os.aparelho?.marca  || '',
              modelo      : os.aparelho?.modelo || '',
            };
            // semComprovante: true — pagamento manual presencial, sem PDF de
            // comprovante gerado a partir de uma transação automática.
            const msg = mensagensWpp.montarPagamentoConfirmado(osParaMsg, config, { semComprovante: true });
            const codigoPais = (config.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55';
            const envioMsg = await whatsapp.enviarMensagem(telefone, msg, codigoPais);
  
            if (envioMsg.sucesso) {
              wppEnviado = true;
              try {
                db.registrarLogMensagem({
                  tipo       : 'pagamento_confirmado',
                  osNumero,
                  clienteNome: osParaMsg.nome_cliente,
                  telefone,
                  mensagem   : msg,
                  sucesso    : true,
                  erro       : null,
                });
              } catch (eLog) { console.warn('[PagamentoPresencial→WhatsApp] Erro ao salvar log:', eLog.message); }
            } else {
              wppErro = envioMsg.erro || 'Falha no envio';
            }
          }
        } catch (eWpp) {
          wppErro = eWpp.message;
          console.warn('[PagamentoPresencial→WhatsApp] Erro inesperado:', eWpp.message);
        }
      }
  
      return {
        sucesso: true,
        pagamento,
        pagamentoParcial,
        percentualConfirmado: pagamentoParcial ? 50 : 100,
        valorRestante: Number(osAposPagamento?.valorRestanteServico || 0),
        comprovanteGerado: comprovante?.sucesso === true,
        caminhoComprovante: comprovante?.sucesso ? comprovante.caminho : '',
        avisoComprovante: comprovante?.sucesso ? '' : (comprovante?.erro || 'Não foi possível gerar o comprovante agora.'),
        wppEnviado,
        wppErro,
        mensagem: pagamentoParcial
          ? `Entrada de 50% (R$ ${pagamento.valor.toFixed(2)}) confirmada. Reparo autorizado; saldo de R$ ${Number(osAposPagamento?.valorRestanteServico || 0).toFixed(2)} para a retirada.`
          : `Pagamento integral de R$ ${pagamento.valor.toFixed(2)} confirmado. Serviço quitado e reparo autorizado.`
      };
    } catch (e) {
      return { sucesso: false, erro: e.message };
    }
  });
  
  // ── v36: Reembolsos — registro manual vinculado a um pagamento (Prompt 3B) ──
  ipcMain.handle('reembolso:registrar', (_e, dados) => {
    try {
      const r = db.registrarReembolso(dados);
      backup.agendarBackupEmBreve('reembolso:registrar');
      return { sucesso: true, reembolso: r };
    } catch (e) {
      return { sucesso: false, erro: e.message };
    }
  });
  ipcMain.handle('reembolso:listar', () => db.listarReembolsos());
  ipcMain.handle('reembolso:listarPorPagamento', (_e, pagamentoId) => db.listarReembolsosPorPagamento(pagamentoId));
  
  // Anexar comprovante (imagem ou PDF) — dialog de seleção de arquivo
  ipcMain.handle('pag:anexarComprovante', async (_e, pagamentoId) => {
    const { dialog } = require('electron');
    const resultado = await dialog.showOpenDialog({
      title: 'Selecionar comprovante de pagamento',
      filters: [
        { name: 'Imagens e PDF', extensions: ['jpg','jpeg','png','pdf','webp'] }
      ],
      properties: ['openFile']
    });
    if (resultado.canceled || !resultado.filePaths.length) return { cancelado: true };
    const caminho = resultado.filePaths[0];
    const pag = db.anexarComprovante(pagamentoId, caminho);
    return { sucesso: true, caminho, pagamento: pag };
  });
  
  // Abrir comprovante no visualizador padrão do sistema
  ipcMain.handle('pag:abrirComprovante', async (_e, caminho) => {
    if (!caminho) return { sucesso: false, erro: 'Sem comprovante.' };
    if (!caminhoDentroDe(caminho, db.getRootDir(), ['.pdf', '.png', '.jpg', '.jpeg', '.webp'])) return { sucesso: false, erro: 'Caminho ou tipo do comprovante inválido.' };
    const fs = require('fs');
    if (!fs.existsSync(caminho)) {
      return { sucesso: false, erro: 'Arquivo do comprovante não foi encontrado no disco (pode ter sido movido ou apagado).' };
    }
    const { shell } = require('electron');
    // shell.openPath retorna '' em sucesso, ou uma string de erro em falha —
    // ignorar esse retorno faz o handler mentir "sucesso: true" mesmo quando
    // o sistema operacional não conseguiu abrir o arquivo (ex: sem app
    // associado, permissão negada), fazendo o clique "não fazer nada".
    const erroSistema = await shell.openPath(caminho);
    if (erroSistema) {
      return { sucesso: false, erro: 'Não foi possível abrir o comprovante: ' + erroSistema };
    }
    return { sucesso: true };
  });
  
  // Retorna os dados do pagamento + comprovante em base64 para exibição inline na OS
  ipcMain.handle('pag:obterComprovanteDaOS', async (_e, osNumero) => {
    try {
      const pag = db.obterPagamentoPorOS(osNumero);
      if (!pag) return { sucesso: false, erro: 'Nenhum pagamento registrado para esta OS.' };
      const resultado = {
        sucesso: true,
        pagamento: {
          id: pag.id,
          valor: pag.valor,
          metodo: pag.metodo,
          dataPagamento: pag.dataPagamento,
          percentualQuitado: Number(pag.percentualQuitado) || 100,
          tipoComprovante: pag.tipoComprovante || 'quitacao_100',
          valorTotalServico: Number(pag.valorTotalServico) || Number(pag.valor) || 0,
          valorAcumulado: Number(pag.valorAcumulado) || Number(pag.valor) || 0,
          valorRestanteAposPagamento: Number(pag.valorRestanteAposPagamento) || 0,
          caminhoComprovante: pag.caminhoComprovante || null,
        },
        base64: null,
        mimeType: null,
      };
      if (pag.caminhoComprovante) {
        const fs   = require('fs');
        const path = require('path');
        if (fs.existsSync(pag.caminhoComprovante)) {
          const ext = path.extname(pag.caminhoComprovante).toLowerCase();
          const mimeMap = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
          resultado.mimeType = mimeMap[ext] || 'application/octet-stream';
          resultado.base64   = fs.readFileSync(pag.caminhoComprovante).toString('base64');
        } else {
          resultado.avisoArquivo = 'Arquivo do comprovante não encontrado no disco.';
        }
      }
      return resultado;
    } catch (err) {
      return { sucesso: false, erro: err.message };
    }
  });
  
  // Gera o PDF do comprovante de pagamento em disco (sem abrir o arquivo).
  // Reutilizada pelo handler manual (botão "PDF") e pelo fluxo automático
  // de confirmação de pagamento (para anexar no WhatsApp).
  async function gerarComprovantePagamentoPDF(pagamentoId) {
    const pag = db.obterPagamento(pagamentoId);
    if (!pag) return { sucesso: false, erro: 'Pagamento não encontrado.' };
    const config = db.obterConfig();
  
    const path = require('path');
    const fs   = require('fs');
    const osm  = require('os');
    const crypto = require('crypto');
    const { BrowserWindow } = require('electron');
  
    const empresa  = config.nomeEmpresa || config.nomeFantasia || 'Assistência Técnica';
    const end      = [config.endereco, config.numero, config.bairro, config.cidade, config.estado].filter(Boolean).join(', ');
    const dataPag  = new Date(pag.dataPagamento).toLocaleString('pt-BR');
    const geradoEm = new Date().toLocaleString('pt-BR');
    const osPagamento = db.obterOSPorNumero(pag.osNumero) || {};
    const pagamentosOS = (db.listarPagamentos ? db.listarPagamentos() : [])
      .filter(item => item.osNumero === pag.osNumero)
      .sort((a, b) => new Date(a.dataPagamento || a.criadoEm || 0) - new Date(b.dataPagamento || b.criadoEm || 0));
    const indiceAtual = pagamentosOS.findIndex(item => item.id === pag.id);
    const pagamentosAteAtual = indiceAtual >= 0 ? pagamentosOS.slice(0, indiceAtual + 1) : [pag];
    const valorAcumuladoCalculado = pagamentosAteAtual.reduce((soma, item) => soma + (Number(item.valor) || 0), 0);
    const valorTotalServico = Number(pag.valorTotalServico)
      || Number(osPagamento.valorTotalServico)
      || Number(osPagamento.diagnosticoTecnico?.valorEstimado)
      || Number(pag.valor) || 0;
    const valorAcumulado = Number(pag.valorAcumulado) || valorAcumuladoCalculado;
    const percentualCalculado = valorTotalServico > 0 ? (valorAcumulado / valorTotalServico) * 100 : 100;
    const percentualQuitado = Number(pag.percentualQuitado)
      || (percentualCalculado >= 99.5 ? 100 : percentualCalculado >= 49.5 ? 50 : Math.max(1, Math.round(percentualCalculado)));
    const quitado = percentualQuitado >= 100;
    const valorExibido = quitado ? Math.max(valorAcumulado, valorTotalServico) : Number(pag.valor);
    const valorRestante = quitado ? 0 : Math.max(0,
      Number(pag.valorRestanteAposPagamento) || valorTotalServico - valorAcumulado);
    const valorFmt = 'R$&nbsp;' + valorExibido.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const valorParcelaFmt = 'R$ ' + Number(pag.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const valorTotalFmt = 'R$ ' + valorTotalServico.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const valorRestanteFmt = 'R$ ' + valorRestante.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const tituloComprovante = quitado ? 'Comprovante de Quitação — 100%' : `Comprovante de Entrada — ${percentualQuitado}%`;
    const rotuloValor = quitado ? 'Total Quitado (100%)' : `Valor Pago (${percentualQuitado}%)`;
    const statusComprovante = quitado ? 'Serviço 100% Quitado' : `Entrada de ${percentualQuitado}% Confirmada`;
    const marcaDagua = quitado ? 'QUITADO' : `${percentualQuitado}% PAGO`;
    const origemLabel = pag.origem === 'mercadopago' ? 'Mercado Pago' : pag.origem === 'pix' ? 'Pix' : 'Manual';
  
    const linha = (label, val) => val
      ? `<tr><td class="label">${label}</td><td class="val">${val}</td></tr>` : '';
  
    const html = `<!DOCTYPE html>
  <html lang="pt-BR">
  <head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { background:#fff; font-family:'Inter', Arial, Helvetica, sans-serif; font-size:10pt; color:#1a1a1a; }
    body { padding:40px 52px 44px; }
  
    /* ── Cabeçalho ── */
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0; }
    .empresa-nome { font-size:17pt; font-weight:800; color:#111; letter-spacing:-.3px; line-height:1.1; }
    .empresa-info { font-size:8pt; color:#6b7280; margin-top:5px; line-height:1.7; }
    .header-right { text-align:right; }
    .os-badge { display:inline-block; background:#1e3a5f; color:#fff; font-size:8pt; font-weight:700; text-transform:uppercase; letter-spacing:.8px; padding:3px 10px; border-radius:3px; margin-bottom:4px; }
    .os-num { font-size:20pt; font-weight:800; color:#1e3a5f; letter-spacing:-1px; line-height:1; }
  
    /* ── Faixa título ── */
    .faixa-titulo { margin:18px 0 20px; border-top:2px solid #1e3a5f; border-bottom:1px solid #d1d5db; padding:8px 0; display:flex; justify-content:space-between; align-items:center; }
    .faixa-titulo .titulo-texto { font-size:11.5pt; font-weight:700; color:#1e3a5f; text-transform:uppercase; letter-spacing:1.5px; }
    .faixa-titulo .titulo-data { font-size:8pt; color:#6b7280; }
  
    /* ── Seções ── */
    .secao-titulo { font-size:7.5pt; font-weight:700; text-transform:uppercase; letter-spacing:1.2px; color:#6b7280; margin:18px 0 8px; padding-bottom:5px; border-bottom:1px solid #e5e7eb; }
  
    /* ── Tabela de dados ── */
    table.dados { width:100%; border-collapse:collapse; }
    table.dados tr { border-bottom:1px solid #f3f4f6; }
    table.dados tr:last-child { border-bottom:none; }
    table.dados td { padding:6px 4px; vertical-align:top; line-height:1.45; }
    td.label { width:34%; font-size:8.5pt; font-weight:600; color:#374151; white-space:nowrap; padding-right:12px; }
    td.val { font-size:9.5pt; color:#111; }
  
    /* ── Bloco valor + método ── */
    .bloco-financeiro { display:flex; gap:12px; margin:20px 0 16px; align-items:stretch; }
    .valor-principal { flex:1; background:#1e3a5f; border-radius:6px; padding:16px 22px 14px; }
    .valor-principal .vp-label { font-size:8pt; font-weight:600; color:#93c5fd; text-transform:uppercase; letter-spacing:.5px; margin-bottom:6px; }
    .valor-principal .vp-valor { font-size:28pt; font-weight:800; color:#fff; letter-spacing:-1.5px; line-height:1; }
    .valor-principal .vp-extenso { font-size:8pt; color:#93c5fd; margin-top:6px; }
    .metodo-card { background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:6px; padding:14px 18px; display:flex; flex-direction:column; justify-content:center; align-items:center; min-width:140px; gap:5px; }
    .metodo-card .mc-label { font-size:7.5pt; font-weight:600; color:#9ca3af; text-transform:uppercase; letter-spacing:.5px; }
    .metodo-card .mc-valor { font-size:13pt; font-weight:700; color:#1e3a5f; }
  
    /* ── Status confirmado ── */
    .status-confirmado { display:flex; align-items:center; gap:10px; background:#f0fdf4; border:1.5px solid #86efac; border-radius:5px; padding:10px 16px; margin-bottom:20px; }
    .status-confirmado .sc-icone { width:20px; height:20px; background:#16a34a; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .status-confirmado .sc-icone::after { content:'✓'; color:#fff; font-size:11pt; font-weight:800; line-height:1; }
    .status-confirmado .sc-texto { font-size:10pt; font-weight:700; color:#15803d; text-transform:uppercase; letter-spacing:.5px; }
  
    /* ── Rodapé ── */
    .rodape { border-top:1px solid #e5e7eb; padding-top:10px; margin-top:22px; display:flex; justify-content:space-between; align-items:flex-end; }
    .rodape-info { font-size:7.5pt; color:#9ca3af; line-height:1.65; }
    .rodape-id { font-family:'Courier New', monospace; font-size:7pt; color:#d1d5db; text-align:right; }
  
    /* ── Marca d'água "PAGO" ── */
    .marca-dagua { position:fixed; bottom:120px; right:52px; font-size:52pt; font-weight:900; color:rgba(22,163,74,.06); text-transform:uppercase; letter-spacing:4px; transform:rotate(-18deg); pointer-events:none; user-select:none; }
  </style>
  </head>
  <body>
  
    <div class="marca-dagua">${marcaDagua}</div>
  
    <!-- Cabeçalho -->
    <div class="header">
      <div>
        <div class="empresa-nome">${empresa}</div>
        <div class="empresa-info">${[config.cnpj && config.possuiCnpj && config.exibirCnpjDocumentos !== false ? 'CNPJ: ' + config.cnpj : '', config.telefonePrincipal ? 'Tel.: ' + config.telefonePrincipal : '', end].filter(Boolean).join('&nbsp;&nbsp;|&nbsp;&nbsp;')}</div>
      </div>
      <div class="header-right">
        <div class="os-badge">Ordem de Serviço</div>
        <div class="os-num">${pag.osNumero}</div>
      </div>
    </div>
  
    <!-- Faixa título -->
    <div class="faixa-titulo">
      <span class="titulo-texto">${tituloComprovante}</span>
      <span class="titulo-data">Emitido em: ${geradoEm}</span>
    </div>
  
    <!-- Dados do cliente -->
    <div class="secao-titulo">Identificação do Cliente</div>
    <table class="dados">
      ${linha('Nome', pag.clienteNome)}
      ${pag.clienteCpf ? linha('CPF', pag.clienteCpf) : ''}
      ${pag.clienteTel ? linha('Telefone', pag.clienteTel) : ''}
      ${linha('Aparelho / Serviço', pag.aparelho)}
    </table>
  
    <!-- Dados do pagamento -->
    <div class="secao-titulo">Informações do Pagamento</div>
    <table class="dados">
      ${linha('Data e Hora', dataPag)}
      ${linha('Canal de Recebimento', origemLabel)}
      ${linha('Percentual quitado', percentualQuitado + '%')}
      ${linha('Valor total do serviço', valorTotalFmt)}
      ${quitado && pagamentosAteAtual.length > 1 ? linha('Última parcela recebida', valorParcelaFmt) : ''}
      ${!quitado ? linha('Saldo restante', valorRestanteFmt) : ''}
      ${pag.observacao ? linha('Observações', pag.observacao) : ''}
    </table>
  
    <!-- Bloco financeiro -->
    <div class="bloco-financeiro">
      <div class="valor-principal">
        <div class="vp-label">${rotuloValor}</div>
        <div class="vp-valor">${valorFmt}</div>
      </div>
      <div class="metodo-card">
        <span class="mc-label">Forma de Pagamento</span>
        <span class="mc-valor">${pag.metodo}</span>
      </div>
    </div>
  
    <!-- Status -->
    <div class="status-confirmado">
      <div class="sc-icone"></div>
      <span class="sc-texto">${statusComprovante}</span>
    </div>
  
    <!-- Rodapé -->
    <div class="rodape">
      <div class="rodape-info">
        ${empresa} &nbsp;·&nbsp; ${end || 'Brasil'}<br>
        Documento gerado em ${geradoEm}. Válido como registro interno de pagamento.
      </div>
      <div class="rodape-id">PAG-${pag.id}</div>
    </div>
  
  </body>
  </html>`;
  
    const tmpPath = path.join(osm.tmpdir(), `comprovante-${crypto.randomUUID()}.html`);
    fs.writeFileSync(tmpPath, html, 'utf-8');
  
    const janela = new BrowserWindow({ show: false, width: 794, height: 1123,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    let buffer;
    try {
      await janela.loadFile(tmpPath);
      buffer = await janela.webContents.printToPDF({
        printBackground: true, landscape: false, pageSize: 'A4',
        margins: { marginType: 'printableArea' }
      });
    } finally {
      janela.destroy();
      fs.unlink(tmpPath, () => {});
    }
  
    // Mantenha o comprovante dentro da pasta da empresa ativa. Esse local
    // participa do backup e é aceito pelo validador seguro de abertura.
    const dir = path.join(db.getRootDir(), 'Comprovantes');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const arquivo = path.join(dir, `${pag.id}.pdf`);
    fs.writeFileSync(arquivo, buffer);
  
    db.anexarComprovante(pagamentoId, arquivo);
    return { sucesso: true, caminho: arquivo };
  }
  
  // Gerar comprovante PDF interno via HTML → printToPDF (sem dependências externas)
  // Uso manual (botão "🖨️ PDF" na tela de pagamentos): gera e abre o arquivo.
  ipcMain.handle('pag:gerarComprovantePDF', async (_e, pagamentoId) => {
    const resultado = await gerarComprovantePagamentoPDF(pagamentoId);
    if (resultado.sucesso) await shell.openPath(resultado.caminho);
    return resultado;
  });
  
  // Uso automático (confirmação de pagamento): gera o PDF sem abrir,
  // para ser anexado à mensagem de WhatsApp de confirmação.
  ipcMain.handle('pag:gerarComprovantePDFSilencioso', async (_e, pagamentoId) => {
    return gerarComprovantePagamentoPDF(pagamentoId);
  });
  
  // ══════════════════════════════════════════════════════════════
  // v24 — COBRANÇAS (pendentes Aguardando/Pago)
  // ══════════════════════════════════════════════════════════════
  
  ipcMain.handle('cobranca:registrar', (_e, dados) => {
    const cob = db.registrarCobranca(dados);
    backup.agendarBackupEmBreve('cobranca:registrar');
    return cob;
  });
  
  ipcMain.handle('cobranca:listar', () => {
    return db.listarCobrancas();
  });
  
  ipcMain.handle('cobranca:buscar', (_e, q) => {
    return db.buscarCobrancas(q);
  });
  
  ipcMain.handle('cobranca:atualizar', (_e, id, dados) => {
    const cob = db.atualizarStatusCobranca(id, dados);
    backup.agendarBackupEmBreve('cobranca:atualizar');
    return cob;
  });
  
  // ══════════════════════════════════════════════════════════════
  // LOG DE MENSAGENS WHATSAPP — handlers IPC
  // ══════════════════════════════════════════════════════════════
  
  ipcMain.handle('wapplog:registrar', (_e, dados) => {
    return db.registrarLogMensagem(dados);
  });
  
  ipcMain.handle('wapplog:listar', () => {
    return db.listarLogMensagens();
  });
  
  ipcMain.handle('wapplog:buscar', (_e, query) => {
    return db.buscarLogMensagens(query);
  });
  
  ipcMain.handle('wapplog:porCliente', (_e, query) => {
    return db.listarLogMensagensPorCliente(query);
  });
  
  // Atualiza o nome do cliente por telefone — usado pelo lápis de editar nome
  // tanto na aba Mensagens quanto na aba Conversas. Atualiza em todos os
  // lugares (log de mensagens + OS) para as duas telas ficarem consistentes.
  ipcMain.handle('wapplog:atualizarNomeCliente', (_e, telefone, novoNome) => {
    return db.atualizarNomeClientePorTelefone(telefone, novoNome);
  });
  
  // Exclui uma mensagem individual do histórico (botão "Excluir" dentro da
  // conversa). Só remove o registro do log — não mexe na OS nem em nada mais.
  ipcMain.handle('wapplog:excluirMensagem', (_e, id, usuarioId) => {
    const resultado = db.excluirLogMensagem(id);
    auditoria.registrar('wapplog:excluirMensagem', { id, sucesso: resultado.sucesso }, usuarioId);
    return resultado;
  });
  
  // Exclui todas as mensagens de um contato (por telefone) — botão "Excluir"
  // na lista lateral da aba Mensagens WhatsApp.
  ipcMain.handle('wapplog:excluirPorTelefone', (_e, telefone, usuarioId) => {
    const resultado = db.excluirMensagensPorTelefone(telefone);
    auditoria.registrar('wapplog:excluirPorTelefone', { telefone, sucesso: resultado.sucesso, excluidas: resultado.excluidas }, usuarioId);
    return resultado;
  });
  
  // ══════════════════════════════════════════════════════════════
  // v40.2 — LOG DE IA (Groq) — handlers IPC
  // Apenas expõe funções já existentes em db.js (mesmo padrão do bloco
  // wapplog acima) — nenhuma lógica de negócio nova é criada aqui.
  // ══════════════════════════════════════════════════════════════
  
  ipcMain.handle('ialog:listar', () => {
    return db.listarLogIA();
  });
  
  ipcMain.handle('ialog:buscar', (_e, query) => {
    return db.buscarLogIA(query);
  });
  
  ipcMain.handle('ialog:contadores', () => {
    return db.contadoresLogIA();
  });
  
  // Testa a chave da Groq em tempo real, antes mesmo de salvar nas configurações
  // (o usuário cola a chave, clica em "Testar Conexão", e recebe feedback na hora
  // — sem isso, só descobriria se a chave está errada quando um cliente real
  // respondesse no WhatsApp, o que é tarde demais).
  ipcMain.handle('ia:testarConexao', (_e, apiKeyForcada, tipo, provedor, modelo) => {
    if (tipo !== 'chat' || !provedor || provedor === 'groq') return iaGroq.testarConexao(apiKeyForcada, tipo);
    return require('../ia-provider').testarConexao(db.loadDB().config || {}, { provedor, apiKey: apiKeyForcada, model: modelo });
  });
  
  // ══════════════════════════════════════════════════════════════
  // v41 — CHATBOT FLUTUANTE (Groq) — handler IPC
  // Reaproveita src/ia-chat.js, que por sua vez reaproveita a chamada à Groq
  // já existente em src/ia-groq.js e as funções de leitura de dados já
  // existentes em src/db.js. Nenhuma lógica de negócio nova é criada aqui.
  // `historico` é opcional: array [{role:'user'|'assistant', content}] dos
  // turnos anteriores da mesma conversa, pra manter contexto entre perguntas.
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('ia:perguntar', (_e, pergunta, historico) => {
    return iaChat.responderPergunta(
      pergunta,
      historico,
      getUsuarioAutenticado?.(),
      (mensagens, opcoes) => supabaseDesktop.chamarIAEmpresa(mensagens, opcoes)
    );
  });
  
  // ══════════════════════════════════════════════════════════════
  // v42 — CHATBOT: EXECUÇÃO DE AÇÕES SOBRE OS (criar/alterar status/excluir/
  // enviar mensagem WhatsApp)
  //
  // A IA (src/ia-chat.js) NUNCA chama isto sozinha — ela só devolve uma
  // PROPOSTA de ação (acaoProposta) na resposta de ia:perguntar. O renderer
  // sempre exige um clique explícito de confirmação do usuário antes de
  // invocar este canal. Aqui, no processo principal (nunca no renderer):
  //   1) Para 'excluir_os', a senha de exclusão já configurada é validada de
  //      novo (db.verificarSenhaExclusao) — mesma trava usada em
  //      sistema:zerar — mesmo que o renderer já tenha validado antes, para
  //      nunca depender só do lado do cliente.
  //   2) A ação em si roda via iaChat.executarAcao, que só chama as mesmas
  //      funções de db.js (criarOS/atualizarOS/excluirOS) usadas pelos
  //      formulários manuais, ou src/whatsapp.js (enviarMensagem) para
  //      'enviar_mensagem_whatsapp' — nenhuma regra de negócio nova.
  //   3) PDF/backup são gerados do mesmo jeito que os fluxos manuais de
  //      criar/atualizar OS já fazem (main.js os:criar / os:atualizar).
  //   4) Toda ação é registrada na auditoria, identificando que a origem foi
  //      o assistente de IA.
  // ══════════════════════════════════════════════════════════════
  ipcMain.handle('ia:executarAcao', async (_e, acao, usuario, autorizacaoExclusao) => {
    const usuarioAutenticado = getUsuarioAutenticado?.();
    if (!require('../access-policy').podeAcaoIA(usuarioAutenticado, acao?.tipo)) {
      return { sucesso: false, erro: 'Seu usuário não possui permissão para esta ação.' };
    }
    usuario = usuarioAutenticado.id;
    if (!acao || typeof acao !== 'object' || !acao.tipo) {
      return { sucesso: false, erro: 'Ação inválida.' };
    }
  
    if (acao.tipo === 'excluir_os') {
      const credencial = autorizacaoExclusao && typeof autorizacaoExclusao === 'object'
        ? autorizacaoExclusao
        : { tipo: 'individual', senha: String(autorizacaoExclusao || '') };
      let autorizada = false;
      if (credencial.tipo === 'administrador') {
        const respostaAdmin = await supabaseDesktop?.administrarGlobal?.('validar_credencial_admin_exclusao', {
          usuario: String(credencial.usuario || ''), senha: String(credencial.senha || '')
        });
        autorizada = respostaAdmin?.sucesso === true;
      } else if (credencial.tipo === 'sem_senha') {
        const politica = await supabaseDesktop?.obterPoliticaExclusao?.();
        autorizada = politica ? politica.sem_senha === true : db.verificarSenhaExclusao('');
      } else {
        const validacaoNuvem = await supabaseDesktop?.validarMinhaSenhaExclusao?.(String(credencial.senha || ''));
        autorizada = validacaoNuvem === null || validacaoNuvem === undefined
          ? db.verificarSenhaExclusao(String(credencial.senha || ''))
          : validacaoNuvem === true;
      }
      if (!autorizada) {
        auditoria.registrar('ia:executarAcao:senhaIncorreta', { tipo: acao.tipo, numero: acao.dados?.numero }, usuario);
        return { sucesso: false, erro: 'Autorização de exclusão inválida.' };
      }
    }
  
    const resultado = await iaChat.executarAcao(acao, usuarioAutenticado);
  
    // Mesmo pós-processamento (PDF + backup automático) que os handlers
    // manuais os:criar / os:atualizar já fazem, para a OS criada/alterada
    // pela IA sair do mesmo jeito que uma criada pelo formulário.
    if (resultado.sucesso && (acao.tipo === 'criar_os' || acao.tipo === 'alterar_status_os') && resultado.os) {
      try { await pdf.gerarPdfDaOS(resultado.os); } catch (err) { console.error('PDF OS (IA) falhou:', err); }
      resultado.os = db.obterOSPorNumero(resultado.os.numero);
      try { backup.backupAutomaticoDaOS(resultado.os); } catch (err) { console.error('Backup OS (IA) falhou:', err); }
    }
    if (resultado.sucesso && ['criar_os', 'alterar_status_os', 'excluir_os', 'adicionar_custos_compra', 'alterar_status_cobranca'].includes(acao.tipo)) {
      if (acao.tipo === 'adicionar_custos_compra') backup.agendarBackupEmBreve('ia:adicionar_custos_compra');
      sincronizarSupabaseEmSegundoPlano();
    }
  
    auditoria.registrar('ia:executarAcao', {
      tipo: acao.tipo,
      numero: acao.dados?.numero || resultado.os?.numero || resultado.compra?.numero,
      sucesso: resultado.sucesso,
      erro: resultado.erro
    }, usuario);
  
    return resultado;
  });
  
  // ══════════════════════════════════════════════════════════════
  // v40 — ABA CONVERSAS — handlers IPC
  // Apenas expõe funções já existentes em db.js (nenhuma lógica nova
  // de negócio é criada aqui; a automação do WhatsApp não é alterada).
  // ══════════════════════════════════════════════════════════════
  
  ipcMain.handle('conversas:porClassificacao', (_e, classificacao) => {
    return db.listarConversasPorClassificacao(classificacao);
  });
  
  ipcMain.handle('conversas:naoEntendidas', () => {
    return db.listarConversasNaoEntendidas();
  });
  
  // v40.4 — aba "Aguardando Humano", separada de "Não Entendidas"
  ipcMain.handle('conversas:aguardandoHumano', () => {
    return db.listarConversasAguardandoHumano();
  });
  
  // Fase 7 — aba "Pagamento na Retirada": OS com forma de pagamento já
  // informada pelo cliente, mas pagamento ainda não confirmado (nem
  // Mercado Pago, nem presencial). Separada de "Aguardando Humano": aqui a
  // automação de texto já terminou, falta só a confirmação do pagamento.
  ipcMain.handle('conversas:pagamentoNaRetirada', () => {
    return db.listarConversasPagamentoNaRetirada();
  });
  
  ipcMain.handle('conversas:contadores', () => {
    return db.contarConversasPorClassificacao();
  });
  
  
  
  // ══════════════════════════════════════════════════════════════
  // v24 — MP:GERARPAYLOAD — igual ao mp:gerarLinkEPix mas SEM abrir browser
  // Retorna { sucesso, linkML, erroML, pixCodigo, erroPix, preferenciaId }
  // ══════════════════════════════════════════════════════════════
  
  ipcMain.handle('mp:gerarPayload', async (_e, numero, valor) => {
    const os = db.obterOSPorNumero(numero);
    if (!os) return { sucesso: false, erro: 'OS não encontrada.' };
  
    const configFull = db.loadDB().config;
    const token   = configFull.mercadoPagoToken || '';
    const valorNum = parseFloat(valor);
    if (!valorNum || valorNum <= 0) return { sucesso: false, erro: 'Valor inválido.' };
  
    const aparelho = [os.aparelho?.marca, os.aparelho?.modelo].filter(Boolean).join(' ') || 'serviço';
    const telefone = (os.cliente?.telefone || '').replace(/\D/g, '');
    const pagador = criarPagadorMercadoPago(os);
  
    let linkML = null, erroML = null, preferenciaId = null;
    if (token) {
      try {
        const https = require('https');
        const body = JSON.stringify({
          items: [{ title: `${os.numero} — ${aparelho}`, quantity: 1, currency_id: 'BRL', unit_price: valorNum }],
          ...(Object.keys(pagador).length ? { payer: pagador } : {}),
          statement_descriptor: 'ASSISTENCIA TEC',
          payment_methods: {
            excluded_payment_types: [],
            installments: 1
          },
          external_reference: os.numero,
          expires: true,
          expiration_date_to: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '.000-03:00')
        });
        const resultado = await new Promise((resolve, reject) => {
          const req = require('https').request({
            hostname: 'api.mercadopago.com', path: '/checkout/preferences', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Content-Length': Buffer.byteLength(body) }
          }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
          });
          req.on('error', reject); req.write(body); req.end();
        });
        linkML = resultado.init_point || null;
        preferenciaId = resultado.id || null;
        if (!linkML) erroML = resultado.message || resultado.error || 'Resposta inválida';
      } catch(e) { erroML = e.message; }
    } else {
      erroML = 'Token Mercado Pago não configurado.';
    }
  
    let pixCodigo = null, erroPix = null;
    const pixChave = configFull.pixChave || '';
    const pixTipo  = configFull.pixTipoChave || 'telefone';
    const config   = db.obterConfig();
    if (pixChave) {
      try {
        const pix = require('../pix');
        pixCodigo = pix.gerarPixCopiaCola({
          chave: pixChave, tipoChave: pixTipo,
          nome: config.nomeEmpresa || 'Assistência Técnica',
          cidade: config.cidade || 'Brasil',
          valor: valorNum, txid: os.numero.replace(/\D/g, ''),
          descricao: `OS ${os.numero}`
        });
      } catch(e) { erroPix = e.message; }
    } else { erroPix = 'Chave Pix não configurada.'; }
  
    return { sucesso: true, linkML, erroML, pixCodigo, erroPix, preferenciaId,
             clienteNome: os.cliente?.nome || '', telefone };
  });
  
  // ══════════════════════════════════════════════════════════════
  // v24 — WAPPFLY — envio automático de WhatsApp via API
  // ══════════════════════════════════════════════════════════════
  
  ipcMain.handle('wappfly:enviar', async (_e, telefone, mensagem) => {
    const configFull = db.loadDB().config;
    const apiUrl = configFull.wappflyApiUrl || '';
    const apiKey = configFull.wappflyApiKey || '';
  
    if (!apiUrl || !apiKey) {
      return { sucesso: false, erro: 'Wappfly não configurado. Vá em Configurações > Integrações.' };
    }
  
    // Normaliza telefone: remove tudo que não é dígito, garante código do país configurado
    const ddi = (configFull.codigoPaisWhatsapp || '55').replace(/\D/g, '') || '55';
    const tel = telefone.replace(/\D/g, '');
    const telFinal = tel.startsWith(ddi) ? tel : ddi + tel;
  
    try {
      const https = require('https');
      const http  = require('http');
      const url   = new URL(apiUrl.replace(/\/$/, '') + '/messages');
      const body  = JSON.stringify({ phone: telFinal, message: mensagem });
      const driver = url.protocol === 'https:' ? https : http;
  
      const resposta = await new Promise((resolve, reject) => {
        const req = driver.request({
          hostname: url.hostname,
          path:     url.pathname + url.search,
          port:     url.port || (url.protocol === 'https:' ? 443 : 80),
          method:   'POST',
          headers: {
            'Content-Type':  'application/json',
            'x-api-key':     apiKey,
            'Content-Length': Buffer.byteLength(body)
          }
        }, res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
            catch { resolve({ status: res.statusCode, body: data }); }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
  
      if (resposta.status >= 200 && resposta.status < 300) {
        return { sucesso: true, resposta: resposta.body };
      }
      return { sucesso: false, erro: `Wappfly retornou status ${resposta.status}`, detalhe: resposta.body };
    } catch(e) {
      return { sucesso: false, erro: e.message };
    }
  });
  
  
  // ─── ATUALIZAÇÃO PELO GITHUB RELEASES ───────────────────────────────────────
  // O renderer não escolhe arquivo nem caminho: o electron-updater baixa e
  // valida os artefatos publicados no repositório oficial.
  ipcMain.handle('update:verificar', () => atualizador.verificar());
  ipcMain.handle('update:estado', () => atualizador.obterEstado());
  ipcMain.handle('update:instalar', () => atualizador.instalar());
  ipcMain.handle('update:versaoAtual', () => atualizador.versaoAtual());

  return { sincronizarSupabaseEmSegundoPlano };
}

module.exports = { registerLegacyHandlers };
