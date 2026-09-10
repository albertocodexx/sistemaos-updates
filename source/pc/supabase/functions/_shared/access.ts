const CARGOS_ADMINISTRATIVOS = new Set([
  'administrador', 'admin', 'proprietario', 'proprietário'
]);

const STATUS_LICENCA_OPERACIONAL = new Set([
  'ativa', 'teste', 'vencendo', 'periodo_graca'
]);

const MODULO_DOCUMENTO = Object.freeze({
  os: 'os',
  entrega: 'os',
  desbloqueio: 'os',
  compra: 'estoque',
  venda: 'estoque'
});

const textoNormalizado = (valor: unknown) => String(valor ?? '').trim().toLowerCase();

export function ehAdministradorEmpresa(contexto: Record<string, any> | null | undefined) {
  return !!contexto && contexto.administrador_global !== true &&
    CARGOS_ADMINISTRATIVOS.has(textoNormalizado(contexto.cargo));
}

export function temPermissao(
  contexto: Record<string, any> | null | undefined,
  modulo: string,
  acao: string
) {
  if (!contexto || contexto.administrador_global === true) return false;
  if (ehAdministradorEmpresa(contexto)) return true;
  const permissoes = contexto.permissoes && typeof contexto.permissoes === 'object'
    ? contexto.permissoes
    : {};
  if (permissoes?.['*']?.['*'] === true) return true;
  const permissaoModulo = permissoes?.[modulo];
  return permissaoModulo === true || !!(
    permissaoModulo && typeof permissaoModulo === 'object' && permissaoModulo[acao] === true
  );
}

export function contextoUsuarioAtivo(contexto: Record<string, any> | null | undefined) {
  if (!contexto || contexto.usuario_ativo !== true) return false;
  return contexto.administrador_global === true || contexto.empresa_ativa === true;
}

export function licencaPermiteOperacao(contexto: Record<string, any> | null | undefined) {
  return !!contexto && contexto.administrador_global !== true &&
    STATUS_LICENCA_OPERACIONAL.has(textoNormalizado(contexto.licenca_status));
}

export function tiposDocumentoPermitidos(
  contexto: Record<string, any> | null | undefined,
  acao: string
) {
  return Object.entries(MODULO_DOCUMENTO)
    .filter(([, modulo]) => temPermissao(contexto, modulo, acao))
    .map(([tipo]) => tipo);
}

export function podeAcessarTipoDocumento(
  contexto: Record<string, any> | null | undefined,
  tipoDocumento: unknown,
  acao: string
) {
  const modulo = MODULO_DOCUMENTO[String(tipoDocumento || '') as keyof typeof MODULO_DOCUMENTO];
  return !!modulo && temPermissao(contexto, modulo, acao);
}
