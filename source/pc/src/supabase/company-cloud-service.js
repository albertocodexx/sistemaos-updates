const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUCKET_BACKUP = 'backups-empresa';
const BUCKET_IDENTIDADE = 'identidade-empresa';
const LIMITE_BACKUP = 50 * 1024 * 1024;
const LIMITE_LOGO = 5 * 1024 * 1024;
const MAX_HISTORICO_BACKUPS_NUVEM = 30;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function bufferDeDataUrl(dataUrl) {
  const resultado = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ''));
  if (!resultado) throw new Error('A logo precisa ser uma imagem valida.');
  return { mime: resultado[1].toLowerCase(), buffer: Buffer.from(resultado[2], 'base64') };
}

function bancoOperacionalVazio(db) {
  const atual = db.loadDB();
  const colecoes = ['ordens', 'estoque', 'clientes', 'compras', 'vendas', 'entregas', 'garantias', 'desbloqueios'];
  return colecoes.every((chave) => !Array.isArray(atual[chave]) || atual[chave].length === 0);
}

async function bufferDeDownload(download) {
  if (download?.error) throw download.error;
  if (!download?.data || typeof download.data.arrayBuffer !== 'function') {
    throw new Error('A nuvem devolveu um arquivo de backup invalido.');
  }
  return Buffer.from(await download.data.arrayBuffer());
}

function validarBufferBackup(buffer, tamanhoEsperado = null, hashEsperado = '') {
  if (!buffer.length || buffer.length > LIMITE_BACKUP) throw new Error('Backup vazio ou maior que 50 MB.');
  if (tamanhoEsperado !== null && buffer.length !== Number(tamanhoEsperado)) {
    throw new Error('O tamanho do backup da nuvem nao confere.');
  }
  const hash = sha256(buffer);
  if (hashEsperado && hash !== hashEsperado) {
    throw new Error('O backup da nuvem falhou na verificacao de integridade.');
  }
  const json = JSON.parse(buffer.toString('utf8'));
  if (!json || json.tipo !== 'backup-sistema-os' || !Array.isArray(json.ordens)) {
    throw new Error('A estrutura do backup da nuvem e invalida.');
  }
  return hash;
}

// A configuracao visual e comercial que o APK precisa. Nunca incluem
// credenciais, tokens ou senhas locais do desktop. Esta mesma representacao
// fica em configuracoes_empresa.identidadeEmpresa.configMobile e vira a fonte
// de restauracao quando o Android e reinstalado.
function configuracaoMobileDoDesktop(configuracao) {
  const config = configuracao || {};
  const garantia = String(config.garantiaPadrao || '').match(/\d+/);
  const tema = String(config.temaModo || '').toLowerCase();
  return {
    nomeEmpresa: String(config.nomeEmpresa || config.nomeFantasia || '').trim(),
    nomeFantasia: String(config.nomeFantasia || config.nomeEmpresa || '').trim(),
    razaoSocial: String(config.razaoSocial || '').trim(),
    possuiCnpj: config.possuiCnpj === true,
    cnpj: String(config.cnpj || '').trim(),
    inscricaoEstadual: String(config.inscricaoEstadual || '').trim(),
    telefone: String(config.telefonePrincipal || config.telefoneEmpresa || '').trim(),
    telefoneFixo: String(config.telefoneFixo || '').trim(),
    whatsapp: String(config.whatsapp || '').trim(),
    email: String(config.email || '').trim(),
    site: String(config.site || '').trim(),
    endereco: String(config.endereco || config.enderecoEmpresa || '').trim(),
    numero: String(config.numero || '').trim(),
    complemento: String(config.complemento || '').trim(),
    bairro: String(config.bairro || '').trim(),
    cidade: String(config.cidade || '').trim(),
    estado: String(config.estado || '').trim(),
    cep: String(config.cep || '').trim(),
    exibirCnpjDocumentos: config.exibirCnpjDocumentos !== false,
    usarTermosPredefinidosOS: config.usarTermosPredefinidosOS === true,
    termosCustomOS: String(config.termosOS || '').trim(),
    usarTermosPredefinidosVenda: config.usarTermosPredefinidosVenda === true,
    termosCustomVenda: String(config.termosVenda || '').trim(),
    usarTermosPredefinidosCompra: config.usarTermosPredefinidosCompra === true,
    termosCustomCompra: String(config.termosCompra || '').trim(),
    usarTermosPredefinidosGarantia: config.usarTermosPredefinidosGarantia !== false,
    termosCustomGarantia: String(config.termosGarantia || '').trim(),
    textoRodapePdf: String(config.textoRodapePdf || '').trim(),
    tamanhoLogoPdf: Math.max(40, Number(config.tamanhoLogoPdf) || 80),
    tamanhoFonteTermosPdf: Math.max(0, Number(config.tamanhoFonteTermosPdf) || 0),
    temaModo: tema === 'light' || tema === 'claro' ? 'claro' : 'escuro',
    exigirAssinaturaAssistencia: config.exigirAssinaturaAssistencia !== false,
    garantiaDiasPadrao: garantia ? Math.max(0, Number(garantia[0]) || 0) : 90
  };
}

function configuracaoDesktopDoMobile(configuracao) {
  const config = configuracao || {};
  const garantiaInformada = Number(config.garantiaDiasPadrao);
  const garantiaDias = Number.isFinite(garantiaInformada) ? Math.max(0, garantiaInformada) : 90;
  const nomeEmpresa = String(config.nomeEmpresa || config.nomeFantasia || '').trim();
  return {
    nomeEmpresa,
    nomeFantasia: String(config.nomeFantasia || nomeEmpresa).trim(),
    razaoSocial: String(config.razaoSocial || '').trim(),
    possuiCnpj: config.possuiCnpj === true,
    cnpj: String(config.cnpj || '').trim(),
    inscricaoEstadual: String(config.inscricaoEstadual || '').trim(),
    telefonePrincipal: String(config.telefone || '').trim(),
    telefoneEmpresa: String(config.telefone || '').trim(),
    telefoneFixo: String(config.telefoneFixo || '').trim(),
    whatsapp: String(config.whatsapp || '').trim(),
    email: String(config.email || '').trim(),
    site: String(config.site || '').trim(),
    endereco: String(config.endereco || '').trim(),
    numero: String(config.numero || '').trim(),
    complemento: String(config.complemento || '').trim(),
    bairro: String(config.bairro || '').trim(),
    cidade: String(config.cidade || '').trim(),
    estado: String(config.estado || '').trim(),
    cep: String(config.cep || '').trim(),
    exibirCnpjDocumentos: config.exibirCnpjDocumentos !== false,
    usarTermosPredefinidosOS: config.usarTermosPredefinidosOS === true,
    termosOS: String(config.termosCustomOS || '').trim(),
    usarTermosPredefinidosVenda: config.usarTermosPredefinidosVenda === true,
    termosVenda: String(config.termosCustomVenda || '').trim(),
    usarTermosPredefinidosCompra: config.usarTermosPredefinidosCompra === true,
    termosCompra: String(config.termosCustomCompra || '').trim(),
    usarTermosPredefinidosGarantia: config.usarTermosPredefinidosGarantia !== false,
    termosGarantia: String(config.termosCustomGarantia || '').trim(),
    textoRodapePdf: String(config.textoRodapePdf || '').trim(),
    tamanhoLogoPdf: Math.max(40, Number(config.tamanhoLogoPdf) || 80),
    tamanhoFonteTermosPdf: Math.max(0, Number(config.tamanhoFonteTermosPdf) || 0),
    temaModo: String(config.temaModo || '').toLowerCase() === 'claro' ? 'light' : 'dark',
    exigirAssinaturaAssistencia: config.exigirAssinaturaAssistencia !== false,
    garantiaPadrao: `${garantiaDias} dias`,
    configuracaoEmpresaAtualizadaEm: String(config.configAtualizadaEm || '')
  };
}

class CompanyCloudService {
  constructor({ getClient, getContext, db, stateStore, appVersion = '' }) {
    this.getClient = getClient;
    this.getContext = getContext;
    this.db = db;
    this.stateStore = stateStore;
    this.appVersion = appVersion;
  }

  _contexto() {
    const contexto = this.getContext?.();
    if (!contexto?.empresa_id || contexto.administrador_global === true) {
      throw new Error('Entre em uma empresa para usar os dados compartilhados.');
    }
    return contexto;
  }

  _cliente() {
    const cliente = this.getClient?.();
    if (!cliente) throw new Error('Supabase indisponivel.');
    return cliente;
  }

  _ehAdministrador() {
    const contexto = this._contexto();
    const cargo = String(contexto.cargo || '').trim().toLowerCase();
    return contexto.acesso_somente_cobranca !== true && ['administrador', 'admin', 'proprietario', 'proprietário'].includes(cargo);
  }

  async publicarBackup(caminhoArquivo) {
    const contexto = this._contexto();
    if (!this._ehAdministrador()) throw new Error('Somente o administrador pode acessar o backup completo.');
    const cliente = this._cliente();
    const buffer = fs.readFileSync(caminhoArquivo);
    // Valida o JSON antes de substituir a copia boa da nuvem.
    const hash = validarBufferBackup(buffer);
    const storagePath = `${contexto.empresa_id}/ultimo-backup.json`;
    const estadoAnterior = this.stateStore.obter?.() || {};
    if (estadoAnterior.backupNuvem?.sha256 === hash) {
      return { sucesso: true, ignorado: true, sha256: hash, tamanho: buffer.length, storagePath };
    }

    const pastaHistorico = `${contexto.empresa_id}/historico`;
    const carimbo = new Date().toISOString().replace(/[-:.]/g, '');
    const storagePathHistorico = `${pastaHistorico}/${carimbo}-${hash}.json`;
    const storage = cliente.storage.from(BUCKET_BACKUP);

    // A copia imutavel entra primeiro. Se a conexao cair em qualquer etapa
    // posterior, ainda existe uma versao integra que pode ser localizada pelo
    // checksum registrado no banco.
    const envioHistorico = await storage.upload(storagePathHistorico, buffer, {
      contentType: 'application/json',
      upsert: false,
      cacheControl: '0'
    });
    if (envioHistorico.error && !/already exists|duplicate/i.test(envioHistorico.error.message || '')) {
      throw envioHistorico.error;
    }

    // Guarda a versao anterior para desfazer a troca caso a gravacao dos
    // metadados falhe depois do upload do arquivo principal.
    let bufferAnterior = null;
    try {
      bufferAnterior = await bufferDeDownload(await storage.download(storagePath));
    } catch {}

    const envio = await storage.upload(storagePath, buffer, {
      contentType: 'application/json',
      upsert: true,
      cacheControl: '0'
    });
    if (envio.error) throw envio.error;
    const registro = await cliente.rpc('registrar_backup_empresa', {
      p_tamanho_bytes: buffer.length,
      p_sha256: hash,
      p_versao_aplicativo: this.appVersion
    });
    if (registro.error) {
      if (bufferAnterior?.length) {
        try {
          await storage.upload(storagePath, bufferAnterior, {
            contentType: 'application/json', upsert: true, cacheControl: '0'
          });
        } catch {}
      }
      throw registro.error;
    }
    this.stateStore.alterar((estado) => {
      estado.backupNuvem = {
        sha256: hash,
        atualizadoEm: new Date().toISOString(),
        storagePath,
        storagePathHistorico
      };
    });

    // Limpeza e apenas manutencao: uma falha aqui nao invalida o backup que
    // acabou de ser registrado e verificado.
    try {
      if (typeof storage.list === 'function' && typeof storage.remove === 'function') {
        const lista = await storage.list(pastaHistorico, {
          limit: 100,
          sortBy: { column: 'name', order: 'desc' }
        });
        if (!lista.error && Array.isArray(lista.data) && lista.data.length > MAX_HISTORICO_BACKUPS_NUVEM) {
          const antigos = lista.data.slice(MAX_HISTORICO_BACKUPS_NUVEM)
            .map((item) => `${pastaHistorico}/${item.name}`);
          if (antigos.length) await storage.remove(antigos);
        }
      }
    } catch {}

    return { sucesso: true, sha256: hash, tamanho: buffer.length, storagePath, storagePathHistorico };
  }

  async baixarUltimoBackup() {
    const contexto = this._contexto();
    if (!this._ehAdministrador()) throw new Error('Somente o administrador pode acessar o backup completo.');
    const cliente = this._cliente();
    const consulta = await cliente.from('backups_empresa')
      .select('storage_bucket,storage_path,tamanho_bytes,sha256,updated_at')
      .eq('empresa_id', contexto.empresa_id)
      .maybeSingle();
    if (consulta.error) throw consulta.error;
    if (!consulta.data) return { sucesso: true, disponivel: false };
    const meta = consulta.data;
    if (Number(meta.tamanho_bytes) < 1 || Number(meta.tamanho_bytes) > LIMITE_BACKUP) {
      throw new Error('Metadados do backup da nuvem sao invalidos.');
    }
    const storage = cliente.storage.from(meta.storage_bucket || BUCKET_BACKUP);
    let buffer;
    let recuperadoDoHistorico = false;
    try {
      buffer = await bufferDeDownload(await storage.download(meta.storage_path));
      validarBufferBackup(buffer, meta.tamanho_bytes, meta.sha256);
    } catch (erroPrincipal) {
      // Se o computador caiu entre o upload e o registro dos metadados, o
      // arquivo principal pode estar uma versao a frente. Localizamos a copia
      // imutavel que possui exatamente o checksum ainda registrado.
      if (typeof storage.list !== 'function') throw erroPrincipal;
      const pastaHistorico = `${contexto.empresa_id}/historico`;
      const lista = await storage.list(pastaHistorico, {
        limit: 100,
        sortBy: { column: 'name', order: 'desc' }
      });
      if (lista.error) throw erroPrincipal;
      const candidato = (lista.data || []).find((item) => String(item.name || '').includes(meta.sha256));
      if (!candidato) throw erroPrincipal;
      buffer = await bufferDeDownload(await storage.download(`${pastaHistorico}/${candidato.name}`));
      validarBufferBackup(buffer, meta.tamanho_bytes, meta.sha256);
      recuperadoDoHistorico = true;
      // Repara a copia principal sem alterar os metadados, que ja descrevem
      // exatamente o buffer recuperado.
      const reparo = await storage.upload(meta.storage_path, buffer, {
        contentType: 'application/json', upsert: true, cacheControl: '0'
      });
      if (reparo.error) console.warn('[Backup Nuvem] Copia historica recuperada; reparo do arquivo principal ficou pendente.');
    }
    const destino = path.join(this.db.getBackupAutoDir(), `cloud-ultimo-backup-${contexto.empresa_id}.json`);
    const temporario = `${destino}.tmp`;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(temporario, buffer);
    fs.renameSync(temporario, destino);
    this.stateStore.alterar((estado) => {
      estado.backupNuvem = {
        sha256: meta.sha256,
        atualizadoEm: meta.updated_at || new Date().toISOString(),
        storagePath: meta.storage_path,
        cacheLocal: destino,
        recuperadoDoHistorico
      };
    });
    return { sucesso: true, disponivel: true, caminho: destino, metadados: meta, recuperadoDoHistorico };
  }

  async restaurarEmInstalacaoNova() {
    // Usuarios operacionais recebem somente dados autorizados pelo sincronizador.
    // Um backup completo inclui modulos que esse usuario pode nao acessar.
    if (!this._ehAdministrador()) return { sucesso: true, disponivel: false, restaurado: false };
    const baixado = await this.baixarUltimoBackup();
    if (!baixado.disponivel || !bancoOperacionalVazio(this.db)) {
      return Object.assign({}, baixado, { restaurado: false });
    }
    this.db.importarBackup(baixado.caminho);
    this.stateStore.alterar((estado) => {
      estado.backupNuvem = Object.assign({}, estado.backupNuvem, {
        restauradoEm: new Date().toISOString()
      });
    });
    return Object.assign({}, baixado, { restaurado: true });
  }

  async obterIdentidade() {
    const contexto = this._contexto();
    const consulta = await this._cliente().from('configuracoes_empresa')
      .select('configuracoes,updated_at')
      .eq('empresa_id', contexto.empresa_id)
      .maybeSingle();
    if (consulta.error) throw consulta.error;
    return consulta.data?.configuracoes?.identidadeEmpresa || null;
  }

  async publicarConfiguracaoMobile(configuracao) {
    const contexto = this.getContext?.();
    // A conta global de suporte nao representa uma assistencia e, portanto,
    // nao possui configuracao comercial para publicar.
    if (!contexto?.empresa_id || contexto.administrador_global === true) {
      return { sucesso: true, ignorado: true };
    }
    if (!this._ehAdministrador()) {
      return { sucesso: false, ignorado: true, erro: 'Somente o administrador pode publicar as configuracoes da empresa.' };
    }

    try {
      const identidade = await this.obterIdentidade() || {};
      const { data, error } = await this._cliente().rpc('salvar_configuracao_mobile', {
        p_config_mobile: configuracaoMobileDoDesktop(configuracao),
        // A RPC remove a assinatura quando recebe caminho vazio. Por isso o
        // desktop sempre reenvia os metadados existentes, sem baixar ou expor
        // a imagem da assinatura.
        p_assinatura_storage_path: String(identidade.assinaturaStoragePath || ''),
        p_assinatura_sha256: String(identidade.assinaturaSha256 || '')
      });
      if (error) throw error;
      return { sucesso: true, identidade: data || null };
    } catch (erro) {
      // O banco local ja foi salvo. A proxima gravacao de configuracoes pode
      // repetir o envio sem interromper o trabalho da assistencia.
      return { sucesso: false, pendente: true, erro: erro?.message || String(erro) };
    }
  }

  // Em uma instalacao anterior a configuracao compartilhada, o desktop ja
  // possui a identidade correta no banco local. Publica uma unica vez quando
  // a nuvem ainda nao tem configMobile, sem sobrescrever o que o Android
  // eventualmente ja tiver salvo.
  async publicarConfiguracaoMobileSeAusente(configuracao) {
    const contexto = this.getContext?.();
    if (!contexto?.empresa_id || contexto.administrador_global === true || !this._ehAdministrador()) {
      return { sucesso: true, ignorado: true };
    }
    try {
      const identidade = await this.obterIdentidade() || {};
      const existente = identidade.configMobile;
      if (existente && typeof existente === 'object' && !Array.isArray(existente) && Object.keys(existente).length) {
        return { sucesso: true, ignorado: true, motivo: 'configuracao_mobile_existente' };
      }
      return this.publicarConfiguracaoMobile(configuracao);
    } catch (erro) {
      return { sucesso: false, pendente: true, erro: erro?.message || String(erro) };
    }
  }

  async sincronizarConfiguracaoCompartilhada() {
    const contexto = this.getContext?.();
    if (!contexto?.empresa_id || contexto.administrador_global === true || this._ehAdministrador()) {
      return { sucesso: true, ignorado: true };
    }
    const identidade = await this.obterIdentidade();
    const configMobile = identidade?.configMobile;
    if (!configMobile || typeof configMobile !== 'object' || Array.isArray(configMobile)) {
      return { sucesso: true, ignorado: true, motivo: 'configuracao_mobile_ausente' };
    }
    const patch = configuracaoDesktopDoMobile(Object.assign({}, configMobile, {
      configAtualizadaEm: identidade.configMobileAtualizadaEm || ''
    }));
    this.db.salvarConfig(patch);
    this.stateStore.alterar((s) => {
      s.configEmpresa = {
        atualizadaEm: String(identidade.configMobileAtualizadaEm || ''),
        verificadaEm: new Date().toISOString()
      };
    });
    return { sucesso: true, atualizada: true, configuracao: patch };
  }

  async sincronizarLogo() {
    const identidade = await this.obterIdentidade();
    const storagePath = String(identidade?.logoStoragePath || '');
    if (!storagePath) {
      const atual = this.db.obterConfig();
      if (atual.logoBase64) this.db.salvarConfig({ logoPath: '', logoBase64: '' });
      return { sucesso: true, possuiLogo: false };
    }
    const hashEsperado = String(identidade.logoSha256 || '');
    const estado = this.stateStore.obter();
    if (hashEsperado && estado.logoEmpresa?.sha256 === hashEsperado && this.db.obterConfig().logoBase64) {
      return { sucesso: true, possuiLogo: true, cache: true };
    }
    const download = await this._cliente().storage.from(BUCKET_IDENTIDADE).download(storagePath);
    if (download.error) throw download.error;
    const buffer = Buffer.from(await download.data.arrayBuffer());
    if (!buffer.length || buffer.length > LIMITE_LOGO) throw new Error('Logo da empresa invalida.');
    const hash = sha256(buffer);
    if (hashEsperado && hash !== hashEsperado) throw new Error('A logo da empresa falhou na verificacao de integridade.');
    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
    this.db.salvarConfig({ logoPath: '', logoBase64: base64 });
    this.stateStore.alterar((s) => { s.logoEmpresa = { sha256: hash, storagePath, atualizadoEm: new Date().toISOString() }; });
    return { sucesso: true, possuiLogo: true, sha256: hash };
  }

  async atualizarLogo(dataUrl) {
    if (!this._ehAdministrador()) throw new Error('Somente o administrador ou proprietario pode alterar a logo da empresa.');
    const contexto = this._contexto();
    const cliente = this._cliente();
    const storagePath = `${contexto.empresa_id}/logo.png`;
    if (!dataUrl) {
      const remocao = await cliente.storage.from(BUCKET_IDENTIDADE).remove([storagePath]);
      if (remocao.error && !/not found/i.test(remocao.error.message || '')) throw remocao.error;
      const registro = await cliente.rpc('definir_logo_empresa', { p_storage_path: '', p_sha256: '' });
      if (registro.error) throw registro.error;
      this.db.salvarConfig({ logoPath: '', logoBase64: '' });
      this.stateStore.alterar((s) => { s.logoEmpresa = { sha256: '', storagePath: '', atualizadoEm: new Date().toISOString() }; });
      return { sucesso: true, possuiLogo: false };
    }
    const imagem = bufferDeDataUrl(dataUrl);
    if (!/^image\//.test(imagem.mime) || !imagem.buffer.length || imagem.buffer.length > LIMITE_LOGO) {
      throw new Error('A logo deve ser uma imagem de ate 5 MB.');
    }
    const hash = sha256(imagem.buffer);
    const envio = await cliente.storage.from(BUCKET_IDENTIDADE).upload(storagePath, imagem.buffer, {
      contentType: 'image/png', upsert: true, cacheControl: '0'
    });
    if (envio.error) throw envio.error;
    const registro = await cliente.rpc('definir_logo_empresa', { p_storage_path: storagePath, p_sha256: hash });
    if (registro.error) throw registro.error;
    const base64 = `data:image/png;base64,${imagem.buffer.toString('base64')}`;
    this.db.salvarConfig({ logoPath: '', logoBase64: base64 });
    this.stateStore.alterar((s) => { s.logoEmpresa = { sha256: hash, storagePath, atualizadoEm: new Date().toISOString() }; });
    return { sucesso: true, possuiLogo: true, sha256: hash, logoBase64: base64 };
  }
}

module.exports = {
  CompanyCloudService,
  BUCKET_BACKUP,
  BUCKET_IDENTIDADE,
  LIMITE_BACKUP,
  LIMITE_LOGO,
  MAX_HISTORICO_BACKUPS_NUVEM,
  sha256,
  validarBufferBackup,
  bufferDeDataUrl,
  bancoOperacionalVazio,
  configuracaoMobileDoDesktop,
  configuracaoDesktopDoMobile
};
