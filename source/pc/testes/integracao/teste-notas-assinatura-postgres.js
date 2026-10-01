'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_PATH || '@electric-sql/pglite');
(async()=>{const db=new PGlite();try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table empresas(id uuid primary key,cnpj text,razao_social text,nome_fantasia text,contato_cobranca_email text);
    create table planos(id uuid primary key,nome text);
    create table configuracoes_fiscais(empresa_id uuid,metadados jsonb);
    create table cobrancas_assinatura(id uuid primary key,empresa_id uuid,plano_id uuid,status text,
      aplicado_em timestamptz,pagamento_provedor_id text,moeda text,valor numeric,duracao_dias integer);
    insert into empresas values('11111111-1111-4111-8111-111111111111',null,'Cliente QA','QA','qa@example.test');
    insert into planos values('22222222-2222-4222-8222-222222222222','Básico');`);
  await db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261001000100_notas_assinaturas.sql'),'utf8'));
  await db.exec(`insert into cobrancas_assinatura values('33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
    'pendente',null,null,'BRL',49.90,30);`);
  const count=async()=>(await db.query('select count(*)::int n from notas_fiscais_assinatura')).rows[0].n;
  assert.equal(await count(),0);
  await db.exec("update cobrancas_assinatura set status='aprovada'");assert.equal(await count(),0,'status isolado não gera nota');
  await db.exec("update cobrancas_assinatura set aplicado_em=now(),pagamento_provedor_id='999999'");assert.equal(await count(),1);
  await db.exec("update cobrancas_assinatura set status='aprovada'");assert.equal(await count(),1,'webhook repetido mantém a mesma nota');
  const n=(await db.query('select * from notas_fiscais_assinatura')).rows[0];assert.equal(Number(n.valor),49.9);
  let claim=await db.query('select * from reservar_nota_assinatura($1,$2)',[n.id,'44444444-4444-4444-8444-444444444444']);assert.equal(claim.rows.length,1);
  claim=await db.query('select * from reservar_nota_assinatura($1,$2)',[n.id,'55555555-5555-4555-8555-555555555555']);assert.equal(claim.rows.length,0);
  const priv=(await db.query("select has_table_privilege('authenticated','notas_fiscais_assinatura','INSERT') inserir,has_function_privilege('authenticated','enfileirar_nota_assinatura(uuid)','EXECUTE') emitir")).rows[0];assert.equal(priv.inserir,false);assert.equal(priv.emitir,false);
  console.log('OK PostgreSQL: pagamento confirmado, fila idempotente, valor preservado, lease e privilégios.');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
