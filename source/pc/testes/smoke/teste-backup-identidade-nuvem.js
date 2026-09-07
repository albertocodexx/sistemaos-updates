const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CompanyCloudService,
  sha256,
  bancoOperacionalVazio,
  configuracaoMobileDoDesktop,
  configuracaoDesktopDoMobile
} = require('../../src/supabase/company-cloud-service');

(async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-cloud-'));
  const pastaAuto = path.join(raiz, 'auto');
  fs.mkdirSync(pastaAuto, { recursive: true });
  const backupBuffer = Buffer.from(JSON.stringify({ tipo: 'backup-sistema-os', versao: 7, ordens: [] }));
  const origem = path.join(raiz, 'backup.json');
  fs.writeFileSync(origem, backupBuffer);
  const logoBuffer = Buffer.from('imagem-png-teste');
  const empresaId = '11111111-1111-4111-8111-111111111111';
  const chamadas = [];
  let configLocal = { logoBase64: '' };
  let importado = '';
  const estado = {};

  const cliente = {
    storage: {
      from(bucket) {
        return {
          async upload(storagePath, buffer, opcoes) {
            chamadas.push({ tipo: 'upload', bucket, storagePath, buffer: Buffer.from(buffer), opcoes });
            return { data: { path: storagePath }, error: null };
          },
          async download(storagePath) {
            chamadas.push({ tipo: 'download', bucket, storagePath });
            const buffer = bucket === 'backups-empresa' ? backupBuffer : logoBuffer;
            return { data: new Blob([buffer]), error: null };
          },
          async list(prefixo) {
            chamadas.push({ tipo: 'list', bucket, prefixo });
            return { data: [], error: null };
          },
          async remove(paths) { chamadas.push({ tipo: 'remove', bucket, paths }); return { error: null }; }
        };
      }
    },
    async rpc(nome, parametros) {
      chamadas.push({ tipo: 'rpc', nome, parametros });
      return { data: parametros, error: null };
    },
    from(tabela) {
      const q = {
        select() { return q; }, eq() { return q; },
        async maybeSingle() {
          if (tabela === 'backups_empresa') return { data: {
            storage_bucket: 'backups-empresa', storage_path: empresaId + '/ultimo-backup.json',
            tamanho_bytes: backupBuffer.length, sha256: sha256(backupBuffer), updated_at: new Date().toISOString()
          }, error: null };
          return { data: { configuracoes: { identidadeEmpresa: {
            logoStoragePath: empresaId + '/logo.png', logoSha256: sha256(logoBuffer)
          } } }, error: null };
        }
      };
      return q;
    }
  };
  const db = {
    getBackupAutoDir: () => pastaAuto,
    loadDB: () => ({ ordens: [], estoque: [], clientes: [], compras: [], vendas: [], entregas: [], garantias: [] }),
    importarBackup: (caminho) => { importado = caminho; },
    obterConfig: () => Object.assign({}, configLocal),
    salvarConfig: (patch) => { configLocal = Object.assign({}, configLocal, patch); return configLocal; }
  };
  const stateStore = {
    obter: () => JSON.parse(JSON.stringify(estado)),
    alterar: (fn) => fn(estado)
  };
  let contextoAtual = { empresa_id: empresaId, cargo: 'Administrador' };
  const servico = new CompanyCloudService({
    getClient: () => cliente,
    getContext: () => contextoAtual,
    db, stateStore, appVersion: '30.5.17'
  });

  assert.equal(bancoOperacionalVazio(db), true);
  const publicado = await servico.publicarBackup(origem);
  assert.equal(publicado.sucesso, true);
  assert(chamadas.some((c) => c.tipo === 'upload' && c.storagePath === empresaId + '/ultimo-backup.json'));
  assert(chamadas.some((c) => c.tipo === 'upload' && c.storagePath.startsWith(empresaId + '/historico/')));
  assert(chamadas.some((c) => c.nome === 'registrar_backup_empresa'));

  const restaurado = await servico.restaurarEmInstalacaoNova();
  assert.equal(restaurado.restaurado, true);
  assert.equal(importado, restaurado.caminho);
  assert.equal(fs.readFileSync(restaurado.caminho, 'utf8'), backupBuffer.toString('utf8'));

  const logo = await servico.sincronizarLogo();
  assert.equal(logo.possuiLogo, true);
  assert(configLocal.logoBase64.startsWith('data:image/png;base64,'));
  const novaLogo = 'data:image/png;base64,' + logoBuffer.toString('base64');
  const atualizada = await servico.atualizarLogo(novaLogo);
  assert.equal(atualizada.possuiLogo, true);
  assert(chamadas.some((c) => c.nome === 'definir_logo_empresa'));

  const mobile = configuracaoMobileDoDesktop({
    nomeFantasia: 'Oficina Nuvem', telefonePrincipal: '27999999999',
    email: 'contato@oficina.test', senhaExclusao: 'nunca-exportar',
    mercadoPagoToken: 'nunca-exportar', temaModo: 'claro', garantiaPadrao: '120 dias'
  });
  assert.equal(mobile.nomeFantasia, 'Oficina Nuvem');
  assert.equal(mobile.temaModo, 'claro');
  assert.equal(mobile.garantiaDiasPadrao, 120);
  assert.equal(Object.prototype.hasOwnProperty.call(mobile, 'senhaExclusao'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(mobile, 'mercadoPagoToken'), false);

  const desktop = configuracaoDesktopDoMobile({
    nomeFantasia: 'Oficina compartilhada', telefone: '27988887777',
    garantiaDiasPadrao: 0, temaModo: 'claro', termosCustomOS: 'Termo da empresa'
  });
  assert.equal(desktop.nomeEmpresa, 'Oficina compartilhada');
  assert.equal(desktop.telefonePrincipal, '27988887777');
  assert.equal(desktop.garantiaPadrao, '0 dias');
  assert.equal(desktop.temaModo, 'light');
  assert.equal(desktop.termosOS, 'Termo da empresa');

  let configMembro = { nomeEmpresa: 'Cache antigo' };
  const servicoMembro = new CompanyCloudService({
    getClient: () => ({
      from() {
        const consulta = {
          select() { return consulta; }, eq() { return consulta; },
          async maybeSingle() {
            return { error: null, data: { configuracoes: { identidadeEmpresa: {
              configMobile: { nomeFantasia: 'Oficina compartilhada', telefone: '27988887777', garantiaDiasPadrao: 0 },
              configMobileAtualizadaEm: '2026-09-06T12:00:00.000Z'
            } } } };
          }
        };
        return consulta;
      }
    }),
    getContext: () => ({ empresa_id: empresaId, cargo: 'Tecnico' }),
    db: {
      obterConfig: () => Object.assign({}, configMembro),
      salvarConfig: (patch) => { configMembro = Object.assign({}, configMembro, patch); return configMembro; }
    },
    stateStore,
    appVersion: '30.5.123'
  });
  const sincronizada = await servicoMembro.sincronizarConfiguracaoCompartilhada();
  assert.equal(sincronizada.atualizada, true);
  assert.equal(configMembro.nomeEmpresa, 'Oficina compartilhada');
  assert.equal(configMembro.telefonePrincipal, '27988887777');
  assert.equal(configMembro.garantiaPadrao, '0 dias');

  const publicada = await servico.publicarConfiguracaoMobile({ nomeFantasia: 'Oficina Nuvem' });
  assert.equal(publicada.sucesso, true);
  const rpcMobile = chamadas.find((c) => c.nome === 'salvar_configuracao_mobile');
  assert.equal(rpcMobile.parametros.p_config_mobile.nomeFantasia, 'Oficina Nuvem');
  assert.equal(rpcMobile.parametros.p_assinatura_storage_path, '');

  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260718000600_backup_identidade_empresa.sql'), 'utf8');
  assert(/backups_empresa/.test(sql));
  assert(/somente_administrador_pode_alterar_logo/.test(sql));
  assert(/backups-empresa/.test(sql) && /identidade-empresa/.test(sql));
  console.log('OK - backup unico na nuvem, restauracao por empresa e logo administrativa validados.');
})().catch((erro) => { console.error(erro); process.exit(1); });
