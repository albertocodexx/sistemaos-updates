import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-cron-secret, x-request-id, x-signature',
  'Content-Type': 'application/json; charset=utf-8'
};
const resposta = (status: number, corpo: Record<string, unknown>) =>
  new Response(JSON.stringify(corpo), { status, headers: cors });
const texto = (valor: unknown) => String(valor ?? '').trim();
const mensagemErro = (erro: unknown) => {
  const mensagem = erro instanceof Error ? erro.message : texto(erro);
  if (/token|secret|authorization|apikey|service.role/i.test(mensagem)) return 'O servidor recusou a operacao por seguranca.';
  return mensagem || 'Nao foi possivel concluir a operacao.';
};

const compararSeguro = (a: string, b: string) => {
  const esquerda = new TextEncoder().encode(a);
  const direita = new TextEncoder().encode(b);
  if (!esquerda.length || esquerda.length !== direita.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esquerda.length; i += 1) diferenca |= esquerda[i] ^ direita[i];
  return diferenca === 0;
};

const urlHttps = (valor: unknown) => {
  const bruto = texto(valor);
  if (!bruto) return '';
  try {
    const url = new URL(bruto);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch (_) {
    return '';
  }
};

const pdfBase64Bytes = (valor: unknown) => {
  const bruto = texto(valor).replace(/^data:application\/pdf;base64,/i, '').replace(/\s/g, '');
  if (!bruto) return null;
  if (bruto.length > 28_000_000) throw new Error('DANFSe maior que o limite de 20 MB.');
  let binario = '';
  try { binario = atob(bruto); } catch (_) { throw new Error('DANFSe em Base64 invalido.'); }
  const bytes = Uint8Array.from(binario, (caractere) => caractere.charCodeAt(0));
  if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    throw new Error('O arquivo recebido nao e um PDF valido.');
  }
  return bytes;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return resposta(405, { erro: 'Metodo nao permitido.' });

  try {
    const segredoRecebido = req.headers.get('x-cron-secret') || '';
    const segredoEsperado = Deno.env.get('CRON_SECRET') || '';
    if (!compararSeguro(segredoRecebido, segredoEsperado)) {
      return resposta(401, { erro: 'Origem do resultado fiscal nao autorizada.' });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );
    const corpo = await req.json().catch(() => ({}));
    if (texto(corpo.acao) !== 'registrar_resultado') return resposta(400, { erro: 'Acao nao reconhecida.' });
    const dados = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
    const empresaId = texto(dados.empresaId);
    const notaId = texto(dados.notaId);
    if (!empresaId || !notaId) return resposta(400, { erro: 'Informe empresa e nota fiscal.' });

    const { data: nota, error: notaErro } = await admin.from('notas_fiscais')
      .select('id,empresa_id,status,numero,danfse_storage_path')
      .eq('id', notaId).eq('empresa_id', empresaId).maybeSingle();
    if (notaErro) throw notaErro;
    if (!nota) return resposta(404, { erro: 'Nota fiscal nao encontrada.' });

    const statusInformado = texto(dados.status).toLowerCase();
    const status = ['autorizada', 'rejeitada', 'cancelada', 'processando'].includes(statusInformado)
      ? statusInformado : 'processando';
    const numero = texto(dados.numero).slice(0, 80) || nota.numero || null;
    const chaveAcesso = texto(dados.chaveAcesso).replace(/[^0-9A-Za-z]/g, '').slice(0, 100) || null;
    const codigoVerificacao = texto(dados.codigoVerificacao).slice(0, 120) || null;
    const urlConsulta = urlHttps(dados.urlConsulta) || null;
    const danfseUrl = urlHttps(dados.danfseUrl || dados.pdfUrl) || null;
    const xmlUrl = urlHttps(dados.xmlUrl) || null;
    const referenciaProvedor = texto(dados.referenciaProvedor).slice(0, 160) || null;
    const ultimoErro = texto(dados.erro).slice(0, 1000) || null;

    let caminhoPdf = nota.danfse_storage_path || null;
    const pdf = pdfBase64Bytes(dados.danfseBase64 || dados.pdfBase64);
    if (pdf) {
      caminhoPdf = `${empresaId}/${notaId}/danfse.pdf`;
      const { error: uploadErro } = await admin.storage.from('documentos-fiscais')
        .upload(caminhoPdf, pdf, { contentType: 'application/pdf', cacheControl: '3600', upsert: true });
      if (uploadErro) throw uploadErro;
    }

    const agora = new Date().toISOString();
    const alteracoes: Record<string, unknown> = {
      status,
      numero,
      chave_acesso: chaveAcesso,
      codigo_verificacao: codigoVerificacao,
      url_consulta: urlConsulta,
      xml_url: xmlUrl,
      referencia_provedor: referenciaProvedor,
      ultimo_erro: ultimoErro,
      resposta_provedor: {
        status: statusInformado || status,
        referencia: referenciaProvedor,
        recebido_em: agora,
        danfse_recebido: Boolean(pdf || danfseUrl)
      },
      updated_at: agora
    };
    if (status === 'autorizada') alteracoes.emitida_em = agora;
    if (pdf || danfseUrl) {
      alteracoes.danfse_storage_path = caminhoPdf;
      alteracoes.danfse_url = danfseUrl;
      alteracoes.pdf_url = danfseUrl;
      alteracoes.danfse_gerado_em = agora;
    }

    const { data: atualizada, error: atualizarErro } = await admin.from('notas_fiscais')
      .update(alteracoes).eq('id', notaId).eq('empresa_id', empresaId)
      .select('id,status,numero,chave_acesso,danfse_storage_path,danfse_url,danfse_gerado_em,emitida_em').single();
    if (atualizarErro) throw atualizarErro;
    return resposta(200, {
      sucesso: true,
      nota: atualizada,
      danfseDisponivel: Boolean(atualizada.danfse_storage_path || atualizada.danfse_url)
    });
  } catch (erro) {
    console.error('[fiscal-documentos-provedor]', erro);
    return resposta(500, { erro: mensagemErro(erro) });
  }
});
