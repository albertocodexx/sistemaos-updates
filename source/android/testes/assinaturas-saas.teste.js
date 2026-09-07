'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const interfaceAssinatura = fs.readFileSync(path.join(raiz, 'www', 'js', 'assinaturas-saas.js'), 'utf8');
const sessao = fs.readFileSync(path.join(raiz, 'www', 'js', 'auth', 'sessao.js'), 'utf8');
const empresa = fs.readFileSync(path.join(raiz, 'www', 'js', 'supabase', 'empresa-service.js'), 'utf8');
const consulta = fs.readFileSync(path.join(raiz, 'www', 'js', 'consulta.js'), 'utf8');

assert.match(interfaceAssinatura, /Minha assinatura/);
assert.match(interfaceAssinatura, /criar_checkout/);
assert.match(interfaceAssinatura, /mercadopago\\\.com/);
assert.match(interfaceAssinatura, /mercadopago\\\.com\(\?:\\\.br\)\?/);
assert.match(interfaceAssinatura, /mercadolivre\\\.com\(\?:\\\.br\)\?/);
assert.match(interfaceAssinatura, /acompanharPagamento\(resultado\.cobranca && resultado\.cobranca\.id\)/);
assert.match(interfaceAssinatura, /item\.id === cobrancaId/);
assert.match(interfaceAssinatura, /planoId === atualId \? 'renovacao'/);
assert.match(interfaceAssinatura, /Number\(plano\.preco_referencia\) > 0/);
assert.match(interfaceAssinatura, /SistemaOSSessao\.revalidar/);
assert.match(sessao, /acesso_somente_cobranca/);
assert.match(empresa, /estado: 'cobranca'/);
assert.doesNotMatch(interfaceAssinatura, /service_role|access_token/i);
assert.doesNotMatch(consulta, /OS não encontrada na nuvem/);

console.log('OK: assinatura no celular, pagamento seguro e modo de cobrança exclusiva.');
