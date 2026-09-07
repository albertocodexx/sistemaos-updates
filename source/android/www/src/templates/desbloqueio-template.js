const { montarDadosEmpresa } = require('./empresa-compositor');
const { resolverTemaPdf } = require('./tema-pdf');

const TERMOS_DESBLOQUEIO = `DECLARAÇÃO DE TITULARIDADE E AUTORIZAÇÃO
O(a) cliente declara, sob sua responsabilidade, ser proprietário(a) do aparelho identificado neste documento ou possuir autorização legítima e comprovável para solicitar o serviço. Declara também que as informações fornecidas são verdadeiras e assume responsabilidade por eventual reivindicação de terceiros.

CIÊNCIA TÉCNICA E RISCOS
1. Dependendo do modelo, da versão do sistema e do método tecnicamente disponível, o procedimento poderá exigir a restauração de fábrica do aparelho.
2. A restauração de fábrica e outras etapas do serviço podem apagar, de forma definitiva, fotos, vídeos, arquivos, contas, aplicativos, configurações e demais dados armazenados.
3. Bloqueios de segurança, tentativas anteriores, falhas de software ou hardware, oxidação, modificações e danos preexistentes podem impedir a conclusão do serviço.
4. Mesmo com a adoção dos cuidados técnicos compatíveis, existe risco de perda parcial ou total de dados, perda de funcionalidades, indisponibilidade do sistema ou, em situação excepcional, inutilização do aparelho (perda total).
5. A assistência não garante a preservação nem a recuperação de dados. O backup prévio é de responsabilidade do(a) cliente, quando tecnicamente possível.
6. O serviço não será executado quando houver indício de furto, roubo, fraude, IMEI irregular, propriedade de terceiro ou ausência de comprovação legítima. Nesses casos, a assistência poderá recusar ou interromper o atendimento.

Ao assinar, o(a) cliente confirma que leu, compreendeu e aceita as condições acima e autoriza o diagnóstico e a execução do procedimento descrito.`;

function escapar(valor) {
  return String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatarData(valor) {
  const data = new Date(valor || Date.now());
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleDateString('pt-BR');
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function campo(rotulo, valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  return `<div class="campo"><span>${escapar(rotulo)}</span><strong>${escapar(texto)}</strong></div>`;
}

function linhaTermica(rotulo, valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  return `<div class="linha-termica"><span>${escapar(rotulo)}</span><strong>${escapar(texto)}</strong></div>`;
}

function gerarHtmlDesbloqueio(documento, config = {}) {
  const empresa = montarDadosEmpresa(config);
  const tema = resolverTemaPdf(config);
  const cliente = documento.cliente || {};
  const aparelho = documento.aparelho || {};
  const logo = empresa.temLogo
    ? `<img class="logo${config.logoPdfMonocromatica ? ' logo-pdf-monocromatica' : ''}" src="${empresa.logoBase64}" alt="Logo"/>`
    : `<div class="logo-fallback">${escapar(empresa.iniciais || 'OS')}</div>`;
  const contato = empresa.linhasContato?.length
    ? `<p>${empresa.linhasContato.map(escapar).join(' · ')}</p>` : '';

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${escapar(documento.numero)} - Autorização de desbloqueio</title><style>
    *,*::before,*::after{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.42}
    .pagina{width:210mm;min-height:297mm;padding:11mm 14mm;display:flex;flex-direction:column}
    .topo{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:start;padding-bottom:9px;border-bottom:2px solid ${tema.linhasDestaque}}
    .logo{height:${Number(config.tamanhoLogoPdf)||70}px;max-width:150px;object-fit:contain}.logo-pdf-monocromatica{filter:grayscale(1) brightness(0) contrast(1.4)}.logo-fallback{width:54px;height:54px;border:2px solid #111;display:grid;place-items:center;font-weight:900;font-size:17px}
    .empresa h1{font-size:16px;margin:0 0 3px}.empresa p{margin:1px 0;color:#555;font-size:9px}.doc{text-align:right}.doc small{display:block;text-transform:uppercase;letter-spacing:.09em;color:#666;font-weight:700}.doc b{display:block;font-size:20px;margin:1px 0}.doc time{color:#555}
    .titulo{margin:11px 0 8px;background:#111;color:#fff;padding:9px 12px;display:flex;justify-content:space-between;align-items:center}.titulo h2{margin:0;font-size:14px;letter-spacing:.04em}.titulo span{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#ddd}
    .secao{border:1px solid #bbb;margin-bottom:7px;page-break-inside:avoid}.secao h3{margin:0;background:#111;color:#fff;padding:5px 10px;font-size:9px;letter-spacing:.1em;text-transform:uppercase}.grade{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;padding:9px 11px}.campo span{display:block;font-size:7.5px;color:#777;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.campo strong{display:block;font-size:11.5px;margin-top:1px;overflow-wrap:anywhere}
    .termos{border:1px solid #999;padding:10px 12px;white-space:pre-line;text-align:justify;font-size:11.5px;line-height:1.48;flex:1}.termos b{font-size:10px}
    .assinatura{margin-top:18px;display:flex;justify-content:center;page-break-inside:avoid}.assin-box{width:min(118mm,100%);text-align:center}.assin-esp{height:58px;position:relative;display:flex;align-items:flex-end;justify-content:center}.assin-linha{border-top:1px solid #111}.assin-label{font-size:8px;font-weight:800;letter-spacing:.07em;margin-top:4px}.assin-meta{font-size:8px;color:#666;margin-top:3px}.rodape{border-top:1px solid #bbb;margin-top:13px;padding-top:6px;text-align:center;color:#666;font-size:8px}
    @page{size:A4 portrait;margin:0}@media print{.pagina{page-break-after:always}}
  </style></head><body><main class="pagina">
    <header class="topo"><div>${logo}</div><div class="empresa"><h1>${escapar(empresa.nome)}</h1>${empresa.razaoSocialLinha?`<p>${escapar(empresa.razaoSocialLinha)}</p>`:''}${empresa.cnpj?`<p>CNPJ: ${escapar(empresa.cnpj)}</p>`:''}${empresa.endereco?`<p>${escapar(empresa.endereco)}</p>`:''}${contato}</div><div class="doc"><small>Autorização de desbloqueio</small><b>${escapar(documento.numero)}</b><time>${formatarData(documento.criadoEm)}</time></div></header>
    <div class="titulo"><h2>Termo de titularidade, ciência e autorização</h2><span>Documento individual</span></div>
    <section class="secao"><h3>Cliente</h3><div class="grade">${campo('Nome completo',cliente.nome)}${campo('ID do cliente',cliente.clienteId||'00000')}${campo('CPF',cliente.cpf)}${campo('Telefone',cliente.telefone)}</div></section>
    <section class="secao"><h3>Aparelho e serviço solicitado</h3><div class="grade">${campo('Marca',aparelho.marca)}${campo('Modelo',aparelho.modelo)}${campo('IMEI / Número de série',aparelho.imei||aparelho.numeroSerie)}${campo('Cor',aparelho.cor)}${campo('Tipo de bloqueio',documento.tipoBloqueio)}${documento.valor>0?campo('Valor informado',formatarMoeda(documento.valor)):''}${campo('Procedimento previsto',documento.procedimentoPrevisto)}${campo('Observações',documento.observacoes)}</div></section>
    <section class="termos">${escapar(TERMOS_DESBLOQUEIO).replace(/\n/g,'<br>')}</section>
    <section class="assinatura"><div class="assin-box"><div class="assin-esp"></div><div class="assin-linha"></div><div class="assin-label">ASSINATURA DO CLIENTE</div><div class="assin-meta">Declaro a titularidade e aceito os riscos informados</div></div></section>
    <footer class="rodape">Autorização vinculada ao aparelho acima identificado. Guarde este documento com o comprovante do atendimento.</footer>
  </main></body></html>`;
}

function gerarHtmlDesbloqueioTermico(documento, config = {}, formato = '80mm') {
  const largura = String(formato).toLowerCase().includes('58') ? '58mm' : '80mm';
  const empresa = montarDadosEmpresa(config);
  const cliente = documento.cliente || {};
  const aparelho = documento.aparelho || {};
  const contato = empresa.linhasContato?.length
    ? `<p>${empresa.linhasContato.map(escapar).join(' · ')}</p>` : '';
  const logo = empresa.temLogo
    ? `<img class="logo${config.logoPdfMonocromatica ? ' logo-pdf-monocromatica' : ''}" src="${empresa.logoBase64}" alt="Logo"/>`
    : `<div class="logo-fallback">${escapar(empresa.iniciais || 'OS')}</div>`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${escapar(documento.numero)} - Autorização de desbloqueio</title><style>
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}.bobina{width:${largura};padding:3mm 3mm 5mm;font-size:9px;line-height:1.3}.topo{text-align:center;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:7px}.logo{display:block;max-width:34mm;max-height:14mm;object-fit:contain;margin:0 auto 4px}.logo-pdf-monocromatica{filter:grayscale(1) brightness(0) contrast(1.4)}.logo-fallback{width:12mm;height:12mm;border:2px solid #111;display:grid;place-items:center;margin:0 auto 4px;font-weight:900}.topo h1{font-size:13px;margin:0}.topo p{font-size:7px;margin:2px 0;color:#444}.doc{text-align:center;margin-bottom:7px}.doc small{display:block;font-size:7px;letter-spacing:.08em;text-transform:uppercase}.doc b{display:block;font-size:17px;margin:1px 0}.bloco{border-top:1px solid #111;padding-top:5px;margin-top:6px}.bloco h2{font-size:9px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px}.linha-termica{display:flex;gap:5px;align-items:flex-start;margin:2px 0}.linha-termica span{flex:0 0 31%;font-size:7px;color:#555;text-transform:uppercase}.linha-termica strong{flex:1;font-size:8px;overflow-wrap:anywhere}.termos{font-size:9px;line-height:1.4;text-align:left;white-space:pre-line}.assinatura{margin:12mm auto 0;text-align:center;width:92%}.assin-esp{height:15mm;position:relative;display:flex;align-items:flex-end;justify-content:center}.assin-linha{border-top:1px solid #111}.assin-label{font-size:7px;font-weight:800;letter-spacing:.06em;margin-top:3px}.assin-meta{font-size:6.5px;color:#555;margin-top:2px}.rodape{border-top:1px dashed #777;margin-top:8px;padding-top:5px;text-align:center;font-size:6.5px;color:#555}@page{size:${largura} auto;margin:0}@media print{.bobina{width:${largura}}}
  </style></head><body><main class="bobina">
    <header class="topo">${logo}<h1>${escapar(empresa.nome)}</h1>${empresa.cnpj ? `<p>CNPJ: ${escapar(empresa.cnpj)}</p>` : ''}${contato}</header>
    <section class="doc"><small>Autorização de desbloqueio</small><b>${escapar(documento.numero)}</b><time>${formatarData(documento.criadoEm)}</time></section>
    <section class="bloco"><h2>Cliente</h2>${linhaTermica('Nome', cliente.nome)}${linhaTermica('ID', cliente.clienteId || '00000')}${linhaTermica('CPF', cliente.cpf)}${linhaTermica('Telefone', cliente.telefone)}</section>
    <section class="bloco"><h2>Aparelho</h2>${linhaTermica('Marca', aparelho.marca)}${linhaTermica('Modelo', aparelho.modelo)}${linhaTermica('IMEI / Série', aparelho.imei || aparelho.numeroSerie)}${linhaTermica('Cor', aparelho.cor)}${linhaTermica('Bloqueio', documento.tipoBloqueio)}${documento.valor > 0 ? linhaTermica('Valor', formatarMoeda(documento.valor)) : ''}${linhaTermica('Procedimento', documento.procedimentoPrevisto)}${linhaTermica('Observações', documento.observacoes)}</section>
    <section class="bloco"><h2>Termos e autorização</h2><div class="termos">${escapar(TERMOS_DESBLOQUEIO).replace(/\n/g, '<br>')}</div></section>
    <section class="assinatura"><div class="assin-esp"></div><div class="assin-linha"></div><div class="assin-label">ASSINATURA DO CLIENTE</div><div class="assin-meta">Declaro a titularidade e aceito os riscos informados</div></section>
    <footer class="rodape">Autorização vinculada ao aparelho identificado acima.</footer>
  </main></body></html>`;
}

module.exports = { gerarHtmlDesbloqueio, gerarHtmlDesbloqueioTermico, TERMOS_DESBLOQUEIO };
