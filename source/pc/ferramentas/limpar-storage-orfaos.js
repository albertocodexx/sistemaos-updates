'use strict';

// Remove somente objetos que ainda pertencem a metadados logicamente
// excluidos e que nao sao referenciados por nenhuma linha ativa. A chave
// administrativa deve vir do ambiente e nunca e gravada no projeto/log.
const { createClient } = require('@supabase/supabase-js');

function obrigatoria(nome) {
  const valor = String(process.env[nome] || '').trim();
  if (!valor) throw new Error(`Variavel ${nome} obrigatoria.`);
  return valor;
}

async function listarTodas(client, excluidas) {
  const linhas = [];
  let inicio = 0;
  while (true) {
    let consulta = client.from('arquivos')
      .select('id,storage_bucket,arquivo_nuvem_path,miniatura_path,deleted_at')
      .order('id', { ascending: true })
      .range(inicio, inicio + 999);
    consulta = excluidas ? consulta.not('deleted_at', 'is', null) : consulta.is('deleted_at', null);
    const { data, error } = await consulta;
    if (error) throw error;
    linhas.push(...(data || []));
    if (!data || data.length < 1000) break;
    inicio += data.length;
  }
  return linhas;
}

function chave(bucket, caminho) {
  return `${bucket || ''}\n${caminho || ''}`;
}

async function executar() {
  const aplicar = process.argv.includes('--apply');
  const client = createClient(obrigatoria('SUPABASE_URL'), obrigatoria('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const [ativas, excluidas] = await Promise.all([
    listarTodas(client, false), listarTodas(client, true)
  ]);
  const referenciasAtivas = new Set();
  for (const linha of ativas) {
    if (linha.storage_bucket && linha.arquivo_nuvem_path) {
      referenciasAtivas.add(chave(linha.storage_bucket, linha.arquivo_nuvem_path));
    }
    if (linha.miniatura_path) referenciasAtivas.add(chave('miniaturas', linha.miniatura_path));
  }
  const porBucket = new Map();
  function candidato(bucket, caminho) {
    if (!bucket || !caminho || referenciasAtivas.has(chave(bucket, caminho))) return;
    if (!['documentos-pdf', 'arquivos-os', 'miniaturas'].includes(bucket)) return;
    if (!porBucket.has(bucket)) porBucket.set(bucket, new Set());
    porBucket.get(bucket).add(caminho);
  }
  for (const linha of excluidas) {
    candidato(linha.storage_bucket, linha.arquivo_nuvem_path);
    candidato('miniaturas', linha.miniatura_path);
  }

  let removidos = 0;
  const resumo = {};
  for (const [bucket, conjunto] of porBucket) {
    const caminhos = [...conjunto];
    resumo[bucket] = caminhos.length;
    if (!aplicar) continue;
    for (let i = 0; i < caminhos.length; i += 100) {
      const lote = caminhos.slice(i, i + 100);
      const { data, error } = await client.storage.from(bucket).remove(lote);
      if (error) throw error;
      removidos += (data || []).length;
    }
  }
  console.log(JSON.stringify({ modo: aplicar ? 'apply' : 'dry-run', candidatos: resumo, removidos }, null, 2));
}

executar().catch((erro) => {
  console.error('Falha na limpeza segura:', erro.message);
  process.exitCode = 1;
});
