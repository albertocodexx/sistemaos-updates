const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

(async () => {
  const chamadas = [];
  const salvamentosLocais = [];
  globalThis.crypto = crypto.webcrypto;
  globalThis.atob = (texto) => Buffer.from(texto, 'base64').toString('binary');
  globalThis.ConfigApp = {
    salvarConfig(patch) { salvamentosLocais.push(patch); }
  };
  globalThis.SupabaseClientApp = {
    obterCliente() {
      return {
        from(tabela) {
          const query = {
            select() { return query; },
            eq() { return query; },
            async maybeSingle() {
              chamadas.push({ tipo: 'select', tabela });
              return { error: null, data: { configuracoes: { identidadeEmpresa: {} } } };
            }
          };
          return query;
        },
        storage: {
          from(bucket) {
            return {
              async upload(caminho) {
                chamadas.push({ tipo: 'upload', bucket, caminho });
                return { error: null };
              },
              async remove(caminhos) {
                chamadas.push({ tipo: 'remove', bucket, caminhos });
                return { error: null };
              }
            };
          }
        },
        async rpc(nome, dados) {
          chamadas.push({ tipo: 'rpc', nome, dados });
          return { error: null, data: dados };
        }
      };
    }
  };

  delete require.cache[require.resolve('../www/js/supabase/empresa-service.js')];
  const servico = require('../www/js/supabase/empresa-service.js');
  const empresa = '11111111-1111-4111-8111-111111111111';
  const sincronizado = await servico.sincronizarConfiguracoesEmpresa({
    empresa_id: empresa,
    cargo: 'Administrador'
  });
  assert.equal(sincronizado, null);
  assert.equal(
    salvamentosLocais.length,
    0,
    'metadados legados vazios não podem apagar a configuração local'
  );

  const assinatura = 'data:image/png;base64,' + Buffer.from('assinatura').toString('base64');
  await servico.salvarConfiguracoesEmpresa(
    { empresa_id: empresa, cargo: 'Administrador' },
    {
      nomeFantasia: 'Assistência Teste',
      assinaturaAssistenciaBase64: assinatura,
      supabasePublishableKey: 'nao-deve-subir'
    }
  );

  const chamadasRpc = chamadas.filter((item) => item.tipo === 'rpc' && item.nome === 'salvar_configuracao_mobile');
  const chamadaRpc = chamadasRpc[chamadasRpc.length - 1];
  assert(chamadaRpc, 'o APK deve salvar as configurações pela RPC protegida');
  assert.equal(chamadasRpc.length, 2, 'a configuração deve ser confirmada antes e depois do upload da assinatura');
  assert.equal(chamadaRpc.dados.p_config_mobile.nomeFantasia, 'Assistência Teste');
  assert.equal(chamadaRpc.dados.p_config_mobile.supabasePublishableKey, undefined);
  assert.equal(chamadaRpc.dados.p_assinatura_storage_path, empresa + '/assinatura-assistencia.png');
  assert(chamadas.some((item) => item.tipo === 'upload' && item.caminho === empresa + '/assinatura-assistencia.png'));
  assert(
    chamadas.findIndex((item) => item.tipo === 'rpc' && item.nome === 'salvar_configuracao_mobile') <
      chamadas.findIndex((item) => item.tipo === 'upload'),
    'campos comuns devem chegar à nuvem mesmo se o upload da assinatura falhar'
  );
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'supabase', 'empresa-service.js'), 'utf8');
  assert.match(fonte, /config-mobile-reconciliada-v2/, 'upgrade deve reconciliar a configuracao local antes de baixar uma copia antiga');
  assert.match(fonte, /configuracaoLocalSignificativa/, 'instalacao nova vazia nao pode sobrescrever a configuracao da nuvem');
  console.log('OK: configurações e assinatura do APK são persistidas pela RPC segura.');
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
