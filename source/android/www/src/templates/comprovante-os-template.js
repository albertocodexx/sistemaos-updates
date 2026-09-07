// Comprovantes térmicos derivados dos dados sincronizados da OS.
// Este arquivo é mantido byte-idêntico no PC e no aplicativo Android.
// Nenhum custo interno, margem, senha ou observação privada pode aparecer aqui.

const { montarDadosEmpresa } = require('./empresa-compositor');

const VERSAO_TEMPLATE_COMPROVANTE = 3;

function texto(valor) {
  return String(valor == null ? '' : valor).trim();
}

function escapeHtml(valor) {
  return texto(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function semAcentos(valor) {
  return texto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizarNumeroOS(valor) {
  const original = texto(valor).replace(/^#/, '');
  if (!original) return 'AGUARDANDO SINCRONIZAÇÃO';
  const semPrefixos = original.replace(/^(?:OS[\s#:_-]*)+/i, '').trim();
  if (/^\d+$/.test(semPrefixos)) {
    return `OS-${semPrefixos.padStart(4, '0')}`;
  }
  return original.replace(/^OS[\s#:_-]*/i, 'OS-');
}

function moeda(valor) {
  const numero = Number(String(valor == null ? 0 : valor).replace(',', '.'));
  return (Number.isFinite(numero) ? numero : 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function dataHora(valor) {
  if (!valor) return '';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return texto(valor);
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function assinaturaImagem(valor, alt) {
  const src = texto(valor);
  if (!/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) return '';
  return `<img class="assinatura-imagem" src="${src}" alt="${escapeHtml(alt)}">`;
}

function logoImagem(valor) {
  const src = texto(valor);
  if (!/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) return '';
  return `<img class="empresa-logo" src="${src}" alt="Logo da assistência técnica">`;
}

function valorReparo(os) {
  const diagnostico = os.diagnosticoTecnico || {};
  const entrega = os.entrega || os.dadosEntrega || {};
  return os.valorTotalServico || os.valorReparo || os.valorCobrado ||
    entrega.valorReparo || entrega.valorCobrado || os.valorTotal ||
    diagnostico.valorEstimado || 0;
}

function formaPagamentoResolvida(os) {
  const entrega = os.entrega || os.dadosEntrega || {};
  const pagamento = os.pagamento || {};
  return texto(
    os.formaPagamento || os.pagamentoForma || entrega.formaPagamento ||
    pagamento.forma || pagamento.formaPagamento || os.statusPagamento
  );
}

function servicoExecutado(os) {
  const diagnostico = os.diagnosticoTecnico || {};
  return texto(
    diagnostico.solucao ||
    os.servicoRealizado ||
    os.reparoRealizado ||
    os.observacoesSaida
  );
}

function pecasPublicas(os) {
  const diagnostico = os.diagnosticoTecnico || {};
  const itens = Array.isArray(diagnostico.pecasTrocar)
    ? diagnostico.pecasTrocar
    : (Array.isArray(os.pecasTrocadas) ? os.pecasTrocadas : []);
  return itens
    .map((item) => {
      const nome = texto(item && (item.nome || item.descricao || item.peca));
      if (!nome) return '';
      const quantidade = Math.max(1, Number(item.quantidade || 1));
      return `${quantidade}x ${nome}`;
    })
    .filter(Boolean);
}

function tipoComprovante(os) {
  const solicitado = semAcentos(os.tipoComprovante || os.modoComprovante);
  if (solicitado === 'autorizacao') return 'autorizacao';
  if (solicitado === 'entrega') return 'entrega';

  const status = semAcentos(os.status).replace(/[_-]+/g, ' ');
  if (
    (status.includes('aguardando') || status.includes('pendente')) &&
    status.includes('aprov')
  ) return 'autorizacao';
  if (
    status.includes('pronto para retirada') ||
    status.includes('entreg') ||
    status.includes('finaliz') ||
    status.includes('concluid')
  ) return 'entrega';
  return 'geral';
}

function dadosEntrega(os) {
  const entrega = os.entrega || os.dadosEntrega || os.comprovanteEntrega || {};
  const cliente = os.cliente || {};
  const status = semAcentos(os.status).replace(/[_-]+/g, ' ');
  const entregaConcluida = status.includes('entreg') || status.includes('finaliz') || status.includes('concluid');
  return {
    recebidoPor: texto(
      entrega.nomeRetirou ||
      entrega.recebidoPor ||
      os.nomeRetirou ||
      os.recebidoPor ||
      cliente.nome ||
      os.clienteNome
    ),
    telefone: texto(
      entrega.telefone ||
      entrega.telefoneRetirou ||
      os.telefoneRetirou ||
      cliente.telefone ||
      os.clienteTelefone
    ),
    cpf: texto(
      entrega.cpf ||
      entrega.cpfRetirou ||
      os.cpfRetirou ||
      cliente.cpf ||
      os.clienteCpf
    ),
    entregueEm: (
      entrega.dataHoraAssinatura ||
      entrega.dataHoraEntrega ||
      os.dataHoraEntrega ||
      os.entregueEm ||
      os.finalizadoEm ||
      (entregaConcluida ? (os.updatedAt || os.atualizadoEm || os.data) : '')
    ),
    assinatura: assinaturaImagem(
      entrega.assinaturaRetirouBase64 ||
      entrega.assinaturaRecebimentoBase64 ||
      os.assinaturaRetirouBase64 ||
      os.assinaturaRecebimentoBase64,
      'Assinatura de recebimento'
    )
  };
}

function mapearEntregaParaComprovante(entregaOriginal) {
  const origem = entregaOriginal || {};
  const dados = origem.entrega || origem.dadosEntrega || origem;
  const clienteOrigem = origem.cliente || {};
  const aparelhoOrigem = origem.aparelho || {};
  const numero = normalizarNumeroOS(origem.numeroOS || origem.numero);

  return {
    ...origem,
    numero,
    numeroOS: numero,
    status: 'Entregue',
    tipoComprovante: 'entrega',
    cliente: {
      ...clienteOrigem,
      nome: texto(clienteOrigem.nome || origem.clienteNome || dados.nomeRetirou || dados.recebidoPor),
      telefone: texto(clienteOrigem.telefone || origem.clienteTelefone || dados.telefoneRetirou || dados.telefone),
      cpf: texto(clienteOrigem.cpf || origem.clienteCpf || dados.cpfRetirou || dados.cpf)
    },
    aparelho: {
      ...aparelhoOrigem,
      tipoEquipamento: texto(aparelhoOrigem.tipoEquipamento || origem.tipoEquipamento),
      marca: texto(aparelhoOrigem.marca || origem.marca),
      modelo: texto(aparelhoOrigem.modelo || origem.modelo),
      cor: texto(aparelhoOrigem.cor || origem.cor),
      imei: texto(aparelhoOrigem.imei || origem.imei)
    },
    diagnosticoTecnico: {
      ...(origem.diagnosticoTecnico || {}),
      diagnostico: texto((origem.diagnosticoTecnico || {}).diagnostico || origem.diagnostico),
      solucao: texto(
        (origem.diagnosticoTecnico || {}).solucao ||
        origem.reparoRealizado ||
        origem.servicoRealizado
      )
    },
    valorTotalServico: Number(
      origem.valorTotalServico ||
      origem.valorReparo ||
      dados.valorReparo ||
      0
    ) || 0,
    formaPagamento: texto(
      origem.formaPagamento || origem.pagamentoForma || dados.formaPagamento ||
      (origem.pagamento || {}).forma || origem.statusPagamento
    ),
    garantiaDias: Number(origem.garantiaDias || dados.garantiaDias || 0) || 0,
    entrega: {
      ...dados,
      nomeRetirou: texto(dados.nomeRetirou || dados.recebidoPor || clienteOrigem.nome),
      telefoneRetirou: texto(dados.telefoneRetirou || dados.telefone || clienteOrigem.telefone),
      cpfRetirou: texto(dados.cpfRetirou || dados.cpf || clienteOrigem.cpf),
      dataHoraEntrega: (
        dados.dataHoraEntrega ||
        dados.dataHoraAssinatura ||
        origem.dataHoraEntrega ||
        origem.dataHoraAssinatura ||
        origem.updatedAt ||
        origem.atualizadoEm
      ),
      assinaturaRetirouBase64: (
        dados.assinaturaRetirouBase64 ||
        dados.assinaturaRecebimentoBase64 ||
        origem.assinaturaRetirouBase64 ||
        origem.assinaturaRecebimentoBase64 ||
        ''
      )
    }
  };
}

function hashCurto(os) {
  const origem = [
    os.id || '',
    normalizarNumeroOS(os.numero),
    os.revision || os.revisao || 1,
    os.updatedAt || os.atualizadoEm || os.data || '',
    tipoComprovante(os),
    valorReparo(os),
    servicoExecutado(os)
  ].join('|');
  let hash = 2166136261;
  for (let i = 0; i < origem.length; i += 1) {
    hash ^= origem.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function linha(label, valor, classe) {
  if (!texto(valor)) return '';
  return `<div class="linha ${classe || ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(valor)}</strong></div>`;
}

function bloco(titulo, conteudo) {
  if (!texto(conteudo)) return '';
  return `<section><h2>${escapeHtml(titulo)}</h2><p>${escapeHtml(conteudo)}</p></section>`;
}

function montarModeloComprovanteOS(osOriginal, configOriginal) {
  const os = osOriginal || {};
  const config = configOriginal || {};
  const empresa = montarDadosEmpresa(config);
  const cliente = os.cliente || {};
  const aparelho = os.aparelho || {};
  const diagnostico = os.diagnosticoTecnico || {};
  const revisao = Number(os.revision || os.revisao || os.comprovanteRevisao || 1) || 1;
  const emitidoEm = os.updatedAt || os.atualizadoEm || os.data || new Date().toISOString();
  const tipo = tipoComprovante(os);
  const entrega = dadosEntrega(os);

  return {
    tipo,
    titulo: tipo === 'autorizacao'
      ? 'AUTORIZAÇÃO DE SERVIÇO'
      : (tipo === 'entrega' ? 'COMPROVANTE DE ENTREGA' : 'COMPROVANTE DA ORDEM DE SERVIÇO'),
    empresa,
    numero: normalizarNumeroOS(os.numero),
    revisao,
    emitidoEm,
    cliente: {
      nome: texto(cliente.nome || os.clienteNome),
      telefone: texto(cliente.telefone || os.clienteTelefone),
      cpf: texto(cliente.cpf || os.clienteCpf)
    },
    aparelho: {
      tipo: texto(aparelho.tipoEquipamento || aparelho.tipo || os.tipoEquipamento),
      marca: texto(aparelho.marca || os.marca),
      modelo: texto(aparelho.modelo || os.modelo),
      cor: texto(aparelho.cor || os.cor),
      imei: texto(os.imei || aparelho.imei)
    },
    defeito: texto(aparelho.defeitoRelatado || os.defeitoRelatado),
    diagnostico: texto(diagnostico.diagnostico || os.diagnostico),
    servico: servicoExecutado(os),
    pecas: pecasPublicas(os),
    valor: valorReparo(os),
    pagamento: formaPagamentoResolvida(os),
    prazo: texto(diagnostico.prazoEstimado || os.prazoEstimado || (os.semPrazo ? 'Sem prazo definido' : '')),
    garantia: texto(os.garantiaDias ? `${os.garantiaDias} dias` : os.garantia),
    assinaturaCliente: assinaturaImagem(os.assinaturaClienteBase64, 'Assinatura do cliente'),
    entrega,
    autenticidade: hashCurto(os)
  };
}

function gerarHtmlComprovanteOS(os, config, opcoes) {
  const modelo = montarModeloComprovanteOS(os, config);
  const formato = ['58mm', '80mm', 'a4'].includes(opcoes && opcoes.formato)
    ? opcoes.formato
    : '80mm';
  const largura = formato === '58mm' ? '58mm' : (formato === 'a4' ? '210mm' : '80mm');
  const corpoMaximo = formato === 'a4' ? '176mm' : largura;
  const empresa = modelo.empresa;
  const contato = empresa.linhasContato.map(escapeHtml).join(' · ');
  const logoA4 = formato === 'a4' ? logoImagem(empresa.logoBase64) : '';
  const aparelho = [modelo.aparelho.tipo, modelo.aparelho.marca, modelo.aparelho.modelo]
    .filter(Boolean).join(' ');
  const pecas = modelo.pecas.length
    ? `<section><h2>PEÇAS / ITENS APLICADOS</h2><ul>${modelo.pecas.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></section>`
    : '';
  const assinaturaCliente = modelo.assinaturaCliente || '<div class="assinatura-vazia"></div>';
  const assinaturaRecebimento = modelo.entrega.assinatura || '<div class="assinatura-vazia"></div>';

  const resumoFinanceiro = modelo.tipo === 'autorizacao'
    ? `<div class="total">${linha('VALOR AUTORIZADO', moeda(modelo.valor))}${linha('Prazo estimado', modelo.prazo)}</div>`
    : `<div class="total">${linha('VALOR DO REPARO', moeda(modelo.valor))}${linha('Forma de pagamento', modelo.pagamento)}${modelo.tipo === 'entrega' ? linha('Garantia', modelo.garantia) : `${linha('Prazo', modelo.prazo)}${linha('Garantia', modelo.garantia)}`}</div>`;

  const blocoFinal = modelo.tipo === 'autorizacao'
    ? `<section class="declaracao">
        <h2>AUTORIZAÇÃO</h2>
        <p>Declaro que conferi os dados acima, li e aceito os termos e condições da Ordem de Serviço e autorizo a execução do serviço descrito pelo valor informado. A assinatura deste comprovante formaliza a aceitação dos termos. Qualquer alteração relevante de serviço ou valor deverá ser comunicada para nova aprovação.</p>
      </section>
      <div class="assinaturas">
        <div class="assinatura">
          ${assinaturaCliente}
          <div class="assinatura-linha">ASSINATURA PARA AUTORIZAR<br>${escapeHtml(modelo.cliente.nome)}</div>
        </div>
      </div>`
    : (modelo.tipo === 'entrega'
      ? `<section>
          <h2>RECEBIMENTO</h2>
          ${linha('Data e hora da entrega', dataHora(modelo.entrega.entregueEm))}
          ${linha('Recebido por', modelo.entrega.recebidoPor)}
          ${linha('Telefone', modelo.entrega.telefone)}
          ${linha('CPF', modelo.entrega.cpf)}
        </section>
        <section class="declaracao">
          <h2>DECLARAÇÃO DE RECEBIMENTO</h2>
          <p>Declaro que recebi o equipamento identificado acima e conferi os reparos realizados, o valor e a forma de pagamento informados neste comprovante.</p>
        </section>
        <div class="assinaturas">
          <div class="assinatura">
            ${assinaturaRecebimento}
            <div class="assinatura-linha">ASSINATURA DE QUEM RECEBEU<br>${escapeHtml(modelo.entrega.recebidoPor)}</div>
          </div>
        </div>`
      : `<section class="declaracao">
          <h2>REGISTRO DA ORDEM DE SERVIÇO</h2>
          <p>Este comprovante apresenta os dados atuais da ordem de serviço na data e hora indicadas.</p>
        </section>
        <div class="assinaturas">
          <div class="assinatura">
            ${assinaturaCliente}
            <div class="assinatura-linha">CLIENTE / RESPONSÁVEL<br>${escapeHtml(modelo.cliente.nome)}</div>
          </div>
        </div>`);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(modelo.titulo)} - ${escapeHtml(modelo.numero)}</title>
<style>
  @page{size:${formato === 'a4' ? 'A4' : 'auto'};margin:0}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}
  body{width:${largura};font-size:${formato === '58mm' ? '9.5px' : '11px'};line-height:1.34}
  .folha{width:100%;max-width:${corpoMaximo};margin:0 auto;padding:${formato === 'a4' ? '14mm' : '3.2mm'}}
  header{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:8px}
  .empresa-cabecalho{display:flex;align-items:center;justify-content:center;gap:10mm}
  .empresa-logo{display:block;width:25mm;height:25mm;object-fit:contain;flex:0 0 auto}
  .empresa-identidade{text-align:${formato === 'a4' && logoA4 ? 'left' : 'center'}}
  h1{font-size:${formato === 'a4' ? '24px' : '15px'};line-height:1.1;margin:0 0 3px;text-transform:uppercase}
  .empresa-dados{font-size:.86em;overflow-wrap:anywhere}
  .titulo{margin:8px 0;padding:7px 4px;background:#111;color:#fff;text-align:center;font-weight:900;letter-spacing:.06em}
  .identificacao{border:1.5px solid #111;padding:6px;margin-bottom:7px}
  .linha{display:flex;gap:6px;justify-content:space-between;border-bottom:1px dotted #888;padding:2px 0}
  .linha:last-child{border-bottom:0}.linha span{color:#444}.linha strong{text-align:right;overflow-wrap:anywhere}
  section{border-top:1.5px solid #111;padding-top:6px;margin-top:7px}
  section h2{font-size:1em;margin:0 0 3px;letter-spacing:.045em}
  section p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
  ul{margin:2px 0 0;padding-left:16px}
  .total{font-size:1.32em;padding:6px 0;margin-top:7px;border-top:2px solid #111;border-bottom:2px solid #111}
  .declaracao{font-size:.9em;text-align:justify}
  .assinaturas{display:grid;grid-template-columns:1fr;gap:9px;margin-top:11px}
  .assinatura{min-height:25mm;text-align:center;display:flex;flex-direction:column;justify-content:flex-end}
  .assinatura-imagem{display:block;max-width:100%;height:15mm;object-fit:contain;margin:auto auto 1px}
  .assinatura-vazia{height:15mm}
  .assinatura-linha{border-top:1px solid #111;padding-top:3px;font-size:.82em;font-weight:800}
  footer{border-top:1.5px solid #111;text-align:center;margin-top:10px;padding-top:6px;font-size:.76em}
  .codigo{font-family:Consolas,monospace;letter-spacing:.08em}
  @media screen{body{margin:16px auto;box-shadow:0 12px 40px rgba(0,0,0,.18)}}
  @media print{body{margin:0;box-shadow:none}}
</style>
</head>
<body>
<main class="folha">
  <header>
    <div class="empresa-cabecalho">
      ${logoA4}
      <div class="empresa-identidade">
        <h1>${escapeHtml(empresa.nome)}</h1>
        ${empresa.razaoSocialLinha ? `<div>${escapeHtml(empresa.razaoSocialLinha)}</div>` : ''}
        <div class="empresa-dados">${empresa.cnpj ? `CNPJ: ${escapeHtml(empresa.cnpj)}<br>` : ''}${empresa.inscricaoEstadual ? `Inscrição Estadual: ${escapeHtml(empresa.inscricaoEstadual)}<br>` : ''}${empresa.endereco ? `${escapeHtml(empresa.endereco)}<br>` : ''}${contato}</div>
      </div>
    </div>
  </header>

  <div class="titulo">${escapeHtml(modelo.titulo)}</div>
  <div class="identificacao">
    ${linha('Ordem de serviço', modelo.numero)}
    ${linha('Emissão / atualização', dataHora(modelo.emitidoEm))}
    ${linha('Revisão', String(modelo.revisao))}
  </div>

  <section>
    <h2>CLIENTE</h2>
    ${linha('Nome', modelo.cliente.nome)}
    ${linha('Telefone', modelo.cliente.telefone)}
    ${linha('CPF', modelo.cliente.cpf)}
  </section>

  <section>
    <h2>APARELHO</h2>
    ${linha('Equipamento', aparelho)}
    ${linha('Cor', modelo.aparelho.cor)}
    ${linha('IMEI / Série', modelo.aparelho.imei)}
  </section>

  ${bloco('DEFEITO INFORMADO', modelo.defeito)}
  ${bloco('DIAGNÓSTICO', modelo.diagnostico)}
  ${bloco(modelo.tipo === 'autorizacao' ? 'SERVIÇO PROPOSTO' : 'REPAROS REALIZADOS', modelo.servico)}
  ${pecas}
  ${resumoFinanceiro}
  ${blocoFinal}

  <footer>
    <div>${escapeHtml(modelo.titulo)} · ${escapeHtml(modelo.numero)} · Rev. ${modelo.revisao}</div>
    <div class="codigo">Verificação: ${modelo.autenticidade}</div>
  </footer>
</main>
</body>
</html>`;
}

module.exports = {
  VERSAO_TEMPLATE_COMPROVANTE,
  mapearEntregaParaComprovante,
  montarModeloComprovanteOS,
  gerarHtmlComprovanteOS
};
