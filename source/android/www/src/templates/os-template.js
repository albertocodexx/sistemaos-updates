// src/templates/os-template.js
// PDF da Ordem de Serviço — Via do Cliente e Via da Assistência LADO A LADO
// Folha A4 paisagem (50/50). Estilo escuro com cabeçalhos pretos, texto compacto
// para caber todos os termos. Linha tracejada central de recorte.

const { montarDadosEmpresa } = require('./empresa-compositor');
const { resolverTemaPdf } = require('./tema-pdf');
const { TERMOS_OS } = require('../termos-predefinidos');

function resolverTermosOS(os, config) {
  if (os.termos && os.termos.trim()) return os.termos;
  if (config.termosOS && config.termosOS.trim()) return config.termosOS;
  if (config.usarTermosPredefinidosOS) {
    // "Predefinido" é o padrão DO USUÁRIO (Configurações > "Definir como
    // novo padrão"), se já definido; senão, o texto de fábrica (TERMOS_OS).
    if (config.termosPadraoUsuarioOS && config.termosPadraoUsuarioOS.trim()) {
      return config.termosPadraoUsuarioOS;
    }
    return TERMOS_OS;
  }
  return '';
}

// Tamanho de fonte inicial dos termos (pt), ajustável pelo usuário em
// Configurações (config.tamanhoFonteTermosPdf). 0/ausente = mantém o
// tamanho de fábrica original deste template (7.8pt). O autofit do script
// no final do documento ainda pode reduzir a partir daqui se o texto não
// couber na via — nunca abaixo de FONTE_TERMOS_MIN_PT — então o valor
// escolhido pelo usuário é um ponto de partida, não uma garantia final de
// tamanho impresso quando o texto for muito longo.
const FONTE_TERMOS_FABRICA_PT = 7.8;
const FONTE_TERMOS_MIN_PT = 5.5;
const FONTE_TERMOS_MAX_PT = 14;
function resolverTamanhoFonteTermos(config) {
  const valor = Number(config && config.tamanhoFonteTermosPdf);
  if (!valor || isNaN(valor)) return FONTE_TERMOS_FABRICA_PT;
  return Math.min(FONTE_TERMOS_MAX_PT, Math.max(FONTE_TERMOS_MIN_PT, valor));
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

function escapeHtml(t) {
  return String(t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br/>');
}
function fmtMoeda(v) { return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function formatarData(iso) {
  try { const d=new Date(iso); return d.toLocaleDateString('pt-BR')+' às '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); } catch { return iso; }
}
function formatarDataPrevista(dataISO, hora) {
  // dataISO normalmente vem de um <input type="date"> (formato garantido
  // AAAA-MM-DD puro, sem hora). Mas documentos-recebidos.js também chama
  // este template com dados JSON importados do PC (registro.dados), sem
  // nenhuma normalização — se o PC gravar a data como um ISO datetime
  // completo (ex.: "2026-07-15T00:00:00.000Z"), o split abaixo quebraria
  // sem o corte pelo 'T' feito aqui ("d" sairia "15T00:00:00.000Z").
  // Cortamos só a parte antes do 'T' (se houver) e mantemos o split
  // manual por '-' (em vez de new Date()) de propósito: new Date() em
  // fusos atrás de UTC (ex. Brasil, UTC-3) interpretaria a meia-noite UTC
  // como o dia anterior no horário local, fazendo a data "voltar um dia".
  try { const [a,m,d]=String(dataISO).split('T')[0].split('-'); return hora?`${d}/${m}/${a} às ${hora}`:`${d}/${m}/${a}`; } catch { return dataISO; }
}
function campo(rotulo, valor) {
  if (!valor) return '';
  return `<div class="campo"><span class="rotulo">${rotulo}</span><span class="valor">${escapeHtml(valor)}</span></div>`;
}

function gerarVia(os, config, tituloVia, t) {
  const empresa = montarDadosEmpresa(config);
  const c = os.cliente || {};
  const a = os.aparelho || {};
  const diag = os.diagnosticoTecnico || {};
  const imei = os.imei || a.imei || '';

  const logoHtml = empresa.temLogo
    ? `<img src="${empresa.logoBase64}" alt="Logo" class="logo-img${config.logoPdfMonocromatica ? ' logo-pdf-monocromatica' : ''}" />`
    : `<div class="logo-monograma">${escapeHtml(empresa.iniciais)}</div>`;

  const cnpjHtml = empresa.cnpj
    ? `<p class="empresa-cnpj">CNPJ: ${escapeHtml(empresa.cnpj)}${empresa.inscricaoEstadual ? ` &nbsp;·&nbsp; IE: ${escapeHtml(empresa.inscricaoEstadual)}` : ''}</p>` : '';
  const enderecoHtml = empresa.endereco ? `<p>${escapeHtml(empresa.endereco)}</p>` : '';
  const contatoHtml = empresa.linhasContato.length
    ? `<p>${empresa.linhasContato.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</p>` : '';

  // Rodapé: só tel e email — SEM data duplicada
  const rodapeItens = [];
  if (empresa.telefoneRodape) rodapeItens.push(`<b>Tel:</b> ${escapeHtml(empresa.telefoneRodape)}`);
  if (empresa.emailRodape)    rodapeItens.push(`${escapeHtml(empresa.emailRodape)}`);

  return `
  <div class="via">
    <!-- CABEÇALHO -->
    <div class="cabecalho">
      <div class="empresa-logo">${logoHtml}</div>
      <div class="empresa-info">
        <h1>${escapeHtml(empresa.nome)}</h1>
        ${empresa.razaoSocialLinha ? `<p>${escapeHtml(empresa.razaoSocialLinha)}</p>` : ''}
        ${cnpjHtml}${enderecoHtml}${contatoHtml}
      </div>
      <div class="os-numero-box">
        <div class="os-label">ORDEM DE SERVIÇO</div>
        <div class="os-num">${escapeHtml(os.numero)}</div>
        <div class="os-data">${formatarData(os.data)}</div>
        ${os.status ? `<div class="os-status-badge">${escapeHtml(os.status)}</div>` : ''}
        ${os.dataPrevista ? `<div class="os-previsao${os.atrasada?' atrasada':''}">Prev.: ${escapeHtml(formatarDataPrevista(os.dataPrevista, os.horaPrevista))}${os.atrasada?' ⚠ ATRASADA':''}</div>` : ''}
      </div>
    </div>

    <!-- BADGE VIA -->
    <div class="via-label">${tituloVia}</div>

    <div class="secoes">
      <!-- DADOS DO CLIENTE -->
      <div class="secao">
        <div class="secao-titulo">DADOS DO CLIENTE</div>
        <div class="grade">
          ${campo('NOME', c.nome)}
          ${campo('CPF', c.cpf)}
          ${campo('TELEFONE', c.telefone)}
          ${campo('E-MAIL', c.email)}
        </div>
      </div>

      ${(os.tecnicoResponsavel || os.tecnicoAuxiliar) ? `
      <div class="secao">
        <div class="secao-titulo">RESPONSÁVEL TÉCNICO</div>
        <div class="grade">
          ${campo('TÉCNICO', os.tecnicoResponsavel)}
          ${campo('AUXILIAR', os.tecnicoAuxiliar)}
        </div>
      </div>` : ''}

      <!-- DADOS DO APARELHO -->
      <div class="secao">
        <div class="secao-titulo">DADOS DO APARELHO</div>
        <div class="grade">
          ${campo('TIPO DE EQUIPAMENTO', a.tipoEquipamento || a.tipo)}
          ${campo('MARCA', a.marca)}
          ${campo('MODELO', a.modelo)}
          ${campo('COR', a.cor)}
          ${campo('IMEI', imei)}
          ${Object.entries(EQUIPAMENTO_CAMPOS_LABELS[a.tipoEquipamento]||{}).map(([id,label])=>campo(label.toUpperCase(),(a.dadosEquipamento||{})[id])).join('')}
          ${campo('SENHA', a.senhaAparelho)}
          ${campo('ACESSÓRIOS', a.acessorios)}
          ${(a.acessoriosChecklist&&a.acessoriosChecklist.length)?campo('ACESSÓRIOS RECEBIDOS',a.acessoriosChecklist.join(', ')):''}
          ${(a.testesEntrada&&a.testesEntrada.length)?campo('TESTES ENTRADA OK',a.testesEntrada.join(', ')):''}
        </div>
      </div>

      <!-- DEFEITO RELATADO -->
      ${(a.defeitoRelatado||os.observacoes||(a.checklistDefeitos&&a.checklistDefeitos.length)) ? `
      <div class="secao">
        <div class="secao-titulo">DEFEITO RELATADO</div>
        ${(a.checklistDefeitos&&a.checklistDefeitos.length)?`<div class="secao-sub">DEFEITOS NO CHECKLIST</div><div class="texto-livre">${escapeHtml(a.checklistDefeitos.join(', '))}</div>`:''}
        ${a.defeitoRelatado?`<div class="secao-sub">INFORMADO PELO CLIENTE</div><div class="texto-livre">${escapeHtml(a.defeitoRelatado)}</div>`:''}
        ${os.observacoes?`<div class="secao-sub">OBSERVAÇÕES</div><div class="texto-livre">${escapeHtml(os.observacoes)}</div>`:''}
      </div>` : ''}

      <!-- DIAGNÓSTICO E ORÇAMENTO -->
      ${(diag.diagnostico||diag.solucao||diag.pecas||diag.valorEstimado||diag.prazoEstimado) ? `
      <div class="secao">
        <div class="secao-titulo">DIAGNÓSTICO E ORÇAMENTO</div>
        ${diag.diagnostico?`<div class="secao-sub">DIAGNÓSTICO</div><div class="texto-livre">${escapeHtml(diag.diagnostico)}</div>`:''}
        ${diag.solucao?`<div class="secao-sub">SOLUÇÃO</div><div class="texto-livre">${escapeHtml(diag.solucao)}</div>`:''}
        ${diag.pecas?`<div class="secao-sub">PEÇAS</div><div class="texto-livre">${escapeHtml(diag.pecas)}</div>`:''}
        ${(diag.valorEstimado||diag.prazoEstimado)?`<div class="grade">${campo('VALOR ESTIMADO',diag.valorEstimado?fmtMoeda(diag.valorEstimado):'')}${campo('PRAZO',diag.prazoEstimado)}</div>`:''}
      </div>` : ''}

      <!-- TERMOS E CONDIÇÕES -->
      <!-- BUGFIX: só desenha a seção quando há texto de termos, igual já
           funciona em venda-template.js e compra-template.js. Antes, esta
           caixa aparecia sempre, mesmo com resolverTermosOS() vazio
           (usuário desligou "usar termos predefinidos" e não escreveu
           nada customizado) — resultando numa caixa "TERMOS E CONDIÇÕES
           DA ORDEM DE SERVIÇO" com título mas sem nenhum conteúdo no PDF. -->
      ${resolverTermosOS(os, config) ? `
      <div class="secao secao-termos">
        <div class="secao-titulo">TERMOS E CONDIÇÕES DA ORDEM DE SERVIÇO</div>
        <div class="termos-texto">${escapeHtml(resolverTermosOS(os, config))}</div>
      </div>` : ''}
    </div>

    <!-- ASSINATURAS -->
    <div class="assinaturas">
      <div class="assinatura-bloco">
        <div class="assinatura-espaco"></div>
        <div class="linha-assinatura"></div>
        <div class="assinatura-label">ASSINATURA DO CLIENTE</div>
        <div class="assinatura-nome">${escapeHtml(c.nome||'')}</div>
        <div class="assinatura-data">Data: _____ / _____ / ___________</div>
      </div>
      <div class="assinatura-bloco">
        <div class="assinatura-espaco"></div>
        <div class="linha-assinatura"></div>
        <div class="assinatura-label">ASSINATURA DA ASSISTÊNCIA TÉCNICA</div>
        <div class="assinatura-nome">${escapeHtml(empresa.nome)}</div>
        <div class="assinatura-data">Data: _____ / _____ / ___________</div>
      </div>
    </div>

    <!-- RODAPÉ -->
    ${rodapeItens.length ? `
    <div class="rodape-via">
      <span>${rodapeItens.join(' &nbsp;·&nbsp; ')}</span>
    </div>` : ''}
  </div>`;
}

function gerarHtmlOS(os, config) {
  const t = resolverTemaPdf(config);
  const viaCliente     = gerarVia(os, config, 'VIA DO CLIENTE', t);
  const viaAssistencia = gerarVia(os, config, 'VIA DA ASSISTÊNCIA', t);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{
    font-family:'Arial','Helvetica Neue',sans-serif;
    color:#111;background:#fff;
    font-size:11px;line-height:1.4;
    width:297mm;height:210mm;
    --logo-h:${config.tamanhoLogoPdf||80}px;
    --fonte-termos:${resolverTamanhoFonteTermos(config)}pt;
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
    display:flex;align-items:center;gap:9px;
    border-bottom:2.5px solid ${t.linhasDestaque};
    padding-bottom:7px;margin-bottom:6px;flex-shrink:0;
  }
  .empresa-logo{flex-shrink:0;background:#fff;border-radius:4px;display:flex;align-items:center;justify-content:center;}
  .logo-img{display:block;max-height:var(--logo-h,80px);max-width:calc(var(--logo-h,80px) * 2.2);object-fit:contain;}
  .logo-pdf-monocromatica{filter:grayscale(1) brightness(0) contrast(1.4);}
  .logo-monograma{
    width:var(--logo-h,80px);height:var(--logo-h,80px);display:flex;align-items:center;justify-content:center;
    border:2px solid ${t.bordas};border-radius:5px;
    font-size:16px;font-weight:900;color:${t.bordas};
  }
  .empresa-info{flex:1;min-width:0;}
  .empresa-info h1{font-size:13px;font-weight:800;color:#000;margin-bottom:2px;line-height:1.2;}
  .empresa-info p{font-size:9px;color:#444;margin:1px 0;line-height:1.35;overflow-wrap:anywhere;word-break:break-word;}
  .empresa-cnpj{font-weight:700;color:${t.titulos}!important;}
  .os-numero-box{text-align:right;flex-shrink:0;min-width:110px;}
  .os-label{font-size:7.5px;text-transform:uppercase;letter-spacing:.1em;color:#666;font-weight:700;}
  .os-num{font-size:21px;font-weight:900;color:${t.titulos};line-height:1.1;}
  .os-data{font-size:9px;color:#555;margin-top:2px;}
  .os-status-badge{
    margin-top:3px;font-size:8px;font-weight:800;color:#fff;
    text-transform:uppercase;letter-spacing:.05em;
    background:${t.cabecalhos};border-radius:3px;padding:2px 7px;display:inline-block;
  }

  .os-previsao{font-size:8.5px;color:#555;margin-top:2px;font-weight:600;}
  .os-previsao.atrasada{color:#b91c1c;font-weight:800;}

  /* BADGE VIA */
  .via-label{
    align-self:flex-start;font-size:9px;font-weight:800;
    letter-spacing:.13em;text-transform:uppercase;
    color:#fff;background:${t.titulos};
    padding:3px 12px;border-radius:3px;margin-bottom:6px;flex-shrink:0;
  }

  /* SEÇÕES */
  .secoes{display:flex;flex-direction:column;gap:3.5px;flex:1;min-height:0;overflow:hidden;}
  .secao{border:1px solid ${t.bordas};border-radius:3px;overflow:hidden;flex-shrink:0;}
  .secao-titulo{
    background:${t.cabecalhos};color:#fff;
    font-size:9px;font-weight:800;
    text-transform:uppercase;letter-spacing:.07em;
    padding:3px 10px;border-left:3px solid ${t.linhasDestaque};line-height:1.3;
  }
  .secao-sub{
    font-size:8.5px;font-weight:700;text-transform:uppercase;
    letter-spacing:.06em;color:${t.titulos};padding:2px 10px 0;
  }
  .grade{display:grid;grid-template-columns:1fr 1fr;gap:0;padding:4px 10px 5px;}
  .campo{padding:1.5px 4px;}
  .rotulo{
    display:block;font-size:7px;text-transform:uppercase;
    letter-spacing:.06em;color:#777;margin-bottom:1px;font-weight:600;
  }
  .valor{display:block;font-size:11px;color:#111;font-weight:700;line-height:1.3;}
  .texto-livre{
    font-size:10.5px;padding:4px 10px;
    white-space:pre-wrap;word-break:break-word;color:#1a1a1a;line-height:1.4;
  }

  /* TERMOS — ocupa o espaço restante, texto menor para caber.
     font-size parte de --fonte-termos (ajustável em Configurações); o
     script de autofit no final do documento ainda pode reduzir a partir
     daí se o texto não couber na via impressa. */
  .secao-termos{flex:1;min-height:0;display:flex;flex-direction:column;}
  .termos-texto{
    font-size:var(--fonte-termos,7.8pt);color:#1a1a1a;
    padding:4px 10px 5px;
    white-space:pre-wrap;word-break:break-word;
    line-height:1.5;overflow:hidden;flex:1;text-align:justify;
  }

  /* ASSINATURAS */
  .assinaturas{
    display:flex;justify-content:space-between;gap:14px;
    margin-top:7px;padding-top:2px;flex-shrink:0;
  }
  .assinatura-bloco{flex:1;text-align:center;display:flex;flex-direction:column;align-items:center;}
  /* 56px = mesma altura mínima usada em js/assinatura-injetor.js
     (ESPACO_ALTURA_MIN). Antes eram só 22px: a imagem de assinatura
     injetada (position:absolute, até 90px) crescia para fora deste
     container e sobrepunha o conteúdo da seção de termos, logo acima
     na página. Mantido em sincronia com o injetor porque ele confia
     neste valor de CSS estático como base sempre que o min-height
     inline (aplicado só na hora da injeção) ainda não estiver presente
     — por exemplo, num preview do documento sem assinatura nenhuma. */
  .assinatura-espaco{height:56px;width:100%;}
  .linha-assinatura{border-top:1.5px solid #222;width:90%;margin-bottom:5px;}
  .assinatura-label{font-size:9px;color:#111;font-weight:800;text-transform:uppercase;letter-spacing:.05em;line-height:1.3;}
  .assinatura-nome{font-size:10px;color:#333;margin-top:2px;font-weight:600;}
  .assinatura-data{font-size:9px;color:#666;margin-top:3px;}

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
    ${viaCliente}
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
  // Autofit: reduz fonte dos termos até o texto caber no espaço reservado
  // para ele (.secao-termos, flex:1 dentro da via).
  // Parte de --fonte-termos (tamanho de fábrica ou o escolhido pelo usuário
  // em Configurações), nunca abaixo de minPt — mesmo piso de legibilidade
  // de antes desta funcionalidade existir.
  //
  // IMPORTANTE: mede scrollHeight/clientHeight do PRÓPRIO elemento de
  // termos, não de .via inteira. .via tem altura fixa (210mm) com
  // display:flex;flex-direction:column — nesse layout, o filho flex:1
  // sempre se estica para preencher o espaço disponível, então
  // via.scrollHeight é sempre ~igual à altura fixa da via,
  // independentemente do tamanho da fonte dos termos (confirmado: mesmo
  // fonte de 2pt e 20pt geram o mesmo via.scrollHeight). Medir a via
  // inteira faz o loop nunca convergir de verdade e sempre reduzir até o
  // piso mínimo, mesmo com texto curtíssimo. .termos-texto, por sua vez,
  // tem overflow:hidden e uma altura definida pelo flex — comparar seu
  // próprio scrollHeight (conteúdo real) com clientHeight (espaço
  // disponível) reflete corretamente se o texto transborda ou não.
  (function() {
    document.querySelectorAll('.termos-texto').forEach(function(el) {
      var minPt = 5.5;
      var curPt = parseFloat(getComputedStyle(el).fontSize) || 7.8;
      var tentativas = 0;
      while (curPt > minPt && el.scrollHeight > el.clientHeight + 1 && tentativas < 60) {
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

module.exports = { gerarHtmlOS };
