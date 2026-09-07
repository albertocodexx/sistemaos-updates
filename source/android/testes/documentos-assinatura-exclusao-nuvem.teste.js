'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const ler = arquivo => fs.readFileSync(path.join(raiz, arquivo), 'utf8');
const tela = ler('www/index.html');
const fluxo = ler('www/js/documentos-recebidos.js');
const migracao = fs.readFileSync(path.resolve(raiz, '..', 'sistemaos-pc', 'supabase', 'migrations', '20260829000200_cancelar_assinatura_remota.sql'), 'utf8');

assert.match(tela, /id="btn-assinar-doc"[^>]*>Assinar documento</);
assert.match(tela, /id="btn-nao-assinado-doc"[^>]*>Marcar como não assinado</);
assert.match(tela, /Enviar decisão para o PC/);
assert.match(fluxo, /statusLocal = 'nao_assinado'/);
assert.match(fluxo, /respostaAutomatica\.naoAssinado = registro\.statusLocal === 'nao_assinado'/);
assert.match(fluxo, /cancelar_solicitacao_assinatura_remota/);
assert.match(fluxo, /exclusaoNuvem\.then[\s\S]*excluirDocumentoRecebido/, 'a exclusão local deve ocorrer só depois da nuvem');
assert.match(migracao, /status = 'cancelada'/);
assert.match(migracao, /pacote = jsonb_build_object/);
assert.match(migracao, /grant execute[\s\S]*to authenticated/);

console.log('OK — assinatura, não assinado e exclusão permanente na nuvem estão cobertos.');
