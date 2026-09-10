import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { contextoUsuarioAtivo, licencaPermiteOperacao, temPermissao } from '../_shared/access.ts';

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
const cnpjValido = (valor: string) => /^[0-9A-Z]{12}\d{2}$/.test(valor);
const decimalOpcional = (valor: unknown) => {
  const bruto = texto(valor).replace(',', '.');
  if (!bruto) return null;
  const numero = Number(bruto);
  return Number.isFinite(numero) && numero >= 0 && numero <= 100 ? numero : null;
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
    const { data: contextoConsulta, error: contextoErro } = await cliente.rpc('obter_contexto_comercial');
    const contexto = Array.isArray(contextoConsulta) ? contextoConsulta[0] : contextoConsulta;
    if (contextoErro || !contexto?.empresa_id || contexto.administrador_global ||
        !contextoUsuarioAtivo(contexto) || !licencaPermiteOperacao(contexto)) {
      return resposta(403, { erro: 'Entre em uma empresa para usar a NFS-e.' });
    }

    const corpo = await req.json().catch(() => ({}));
    const acao = texto(corpo.acao);
    const dados = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
    const empresaId = contexto.empresa_id;
    if (contexto.recursos_habilitados?.fiscal_habilitado !== true) {
      return resposta(403, { erro: 'A emissão de NFS-e ainda não está liberada para esta empresa.' });
    }
    const podeConfigurar = temPermissao(contexto, 'configuracoes', 'editar');
    const podeLerFinanceiro = temPermissao(contexto, 'financeiro', 'ler');
    const podeEmitir = temPermissao(contexto, 'financeiro', 'criar') ||
      temPermissao(contexto, 'financeiro', 'editar');
    const podeCancelar = temPermissao(contexto, 'financeiro', 'editar');

    if (acao === 'resumo' || acao === 'listar') {
      if (!podeLerFinanceiro) return resposta(403, { erro: 'Seu usuário não pode consultar documentos fiscais.' });
      const [configConsulta, notasConsulta] = await Promise.all([
        admin.from('configuracoes_fiscais').select('empresa_id,provedor,ambiente,status,emissao_automatica_os,emissao_automatica_venda,emissao_automatica_assinatura,metadados,ultimo_erro,updated_at').eq('empresa_id', empresaId).maybeSingle(),
        admin.from('notas_fiscais').select('id,origem_tipo,origem_id,valor,descricao,status,numero,codigo_verificacao,chave_acesso,url_consulta,pdf_url,danfse_url,danfse_storage_path,danfse_gerado_em,emitida_em,ultimo_erro,created_at').eq('empresa_id', empresaId).order('created_at', { ascending: false }).limit(50)
      ]);
      if (configConsulta.error) throw configConsulta.error;
      if (notasConsulta.error) throw notasConsulta.error;
      return resposta(200, { configuracao: configConsulta.data, notas: notasConsulta.data || [] });
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
      if (tipoPessoa === 'fisica' && documentoPrestador && !cpfValido(cpf)) return resposta(400, { erro: 'CPF do prestador invalido.' });
      if (tipoPessoa === 'juridica' && cnpj && !cnpjValido(cnpj)) {
        return resposta(400, { erro: 'CNPJ invalido. Informe 14 caracteres; os dois ultimos devem ser numericos.' });
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
          provedor_fiscal: provedorFiscal || null
        },
        ultimo_erro: ultimoErro,
        updated_at: new Date().toISOString()
      }, { onConflict: 'empresa_id' }).select('empresa_id,provedor,ambiente,status,emissao_automatica_os,emissao_automatica_venda,emissao_automatica_assinatura,metadados,ultimo_erro,updated_at').single();
      if (error) throw error;
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
      if (!['os', 'venda', 'compra', 'avulsa'].includes(origemTipo) || !origemId ||
          !Number.isFinite(valor) || valor <= 0 || !descricao) {
        return resposta(400, { erro: 'Informe documento, valor e descricao validos.' });
      }
      const { data: existente, error: existenteErro } = await admin.from('notas_fiscais')
        .select('id,origem_tipo,origem_id,valor,descricao,status,numero,chave_acesso,url_consulta,pdf_url,danfse_url,danfse_storage_path,danfse_gerado_em,created_at')
        .eq('empresa_id', empresaId).eq('origem_tipo', origemTipo).eq('origem_id', origemId).maybeSingle();
      if (existenteErro) throw existenteErro;
      if (existente?.status === 'autorizada') {
        return resposta(200, { nota: existente, reutilizada: true, mensagem: 'Esta NFS-e ja foi autorizada. O DANFSe continua disponivel no historico.' });
      }
      const { data: config, error: configErro } = await admin.from('configuracoes_fiscais')
        .select('status,provedor').eq('empresa_id', empresaId).maybeSingle();
      if (configErro) throw configErro;
      const status = config?.status === 'configurada' ? 'na_fila' : 'aguardando_configuracao';
      const payload = {
        tomador: dados.tomador && typeof dados.tomador === 'object' ? dados.tomador : {},
        observacoes: texto(dados.observacoes).slice(0, 1000)
      };
      const { data: nota, error } = await admin.from('notas_fiscais').upsert({
        empresa_id: empresaId, origem_tipo: origemTipo, origem_id: origemId, valor,
        descricao, status, provedor: config?.provedor || 'nfse_nacional', payload,
        ultimo_erro: status === 'aguardando_configuracao' ? 'Configure os dados da NFS-e e conclua a ativacao fiscal.' : null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'empresa_id,origem_tipo,origem_id' })
        .select('id,origem_tipo,origem_id,valor,descricao,status,numero,url_consulta,pdf_url,created_at').single();
      if (error) throw error;
      return resposta(200, { nota, mensagem: status === 'na_fila'
        ? 'NFS-e adicionada a fila de emissao.'
        : 'Solicitacao de NFS-e salva. Conclua a ativacao fiscal para autoriza-la.' });
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
        .in('status', ['rascunho', 'aguardando_configuracao', 'na_fila'])
        .select('id,status').maybeSingle();
      if (error) throw error;
      if (!nota) return resposta(409, { erro: 'Esta NFS-e ja foi processada e nao pode ser cancelada por aqui.' });
      return resposta(200, { nota, mensagem: 'Solicitacao de NFS-e cancelada.' });
    }

    return resposta(400, { erro: 'Acao nao reconhecida.' });
  } catch (erro) {
    console.error('[fiscal-documentos]', erro);
    return resposta(500, { erro: 'Nao foi possivel concluir a operacao fiscal agora.' });
  }
});
