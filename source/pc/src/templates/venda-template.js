// src/templates/venda-template.js
// Comprovante de Venda — folha A4 paisagem, DUAS VIAS lado a lado (50/50).
// Mesma estrutura e estilo da OS e Compra: cabeçalhos pretos, borda azul lateral,
// badge de via, linha tracejada central com tesoura, rodapé limpo (tel + email).

const { montarDadosEmpresa } = require('./empresa-compositor');
const { resolverTemaPdf } = require('./tema-pdf');
const { resolverTamanhoFonteTermos } = require('./fonte-termos-pdf');
const { TERMOS_VENDA } = require('../termos-predefinidos');

function resolverTermosVenda(item, config) {
  if (item.termosVenda && item.termosVenda.trim()) return item.termosVenda;
  if (config && config.termosVenda && config.termosVenda.trim()) return config.termosVenda;
  if (config && config.usarTermosPredefinidosVenda) return TERMOS_VENDA;
  return '';
}

const EQUIPAMENTO_CAMPOS_LABELS = {
  'Notebook': { numeroSerie:'Número de Série', processador:'Processador', memoriaRam:'Memória RAM', ssd:'SSD', hd:'HD', sistemaOperacional:'Sistema Operacional' },
  'Computador Desktop': { numeroSerie:'Número de Série', processador:'Processador', placaMae:'Placa-mãe', memoriaRam:'Memória RAM', ssd:'SSD', hd:'HD', fonte:'Fonte', placaVideo:'Placa de Vídeo', sistemaOperacional:'Sistema Operacional' },
  'All In One': { numeroSerie:'Número de Série', processador:'Processador', memoriaRam:'Memória RAM', ssd:'SSD', hd:'HD', sistemaOperacional:'Sistema Operacional' },
  'Monitor': { numeroSerie:'Número de Série', tamanho:'Tamanho' },
  'Impressora': { numeroSerie:'Número de Série', tipoImpressora:'Tipo' },
  'Videogame': { numeroSerie:'Número de Série' },
  'Outro': { numeroSerie:'Número de Série' },
  'Smartphone': {},
  'Tablet': {}
};

function e(t) {
  return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br/>');
}
function fmtData(iso) { try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso||''; } }
function fmtDataHora(iso) {
  try { const d=new Date(iso); return d.toLocaleDateString('pt-BR')+' às '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); } catch { return iso||''; }
}
function fmtMoeda(v) { return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function formatarGarantiaVenda(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  if (/^0(?:[.,]0+)?(?:\s*(?:dia(?:s)?|m[eê]s(?:es)?|ano(?:s)?))?$/i.test(texto)) {
    return 'Sem garantia';
  }
  return texto;
}
function campo(rotulo, valor) {
  if (!valor) return '';
  return `<div class="campo"><span class="rot">${rotulo}</span><span class="val">${e(valor)}</span></div>`;
}

function gerarVia(item, config, tituloVia, t) {
  const empresa = montarDadosEmpresa(config);

  const logoHtml = empresa.temLogo
    ? `<img src="${empresa.logoBase64}" alt="Logo" class="logo-img${config.logoPdfMonocromatica ? ' logo-pdf-monocromatica' : ''}"/>`
    : `<div class="logo-mono">${e(empresa.iniciais)}</div>`;

  const cnpjHtml = empresa.cnpj
    ? `<p class="emp-cnpj">CNPJ: ${e(empresa.cnpj)}${empresa.inscricaoEstadual?` &nbsp;·&nbsp; IE: ${e(empresa.inscricaoEstadual)}`:''}</p>` : '';
  const endHtml  = empresa.endereco ? `<p>${e(empresa.endereco)}</p>` : '';
  const ctHtml   = empresa.linhasContato.length ? `<p>${empresa.linhasContato.map(e).join(' &nbsp;·&nbsp; ')}</p>` : '';

  // Rodapé: só tel e email — SEM data duplicada
  const rodapeItens = [];
  if (empresa.telefoneRodape) rodapeItens.push(`<b>Tel:</b> ${e(empresa.telefoneRodape)}`);
  if (empresa.emailRodape)    rodapeItens.push(e(empresa.emailRodape));

  const termos = resolverTermosVenda(item, config);
  const garantia = formatarGarantiaVenda(item.garantia);

  return `
  <div class="via">
    <!-- CABEÇALHO -->
    <div class="cabecalho">
      <div class="logo-wrap">${logoHtml}</div>
      <div class="emp-info">
        <h1>${e(empresa.nome)}</h1>
        ${empresa.razaoSocialLinha?`<p>${e(empresa.razaoSocialLinha)}</p>`:''}
        ${cnpjHtml}${endHtml}${ctHtml}
      </div>
      <div class="num-box">
        <div class="num-label">COMPROVANTE DE VENDA</div>
        <div class="num-val">${e(item.id)}</div>
        <div class="num-data">Data: ${fmtData(item.dataVenda||new Date().toISOString())}</div>
        <div><span class="badge"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;margin:0 2px 1px 0"><path d="M20 6L9 17L4 12" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg> Vendido</span></div>
      </div>
    </div>

    <!-- BADGE VIA -->
    <div class="via-label">${tituloVia}</div>

    <div class="secoes">
      <!-- APARELHO -->
      <div class="secao">
        <div class="stit">APARELHO</div>
        <div class="grade">
          ${campo('MARCA', item.marca)}
          ${campo('MODELO', item.modelo)}
          ${item.tipoEquipamento&&item.tipoEquipamento!=='Smartphone'?campo('TIPO', item.tipoEquipamento):''}
          ${campo('COR', item.cor)}
          ${campo('IMEI', item.imei)}
          ${Object.entries(EQUIPAMENTO_CAMPOS_LABELS[item.tipoEquipamento]||{})
            .filter(([id])=>(item.dadosEquipamento||{})[id])
            .map(([id,label])=>campo(label.toUpperCase(),(item.dadosEquipamento||{})[id])).join('')}
          ${campo('OBSERVAÇÕES', item.observacoes)}
        </div>
      </div>

      <!-- COMPRADOR -->
      <div class="secao">
        <div class="stit">COMPRADOR</div>
        <div class="grade">
          ${campo('NOME', item.compradorNome||'—')}
          ${campo('ID DO CLIENTE', item.compradorClienteId || '00000')}
          ${campo('CPF', item.compradorCpf||'—')}
          ${campo('TELEFONE', item.compradorTelefone)}
          ${campo('E-MAIL', item.compradorEmail)}
        </div>
      </div>

      <!-- VALORES -->
      <div class="secao">
        <div class="stit">VALORES</div>
        <div class="grade grade-valores">
          <div class="campo"><span class="rot">VALOR DA VENDA</span><span class="val val-destaque">${fmtMoeda(item.valorVenda)}</span></div>
          ${campo('GARANTIA', garantia)}
          ${campo('FORMA DE PAGAMENTO', item.formaPagamento)}
        </div>
      </div>

      <!-- TERMOS E CONDIÇÕES -->
      ${termos ? `
      <div class="secao secao-termos">
        <div class="stit">TERMOS E CONDIÇÕES</div>
        <div class="termos-txt">${e(termos)}</div>
      </div>` : ''}
    </div>

    <!-- ASSINATURAS -->
    <div class="assinaturas">
      <div class="assin-bloco">
        <div class="assin-esp"></div>
        <div class="assin-linha"></div>
        <div class="assin-label">ASSINATURA DA ASSISTÊNCIA TÉCNICA</div>
        <div class="assin-nome">${e(empresa.nome)}</div>
        <div class="assin-data">Data: _____ / _____ / ___________</div>
      </div>
      <div class="assin-bloco">
        <div class="assin-esp"></div>
        <div class="assin-linha"></div>
        <div class="assin-label">ASSINATURA DO COMPRADOR</div>
        <div class="assin-nome">${e(item.compradorNome||'')}</div>
        <div class="assin-data">Data: _____ / _____ / ___________</div>
      </div>
    </div>

    <!-- RODAPÉ -->
    ${rodapeItens.length ? `
    <div class="rodape-via">
      <span>${rodapeItens.join(' &nbsp;·&nbsp; ')}</span>
    </div>` : ''}
  </div>`;
}

function gerarHtmlVenda(item, config) {
  const t = resolverTemaPdf(config);
  const viaComprador   = gerarVia(item, config, 'VIA DO COMPRADOR', t);
  const viaAssistencia = gerarVia(item, config, 'VIA DA ASSISTÊNCIA', t);
  // Fonte inicial dos termos (0/ausente = mantém 8.5pt de fábrica).
  const fonteTermosInicial = resolverTamanhoFonteTermos(config, 8.5);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{
    font-family:'Arial','Helvetica Neue',sans-serif;
    color:#111;background:#fff;
    font-size:11px;line-height:1.4;
    width:297mm;height:210mm;
    --logo-h:${config.tamanhoLogoPdf||80}px;
    --fonte-termos:${fonteTermosInicial}pt;
  }
  .pagina{
    position:relative;width:297mm;height:210mm;
    display:flex;flex-direction:row;
  }
  .linha-corte{
    position:absolute;top:0;bottom:0;left:50%;
    width:0;border-left:1.5px dashed #6b7280;z-index:5;
  }
  .tesoura{
    position:absolute;left:50%;top:8mm;
    transform:translate(-50%,-50%);
    background:#fff;display:flex;align-items:center;justify-content:center;
    width:20px;height:20px;padding:2px;z-index:6;
  }

  /* VIA */
  .via{
    width:50%;height:210mm;
    padding:7mm 8mm 5mm;
    display:flex;flex-direction:column;overflow:hidden;
  }

  /* CABEÇALHO */
  .cabecalho{
    display:flex;align-items:flex-start;gap:8px;
    border-bottom:2.5px solid ${t.linhasDestaque};
    padding-bottom:6px;margin-bottom:5px;flex-shrink:0;
  }
  .logo-wrap{flex-shrink:0;background:#fff;border-radius:4px;}
  .logo-img{height:var(--logo-h,80px);width:auto;max-width:calc(var(--logo-h,80px) * 2.2);object-fit:contain;}
  .logo-pdf-monocromatica{filter:grayscale(1) brightness(0) contrast(1.4);}
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
  .num-box{text-align:right;flex-shrink:0;min-width:110px;}
  .num-label{font-size:7.5px;text-transform:uppercase;letter-spacing:.1em;color:#666;font-weight:700;}
  .num-val{font-size:20px;font-weight:900;color:${t.titulos};line-height:1.1;}
  .num-data{font-size:9px;color:#555;margin-top:2px;}
  .badge{
    display:inline-block;padding:2px 7px;border-radius:3px;
    font-size:8px;font-weight:800;background:${t.cabecalhos};
    color:#fff;margin-top:3px;letter-spacing:.04em;text-transform:uppercase;
  }

  /* BADGE VIA */
  .via-label{
    align-self:flex-start;font-size:9px;font-weight:800;
    letter-spacing:.13em;text-transform:uppercase;
    color:#fff;background:${t.titulos};
    padding:3px 12px;border-radius:3px;margin-bottom:5px;flex-shrink:0;
  }

  /* SEÇÕES */
  .secoes{display:flex;flex-direction:column;gap:3px;flex:1;min-height:0;overflow:hidden;}
  .secao{border:1px solid ${t.bordas};border-radius:3px;overflow:hidden;flex-shrink:0;}
  .stit{
    background:${t.cabecalhos};color:#fff;
    font-size:9px;font-weight:800;
    text-transform:uppercase;letter-spacing:.07em;
    padding:3px 10px;border-left:3px solid ${t.linhasDestaque};line-height:1.3;
  }

  /* Grade de campos */
  .grade{display:flex;flex-wrap:wrap;gap:1.5px 6px;padding:3px 10px 4px;}
  .campo{display:flex;align-items:baseline;gap:3px;min-width:95px;}
  .grade-valores{display:grid;grid-template-columns:1.2fr .85fr 1.45fr;align-items:center;gap:6px;}
  .grade-valores .campo{min-width:0;align-items:center;}
  .rot{font-size:7px;color:#888;font-weight:700;white-space:nowrap;flex-shrink:0;text-transform:uppercase;}
  .rot::after{content:':';}
  .val{font-size:11px;color:#111;font-weight:600;word-break:break-word;}
  .val-destaque{font-size:14px!important;color:${t.titulos}!important;font-weight:800!important;}

  /* TERMOS */
  .secao-termos{flex:1;min-height:0;display:flex;flex-direction:column;}
  .termos-txt{
    font-size:var(--fonte-termos, 8.5pt);color:#1a1a1a;line-height:1.55;
    padding:3px 10px 4px;white-space:pre-wrap;text-align:justify;
    flex:1;overflow:hidden;
  }

  /* ASSINATURAS */
  .assinaturas{
    display:flex;justify-content:space-between;gap:14px;
    margin-top:7px;padding-top:2px;flex-shrink:0;
  }
  .assin-bloco{flex:1;text-align:center;display:flex;flex-direction:column;align-items:center;}
  .assin-esp{height:40px;width:100%;}
  .assin-linha{border-top:1.5px solid #222;width:90%;margin-bottom:5px;}
  .assin-label{font-size:9px;color:#111;font-weight:800;text-transform:uppercase;letter-spacing:.05em;line-height:1.3;}
  .assin-nome{font-size:10px;color:#333;margin-top:2px;font-weight:600;}
  .assin-data{font-size:9px;color:#666;margin-top:3px;}

  /* RODAPÉ */
  .rodape-via{
    overflow-wrap:anywhere;word-break:break-word;
    margin-top:5px;padding-top:4px;
    border-top:1.5px solid ${t.rodapes};
    text-align:center;font-size:9px;color:#555;flex-shrink:0;
  }

  @page{size:A4 landscape;margin:0;}
  @media print{.pagina{page-break-inside:avoid;}}
</style>
</head>
<body>
  <div class="pagina">
    ${viaComprador}
    <div class="linha-corte"></div>
    <div class="tesoura">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
  // Mede o overflow do PRÓPRIO elemento (.termos-txt), não da via inteira
  // — ver explicação detalhada no mesmo bloco em os-template.js (bug de
  // métrica identificado e corrigido nesta sessão).
  (function() {
    document.querySelectorAll('.termos-txt').forEach(function(el) {
      var minPt = 5.5;
      var curPt = parseFloat(getComputedStyle(el).fontSize) || 8.5;
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

module.exports = { gerarHtmlVenda };
