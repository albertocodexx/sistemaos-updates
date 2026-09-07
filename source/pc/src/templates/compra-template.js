// src/templates/compra-template.js
// Contrato de Compra — duas vias lado a lado (paisagem A4)
// Estilo escuro (cabeçalhos pretos), compacto para caber declarações e termos.

const { montarDadosEmpresa } = require('./empresa-compositor');
const { resolverTemaPdf } = require('./tema-pdf');
const { resolverTamanhoFonteTermos } = require('./fonte-termos-pdf');
const { TERMOS_COMPRA } = require('../termos-predefinidos');

function resolverTermosCompra(cp, config) {
  if (cp.termosCompra && cp.termosCompra.trim()) return cp.termosCompra;
  if (config && config.termosCompra && config.termosCompra.trim()) return config.termosCompra;
  if (config && config.usarTermosPredefinidosCompra) return TERMOS_COMPRA;
  return '';
}

function e(t) {
  return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br/>');
}
function fmtMoeda(v) { return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function formatarData(iso) {
  try { const d=new Date(iso); return d.toLocaleDateString('pt-BR')+' às '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); } catch { return iso||''; }
}
function campo(rotulo, valor) {
  if (!valor) return '';
  return `<div class="campo"><span class="rot">${rotulo}</span><span class="val">${e(valor)}</span></div>`;
}

function gerarVia(cp, config, tituloVia, t) {
  const empresa = montarDadosEmpresa(config);
  const v = cp.vendedor || {};
  const ap = cp.aparelho || {};
  const av = cp.avaliacao || {};
  const compra = cp.dadosCompra || {};
  const cfg = config || {};

  const logoHtml = empresa.temLogo
    ? `<img src="${empresa.logoBase64}" alt="Logo" class="logo-img"/>`
    : `<div class="logo-mono">${e(empresa.iniciais)}</div>`;

  const cnpjHtml = empresa.cnpj
    ? `<p class="emp-cnpj">CNPJ: ${e(empresa.cnpj)}${empresa.inscricaoEstadual?` · IE: ${e(empresa.inscricaoEstadual)}`:''}</p>` : '';
  const endHtml  = empresa.endereco ? `<p>${e(empresa.endereco)}</p>` : '';
  const ctHtml   = empresa.linhasContato.length ? `<p>${empresa.linhasContato.map(e).join(' · ')}</p>` : '';

  const situacaoStr = (ap.situacao&&ap.situacao.length) ? ap.situacao.join(', ') : '';
  const acessoriosStr = (ap.acessorios&&ap.acessorios.length) ? ap.acessorios.join(', ') : (ap.acessoriosTexto||'');
  const contaStr = (ap.contaVinculada&&ap.contaVinculada!=='Não') ? ap.contaVinculada : '';
  const contaRemovida = ap.contaRemovida===true||ap.contaRemovida==='true'||ap.contaRemovida==='Sim';
  const semTeste = ap.situacao&&(ap.situacao.includes('Não liga')||ap.situacao.includes('Não foi possível testar'));

  const rodapeItens = [];
  if (empresa.telefoneRodape) rodapeItens.push(`<b>Tel:</b> ${e(empresa.telefoneRodape)}`);
  if (empresa.emailRodape)    rodapeItens.push(e(empresa.emailRodape));

  return `
  <div class="via">
    <div class="cabecalho">
      <div class="logo-wrap">${logoHtml}</div>
      <div class="emp-info">
        <h1>${e(empresa.nome)}</h1>
        ${empresa.razaoSocialLinha?`<p>${e(empresa.razaoSocialLinha)}</p>`:''}
        ${cnpjHtml}${endHtml}${ctHtml}
      </div>
      <div class="num-box">
        <div class="num-label">CONTRATO DE COMPRA</div>
        <div class="num-val">${e(cp.numero)}</div>
        <div class="num-data">${formatarData(cp.data)}</div>
      </div>
    </div>

    <div class="via-label">${tituloVia}</div>

    <div class="secoes">
      <!-- DADOS DO VENDEDOR -->
      <div class="secao">
        <div class="stit">DADOS DO VENDEDOR</div>
        <div class="grade">
          ${campo('NOME', v.nome)}
          ${campo('ID DO CLIENTE', v.clienteId || '00000')}
          ${campo('CPF', v.cpf)}
          ${cfg.cpExibirRg!==false ? campo('RG', v.rg) : ''}
          ${campo('TELEFONE', v.telefone)}
          ${campo('WHATSAPP', v.whatsapp)}
          ${campo('E-MAIL', v.email)}
          ${v.endereco ? campo('ENDEREÇO', [v.endereco,v.numero,v.bairro,v.cidade,v.estado,v.cep].filter(Boolean).join(', ')) : ''}
        </div>
      </div>

      <!-- DADOS DO APARELHO -->
      <div class="secao">
        <div class="stit">DADOS DO APARELHO</div>
        <div class="grade">
          ${campo('TIPO', ap.tipo)}
          ${campo('MARCA', ap.marca)}
          ${campo('MODELO', ap.modelo)}
          ${campo('COR', ap.cor)}
          ${campo('CAPACIDADE', ap.capacidade)}
          ${cfg.cpExibirImei!==false ? campo('IMEI 1', ap.imei1) : ''}
          ${cfg.cpExibirImei!==false ? campo('IMEI 2', ap.imei2) : ''}
          ${cfg.cpExibirNumeroDeSerie!==false ? campo('Nº DE SÉRIE', ap.numeroSerie) : ''}
          ${campo('ESTADO', ap.estadoConservacao)}
          ${acessoriosStr ? campo('ACESSÓRIOS', acessoriosStr) : ''}
          ${situacaoStr   ? campo('SITUAÇÃO', situacaoStr) : ''}
          ${contaStr ? campo('CONTA VINCULADA', contaStr+(ap.emailConta?` (${ap.emailConta})`:'')+(!contaRemovida?' — Não removida':' — Removida')) : ''}
        </div>
      </div>

      <!-- AVALIAÇÃO -->
      ${(av.descricaoGeral||av.defeitosInformados||av.defeitosEncontrados||av.observacoes) ? `
      <div class="secao">
        <div class="stit">AVALIAÇÃO DO APARELHO</div>
        ${av.descricaoGeral      ? `<div class="ssub">DESCRIÇÃO GERAL</div><div class="tlivre">${e(av.descricaoGeral)}</div>` : ''}
        ${av.defeitosInformados  ? `<div class="ssub">DEFEITOS INFORMADOS</div><div class="tlivre">${e(av.defeitosInformados)}</div>` : ''}
        ${av.defeitosEncontrados ? `<div class="ssub">DEFEITOS ENCONTRADOS</div><div class="tlivre">${e(av.defeitosEncontrados)}</div>` : ''}
        ${av.observacoes         ? `<div class="ssub">OBSERVAÇÕES</div><div class="tlivre">${e(av.observacoes)}</div>` : ''}
      </div>` : ''}

      <!-- DADOS DA COMPRA -->
      <div class="secao">
        <div class="stit">DADOS DA COMPRA</div>
        <div class="grade">
          ${campo('CONTRATO', cp.numero)}
          ${campo('DATA', cp.data?cp.data.slice(0,10).split('-').reverse().join('/'):'')}
          ${compra.valor ? campo('VALOR PAGO NO APARELHO', fmtMoeda(compra.valor)) : ''}
          ${campo('FORMA DE PAGAMENTO', compra.formaPagamento)}
          ${campo('CHAVE PIX', compra.chavePix)}
          ${campo('OBSERVAÇÕES', compra.observacoes)}
        </div>
      </div>

      <!-- PEÇAS A TROCAR / CUSTO TOTAL -->
      ${(compra.pecasTrocar && compra.pecasTrocar.length) ? `
      <div class="secao">
        <div class="stit">PEÇAS A TROCAR (CUSTO DE REPARO)</div>
        <div class="grade">
          ${compra.pecasTrocar.map(p => campo(e(p.nome||'PEÇA').toUpperCase(), fmtMoeda(p.valor))).join('')}
        </div>
        <div class="tlivre" style="font-weight:800;border-top:1px solid ${'#ddd'};margin-top:2px;">
          VALOR PAGO NO APARELHO: ${fmtMoeda(compra.valor)} &nbsp;+&nbsp; TOTAL EM PEÇAS: ${fmtMoeda(compra.custoPecas||0)} &nbsp;=&nbsp; CUSTO TOTAL: ${fmtMoeda(compra.custoTotal||((compra.valor||0)+(compra.custoPecas||0)))}
        </div>
      </div>` : ''}

      <!-- TERMOS E CONDIÇÕES GERAIS (declarações + termos unificados) -->
      <div class="secao secao-termos">
        <div class="stit">TERMOS E CONDIÇÕES</div>
        <!-- As 4 declarações fixas (PROPRIEDADE, PROCEDÊNCIA, SENHA E ACESSO,
             CONTAS E BLOQUEIOS) foram removidas por completo — não fazem
             mais parte deste documento, atrás de toggle ou não. Alinhado
             com a mesma remoção feita no app do celular. O bloco condicional
             "ATENÇÃO — APARELHO SEM TESTE" foi mantido: é um alerta
             operacional condicional, não uma declaração de contrato fixa. -->
        <div class="termos-txt">${[
          semTeste ? 'ATENÇÃO — APARELHO SEM TESTE: Este equipamento foi adquirido sem possibilidade de teste completo. Caso volte a funcionar, o vendedor compromete-se a fornecer senhas e desbloqueios necessários.' : '',
          resolverTermosCompra(cp, cfg) || ''
        ].filter(Boolean).join('<br/><br/>')}</div>
      </div>
    </div>

    <!-- ASSINATURAS -->
    <div class="assinaturas">
      <div class="assin-bloco">
        <div class="assin-esp"></div>
        <div class="assin-linha"></div>
        <div class="assin-label">ASSINATURA DO VENDEDOR</div>
        <div class="assin-nome">${e(v.nome||'')}</div>
        <div class="assin-cpf">${v.cpf?`CPF: ${e(v.cpf)}`:''}</div>
        <div class="assin-data">Data: _____ / _____ / __________</div>
      </div>
      <div class="assin-bloco">
        <div class="assin-esp"></div>
        <div class="assin-linha"></div>
        <div class="assin-label">ASSINATURA DA ASSISTÊNCIA TÉCNICA</div>
        <div class="assin-nome">${e(empresa.nome)}</div>
        <div class="assin-cpf">${empresa.cnpj?`CNPJ: ${e(empresa.cnpj)}`:''}</div>
        <div class="assin-data">Data: _____ / _____ / __________</div>
      </div>
    </div>

    <!-- RODAPÉ -->
    ${rodapeItens.length ? `
    <div class="rodape-via">
      <span>${rodapeItens.join(' &nbsp;·&nbsp; ')}</span>
    </div>` : ''}
  </div>`;
}

function gerarHtmlCompra(cp, config) {
  const t = resolverTemaPdf(config);
  const viaVendedor    = gerarVia(cp, config, 'VIA DO VENDEDOR', t);
  const viaAssistencia = gerarVia(cp, config, 'VIA DA ASSISTÊNCIA', t);
  // Fonte inicial dos termos (0/ausente = mantém 7.8pt de fábrica).
  const fonteTermosInicial = resolverTamanhoFonteTermos(config, 7.8);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  body{
    font-family:'Arial','Helvetica Neue',sans-serif;
    background:#fff;font-size:11px;color:#111;line-height:1.4;
    --logo-h:${config.tamanhoLogoPdf||80}px;
    --fonte-termos:${fonteTermosInicial}pt;
  }
  .pagina{
    width:297mm;height:210mm;
    display:flex;flex-direction:row;align-items:stretch;
    overflow:hidden;position:relative;
  }
  .via{
    width:50%;padding:7mm 8mm 5mm;
    display:flex;flex-direction:column;overflow:hidden;
  }
  .linha-corte{
    width:1.5px;flex-shrink:0;
    background:repeating-linear-gradient(to bottom,#6b7280 0,#6b7280 5px,transparent 5px,transparent 10px);z-index:5;
  }
  .tesoura{
    position:absolute;top:50%;left:50%;
    transform:translate(-50%,-50%);
    background:#fff;border-radius:50%;padding:2px;z-index:10;
  }

  /* CABEÇALHO */
  .cabecalho{
    display:flex;align-items:flex-start;gap:8px;
    border-bottom:2px solid ${t.linhasDestaque};
    padding-bottom:6px;margin-bottom:5px;flex-shrink:0;
  }
  .logo-wrap{flex-shrink:0;background:#fff;border-radius:4px;}
  .logo-img{height:var(--logo-h,80px);width:auto;max-width:calc(var(--logo-h,80px) * 2.2);object-fit:contain;}
  .logo-mono{
    width:var(--logo-h,80px);height:var(--logo-h,80px);border-radius:5px;
    border:2px solid ${t.titulos};color:${t.titulos};
    display:flex;align-items:center;justify-content:center;
    font-size:14px;font-weight:800;
  }
  .emp-info{flex:1;min-width:0;}
  .emp-info h1{font-size:13px;font-weight:800;color:#000;line-height:1.2;margin-bottom:1px;}
  .emp-info p{font-size:9px;color:#555;line-height:1.35;margin-top:1px;overflow-wrap:anywhere;word-break:break-word;}
  .emp-cnpj{font-weight:700;color:${t.titulos}!important;}
  .num-box{text-align:right;flex-shrink:0;min-width:90px;}
  .num-label{font-size:8px;font-weight:700;color:${t.titulos};text-transform:uppercase;letter-spacing:.07em;}
  .num-val{font-size:18px;font-weight:900;color:${t.cabecalhos};line-height:1.1;}
  .num-data{font-size:9px;color:#555;margin-top:2px;}

  /* BADGE VIA */
  .via-label{
    text-align:center;font-size:9px;font-weight:800;
    color:#fff;background:${t.titulos};
    text-transform:uppercase;letter-spacing:.12em;
    border-radius:3px;margin-bottom:5px;padding:3px 0;flex-shrink:0;
  }

  /* SEÇÕES */
  .secoes{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:2.5px;}
  .secao{flex-shrink:0;border:1px solid ${t.bordas};border-radius:3px;overflow:hidden;}
  .secao-atencao .stit{background:#92400e!important;border-left-color:#d97706!important;}
  .secao-termos{flex:1;min-height:0;display:flex;flex-direction:column;}

  .stit{
    font-size:9px;font-weight:800;color:#fff;
    background:${t.cabecalhos};
    text-transform:uppercase;letter-spacing:.07em;
    padding:3px 10px;border-left:3px solid ${t.linhasDestaque};
  }
  .ssub{font-size:8.5px;font-weight:700;color:${t.titulos};padding:2px 10px 0;text-transform:uppercase;}

  /* Grade inline */
  .grade{display:flex;flex-wrap:wrap;gap:1.5px 6px;padding:3px 10px 4px;}
  .campo{display:flex;align-items:baseline;gap:3px;min-width:95px;}
  .rot{font-size:7px;color:#888;font-weight:700;white-space:nowrap;flex-shrink:0;text-transform:uppercase;}
  .rot::after{content:':';}
  .val{font-size:11px;color:#111;font-weight:600;word-break:break-word;}

  .tlivre{font-size:10px;color:#333;padding:3px 10px 4px;line-height:1.4;white-space:pre-wrap;}

  /* TERMOS */
  .termos-txt{
    font-size:var(--fonte-termos, 7.8pt);color:#1a1a1a;line-height:1.5;
    padding:3px 10px 4px;white-space:pre-wrap;text-align:justify;
    flex:1;overflow:hidden;
  }

  /* ASSINATURAS */
  .assinaturas{
    display:flex;justify-content:space-between;gap:12px;
    margin-top:6px;flex-shrink:0;
  }
  .assin-bloco{flex:1;text-align:center;display:flex;flex-direction:column;align-items:center;}
  .assin-esp{height:60px;width:100%;}
  .assin-linha{border-top:1.5px solid #222;width:90%;margin-bottom:4px;}
  .assin-label{font-size:9px;color:#111;font-weight:800;text-transform:uppercase;letter-spacing:.05em;line-height:1.2;}
  .assin-nome{font-size:10px;color:#333;margin-top:2px;font-weight:600;}
  .assin-cpf{font-size:9px;color:#555;margin-top:1px;}
  .assin-data{font-size:9px;color:#666;margin-top:3px;}

  /* RODAPÉ */
  .rodape-via{
    overflow-wrap:anywhere;word-break:break-word;
    margin-top:4px;padding-top:3px;
    border-top:1.5px solid ${t.rodapes};
    text-align:center;font-size:9px;color:#555;flex-shrink:0;
  }

  @page{size:A4 landscape;margin:0;}
  @media print{.pagina{page-break-inside:avoid;}}
</style>
</head>
<body>
  <div class="pagina">
    ${viaVendedor}
    <div class="linha-corte"></div>
    <div class="tesoura">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="6" cy="6" r="2.4" stroke="${t.elementosGraficos}" stroke-width="1.8"/>
        <circle cx="6" cy="18" r="2.4" stroke="${t.elementosGraficos}" stroke-width="1.8"/>
        <line x1="8" y1="7.5" x2="20" y2="17" stroke="${t.elementosGraficos}" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="8" y1="16.5" x2="20" y2="7" stroke="${t.elementosGraficos}" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    </div>
    ${viaAssistencia}
  </div>
<script>
  // Autofit: reduz fonte dos termos até o texto caber no espaço disponível.
  // IMPORTANTE: mede o overflow do PRÓPRIO elemento de texto (.termos-txt),
  // não da via inteira. A via é filha flex de .pagina (align-items:stretch)
  // com altura fixa (210mm) e overflow:hidden — nesse layout ela sempre se
  // estica pra preencher o espaço disponível, então via.scrollHeight é
  // sempre ~igual à altura fixa, independente do tamanho da fonte (bug
  // corrigido nesta sessão — sem essa correção, o autofit nunca convergia
  // de verdade e o texto ficava cortado). .termos-txt, em troca, tem
  // overflow:hidden real com altura definida pelo flex do pai (que agora
  // tem min-height:0 na cadeia .secoes/.secao-termos), então
  // scrollHeight > clientHeight é uma medição válida de overflow.
  (function() {
    document.querySelectorAll('.termos-txt').forEach(function(el) {
      var minPt = 5.5;
      var curPt = parseFloat(getComputedStyle(el).fontSize) || 7.8;
      var tentativas = 0;
      while (curPt > minPt && el.scrollHeight > el.clientHeight && tentativas < 60) {
        curPt -= 0.2;
        el.style.fontSize = curPt.toFixed(1) + 'pt';
        el.style.lineHeight = '1.35';
        tentativas++;
      }
    });
  })();
</script>
</body>
</html>`;
}

module.exports = { gerarHtmlCompra };
