// src/templates/tema-pdf.js
// ─────────────────────────────────────────────────────────────────────────
// Resolve qual conjunto de cores os PDFs (OS, Venda, Relatórios, etc.) devem
// usar, de acordo com a configuração "Utilizar mesmo tema do sistema nos
// PDFs". Único ponto de verdade — nenhum template deve ler `config.tema` ou
// `config.temaPdf` diretamente.
// ─────────────────────────────────────────────────────────────────────────

const TEMA_PADRAO_SISTEMA = {
  corPrincipal: '#3B82F6',
  corSecundaria: '#111111',
  corDestaque: '#3B82F6',
  corBotoes: '#3B82F6',
  corCabecalhos: '#111111',
  corBarraLateral: '#111111',
  corCards: '#FFFFFF',
  corLinks: '#3B82F6'
};

const TEMA_PADRAO_PDF = {
  usarTemaSistemaPdf: true,
  corCabecalhos: '#111111',
  corTitulos: '#3B82F6',
  corLinhasDestaque: '#3B82F6',
  corTabelas: '#111111',
  corRodapes: '#111111',
  corBordas: '#111111',
  corElementosGraficos: '#3B82F6'
};

function resolverTemaPdf(config) {
  const tema = Object.assign({}, TEMA_PADRAO_SISTEMA, config?.tema || {});
  const temaPdf = Object.assign({}, TEMA_PADRAO_PDF, config?.temaPdf || {});

  if (temaPdf.usarTemaSistemaPdf) {
    return {
      cabecalhos: tema.corCabecalhos,
      titulos: tema.corPrincipal,
      linhasDestaque: tema.corDestaque,
      tabelas: tema.corSecundaria,
      rodapes: tema.corSecundaria,
      bordas: tema.corSecundaria,
      elementosGraficos: tema.corDestaque
    };
  }

  return {
    cabecalhos: temaPdf.corCabecalhos,
    titulos: temaPdf.corTitulos,
    linhasDestaque: temaPdf.corLinhasDestaque,
    tabelas: temaPdf.corTabelas,
    rodapes: temaPdf.corRodapes,
    bordas: temaPdf.corBordas,
    elementosGraficos: temaPdf.corElementosGraficos
  };
}

module.exports = { resolverTemaPdf, TEMA_PADRAO_SISTEMA, TEMA_PADRAO_PDF };
