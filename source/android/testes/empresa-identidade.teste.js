const assert = require('assert');
const crypto = require('crypto');

(async () => {
  const chamadas = [];
  globalThis.crypto = crypto.webcrypto;
  globalThis.atob = (texto) => Buffer.from(texto, 'base64').toString('binary');
  globalThis.ConfigApp = {
    salvarConfig(patch) { chamadas.push({ tipo: 'config', patch }); return patch; }
  };
  globalThis.SupabaseClientApp = {
    obterCliente() {
      return {
        storage: { from(bucket) { return {
          async upload(caminho, bytes, opcoes) { chamadas.push({ tipo: 'upload', bucket, caminho, bytes, opcoes }); return { error: null }; },
          async remove(paths) { chamadas.push({ tipo: 'remove', bucket, paths }); return { error: null }; }
        }; } },
        async rpc(nome, dados) { chamadas.push({ tipo: 'rpc', nome, dados }); return { error: null, data: dados }; }
      };
    }
  };

  delete require.cache[require.resolve('../www/js/supabase/empresa-service.js')];
  const servico = require('../www/js/supabase/empresa-service.js');
  const empresa = '11111111-1111-4111-8111-111111111111';
  assert.equal(servico.ehAdministrador({ cargo: 'Administrador' }), true);
  assert.equal(servico.ehAdministrador({ cargo: 'Atendente' }), false);
  await assert.rejects(
    () => servico.atualizarLogoEmpresa({ empresa_id: empresa, cargo: 'Atendente' }, ''),
    /administrador|propriet/i
  );
  const dataUrl = 'data:image/png;base64,' + Buffer.from('logo-padrao').toString('base64');
  const resposta = await servico.atualizarLogoEmpresa({ empresa_id: empresa, cargo: 'Administrador' }, dataUrl);
  assert.equal(resposta.possuiLogo, true);
  assert(chamadas.some((item) => item.tipo === 'upload' && item.caminho === empresa + '/logo.png'));
  assert(chamadas.some((item) => item.nome === 'definir_logo_empresa'));
  assert(chamadas.some((item) => item.tipo === 'config' && item.patch.logoBase64 === dataUrl));
  console.log('OK - logo unica por empresa e alteracao exclusiva do administrador validadas.');
})().catch((erro) => { console.error(erro); process.exit(1); });
