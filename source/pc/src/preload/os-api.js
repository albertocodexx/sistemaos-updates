// API segura do domínio de Ordens de Serviço para o preload.
// Recebe apenas uma função de invocação; nunca expõe ipcRenderer ao renderer.

function criarApiOS(invoke) {
  return {
    criar: (dados, usuario) => invoke('os:criar', dados, usuario),
    atualizar: (numero, dados, usuario) => invoke('os:atualizar', numero, dados, usuario),
    listar: () => invoke('os:listar'),
    buscar: (termo) => invoke('os:buscar', termo),
    obter: (numero) => invoke('os:obter', numero),
    statusValidos: () => invoke('os:statusValidos'),
    estatisticas: (filtro) => invoke('os:stats', filtro),
    gerarPdf: (numero) => invoke('os:gerarPdfNovamente', numero),
    abrirPdf: (caminho) => invoke('os:abrirPdf', caminho),
    gerarComprovante: (numero, formato) => invoke('os:gerarComprovante', numero, formato),
    abrirComprovante: (numero, formato, dadosExtras) => invoke('os:abrirComprovante', numero, formato, dadosExtras),
    imprimirComprovante: (numero, formato, impressora, copias, dadosExtras) => invoke('os:imprimirComprovante', numero, formato, impressora, copias, dadosExtras),
    listarImpressoras: () => invoke('os:listarImpressoras'),
    gerarEtiquetaQR: (numero) => invoke('etiqueta:gerarQr', numero),
    excluir: (numero, usuario) => invoke('os:excluir', numero, usuario),
    salvarFoto: (numero, categoria, base64, nome) => invoke('os:salvarFoto', numero, categoria, base64, nome),
    salvarComprovanteTermico: (numero, base64, nome, mimeType) => invoke('os:salvarComprovanteTermico', numero, base64, nome, mimeType),
    excluirFoto: (numero, fotoId) => invoke('os:excluirFoto', numero, fotoId),
    substituirFoto: (numero, fotoId, base64, nome) => invoke('os:substituirFoto', numero, fotoId, base64, nome),
    registrarRespostaTermos: (numero, dados) => invoke('os:registrarRespostaTermos', numero, dados),
    confirmarPagamentoPresencial: (dados) => invoke('os:confirmarPagamentoPresencial', dados)
  };
}

module.exports = { criarApiOS };
