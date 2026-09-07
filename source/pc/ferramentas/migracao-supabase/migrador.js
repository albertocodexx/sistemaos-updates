const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ORIGEM_PADRAO = 'sistema-os-json-v5';

function objetoOrdenado(valor) {
  if (Array.isArray(valor)) return valor.map(objetoOrdenado);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.keys(valor).sort().reduce((acc, chave) => {
    acc[chave] = objetoOrdenado(valor[chave]);
    return acc;
  }, {});
}

function sha256(valor) {
  if (Buffer.isBuffer(valor)) return crypto.createHash('sha256').update(valor).digest('hex');
  const texto = typeof valor === 'string' ? valor : JSON.stringify(objetoOrdenado(valor));
  return crypto.createHash('sha256').update(texto).digest('hex');
}

function texto(valor) {
  return valor === null || valor === undefined ? '' : String(valor).trim();
}

function somenteDigitos(valor) {
  return texto(valor).replace(/\D/g, '');
}

function iso(valor, fallback) {
  const baseDeterministica = fallback || '1970-01-01T00:00:00.000Z';
  const data = valor ? new Date(valor) : new Date(baseDeterministica);
  return Number.isNaN(data.getTime()) ? new Date(baseDeterministica).toISOString() : data.toISOString();
}

function data(valor, fallback) {
  return iso(valor, fallback).slice(0, 10);
}

function numeroOS(valor) {
  const n = Number(String(valor || '').match(/\d+/)?.[0]);
  return Number.isInteger(n) && n > 0 ? `OS-${String(n).padStart(4, '0')}` : '';
}

function sequencialOS(valor) {
  return Number(numeroOS(valor).match(/\d+/)?.[0]) || 0;
}

function idExportacao(tipo, registro, origem) {
  const existente = texto(registro.origemIdExportacao || registro.idExportacao || registro.idEnvioAssinatura);
  const referencia = tipo === 'os' ? numeroOS(registro.numero) : numeroOS(registro.numeroOS);
  return existente || `legacy:${origem}:${tipo}:${referencia || sha256(registro).slice(0, 16)}`;
}

function limparExtras(valor) {
  if (Array.isArray(valor)) return valor.map(limparExtras);
  if (!valor || typeof valor !== 'object') return valor;
  const saida = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (/base64|senha|token|secret|api.?key|pdfPath|logoPath|path$/i.test(chave)) continue;
    saida[chave] = limparExtras(item);
  }
  return saida;
}

function sanitizarConfiguracao(config) {
  const proibidos = /senha|token|secret|api.?key|firebaseConfig|cloudinaryConfig|supabaseConfig|logoBase64|logoPath/i;
  return Object.entries(config || {}).reduce((acc, [chave, valor]) => {
    if (!proibidos.test(chave)) acc[chave] = limparExtras(valor);
    return acc;
  }, {});
}

function mapearOS(local, origem) {
  const aparelho = local.aparelho || {};
  const diagnostico = local.diagnosticoTecnico || {};
  const numero = numeroOS(local.numero);
  if (!numero) throw new Error(`Número de OS inválido: ${local.numero || '(vazio)'}`);
  return {
    chaveLegada: idExportacao('os', local, origem),
    numero,
    row: {
      numero,
      numero_sequencial: sequencialOS(numero),
      id_exportacao: idExportacao('os', local, origem),
      cliente_nome_snapshot: texto(local.cliente?.nome) || 'Cliente não informado',
      cliente_telefone_snapshot: texto(local.cliente?.telefone) || null,
      cliente_cpf_snapshot: somenteDigitos(local.cliente?.cpf).slice(0, 11) || null,
      aparelho: texto([aparelho.marca, aparelho.modelo].filter(Boolean).join(' ')) || null,
      marca: texto(aparelho.marca) || null,
      modelo: texto(aparelho.modelo) || null,
      cor: texto(aparelho.cor) || null,
      imei: texto(local.imei || aparelho.imei) || null,
      senha_aparelho: texto(aparelho.senhaAparelho) || null,
      acessorios: texto(aparelho.acessorios) || null,
      estado_aparelho: texto(aparelho.observacoes) || null,
      defeito_relatado: texto(aparelho.defeitoRelatado) || 'Não informado',
      diagnostico: texto(diagnostico.diagnostico) || null,
      servico_realizado: texto(diagnostico.solucao) || null,
      observacoes: texto(local.observacoes) || null,
      termos: texto(local.termos) || null,
      status: texto(local.status) || 'Aguardando análise',
      prioridade: texto(local.prioridade) || 'Normal',
      valor: Math.max(0, Number(diagnostico.valorEstimado || local.valor || 0) || 0),
      forma_pagamento: texto(local.formaPagamento) || null,
      status_pagamento: texto(local.statusPagamento),
      garantia_dias: Math.max(0, Math.trunc(Number(local.garantiaDias) || 0)),
      data_abertura: iso(local.data),
      data_prevista: local.dataPrevista ? data(local.dataPrevista) : null,
      hora_prevista: texto(local.horaPrevista).slice(0, 5) || null,
      origem: 'migracao',
      revision: Math.max(1, Number(local.supabaseRevision) || 1),
      dados_extras: limparExtras({
        legado: true,
        origem_local: local.origem || 'pc',
        cliente_email: local.cliente?.email || '',
        tipo_equipamento: aparelho.tipoEquipamento || aparelho.tipo || '',
        dados_equipamento: aparelho.dadosEquipamento || {},
        controle_interno: local.controleInterno || {},
        tecnico_responsavel: local.tecnicoResponsavel || '',
        tecnico_auxiliar: local.tecnicoAuxiliar || '',
        checklist_entrada: local.checklistEntrada || [],
        observacoes_entrada: local.observacoesEntrada || '',
        checklist_saida: local.checklistSaida || [],
        observacoes_saida: local.observacoesSaida || ''
      }),
      created_at: iso(local.data),
      updated_at: iso(local.supabaseUpdatedAt || local.data)
    },
    local
  };
}

function mapearGarantia(local, osRemota, origem) {
  const numero = numeroOS(local.numeroOS);
  if (!numero || !osRemota?.id) throw new Error(`Garantia sem OS correspondente: ${local.numeroOS || '(vazio)'}`);
  const inicio = data(local.dataInicio || local.criadoEm);
  return {
    chaveLegada: idExportacao('garantia', local, origem),
    numeroOS: numero,
    row: {
      ordem_servico_id: osRemota.id,
      numero_os_snapshot: numero,
      cliente_nome_snapshot: texto(local.clienteNome) || osRemota.cliente_nome_snapshot || 'Cliente não informado',
      cliente_telefone_snapshot: texto(local.clienteTelefone) || null,
      aparelho_snapshot: texto([local.marca, local.modelo].filter(Boolean).join(' ')) || null,
      marca_snapshot: texto(local.marca) || null,
      modelo_snapshot: texto(local.modelo) || null,
      imei_snapshot: texto(local.imei) || null,
      reparo_realizado: texto(local.servicoRealizado) || null,
      termos: texto(local.termos) || null,
      status: 'ativa',
      garantia_dias: Math.max(0, Math.trunc(Number(local.garantiaDias) || 0)),
      data_abertura: inicio,
      data_limite: local.dataLimite ? data(local.dataLimite) : null,
      id_exportacao: idExportacao('garantia', local, origem),
      created_at: iso(local.criadoEm || local.dataInicio),
      updated_at: iso(local.atualizadoEm || local.criadoEm || local.dataInicio)
    },
    local
  };
}

function mapearEntrega(local, osRemota, origem, pendente = false) {
  const numero = numeroOS(local.numeroOS);
  if (!numero || !osRemota?.id) throw new Error(`Entrega sem OS correspondente: ${local.numeroOS || '(vazio)'}`);
  const concluida = !pendente && !!(local.dataHoraAssinatura || local.assinaturaRetirouBase64);
  return {
    chaveLegada: idExportacao('entrega', local, origem),
    numeroOS: numero,
    row: {
      ordem_servico_id: osRemota.id,
      numero_os_snapshot: numero,
      cliente_nome_snapshot: texto(local.clienteNome || local.nomeCliente) || osRemota.cliente_nome_snapshot || 'Cliente não informado',
      retirado_por: texto(local.nomeRetirou) || null,
      aparelho_snapshot: texto([local.marca, local.modelo].filter(Boolean).join(' ')) || null,
      marca_snapshot: texto(local.marca) || null,
      modelo_snapshot: texto(local.modelo) || null,
      reparo_realizado: texto(local.reparoRealizado) || null,
      status: concluida ? 'concluida' : 'pendente_assinatura',
      entregue_em: concluida ? iso(local.dataHoraAssinatura) : null,
      garantia_dias: Math.max(0, Math.trunc(Number(local.garantiaDias) || 0)),
      data_limite_garantia: local.dataLimiteGarantia ? data(local.dataLimiteGarantia) : null,
      forma_entrega: texto(local.formaEntrega) || null,
      observacoes: texto(local.declaracao || local.observacoes) || null,
      id_envio_assinatura: texto(local.idEnvioAssinatura) || null,
      id_exportacao: idExportacao('entrega', local, origem),
      created_at: iso(local.criadoEm || local.dataHoraAssinatura),
      updated_at: iso(local.atualizadoEm || local.dataHoraAssinatura || local.criadoEm)
    },
    local
  };
}

function resolverEmail(usuario, config, mapaUsuarios, totalUsuarios) {
  const mapeado = mapaUsuarios?.[usuario.usuario] || mapaUsuarios?.[usuario.id];
  if (typeof mapeado === 'string') return mapeado;
  if (mapeado?.email) return mapeado.email;
  if (totalUsuarios === 1 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(texto(config.email))) return texto(config.email);
  return '';
}

function planejarMigracao(database, opcoes = {}) {
  const origem = opcoes.origem || ORIGEM_PADRAO;
  const config = database.config || {};
  const ordens = [];
  const erros = [];
  for (const local of (database.ordens || [])) {
    try { ordens.push(mapearOS(local, origem)); }
    catch (erro) { erros.push({ tipo: 'ordem_servico', referencia: local.numero || '', erro: erro.message }); }
  }
  const porNumero = new Map(ordens.map((item) => [item.numero, { id: `dry-run:${item.numero}`, ...item.row }]));
  const garantias = [];
  for (const local of (database.garantias || [])) {
    try { garantias.push(mapearGarantia(local, porNumero.get(numeroOS(local.numeroOS)), origem)); }
    catch (erro) { erros.push({ tipo: 'garantia', referencia: local.numeroOS || '', erro: erro.message }); }
  }
  const entregas = [];
  for (const local of (database.entregas || [])) {
    try { entregas.push(mapearEntrega(local, porNumero.get(numeroOS(local.numeroOS)), origem, false)); }
    catch (erro) { erros.push({ tipo: 'entrega', referencia: local.numeroOS || '', erro: erro.message }); }
  }
  for (const local of (database.entregasPendentes || [])) {
    try { entregas.push(mapearEntrega(local, porNumero.get(numeroOS(local.numeroOS)), origem, true)); }
    catch (erro) { erros.push({ tipo: 'entrega', referencia: local.numeroOS || '', erro: erro.message }); }
  }

  const usuarios = (database.usuarios || []).map((usuario) => ({
    chaveLegada: `usuario:${texto(usuario.id || usuario.usuario)}`,
    usuarioLocal: texto(usuario.usuario),
    nome: texto(usuario.nome || usuario.usuario) || 'Usuário',
    email: resolverEmail(usuario, config, opcoes.mapaUsuarios || {}, (database.usuarios || []).length),
    cargo: texto(usuario.perfil) === 'admin' ? 'Administrador' : 'Atendente',
    ativo: usuario.status !== 'inativo' && usuario.status !== 'bloqueado',
    senhaLegadaDescartada: true
  }));
  // Arquivos de provedores externos antigos não são importados. O fluxo
  // atual cataloga e envia somente arquivos locais pelo Supabase Storage.
  const arquivos = [];

  const identidadeEmpresa = {
    nome: texto(config.nomeFantasia || config.nomeEmpresa) || 'Empresa migrada',
    razaoSocial: texto(config.razaoSocial),
    cnpj: somenteDigitos(config.cnpj).slice(0, 14),
    telefone: somenteDigitos(config.telefonePrincipal || config.telefoneEmpresa)
  };
  return {
    origem,
    empresa: {
      chaveLegada: `empresa:${sha256(identidadeEmpresa).slice(0, 24)}`,
      row: {
        nome_fantasia: identidadeEmpresa.nome,
        razao_social: identidadeEmpresa.razaoSocial || null,
        cnpj: identidadeEmpresa.cnpj.length === 14 ? identidadeEmpresa.cnpj : null,
        ativo: true,
        licenca_status: opcoes.licencaStatus || 'teste',
        licenca_expira_em: opcoes.licencaExpiraEm || null,
        modo_armazenamento: opcoes.modoArmazenamento || 'economico'
      },
      configuracoes: sanitizarConfiguracao(config)
    },
    usuarios, ordens, garantias, entregas, arquivos, erros,
    avisos: [
      ...usuarios.filter((u) => !u.email).map((u) => `Usuário "${u.usuarioLocal}" sem e-mail mapeado; não poderá ser criado.`),
      'Hashes de senha locais não são compatíveis com Supabase Auth e nunca são enviados.',
      'Fotos, PDFs, assinaturas Base64, caminhos e URLs externas antigas não são enviados automaticamente.'
    ]
  };
}

function resumoPlano(plano) {
  return {
    empresa: 1,
    usuarios: plano.usuarios.length,
    usuariosSemEmail: plano.usuarios.filter((u) => !u.email).length,
    ordensServico: plano.ordens.length,
    garantias: plano.garantias.length,
    entregas: plano.entregas.length,
    arquivosExternosIgnorados: plano.arquivos.length,
    arquivosLocaisIgnorados: [...plano.ordens, ...plano.garantias, ...plano.entregas]
      .reduce((n, item) => n + (item.local?.pdfPath ? 1 : 0) + (item.local?.fotos?.length || 0), 0),
    errosValidacao: plano.erros.length
  };
}

function valoresEquivalentes(chave, esperado, atual) {
  if (esperado === null || esperado === undefined) return atual === null || atual === undefined;
  if (typeof esperado === 'object') return JSON.stringify(objetoOrdenado(esperado)) === JSON.stringify(objetoOrdenado(atual));
  if (/(^data_|_at$|_em$)/.test(chave) && !Number.isNaN(new Date(esperado).getTime()) && !Number.isNaN(new Date(atual).getTime())) {
    return new Date(esperado).getTime() === new Date(atual).getTime();
  }
  if (typeof esperado === 'number' && Number.isFinite(Number(atual))) return esperado === Number(atual);
  return String(esperado) === String(atual);
}

function linhaEquivalente(esperada, atual) {
  if (!atual) return false;
  return Object.entries(esperada).every(([chave, valor]) => valoresEquivalentes(chave, valor, atual[chave]));
}

async function buscarUnico(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

class ExecutorMigracao {
  constructor({ supabase, plano, empresaId, atualizarExistentes = false }) {
    this.supabase = supabase;
    this.plano = plano;
    this.empresaIdForcado = empresaId || '';
    this.atualizarExistentes = atualizarExistentes;
    this.resultados = { criados: [], ignorados: [], conflitos: [], erros: [] };
    this.osRemotas = new Map();
  }

  async ledger(tipo, chave) {
    return buscarUnico(this.supabase.from('migracoes_legado').select('*')
      .eq('origem', this.plano.origem).eq('entidade_tipo', tipo).eq('chave_legada', chave));
  }

  async gravarLedger(empresaId, tipo, chave, entidadeId, checksum, detalhes = {}) {
    const { error } = await this.supabase.from('migracoes_legado').upsert({
      empresa_id: empresaId, origem: this.plano.origem, entidade_tipo: tipo,
      chave_legada: chave, entidade_id: entidadeId || null, checksum_sha256: checksum,
      status: 'concluido', detalhes
    }, { onConflict: 'origem,entidade_tipo,chave_legada' });
    if (error) throw error;
  }

  async migrarEmpresa() {
    const item = this.plano.empresa;
    const checksum = sha256(item.row);
    const anterior = await this.ledger('empresa', item.chaveLegada);
    let empresa = null;
    if (this.empresaIdForcado) {
      empresa = await buscarUnico(this.supabase.from('empresas').select('*').eq('id', this.empresaIdForcado));
      if (!empresa) throw new Error('A empresa informada em --empresa-id não existe.');
    } else if (anterior?.entidade_id) {
      empresa = await buscarUnico(this.supabase.from('empresas').select('*').eq('id', anterior.entidade_id));
    } else if (item.row.cnpj) {
      empresa = await buscarUnico(this.supabase.from('empresas').select('*').eq('cnpj', item.row.cnpj));
    }
    let conflitoEmpresa = false;
    if (!empresa) {
      const { data, error } = await this.supabase.from('empresas').insert(item.row).select('*').single();
      if (error) throw error;
      empresa = data;
      this.resultados.criados.push({ tipo: 'empresa', referencia: empresa.id });
    } else if (anterior && anterior.checksum_sha256 !== checksum && !this.atualizarExistentes) {
      this.resultados.conflitos.push({ tipo: 'empresa', referencia: empresa.id, motivo: 'dados locais mudaram após migração anterior' });
      conflitoEmpresa = true;
    } else if (this.atualizarExistentes) {
      const { error } = await this.supabase.from('empresas').update(item.row).eq('id', empresa.id);
      if (error) throw error;
    }
    if (!conflitoEmpresa) {
      await this.supabase.from('configuracoes_empresa').upsert({
        empresa_id: empresa.id,
        configuracoes: item.configuracoes,
        feature_flags: { supabaseAtivo: true, storageProvider: 'supabase-storage' }
      }, { onConflict: 'empresa_id' }).then(({ error }) => { if (error) throw error; });
      await this.gravarLedger(empresa.id, 'empresa', item.chaveLegada, empresa.id, checksum);
    }
    return empresa;
  }

  async buscarAuthPorEmail(email) {
    for (let pagina = 1; pagina <= 20; pagina += 1) {
      const { data, error } = await this.supabase.auth.admin.listUsers({ page: pagina, perPage: 1000 });
      if (error) throw error;
      const achado = (data.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (achado) return achado;
      if ((data.users || []).length < 1000) break;
    }
    return null;
  }

  async migrarUsuarios(empresa) {
    for (const item of this.plano.usuarios) {
      if (!item.email) {
        this.resultados.ignorados.push({ tipo: 'usuario', referencia: item.usuarioLocal, motivo: 'e-mail não mapeado' });
        continue;
      }
      try {
        const checksum = sha256({ email: item.email, nome: item.nome, cargo: item.cargo, ativo: item.ativo });
        const ledger = await this.ledger('usuario', item.chaveLegada);
        if (ledger?.checksum_sha256 === checksum) {
          this.resultados.ignorados.push({ tipo: 'usuario', referencia: item.usuarioLocal, motivo: 'já migrado' });
          continue;
        }
        if (ledger && !this.atualizarExistentes) {
          this.resultados.conflitos.push({ tipo: 'usuario', referencia: item.usuarioLocal, motivo: 'dados locais mudaram após migração anterior' });
          continue;
        }
        let authUser = await this.buscarAuthPorEmail(item.email);
        if (!authUser) {
          const senhaTemporaria = crypto.randomBytes(32).toString('base64url');
          const { data, error } = await this.supabase.auth.admin.createUser({
            email: item.email, password: senhaTemporaria, email_confirm: true,
            user_metadata: { migrado: true, precisa_redefinir_senha: true }
          });
          if (error) throw error;
          authUser = data.user;
          this.resultados.criados.push({ tipo: 'usuario', referencia: item.email, acaoNecessaria: 'usar recuperação de senha no primeiro acesso' });
        }
        const { error: perfilErro } = await this.supabase.from('perfis').upsert({
          id: authUser.id, empresa_id: empresa.id, nome: item.nome, cargo: item.cargo,
          permissoes: item.cargo === 'Administrador' ? { os: true, configuracoes: true } : { os: true },
          ativo: item.ativo
        }, { onConflict: 'id' });
        if (perfilErro) throw perfilErro;
        await this.gravarLedger(empresa.id, 'usuario', item.chaveLegada, authUser.id, checksum, { email: item.email });
      } catch (erro) {
        this.resultados.erros.push({ tipo: 'usuario', referencia: item.usuarioLocal, erro: erro.message });
      }
    }
  }

  async migrarOS(empresa) {
    let maior = 0;
    for (const item of this.plano.ordens) {
      maior = Math.max(maior, item.row.numero_sequencial);
      try {
        const checksum = sha256(item.row);
        const ledger = await this.ledger('ordem_servico', item.chaveLegada);
        let remota = null;
        if (ledger?.entidade_id) remota = await buscarUnico(this.supabase.from('ordens_servico').select('*').eq('id', ledger.entidade_id));
        if (!remota) remota = await buscarUnico(this.supabase.from('ordens_servico').select('*').eq('empresa_id', empresa.id).eq('id_exportacao', item.row.id_exportacao));
        if (!remota) remota = await buscarUnico(this.supabase.from('ordens_servico').select('*').eq('empresa_id', empresa.id).eq('numero', item.numero));
        let podeVincular = false;
        if (ledger?.checksum_sha256 === checksum && remota) {
          this.resultados.ignorados.push({ tipo: 'ordem_servico', referencia: item.numero, motivo: 'já migrada' });
          podeVincular = true;
        } else if (remota && !ledger && linhaEquivalente({ empresa_id: empresa.id, ...item.row }, remota)) {
          this.resultados.ignorados.push({ tipo: 'ordem_servico', referencia: item.numero, motivo: 'já existia com o mesmo conteúdo; vínculo recuperado' });
          podeVincular = true;
        } else if (remota) {
          this.resultados.conflitos.push({ tipo: 'ordem_servico', referencia: item.numero, motivo: 'número/idExportacao já existe ou conteúdo mudou' });
        } else {
          const { data, error } = await this.supabase.from('ordens_servico').insert({ empresa_id: empresa.id, ...item.row }).select('*').single();
          if (error) throw error;
          remota = data;
          this.resultados.criados.push({ tipo: 'ordem_servico', referencia: item.numero });
          podeVincular = true;
        }
        if (remota && podeVincular) {
          this.osRemotas.set(item.numero, remota);
          await this.gravarLedger(empresa.id, 'ordem_servico', item.chaveLegada, remota.id, checksum, { numero: item.numero });
        }
      } catch (erro) {
        this.resultados.erros.push({ tipo: 'ordem_servico', referencia: item.numero, erro: erro.message });
      }
    }
    if (maior) {
      const existente = await buscarUnico(this.supabase.from('sequencias_documentos').select('*')
        .eq('empresa_id', empresa.id).eq('tipo', 'os'));
      const proximo = Math.max(maior + 1, Number(existente?.proximo_valor) || 1);
      const consulta = existente
        ? this.supabase.from('sequencias_documentos').update({ proximo_valor: proximo }).eq('empresa_id', empresa.id).eq('tipo', 'os')
        : this.supabase.from('sequencias_documentos').insert({ empresa_id: empresa.id, tipo: 'os', proximo_valor: proximo });
      const { error } = await consulta;
      if (error) throw error;
    }
  }

  async migrarDependentes(empresa, tipo, itens, tabela) {
    for (const item of itens) {
      try {
        const osRemota = this.osRemotas.get(item.numeroOS);
        if (!osRemota) throw new Error('OS correspondente não foi migrada ou está em conflito.');
        const row = { empresa_id: empresa.id, ...item.row, ordem_servico_id: osRemota.id };
        const checksum = sha256(row);
        const ledger = await this.ledger(tipo, item.chaveLegada);
        let remota = ledger?.entidade_id
          ? await buscarUnico(this.supabase.from(tabela).select('*').eq('id', ledger.entidade_id))
          : await buscarUnico(this.supabase.from(tabela).select('*').eq('empresa_id', empresa.id).eq('ordem_servico_id', osRemota.id));
        let podeVincular = false;
        if (ledger?.checksum_sha256 === checksum && remota) {
          this.resultados.ignorados.push({ tipo, referencia: item.numeroOS, motivo: 'já migrado' });
          podeVincular = true;
        } else if (remota && !ledger && linhaEquivalente(row, remota)) {
          this.resultados.ignorados.push({ tipo, referencia: item.numeroOS, motivo: 'já existia com o mesmo conteúdo; vínculo recuperado' });
          podeVincular = true;
        } else if (remota) {
          this.resultados.conflitos.push({ tipo, referencia: item.numeroOS, motivo: 'registro já existe ou conteúdo mudou' });
        } else {
          const { data, error } = await this.supabase.from(tabela).insert(row).select('*').single();
          if (error) throw error;
          remota = data;
          this.resultados.criados.push({ tipo, referencia: item.numeroOS });
          podeVincular = true;
        }
        if (remota && podeVincular) await this.gravarLedger(empresa.id, tipo, item.chaveLegada, remota.id, checksum, { numeroOS: item.numeroOS });
      } catch (erro) {
        this.resultados.erros.push({ tipo, referencia: item.numeroOS, erro: erro.message });
      }
    }
  }

  async executar() {
    const empresa = await this.migrarEmpresa();
    await this.migrarUsuarios(empresa);
    await this.migrarOS(empresa);
    await this.migrarDependentes(empresa, 'garantia', this.plano.garantias, 'garantias');
    await this.migrarDependentes(empresa, 'entrega', this.plano.entregas, 'entregas');
    return { empresaId: empresa.id, ...this.resultados };
  }
}

function lerJson(caminho) {
  const absoluto = path.resolve(caminho);
  const stat = fs.statSync(absoluto);
  if (!stat.isFile()) throw new Error('A origem informada não é um arquivo.');
  if (stat.size > 512 * 1024 * 1024) throw new Error('Arquivo de origem excede o limite de 512 MB.');
  const database = JSON.parse(fs.readFileSync(absoluto, 'utf8'));
  if (!database || !Array.isArray(database.ordens)) throw new Error('JSON não possui o formato esperado do Sistema OS.');
  return { database, absoluto, tamanhoBytes: stat.size, checksum: sha256(fs.readFileSync(absoluto)) };
}

module.exports = {
  ORIGEM_PADRAO, sha256, numeroOS, iso, sanitizarConfiguracao, mapearOS,
  mapearGarantia, mapearEntrega, planejarMigracao,
  resumoPlano, ExecutorMigracao, lerJson, linhaEquivalente
};
