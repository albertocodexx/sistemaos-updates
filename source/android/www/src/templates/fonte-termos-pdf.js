// src/templates/fonte-termos-pdf.js
// ─────────────────────────────────────────────────────────────────────────
// Resolve o tamanho de fonte inicial dos termos no PDF (OS, Venda, Compra),
// a partir do controle "Fonte dos Termos no PDF" em Configurações. Único
// ponto de verdade — nenhum template deve ler config.tamanhoFonteTermosPdf
// diretamente, para manter o mesmo clamp e o mesmo valor "ausente = usa o
// tamanho de fábrica" nos 3 lugares.
//
// Config local do PC — não viaja no .json de OS/Compra/Venda exportado
// (mesma natureza de termosPadraoUsuario* do celular: cada aparelho, PC e
// celular, tem o seu próprio valor).
//
// 0 ou ausente = "Padrão do sistema": usa o tamanho de fábrica de cada
// template (7.8pt em OS/Compra, 8.5pt em Venda) — quem nunca mexeu no
// controle não vê nenhuma mudança visual.
// ─────────────────────────────────────────────────────────────────────────

const FONTE_MINIMA_PT = 5.5;   // piso técnico já usado pelo autofit
const FONTE_MAXIMA_PT = 14;    // máximo do controle em Configurações

function resolverTamanhoFonteTermos(config, fabricaPt) {
  const valor = config && config.tamanhoFonteTermosPdf;
  if (!valor || isNaN(parseFloat(valor))) return fabricaPt;
  const v = parseFloat(valor);
  if (v <= 0) return fabricaPt;
  return Math.min(FONTE_MAXIMA_PT, Math.max(FONTE_MINIMA_PT, v));
}

module.exports = { resolverTamanhoFonteTermos, FONTE_MINIMA_PT, FONTE_MAXIMA_PT };
