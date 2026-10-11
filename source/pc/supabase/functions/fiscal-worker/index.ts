import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  baixarPdfNfseNfeio,
  baixarXmlNfseNfeio,
  cancelarNfseNfeio,
  consultarNfseNfeio,
  emitirNfseNfeio, estadoNfseNfeio
} from '../_shared/nfeio-nfse.ts';
import { processarNotasAssinaturas } from '../_shared/notas-assinaturas.ts';
import { baixarDanfeProdutoNfeio, baixarXmlProdutoNfeio, cancelarDocumentoProdutoNfeio,
  consultarDocumentoProdutoNfeio, emitirDocumentoProdutoNfeio, estadoDocumentoProdutoNfeio,
  type TipoDocumentoProduto } from '../_shared/nfeio-produtos.ts';
import { ativarInscricaoEstadualNfeio } from '../_shared/nfeio-onboarding.ts';

type Registro = Record<string, any>;

const headers = { 'Content-Type': 'application/json; charset=utf-8' };
const texto = (valor: unknown) => String(valor ?? '').trim();
const responder = (status: number, corpo: Registro) =>
  new Response(JSON.stringify(corpo), { status, headers });

function segredoIgual(recebido: string, esperado: string) {
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(esperado);
  if (!a.length || a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i += 1) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

function proximaTentativa(tentativas: number) {
  const segundos = Math.min(3600, 30 * (2 ** Math.min(7, Math.max(0, tentativas - 1))));
  return new Date(Date.now() + segundos * 1000).toISOString();
}

function podeTentar(payload: Registro) {
  const proxima = Date.parse(texto(payload?.processamento?.proxima_tentativa_em));
  return !Number.isFinite(proxima) || proxima <= Date.now();
}

function estadoNfeio(retorno: Registro) {
  return estadoNfseNfeio(retorno);
}

function payloadComProcessamento(payload: Registro, atualizacao: Registro) {
  return {
    ...(payload && typeof payload === 'object' ? payload : {}),
    processamento: {
      ...(payload?.processamento && typeof payload.processamento === 'object' ? payload.processamento : {}),
      ...atualizacao
    }
  };
}

async function registrarFalhaTemporaria(admin: any, nota: Registro, motivo: string) {
  const tentativas = Number(nota.payload?.processamento?.tentativas || 0) + 1;
  const payload = payloadComProcessamento(nota.payload, {
    tentativas,
    ultima_tentativa_em: new Date().toISOString(),
    proxima_tentativa_em: proximaTentativa(tentativas)
  });
  await admin.from('notas_fiscais').update({
    status: nota.status === 'autorizada' ? 'autorizada' : 'processando',
    payload,
    ultimo_erro: motivo.slice(0, 300),
    updated_at: new Date().toISOString()
  }).eq('id', nota.id).eq('empresa_id', nota.empresa_id);
}

async function guardarDocumentos(admin: any, nota: Registro, empresaNfeioId: string,
  emissaoId: string, chave: string) {
  const documentos = nota.payload?.documentos && typeof nota.payload.documentos === 'object'
    ? nota.payload.documentos : {};
  let pdfPath = texto(nota.danfse_storage_path || documentos.pdf_storage_path);
  let xmlPath = texto(documentos.xml_storage_path);
  let erro = '';

  if (!pdfPath) {
    const pdf = await baixarPdfNfseNfeio(empresaNfeioId, emissaoId, chave);
    if (pdf.ok) {
      pdfPath = `${nota.empresa_id}/${nota.id}/DANFSe.pdf`;
      const envio = await admin.storage.from('documentos-fiscais').upload(pdfPath, pdf.bytes, {
        contentType: 'application/pdf', cacheControl: '3600', upsert: true
      });
      if (envio.error) { pdfPath = ''; erro = 'DANFSe temporariamente indisponivel.'; }
    } else erro = 'DANFSe temporariamente indisponivel.';
  }

  if (!xmlPath) {
    const xml = await baixarXmlNfseNfeio(empresaNfeioId, emissaoId, chave);
    if (xml.ok) {
      xmlPath = `${nota.empresa_id}/${nota.id}/NFS-e.xml`;
      const envio = await admin.storage.from('documentos-fiscais').upload(xmlPath, xml.bytes, {
        contentType: 'application/xml', cacheControl: '3600', upsert: true
      });
      if (envio.error) { xmlPath = ''; erro ||= 'XML temporariamente indisponivel.'; }
    } else erro ||= 'XML temporariamente indisponivel.';
  }

  const payload = {
    ...(nota.payload || {}),
    documentos: {
      ...documentos,
      pdf_storage_path: pdfPath || null,
      xml_storage_path: xmlPath || null,
      atualizado_em: new Date().toISOString()
    },
    processamento: {
      ...(nota.payload?.processamento || {}),
      proxima_tentativa_em: erro ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null
    }
  };
  return { payload, pdfPath, xmlPath, erro };
}

async function processarNota(admin: any, nota: Registro, chave: string) {
  const { data: config, error: configErro } = await admin.from('configuracoes_fiscais')
    .select('provedor,ambiente,status,metadados').eq('empresa_id', nota.empresa_id).maybeSingle();
  if (configErro) throw configErro;
  const empresaNfeioId = texto(config?.metadados?.nfeio_empresa_id);
  if (config?.provedor !== 'nfeio' || config?.ambiente !== 'producao' ||
      config?.status !== 'configurada' || !empresaNfeioId) {
    await admin.from('notas_fiscais').update({
      status: nota.status === 'autorizada' ? 'autorizada' : 'rejeitada',
      ultimo_erro: 'Emitente NFE.io nao esta ativo em producao.', updated_at: new Date().toISOString()
    }).eq('id', nota.id).eq('empresa_id', nota.empresa_id);
    return 'configuracao';
  }

  let consulta = await consultarNfseNfeio(empresaNfeioId, nota.id, chave);
  if (!consulta.ok && consulta.codigo === 404 && nota.status !== 'autorizada') {
    const emissao = await emitirNfseNfeio(empresaNfeioId, nota, config.metadados || {}, chave);
    if (!emissao.ok) {
      if (['nota_incompleta', 'identificacao_invalida'].includes(texto(emissao.motivo))) {
        await admin.from('notas_fiscais').update({ status: 'rejeitada',
          ultimo_erro: 'Dados da NFS-e incompletos ou invalidos.', updated_at: new Date().toISOString() })
          .eq('id', nota.id).eq('empresa_id', nota.empresa_id);
        return 'rejeitada';
      }
      await registrarFalhaTemporaria(admin, nota, 'Resultado da emissao ainda nao confirmado; nova consulta sera automatica.');
      return 'pendente';
    }
    consulta = await consultarNfseNfeio(empresaNfeioId, nota.id, chave);
  }

  if (!consulta.ok) {
    await registrarFalhaTemporaria(admin, nota, 'Emissor fiscal temporariamente indisponivel; a fila tentara novamente.');
    return 'pendente';
  }

  const estado = estadoNfeio(consulta);
  const emissaoId = texto(consulta.id || nota.referencia_provedor);
  const ambienteRetornado = texto(consulta.ambiente).toLowerCase();
  const cancelamento = nota.payload?.cancelamento && typeof nota.payload.cancelamento === 'object'
    ? nota.payload.cancelamento : {};

  // Falha fechada: uma resposta autorizada do ambiente de testes nunca pode
  // consumir cota nem ser apresentada ao cliente como documento de producao.
  if (estado === 'autorizada' && ambienteRetornado !== 'production') {
    await admin.from('notas_fiscais').update({
      status: 'rejeitada', referencia_provedor: emissaoId || null,
      resposta_provedor: { status: texto(consulta.status), fluxo: texto(consulta.fluxo),
        ambiente: texto(consulta.ambiente) },
      ultimo_erro: 'O emissor respondeu fora do ambiente de producao.',
      updated_at: new Date().toISOString()
    }).eq('id', nota.id).eq('empresa_id', nota.empresa_id);
    return 'ambiente_invalido';
  }

  if (nota.status === 'autorizada' && cancelamento.solicitado_em && estado !== 'cancelada') {
    if (!cancelamento.enviado_em) {
      const retorno = await cancelarNfseNfeio(empresaNfeioId, emissaoId, chave);
      if (!retorno.ok) {
        await registrarFalhaTemporaria(admin, nota, 'Cancelamento ainda nao confirmado pelo emissor.');
        return 'pendente';
      }
      nota.payload = {
        ...(nota.payload || {}),
        cancelamento: { ...cancelamento, enviado_em: new Date().toISOString() }
      };
    }
    await registrarFalhaTemporaria(admin, nota, 'Cancelamento enviado; aguardando confirmacao da prefeitura.');
    return 'pendente';
  }

  if (estado === 'rejeitada') {
    const erroSeguro = texto(consulta.nota?.flowMessage ?? consulta.nota?.FlowMessage)
      .replace(/[\r\n\t]+/g, ' ').slice(0, 300) || 'Emissao rejeitada pelo provedor fiscal.';
    await admin.from('notas_fiscais').update({ status: 'rejeitada', referencia_provedor: emissaoId || null,
      resposta_provedor: { status: texto(consulta.status), fluxo: texto(consulta.fluxo) },
      ultimo_erro: erroSeguro, updated_at: new Date().toISOString() })
      .eq('id', nota.id).eq('empresa_id', nota.empresa_id);
    return 'rejeitada';
  }

  if (estado === 'cancelada') {
    await admin.from('notas_fiscais').update({ status: 'cancelada', referencia_provedor: emissaoId || null,
      resposta_provedor: { status: texto(consulta.status), fluxo: texto(consulta.fluxo) },
      ultimo_erro: null, updated_at: new Date().toISOString() })
      .eq('id', nota.id).eq('empresa_id', nota.empresa_id);
    return 'cancelada';
  }

  if (estado !== 'autorizada') {
    await registrarFalhaTemporaria(admin, nota, 'NFS-e em processamento no emissor.');
    return 'processando';
  }

  const documentos = await guardarDocumentos(admin, nota, empresaNfeioId, emissaoId, chave);
  await admin.from('notas_fiscais').update({
    status: 'autorizada', referencia_provedor: emissaoId,
    numero: texto(consulta.numero) || null,
    codigo_verificacao: texto(consulta.codigoVerificacao) || null,
    danfse_storage_path: documentos.pdfPath || nota.danfse_storage_path || null,
    danfse_gerado_em: documentos.pdfPath ? new Date().toISOString() : nota.danfse_gerado_em,
    payload: documentos.payload,
    resposta_provedor: { status: texto(consulta.status), fluxo: texto(consulta.fluxo), ambiente: texto(consulta.ambiente) },
    emitida_em: nota.emitida_em || new Date().toISOString(),
    ultimo_erro: documentos.erro || null,
    updated_at: new Date().toISOString()
  }).eq('id', nota.id).eq('empresa_id', nota.empresa_id);
  return documentos.erro ? 'autorizada_sem_documentos' : 'autorizada';
}

async function guardarDocumentosProduto(admin: any, nota: Registro, empresaId: string,
  emissaoId: string, tipo: TipoDocumentoProduto, chave: string) {
  const documentos = nota.payload?.documentos && typeof nota.payload.documentos === 'object'
    ? nota.payload.documentos : {};
  let pdfPath = texto(nota.danfse_storage_path || documentos.pdf_storage_path);
  let xmlPath = texto(documentos.xml_storage_path);
  let erro = '';
  if (!pdfPath) {
    const pdf = await baixarDanfeProdutoNfeio(empresaId, emissaoId, tipo, chave);
    if (pdf.ok) {
      pdfPath = `${nota.empresa_id}/${nota.id}/${tipo === 'nfe' ? 'DANFE-NFe' : 'DANFE-NFCe'}.pdf`;
      const envio = await admin.storage.from('documentos-fiscais').upload(pdfPath, pdf.bytes, {
        contentType: 'application/pdf', cacheControl: '3600', upsert: true
      });
      if (envio.error) { pdfPath = ''; erro = 'DANFE temporariamente indisponivel.'; }
    } else erro = 'DANFE temporariamente indisponivel.';
  }
  if (!xmlPath) {
    const xml = await baixarXmlProdutoNfeio(empresaId, emissaoId, tipo, chave);
    if (xml.ok) {
      xmlPath = `${nota.empresa_id}/${nota.id}/${tipo === 'nfe' ? 'NFe' : 'NFCe'}.xml`;
      const envio = await admin.storage.from('documentos-fiscais').upload(xmlPath, xml.bytes, {
        contentType: 'application/xml', cacheControl: '3600', upsert: true
      });
      if (envio.error) { xmlPath = ''; erro ||= 'XML temporariamente indisponivel.'; }
    } else erro ||= 'XML temporariamente indisponivel.';
  }
  return { pdfPath, xmlPath, erro, payload: {
    ...(nota.payload || {}), documentos: { ...documentos, pdf_storage_path: pdfPath || null,
      xml_storage_path: xmlPath || null, atualizado_em: new Date().toISOString() },
    processamento: { ...(nota.payload?.processamento || {}),
      proxima_tentativa_em: erro ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null }
  } };
}

async function processarNotaProduto(admin: any, nota: Registro, chave: string) {
  const tipo = nota.tipo_documento as TipoDocumentoProduto;
  const { data: config, error: configErro } = await admin.from('configuracoes_fiscais')
    .select('provedor,ambiente,status,metadados').eq('empresa_id', nota.empresa_id).maybeSingle();
  if (configErro) throw configErro;
  const empresaNfeioId = texto(config?.metadados?.nfeio_empresa_id);
  const inscricaoId = tipo === 'nfe' ? texto(config?.metadados?.nfeio_ie_nfe_id)
    : texto(config?.metadados?.nfeio_ie_nfce_id);
  const { data: homologacao } = await admin.from('homologacoes_fiscais').select('status')
    .eq('empresa_id', nota.empresa_id).eq('tipo_documento', tipo).maybeSingle();
  if (config?.provedor !== 'nfeio' || config?.ambiente !== 'producao' ||
      config?.status !== 'configurada' || !empresaNfeioId || !inscricaoId || homologacao?.status !== 'aprovada') {
    await admin.from('notas_fiscais').update({ status: 'rejeitada',
      ultimo_erro: `${tipo.toUpperCase()} ainda nao foi homologada para esta empresa.`, updated_at: new Date().toISOString() })
      .eq('id', nota.id).eq('empresa_id', nota.empresa_id);
    return 'configuracao';
  }
  let emissaoId = texto(nota.referencia_provedor) || nota.id;
  let consulta = await consultarDocumentoProdutoNfeio(empresaNfeioId, emissaoId, tipo, chave);
  if (!consulta.ok && consulta.codigo === 404 && nota.status !== 'autorizada') {
    const emissao = await emitirDocumentoProdutoNfeio(empresaNfeioId, inscricaoId, nota, tipo, chave);
    if (!emissao.ok) {
      if (['itens_fiscais_incompletos', 'destinatario_incompleto', 'identificacao_invalida'].includes(texto(emissao.motivo))) {
        await admin.from('notas_fiscais').update({ status: 'rejeitada',
          ultimo_erro: 'Dados fiscais dos itens ou destinatario incompletos.', updated_at: new Date().toISOString() })
          .eq('id', nota.id).eq('empresa_id', nota.empresa_id);
        return 'rejeitada';
      }
      await registrarFalhaTemporaria(admin, nota, 'Resultado da emissao ainda nao confirmado; nova consulta sera automatica.');
      return 'pendente';
    }
    emissaoId = emissao.id;
    await admin.from('notas_fiscais').update({ referencia_provedor: emissaoId }).eq('id', nota.id)
      .eq('empresa_id', nota.empresa_id);
    consulta = await consultarDocumentoProdutoNfeio(empresaNfeioId, emissaoId, tipo, chave);
  }
  if (!consulta.ok) {
    await registrarFalhaTemporaria(admin, nota, 'Emissor fiscal temporariamente indisponivel; a fila tentara novamente.');
    return 'pendente';
  }
  const estado = estadoDocumentoProdutoNfeio(consulta);
  const ambiente = texto(consulta.environmentType ?? consulta.environment ?? consulta.protocol?.environmentType).toLowerCase();
  const cancelamento = nota.payload?.cancelamento || {};
  if (estado === 'autorizada' && ambiente !== 'production') {
    await admin.from('notas_fiscais').update({ status: 'rejeitada', referencia_provedor: emissaoId,
      ultimo_erro: 'O emissor respondeu fora do ambiente de producao.', updated_at: new Date().toISOString() })
      .eq('id', nota.id).eq('empresa_id', nota.empresa_id);
    return 'ambiente_invalido';
  }
  if (nota.status === 'autorizada' && cancelamento.solicitado_em && estado !== 'cancelada') {
    if (!cancelamento.enviado_em) {
      const retorno = await cancelarDocumentoProdutoNfeio(empresaNfeioId, emissaoId, tipo, chave);
      if (!retorno.ok) {
        await registrarFalhaTemporaria(admin, nota, 'Cancelamento ainda nao confirmado pelo emissor.');
        return 'pendente';
      }
      nota.payload = { ...(nota.payload || {}), cancelamento: { ...cancelamento,
        enviado_em: new Date().toISOString() } };
    }
    await registrarFalhaTemporaria(admin, nota, 'Cancelamento enviado; aguardando confirmacao da SEFAZ.');
    return 'pendente';
  }
  if (estado === 'rejeitada' || estado === 'cancelada') {
    await admin.from('notas_fiscais').update({ status: estado, referencia_provedor: emissaoId,
      resposta_provedor: { status: texto(consulta.currentStatus ?? consulta.status) },
      ultimo_erro: estado === 'rejeitada' ? 'Documento rejeitado pela SEFAZ ou pelo emissor.' : null,
      updated_at: new Date().toISOString() }).eq('id', nota.id).eq('empresa_id', nota.empresa_id);
    return estado;
  }
  if (estado !== 'autorizada') {
    await registrarFalhaTemporaria(admin, nota, `${tipo.toUpperCase()} em processamento no emissor.`);
    return 'processando';
  }
  const documentos = await guardarDocumentosProduto(admin, nota, empresaNfeioId, emissaoId, tipo, chave);
  const chaveAcesso = texto(consulta.protocol?.accessKey ?? consulta.accessKey);
  await admin.from('notas_fiscais').update({ status: 'autorizada', referencia_provedor: emissaoId,
    numero: texto(consulta.number ?? consulta.numero) || null, chave_acesso: chaveAcesso || null,
    codigo_verificacao: chaveAcesso || null,
    danfse_storage_path: documentos.pdfPath || nota.danfse_storage_path || null,
    danfse_gerado_em: documentos.pdfPath ? new Date().toISOString() : nota.danfse_gerado_em,
    payload: documentos.payload, resposta_provedor: { status: texto(consulta.currentStatus ?? consulta.status), ambiente },
    emitida_em: nota.emitida_em || new Date().toISOString(), ultimo_erro: documentos.erro || null,
    updated_at: new Date().toISOString() }).eq('id', nota.id).eq('empresa_id', nota.empresa_id);
  return documentos.erro ? 'autorizada_sem_documentos' : 'autorizada';
}

async function processarHomologacoes(admin: any, chave: string, limite: number) {
  const { data, error } = await admin.from('homologacoes_fiscais')
    .select('id,empresa_id,tipo_documento,status,referencia_provedor,requisitos,tentativas,proxima_tentativa_em')
    .in('status', ['na_fila', 'processando']).order('updated_at').limit(limite);
  if (error) throw error;
  const resultado: Registro = { aprovadas: 0, processando: 0, rejeitadas: 0 };
  for (const original of data || []) {
    if (Date.parse(texto(original.proxima_tentativa_em)) > Date.now()) continue;
    const claim = original.status === 'na_fila' ? await admin.from('homologacoes_fiscais')
      .update({ status: 'processando', tentativas: Number(original.tentativas || 0) + 1 })
      .eq('id', original.id).eq('status', 'na_fila').select('*').maybeSingle() : { data: original, error: null };
    if (claim.error || !claim.data) continue;
    const item = claim.data;
    const tipo = item.tipo_documento as TipoDocumentoProduto;
    try {
      const { data: config } = await admin.from('configuracoes_fiscais').select('metadados')
        .eq('empresa_id', item.empresa_id).maybeSingle();
      const empresaId = texto(config?.metadados?.nfeio_empresa_id);
      const inscricaoId = texto(item.requisitos?.inscricao_id);
      let emissaoId = texto(item.referencia_provedor) || item.id;
      let consulta = await consultarDocumentoProdutoNfeio(empresaId, emissaoId, tipo, chave);
      if (!consulta.ok && consulta.codigo === 404) {
        const emissao = await emitirDocumentoProdutoNfeio(empresaId, inscricaoId,
          { id: item.id, payload: { itens: item.requisitos?.itens,
            tomador: item.requisitos?.tomador, natureza_operacao: 'EMISSAO EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' } },
          tipo, chave, true);
        if (!emissao.ok) {
          await admin.from('homologacoes_fiscais').update({ status: 'rejeitada',
            ultimo_erro: 'Dados de homologacao rejeitados. Revise os codigos com o contador.' }).eq('id', item.id);
          resultado.rejeitadas += 1; continue;
        }
        emissaoId = emissao.id;
        await admin.from('homologacoes_fiscais').update({ referencia_provedor: emissaoId }).eq('id', item.id);
        consulta = await consultarDocumentoProdutoNfeio(empresaId, emissaoId, tipo, chave);
      }
      if (!consulta.ok || estadoDocumentoProdutoNfeio(consulta) === 'processando') {
        await admin.from('homologacoes_fiscais').update({ status: 'processando',
          proxima_tentativa_em: new Date(Date.now() + 60_000).toISOString(), ultimo_erro: null }).eq('id', item.id);
        resultado.processando += 1; continue;
      }
      if (estadoDocumentoProdutoNfeio(consulta) !== 'autorizada') {
        await admin.from('homologacoes_fiscais').update({ status: 'rejeitada',
          resposta_provedor: { status: texto(consulta.currentStatus ?? consulta.status) },
          ultimo_erro: 'Teste rejeitado pela SEFAZ. Revise IE, CSC e tributacao com o contador.' }).eq('id', item.id);
        resultado.rejeitadas += 1; continue;
      }
      const ambiente = texto(consulta.environmentType ?? consulta.environment ?? consulta.protocol?.environmentType).toLowerCase();
      if (!['test', 'development', 'homologation'].includes(ambiente)) {
        await admin.from('homologacoes_fiscais').update({ status: 'rejeitada',
          ultimo_erro: 'Resposta de homologacao veio de ambiente inesperado.' }).eq('id', item.id);
        resultado.rejeitadas += 1; continue;
      }
      const ativacao = await ativarInscricaoEstadualNfeio(empresaId, inscricaoId,
        tipo === 'nfe' ? 'NFe' : 'NFCe', chave);
      if (!ativacao.ok) {
        await admin.from('homologacoes_fiscais').update({ status: 'processando',
          proxima_tentativa_em: new Date(Date.now() + 5 * 60_000).toISOString(),
          ultimo_erro: 'Teste aprovado; aguardando ativacao da inscricao em producao.' }).eq('id', item.id);
        resultado.processando += 1; continue;
      }
      await admin.from('homologacoes_fiscais').update({ status: 'aprovada', concluida_em: new Date().toISOString(),
        proxima_tentativa_em: null, ultimo_erro: null,
        resposta_provedor: { status: texto(consulta.currentStatus ?? consulta.status), ambiente } }).eq('id', item.id);
      await admin.from('configuracoes_fiscais').update({ provedor: 'nfeio', ambiente: 'producao',
        status: 'configurada', ultimo_erro: null }).eq('empresa_id', item.empresa_id);
      resultado.aprovadas += 1;
    } catch (_) {
      await admin.from('homologacoes_fiscais').update({ status: 'processando',
        proxima_tentativa_em: new Date(Date.now() + 5 * 60_000).toISOString(),
        ultimo_erro: 'Falha temporaria no teste automatico.' }).eq('id', item.id);
      resultado.processando += 1;
    }
  }
  return resultado;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder(405, { erro: 'Metodo nao permitido.' });
  const segredo = texto(Deno.env.get('FISCAL_WORKER_CRON_SECRET'));
  if (!segredo || !segredoIgual(texto(req.headers.get('x-cron-secret')), segredo)) {
    return responder(401, { erro: 'Nao autorizado.' });
  }
  if (Deno.env.get('FISCAL_EMISSOR_ATIVO') !== 'true') {
    return responder(503, { erro: 'Emissor fiscal desativado.' });
  }
  const chave = texto(Deno.env.get('NFEIO_INVOICE_KEY'));
  if (!chave) return responder(503, { erro: 'Credencial fiscal indisponivel.' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } });
  const limite = Math.max(1, Math.min(50, Number(Deno.env.get('FISCAL_WORKER_BATCH')) || 10));
  const pedido = await req.json().catch(() => ({}));
  const assinatura = await processarNotasAssinaturas(admin, texto(pedido.cobrancaId));
  if (pedido.cobrancaId) return responder(200, { assinatura });
  const homologacoes = await processarHomologacoes(admin, chave, limite);
  const { data, error } = await admin.from('notas_fiscais')
    .select('id,empresa_id,tipo_documento,origem_tipo,origem_id,valor,descricao,status,provedor,referencia_provedor,numero,codigo_verificacao,danfse_storage_path,danfse_gerado_em,emitida_em,payload,updated_at')
    .in('status', ['na_fila', 'processando', 'autorizada'])
    .order('updated_at', { ascending: true }).limit(limite * 5);
  if (error) return responder(500, { erro: 'Fila fiscal indisponivel.' });

  const candidatos = (data || []).filter((nota: Registro) => {
    if (!podeTentar(nota.payload || {})) return false;
    if (nota.status !== 'autorizada') return true;
    return Boolean(nota.payload?.cancelamento?.solicitado_em) ||
      !texto(nota.danfse_storage_path) || !texto(nota.payload?.documentos?.xml_storage_path);
  }).slice(0, limite);

  const contagem: Registro = { autorizada: 0, autorizada_sem_documentos: 0, processando: 0,
    pendente: 0, rejeitada: 0, cancelada: 0, configuracao: 0, falhou: 0 };
  for (const original of candidatos) {
    let nota = original;
    if (original.status === 'na_fila') {
      const claim = await admin.from('notas_fiscais').update({ status: 'processando', updated_at: new Date().toISOString() })
        .eq('id', original.id).eq('empresa_id', original.empresa_id).eq('status', 'na_fila')
        .select('id,empresa_id,tipo_documento,origem_tipo,origem_id,valor,descricao,status,provedor,referencia_provedor,numero,codigo_verificacao,danfse_storage_path,danfse_gerado_em,emitida_em,payload,updated_at').maybeSingle();
      if (claim.error || !claim.data) continue;
      nota = claim.data;
    }
    try {
      const resultado = ['nfe', 'nfce'].includes(texto(nota.tipo_documento))
        ? await processarNotaProduto(admin, nota, chave)
        : await processarNota(admin, nota, chave);
      contagem[resultado] = Number(contagem[resultado] || 0) + 1;
    } catch (_) {
      contagem.falhou += 1;
      await registrarFalhaTemporaria(admin, nota, 'Falha temporaria no processamento fiscal.');
    }
  }
  return responder(200, { processadas: candidatos.length, resultados: contagem, homologacoes });
});
