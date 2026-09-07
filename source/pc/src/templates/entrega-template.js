// Adaptador legado: toda Entrega usa o comprovante unificado da OS.
// Mantém a API gerarHtmlEntrega(en, config) para não quebrar históricos,
// importações do celular e PDFs já integrados ao restante do sistema.

const {
  gerarHtmlComprovanteOS,
  mapearEntregaParaComprovante
} = require('./comprovante-os-template');

function gerarHtmlEntrega(entrega, config) {
  return gerarHtmlComprovanteOS(
    mapearEntregaParaComprovante(entrega),
    config,
    { formato: 'a4' }
  );
}

module.exports = { gerarHtmlEntrega };
