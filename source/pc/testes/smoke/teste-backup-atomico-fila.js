const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-backup-atomico-'));
const pastaAuto = path.join(raiz, 'BACKUP - OS', 'auto');
const pastaOS = path.join(raiz, 'BACKUP - OS');
fs.mkdirSync(pastaAuto, { recursive: true });

let sequencia = 0;
const dbFalso = {
  getBackupAutoDir: () => pastaAuto,
  getBackupDir: () => pastaOS,
  exportarBackupCompleto(caminho) {
    sequencia += 1;
    const pacote = {
      tipo: 'backup-sistema-os',
      versaoBackup: 7,
      geradoEm: new Date().toISOString(),
      sequencia,
      ordens: []
    };
    fs.writeFileSync(caminho, JSON.stringify(pacote));
    return { caminho, totalOrdens: 0 };
  },
  importarBackup: () => ({ sucesso: true })
};

const caminhoDb = require.resolve('../../src/db');
require.cache[caminhoDb] = {
  id: caminhoDb,
  filename: caminhoDb,
  loaded: true,
  exports: dbFalso
};
const caminhoModulo = require.resolve('../../src/backup');
delete require.cache[caminhoModulo];
const backup = require('../../src/backup');

const resultado = backup.fazerBackupAutoDiario();
assert.equal(resultado.sucesso, true);
assert(resultado.nome.endsWith('-diario.json'));
assert.equal(JSON.parse(fs.readFileSync(resultado.caminho, 'utf8')).tipo, 'backup-sistema-os');
assert.equal(fs.readdirSync(pastaAuto).some((nome) => nome.includes('.tmp-')), false);

const pendente = path.join(pastaAuto, 'cloud-pendente.json');
assert.equal(fs.existsSync(pendente), true);
assert.equal(JSON.parse(fs.readFileSync(pendente, 'utf8')).sequencia, 1);
assert.equal(backup.statusAgendamento().backupNuvemPendente, true);

console.log('OK - backup local atomico e fila persistente da nuvem validados.');
