// Executa a suíte de smoke tests sem abrir Electron, alterar banco ou gerar
// instaladores. Mantém uma ordem explícita para facilitar o diagnóstico.
const { existsSync } = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.resolve(__dirname, '..', '..');
const testes = [
  'teste-autorizacao-runtime.js',
  'teste-seguranca-intensiva-local.js',
  'teste-auth-webhook-isolados.js',
  'teste-pos-atendimento.js',
  'teste-entrega-retorno-preserva-original.js',
  'teste-retorno-garantia-contrato.js',
  'teste-extrato-financeiro.js',
  'teste-console-epipe.js',
  'teste-inicializacao-electron.js',
  'teste-ipcs-duplicados.js',
  'teste-ipc-licenca.js',
  'teste-ipc-registro-completo.js',
  'teste-preload-os-api.js',
  'teste-preload-api.js',
  'teste-repositorio-clientes.js',
  'teste-renderer-core.js',
  'teste-clientes-renderizacao-segura.js',
  'teste-login-clean.js',
  'teste-identidade-monocromatica.js',
  'teste-contraste-interface.js',
  'teste-troca-conta-sem-travar.js',
  'teste-ia-empresa-notificacoes-assinatura.js',
  'teste-notificacoes-data-hora.js',
  'teste-relatorios-financeiro-subaba.js',
  'teste-renderer-licenca.js',
  'teste-renderer-os-list.js',
  'teste-formularios-termos-editaveis.js',
  'teste-formularios-modais-organizados.js',
  'teste-busca-funcoes-config.js',
  'teste-equipe-suporte-organizada.js',
  'teste-etiqueta-qr.js',
  'teste-desbloqueios-autorizacao.js',
  'teste-edicao-os-entrega-sem-assinatura.js',
  'teste-renderer-estoque-dashboard.js',
  'teste-cpf-opcional-estoque.js',
  'teste-venda-sem-garantia.js',
  'teste-vinculo-compra-estoque.js',
  'teste-aparelho-aguardando-pecas.js',
  'teste-comprovante-pagamento-legado.js',
  'teste-estoque-consumiveis.js',
  'teste-exclusao-usuarios.js',
  'teste-tabela-precos.js',
  'teste-conflito-comercial-idempotente.js',
  'teste-checklist-entrada-ampliado.js',
  'teste-atualizador-github.js',
  'teste-atualizacao-suporte.js',
  'teste-seguranca-cyber.js',
  'teste-seguranca-baileys-cve.js',
  'teste-remocao-legado.js',
  'teste-supabase-desktop.js',
  'teste-sync-os-outra-maquina.js',
  'teste-storage-transito-otimizacao.js',
  'teste-exclusao-remota-os.js',
  'teste-entrega-reconciliacao-supabase.js',
  'teste-pdf-atual-unico.js',
  'teste-fluxos-mp-cancelamento-assinatura.js',
  'teste-fluxo-pagamento-percentual.js',
  'teste-pagamentos-entrada-50.js',
  'teste-jornada-usuario-completa.js',
  'teste-pdfs-sem-fotos-anexadas.js',
  'teste-assinatura-estados-pdf.js',
  'teste-comprovante-os.js',
  'teste-fluxo-comprovante-entrega.js',
  'teste-backup-atomico-fila.js',
  'teste-backup-identidade-nuvem.js',
  'teste-configuracao-compartilhada-mobile.js',
  'teste-isolamento-multiempresa-erros.js',
  'teste-comercial-supabase.js',
  'teste-assinaturas-saas-automaticas.js',
  'teste-lembretes-assinatura-baileys.js',
  'teste-telefones-empresa-cobranca.js',
  'teste-fiscal-oculto-suporte.js',
  'teste-danfse-fiscal.js',
  'teste-documentos-comerciais-mobile.js',
  'teste-estoque-reconciliacao-supabase.js',
  'teste-suporte-chat-planos.js',
  'teste-trial-45-chamados-seguros.js',
  'teste-migracao-supabase.js',
  'teste-cobrancas-pc-ia-sincronizadas.js',
  'teste-ia-custos-compra-local.js',
  'teste-ia-chat-online.js'
];

let falhas = 0;
for (const nome of testes) {
  const arquivo = path.join(__dirname, nome);
  if (!existsSync(arquivo)) {
    console.error('FALHOU - teste não encontrado: ' + nome);
    falhas += 1;
    continue;
  }

  console.log('\n=== ' + nome + ' ===');
  const resultado = spawnSync(process.execPath, [arquivo], {
    cwd: raiz,
    stdio: 'inherit'
  });
  if (resultado.error || resultado.status !== 0) {
    console.error('FALHOU - ' + nome);
    falhas += 1;
  }
}

if (falhas) {
  console.error('\nSuíte de smoke tests falhou: ' + falhas + ' arquivo(s).');
  process.exit(1);
}

console.log('\nSuíte de smoke tests aprovada: ' + testes.length + ' arquivo(s).');
