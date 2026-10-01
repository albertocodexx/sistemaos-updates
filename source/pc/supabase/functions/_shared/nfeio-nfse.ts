// Adaptador da NFS-e. A API de emissão é v1 mesmo quando o cadastro do
// emitente usa a API de Contribuintes v2. Não ativar produção sem teste real.
type Consulta = typeof fetch;
type Registro = Record<string, any>;

export function estadoNfseNfeio(retorno: Registro) {
  const status = String(retorno.status ?? '').toLowerCase();
  const fluxo = String(retorno.fluxo ?? '').toLowerCase();
  if (['cancelled', '3'].includes(status) && ['cancelled', '2'].includes(fluxo)) return 'cancelada';
  // CancelFailed é falha no cancelamento, não nota cancelada.
  if (['issued', '2'].includes(status)) return 'autorizada';
  if (['error', '-1'].includes(status) && ['issuefailed', '-1'].includes(fluxo)) return 'rejeitada';
  return 'processando';
}

const texto = (valor: unknown) => String(valor ?? '').trim();
const digitos = (valor: unknown) => texto(valor).replace(/\D/g, '');
const idValido = (valor: string) => /^[A-Za-z0-9_-]{8,100}$/.test(valor);
const uuidValido = (valor: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);

function cpfValido(valor: string) {
  if (!/^\d{11}$/.test(valor) || /^(\d)\1{10}$/.test(valor)) return false;
  const digito = (tamanho: number) => {
    const soma = [...valor.slice(0, tamanho)].reduce((total, numero, i) =>
      total + Number(numero) * (tamanho + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(valor[9]) && digito(10) === Number(valor[10]);
}

function cnpjValido(valor: string) {
  if (!/^\d{14}$/.test(valor) || /^(\d)\1{13}$/.test(valor)) return false;
  const calcular = (base: string, pesos: number[]) => {
    const resto = [...base].reduce((total, numero, i) => total + Number(numero) * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = calcular(valor.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = calcular(valor.slice(0, 12) + primeiro, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return primeiro === Number(valor[12]) && segundo === Number(valor[13]);
}

export function montarNfseNfeio(nota: Registro, fiscal: Registro) {
  const id = texto(nota.id);
  const tomador = nota.payload?.tomador || {};
  const documento = digitos(tomador.cpfCnpj || tomador.cpf || tomador.cnpj);
  const nome = texto(tomador.nome).slice(0, 160);
  const descricao = texto(nota.descricao).slice(0, 500);
  const codigo = texto(fiscal.codigo_servico_municipal || fiscal.codigo_servico);
  const valor = Number(nota.valor);
  if (!uuidValido(id) || !(cpfValido(documento) || cnpjValido(documento)) ||
      nome.length < 2 || !/^[0-9A-Za-z._-]{1,30}$/.test(codigo) || !descricao ||
      !Number.isFinite(valor) || valor <= 0 || valor > 9999999999.99 ||
      Math.abs(valor * 100 - Math.round(valor * 100)) > 0.000001) return null;

  const email = texto(tomador.email);
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) return null;
  const corpo: Registro = {
    externalId: id,
    borrower: { type: documento.length === 11 ? 'NaturalPerson' : 'LegalEntity',
      federalTaxNumber: documento, name: nome },
    cityServiceCode: codigo,
    description: descricao,
    servicesAmount: valor
  };
  if (email) corpo.borrower.email = email;
  // O cálculo tributário fica com a NFE.io/prefeitura. Não enviar alíquota
  // inventada nem incluir automaticamente o preço do produto numa NFS-e.
  return corpo;
}

async function solicitar(caminho: string, metodo: 'GET' | 'POST' | 'DELETE', chave: string,
  corpo?: Registro, consultar: Consulta = fetch) {
  if (!chave) return { ok: false, motivo: 'credencial_indisponivel' };
  try {
    const resposta = await consultar(`https://api.nfe.io${caminho}`, {
      method: metodo,
      headers: { Authorization: chave, Accept: 'application/json',
        ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(15000)
    });
    if (!resposta.ok) return { ok: false, motivo: 'provedor_recusou', codigo: resposta.status };
    const dados = resposta.status === 204 ? null : await resposta.json().catch(() => null);
    return { ok: true, codigo: resposta.status, dados,
      localizacao: texto(resposta.headers.get('location')) };
  } catch (_) {
    // Falha/timeout após POST é ambíguo: consultar externalId antes de repetir.
    // Não incluir dados fiscais, chave ou resposta do emissor nos logs.
    return { ok: false, motivo: 'resultado_desconhecido' };
  }
}

export async function consultarNfseNfeio(empresaId: string, notaId: string, chave: string,
  consultar: Consulta = fetch) {
  if (!idValido(empresaId) || !uuidValido(notaId)) return { ok: false, motivo: 'identificacao_invalida' };
  const retorno = await solicitar(`/v1/companies/${encodeURIComponent(empresaId)}/serviceinvoices/external/${encodeURIComponent(notaId)}`,
    'GET', chave, undefined, consultar);
  if (!retorno.ok) return retorno;
  const nota = retorno.dados?.serviceInvoice || retorno.dados?.ServiceInvoice || retorno.dados;
  if (!nota || typeof nota !== 'object') return { ok: false, motivo: 'resposta_inesperada' };
  const id = texto(nota.id ?? nota.Id);
  const status = texto(nota.status ?? nota.Status);
  const fluxo = texto(nota.flowStatus ?? nota.FlowStatus);
  if (!idValido(id) || !status) return { ok: false, motivo: 'resposta_inesperada' };
  return { ok: true, id, status, fluxo,
    numero: texto(nota.number ?? nota.Number),
    codigoVerificacao: texto(nota.checkCode ?? nota.CheckCode ?? nota.verificationCode ?? nota.VerificationCode),
    ambiente: texto(nota.environment ?? nota.Environment), nota };
}

export async function emitirNfseNfeio(empresaId: string, nota: Registro, fiscal: Registro,
  chave: string, consultar: Consulta = fetch) {
  if (!idValido(empresaId)) return { ok: false, motivo: 'identificacao_invalida' };
  const corpo = montarNfseNfeio(nota, fiscal);
  if (!corpo) return { ok: false, motivo: 'nota_incompleta' };
  const retorno = await solicitar(`/v1/companies/${encodeURIComponent(empresaId)}/serviceinvoices`,
    'POST', chave, corpo, consultar);
  if (!retorno.ok) return retorno;
  const dados = retorno.dados?.serviceInvoice || retorno.dados?.ServiceInvoice || retorno.dados;
  if (retorno.codigo === 202) {
    return { ok: true, pendente: true, localizacao: retorno.localizacao || texto(dados?.location),
      id: texto(dados?.id ?? dados?.Id) };
  }
  const id = texto(dados?.id ?? dados?.Id);
  if (!idValido(id)) return { ok: false, motivo: 'resposta_inesperada' };
  return { ok: true, pendente: true, id, status: texto(dados?.status ?? dados?.Status) };
}

export async function cancelarNfseNfeio(empresaId: string, emissaoId: string, chave: string,
  consultar: Consulta = fetch) {
  if (!idValido(empresaId) || !idValido(emissaoId)) return { ok: false, motivo: 'identificacao_invalida' };
  const retorno = await solicitar(`/v1/companies/${encodeURIComponent(empresaId)}/serviceinvoices/${encodeURIComponent(emissaoId)}`,
    'DELETE', chave, undefined, consultar);
  // 200/204 confirma recebimento, não o cancelamento na prefeitura.
  return retorno.ok ? { ok: true, pendente: true } : retorno;
}

export async function baixarPdfNfseNfeio(empresaId: string, emissaoId: string, chave: string,
  consultar: Consulta = fetch) {
  if (!idValido(empresaId) || !idValido(emissaoId)) return { ok: false, motivo: 'identificacao_invalida' };
  if (!chave) return { ok: false, motivo: 'credencial_indisponivel' };
  try {
    const resposta = await consultar(`https://api.nfe.io/v1/companies/${encodeURIComponent(empresaId)}/serviceinvoices/${encodeURIComponent(emissaoId)}/pdf`, {
      method: 'GET', headers: { Authorization: chave, Accept: 'application/pdf' },
      signal: AbortSignal.timeout(20000)
    });
    if (!resposta.ok) return { ok: false, motivo: 'pdf_indisponivel', codigo: resposta.status };
    const tamanho = Number(resposta.headers.get('content-length') || 0);
    if (tamanho > 20_000_000) return { ok: false, motivo: 'pdf_grande' };
    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.length < 5 || bytes.length > 20_000_000 ||
        new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
      return { ok: false, motivo: 'pdf_invalido' };
    }
    return { ok: true, bytes };
  } catch (_) {
    return { ok: false, motivo: 'pdf_indisponivel' };
  }
}

export async function baixarXmlNfseNfeio(empresaId: string, emissaoId: string, chave: string,
  consultar: Consulta = fetch) {
  if (!idValido(empresaId) || !idValido(emissaoId)) return { ok: false, motivo: 'identificacao_invalida' };
  if (!chave) return { ok: false, motivo: 'credencial_indisponivel' };
  try {
    const resposta = await consultar(`https://api.nfe.io/v1/companies/${encodeURIComponent(empresaId)}/serviceinvoices/${encodeURIComponent(emissaoId)}/xml`, {
      method: 'GET', headers: { Authorization: chave, Accept: 'application/xml, text/xml' },
      signal: AbortSignal.timeout(20000)
    });
    if (!resposta.ok) return { ok: false, motivo: 'xml_indisponivel', codigo: resposta.status };
    const tamanho = Number(resposta.headers.get('content-length') || 0);
    if (tamanho > 20_000_000) return { ok: false, motivo: 'xml_grande' };
    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.length < 5 || bytes.length > 20_000_000) return { ok: false, motivo: 'xml_invalido' };
    const inicio = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512))).replace(/^\uFEFF/, '').trimStart();
    if (!inicio.startsWith('<?xml') && !inicio.startsWith('<')) return { ok: false, motivo: 'xml_invalido' };
    return { ok: true, bytes };
  } catch (_) {
    return { ok: false, motivo: 'xml_indisponivel' };
  }
}
