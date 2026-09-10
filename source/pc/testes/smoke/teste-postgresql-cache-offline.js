'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const raiz = path.resolve(__dirname, '..', '..');
const migracao = fs.readFileSync(path.join(
  raiz, 'supabase', 'migrations', '20260909000200_postgresql_integridade_otimizacao.sql'
), 'utf8');
const migracaoPermissoes = fs.readFileSync(path.join(
  raiz, 'supabase', 'migrations', '20260909000300_revogar_execucao_publica_funcoes.sql'
), 'utf8');
const runtimeFonte = fs.readFileSync(path.join(raiz, 'src', 'supabase', 'desktop-runtime.js'), 'utf8');
const inventarioFonte = fs.readFileSync(path.join(raiz, 'src', 'supabase', 'inventory-service.js'), 'utf8');

assert.match(migracao, /create extension if not exists pg_trgm/i);
assert.match(migracao, /ordens_empresa_cursor_idx[\s\S]*\(empresa_id, updated_at, id\)/i);
assert.match(migracao, /clientes_empresa_nome_trgm_idx/i);
assert.match(migracao, /create or replace function public\.auditar_integridade_postgresql\(\)/i);
assert.match(migracao, /security definer[\s\S]*set search_path = ''/i);
assert.match(migracao, /eh_administrador_empresa\(v_empresa\)/i);
assert.match(migracao, /revoke all on function public\.auditar_integridade_postgresql\(\) from public, anon/i);
assert.match(migracao, /when 'vendas' then 'estoque'/i);
assert.match(migracao, /modulo_entidade_arquivo\(entidade_tipo\), 'ler'/i);
assert.match(migracao, /sem permissao para acessar este arquivo/i);
assert.match(migracaoPermissoes, /revoke execute on function %s from public, anon, authenticated/i);
assert.match(migracaoPermissoes, /grant execute on function %s to service_role/i);
assert.match(migracaoPermissoes, /grant execute on function %s to authenticated/i);
assert.match(migracaoPermissoes, /touch_solicitacoes_assinatura_remota_updated_at/i);
assert.match(inventarioFonte, /for \(let inicio = 0; ; inicio \+= TAMANHO_PAGINA\)/);
assert.doesNotMatch(inventarioFonte, /\.limit\(5000\)/);
assert.match(runtimeFonte, /reconciliacaoPostgresqlNestaSessao/);
assert.match(runtimeFonte, /_processarFilaAssinaturas/);
assert.match(runtimeFonte, /enfileirarAssinatura\(pacote\)/);

const { DesktopStateStore } = require(path.join(raiz, 'src', 'supabase', 'desktop-state-store.js'));
const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-os-postgres-'));
try {
  const pacote = {
    idEnvioAssinatura: 'os-offline-100',
    tipoDocumento: 'os',
    tipoArquivo: 'sistema-os-pc-para-assinar',
    dados: { numero: 'OS-0100' }
  };
  let store = new DesktopStateStore(temporario);
  store.enfileirarAssinatura(pacote);
  store = new DesktopStateStore(temporario);
  let estado = store.obter();
  assert.equal(estado.filaAssinaturas.length, 1, 'a fila deve sobreviver ao reinicio do PC');
  assert.equal(estado.filaAssinaturas[0].idEnvioAssinatura, 'os-offline-100');
  store.enfileirarAssinatura({ ...pacote, dados: { numero: 'OS-0100', revisao: 2 } });
  assert.equal(store.obter().filaAssinaturas.length, 1, 'retry idempotente nao pode duplicar o documento');
  store.confirmarAssinaturaEnviada('os-offline-100');
  estado = store.obter();
  assert.equal(estado.filaAssinaturas.length, 0, 'so a confirmacao deve remover o item');
} finally {
  fs.rmSync(temporario, { recursive: true, force: true });
}

console.log('OK: PostgreSQL otimizado e filas offline duraveis verificadas.');
