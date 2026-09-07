export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-cron-secret, x-request-id, x-signature',
  'Content-Type': 'application/json; charset=utf-8'
};

export const resposta = (status: number, corpo: Record<string, unknown>) =>
  new Response(JSON.stringify(corpo), { status, headers: cors });

export const texto = (valor: unknown) => String(valor ?? '').trim();

const bytesBase64 = (valor: string) => {
  const bruto = atob(valor);
  return Uint8Array.from(bruto, (caractere) => caractere.charCodeAt(0));
};

const base64Bytes = (valor: ArrayBuffer) => {
  const bytes = new Uint8Array(valor);
  let bruto = '';
  bytes.forEach((byte) => { bruto += String.fromCharCode(byte); });
  return btoa(bruto);
};

async function chaveCifra() {
  const valor = Deno.env.get('INTEGRATION_ENCRYPTION_KEY') || '';
  let bytes: Uint8Array;
  try {
    bytes = bytesBase64(valor);
  } catch (_) {
    throw new Error('O cofre seguro da plataforma nao esta configurado.');
  }
  if (bytes.byteLength !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY invalida.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function cifrarJson(valor: Record<string, unknown>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chave = await chaveCifra();
  const aberto = new TextEncoder().encode(JSON.stringify(valor));
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, aberto);
  return { iv: base64Bytes(iv.buffer), cifra: base64Bytes(cifrado) };
}

export async function decifrarJson(ivBase64: string, cifraBase64: string) {
  const chave = await chaveCifra();
  const iv = bytesBase64(ivBase64);
  const cifra = bytesBase64(cifraBase64);
  const aberto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, chave, cifra);
  const valor = JSON.parse(new TextDecoder().decode(aberto));
  if (!valor || typeof valor !== 'object') throw new Error('Segredo da integracao invalido.');
  return valor as Record<string, unknown>;
}

export async function carregarIntegracaoPlataforma(admin: any, tipo: string) {
  const { data: integracao, error } = await admin.from('integracoes_plataforma')
    .select('id,tipo,status,provedor,conta_mascarada,metadados,ultimo_erro')
    .eq('tipo', tipo).maybeSingle();
  if (error) throw error;
  if (!integracao || integracao.status !== 'conectada') return { integracao, segredo: null };
  const { data: cofre, error: cofreErro } = await admin.from('integracoes_plataforma_segredos')
    .select('iv_base64,segredo_cifrado_base64').eq('integracao_id', integracao.id).maybeSingle();
  if (cofreErro) throw cofreErro;
  if (!cofre) return { integracao, segredo: null };
  return {
    integracao,
    segredo: await decifrarJson(cofre.iv_base64, cofre.segredo_cifrado_base64)
  };
}

export const mapearStatusMercadoPago = (status: unknown) => {
  switch (texto(status).toLowerCase()) {
    case 'approved': return 'aprovada';
    case 'in_process':
    case 'in_mediation':
    case 'authorized': return 'em_processamento';
    case 'rejected': return 'rejeitada';
    case 'cancelled': return 'cancelada';
    case 'refunded':
    case 'charged_back': return 'estornada';
    default: return 'pendente';
  }
};

export const mensagemErro = (erro: unknown) => {
  const mensagem = erro instanceof Error ? erro.message : texto(erro);
  if (/token|secret|authorization|apikey|service.role/i.test(mensagem)) {
    return 'O servidor recusou a operacao por seguranca.';
  }
  return mensagem || 'Nao foi possivel concluir a operacao.';
};
