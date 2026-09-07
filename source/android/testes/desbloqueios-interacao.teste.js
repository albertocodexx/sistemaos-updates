'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const raiz=path.resolve(__dirname,'..');
const ler=p=>fs.readFileSync(path.join(raiz,p),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function aguardar(pred){for(let i=0;i<100;i++){if(pred())return;await tick();}assert.fail('A interface não concluiu a ação');}
(async()=>{
 const dom=new JSDOM(ler('www/index.html'),{url:'https://qa.local',runScripts:'outside-only'});
 const w=dom.window, d=w.document;
 try {
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.confirm=()=>true;
  const get=id=>d.getElementById(id);
  let rows=[],calls=[],signatureCallback,printCall,waiting=null;
  const client={from(){let selectedId;const q={select(){return this},eq(k,v){if(k==='id')selectedId=v;return this},is(){return this},order(){return this},async range(){return {data:rows.filter(x=>!x.deleted_at).map(x=>({...x}))}},async maybeSingle(){if(waiting)return waiting;return {data:rows.find(x=>x.id===selectedId&&!x.deleted_at)||null}}};return q;},async rpc(name,p){
    calls.push({name,p:structuredClone(p)});
    if(name==='excluir_desbloqueio'){rows.find(x=>x.id===p.p_id).deleted_at='2026-09-04';return {data:true};}
    const a=p.p_dados;
    assert.equal(name,'salvar_desbloqueio');
    let row=rows.find(x=>x.id===p.p_id);
    if(!row){row={id:'00000000-0000-4000-8000-000000000001',numero:'DES-0001',cliente_id:'00000000-0000-4000-8000-000000000002',cliente_numero_snapshot:10000,revision:0,created_at:'2026-09-04T12:00:00Z',id_exportacao:a.idExportacao};rows.push(row);}
    else assert.equal(p.p_revision,row.revision);
    Object.assign(row,{revision:row.revision+1,cliente_nome_snapshot:a.cliente.nome,cliente_cpf_snapshot:a.cliente.cpf,marca:a.aparelho.marca,modelo:a.aparelho.modelo,tipo_bloqueio:a.tipoBloqueio,assinatura_estado:a.assinaturaEstado,assinatura_cliente_base64:a.assinaturaClienteBase64,valor:a.valor});
    return {data:{...row}};
  }};
  w.SupabaseClientApp={obterCliente:()=>client};
  w.SistemaOSAssinatura={abrir:cb=>{signatureCallback=cb}};
  w.ConfigApp={montarDadosEmpresa:()=>({nomeEmpresa:'Assistência QA',telefone:'00000000000'})};
  w.Capacitor={Plugins:{Impressao:{imprimir:async data=>{printCall=data;}}}};
  w.__modules={'desbloqueio-template':{exports:require('../www/src/templates/desbloqueio-template')}};
  w.eval(ler('www/js/assinatura-injetor.js'));
  w.eval(ler('www/js/desbloqueios-tela.js'));
  get('btn-desbloqueio-nao-assinado').click();await tick();
  assert.match(get('desbloqueio-feedback').textContent,/nome do cliente.*marca.*modelo/);
  assert.equal(calls.length,0,'Não salva formulário incompleto');
  const values={'desbloqueio-cliente-nome':'Cliente QA <script>ruim()</script>','desbloqueio-marca':'Samsung','desbloqueio-modelo':'Galaxy QA','desbloqueio-tipo':'Senha ou PIN'};
  for(const[k,v]of Object.entries(values))get(k).value=v;
  get('desbloqueio-titularidade').checked=true;
  get('btn-desbloqueio-nao-assinado').click();
  await aguardar(()=>d.querySelector('.desbloqueio-preview-modal'));
  assert.equal(rows[0].assinatura_estado,'nao_assinado');
  assert.equal(calls[0].p.p_dados.cliente.cpf,null,'CPF vazio não é inventado');
  const iframe=d.querySelector('.desbloqueio-preview-modal iframe');
  assert.match(iframe.srcdoc,/10000/,'PDF contém o ID devolvido pelo servidor');
  assert.match(iframe.srcdoc,/NÃO ASSINADO/);
  assert.doesNotMatch(iframe.srcdoc,/<script>ruim\(\)<\/script>/,'Texto informado não executa HTML');
  assert.match(iframe.srcdoc,/Assistência QA/,'Documento usa a empresa configurada');
  assert.doesNotMatch(iframe.srcdoc,/>CPF</);
  d.querySelector('[data-formato="58mm"]').click();
  d.querySelector('[data-imprimir]').click();await tick();
  assert.match(printCall.html,/width:58mm/,'Impressão Android recebe HTML térmico');
  d.querySelector('.desbloqueio-preview-modal header button').click();
  get('btn-desbloqueio-assinar').click();
  signatureCallback('data:image/png;base64,aGVsbG8=');
  await aguardar(()=>d.querySelector('.desbloqueio-preview-modal'));
  assert.equal(rows[0].assinatura_estado,'assinado');
  assert.match(get('desbloqueio-identificacao').textContent,/Assinado/);
  d.querySelector('.desbloqueio-preview-modal header button').click();
  get('btn-desbloqueio-nao-assinado').click();
  await aguardar(()=>d.querySelector('.desbloqueio-preview-modal'));
  assert.equal(rows[0].assinatura_estado,'nao_assinado');
  assert.equal(rows[0].assinatura_cliente_base64,null,'Remove assinatura anterior ao marcar não assinado');
  d.querySelector('.desbloqueio-preview-modal header button').click();
  get('btn-desbloqueio-excluir').click();
  await aguardar(()=>!!rows[0].deleted_at && get('desbloqueio-feedback').textContent.includes('excluída'));
  await w.SistemaOSDesbloqueiosMobile.recarregar();
  assert.equal(d.querySelectorAll('.desbloqueio-card').length,0,'Exclusão permanece após recarregar');
  // Uma consulta iniciada na empresa A não preenche o formulário da empresa B.
  let resolve;
  waiting=new Promise(r=>{resolve=r});
  const delayed=w.SistemaOSDesbloqueiosMobile.abrir(rows[0].id);
  d.dispatchEvent(new w.CustomEvent('sistema-os:sessao-alterada',{detail:{usuario:{id:'B'},contexto:{empresa_id:'B'}}}));
  resolve({data:{...rows[0],deleted_at:null}});await delayed;
  assert.equal(get('desbloqueio-cliente-nome').value,'');
  assert.equal(get('desbloqueio-id').value,'');
  console.log('OK: formulário real Android — validação, ID antes do PDF, CPF oculto, XSS, A4/térmico, assinado/não assinado, editar, excluir e troca de conta.');
 } finally {dom.window.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
