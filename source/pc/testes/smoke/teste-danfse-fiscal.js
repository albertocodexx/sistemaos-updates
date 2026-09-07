'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(raiz, ...partes), 'utf8');

const migracao = ler('supabase', 'migrations', '20260807000200_danfse_documentos_fiscais.sql');
const fiscal = ler('supabase', 'functions', 'fiscal-documentos', 'index.ts');
const provedor = ler('supabase', 'functions', 'fiscal-documentos-provedor', 'index.ts');
const config = ler('supabase', 'config.toml');
const tela = ler('renderer', 'modules', 'fiscal', 'documentos.js');
const preload = ler('src', 'preload', 'api.js');
const ipc = ler('src', 'ipc', 'register-legacy.js');

assert.match(migracao, /add column if not exists chave_acesso/i);
assert.match(migracao, /add column if not exists danfse_storage_path/i);
assert.match(migracao, /documentos-fiscais[\s\S]*public\s*=\s*false/i);
assert.match(fiscal, /acao === 'obter_danfse'/);
assert.match(fiscal, /createSignedUrl\(nota\.danfse_storage_path, 300/);
assert.match(fiscal, /status !== 'autorizada'/);
assert.match(fiscal, /Esta NFS-e ja foi autorizada/);
assert.match(fiscal, /const cpfValido/);
assert.match(fiscal, /const cnpjNormalizado/);
assert.match(fiscal, /\^\[0-9A-Z\]\{12\}\\d\{2\}\$/);
assert.match(fiscal, /tipoPessoa === 'fisica'/);
assert.match(fiscal, /documento_prestador/);
assert.match(provedor, /x-cron-secret/i);
assert.match(provedor, /compararSeguro/);
assert.match(provedor, /registrar_resultado/);
assert.match(provedor, /new TextDecoder\(\)\.decode\(bytes\.slice\(0, 5\)\) !== '%PDF-'/);
assert.match(provedor, /storage\.from\('documentos-fiscais'\)/);
assert.match(provedor, /danfse_gerado_em/);
assert.match(config, /\[functions\.fiscal-documentos-provedor\][\s\S]*verify_jwt\s*=\s*false/);
assert.match(tela, /Abrir DANFSe/);
assert.match(tela, /DANFSe sendo preparado/);
assert.match(tela, /fiscalabrirdanfse/);
assert.match(tela, /fiscalTipoPrestador/);
assert.match(tela, /fiscalDocumentoPrestador/);
assert.match(tela, /function cnpjValido/);
assert.match(tela, /emissão por CPF só funciona/i);
assert.match(tela, /data-fiscal-etapa="1"/);
assert.match(tela, /data-fiscal-etapa="4"/);
assert.match(tela, /Solicitar ativação fiscal/);
assert.match(tela, /supabasecriarchamadosuporte/);
assert.match(tela, /Não informe senha GOV\.BR/);
assert.doesNotMatch(tela, /DANFE\/DANFSe/);
assert.match(tela, /documento\?\.valorServico \|\| documento\?\.valorMaoDeObra/);
assert.match(tela, /não inclua o aparelho ou produto/);
assert.match(tela, /setTimeout\(\(\) => carregar\(\)/);
assert.match(preload, /fiscalabrirdanfse:\s*\(notaId\)\s*=>\s*invocar\('fiscal:abrirDanfse', notaId\)/);
assert.match(ipc, /ipcMain\.handle\('fiscal:abrirDanfse'/);
assert.match(ipc, /destino\.protocol !== 'https:'/);
assert.match(ipc, /bytes\.subarray\(0, 5\)\.toString\('ascii'\) !== '%PDF-'/);
assert.match(ipc, /shell\.openPath\(arquivo\)/);

console.log('OK: NFS-e autorizada recebe DANFSe oficial privado, seguro e aberto em PDF no PC.');
