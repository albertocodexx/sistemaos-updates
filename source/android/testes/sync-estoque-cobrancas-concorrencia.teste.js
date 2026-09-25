'use strict';
const assert = require('node:assert/strict');
const clone = x => JSON.parse(JSON.stringify(x));
const storage = new Map();
global.localStorage = {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
global.SistemaOSPermissoes = {obterContexto:()=>({empresa_id:'empresa-teste'})};
global.SistemaOSSupabaseSync = {obterDispositivoId:async()=> 'dispositivo'};
let offline = true;
let bloquear = null;
let remoto = {id:'uuid',tipo:'aparelho',local_id:'EST-1',revision:1,dados:{id:'EST-1',marca:'Samsung',modelo:'S20FE',status:'Reservado',valorVenda:350,valorGastoPecas:0,pecasUsadas:[]}};
global.SupabaseClientApp = {obterCliente:()=>({
  from:()=>({select(){return this},eq(){return this},is(){return this},maybeSingle:async()=>({data:clone(remoto)})}),
  rpc:async(n,p)=>{
    if(offline) throw new TypeError('Failed to fetch');
    if(bloquear) { const esperar=bloquear; bloquear=null; await esperar(); }
    if(p.p_revision!==remoto.revision) return {error:{message:'conflito_revision_estoque'}};
    remoto={...remoto,revision:remoto.revision+1,dados:clone(p.p_dados)};
    return {data:clone(remoto)};
  }
})};
const estoque=require('../www/js/supabase/estoque-service');
(async()=>{
  let base=await estoque.obterAparelho('EST-1');
  await estoque.salvarAparelho({cor:'Azul'},base);
  assert.equal(estoque.listarCache('aparelho')[0]._pendenteNuvem,true);
  remoto.dados.status='Vendido'; remoto.dados.valorGastoPecas=290; remoto.revision++;
  offline=false;
  await estoque.processarFila();
  assert.equal(remoto.dados.status,'Vendido'); assert.equal(remoto.dados.valorGastoPecas,290); assert.equal(remoto.dados.cor,'Azul');
  base=await estoque.obterAparelho('EST-1');
  remoto.dados.lembretesCobranca=[{id:'pc',data:'2026-09-30',valor:175,status:'paga',atualizadoEm:'2026-09-25T12:00:00Z'}]; remoto.revision++;
  await estoque.salvarAparelho({lembretesCobranca:[{id:'cel',data:'2026-10-30',valor:175,status:'pendente',atualizadoEm:'2026-09-25T12:01:00Z'}]},base);
  assert.equal(remoto.dados.lembretesCobranca.length,2); assert.equal(remoto.dados.valorRestanteVenda,175);
  offline=true; await estoque.salvarAparelho({cor:'Preto'},await estoque.obterAparelho('EST-1'));
  offline=false;
  let liberar, entrou; const iniciou=new Promise(r=>entrou=r);
  bloquear=()=>new Promise(r=>{liberar=r;entrou()});
  const envio=estoque.processarFila(); await iniciou;
  offline=true; await estoque.salvarAparelho({observacoes:'Edicao durante envio'},await estoque.obterAparelho('EST-1'));
  offline=false; liberar(); await envio;
  assert.equal(JSON.parse(storage.get('sistema-os-estoque-cache-v2:empresa-teste')).fila.length,1,'nova edição não pode sumir');
  await estoque.processarFila(); assert.equal(remoto.dados.observacoes,'Edicao durante envio');
  assert.equal(JSON.parse(storage.get('sistema-os-estoque-cache-v2:empresa-teste')).fila.length,0);
  console.log('OK: fila offline, venda, peças, cobrança concorrente e edição durante envio.');
})().catch(e=>{console.error(e);process.exitCode=1});
