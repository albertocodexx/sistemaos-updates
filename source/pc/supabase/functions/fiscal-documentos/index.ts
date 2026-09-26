import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { contextoUsuarioAtivo, ehAdministradorEmpresa, licencaPermiteOperacao, temPermissao } from '../_shared/access.ts';
import { carregarIntegracaoPlataforma } from '../assinaturas-saas/saas.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-cron-secret, x-request-id, x-signature',
  'Content-Type': 'application/json; charset=utf-8'
};
const resposta = (status: number, corpo: Record<string, unknown>) =>
  new Response(JSON.stringify(corpo), { status, headers: cors });
const texto = (valor: unknown) => String(valor ?? '').trim();

const digitos = (valor: unknown, limite = 20) => texto(valor).replace(/\D/g, '').slice(0, limite);
const cnpjNormalizado = (valor: unknown) => texto(valor).toUpperCase().replace(/[^0-9A-Z]/g, '');
const cnpjValido = (valor: string) => {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(valor) || /^(.)\1{13}$/.test(valor)) return false;
  const base = [...valor.slice(0, 12)].map((caractere) => caractere.charCodeAt(0) - 48);
  const digito = (sequencia: number[], pesos: number[]) => {
    const resto = sequencia.reduce((soma, numero, indice) => soma + numero * pesos[indice], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = digito([...base, primeiro], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return primeiro === Number(valor[12]) && segundo === Number(valor[13]);
};
const decimalOpcional = (valor: unknown) => {
  const bruto = texto(valor).replace(',', '.');
  if (!bruto) return null;
  const numero = Number(bruto);
  return Number.isFinite(numero) && numero >= 0 && numero <= 100 ? numero : null;
};
const competenciaAtual = () => {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  const ano = partes.find((parte) => parte.type === 'year')?.value;
  const mes = partes.find((parte) => parte.type === 'month')?.value;
  return `${ano}-${mes}-01`;
};

const cpfValido = (valor: string) => {
  if (!/^\d{11}$/.test(valor) || /^(\d)\1{10}$/.test(valor)) return false;
  const calcular = (tamanho: number) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) soma += Number(valor[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calcular(9) === Number(valor[9]) && calcular(10) === Number(valor[10]);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return resposta(401, { erro: 'Sessao invalida.' });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cliente = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const { data: autenticacao } = await cliente.auth.getUser();
    if (!autenticacao.user) return resposta(401, { erro: 'Sessao invalida.' });
    const corpo = await req.json().catch(() => ({}));
    const acao = texto(corpo.acao);
    const dados = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
    const { data: contextoConsulta, error: contextoErro } = await cliente.rpc('obter_contexto_comercial');
    const contexto = Array.isArray(contextoConsulta) ? contextoConsulta[0] : contextoConsulta;
    if (contextoErro || !contextoUsuarioAtivo(contexto)) {
      return resposta(403, { erro: 'Entre em uma empresa para usar a NFS-e.' });
    }
    const suporteCadastro = contexto.administrador_global === true;
    if (suporteCadastro) {
      if (!['resumo', 'listar', 'salvar_configuracao'].includes(acao)) {
        return resposta(403, { erro: 'O suporte so pode consultar ou atualizar o cadastro fiscal da empresa.' });
      }
      const { data: papel, error: papelErro } = await admin.from('administradores_globais')
        .select('papel,ativo').eq('usuario_id', autenticacao.user.id).maybeSingle();
      if (papelErro) throw papelErro;
      if (papel?.ativo !== true || papel?.papel !== 'administrador_geral') {
        return resposta(403, { erro: 'Somente o Administrador Geral pode alterar o cadastro fiscal.' });
      }
    } else if (!contexto?.empresa_id || !licencaPermiteOperacao(contexto)) {
      return resposta(403, { erro: 'Entre em uma empresa ativa para usar a NFS-e.' });
    }
    const empresaId = suporteCadastro ? texto(dados.empresaId) : contexto.empresa_id;
    if (suporteCadastro) {
      if (!/^[0-9a-f-]{36}$/i.test(empresaId)) return resposta(400, { erro: 'Empresa invalida.' });
      const { data: empresa, error: empresaErro } = await admin.from('empresas')
        .select('id').eq('id', empresaId).maybeSingle();
      if (empresaErro) throw empresaErro;
      if (!empresa) return resposta(404, { erro: 'Empresa nao encontrada.' });
    }
    if (!suporteCadastro && contexto.recursos_habilitados?.fiscal_habilitado !== true) {
      return resposta(403, { erro: 'A emissão de NFS-e ainda não está liberada para esta empresa.' });
    }
    const podeConfigurar = suporteCadastro || temPermissao(contexto, 'configuracoes', 'editar');
    const podeLerFinanceiro = suporteCadastro || temPermissao(contexto, 'financeiro', 'ler');
    const podeEmitir = !suporteCadastro && (temPermissao(contexto, 'financeiro', 'criar') ||
      temPermissao(contexto, 'financeiro', 'editar'));
    const podeCancelar = !suporteCadastro && temPermissao(contexto, 'financeiro', 'editar');
    const podeGerirLimites = !suporteCadastro && ehAdministradorEmpresa(contexto);
    const emissorOperacional = Deno.env.get('FISCAL_EMISSOR_ATIVO') === 'true';

    if (['listar_limites', 'salvar_limite', 'remover_limite'].includes(acao)) {
      if (!podeGerirLimites) return resposta(403, { erro: 'Somente o administrador da empresa pode definir limites fiscais da equipe.' });
      if (acao === 'listar_limites') {
        const [regras, perfis] = await Promise.all([
          admin.from('limites_emissao_fiscal').select('tipo_alvo,alvo,limite_mensal,limite_gasto_centavos,atualizado_em')
            .eq('empresa_id', empresaId).order('tipo_alvo').order('alvo'),
          admin.from('perfis').select('id,nome,cargo,ativo').eq('empresa_id', empresaId).eq('ativo', true).order('nome')
        ]);
        if (regras.error) throw regras.error;
        if (perfis.error) throw perfis.error;
        return resposta(200, { regras: regras.data || [], usuarios: perfis.data || [] });
      }
      const tipoAlvo = texto(dados.tipoAlvo);
      const alvo = texto(dados.alvo).toLowerCase();
      if (!['usuario', 'cargo'].includes(tipoAlvo) || !alvo || alvo.length > 120) {
        return resposta(400, { erro: 'Selecione um usuario ou cargo valido.' });
      }
      if (acao === 'remover_limite') {
        const { data: removido, error } = await admin.rpc('remover_limite_emissao_fiscal', {
          p_empresa_id: empresaId, p_tipo_alvo: tipoAlvo, p_alvo: alvo,
          p_autor_id: autenticacao.user.id
        });
        if (error) throw error;
        return resposta(200, { removido: Boolean(removido) });
      }
      const limiteMensal = dados.limiteMensal == null || dados.limiteMensal === '' ? null : Number(dados.limiteMensal);
      const limiteGasto = dados.limiteGastoCentavos == null || dados.limiteGastoCentavos === ''
        ? null : Number(dados.limiteGastoCentavos);
      if ((limiteMensal === null && limiteGasto === null) ||
          (limiteMensal !== null && (!Number.isInteger(limiteMensal) || limiteMensal < 0 || limiteMensal > 1000000)) ||
          (limiteGasto !== null && (!Number.isSafeInteger(limiteGasto) || limiteGasto < 0 || limiteGasto > 1000000000))) {
        return resposta(400, { erro: 'Informe limite mensal e/ou gasto mensal em centavos validos. Zero bloqueia o uso.' });
      }
      const { data: regra, error } = await admin.rpc('definir_limite_emissao_fiscal', {
        p_empresa_id: empresaId, p_tipo_alvo: tipoAlvo, p_alvo: alvo,
        p_limite_mensal: limiteMensal, p_limite_gasto_centavos: limiteGasto,
        p_autor_id: autenticacao.user.id
      });
      if (error) {
        if (/nao pertence a empresa/i.test(error.message)) return resposta(400, { erro: error.message });
        throw error;
      }
      return resposta(200, { regra });
    }

    if (acao === 'resumo' || acao === 'listar') {
      if (!podeLerFinanceiro) return resposta(403, { erro: 'Seu usuário não pode consultar documentos fiscais.' });
      const [configConsulta, notasConsulta, contaConsulta, usoConsulta, recargasConsulta] = await Promise.all([
        admin.from('configuracoes_fiscais').select('empresa_id,provedor,ambiente,status,emissao_automatica_os,emissao_automatica_venda,emissao_automatica_assinatura,metadados,ultimo_erro,updated_at').eq('empresa_id', empresaId).maybeSingle(),
        suporteCadastro ? Promise.resolve({ data: [], error: null }) :
          admin.from('notas_fiscais').select('id,origem_tipo,origem_id,valor,descricao,status,numero,codigo_verificacao,chave_acesso,url_consulta,pdf_url,danfse_url,danfse_storage_path,danfse_gerado_em,emitida_em,ultimo_erro,created_at').eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(50),
        admin.from('contas_fiscais').select('limite_gratuito_mensal,preco_excedente_centavos,saldo_centavos,debito_pendente_centavos').eq('empresa_id', empresaId).maybeSingle(),
        admin.from('reservas_fiscais').select('status', { count: 'exact', head: true }).eq('empresa_id', empresaId).eq('competencia', competenciaAtual()).in('status', ['reservada', 'consumida']),
        suporteCadastro ? Promise.resolve({ data: [], error: null }) :
          admin.from('recargas_fiscais').select('id,valor_centavos,status,checkout_url,criado_em,aplicado_em').eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(5)
      ]);
      if (configConsulta.error) throw configConsulta.error;
      if (notasConsulta.error) throw notasConsulta.error;
      if (contaConsulta.error) throw contaConsulta.error;
      if (usoConsulta.error) throw usoConsulta.error;
      if (recargasConsulta.error) throw recargasConsulta.error;
      const conta = contaConsulta.data || { limite_gratuito_mensal: 100, preco_excedente_centavos: 20,
        saldo_centavos: 0, debito_pendente_centavos: 0 };
      const utilizadas = usoConsulta.count || 0;
      return resposta(200, { configuracao: configConsulta.data, notas: notasConsulta.data || [],
        emissor_operacional: emissorOperacional,
        cota: { ...conta, utilizadas, restantes_gratuitas: Math.max(0, conta.limite_gratuito_mensal - utilizadas), competencia: competenciaAtual() },
        recargas: recargasConsulta.data || [] });
    }

    if (acao === 'criar_recarga') {
      if (!podeConfigurar) return resposta(403, { erro: 'Somente o administrador da empresa pode adicionar credito fiscal.' });
      const valorCentavos = Number(dados.valorCentavos);
      if (!Number.isInteger(valorCentavos) || valorCentavos < 100 || valorCentavos > 10000000) {
        return resposta(400, { erro: 'Informe uma recarga entre R$ 1,00 e R$ 100.000,00.' });
      }
      const { data: configFiscal, error: configErro } = await admin.from('configuracoes_fiscais')
        .select('status,ambiente').eq('empresa_id', empresaId).maybeSingle();
      if (configErro) throw configErro;
      if (!emissorOperacional || configFiscal?.status !== 'configurada' || configFiscal?.ambiente !== 'producao') {
        return resposta(409, { erro: 'A recarga so sera liberada apos a emissao fiscal em producao ser homologada para esta empresa.' });
      }
      const { integracao, segredo } = await carregarIntegracaoPlataforma(admin, 'mercado_pago');
      const accessToken = texto(segredo?.access_token);
      if (!integracao || !accessToken || integracao.metadados?.webhook_assinado !== true || integracao.metadados?.ambiente !== 'producao') {
        return resposta(409, { erro: 'Mercado Pago indisponivel para recarga fiscal.' });
      }
      const id = crypto.randomUUID();
      const referencia = `FISCAL-${empresaId}-${id}`;
      const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { data: recarga, error: recargaErro } = await admin.from('recargas_fiscais').insert({
        id, empresa_id: empresaId, valor_centavos: valorCentavos, referencia_externa: referencia, expira_em: expiraEm
      }).select('id,idempotency_key').single();
      if (recargaErro) throw recargaErro;
      const retorno = texto(Deno.env.get('SAAS_BILLING_RETURN_URL'));
      const preferenciaBody: Record<string, unknown> = {
        items: [{ id, title: 'Sistema OS - Credito para notas fiscais', quantity: 1, currency_id: 'BRL', unit_price: valorCentavos / 100 }],
        external_reference: referencia,
        notification_url: `${url.replace(/\/$/, '')}/functions/v1/mercado-pago-saas-webhook`,
        expires: true, expiration_date_to: expiraEm, statement_descriptor: 'SISTEMA OS',
        metadata: { recarga_fiscal_id: id, empresa_id: empresaId }
      };
      if (/^https:\/\//i.test(retorno)) {
        preferenciaBody.back_urls = { success: retorno, pending: retorno, failure: retorno };
        preferenciaBody.auto_return = 'approved';
      }
      const mpResposta = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
          'X-Idempotency-Key': String(recarga.idempotency_key) },
        body: JSON.stringify(preferenciaBody), signal: AbortSignal.timeout(15000)
      });
      const preferencia = await mpResposta.json().catch(() => ({}));
      const link = texto(preferencia.init_point);
      if (!mpResposta.ok || !/^https:\/\//i.test(link)) {
        await admin.from('recargas_fiscais').update({ status: 'rejeitada' }).eq('id', id);
        return resposta(502, { erro: 'Nao foi possivel gerar a recarga no Mercado Pago.' });
      }
      const { error: atualizarErro } = await admin.from('recargas_fiscais').update({
        checkout_url: link, preferencia_id: texto(preferencia.id)
      }).eq('id', id);
      if (atualizarErro) throw atualizarErro;
      return resposta(200, { recarga: { id, valor_centavos: valorCentavos, status: 'pendente', checkout_url: link }, link });
    }

    if (acao === 'salvar_configuracao') {
      if (!podeConfigurar) return resposta(403, { erro: 'Somente o administrador pode configurar a emissao de NFS-e.' });
      const tipoInformado = texto(dados.tipoPrestador || dados.tipoPessoa).toLowerCase();
      const tipoPrestador = ['mei', 'juridica', 'fisica'].includes(tipoInformado)
        ? tipoInformado
        : (texto(dados.tipoPessoa) === 'fisica' ? 'fisica' : 'juridica');
      const tipoPessoa = tipoPrestador === 'fisica' ? 'fisica' : 'juridica';
      const cpf = tipoPessoa === 'fisica' ? digitos(dados.documentoPrestador || dados.cpf, 20) : '';
      const cnpj = tipoPessoa === 'juridica' ? cnpjNormalizado(dados.documentoPrestador || dados.cnpj) : '';
      const documentoPrestador = cpf || cnpj;
      const codigoMunicipio = digitos(dados.codigoMunicipio, 20);
      const codigoMunicipioPrestacao = digitos(dados.codigoMunicipioPrestacao, 20);
      const inscricaoMunicipal = texto(dados.inscricaoMunicipal).replace(/[^0-9A-Za-z.-]/g, '').slice(0, 30);
      const inscricaoMunicipalDispensada = dados.inscricaoMunicipalDispensada === true;
      const cadastroMunicipalConfirmado = dados.cadastroMunicipalConfirmado === true;
      const codigoServico = texto(dados.codigoServico).replace(/[^0-9A-Za-z.-]/g, '').slice(0, 30);
      const codigoServicoMunicipal = texto(dados.codigoServicoMunicipal).replace(/[^0-9A-Za-z.-]/g, '').slice(0, 30);
      const nbs = texto(dados.nbs).replace(/[^0-9A-Za-z.-]/g, '').slice(0, 30);
      const nomePrestador = texto(dados.nomePrestador).slice(0, 160);
      const nomeFantasia = texto(dados.nomeFantasia).slice(0, 160);
      const emailPrestador = texto(dados.emailPrestador).toLowerCase().slice(0, 180);
      const telefonePrestador = texto(dados.telefonePrestador).replace(/[^0-9+()\s.-]/g, '').slice(0, 30);
      const cepPrestador = digitos(dados.cepPrestador, 8);
      const logradouroPrestador = texto(dados.logradouroPrestador).slice(0, 180);
      const numeroPrestador = texto(dados.numeroPrestador).slice(0, 30);
      const complementoPrestador = texto(dados.complementoPrestador).slice(0, 80);
      const bairroPrestador = texto(dados.bairroPrestador).slice(0, 100);
      const municipioNome = texto(dados.municipioNome).slice(0, 120);
      const uf = texto(dados.uf).toUpperCase().replace(/[^A-Z]/g, '');
      const regimesValidos = new Set(['mei', 'simples_nacional', 'lucro_presumido', 'lucro_real', 'autonomo', 'outro']);
      const regimePadrao = tipoPrestador === 'mei' ? 'mei' : (tipoPrestador === 'fisica' ? 'autonomo' : 'simples_nacional');
      const regimeTributario = regimesValidos.has(texto(dados.regimeTributario)) ? texto(dados.regimeTributario) : regimePadrao;
      const apuracoesValidas = new Set(['padrao', 'simples_nacional', 'nfse']);
      const regimeApuracao = apuracoesValidas.has(texto(dados.regimeApuracao)) ? texto(dados.regimeApuracao) : 'padrao';
      const regimeEspecial = texto(dados.regimeEspecial).slice(0, 100);
      const beneficioMunicipal = texto(dados.beneficioMunicipal).slice(0, 100);
      const descricaoServicoPadrao = texto(dados.descricaoServicoPadrao).slice(0, 500);
      const aliquotaIssBruta = texto(dados.aliquotaIss);
      const aliquotaIss = decimalOpcional(dados.aliquotaIss);
      const retencoesValidas = new Set(['nao', 'tomador', 'intermediario']);
      const issRetidoPadrao = retencoesValidas.has(texto(dados.issRetidoPadrao)) ? texto(dados.issRetidoPadrao) : 'nao';
      const tributosAproximadosModo = texto(dados.tributosAproximadosModo) === 'percentuais' ? 'percentuais' : 'nao_informar';
      const percentualTributosFederais = decimalOpcional(dados.percentualTributosFederais);
      const percentualTributosEstaduais = decimalOpcional(dados.percentualTributosEstaduais);
      const percentualTributosMunicipais = decimalOpcional(dados.percentualTributosMunicipais);
      const rotasValidas = new Set(['nfse_nacional', 'municipal', 'provedor']);
      const rotaEmissao = rotasValidas.has(texto(dados.rotaEmissao)) ? texto(dados.rotaEmissao) : 'nfse_nacional';
      const provedorFiscal = texto(dados.provedorFiscal).slice(0, 120);
      const ambiente = texto(dados.ambiente) === 'producao' ? 'producao' : 'homologacao';
      const tipoEmitenteProdutos = texto(dados.tipoEmitenteProdutos) === 'cpf' ? 'cpf' : 'cnpj';
      const documentoEmitenteProdutos = tipoEmitenteProdutos === 'cpf'
        ? digitos(dados.documentoEmitenteProdutos, 11)
        : cnpjNormalizado(dados.documentoEmitenteProdutos);
      const produtorRural = dados.produtorRural === true;
      const inscricaoEstadual = texto(dados.inscricaoEstadual).replace(/[^0-9A-Za-z]/g, '').slice(0, 20);
      if (tipoPessoa === 'fisica' && documentoPrestador && !cpfValido(cpf)) return resposta(400, { erro: 'CPF do prestador invalido.' });
      if (tipoPessoa === 'juridica' && cnpj && !cnpjValido(cnpj)) {
        return resposta(400, { erro: 'CNPJ invalido: confira os caracteres e digitos verificadores.' });
      }
      if (documentoEmitenteProdutos && !(tipoEmitenteProdutos === 'cpf'
        ? cpfValido(documentoEmitenteProdutos) : cnpjValido(documentoEmitenteProdutos))) {
        return resposta(400, { erro: 'CPF/CNPJ do emitente de NF-e/NFC-e invalido.' });
      }
      if (documentoEmitenteProdutos && tipoEmitenteProdutos === 'cpf' && (!produtorRural || !inscricaoEstadual)) {
        return resposta(400, { erro: 'Emissao de NF-e/NFC-e por CPF exige produtor rural com inscricao estadual e credenciamento da UF.' });
      }
      if (codigoMunicipio && codigoMunicipio.length !== 7) return resposta(400, { erro: 'Codigo do municipio invalido.' });
      if (codigoMunicipioPrestacao && codigoMunicipioPrestacao.length !== 7) return resposta(400, { erro: 'Codigo do municipio da prestacao invalido.' });
      if (uf && uf.length !== 2) return resposta(400, { erro: 'UF do prestador invalida.' });
      if (emailPrestador && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPrestador)) return resposta(400, { erro: 'E-mail fiscal invalido.' });
      if (aliquotaIssBruta && aliquotaIss === null) return resposta(400, { erro: 'Aliquota de ISS invalida.' });
      if (tributosAproximadosModo === 'percentuais') {
        const percentuais: Array<[string, number | null]> = [
          [texto(dados.percentualTributosFederais), percentualTributosFederais],
          [texto(dados.percentualTributosEstaduais), percentualTributosEstaduais],
          [texto(dados.percentualTributosMunicipais), percentualTributosMunicipais]
        ];
        if (percentuais.some(([bruto, numero]) => Boolean(bruto && numero === null))) {
          return resposta(400, { erro: 'Percentual de tributos aproximados invalido.' });
        }
      }

      const { data: configuracaoAtual, error: configuracaoAtualErro } = await admin.from('configuracoes_fiscais')
        .select('provedor,ambiente,status,metadados,ultimo_erro').eq('empresa_id', empresaId).maybeSingle();
      if (configuracaoAtualErro) throw configuracaoAtualErro;
      const metadadosAtuais: Record<string, unknown> = configuracaoAtual?.metadados &&
        typeof configuracaoAtual.metadados === 'object' && !Array.isArray(configuracaoAtual.metadados)
        ? configuracaoAtual.metadados as Record<string, unknown>
        : {};
      const tipoAnterior = texto(metadadosAtuais.tipo_prestador) ||
        (texto(metadadosAtuais.tipo_pessoa) === 'fisica' ? 'fisica' : 'juridica');
      const documentoAnteriorBruto = metadadosAtuais.documento_prestador || metadadosAtuais.cpf || metadadosAtuais.cnpj;
      const documentoAnterior = tipoAnterior === 'fisica'
        ? digitos(documentoAnteriorBruto, 20)
        : cnpjNormalizado(documentoAnteriorBruto);
      const rotaAnterior = texto(metadadosAtuais.rota_emissao) || 'nfse_nacional';
      const identidadeMudou = Boolean(configuracaoAtual && (
        tipoAnterior !== tipoPrestador ||
        documentoAnterior !== documentoPrestador ||
        texto(metadadosAtuais.codigo_municipio) !== codigoMunicipio ||
        rotaAnterior !== rotaEmissao ||
        texto(configuracaoAtual.ambiente) !== ambiente
      ));
      const documentoCompleto = tipoPessoa === 'fisica' ? cpfValido(cpf) : cnpjValido(cnpj);
      const inscricaoCompleta = Boolean(inscricaoMunicipal || inscricaoMunicipalDispensada);
      const autorizacaoCompleta = tipoPrestador !== 'fisica' || cadastroMunicipalConfirmado;
      const completo = Boolean(documentoCompleto && codigoMunicipio.length === 7 && inscricaoCompleta &&
        codigoServico && regimeTributario && autorizacaoCompleta);
      const manterAtivacao = configuracaoAtual?.status === 'configurada' && !identidadeMudou && completo;
      const statusConfiguracao = manterAtivacao ? 'configurada' : 'nao_configurada';
      const ultimoErro = manterAtivacao
        ? null
        : (completo
          ? 'Dados fiscais salvos. Solicite a ativacao tecnica e o teste de homologacao.'
          : (tipoPrestador === 'fisica' && !cadastroMunicipalConfirmado
            ? 'Confirme o cadastro municipal da pessoa fisica e complete os dados da NFS-e.'
            : 'Complete os dados fiscais e solicite a ativacao da NFS-e.'));
      const { data: configuracao, error } = await admin.from('configuracoes_fiscais').upsert({
        empresa_id: empresaId,
        provedor: configuracaoAtual?.provedor || 'nfse_nacional',
        ambiente,
        status: statusConfiguracao,
        emissao_automatica_os: dados.emissaoAutomaticaOs === true,
        emissao_automatica_venda: dados.emissaoAutomaticaVenda === true,
        emissao_automatica_assinatura: dados.emissaoAutomaticaAssinatura === true,
        metadados: {
          ...metadadosAtuais,
          tipo_pessoa: tipoPessoa,
          tipo_prestador: tipoPrestador,
          documento_prestador: documentoPrestador || null,
          cpf: cpf || null,
          cnpj: cnpj || null,
          nome_prestador: nomePrestador || null,
          nome_fantasia: nomeFantasia || null,
          email_prestador: emailPrestador || null,
          telefone_prestador: telefonePrestador || null,
          cep_prestador: cepPrestador || null,
          logradouro_prestador: logradouroPrestador || null,
          numero_prestador: numeroPrestador || null,
          complemento_prestador: complementoPrestador || null,
          bairro_prestador: bairroPrestador || null,
          codigo_municipio: codigoMunicipio || null,
          municipio_nome: municipioNome || null,
          uf: uf || null,
          inscricao_municipal: inscricaoMunicipal || null,
          inscricao_municipal_dispensada: inscricaoMunicipalDispensada,
          cadastro_municipal_confirmado: cadastroMunicipalConfirmado,
          regime_tributario: regimeTributario,
          regime_apuracao: regimeApuracao,
          regime_especial: regimeEspecial || null,
          beneficio_municipal: beneficioMunicipal || null,
          codigo_servico: codigoServico || null,
          codigo_servico_municipal: codigoServicoMunicipal || null,
          nbs: nbs || null,
          aliquota_iss: aliquotaIss,
          iss_retido_padrao: issRetidoPadrao,
          codigo_municipio_prestacao: codigoMunicipioPrestacao || null,
          descricao_servico_padrao: descricaoServicoPadrao || null,
          tributos_aproximados_modo: tributosAproximadosModo,
          percentual_tributos_federais: tributosAproximadosModo === 'percentuais' ? percentualTributosFederais : null,
          percentual_tributos_estaduais: tributosAproximadosModo === 'percentuais' ? percentualTributosEstaduais : null,
          percentual_tributos_municipais: tributosAproximadosModo === 'percentuais' ? percentualTributosMunicipais : null,
          rota_emissao: rotaEmissao,
          provedor_fiscal: provedorFiscal || null,
          tipo_emitente_produtos: tipoEmitenteProdutos,
          documento_emitente_produtos: documentoEmitenteProdutos || null,
          produtor_rural: produtorRural,
          inscricao_estadual: inscricaoEstadual || null
        },
        ultimo_erro: ultimoErro,
        updated_at: new Date().toISOString()
      }, { onConflict: 'empresa_id' }).select('empresa_id,provedor,ambiente,status,emissao_automatica_os,emissao_automatica_venda,emissao_automatica_assinatura,metadados,ultimo_erro,updated_at').single();
      if (error) throw error;
      if (suporteCadastro) {
        const { error: auditoriaErro } = await admin.from('auditoria_comercial').insert({
          empresa_id: empresaId, autor_id: autenticacao.user.id,
          acao: 'cadastro_fiscal_atualizado_suporte', entidade: 'empresa', entidade_id: empresaId,
          metadados: { ambiente, status: statusConfiguracao, tipo_prestador: tipoPrestador,
            tipo_emitente_produtos: tipoEmitenteProdutos, identidade_mudou: identidadeMudou }
        });
        if (auditoriaErro) console.error('[fiscal-documentos] Auditoria de suporte indisponivel', auditoriaErro.message);
      }
      return resposta(200, {
        configuracao,
        mensagem: manterAtivacao
          ? 'Configuracao da NFS-e atualizada; a ativacao existente foi mantida.'
          : (completo
            ? 'Dados da NFS-e salvos. Solicite a ativacao fiscal para conectar e homologar a emissao.'
            : 'Dados da NFS-e salvos. Complete os campos pendentes antes da ativacao.')
      });
    }

    if (acao === 'solicitar_emissao') {
      if (!podeEmitir) return resposta(403, { erro: 'Seu usuário não pode emitir documentos fiscais.' });
      const origemTipo = texto(dados.origemTipo);
      const origemId = texto(dados.origemId).slice(0, 120);
      const valor = Number(dados.valor || 0);
      const descricao = texto(dados.descricao).slice(0, 500);
      if (!['os', 'venda', 'avulsa'].includes(origemTipo) || !origemId ||
          !Number.isFinite(valor) || valor <= 0 || valor > 9999999999.99 ||
          Math.abs(valor * 100 - Math.round(valor * 100)) > 0.000001 || !descricao) {
        return resposta(400, { erro: 'Informe documento, valor e descricao validos.' });
      }
      const { data: existente, error: existenteErro } = await admin.from('notas_fiscais')
        .select('id,origem_tipo,origem_id,valor,descricao,status,numero,chave_acesso,url_consulta,pdf_url,danfse_url,danfse_storage_path,danfse_gerado_em,created_at')
        .eq('empresa_id', empresaId).eq('origem_tipo', origemTipo).eq('origem_id', origemId).maybeSingle();
      if (existenteErro) throw existenteErro;
      if (existente && ['autorizada', 'na_fila', 'processando'].includes(existente.status)) {
        return resposta(200, { nota: existente, reutilizada: true, mensagem: existente.status === 'autorizada'
          ? 'Esta NFS-e ja foi autorizada. O DANFSe continua disponivel no historico.'
          : 'A solicitacao desta NFS-e ja esta em andamento.' });
      }
      const { data: config, error: configErro } = await admin.from('configuracoes_fiscais')
        .select('status,provedor,ambiente').eq('empresa_id', empresaId).maybeSingle();
      if (configErro) throw configErro;
      const pronta = emissorOperacional && config?.status === 'configurada' && config?.ambiente === 'producao';
      const status = pronta ? 'rascunho' : 'aguardando_configuracao';
      const payload = {
        tomador: dados.tomador && typeof dados.tomador === 'object' ? dados.tomador : {},
        observacoes: texto(dados.observacoes).slice(0, 1000)
      };
      const mutacao = {
        empresa_id: empresaId, origem_tipo: origemTipo, origem_id: origemId, valor,
        descricao, status, provedor: config?.provedor || 'nfse_nacional', payload,
        ultimo_erro: status === 'aguardando_configuracao' ? 'Configure os dados da NFS-e e conclua a ativacao fiscal.' : null,
        updated_at: new Date().toISOString()
      };
      const consulta = existente
        ? admin.from('notas_fiscais').update(mutacao).eq('id', existente.id).eq('empresa_id', empresaId)
            .in('status', ['rascunho', 'aguardando_configuracao', 'rejeitada'])
        : admin.from('notas_fiscais').insert(mutacao);
      const { data: nota, error } = await consulta
        .select('id,origem_tipo,origem_id,valor,descricao,status,numero,url_consulta,pdf_url,created_at').maybeSingle();
      if (error?.code === '23505') return resposta(409, { erro: 'A NFS-e foi criada por outro usuario. Atualize a lista.' });
      if (error) throw error;
      if (!nota) return resposta(409, { erro: 'A NFS-e mudou de estado. Atualize a lista.' });
      if (pronta) {
        const { data: reserva, error: reservaErro } = await admin.rpc('reservar_cota_fiscal', {
          p_nota_id: nota.id, p_usuario_id: autenticacao.user.id
        });
        if (reservaErro) {
          if (/saldo fiscal insuficiente/i.test(reservaErro.message)) {
            return resposta(409, { erro: 'Cota gratuita esgotada e saldo fiscal insuficiente. Adicione saldo antes de emitir.' });
          }
          if (/limite mensal de emissao|limite de gasto fiscal/i.test(reservaErro.message)) {
            return resposta(409, { erro: 'Seu limite mensal de notas ou de uso do saldo fiscal foi atingido. Fale com o administrador da empresa.' });
          }
          throw reservaErro;
        }
        return resposta(200, { nota: { ...nota, status: 'na_fila' }, reserva,
          mensagem: 'NFS-e reservada na cota e adicionada a fila de emissao.' });
      }
      return resposta(200, { nota, mensagem: 'Solicitacao de NFS-e salva. Conclua a ativacao fiscal para autoriza-la.' });
    }

    if (acao === 'alterar_solicitacao') {
      if (!podeEmitir) return resposta(403, { erro: 'Seu usuário não pode alterar documentos fiscais.' });
      const id = texto(dados.id);
      const valor = Number(dados.valor);
      const descricao = texto(dados.descricao).slice(0, 500);
      if (!id || !Number.isFinite(valor) || valor <= 0 || valor > 9999999999.99 ||
          Math.abs(valor * 100 - Math.round(valor * 100)) > 0.000001 || !descricao) {
        return resposta(400, { erro: 'Informe valor com até duas casas decimais e descrição do serviço.' });
      }
      const { data: nota, error } = await admin.from('notas_fiscais')
        .update({ valor, descricao, updated_at: new Date().toISOString() })
        .eq('id', id).eq('empresa_id', empresaId)
        .in('status', ['rascunho', 'aguardando_configuracao'])
        .select('id,valor,descricao,status').maybeSingle();
      if (error) throw error;
      if (!nota) return resposta(409, { erro: 'Esta solicitação já foi enviada ao emissor ou não pertence à empresa. Não pode mais ser editada.' });
      return resposta(200, { nota, mensagem: 'Solicitação fiscal atualizada.' });
    }

    if (acao === 'obter_danfse') {
      if (!podeLerFinanceiro) return resposta(403, { erro: 'Seu usuário não pode consultar documentos fiscais.' });
      const id = texto(dados.id);
      if (!id) return resposta(400, { erro: 'Informe a NFS-e.' });
      const { data: nota, error } = await admin.from('notas_fiscais')
        .select('id,status,numero,chave_acesso,pdf_url,danfse_url,danfse_storage_path,danfse_gerado_em')
        .eq('id', id).eq('empresa_id', empresaId).maybeSingle();
      if (error) throw error;
      if (!nota) return resposta(404, { erro: 'NFS-e nao encontrada.' });
      if (nota.status !== 'autorizada') {
        return resposta(409, { erro: 'O DANFSe so fica disponivel depois que a NFS-e e autorizada.' });
      }

      let url = '';
      if (nota.danfse_storage_path) {
        const { data: assinatura, error: assinaturaErro } = await admin.storage
          .from('documentos-fiscais').createSignedUrl(nota.danfse_storage_path, 300, { download: `DANFSe-${nota.numero || nota.id}.pdf` });
        if (assinaturaErro) throw assinaturaErro;
        url = urlHttps(assinatura?.signedUrl);
      }
      if (!url) url = urlHttps(nota.danfse_url || nota.pdf_url);
      if (!url) {
        return resposta(409, { erro: 'A NFS-e foi autorizada, mas o provedor ainda nao entregou o DANFSe. Atualize a situacao em instantes.' });
      }
      return resposta(200, {
        danfse: {
          notaId: nota.id,
          numero: nota.numero,
          chaveAcesso: nota.chave_acesso,
          url,
          expiraEmSegundos: nota.danfse_storage_path ? 300 : null,
          geradoEm: nota.danfse_gerado_em
        }
      });
    }

    if (acao === 'cancelar_solicitacao') {
      if (!podeCancelar) return resposta(403, { erro: 'Seu usuário não pode cancelar documentos fiscais.' });
      const id = texto(dados.id);
      const { data: nota, error } = await admin.from('notas_fiscais').update({
        status: 'cancelada', updated_at: new Date().toISOString()
      }).eq('id', id).eq('empresa_id', empresaId)
        // Depois de entrar na fila, a SEFAZ/prefeitura pode já estar processando.
        // Não cancele só no banco: espere o emissor confirmar o cancelamento.
        .in('status', ['rascunho', 'aguardando_configuracao'])
        .select('id,status').maybeSingle();
      if (error) throw error;
      if (!nota) return resposta(409, { erro: 'Esta solicitação já foi enviada ao emissor ou encerrada. O cancelamento fiscal exige confirmação do provedor.' });
      return resposta(200, { nota, mensagem: 'Solicitacao de NFS-e cancelada.' });
    }

    return resposta(400, { erro: 'Acao nao reconhecida.' });
  } catch (erro) {
    console.error('[fiscal-documentos]', erro);
    return resposta(500, { erro: 'Nao foi possivel concluir a operacao fiscal agora.' });
  }
});
