'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { podeModulo, podeAcaoIA } = require('../../src/access-policy');
const { exigirAcesso } = require('../../src/ipc/secure-ipc');
const { arquivoPermitido } = require('../../src/local-file-access');
const { criarAuditoria } = require('../../src/audit-service');
let verificacoes = 0;
function verificar(atual, esperado) { assert.deepEqual(atual, esperado); verificacoes++; }

async function executar() {
  const modulos = ['os', 'clientes', 'estoque', 'financeiro', 'relatorios', 'configuracoes', 'usuarios'];
  for (let mascara = 0; mascara < 128; mascara++) {
    const permissoes = Object.fromEntries(modulos.map((m, i) => [m, !!(mascara & (1 << i))]));
    const u = { id: 'qa-' + mascara, permissoes };
    for (const m of modulos) verificar(podeModulo(u, m), permissoes[m]);
    verificar(podeAcaoIA(u, 'alterar_status_cobranca'), permissoes.financeiro);
    verificar(podeAcaoIA(u, 'adicionar_custos_compra'), permissoes.estoque);
    verificar(podeAcaoIA(u, 'criar_os'), permissoes.os);
    verificar(podeAcaoIA(u, '__proto__'), false);
    verificar(podeAcaoIA(u, 'constructor'), false);
  }
  for (const valor of [false, 'true', 1, {}, { ler: 'true' }, { editar: true }]) {
    verificar(podeModulo({ permissoes: { financeiro: valor } }, 'financeiro'), false);
  }
  for (const canal of ['auditoria:listar', 'sistema:zerar', 'auth:criarUsuario', 'cargos:editar']) {
    assert.throws(() => exigirAcesso(canal, { id: 'operador', permissoes: Object.fromEntries(modulos.map(m => [m, true])) })); verificacoes++;
  }

  // IA sem acesso nem sequer le o banco da categoria proibida.
  const fonte = fs.readFileSync(path.join(__dirname, '../../src/ia-chat.js'), 'utf8');
  let leiturasProibidas = 0;
  const banco = new Proxy({ loadDB: () => ({ config: {} }) }, { get(alvo, k) {
    if (k in alvo) return alvo[k];
    return () => { leiturasProibidas++; throw new Error('Leitura indevida'); };
  } });
  const sandbox = { module: { exports: {} }, exports: {}, console, Intl, Date, setTimeout, clearTimeout,
    require: id => {
      if (id === './db') return banco;
      if (id === './ia-provider') return { normalizarProvedor: () => 'groq', PROVEDORES: { groq: { key: 'groqChatApiKey' } } };
      if (id === './ia-groq' || id === './whatsapp') return {};
      if (id === './access-policy') return require('../../src/access-policy');
      return require(id);
    }
  };
  vm.runInNewContext(fonte, sandbox);
  const ia = sandbox.module.exports;
  verificar(JSON.stringify(ia._montarContextoDados(null, { id: 'sem-acesso', permissoes: {} })), '{}');
  verificar(JSON.stringify(ia._montarContextoDados(['financeiro', 'compras', 'resumo'], { id: 'tecnico', permissoes: { os: true } })), '{}');
  verificar((await ia.executarAcao({ tipo: 'alterar_status_cobranca', dados: {} }, { permissoes: { os: true } })).sucesso, false);
  await ia.responderPergunta('gasto em cp0003', [], { id: 'operador', permissoes: { os: true } });
  verificar(leiturasProibidas, 0);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sistemaos-seguranca-qa-'));
  try {
    const raiz = path.join(temp, 'empresa-a'), outra = path.join(temp, 'empresa-b');
    fs.mkdirSync(raiz); fs.mkdirSync(outra);
    fs.writeFileSync(path.join(raiz, 'documento.pdf'), '%PDF-teste');
    fs.writeFileSync(path.join(raiz, 'programa.exe'), 'fixture inerte');
    fs.writeFileSync(path.join(outra, 'documento.pdf'), '%PDF-teste');
    verificar(arquivoPermitido(path.join(raiz, 'documento.pdf'), raiz), true);
    for (const caminho of [path.join(raiz, 'programa.exe'), outra, path.join(outra, 'documento.pdf'), path.join(raiz, '..', 'empresa-b', 'documento.pdf'), path.join(raiz, 'documento.pdf:stream'), 'documento.pdf', 'https://externo.invalid/a.pdf']) {
      verificar(arquivoPermitido(caminho, raiz), false);
    }
    fs.symlinkSync(outra, path.join(raiz, 'atalho'), process.platform === 'win32' ? 'junction' : 'dir');
    verificar(arquivoPermitido(path.join(raiz, 'atalho', 'documento.pdf'), raiz), false);

    let empresa = 'empresa-a', registro = { id: 'EST-QA', valorVenda: 100, fotos: [], senhaAparelho: 'SEGREDO-DE-TESTE' };
    const audit = criarAuditoria({ getRootDir: () => path.join(temp, empresa), getEmpresaId: () => empresa, obterRegistro: () => registro });
    const usuario = { id: 'tecnico-qa', nome: 'Técnico QA' };
    await audit.executarComContexto({ usuario, canal: 'estoque:atualizar', args: ['EST-QA', { token: 'SEGREDO-DE-TESTE' }] }, () => {
      registro.valorVenda = 150;
      audit.registrar('estoque:atualizar', { senha: 'SEGREDO-DE-TESTE' }, { id: 'admin-forjado' });
      return registro;
    });
    await audit.executarComContexto({ usuario, canal: 'estoque:salvarFoto', args: ['EST-QA', 'BASE64-DE-TESTE'] }, () => {
      registro.fotos.push({ id: 'foto-1', nome: 'frente.jpg', base64: 'BASE64-DE-TESTE' }); return { sucesso: true };
    });
    let linhas = audit.listar().itens;
    verificar(linhas.length, 2);
    verificar(linhas[1].usuario.id, usuario.id);
    verificar(linhas[1].alteracoes.find(m => m.campo === 'valorVenda'), { campo: 'valorVenda', antes: 100, depois: 150 });
    verificar(linhas[0].alteracoes.some(m => m.campo === 'fotos'), true);
    verificar(fs.readFileSync(audit.getCaminhoLog(), 'utf8').includes('SEGREDO-DE-TESTE'), false);
    verificar(fs.readFileSync(audit.getCaminhoLog(), 'utf8').includes('BASE64-DE-TESTE'), false);
    verificar(audit.listar({ busca: 'Técnico QA', acao: 'estoque:atualizar' }).itens.length, 1);
    empresa = 'empresa-b'; verificar(audit.listar().itens.length, 0); empresa = 'empresa-a';
    await assert.rejects(audit.executarComContexto({ usuario, canal: 'estoque:excluir', args: ['EST-QA'] }, () => { throw new Error('SEGREDO-DE-TESTE'); }));
    verificar(audit.listar().itens[0].status, 'erro');
    verificar(fs.readFileSync(audit.getCaminhoLog(), 'utf8').includes('SEGREDO-DE-TESTE'), false);
  } finally {
    // Apenas a fixture criada acima, nunca o workspace nem dados do usuario.
    assert.equal(path.dirname(temp), os.tmpdir());
    assert.ok(path.basename(temp).startsWith('sistemaos-seguranca-qa-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`OK: ${verificacoes} verificacoes locais de autorizacao, IA, arquivos, segredos e auditoria.`);
}
executar().catch(erro => { console.error(erro); process.exitCode = 1; });
