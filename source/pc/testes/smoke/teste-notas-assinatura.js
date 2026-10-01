'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
(async () => {
  global.Deno = { env:{ get:k => ({ FISCAL_EMISSOR_ATIVO:'true',NFEIO_INVOICE_KEY:'CHAVE_SOMENTE_TESTE' })[k] } };
  const api = await import(pathToFileURL(path.resolve(__dirname,'../../supabase/functions/_shared/notas-assinaturas-api.ts')));
  const worker = await import(pathToFileURL(path.resolve(__dirname,'../../supabase/functions/_shared/notas-assinaturas.ts')));
  const nfe = await import(pathToFileURL(path.resolve(__dirname,'../../supabase/functions/_shared/nfeio-nfse.ts')));
  assert.equal(nfe.estadoNfseNfeio({status:'Issued',fluxo:'CancelFailed'}),'autorizada');
  assert.equal(nfe.estadoNfseNfeio({status:'Cancelled',fluxo:'Cancelled'}),'cancelada');
  const tabelas = { configuracoes_fiscais_plataforma:[{empresa_id:'00000000-0000-4000-8000-000000000001',
    provedor:'nfeio',ambiente:'producao',status:'configurada',metadados:{nfeio_empresa_id:'emitente_123456',codigo_servico:'1401'}}],
    empresas:[{id:id(1),nome_fantasia:'Cliente QA',cnpj:'',contato_cobranca_email:'qa@example.test'}],
    configuracoes_fiscais:[{empresa_id:id(1),metadados:{documento_prestador:'52998224725',nome_prestador:'Cliente QA'}}],
    notas_fiscais_assinatura:[],cobrancas_assinatura:[],administradores_globais:[{usuario_id:id(9),ativo:true,papel:'moderador'}] };
  const novas = n => {
    const nota={id:id(n),empresa_id:id(1),cobranca_id:id(n+100),valor:49.9,descricao:'Assinatura mensal',
      payload:{},status:'na_fila',danfse_storage_path:null,bloqueada_ate:null};
    tabelas.notas_fiscais_assinatura.push(nota);
    tabelas.cobrancas_assinatura.push({id:nota.cobranca_id,empresa_id:id(1),valor:49.9,status:'aprovada',aplicado_em:'2026-09-30',pagamento_provedor_id:'12345',moeda:'BRL'});
    return nota;
  };
  let assinados=0;
  const admin = { from(t) {
    const filtros=[];let alteracao=null;let unico=false;
    const q={select(){return q},order(){return q},limit(){return q},range(){return q},
      is(k,v){filtros.push(r=>(r[k]??null)===v);return q},in(k,v){filtros.push(r=>v.includes(r[k]));return q},
      eq(k,v){filtros.push(r=>r[k]===v);return q},update(v){alteracao=v;return q},maybeSingle(){unico=true;return q},single(){unico=true;return q},
      then(resolve,reject){try {const rows=(tabelas[t]||[]).filter(r=>filtros.every(f=>f(r)));if(alteracao)rows.forEach(r=>Object.assign(r,alteracao));return Promise.resolve({data:unico?(rows[0]||null):rows.map(r=>({...r})),error:null}).then(resolve,reject)}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q;
  },async rpc(nome,p){
    assert.equal(nome,'reservar_nota_assinatura');const n=tabelas.notas_fiscais_assinatura.find(n=>n.id===p.p_id);
    if(n.bloqueio_id)return {data:[],error:null};n.bloqueio_id=p.p_bloqueio;n.bloqueada_ate='agora';return {data:[structuredClone(n)],error:null};
  },storage:{from(){return {async upload(){return {error:null}},async createSignedUrl(){assinados++;return {data:{signedUrl:'https://storage.example.test/nota.pdf'},error:null}}}}}};
  let posts=0;let ambiente='Production';let ambiguo=false;const emitidas=new Set();
  const fetchQa=async (url,op={})=>{
    if(op.method==='POST'){posts++;if(ambiguo)throw new Error('timeout simulado');emitidas.add(JSON.parse(op.body).externalId);return new Response('{}',{status:202})}
    if(url.endsWith('/pdf'))return new Response('%PDF-1.7\nQA');
    const ref=decodeURIComponent(url.split('/').pop());if(!emitidas.has(ref))return new Response('{}',{status:404});
    return new Response(JSON.stringify({id:'invoice_12345678',status:'Issued',flowStatus:'Issued',number:'22',checkCode:'QA123',environment:ambiente}));
  };
  const nota=novas(10);
  await Promise.all([worker.processarNotasAssinaturas(admin,nota.cobranca_id,fetchQa),worker.processarNotasAssinaturas(admin,nota.cobranca_id,fetchQa)]);
  assert.equal(posts,1,'concorrência não duplica o POST');assert.equal(nota.status,'autorizada');
  await worker.processarNotasAssinaturas(admin,nota.cobranca_id,fetchQa);assert.equal(posts,1);
  const semPagamento=novas(20);tabelas.cobrancas_assinatura.at(-1).aplicado_em=null;
  await worker.processarNotasAssinaturas(admin,semPagamento.cobranca_id,fetchQa);assert.equal(posts,1);assert.equal(semPagamento.status,'cancelada');
  const valorErrado=novas(30);valorErrado.valor=1;await worker.processarNotasAssinaturas(admin,valorErrado.cobranca_id,fetchQa);assert.equal(posts,1);
  ambiguo=true;const timeout=novas(40);await worker.processarNotasAssinaturas(admin,timeout.cobranca_id,fetchQa);
  timeout.payload.processamento={};await worker.processarNotasAssinaturas(admin,timeout.cobranca_id,fetchQa);assert.equal(posts,2,'timeout ambíguo consulta sem repetir POST');
  ambiguo=false;ambiente='Development';const teste=novas(50);await worker.processarNotasAssinaturas(admin,teste.cobranca_id,fetchQa);assert.equal(teste.status,'rejeitada');assert.equal(teste.danfse_storage_path,null);
  const res=(s,b)=>({s,b});const ctx={empresa_id:id(2),cargo:'Administrador'};
  let r=await api.atenderNotasAssinatura(admin,ctx,id(3),'obter_nota_assinatura',{id:nota.id,empresaId:id(1)},res);
  assert.equal(r.s,404);assert.equal(assinados,0,'ID de outra empresa nunca gera URL');
  r=await api.atenderNotasAssinatura(admin,{empresa_id:id(1),cargo:'Atendente'},id(3),'listar_notas_assinatura',{},res);assert.equal(r.s,403);
  r=await api.atenderNotasAssinatura(admin,{administrador_global:true},id(9),'emitir_nota_assinatura',{cobrancaId:nota.cobranca_id},res);assert.equal(r.s,403);
  r=await api.atenderNotasAssinatura(admin,{empresa_id:id(1),cargo:'Administrador'},id(3),'obter_nota_assinatura',{id:nota.id},res);assert.equal(r.s,200);assert.equal(assinados,1);
  console.log('OK: notas de assinatura: pagamento, valor, concorrência, timeout, ambiente, permissões e isolamento.');
})().catch(e=>{console.error(e);process.exitCode=1});
