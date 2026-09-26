'use strict';

// Execute com PGLITE_PATH apontando para @electric-sql/pglite instalado fora do produto.
// Testa as funcoes PL/pgSQL reais sem credenciais nem pagamentos reais.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_PATH || '@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260925000200_cota_creditos_fiscais.sql'), 'utf8');
const empresaA = '11111111-1111-4111-8111-111111111111';
const empresaB = '22222222-2222-4222-8222-222222222222';
const empresaC = '33333333-3333-4333-8333-333333333333';
const empresaD = '44444444-4444-4444-8444-444444444444';
const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const usuarioA = id(201);
const usuarioB = id(202);
const usuarioC = id(203);
const usuarioD1 = id(204);
const usuarioD2 = id(205);
const adminD = id(206);

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create role anon;
      create role authenticated;
      create role service_role;
      create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
      create table public.empresas (id uuid primary key);
      create table public.perfis (id uuid primary key, empresa_id uuid references public.empresas(id),
        cargo text not null, ativo boolean not null default true);
      create table public.auditoria_comercial (empresa_id uuid, autor_id uuid,
        acao text, entidade text, entidade_id text, metadados jsonb);
      create table public.notas_fiscais (
        id uuid primary key, empresa_id uuid not null references public.empresas(id),
        status text not null default 'rascunho', ultimo_erro text,
        created_at timestamptz not null default now(), emitida_em timestamptz
      );
      insert into public.empresas(id) values ('${empresaA}'), ('${empresaB}'), ('${empresaC}'), ('${empresaD}');
      insert into public.perfis(id,empresa_id,cargo) values
        ('${usuarioA}','${empresaA}','Administrador'), ('${usuarioB}','${empresaB}','Administrador'),
        ('${usuarioC}','${empresaC}','Administrador'), ('${usuarioD1}','${empresaD}','Atendente'),
        ('${usuarioD2}','${empresaD}','Atendente'),
        ('${adminD}','${empresaD}','Administrador');
      insert into public.notas_fiscais(id,empresa_id,status) values
        ('${id(90)}','${empresaB}','autorizada');
    `);
    await db.exec(migration);
    const query = (sql, params = []) => db.query(sql, params);
    assert.equal((await query('select status from public.reservas_fiscais where nota_id=$1', [id(90)])).rows[0].status,
      'consumida', 'nota autorizada antes da migracao conta para a cota mensal');
    const conta = async (empresa = empresaA) => (await query(
      'select * from public.contas_fiscais where empresa_id=$1', [empresa]
    )).rows[0];
    const donosNotas = new Map();
    const usuarioEmpresa = (empresa) => ({ [empresaA]: usuarioA, [empresaB]: usuarioB,
      [empresaC]: usuarioC, [empresaD]: usuarioD1 })[empresa];
    const nota = async (numero, empresa = empresaA) => {
      await query('insert into public.notas_fiscais(id,empresa_id) values($1,$2)', [id(numero), empresa]);
      donosNotas.set(id(numero), usuarioEmpresa(empresa));
      return id(numero);
    };
    const reservar = (notaId, usuario = donosNotas.get(notaId)) =>
      query('select public.reservar_cota_fiscal($1,$2) as resultado', [notaId, usuario]);

    await query('select public.ajustar_conta_fiscal($1,$2,$3,$4,$5,$6)', [empresaA, 1, 20, 100, 'teste-saldo-inicial', 'Credito manual de teste']);
    await query('select public.ajustar_conta_fiscal($1,$2,$3,$4,$5,$6)', [empresaA, 1, 20, 100, 'teste-saldo-inicial', 'Credito manual de teste']);
    assert.equal((await conta()).saldo_centavos, 100, 'replay de ajuste manual nao duplica saldo');
    await nota(1);
    await reservar(id(1));
    assert.equal((await conta()).saldo_centavos, 100);
    await nota(2);
    await reservar(id(2));
    assert.equal((await conta()).saldo_centavos, 80);
    await reservar(id(2));
    assert.equal((await conta()).saldo_centavos, 80, 'retry nao deve cobrar novamente');
    await query('update public.notas_fiscais set status=$1 where id=$2', ['autorizada', id(2)]);
    assert.equal((await query('select status from public.reservas_fiscais where nota_id=$1', [id(2)])).rows[0].status, 'consumida');
    await nota(3);
    await reservar(id(3));
    assert.equal((await conta()).saldo_centavos, 60);
    await query('update public.notas_fiscais set status=$1 where id=$2', ['rejeitada', id(3)]);
    assert.equal((await conta()).saldo_centavos, 80, 'rejeicao precisa estornar a reserva');
    await reservar(id(3));
    assert.equal((await conta()).saldo_centavos, 60, 'nova tentativa deve reservar uma unica vez');
    await query('update public.notas_fiscais set status=$1 where id=$2', ['cancelada', id(3)]);
    assert.equal((await conta()).saldo_centavos, 80, 'cancelamento precisa estornar');

    const recargaId = id(100);
    await query(`insert into public.recargas_fiscais(id,empresa_id,valor_centavos,referencia_externa,status,pagamento_provedor_id)
      values($1,$2,100,'FISCAL-TESTE','aprovada','12345')`, [recargaId, empresaA]);
    await query('select public.aplicar_recarga_fiscal($1,$2)', [recargaId, '12345']);
    await query('select public.aplicar_recarga_fiscal($1,$2)', [recargaId, '12345']);
    assert.equal((await conta()).saldo_centavos, 180, 'webhook duplicado nao duplica credito');
    await query('select public.estornar_recarga_fiscal($1,$2,$3)', [recargaId, '12345', 30]);
    assert.equal((await conta()).saldo_centavos, 150, 'estorno parcial deduz so o valor devolvido');
    await query('select public.estornar_recarga_fiscal($1,$2,$3)', [recargaId, '12345', 30]);
    assert.equal((await conta()).saldo_centavos, 150, 'retry parcial nao duplica estorno');
    await query('select public.estornar_recarga_fiscal($1,$2,$3)', [recargaId, '12345', 100]);
    await query('select public.estornar_recarga_fiscal($1,$2,$3)', [recargaId, '12345', 100]);
    assert.equal((await conta()).saldo_centavos, 80, 'estorno duplicado nao retira duas vezes');

    const recargaAntecipada = id(101);
    await query(`insert into public.recargas_fiscais(id,empresa_id,valor_centavos,referencia_externa,status,pagamento_provedor_id)
      values($1,$2,1000,'FISCAL-ANTECIPADA','estorno_parcial','22222')`, [recargaAntecipada, empresaC]);
    await query('select public.estornar_recarga_fiscal($1,$2,$3)', [recargaAntecipada, '22222', 200]);
    await query(`update public.recargas_fiscais set status='aprovada' where id=$1`, [recargaAntecipada]);
    await query('select public.aplicar_recarga_fiscal($1,$2)', [recargaAntecipada, '22222']);
    await query('select public.aplicar_recarga_fiscal($1,$2)', [recargaAntecipada, '22222']);
    assert.equal((await conta(empresaC)).saldo_centavos, 800, 'estorno parcial antes da aprovacao credita so o liquido');
    await query('select public.estornar_recarga_fiscal($1,$2,$3)', [recargaAntecipada, '22222', 1000]);
    assert.equal((await conta(empresaC)).saldo_centavos, 0, 'estorno posterior deduz apenas o restante');
    assert.equal((await conta(empresaC)).debito_pendente_centavos, 0);

    const recargaIntegralAnterior = id(102);
    await query(`insert into public.recargas_fiscais(id,empresa_id,valor_centavos,referencia_externa,status,pagamento_provedor_id)
      values($1,$2,100,'FISCAL-INTEGRAL','pendente','33333')`, [recargaIntegralAnterior, empresaC]);
    await query('select public.estornar_recarga_fiscal($1,$2,$3)', [recargaIntegralAnterior, '33333', 100]);
    await query(`update public.recargas_fiscais set status='aprovada' where id=$1`, [recargaIntegralAnterior]);
    await assert.rejects(query('select public.aplicar_recarga_fiscal($1,$2)', [recargaIntegralAnterior, '33333']),
      /integralmente estornada/);
    assert.equal((await conta(empresaC)).saldo_centavos, 0, 'recarga ja estornada nunca vira credito');

    const recargaConsumida = id(103);
    await query(`insert into public.recargas_fiscais(id,empresa_id,valor_centavos,referencia_externa,status,pagamento_provedor_id)
      values($1,$2,100,'FISCAL-CONSUMIDA','aprovada','44444')`, [recargaConsumida, empresaC]);
    await query('select public.aplicar_recarga_fiscal($1,$2)', [recargaConsumida, '44444']);
    await query('select public.ajustar_conta_fiscal($1,$2,$3,$4,$5,$6)',
      [empresaC, 0, 20, 0, null, null]);
    await nota(20, empresaC);
    await reservar(id(20));
    await query('select public.estornar_recarga_fiscal($1,$2,$3)', [recargaConsumida, '44444', 100]);
    assert.equal((await conta(empresaC)).saldo_centavos, 0);
    assert.equal((await conta(empresaC)).debito_pendente_centavos, 20, 'estorno de credito ja usado cria debito bloqueante');
    await nota(21, empresaC);
    await assert.rejects(reservar(id(21)), /saldo fiscal insuficiente/);
    const recargaParaQuitar = id(104);
    await query(`insert into public.recargas_fiscais(id,empresa_id,valor_centavos,referencia_externa,status,pagamento_provedor_id)
      values($1,$2,100,'FISCAL-QUITACAO','aprovada','55555')`, [recargaParaQuitar, empresaC]);
    await query('select public.aplicar_recarga_fiscal($1,$2)', [recargaParaQuitar, '55555']);
    assert.equal((await conta(empresaC)).saldo_centavos, 80, 'nova recarga quita debito antes de liberar saldo');
    assert.equal((await conta(empresaC)).debito_pendente_centavos, 0);
    await nota(22, empresaC);
    await reservar(id(22));
    await query('select public.estornar_recarga_fiscal($1,$2,$3)', [recargaParaQuitar, '55555', 100]);
    assert.equal((await conta(empresaC)).debito_pendente_centavos, 40);
    await query('update public.notas_fiscais set status=$1 where id=$2', ['rejeitada', id(22)]);
    assert.equal((await conta(empresaC)).debito_pendente_centavos, 20,
      'liberacao de reserva apos estorno abate divida antes de virar saldo');
    await query('select public.ajustar_conta_fiscal($1,$2,$3,$4,$5,$6)',
      [empresaC, 0, 20, 10, 'teste-ajuste-debito', 'Abatimento manual do debito']);
    assert.equal((await conta(empresaC)).debito_pendente_centavos, 10,
      'ajuste manual positivo quita debito antes de liberar credito');
    await query('update public.notas_fiscais set status=$1 where id=$2', ['rejeitada', id(20)]);
    assert.equal((await conta(empresaC)).debito_pendente_centavos, 0);
    assert.equal((await conta(empresaC)).saldo_centavos, 10);
    await query('select public.ajustar_conta_fiscal($1,$2,$3,$4,$5,$6)',
      [empresaC, 0, 20, 50, 'teste-ajuste-pos-estorno', 'Ajuste manual de credito']);
    assert.equal((await conta(empresaC)).saldo_centavos, 60);

    await query('select public.ajustar_conta_fiscal($1,$2,$3,$4,$5,$6)', [empresaB, 0, 20, 20, 'teste-saldo-b', 'Credito manual da empresa B']);
    await nota(10, empresaB);
    await nota(11, empresaB);
    const resultados = await Promise.allSettled([reservar(id(10)), reservar(id(11))]);
    assert.equal(resultados.filter((item) => item.status === 'fulfilled').length, 1, 'somente uma reserva com saldo de R$0,20');
    assert.equal((await conta(empresaB)).saldo_centavos, 0);
    assert.equal((await conta()).saldo_centavos, 80, 'outra empresa nao deve alterar este saldo');

    await query('select public.ajustar_conta_fiscal($1,$2,$3,$4,$5,$6)',
      [empresaD, 1, 20, 100, 'credito-equipe', 'Credito para teste de limites']);
    await assert.rejects(query('select public.definir_limite_emissao_fiscal($1,$2,$3,$4,$5,$6)',
      [empresaD, 'cargo', 'Atendente', 2, 20, usuarioD1]), /administrador da empresa invalido/);
    await query('select public.definir_limite_emissao_fiscal($1,$2,$3,$4,$5,$6)',
      [empresaD, 'cargo', 'Atendente', 2, 20, adminD]);
    await query('select public.definir_limite_emissao_fiscal($1,$2,$3,$4,$5,$6)',
      [empresaD, 'usuario', usuarioD1, 1, 0, adminD]);
    await nota(30, empresaD);
    await reservar(id(30), usuarioD1); // primeira NF gratuita
    await nota(31, empresaD);
    await assert.rejects(reservar(id(31), usuarioD1), /limite mensal de emissao/);
    assert.equal((await conta(empresaD)).saldo_centavos, 100, 'limite por usuario nao desconta saldo');
    await nota(32, empresaD);
    await reservar(id(32), usuarioD2); // excedente pago: R$ 0,20
    assert.equal((await conta(empresaD)).saldo_centavos, 80);
    await nota(33, empresaD);
    await assert.rejects(reservar(id(33), usuarioD2), /limite mensal de emissao/);
    await query('select public.definir_limite_emissao_fiscal($1,$2,$3,$4,$5,$6)',
      [empresaD, 'cargo', 'atendente', 3, 20, adminD]);
    await assert.rejects(reservar(id(33), usuarioD2), /limite de gasto fiscal/);
    assert.equal((await conta(empresaD)).saldo_centavos, 80, 'gasto bloqueado nao desconta saldo');
    await query('select public.definir_limite_emissao_fiscal($1,$2,$3,$4,$5,$6)',
      [empresaD, 'cargo', 'atendente', 3, 40, adminD]);
    await reservar(id(33), usuarioD2);
    assert.equal((await conta(empresaD)).saldo_centavos, 60);
    await query('update public.notas_fiscais set status=$1 where id=$2', ['rejeitada', id(33)]);
    assert.equal((await conta(empresaD)).saldo_centavos, 80, 'rejeicao libera gasto da equipe');
    await nota(34, empresaD);
    await assert.rejects(reservar(id(34), usuarioA), /outra empresa/);
    await assert.rejects(query('select public.definir_limite_emissao_fiscal($1,$2,$3,$4,$5,$6)',
      [empresaD, 'usuario', usuarioA, 1, 0, adminD]), /nao pertence a empresa/);
    assert.equal((await query('select public.remover_limite_emissao_fiscal($1,$2,$3,$4) as removido',
      [empresaD, 'cargo', 'atendente', adminD])).rows[0].removido, true);
    assert.equal((await query('select count(*)::int as total from public.auditoria_comercial where empresa_id=$1',
      [empresaD])).rows[0].total, 5, 'toda mudanca de limite fica auditada');
    await assert.rejects(query('delete from public.empresas where id=$1', [empresaD]),
      /historico financeiro|movimentacoes fiscais|documentos ou movimentacoes fiscais/i);
    assert.equal((await query('select count(*)::int as total from public.notas_fiscais where empresa_id=$1',
      [empresaD])).rows[0].total, 5, 'tentativa de exclusao nao remove documentos fiscais');

    const movimentos = (await query('select tipo,valor_centavos from public.movimentos_fiscais where empresa_id=$1', [empresaA])).rows;
    assert.equal(movimentos.filter((m) => m.tipo === 'recarga_mp').length, 1);
    assert.equal(movimentos.filter((m) => m.tipo === 'estorno_mp').length, 2);
    const privilegios = (await query(`select
      has_table_privilege('authenticated', 'public.contas_fiscais', 'SELECT') as tabela,
      has_function_privilege('authenticated', 'public.aplicar_recarga_fiscal(uuid,text)', 'EXECUTE') as credito,
      has_table_privilege('authenticated', 'public.limites_emissao_fiscal', 'SELECT') as limites,
      has_function_privilege('authenticated', 'public.reservar_cota_fiscal(uuid,uuid)', 'EXECUTE') as reserva`)).rows[0];
    assert.deepEqual(privilegios, { tabela: false, credito: false, limites: false, reserva: false },
      'cliente autenticado nao acessa saldo nem RPC de cobranca diretamente');
    console.log('OK: PostgreSQL real — cota, limites de usuario/cargo, saldo, estornos, debito e isolamento.');
  } finally {
    await db.close();
  }
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
