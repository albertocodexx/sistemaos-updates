import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  contextoUsuarioAtivo, licencaPermiteOperacao, podeAcessarTipoDocumento,
  tiposDocumentoPermitidos
} from '../_shared/access.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json; charset=utf-8'
};

function resposta(status: number, corpo: Record<string, unknown>) {
  return new Response(JSON.stringify(corpo), { status, headers: cors });
}

function primeiro(valor: unknown): any {
  return Array.isArray(valor) ? valor[0] : valor;
}

function pacoteValido(pacote: any) {
  const tipo = String(pacote?.tipoDocumento || '');
  const idEnvio = String(pacote?.idEnvioAssinatura || '').trim();
  return pacote && typeof pacote === 'object' &&
    pacote.tipoArquivo === 'sistema-os-pc-para-assinar' &&
    ['os', 'compra', 'venda', 'entrega', 'desbloqueio'].includes(tipo) &&
    idEnvio.length > 0 && idEnvio.length <= 200 &&
    pacote.dados && typeof pacote.dados === 'object' &&
    tamanhoJson(pacote) <= 8_000_000;
}

function tamanhoJson(valor: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(valor)).byteLength;
  } catch (_) {
    return Number.POSITIVE_INFINITY;
  }
}

function respostaAssinaturaValida(respostaRecebida: any, tipo: string, idEnvio: string) {
  if (!respostaRecebida || typeof respostaRecebida !== 'object' ||
      respostaRecebida.tipoArquivo !== 'sistema-os-pc-para-assinar-resposta' ||
      String(respostaRecebida.tipoDocumento || '') !== tipo ||
      String(respostaRecebida.idEnvioAssinatura || '').trim() !== idEnvio ||
      respostaRecebida.assinaturaPendente === true || tamanhoJson(respostaRecebida) > 8_000_000) return false;
  const campo = tipo === 'compra' ? 'assinaturaVendedorBase64'
    : tipo === 'venda' ? 'assinaturaCompradorBase64'
    : tipo === 'entrega' ? 'assinaturaRetirouBase64'
    : 'assinaturaClienteBase64';
  const assinatura = String(respostaRecebida[campo] || '');
  if (respostaRecebida.naoAssinado === true) return assinatura.length === 0;
  return /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(assinatura) &&
    assinatura.length <= 6_000_000;
}

function jsonCanonico(valor: any): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  return `{${Object.keys(valor).sort().map((chave) => `${JSON.stringify(chave)}:${jsonCanonico(valor[chave])}`).join(',')}}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return resposta(401, { erro: 'Sessão inválida.' });

  try {
    const url = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const cliente = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: usuario, error: usuarioErro } = await cliente.auth.getUser();
    if (usuarioErro || !usuario.user) return resposta(401, { erro: 'Sessão inválida.' });
    const { data: contexto, error: contextoErro } = await cliente.rpc('obter_contexto_comercial');
    const atual = primeiro(contexto);
    if (contextoErro || !atual?.empresa_id || atual?.administrador_global === true ||
        !contextoUsuarioAtivo(atual) || !licencaPermiteOperacao(atual)) {
      return resposta(403, { erro: 'Entre em uma empresa para usar assinatura remota.' });
    }
    const corpo = await req.json();
    const acao = String(corpo?.acao || '');
    const dados = corpo?.dados || {};
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

    if (acao === 'enviar') {
      const pacote = dados.pacote;
      if (!pacoteValido(pacote)) return resposta(400, { erro: 'Documento de assinatura inválido.' });
      if (!podeAcessarTipoDocumento(atual, pacote.tipoDocumento, 'criar') &&
          !podeAcessarTipoDocumento(atual, pacote.tipoDocumento, 'editar')) {
        return resposta(403, { erro: 'Seu usuário não pode enviar este tipo de documento.' });
      }
      const { data, error } = await admin.from('solicitacoes_assinatura_remota')
        .upsert({
          empresa_id: atual.empresa_id,
          id_envio_assinatura: String(pacote.idEnvioAssinatura),
          tipo_documento: String(pacote.tipoDocumento),
          pacote,
          resposta: null,
          status: 'pendente',
          enviado_por: usuario.user.id,
          respondido_por: null,
          respondido_em: null,
          concluido_em: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'empresa_id,id_envio_assinatura' })
        .select('id,id_envio_assinatura,tipo_documento,status,created_at,updated_at').single();
      if (error) throw error;
      return resposta(200, { solicitacao: data, mensagem: 'Documento enviado ao celular da empresa.' });
    }

    if (acao === 'buscar_pendentes') {
      const tipos = tiposDocumentoPermitidos(atual, 'ler');
      if (!tipos.length) return resposta(200, { solicitacoes: [] });
      const { data, error } = await admin.from('solicitacoes_assinatura_remota')
        .select('id,id_envio_assinatura,tipo_documento,pacote,created_at,updated_at')
        .eq('empresa_id', atual.empresa_id).eq('status', 'pendente')
        .in('tipo_documento', tipos)
        .order('updated_at', { ascending: true }).limit(50);
      if (error) throw error;
      return resposta(200, { solicitacoes: data || [] });
    }

    if (acao === 'responder') {
      const idEnvio = String(dados.idEnvioAssinatura || '').trim();
      const respostaAssinada = dados.resposta;
      if (!idEnvio || idEnvio.length > 200 || !respostaAssinada || typeof respostaAssinada !== 'object') {
        return resposta(400, { erro: 'Resposta de assinatura inválida.' });
      }
      const tipos = tiposDocumentoPermitidos(atual, 'editar');
      if (!tipos.length) return resposta(403, { erro: 'Seu usuário não pode responder documentos.' });
      const { data: pendente, error: pendenteErro } = await admin.from('solicitacoes_assinatura_remota')
        .select('id,tipo_documento,status,resposta').eq('empresa_id', atual.empresa_id)
        .eq('id_envio_assinatura', idEnvio)
        .in('tipo_documento', tipos).maybeSingle();
      if (pendenteErro) throw pendenteErro;
      if (!pendente) return resposta(409, { erro: 'Esta solicitação expirou ou não está acessível.' });
      if (!respostaAssinaturaValida(respostaAssinada, pendente.tipo_documento, idEnvio)) {
        return resposta(400, { erro: 'A resposta não corresponde ao documento enviado.' });
      }
      // O Android pode perder a confirmacao HTTP depois que o PostgreSQL ja
      // gravou a assinatura. A repeticao do mesmo pacote precisa confirmar o
      // envio, sem duplicar nem deixar a fila offline presa para sempre.
      if (['respondida', 'concluida'].includes(String(pendente.status))) {
        if (jsonCanonico(pendente.resposta) === jsonCanonico(respostaAssinada)) {
          return resposta(200, {
            solicitacao: { id: pendente.id, status: pendente.status },
            repetida: true,
            mensagem: 'Assinatura já confirmada no PC.'
          });
        }
        return resposta(409, { erro: 'Esta solicitação já possui outra resposta confirmada.' });
      }
      if (pendente.status !== 'pendente') {
        return resposta(409, { erro: 'Esta solicitação foi cancelada ou expirou.' });
      }
      const { data, error } = await admin.from('solicitacoes_assinatura_remota')
        .update({ resposta: respostaAssinada, status: 'respondida', respondido_por: usuario.user.id, respondido_em: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('empresa_id', atual.empresa_id).eq('id', pendente.id).eq('status', 'pendente')
        .select('id,status').maybeSingle();
      if (error) throw error;
      if (!data) {
        const { data: confirmada } = await admin.from('solicitacoes_assinatura_remota')
          .select('id,status,resposta').eq('empresa_id', atual.empresa_id).eq('id', pendente.id).maybeSingle();
        if (confirmada && ['respondida', 'concluida'].includes(String(confirmada.status)) &&
            jsonCanonico(confirmada.resposta) === jsonCanonico(respostaAssinada)) {
          return resposta(200, { solicitacao: { id: confirmada.id, status: confirmada.status }, repetida: true });
        }
        return resposta(409, { erro: 'Esta solicitação já foi respondida ou expirou.' });
      }
      return resposta(200, { solicitacao: data, mensagem: 'Assinatura enviada automaticamente ao PC.' });
    }

    if (acao === 'buscar_respostas') {
      const tipos = tiposDocumentoPermitidos(atual, 'ler');
      if (!tipos.length) return resposta(200, { solicitacoes: [] });
      const { data, error } = await admin.from('solicitacoes_assinatura_remota')
        .select('id,resposta,id_envio_assinatura,tipo_documento,respondido_em')
        .eq('empresa_id', atual.empresa_id).eq('status', 'respondida')
        .in('tipo_documento', tipos)
        .order('respondido_em', { ascending: true }).limit(50);
      if (error) throw error;
      return resposta(200, { solicitacoes: data || [] });
    }

    if (acao === 'confirmar_resposta') {
      const id = String(dados.solicitacaoId || '').trim();
      if (!id) return resposta(400, { erro: 'Solicitação não informada.' });
      const tipos = tiposDocumentoPermitidos(atual, 'editar');
      if (!tipos.length) return resposta(403, { erro: 'Seu usuário não pode concluir documentos.' });
      const { error } = await admin.from('solicitacoes_assinatura_remota')
        .update({ status: 'concluida', concluido_em: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('empresa_id', atual.empresa_id).eq('id', id).eq('status', 'respondida')
        .in('tipo_documento', tipos);
      if (error) throw error;
      return resposta(200, { sucesso: true });
    }

    return resposta(400, { erro: 'Ação de assinatura não suportada.' });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error('[assinaturas-remotas]', mensagem);
    return resposta(500, { erro: 'Não foi possível concluir a assinatura remota agora.' });
  }
});
