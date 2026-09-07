const assert = require('assert');

(async () => {
  const chamadas = [];
  const salvamentosLocais = [];
  const empresa = '11111111-1111-4111-8111-111111111111';
  globalThis.localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  };
  globalThis.ConfigApp = {
    salvarConfig(patch) { salvamentosLocais.push(Object.assign({}, patch)); return patch; }
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
              return { error: null, data: { configuracoes: { identidadeEmpresa: {
                configMobileAtualizadaEm: '2026-09-07T12:00:00.000Z',
                configMobile: {
                  nomeEmpresa: 'TechReparos', nomeFantasia: 'TechReparos',
                  telefone: '(27) 99999-0000', telefoneFixo: '(27) 3333-0000',
                  email: 'contato@empresa.test', site: 'https://empresa.test',
                  endereco: 'Rua Teste', numero: '10', complemento: 'Sala 2',
                  bairro: 'Centro', cidade: 'Linhares', estado: 'ES', cep: '29900-000'
                }
              } } } };
            }
          };
          return query;
        },
        async rpc(nome) { chamadas.push({ tipo: 'rpc', nome }); return { error: null }; },
        storage: { from() { return { async upload() { chamadas.push({ tipo: 'upload' }); return { error: null }; } }; } }
      };
    }
  };

  delete require.cache[require.resolve('../www/js/supabase/empresa-service.js')];
  const servico = require('../www/js/supabase/empresa-service.js');
  const sincronizado = await servico.sincronizarConfiguracoesEmpresa({ empresa_id: empresa, cargo: 'Administrador' });
  assert.equal(sincronizado.nomeEmpresa, 'TechReparos');
  assert.equal(sincronizado.site, 'https://empresa.test');
  assert.equal(sincronizado.numero, '10');
  assert.equal(salvamentosLocais.length, 1, 'Android deve apenas aplicar a configuracao recebida do PC');
  assert.equal(salvamentosLocais[0].telefoneFixo, '(27) 3333-0000');
  assert.equal(salvamentosLocais[0].bairro, 'Centro');

  await assert.rejects(
    () => servico.salvarConfiguracoesEmpresa({ empresa_id: empresa, cargo: 'Administrador' }, { nomeFantasia: 'Indevido' }),
    /somente.*PC/i
  );
  await assert.rejects(
    () => servico.atualizarLogoEmpresa({ empresa_id: empresa, cargo: 'Administrador' }, 'data:image/png;base64,AA=='),
    /somente.*PC/i
  );
  assert.equal(chamadas.some((item) => item.tipo === 'rpc' || item.tipo === 'upload'), false,
    'Android nao pode publicar identidade nem logo');
  console.log('OK: Android recebe todos os dados da empresa do PC e nao permite altera-los.');
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
