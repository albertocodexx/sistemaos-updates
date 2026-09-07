#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  lerJson, planejarMigracao, resumoPlano, ExecutorMigracao
} = require('./migrador');

function argumentos(argv) {
  const opcoes = { dryRun: true, origem: 'sistema-os-json-v5', modoArmazenamento: 'economico' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const valor = () => {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Valor obrigatório para ${arg}.`);
      i += 1;
      return argv[i];
    };
    if (arg === '--fonte') opcoes.fonte = valor();
    else if (arg === '--relatorio') opcoes.relatorio = valor();
    else if (arg === '--mapa-usuarios') opcoes.mapaUsuariosPath = valor();
    else if (arg === '--empresa-id') opcoes.empresaId = valor();
    else if (arg === '--origem') opcoes.origem = valor();
    else if (arg === '--modo') opcoes.modoArmazenamento = valor();
    else if (arg === '--licenca-status') opcoes.licencaStatus = valor();
    else if (arg === '--licenca-expira-em') opcoes.licencaExpiraEm = valor();
    else if (arg === '--confirmar') opcoes.confirmacao = valor();
    else if (arg === '--apply') opcoes.dryRun = false;
    else if (arg === '--dry-run') opcoes.dryRun = true;
    else if (arg === '--permitir-usuarios-sem-email') opcoes.permitirUsuariosSemEmail = true;
    else if (arg === '--atualizar-existentes') opcoes.atualizarExistentes = true;
    else if (arg === '--help' || arg === '-h') opcoes.help = true;
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return opcoes;
}

function ajuda() {
  return `Migração gradual Sistema OS -> Supabase

Uso seguro (padrão, não grava nada):
  node ferramentas/migracao-supabase/index.js --fonte "database.json" --dry-run

Aplicação explícita:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node ferramentas/migracao-supabase/index.js \\
    --fonte "database.json" --mapa-usuarios "usuarios.json" --apply --confirmar MIGRAR

Opções:
  --relatorio <arquivo>             Caminho do relatório JSON
  --empresa-id <uuid>               Usa empresa já existente
  --modo economico|nuvem            Modo de arquivos da empresa
  --mapa-usuarios <json>             { "loginLocal": { "email": "..." } }
  --permitir-usuarios-sem-email      Ignora usuários não mapeados no apply
  --atualizar-existentes             Permite atualizar dados da empresa; documentos conflitantes continuam protegidos

O comando nunca envia Base64, fotos, PDFs, URLs externas antigas ou caminhos locais.
Arquivos devem ser enviados separadamente para o Supabase Storage.`;
}

function lerMapa(caminho) {
  if (!caminho) return {};
  const valor = JSON.parse(fs.readFileSync(path.resolve(caminho), 'utf8'));
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Mapa de usuários deve ser um objeto JSON.');
  return valor;
}

function validarServiceRole(chave) {
  if (!chave) throw new Error('SUPABASE_SERVICE_ROLE_KEY não informada.');
  const partes = chave.split('.');
  if (partes.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
      if (payload.role !== 'service_role') throw new Error('A chave informada não possui role service_role.');
    } catch (erro) {
      if (/role service_role/.test(erro.message)) throw erro;
    }
  } else if (!/^sb_secret_/i.test(chave)) {
    throw new Error('Use uma service_role JWT ou uma secret key moderna somente nesta ferramenta confiável.');
  }
}

function salvarRelatorio(caminho, relatorio) {
  const absoluto = path.resolve(caminho);
  fs.mkdirSync(path.dirname(absoluto), { recursive: true });
  const temporario = absoluto + '.tmp';
  fs.writeFileSync(temporario, JSON.stringify(relatorio, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporario, absoluto);
  return absoluto;
}

async function main() {
  const opcoes = argumentos(process.argv.slice(2));
  if (opcoes.help) { console.log(ajuda()); return; }
  if (!opcoes.fonte) throw new Error('Informe --fonte com o database.json ou backup completo.');
  if (!['economico', 'nuvem'].includes(opcoes.modoArmazenamento)) throw new Error('--modo deve ser economico ou nuvem.');
  const origem = lerJson(opcoes.fonte);
  const mapaUsuarios = lerMapa(opcoes.mapaUsuariosPath);
  const plano = planejarMigracao(origem.database, { ...opcoes, mapaUsuarios });
  const resumo = resumoPlano(plano);
  const reportPath = opcoes.relatorio || path.join(process.cwd(), 'relatorios-migracao', `migracao-${Date.now()}.json`);
  const base = {
    versaoRelatorio: 1,
    modo: opcoes.dryRun ? 'dry-run' : 'apply',
    geradoEm: new Date().toISOString(),
    origem: { arquivo: origem.absoluto, tamanhoBytes: origem.tamanhoBytes, checksumSha256: origem.checksum },
    resumo, avisos: plano.avisos, errosValidacao: plano.erros
  };

  if (opcoes.dryRun) {
    const caminho = salvarRelatorio(reportPath, { ...base, sucesso: plano.erros.length === 0 });
    console.log(JSON.stringify({ sucesso: plano.erros.length === 0, modo: 'dry-run', resumo, relatorio: caminho }, null, 2));
    if (plano.erros.length) process.exitCode = 2;
    return;
  }

  if (opcoes.confirmacao !== 'MIGRAR') throw new Error('Apply bloqueado: use --confirmar MIGRAR após revisar o dry-run.');
  if (resumo.usuariosSemEmail && !opcoes.permitirUsuariosSemEmail) {
    throw new Error(`${resumo.usuariosSemEmail} usuário(s) sem e-mail. Forneça --mapa-usuarios ou autorize a omissão explicitamente.`);
  }
  if (plano.erros.length) throw new Error('Apply bloqueado porque o dry-run encontrou erros de validação.');
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^https:\/\//i.test(url || '')) throw new Error('SUPABASE_URL HTTPS não informada.');
  validarServiceRole(chave);
  const supabase = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  let resultado;
  try {
    const preflight = await supabase.from('migracoes_legado').select('id').limit(1);
    if (preflight.error) throw new Error('Migration 20260717000900 não aplicada ou service_role inválida: ' + preflight.error.message);
    const executor = new ExecutorMigracao({
      supabase, plano, empresaId: opcoes.empresaId, atualizarExistentes: opcoes.atualizarExistentes
    });
    resultado = await executor.executar();
  } catch (erro) {
    resultado = { empresaId: null, criados: [], ignorados: [], conflitos: [],
      erros: [{ tipo: 'fatal', referencia: 'apply', erro: erro.message }] };
    const caminho = salvarRelatorio(reportPath, { ...base, sucesso: false, resultado });
    console.error(`MIGRAÇÃO INTERROMPIDA. Relatório: ${caminho}`);
    process.exitCode = 3;
    return;
  }
  const sucesso = resultado.erros.length === 0 && resultado.conflitos.length === 0;
  const caminho = salvarRelatorio(reportPath, { ...base, sucesso, resultado });
  console.log(JSON.stringify({ sucesso, modo: 'apply', empresaId: resultado.empresaId, relatorio: caminho,
    criados: resultado.criados.length, ignorados: resultado.ignorados.length,
    conflitos: resultado.conflitos.length, erros: resultado.erros.length }, null, 2));
  if (!sucesso) process.exitCode = 3;
}

if (require.main === module) {
  main().catch((erro) => {
    console.error('MIGRAÇÃO BLOQUEADA:', erro.message);
    process.exit(1);
  });
}

module.exports = { argumentos, validarServiceRole, salvarRelatorio, main };
