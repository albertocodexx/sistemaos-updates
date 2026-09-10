const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSAO_ESTADO = 1;

function estadoInicial() {
  return {
    versao: VERSAO_ESTADO,
    deviceKey: crypto.randomUUID(),
    empresaId: '',
    dispositivoId: '',
    ultimoPullEm: '1970-01-01T00:00:00.000Z',
    ultimaReconciliacaoOSCompletaEm: '',
    ultimoPullExclusoesEm: '1970-01-01T00:00:00.000Z',
    ultimoPullEstoqueEm: '1970-01-01T00:00:00.000Z',
    ultimoPullComercialEm: '1970-01-01T00:00:00.000Z',
    ultimoPullArquivosEm: '1970-01-01T00:00:00.000Z',
    fila: [],
    filaAssinaturas: [],
    mapeamentosOS: {},
    mapeamentosEstoque: {},
    documentosComerciais: {},
    posAtendimento: {},
    posAtendimentoExclusoes: {},
    arquivosLocais: {},
    limpezasStoragePendentes: [],
    conflitos: [],
    auditoriaPostgresql: null,
    ultimaSincronizacaoEm: '',
    ultimoErro: ''
  };
}

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

class DesktopStateStore {
  constructor(rootDir) {
    if (!rootDir) throw new Error('Diretório raiz obrigatório para o estado Supabase.');
    this.rootDir = rootDir;
    this.filePath = path.join(rootDir, 'supabase-desktop-state.json');
    this.state = null;
  }

  carregar() {
    if (this.state) return this.state;
    let lido = null;
    try {
      if (fs.existsSync(this.filePath)) {
        lido = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (erro) {
      const corrompido = this.filePath + '.corrompido-' + Date.now();
      try { fs.renameSync(this.filePath, corrompido); } catch (_) { /* best effort */ }
      console.error('[Supabase] Estado local corrompido foi isolado:', erro.message);
    }

    const base = estadoInicial();
    this.state = Object.assign(base, lido || {}, {
      versao: VERSAO_ESTADO,
      fila: Array.isArray(lido?.fila) ? lido.fila : [],
      filaAssinaturas: Array.isArray(lido?.filaAssinaturas) ? lido.filaAssinaturas : [],
      mapeamentosOS: lido?.mapeamentosOS && typeof lido.mapeamentosOS === 'object' ? lido.mapeamentosOS : {},
      mapeamentosEstoque: lido?.mapeamentosEstoque && typeof lido.mapeamentosEstoque === 'object' ? lido.mapeamentosEstoque : {},
      documentosComerciais: lido?.documentosComerciais && typeof lido.documentosComerciais === 'object' ? lido.documentosComerciais : {},
      arquivosLocais: lido?.arquivosLocais && typeof lido.arquivosLocais === 'object' ? lido.arquivosLocais : {},
      limpezasStoragePendentes: Array.isArray(lido?.limpezasStoragePendentes) ? lido.limpezasStoragePendentes : [],
      conflitos: Array.isArray(lido?.conflitos) ? lido.conflitos : []
    });
    this.salvar();
    return this.state;
  }

  obter() {
    return clonar(this.carregar());
  }

  salvar() {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const temporario = this.filePath + '.tmp';
    fs.writeFileSync(temporario, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temporario, this.filePath);
  }

  alterar(mutador) {
    const atual = this.carregar();
    const retorno = mutador(atual);
    this.salvar();
    return retorno;
  }

  trocarEmpresa(empresaId) {
    this.alterar((estado) => {
      if (estado.empresaId && estado.empresaId !== empresaId) {
        estado.ultimoPullEm = '1970-01-01T00:00:00.000Z';
        estado.ultimaReconciliacaoOSCompletaEm = '';
        estado.ultimoPullExclusoesEm = '1970-01-01T00:00:00.000Z';
        estado.ultimoPullEstoqueEm = '1970-01-01T00:00:00.000Z';
        estado.ultimoPullComercialEm = '1970-01-01T00:00:00.000Z';
        estado.ultimoPullArquivosEm = '1970-01-01T00:00:00.000Z';
        estado.fila = [];
        estado.filaAssinaturas = [];
        estado.mapeamentosOS = {};
        estado.mapeamentosEstoque = {};
        estado.documentosComerciais = {};
        estado.posAtendimento = {};
        estado.posAtendimentoExclusoes = {};
        estado.arquivosLocais = {};
        estado.limpezasStoragePendentes = [];
        estado.conflitos = [];
        estado.auditoriaPostgresql = null;
      }
      estado.empresaId = empresaId || '';
      estado.dispositivoId = '';
    });
  }

  registrarMapeamentoOS(numero, linha) {
    if (!numero || !linha?.id) return;
    this.alterar((estado) => {
      estado.mapeamentosOS[numero] = {
        id: linha.id,
        revision: Number(linha.revision) || 1,
        idExportacao: linha.id_exportacao || '',
        updatedAt: linha.updated_at || new Date().toISOString()
      };
    });
  }

  confirmarExclusaoOSRemota(numero, linha = {}) {
    if (!numero) return;
    this.alterar((estado) => {
      // Uma alteracao local antiga nao pode recriar uma OS que outro
      // dispositivo ja apagou. O tombstone do servidor sempre prevalece.
      estado.fila = (estado.fila || []).filter((item) =>
        !(item.entidade === 'ordem_servico' && item.numero === numero)
      );
      estado.conflitos = (estado.conflitos || []).filter((item) => item.numero !== numero);
      if (linha?.id) {
        estado.mapeamentosOS[numero] = {
          id: linha.id,
          revision: Number(linha.revision) || 1,
          idExportacao: linha.id_exportacao || '',
          updatedAt: linha.updated_at || linha.deleted_at || new Date().toISOString(),
          deletedAt: linha.deleted_at || new Date().toISOString()
        };
      }
    });
  }

  enfileirarOS(operacao, numero, dados) {
    if (!['insert', 'update', 'delete'].includes(operacao)) throw new Error('Operação de sincronização inválida.');
    if (!numero) throw new Error('Número da OS obrigatório para enfileirar.');
    return this.alterar((estado) => {
      const conflitoExistente = estado.fila.find((item) => item.entidade === 'ordem_servico' && item.numero === numero && item.status === 'conflito');
      if (conflitoExistente || estado.conflitos.some((item) => item.numero === numero)) {
        return clonar(conflitoExistente || {
          entidade: 'ordem_servico', numero, status: 'conflito', operacao, dados
        });
      }
      const existente = estado.fila.find((item) => item.entidade === 'ordem_servico' && item.numero === numero && item.status === 'pendente');
      if (existente) {
        if (existente.operacao === 'insert' && operacao === 'delete') {
          estado.fila = estado.fila.filter((item) => item !== existente);
          return null;
        }
        existente.operacao = existente.operacao === 'insert' ? 'insert' : operacao;
        existente.dados = dados || {};
        existente.atualizadoEm = new Date().toISOString();
        existente.proximaTentativaEm = '';
        existente.ultimoErro = '';
        return clonar(existente);
      }
      const item = {
        id: crypto.randomUUID(),
        entidade: 'ordem_servico',
        operacao,
        numero,
        dados: dados || {},
        status: 'pendente',
        tentativas: 0,
        proximaTentativaEm: '',
        ultimoErro: '',
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString()
      };
      estado.fila.push(item);
      return clonar(item);
    });
  }

  enfileirarAssinatura(pacote) {
    const idEnvio = String(pacote?.idEnvioAssinatura || '').trim();
    if (!idEnvio) throw new Error('Identificador da assinatura obrigatório para enfileirar.');
    return this.alterar((estado) => {
      estado.filaAssinaturas = Array.isArray(estado.filaAssinaturas) ? estado.filaAssinaturas : [];
      const existente = estado.filaAssinaturas.find((item) => item.idEnvioAssinatura === idEnvio);
      if (existente) {
        existente.pacote = pacote;
        existente.proximaTentativaEm = '';
        existente.ultimoErro = '';
        existente.atualizadoEm = new Date().toISOString();
        return clonar(existente);
      }
      const item = {
        id: crypto.randomUUID(),
        idEnvioAssinatura: idEnvio,
        pacote,
        tentativas: 0,
        proximaTentativaEm: '',
        ultimoErro: '',
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString()
      };
      estado.filaAssinaturas.push(item);
      return clonar(item);
    });
  }

  confirmarAssinaturaEnviada(idEnvioAssinatura) {
    const idEnvio = String(idEnvioAssinatura || '').trim();
    if (!idEnvio) return;
    this.alterar((estado) => {
      estado.filaAssinaturas = (estado.filaAssinaturas || []).filter(
        (item) => item.idEnvioAssinatura !== idEnvio
      );
    });
  }

  registrarArquivoLocal(localId, dados) {
    if (!localId || !dados?.path) return;
    this.alterar((estado) => {
      estado.arquivosLocais[localId] = Object.assign({}, dados, { atualizadoEm: new Date().toISOString() });
    });
  }

  registrarMapeamentoEstoque(tipo, localId, linha, hashLocal) {
    if (!tipo || !localId || !linha?.id) return;
    this.alterar((estado) => {
      const chave = `${tipo}:${localId}`;
      estado.mapeamentosEstoque[chave] = {
        id: linha.id,
        tipo,
        localId,
        revision: Number(linha.revision) || 1,
        hashLocal: hashLocal || '',
        updatedAt: linha.updated_at || new Date().toISOString(),
        deletedAt: linha.deleted_at || ''
      };
    });
  }
}

module.exports = { DesktopStateStore, estadoInicial, VERSAO_ESTADO };
