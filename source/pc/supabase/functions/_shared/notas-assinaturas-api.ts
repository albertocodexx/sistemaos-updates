import { ehAdministradorEmpresa, temPermissao } from './access.ts';
import { iniciarNotasAssinaturas } from './notas-assinaturas.ts';
const texto = (v: unknown) => String(v ?? '').trim();
const uuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(texto(v));

export async function atenderNotasAssinatura(admin: any, contexto: any, userId: string,
  acao: string, dados: any, resposta: (status: number, corpo: any) => Response) {
  if (!['listar_notas_assinatura','obter_nota_assinatura','emitir_nota_assinatura'].includes(acao)) return null;
  const suporte = contexto.administrador_global === true;
  if (suporte) {
    const papel = await admin.from('administradores_globais').select('papel,ativo').eq('usuario_id', userId).maybeSingle();
    if (papel.error) throw papel.error;
    if (papel.data?.ativo !== true || papel.data?.papel !== 'administrador_geral')
      return resposta(403, { erro: 'Somente o Administrador Geral pode gerenciar as notas de assinaturas.' });
  } else if (!contexto.empresa_id || (!ehAdministradorEmpresa(contexto) && !temPermissao(contexto,'financeiro','ler'))) {
    return resposta(403, { erro: 'Seu usuário não tem acesso às notas da assinatura.' });
  }
  const empresaId = suporte ? texto(dados.empresaId) : contexto.empresa_id;
  if (empresaId && !uuid(empresaId)) return resposta(400, { erro: 'Empresa inválida.' });
  if (acao === 'emitir_nota_assinatura') {
    if (!suporte) return resposta(403, { erro: 'A emissão da assinatura é gerenciada pelo suporte.' });
    if (!uuid(dados.cobrancaId)) return resposta(400, { erro: 'Pagamento inválido.' });
    const criada = await admin.rpc('enfileirar_nota_assinatura', { p_cobranca_id: dados.cobrancaId });
    if (criada.error) throw criada.error;
    if (!criada.data) return resposta(409, { erro: 'A assinatura precisa ter pagamento confirmado e aplicado.' });
    iniciarNotasAssinaturas(admin, dados.cobrancaId);
    return resposta(200, { id: criada.data, mensagem: 'Nota encaminhada para conferência. O status será atualizado após o retorno do emissor.' });
  }
  if (acao === 'listar_notas_assinatura') {
    const pagina = Number(dados.pagina || 0);
    if (!Number.isInteger(pagina) || pagina < 0 || pagina > 10000) return resposta(400, { erro: 'Página inválida.' });
    let q = admin.from('notas_fiscais_assinatura')
      .select('id,cobranca_id,empresa_id,valor,descricao,status,numero,codigo_verificacao,danfse_storage_path,emitida_em,ultimo_erro,created_at,cliente:empresas(nome_fantasia)')
      .order('created_at', { ascending: false }).order('id').range(pagina*30, pagina*30+30);
    if (empresaId) q = q.eq('empresa_id', empresaId);
    const consulta = await q;
    if (consulta.error) throw consulta.error;
    const notas = (consulta.data || []).slice(0,30).map((n: any) => {
      const { danfse_storage_path: caminho, cliente, ...dadosNota } = n;
      return { ...dadosNota, cliente_nome: suporte ? (cliente?.nome_fantasia || '') : undefined,
        pdf_disponivel: n.status === 'autorizada' && Boolean(caminho && n.codigo_verificacao) };
    });
    return resposta(200, { notas, mais: (consulta.data || []).length > 30 });
  }
  if (!uuid(dados.id)) return resposta(400, { erro: 'Nota inválida.' });
  let q = admin.from('notas_fiscais_assinatura')
    .select('id,empresa_id,status,numero,codigo_verificacao,danfse_storage_path').eq('id', dados.id);
  if (!suporte) q = q.eq('empresa_id', empresaId);
  const consulta = await q.maybeSingle();
  if (consulta.error) throw consulta.error;
  const n = consulta.data;
  if (!n) return resposta(404, { erro: 'Nota não encontrada.' });
  const caminho = `${n.empresa_id}/assinaturas/${n.id}/DANFSe.pdf`;
  if (n.status !== 'autorizada' || !n.codigo_verificacao || n.danfse_storage_path !== caminho)
    return resposta(409, { erro: 'A nota ainda não está disponível para download.' });
  const nome = `NFS-e-assinatura-${String(n.numero || n.id).replace(/[^a-z0-9-]/gi,'')}.pdf`;
  const link = await admin.storage.from('documentos-fiscais').createSignedUrl(caminho, 300,
    dados.baixar === true ? { download: nome } : undefined);
  if (link.error) throw link.error;
  return resposta(200, { nota: { id:n.id, numero:n.numero, codigoVerificacao:n.codigo_verificacao,
    url:link.data.signedUrl, nomeArquivo:nome, expiraEmSegundos:300 } });
}
