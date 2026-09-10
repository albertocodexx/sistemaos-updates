'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

let codigoAcesso = ler('supabase', 'functions', '_shared', 'access.ts');
codigoAcesso = stripTypeScriptTypes(codigoAcesso).replace(/\bexport\s+/g, '');
codigoAcesso += '\nglobalThis.acesso = { ehAdministradorEmpresa, temPermissao, contextoUsuarioAtivo, licencaPermiteOperacao, tiposDocumentoPermitidos, podeAcessarTipoDocumento };';
const ambiente = {};
vm.createContext(ambiente);
vm.runInContext(codigoAcesso, ambiente);
const acesso = ambiente.acesso;

const base = {
  administrador_global: false, usuario_ativo: true, empresa_ativa: true,
  licenca_status: 'ativa', cargo: 'Tecnico', permissoes: {}
};
const contexto = (alteracoes = {}) => ({ ...base, ...alteracoes });

assert.equal(acesso.temPermissao(contexto({ permissoes: { configuracoes: { ler: true } } }), 'configuracoes', 'editar'), false,
  'Leitura de configurações não pode autorizar edição.');
assert.equal(acesso.temPermissao(contexto({ permissoes: { configuracoes: { editar: true } } }), 'configuracoes', 'editar'), true);
assert.equal(acesso.temPermissao(contexto({ permissoes: { financeiro: { ler: true } } }), 'financeiro', 'criar'), false,
  'Leitura financeira não pode gerar cobrança.');
assert.equal(acesso.temPermissao(contexto({ permissoes: { financeiro: true } }), 'financeiro', 'criar'), true,
  'Permissão booleana legada continua compatível.');
assert.equal(acesso.temPermissao(contexto({ permissoes: { '*': { '*': true } } }), 'estoque', 'editar'), true);
assert.equal(acesso.ehAdministradorEmpresa(contexto({ cargo: 'Administrador assistente' })), false,
  'Nome que apenas contém “administrador” não vira cargo administrativo.');
assert.equal(acesso.ehAdministradorEmpresa(contexto({ cargo: 'Administrador' })), true);
assert.equal(acesso.contextoUsuarioAtivo(contexto({ usuario_ativo: false })), false);
assert.equal(acesso.contextoUsuarioAtivo(contexto({ empresa_ativa: false })), false);
assert.equal(acesso.licencaPermiteOperacao(contexto({ licenca_status: 'vencida' })), false);
assert.equal(acesso.licencaPermiteOperacao(contexto({ licenca_status: 'periodo_graca' })), true);
assert.equal(acesso.podeAcessarTipoDocumento(contexto({ permissoes: { os: { editar: true } } }), 'entrega', 'editar'), true);
assert.equal(acesso.podeAcessarTipoDocumento(contexto({ permissoes: { os: { editar: true } } }), 'venda', 'editar'), false);
assert.deepEqual(
  Array.from(acesso.tiposDocumentoPermitidos(contexto({ permissoes: { estoque: { ler: true } } }), 'ler')).sort(),
  ['compra', 'venda']
);

const integracoes = ler('supabase', 'functions', 'integracoes-empresa', 'index.ts');
const fiscal = ler('supabase', 'functions', 'fiscal-documentos', 'index.ts');
const remotas = ler('supabase', 'functions', 'assinaturas-remotas', 'index.ts');
const saas = ler('supabase', 'functions', 'assinaturas-saas', 'index.ts');
const admin = ler('supabase', 'functions', 'admin-global', 'index.ts');
const chamados = ler('supabase', 'functions', 'chamados-suporte', 'index.ts');
const login = ler('supabase', 'functions', 'auth-login', 'index.ts');
const migration = ler('supabase', 'migrations', '20260909000100_endurecer_autorizacao_edge.sql');
const migrationPostgres = ler('supabase', 'migrations', '20260909000200_postgresql_integridade_otimizacao.sql');

for (const [nome, fonte] of Object.entries({ integracoes, fiscal, remotas })) {
  assert.match(fonte, /contextoUsuarioAtivo\(/, `${nome} deve bloquear usuário/empresa inativos.`);
  assert.match(fonte, /licencaPermiteOperacao\(/, `${nome} deve bloquear licença sem acesso operacional.`);
}
for (const [nome, fonte] of Object.entries({ saas, admin, chamados })) {
  assert.match(fonte, /contextoUsuarioAtivo\(/, `${nome} deve bloquear identidade inativa.`);
}
assert.doesNotMatch(integracoes, /Boolean\(atual\.permissoes\?\.configuracoes\)/);
assert.doesNotMatch(fiscal, /Boolean\(contexto\.permissoes\?\.configuracoes\)/);
assert.doesNotMatch(saas, /Boolean\(contexto\.permissoes\?\.configuracoes\)/);
assert.match(integracoes, /podeConsultarFinanceiro = temPermissao\(atual, 'financeiro', 'ler'\)/);
assert.match(integracoes, /podeEnviarWhatsApp = temPermissao\(atual, 'os', 'editar'\)/);
assert.match(fiscal, /if \(!podeEmitir\).*não pode emitir documentos fiscais/);
assert.match(remotas, /tamanhoJson\(pacote\) <= 8_000_000/);
assert.match(remotas, /respostaAssinaturaValida\(respostaAssinada, pendente\.tipo_documento, idEnvio\)/);
assert.match(remotas, /\.in\('tipo_documento', tipos\)/);
assert.match(migration, /v_tipo in \('compra', 'venda'\).*then 'estoque'.*else 'os'/s);
assert.doesNotMatch(migration, /then 'compras'|then 'vendas'|then 'entregas'/);
assert.match(migration, /registrar_falha_login_controlada/);
assert.match(login, /conta\|\$\{empresa\}\|\$\{usuario\}/);
assert.match(login, /cf-connecting-ip.*x-real-ip.*encaminhados/s);
assert.match(login, /p_limite: 20/);
assert.match(migrationPostgres, /p\.id = \(select auth\.uid\(\)\)/,
  'empresa e permissoes precisam vir do JWT, nunca de URL ou empresaId enviado pelo cliente.');
assert.doesNotMatch(migrationPostgres, /current_setting\([^)]*(?:url|empresa)/i);
assert.match(migrationPostgres, /pode_acessar_empresa\(empresa_id\).*modulo_entidade_arquivo/s);

console.log('OK: JWT/RLS ignoram empresa adulterada na URL; Edge Functions exigem contexto ativo, licença e permissão exata.');
