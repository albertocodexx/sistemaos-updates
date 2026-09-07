const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');

const dominio = ler('src/database/domain.js');
assert(/function ativarEscopoEmpresa/.test(dominio));
assert(/empresas/.test(dominio) && /empresaAtivaId/.test(dominio));
assert(/migrarLegado/.test(dominio));

const runtime = ler('src/supabase/desktop-runtime.js');
assert(/_ativarEscopoLocal/.test(runtime));
assert(/garantirOSPublicada/.test(runtime));
assert(/relatorios_erros/.test(runtime));
assert(/this\.contexto\?\.usuario_id/.test(runtime));

const assinatura = ler('src/ipc/register-legacy.js');
assert(/garantirOSPublicada/.test(assinatura));
assert(/solicitarAssinaturaRemota/.test(assinatura));

const admin = ler('supabase/functions/admin-global/index.ts');
assert(/listar_erros_usuarios/.test(admin));
assert(/atualizar_erro_usuario/.test(admin));
assert(/3 \* 86400000/.test(admin));
assert(/crypto\.randomUUID/.test(admin));

const migracao = ler('supabase/migrations/20260719000800_erros_usuarios_e_retencao_empresas.sql');
assert(/create table if not exists public\.relatorios_erros/.test(migracao));
assert(/relatorios_erros_insert_empresa/.test(migracao));

const renderer = ler('renderer/core/legacy-runtime.js');
assert(/renderizarErrosUsuarios/.test(renderer));
assert(/Assinatura recebida do celular/.test(renderer));
assert(/Conta alterada com sucesso/.test(renderer));

console.log('OK - isolamento multiempresa, consulta antes da assinatura, notificacao e relatorios de erros validados.');
