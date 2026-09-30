import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  baixarPdfNfseNfeio,
  baixarXmlNfseNfeio,
  cancelarNfseNfeio,
  consultarNfseNfeio,
  emitirNfseNfeio
} from '../_shared/nfeio-nfse.ts';

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
  const estado = `${texto(retorno.status)} ${texto(retorno.fluxo)}`.toLowerCase();
  if (/cancel/.test(estado)) return 'cancelada';
  if (/issued|authorized|autoriz/.test(estado)) return 'autorizada';
  if (/issuefailed|error|reject|denied|falh|rejeit/.test(estado)) return 'rejeitada';
  return 'processando';
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
  const { data, error } = await admin.from('notas_fiscais')
    .select('id,empresa_id,origem_tipo,origem_id,valor,descricao,status,provedor,referencia_provedor,numero,codigo_verificacao,danfse_storage_path,danfse_gerado_em,emitida_em,payload,updated_at')
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
        .select('id,empresa_id,origem_tipo,origem_id,valor,descricao,status,provedor,referencia_provedor,numero,codigo_verificacao,danfse_storage_path,danfse_gerado_em,emitida_em,payload,updated_at').maybeSingle();
      if (claim.error || !claim.data) continue;
      nota = claim.data;
    }
    try {
      const resultado = await processarNota(admin, nota, chave);
      contagem[resultado] = Number(contagem[resultado] || 0) + 1;
    } catch (_) {
      contagem.falhou += 1;
      await registrarFalhaTemporaria(admin, nota, 'Falha temporaria no processamento fiscal.');
    }
  }
  return responder(200, { processadas: candidatos.length, resultados: contagem });
});
