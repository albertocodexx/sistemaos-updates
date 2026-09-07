'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..', '..');
const runtime = fs.readFileSync(path.join(raiz, 'src/supabase/desktop-runtime.js'), 'utf8');
const arquivos = fs.readFileSync(path.join(raiz, 'src/supabase/file-service.js'), 'utf8');
const dominio = fs.readFileSync(path.join(raiz, 'src/database/domain.js'), 'utf8');
const renderer = fs.readFileSync(path.join(raiz, 'renderer/core/legacy-runtime.js'), 'utf8');
const estado = fs.readFileSync(path.join(raiz, 'src/supabase/desktop-state-store.js'), 'utf8');
const migration = fs.readFileSync(path.join(raiz, 'supabase/migrations/20260721000200_arquivos_transito_e_cpu.sql'), 'utf8');
const migrationExclusao = fs.readFileSync(path.join(raiz, 'supabase/migrations/20260721000300_exclusao_total_os.sql'), 'utf8');

assert.match(runtime, /timerHeartbeat[\s\S]*60000/);
assert.match(runtime, /timerSync[\s\S]*180000/);
assert.match(runtime, /solicitarSincronizacao/);
assert.match(runtime, /syncFalhasConsecutivas/);
assert.match(runtime, /syncSuspensoAte/);
assert.match(runtime, /itens\.slice\(0,\s*10\)/);
assert.match(estado, /ultimoPullArquivosEm/);
assert.match(estado, /limpezasStoragePendentes/);
assert.match(arquivos, /\.gt\('updated_at', desde\)/);
assert.match(arquivos, /confirmarConsumoMobile/);
assert.match(arquivos, /limparObjetosStoragePendentes/);
assert.match(arquivos, /not\('categoria', 'eq', 'pdf'\)/);
assert.doesNotMatch(arquivos, /not\('mime_type', 'eq', 'application\/pdf'\)/);
assert.match(dominio, /categoriaRemota === 'comprovante_termico_assinado'/);
assert.match(dominio, /comprovantesTermicosAssinados/);
assert.match(renderer, /Comprovantes térmicos assinados/);
assert.match(arquivos, /mimePorExtensao\(item\.path\) === 'application\/pdf'/);
assert.match(migration, /confirmar_consumo_arquivo_mobile/);
assert.match(migration, /origem\.tipo = 'android'/);
assert.match(migration, /disponibilidade = 'local'/);
assert.match(arquivos, /removerArquivosOSRemotos/);
assert.match(runtime, /await this\.fileService\.removerArquivosOSRemotos\(remoteId\)/);
assert.match(migrationExclusao, /listar_arquivos_exclusao_os/);
assert.match(migrationExclusao, /delete from public\.arquivos/);
assert.match(migrationExclusao, /delete from public\.ordens_servico/);

console.log('OK: sincronizacao incremental, transito seguro e exclusao total do Storage validados.');
