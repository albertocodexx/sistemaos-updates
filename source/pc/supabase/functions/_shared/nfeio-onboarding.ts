type Cadastro = Record<string, unknown>;
type Consulta = typeof fetch;

const documento = (valor: unknown) => String(valor ?? '').replace(/\D/g, '');
const texto = (valor: unknown) => String(valor ?? '').trim();
const idValido = (valor: string) => /^[A-Za-z0-9_-]{8,100}$/.test(valor);

async function requisitar(caminho: string, metodo: 'GET' | 'POST' | 'PUT', chave: string,
  corpo?: Record<string, unknown> | FormData, consultar: Consulta = fetch) {
  if (!chave) return { ok: false, motivo: 'credencial_indisponivel' };
  const multipart = corpo instanceof FormData;
  const headers: Record<string, string> = { Authorization: chave, Accept: 'application/json' };
  if (corpo && !multipart) headers['Content-Type'] = 'application/json';
  try {
    const resposta = await consultar(`https://api.nfse.io${caminho}`, {
      method: metodo, headers, body: corpo ? (multipart ? corpo : JSON.stringify(corpo)) : undefined,
      signal: AbortSignal.timeout(15000)
    });
    if (!resposta.ok) return { ok: false, motivo: 'provedor_recusou', codigo: resposta.status };
    return { ok: true, dados: await resposta.json() };
  } catch (_) {
    // Nunca registrar payload, chave, certificado ou senha em logs.
    return { ok: false, motivo: 'provedor_indisponivel' };
  }
}

export function montarEmpresaNfeio(cadastro: Cadastro, contaId: string) {
  const cnpj = documento(cadastro.cnpj);
  const nome = texto(cadastro.nome_prestador);
  const cep = documento(cadastro.cep_prestador);
  const codigoMunicipio = documento(cadastro.codigo_municipio);
  const uf = texto(cadastro.uf).toUpperCase();
  const regimes: Record<string, string> = {
    mei: 'MicroempreendedorIndividual', simples_nacional: 'SimplesNacional',
    lucro_presumido: 'LucroPresumido', lucro_real: 'LucroReal'
  };
  const regime = regimes[texto(cadastro.regime_tributario)];
  if (!/^\d{14}$/.test(cnpj) || nome.length < 2 || nome.length > 60 || cep.length !== 8 ||
      codigoMunicipio.length !== 7 || !/^[A-Z]{2}$/.test(uf) || !regime ||
      texto(cadastro.logradouro_prestador).length < 5 || texto(cadastro.bairro_prestador).length < 2 ||
      !texto(cadastro.numero_prestador) || !texto(cadastro.municipio_nome) || !idValido(contaId)) {
    return null;
  }
  return { Company: {
    AccountId: contaId,
    Name: nome, TradeName: texto(cadastro.nome_fantasia) || nome,
    FederalTaxNumber: cnpj, TaxRegime: regime,
    Address: {
      State: uf, City: { Code: codigoMunicipio, Name: texto(cadastro.municipio_nome) },
      District: texto(cadastro.bairro_prestador), Street: texto(cadastro.logradouro_prestador),
      Number: texto(cadastro.numero_prestador),
      AdditionalInformation: texto(cadastro.complemento_prestador) || undefined,
      PostalCode: cep, Country: 'BRA'
    }
  } };
}

export async function criarEmpresaNfeio(cadastro: Cadastro, contaId: string, chave: string,
  consultar: Consulta = fetch) {
  const corpo = montarEmpresaNfeio(cadastro, contaId);
  if (!corpo) return { ok: false, motivo: 'cadastro_incompleto' };
  const retorno = await requisitar('/v2/companies', 'POST', chave, corpo, consultar);
  if (!retorno.ok) return retorno;
  const empresa = retorno.dados?.Company || retorno.dados?.company;
  const id = texto(empresa?.Id ?? empresa?.id);
  if (!idValido(id) || documento(empresa?.FederalTaxNumber ?? empresa?.federalTaxNumber) !== corpo.Company.FederalTaxNumber) {
    return { ok: false, motivo: 'resposta_inesperada' };
  }
  return { ok: true, id };
}

export async function consultarEmpresaExistenteNfeio(cnpj: string, chave: string,
  consultar: Consulta = fetch) {
  if (!/^\d{14}$/.test(cnpj)) return { ok: false, motivo: 'cnpj_invalido' };
  let cursor = '';
  for (let pagina = 0; pagina < 20; pagina += 1) {
    const caminho = `/v2/companies?limit=50${cursor ? `&startingAfter=${encodeURIComponent(cursor)}` : ''}`;
    const retorno = await requisitar(caminho, 'GET', chave, undefined, consultar);
    if (!retorno.ok) return retorno;
    const lista = retorno.dados?.companies ?? retorno.dados?.Companies;
    if (!Array.isArray(lista)) return { ok: false, motivo: 'resposta_inesperada' };
    if (lista.some((item) => documento(item.FederalTaxNumber ?? item.federalTaxNumber) === cnpj)) {
      return { ok: true, existe: true };
    }
    if (retorno.dados?.hasMore !== true && retorno.dados?.HasMore !== true) {
      return { ok: true, existe: false };
    }
    const proximo = texto(lista.at(-1)?.Id ?? lista.at(-1)?.id);
    if (!idValido(proximo) || proximo === cursor) return { ok: false, motivo: 'paginacao_invalida' };
    cursor = proximo;
  }
  return { ok: false, motivo: 'paginacao_incompleta' };
}

export async function criarInscricaoMunicipalNfeio(id: string, cadastro: Cadastro,
  chave: string, consultar: Consulta = fetch) {
  const serie = texto(cadastro.rps_serie);
  const proximo = Number(cadastro.rps_proximo_numero);
  const codigo = documento(cadastro.codigo_municipio);
  const uf = texto(cadastro.uf).toUpperCase();
  const inscricao = texto(cadastro.inscricao_municipal);
  if (!idValido(id) || codigo.length !== 7 || !/^[A-Z]{2}$/.test(uf) ||
      !texto(cadastro.municipio_nome) || !/^[A-Za-z0-9._-]{1,10}$/.test(serie) ||
      !Number.isSafeInteger(proximo) || proximo < 1 || proximo > 999999999 ||
      (!inscricao && cadastro.inscricao_municipal_dispensada !== true)) {
    return { ok: false, motivo: 'inscricao_incompleta' };
  }
  const corpo = { MunicipalTax: {
    City: { Code: codigo, Name: texto(cadastro.municipio_nome), State: uf, Country: 'BRA' },
    TaxNumber: inscricao || undefined, Environment: 'Development',
    RpsSerialNumber: serie, RpsNumber: proximo, LastRpsSent: proximo - 1
  } };
  const retorno = await requisitar(`/v2/companies/${encodeURIComponent(id)}/municipaltaxes`,
    'POST', chave, corpo, consultar);
  if (!retorno.ok) return retorno;
  const municipal = retorno.dados?.MunicipalTax || retorno.dados?.municipalTax;
  const municipalId = texto(municipal?.Id ?? municipal?.id);
  if (!idValido(municipalId)) return { ok: false, motivo: 'resposta_inesperada' };
  return { ok: true, id: municipalId };
}

export async function ativarInscricaoMunicipalNfeio(empresaId: string, inscricaoId: string,
  cadastro: Cadastro, credenciais: Cadastro, chave: string, consultar: Consulta = fetch) {
  if (!idValido(empresaId) || !idValido(inscricaoId)) return { ok: false, motivo: 'identificacao_invalida' };
  const caminho = `/v2/companies/${encodeURIComponent(empresaId)}/municipaltaxes/${encodeURIComponent(inscricaoId)}`;
  const atual = await requisitar(caminho, 'GET', chave, undefined, consultar);
  if (!atual.ok) return atual;
  const im = atual.dados?.MunicipalTax || atual.dados?.municipalTax;
  const numero = texto(im?.TaxNumber ?? im?.taxNumber);
  const municipio = documento(im?.City?.Code ?? im?.city?.code);
  const serie = texto(im?.RpsSerialNumber ?? im?.rpsSerialNumber);
  const status = texto(im?.Status ?? im?.status).toLowerCase();
  const fiscalStatus = texto(im?.FiscalStatus ?? im?.fiscalStatus).toLowerCase();
  if (texto(im?.CompanyId ?? im?.companyId) !== empresaId ||
      texto(im?.Id ?? im?.id) !== inscricaoId ||
      municipio !== documento(cadastro.codigo_municipio) ||
      numero !== texto(cadastro.inscricao_municipal) ||
      serie !== texto(cadastro.rps_serie)) return { ok: false, motivo: 'inscricao_divergente' };
  if (status !== 'active' || fiscalStatus !== 'active') return { ok: false, motivo: 'municipio_indisponivel' };
  if (texto(im?.Environment ?? im?.environment).toLowerCase() === 'production') {
    return { ok: true, ja_ativa: true };
  }
  const login = texto(credenciais.loginName);
  const senha = texto(credenciais.loginPassword);
  const autorizacao = texto(credenciais.authIssueValue);
  if (login.length > 160 || senha.length > 256 || autorizacao.length > 256) {
    return { ok: false, motivo: 'credenciais_invalidas' };
  }
  const corpo = { MunicipalTax: {
    Environment: 'Production',
    ...(login ? { LoginName: login } : {}),
    ...(senha ? { LoginPassword: senha } : {}),
    ...(autorizacao ? { AuthIssueValue: autorizacao } : {})
  } };
  const alterada = await requisitar(caminho, 'PUT', chave, corpo, consultar);
  if (!alterada.ok) return alterada;
  const confirmada = alterada.dados?.MunicipalTax || alterada.dados?.municipalTax;
  if (texto(confirmada?.Id ?? confirmada?.id) !== inscricaoId ||
      texto(confirmada?.CompanyId ?? confirmada?.companyId) !== empresaId ||
      texto(confirmada?.Environment ?? confirmada?.environment).toLowerCase() !== 'production' ||
      texto(confirmada?.Status ?? confirmada?.status).toLowerCase() !== 'active') {
    return { ok: false, motivo: 'ativacao_nao_confirmada' };
  }
  return { ok: true, ja_ativa: false };
}

export async function enviarCertificadoNfeio(id: string, cnpj: string, arquivo: Uint8Array,
  senha: string, chave: string, consultar: Consulta = fetch) {
  if (!idValido(id) || !/^\d{14}$/.test(cnpj) || arquivo.length < 100 || arquivo.length > 512 * 1024 ||
      arquivo[0] !== 0x30 || !senha || senha.length > 256) {
    return { ok: false, motivo: 'certificado_invalido' };
  }
  const formulario = new FormData();
  formulario.set('File', new File([arquivo], 'certificado.pfx', { type: 'application/x-pkcs12' }));
  formulario.set('Password', senha);
  const retorno = await requisitar(`/v2/companies/${encodeURIComponent(id)}/certificates`,
    'POST', chave, formulario, consultar);
  if (!retorno.ok) return retorno;
  const certificado = retorno.dados?.Certificate || retorno.dados?.certificate;
  const validoAte = texto(certificado?.ValidUntil ?? certificado?.validUntil);
  if (documento(certificado?.TaxId ?? certificado?.taxId) !== cnpj ||
      texto(certificado?.Status ?? certificado?.status).toLowerCase() !== 'active' ||
      !Number.isFinite(Date.parse(validoAte)) || Date.parse(validoAte) <= Date.now()) {
    return { ok: false, motivo: 'certificado_nao_confirmado' };
  }
  return { ok: true, valido_ate: validoAte };
}
