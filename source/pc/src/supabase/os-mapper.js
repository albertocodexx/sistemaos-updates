const STATUS_SUPABASE = new Set([
  'Aguardando análise', 'Em diagnóstico', 'Aguardando aprovação',
  'Aguardando peça', 'Em reparo', 'Em testes', 'Pronto para retirada',
  'Entregue', 'Cancelado'
]);

const PRIORIDADES = new Set(['Baixa', 'Normal', 'Alta', 'Urgente']);
const { normalizarLembretes, normalizarExclusoes } = require('./cobrancas-sync');

function texto(valor) {
  return valor === null || valor === undefined ? '' : String(valor);
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function dataSomente(valor) {
  if (!valor) return '';
  const s = String(valor);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function horaSomente(valor) {
  if (!valor) return '';
  return String(valor).slice(0, 5);
}

function limparObjeto(valor) {
  if (Array.isArray(valor)) return valor.map(limparObjeto);
  if (!valor || typeof valor !== 'object') return valor;
  const resultado = {};
  for (const [chave, item] of Object.entries(valor)) {
    // Metadados de arquivo pertencem ao Storage e não entram em dados_extras.
    if (/base64|pdfPath|path|url|publicId|resourceType|provider|provedor/i.test(chave)) continue;
    resultado[chave] = limparObjeto(item);
  }
  return resultado;
}

function idExportacaoDaOS(os, deviceKey) {
  return texto(os?.origemIdExportacao || os?.idExportacao || os?.idEnvioAssinatura)
    || `desktop:${deviceKey}:os:${texto(os?.numero)}`;
}

function statusPagamentoCompativelSupabase(valor) {
  if (valor === 'Pago') return 'Autorizado';
  if (valor === 'Pago 50%') return 'Aguardando Pagamento na Retirada';
  return texto(valor);
}

function localParaSupabase(os, deviceKey) {
  const aparelho = os?.aparelho || {};
  const diagnostico = os?.diagnosticoTecnico || {};
  const dadosExtras = limparObjeto({
    origem_local: os?.origem || 'pc',
    cliente_id_numero: texto(os?.cliente?.clienteId),
    cliente_email: os?.cliente?.email || '',
    tipo_equipamento: aparelho.tipoEquipamento || aparelho.tipo || '',
    aparelho_observacoes: aparelho.observacoes || '',
    dados_equipamento: aparelho.dadosEquipamento || {},
    diagnostico_solucao: diagnostico.solucao || '',
    diagnostico_pecas: diagnostico.pecas || '',
    diagnostico_prazo: diagnostico.prazoEstimado || '',
    controle_interno: os?.controleInterno || {},
    tecnico_responsavel: os?.tecnicoResponsavel || '',
    tecnico_auxiliar: os?.tecnicoAuxiliar || '',
    checklist_entrada: os?.checklistEntrada || [],
    observacoes_entrada: os?.observacoesEntrada || '',
    checklist_saida: os?.checklistSaida || [],
    observacoes_saida: os?.observacoesSaida || '',
    usar_mercado_pago_aprovacao: os?.usarMercadoPagoAprovacao === true,
    exigir_entrada_50_aprovacao: os?.exigirEntrada50Aprovacao === true,
    valor_total_servico: numero(os?.valorTotalServico),
    valor_entrada_aprovacao: numero(os?.valorEntradaAprovacao),
    entrada_50_paga: os?.entrada50Paga === true,
    percentual_pagamento_aguardado: numero(os?.percentualPagamentoAguardado),
    percentual_pagamento_confirmado: numero(os?.percentualPagamentoConfirmado),
    valor_recebido_confirmado: numero(os?.valorRecebidoConfirmado),
    valor_recebido_base_cobrancas: numero(os?.valorRecebidoBaseCobrancas),
    modalidade_pagamento_aprovacao: texto(os?.modalidadePagamentoAprovacao),
    modalidade_parcela_1: texto(os?.modalidadeParcela1),
    modalidade_parcela_2: texto(os?.modalidadeParcela2),
    valor_restante_servico: numero(os?.valorRestanteServico),
    contexto_forma_pagamento: os?.contextoFormaPagamento || '',
    status_aprovacao: os?.statusAprovacao || 'Pendente',
    status_pagamento_local: os?.statusPagamento || '',
    lembretes_cobranca: normalizarLembretes(os?.lembretesCobranca),
    lembretes_cobranca_excluidos: normalizarExclusoes(os?.lembretesCobrancaExcluidos),
    sem_prazo: os?.semPrazo === true
  });

  return {
    idExportacao: idExportacaoDaOS(os, deviceKey),
    dados: {
      cliente_nome_snapshot: texto(os?.cliente?.nome) || 'Cliente não informado',
      cliente_telefone_snapshot: texto(os?.cliente?.telefone),
      cliente_cpf_snapshot: texto(os?.cliente?.cpf),
      aparelho: [aparelho.marca, aparelho.modelo].filter(Boolean).join(' '),
      marca: texto(aparelho.marca),
      modelo: texto(aparelho.modelo),
      cor: texto(aparelho.cor),
      imei: texto(os?.imei || aparelho.imei),
      senha_aparelho: texto(aparelho.senhaAparelho),
      acessorios: texto(aparelho.acessorios),
      estado_aparelho: texto(aparelho.observacoes),
      defeito_relatado: texto(aparelho.defeitoRelatado) || 'Não informado',
      diagnostico: texto(diagnostico.diagnostico),
      servico_realizado: texto(diagnostico.solucao),
      observacoes: texto(os?.observacoes),
      termos: texto(os?.termos),
      status: STATUS_SUPABASE.has(os?.status) ? os.status : 'Aguardando análise',
      prioridade: PRIORIDADES.has(os?.prioridade) ? os.prioridade : 'Normal',
      valor: numero(diagnostico.valorEstimado || os?.valor),
      forma_pagamento: texto(os?.formaPagamento),
      // Mantém compatibilidade com bancos Supabase que ainda possuem a
      // constraint antiga; o estado canônico segue em dados_extras.
      status_pagamento: statusPagamentoCompativelSupabase(os?.statusPagamento),
      garantia_dias: Math.max(0, Math.trunc(numero(os?.garantiaDias))),
      data_abertura: os?.data || new Date().toISOString(),
      data_prevista: dataSomente(os?.dataPrevista),
      hora_prevista: horaSomente(os?.horaPrevista),
      dados_extras: dadosExtras
    }
  };
}

function remotoParaLocal(linha, existente) {
  const atual = existente || {};
  const extra = linha?.dados_extras && typeof linha.dados_extras === 'object' ? linha.dados_extras : {};
  const historico = Array.isArray(atual.historicoStatus) ? [...atual.historicoStatus] : [];
  if (linha.status && linha.status !== atual.status) {
    historico.push({ status: linha.status, data: linha.updated_at || new Date().toISOString(), origem: 'supabase' });
  }
  return Object.assign({}, atual, {
    numero: linha.numero,
    data: linha.data_abertura || atual.data || new Date().toISOString(),
    status: linha.status || atual.status || 'Aguardando análise',
    statusPagamento: extra.status_pagamento_local
      || (linha.status_pagamento === 'Autorizado' ? 'Pago' : (linha.status_pagamento ?? atual.statusPagamento ?? '')),
    statusAprovacao: extra.status_aprovacao
      || (linha.status_pagamento === 'Autorizado' ? 'Aprovado' : (atual.statusAprovacao || 'Pendente')),
    historicoStatus: historico.length ? historico : [{ status: linha.status || 'Aguardando análise', data: linha.created_at || new Date().toISOString() }],
    semPrazo: extra.sem_prazo === true || (!linha.data_prevista && !linha.hora_prevista),
    dataPrevista: extra.sem_prazo === true ? '' : (dataSomente(linha.data_prevista) || atual.dataPrevista || ''),
    horaPrevista: extra.sem_prazo === true ? '' : (horaSomente(linha.hora_prevista) || atual.horaPrevista || ''),
    prioridade: linha.prioridade || atual.prioridade || 'Normal',
    cliente: Object.assign({}, atual.cliente || {}, {
      nome: linha.cliente_nome_snapshot || atual.cliente?.nome || '',
      telefone: linha.cliente_telefone_snapshot || atual.cliente?.telefone || '',
      cpf: linha.cliente_cpf_snapshot || atual.cliente?.cpf || '',
      email: extra.cliente_email || atual.cliente?.email || '',
      clienteId: extra.cliente_id_numero || atual.cliente?.clienteId || ''
    }),
    aparelho: Object.assign({}, atual.aparelho || {}, {
      tipoEquipamento: extra.tipo_equipamento || atual.aparelho?.tipoEquipamento || 'Smartphone',
      marca: linha.marca || atual.aparelho?.marca || '',
      modelo: linha.modelo || atual.aparelho?.modelo || '',
      cor: linha.cor || atual.aparelho?.cor || '',
      imei: linha.imei || atual.aparelho?.imei || '',
      senhaAparelho: linha.senha_aparelho || atual.aparelho?.senhaAparelho || '',
      acessorios: linha.acessorios || atual.aparelho?.acessorios || '',
      observacoes: linha.estado_aparelho || extra.aparelho_observacoes || atual.aparelho?.observacoes || '',
      defeitoRelatado: linha.defeito_relatado || atual.aparelho?.defeitoRelatado || '',
      dadosEquipamento: extra.dados_equipamento || atual.aparelho?.dadosEquipamento || {}
    }),
    imei: linha.imei || atual.imei || '',
    observacoes: linha.observacoes ?? atual.observacoes ?? '',
    termos: linha.termos ?? atual.termos ?? '',
    assinaturaPendente: extra.assinatura_pendente === true,
    naoAssinado: extra.nao_assinado === true,
    garantiaDias: Number(linha.garantia_dias) || atual.garantiaDias || 0,
    formaPagamento: linha.forma_pagamento ?? atual.formaPagamento ?? null,
    diagnosticoTecnico: Object.assign({}, atual.diagnosticoTecnico || {}, {
      diagnostico: linha.diagnostico || atual.diagnosticoTecnico?.diagnostico || '',
      solucao: linha.servico_realizado || extra.diagnostico_solucao || atual.diagnosticoTecnico?.solucao || '',
      pecas: extra.diagnostico_pecas || atual.diagnosticoTecnico?.pecas || '',
      prazoEstimado: extra.diagnostico_prazo || atual.diagnosticoTecnico?.prazoEstimado || '',
      valorEstimado: numero(linha.valor)
    }),
    controleInterno: Object.assign({}, atual.controleInterno || {}, extra.controle_interno || {}),
    tecnicoResponsavel: extra.tecnico_responsavel || atual.tecnicoResponsavel || '',
    tecnicoAuxiliar: extra.tecnico_auxiliar || atual.tecnicoAuxiliar || '',
    checklistEntrada: extra.checklist_entrada || atual.checklistEntrada || [],
    observacoesEntrada: extra.observacoes_entrada ?? atual.observacoesEntrada ?? '',
    checklistSaida: extra.checklist_saida || atual.checklistSaida || [],
    observacoesSaida: extra.observacoes_saida ?? atual.observacoesSaida ?? '',
    usarMercadoPagoAprovacao: extra.usar_mercado_pago_aprovacao !== undefined
      ? extra.usar_mercado_pago_aprovacao === true
      : atual.usarMercadoPagoAprovacao === true,
    exigirEntrada50Aprovacao: extra.exigir_entrada_50_aprovacao !== undefined
      ? extra.exigir_entrada_50_aprovacao === true
      : atual.exigirEntrada50Aprovacao === true,
    valorTotalServico: numero(extra.valor_total_servico ?? atual.valorTotalServico),
    valorEntradaAprovacao: numero(extra.valor_entrada_aprovacao ?? atual.valorEntradaAprovacao),
    entrada50Paga: extra.entrada_50_paga !== undefined
      ? extra.entrada_50_paga === true
      : atual.entrada50Paga === true,
    percentualPagamentoAguardado: numero(extra.percentual_pagamento_aguardado ?? atual.percentualPagamentoAguardado),
    percentualPagamentoConfirmado: numero(extra.percentual_pagamento_confirmado ?? atual.percentualPagamentoConfirmado),
    valorRecebidoConfirmado: numero(extra.valor_recebido_confirmado ?? atual.valorRecebidoConfirmado),
    valorRecebidoBaseCobrancas: numero(extra.valor_recebido_base_cobrancas ?? atual.valorRecebidoBaseCobrancas),
    modalidadePagamentoAprovacao: extra.modalidade_pagamento_aprovacao ?? atual.modalidadePagamentoAprovacao ?? '',
    modalidadeParcela1: extra.modalidade_parcela_1 ?? atual.modalidadeParcela1 ?? '',
    modalidadeParcela2: extra.modalidade_parcela_2 ?? atual.modalidadeParcela2 ?? '',
    valorRestanteServico: numero(extra.valor_restante_servico ?? atual.valorRestanteServico),
    contextoFormaPagamento: extra.contexto_forma_pagamento ?? atual.contextoFormaPagamento ?? '',
    lembretesCobranca: normalizarLembretes(Array.isArray(extra.lembretes_cobranca)
      ? extra.lembretes_cobranca
      : (atual.lembretesCobranca || [])),
    lembretesCobrancaExcluidos: normalizarExclusoes(Array.isArray(extra.lembretes_cobranca_excluidos)
      ? extra.lembretes_cobranca_excluidos
      : (atual.lembretesCobrancaExcluidos || [])),
    fotos: atual.fotos || [],
    pdfPath: atual.pdfPath || '',
    assinaturaClienteBase64: atual.assinaturaClienteBase64 || '',
    assinaturaAssistenciaBase64: atual.assinaturaAssistenciaBase64 || '',
    origem: atual.origem || (linha.origem === 'android' ? 'celular' : 'pc'),
    origemIdExportacao: linha.id_exportacao || atual.origemIdExportacao || null,
    supabaseId: linha.id,
    supabaseRevision: Number(linha.revision) || 1,
    supabaseUpdatedAt: linha.updated_at || '',
    supabaseSincronizadoEm: new Date().toISOString()
  });
}

module.exports = {
  localParaSupabase,
  remotoParaLocal,
  idExportacaoDaOS,
  limparObjeto,
  STATUS_SUPABASE,
  PRIORIDADES
};
