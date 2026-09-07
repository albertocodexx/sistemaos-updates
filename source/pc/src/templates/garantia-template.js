// src/templates/garantia-template.js
// ─────────────────────────────────────────────────────────────────────────
// Comprovante de Garantia — via ÚNICA, retrato A4. Gerado manualmente no PC
// (aba Garantia): usuário digita o nº da OS, o sistema puxa cliente/aparelho
// dela, e o usuário define prazo (dias) + termos. Documento informativo pra
// entregar/mostrar ao cliente — sem bloco de assinatura (diferente de
// entrega-template.js, que é assinado no celular na hora da retirada).
// Mesmo padrão visual (cores via tema-pdf, dados da empresa via
// empresa-compositor) dos outros documentos do sistema.
// ─────────────────────────────────────────────────────────────────────────

const { montarDadosEmpresa } = require('./empresa-compositor');
const { resolverTemaPdf } = require('./tema-pdf');
const { TERMOS_GARANTIA } = require('../termos-predefinidos');
const { resolverTamanhoFonteTermos } = require('./fonte-termos-pdf');

// Mesma regra de prioridade usada em resolverTermosOS/Venda/Compra:
// 1) texto já salvo na própria garantia (o que o usuário digitou/editou
//    na aba Garantia tem sempre prioridade); 2) termos personalizados
//    configurados em Configurações; 3) termos predefinidos do sistema,
//    só se o checkbox "usar termos predefinidos" estiver ligado.
function resolverTermosGarantia(g, config) {
  if (Object.prototype.hasOwnProperty.call(g, 'termos')) return String(g.termos ?? '');
  if (config.termosGarantia && config.termosGarantia.trim()) return config.termosGarantia;
  if (config.usarTermosPredefinidosGarantia) return TERMOS_GARANTIA;
  return '';
}

function e(t) {
  return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br/>');
}
function formatarDataSimples(iso) {
  const value = String(iso || '');
  const date = new Date(value.length === 10 ? value + 'T12:00:00' : value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
}
function campo(rotulo, valor) {
  if (!String(valor||'').trim()) return '';
  return `<div class="campo"><span class="rot">${rotulo}</span><span class="val">${e(valor)}</span></div>`;
}
function temConteudo(valor) {
  return !!String(valor||'').trim();
}

function gerarHtmlGarantia(g, config) {
  const t = resolverTemaPdf(config);
  const empresa = montarDadosEmpresa(config);
  // Fonte inicial dos termos (0/ausente = mantém 8pt de fábrica, já reduzido
  // do padrão antigo de 10.5pt para caber melhor numa via única).
  const fonteTermosInicial = resolverTamanhoFonteTermos(config, 8);

  const logoHtml = empresa.temLogo
    ? `<img src="${empresa.logoBase64}" alt="Logo" class="logo-img${config.logoPdfMonocromatica ? ' logo-pdf-monocromatica' : ''}"/>`
    : `<div class="logo-mono">${e(empresa.iniciais)}</div>`;

  const cnpjHtml = empresa.cnpj
    ? `<p class="emp-cnpj">CNPJ: ${e(empresa.cnpj)}${empresa.inscricaoEstadual?` · IE: ${e(empresa.inscricaoEstadual)}`:''}</p>` : '';
  const endHtml  = empresa.endereco ? `<p>${e(empresa.endereco)}</p>` : '';
  const ctHtml   = empresa.linhasContato.length ? `<p>${empresa.linhasContato.map(e).join(' · ')}</p>` : '';

  const rodapeItens = [];
  if (empresa.telefoneRodape) rodapeItens.push(`<b>Tel:</b> ${e(empresa.telefoneRodape)}`);
  if (empresa.emailRodape)    rodapeItens.push(e(empresa.emailRodape));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  body{
    font-family:'Arial','Helvetica Neue',sans-serif;
    background:#fff;font-size:12px;color:#111;line-height:1.4;
    --logo-h:${config.tamanhoLogoPdf||80}px;
    --fonte-termos:${fonteTermosInicial}pt;
  }
  .pagina{width:210mm;min-height:297mm;padding:10mm 14mm;display:flex;flex-direction:column;}

  .cabecalho{
    display:flex;align-items:flex-start;gap:10px;
    border-bottom:2px solid ${t.linhasDestaque};
    padding-bottom:7px;margin-bottom:10px;flex-shrink:0;
  }
  .logo-wrap{flex-shrink:0;background:#fff;border-radius:4px;}
  .logo-img{height:var(--logo-h,80px);width:auto;max-width:calc(var(--logo-h,80px) * 2.2);object-fit:contain;}
  .logo-pdf-monocromatica{filter:grayscale(1) brightness(0) contrast(1.4);}
  .logo-mono{
    width:var(--logo-h,80px);height:var(--logo-h,80px);border-radius:6px;
    border:2px solid ${t.titulos};color:${t.titulos};
    display:flex;align-items:center;justify-content:center;
    font-size:16px;font-weight:800;
  }
  .emp-info{flex:1;min-width:0;}
  .emp-info h1{font-size:16px;font-weight:800;color:#000;line-height:1.25;margin-bottom:2px;}
  .emp-info p{font-size:10px;color:#555;line-height:1.4;margin-top:1px;overflow-wrap:anywhere;word-break:break-word;}
  .emp-cnpj{font-weight:700;color:${t.titulos}!important;}
  .num-box{text-align:right;flex-shrink:0;min-width:140px;}
  .num-label{font-size:9px;font-weight:700;color:${t.titulos};text-transform:uppercase;letter-spacing:.08em;}
  .num-val{font-size:19px;font-weight:900;color:${t.cabecalhos};line-height:1.15;}
  .num-data{font-size:10px;color:#555;margin-top:3px;}

  .selo{
    display:flex;align-items:center;justify-content:center;gap:8px;
    background:${t.titulos};color:#fff;border-radius:6px;
    padding:7px 14px;margin-bottom:10px;flex-shrink:0;
  }
  .selo-icone{display:inline-flex;align-items:center;justify-content:center;}
  .selo-txt{text-align:center;}
  .selo-txt .l1{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;opacity:.9;}
  .selo-txt .l2{font-size:18px;font-weight:900;}

  .secoes{display:flex;flex-direction:column;gap:6px;flex:1;}
  .secao{border:1px solid ${t.bordas};border-radius:5px;overflow:hidden;}
  .stit{
    font-size:10px;font-weight:800;color:#fff;
    background:${t.cabecalhos};
    text-transform:uppercase;letter-spacing:.07em;
    padding:4px 12px;border-left:4px solid ${t.linhasDestaque};
  }
  .grade{display:flex;flex-wrap:wrap;gap:3px 14px;padding:6px 12px 7px;}
  .campo{display:flex;align-items:baseline;gap:4px;min-width:150px;}
  .rot{font-size:8px;color:#888;font-weight:700;white-space:nowrap;flex-shrink:0;text-transform:uppercase;}
  .rot::after{content:':';}
  .val{font-size:12px;color:#111;font-weight:600;word-break:break-word;}

  .secao-sub{
    font-size:9.5px;font-weight:800;text-transform:uppercase;
    letter-spacing:.06em;color:${t.titulos};padding:6px 12px 0;
  }
  .texto-livre{
    font-size:12px;color:#1a1a1a;line-height:1.55;
    padding:3px 12px 10px;white-space:pre-wrap;word-break:break-word;
  }
  .termos-txt{
    font-size:var(--fonte-termos, 8pt);color:#1a1a1a;line-height:1.4;
    padding:6px 12px 8px;white-space:pre-wrap;text-align:justify;
  }

  .rodape-via{
    overflow-wrap:anywhere;word-break:break-word;
    margin-top:16px;padding-top:10px;border-top:1.5px solid ${t.rodapes};
    text-align:center;font-size:9.5px;color:#555;flex-shrink:0;
  }
  .rodape-via .aviso{font-size:9px;color:#888;margin-top:4px;font-style:italic;}

  @page{size:A4 portrait;margin:0;}
  @media print{
    .secao{page-break-inside:avoid;}
    .cabecalho,.selo{page-break-inside:avoid;}
  }
</style>
</head>
<body>
  <div class="pagina">
    <div class="cabecalho">
      <div class="logo-wrap">${logoHtml}</div>
      <div class="emp-info">
        <h1>${e(empresa.nome)}</h1>
        ${empresa.razaoSocialLinha?`<p>${e(empresa.razaoSocialLinha)}</p>`:''}
        ${cnpjHtml}${endHtml}${ctHtml}
      </div>
      <div class="num-box">
        <div class="num-label">COMPROVANTE DE GARANTIA</div>
        <div class="num-val">${e(g.numeroOS)}</div>
        <div class="num-data">Emitido em ${formatarDataSimples(g.dataInicio)}</div>
      </div>
    </div>

    <div class="selo">
      <span class="selo-icone"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L4 5V11C4 16.55 7.84 21.74 12 23C16.16 21.74 20 16.55 20 11V5L12 2Z" fill="#ffffff"/></svg></span>
      <div class="selo-txt">
        <div class="l1">Prazo de garantia</div>
        <div class="l2">${Number(g.garantiaDias) > 0 ? `${Number(g.garantiaDias)} dias — válida até ${formatarDataSimples(g.dataLimite)}` : 'Sem garantia adicional'}</div>
      </div>
    </div>

    <div class="secoes">
      <div class="secao">
        <div class="stit">DADOS DO CLIENTE</div>
        <div class="grade">
          ${campo('NOME', g.clienteNome)}
          ${campo('ID DO CLIENTE', g.clienteNumero || g.clienteId || '00000')}
          ${campo('TELEFONE', g.clienteTelefone)}
          ${campo('CPF', g.clienteCpf)}
        </div>
      </div>

      ${(temConteudo(g.marca) || temConteudo(g.modelo) || temConteudo(g.imei) || temConteudo(g.servicoRealizado)) ? `
      <div class="secao">
        <div class="stit">DADOS DO APARELHO</div>
        ${(temConteudo(g.marca) || temConteudo(g.modelo) || temConteudo(g.imei)) ? `
        <div class="grade">
          ${campo('MARCA', g.marca)}
          ${campo('MODELO', g.modelo)}
          ${campo('IMEI/SÉRIE', g.imei)}
        </div>` : ''}
        ${temConteudo(g.servicoRealizado) ? `
        <div class="secao-sub">SERVIÇO REALIZADO</div>
        <div class="texto-livre">${e(g.servicoRealizado)}</div>` : ''}
      </div>` : ''}

      <div class="secao">
        <div class="stit">PERÍODO DE GARANTIA</div>
        <div class="grade">
          ${campo('PRAZO', Number(g.garantiaDias) > 0 ? g.garantiaDias + ' dias' : 'Sem garantia adicional')}
          ${campo('INÍCIO', formatarDataSimples(g.dataInicio))}
          ${campo('VÁLIDA ATÉ', g.dataLimite ? formatarDataSimples(g.dataLimite) : '—')}
        </div>
      </div>

      ${(() => { const termosResolvidos = resolverTermosGarantia(g, config); return temConteudo(termosResolvidos) ? `
      <div class="secao">
        <div class="stit">TERMOS E CONDIÇÕES DA GARANTIA</div>
        <div class="termos-txt">${e(termosResolvidos)}</div>
      </div>` : ''; })()}
    </div>

    <div class="rodape-via">
      ${rodapeItens.length ? `<span>${rodapeItens.join(' &nbsp;·&nbsp; ')}</span>` : ''}
      <div class="aviso">Este documento é um comprovante informativo de garantia referente à ${e(g.numeroOS)}.</div>
    </div>
  </div>
<script>
  // Autofit: reduz fonte dos termos até o documento caber numa única
  // página A4 (297mm). Diferente do autofit da OS (via fixa 210mm com
  // overflow:hidden): aqui a .pagina tem min-height:297mm e cresce
  // livremente, então quem "vaza" é a altura total do documento, não
  // o overflow interno de um elemento. Por isso medimos
  // .pagina.scrollHeight contra os 297mm em pixels.
  (function() {
    var pagina = document.querySelector('.pagina');
    var termos = document.querySelector('.termos-txt');
    if (!pagina || !termos) return;
    var limitePx = 297 * 3.7795; // 297mm em px (96dpi)
    var minPt = 8; // via única A4 — mantém confortável para leitura
    var curPt = parseFloat(getComputedStyle(termos).fontSize) || 8;
    var tentativas = 0;
    while (curPt > minPt && pagina.scrollHeight > limitePx && tentativas < 60) {
      curPt -= 0.2;
      termos.style.fontSize = curPt.toFixed(1) + 'pt';
      termos.style.lineHeight = '1.3';
      tentativas++;
    }
  })();
</script>
</body>
</html>`;
}

module.exports = { gerarHtmlGarantia };
