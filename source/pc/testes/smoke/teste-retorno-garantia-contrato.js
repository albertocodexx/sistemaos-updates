'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fonte = fs.readFileSync(path.join(__dirname, '../../src/database/domain.js'), 'utf8');
assert.match(fonte, /STATUS_RETORNO_GARANTIA_VALIDOS[^\n]*\['Em análise', 'Em reparo', 'Pronto para retirada', 'Entregue'\]/);
assert.match(fonte, /function registrarRetornoGarantia\(/);
assert.match(fonte, /function atualizarStatusRetornoGarantia\(/);
assert.match(fonte, /retornosGarantia:/);
assert.match(fonte, /origem: 'retorno_garantia'/);
assert.match(fonte, /module\.exports\.registrarRetornoGarantia/);
assert.match(fonte, /module\.exports\.atualizarStatusRetornoGarantia/);

const sync = fs.readFileSync(path.join(__dirname, '../../src/supabase/aftercare-service.js'), 'utf8');
assert.match(sync, /'retornosGarantia'/);
assert.match(sync, /'statusRetorno'/);

console.log('OK — retorno em garantia possui jornada, histórico e contrato de sincronização.');
