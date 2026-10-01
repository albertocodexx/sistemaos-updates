import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { contextoUsuarioAtivo, ehAdministradorEmpresa, licencaPermiteOperacao, temPermissao } from '../_shared/access.ts';
import { carregarIntegracaoPlataforma } from '../assinaturas-saas/saas.ts';
import { verificarEmitenteNfeio } from '../_shared/nfeio-preflight.ts';
import { consultarEmpresaExistenteNfeio, criarEmpresaNfeio, criarInscricaoMunicipalNfeio,
  ativarInscricaoMunicipalNfeio,
  enviarCertificadoNfeio } from '../_shared/nfeio-onboarding.ts';

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
      if (!['resumo', 'listar', 'salvar_configuracao', 'verificar_emitente_nfeio',
        'cadastrar_empresa_nfeio', 'cadastrar_inscricao_nfeio', 'cadastrar_certificado_a1', 'ativar_inscricao_nfeio'].includes(acao)) {
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
    const plataformaFiscal = suporteCadastro && dados.escopo === 'plataforma';
    const tabelaConfiguracoes = plataformaFiscal ? 'configuracoes_fiscais_plataforma' : 'configuracoes_fiscais';
    const empresaId = plataformaFiscal ? '00000000-0000-4000-8000-000000000001'
      : suporteCadastro ? texto(dados.empresaId) : contexto.empresa_id;
    if (suporteCadastro && !plataformaFiscal) {
      if (!/^[0-9a-f-]{36}$/i.test(empresaId)) return resposta(400, { erro: 'Empresa invalida.' });
      const { data: empresa, error: empresaErro } = await admin.from('empresas')
        .select('id').eq('id', empresaId).maybeSingle();
      if (empresaErro) throw empresaErro;
      if (!empresa) return resposta(404, { erro: 'Empresa nao encontrada.' });
    }
    const { data: empresaFiscal, error: empresaFiscalErro } = await admin.from('empresas')
      .select('licenca_status,inicio_trial,fim_trial,data_vencimento,plano:planos(nome)').eq('id', empresaId).maybeSingle();
    if (empresaFiscalErro) throw empresaFiscalErro;
    const fiscalNoTrial = ['trial', 'beta'].includes(texto(empresaFiscal?.plano?.nome).toLowerCase()) &&
      empresaFiscal?.licenca_status === 'teste' &&
      Date.parse(texto(empresaFiscal.fim_trial)) > Date.now();
    const fiscalDisponivel = plataformaFiscal || fiscalNoTrial ||
      (empresaFiscal?.licenca_status === 'ativa' && Date.parse(texto(empresaFiscal?.data_vencimento)) > Date.now());
    // Os dados fiscais e a identidade do emitente pertencem à empresa, mas
    // somente o administrador dela pode alterá-los. A permissão genérica de
    // editar Configurações não equivale a administrar o emitente fiscal.
    const podeConfigurar = suporteCadastro || ehAdministradorEmpresa(contexto);
    const podeLerFinanceiro = suporteCadastro || temPermissao(contexto, 'financeiro', 'ler');
    const podeEmitir = !suporteCadastro && (temPermissao(contexto, 'financeiro', 'criar') ||
      temPermissao(contexto, 'financeiro', 'editar'));
    const podeCancelar = !suporteCadastro && temPermissao(contexto, 'financeiro', 'editar');
    const podeGerirLimites = !suporteCadastro && ehAdministradorEmpresa(contexto);
    // A liberação exige código, chave e worker configurados no servidor. O
    // formulário do cliente nunca consegue promover sozinho um emitente.
    const emissorOperacional = Deno.env.get('FISCAL_EMISSOR_ATIVO') === 'true' &&
      Boolean(texto(Deno.env.get('NFEIO_INVOICE_KEY'))) &&
      Boolean(texto(Deno.env.get('NFEIO_ACCOUNT_ID'))) &&
      Boolean(texto(Deno.env.get('FISCAL_WORKER_CRON_SECRET')));

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
        admin.from(tabelaConfiguracoes).select('empresa_id,provedor,ambiente,status,emissao_automatica_os,emissao_automatica_venda,emissao_automatica_assinatura,metadados,ultimo_erro,updated_at').eq('empresa_id', empresaId).maybeSingle(),
        suporteCadastro ? Promise.resolve({ data: [], error: null }) :
          admin.from('notas_fiscais').select('id,origem_tipo,origem_id,valor,descricao,status,numero,codigo_verificacao,chave_acesso,url_consulta,pdf_url,danfse_url,danfse_storage_path,danfse_gerado_em,emitida_em,ultimo_erro,created_at,payload').eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(100),
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
      const conta = contaConsulta.data || { limite_gratuito_mensal: 0, preco_excedente_centavos: 99,
        saldo_centavos: 0, debito_pendente_centavos: 0 };
      const utilizadas = usoConsulta.count || 0;
      const notas = (notasConsulta.data || []).map((nota: Record<string, any>) => {
        const tomador = nota.payload?.tomador;
        const clienteNome = tomador && typeof tomador === 'object' ? texto(tomador.nome).slice(0, 160) : '';
        const { payload: _payload, ...dadosNota } = nota;
        return { ...dadosNota, cliente_nome: clienteNome, tipo_documento: 'nfse',
          cancelamento_solicitado: Boolean(nota.payload?.cancelamento?.solicitado_em),
          xml_disponivel: Boolean(nota.payload?.documentos?.xml_storage_path) };
      });
      return resposta(200, { configuracao: configConsulta.data, notas,
        provedor_fiscal: 'nfeio', pode_configurar: podeConfigurar,
        nfeio_disponivel: Boolean(Deno.env.get('NFEIO_INVOICE_KEY')) && Boolean(Deno.env.get('NFEIO_ACCOUNT_ID')),
        certificado_upload_disponivel: podeConfigurar &&
          Boolean(Deno.env.get('NFEIO_INVOICE_KEY')) &&
          Boolean(configConsulta.data?.metadados?.nfeio_empresa_id),
        emissor_operacional: emissorOperacional,
        modulo_fiscal_ativo: fiscalDisponivel,
        modulo_fiscal_trial: fiscalNoTrial,
        modulo_fiscal_ativo_ate: fiscalNoTrial ? empresaFiscal?.fim_trial : empresaFiscal?.data_vencimento || null,
        cota: { ...conta, limite_gratuito_mensal: fiscalDisponivel ? conta.limite_gratuito_mensal : 0,
          utilizadas, restantes_gratuitas: fiscalDisponivel ? Math.max(0, conta.limite_gratuito_mensal - utilizadas) : 0,
          competencia: competenciaAtual() },
        recargas: recargasConsulta.data || [] });
    }

    if (acao === 'verificar_emitente_nfeio') {
      if (!podeConfigurar) return resposta(403, { erro: 'Somente o administrador pode conferir o emitente fiscal.' });
      const { data: config, error: configErro } = await admin.from(tabelaConfiguracoes)
        .select('metadados').eq('empresa_id', empresaId).maybeSingle();
      if (configErro) throw configErro;
      const cnpj = cnpjNormalizado(config?.metadados?.cnpj || config?.metadados?.documento_prestador);
      if (!cnpjValido(cnpj)) return resposta(409, { erro: 'Salve primeiro o CNPJ da propria empresa no cadastro fiscal.' });
      const idExterno = texto(dados.empresaNfeioId);
      const resultado = await verificarEmitenteNfeio(idExterno, cnpj, texto(Deno.env.get('NFEIO_INVOICE_KEY')));
      if (!resultado.ok) {
        const mensagens: Record<string, string> = {
          identificacao_invalida: 'Informe um identificador valido da empresa na NFE.io.',
          credencial_indisponivel: 'A integracao NFE.io ainda nao foi configurada no servidor.',
          cnpj_divergente: 'O CNPJ da NFE.io nao corresponde ao cadastro desta empresa.',
          empresa_inativa: 'A empresa esta inativa na NFE.io.',
          consulta_empresa_falhou: 'Nao foi possivel consultar a empresa na NFE.io.',
          consulta_inscricoes_falhou: 'Nao foi possivel consultar as inscricoes na NFE.io.',
          resposta_inesperada: 'A NFE.io retornou um formato inesperado.'
        };
        return resposta(409, { erro: mensagens[resultado.motivo] || 'Nao foi possivel verificar o emitente.' });
      }
      return resposta(200, { verificacao: resultado,
        mensagem: 'CNPJ conferido. Esta checagem nao libera emissao; as inscricoes e o conector ainda precisam ser validados.' });
    }

    if (['cadastrar_empresa_nfeio', 'cadastrar_inscricao_nfeio', 'ativar_inscricao_nfeio'].includes(acao)) {
      if (!podeConfigurar) return resposta(403, { erro: 'Somente o administrador da empresa ou Administrador Geral pode cadastrar o emitente.' });
      if (!fiscalDisponivel && !suporteCadastro) return resposta(409, { erro: 'Ative ou renove o plano para configurar o emissor.' });
      const chave = texto(Deno.env.get('NFEIO_INVOICE_KEY'));
      const contaId = texto(Deno.env.get('NFEIO_ACCOUNT_ID'));
      if (!chave || !contaId) return resposta(503, { erro: 'Integracao fiscal ainda nao configurada no servidor.' });
      const { data: config, error: configErro } = await admin.from(tabelaConfiguracoes)
        .select('metadados,updated_at').eq('empresa_id', empresaId).maybeSingle();
      if (configErro) throw configErro;
      const fiscal = config?.metadados || {};
      const cnpj = digitos(fiscal.cnpj, 14);
      if (!cnpjValido(cnpj) || cnpj.length !== 14) return resposta(409, { erro: 'Salve o CNPJ da empresa antes de cadastrar o emitente.' });

      if (acao === 'ativar_inscricao_nfeio') {
        const idExterno = texto(fiscal.nfeio_empresa_id);
        const inscricaoId = texto(fiscal.nfeio_im_id);
        const validadeA1 = Date.parse(texto(fiscal.nfeio_certificado_valido_ate));
        if (!idExterno || !inscricaoId || !Number.isFinite(validadeA1) || validadeA1 <= Date.now()) {
          return resposta(409, { erro: 'Cadastre a empresa, a inscricao municipal e o A1 valido da propria empresa antes da ativacao.' });
        }
        if (dados.confirmacaoTitularidade !== true) {
          return resposta(400, { erro: 'Confirme que estes dados e o certificado pertencem a sua empresa.' });
        }
        const verificado = await verificarEmitenteNfeio(idExterno, cnpj, chave);
        if (!verificado.ok) return resposta(409, { erro: 'O CNPJ do emissor nao corresponde ao da empresa. Revise o cadastro.' });
        const ativada = await ativarInscricaoMunicipalNfeio(idExterno, inscricaoId, fiscal, {
          loginName: dados.loginPrefeitura, loginPassword: dados.senhaPrefeitura,
          authIssueValue: dados.tokenPrefeitura
        }, chave);
        if (!ativada.ok) {
          const mensagens: Record<string, string> = {
            inscricao_divergente: 'A inscricao municipal no emissor nao confere com os dados desta empresa.',
            municipio_indisponivel: 'A cidade ou a inscricao municipal nao esta ativa no emissor.',
            credenciais_invalidas: 'Confira as credenciais municipais informadas.',
            ativacao_nao_confirmada: 'O emissor nao confirmou o ambiente de producao. Consulte o suporte.'
          };
          return resposta(409, { erro: mensagens[ativada.motivo] ||
            'A NFE.io nao confirmou a ativacao. Confira o credenciamento municipal e os dados fiscais.' });
        }
        const { data: atualizada, error: atualizarErro } = await admin.from(tabelaConfiguracoes)
          .update({ provedor: 'nfeio', ambiente: 'producao', status: 'configurada', ultimo_erro: null,
            metadados: { ...fiscal, nfeio_im_producao_em: new Date().toISOString() },
            updated_at: new Date().toISOString() })
          .eq('empresa_id', empresaId).eq('updated_at', config.updated_at)
          .select('empresa_id').maybeSingle();
        if (atualizarErro) throw atualizarErro;
        if (!atualizada) return resposta(409, { erro: 'Ativacao confirmada na NFE.io, mas o cadastro foi alterado simultaneamente. Atualize a tela e repita a conferencia.' });
        return resposta(200, { cadastrada: true, emissor_operacional: emissorOperacional,
          mensagem: emissorOperacional
            ? 'Inscricao municipal confirmada. A fila de emissao NFE.io esta ativa.'
            : 'Inscricao municipal confirmada. O servidor fiscal ainda precisa ser ativado pelo suporte.' });
      }

      if (acao === 'cadastrar_empresa_nfeio') {
        if (texto(fiscal.nfeio_empresa_id)) {
          const verificado = await verificarEmitenteNfeio(texto(fiscal.nfeio_empresa_id), cnpj, chave);
          if (!verificado.ok) return resposta(409, { erro: 'O vinculo fiscal salvo nao confere. Fale com o suporte antes de tentar novamente.' });
          return resposta(200, { cadastrado: true, reutilizado: true,
            mensagem: 'Empresa ja cadastrada no emissor. Continue com a inscricao municipal.' });
        }
        const existente = await consultarEmpresaExistenteNfeio(cnpj, chave);
        if (!existente.ok) return resposta(503, { erro: 'Nao foi possivel verificar cadastros existentes no emissor. Tente novamente.' });
        if (existente.existe) return resposta(409, { erro: 'Esse CNPJ ja existe na conta do emissor. O suporte deve conferir a titularidade antes de vincular; nenhum cadastro novo foi criado.' });
        const criado = await criarEmpresaNfeio(fiscal, contaId, chave);
        if (!criado.ok) return resposta(criado.motivo === 'cadastro_incompleto' ? 400 : 502, {
          erro: criado.motivo === 'cadastro_incompleto'
            ? 'Complete razao social, CNPJ, regime e endereco fiscal antes de cadastrar a empresa.'
            : 'O emissor nao confirmou o cadastro. Confira os dados fiscais e tente novamente.'
        });
        const { data: vinculo, error: vinculoErro } = await admin.from(tabelaConfiguracoes)
          .update({ metadados: { ...fiscal, nfeio_empresa_id: criado.id, nfeio_cnpj: cnpj },
            updated_at: new Date().toISOString() })
          .eq('empresa_id', empresaId).eq('updated_at', config.updated_at)
          .select('empresa_id').maybeSingle();
        if (vinculoErro?.code === '23505') return resposta(409, { erro: 'Este CNPJ ja esta vinculado a outra empresa no Sistema OS.' });
        if (vinculoErro) throw vinculoErro;
        if (!vinculo) return resposta(409, { erro: 'Cadastro criado no emissor, mas os dados foram alterados ao mesmo tempo. Fale com o suporte para conferir o vinculo antes de repetir.' });
        return resposta(200, { cadastrado: true, mensagem: 'Empresa cadastrada no emissor em ambiente de testes. Configure a inscricao municipal para prosseguir.' });
      }

      const idExterno = texto(fiscal.nfeio_empresa_id);
      if (!idExterno) return resposta(409, { erro: 'Cadastre a empresa no emissor antes da inscricao municipal.' });
      const verificado = await verificarEmitenteNfeio(idExterno, cnpj, chave);
      if (!verificado.ok) return resposta(409, { erro: 'O CNPJ vinculado ao emissor nao confere com esta empresa.' });
      if (texto(fiscal.nfeio_im_id)) return resposta(200, { cadastrada: true, reutilizada: true,
        mensagem: 'Inscricao municipal ja cadastrada no emissor.' });
      if (verificado.inscricao_municipal_teste || verificado.inscricao_municipal_producao) {
        return resposta(409, { erro: 'Ja existe inscricao municipal no emissor. O suporte precisa conferir antes de associar; nenhuma inscricao duplicada foi criada.' });
      }
      const criada = await criarInscricaoMunicipalNfeio(idExterno, fiscal, chave);
      if (!criada.ok) return resposta(criada.motivo === 'inscricao_incompleta' ? 400 : 502, {
        erro: criada.motivo === 'inscricao_incompleta'
          ? 'Informe inscricao municipal ou dispensa, serie RPS e proximo numero informado pela prefeitura/contador.'
          : 'O emissor nao confirmou a inscricao municipal. Confira os dados antes de repetir.'
      });
      const { data: vinculada, error: vinculoErro } = await admin.from(tabelaConfiguracoes)
        .update({ metadados: { ...fiscal, nfeio_im_id: criada.id }, updated_at: new Date().toISOString() })
        .eq('empresa_id', empresaId).eq('updated_at', config.updated_at)
        .select('empresa_id').maybeSingle();
      if (vinculoErro) throw vinculoErro;
      if (!vinculada) return resposta(409, { erro: 'Inscricao criada no emissor, mas o cadastro mudou ao mesmo tempo. Fale com o suporte antes de repetir.' });
      return resposta(200, { cadastrada: true, mensagem: 'Inscricao municipal cadastrada para testes. A emissao ainda nao esta liberada.' });
    }

    if (acao === 'criar_recarga') {
      if (!fiscalDisponivel) return resposta(409, { erro: 'O teste ou a assinatura da empresa terminou. Renove o plano para adicionar saldo fiscal.' });
      if (!podeConfigurar) return resposta(403, { erro: 'Somente o administrador da empresa pode adicionar credito fiscal.' });
      const valorCentavos = Number(dados.valorCentavos);
      if (!Number.isInteger(valorCentavos) || valorCentavos < 100 || valorCentavos > 10000000) {
        return resposta(400, { erro: 'Informe uma recarga entre R$ 1,00 e R$ 100.000,00.' });
      }
      const { data: configFiscal, error: configErro } = await admin.from(tabelaConfiguracoes)
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
      const rpsSerie = texto(dados.rpsSerie).replace(/[^0-9A-Za-z._-]/g, '').slice(0, 10);
      const rpsProximoNumero = dados.rpsProximoNumero === '' || dados.rpsProximoNumero == null
        ? null : Number(dados.rpsProximoNumero);
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
      const rotaInformada = rotasValidas.has(texto(dados.rotaEmissao)) ? texto(dados.rotaEmissao) : 'nfse_nacional';
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
      if (rpsProximoNumero !== null && (!Number.isSafeInteger(rpsProximoNumero) || rpsProximoNumero < 1 || rpsProximoNumero > 999999999)) {
        return resposta(400, { erro: 'Proximo numero do RPS invalido.' });
      }
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

      const { data: configuracaoAtual, error: configuracaoAtualErro } = await admin.from(tabelaConfiguracoes)
        .select('provedor,ambiente,status,metadados,ultimo_erro').eq('empresa_id', empresaId).maybeSingle();
      if (configuracaoAtualErro) throw configuracaoAtualErro;
      const metadadosAtuais: Record<string, unknown> = configuracaoAtual?.metadados &&
        typeof configuracaoAtual.metadados === 'object' && !Array.isArray(configuracaoAtual.metadados)
        ? configuracaoAtual.metadados as Record<string, unknown>
        : {};
      // A empresa informa o cadastro, mas a passagem para produção só ocorre
      // na ação autenticada de ativação após conferência do emitente/A1.
      const rotaEmissao = suporteCadastro ? rotaInformada : texto(metadadosAtuais.rota_emissao) || 'nfse_nacional';
      const provedorFiscal = 'nfeio';
      const jaAtivaNfeio = configuracaoAtual?.provedor === 'nfeio' &&
        configuracaoAtual?.ambiente === 'producao' && configuracaoAtual?.status === 'configurada' &&
        Boolean(texto(metadadosAtuais.nfeio_empresa_id)) && Boolean(texto(metadadosAtuais.nfeio_im_id));
      const ambiente = jaAtivaNfeio ? 'producao' : 'homologacao';
      const tipoAnterior = texto(metadadosAtuais.tipo_prestador) ||
        (texto(metadadosAtuais.tipo_pessoa) === 'fisica' ? 'fisica' : 'juridica');
      const documentoAnteriorBruto = metadadosAtuais.documento_prestador || metadadosAtuais.cpf || metadadosAtuais.cnpj;
      const documentoAnterior = tipoAnterior === 'fisica'
        ? digitos(documentoAnteriorBruto, 20)
        : cnpjNormalizado(documentoAnteriorBruto);
      if (texto(metadadosAtuais.nfeio_empresa_id) && documentoAnterior !== documentoPrestador) {
        return resposta(409, { erro: 'O CNPJ de um emitente ja vinculado nao pode ser trocado. Fale com o suporte para revisar o cadastro.' });
      }
      if (texto(metadadosAtuais.nfeio_im_id) && (
        texto(metadadosAtuais.inscricao_municipal) !== inscricaoMunicipal ||
        texto(metadadosAtuais.codigo_municipio) !== codigoMunicipio ||
        texto(metadadosAtuais.uf) !== uf ||
        texto(metadadosAtuais.rps_serie) !== rpsSerie ||
        Number(metadadosAtuais.rps_proximo_numero) !== rpsProximoNumero
      )) return resposta(409, { erro: 'A inscricao municipal vinculada nao pode ser alterada por este formulario. Fale com o suporte.' });
      const rotaAnterior = texto(metadadosAtuais.rota_emissao) || 'nfse_nacional';
      const identidadeMudou = Boolean(configuracaoAtual && (
        texto(configuracaoAtual.provedor) !== 'nfeio' ||
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
      const statusConfiguracao = jaAtivaNfeio ? 'configurada' : 'nao_configurada';
      const ultimoErro = jaAtivaNfeio ? null : (completo
        ? 'Cadastro fiscal salvo. Conclua o cadastro do emitente, A1 e inscricao municipal na NFE.io.'
        : (tipoPrestador === 'fisica' && !cadastroMunicipalConfirmado
          ? 'Confirme o cadastro municipal da pessoa fisica e complete os dados da NFS-e.'
          : 'Complete os dados fiscais da empresa antes de solicitar uma nota.'));
      const { data: configuracao, error } = await admin.from(tabelaConfiguracoes).upsert({
        empresa_id: empresaId,
        provedor: 'nfeio',
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
          rps_serie: rpsSerie || null,
          rps_proximo_numero: rpsProximoNumero,
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
          certificado_a1_sandbox_em: null,
          certificado_a1_sandbox_valido_ate: null,
          tipo_emitente_produtos: tipoEmitenteProdutos,
          documento_emitente_produtos: documentoEmitenteProdutos || null,
          produtor_rural: produtorRural,
          inscricao_estadual: inscricaoEstadual || null
        },
        ultimo_erro: ultimoErro,
        updated_at: new Date().toISOString()
      }, { onConflict: 'empresa_id' }).select('empresa_id,provedor,ambiente,status,emissao_automatica_os,emissao_automatica_venda,emissao_automatica_assinatura,metadados,ultimo_erro,updated_at').single();
      if (error?.code === '23505') return resposta(409, {
        erro: 'Este CPF/CNPJ de emitente já está vinculado a outra conta. Fale com o suporte.'
      });
      if (error) throw error;
      if (suporteCadastro) {
        const { error: auditoriaErro } = await admin.from('auditoria_comercial').insert({
          empresa_id: plataformaFiscal ? null : empresaId, autor_id: autenticacao.user.id,
          acao: 'cadastro_fiscal_atualizado_suporte', entidade: 'empresa', entidade_id: empresaId,
          metadados: { ambiente, status: statusConfiguracao, tipo_prestador: tipoPrestador,
            tipo_emitente_produtos: tipoEmitenteProdutos, identidade_mudou: identidadeMudou }
        });
        if (auditoriaErro) console.error('[fiscal-documentos] Auditoria de suporte indisponivel', auditoriaErro.message);
      }
      return resposta(200, {
        configuracao,
        mensagem: completo
          ? (jaAtivaNfeio ? 'Dados da NFS-e atualizados. O emissor continua ativo.' : 'Dados da NFS-e salvos. Conclua a ativacao NFE.io para emitir.')
          : 'Dados da NFS-e salvos. Complete os campos pendentes antes da ativacao.'
      });
    }

    if (acao === 'cadastrar_certificado_a1') {
      if (!podeConfigurar) return resposta(403, { erro: 'Somente o administrador da empresa ou Administrador Geral pode enviar o A1.' });
      const chave = texto(Deno.env.get('NFEIO_INVOICE_KEY'));
      if (!chave) return resposta(503, { erro: 'Integracao fiscal ainda nao configurada no servidor.' });
      const { data: config, error: configErro } = await admin.from(tabelaConfiguracoes)
        .select('metadados,updated_at').eq('empresa_id', empresaId).maybeSingle();
      if (configErro) throw configErro;
      const fiscal = config?.metadados || {};
      const cnpj = digitos(fiscal.cnpj, 14);
      const idExterno = texto(fiscal.nfeio_empresa_id);
      if (!cnpjValido(cnpj) || !idExterno) return resposta(409, { erro: 'Cadastre a empresa no emissor antes de enviar o A1.' });
      const verificado = await verificarEmitenteNfeio(idExterno, cnpj, chave);
      if (!verificado.ok) return resposta(409, { erro: 'O CNPJ do emitente nao confere com o emissor.' });
      const base64 = texto(dados.certificadoBase64);
      // Senhas de certificados podem conter espaços no início/fim; não normalize.
      const senha = typeof dados.senha === 'string' ? dados.senha : '';
      if (!/^[A-Za-z0-9+/=]+$/.test(base64) || base64.length > 720000 || !senha) {
        return resposta(400, { erro: 'Arquivo A1 ou senha invalidos.' });
      }
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(base64), (caractere) => caractere.charCodeAt(0)); }
      catch (_) { return resposta(400, { erro: 'Arquivo A1 invalido.' }); }
      const enviado = await enviarCertificadoNfeio(idExterno, cnpj, bytes, senha, chave);
      bytes.fill(0);
      if (!enviado.ok) return resposta(502, { erro: 'O emissor nao confirmou o A1. Confira se e um e-CNPJ valido dessa empresa, com senha correta.' });
      const { data: atualizado, error: atualizarErro } = await admin.from(tabelaConfiguracoes)
        .update({ metadados: { ...fiscal, nfeio_certificado_valido_ate: enviado.valido_ate },
          updated_at: new Date().toISOString() })
        .eq('empresa_id', empresaId).eq('updated_at', config.updated_at)
        .select('empresa_id').maybeSingle();
      if (atualizarErro) throw atualizarErro;
      if (!atualizado) return resposta(409, { erro: 'A1 aceito no emissor, mas o cadastro mudou ao mesmo tempo. Atualize a tela e confira o status.' });
      return resposta(200, { cadastrado: true, mensagem: 'A1 recebido e validado pelo emissor. Agora ative a inscricao municipal.' });
    }

    if (acao === 'solicitar_emissao') {
      if (!fiscalDisponivel) return resposta(409, { erro: 'O teste ou a assinatura da empresa terminou. Renove o plano para emitir notas.' });
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
      const { data: config, error: configErro } = await admin.from(tabelaConfiguracoes)
        .select('status,provedor,ambiente').eq('empresa_id', empresaId).maybeSingle();
      if (configErro) throw configErro;
      const pronta = emissorOperacional && config?.provedor === 'nfeio' &&
        config?.status === 'configurada' && config?.ambiente === 'producao';
      const status = pronta ? 'rascunho' : 'aguardando_configuracao';
      const payload = {
        tomador: dados.tomador && typeof dados.tomador === 'object' ? dados.tomador : {},
        observacoes: texto(dados.observacoes).slice(0, 1000)
      };
      const mutacao = {
        empresa_id: empresaId, origem_tipo: origemTipo, origem_id: origemId, valor,
        descricao, status, provedor: config?.provedor || 'nfeio', payload,
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
            return resposta(409, { erro: 'Saldo fiscal insuficiente. Adicione saldo antes de emitir.' });
          }
          if (/limite mensal de emissao|limite de gasto fiscal/i.test(reservaErro.message)) {
            return resposta(409, { erro: 'Seu limite mensal de notas ou de uso do saldo fiscal foi atingido. Fale com o administrador da empresa.' });
          }
          throw reservaErro;
        }
        return resposta(200, { nota: { ...nota, status: 'na_fila' }, reserva,
          mensagem: 'Valor da NFS-e reservado na carteira e pedido adicionado a fila de emissao.' });
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
        .select('id,status,numero,chave_acesso,codigo_verificacao,pdf_url,danfse_url,danfse_storage_path,danfse_gerado_em')
        .eq('id', id).eq('empresa_id', empresaId).maybeSingle();
      if (error) throw error;
      if (!nota) return resposta(404, { erro: 'NFS-e nao encontrada.' });
      if (nota.status !== 'autorizada') {
        return resposta(409, { erro: 'O DANFSe so fica disponivel depois que a NFS-e e autorizada.' });
      }
      if (!texto(nota.chave_acesso) && !texto(nota.codigo_verificacao)) {
        return resposta(409, { erro: 'Documento sem chave de acesso ou codigo de verificacao confirmado pelo emissor.' });
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

    if (acao === 'solicitar_cancelamento') {
      if (!podeCancelar) return resposta(403, { erro: 'Seu usuário não pode cancelar documentos fiscais.' });
      const id = texto(dados.id);
      const justificativa = texto(dados.justificativa).replace(/[\r\n\t]+/g, ' ').slice(0, 255);
      if (!id || justificativa.length < 15) {
        return resposta(400, { erro: 'Informe uma justificativa de cancelamento com pelo menos 15 caracteres.' });
      }
      const { data: existente, error: consultaErro } = await admin.from('notas_fiscais')
        .select('id,status,payload,updated_at').eq('id', id).eq('empresa_id', empresaId).maybeSingle();
      if (consultaErro) throw consultaErro;
      if (!existente) return resposta(404, { erro: 'NFS-e nao encontrada.' });
      if (existente.status === 'cancelada') {
        return resposta(200, { nota: { id, status: 'cancelada' }, reutilizada: true,
          mensagem: 'Esta NFS-e ja foi cancelada.' });
      }
      if (existente.status !== 'autorizada') {
        return resposta(409, { erro: 'Somente uma NFS-e autorizada pode ser cancelada no emissor.' });
      }
      if (existente.payload?.cancelamento?.solicitado_em) {
        return resposta(200, { nota: { id, status: 'autorizada' }, reutilizada: true,
          mensagem: 'O cancelamento ja foi enviado e aguarda confirmacao da prefeitura.' });
      }
      const payload = {
        ...(existente.payload || {}),
        cancelamento: {
          solicitado_em: new Date().toISOString(),
          solicitado_por: autenticacao.user.id,
          justificativa
        },
        processamento: {
          ...(existente.payload?.processamento || {}),
          proxima_tentativa_em: null
        }
      };
      const { data: nota, error } = await admin.from('notas_fiscais')
        .update({ payload, ultimo_erro: null, updated_at: new Date().toISOString() })
        .eq('id', id).eq('empresa_id', empresaId).eq('status', 'autorizada')
        .eq('updated_at', existente.updated_at).select('id,status').maybeSingle();
      if (error) throw error;
      if (!nota) return resposta(409, { erro: 'A NFS-e foi alterada simultaneamente. Atualize e tente novamente.' });
      return resposta(200, { nota, mensagem: 'Cancelamento enviado para a fila. O status so mudara apos confirmacao do emissor.' });
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
  } catch (_) {
    // Erros do provedor/banco podem conter dados fiscais ou cabeçalhos de autenticação.
    console.error('[fiscal-documentos] operacao indisponivel');
    return resposta(500, { erro: 'Nao foi possivel concluir a operacao fiscal agora.' });
  }
});
