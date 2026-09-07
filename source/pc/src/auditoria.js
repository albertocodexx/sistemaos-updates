'use strict';
const { criarAuditoria } = require('./audit-service');
let dependencias = {};
const banco = () => dependencias.db || require('./db');
async function obterRegistro(canal, args, resultado) {
  const db = banco(), grupo = canal.split(':')[0];
  const id = typeof args?.[0] === 'string' ? args[0] : args?.[0]?.id || args?.[0]?.numero || resultado?.id || resultado?.numero;
  if (grupo === 'os') return id ? db.obterOSPorNumero(id) : resultado;
  if (grupo === 'estoque') return id ? db.obterItemEstoquePorId(id) : resultado;
  if (grupo === 'compra') return id ? db.obterCompraPorNumero(id) : resultado;
  if (grupo === 'peca') return id ? db.obterPecaPorId(id) : resultado;
  if (grupo === 'entrega') return id ? db.obterEntregaPorNumeroOS(id, args?.[2]) : resultado;
  if (grupo === 'garantia') return id ? db.obterGarantiaPorNumeroOS(id) : resultado;
  if (grupo === 'config') return db.obterConfig();
  if (grupo === 'pag') return id ? db.obterPagamento(id) : resultado;
  if (grupo === 'cobranca') return id ? db.listarCobrancas().find(item => item.id === id) : resultado;
  if (grupo === 'tabelaPrecos' && id && dependencias.supabaseDesktop) {
    if (resultado) return resultado;
    let timer;
    try {
      const itens = await Promise.race([
        dependencias.supabaseDesktop.listarTabelaPrecos(),
        new Promise(resolve => { timer = setTimeout(() => resolve([]), 1500); timer.unref?.(); })
      ]);
      return itens.find(item => item.id === id);
    } finally { clearTimeout(timer); }
  }
  if (grupo === 'ia' && args?.[0]?.tipo === 'adicionar_custos_compra') return db.obterCompraPorNumero(args[0].dados?.numero);
  if (grupo === 'ia' && args?.[0]?.dados?.numero) return db.obterOSPorNumero(args[0].dados.numero);
  return resultado;
}
const api = criarAuditoria({
  getRootDir: () => banco().getRootDir(),
  getEmpresaId: () => banco().obterEscopoEmpresaAtivo() || 'local',
  obterRegistro
});
module.exports = { ...api, configurar: deps => { dependencias = deps; } };
