'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../../../sistemaos-android/node_modules/jsdom');
const raiz = path.resolve(__dirname, '../..');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

(async () => {
  const { validarAnexos } = await import('../../supabase/functions/chamados-suporte/anexos.ts');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  assert.equal(validarAnexos([{ nome: 'print.png', dados: png }]).length, 1);
  for (const dados of ['https://externo/arquivo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YWFhYWFhYWFhYWFhYWFhYWFhYQ==']) {
    assert.throws(() => validarAnexos([{dados}]));
  }
  assert.throws(() => validarAnexos(Array(4).fill({dados:png})));
  for (const mobile of [false, true]) {
    const dom = new JSDOM('<!doctype html><body></body>', {url:'https://qa.local',runScripts:'outside-only'});
    const w=dom.window;
    const chamados=[{id:'a',protocolo:'CH-A',status:'aberto'},{id:'b',protocolo:'CH-B',status:'resolvido'},{id:'c',protocolo:'CH-C',status:'cancelado'}];
    const chamadas=[];let respostaLenta;
    const transporte=async(acao,dados)=>{
      chamadas.push({acao,dados});
      if(acao==='listar_meus')return {sucesso:true,chamados};
      if(acao==='listar_mensagens'){
        if(dados.chamadoId==='a' && respostaLenta) return await respostaLenta;
        return {sucesso:true,chamado:chamados.find(c=>c.id===dados.chamadoId),mensagens:[{mensagem:'Histórico '+dados.chamadoId,anexos:[{nome:'Print',dados:png}]}]};
      }
      return {sucesso:true};
    };
    w.api={supabasechamadosuporte:transporte};
    w.SistemaOSSessao={obterEstado:()=>({usuario:{id:'usuario'}})};
    w.SupabaseClientApp={obterCliente:()=>({functions:{invoke:async(_,p)=>({data:await transporte(p.body.acao,p.body.dados)})}})};
    const dir=mobile?path.resolve(raiz,'../sistemaos-android/www/js'):path.join(raiz,'renderer/modules/suporte');
    w.eval(fs.readFileSync(path.join(dir,mobile?'chamado-anexos.js':'anexos.js'),'utf8'));
    w.eval(fs.readFileSync(path.join(dir,'chamados.js'),'utf8'));
    w.localStorage.setItem('sistemaos_chamados_acompanhamento_v2',JSON.stringify([{tokenAcompanhamento:'de-outra-conta'}]));
    await w.SistemaOSChamados.abrir({origem:mobile?'config_celular':'config_pc'});
    assert(!chamadas.some(c=>c.acao==='listar_mensagens'),'abrir suporte não deve abrir uma conversa');
    assert(!chamadas.some(c=>c.acao==='acompanhar_publico'),'conta autenticada não mistura tokens públicos');
    const lista=w.document.getElementById(mobile?'lista-central-chamados-app':'listaCentralChamados');
    const form=w.document.getElementById(mobile?'form-mensagem-chamado-app':'formMensagemChamado');
    const msgs=w.document.getElementById(mobile?'mensagens-chamado-app':'mensagensCentralChamados');
    lista.querySelectorAll('button')[1].click();await tick();
    assert(msgs.textContent.includes('Histórico b'));
    assert.equal(msgs.querySelectorAll('img').length,1);
    assert(mobile?form.hidden:form.classList.contains('escondido'),'finalizado só leitura');
    lista.querySelectorAll('button')[2].click();await tick();
    assert(mobile?form.hidden:form.classList.contains('escondido'),'cancelado só leitura');
    let liberar;
    respostaLenta=new Promise(r=>liberar=r);
    lista.querySelectorAll('button')[0].click();await tick();
    lista.querySelectorAll('button')[2].click();await tick();
    liberar({sucesso:true,chamado:chamados[0],mensagens:[{mensagem:'RESPOSTA ANTIGA'}]});await tick();
    assert(!msgs.textContent.includes('RESPOSTA ANTIGA'),'resposta antiga não substitui chamado selecionado');
    await w.SistemaOSChamados.abrir();
    assert(mobile?w.document.getElementById('conversa-central-chamados-app').hidden:form.classList.contains('escondido'));
    dom.window.close();
  }
  console.log('OK: histórico PC/Android, finalizado/cancelado só leitura, corrida de seleção, prints válidos e rejeição de formatos externos.');
})().catch(erro=>{console.error(erro);process.exit(1);});
