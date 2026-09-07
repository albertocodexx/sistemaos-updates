const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUCKET_ARQUIVOS = 'arquivos-os';
const BUCKET_PDFS = 'documentos-pdf';

function nomeSeguro(nome) {
  const limpo = String(nome || 'arquivo.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
  return limpo.slice(0, 140) || 'arquivo.bin';
}

function mimePorExtensao(caminho) {
  const ext = path.extname(caminho || '').toLowerCase();
  const mapa = {
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'
  };
  return mapa[ext] || 'application/octet-stream';
}

function checksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

class SupabaseFileService {
  constructor({ rootDir, stateStore, getClient, getContext, nativeImage, db }) {
    this.rootDir = path.join(rootDir, 'Supabase-Arquivos');
    this.stateStore = stateStore;
    this.getClient = getClient;
    this.getContext = getContext;
    this.nativeImage = nativeImage;
    this.db = db;
    this.arquivosAplicados = new Map();
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  _materializarBase64(base64, nome) {
    if (!base64) return '';
    const match = String(base64).match(/^data:([^;]+);base64,(.+)$/s);
    const conteudo = match ? match[2] : String(base64);
    const destino = path.join(this.rootDir, 'assinaturas', nomeSeguro(nome));
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(conteudo, 'base64'));
    return destino;
  }

  _arquivosDaOS(os) {
    const arquivos = [];
    if (os?.pdfPath) arquivos.push({ path: os.pdfPath, categoria: 'pdf', nome: path.basename(os.pdfPath) });
    for (const foto of (os?.fotos || [])) {
      if (foto?.path) arquivos.push({
        path: foto.path,
        categoria: 'foto_' + String(foto.categoria || 'os'),
        nome: foto.nome || path.basename(foto.path)
      });
    }
    if (os?.assinaturaClienteBase64) {
      const p = this._materializarBase64(os.assinaturaClienteBase64, `${os.numero}-assinatura-cliente.png`);
      if (p) arquivos.push({ path: p, categoria: 'assinatura_cliente', nome: path.basename(p) });
    }
    if (os?.assinaturaAssistenciaBase64) {
      const p = this._materializarBase64(os.assinaturaAssistenciaBase64, `${os.numero}-assinatura-assistencia.png`);
      if (p) arquivos.push({ path: p, categoria: 'assinatura_assistencia', nome: path.basename(p) });
    }
    for (const comprovante of (os?.comprovantesTermicosAssinados || [])) {
      if (comprovante?.path) arquivos.push({
        path: comprovante.path,
        categoria: 'comprovante_termico_assinado',
        nome: comprovante.nome || path.basename(comprovante.path)
      });
    }
    return arquivos;
  }

  async _criarMiniatura(caminho, sha, empresaId) {
    if (!/^image\//.test(mimePorExtensao(caminho)) || !this.nativeImage?.createFromPath) return '';
    try {
      const imagem = this.nativeImage.createFromPath(caminho);
      if (!imagem || imagem.isEmpty()) return '';
      const png = imagem.resize({ width: 320, quality: 'good' }).toPNG();
      if (!png?.length) return '';
      const local = path.join(this.rootDir, 'miniaturas', `${sha}.png`);
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.writeFileSync(local, png);
      const remoto = `${empresaId}/miniaturas/${sha}.png`;
      const { error } = await this.getClient().storage.from(BUCKET_ARQUIVOS)
        .upload(remoto, png, { contentType: 'image/png', upsert: true });
      if (error) throw error;
      return remoto;
    } catch (erro) {
      console.warn('[Supabase] Miniatura não pôde ser criada:', erro.message);
      return '';
    }
  }

  async catalogarOS(os, linhaRemota) {
    const contexto = this.getContext();
    const estado = this.stateStore.obter();
    if (!contexto?.empresa_id || !estado.dispositivoId || !linhaRemota?.id) return { registrados: 0, erros: [] };
    const arquivos = this._arquivosDaOS(os).filter((item) =>
      mimePorExtensao(item.path) === 'application/pdf' ||
      item.categoria === 'comprovante_termico_assinado'
    );
    let registrados = 0;
    const erros = [];
    for (const item of arquivos) {
      try {
        if (!item.path || !fs.existsSync(item.path) || !fs.statSync(item.path).isFile()) continue;
        const buffer = fs.readFileSync(item.path);
        const sha = checksum(buffer);
        const localId = `desktop:${estado.deviceKey}:${sha}`;
        const mime = mimePorExtensao(item.path);
        const miniaturaPath = '';
        const bucket = mime === 'application/pdf' ? BUCKET_PDFS : BUCKET_ARQUIVOS;
        const arquivoNuvemPath = `${contexto.empresa_id}/completos/${sha}/${nomeSeguro(item.nome)}`;
        const disponibilidade = 'local_e_nuvem';
        const { error: uploadError } = await this.getClient().storage.from(bucket)
          .upload(arquivoNuvemPath, buffer, { contentType: mime, upsert: true });
        if (uploadError) throw uploadError;

        // Arquivos de OS são compartilhados entre desktop e celular. Mesmo
        // no plano econômico, o original precisa existir no Storage privado.
        const dados = {
          categoria: item.categoria,
          nome_arquivo: nomeSeguro(item.nome),
          mime_type: mime,
          tamanho_bytes: buffer.length,
          miniatura_path: miniaturaPath || null,
          storage_bucket: bucket || null,
          arquivo_nuvem_path: arquivoNuvemPath || null,
          arquivo_local_id: localId,
          disponibilidade,
          checksum_sha256: sha
        };
        const { data, error } = await this.getClient().rpc('registrar_arquivo', {
          p_entidade_tipo: 'ordem_servico',
          p_entidade_id: linhaRemota.id,
          p_idempotency_key: `desktop:${estado.deviceKey}:os:${linhaRemota.id}:${item.categoria}:${sha}`,
          p_dados: dados,
          p_origem_dispositivo_id: estado.dispositivoId
        });
        if (error) throw error;
        this.stateStore.registrarArquivoLocal(localId, {
          path: path.resolve(item.path),
          arquivoId: data?.id || '',
          entidadeId: linhaRemota.id,
          categoria: item.categoria,
          mimeType: mime,
          nomeArquivo: nomeSeguro(item.nome),
          checksumSha256: sha
        });
        registrados += 1;
      } catch (erro) {
        erros.push({ arquivo: item.nome, erro: erro.message });
      }
    }
    return { registrados, erros };
  }

  async baixarArquivosOS(entidadeId, numero) {
    const cliente = this.getClient();
    const estado = this.stateStore.obter();
    if (!cliente || !entidadeId || !numero || !this.db?.aplicarArquivoSupabaseOS) {
      return { aplicados: 0, numero };
    }
    const { data: arquivos, error } = await cliente.from('arquivos')
      .select('id,entidade_id,categoria,nome_arquivo,mime_type,storage_bucket,miniatura_path,arquivo_nuvem_path,origem_dispositivo_id,updated_at')
      .eq('entidade_tipo', 'ordem_servico')
      .eq('entidade_id', entidadeId)
      .is('deleted_at', null)
      .not('arquivo_nuvem_path', 'is', null)
      .not('origem_dispositivo_id', 'is', null)
      .not('origem_dispositivo_id', 'eq', estado.dispositivoId)
      .not('categoria', 'eq', 'pdf')
      .order('updated_at', { ascending: true });
    if (error) throw error;
    let aplicados = 0;
    let requerProcessamento = false;
    for (const arquivo of (arquivos || [])) {
      if (!arquivo.storage_bucket || !arquivo.arquivo_nuvem_path) continue;
      const chave = `${arquivo.id}:${arquivo.updated_at || ''}`;
      if (this.arquivosAplicados.get(arquivo.id) === chave) continue;
      const { data: blob, error: downloadError } = await cliente.storage
        .from(arquivo.storage_bucket).download(arquivo.arquivo_nuvem_path);
      if (downloadError) throw downloadError;
      const buffer = Buffer.from(await blob.arrayBuffer());
      const resultado = this.db.aplicarArquivoSupabaseOS(numero, arquivo, buffer);
      this.arquivosAplicados.set(arquivo.id, chave);
      if (resultado && !resultado.erro) await this.confirmarConsumoMobile(arquivo, buffer);
      if (resultado?.aplicado) {
        aplicados += 1;
        if (arquivo.mime_type !== 'application/pdf' && arquivo.categoria !== 'pdf') {
          requerProcessamento = true;
        }
      }
    }
    return { aplicados, numero, requerProcessamento };
  }

  async sincronizarArquivosRemotos() {
    const cliente = this.getClient();
    if (!cliente || !this.db) return { aplicados: 0, numeros: [] };
    const estado = this.stateStore.obter();
    const desde = estado.ultimoPullArquivosEm || '1970-01-01T00:00:00.000Z';
    const { data: metadados, error } = await cliente.from('arquivos')
      .select('id,entidade_id,categoria,nome_arquivo,mime_type,storage_bucket,miniatura_path,arquivo_nuvem_path,origem_dispositivo_id,updated_at')
      .eq('entidade_tipo', 'ordem_servico')
      .is('deleted_at', null)
      .not('arquivo_nuvem_path', 'is', null)
      .not('origem_dispositivo_id', 'is', null)
      .not('origem_dispositivo_id', 'eq', estado.dispositivoId)
      .not('categoria', 'eq', 'pdf')
      .gt('updated_at', desde)
      .order('updated_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    const ids = [...new Set((metadados || []).map((item) => item.entidade_id).filter(Boolean))];
    if (!ids.length) return { aplicados: 0, numeros: [] };
    const { data: ordens, error: ordensError } = await cliente.from('ordens_servico')
      .select('id,numero').in('id', ids);
    if (ordensError) throw ordensError;
    const numerosPorId = new Map((ordens || []).map((ordem) => [ordem.id, ordem.numero]));
    let aplicados = 0;
    const numeros = [];
    let maiorData = desde;
    for (const arquivo of (metadados || [])) {
      const numero = numerosPorId.get(arquivo.entidade_id);
      if (!numero || !arquivo.storage_bucket || !arquivo.arquivo_nuvem_path) continue;
      const download = await cliente.storage.from(arquivo.storage_bucket).download(arquivo.arquivo_nuvem_path);
      if (download.error) throw download.error;
      const buffer = Buffer.from(await download.data.arrayBuffer());
      const resultado = this.db.aplicarArquivoSupabaseOS(numero, arquivo, buffer);
      if (resultado?.erro) throw new Error(resultado.erro);
      await this.confirmarConsumoMobile(arquivo, buffer);
      if (resultado?.aplicado) {
        aplicados += 1;
        numeros.push(numero);
      }
      if (arquivo.updated_at && arquivo.updated_at > maiorData) maiorData = arquivo.updated_at;
    }
    if (metadados?.length) this.stateStore.alterar((s) => { s.ultimoPullArquivosEm = maiorData; });
    return { aplicados, numeros: [...new Set(numeros)] };
  }

  _materializarRecebido(arquivo, buffer) {
    const extensao = path.extname(arquivo.nome_arquivo || '') ||
      (arquivo.mime_type === 'image/png' ? '.png' : arquivo.mime_type === 'application/pdf' ? '.pdf' : '.jpg');
    const destino = path.join(this.rootDir, 'recebidos', `${arquivo.id}${extensao}`);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, buffer);
    return destino;
  }

  async confirmarConsumoMobile(arquivo, buffer) {
    const estado = this.stateStore.obter();
    if (!arquivo?.id || !Buffer.isBuffer(buffer) || !estado.dispositivoId) return false;
    const sha = checksum(buffer);
    const localId = `desktop:${estado.deviceKey}:${sha}`;
    const destino = this._materializarRecebido(arquivo, buffer);
    const { error } = await this.getClient().rpc('confirmar_consumo_arquivo_mobile', {
      p_arquivo_id: arquivo.id,
      p_dispositivo_id: estado.dispositivoId,
      p_arquivo_local_id: localId
    });
    if (error) {
      const mensagem = String(error.message || error.details || error || '');
      // Confirmar consumo apenas libera o objeto de transito do Storage. Um
      // arquivo antigo, criado pelo desktop ou sem o dispositivo Android
      // preservado, nao pode interromper a importacao que ja foi concluida.
      if (/somente arquivo originado no Android pode ser consumido|arquivo nao encontrado/i.test(mensagem)) {
        try { if (fs.existsSync(destino)) fs.unlinkSync(destino); } catch (_) { /* best effort */ }
        return false;
      }
      throw error;
    }
    this.stateStore.registrarArquivoLocal(localId, {
      path: destino,
      arquivoId: arquivo.id,
      entidadeId: arquivo.entidade_id,
      categoria: arquivo.categoria,
      mimeType: arquivo.mime_type,
      nomeArquivo: arquivo.nome_arquivo,
      checksumSha256: sha
    });
    const pendentes = [];
    if (arquivo.storage_bucket && arquivo.arquivo_nuvem_path) {
      pendentes.push({ bucket: arquivo.storage_bucket, path: arquivo.arquivo_nuvem_path });
    }
    if (arquivo.miniatura_path) pendentes.push({ bucket: 'miniaturas', path: arquivo.miniatura_path });
    if (pendentes.length) this.stateStore.alterar((s) => {
      s.limpezasStoragePendentes = (s.limpezasStoragePendentes || []).concat(pendentes)
        .filter((item, indice, lista) => lista.findIndex((outro) => outro.bucket === item.bucket && outro.path === item.path) === indice);
    });
    await this.limparObjetosStoragePendentes();
    return true;
  }

  async limparObjetosStoragePendentes() {
    const pendentes = this.stateStore.obter().limpezasStoragePendentes || [];
    if (!pendentes.length) return { removidos: 0 };
    const restantes = [];
    let removidos = 0;
    for (const item of pendentes) {
      const { error } = await this.getClient().storage.from(item.bucket).remove([item.path]);
      if (error) restantes.push(item);
      else removidos += 1;
    }
    this.stateStore.alterar((s) => { s.limpezasStoragePendentes = restantes; });
    return { removidos };
  }

  async removerArquivosOSRemotos(osId) {
    const cliente = this.runtime.client;
    if (!cliente || !osId) return { removidos: 0 };
    const { data, error } = await cliente.rpc('listar_arquivos_exclusao_os', { p_id: osId });
    if (error) throw error;
    const porBucket = new Map();
    const adicionar = (bucket, caminho) => {
      if (!bucket || !caminho) return;
      if (!porBucket.has(bucket)) porBucket.set(bucket, new Set());
      porBucket.get(bucket).add(caminho);
    };
    for (const arquivo of (data || [])) {
      adicionar(arquivo.storage_bucket, arquivo.arquivo_nuvem_path);
      adicionar('miniaturas', arquivo.miniatura_path);
    }
    let removidos = 0;
    for (const [bucket, caminhos] of porBucket) {
      const lista = [...caminhos];
      for (let i = 0; i < lista.length; i += 100) {
        const lote = lista.slice(i, i + 100);
        const resposta = await cliente.storage.from(bucket).remove(lote);
        if (resposta.error) throw resposta.error;
        removidos += (resposta.data || []).length;
      }
    }
    return { removidos };
  }

  async responderSolicitacoesPendentes() {
    const cliente = this.getClient();
    const contexto = this.getContext();
    const estado = this.stateStore.obter();
    if (!cliente || !contexto?.empresa_id || !estado.dispositivoId) return { respondidas: 0 };
    const { data: solicitacoes, error } = await cliente.from('solicitacoes_arquivo')
      .select('id,arquivo_id,expira_em,status')
      .eq('status', 'pendente')
      .gt('expira_em', new Date().toISOString())
      .order('solicitado_em', { ascending: true })
      .limit(25);
    if (error) throw error;
    let respondidas = 0;
    for (const solicitacao of (solicitacoes || [])) {
      const { data: arquivo, error: arquivoErro } = await cliente.from('arquivos')
        .select('id,arquivo_local_id,nome_arquivo,mime_type')
        .eq('id', solicitacao.arquivo_id)
        .maybeSingle();
      if (arquivoErro) throw arquivoErro;
      const local = arquivo?.arquivo_local_id ? estado.arquivosLocais[arquivo.arquivo_local_id] : null;
      if (!local?.path || !fs.existsSync(local.path)) {
        await cliente.rpc('responder_solicitacao_arquivo', {
          p_solicitacao_id: solicitacao.id,
          p_storage_bucket: null,
          p_arquivo_nuvem_path: null,
          p_dispositivo_id: estado.dispositivoId,
          p_erro: 'Arquivo local não encontrado neste desktop.'
        });
        continue;
      }
      const buffer = fs.readFileSync(local.path);
      const bucket = arquivo.mime_type === 'application/pdf' ? BUCKET_PDFS : BUCKET_ARQUIVOS;
      const remoto = `${contexto.empresa_id}/temporarios/${solicitacao.id}/${nomeSeguro(arquivo.nome_arquivo)}`;
      const { error: uploadError } = await cliente.storage.from(bucket)
        .upload(remoto, buffer, { contentType: arquivo.mime_type, upsert: true });
      if (uploadError) throw uploadError;
      const { error: respostaErro } = await cliente.rpc('responder_solicitacao_arquivo', {
        p_solicitacao_id: solicitacao.id,
        p_storage_bucket: bucket,
        p_arquivo_nuvem_path: remoto,
        p_dispositivo_id: estado.dispositivoId,
        p_erro: null
      });
      if (respostaErro) throw respostaErro;
      respondidas += 1;
    }
    return { respondidas };
  }

  async limparTemporariosExpirados() {
    const cliente = this.getClient();
    const estado = this.stateStore.obter();
    if (!cliente || !estado.dispositivoId) return { removidos: 0 };
    const { data, error } = await cliente.rpc('listar_arquivos_temporarios_expirados', {
      p_dispositivo_id: estado.dispositivoId
    });
    if (error) throw error;
    let removidos = 0;
    for (const item of (data || [])) {
      if (item.storage_bucket && item.arquivo_nuvem_path) {
        await cliente.storage.from(item.storage_bucket).remove([item.arquivo_nuvem_path]);
      }
      const { error: expireError } = await cliente.rpc('expirar_arquivo_temporario', {
        p_arquivo_id: item.id,
        p_dispositivo_id: estado.dispositivoId
      });
      if (!expireError) removidos += 1;
    }
    return { removidos };
  }
}

module.exports = { SupabaseFileService, nomeSeguro, mimePorExtensao, checksum };
