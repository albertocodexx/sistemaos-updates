const crypto = require('crypto');

const CAMPOS_ENTREGA = ['numeroOS', 'documentoEntregaId', 'cicloEntregaId', 'tipoEntrega', 'retornoGarantiaId', 'garantiaId', 'clienteId', 'clienteNumero', 'nomeRetirou', 'cpfRetirou', 'telefoneRetirou', 'marca', 'modelo', 'reparoRealizado', 'valorReparo', 'formaPagamento', 'declaracao', 'dataHoraAssinatura', 'garantiaDias', 'garantiaDataInicio', 'dataLimiteGarantia', 'termosGarantia', 'assinaturaPendente', 'naoAssinado'];
const CAMPOS_GARANTIA = ['numeroOS', 'clienteId', 'clienteNumero', 'clienteNome', 'clienteTelefone', 'clienteCpf', 'marca', 'modelo', 'imei', 'servicoRealizado', 'garantiaDias', 'dataInicio', 'dataLimite', 'termos', 'origem', 'retornosGarantia', 'retornoAtualId', 'statusRetorno'];
const limpar = (d, campos) => Object.fromEntries(campos.map(c => [c, d?.[c] ?? null]));
const hash = d => crypto.createHash('sha256').update(JSON.stringify(d)).digest('hex');
const dia = valor => String(valor || '').slice(0, 10) || null;

function garantiaRemota(linha) {
  return {
    ...(linha.dados_extras || {}), numeroOS: linha.numero_os_snapshot,
    clienteNome: linha.cliente_nome_snapshot, clienteTelefone: linha.cliente_telefone_snapshot || '',
    marca: linha.marca_snapshot || '', modelo: linha.modelo_snapshot || '', imei: linha.imei_snapshot || '',
    servicoRealizado: linha.reparo_realizado || '', garantiaDias: linha.garantia_dias,
    dataInicio: linha.data_abertura + 'T12:00:00', dataLimite: linha.data_limite || '', termos: linha.termos || '',
    supabaseId: linha.id, supabaseRevision: linha.revision
  };
}

// Os registros continuam disponíveis offline. O hash só é confirmado após o
// servidor aceitar a revisão; conflitos nunca sobrescrevem dados silenciosamente.
class AftercareService {
  constructor({ getClient, getContext, db, stateStore }) {
    Object.assign(this, { getClient, getContext, db, stateStore });
    this.ultimasConsultas = new Map();
  }
  registrarExclusao(tipo, numero, cicloEntregaId, supabaseId) {
    if (!this.getContext()?.empresa_id) return;
    const ciclo = tipo === 'entrega' ? String(cicloEntregaId || 'original') : '';
    this.stateStore.alterar(s => {
      s.posAtendimentoExclusoes ||= {};
      s.posAtendimentoExclusoes[this._chave(tipo, numero, ciclo)] = { tipo, numero, cicloEntregaId: ciclo, supabaseId: supabaseId || null };
    });
    this.ultimasConsultas.clear();
  }
  _ciclo(registro) { return String(registro?.cicloEntregaId || registro?.retornoGarantiaId || 'original'); }
  _chave(tipo, numero, cicloEntregaId) {
    return this.getContext().empresa_id + ':' + tipo + ':' + numero + (tipo === 'entrega' ? ':' + String(cicloEntregaId || 'original') : '');
  }
  _confirmar(tipo, registro, linha) {
    const dados = limpar(registro, tipo === 'entrega' ? CAMPOS_ENTREGA : CAMPOS_GARANTIA);
    this.stateStore.alterar(s => {
      s.posAtendimento = s.posAtendimento || {};
      s.posAtendimento[this._chave(tipo, registro.numeroOS, tipo === 'entrega' ? this._ciclo(registro) : '')] = { hash: hash(dados), id: linha.id, revision: linha.revision, atualizadoEm: linha.updated_at };
    });
  }
  recebeuEntrega(numero, linha) {
    const local = this.db.obterEntregaPorNumeroOS(numero, linha?.ciclo_entrega_id || linha?.retorno_garantia_id || 'original');
    if (local) this._confirmar('entrega', local, linha);
  }
  async _listar(tabela) {
    const lista = [];
    for (let inicio = 0; ; inicio += 200) {
      const r = await this.getClient().from(tabela).select('*').eq('empresa_id', this.getContext().empresa_id).is('deleted_at', null).order('id').range(inicio, inicio + 199);
      if (r.error) throw r.error;
      lista.push(...(r.data || []));
      if ((r.data || []).length < 200) return lista;
    }
  }
  async sincronizar(tipo) {
    const tabela = tipo === 'entrega' ? 'entregas' : 'garantias';
    const campos = tipo === 'entrega' ? CAMPOS_ENTREGA : CAMPOS_GARANTIA;
    const locais = tipo === 'entrega' ? this.db.listarEntregas() : this.db.listarGarantias();
    const chaveConsulta = this._chave(tipo, '*');
    const fingerprint = hash(locais.map(d => limpar(d, campos)));
    const ultima = this.ultimasConsultas.get(chaveConsulta);
    if (ultima?.hash === fingerprint && Date.now() - ultima.em < 60000) return { enviados: 0, recebidos: 0 };
    const remotas = await this._listar(tabela);
    let enviados = 0, recebidos = 0;
    for (const [chave, exclusao] of Object.entries(this.stateStore.obter().posAtendimentoExclusoes || {})) {
      if (chave !== this._chave(tipo, exclusao.numero, exclusao.cicloEntregaId)) continue;
      const remoto = remotas.find(r => exclusao.supabaseId ? r.id === exclusao.supabaseId : (
        r.numero_os_snapshot === exclusao.numero && (tipo !== 'entrega' || String(r.ciclo_entrega_id || r.retorno_garantia_id || 'original') === String(exclusao.cicloEntregaId || 'original'))
      ));
      if (remoto) {
        const r = await this.getClient().rpc('salvar_pos_atendimento', { p_tipo: tipo, p_id: remoto.id, p_revision: remoto.revision, p_excluir: true });
        if (r.error) throw r.error;
        if (!r.data) throw new Error('Este documento mudou antes da exclusão. Tente sincronizar novamente.');
        remotas.splice(remotas.indexOf(remoto), 1);
        enviados++;
      }
      this.stateStore.alterar(s => { delete s.posAtendimentoExclusoes[chave]; });
    }
    for (const local of locais) {
      const cicloLocal = tipo === 'entrega' ? this._ciclo(local) : '';
      const remoto = remotas.find(r => local.supabaseId ? r.id === local.supabaseId : (
        r.numero_os_snapshot === local.numeroOS && (tipo !== 'entrega' || String(r.ciclo_entrega_id || r.retorno_garantia_id || 'original') === cicloLocal)
      ));
      const anterior = this.stateStore.obter().posAtendimento?.[this._chave(tipo, local.numeroOS, cicloLocal)];
      const dados = limpar(local, campos);
      const alterado = anterior && anterior.hash !== hash(dados);
      // Primeira reconciliação: a cópia já compartilhada prevalece. Não
      // substituir um registro do celular por um backup antigo do PC.
      if (remoto && !anterior) { this._confirmar(tipo, local, remoto); continue; }
      if (remoto && !alterado) continue;
      if (!remoto && anterior) continue; // exclusão remota, não ressuscitar
      if (remoto && Number(remoto.revision) !== Number(anterior.revision)) {
        throw new Error(`A ${tipo} ${local.numeroOS} foi alterada em outro aparelho. Reabra o documento antes de salvar novamente.`);
      }
      const osLocal = this.db.obterOSPorNumero(local.numeroOS);
      const ordemId = this.stateStore.obter().mapeamentosOS?.[local.numeroOS]?.id || osLocal?.supabaseId;
      if (!ordemId) continue; // a OS precisa ser publicada primeiro
      const vinculo = { empresa_id: this.getContext().empresa_id, ordem_servico_id: ordemId, numero_os_snapshot: local.numeroOS };
      let payload;
      if (tipo === 'entrega') {
        payload = { ...vinculo, cliente_nome_snapshot: osLocal?.cliente?.nome || local.nomeRetirou,
          retirado_por: local.nomeRetirou, documento_retirada: local.cpfRetirou, marca_snapshot: local.marca, modelo_snapshot: local.modelo,
          aparelho_snapshot: [local.marca, local.modelo].filter(Boolean).join(' '), reparo_realizado: local.reparoRealizado,
          status: local.assinaturaPendente ? 'pendente_assinatura' : 'concluida', entregue_em: local.dataHoraAssinatura,
          garantia_dias: local.garantiaDias, data_limite_garantia: dia(local.dataLimiteGarantia), observacoes: local.declaracao,
          valor_reparo: local.valorReparo || 0, forma_pagamento: local.formaPagamento,
          ciclo_entrega_id: cicloLocal, tipo_entrega: local.tipoEntrega || (cicloLocal === 'original' ? 'original' : 'retorno_garantia'),
          retorno_garantia_id: local.retornoGarantiaId || null, garantia_id: local.garantiaId || null,
          id_exportacao: remoto?.id_exportacao || `desktop-entrega-${ordemId}-${cicloLocal}`,
          dados_extras: { ...(remoto?.dados_extras || {}), documento_mobile: { ...(remoto?.dados_extras?.documento_mobile || {}), ...dados }, valor_total: local.valorReparo || 0 } };
      } else {
        payload = { ...vinculo, cliente_nome_snapshot: local.clienteNome || '', cliente_telefone_snapshot: local.clienteTelefone,
          aparelho_snapshot: [local.marca, local.modelo].filter(Boolean).join(' '), marca_snapshot: local.marca, modelo_snapshot: local.modelo,
          imei_snapshot: local.imei, reparo_realizado: local.servicoRealizado, termos: local.termos,
          garantia_dias: local.garantiaDias, data_abertura: dia(local.dataInicio), data_limite: dia(local.dataLimite), dados_extras: { ...(remoto?.dados_extras || {}), ...dados } };
      }
      const salvo = tipo === 'entrega'
        ? await this.getClient().rpc(remoto ? 'atualizar_entrega_mobile' : 'criar_entrega_mobile', remoto ? {
          p_id: remoto.id,
          p_revision: remoto.revision,
          p_dados: payload.dados_extras
        } : {
          p_id_exportacao: payload.id_exportacao,
          p_dados: payload.dados_extras,
          p_origem_dispositivo_id: null
        })
        : await this.getClient().rpc('salvar_pos_atendimento', { p_tipo: tipo, p_dados: payload, p_id: remoto?.id || null, p_revision: remoto?.revision || null });
      if (salvo.error) throw salvo.error;
      if (!salvo.data) throw new Error(`Conflito ao salvar ${tipo} ${local.numeroOS}. Sua alteração permanece neste PC.`);
      this._confirmar(tipo, local, salvo.data);
      if (tipo === 'entrega') this.stateStore.alterar(s => { s.documentosComerciais ||= {}; s.documentosComerciais['entrega:' + salvo.data.id] = salvo.data.updated_at; });
      enviados++;
    }
    if (tipo === 'garantia') {
      for (const remoto of enviados > 0 ? await this._listar(tabela) : remotas) {
        const local = this.db.obterGarantiaPorNumeroOS(remoto.numero_os_snapshot);
        const anterior = this.stateStore.obter().posAtendimento?.[this._chave(tipo, remoto.numero_os_snapshot)];
        if (local && anterior && anterior.atualizadoEm === remoto.updated_at && local.supabaseId === remoto.id) continue;
        if (local && anterior && anterior.hash !== hash(limpar(local, campos))) continue;
        const salvo = this.db.receberGarantiaRemota(garantiaRemota(remoto));
        this._confirmar(tipo, salvo, remoto);
        recebidos++;
      }
    }
    this.ultimasConsultas.set(chaveConsulta, { hash: fingerprint, em: Date.now() });
    return { enviados, recebidos };
  }
}
module.exports = { AftercareService, garantiaRemota, CAMPOS_ENTREGA, CAMPOS_GARANTIA };
