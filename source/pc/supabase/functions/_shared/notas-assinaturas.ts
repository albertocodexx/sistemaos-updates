import { montarNfseNfeio, emitirNfseNfeio, consultarNfseNfeio, baixarPdfNfseNfeio,
  estadoNfseNfeio } from './nfeio-nfse.ts';

type Registro = Record<string, any>;
const texto = (v: unknown) => String(v ?? '').trim();
const TABELA = 'notas_fiscais_assinatura';

// A fila pertence ao pagamento, não à carteira de notas do cliente.
export async function processarNotasAssinaturas(admin: any, cobrancaId = '', consultar: typeof fetch = fetch) {
  const chave = texto(Deno.env.get('NFEIO_INVOICE_KEY'));
  if (Deno.env.get('FISCAL_EMISSOR_ATIVO') !== 'true' || !chave) return { processadas: 0, configurada: false };
  const config = await admin.from('configuracoes_fiscais_plataforma')
    .select('provedor,ambiente,status,metadados').eq('empresa_id', '00000000-0000-4000-8000-000000000001').maybeSingle();
  if (config.error) throw config.error;
  const fiscal = config.data?.metadados || {};
  if (config.data?.status !== 'configurada' || config.data?.ambiente !== 'producao' ||
      config.data?.provedor !== 'nfeio' || !texto(fiscal.nfeio_empresa_id)) return { processadas: 0, configurada: false };
  let busca = admin.from(TABELA).select('*').is('danfse_storage_path', null).in('status', ['aguardando_configuracao','na_fila','processando','autorizada'])
    .order('updated_at', { ascending: true }).limit(30);
  if (cobrancaId) busca = busca.eq('cobranca_id', cobrancaId);
  const fila = await busca;
  if (fila.error) throw fila.error;
  let processadas = 0;
  for (const original of (fila.data || []).filter((n: Registro) => !n.danfse_storage_path &&
    !(Date.parse(n.payload?.processamento?.proxima_tentativa_em) > Date.now())).slice(0, 5)) {
    const lease = crypto.randomUUID();
    const claim = await admin.rpc('reservar_nota_assinatura', { p_id: original.id, p_bloqueio: lease });
    if (claim.error) throw claim.error;
    const nota = Array.isArray(claim.data) ? claim.data[0] : claim.data;
    if (!nota) continue;
    const atualizar = async (dados: Registro) => {
      const r = await admin.from(TABELA).update({ ...dados, updated_at: new Date().toISOString() })
        .eq('id', nota.id).eq('empresa_id', nota.empresa_id).eq('bloqueio_id', lease).select('id').maybeSingle();
      if (r.error || !r.data) throw new Error('Não foi possível atualizar a fila fiscal.');
    };
    try {
      const c = await admin.from('cobrancas_assinatura').select('id,empresa_id,status,aplicado_em,valor,moeda,pagamento_provedor_id')
        .eq('id', nota.cobranca_id).eq('empresa_id', nota.empresa_id).single();
      if (c.error) throw c.error;
      if (c.data.status !== 'aprovada' || !c.data.aplicado_em || !c.data.pagamento_provedor_id ||
        c.data.moeda !== 'BRL' || Math.round(Number(c.data.valor)*100) !== Math.round(Number(nota.valor)*100)) {
        // Uma nota já enviada exige conciliação, nunca cancelamento fiscal fictício.
        await atualizar({ ultimo_erro: 'Pagamento alterado. O suporte deve conferir a situação fiscal.',
          status: nota.payload?.envio_iniciado_em ? nota.status : 'cancelada' });
        continue;
      }
      const payload = { ...(nota.payload || {}) };
      // O tomador pode completar seu cadastro antes do primeiro envio; depois fica congelado.
      if (!payload.envio_iniciado_em) {
        const e = await admin.from('empresas').select('razao_social,nome_fantasia,cnpj,contato_cobranca_email')
          .eq('id', nota.empresa_id).single();
        const f = await admin.from('configuracoes_fiscais').select('metadados').eq('empresa_id', nota.empresa_id).maybeSingle();
        if (e.error || f.error) throw e.error || f.error;
        const m = f.data?.metadados || {};
        payload.tomador = { cpfCnpj: e.data.cnpj || m.documento_prestador,
          nome: e.data.razao_social || m.nome_prestador || e.data.nome_fantasia,
          email: e.data.contato_cobranca_email || m.email_prestador || '' };
      }
      const emitente = texto(payload.emitente_nfeio_id || fiscal.nfeio_empresa_id);
      const dadosNota = { ...nota, payload };
      if (!montarNfseNfeio(dadosNota, fiscal)) {
        await atualizar({ status: 'aguardando_configuracao', payload,
          ultimo_erro: 'Complete nome, CPF/CNPJ e e-mail válido nos dados da empresa para receber a nota.' });
        continue;
      }
      let retorno: any = await consultarNfseNfeio(emitente, nota.id, chave, consultar);
      if (!retorno.ok && retorno.codigo === 404 && !payload.envio_iniciado_em) {
        // Grave antes do POST. Em resultado ambíguo, só consultar; não repetir emissão.
        payload.envio_iniciado_em = new Date().toISOString();
        payload.emitente_nfeio_id = emitente;
        await atualizar({ status: 'processando', payload, ultimo_erro: null });
        await emitirNfseNfeio(emitente, { ...nota, payload }, fiscal, chave, consultar);
        retorno = await consultarNfseNfeio(emitente, nota.id, chave, consultar);
      }
      const estado = retorno.ok ? estadoNfseNfeio(retorno) : 'processando';
      if (estado === 'autorizada' && texto(retorno.ambiente).toLowerCase() !== 'production') {
        await atualizar({ status: 'rejeitada', payload, ultimo_erro: 'O emissor retornou uma nota de testes. Conferência necessária.' });
        continue;
      }
      const campos: Registro = { payload, status: estado, referencia_provedor: retorno.id || null,
        numero: retorno.numero || null, codigo_verificacao: retorno.codigoVerificacao || null,
        ultimo_erro: estado === 'rejeitada' ? 'A prefeitura recusou a emissão. Solicite a revisão pelo suporte.' : null };
      if (estado === 'autorizada') {
        campos.emitida_em = nota.emitida_em || new Date().toISOString();
        const pdf = await baixarPdfNfseNfeio(emitente, retorno.id, chave, consultar);
        if (pdf.ok) {
          const caminho = `${nota.empresa_id}/assinaturas/${nota.id}/DANFSe.pdf`;
          const upload = await admin.storage.from('documentos-fiscais').upload(caminho, pdf.bytes,
            { contentType: 'application/pdf', upsert: true });
          if (upload.error) throw upload.error;
          campos.danfse_storage_path = caminho;
          campos.danfse_gerado_em = new Date().toISOString();
        } else campos.ultimo_erro = 'Nota autorizada. Aguardando o PDF do emissor.';
      } else if (estado === 'processando') campos.ultimo_erro = 'Aguardando autorização da prefeitura.';
      payload.processamento = { proxima_tentativa_em: new Date(Date.now()+60000).toISOString() };
      await atualizar(campos);
      processadas++;
    } catch (_) {
      await atualizar({ ultimo_erro: 'Consulta fiscal temporariamente indisponível. Nova tentativa automática.' }).catch(() => {});
    } finally {
      await admin.from(TABELA).update({ bloqueada_ate: null, bloqueio_id: null })
        .eq('id', nota.id).eq('bloqueio_id', lease);
    }
  }
  return { processadas, configurada: true };
}

// Inicia em segundo plano após confirmar o pagamento. O cron recupera interrupções.
export function iniciarNotasAssinaturas(admin: any, cobrancaId = '') {
  const tarefa = processarNotasAssinaturas(admin, cobrancaId).catch(() => ({ processadas: 0 }));
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(tarefa);
  return tarefa;
}
