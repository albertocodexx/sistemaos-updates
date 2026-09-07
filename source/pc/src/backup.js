// src/backup.js — v2 (backup completo + auto-poll Mercado Pago)
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const db   = require('./db');

let _publicadorNuvem = null;
let _publicacaoNuvemEmAndamento = null;
let _retryNuvemTimer = null;
let _tentativaNuvem = 0;
const RETRY_NUVEM_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
const NOME_BACKUP_PENDENTE_NUVEM = 'cloud-pendente.json';

function definirPublicadorNuvem(publicador) {
  _publicadorNuvem = typeof publicador === 'function' ? publicador : null;
  if (_publicadorNuvem) {
    // Retoma automaticamente um envio que ficou pendente porque o computador
    // foi desligado ou a internet caiu na execucao anterior.
    setTimeout(() => reprocessarBackupNuvemPendente(), 0);
  }
}

function hashArquivo(caminho) {
  return crypto.createHash('sha256').update(fs.readFileSync(caminho)).digest('hex');
}

function validarBackupJson(caminho) {
  const stat = fs.statSync(caminho);
  if (!stat.isFile() || stat.size < 2 || stat.size > 50 * 1024 * 1024) {
    throw new Error('Backup vazio ou maior que 50 MB.');
  }
  const dados = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  if (!dados || dados.tipo !== 'backup-sistema-os' || !Array.isArray(dados.ordens)) {
    throw new Error('Estrutura do backup invalida.');
  }
  return stat;
}

function substituirArquivoAtomico(origem, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  try {
    fs.renameSync(origem, destino);
  } catch (erro) {
    // Alguns antiviruses do Windows seguram o destino por poucos milissegundos.
    // A copia so e usada como compatibilidade; a origem ja esta completa e
    // validada, portanto nunca publicamos um JSON parcialmente gravado.
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(erro.code)) throw erro;
    fs.copyFileSync(origem, destino);
    fs.unlinkSync(origem);
  }
}

function sincronizarArquivo(caminho) {
  const descritor = fs.openSync(caminho, 'r');
  try {
    fs.fsyncSync(descritor);
  } catch (erro) {
    // Alguns volumes sincronizados/virtuais do Windows nao implementam
    // fsync para arquivos abertos somente para leitura. O rename atomico e a
    // validacao posterior continuam protegendo contra JSON parcial.
    if (!['EPERM', 'EINVAL', 'ENOTSUP'].includes(erro.code)) throw erro;
  } finally {
    fs.closeSync(descritor);
  }
}

function gravarTextoAtomico(caminho, conteudo) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const temporario = `${caminho}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    fs.writeFileSync(temporario, conteudo, 'utf8');
    sincronizarArquivo(temporario);
    substituirArquivoAtomico(temporario, caminho);
  } finally {
    try { if (fs.existsSync(temporario)) fs.unlinkSync(temporario); } catch {}
  }
  return caminho;
}

function exportarBackupAtomico(caminho) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const temporario = `${caminho}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    const resultado = db.exportarBackupCompleto(temporario);
    validarBackupJson(temporario);
    sincronizarArquivo(temporario);
    substituirArquivoAtomico(temporario, caminho);
    validarBackupJson(caminho);
    return Object.assign({}, resultado, { caminho });
  } finally {
    try { if (fs.existsSync(temporario)) fs.unlinkSync(temporario); } catch {}
  }
}

function caminhoBackupPendenteNuvem() {
  return path.join(db.getBackupAutoDir(), NOME_BACKUP_PENDENTE_NUVEM);
}

function prepararBackupPendenteNuvem(caminho) {
  validarBackupJson(caminho);
  const destino = caminhoBackupPendenteNuvem();
  const temporario = `${destino}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(caminho, temporario);
  validarBackupJson(temporario);
  substituirArquivoAtomico(temporario, destino);
  return destino;
}

function agendarRetryNuvem() {
  if (_retryNuvemTimer || !_publicadorNuvem) return;
  const espera = RETRY_NUVEM_MS[Math.min(_tentativaNuvem, RETRY_NUVEM_MS.length - 1)];
  _tentativaNuvem += 1;
  _retryNuvemTimer = setTimeout(() => {
    _retryNuvemTimer = null;
    reprocessarBackupNuvemPendente();
  }, espera);
  _retryNuvemTimer.unref?.();
  console.warn(`[Backup Nuvem] Nova tentativa agendada em ${Math.round(espera / 60000)} min.`);
}

function reprocessarBackupNuvemPendente() {
  if (!_publicadorNuvem) return Promise.resolve({ sucesso: false, pendente: true });
  const caminho = caminhoBackupPendenteNuvem();
  if (!fs.existsSync(caminho)) return Promise.resolve({ sucesso: true, pendente: false });
  if (_publicacaoNuvemEmAndamento) return _publicacaoNuvemEmAndamento;

  _publicacaoNuvemEmAndamento = (async () => {
    while (_publicadorNuvem && fs.existsSync(caminho)) {
      let hashEnviado;
      try {
        validarBackupJson(caminho);
        hashEnviado = hashArquivo(caminho);
        const resultado = await _publicadorNuvem(caminho);
        if (resultado && resultado.sucesso === false) {
          throw new Error(resultado.erro || 'falha desconhecida');
        }

        // Se outro salvamento ocorreu durante o upload, o arquivo pendente ja
        // contem a versao nova. Mantemos a fila e enviamos novamente.
        if (fs.existsSync(caminho) && hashArquivo(caminho) === hashEnviado) {
          fs.unlinkSync(caminho);
        }
        _tentativaNuvem = 0;
        if (_retryNuvemTimer) { clearTimeout(_retryNuvemTimer); _retryNuvemTimer = null; }
        console.log('[Backup Nuvem] Copia validada e enviada.');
      } catch (erro) {
        console.error('[Backup Nuvem] Envio pendente:', erro.message);
        agendarRetryNuvem();
        return { sucesso: false, pendente: true, erro: erro.message };
      }
    }
    return { sucesso: true, pendente: false };
  })().finally(() => { _publicacaoNuvemEmAndamento = null; });
  return _publicacaoNuvemEmAndamento;
}

function publicarBackupNaNuvem(caminho) {
  if (!caminho) return Promise.resolve({ sucesso: false, pendente: false });
  try {
    prepararBackupPendenteNuvem(caminho);
  } catch (erro) {
    console.error('[Backup Nuvem] Nao foi possivel preparar a fila:', erro.message);
    return Promise.resolve({ sucesso: false, pendente: false, erro: erro.message });
  }
  if (!_publicadorNuvem) return Promise.resolve({ sucesso: false, pendente: true });
  return reprocessarBackupNuvemPendente();
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────────

function nomeArquivoSeguro(texto) {
  return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup individual de OS (JSON por OS, na pasta BACKUP - OS)
// ─────────────────────────────────────────────────────────────────────────────

function backupAutomaticoDaOS(os) {
  const pasta  = db.getBackupDir();
  const nome   = `${os.numero}_${nomeArquivoSeguro(os.cliente?.nome || 'cliente')}.json`;
  const caminho = path.join(pasta, nome);
  gravarTextoAtomico(caminho, JSON.stringify({
    numero:            os.numero,
    data:              os.data,
    dataAutomatic:     os.dataAutomatic,
    status:            os.status,
    historicoStatus:   os.historicoStatus   || [],
    dataPrevista:      os.dataPrevista      || '',
    horaPrevista:      os.horaPrevista      || '',
    semPrazo:          os.semPrazo === true,
    prioridade:        os.prioridade        || 'Normal',
    controleInterno:   os.controleInterno   || {},
    tecnicoResponsavel: os.tecnicoResponsavel || '',
    tecnicoAuxiliar:   os.tecnicoAuxiliar   || '',
    cliente:           os.cliente,
    aparelho:          os.aparelho,
    imei:              os.imei,
    observacoes:       os.observacoes,
    observacoesEntrada: os.observacoesEntrada || '',
    observacoesSaida:  os.observacoesSaida  || '',
    termos:            os.termos,
    valorInvestido:    os.valorInvestido    || 0,
    percentualLucro:   os.percentualLucro,
    diagnosticoTecnico: os.diagnosticoTecnico || {},
    checklistEntrada:  os.checklistEntrada  || [],
    checklistSaida:    os.checklistSaida    || [],
    fotos: (os.fotos || []).map(f => ({
      id: f.id, categoria: f.categoria, path: f.path, nome: f.nome, data: f.data
    })),
    caminhoPdf: os.pdfPath || ''
  }, null, 2), 'utf-8');
  // O arquivo individual continua existindo por compatibilidade. O backup
  // completo e agendado para que a copia unica da nuvem tambem acompanhe a OS.
  agendarBackupEmBreve(`os:${os.numero}`);
  return caminho;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup completo do banco de dados
// ─────────────────────────────────────────────────────────────────────────────

function exportarBackupCompleto(caminhoDestino) {
  const resultado = exportarBackupAtomico(caminhoDestino);
  publicarBackupNaNuvem(caminhoDestino);
  return resultado;
}
function importarBackup(caminhoOrigem)          { return db.importarBackup(caminhoOrigem); }

// ─────────────────────────────────────────────────────────────────────────────
// Backup Automático Diário
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BACKUPS_AUTO = 30;
const MAX_DIAS_PROTEGIDOS = 15;

function timestampSeguro() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function criarBackupAutomatico(tipo) {
  const pastaAuto = db.getBackupAutoDir();
  const nome = `auto-backup-${timestampSeguro()}-${tipo}.json`;
  const caminho = path.join(pastaAuto, nome);
  exportarBackupAtomico(caminho);
  limparBackupsAntigos(pastaAuto);
  publicarBackupNaNuvem(caminho);
  return { sucesso: true, caminho, nome, nuvemPendente: true };
}

function fazerBackupAutoDiario() {
  try {
    const resultado = criarBackupAutomatico('diario');
    console.log('[Backup Auto] Backup diario criado:', resultado.nome);
    return resultado;
  } catch (err) {
    console.error('[Backup Auto] Falhou:', err);
    return { sucesso: false, erro: err.message };
  }
}

function limparBackupsAntigos(pasta) {
  try {
    const arquivos = fs.readdirSync(pasta)
      .filter(f => f.startsWith('auto-backup-') && f.endsWith('.json'))
      .map(f => ({ nome: f, mtime: fs.statSync(path.join(pasta, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    const manter = new Set(arquivos.slice(0, MAX_BACKUPS_AUTO).map((item) => item.nome));
    const dias = new Set();
    for (const arquivo of arquivos) {
      const dia = arquivo.mtime.toISOString().slice(0, 10);
      if (!dias.has(dia) && dias.size < MAX_DIAS_PROTEGIDOS) {
        manter.add(arquivo.nome);
        dias.add(dia);
      }
    }
    for (const arquivo of arquivos) {
      if (!manter.has(arquivo.nome)) {
        fs.unlinkSync(path.join(pasta, arquivo.nome));
        console.log('[Backup Auto] Removido backup antigo:', arquivo.nome);
      }
    }
  } catch (err) {
    console.error('[Backup Auto] Erro ao limpar antigos:', err);
  }
}

function listarBackupsAuto() {
  try {
    const pastaAuto = db.getBackupAutoDir();
    return fs.readdirSync(pastaAuto)
      .filter(f => f.startsWith('auto-backup-') && f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(pastaAuto, f));
        return { nome: f, caminho: path.join(pastaAuto, f), tamanho: stat.size, data: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.data) - new Date(a.data));
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup com debounce — chamado após cada alteração crítica no banco
// Aguarda 20 s de inatividade antes de salvar para não fazer backup a
// cada keystroke em série de edições.
// ─────────────────────────────────────────────────────────────────────────────

let _debounceTimer = null;
const DEBOUNCE_MS  = 20_000; // 20 segundos

function agendarBackupEmBreve(motivo) {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    try {
      const resultado = criarBackupAutomatico('alteracao');
      console.log(`[Backup Debounce] Salvo apos "${motivo || 'alteracao'}":`, resultado.nome);
    } catch (err) {
      console.error('[Backup Debounce] Falhou:', err);
    }
    _debounceTimer = null;
  }, DEBOUNCE_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agendamento do backup diário
// ─────────────────────────────────────────────────────────────────────────────

let timerBackupAuto = null;
let timerBackupNuvem = null;

function iniciarAgendamentoBackup() {
  verificarEFazerBackupDiario();
  timerBackupAuto = setInterval(verificarEFazerBackupDiario, 60 * 60 * 1000);
  // Tambem verifica a fila separadamente. Assim uma troca de conta/empresa
  // reaproveita o backup pendente do novo escopo sem esperar uma edicao.
  timerBackupNuvem = setInterval(reprocessarBackupNuvemPendente, 5 * 60 * 1000);
  timerBackupNuvem.unref?.();
  console.log('[Backup Auto] Agendamento iniciado (verificação horária)');
}

function verificarEFazerBackupDiario() {
  try {
    const pastaAuto = db.getBackupAutoDir();
    const hoje      = new Date().toISOString().slice(0, 10);
    const jaFezHoje = fs.readdirSync(pastaAuto)
      .some(f => f.startsWith(`auto-backup-${hoje}`) && f.endsWith('-diario.json'));
    if (!jaFezHoje) fazerBackupAutoDiario();
  } catch (err) {
    console.error('[Backup Auto] Erro na verificação:', err);
  }
}

function pararAgendamento() {
  if (timerBackupAuto) { clearInterval(timerBackupAuto); timerBackupAuto = null; }
  if (timerBackupNuvem) { clearInterval(timerBackupNuvem); timerBackupNuvem = null; }
  if (_debounceTimer)  { clearTimeout(_debounceTimer);   _debounceTimer  = null; }
  if (_retryNuvemTimer) { clearTimeout(_retryNuvemTimer); _retryNuvemTimer = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-poll Mercado Pago
// Verifica cobranças em aberto (status='aguardando') a cada POLL_INTERVAL ms.
// Quando confirma pagamento, registra no banco e emite evento para o renderer.
//
// DESIGN: usa setTimeout encadeado em vez de setInterval para garantir que
// um ciclo só começa DEPOIS que o anterior terminou (evita sobreposição em
// redes lentas ou com muitas cobranças pendentes).
// ─────────────────────────────────────────────────────────────────────────────
// O webhook continua sendo o caminho imediato. O poll é somente uma rede de
// segurança e, portanto, não deve consultar Supabase + Mercado Pago a cada
// poucos segundos quando o aplicativo fica aberto na bandeja.
const POLL_INTERVAL_MS = 60 * 1000;
const POLL_JITTER_MS = 15 * 1000;
let _pollAtivo  = false;  // true enquanto o loop estiver rodando
let _pollRodando = false; // true enquanto UMA execução estiver em curso (lock)
let _janelaRef  = null;   // BrowserWindow passada via iniciarPollMP()
let _consultorMercadoPago = null; // consulta segura pelo cofre Supabase

function _proximoIntervaloMP() {
  return POLL_INTERVAL_MS + Math.floor(Math.random() * POLL_JITTER_MS);
}

function definirConsultorMercadoPago(consultor) {
  _consultorMercadoPago = typeof consultor === 'function' ? consultor : null;
}

function iniciarPollMP(janela) {
  _janelaRef = janela;
  if (_pollAtivo) return; // já iniciado; a referência da janela já foi atualizada
  _pollAtivo = true;
  console.log('[MP Poll] Auto-verificação de segurança iniciada (ciclo de 60–75s)');
  // Primeira verificação é espaçada para não disputar CPU com login e sync.
  setTimeout(() => _cicloMP(), 30_000);
}

function definirJanelaPollMP(janela) {
  _janelaRef = janela;
}

function pararPollMP() {
  _pollAtivo = false;
  console.log('[MP Poll] Auto-verificação encerrada');
}

// Loop: executa → aguarda resultado → dorme com jitter → repete
async function _cicloMP() {
  if (!_pollAtivo) return; // foi parado enquanto dormia

  if (!_pollRodando) {
    _pollRodando = true;
    try {
      await _executarPollMP();
    } catch (err) {
      console.error('[MP Poll] Erro inesperado no ciclo:', err.message);
    } finally {
      _pollRodando = false;
    }
  }

  // Só agenda próxima rodada se ainda estiver ativo
  if (_pollAtivo) {
    setTimeout(() => _cicloMP(), _proximoIntervaloMP());
  }
}

async function _executarPollMP() {
  try {
    const dados    = db.loadDB();
    const token    = dados.config?.mercadoPagoToken || '';
    // Instalações novas guardam o token exclusivamente no cofre Supabase.
    // O token local permanece apenas como compatibilidade de bancos antigos.
    if (!_consultorMercadoPago && !token) return;

    const cobrancas = (dados.cobrancas || [])
      .filter(c => c.status === 'aguardando' && c.osNumero);

    if (cobrancas.length === 0) return;

    console.log(`[MP Poll] Verificando ${cobrancas.length} cobrança(s) pendente(s)...`);
    const https = require('https');
    const consultasPorOS = new Map();

    for (const cob of cobrancas) {
      try {
        // Antes de chamar a API do MP, verificar se OS já está encerrada por outro canal
        const osPreCheck = db.obterOSPorNumero(cob.osNumero);
        if (!osPreCheck) {
          db.atualizarStatusCobranca(cob.id, { status: 'cancelado' });
          continue;
        }
        // BUGFIX: 'Autorizada' nunca é um valor válido de os.status (status
        // técnico) — o pagamento confirmado mora em statusPagamento==='Autorizado'.
        // Essa checagem sempre foi 'false' na prática (comparando com um valor
        // que status técnico nunca assume), então nunca encerrava a cobrança
        // órfã aqui — corrigido para checar o campo certo.
        if (['Pago', 'Autorizado'].includes(osPreCheck.statusPagamento) || osPreCheck.status === 'Entregue') {
          // Uma opção alternativa não vira "paga" só porque outra cobrança
          // da mesma OS foi quitada.
          db.atualizarStatusCobranca(cob.id, { status: 'cancelado', pagamentoId: null });
          console.log(`[MP Poll] Cobrança alternativa encerrada — OS ${cob.osNumero} já está paga/entregue.`);
          continue;
        }

        let resultado = consultasPorOS.get(cob.osNumero);
        if (!resultado) {
          if (_consultorMercadoPago) {
            const consultaSegura = await _consultorMercadoPago(cob.osNumero);
            if (!consultaSegura?.sucesso) {
              throw new Error(consultaSegura?.erro || 'Não foi possível consultar o Mercado Pago pelo cofre seguro.');
            }
            resultado = { results: Array.isArray(consultaSegura.pagamentos) ? consultaSegura.pagamentos : [] };
          } else {
            resultado = await _consultarPagamentoMP(https, token, cob.osNumero);
          }
          consultasPorOS.set(cob.osNumero, resultado);
        }
        // Bug fix (pagamento antigo confundido com o novo): external_reference é o número
        // da OS, então a busca sempre traz TODO o histórico de pagamentos daquela OS —
        // incluindo aprovações antigas de ciclos anteriores (ex: OS reaberta e cobrada de
        // novo com outro valor). Antes o código pegava o primeiro "approved" da lista sem
        // checar se pertencia à cobrança atual, confundindo um pagamento antigo (ex: R$ 100
        // de um teste anterior) com o pagamento novo (ex: R$ 1 pago agora nesta cobrança).
        const valorCobAtual = parseFloat(cob.valor || 0);
        const criadoEmCobMs = new Date(cob.criadoEm).getTime() - (5 * 60 * 1000); // margem 5 min
        const aprovado = (resultado.results || []).find(p => {
          if (p.status !== 'approved') return false;
          const dataPagMs = new Date(p.date_approved || p.date_created).getTime();
          if (dataPagMs < criadoEmCobMs) return false; // pagamento de ciclo anterior — ignora
          if (valorCobAtual > 0 && Math.abs(p.transaction_amount - valorCobAtual) > 0.01) return false; // valor não bate com esta cobrança
          return true;
        });
        if (!aprovado) continue;

        const valorPago = aprovado.transaction_amount;
        const os        = db.obterOSPorNumero(cob.osNumero);
        if (!os) continue;

        // Se OS ficou paga/entregue entre o pre-check e a resposta da API, fecha a cobrança órfã
        // (mesmo bugfix do pre-check acima: statusPagamento, não status técnico)
        if (['Pago', 'Autorizado'].includes(os.statusPagamento) || os.status === 'Entregue') {
          db.atualizarStatusCobranca(cob.id, { status: 'cancelado', pagamentoId: null });
          console.log(`[MP Poll] Cobrança alternativa encerrada — OS ${cob.osNumero} já está paga/entregue.`);
          continue;
        }

        // Validação de valor mínimo: usa valor real da cobrança como referência primária,
        // com fallback para valorInvestido da OS se a cobrança não tiver valor definido.
        const valorEsperado = parseFloat(cob.valor || os.valorInvestido || 0);
        if (valorEsperado > 0 && valorPago < valorEsperado * 0.99) {
          console.warn(`[MP Poll] ⚠️ Valor insuficiente — OS ${cob.osNumero} — pago R$ ${valorPago}, esperado R$ ${valorEsperado}. Ignorado.`);
          continue;
        }

        // Deduplica a transação exata. Uma entrada anterior de 50% não pode
        // bloquear a quitação posterior da mesma OS.
        const idMp = String(aprovado.id || '');
        const pagExistente = db.listarPagamentos().find(p =>
          p.osNumero === cob.osNumero
          && p.origem === 'mercadopago'
          && idMp
          && String(p.observacao || '').includes(`ID MP: ${idMp}`)
        );
        let pagamentoId = pagExistente?.id || null;
        if (!pagExistente) {
          const metodo = _traduzirMetodoPagamento(aprovado.payment_type_id);
          const pag = db.registrarPagamento({
            osNumero:   cob.osNumero,
            valor:      valorPago,
            metodo,
            origem:     'mercadopago',
            observacao: `[Auto-Poll] ID MP: ${aprovado.id} | ${new Date(aprovado.date_approved).toLocaleString('pt-BR')}`
          });
          pagamentoId = pag.id;
        }

        // Atualiza a cobrança exata e encerra opções alternativas do mesmo
        // fluxo para que nunca apareçam duas cobranças como pagas.
        db.atualizarStatusCobranca(cob.id, { status: 'pago', pagamentoId });
        if (['entrada_50', 'integral_100'].includes(String(cob.tipo || ''))) {
          const alternativas = db.listarCobrancas().filter(outra =>
            outra.id !== cob.id
            && outra.osNumero === cob.osNumero
            && outra.status === 'aguardando'
            && ['entrada_50', 'integral_100'].includes(String(outra.tipo || ''))
          );
          for (const alternativa of alternativas) {
            db.atualizarStatusCobranca(alternativa.id, { status: 'cancelado', pagamentoId: null });
          }
        }
        agendarBackupEmBreve(`pagamento-auto-mp-${cob.osNumero}`);

        console.log(`[MP Poll] ✅ Pagamento confirmado — OS ${cob.osNumero} — R$ ${valorPago}`);

        // Notifica o renderer para atualizar a tela e enviar WhatsApp
        if (_janelaRef && !_janelaRef.isDestroyed()) {
          const osAtualizada = db.obterOSPorNumero(cob.osNumero) || os;
          _janelaRef.webContents.send('mp:pagamentoConfirmado', {
            osNumero:   cob.osNumero,
            cobId:      cob.id,
            pagamentoId,
            valorPago,
            metodo:     _traduzirMetodoPagamento(aprovado.payment_type_id),
            data:       aprovado.date_approved,
            clienteTel: cob.clienteTel  || '',
            clienteNome: cob.clienteNome || '',
            jaConfirmado: !!pagExistente,
            exigirEntrada50: osAtualizada.exigirEntrada50Aprovacao === true,
            entrada50Paga: osAtualizada.entrada50Paga === true,
            percentualPagamentoConfirmado: Number(osAtualizada.percentualPagamentoConfirmado || 0),
            valorEntrada: Number(osAtualizada.valorEntradaAprovacao || 0),
            valorRestante: Number(osAtualizada.valorRestanteServico || 0)
          });
        }
      } catch (errCob) {
        console.error(`[MP Poll] Erro ao verificar OS ${cob.osNumero}:`, errCob.message);
      }
    }
  } catch (err) {
    console.error('[MP Poll] Erro geral no poll:', err.message);
  }
}

function _consultarPagamentoMP(https, token, osNumero) {
  return new Promise((resolve, reject) => {
    const qpath = `/v1/payments/search?external_reference=${encodeURIComponent(osNumero)}&sort=date_created&criteria=desc&limit=5`;
    const req = https.request({
      hostname: 'api.mercadopago.com',
      path:     qpath,
      method:   'GET',
      headers:  { 'Authorization': `Bearer ${token}` }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Resposta inválida MP: ' + data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function _traduzirMetodoPagamento(tipo) {
  const mapa = {
    credit_card:    'Cartão de crédito',
    debit_card:     'Cartão de débito',
    account_money:  'Saldo Mercado Pago',
    bank_transfer:  'Pix',
    ticket:         'Boleto'
  };
  return mapa[tipo] || `Outro (${tipo})`;
}

// Expõe o status do agendamento de backup para a UI de configurações.
// Reaproveita listarBackupsAuto() (já faz a leitura de disco) em vez de
// duplicar a lógica de ler a pasta de auto-backup.
function statusAgendamento() {
  const backups = listarBackupsAuto(); // já vem ordenado: mais recente primeiro
  const espacoTotalBytes = backups.reduce((soma, b) => soma + (b.tamanho || 0), 0);
  return {
    ativo: timerBackupAuto !== null,
    totalBackups: backups.length,
    espacoTotalBytes,
    ultimoBackup: backups.length > 0 ? backups[0] : null, // {nome, caminho, tamanho, data}
    limiteBackups: MAX_BACKUPS_AUTO,
    backupNuvemPendente: fs.existsSync(caminhoBackupPendenteNuvem()),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  backupAutomaticoDaOS,
  exportarBackupCompleto,
  importarBackup,
  fazerBackupAutoDiario,
  listarBackupsAuto,
  agendarBackupEmBreve,
  iniciarAgendamentoBackup,
  verificarEFazerBackupDiario,
  pararAgendamento,
  definirConsultorMercadoPago,
  definirJanelaPollMP,
  iniciarPollMP,
  pararPollMP,
  statusAgendamento,
  definirPublicadorNuvem,
  reprocessarBackupNuvemPendente,
};
