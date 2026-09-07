'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

const runtime = ler('src', 'supabase', 'desktop-runtime.js');
const renderer = ler('renderer', 'core', 'legacy-runtime.js');
const fiscalUi = ler('renderer', 'modules', 'fiscal', 'documentos.js');
const fiscalApi = ler('supabase', 'functions', 'fiscal-documentos', 'index.ts');
const adminGlobal = ler('supabase', 'functions', 'admin-global', 'index.ts');

assert.match(runtime, /fiscalHabilitado:\s*contexto\.administrador_global\s*!==\s*true\s*&&\s*contexto\.recursos_habilitados\?\.fiscal_habilitado\s*===\s*true/);
assert.match(runtime, /fiscalHabilitado:\s*this\.contexto\?\.administrador_global\s*!==\s*true/);
assert.match(fiscalUi, /let fiscalHabilitado = false/);
assert.match(fiscalUi, /secao\.hidden = !status\?\.autenticado \|\| !status\?\.empresaId \|\| !fiscalHabilitado/);
assert.match(fiscalUi, /if \(!fiscalHabilitado\) throw new Error/);
assert.match(renderer, /window\.fiscalSistemaOSHabilitado\?\.\(\) === true/);
assert.match(renderer, /fiscalAtivo \? 'Ocultar fiscal' : 'Liberar fiscal'/);
assert.match(renderer, /if \(suporteEhAdministradorGeral\(\)\)/);
assert.match(adminGlobal, /'configurar_fiscal_empresa'/);
assert.match(adminGlobal, /fiscal_habilitado:\s*ativa/);
assert.match(adminGlobal, /recurso_fiscal_configurado_suporte/);
assert.match(fiscalApi, /recursos_habilitados\?\.fiscal_habilitado !== true/);
assert.match(fiscalApi, /A emissão de NFS-e ainda não está liberada/);

console.log('OK: fiscal oculto por padrão, liberável apenas pelo Administrador Geral e protegido no servidor.');
