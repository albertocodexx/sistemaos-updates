const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

const renderer = ler('renderer', 'core', 'legacy-runtime.js');
const estilos = ler('renderer', 'style.css');
const html = ler('renderer', 'index.html');
const funcaoAdmin = ler('supabase', 'functions', 'admin-global', 'index.ts');
const migracao = ler('supabase', 'migrations', '20260802000100_exclusao_usuario_resiliente.sql');
const senhaIndividual = ler('supabase', 'migrations', '20260807000200_senha_exclusao_individual_admin.sql');

assert.match(renderer, /definirMensagemUsuarios\(mensagem, 'erro'\)/);
assert.match(renderer, /await carregarListaUsuarios\(\)/);
assert.match(html, /id="msgUsuarios"[^>]+aria-live="polite"/);
assert.match(estilos, /\.toast \{[^}]*right: 112px;[^}]*z-index: 12000;/s);

assert.match(funcaoAdmin, /usuarioJaAusente/);
assert.match(funcaoAdmin, /identidades_login'[\s\S]*\.delete\(\)/);
assert.match(funcaoAdmin, /perfis'[\s\S]*\.delete\(\)/);
assert.match(funcaoAdmin, /auditoriaErro/);
assert.match(html, /id="btnNovoUsuarioPoliticaExclusao"/);
assert.match(renderer, /async function autorizarExclusaoProtegida/);
assert.match(renderer, /btn-senha-individual-exclusao/);
assert.match(renderer, /validar_credencial_admin_exclusao/);
assert.match(funcaoAdmin, /acao === 'definir_senha_exclusao_usuario'/);
assert.match(funcaoAdmin, /signInWithPassword/);
assert.match(senhaIndividual, /create or replace function public\.definir_senha_exclusao_usuario/i);
assert.match(senhaIndividual, /crypt\(p_senha, gen_salt\('bf', 12\)\)/i);
assert.match(senhaIndividual, /senha_exclusao_usuario_definida_por_admin/i);

assert.match(migracao, /solicitacoes_exclusao_solicitada_por_fkey/);
assert.match(migracao, /auditoria_empresas_excluidas_excluida_por_fkey/);
assert.strictEqual((migracao.match(/on delete set null/g) || []).length, 2);
assert.match(migracao, /v_quantidade_nova < 0/);
assert.match(migracao, /Estoque insuficiente para registrar esta saida/);

console.log('OK - exclusao de usuarios e resiliente, auditavel e exibe erros completos');
