const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  planejarMigracao, resumoPlano, numeroOS, sanitizarConfiguracao, linhaEquivalente
} = require('../../ferramentas/migracao-supabase/migrador');
const { validarServiceRole } = require('../../ferramentas/migracao-supabase/index');

function jwt(role) {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc({ role })}.assinatura`;
}

const fixture = {
  config: {
    nomeEmpresa: 'Assistência Teste', email: 'admin@teste.com',
    mercadoPagoToken: 'SEGREDO-MP', groqApiKey: 'SEGREDO-IA',
    firebaseConfig: { apiKey: 'SEGREDO-FB' }, logoBase64: 'BASE64-LOGO', temaModo: 'dark'
  },
  usuarios: [{ id: 'USR-1', usuario: 'admin', nome: 'Administrador', perfil: 'admin', status: 'ativo', senhaHash: 'HASH-LOCAL' }],
  ordens: [{
    numero: 'OS-1', data: '2026-07-16T10:00:00Z', status: 'Em reparo', prioridade: 'Normal',
    cliente: { nome: 'Cliente', telefone: '27999999999' },
    aparelho: { marca: 'Samsung', modelo: 'S23 Ultra', defeitoRelatado: 'Tela' },
    origemIdExportacao: 'os-local-1', pdfUrlStorage: 'https://res.cloudinary.com/demo/raw/upload/os.pdf',
    pdfPath: 'C:\\privado\\OS-0001.pdf', assinaturaClienteBase64: 'data:image/png;base64,SEGREDO-BASE64'
  }],
  garantias: [{ numeroOS: 'OS-0001', clienteNome: 'Cliente', garantiaDias: 90, dataInicio: '2026-07-16T10:00:00Z' }],
  entregas: [{ numeroOS: 'OS-0001', nomeRetirou: 'Cliente', dataHoraAssinatura: '2026-07-17T10:00:00Z', garantiaDias: 90 }],
  entregasPendentes: []
};

assert.strictEqual(numeroOS('1'), 'OS-0001');
assert.strictEqual(
  JSON.stringify(planejarMigracao({ ...fixture, ordens: [{ ...fixture.ordens[0], data: undefined }] })),
  JSON.stringify(planejarMigracao({ ...fixture, ordens: [{ ...fixture.ordens[0], data: undefined }] })),
  'o plano deve permanecer idêntico mesmo quando uma data legada estiver ausente'
);
assert.strictEqual(linhaEquivalente(
  { valor: 1, created_at: '2026-07-17T12:00:00.000Z', dados: { b: 2, a: 1 } },
  { valor: '1', created_at: '2026-07-17T09:00:00-03:00', dados: { a: 1, b: 2 }, extra: true }
), true, 'deve reconhecer uma linha remota equivalente e recuperar o vínculo');
const segura = JSON.stringify(sanitizarConfiguracao(fixture.config));
assert(!/SEGREDO|firebaseConfig|logoBase64/.test(segura));

const plano = planejarMigracao(fixture, { mapaUsuarios: {} });
const resumo = resumoPlano(plano);
assert.deepStrictEqual({ os: resumo.ordensServico, g: resumo.garantias, e: resumo.entregas }, { os: 1, g: 1, e: 1 });
assert.strictEqual(resumo.usuariosSemEmail, 0, 'empresa com um usuário pode usar o e-mail empresarial');
assert.strictEqual(resumo.arquivosExternosIgnorados, 0);
assert(resumo.arquivosLocaisIgnorados >= 1);
const planoTexto = JSON.stringify(plano.ordens[0].row);
assert(!/SEGREDO-BASE64|C:\\\\privado|pdfPath/.test(planoTexto));

assert.doesNotThrow(() => validarServiceRole(jwt('service_role')));
assert.throws(() => validarServiceRole(jwt('anon')), /service_role/);
assert.doesNotThrow(() => validarServiceRole(['sb', 'secret', 'ferramenta', 'confiavel'].join('_')));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'migracao-supabase-'));
try {
  const fonte = path.join(temp, 'database.json');
  const relatorio = path.join(temp, 'relatorio.json');
  fs.writeFileSync(fonte, JSON.stringify(fixture));
  const cli = path.resolve(__dirname, '..', '..', 'ferramentas', 'migracao-supabase', 'index.js');
  const exec = spawnSync(process.execPath, [cli, '--fonte', fonte, '--dry-run', '--relatorio', relatorio], { encoding: 'utf8' });
  assert.strictEqual(exec.status, 0, exec.stderr);
  const gerado = JSON.parse(fs.readFileSync(relatorio, 'utf8'));
  assert.strictEqual(gerado.modo, 'dry-run');
  assert.strictEqual(gerado.resumo.ordensServico, 1);
  const textoRelatorio = JSON.stringify(gerado);
  assert(!/SEGREDO-MP|SEGREDO-IA|SEGREDO-BASE64|HASH-LOCAL/.test(textoRelatorio));

  const bloqueado = spawnSync(process.execPath, [cli, '--fonte', fonte, '--apply'], { encoding: 'utf8' });
  assert.notStrictEqual(bloqueado.status, 0);
  assert(/confirmar MIGRAR/.test(bloqueado.stderr));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const sql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'supabase', 'migrations', '20260717000900_migration_ledger.sql'), 'utf8');
assert(sql.includes('migracoes_legado'));
assert(/revoke all on table public[.]migracoes_legado from public, anon, authenticated/i.test(sql));
assert(/grant select, insert, update on table public[.]migracoes_legado to service_role/i.test(sql));
assert(!/grant\s+.*migracoes_legado.*authenticated/i.test(sql));

const entregaStatusSql = fs.readFileSync(path.resolve(
  __dirname, '..', '..', 'supabase', 'migrations',
  '20260818000100_entrega_atualiza_status_os.sql'
), 'utf8');
assert(entregaStatusSql.includes('trg_entrega_atualiza_status_os'));
assert(/set status = 'Entregue'/i.test(entregaStatusSql));
assert(/o\.status not in \('Entregue', 'Cancelado'\)/.test(entregaStatusSql));

const packageJson = require('../../package.json');
assert(packageJson.build.files.includes('!ferramentas/migracao-supabase/**'), 'ferramenta confiável não pode ser empacotada no Electron');
console.log('OK: dry-run, preservação de números, sanitização, bloqueio de apply, relatório e isolamento da ferramenta validados.');
