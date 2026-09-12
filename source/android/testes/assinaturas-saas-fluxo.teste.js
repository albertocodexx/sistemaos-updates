'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const raiz = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(raiz, 'www', 'js', 'assinaturas-saas.js'), 'utf8');

function consultaEncadeada(resultado) {
  const consulta = {
    select() { return consulta; },
    eq() { return consulta; },
    is() { return consulta; },
    order() { return consulta; },
    then(resolve, reject) { return Promise.resolve(resultado).then(resolve, reject); }
  };
  return consulta;
}

async function montarCenario(resultadoCatalogo) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><form id="form-config"><div></div></form></body></html>', {
    runScripts: 'outside-only', url: 'https://app.local/'
  });
  const { window } = dom;
  window.SistemaOSToast = { mostrar() {} };
  window.SistemaOSSessao = {
    obterEstado() {
      return { tipo: 'autenticado', contexto: { empresa_id: 'empresa-a', plano_id: 'trial' } };
    },
    sair() {}, revalidar() { return Promise.resolve(); }
  };
  window.SupabaseClientApp = {
    obterCliente() {
      return {
        functions: { invoke() { return Promise.reject(new Error('serviço complementar indisponível')); } },
        from() { return consultaEncadeada(resultadoCatalogo); }
      };
    }
  };
  window.eval(script);
  window.SistemaOSAssinaturas.abrir(false);
  await new Promise((resolve) => setTimeout(resolve, 30));
  return dom;
}

(async function () {
  const comPlanos = await montarCenario({
    data: [
      { id: 'trial', nome: 'Trial', preco_referencia: 0, duracao_dias: 45 },
      { id: 'profissional', nome: 'Profissional', descricao: 'Plano completo', preco_referencia: 149.9, duracao_dias: 30 }
    ],
    error: null
  });
  const conteudoPlanos = comPlanos.window.document.getElementById('assinatura-mobile-conteudo').textContent;
  assert.match(conteudoPlanos, /Profissional/);
  assert.doesNotMatch(conteudoPlanos, /Buscando planos/);
  comPlanos.window.close();

  const comErro = await montarCenario({ data: null, error: new Error('sem conexão') });
  const conteudoErro = comErro.window.document.getElementById('assinatura-mobile-conteudo').textContent;
  assert.match(conteudoErro, /Não foi possível carregar os planos/);
  assert.match(conteudoErro, /Tentar novamente/);
  comErro.window.close();

  console.log('OK: planos usam fallback seguro e nunca permanecem em carregamento infinito.');
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
