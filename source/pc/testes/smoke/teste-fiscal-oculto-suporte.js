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
assert.match(runtime, /administradorEmpresa:\s*this\.contexto\?\.administrador_global\s*!==\s*true/);
assert.match(fiscalUi, /let fiscalHabilitado = false/);
assert.match(fiscalUi, /secao\.hidden = empresaSuporte/);
assert.match(fiscalUi, /!status\?\.autenticado \|\| !status\?\.empresaId \|\| status\?\.administradorEmpresa !== true/);
assert.match(fiscalUi, /secao\.dataset\.moduloFiscalAtivo = fiscalHabilitado \? 'true' : 'false'/);
assert.doesNotMatch(fiscalUi, /!status\?\.empresaId \|\| !fiscalHabilitado/);
assert.match(fiscalUi, /!status\?\.autenticado \|\| status\?\.administradorGlobal !== true/);
assert.match(fiscalUi, /if \(!fiscalHabilitado\) throw new Error/);
assert.match(renderer, /window\.fiscalSistemaOSHabilitado\?\.\(\) === true/);
assert.match(renderer, /fiscalAtivo \? 'Ocultar fiscal' : 'Liberar fiscal'/);
assert.match(renderer, /if \(suporteEhAdministradorGeral\(\)\)/);
assert.match(adminGlobal, /'configurar_fiscal_empresa'/);
assert.match(adminGlobal, /fiscal_habilitado:\s*ativa/);
assert.match(adminGlobal, /recurso_fiscal_configurado_suporte/);
assert.match(fiscalApi, /const fiscalDisponivel = plataformaFiscal \|\| fiscalNoTrial \|\|/);
assert.match(fiscalApi, /if \(!fiscalDisponivel\) return resposta\(409/);
assert.match(fiscalApi, /Deno\.env\.get\('FISCAL_EMISSOR_ATIVO'\) === 'true'/);
assert.match(fiscalApi, /NFEIO_INVOICE_KEY/);
assert.match(fiscalApi, /NFEIO_ACCOUNT_ID/);
assert.match(fiscalApi, /FISCAL_WORKER_CRON_SECRET/);

console.log('OK: cadastro fiscal visível ao administrador da empresa; emissão continua bloqueada pelo módulo e servidor.');
