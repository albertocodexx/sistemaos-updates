const { createHash } = require('node:crypto');
function texto(valor) { return String(valor == null ? '' : valor).trim(); }

function estadoLocal(item) {
  if (item.assinaturaClienteBase64) return 'assinado';
  if (item.assinaturaPendente === true) return 'aguardando';
  return 'nao_assinado';
}

function paraPayload(item) {
  return {
    numero: item.numero,
    cliente: {
      id: item.supabaseClienteId || '',
      clienteId: item.cliente?.clienteId || null,
      nome: texto(item.cliente?.nome),
      telefone: texto(item.cliente?.telefone),
      cpf: texto(item.cliente?.cpf)
    },
    aparelho: {
      marca: texto(item.aparelho?.marca), modelo: texto(item.aparelho?.modelo),
      cor: texto(item.aparelho?.cor), imei: texto(item.aparelho?.imei)
    },
    tipoBloqueio: texto(item.tipoBloqueio),
    procedimentoPrevisto: texto(item.procedimentoPrevisto),
    observacoes: texto(item.observacoes),
    declaracaoTitularidade: item.declaracaoTitularidade === true,
    valor: Math.max(0, Number(item.valor) || 0),
    assinaturaEstado: estadoLocal(item),
    assinaturaClienteBase64: texto(item.assinaturaClienteBase64),
    idEnvioAssinatura: texto(item.idEnvioAssinatura),
    idExportacao: texto(item.origemIdExportacao || `desktop:${item.numero}`),
    origem: 'desktop'
  };
}

function fingerprint(item) {
  const dados = paraPayload(item);
  delete dados.origem;
  return createHash('sha256').update(JSON.stringify(dados)).digest('hex');
}

function paraLocal(linha, anterior) {
  const estado = texto(linha.assinatura_estado);
  return {
    ...(anterior || {}),
    numero: linha.numero,
    cliente: {
      ...(anterior?.cliente || {}),
      nome: linha.cliente_nome_snapshot || '', telefone: linha.cliente_telefone_snapshot || '',
      cpf: linha.cliente_cpf_snapshot || '', clienteId: Number(linha.cliente_numero_snapshot) || 0
    },
    aparelho: {
      ...(anterior?.aparelho || {}), marca: linha.marca || '', modelo: linha.modelo || '',
      cor: linha.cor || '', imei: linha.imei || ''
    },
    tipoBloqueio: linha.tipo_bloqueio || '', procedimentoPrevisto: linha.procedimento_previsto || '',
    observacoes: linha.observacoes || '', valor: Number(linha.valor) || 0,
    declaracaoTitularidade: true,
    assinaturaClienteBase64: linha.assinatura_cliente_base64 || '',
    assinaturaPendente: estado === 'aguardando', naoAssinado: estado === 'nao_assinado',
    idEnvioAssinatura: linha.id_envio_assinatura || anterior?.idEnvioAssinatura || '',
    criadoEm: linha.created_at || anterior?.criadoEm,
    atualizadoEm: linha.updated_at || anterior?.atualizadoEm,
    supabaseId: linha.id, supabaseRevision: Number(linha.revision) || 1,
    supabaseClienteId: linha.cliente_id || '',
    origemIdExportacao: linha.id_exportacao || anterior?.origemIdExportacao || ''
  };
}

class DesbloqueioCloudService {
  constructor({ getClient, getContext, db }) {
    this.getClient = getClient;
    this.getContext = getContext;
    this.db = db;
    this.emCurso = null;
  }

  sincronizar() {
    if (this.emCurso) return this.emCurso;
    this.emCurso = this.sincronizarAgora().finally(() => { this.emCurso = null; });
    return this.emCurso;
  }

  async sincronizarAgora() {
    const client = this.getClient?.();
    const contexto = this.getContext?.();
    if (!client || !contexto?.empresa_id || contexto.administrador_global) return { enviados: 0, recebidos: 0 };
    if (typeof this.db?.listarDesbloqueios !== 'function') return { enviados: 0, recebidos: 0 };
    const validarEscopo = () => {
      const atual = this.getContext?.();
      if (atual?.empresa_id !== contexto.empresa_id || atual?.usuario_id !== contexto.usuario_id || this.getClient?.() !== client) {
        throw new Error('A conta mudou. A sincronização anterior foi interrompida.');
      }
    };
    // Inclui tombstones e carrega imagens apenas quando uma revisão mudou.
    const remotos = [];
    for (let inicio = 0; ; inicio += 500) {
      const consulta = await client.from('desbloqueios')
        .select('id,numero,id_exportacao,revision,updated_at,deleted_at')
        .eq('empresa_id', contexto.empresa_id).order('id').range(inicio, inicio + 499);
      if (consulta.error) throw consulta.error;
      validarEscopo();
      remotos.push(...(consulta.data || []));
      if ((consulta.data || []).length < 500) break;
    }
    let enviados = 0;
    let recebidos = 0;

    const locais = this.db.listarDesbloqueios();
    for (const local of locais) {
      const remoto = remotos.find(item => item.id === local.supabaseId || item.id_exportacao === paraPayload(local).idExportacao);
      if (remoto?.deleted_at) {
        this.db.excluirDesbloqueio(local.numero);
        recebidos++;
        continue;
      }
      const mudouLocal = !local.supabaseSyncFingerprint || fingerprint(local) !== local.supabaseSyncFingerprint;
      const mudouRemoto = remoto && Number(remoto.revision) > Number(local.supabaseRevision || 0);
      if (mudouLocal && (!mudouRemoto || !local.supabaseId)) {
        const resposta = await client.rpc('salvar_desbloqueio', {
          p_id: remoto?.id || local.supabaseId || null,
          p_revision: local.supabaseRevision || remoto?.revision || null,
          p_dados: paraPayload(local)
        });
        if (resposta.error) throw resposta.error;
        validarEscopo();
        const salvo = Array.isArray(resposta.data) ? resposta.data[0] : resposta.data;
        if (!salvo?.id) throw new Error('A nuvem não confirmou a autorização.');
        this.aplicar(salvo, local);
        const i = remotos.findIndex(item => item.id === salvo.id);
        if (i >= 0) remotos[i] = salvo; else remotos.push(salvo);
        enviados += 1;
      } else if (mudouLocal && mudouRemoto) {
        // Mantém a edição local para revisão; nunca substitui silenciosamente.
        throw new Error(`A autorização ${local.numero} foi alterada nos dois aparelhos. Revise a edição antes de sincronizar.`);
      }
    }

    for (const remoto of remotos) {
      if (remoto.deleted_at) continue;
      const local = this.db.listarDesbloqueios().find(item => item.supabaseId === remoto.id);
      if (!local || Number(remoto.revision) > Number(local.supabaseRevision || 0)) {
        const resposta = await client.from('desbloqueios').select('*').eq('id', remoto.id).eq('empresa_id', contexto.empresa_id).maybeSingle();
        if (resposta.error) throw resposta.error;
        validarEscopo();
        if (!resposta.data || resposta.data.deleted_at) continue;
        this.aplicar(resposta.data, local);
        recebidos += 1;
      }
    }
    return { enviados, recebidos };
  }

  aplicar(remoto, local) {
    const dados = paraLocal(remoto, local);
    dados.supabaseSyncFingerprint = fingerprint(dados);
    return this.db.aplicarDesbloqueioSupabase(dados, local?.numero || '');
  }

  async excluir(item) {
    const client = this.getClient?.();
    const contexto = this.getContext?.();
    if (!client || !contexto?.empresa_id) return { sucesso: false, erro: 'Conecte-se para confirmar a exclusão na nuvem.' };
    let id = item?.supabaseId;
    let revision = item?.supabaseRevision;
    if (!id) {
      // O servidor pode ter recebido o envio antes de a conexão cair. Busque
      // também pela chave idempotente para não recriar o item no próximo pull.
      const existente = await client.from('desbloqueios').select('id,revision,deleted_at')
        .eq('empresa_id', contexto.empresa_id).eq('id_exportacao', paraPayload(item).idExportacao).maybeSingle();
      if (existente.error) throw existente.error;
      if (!existente.data || existente.data.deleted_at) return { sucesso: true, ignorado: true };
      id = existente.data.id; revision = existente.data.revision;
    }
    if (this.getContext?.()?.empresa_id !== contexto.empresa_id) return { sucesso: false, erro: 'A conta mudou. Tente novamente.' };
    const resposta = await client.rpc('excluir_desbloqueio', {
      p_id: id, p_revision: revision || null
    });
    if (resposta.error) throw resposta.error;
    return { sucesso: resposta.data === true };
  }
}

module.exports = { DesbloqueioCloudService, paraPayload, paraLocal, estadoLocal, fingerprint };
