const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { indexedDB } = require('fake-indexeddb');
const raiz = path.resolve(__dirname, '..');
const ler = p => fs.readFileSync(path.join(raiz,p),'utf8');

(async()=>{
  const dom = new JSDOM('<!doctype html><button id="origem">Editar</button>',{url:'https://qa.local',runScripts:'outside-only'});
  const w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  let linha={id:'g1',revision:1,numero_os_snapshot:'OS-0020',cliente_nome_snapshot:'Cliente QA',cliente_telefone_snapshot:'00000000000',garantia_dias:90,data_abertura:'2026-08-25',data_limite:'2026-11-23',termos:'Texto QA',dados_extras:{clienteNumero:'10000',clienteCpf:''}};
  let filtros={};
  w.SupabaseClientApp={obterCliente:()=>({rpc:async(nome,p)=>{
    assert.equal(nome,'salvar_pos_atendimento');assert.equal(p.p_tipo,'garantia');assert.equal(p.p_id,linha.id);assert.equal(p.p_revision,linha.revision);
    Object.assign(linha,p.p_dados,{revision:linha.revision+1});return {data:structuredClone(linha)};
  },from:t=>{
    let payload;
    const q={select:()=>q,eq:(k,v)=>(filtros[k]=v,q),is:()=>q,update:()=>{throw new Error('Garantia deve ser gravada pela RPC segura');},maybeSingle:async()=>{
      if(payload){assert.equal(filtros.revision,linha.revision);Object.assign(linha,payload,{revision:linha.revision+1});}
      return {data:structuredClone(linha)};
    }};return q;
  }})};
  w.SistemaOSToast={mostrar:m=>{throw new Error(m);}};
  w.eval(ler('www/js/supabase/garantia-service.js'));
  w.eval(ler('www/js/garantia-tela.js'));
  await w.SistemaOSGarantiaUI.abrir('OS-0020',false);
  const form=w.document.querySelector('dialog form');
  assert.ok(form);
  assert.equal(form.elements.garantia_dias.value,'90');
  form.elements.garantia_dias.value='120';
  form.elements.termos.value='Condição editada no celular';
  await form.onsubmit({preventDefault(){}});
  assert.equal(linha.garantia_dias,120);
  assert.equal(linha.termos,'Condição editada no celular');
  assert.equal(linha.dados_extras.clienteNumero,'10000');
  assert.match(form.textContent,/Garantia salva na nuvem/);
  form.elements.garantia_dias.value='-1';
  await form.onsubmit({preventDefault(){}});
  assert.match(form.textContent,/Não foi salvo/);
  assert.equal(linha.garantia_dias,120);
  w.document.querySelector('[data-fechar]').click();
  assert.equal(w.document.querySelector('dialog'),null);
  const entrega = require('../www/js/supabase/entrega-service');
  assert.equal(entrega._normalizar({nao_assinado:true}).status,'Não assinado');
  assert.equal(entrega._normalizar({assinatura_pendente:true,assinatura_disponivel:true}).status,'Aguardando assinatura');
  w.indexedDB=indexedDB;
  w.eval(ler('www/js/historico.js'));
  assert.match(ler('www/js/app.js'),/entregaOriginal && dataEscolhida/);
  assert.match(ler('www/js/app.js'),/gravarEstadoSupabase\(registro.id, entregaReferenciaRemota, \{ pendente: true \}\)/);
  assert.ok(ler('www/src/termos-predefinidos.js').includes('TERMOS_GARANTIA'));
  assert.equal(ler('www/src/templates/garantia-template.js'),fs.readFileSync(path.join(raiz,'../sistemaos-pc/src/templates/garantia-template.js'),'utf8'));
  dom.window.close();
  console.log('OK: editor móvel salva garantia com revisão, preserva cliente, mostra erro, fecha e distingue assinatura. Templates PC/APK iguais.');
})().catch(e=>{console.error(e);process.exitCode=1;});
