// src/dataService.js — Etapa 11.4 — Arquitetura Futura (Servidor / SaaS Ready)
// ═══════════════════════════════════════════════════════════════
// Camada de abstração entre o resto do sistema (main.js, etc.) e a
// origem real dos dados. Hoje só existe o adaptador "local" (db.js,
// JSON em disco). O objetivo desta camada é que, quando uma etapa
// futura implementar de fato um backend remoto (REST/PostgreSQL/
// MySQL/multiempresa), baste escrever um adaptador novo e trocar a
// seleção abaixo — sem precisar tocar em main.js nem no renderer,
// já que ambos continuam chamando os MESMOS nomes de função.
//
// NADA muda no comportamento atual: por padrão (e único modo
// implementado), tudo cai direto no adaptador local (src/db.js).
// ═══════════════════════════════════════════════════════════════

const local = require('./db');

// Placeholder do futuro adaptador remoto (Modo Servidor / SaaS).
// Implementação real fica para uma etapa futura — aqui só garante
// que tentar usar o modo servidor falhe de forma clara, em vez de
// quebrar silenciosamente.
const servidor = new Proxy({}, {
  get() {
    return () => {
      throw new Error(
        'Modo servidor ainda não implementado. Configurações > Rede mantém o sistema em "Modo Local" até essa etapa ser entregue.'
      );
    };
  }
});

function adaptadorAtivo() {
  const modo = local.obterConfigRede().modoOperacao;
  return modo === 'servidor' ? servidor : local;
}

// Proxy genérico: qualquer função chamada em dataService.<nome>(...)
// é repassada pro adaptador ativo no momento da chamada (local, hoje
// sempre; servidor, quando essa etapa futura existir).
module.exports = new Proxy({}, {
  get(_target, prop) {
    return (...args) => adaptadorAtivo()[prop](...args);
  }
});
