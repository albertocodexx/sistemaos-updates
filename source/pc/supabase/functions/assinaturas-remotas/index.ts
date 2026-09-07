import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  return pacote && typeof pacote === 'object' &&
    ['os', 'compra', 'venda', 'entrega', 'desbloqueio'].includes(tipo) &&
    String(pacote.idEnvioAssinatura || '').trim() &&
    pacote.dados && typeof pacote.dados === 'object';
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
    if (contextoErro || !atual?.empresa_id || atual?.administrador_global === true) {
      return resposta(403, { erro: 'Entre em uma empresa para usar assinatura remota.' });
    }
    const corpo = await req.json();
    const acao = String(corpo?.acao || '');
    const dados = corpo?.dados || {};
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

    if (acao === 'enviar') {
      const pacote = dados.pacote;
      if (!pacoteValido(pacote)) return resposta(400, { erro: 'Documento de assinatura inválido.' });
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
      const { data, error } = await admin.from('solicitacoes_assinatura_remota')
        .select('id,id_envio_assinatura,tipo_documento,pacote,created_at,updated_at')
        .eq('empresa_id', atual.empresa_id).eq('status', 'pendente')
        .order('updated_at', { ascending: true }).limit(50);
      if (error) throw error;
      return resposta(200, { solicitacoes: data || [] });
    }

    if (acao === 'responder') {
      const idEnvio = String(dados.idEnvioAssinatura || '').trim();
      const respostaAssinada = dados.resposta;
      if (!idEnvio || !respostaAssinada || typeof respostaAssinada !== 'object') {
        return resposta(400, { erro: 'Resposta de assinatura inválida.' });
      }
      const { data, error } = await admin.from('solicitacoes_assinatura_remota')
        .update({ resposta: respostaAssinada, status: 'respondida', respondido_por: usuario.user.id, respondido_em: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('empresa_id', atual.empresa_id).eq('id_envio_assinatura', idEnvio).eq('status', 'pendente')
        .select('id,status').maybeSingle();
      if (error) throw error;
      if (!data) return resposta(409, { erro: 'Esta solicitação já foi respondida ou expirou.' });
      return resposta(200, { solicitacao: data, mensagem: 'Assinatura enviada automaticamente ao PC.' });
    }

    if (acao === 'buscar_respostas') {
      const { data, error } = await admin.from('solicitacoes_assinatura_remota')
        .select('id,resposta,id_envio_assinatura,tipo_documento,respondido_em')
        .eq('empresa_id', atual.empresa_id).eq('status', 'respondida')
        .order('respondido_em', { ascending: true }).limit(50);
      if (error) throw error;
      return resposta(200, { solicitacoes: data || [] });
    }

    if (acao === 'confirmar_resposta') {
      const id = String(dados.solicitacaoId || '').trim();
      if (!id) return resposta(400, { erro: 'Solicitação não informada.' });
      const { error } = await admin.from('solicitacoes_assinatura_remota')
        .update({ status: 'concluida', concluido_em: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('empresa_id', atual.empresa_id).eq('id', id).eq('status', 'respondida');
      if (error) throw error;
      return resposta(200, { sucesso: true });
    }

    return resposta(400, { erro: 'Ação de assinatura não suportada.' });
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error('[assinaturas-remotas]', mensagem);
    return resposta(500, { erro: 'Não foi possível concluir a assinatura remota: ' + mensagem.slice(0, 180) });
  }
});
