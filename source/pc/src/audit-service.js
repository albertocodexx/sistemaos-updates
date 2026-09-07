'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const PRIVADO = /senha|password|salt|hash|token|secret|api.?key|authorization|chave|base64|assinatura|cpf|cnpj|telefone|email|endereco|caminho|path|url/i;
function textoSeguro(v) {
  return String(v ?? '').replace(/(?:Bearer\s+\S+|(?:gsk_|sk-proj-|sk_live_|ghp_|sb_secret_)[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)/gi, '[protegido]').slice(0, 400);
}
function sanitizar(v, nivel = 0) {
  if (nivel > 5) return '[resumido]';
  if (v == null) return null;
  if (typeof v === 'string') return textoSeguro(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.slice(0, 40).map(item => sanitizar(item, nivel + 1));
  if (typeof v !== 'object') return null;
  const r = {};
  for (const [k, item] of Object.entries(v).slice(0, 100)) {
    if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
    if (PRIVADO.test(k)) r[k] = item ? '[protegido]' : null;
    else if (/fotos|imagens/i.test(k)) r[k] = Array.isArray(item)
      ? item.slice(0, 40).map(f => ({ id: textoSeguro(f?.id), nome: textoSeguro(f?.nome), categoria: textoSeguro(f?.categoria) })) : '[imagem]';
    else r[k] = sanitizar(item, nivel + 1);
  }
  return r;
}
function diferencas(a, b, prefixo = '', r = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return r;
  if (a && b && !Array.isArray(a) && !Array.isArray(b) && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (r.length >= 80) break;
      diferencas(a[k], b[k], prefixo ? prefixo + '.' + k : k, r);
    }
  } else r.push({ campo: prefixo || 'registro', antes: a ?? null, depois: b ?? null });
  return r;
}
function ehAlteracao(canal) {
  return /:(criar|atualizar|editar|excluir|remover|salvar|substituir|registrar|confirmar|alterar|movimentar|baixarEstoque|definir|configurar|zerar|importar|executarAcao|enviar)/.test(canal)
    && !['supabase:registrarErroUsuario', 'supabase:atualizarSenha', 'supabase:configurarTrocaRapida'].includes(canal);
}
function criarAuditoria({ getRootDir, getEmpresaId, obterRegistro = () => undefined }) {
  const contexto = new AsyncLocalStorage();
  const getCaminhoLog = () => path.join(getRootDir(), 'auditoria.log');
  function anexar(linha, arquivo = getCaminhoLog()) {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.appendFileSync(arquivo, JSON.stringify(linha) + '\n', { encoding: 'utf8', mode: 0o600 });
  }
  function identidade(u) {
    return u && typeof u === 'object' ? { id: textoSeguro(u.id), nome: textoSeguro(u.nome || u.usuario || u.id) }
      : { id: '', nome: textoSeguro(u || 'Sistema') };
  }
  function registrar(acao, detalhes, usuario) {
    const atual = contexto.getStore();
    if (atual?.automatico) return;
    try {
      anexar({ id: randomUUID(), data: new Date().toISOString(), empresaId: atual?.empresaId || getEmpresaId(),
        acao: textoSeguro(acao), usuario: identidade(atual?.usuario || usuario), origem: 'pc', status: 'concluido',
        detalhes: sanitizar(detalhes || {}) }, atual?.arquivo);
    } catch (_) { console.error('Não foi possível gravar o histórico de atividades.'); }
  }
  async function executarComContexto({ usuario, canal, args }, executar) {
    const atual = { usuario, empresaId: getEmpresaId(), arquivo: getCaminhoLog(), automatico: ehAlteracao(canal) };
    return contexto.run(atual, async () => {
      if (!atual.automatico) return executar();
      let antes;
      try { antes = sanitizar(await obterRegistro(canal, args)); } catch (_) { antes = null; }
      let resultado, status = 'concluido';
      try {
        resultado = await executar();
        if (resultado?.cancelado || resultado?.canceled) status = 'cancelado';
        else if (resultado === false || resultado?.sucesso === false) status = 'recusado';
        return resultado;
      } catch (erro) { status = 'erro'; throw erro; }
      finally {
        try {
          const depois = status === 'concluido' ? sanitizar(await obterRegistro(canal, args, resultado)) : antes;
          // Nunca serializar args: podem conter senhas, tokens e imagens.
          const registro = resultado?.numero || resultado?.id || (typeof args?.[0] === 'string' && !/config|auth|supabase|whatsapp|wappfly/.test(canal) ? args[0] : '');
          anexar({ id: randomUUID(), data: new Date().toISOString(), empresaId: atual.empresaId,
            usuario: identidade(usuario), acao: canal, registro: textoSeguro(registro), origem: 'pc', status,
            alteracoes: diferencas(antes, depois) }, atual.arquivo);
        } catch (_) { console.error('Não foi possível gravar o histórico de atividades.'); }
      }
    });
  }
  function listar(filtros = {}) {
    const arquivo = getCaminhoLog();
    if (!fs.existsSync(arquivo)) return { itens: [], limitado: false };
    const fd = fs.openSync(arquivo, 'r');
    let conteudo, limitado;
    try {
      const tamanho = fs.fstatSync(fd).size, bytes = Math.min(tamanho, 2 * 1024 * 1024);
      const buffer = Buffer.alloc(bytes);
      const lidos = fs.readSync(fd, buffer, 0, bytes, tamanho - bytes);
      conteudo = buffer.subarray(0, lidos).toString('utf8');
      limitado = tamanho > bytes;
      if (limitado) conteudo = conteudo.slice(conteudo.indexOf('\n') + 1);
    } finally { fs.closeSync(fd); }
    const limite = Math.max(1, Math.min(500, Number(filtros.limite) || 200));
    const busca = textoSeguro(filtros.busca).toLocaleLowerCase('pt-BR'), empresa = getEmpresaId();
    const dataLocal = l => new Date(l.data).toLocaleDateString('sv-SE');
    const encontrados = conteudo.split('\n').filter(Boolean).map(l => { try { return sanitizar(JSON.parse(l)); } catch (_) { return null; } })
      .filter(l => l && l.empresaId === empresa && typeof l.acao === 'string' && Number.isFinite(Date.parse(l.data)))
      .filter(l => !filtros.inicio || dataLocal(l) >= String(filtros.inicio))
      .filter(l => !filtros.fim || dataLocal(l) <= String(filtros.fim))
      .filter(l => !filtros.acao || l.acao.startsWith(String(filtros.acao)))
      .filter(l => !busca || JSON.stringify(l).toLocaleLowerCase('pt-BR').includes(busca)).reverse();
    return { itens: encontrados.slice(0, limite), limitado: limitado || encontrados.length > limite, limite };
  }
  return { registrar, executarComContexto, listar, getCaminhoLog, lerUltimasLinhas: limite => listar({ limite }).itens };
}
module.exports = { criarAuditoria, sanitizar, diferencas, ehAlteracao };
