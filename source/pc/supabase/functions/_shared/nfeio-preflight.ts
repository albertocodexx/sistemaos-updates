const normalizarDocumento = (valor: unknown) => String(valor ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

export async function verificarEmitenteNfeio(
  idExterno: string,
  cnpjEsperado: string,
  chave: string,
  consultar: typeof fetch = fetch
) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(idExterno) || !/^[0-9A-Z]{14}$/.test(cnpjEsperado)) {
    return { ok: false, motivo: 'identificacao_invalida' };
  }
  if (!chave) return { ok: false, motivo: 'credencial_indisponivel' };

  const consultarJson = async (caminho: string) => {
    const resposta = await consultar(`https://api.nfse.io/v2/companies/${encodeURIComponent(idExterno)}${caminho}`, {
      method: 'GET',
      headers: { Authorization: chave, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!resposta.ok) return { erro: resposta.status };
    return { dados: await resposta.json() };
  };

  const empresa = await consultarJson('');
  if (empresa.erro) return { ok: false, motivo: 'consulta_empresa_falhou', codigo: empresa.erro };
  const cadastro = empresa.dados?.Company || empresa.dados?.company;
  if (!cadastro || normalizarDocumento(cadastro.FederalTaxNumber ?? cadastro.federalTaxNumber) !== cnpjEsperado) {
    return { ok: false, motivo: 'cnpj_divergente' };
  }
  if (String(cadastro.Status ?? cadastro.status).toLowerCase() !== 'active') {
    return { ok: false, motivo: 'empresa_inativa' };
  }

  const [municipais, estaduais] = await Promise.all([
    consultarJson('/municipaltaxes?limit=50'),
    consultarJson('/statetaxes?limit=50')
  ]);
  if (municipais.erro || estaduais.erro) {
    return { ok: false, motivo: 'consulta_inscricoes_falhou', codigo: municipais.erro || estaduais.erro };
  }
  const inscricoesMunicipais = municipais.dados?.municipalTaxes || municipais.dados?.MunicipalTaxes || [];
  const inscricoesEstaduais = estaduais.dados?.stateTaxes || estaduais.dados?.StateTaxes || [];
  if (!Array.isArray(inscricoesMunicipais) || !Array.isArray(inscricoesEstaduais)) {
    return { ok: false, motivo: 'resposta_inesperada' };
  }
  const ativa = (item: Record<string, unknown>) => String(item.Status ?? item.status).toLowerCase() === 'active';
  const desenvolvimento = inscricoesMunicipais.some((item) => ativa(item) &&
    String(item.Environment ?? item.environment).toLowerCase() === 'development');
  const producao = inscricoesMunicipais.some((item) => ativa(item) &&
    String(item.Environment ?? item.environment).toLowerCase() === 'production');
  return {
    ok: true,
    cnpj_confere: true,
    inscricao_municipal_teste: desenvolvimento,
    inscricao_municipal_producao: producao,
    inscricao_estadual_ativa: inscricoesEstaduais.some(ativa),
    emissao_liberada: false
  };
}
