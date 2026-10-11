type Registro = Record<string, any>;
type Consulta = typeof fetch;
export type TipoDocumentoProduto = 'nfe' | 'nfce';

const texto = (valor: unknown) => String(valor ?? '').trim();
const digitos = (valor: unknown) => texto(valor).replace(/\D/g, '');
const dinheiro = (valor: unknown) => {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 && numero <= 9999999999.99
    ? Math.round(numero * 100) / 100 : null;
};
const idValido = (valor: string) => /^[A-Za-z0-9_-]{8,100}$/.test(valor);
const endpoint = (tipo: TipoDocumentoProduto) => tipo === 'nfe' ? 'productinvoices' : 'consumerinvoices';

function endereco(enderecoBruto: Registro) {
  const estado = texto(enderecoBruto?.estado ?? enderecoBruto?.state).toUpperCase();
  const codigoCidade = digitos(enderecoBruto?.codigo_municipio ?? enderecoBruto?.city?.code);
  const cep = digitos(enderecoBruto?.cep ?? enderecoBruto?.postalCode);
  const nomeCidade = texto(enderecoBruto?.municipio ?? enderecoBruto?.city?.name);
  const bairro = texto(enderecoBruto?.bairro ?? enderecoBruto?.district);
  const rua = texto(enderecoBruto?.logradouro ?? enderecoBruto?.street);
  const numero = texto(enderecoBruto?.numero ?? enderecoBruto?.number);
  if (!/^[A-Z]{2}$/.test(estado) || codigoCidade.length !== 7 || cep.length !== 8 ||
      !nomeCidade || !bairro || !rua || !numero) return null;
  return { state: estado, city: { code: codigoCidade, name: nomeCidade }, district: bairro,
    street: rua, number: numero, postalCode: cep, country: 'BRA',
    ...(texto(enderecoBruto?.complemento ?? enderecoBruto?.additionalInformation)
      ? { additionalInformation: texto(enderecoBruto?.complemento ?? enderecoBruto?.additionalInformation) } : {}) };
}

function comprador(bruto: Registro, obrigatorio: boolean) {
  const documento = digitos(bruto?.documento ?? bruto?.cpfCnpj ?? bruto?.federalTaxNumber);
  const nome = texto(bruto?.nome ?? bruto?.name).slice(0, 160);
  if (!documento && !nome && !obrigatorio) return undefined;
  const enderecoFiscal = endereco(bruto?.endereco || bruto?.address || {});
  if (![11, 14].includes(documento.length) || nome.length < 2 || !enderecoFiscal) return null;
  return { name: nome, federalTaxNumber: documento, address: enderecoFiscal,
    ...(texto(bruto?.email) ? { email: texto(bruto.email).slice(0, 180) } : {}) };
}

function itemProduto(item: Registro, indice: number) {
  const quantidade = Number(item?.quantidade ?? item?.quantity);
  const valorUnitario = dinheiro(item?.valor_unitario ?? item?.unitAmount);
  const ncm = digitos(item?.ncm);
  const cfop = digitos(item?.cfop);
  const unidade = texto(item?.unidade ?? item?.unit).toUpperCase();
  const origem = texto(item?.origem ?? item?.tax?.icms?.origin);
  const cst = texto(item?.cst_icms ?? item?.tax?.icms?.cst);
  const csosn = texto(item?.csosn ?? item?.tax?.icms?.csosn);
  const pisCst = texto(item?.cst_pis ?? item?.tax?.pis?.cst);
  const cofinsCst = texto(item?.cst_cofins ?? item?.tax?.cofins?.cst);
  if (!Number.isFinite(quantidade) || quantidade <= 0 || quantidade > 999999999 ||
      valorUnitario === null || valorUnitario <= 0 || !/^\d{8}$/.test(ncm) ||
      !/^\d{4}$/.test(cfop) || !/^[A-Z0-9]{1,6}$/.test(unidade) ||
      !/^[0-8]$/.test(origem) || (!/^\d{2}$/.test(cst) && !/^\d{3}$/.test(csosn)) ||
      !/^\d{2}$/.test(pisCst) || !/^\d{2}$/.test(cofinsCst)) return null;
  const base = dinheiro(item?.base_icms ?? item?.tax?.icms?.baseTax) ?? 0;
  const aliquota = dinheiro(item?.aliquota_icms ?? item?.tax?.icms?.rate) ?? 0;
  const valorIcms = dinheiro(item?.valor_icms ?? item?.tax?.icms?.amount) ?? 0;
  return {
    code: texto(item?.codigo ?? item?.code) || `ITEM-${indice + 1}`,
    description: texto(item?.descricao ?? item?.description).slice(0, 120), ncm, cfop,
    unit: unidade, quantity: quantidade, unitAmount: valorUnitario,
    ...(digitos(item?.cest) ? { cest: digitos(item.cest) } : {}),
    tax: {
      icms: { origin: origem, ...(cst ? { cst } : { csosn }), baseTax: base, rate: aliquota, amount: valorIcms },
      pis: { cst: pisCst, baseTax: dinheiro(item?.base_pis) ?? 0,
        rate: dinheiro(item?.aliquota_pis) ?? 0, amount: dinheiro(item?.valor_pis) ?? 0 },
      cofins: { cst: cofinsCst, baseTax: dinheiro(item?.base_cofins) ?? 0,
        rate: dinheiro(item?.aliquota_cofins) ?? 0, amount: dinheiro(item?.valor_cofins) ?? 0 }
    }
  };
}

export function montarDocumentoProdutoNfeio(nota: Registro, tipo: TipoDocumentoProduto,
  homologacao = false) {
  const bruto = nota?.payload || {};
  const itensBrutos = Array.isArray(bruto.itens) ? bruto.itens : [];
  const itens = itensBrutos.map(itemProduto);
  if (!itens.length || itens.some((item) => !item || !item.description)) {
    return { ok: false, motivo: 'itens_fiscais_incompletos' } as const;
  }
  const buyer = comprador(bruto.tomador || bruto.comprador || {}, tipo === 'nfe');
  if (buyer === null) return { ok: false, motivo: 'destinatario_incompleto' } as const;
  const pagamento = Array.isArray(bruto.pagamentos) ? bruto.pagamentos.map((p: Registro) => ({
    method: texto(p.metodo ?? p.method), amount: dinheiro(p.valor ?? p.amount)
  })).filter((p: Registro) => p.method && p.amount !== null && p.amount > 0) : [];
  const corpo: Registro = {
    id: texto(nota.id), purposeType: 'Normal',
    operationType: texto(bruto.tipo_operacao).toLowerCase() === 'entrada' ? 'Incoming' : 'Outgoing',
    operationNature: texto(bruto.natureza_operacao) || (homologacao
      ? 'EMISSAO EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : 'Venda de mercadoria'),
    items: itens,
    ...(buyer ? { buyer } : {}),
    ...(pagamento.length ? { payment: { paymentDetail: pagamento } } : {}),
    additionalInformation: {
      taxpayer: homologacao
        ? 'DOCUMENTO EMITIDO EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
        : texto(bruto.observacoes).slice(0, 2000)
    }
  };
  return { ok: true, corpo } as const;
}

async function requisitarJson(caminho: string, metodo: 'GET' | 'POST' | 'DELETE', chave: string,
  corpo?: Registro, consultar: Consulta = fetch) {
  try {
    const resposta = await consultar(`https://api.nfse.io${caminho}`, {
      method: metodo, headers: { Authorization: chave, Accept: 'application/json',
        ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(20000)
    });
    if (!resposta.ok) return { ok: false, codigo: resposta.status,
      motivo: resposta.status === 404 ? 'nao_encontrada' : 'provedor_recusou' };
    if (resposta.status === 204) return { ok: true, dados: {} };
    return { ok: true, dados: await resposta.json().catch(() => ({})) };
  } catch (_) { return { ok: false, motivo: 'provedor_indisponivel' }; }
}

export async function emitirDocumentoProdutoNfeio(empresaId: string, inscricaoId: string,
  nota: Registro, tipo: TipoDocumentoProduto, chave: string, homologacao = false,
  consultar: Consulta = fetch) {
  if (!idValido(empresaId) || !idValido(inscricaoId)) return { ok: false, motivo: 'identificacao_invalida' };
  const payload = montarDocumentoProdutoNfeio(nota, tipo, homologacao);
  if (!payload.ok) return payload;
  const caminho = `/v2/companies/${encodeURIComponent(empresaId)}/statetaxes/${encodeURIComponent(inscricaoId)}/${endpoint(tipo)}`;
  const retorno = await requisitarJson(caminho, 'POST', chave, payload.corpo, consultar);
  if (!retorno.ok) return retorno;
  const documento = retorno.dados?.ProductInvoice ?? retorno.dados?.ConsumerInvoice ?? retorno.dados;
  const id = texto(documento?.id ?? documento?.Id ?? nota.id);
  return idValido(id) ? { ok: true, id, dados: documento } : { ok: false, motivo: 'resposta_inesperada' };
}

export async function consultarDocumentoProdutoNfeio(empresaId: string, emissaoId: string,
  tipo: TipoDocumentoProduto, chave: string, consultar: Consulta = fetch) {
  if (!idValido(empresaId) || !idValido(emissaoId)) return { ok: false, motivo: 'identificacao_invalida' };
  const retorno = await requisitarJson(`/v2/companies/${encodeURIComponent(empresaId)}/${endpoint(tipo)}/${encodeURIComponent(emissaoId)}`,
    'GET', chave, undefined, consultar);
  if (!retorno.ok) return retorno;
  return { ok: true, ...(retorno.dados?.ProductInvoice ?? retorno.dados?.ConsumerInvoice ?? retorno.dados) };
}

export function estadoDocumentoProdutoNfeio(retorno: Registro) {
  const status = texto(retorno?.currentStatus ?? retorno?.status ?? retorno?.Status).toLowerCase();
  const protocolo = Number(retorno?.protocol?.statusCode ?? retorno?.protocol?.StatusCode);
  if (protocolo === 100 || ['issued', 'issuedcontingency', 'authorized', 'autorizada'].includes(status)) return 'autorizada';
  if (['cancelled', 'canceled', 'cancelada'].includes(status)) return 'cancelada';
  if (['error', 'issueerror', 'issuedenied', 'denied', 'rejected', 'rejeitada'].includes(status)) return 'rejeitada';
  return 'processando';
}

export async function cancelarDocumentoProdutoNfeio(empresaId: string, emissaoId: string,
  tipo: TipoDocumentoProduto, chave: string, consultar: Consulta = fetch) {
  if (!idValido(empresaId) || !idValido(emissaoId)) return { ok: false, motivo: 'identificacao_invalida' };
  return requisitarJson(`/v2/companies/${encodeURIComponent(empresaId)}/${endpoint(tipo)}/${encodeURIComponent(emissaoId)}`,
    'DELETE', chave, undefined, consultar);
}

async function baixar(caminho: string, chave: string, consultar: Consulta) {
  try {
    const resposta = await consultar(`https://api.nfse.io${caminho}`, {
      headers: { Authorization: chave, Accept: 'application/pdf, application/xml, application/json' },
      signal: AbortSignal.timeout(20000)
    });
    if (!resposta.ok) return { ok: false, codigo: resposta.status };
    const tipo = texto(resposta.headers.get('content-type')).toLowerCase();
    if (tipo.includes('json')) {
      const dados = await resposta.json().catch(() => ({}));
      const url = texto(dados?.uri ?? dados?.url ?? dados?.Url);
      if (!/^https:\/\//i.test(url)) return { ok: false, codigo: 502 };
      const arquivo = await consultar(url, { signal: AbortSignal.timeout(20000) });
      return arquivo.ok ? { ok: true, bytes: new Uint8Array(await arquivo.arrayBuffer()) }
        : { ok: false, codigo: arquivo.status };
    }
    return { ok: true, bytes: new Uint8Array(await resposta.arrayBuffer()) };
  } catch (_) { return { ok: false, codigo: 503 }; }
}

export function baixarDanfeProdutoNfeio(empresaId: string, emissaoId: string, tipo: TipoDocumentoProduto,
  chave: string, consultar: Consulta = fetch) {
  return baixar(`/v2/companies/${encodeURIComponent(empresaId)}/${endpoint(tipo)}/${encodeURIComponent(emissaoId)}/pdf`, chave, consultar);
}

export function baixarXmlProdutoNfeio(empresaId: string, emissaoId: string, tipo: TipoDocumentoProduto,
  chave: string, consultar: Consulta = fetch) {
  return baixar(`/v2/companies/${encodeURIComponent(empresaId)}/${endpoint(tipo)}/${encodeURIComponent(emissaoId)}/xml`, chave, consultar);
}
