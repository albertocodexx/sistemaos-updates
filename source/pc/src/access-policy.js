'use strict';

// Estas decisoes recebem exclusivamente o usuario resolvido no processo
// principal. Flags enviadas pelo renderer ou pelo modelo nunca sao autoridade.
function ehAdministrador(usuario) {
  return !!usuario && usuario.acessoSomenteCobranca !== true &&
    (usuario.admin === true || usuario.administradorGlobal === true || usuario.administrador_global === true);
}

function podeModulo(usuario, modulo, acao = 'ler') {
  if (!usuario || usuario.acessoSomenteCobranca === true) return false;
  if (ehAdministrador(usuario)) return true;
  const permissoes = usuario.permissoesDetalhadas || usuario.permissoes || {};
  if (permissoes['*']?.['*'] === true) return true;
  const valor = permissoes[modulo];
  return valor === true || (!!valor && typeof valor === 'object' && valor[acao] === true);
}

const ACOES_IA = Object.freeze({
  criar_os: ['os', 'criar'],
  alterar_status_os: ['os', 'editar'],
  excluir_os: ['os', 'excluir'],
  enviar_mensagem_whatsapp: ['os', 'editar'],
  adicionar_custos_compra: ['estoque', 'editar'],
  alterar_status_cobranca: ['financeiro', 'editar']
});

function podeAcaoIA(usuario, tipo) {
  if (!Object.hasOwn(ACOES_IA, tipo)) return false;
  const [modulo, acao] = ACOES_IA[tipo];
  return podeModulo(usuario, modulo, acao);
}

const CATEGORIAS_IA = Object.freeze({
  resumo: ['os', 'estoque', 'financeiro', 'relatorios'],
  os: ['os'], clientes: ['clientes'], estoque: ['estoque'], pecas: ['estoque'],
  compras: ['estoque'], entregas: ['os'], garantias: ['os'], financeiro: ['financeiro'], whatsapp: ['os']
});
function podeCategoriaIA(usuario, categoria) {
  return Object.hasOwn(CATEGORIAS_IA, categoria) &&
    CATEGORIAS_IA[categoria].every(modulo => podeModulo(usuario, modulo));
}

module.exports = { ehAdministrador, podeModulo, podeAcaoIA, podeCategoriaIA };
