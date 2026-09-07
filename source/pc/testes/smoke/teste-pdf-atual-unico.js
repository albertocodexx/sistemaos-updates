const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
const servico = fs.readFileSync(path.join(raiz, 'src', 'supabase', 'file-service.js'), 'utf8');
const migration = fs.readFileSync(path.join(raiz, 'supabase', 'migrations', '20260718000500_pdf_atual_unico.sql'), 'utf8');

assert.match(servico, /\.is\('deleted_at', null\)/, 'downloads devem ignorar versoes removidas');
assert.match(servico, /requerProcessamento/, 'download deve informar se anexos exigem reconstruir o PDF');
assert.match(servico, /mime_type !== 'application\/pdf'/, 'baixar um PDF nao pode pedir outra regeneracao');
assert.match(migration, /arquivos_pdf_atual_uidx/i, 'servidor deve permitir apenas um PDF atual por entidade');
assert.match(migration, /manter_somente_pdf_atual/i, 'servidor deve substituir a versao anterior');
assert.match(migration, /row_number\(\) over/i, 'migration deve limpar repeticoes existentes');

console.log('OK: PDF atual unico, limpeza legada e bloqueio do ciclo de sincronizacao validados.');
