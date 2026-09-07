// Contrato seguro publicado pelo preload. O renderer recebe apenas métodos
// permitidos; ipcRenderer, require e acesso ao sistema nunca são expostos.
const { criarApiOS } = require('./os-api');

function criarApiPublica({ invocar, assinar, removerAssinatura }) {
  const apiOS = criarApiOS(invocar);
  const apiLegada = {
  dbverificartamanho: ()  => invocar('db:verificarTamanho'),
  auditorialistar: filtros => invocar('auditoria:listar', filtros),
  // API organizada (nova). Os atalhos antigos logo abaixo permanecem.
  os: apiOS,
  // OS
  oscriar:          apiOS.criar,
  osatualizar:      apiOS.atualizar,
  oslistar:         apiOS.listar,
  osbuscar:         apiOS.buscar,
  osobter:          apiOS.obter,
  osstatusvalidos:  apiOS.statusValidos,
  osstatistics:     apiOS.estatisticas,
  osgerarPdf:       apiOS.gerarPdf,
  osabrirpdf:       apiOS.abrirPdf,
  osgerarcomprovante: apiOS.gerarComprovante,
  osabrircomprovante: apiOS.abrirComprovante,
  osimprimircomprovante: apiOS.imprimirComprovante,
  oslistarimpressoras: apiOS.listarImpressoras,
  etiquetagerarqr:   apiOS.gerarEtiquetaQR,
  osexcluir:        apiOS.excluir,
  ossalvarfoto:     apiOS.salvarFoto,
  ossalvarcomprovantetermico: apiOS.salvarComprovanteTermico,
  osexcluirfoto:    apiOS.excluirFoto,
  ossubstituirfoto: apiOS.substituirFoto,
  // Parte 2.1: resposta de termos do cliente
  osregistrartermosresposta: apiOS.registrarRespostaTermos,
  // App Celular (assinatura em campo) — v43: importar OS do celular
  osimportardocelular: (u) => invocar('os:importarDoCelular', u),
  // App Celular — lote v2: importar lote misto (OS + Compra + Venda) do celular
  loteimportardocelular: (u) => invocar('lote:importarDoCelular', u),
  // Exportar documento (OS/Compra/Venda) para assinatura remota no celular.
  assinaturaexportar: (tipoDocumento, identificador, u) => invocar('assinatura:exportar', tipoDocumento, identificador, u),
  assinaturaimportarresposta: (u) => invocar('assinatura:importarResposta', u),
  // Autorizações de desbloqueio
  desbloqueiolistar: () => invocar('desbloqueio:listar'),
  desbloqueioobter: n => invocar('desbloqueio:obter', n),
  desbloqueiotermos: () => invocar('desbloqueio:termos'),
  desbloqueiosalvar: (d, modo, u) => invocar('desbloqueio:salvar', d, modo, u),
  desbloqueiogerarpdf: n => invocar('desbloqueio:gerarPdf', n),
  desbloqueioimprimirtermico: (n, f, i) => invocar('desbloqueio:imprimirTermico', n, f, i),
  desbloqueioabrirpdf: c => invocar('desbloqueio:abrirPdf', c),
  desbloqueioexcluir: (n, u) => invocar('desbloqueio:excluir', n, u),
  // Supabase (Etapa 7 Electron). Tokens/sessão permanecem criptografados no
  // processo principal; o renderer recebe somente contexto público e status.
  supabasestatus:          ()       => invocar('supabase:status'),
  supabaseaguardarinicializacao: () => invocar('supabase:aguardarInicializacao'),
  supabaselogin:           (empresa, usuario, senha) => invocar('supabase:login', empresa, usuario, senha),
  supabaserestaurarsessao: ()       => invocar('supabase:restaurarSessao'),
  supabaselogout:          ()       => invocar('supabase:logout'),
  supabaselistarcontasrapidas: () => invocar('supabase:listarContasRapidas'),
  supabasetrocarcontarapida: (id) => invocar('supabase:trocarContaRapida', id),
  supabaseremovercontarapida: (id) => invocar('supabase:removerContaRapida', id),
  supabaseconfigurartrocarapida: (ativa) => invocar('supabase:configurarTrocaRapida', ativa),
  supabaserecuperarsenha:  (e)      => invocar('supabase:recuperarSenha', e),
  supabaseprocessarrecuperacao: (u) => invocar('supabase:processarRecuperacao', u),
  supabaseatualizarsenha:  (s)      => invocar('supabase:atualizarSenha', s),
  supabasetestarconexao:   (c)      => invocar('supabase:testarConexao', c),
  supabasesincronizaragora:()       => invocar('supabase:sincronizarAgora'),
  tabelaprecoslistar:      ()       => invocar('tabelaPrecos:listar'),
  tabelaprecossalvar:      (dados)  => invocar('tabelaPrecos:salvar', dados),
  tabelaprecosexcluir:     (id, revision) => invocar('tabelaPrecos:excluir', id, revision),
  supabaseintegracaomercadopago: (acao, token) => invocar('supabase:integracaoMercadoPago', acao, token),
  supabaseverificarintegracaomercadopago: () => invocar('supabase:verificarIntegracaoMercadoPago'),
  supabaseobterintegracaomercadopago: () => invocar('supabase:obterIntegracaoMercadoPago'),
  supabaseassinaturassaas:  (acao, dados) => invocar('supabase:assinaturasSaas', acao, dados),
  supabasefiscaldocumentos: (acao, dados) => invocar('supabase:fiscalDocumentos', acao, dados),
  fiscalabrirdanfse: (notaId) => invocar('fiscal:abrirDanfse', notaId),
  supabaseintegracaowhatsappapi: (acao, dados) => invocar('supabase:integracaoWhatsAppApi', acao, dados),
  supabaseintegracaoia: (acao, dados) => invocar('supabase:integracaoIA', acao, dados),
  sistemaabrirlinkseguro: (url) => invocar('sistema:abrirLinkSeguro', url),
  supabaseadministracaoglobal: (acao, dados) => invocar('supabase:administracaoGlobal', acao, dados),
  supabaseregistrarerrousuario: (dados) => invocar('supabase:registrarErroUsuario', dados),
  supabasecriarchamadosuporte: (dados) => invocar('supabase:criarChamadoSuporte', dados),
  supabasechamadosuporte: (acao, dados) => invocar('supabase:chamadosSuporte', acao, dados),
  supabaseadministrarchamadosuporte: (acao, dados) => invocar('supabase:administrarChamadosSuporte', acao, dados),
  onSupabaseSincronizado: (callback) => {
    const listener = (_e, dados) => callback(dados);
    assinar('supabase:sincronizado', listener);
    return () => removerAssinatura('supabase:sincronizado', listener);
  },
  onSupabaseRecuperacaoUrl: (callback) => {
    const listener = (_e, url) => callback(url);
    assinar('supabase:recuperacao-url', listener);
    return () => removerAssinatura('supabase:recuperacao-url', listener);
  },
  onAbrirOSPorUrl: (callback) => {
    const listener = (_e, dados) => callback(dados);
    assinar('sistemaos:abrir-os-url', listener);
    return () => removerAssinatura('sistemaos:abrir-os-url', listener);
  },
  onModoSegundoPlano: (callback) => {
    const listener = (_e, estado) => callback(estado);
    assinar('sistemaos:modo-segundo-plano', listener);
    return () => removerAssinatura('sistemaos:modo-segundo-plano', listener);
  },
  // Config
  configobter:      ()     => invocar('config:obter'),
  configtermosresolvidos: () => invocar('config:termosResolvidos'),
  configsalvar:     (c)    => invocar('config:salvar', c),
  configpreferenciaslocais: () => invocar('config:preferenciasLocais'),
  configsalvarpreferenciaslocais: (c) => invocar('config:salvarPreferenciasLocais', c),
  configverificarsenhaexclusao: (s) => invocar('config:verificarSenhaExclusao', s),
  configpoliticaexclusao: () => invocar('config:politicaExclusao'),
  configdefinirminhasenhaexclusao: (s) => invocar('config:definirMinhaSenhaExclusao', s),
  configconfigurarpoliticaexclusao: (todos, usuarios) => invocar('config:configurarPoliticaExclusao', todos, usuarios),
  configsalvarlogo: (b,e)  => invocar('config:salvarLogo', b, e),
  sistemazerar:     (s, r) => invocar('sistema:zerar', s, r),
  redeobter:        ()     => invocar('rede:obter'),
  redesalvar:       (d)    => invocar('rede:salvar', d),
  // Estoque
  estoquecriar:     (d)    => invocar('estoque:criar', d),
  estoqueatualizar: (id,d) => invocar('estoque:atualizar', id, d),
  estoquelistar:    ()     => invocar('estoque:listar'),
  estoqueobter:     (id)   => invocar('estoque:obter', id),
  estoquestats:     ()     => invocar('estoque:stats'),
  estoquestatusvalidos: () => invocar('estoque:statusValidos'),
  estoquechecklistpadrao: () => invocar('estoque:checklistPadrao'),
  estoquesalvarfoto: (id,b,n) => invocar('estoque:salvarFoto', id, b, n),
  estoquegerarpdfvenda: (id) => invocar('estoque:gerarPdfVenda', id),
  estoqueabrirpdfvenda: (c) => invocar('estoque:abrirPdfVenda', c),
  estoquebuscar:    (f)    => invocar('estoque:buscar', f),
  estoqueobterlog:  (f)   => invocar('estoque:obterLog', f),
  estoqueexportarlogcsv: (f) => invocar('estoque:exportarLogCsv', f),
  estoqueexcluir:   (id,u) => invocar('estoque:excluir', id, u),
  // Backup manual
  backupexportar:   ()     => invocar('backup:exportar'),
  backupimportar:   ()     => invocar('backup:importar'),
  backupabrir:      ()     => invocar('backup:abrirPasta'),
  backupabrirdados: ()     => invocar('backup:abrirPastaDados'),
  // Backup automático
  backupfazeragora:   ()   => invocar('backup:fazerAgora'),
  backuplistarauto:   ()   => invocar('backup:listarAuto'),
  backupbaixarauto:   (c)  => invocar('backup:baixarAuto', c),
  backupabrirpastauto: ()  => invocar('backup:abrirPastaAuto'),
  backupstatusautomatico: () => invocar('backup:statusAutomatico'),
  // Backup visual do painel (Relatórios) em PDF
  backupexportarpainelpdf: () => invocar('backup:exportarPainelPDF'),
  // Manual
  abrirmanual: () => invocar('app:abrirManual'),
  // Licença (Etapa 11.1)
  licencaobter:    ()    => invocar('licenca:obter'),
  licencaverificar: ()   => invocar('licenca:verificar'),
  licencaativar:   (d)   => invocar('licenca:ativar', d),
  licencaresetar:  ()    => invocar('licenca:resetar'),
  // Auth / Usuários (Etapa 11.2)
  authlogin:           (u, s)   => invocar('auth:login', u, s),
  authrevalidar:       (id)     => invocar('auth:revalidar', id),
  authatualizarnome:   (id, nome)          => invocar('auth:atualizarNome', id, nome),
  authexcluirusuario:  (id, solId)          => invocar('auth:excluirUsuario', id, solId),
  authlistarusuarios:  ()       => invocar('auth:listarUsuarios'),
  authcriarusuario:    (d)      => invocar('auth:criarUsuario', d),
  authgerarautomatico: (perfil) => invocar('auth:gerarAutomatico', perfil),
  autheditar:          (id, d)  => invocar('auth:editarUsuario', id, d),
  authalterarstatus:   (id, s)  => invocar('auth:alterarStatus', id, s),
  // Cargos e Permissões (Etapa 11.3)
  cargoslistar:   ()       => invocar('cargos:listar'),
  cargosmodulos:  ()       => invocar('cargos:modulos'),
  cargoscriar:    (d)      => invocar('cargos:criar', d),
  cargoseditar:   (id, d)  => invocar('cargos:editar', id, d),
  cargosexcluir:  (id)     => invocar('cargos:excluir', id),
  // Compra de Aparelhos
  compracriar:    (d)      => invocar('compra:criar', d),
  compraatualizar:(n,d)    => invocar('compra:atualizar', n, d),
  compralistar:   ()       => invocar('compra:listar'),
  compraobterpornumero: (n) => invocar('compra:obter', n),
  comprabuscar:   (f)      => invocar('compra:buscar', f),
  compraexcluir:  (n,u)    => invocar('compra:excluir', n, u),
  compragerarpdf: (n)      => invocar('compra:gerarPdf', n),
  compraabrirpdf: (c)      => invocar('compra:abrirPdf', c),
  // Entregas (App Celular — comprovante de retirada + garantia). Leitura
  // via lote (loteimportardocelular) OU criação individual no PC — ver
  // bloco "Nova Entrega" abaixo.
  entregalistar:      ()   => invocar('entrega:listar'),
  entregaobterporos:  (n, c)  => invocar('entrega:obterPorOS', n, c),
  entregalistarporos: (n) => invocar('entrega:listarPorOS', n),
  entregaeditar: (n, d, c) => invocar('entrega:editar', n, d, c),
  entregaatualizarrecebedor: (n, nome, u, c) => invocar('entrega:atualizarRecebedor', n, nome, u, c),
  entregaabrirpdf:    (c)  => invocar('entrega:abrirPdf', c),
  entregagerarpdf:    (n, c)  => invocar('entrega:gerarPdf', n, c),
  // Nova Entrega (Bloco 3 — criada no PC a partir de uma OS existente,
  // enviada para assinatura remota no celular).
  entregabuscaros:        (n)   => invocar('entrega:buscarOS', n),
  entregalistarpendentes: ()    => invocar('entrega:listarPendentes'),
  entregaobterpendenteporos: (n, c) => invocar('entrega:obterPendentePorOS', n, c),
  entregacriarpendente:   (n,d,u) => invocar('entrega:criarPendente', n, d, u),
  entregacriarnaoassinada: (n,d,u) => invocar('entrega:criarNaoAssinada', n, d, u),
  entregaexcluirpendente: (n,u,c) => invocar('entrega:excluirPendente', n, u, c),
  entregaexcluir: (n,u,c) => invocar('entrega:excluir', n, u, c),
  // Garantia (aba nova, criada manualmente no PC).
  garantiabuscaros:   (n)  => invocar('garantia:buscarOS', n),
  garantiatermospadrao: () => invocar('garantia:termosPadrao'),
  garantialistar:     ()   => invocar('garantia:listar'),
  garantiaobterporos: (n)  => invocar('garantia:obterPorOS', n),
  garantiasalvar:     (d)  => invocar('garantia:salvar', d),
  garantiagerarpdf:   (n)  => invocar('garantia:gerarPdf', n),
  garantiaabrirpdf:   (c)  => invocar('garantia:abrirPdf', c),
  garantiaexcluir:    (n)  => invocar('garantia:excluir', n),
  garantiaregistrarretorno: (n, d, u) => invocar('garantia:registrarRetorno', n, d, u),
  garantiaatualizarstatusretorno: (n, id, d, u) => invocar('garantia:atualizarStatusRetorno', n, id, d, u),
  // Peças e Componentes
  pecacriar:      (d)      => invocar('peca:criar', d),
  pecaatualizar:  (id, d)  => invocar('peca:atualizar', id, d),
  pecalistar:     ()       => invocar('peca:listar'),
  pecaobter:      (id)     => invocar('peca:obter', id),
  pecabuscar:     (f)      => invocar('peca:buscar', f),
  pecaexcluir:    (id, u)  => invocar('peca:excluir', id, u),
  pecamovimentar: (id, tipo, qtd, detalhes) => invocar('peca:movimentar', id, tipo, qtd, detalhes),
  pecabaixarestoque: (id, qtd, os, u) => invocar('peca:baixarEstoque', id, qtd, os, u),
  pecastats:      ()       => invocar('peca:stats'),
  pecacategorias: ()       => invocar('peca:categorias'),
  estoquedashboard: ()     => invocar('estoque:dashboardCompleto'),
  modeloslistar:  ()       => invocar('modelos:listar'),
  modelosregistrar: (m)    => invocar('modelos:registrar', m),
  // Orçamentos
  orccriar:       (d)      => invocar('orc:criar', d),
  orcatualizar:   (n, d)   => invocar('orc:atualizar', n, d),
  orclistar:      ()       => invocar('orc:listar'),
  orcobter:       (n)      => invocar('orc:obter', n),
  orcbuscar:      (t)      => invocar('orc:buscar', t),
  orcexcluir:     (n, u)   => invocar('orc:excluir', n, u),
  orcconverter:   (n, ex)  => invocar('orc:converterEmOS', n, ex),
  // Histórico cliente
  clientehistorico: (cpf, nome) => invocar('cliente:historico', cpf, nome),
  // Aba Clientes (agregação OS + Vendas + Compras)
  clienteslistar:   ()     => invocar('clientes:listar'),
  clientesbuscar:   (t)    => invocar('clientes:buscar', t),
  clientesperfil:   (ch)   => invocar('clientes:perfil', ch),
  clientesatualizardados: (ch, dados, usuario) => invocar('clientes:atualizarDados', ch, dados, usuario),
  clientesexcluir: (ch, usuario) => invocar('clientes:excluir', ch, usuario),
  // v20: Financeiro, cruzamento, WhatsApp
  // BUGFIX (achado durante o Prompt 3B): estas duas funções já eram chamadas
  // por renderer.js (carregarFinanceiro, aba Financeiro/DRE) mas nunca tinham
  // sido expostas aqui — a aba Financeiro estava quebrada silenciosamente
  // (o catch(e) engolia o TypeError e só logava no console).
  financeirorelatorio: (filtros) => invocar('financeiro:relatorio', filtros),
  financeiroexportarcsv: (filtros) => invocar('financeiro:exportarCsv', filtros),
  financeiroexportarpdf: () => invocar('financeiro:exportarPdf'),
  estoquecruza:        ()        => invocar('estoque:cruzarOS'),
  // v20: Pagamentos
  pagregistrar:        (d)               => invocar('pag:registrar', d),
  pagexcluir:          (id)              => invocar('pag:excluir', id),
  paglistar:           ()                => invocar('pag:listar'),
  pagbuscar:           (q)               => invocar('pag:buscar', q),
  pagobter:            (id)              => invocar('pag:obter', id),
  paganexar:           (id)              => invocar('pag:anexarComprovante', id),
  pagabrircomp:        (p)               => invocar('pag:abrirComprovante', p),
  paggerarpdf:         (id)              => invocar('pag:gerarComprovantePDF', id),
  paggerarpdfsilencioso: (id)            => invocar('pag:gerarComprovantePDFSilencioso', id),
  // Fase 6: confirmar pagamento presencial (botão na tela de edição da OS,
  // visível quando statusPagamento === 'Aguardando Pagamento na Retirada')
  osconfirmarpagamentopresencial: apiOS.confirmarPagamentoPresencial,
  // Comprovante inline na OS (base64)
  pagobtercomprovantedaos: (osNumero)    => invocar('pag:obterComprovanteDaOS', osNumero),
  // v24: Cobranças (pendentes — Aguardando/Pago)
  cobrancaregistrar:   (d)               => invocar('cobranca:registrar', d),
  cobrancalistar:      ()                => invocar('cobranca:listar'),
  cobrancabuscar:      (q)               => invocar('cobranca:buscar', q),
  cobrancaatualizar:   (id, d)           => invocar('cobranca:atualizar', id, d),
  // v40.2: Mercado Pago — testar conexão do token (botão em Configurações)
  mptestarconexao:     (token)             => invocar('mp:testarConexao', token),
  // v24: Gerar link MP+Pix sem abrir browser
  mpgerarpayload:      (num, val)        => invocar('mp:gerarPayload', num, val),
  // v24: Verificar pagamento MP por número de OS
  mpverificarpag:      (num)             => invocar('mp:verificarPagamento', num),
  // v36: Painel Financeiro (Mercado Pago) — dados reais da API + saldo estimado local
  mpobterpainelfinanceiro: (periodo)     => invocar('mp:obterPainelFinanceiro', periodo),
  // v36: Reembolsos — registro manual vinculado a um pagamento
  reembolsoregistrar:  (dados)           => invocar('reembolso:registrar', dados),
  reembolsolistar:     ()                => invocar('reembolso:listar'),
  reembolsolistarporpagamento: (id)      => invocar('reembolso:listarPorPagamento', id),

  // ─── v25: WhatsApp Baileys (substituição do WappFly) ────────────────────
  //
  // RETROCOMPATIBILIDADE: wappflyenviar continua funcionando — chama Baileys por baixo.
  // Todo o renderer.js existente (parte 1 e parte 2) usa wappflyenviar sem alteração.
  wappflyenviar:       (tel, msg)        => invocar('whatsapp:enviar', tel, msg),

  // Novos canais Baileys — usados pelo renderer-whatsapp.js (painel de QR/status)
  wappstatus:          ()                => invocar('whatsapp:status'),
  wappdesconectar:     ()                => invocar('whatsapp:desconectar'),
  wappreconectar:      ()                => invocar('whatsapp:reconectar'),

  // Listeners de eventos push (main → renderer)
  onwappqr:     (cb) => assinar('whatsapp:qr',     (_e, d) => cb(d)),
  onwappstatus: (cb) => assinar('whatsapp:status', (_e, d) => cb(d)),

  // v46: notificação de fallback da IA (classificação caiu no fallback por
  // erro real — rede, timeout, chave inválida — nunca quando desligada de
  // propósito). Uso no renderer: window.api.oniaClassificacaoFallback(dados => { ... })
  oniaClassificacaoFallback: (cb) => assinar('ia:classificacaoFallback', (_e, d) => cb(d)),

  // ─── Auto-poll Mercado Pago — evento emitido pelo main quando confirma pagamento ──
  // Uso no renderer: window.api.onMpPagamentoConfirmado(dados => { ... })
  onMpPagamentoConfirmado: (cb) => assinar('mp:pagamentoConfirmado', (_e, d) => cb(d)),

  // ─── v25.1: Mensagens automáticas (cobrança, pagamento e entrega) ────────
  //
  // Cada canal recebe um objeto { telefone, os, config } e retorna
  // { sucesso: boolean, erro?: string }.
  //
  // O processo principal monta a mensagem via mensagens-whatsapp.js e envia.
  //
  // wappenviaraprovacao  → pede autorização do orçamento (SIM/NÃO) + PDF, sem link de pagamento
  // wappenviarcobranca   → template de cobrança com valor, prazo, link MP e Pix
  // wappenviarpagconf    → template de pagamento confirmado
  // wappenviarentregue   → template de entrega com link de avaliação do Google
  wappenviaraprovacao: (dados) => invocar('whatsapp:enviarAguardandoAprovacao', dados),
  wappenviarcobranca:  (dados) => invocar('whatsapp:enviarCobranca', dados),
  wappenviarpagconf:   (dados) => invocar('whatsapp:enviarPagamentoConfirmado', dados),
  wappenviarentregue:  (dados) => invocar('whatsapp:enviarEntregue', dados),
  wappenviargarantia:  (dados) => invocar('whatsapp:enviarGarantia', dados),
  wappenviarretirada:  (dados) => invocar('whatsapp:enviarProntoRetirada', dados),
  // Fase 5 — "Pronto para Retirada" já com cobrança (valor + link Mercado Pago)
  wappenviarretiradacomcobranca: (dados) => invocar('whatsapp:enviarProntoRetiradaComCobranca', dados),

  // ─── Notificações legadas (fallback wa.me via browser) ──────────────────
  // notificacao:whatsappOS    → abre wa.me com mensagem de pronto-para-retirada (sem link)
  // notificacao:whatsappOSML  → abre wa.me com mensagem de pronto-para-retirada + link MP
  // notifwhatsapp é o alias usado no renderer como fallback quando o modal MP não existe
  notifwhatsapp:       (num)             => invocar('notificacao:whatsappOS', num),
  notifwhatsappml:     (num, val, link)  => invocar('notificacao:whatsappOSML', num, val, link),

  // ─── v28: Log de mensagens WhatsApp ─────────────────────────────────────
  // wapplogregistrar    → salva um registro de envio (sucesso ou erro)
  // wapploglistar       → lista todos os registros (mais recentes primeiro)
  // wapplogbuscar       → filtra por nome/telefone/OS
  // wapplogporcliente   → agrupa por cliente (telefone), com contagem e últimas mensagens
  wapplogregistrar:   (dados) => invocar('wapplog:registrar', dados),
  wapploglistar:      ()      => invocar('wapplog:listar'),
  wapplogbuscar:      (q)     => invocar('wapplog:buscar', q),
  wapplogporcliente:  (q)     => invocar('wapplog:porCliente', q),
  // wapplogatualizarnomecliente → renomeia o cliente por telefone (log + OS),
  // usado pelo lápis de editar nome nas abas Mensagens e Conversas.
  wapplogatualizarnomecliente: (telefone, novoNome) => invocar('wapplog:atualizarNomeCliente', telefone, novoNome),
  // wapplogexcluirmensagem → apaga uma mensagem do histórico (por id)
  wapplogexcluirmensagem: (id, usuario) => invocar('wapplog:excluirMensagem', id, usuario),
  // wapplogexcluirporelefone → apaga todas as mensagens de um contato (por telefone)
  wapplogexcluirporelefone: (telefone, usuario) => invocar('wapplog:excluirPorTelefone', telefone, usuario),

  // ── v40.2: Log de classificação por IA (Groq) ──────────────────────────
  // ialoglistar      → lista os registros de classificação (mais recentes primeiro)
  // ialogbuscar      → filtra por nome/telefone/OS/rótulo/texto
  // ialogcontadores  → totais rápidos (quantos vieram da IA vs quantos caíram em fallback)
  // iatestarconexao  → testa uma chave da Groq em tempo real (usado no botão "Testar Conexão")
  ialoglistar:        ()      => invocar('ialog:listar'),
  ialogbuscar:        (q)     => invocar('ialog:buscar', q),
  ialogcontadores:    ()      => invocar('ialog:contadores'),
  iatestarconexao:    (chave, tipo, provedor, modelo) => invocar('ia:testarConexao', chave, tipo, provedor, modelo),
  // v41 — chatbot flutuante: pergunta em linguagem natural + histórico da conversa
  iaperguntar:        (pergunta, historico) => invocar('ia:perguntar', pergunta, historico),
  // v42 — chatbot: executa uma ação sobre OS (criar/alterar status/excluir)
  // SÓ depois que o usuário confirmou explicitamente na interface do chat.
  // senhaExclusao só é usada (e obrigatória) quando acao.tipo === 'excluir_os'.
  iaexecutaracao:     (acao, usuario, senhaExclusao) => invocar('ia:executarAcao', acao, usuario, senhaExclusao),

  // ─── v40: Aba Conversas (classificação automática das respostas) ────────
  // Reaproveita listarConversasPorClassificacao / listarConversasNaoEntendidas /
  // contarConversasPorClassificacao já existentes em db.js — nenhuma lógica
  // nova de automação é criada.
  conversasporclassificacao: (classificacao) => invocar('conversas:porClassificacao', classificacao),
  conversasnaoentendidas:    ()              => invocar('conversas:naoEntendidas'),
  conversasaguardandohumano: ()              => invocar('conversas:aguardandoHumano'),
  conversaspagamentonaretirada: ()           => invocar('conversas:pagamentoNaRetirada'),
  conversascontadores:       ()              => invocar('conversas:contadores'),

  // ─── Atualização pelo GitHub Releases ───────────────────────────────────
  updateVerificar:     ()              => invocar('update:verificar'),
  updateEstado:        ()              => invocar('update:estado'),
  updateInstalar:      ()              => invocar('update:instalar'),
  updateVersaoAtual:   ()              => invocar('update:versaoAtual'),
  onupdateStatus:      (cb)            => assinar('update:status', (_e, dados) => cb(dados)),
  };

  const apiEstoque = {
    criar: apiLegada.estoquecriar,
    atualizar: apiLegada.estoqueatualizar,
    listar: apiLegada.estoquelistar,
    obter: apiLegada.estoqueobter,
    buscar: apiLegada.estoquebuscar,
    estatisticas: apiLegada.estoquestats,
    excluir: apiLegada.estoqueexcluir,
    painel: apiLegada.estoquedashboard
  };
  const apiFinanceiro = {
    relatorio: apiLegada.financeirorelatorio,
    exportarCsv: apiLegada.financeiroexportarcsv,
    exportarPdf: apiLegada.financeiroexportarpdf,
    cruzarEstoque: apiLegada.estoquecruza,
    registrarPagamento: apiLegada.pagregistrar,
    listarPagamentos: apiLegada.paglistar,
    buscarPagamentos: apiLegada.pagbuscar,
    gerarPayloadMercadoPago: apiLegada.mpgerarpayload,
    verificarPagamentoMercadoPago: apiLegada.mpverificarpag,
    listarCobrancas: apiLegada.cobrancalistar
  };
  const apiMobile = {
    importarOS: apiLegada.osimportardocelular,
    importarLote: apiLegada.loteimportardocelular,
    exportarAssinatura: apiLegada.assinaturaexportar,
    importarRespostaAssinatura: apiLegada.assinaturaimportarresposta,
    statusSync: apiLegada.supabasestatus,
    sincronizarAgora: apiLegada.supabasesincronizaragora,
    aoSincronizar: apiLegada.onSupabaseSincronizado
  };
  const apiUsuarios = {
    login: apiLegada.authlogin,
    revalidar: apiLegada.authrevalidar,
    listar: apiLegada.authlistarusuarios,
    criar: apiLegada.authcriarusuario,
    editar: apiLegada.autheditar,
    alterarStatus: apiLegada.authalterarstatus,
    cargos: {
      listar: apiLegada.cargoslistar,
      criar: apiLegada.cargoscriar,
      editar: apiLegada.cargoseditar,
      excluir: apiLegada.cargosexcluir
    }
  };
  const apiWhatsApp = {
    enviar: apiLegada.wappflyenviar,
    status: apiLegada.wappstatus,
    desconectar: apiLegada.wappdesconectar,
    reconectar: apiLegada.wappreconectar,
    enviarAprovacao: apiLegada.wappenviaraprovacao,
    enviarCobranca: apiLegada.wappenviarcobranca,
    enviarPagamentoConfirmado: apiLegada.wappenviarpagconf,
    enviarEntregue: apiLegada.wappenviarentregue,
    logs: {
      listar: apiLegada.wapploglistar,
      buscar: apiLegada.wapplogbuscar,
      porCliente: apiLegada.wapplogporcliente
    }
  };
  const apiSistema = {
    configuracao: {
      obter: apiLegada.configobter,
      termosResolvidos: apiLegada.configtermosresolvidos,
      salvar: apiLegada.configsalvar,
      verificarSenhaExclusao: apiLegada.configverificarsenhaexclusao
    },
    backup: {
      exportar: apiLegada.backupexportar,
      importar: apiLegada.backupimportar,
      fazerAgora: apiLegada.backupfazeragora,
      listarAutomaticos: apiLegada.backuplistarauto
    },
    licenca: {
      obter: apiLegada.licencaobter,
      verificar: apiLegada.licencaverificar,
      ativar: apiLegada.licencaativar
    },
    atualizacao: {
      verificar: apiLegada.updateVerificar,
      estado: apiLegada.updateEstado,
      instalar: apiLegada.updateInstalar,
      versaoAtual: apiLegada.updateVersaoAtual,
      onStatus: apiLegada.onupdateStatus
    }
  };

  return {
    ...apiLegada,
    os: apiOS,
    estoque: apiEstoque,
    financeiro: apiFinanceiro,
    mobile: apiMobile,
    usuarios: apiUsuarios,
    whatsapp: apiWhatsApp,
    sistema: apiSistema
  };
}

module.exports = { criarApiPublica };
