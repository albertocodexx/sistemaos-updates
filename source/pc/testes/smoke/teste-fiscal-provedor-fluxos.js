'use strict';

// Exercita a Edge Function real sem certificado, SEFAZ, dados pessoais ou cobranca.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

async function main() {
  const notas = new Map([
    ['nota-a', { id: 'nota-a', empresa_id: 'empresa-a', status: 'na_fila', numero: null,
      chave_acesso: null, codigo_verificacao: null, danfse_storage_path: null, danfse_url: null }],
    ['nota-b', { id: 'nota-b', empresa_id: 'empresa-b', status: 'processando', numero: null,
      chave_acesso: null, codigo_verificacao: null, danfse_storage_path: null, danfse_url: null }]
  ]);
  const arquivos = new Map();
  let forcarConcorrencia = false;
  const admin = {
    from(tabela) {
      assert.equal(tabela, 'notas_fiscais');
      let id = null;
      let empresaId = null;
      let statusAnterior = null;
      let alteracoes = null;
      const consulta = {
        select() { return consulta; },
        update(valor) { alteracoes = valor; return consulta; },
        eq(campo, valor) {
          if (campo === 'id') id = valor;
          if (campo === 'empresa_id') empresaId = valor;
          if (campo === 'status') statusAnterior = valor;
          return consulta;
        },
        async maybeSingle() {
          const nota = notas.get(id);
          if (!nota || nota.empresa_id !== empresaId) return { data: null, error: null };
          if (alteracoes) {
            if (forcarConcorrencia || nota.status !== statusAnterior) return { data: null, error: null };
            Object.assign(nota, alteracoes);
          }
          return { data: { ...nota }, error: null };
        }
      };
      return consulta;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'documentos-fiscais');
        return {
          async upload(caminho, bytes, opcoes) {
            assert.equal(opcoes.upsert, false);
            if (arquivos.has(caminho)) return { error: new Error('Arquivo ja existe') };
            arquivos.set(caminho, bytes);
            return { error: null };
          },
          async remove(caminhos) {
            caminhos.forEach((caminho) => arquivos.delete(caminho));
            return { error: null };
          }
        };
      }
    }
  };
  let atender;
  let codigo = fs.readFileSync(path.join(__dirname, '../../supabase/functions/fiscal-documentos-provedor/index.ts'), 'utf8');
  codigo = codigo.replace(/^import .*createClient.*;\r?\n/m, '');
  const ambiente = {
    Request, Response, Headers, URL, TextEncoder, TextDecoder, Uint8Array, atob,
    crypto: webcrypto, console: { error() {} },
    Deno: { env: { get: (nome) => nome === 'CRON_SECRET' ? 'segredo-local-qa' : 'fixture-local' },
      serve: (funcao) => { atender = funcao; } },
    createClient: () => admin
  };
  vm.createContext(ambiente);
  vm.runInContext(stripTypeScriptTypes(codigo), ambiente);
  const enviar = async (dados, segredo = 'segredo-local-qa') => {
    const resposta = await atender(new Request('https://qa.invalid/fiscal-documentos-provedor', {
      method: 'POST', headers: { 'x-cron-secret': segredo, 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'registrar_resultado', dados: { empresaId: 'empresa-a', notaId: 'nota-a', ...dados } })
    }));
    return { status: resposta.status, corpo: await resposta.json() };
  };
  assert.equal((await enviar({ status: 'autorizada' }, 'errado')).status, 401);
  assert.equal((await enviar({ status: 'autorizada', empresaId: 'empresa-b' })).status, 404);
  assert.equal((await enviar({ status: 'inexistente' })).status, 400);
  assert.equal((await enviar({ status: 'autorizada' })).status, 400, 'autorizacao exige identificadores oficiais');
  const pdf = Buffer.from('%PDF-1.7\n%%EOF').toString('base64');
  assert.equal((await enviar({ status: 'rejeitada', danfseBase64: pdf })).status, 400,
    'documento rejeitado nao deve armazenar DANFSe');
  assert.equal((await enviar({ status: 'autorizada', numero: '100', chaveAcesso: 'ABC123', danfseBase64: pdf })).status, 200);
  const caminho = notas.get('nota-a').danfse_storage_path;
  const emitidaEm = notas.get('nota-a').emitida_em;
  assert.match(caminho, /^empresa-a\/nota-a\/danfse-[\w-]+\.pdf$/);
  assert.equal(arquivos.size, 1);
  assert.equal((await enviar({ status: 'autorizada', numero: '100', chaveAcesso: 'ABC123', danfseBase64: pdf })).status, 200);
  assert.equal(notas.get('nota-a').emitida_em, emitidaEm, 'retry nao altera data oficial');
  assert.equal(notas.get('nota-a').danfse_storage_path, caminho, 'retry nao sobrescreve PDF');
  assert.equal(arquivos.size, 1);
  assert.equal((await enviar({ status: 'autorizada', numero: '101', chaveAcesso: 'ABC123' })).status, 409);
  assert.equal((await enviar({ status: 'autorizada', numero: '100', chaveAcesso: 'OUTRA' })).status, 409);
  assert.equal((await enviar({ status: 'cancelada' })).status, 200);
  assert.equal((await enviar({ status: 'cancelada' })).status, 200, 'cancelamento repetido e idempotente');
  assert.equal((await enviar({ status: 'autorizada', numero: '100', chaveAcesso: 'ABC123' })).status, 409);

  // Um callback que perde a corrida no banco remove apenas seu PDF unico.
  notas.set('nota-c', { id: 'nota-c', empresa_id: 'empresa-a', status: 'na_fila', numero: null,
    chave_acesso: null, codigo_verificacao: null, danfse_storage_path: null, danfse_url: null });
  forcarConcorrencia = true;
  assert.equal((await enviar({ notaId: 'nota-c', status: 'autorizada', numero: '200',
    codigoVerificacao: 'COD200', danfseBase64: pdf })).status, 409);
  assert.equal(arquivos.size, 1, 'PDF de retorno concorrente nao fica exposto nem sobrescreve o oficial');
  forcarConcorrencia = false;
  assert.equal((await enviar({ notaId: 'nota-b', empresaId: 'empresa-b', status: 'rejeitada' })).status, 200);
  assert.equal((await enviar({ notaId: 'nota-b', empresaId: 'empresa-b', status: 'autorizada',
    numero: '300', codigoVerificacao: 'COD300' })).status, 409);
  console.log('OK: resultado fiscal, isolacao, autorizacao, PDF, cancelamento, rejeicao, retries e concorrencia.');
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
