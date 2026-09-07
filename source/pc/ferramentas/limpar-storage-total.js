'use strict';

// Manutencao segura do Supabase Storage.
// Mantem apenas objetos referenciados por entidades ativas e, com
// --purge-database, remove definitivamente OS que ja estavam em lixeira.
const { createClient } = require('@supabase/supabase-js');

function obrigatoria(nome) {
  const valor = String(process.env[nome] || '').trim();
  if (!valor) throw new Error(`Variavel ${nome} obrigatoria.`);
  return valor;
}

async function todas(client, tabela, campos) {
  const linhas = [];
  let inicio = 0;
  while (true) {
    const { data, error } = await client.from(tabela).select(campos)
      .order('id', { ascending: true }).range(inicio, inicio + 999);
    if (error) throw error;
    linhas.push(...(data || []));
    if (!data || data.length < 1000) break;
    inicio += data.length;
  }
  return linhas;
}

async function listarObjetos(storage, bucket, prefixo, saida) {
  let offset = 0;
  while (true) {
    const { data, error } = await storage.from(bucket).list(prefixo || '', {
      limit: 1000, offset, sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw error;
    for (const item of (data || [])) {
      const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
      if (!item.id) await listarObjetos(storage, bucket, caminho, saida);
      else saida.push(caminho);
    }
    if (!data || data.length < 1000) break;
    offset += data.length;
  }
}

async function removerEmLotes(client, bucket, caminhos) {
  let removidos = 0;
  for (let i = 0; i < caminhos.length; i += 100) {
    const { data, error } = await client.storage.from(bucket).remove(caminhos.slice(i, i + 100));
    if (error) throw error;
    removidos += (data || []).length;
  }
  return removidos;
}

async function excluirIds(client, tabela, coluna, ids) {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await client.from(tabela).delete().in(coluna, ids.slice(i, i + 100));
    if (error) throw error;
  }
}

async function executar() {
  const aplicar = process.argv.includes('--apply');
  const purgarBanco = aplicar && process.argv.includes('--purge-database');
  const client = createClient(obrigatoria('SUPABASE_URL'), obrigatoria('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const [ordens, garantias, entregas, compras, vendas, arquivos] = await Promise.all([
    todas(client, 'ordens_servico', 'id,deleted_at'),
    todas(client, 'garantias', 'id,ordem_servico_id,deleted_at'),
    todas(client, 'entregas', 'id,ordem_servico_id,deleted_at'),
    todas(client, 'compras', 'id,deleted_at'),
    todas(client, 'vendas', 'id,deleted_at'),
    todas(client, 'arquivos', 'id,entidade_tipo,entidade_id,storage_bucket,arquivo_nuvem_path,miniatura_path,deleted_at')
  ]);

  const idsOsAtivas = new Set(ordens.filter(x => !x.deleted_at).map(x => x.id));
  const idsOsExcluidas = ordens.filter(x => x.deleted_at).map(x => x.id);
  const ativos = {
    ordem_servico: idsOsAtivas,
    garantia: new Set(garantias.filter(x => !x.deleted_at && idsOsAtivas.has(x.ordem_servico_id)).map(x => x.id)),
    entrega: new Set(entregas.filter(x => !x.deleted_at && idsOsAtivas.has(x.ordem_servico_id)).map(x => x.id)),
    compra: new Set(compras.filter(x => !x.deleted_at).map(x => x.id)),
    venda: new Set(vendas.filter(x => !x.deleted_at).map(x => x.id))
  };
  const referencias = new Map([['arquivos-os', new Set()], ['documentos-pdf', new Set()], ['miniaturas', new Set()]]);
  const metadadosInvalidos = [];
  for (const arquivo of arquivos) {
    const conjunto = ativos[arquivo.entidade_tipo];
    const valido = !arquivo.deleted_at && (!conjunto || conjunto.has(arquivo.entidade_id));
    if (!valido) { metadadosInvalidos.push(arquivo.id); continue; }
    if (arquivo.storage_bucket && arquivo.arquivo_nuvem_path && referencias.has(arquivo.storage_bucket)) {
      referencias.get(arquivo.storage_bucket).add(arquivo.arquivo_nuvem_path);
    }
    if (arquivo.miniatura_path) referencias.get('miniaturas').add(arquivo.miniatura_path);
  }

  const orfaos = {};
  for (const bucket of referencias.keys()) {
    const existentes = [];
    await listarObjetos(client.storage, bucket, '', existentes);
    orfaos[bucket] = existentes.filter(caminho => !referencias.get(bucket).has(caminho));
  }

  let objetosRemovidos = 0;
  if (aplicar) {
    for (const [bucket, caminhos] of Object.entries(orfaos)) {
      objetosRemovidos += await removerEmLotes(client, bucket, caminhos);
    }
  }

  if (purgarBanco) {
    const idsGarantiasExcluidas = garantias.filter(x => idsOsExcluidas.includes(x.ordem_servico_id)).map(x => x.id);
    const idsEntregasExcluidas = entregas.filter(x => idsOsExcluidas.includes(x.ordem_servico_id)).map(x => x.id);
    const entidadesExcluidas = [...idsOsExcluidas, ...idsGarantiasExcluidas, ...idsEntregasExcluidas];
    await excluirIds(client, 'operacoes_sincronizacao', 'entidade_id', entidadesExcluidas);
    await excluirIds(client, 'arquivos', 'id', metadadosInvalidos);
    await excluirIds(client, 'garantias', 'ordem_servico_id', idsOsExcluidas);
    await excluirIds(client, 'entregas', 'ordem_servico_id', idsOsExcluidas);
    await excluirIds(client, 'ordens_servico', 'id', idsOsExcluidas);
  }

  console.log(JSON.stringify({
    modo: aplicar ? 'apply' : 'dry-run',
    purgaBanco: purgarBanco,
    osAtivas: idsOsAtivas.size,
    osExcluidas: idsOsExcluidas.length,
    metadadosInvalidos: metadadosInvalidos.length,
    objetosOrfaos: Object.fromEntries(Object.entries(orfaos).map(([k, v]) => [k, v.length])),
    objetosRemovidos
  }, null, 2));
}

executar().catch((erro) => {
  console.error('Falha na limpeza total:', erro.message);
  process.exitCode = 1;
});
